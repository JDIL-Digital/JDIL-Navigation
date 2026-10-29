const router = require('express').Router()
const { requireAuth } = require('../middleware/authMiddleware')
const { getBCAccessToken } = require('../utils/bcAuth')
const { supabase } = require('../utils/supabaseAdmin')
const { previewSync } = require('../utils/bcSyncProcessor')
const { stageRig, promoteRun } = require('../utils/bcSyncService')
const { getSchedulerStatus, runFullSync } = require('../utils/bcCronScheduler')
const rateLimiter = require('../utils/bcRateLimiter')
const { withRetry } = require('../utils/bcRetry')

// Wrap a BC DATA fetch with the rate limiter + retry. Token fetch is NOT routed
// through here (it stays plain in bcAuth.js) — that avoids the re-entrant
// deadlock that broke the connection previously.
async function bcFetch(url, options = {}) {
  await rateLimiter.acquire()
  try {
    return await withRetry(() => fetch(url, options), { maxAttempts: 3 })
  } finally {
    rateLimiter.release()
  }
}

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
          const r = await bcFetch(full_url, { headers: { Authorization: `Bearer ${access_token}`, Accept: 'application/json' } })
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
      r = await bcFetch(url, { headers: { Authorization: `Bearer ${access_token}`, Accept: 'application/json' } })
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
      r = await bcFetch(url, { headers: { Authorization: `Bearer ${access_token}`, Accept: 'application/json' } })
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

  // Open a sync-run log row up front so failures are recorded too.
  const { data: run, error: runErr } = await supabase
    .from('bc_sync_runs')
    .insert({ triggered_by: req.user.id, rig_filter: rig_prefix || null, fiscal_years: fiscal_years.join(','), status: 'running' })
    .select().single()
  if (runErr) return res.status(500).json({ success: false, error: `Could not create sync run: ${runErr.message}` })
  const runId = run.id
  const started = Date.now()

  try {
    // Shared fetch → process → stage logic (also used by the cron scheduler).
    const s = await stageRig({ rig_prefix, fiscal_years, runId, label: `run ${runId}` })
    const processing_time_ms = Date.now() - started

    await supabase.from('bc_sync_runs').update({
      status: 'success', completed_at: new Date().toISOString(),
      total_bos_fetched: s.total_bos, total_pos_processed: s.total_pos,
      pos_within_range: s.within, pos_before_cutoff: s.before,
      staging_rows_inserted: s.staging_rows, processing_time_ms,
    }).eq('id', runId)

    res.json({
      success: true,
      sync_run_id: runId,
      summary: {
        total_bos_fetched: s.total_bos, total_pos_processed: s.total_pos,
        pos_within_range: s.within, pos_before_cutoff: s.before,
        staging_rows_inserted: s.staging_rows, line_items_staged: s.line_items, processing_time_ms,
      },
      warnings_count: s.warnings_count,
      message: `${s.staging_rows} PO${s.staging_rows !== 1 ? 's' : ''} and ${s.line_items} line item${s.line_items !== 1 ? 's' : ''} inserted into staging. Review and promote when ready.`,
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

  try {
    // Shared promote logic (also used by the cron scheduler when BC_SYNC_ENABLED=true).
    const result = await promoteRun({ sync_run_id, batch_size, dry_run, createdBy: req.user.id })
    res.json(result)
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

// ─── GET /api/admin/bc-integration/cron-status ────────────────────────────────
// Scheduler state for the "Automated Sync" card: enabled, next run, last run,
// and live progress of an in-flight run.
router.get('/cron-status', async (_req, res) => {
  try {
    res.json(await getSchedulerStatus())
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── POST /api/admin/bc-integration/trigger-sync-now ──────────────────────────
// Fires a full 14-rig sync in the background and returns 202 immediately. The
// client polls /cron-status for progress. Promotion runs only if BC_SYNC_ENABLED.
router.post('/trigger-sync-now', async (req, res) => {
  const status = await getSchedulerStatus()
  if (status.current_run) {
    return res.status(409).json({ error: 'A sync is already running. Please wait for it to finish.' })
  }
  // Fire-and-forget: do NOT await (the run takes ~10-15 min).
  runFullSync(`manual-admin-${req.user.id}`, req.user.id)
    .catch(e => console.error('[cron-sync] manual trigger error:', e))
  res.status(202).json({
    accepted: true,
    message: 'Sync started for all 14 rigs. Watch progress in the Automated Sync card / server logs.',
    promote_enabled: process.env.BC_SYNC_ENABLED === 'true',
  })
})

// ─── GET /api/admin/bc-integration/rate-limit-status ──────────────────────────
// Live counters for the "BC Rate Limiter Status" card. No BC calls.
router.get('/rate-limit-status', (_req, res) => {
  res.json(rateLimiter.getStats())
})

// ─── GET /api/admin/bc-integration/rate-limiter-test ──────────────────────────
// Self-test with MOCK work only (no BC calls): fires 10 staggered jobs that each
// acquire → simulate 300ms of work → release, and records how many were active
// at acquire time. Proves the concurrency cap holds before anything real is wrapped.
router.get('/rate-limiter-test', async (_req, res) => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const test_results = []
  async function job(i) {
    await sleep(i * 100)                       // stagger starts so jobs overlap
    await rateLimiter.acquire()
    const active_during = rateLimiter.getStats().active
    test_results[i] = { time: `t${i}`, active_during, acquired: true }
    await sleep(300)                           // simulate work
    rateLimiter.release()
  }
  try {
    await Promise.all(Array.from({ length: 10 }, (_, i) => job(i)))
    const max_active = test_results.reduce((m, r) => Math.max(m, r.active_during), 0)
    res.json({
      success: true,
      current_stats: rateLimiter.getStats(),
      max_active_observed: max_active,
      test_results,
      message: max_active <= 3
        ? 'Rate limiter working — active never exceeded 3.'
        : `PROBLEM: active reached ${max_active} (expected ≤ 3).`,
    })
  } catch (e) {
    res.status(500).json({ success: false, error: e.message })
  }
})

module.exports = router
