const router = require('express').Router()
const { requireAuth } = require('../middleware/authMiddleware')
const { getBCAccessToken } = require('../utils/bcAuth')
const { supabase } = require('../utils/supabaseAdmin')
const { previewSync } = require('../utils/bcSyncProcessor')
const { isWithinSyncRange } = require('../utils/bcTransform')

// Admin-only.
router.use(requireAuth)
router.use((req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' })
  next()
})

// Extract the rig prefix from a BC documentNo.
//   "RD1/BO/2627/00105"   → "RD1"
//   "RIG/TAWS/BO/.../..."  → "RIG/TAWS"
//   "TAWS/BO/.../..."      → "TAWS"
function rigPrefix(documentNo) {
  if (!documentNo) return null
  const parts = String(documentNo).split('/')
  if (parts[0] === 'RIG' && parts[1]) return `RIG/${parts[1]}`
  return parts[0] || null
}

// ─── GET /api/admin/bc-integration/test-auth ──────────────────────────────────
// Verifies the BC OAuth client-credentials flow works. Never returns the token.
router.get('/test-auth', async (_req, res) => {
  try {
    const r = await getBCAccessToken()
    const expiresInSeconds = Math.max(0, Math.round((new Date(r.expires_at).getTime() - Date.now()) / 1000))
    console.log(`[bc-auth] token OK (length=${r.access_token.length}, from_cache=${r.from_cache}, expires_in=${expiresInSeconds}s)`)
    res.json({
      success:            true,
      token_received:     true,
      token_length:       r.access_token.length,
      expires_in_seconds: expiresInSeconds,
      from_cache:         r.from_cache,
      timestamp:          new Date().toISOString(),
    })
  } catch (e) {
    console.error('[bc-auth] token FAILED:', e.message)   // message only — never the token
    res.status(500).json({
      success: false,
      error:   e.message,
      hint:    e.hint || 'Check BC_TENANT_ID, BC_CLIENT_ID and BC_CLIENT_SECRET in server/.env, then restart.',
    })
  }
})

