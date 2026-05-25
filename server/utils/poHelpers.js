// Server-side mirror of client/src/utils/helpers.js calcStatus + daysElapsed

function calcStatus(po) {
  if (po.delivered_to_rig_date)  return 'Delivered to Rig'
  if (po.in_transit_rig_date)    return 'In Transit to Rig'
  if (po.jdil_location)          return 'At JDIL Location'
  if (po.dispatch_date)          return 'In Transit to JDIL'
  if (po.dc_number_bkc || po.dc_number_taloja || po.dc_number_nagothane || po.dc_number_nhava)
                                 return 'Dispatched from Vendor'
  if (po.material_ready_date)    return 'Material Ready at Vendor'
  if (po.vendor_confirmed_date)  return 'Vendor Confirmed'
  if (po.buyer_code)             return 'Buyer Assigned'
  if (po.po_number)              return 'PO Released'
  return 'MR Created'
}

function daysElapsed(poDate) {
  if (!poDate) return 0
  return Math.floor((Date.now() - new Date(poDate).getTime()) / 86400000)
}

module.exports = { calcStatus, daysElapsed }
