const router = require('express').Router()
const { supabase }    = require('../utils/supabaseAdmin')
const { requireAuth } = require('../middleware/authMiddleware')

// All BC-integration mapping endpoints are admin-only.
router.use(requireAuth)
router.use((req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' })
  next()
})

// ─── Audit helper ─────────────────────────────────────────────────────────────
// Mirrors the po_orders audit pattern (po_id is null for BC-config changes).
// Never throws — an audit failure must not fail the underlying operation.
async function audit(req, { field_changed, old_value, new_value, reason }) {
  try {
    await supabase.from('audit_log').insert({
      po_id:         null,
      changed_by:    req.user.id,
      field_changed,
      old_value:     old_value != null ? String(old_value) : '',
      new_value:     new_value != null ? String(new_value) : '',
      reason:        reason || '',
      changed_at:    new Date().toISOString(),
    })
  } catch (e) { console.error('[bc-mapping] audit error:', e.message) }
}

// Maps a Postgres error to a friendly 400 message, or null if not a known one.
function friendlyDbError(error) {
  if (!error) return null
  if (error.code === '23505') return 'A record with this key already exists.'
  if (error.code === '23503') return 'A referenced record does not exist.'
  return null
}

// ═══════════════════════════════════════════════════════════════════════════════
//  1. RIG MAPPING
// ═══════════════════════════════════════════════════════════════════════════════

// GET all rig mappings (longest prefix first)
router.get('/rigs', async (_req, res) => {
  const { data, error } = await supabase
    .from('bc_rig_mapping').select('*').order('prefix_length', { ascending: false })
  if (error) return res.status(500).json({ error: error.message })
  res.json(data || [])
})

// CREATE rig mapping
router.post('/rigs', async (req, res) => {
  const bc_prefix     = String(req.body.bc_prefix || '').trim()
  const jdil_rig_name = String(req.body.jdil_rig_name || '').trim()
  const notes         = req.body.notes ? String(req.body.notes).trim() : null
  if (!bc_prefix || !jdil_rig_name) {
    return res.status(400).json({ error: 'BC prefix and JDIL rig name are both required.' })
  }

  const { data, error } = await supabase
    .from('bc_rig_mapping').insert({ bc_prefix, jdil_rig_name, notes }).select().single()
  if (error) return res.status(400).json({ error: friendlyDbError(error) || error.message })

  await audit(req, { field_changed: 'bc_rig_mapping', old_value: '', new_value: `${bc_prefix} → ${jdil_rig_name}`, reason: `Created BC rig mapping ${bc_prefix}` })
  res.json({ success: true, data })
})

// UPDATE rig mapping
router.patch('/rigs/:prefix', async (req, res) => {
  const patch = {}
  if (req.body.jdil_rig_name !== undefined) patch.jdil_rig_name = String(req.body.jdil_rig_name).trim()
  if (req.body.active        !== undefined) patch.active        = req.body.active === true
  if (req.body.notes         !== undefined) patch.notes         = req.body.notes ? String(req.body.notes).trim() : null
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No fields to update.' })
  patch.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('bc_rig_mapping').update(patch).eq('bc_prefix', req.params.prefix).select().single()
  if (error) return res.status(400).json({ error: friendlyDbError(error) || error.message })
  if (!data)  return res.status(404).json({ error: 'Rig mapping not found.' })

  await audit(req, { field_changed: 'bc_rig_mapping', old_value: req.params.prefix, new_value: JSON.stringify(patch), reason: `Updated BC rig mapping ${req.params.prefix}` })
  res.json({ success: true, data })
})

// SOFT DELETE rig mapping (active = false)
router.delete('/rigs/:prefix', async (req, res) => {
  const { data, error } = await supabase
    .from('bc_rig_mapping')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('bc_prefix', req.params.prefix).select().single()
  if (error) return res.status(400).json({ error: error.message })
  if (!data)  return res.status(404).json({ error: 'Rig mapping not found.' })

  await audit(req, { field_changed: 'bc_rig_mapping', old_value: 'active', new_value: 'inactive', reason: `Deactivated BC rig mapping ${req.params.prefix}` })
  res.json({ success: true, data })
})

// ═══════════════════════════════════════════════════════════════════════════════
//  2. BUYER MAPPING
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/buyers', async (_req, res) => {
  const { data, error } = await supabase
    .from('bc_buyer_mapping').select('*').order('bc_buyer_code', { ascending: true })
  if (error) return res.status(500).json({ error: error.message })
  res.json(data || [])
})

