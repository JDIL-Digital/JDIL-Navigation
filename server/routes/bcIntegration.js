const router = require('express').Router()
const { requireAuth } = require('../middleware/authMiddleware')
const { getBCAccessToken } = require('../utils/bcAuth')
const { supabase } = require('../utils/supabaseAdmin')
const { previewSync } = require('../utils/bcSyncProcessor')

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

module.exports = router
