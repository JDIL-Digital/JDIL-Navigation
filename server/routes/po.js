const router = require('express').Router()
const { supabase }                            = require('../utils/supabaseAdmin')
const { requireAuth }                         = require('../middleware/authMiddleware')
const { validateUpdateFields, canCreatePO, SYSTEM_FIELDS } = require('../utils/fieldPermissions')
const { calcStatus, daysElapsed }             = require('../utils/poHelpers')
const {
  sendEmail,
  newPOEmail,
  statusChangedEmail,
} = require('../utils/email')

const OVERDUE_DAYS = 45

// ─── Pipeline stage groups (for email routing) ───────────────────────────────
// Entering a LOGISTICS stage from a PURCHASE stage → notify logistics team
// Entering a RIG stage from a LOGISTICS stage     → notify rig users for that rig
const PURCHASE_STAGES  = new Set([
  'MR Created', 'PO Released', 'Buyer Assigned',
  'Vendor Confirmed', 'Material Ready at Vendor', 'Dispatched from Vendor',
])
const LOGISTICS_STAGES = new Set([
  'In Transit to JDIL', 'At JDIL Location', 'In Transit to Rig',
])
const RIG_STAGES = new Set(['Delivered to Rig'])

// ─── Email helper: fetch recipient emails by role (+ optional rig filter) ────
async function getEmailsByRole(role, rigName = null) {
  let q = supabase
    .from('users')
    .select('email')
    .eq('role', role)
    .eq('is_active', true)
  if (rigName) q = q.eq('rig_name', rigName)
  const { data } = await q
  return (data || []).map(u => u.email).filter(Boolean)
}

// ─── GET all POs ────────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const { rig, status, stale } = req.query
  let q = supabase.from('po_orders').select('*').order('updated_at', { ascending: false })
  if (rig)              q = q.eq('rig_name', rig)
  if (status)           q = q.eq('status', status)
  if (stale === 'true') q = q.eq('is_stale', true)
  // Rig role: scope to their assigned rig
  if (req.user.role === 'rig' && req.user.rig_name) q = q.eq('rig_name', req.user.rig_name)
  const { data, error } = await q
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// ─── GET single PO ──────────────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('po_orders').select('*').eq('id', req.params.id).single()
  if (error) return res.status(404).json({ error: error.message })
  res.json(data)
})

// ─── CREATE PO ──────────────────────────────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  if (!canCreatePO(req.user.role)) {
    return res.status(403).json({
      error: `Your role (${req.user.role}) cannot create Purchase Orders`,
    })
  }

  // Strip any system fields the client may have sent
  const body = { ...req.body }
  SYSTEM_FIELDS.forEach(k => delete body[k])

  // Validate fields against role permissions
  const check = validateUpdateFields(req.user.role, body)
  if (!check.ok) {
    return res.status(403).json({
      error: `You don't have permission to edit these fields: ${check.forbidden.join(', ')}`,
      forbidden: check.forbidden,
    })
  }

  body.created_by   = req.user.id
  body.updated_at   = new Date().toISOString()
  body.status       = calcStatus(body)
  body.days_elapsed = daysElapsed(body.po_date)
  body.is_stale     = body.days_elapsed > OVERDUE_DAYS

  const { data, error } = await supabase.from('po_orders').insert(body).select().single()
  if (error) return res.status(400).json({ error: error.message })

  // ── In-app notifications (admin + csuite) ─────────────────────────────────
  try {
    const { data: targets } = await supabase
      .from('users').select('id').in('role', ['admin', 'csuite']).eq('is_active', true)
    if (targets?.length) {
      await supabase.from('notifications').insert(targets.map(u => ({
        user_id: u.id, type: 'new_po',
        title:   `New PO Created: ${data.po_number}`,
        message: `${data.po_number} for ${data.rig_name} — ${data.vendor_name}`,
        is_read: false, created_at: new Date().toISOString(),
      })))
    }
  } catch (e) { console.error('[notify] in-app error:', e) }

  // ── Email: notify all logistics users of the new PO ───────────────────────
  try {
    const logisticsEmails = await getEmailsByRole('logistics')
    if (logisticsEmails.length) {
      const createdByName = req.user.name || req.user.email || 'System'
      await sendEmail({
        to:      logisticsEmails,
        subject: `New PO Created — ${data.po_number} — ${data.rig_name}`,
        html:    newPOEmail(data, createdByName),
      })
      console.log(`[email] New PO ${data.po_number} → ${logisticsEmails.length} logistics users`)
    }
  } catch (e) { console.error('[email] new PO notification error:', e) }

  res.json(data)
})

