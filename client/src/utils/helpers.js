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

export function calcStatus(po) {
  if (po.delivered_to_rig_date) return 'Delivered to Rig'
  if (po.in_transit_rig_date)   return 'In Transit to Rig'
  if (po.jdil_location)         return 'At JDIL Location'
  if (po.dispatch_date)         return 'In Transit to JDIL'
  if (po.dc_number_bkc || po.dc_number_taloja || po.dc_number_nagothane || po.dc_number_nhava)
                                return 'Dispatched from Vendor'
  if (po.material_collection_location || po.material_ready_date) return 'Material Ready at Vendor'
  if (po.vendor_confirmed_date) return 'Vendor Confirmed'
  if (po.buyer_code)            return 'Buyer Assigned'
  if (po.po_number)             return 'PO Released'
  return 'MR Created'
}

export function statusIndex(status) {
  return PO_STATUSES.indexOf(status)
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