// ─── GET /api/admin/bc-integration/test-fetch?type=simple|full ────────────────
// Fetches sample Blanket Orders from BC to verify data flow. Does NOT persist.
router.get('/test-fetch', async (req, res) => {
  const type = ['simple', 'full', 'recent', 'discover'].includes(req.query.type) ? req.query.type : 'simple'
  const wantsExpand = type === 'full' || type === 'recent'   // 'recent' = full + date filter
  const { BC_TENANT_ID, BC_ENVIRONMENT, BC_COMPANY_ID } = process.env

  try {
    if (!BC_TENANT_ID || !BC_ENVIRONMENT || !BC_COMPANY_ID) {
      return res.status(500).json({
        success: false,
        error:   'BC data-fetch not configured in .env',
        hint:    'Set BC_TENANT_ID, BC_ENVIRONMENT and BC_COMPANY_ID in server/.env, then restart.',
      })
    }

    const { access_token } = await getBCAccessToken()

    const base = `https://api.businesscentral.dynamics.com/v2.0/${encodeURIComponent(BC_TENANT_ID)}/${encodeURIComponent(BC_ENVIRONMENT)}/api/TCPL/Procurement/v2.0/companies(${BC_COMPANY_ID})/blanketOrdersnew`

    // ── Diagnostic: probe which fields BC accepts in $filter / $orderby ─────────
    if (type === 'discover') {
      const probes = [
        { field: 'documentNo',     kind: 'filter',  description: "documentNo starts with 'RD1'",      param: "$filter=startswith(documentNo,'RD1')" },
        { field: 'vendorNo',       kind: 'filter',  description: "vendorNo eq 'DISCOVERY1-MR'",         param: "$filter=vendorNo eq 'DISCOVERY1-MR'" },
        { field: 'PurchaseLocation', kind: 'filter', description: "PurchaseLocation eq 'Mumbai'",       param: "$filter=PurchaseLocation eq 'Mumbai'" },
        { field: 'MRDesc',         kind: 'filter',  description: "MRDesc ne ''",                        param: "$filter=MRDesc ne ''" },
        { field: 'documentType',   kind: 'filter',  description: "documentType eq 'Blanket_x0020_Order'", param: "$filter=documentType eq 'Blanket_x0020_Order'" },
        { field: 'MRReleasedDate', kind: 'orderby', description: 'orderby MRReleasedDate desc',         param: '$orderby=MRReleasedDate desc' },
        { field: 'documentNo',     kind: 'orderby', description: 'orderby documentNo desc',             param: '$orderby=documentNo desc' },
        { field: 'documentNo',     kind: 'filter',  description: "documentNo starts with 'RD1/' (trailing slash test for Discovery 1 only)",          param: "$filter=startswith(documentNo,'RD1/')" },
        { field: 'documentNo',     kind: 'filter',  description: "documentNo starts with 'RD1DD/' (trailing slash test for Discovery 1 Dry Dock only)", param: "$filter=startswith(documentNo,'RD1DD/')" },
        { field: 'documentNo',     kind: 'filter',  description: "Confirm RD1 WITHOUT trailing slash matches both RD1 and RD1DD (should return records if both exist)", param: "$filter=startswith(documentNo,'RD1')" },
      ]
      const sleep = ms => new Promise(r => setTimeout(r, ms))
      const attempts = []

      for (let i = 0; i < probes.length; i++) {
        const p = probes[i]
        const full_url = `${base}?$top=1&${p.param}`
        let status_code = null, ok = false, records_returned = null, error = null
        try {
          console.log(`[bc-discover] #${i + 1} GET ${full_url}`)
          const r = await fetch(full_url, { headers: { Authorization: `Bearer ${access_token}`, Accept: 'application/json' } })
          status_code = r.status
          ok = r.ok
          const text = await r.text()
          let body = null
          try { body = JSON.parse(text) } catch { /* non-JSON */ }
          if (r.ok) records_returned = Array.isArray(body?.value) ? body.value.length : 0
          else error = (body?.error?.message || `HTTP ${r.status}`).slice(0, 400)
          console.log(`[bc-discover] #${i + 1} status ${r.status}`)
        } catch {
          error = 'Network error — could not reach Business Central API'
        }
        attempts.push({
          attempt_number: i + 1,
          description: p.description,
          kind: p.kind,
          field: p.field,
          filter_syntax: p.param,
          full_url,
          status_code,
          filterable: ok,
          records_returned,
          error,
        })
        if (i < probes.length - 1) await sleep(500)   // avoid rate limiting
      }

      const filterProbes  = attempts.filter(a => a.kind === 'filter')
      const orderbyProbes = attempts.filter(a => a.kind === 'orderby')
      const filterable_fields     = [...new Set(filterProbes.filter(a => a.filterable).map(a => a.field))]
      const non_filterable_fields = [...new Set(filterProbes.filter(a => !a.filterable).map(a => a.field))]
      const orderby_supported     = orderbyProbes.some(a => a.filterable)

      let recommended_filter_strategy
      if (filterable_fields.includes('documentNo')) {
        recommended_filter_strategy = "Filter by rig with startswith(documentNo,'<prefix>')"
          + (orderby_supported ? ", and sort recency with $orderby=documentNo desc or MRReleasedDate desc." : '.')
      } else if (filterable_fields.length) {
        recommended_filter_strategy = `Use supported filter field(s): ${filterable_fields.join(', ')}`
          + (orderby_supported ? '; combine with $orderby for recency.' : '.')
      } else if (orderby_supported) {
        recommended_filter_strategy = 'No tested $filter fields are supported — use $orderby (e.g. documentNo desc) and filter client-side after fetching.'
      } else {
        recommended_filter_strategy = 'Neither tested $filter nor $orderby is supported — fetch with $top and filter/sort entirely client-side.'
      }

      // Trailing-slash separation test (attempts 8 & 9 must both be accepted).
      const a8 = attempts.find(a => a.filter_syntax === "$filter=startswith(documentNo,'RD1/')")
      const a9 = attempts.find(a => a.filter_syntax === "$filter=startswith(documentNo,'RD1DD/')")
      const trailing_slash_filtering_supported = !!(a8?.filterable && a9?.filterable)
      const recommended_sync_strategy = trailing_slash_filtering_supported
        ? "Use trailing slash per rig (e.g. 'RD1/') for clean separation of dry-dock variants."
        : 'Use plain prefix + code-level filtering to separate dry dock variants.'

      return res.json({
        success:    true,
        fetch_type: 'discover',
        attempts,
        summary: {
          filterable_fields, non_filterable_fields, orderby_supported, recommended_filter_strategy,
          trailing_slash_filtering_supported, recommended_sync_strategy,
        },
        timestamp: new Date().toISOString(),
      })
    }

    let query = '?$top=5'
    if (wantsExpand) query += '&$expand=blanketLines($expand=linkedOrders($expand=receiptHeaders($expand=receiptLines)))'
    if (type === 'recent') query += "&$filter=MRReleasedDate ge '2026-07-01'"   // quoted: MRReleasedDate is Edm.String in BC
    const url = base + query

    console.log(`[bc-fetch] GET ${url}`)   // URL + status only — never the token
    const started = Date.now()
    let r
    try {
      r = await fetch(url, { headers: { Authorization: `Bearer ${access_token}`, Accept: 'application/json' } })
    } catch {
      return res.status(500).json({
        success: false,
        error:   'Could not reach Business Central API',
        hint:    'Check outbound internet and that api.businesscentral.dynamics.com is reachable.',
      })
    }
    const elapsed   = Date.now() - started
    const text      = await r.text()
    const sizeBytes = Buffer.byteLength(text, 'utf8')
    let data = null
    try { data = JSON.parse(text) } catch { /* non-JSON body */ }
    console.log(`[bc-fetch] status ${r.status} (${elapsed}ms, ${sizeBytes} bytes)`)

    if (!r.ok) {
      let hint = 'Verify BC_ENVIRONMENT, BC_COMPANY_ID and that the app can access the Procurement API.'
      if (r.status === 401 || r.status === 403) hint = 'Token rejected — confirm the app registration has Business Central API permission and access to this company.'
      else if (r.status === 404) hint = 'Not found — check BC_ENVIRONMENT, BC_COMPANY_ID and the API route path (blanketOrdersnew).'
      return res.status(500).json({
        success:       false,
        error:         data?.error?.message || `BC API returned HTTP ${r.status}`,
        hint,
        response_body: data || text.slice(0, 4000),
      })
    }

    const value  = Array.isArray(data?.value) ? data.value : []
    const docNos = value.map(v => v.documentNo).filter(Boolean)
    const prefixes = [...new Set(docNos.map(rigPrefix).filter(Boolean))]

    let uniqueBuyerCodes = [], emptyBuyerCount = 0, totalPoCount = 0
    if (wantsExpand) {
      const buyerSet = new Set()
      for (const bo of value) {
        for (const line of (Array.isArray(bo.blanketLines) ? bo.blanketLines : [])) {
          for (const po of (Array.isArray(line.linkedOrders) ? line.linkedOrders : [])) {
            totalPoCount++
            const code = String(po.BuyerCode ?? po.buyerCode ?? '').trim()
            if (code) buyerSet.add(code)
            else emptyBuyerCount++
          }
        }
      }
      uniqueBuyerCodes = [...buyerSet]
    }

    res.json({
      success:             true,
      fetch_type:          type,
      records_returned:    value.length,
      response_time_ms:    elapsed,
      response_size_bytes: sizeBytes,
      summary: {
        document_numbers:    docNos.slice(0, 5),
        unique_rig_prefixes: prefixes,
        unique_buyer_codes:  uniqueBuyerCodes,
        empty_buyer_count:   emptyBuyerCount,
        total_po_count:      totalPoCount,   // denominator for "N of M POs"
      },
      raw_data:  data,
      timestamp: new Date().toISOString(),
    })
  } catch (e) {
    console.error('[bc-fetch] FAILED:', e.message)
    res.status(500).json({ success: false, error: e.message, hint: e.hint || 'Check BC credentials and configuration in server/.env.' })
  }
})