// ─── UPDATE PO ──────────────────────────────────────────────────────────────
// Expects body: { fields: { field: value, ... }, reason: '' }
router.patch('/:id', requireAuth, async (req, res) => {
  const { fields = {}, reason = '' } = req.body

  if (req.user.role === 'csuite') {
    return res.status(403).json({ error: 'C-Suite role is read-only' })
  }

  // Strip any system fields
  const sanitised = { ...fields }
  SYSTEM_FIELDS.forEach(k => delete sanitised[k])

  if (Object.keys(sanitised).length === 0) {
    return res.status(400).json({ error: 'No fields to update' })
  }

  // Validate every key against the user's role
  const check = validateUpdateFields(req.user.role, sanitised)
  if (!check.ok) {
    return res.status(403).json({
      error: `You don't have permission to edit this field: ${check.forbidden.join(', ')}`,
      forbidden: check.forbidden,
    })
  }

  // Admin requires a reason
  if (req.user.role === 'admin' && !reason?.trim()) {
    return res.status(400).json({ error: 'Admin must provide a reason for every change' })
  }

  // Fetch the current record so we can merge and recalculate status
  const { data: current, error: fetchErr } = await supabase
    .from('po_orders').select('*').eq('id', req.params.id).single()
  if (fetchErr) return res.status(404).json({ error: 'PO not found' })

  const merged     = { ...current, ...sanitised }
  const newStatus  = calcStatus(merged)
  const newElapsed = daysElapsed(merged.po_date)
  const oldStatus  = current.status

  const updatePayload = {
    ...sanitised,
    status:       newStatus,
    days_elapsed: newElapsed,
    is_stale:     newElapsed > OVERDUE_DAYS,
    updated_at:   new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('po_orders').update(updatePayload).eq('id', req.params.id).select().single()
  if (error) return res.status(400).json({ error: error.message })

  // ── Audit log (admin only) ─────────────────────────────────────────────────
  if (req.user.role === 'admin') {
    const logs = Object.entries(sanitised).map(([field, newVal]) => ({
      po_id:         req.params.id,
      changed_by:    req.user.id,
      field_changed: field,
      old_value:     String(current[field] ?? ''),
      new_value:     String(newVal ?? ''),
      reason,
      changed_at:    new Date().toISOString(),
    }))
    await supabase.from('audit_log').insert(logs).catch(e => console.error('[audit] log error:', e))
  }

  // ── In-app + email notifications on status change ──────────────────────────
  if (oldStatus !== newStatus) {
    const updatedByName = req.user.name || req.user.email || 'System'

    // In-app: admin + csuite
    try {
      const { data: targets } = await supabase
        .from('users').select('id').in('role', ['admin', 'csuite']).eq('is_active', true)
      if (targets?.length) {
        await supabase.from('notifications').insert(targets.map(u => ({
          user_id: u.id, type: 'status_change',
          title:   `Status Update: ${data.po_number}`,
          message: `${oldStatus} → ${newStatus}`,
          is_read: false, created_at: new Date().toISOString(),
        })))
      }
    } catch (e) { console.error('[notify] in-app status change error:', e) }

    // Email routing: Purchase → Logistics
    if (PURCHASE_STAGES.has(oldStatus) && LOGISTICS_STAGES.has(newStatus)) {
      try {
        const emails = await getEmailsByRole('logistics')
        if (emails.length) {
          await sendEmail({
            to:      emails,
            subject: `PO Update — ${data.po_number} status changed to ${newStatus}`,
            html:    statusChangedEmail(data, oldStatus, newStatus, updatedByName),
          })
          console.log(`[email] Status ${oldStatus}→${newStatus} for ${data.po_number} → ${emails.length} logistics users`)
        }
      } catch (e) { console.error('[email] logistics status email error:', e) }
    }

    // Email routing: Logistics → Rig
    if (LOGISTICS_STAGES.has(oldStatus) && RIG_STAGES.has(newStatus)) {
      try {
        // Notify rig users assigned to this specific rig
        const rigEmails = await getEmailsByRole('rig', data.rig_name)
        // Also notify all logistics users (they dispatched it)
        const logisticsEmails = await getEmailsByRole('logistics')
        const allEmails = [...new Set([...rigEmails, ...logisticsEmails])]
        if (allEmails.length) {
          await sendEmail({
            to:      allEmails,
            subject: `PO Update — ${data.po_number} status changed to ${newStatus}`,
            html:    statusChangedEmail(data, oldStatus, newStatus, updatedByName),
          })
          console.log(`[email] Status ${oldStatus}→${newStatus} for ${data.po_number} → ${rigEmails.length} rig + ${logisticsEmails.length} logistics users`)
        }
      } catch (e) { console.error('[email] rig status email error:', e) }
    }

    // Email routing: Any logistics-internal stage change → logistics team
    if (LOGISTICS_STAGES.has(oldStatus) && LOGISTICS_STAGES.has(newStatus)) {
      try {
        const emails = await getEmailsByRole('logistics')
        if (emails.length) {
          await sendEmail({
            to:      emails,
            subject: `PO Update — ${data.po_number} status changed to ${newStatus}`,
            html:    statusChangedEmail(data, oldStatus, newStatus, updatedByName),
          })
          console.log(`[email] Internal logistics status change for ${data.po_number} → ${emails.length} logistics users`)
        }
      } catch (e) { console.error('[email] logistics internal status email error:', e) }
    }
  }

  res.json(data)
})

module.exports = router
