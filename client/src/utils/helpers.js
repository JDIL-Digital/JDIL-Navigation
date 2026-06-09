import { PO_STATUSES } from './constants'

export function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d)) return '—'
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}-${mm}-${yyyy}`
}

export function parseDate(ddmmyyyy) {
  if (!ddmmyyyy) return null
  const [dd, mm, yyyy] = ddmmyyyy.split('-')
  return `${yyyy}-${mm}-${dd}`
}

export function daysElapsed(poDate) {
  if (!poDate) return 0
  const start = new Date(poDate)
  const now = new Date()
  return Math.floor((now - start) / (1000 * 60 * 60 * 24))
}

// Rig destinations — if the dispatch location matches any of these, an
// in-transit PO is heading to a rig; otherwise it's between JDIL hubs.
const RIG_KEYWORDS = [
  'Discovery 1', 'Virtue 1', 'Jindal Star', 'Jindal Explorer',
  'Jindal Pioneer', 'Jindal Supreme', 'Directional Drilling', 'MLU',
]

export function calcStatus(po) {
  // Latest filled field wins — evaluated in pipeline order, last match returned.
  let status = 'MR Created'
  if (po.mr_number)             status = 'MR Created'
  if (po.po_number)             status = 'PO Released'
  if (po.buyer_code)            status = 'Buyer Assigned'
  if (po.promised_ready_date)   status = 'Vendor Confirmed'
  if (po.material_received_date) status = 'At JDIL Location'
  if (po.dispatch_date)         status = 'Dispatched from JDIL'
  if (po.in_transit_rig_date) {
    const isRig = RIG_KEYWORDS.some(k => (po.jdil_location || '').includes(k))
    status = isRig ? 'In Transit to Rig' : 'In Transit to JDIL'
  }
  if (po.delivered_to_rig_date) status = 'Delivered to Rig'
  return status
}

export function statusIndex(status) {
  return PO_STATUSES.indexOf(status)
}

// Overdue is measured from promised_ready_date; if absent, fall back to po_date.
export function overdueBaseDate(po) {
  return po?.promised_ready_date || po?.po_date || null
}

// Days elapsed since the overdue base date (promised_ready_date or po_date fallback).
export function overdueDays(po) {
  const base = overdueBaseDate(po)
  return base ? daysElapsed(base) : 0
}

// True if the PO is past the overdue threshold and not yet delivered.
export function isOverdue(po, threshold = 45) {
  if (calcStatus(po) === 'Delivered to Rig') return false
  return overdueDays(po) > threshold
}

export function generateMRNumber(existingCount) {
  const year = new Date().getFullYear()
  const seq = String(existingCount + 1).padStart(3, '0')
  return `MR-${year}-${seq}`
}

export function generatePONumber(existingCount) {
  const year = new Date().getFullYear()
  const seq = String(existingCount + 1).padStart(3, '0')
  return `PO-${year}-${seq}`
}

export function vendorScore(orders) {
  if (!orders.length) return 0
  const onTime = orders.filter(o => {
    if (!o.delivered_to_rig_date || !o.promised_ready_date) return false
    return new Date(o.delivered_to_rig_date) <= new Date(o.promised_ready_date)
  }).length
  return Math.round((onTime / orders.length) * 100)
}