// ─── GET /api/admin/bc-integration/preview-sync ───────────────────────────────
//   ?rig_prefix=<optional>   &fiscal_years=2627,2728
// Single $top=100 fetch. When a rig is selected, filters at BC by fiscal year
// (startswith documentNo '<prefix>/BO/<fy>' ...), which is fast and targets
// recent data directly. "All rigs" stays unfiltered (diagnostic). No DB writes.
router.get('/preview-sync', async (req, res) => {
  const rig_prefix = String(req.query.rig_prefix || '').trim().replace(/[^A-Za-z0-9]/g, '')  // sanitize for OData literal
  const fiscal_years = String(req.query.fiscal_years || '2627,2728')
    .split(',').map(s => s.trim().replace(/[^0-9]/g, '')).filter(Boolean)
  const { BC_TENANT_ID, BC_ENVIRONMENT, BC_COMPANY_ID } = process.env

  try {
    if (!BC_TENANT_ID || !BC_ENVIRONMENT || !BC_COMPANY_ID) {
      return res.status(500).json({
        success: false,
        error:   'BC data-fetch not configured in .env',
        hint:    'Set BC_TENANT_ID, BC_ENVIRONMENT and BC_COMPANY_ID in server/.env, then restart.',
      })
    }

    const { access_token } = await getBCAccessToken()

    const base   = `https://api.businesscentral.dynamics.com/v2.0/${encodeURIComponent(BC_TENANT_ID)}/${encodeURIComponent(BC_ENVIRONMENT)}/api/TCPL/Procurement/v2.0/companies(${BC_COMPANY_ID})/blanketOrdersnew`
    const expand = '$expand=blanketLines($expand=linkedOrders($expand=receiptHeaders($expand=receiptLines)))'

    // Fiscal-year filter only when a specific rig is chosen (BC uses lowercase 'or').
    let filter = ''
    if (rig_prefix && fiscal_years.length) {
      const clauses = fiscal_years.map(fy => `startswith(documentNo,'${rig_prefix}/BO/${fy}')`).join(' or ')
      filter = `&$filter=${clauses}`
    } else if (rig_prefix) {
      filter = `&$filter=startswith(documentNo,'${rig_prefix}/')`
    }

    const url = `${base}?$top=100&$orderby=documentNo desc&${expand}${filter}`   // newest BOs first
    console.log(`[bc-preview] GET ${url}`)   // URL + status only — never the token
    const started = Date.now()
    let r
    try {
      r = await fetch(url, { headers: { Authorization: `Bearer ${access_token}`, Accept: 'application/json' } })
    } catch {
      return res.status(500).json({ success: false, error: 'Could not reach Business Central API', hint: 'Check outbound internet and that api.businesscentral.dynamics.com is reachable.' })
    }
    const fetch_time_ms       = Date.now() - started
    const text                = await r.text()
    const bc_response_size_kb = +(Buffer.byteLength(text, 'utf8') / 1024).toFixed(1)
    let data = null
    try { data = JSON.parse(text) } catch { /* non-JSON body */ }
    console.log(`[bc-preview] status ${r.status} (${fetch_time_ms}ms, ${bc_response_size_kb} KB)`)

    if (!r.ok) {
      let hint = 'Verify BC_ENVIRONMENT, BC_COMPANY_ID and that the app can access the Procurement API.'
      if (r.status === 401 || r.status === 403) hint = 'Token rejected — confirm the app registration has Business Central API permission and access to this company.'
      else if (r.status === 404) hint = 'Not found — check BC_ENVIRONMENT, BC_COMPANY_ID and the API route path (blanketOrdersnew).'
      return res.status(500).json({ success: false, error: data?.error?.message || `BC API returned HTTP ${r.status}`, hint, response_body: data || text.slice(0, 4000) })
    }

    const procStart = Date.now()
    const preview   = await previewSync(data, supabase)   // read-only lookups; no writes
    const processing_time_ms = Date.now() - procStart

    res.json({
      success:            true,
      rig_prefix_filter:  rig_prefix || null,
      fiscal_years,
      fetch_time_ms,
      processing_time_ms,
      bc_response_size_kb,
      preview,
    })
  } catch (e) {
    console.error('[bc-preview] FAILED:', e.message)
    res.status(500).json({ success: false, error: e.message, hint: e.hint || 'Check BC credentials and configuration in server/.env.' })
  }
})

