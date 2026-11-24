/**
 * bcSyncService.js — shared BC → staging → po_orders logic.
 *
 * Extracted so the admin routes (manual) AND the cron scheduler use ONE
 * implementation instead of two copies that could drift. These are pure async
 * functions — no Express req/res. Behaviour is identical to the original
 * sync-to-staging / promote-to-po-orders route bodies.
 *
 *   stageRig()    — fetch one rig's BOs and write within-range POs (+ line
 *                   items) to bc_po_staging under an EXISTING run id. It does
 *                   NOT create or update the bc_sync_runs row (the caller owns
 *                   the run row), so a cron run can stage all 14 rigs under one
 *                   master run.
 *   promoteRun()  — promote a run's pending INSERT staging rows to po_orders.
 */

const { getBCAccessToken } = require('./bcAuth')
const { supabase } = require('./supabaseAdmin')
const { previewSync } = require('./bcSyncProcessor')
const { isWithinSyncRange } = require('./bcTransform')
const rateLimiter = require('./bcRateLimiter')
const { withRetry } = require('./bcRetry')

// How many blanket orders we request per rig in a single BC call ($top), how
// many pages we will walk before giving up ($skip loop), and the pause between
// pages so we stay gentle on BC / the rate limiter.
const BO_FETCH_TOP     = 100
const BO_MAX_PAGES     = 10         // safety cap → up to 1,000 BOs per rig
const BO_PAGE_DELAY_MS = 500        // delay between pages

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ── BC query helpers ──────────────────────────────────────────────────────────
function bcBase() {
  const { BC_TENANT_ID, BC_ENVIRONMENT, BC_COMPANY_ID } = process.env
  if (!BC_TENANT_ID || !BC_ENVIRONMENT || !BC_COMPANY_ID) {
    throw Object.assign(new Error('BC data-fetch not configured in .env'), {
      hint: 'Set BC_TENANT_ID, BC_ENVIRONMENT and BC_COMPANY_ID in server/.env, then restart.',
    })
  }
  return `https://api.businesscentral.dynamics.com/v2.0/${encodeURIComponent(BC_TENANT_ID)}/${encodeURIComponent(BC_ENVIRONMENT)}/api/TCPL/Procurement/v2.0/companies(${BC_COMPANY_ID})/blanketOrdersnew`
}

// Same filter logic the routes use: per-rig + fiscal-year, or plain prefix, or none.
function buildFilter(rig_prefix, fiscal_years) {
  if (rig_prefix && fiscal_years.length) {
    return `&$filter=${fiscal_years.map(fy => `startswith(documentNo,'${rig_prefix}/BO/${fy}')`).join(' or ')}`
  }
  if (rig_prefix) return `&$filter=startswith(documentNo,'${rig_prefix}/')`
  return ''
}

// NOTE: BC returns at most $top=100 BOs per call. A rig can have more than that,
// so we PAGINATE with $skip, walking pages until BC returns a short page (natural
// end) or we hit BO_MAX_PAGES (safety cap). likely_truncated is TRUE only when we
// stop at the safety cap — i.e. there may still be more BOs we never fetched.
// A full first page is NO LONGER truncation on its own; it just means "fetch the
// next page". (Oct 2026: RV1DD hits the 100-per-page ceiling and needs paging.)
async function fetchBlanketOrders({ rig_prefix, fiscal_years, label }) {
  const { access_token } = await getBCAccessToken()   // token stays UNWRAPPED (no limiter/retry)
  const expand = '$expand=blanketLines($expand=linkedOrders($expand=receiptHeaders($expand=receiptLines)))'
  const filter = buildFilter(rig_prefix, fiscal_years)
  const rigTag = rig_prefix || '(all)'

  console.log(`[bc-pagination] Starting pagination for rig ${rigTag}`)

  const all = []
  let page = 0
  let hitCap = false
  for (page = 1; page <= BO_MAX_PAGES; page++) {
    const skip = (page - 1) * BO_FETCH_TOP
    const url = `${bcBase()}?$top=${BO_FETCH_TOP}&$skip=${skip}&$orderby=documentNo desc&${expand}${filter}`
    console.log(`[bc-sync]${label ? ` ${label}` : ''} GET ${url}`)   // URL + status only — never the token

    // Wrap only the DATA fetch with rate limiter + retry (the sync-to-staging
    // endpoint and the cron scheduler both reach BC through here). The token
    // fetch above stays outside the limiter to avoid re-entrant deadlock.
    await rateLimiter.acquire()
    let r
    try {
      r = await withRetry(() => fetch(url, { headers: { Authorization: `Bearer ${access_token}`, Accept: 'application/json' } }), { maxAttempts: 3 })
    } finally {
      rateLimiter.release()
    }
    const text = await r.text()
    let data = null
    try { data = JSON.parse(text) } catch { /* non-JSON body */ }
    if (!r.ok) {
      throw Object.assign(new Error(data?.error?.message || `BC API returned HTTP ${r.status}`), {
        hint: 'Check BC_ENVIRONMENT, BC_COMPANY_ID and app permissions.',
      })
    }

    const pageValue = Array.isArray(data?.value) ? data.value : []
    all.push(...pageValue)

    console.log(`[bc-pagination] Rig ${rigTag} page ${page}: fetched ${pageValue.length} BOs (cumulative: ${all.length})`)

    if (pageValue.length < BO_FETCH_TOP) break          // short page → natural end
    if (page >= BO_MAX_PAGES) { hitCap = true; break }   // safety cap → maybe more exist
    await sleep(BO_PAGE_DELAY_MS)                         // be gentle between pages
  }

  const pages_fetched = page
  console.log(`[bc-pagination] Completed: ${pages_fetched} pages, ${all.length} total BOs${hitCap ? ' (SAFETY CAP HIT — may be truncated)' : ''}`)

  return {
    value: all,
    bo_count: all.length,
    pages_fetched,
    likely_truncated: hitCap,                            // only true at the safety cap
    truncation_reason: hitCap ? 'safety_cap' : null,
  }
}

