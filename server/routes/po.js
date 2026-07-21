const router = require('express').Router()
const { supabase }                            = require('../utils/supabaseAdmin')
const { requireAuth }                         = require('../middleware/authMiddleware')
const { validateUpdateFields, canCreatePO, SYSTEM_FIELDS } = require('../utils/fieldPermissions')
const { validateFieldLengths } = require('../utils/validate')
const { calcStatus, daysElapsed, overdueDays } = require('../utils/poHelpers')
const {
  sendEmail,
  newPOEmail,
  statusChangedEmail,
  partialDeliveryEmail,
} = require('../utils/email')

const OVERDUE_DAYS = 45

// ─── Pipeline stage groups (for email routing) ───────────────────────────────
// Entering a LOGISTICS stage from a PURCHASE stage → notify logistics team
// Entering a RIG stage from a LOGISTICS stage     → notify rig users for that rig
const PURCHASE_STAGES  = new Set([
  'MR Created', 'PO Released', 'Buyer Assigned', 'Vendor Confirmed',
])
const LOGISTICS_STAGES = new Set([
  'In Transit to JDIL', 'At JDIL Location', 'Dispatched from JDIL', 'In Transit to Rig',
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

// ─── GET delivered POs for Reverse Logistics search ──────────────────────────
// Must be declared BEFORE '/:id' so it isn't captured as an id.
router.get('/search-delivered', requireAuth, async (req, res) => {
  // Strip characters that would break the PostgREST .or() / ilike filter.
  const q = String(req.query.q || '').replace(/[%,()]/g, ' ').trim()
  if (q.length < 2) return res.json([])

  // Delivered items only; search across ALL rigs (inter-rig transfers happen).
  const { data: pos, error } = await supabase
    .from('po_orders')
    .select('id, po_number, mr_number, rig_name, vendor_name, vendor_contact_name, vendor_phone_number, delivered_to_rig_date, material_description, material_description_2')
    .not('delivered_to_rig_date', 'is', null)
    .or(`po_number.ilike.%${q}%,mr_number.ilike.%${q}%,vendor_name.ilike.%${q}%`)
    .order('delivered_to_rig_date', { ascending: false })
    .limit(10)
  if (error) return res.status(500).json({ error: error.message })

  const ids = (pos || []).map(p => p.id)
  const itemsByPo = {}
  if (ids.length) {
    const { data: items } = await supabase
      .from('po_line_items')
      .select('id, po_id, item_name, material_description, quantity_ordered, unit')
      .in('po_id', ids)
      .order('created_at', { ascending: true })
    ;(items || []).forEach(it => { (itemsByPo[it.po_id] = itemsByPo[it.po_id] || []).push(it) })
  }
  res.json((pos || []).map(p => ({ ...p, line_items: itemsByPo[p.id] || [] })))
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

  // Enforce max text-field lengths
  const lenCheck = validateFieldLengths(body)
  if (!lenCheck.ok) return res.status(400).json({ error: lenCheck.error })

  body.created_by   = req.user.id
  body.updated_at   = new Date().toISOString()
  body.status       = calcStatus(body)
  body.days_elapsed = daysElapsed(body.po_date)
  body.is_stale     = overdueDays(body) > OVERDUE_DAYS

  const { data, error } = await supabase.from('po_orders').insert(body).select().single()
  if (error) return res.status(400).json({ error: error.message })

  // ✅ Respond to the client IMMEDIATELY — notifications run afterwards and
  //    must never crash the handler or block the response.
  res.json({ success: true, data })

  // ── Fire-and-forget: in-app notifications + new-PO email ───────────────────
  ;(async () => {
    // In-app notifications (admin + csuite)
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

    // Email: notify all logistics users of the new PO
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
  })().catch(e => console.error('[po POST] notification dispatch error (non-fatal):', e))
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

  // Enforce max text-field lengths
  const lenCheck = validateFieldLengths(sanitised)
  if (!lenCheck.ok) return res.status(400).json({ error: lenCheck.error })

  // Admin requires a reason
  if (req.user.role === 'admin' && !reason?.trim()) {
    return res.status(400).json({ error: 'Admin must provide a reason for every change' })
  }

  // Fetch the current record so we can merge and recalculate status
  const { data: current, error: fetchErr } = await supabase
    .from('po_orders').select('*').eq('id', req.params.id).single()
  if (fetchErr) {
    console.error('[po PATCH] fetch error for id', req.params.id, ':', fetchErr)
    // PGRST116 = "JSON object requested, multiple (or no) rows returned" → genuine not-found
    const status = fetchErr.code === 'PGRST116' ? 404 : 500
    return res.status(status).json({
      error: status === 404
        ? 'PO not found — the record may not exist or the ID is invalid'
        : `Database error: ${fetchErr.message}`,
      code: fetchErr.code,
    })
  }

  const merged     = { ...current, ...sanitised }
  const newStatus  = calcStatus(merged)
  const newElapsed = daysElapsed(merged.po_date)
  const oldStatus  = current.status

  const updatePayload = {
    ...sanitised,
    status:       newStatus,
    days_elapsed: newElapsed,
    is_stale:     overdueDays(merged) > OVERDUE_DAYS,
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
    try {
      await supabase.from('audit_log').insert(logs)
    } catch (e) { console.error('[audit] log error:', e) }
  }

  // ✅ Respond to the client IMMEDIATELY — before any email work.
  //    A mail failure must never crash the handler or leave the request
  //    hanging (which surfaced as "Unexpected end of JSON input" on the client).
  res.json({ success: true, data })

  // ── Fire-and-forget: in-app + email notifications ──────────────────────────
  //    Runs AFTER the response is sent. Wrapped in an async IIFE with a top-level
  //    .catch so nothing here can crash the process or affect the API response.
  ;(async () => {
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
  })().catch(e => console.error('[po PATCH] notification dispatch error (non-fatal):', e))
})

// ═══════════════════════════════════════════════════════════════════════════════
//  LINE ITEMS
//  Pipeline status stays PER-PO; these endpoints only track item quantities.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /api/po/:id/items — list line items for a PO ─────────────────────────
router.get('/:id/items', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('po_line_items')
    .select('*')
    .eq('po_id', req.params.id)
    .order('created_at', { ascending: true })
  if (error) return res.status(500).json({ error: error.message })
  res.json(data || [])
})

// ─── POST /api/po/:id/items — add line items (purchase + admin) ───────────────
// Body: { items: [{ item_name, material_description, unit, quantity_ordered }, ...] }
router.post('/:id/items', requireAuth, async (req, res) => {
  if (!['purchase', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ error: `Your role (${req.user.role}) cannot add line items` })
  }

  const items = Array.isArray(req.body.items) ? req.body.items : []
  if (items.length === 0) {
    return res.status(400).json({ error: 'No line items provided' })
  }

  // Sanitise — only accept mutable fields; never generated columns
  const rows = items
    .filter(it => it && it.item_name && String(it.item_name).trim())
    .map(it => ({
      po_id:                req.params.id,
      item_name:            String(it.item_name).trim(),
      material_description: it.material_description ? String(it.material_description).trim() : null,
      unit:                 it.unit ? String(it.unit).trim() : null,
      quantity_ordered:     Number(it.quantity_ordered) || 0,
      quantity_delivered:   0,
      remarks:              it.remarks ? String(it.remarks).trim() : null,
    }))

  if (rows.length === 0) {
    return res.status(400).json({ error: 'Every line item needs an item name' })
  }

  const { data, error } = await supabase.from('po_line_items').insert(rows).select()
  if (error) return res.status(400).json({ error: error.message })
  res.json({ success: true, data })
})