// ─── POST /api/admin/bc-integration/sync-to-staging ───────────────────────────
//   ?rig_prefix=X&fiscal_years=2627,2728
// Fetches BC data, processes it, and writes within-range POs to bc_po_staging.
// Does NOT touch po_orders. Logged in bc_sync_runs.
router.post('/sync-to-staging', async (req, res) => {
  const rig_prefix = String(req.query.rig_prefix || '').trim().replace(/[^A-Za-z0-9]/g, '')
  const fiscal_years = String(req.query.fiscal_years || '2627,2728')
    .split(',').map(s => s.trim().replace(/[^0-9]/g, '')).filter(Boolean)
  const { BC_TENANT_ID, BC_ENVIRONMENT, BC_COMPANY_ID } = process.env

  // Open a sync-run log row up front so failures are recorded too.
  const { data: run, error: runErr } = await supabase
    .from('bc_sync_runs')
    .insert({ triggered_by: req.user.id, rig_filter: rig_prefix || null, fiscal_years: fiscal_years.join(','), status: 'running' })
    .select().single()
  if (runErr) return res.status(500).json({ success: false, error: `Could not create sync run: ${runErr.message}` })
  const runId = run.id
  const started = Date.now()

  try {
    if (!BC_TENANT_ID || !BC_ENVIRONMENT || !BC_COMPANY_ID) {
      throw Object.assign(new Error('BC data-fetch not configured in .env'), { hint: 'Set BC_TENANT_ID, BC_ENVIRONMENT and BC_COMPANY_ID in server/.env, then restart.' })
    }

    const { access_token } = await getBCAccessToken()
    const base   = `https://api.businesscentral.dynamics.com/v2.0/${encodeURIComponent(BC_TENANT_ID)}/${encodeURIComponent(BC_ENVIRONMENT)}/api/TCPL/Procurement/v2.0/companies(${BC_COMPANY_ID})/blanketOrdersnew`
    const expand = '$expand=blanketLines($expand=linkedOrders($expand=receiptHeaders($expand=receiptLines)))'
    let filter = ''
    if (rig_prefix && fiscal_years.length) {
      filter = `&$filter=${fiscal_years.map(fy => `startswith(documentNo,'${rig_prefix}/BO/${fy}')`).join(' or ')}`
    } else if (rig_prefix) {
      filter = `&$filter=startswith(documentNo,'${rig_prefix}/')`
    }
    const url = `${base}?$top=100&$orderby=documentNo desc&${expand}${filter}`
    console.log(`[bc-staging] run ${runId} GET ${url}`)

    const r = await fetch(url, { headers: { Authorization: `Bearer ${access_token}`, Accept: 'application/json' } })
    const text = await r.text()
    let data = null
    try { data = JSON.parse(text) } catch { /* non-JSON */ }
    if (!r.ok) {
      throw Object.assign(new Error(data?.error?.message || `BC API returned HTTP ${r.status}`), { hint: 'Check BC_ENVIRONMENT, BC_COMPANY_ID and app permissions.' })
    }

    const preview = await previewSync(data, supabase)

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
        if (po.buyer_lookup?.auto_assigned_to_accounts) {
          warnings.push(`buyer auto-assigned to ACCOUNTS${po.buyer_lookup.bc_value ? ` (${po.buyer_lookup.bc_value})` : ' (empty)'}`)
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

    const stagingCount = poRecords.length
    if (skippedLineItems) console.warn(`[bc-staging] run ${runId}: skipped ${skippedLineItems} line item(s) missing item_code/qty_ordered`)
    const processing_time_ms = Date.now() - started
    const warnings_count = poRecords.filter(rec => rec.row.processed_warnings).length

    await supabase.from('bc_sync_runs').update({
      status: 'success', completed_at: new Date().toISOString(),
      total_bos_fetched: preview.total_bos, total_pos_processed: preview.total_pos,
      pos_within_range: within, pos_before_cutoff: before,
      staging_rows_inserted: stagingCount, processing_time_ms,
    }).eq('id', runId)

    res.json({
      success: true,
      sync_run_id: runId,
      summary: {
        total_bos_fetched: preview.total_bos, total_pos_processed: preview.total_pos,
        pos_within_range: within, pos_before_cutoff: before,
        staging_rows_inserted: stagingCount, line_items_staged: lineItemsStaged, processing_time_ms,
      },
      warnings_count,
      message: `${stagingCount} PO${stagingCount !== 1 ? 's' : ''} and ${lineItemsStaged} line item${lineItemsStaged !== 1 ? 's' : ''} inserted into staging. Review and promote when ready.`,
    })
  } catch (e) {
    console.error(`[bc-staging] run ${runId} FAILED:`, e.message)
    await supabase.from('bc_sync_runs').update({
      status: 'failed', completed_at: new Date().toISOString(),
      error_message: e.message, processing_time_ms: Date.now() - started,
    }).eq('id', runId)
    res.status(500).json({ success: false, sync_run_id: runId, error: e.message, hint: e.hint || 'Check BC credentials/configuration and the staging tables (run v24 migration).' })
  }
})

// ─── GET /api/admin/bc-integration/staging-rows?sync_run_id=X&status=pending ───
router.get('/staging-rows', async (req, res) => {
  const sync_run_id = String(req.query.sync_run_id || '').trim()
  const status      = String(req.query.status || 'pending').trim()

  let q = supabase.from('bc_po_staging').select('*').order('created_at', { ascending: false }).limit(500)
  if (sync_run_id) q = q.eq('sync_run_id', sync_run_id)
  if (status && status !== 'all') q = q.eq('promotion_status', status)
  const { data, error } = await q
  if (error) return res.status(500).json({ error: error.message })

  let sync_run_info = null
  if (sync_run_id) {
    const { data: runRow } = await supabase.from('bc_sync_runs').select('*').eq('id', sync_run_id).single()
    sync_run_info = runRow || null
  }
  res.json({ rows: data || [], total: (data || []).length, sync_run_info })
})

// ─── POST /api/admin/bc-integration/promote-to-po-orders ──────────────────────
//   ?sync_run_id=X&batch_size=10&dry_run=true
// Promotes pending INSERT staging rows into po_orders (+ po_line_items).
// Safety: batch-limited, supports dry_run, per-PO compensation on failure.
// Handles sync_action='INSERT' only (UPDATE comes later).
router.post('/promote-to-po-orders', async (req, res) => {
  const sync_run_id = String(req.query.sync_run_id || '').trim()
  if (!sync_run_id) return res.status(400).json({ error: 'sync_run_id is required.' })
  const batch_size = Math.min(Math.max(parseInt(req.query.batch_size, 10) || 10, 1), 1000)
  const dry_run = req.query.dry_run === 'true'
  const now = () => new Date().toISOString()

  const dateOrNull = v => (v ? String(v) : null)

  try {
    const { data: staging, error } = await supabase
      .from('bc_po_staging').select('*')
      .eq('sync_run_id', sync_run_id).eq('promotion_status', 'pending').eq('sync_action', 'INSERT')
      .order('created_at', { ascending: true })
      .limit(batch_size)
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
    const seenPoNumbers = new Set()   // catches in-batch duplicates too

    for (const s of staging) {
      const stagingLis = (liByStaging.get(s.id) || []).filter(li => li.item_code)  // item_name NOT NULL

      // Duplicate check: skip if this po_number already exists in po_orders, or
      // already appeared earlier in this batch.
      let alreadyExists = seenPoNumbers.has(s.po_number)
      if (!alreadyExists) {
        const { data: dup } = await supabase.from('po_orders').select('id').eq('po_number', s.po_number).limit(1)
        alreadyExists = !!(dup && dup.length)
      }
      if (alreadyExists) {
        pos_skipped++
        if (!dry_run) await supabase.from('bc_po_staging').update({ promotion_status: 'skipped', promotion_notes: 'already_in_po_orders' }).eq('id', s.id)
        details.push({ po_number: s.po_number, status: dry_run ? 'would_skip' : 'skipped', new_po_id: null, reason: 'already_in_po_orders' })
        continue
      }
      seenPoNumbers.add(s.po_number)

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
        bc_source: true, bc_last_synced: now(), created_by: req.user.id, updated_at: now(),
      }
      const { data: newPo, error: poErr } = await supabase.from('po_orders').insert(poRow).select('id').single()
      if (poErr) {
        pos_failed++
        await supabase.from('bc_po_staging').update({ promotion_status: 'failed', promotion_notes: `PO insert: ${poErr.message}` }).eq('id', s.id)
        details.push({ po_number: s.po_number, status: 'failed', new_po_id: null, error: poErr.message })
        continue
      }
      const poId = newPo.id

      // 2. Insert line items (generated columns quantity_pending/item_status are skipped).
      if (stagingLis.length) {
        const liRows = stagingLis.map(li => ({
          po_id: poId,
          item_name: li.item_code,
          material_description: li.item_description ?? null,
          unit: li.uom ?? null,
          quantity_ordered: li.qty_ordered ?? 0,
          quantity_delivered: li.qty_received ?? 0,
        }))
        const { data: insertedLis, error: liErr } = await supabase.from('po_line_items').insert(liRows).select('id')
        if (liErr) {
          // Compensate: remove the PO just inserted (cascades any line items).
          await supabase.from('po_orders').delete().eq('id', poId)
          pos_failed++
          await supabase.from('bc_po_staging').update({ promotion_status: 'failed', promotion_notes: `Line item insert: ${liErr.message}` }).eq('id', s.id)
          details.push({ po_number: s.po_number, status: 'failed', new_po_id: null, error: liErr.message })
          continue
        }
        line_items_promoted += insertedLis.length
        // Mark staged line items promoted, linking to their new ids (by order).
        for (let k = 0; k < stagingLis.length; k++) {
          await supabase.from('bc_po_line_items_staging')
            .update({ promotion_status: 'promoted', promoted_at: now(), promoted_line_item_id: insertedLis[k]?.id ?? null })
            .eq('id', stagingLis[k].id)
        }
      }

      // 3. Mark the staging PO promoted.
      await supabase.from('bc_po_staging')
        .update({ promotion_status: 'promoted', promoted_at: now(), promoted_po_id: poId })
        .eq('id', s.id)
      pos_promoted++
      details.push({ po_number: s.po_number, status: 'promoted', new_po_id: poId })
    }

    // Remaining pending INSERT rows for this run.
    const { count: remaining } = await supabase
      .from('bc_po_staging').select('id', { count: 'exact', head: true })
      .eq('sync_run_id', sync_run_id).eq('promotion_status', 'pending').eq('sync_action', 'INSERT')

    res.json({
      success: true,
      dry_run,
      batch_size_requested: batch_size,
      pos_promoted, pos_failed, pos_skipped, line_items_promoted,
      details,
      remaining_pending: remaining ?? 0,
    })
  } catch (e) {
    console.error('[bc-promote] FAILED:', e.message)
    res.status(500).json({ success: false, error: e.message, hint: 'Ensure v27 columns exist on po_orders and staging tables are populated.' })
  }
})

