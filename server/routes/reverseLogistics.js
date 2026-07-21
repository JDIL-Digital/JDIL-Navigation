const router = require('express').Router()
const { supabase }    = require('../utils/supabaseAdmin')
const { requireAuth } = require('../middleware/authMiddleware')
const { validateRLUpdateFields, RL_SYSTEM_FIELDS } = require('../utils/fieldPermissions')
const { calcReverseLogisticsStatus } = require('../utils/poHelpers')

const JOB_TYPES = ['Repair', 'Return', 'Replacement']

// Fire-and-forget in-app notification to admin + csuite on a stage change.
async function notifyStageChange(job, oldStatus, newStatus) {
  try {
    const { data: targets } = await supabase
      .from('users').select('id').in('role', ['admin', 'csuite']).eq('is_active', true)
    if (targets?.length) {
      await supabase.from('notifications').insert(targets.map(u => ({
        user_id: u.id, type: 'status_change',
        title:   `RL ${job.job_type} ${job.job_number}: ${newStatus}`,
        message: `${oldStatus} → ${newStatus} (${job.rig_name})`,
        is_read: false, created_at: new Date().toISOString(),
      })))
    }
  } catch (e) { console.error('[rl notify] error:', e) }
}

// ─── GET /api/rl/jobs?type= — list ────────────────────────────────────────────
router.get('/jobs', requireAuth, async (req, res) => {
  let q = supabase.from('reverse_logistics_jobs').select('*').order('created_at', { ascending: false })
  if (req.query.type && JOB_TYPES.includes(req.query.type)) q = q.eq('job_type', req.query.type)
  // Rig users only see their own rig's jobs
  if (req.user.role === 'rig' && req.user.rig_name) q = q.eq('rig_name', req.user.rig_name)
  const { data, error } = await q
  if (error) return res.status(500).json({ error: error.message })
  res.json(data || [])
})

// ─── GET /api/rl/jobs/:id — single job + line items ───────────────────────────
router.get('/jobs/:id', requireAuth, async (req, res) => {
  const { data: job, error } = await supabase
    .from('reverse_logistics_jobs').select('*').eq('id', req.params.id).single()
  if (error) return res.status(404).json({ error: 'Job not found' })
  const { data: items } = await supabase
    .from('reverse_logistics_line_items').select('*').eq('job_id', req.params.id).order('created_at', { ascending: true })
  res.json({ ...job, line_items: items || [] })
})

// ─── POST /api/rl/jobs — create (rig + admin) ─────────────────────────────────
router.post('/jobs', requireAuth, async (req, res) => {
  if (!['rig', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ error: `Your role (${req.user.role}) cannot create reverse logistics jobs` })
  }
  const raw = { ...req.body }
  const items = Array.isArray(raw.line_items) ? raw.line_items : []

  // Explicit creation allowlist (rig-stage + identifiers + optional source link
  // and pre-filled vendor details when created from a delivered PO).
  const KEEP = new Set([
    'job_type', 'mr_number', 'po_number', 'rig_name', 'material_description_2',
    'rig_dispatch_date', 'rig_dispatch_location', 'rig_mode_of_transport',
    'vendor_name', 'vendor_contact', 'vendor_phone',
    'source_po_id', 'source_line_item_id', 'is_external_item',
  ])
  const body = {}
  Object.keys(raw).forEach(k => { if (KEEP.has(k)) body[k] = raw[k] })

  if (!JOB_TYPES.includes(body.job_type)) return res.status(400).json({ error: 'Invalid job_type' })
  if (!body.mr_number?.trim())            return res.status(400).json({ error: 'MR Number is required' })
  if (!body.po_number?.trim())            return res.status(400).json({ error: 'PO Number is required' })
  if (!body.rig_name?.trim())             return res.status(400).json({ error: 'Rig Name is required' })

  // Rig users can only create for their own rig
  if (req.user.role === 'rig' && req.user.rig_name) body.rig_name = req.user.rig_name

  // job_number is a legacy NOT NULL column — mirror po_number into it.
  body.job_number = body.po_number.trim()
  body.created_by = req.user.id
  body.status     = calcReverseLogisticsStatus(body)

  const { data: job, error } = await supabase.from('reverse_logistics_jobs').insert(body).select().single()
  if (error) {
    const msg = error.code === '23505'
      ? `This PO Number already exists for ${body.job_type}. Please use a different PO Number.`
      : error.message
    return res.status(400).json({ error: msg })
  }

  // Insert line items (best-effort)
  const rows = items.filter(it => it?.item_name?.trim()).map(it => ({
    job_id:               job.id,
    item_name:            String(it.item_name).trim(),
    material_description: it.material_description ? String(it.material_description).trim() : null,
    unit:                 it.unit ? String(it.unit).trim() : null,
    quantity:             Number(it.quantity) || 0,
    remarks:              it.remarks ? String(it.remarks).trim() : null,
  }))
  if (rows.length) {
    const { error: itErr } = await supabase.from('reverse_logistics_line_items').insert(rows)
    if (itErr) return res.status(400).json({ success: true, data: job, warning: `Job created but items failed: ${itErr.message}` })
  }

  res.json({ success: true, data: job })
})