router.post('/buyers', async (req, res) => {
  const bc_buyer_code   = String(req.body.bc_buyer_code || '').trim()
  const jdil_buyer_code = String(req.body.jdil_buyer_code || '').trim()
  const full_name       = req.body.full_name ? String(req.body.full_name).trim() : null
  const notes           = req.body.notes ? String(req.body.notes).trim() : null
  if (!bc_buyer_code || !jdil_buyer_code) {
    return res.status(400).json({ error: 'BC buyer code and JDIL buyer code are both required.' })
  }

  const { data, error } = await supabase
    .from('bc_buyer_mapping').insert({ bc_buyer_code, jdil_buyer_code, full_name, notes }).select().single()
  if (error) return res.status(400).json({ error: friendlyDbError(error) || error.message })

  await audit(req, { field_changed: 'bc_buyer_mapping', old_value: '', new_value: `${bc_buyer_code} → ${jdil_buyer_code}`, reason: `Created BC buyer mapping ${bc_buyer_code}` })
  res.json({ success: true, data })
})

router.patch('/buyers/:code', async (req, res) => {
  const patch = {}
  if (req.body.jdil_buyer_code !== undefined) patch.jdil_buyer_code = String(req.body.jdil_buyer_code).trim()
  if (req.body.full_name       !== undefined) patch.full_name       = req.body.full_name ? String(req.body.full_name).trim() : null
  if (req.body.active          !== undefined) patch.active          = req.body.active === true
  if (req.body.notes           !== undefined) patch.notes           = req.body.notes ? String(req.body.notes).trim() : null
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No fields to update.' })
  patch.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('bc_buyer_mapping').update(patch).eq('bc_buyer_code', req.params.code).select().single()
  if (error) return res.status(400).json({ error: friendlyDbError(error) || error.message })
  if (!data)  return res.status(404).json({ error: 'Buyer mapping not found.' })

  await audit(req, { field_changed: 'bc_buyer_mapping', old_value: req.params.code, new_value: JSON.stringify(patch), reason: `Updated BC buyer mapping ${req.params.code}` })
  res.json({ success: true, data })
})

router.delete('/buyers/:code', async (req, res) => {
  const { data, error } = await supabase
    .from('bc_buyer_mapping')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('bc_buyer_code', req.params.code).select().single()
  if (error) return res.status(400).json({ error: error.message })
  if (!data)  return res.status(404).json({ error: 'Buyer mapping not found.' })

  await audit(req, { field_changed: 'bc_buyer_mapping', old_value: 'active', new_value: 'inactive', reason: `Deactivated BC buyer mapping ${req.params.code}` })
  res.json({ success: true, data })
})

// ═══════════════════════════════════════════════════════════════════════════════
//  3. BUYER ALIASES
// ═══════════════════════════════════════════════════════════════════════════════

// GET aliases, enriched with the canonical buyer's details (JS join — robust
// against PostgREST relationship-cache timing on the new FK).
router.get('/aliases', async (_req, res) => {
  const [aliasRes, buyerRes] = await Promise.all([
    supabase.from('bc_buyer_aliases').select('*').order('created_at', { ascending: false }),
    supabase.from('bc_buyer_mapping').select('bc_buyer_code, jdil_buyer_code, full_name'),
  ])
  if (aliasRes.error) return res.status(500).json({ error: aliasRes.error.message })
  const byCode = new Map((buyerRes.data || []).map(b => [b.bc_buyer_code, b]))
  const rows = (aliasRes.data || []).map(a => ({
    ...a,
    canonical: byCode.get(a.canonical_bc_code) || null,
  }))
  res.json(rows)
})

router.post('/aliases', async (req, res) => {
  const alias             = String(req.body.alias || '').trim()
  const canonical_bc_code = String(req.body.canonical_bc_code || '').trim()
  if (!alias || !canonical_bc_code) {
    return res.status(400).json({ error: 'Alias and canonical buyer code are both required.' })
  }

  const { data, error } = await supabase
    .from('bc_buyer_aliases')
    .insert({ alias, canonical_bc_code, source: 'admin_added' })
    .select().single()
  if (error) {
    if (error.code === '23505') return res.status(400).json({ error: 'This alias already exists.' })
    if (error.code === '23503') return res.status(400).json({ error: 'Selected buyer code does not exist.' })
    return res.status(400).json({ error: error.message })
  }

  await audit(req, { field_changed: 'bc_buyer_aliases', old_value: '', new_value: `${alias} → ${canonical_bc_code}`, reason: `Created BC buyer alias "${alias}"` })
  res.json({ success: true, data })
})

// Toggle "confirmed" on an alias. (Not in the original endpoint list, but the UI
// needs it to make the Confirmed toggle functional.)
router.patch('/aliases/:id', async (req, res) => {
  const patch = {}
  if (req.body.confirmed !== undefined) patch.confirmed = req.body.confirmed === true
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No fields to update.' })

  const { data, error } = await supabase
    .from('bc_buyer_aliases').update(patch).eq('id', req.params.id).select().single()
  if (error) return res.status(400).json({ error: error.message })
  if (!data)  return res.status(404).json({ error: 'Alias not found.' })

  await audit(req, { field_changed: 'bc_buyer_aliases', old_value: req.params.id, new_value: `confirmed=${patch.confirmed}`, reason: `Updated BC buyer alias ${req.params.id}` })
  res.json({ success: true, data })
})

