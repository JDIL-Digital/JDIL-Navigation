// Server-side mirror of client/src/utils/helpers.js calcStatus + daysElapsed

const RIG_KEYWORDS = [
  'Discovery 1', 'Virtue 1', 'Jindal Star', 'Jindal Explorer',
  'Jindal Pioneer', 'Jindal Supreme', 'Directional Drilling', 'MLU',
]

function calcStatus(po) {
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

function daysElapsed(poDate) {
  if (!poDate) return 0
  return Math.floor((Date.now() - new Date(poDate).getTime()) / 86400000)
}

// Overdue is measured from promised_ready_date; fall back to po_date if absent.
function overdueDays(po) {
  const base = po.promised_ready_date || po.po_date
  if (!base) return 0
  return Math.floor((Date.now() - new Date(base).getTime()) / 86400000)
}

module.exports = { calcStatus, daysElapsed, overdueDays }