// ─── PATCH /api/rl/jobs/:id — update (per-field role check + status recalc) ───
router.patch('/jobs/:id', requireAuth, async (req, res) => {
  if (req.user.role === 'csuite') return res.status(403).json({ error: 'C-Suite is read-only' })

  const fields = { ...(req.body.fields || {}) }
  RL_SYSTEM_FIELDS.forEach(k => delete fields[k])
  if (Object.keys(fields).length === 0) return res.status(400).json({ error: 'No fields to update' })

  const check = validateRLUpdateFields(req.user.role, fields)
  if (!check.ok) return res.status(403).json({ error: `Not permitted to edit: ${check.forbidden.join(', ')}`, forbidden: check.forbidden })

  const { data: current, error: fErr } = await supabase
    .from('reverse_logistics_jobs').select('*').eq('id', req.params.id).single()
  if (fErr) return res.status(404).json({ error: 'Job not found' })

  const merged    = { ...current, ...fields }
  const newStatus = calcReverseLogisticsStatus(merged)
  const oldStatus = current.status

  const { data, error } = await supabase
    .from('reverse_logistics_jobs')
    .update({ ...fields, status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', req.params.id).select().single()
  if (error) return res.status(400).json({ error: error.message })

  res.json({ success: true, data })

  if (oldStatus !== newStatus) notifyStageChange(data, oldStatus, newStatus)
    .catch(e => console.error('[rl PATCH] notify error:', e))
})

// ─── POST /api/rl/jobs/:id/mark-failed — (purchase + admin) ───────────────────
router.post('/jobs/:id/mark-failed', requireAuth, async (req, res) => {
  if (!['purchase', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Only purchase or admin can mark a job as failed' })
  }
  const reason = (req.body.reason || '').toString().trim()
  if (!reason) return res.status(400).json({ error: 'A reason is required' })

  const { data: current } = await supabase
    .from('reverse_logistics_jobs').select('*').eq('id', req.params.id).single()
  const note = `[FAILED] ${reason}`
  const merged = current
    ? { ...current, rig_other_remarks: [current.rig_other_remarks, note].filter(Boolean).join(' | ') }
    : { rig_other_remarks: note }

  const { data, error } = await supabase
    .from('reverse_logistics_jobs')
    .update({ status: 'Failed', rig_other_remarks: merged.rig_other_remarks, updated_at: new Date().toISOString() })
    .eq('id', req.params.id).select().single()
  if (error) return res.status(400).json({ error: error.message })

  res.json({ success: true, data })
  if (current) notifyStageChange(data, current.status, 'Failed').catch(() => {})
})

// ─── Line items ───────────────────────────────────────────────────────────────
router.get('/jobs/:id/items', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('reverse_logistics_line_items').select('*').eq('job_id', req.params.id).order('created_at', { ascending: true })
  if (error) return res.status(500).json({ error: error.message })
  res.json(data || [])
})

const ITEM_EDIT_ROLES = ['rig', 'purchase', 'admin']

router.post('/jobs/:id/items', requireAuth, async (req, res) => {
  if (!ITEM_EDIT_ROLES.includes(req.user.role)) {
    return res.status(403).json({ error: 'Not permitted to add line items' })
  }
  const items = Array.isArray(req.body.items) ? req.body.items : []
  const rows = items.filter(it => it?.item_name?.trim()).map(it => ({
    job_id:               req.params.id,
    item_name:            String(it.item_name).trim(),
    material_description: it.material_description ? String(it.material_description).trim() : null,
    unit:                 it.unit ? String(it.unit).trim() : null,
    quantity:             Number(it.quantity) || 0,
    remarks:              it.remarks ? String(it.remarks).trim() : null,
  }))
  if (!rows.length) return res.status(400).json({ error: 'No valid line items' })
  const { data, error } = await supabase.from('reverse_logistics_line_items').insert(rows).select()
  if (error) return res.status(400).json({ error: error.message })
  res.json({ success: true, data })
})

router.patch('/items/:itemId', requireAuth, async (req, res) => {
  if (!ITEM_EDIT_ROLES.includes(req.user.role)) {
    return res.status(403).json({ error: 'Not permitted to edit line items' })
  }
  const patch = {}
  for (const k of ['item_name', 'material_description', 'unit', 'quantity', 'remarks']) {
    if (req.body[k] !== undefined) patch[k] = k === 'quantity' ? (Number(req.body[k]) || 0) : req.body[k]
  }
  patch.updated_at = new Date().toISOString()
  const { data, error } = await supabase
    .from('reverse_logistics_line_items').update(patch).eq('id', req.params.itemId).select().single()
  if (error) return res.status(400).json({ error: error.message })
  res.json({ success: true, data })
})

router.delete('/items/:itemId', requireAuth, async (req, res) => {
  if (!ITEM_EDIT_ROLES.includes(req.user.role)) {
    return res.status(403).json({ error: 'Not permitted to delete line items' })
  }
  const { error } = await supabase.from('reverse_logistics_line_items').delete().eq('id', req.params.itemId)
  if (error) return res.status(400).json({ error: error.message })
  res.json({ success: true })
})

module.exports = router