// ─── PATCH /api/po/items/:itemId — update delivered quantity (rig + admin) ────
// Body: { quantity_delivered: number, remarks?: string }
router.patch('/items/:itemId', requireAuth, async (req, res) => {
  if (!['rig', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ error: `Your role (${req.user.role}) cannot update delivery quantities` })
  }

  const qty = Number(req.body.quantity_delivered)
  if (Number.isNaN(qty) || qty < 0) {
    return res.status(400).json({ error: 'quantity_delivered must be a non-negative number' })
  }

  // Fetch current item to validate against ordered qty and detect partial delivery
  const { data: item, error: fetchErr } = await supabase
    .from('po_line_items').select('*').eq('id', req.params.itemId).single()
  if (fetchErr) {
    const status = fetchErr.code === 'PGRST116' ? 404 : 500
    return res.status(status).json({
      error: status === 404 ? 'Line item not found' : `Database error: ${fetchErr.message}`,
      code: fetchErr.code,
    })
  }

  const ordered = Number(item.quantity_ordered) || 0
  if (qty > ordered) {
    return res.status(400).json({ error: `Delivered quantity (${qty}) cannot exceed ordered quantity (${ordered})` })
  }

  // Rig users may only update items for their own rig
  if (req.user.role === 'rig' && req.user.rig_name) {
    const { data: parentPO } = await supabase
      .from('po_orders').select('rig_name').eq('id', item.po_id).single()
    if (parentPO && parentPO.rig_name !== req.user.rig_name) {
      return res.status(403).json({ error: 'You can only update line items for your assigned rig' })
    }
  }

  const patch = { quantity_delivered: qty, updated_at: new Date().toISOString() }
  if (req.body.remarks !== undefined) patch.remarks = req.body.remarks || null

  const { data: updated, error } = await supabase
    .from('po_line_items').update(patch).eq('id', req.params.itemId).select().single()
  if (error) return res.status(400).json({ error: error.message })

  // ✅ Respond immediately — email is fire-and-forget below
  res.json({ success: true, data: updated })

  // ── Fire-and-forget: partial-delivery alert ────────────────────────────────
  const isPartial = qty > 0 && qty < ordered
  if (isPartial) {
    ;(async () => {
      try {
        const { data: po } = await supabase
          .from('po_orders').select('*').eq('id', updated.po_id).single()
        if (!po) return

        // Rig managers for this rig + all purchase users
        const rigEmails      = await getEmailsByRole('rig', po.rig_name)
        const purchaseEmails = await getEmailsByRole('purchase')
        const recipients     = [...new Set([...rigEmails, ...purchaseEmails])]

        if (recipients.length) {
          await sendEmail({
            to:      recipients,
            subject: `Partial Delivery — ${po.po_number || po.mr_number} — ${updated.item_name}`,
            html:    partialDeliveryEmail(po, updated),
          })
          console.log(`[email] Partial delivery for ${po.po_number} item "${updated.item_name}" → ${recipients.length} recipients`)
        }
      } catch (e) {
        console.error('[po items PATCH] partial-delivery email error (non-fatal):', e)
      }
    })().catch(e => console.error('[po items PATCH] dispatch error (non-fatal):', e))
  }
})

module.exports = router