// ─── GET /api/admin/bc-integration/staging-line-items/:bc_staging_id ──────────
router.get('/staging-line-items/:bc_staging_id', async (req, res) => {
  const { data, error } = await supabase
    .from('bc_po_line_items_staging')
    .select('*')
    .eq('bc_staging_id', req.params.bc_staging_id)
    .order('bc_line_no', { ascending: true })
  if (error) return res.status(500).json({ error: error.message })
  res.json(data || [])
})

// ─── POST /api/admin/bc-integration/preview-promote?sync_run_id=X ──────────────
// Dry run: analyzes what promoting a run's pending staging rows to po_orders
// WOULD do. READ-ONLY on po_orders / po_line_items — only writes the planned
// sync_action back onto bc_po_staging. No promotion is performed.
//
// Purchase-side fields compared on UPDATE (mapped staging → po_orders column):
const PROMOTE_COMPARE = [
  ['mr_number',            'mr_number'],
  ['vendor_name',          'vendor_name'],
  ['material_description',  'material_description'],
  ['material_description_2','material_description_2'],
  ['po_date',              'po_date'],
  ['buyer_code',           'buyer_code'],
  ['grn_number',           'grn_number'],
  ['po_status',            'status'],
]
// NEVER compared/updated (logistics-side, JDIL-owned): dispatch_date,
// material_received_date, delivered_to_rig_date, logistics_team_code, remarks,
// other_remarks. Staging fields with no current po_orders column (mr_description,
// mr_date, vendor_code, gran_date, quantities_pending_confirmation) are left out
// until the po_orders schema gains them (promotion phase).