// ── Stage one rig under an existing run ────────────────────────────────────────
/**
 * @param {{ rig_prefix: string, fiscal_years: string[], runId: string, label?: string }} opts
 * @returns {Promise<{ total_bos, total_pos, within, before, staging_rows, line_items, warnings_count, skipped_line_items }>}
 */
async function stageRig({ rig_prefix, fiscal_years, runId, label }) {
  const fetched = await fetchBlanketOrders({ rig_prefix, fiscal_years, label })
  if (fetched.likely_truncated) {
    console.warn(`[bc-truncation] Rig ${rig_prefix || '(all)'} hit the ${fetched.pages_fetched}-page safety cap (${fetched.bo_count} BOs). There may be more — raise BO_MAX_PAGES or add deeper paging.`)
  }
  const preview = await previewSync(fetched, supabase)

  // Build staging PO records (each with its line items) for within-range POs.
  const poRecords = []   // [{ row, lineItems }]
  let within = 0, before = 0, skippedLineItems = 0
  for (const bo of preview.blanket_orders) {
    for (const po of bo.pos_processed) {
      const td = po.transformed_data
      if (!isWithinSyncRange(td.mr_date)) { before++; continue }
      within++
      if (!td.po_number) continue   // po_number is NOT NULL in staging — skip if absent

      const qtyPending = po.quantities_pending_confirmation ?? !!(po.gran_data?.grn_number)

      const warnings = []
      if (!bo.rig_matched) warnings.push(`unknown rig: ${bo.rig_prefix || '(none)'}`)
      if (po.buyer_lookup?.needs_manual_review) {
        warnings.push(`buyer not assigned - needs manual review${po.buyer_lookup.bc_value ? ` (${po.buyer_lookup.bc_value})` : ' (empty)'}`)
      }
      if (qtyPending) warnings.push('⚠️ GRN received - rig team needs to confirm quantities')

      const row = {
        mr_number: td.mr_number, mr_description: td.mr_description, mr_date: td.mr_date,
        rig_name: td.rig_name, office_location: td.office_location,
        po_number: td.po_number, vendor_code: td.vendor_code, vendor_name: td.vendor_name,
        material_description: td.material_description, material_description_2: td.material_description_2,
        po_date: td.po_date, po_status: td.po_status,
        buyer_code: td.buyer_code, buyer_code_raw: td.buyer_code_raw,
        grn_number: po.gran_data?.grn_number ?? null, gran_date: po.gran_data?.gran_date ?? null,
        bc_blanket_order_id: td.bc_blanket_order_id, bc_linked_order_id: td.bc_linked_order_id,
        sync_run_id: runId,
        sync_action: po.action_needed || 'INSERT',
        promotion_status: 'pending',
        quantities_pending_confirmation: qtyPending,
        processed_warnings: warnings.length ? warnings : null,
      }
      // Skip line items lacking an item code or ordered qty.
      const lineItems = (po.line_items || []).filter(li => {
        const ok = li.item_code && li.qty_ordered != null
        if (!ok) skippedLineItems++
        return ok
      })
      poRecords.push({ row, lineItems })
    }
  }

  // Insert PO rows (capturing ids), then their line items. PostgREST returns
  // inserted rows in input order, so we zip by index within each chunk.
  let lineItemsStaged = 0
  for (let i = 0; i < poRecords.length; i += 500) {
    const chunk = poRecords.slice(i, i + 500)
    const { data: inserted, error: insErr } = await supabase
      .from('bc_po_staging').insert(chunk.map(rec => rec.row)).select('id')
    if (insErr) throw new Error(`Staging insert failed: ${insErr.message}`)

    const liRows = []
    inserted.forEach((ins, idx) => {
      const rec = chunk[idx]
      for (const li of rec.lineItems) {
        const n = Number(li.bc_line_no)
        liRows.push({
          bc_staging_id:      ins.id,
          po_number:          rec.row.po_number,
          bc_line_no:         Number.isFinite(n) ? n : null,
          item_code:          li.item_code,
          item_description:   li.item_description ?? null,
          qty_ordered:        li.qty_ordered ?? null,
          qty_received:       li.qty_received ?? 0,
          uom:                li.uom ?? null,
          bc_blanket_line_id: li.bc_blanket_line_id ?? null,
        })
      }
    })
    for (let j = 0; j < liRows.length; j += 500) {
      const { error: liErr } = await supabase.from('bc_po_line_items_staging').insert(liRows.slice(j, j + 500))
      if (liErr) throw new Error(`Line item insert failed: ${liErr.message}`)
    }
    lineItemsStaged += liRows.length
  }

  if (skippedLineItems) console.warn(`[bc-sync] run ${runId}${label ? ` ${label}` : ''}: skipped ${skippedLineItems} line item(s) missing item_code/qty_ordered`)

  return {
    total_bos: preview.total_bos, total_pos: preview.total_pos,
    within, before,
    staging_rows: poRecords.length, line_items: lineItemsStaged,
    warnings_count: poRecords.filter(rec => rec.row.processed_warnings).length,
    skipped_line_items: skippedLineItems,
    likely_truncated: fetched.likely_truncated, bo_count: fetched.bo_count,
    pages_fetched: fetched.pages_fetched, truncation_reason: fetched.truncation_reason,
  }
}