// HARD DELETE alias (aliases are temporary mappings)
router.delete('/aliases/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('bc_buyer_aliases').delete().eq('id', req.params.id).select().single()
  if (error) return res.status(400).json({ error: error.message })
  if (!data)  return res.status(404).json({ error: 'Alias not found.' })

  await audit(req, { field_changed: 'bc_buyer_aliases', old_value: data.alias, new_value: 'deleted', reason: `Deleted BC buyer alias "${data.alias}"` })
  res.json({ success: true, data })
})

// ═══════════════════════════════════════════════════════════════════════════════
//  4. DATA QUALITY ALERTS
// ═══════════════════════════════════════════════════════════════════════════════

// GET alerts — unresolved only unless ?includeResolved=true. Newest first.
router.get('/alerts', async (req, res) => {
  const includeResolved = req.query.includeResolved === 'true'
  let q = supabase.from('bc_data_quality_alerts').select('*').order('detected_at', { ascending: false })
  if (!includeResolved) q = q.eq('resolved', false)
  const { data, error } = await q
  if (error) return res.status(500).json({ error: error.message })
  res.json(data || [])
})

// Mark an alert resolved.
router.patch('/alerts/:id', async (req, res) => {
  const patch = {
    resolved:         true,
    resolved_by:      req.user.email || req.user.id,
    resolved_at:      new Date().toISOString(),
    resolution_notes: req.body.resolution_notes ? String(req.body.resolution_notes).trim() : null,
  }
  const { data, error } = await supabase
    .from('bc_data_quality_alerts').update(patch).eq('id', req.params.id).select().single()
  if (error) return res.status(400).json({ error: error.message })
  if (!data)  return res.status(404).json({ error: 'Alert not found.' })

  await audit(req, { field_changed: 'bc_data_quality_alerts', old_value: 'unresolved', new_value: 'resolved', reason: `Resolved BC data-quality alert ${req.params.id}` })
  res.json({ success: true, data })
})

// Resolve an unknown-buyer alert by creating an alias for its BC value, then
// marking the alert resolved.  Body: { canonical_bc_code, note? }
router.post('/alerts/:id/resolve-with-alias', async (req, res) => {
  const canonical_bc_code = String(req.body.canonical_bc_code || '').trim()
  const note = req.body.note ? String(req.body.note).trim() : null
  if (!canonical_bc_code) return res.status(400).json({ error: 'canonical_bc_code is required.' })

  // Fetch the alert.
  const { data: alert, error: aErr } = await supabase
    .from('bc_data_quality_alerts').select('*').eq('id', req.params.id).single()
  if (aErr || !alert) return res.status(404).json({ error: 'Alert not found.' })
  if (alert.alert_type !== 'unknown_buyer') {
    return res.status(400).json({ error: 'Alias resolution only applies to unknown_buyer alerts.' })
  }
  if (!alert.bc_value) return res.status(400).json({ error: 'Alert has no BC value to alias.' })

  // Canonical buyer must exist.
  const { data: buyer } = await supabase
    .from('bc_buyer_mapping').select('bc_buyer_code').eq('bc_buyer_code', canonical_bc_code).limit(1)
  if (!buyer || !buyer.length) {
    return res.status(400).json({ error: `Buyer code "${canonical_bc_code}" does not exist in bc_buyer_mapping.` })
  }

  // Create the alias (ignore if it already exists).
  const { error: insErr } = await supabase
    .from('bc_buyer_aliases')
    .insert({ alias: alert.bc_value, canonical_bc_code, source: 'admin_resolved', confirmed: true })
  if (insErr && insErr.code !== '23505') {
    return res.status(400).json({ error: insErr.message })
  }

  // Mark the alert resolved.
  const { data, error } = await supabase
    .from('bc_data_quality_alerts')
    .update({
      resolved:         true,
      resolved_by:      req.user.email || req.user.id,
      resolved_at:      new Date().toISOString(),
      resolution_notes: note || `Mapped "${alert.bc_value}" → ${canonical_bc_code}`,
    })
    .eq('id', req.params.id).select().single()
  if (error) return res.status(400).json({ error: error.message })

  await audit(req, {
    field_changed: 'bc_data_quality_alerts',
    old_value:     alert.bc_value,
    new_value:     `alias → ${canonical_bc_code}`,
    reason:        `Resolved unknown-buyer alert by aliasing "${alert.bc_value}" to ${canonical_bc_code}`,
  })
  res.json({ success: true, data, alias_created: alert.bc_value, canonical_bc_code })
})

module.exports = router