router.post('/preview-promote', async (req, res) => {
  const sync_run_id = String(req.query.sync_run_id || '').trim()
  if (!sync_run_id) return res.status(400).json({ error: 'sync_run_id is required.' })

  try {
    const { data: staging, error } = await supabase
      .from('bc_po_staging').select('*')
      .eq('sync_run_id', sync_run_id).eq('promotion_status', 'pending')
    if (error) throw new Error(error.message)

    // Match existing POs by po_number (single query).
    const poNumbers = [...new Set(staging.map(s => s.po_number).filter(Boolean))]
    const existingByPo = new Map()
    for (let i = 0; i < poNumbers.length; i += 300) {
      const { data: existing } = await supabase.from('po_orders').select('*').in('po_number', poNumbers.slice(i, i + 300))
      for (const e of existing || []) existingByPo.set(e.po_number, e)
    }

    // Staging line items grouped by staging id (single pass).
    const stagingIds = staging.map(s => s.id)
    const liByStaging = new Map()
    for (let i = 0; i < stagingIds.length; i += 200) {
      const { data: lis } = await supabase.from('bc_po_line_items_staging').select('bc_staging_id, item_code, qty_ordered').in('bc_staging_id', stagingIds.slice(i, i + 200))
      for (const li of lis || []) { const a = liByStaging.get(li.bc_staging_id) || []; a.push(li); liByStaging.set(li.bc_staging_id, a) }
    }

    const rows = []
    const summary = { will_insert: 0, will_update: 0, will_skip: 0, inserts_with_grn: 0, updates_with_grn: 0 }
    const idsByAction = { INSERT: [], UPDATE: [], SKIP: [] }

    for (const s of staging) {
      const existing = existingByPo.get(s.po_number) || null
      const sLineItems = liByStaging.get(s.id) || []
      let action, skip_reason = null
      const field_changes = {}
      let line_items_to_insert = 0, line_items_to_update = 0, line_items_unchanged = 0
      const warnings = Array.isArray(s.processed_warnings) ? [...s.processed_warnings] : []

      if (!existing) {
        action = 'INSERT'
        line_items_to_insert = sLineItems.length
      } else if (String(existing.status || '').toLowerCase() === 'cancelled') {
        action = 'SKIP'; skip_reason = 'already_cancelled'
      } else {
        for (const [sf, pc] of PROMOTE_COMPARE) {
          if (String(s[sf] ?? '') !== String(existing[pc] ?? '')) field_changes[sf] = { from: existing[pc] ?? null, to: s[sf] ?? null }
        }
        // Compare line items by item_code vs existing po_line_items.item_name.
        const { data: existingLis } = await supabase.from('po_line_items').select('item_name, quantity_ordered').eq('po_id', existing.id)
        const exByName = new Map((existingLis || []).map(x => [String(x.item_name), x]))
        for (const li of sLineItems) {
          const ex = exByName.get(String(li.item_code))
          if (!ex) line_items_to_insert++
          else if (String(ex.quantity_ordered ?? '') !== String(li.qty_ordered ?? '')) line_items_to_update++
          else line_items_unchanged++
        }
        if (Object.keys(field_changes).length === 0 && line_items_to_insert === 0 && line_items_to_update === 0) {
          action = 'SKIP'; skip_reason = 'no_changes'
        } else {
          action = 'UPDATE'
        }
      }

      if (action === 'INSERT') { summary.will_insert++; if (s.grn_number) summary.inserts_with_grn++ }
      else if (action === 'UPDATE') { summary.will_update++; if (s.grn_number) summary.updates_with_grn++ }
      else summary.will_skip++
      idsByAction[action].push(s.id)

      rows.push({
        staging_id: s.id, po_number: s.po_number, action, skip_reason,
        existing_po_id: existing ? existing.id : null,
        field_changes, line_items_to_insert, line_items_to_update, line_items_unchanged, warnings,
      })
    }

    // Part 2: persist the planned action (promotion_status stays 'pending').
    for (const act of ['INSERT', 'UPDATE', 'SKIP']) {
      const ids = idsByAction[act]
      for (let i = 0; i < ids.length; i += 200) {
        await supabase.from('bc_po_staging').update({ sync_action: act }).in('id', ids.slice(i, i + 200))
      }
    }

    res.json({ sync_run_id, total_rows: staging.length, summary, rows })
  } catch (e) {
    console.error('[bc-preview-promote] FAILED:', e.message)
    res.status(500).json({ error: e.message, hint: 'Ensure staging tables exist (v24/v25) and the sync run has pending rows.' })
  }
})

// ─── GET /api/admin/bc-integration/sync-runs ──────────────────────────────────
router.get('/sync-runs', async (_req, res) => {
  const { data, error } = await supabase
    .from('bc_sync_runs').select('*').order('started_at', { ascending: false }).limit(20)
  if (error) return res.status(500).json({ error: error.message })
  res.json(data || [])
})

module.exports = router