// ── Promote a run's pending INSERT staging rows into po_orders ──────────────────
/**
 * @param {{ sync_run_id: string, batch_size?: number, dry_run?: boolean, createdBy?: string|null }} opts
 * createdBy is the users(id) to stamp onto new po_orders rows; null for cron
 * (po_orders.created_by is nullable).
 */
async function promoteRun({ sync_run_id, batch_size = 10, dry_run = false, createdBy = null }) {
  const bs = Math.min(Math.max(parseInt(batch_size, 10) || 10, 1), 1000)
  const now = () => new Date().toISOString()
  const dateOrNull = v => (v ? String(v) : null)

  const { data: staging, error } = await supabase
    .from('bc_po_staging').select('*')
    .eq('sync_run_id', sync_run_id).eq('promotion_status', 'pending').eq('sync_action', 'INSERT')
    .order('created_at', { ascending: true })
    .limit(bs)
  if (error) throw new Error(error.message)

  // Pre-fetch line items for the batch.
  const liByStaging = new Map()
  const ids = staging.map(s => s.id)
  for (let i = 0; i < ids.length; i += 200) {
    const { data: lis } = await supabase.from('bc_po_line_items_staging').select('*').in('bc_staging_id', ids.slice(i, i + 200)).order('bc_line_no', { ascending: true })
    for (const li of lis || []) { const a = liByStaging.get(li.bc_staging_id) || []; a.push(li); liByStaging.set(li.bc_staging_id, a) }
  }

  const details = []
  let pos_promoted = 0, pos_failed = 0, pos_skipped = 0, line_items_promoted = 0
  // po_number -> existing/created po_id. Catches in-batch splits: one PO's line
  // items can arrive across several staging rows (e.g. one per blanket line), so
  // later rows for the same PO must ADD their missing line items, not be skipped.
  const seenPoIdByNumber = new Map()
  // po_id -> Set<item_name> already present. Seeded from DB on first use, then
  // kept current in memory as we insert within this batch.
  const existingItemsByPoId = new Map()
  let line_items_added_to_existing = 0   // extra observability (new behaviour)

  async function existingItemsFor(poId) {
    if (existingItemsByPoId.has(poId)) return existingItemsByPoId.get(poId)
    const { data: existing } = await supabase.from('po_line_items').select('item_name').eq('po_id', poId)
    const set = new Set((existing || []).map(r => r.item_name))
    existingItemsByPoId.set(poId, set)
    return set
  }

  for (const s of staging) {
    const stagingLis = (liByStaging.get(s.id) || []).filter(li => li.item_code)  // item_name NOT NULL

    // Resolve an existing po_id for this po_number: created earlier in this batch,
    // or already present in po_orders.
    let poId = seenPoIdByNumber.get(s.po_number) || null
    if (!poId) {
      const { data: dup } = await supabase.from('po_orders').select('id').eq('po_number', s.po_number).limit(1)
      if (dup && dup.length) { poId = dup[0].id; seenPoIdByNumber.set(s.po_number, poId) }
    }

    // ── CASE B: PO already exists → add only its MISSING line items ──────────────
    // Match key is (po_id, item_name) — po_line_items has no bc_line_no column.
    if (poId) {
      const existingSet = await existingItemsFor(poId)
      const newLis = []
      for (const li of stagingLis) {
        if (existingSet.has(li.item_code)) continue   // true duplicate line item
        existingSet.add(li.item_code)                 // also dedups within this row
        newLis.push(li)
      }
      const dupCount = stagingLis.length - newLis.length

      if (dry_run) {
        if (newLis.length) {
          pos_promoted++; line_items_promoted += newLis.length
          details.push({ po_number: s.po_number, status: 'would_promote', new_po_id: poId, line_items: newLis.length, existing_po: true, reason: `would add ${newLis.length} line item(s) to existing PO` })
        } else {
          pos_skipped++
          details.push({ po_number: s.po_number, status: 'would_skip', new_po_id: poId, reason: 'all_line_items_present' })
        }
        continue
      }

      if (newLis.length === 0) {
        pos_skipped++
        await supabase.from('bc_po_staging')
          .update({ promotion_status: 'skipped', promoted_po_id: poId, promotion_notes: 'no new line items to add - all already present' })
          .eq('id', s.id)
        details.push({ po_number: s.po_number, status: 'skipped', new_po_id: poId, reason: 'all_line_items_present' })
        continue
      }

      const liRows = newLis.map(li => ({
        po_id: poId,
        item_name: li.item_code,
        material_description: li.item_description ?? null,
        unit: li.uom ?? null,
        quantity_ordered: li.qty_ordered ?? 0,
        quantity_delivered: li.qty_received ?? 0,
      }))
      const { data: insertedLis, error: liErr } = await supabase.from('po_line_items').insert(liRows).select('id')
      if (liErr) {
        // The PO pre-existed — never delete it. Just mark this staging row failed.
        pos_failed++
        await supabase.from('bc_po_staging').update({ promotion_status: 'failed', promotion_notes: `Line item insert (existing PO): ${liErr.message}` }).eq('id', s.id)
        details.push({ po_number: s.po_number, status: 'failed', new_po_id: poId, error: liErr.message })
        continue
      }
      line_items_promoted += insertedLis.length
      line_items_added_to_existing += insertedLis.length

      // Mark staged line items: newly inserted → promoted (link id by order);
      // the duplicates in this row → skipped.
      const newSet = new Set(newLis)
      for (const li of stagingLis) {
        if (!newSet.has(li)) {
          await supabase.from('bc_po_line_items_staging').update({ promotion_status: 'skipped', promotion_notes: 'already_in_po_line_items' }).eq('id', li.id)
        }
      }
      for (let k = 0; k < newLis.length; k++) {
        await supabase.from('bc_po_line_items_staging')
          .update({ promotion_status: 'promoted', promoted_at: now(), promoted_line_item_id: insertedLis[k]?.id ?? null })
          .eq('id', newLis[k].id)
      }

      // PART 5: prove BC data was processed against this PO (do NOT touch any
      // other PO field — status/vendor/dates are manual edits; bc_source stays true).
      await supabase.from('po_orders').update({ bc_last_synced: now() }).eq('id', poId)

      await supabase.from('bc_po_staging')
        .update({ promotion_status: 'promoted', promoted_at: now(), promoted_po_id: poId,
                  promotion_notes: `added ${insertedLis.length} new line items to existing PO${dupCount ? ` (${dupCount} existing items unchanged)` : ''}` })
        .eq('id', s.id)
      pos_promoted++
      details.push({ po_number: s.po_number, status: 'promoted', new_po_id: poId, line_items_added: insertedLis.length, duplicates: dupCount, existing_po: true })
      continue
    }

    // ── CASE A: brand-new PO → insert PO + ALL its line items (original flow) ─────
    if (dry_run) {
      details.push({ po_number: s.po_number, status: 'would_promote', new_po_id: null, line_items: stagingLis.length })
      pos_promoted++; line_items_promoted += stagingLis.length
      continue
    }

    // 1. Insert the PO.
    const poRow = {
      mr_number: s.mr_number, po_number: s.po_number, mr_description: s.mr_description,
      mr_date: dateOrNull(s.mr_date), rig_name: s.rig_name, office_location: s.office_location,
      vendor_code: s.vendor_code, vendor_name: s.vendor_name,
      material_description: s.material_description, material_description_2: s.material_description_2,
      po_date: dateOrNull(s.po_date), status: s.po_status, buyer_code: s.buyer_code,
      grn_number: s.grn_number, delivered_to_rig_date: dateOrNull(s.gran_date),
      quantities_pending_confirmation: s.quantities_pending_confirmation,
      bc_blanket_order_id: s.bc_blanket_order_id, bc_linked_order_id: s.bc_linked_order_id,
      bc_source: true, bc_last_synced: now(), created_by: createdBy, updated_at: now(),
    }
    const { data: newPo, error: poErr } = await supabase.from('po_orders').insert(poRow).select('id').single()
    if (poErr) {
      pos_failed++
      await supabase.from('bc_po_staging').update({ promotion_status: 'failed', promotion_notes: `PO insert: ${poErr.message}` }).eq('id', s.id)
      details.push({ po_number: s.po_number, status: 'failed', new_po_id: null, error: poErr.message })
      continue
    }
    const newPoId = newPo.id
    seenPoIdByNumber.set(s.po_number, newPoId)
    const seedSet = new Set()
    existingItemsByPoId.set(newPoId, seedSet)   // later rows for this PO add to it

    // 2. Insert line items (generated columns quantity_pending/item_status are skipped).
    if (stagingLis.length) {
      const liRows = stagingLis.map(li => ({
        po_id: newPoId,
        item_name: li.item_code,
        material_description: li.item_description ?? null,
        unit: li.uom ?? null,
        quantity_ordered: li.qty_ordered ?? 0,
        quantity_delivered: li.qty_received ?? 0,
      }))
      const { data: insertedLis, error: liErr } = await supabase.from('po_line_items').insert(liRows).select('id')
      if (liErr) {
        // Compensate: remove the PO just inserted (cascades any line items).
        await supabase.from('po_orders').delete().eq('id', newPoId)
        existingItemsByPoId.delete(newPoId)
        seenPoIdByNumber.delete(s.po_number)   // PO no longer exists
        pos_failed++
        await supabase.from('bc_po_staging').update({ promotion_status: 'failed', promotion_notes: `Line item insert: ${liErr.message}` }).eq('id', s.id)
        details.push({ po_number: s.po_number, status: 'failed', new_po_id: null, error: liErr.message })
        continue
      }
      line_items_promoted += insertedLis.length
      for (const li of stagingLis) seedSet.add(li.item_code)   // keep cache current for later rows
      // Mark staged line items promoted, linking to their new ids (by order).
      for (let k = 0; k < stagingLis.length; k++) {
        await supabase.from('bc_po_line_items_staging')
          .update({ promotion_status: 'promoted', promoted_at: now(), promoted_line_item_id: insertedLis[k]?.id ?? null })
          .eq('id', stagingLis[k].id)
      }
    }

    // 3. Mark the staging PO promoted.
    await supabase.from('bc_po_staging')
      .update({ promotion_status: 'promoted', promoted_at: now(), promoted_po_id: newPoId, promotion_notes: `promoted new PO with ${stagingLis.length} line items` })
      .eq('id', s.id)
    pos_promoted++
    details.push({ po_number: s.po_number, status: 'promoted', new_po_id: newPoId, line_items: stagingLis.length })
  }

  // Remaining pending INSERT rows for this run.
  const { count: remaining } = await supabase
    .from('bc_po_staging').select('id', { count: 'exact', head: true })
    .eq('sync_run_id', sync_run_id).eq('promotion_status', 'pending').eq('sync_action', 'INSERT')

  return {
    success: true,
    dry_run,
    batch_size_requested: bs,
    pos_promoted, pos_failed, pos_skipped, line_items_promoted,
    line_items_added_to_existing,
    details,
    remaining_pending: remaining ?? 0,
  }
}

module.exports = { stageRig, promoteRun }
