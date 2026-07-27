// Server-side mirror of client/src/utils/helpers.js calcStatus + daysElapsed

const RIG_KEYWORDS = [
  'Discovery 1', 'Virtue 1', 'Jindal Star', 'Jindal Explorer',
  'Jindal Pioneer', 'Jindal Supreme', 'Directional Drilling', 'MLU', 'Pipavav',
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

// Visible status-pill text — pipeline stage unchanged; enriches "In Transit"
// stages with the specific dispatch destination for display.
function getDisplayStatus(po) {
  const status = calcStatus(po)
  if ((status === 'In Transit to JDIL' || status === 'In Transit to Rig') && po.jdil_location) {
    return `In Transit to ${po.jdil_location}`
  }
  if (status === 'Dispatched from JDIL' && po.jdil_location) {
    return `Dispatched to ${po.jdil_location}`
  }
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

// ── Progressive escalation staleness (day-1+, replaces the 45-day threshold) ──
const _PURCHASE_STAGES  = new Set(['MR Created', 'PO Released', 'Buyer Assigned', 'Vendor Confirmed'])
const _LOGISTICS_STAGES = new Set(['At JDIL Location', 'Dispatched from JDIL', 'In Transit to JDIL', 'In Transit to Rig'])

// Whole days elapsed since a date (0 if unset/future).
function daysSince(dateStr) {
  if (!dateStr) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000))
}

// FLOW 1 — vendor-side: promised date passed, material not yet received.
// Days late is measured from promised_ready_date.
function isVendorStale(po) {
  if (!po.promised_ready_date || po.material_received_date) return false
  if (!_PURCHASE_STAGES.has(calcStatus(po))) return false
  return daysSince(po.promised_ready_date) >= 1
}

// FLOW 2 — logistics-side: material received at JDIL, not yet delivered to rig.
// Days late is measured from material_received_date.
function isLogisticsStale(po) {
  if (!po.material_received_date || po.delivered_to_rig_date) return false
  if (!_LOGISTICS_STAGES.has(calcStatus(po))) return false
  return daysSince(po.material_received_date) >= 1
}

// Days-late number for whichever flow the PO is in (0 if neither).
function daysLate(po) {
  if (isVendorStale(po))    return daysSince(po.promised_ready_date)
  if (isLogisticsStale(po)) return daysSince(po.material_received_date)
  return 0
}

// ── Reverse Logistics status (latest filled field wins) ───────────────────────
function calcReverseLogisticsStatus(job) {
  if (!job) return 'Job Created'
  if (job.status === 'Failed') return 'Failed'

  if (job.job_type === 'Return') {
    if (job.vendor_received_date) return 'Delivered to Vendor'
    if (job.rig_dispatch_date)    return 'Dispatched from Rig'
    return 'Job Created'
  }

  if (job.rig_received_date)      return 'Delivered to Rig'
  if (job.jdil_out_dispatch_date) return 'In Transit to Rig'
  if (job.jdil_out_received_date) return 'Back at JDIL'
  if (job.vendor_dispatch_date)  return job.job_type === 'Replacement' ? 'Replacement Ready' : 'Repair Complete'
  if (job.vendor_received_date)  return 'At Vendor'
  if (job.jdil_in_received_date) return 'At JDIL Location'
  if (job.rig_dispatch_date)     return 'Dispatched from Rig'
  return 'Job Created'
}

function getRLDisplayStatus(job) {
  const s = calcReverseLogisticsStatus(job)
  switch (s) {
    case 'Dispatched from Rig':  return job.rig_dispatch_location    ? `Dispatched to ${job.rig_dispatch_location}` : s
    case 'At JDIL Location':     return job.jdil_in_received_location  ? `At ${job.jdil_in_received_location}` : s
    case 'At Vendor':            return job.vendor_name              ? `At ${job.vendor_name}` : s
    case 'Repair Complete':
    case 'Replacement Ready':    return job.vendor_dispatch_location  ? `In Transit to ${job.vendor_dispatch_location}` : s
    case 'Back at JDIL':         return job.jdil_out_received_location ? `At ${job.jdil_out_received_location}` : s
    case 'In Transit to Rig':    return job.jdil_out_dispatch_location ? `In Transit to ${job.jdil_out_dispatch_location}` : s
    case 'Delivered to Vendor':  return job.vendor_name              ? `At ${job.vendor_name}` : s
    default:                     return s
  }
}

module.exports = {
  calcStatus, getDisplayStatus, daysElapsed, overdueDays,
  daysSince, isVendorStale, isLogisticsStale, daysLate,
  calcReverseLogisticsStatus, getRLDisplayStatus,
}
