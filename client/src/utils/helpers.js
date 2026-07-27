import { PO_STATUSES, PURCHASE_STAGES, LOGISTICS_STAGES } from './constants'

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
  'Jindal Pioneer', 'Jindal Supreme', 'Directional Drilling', 'MLU', 'Pipavav',
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

/**
 * Visible status-pill text. Pipeline stage (calcStatus) is unchanged — this only
 * enriches the two "In Transit" stages with the specific dispatch destination
 * for display. e.g. "In Transit to Nhava" / "In Transit to Jindal Explorer".
 */
export function getDisplayStatus(po) {
  const status = calcStatus(po)
  if ((status === 'In Transit to JDIL' || status === 'In Transit to Rig') && po.jdil_location) {
    return `In Transit to ${po.jdil_location}`
  }
  if (status === 'Dispatched from JDIL' && po.jdil_location) {
    return `Dispatched to ${po.jdil_location}`
  }
  return status
}

export function statusIndex(status) {
  return PO_STATUSES.indexOf(status)
}

// ── Reverse Logistics status (latest filled field wins) ───────────────────────
// Return = 3 stages; Repair/Replacement = 7 stages. 'Failed' is a manual override
// stored on the row and takes precedence when present.
export function calcReverseLogisticsStatus(job) {
  if (!job) return 'Job Created'
  if (job.status === 'Failed') return 'Failed'

  if (job.job_type === 'Return') {
    if (job.vendor_received_date) return 'Delivered to Vendor'
    if (job.rig_dispatch_date)    return 'Dispatched from Rig'
    return 'Job Created'
  }

  // Repair / Replacement (7 stages)
  if (job.rig_received_date)      return 'Delivered to Rig'
  if (job.jdil_out_dispatch_date) return 'In Transit to Rig'
  if (job.jdil_out_received_date) return 'Back at JDIL'
  if (job.vendor_dispatch_date)  return job.job_type === 'Replacement' ? 'Replacement Ready' : 'Repair Complete'
  if (job.vendor_received_date)  return 'At Vendor'
  if (job.jdil_in_received_date) return 'At JDIL Location'
  if (job.rig_dispatch_date)     return 'Dispatched from Rig'
  return 'Job Created'
}

// Ordered pipeline stages for the RL pipeline dots (includes Job Created).
export function rlStageList(jobType) {
  if (jobType === 'Return') return ['Job Created', 'Dispatched from Rig', 'Delivered to Vendor']
  const mid = jobType === 'Replacement' ? 'Replacement Ready' : 'Repair Complete'
  return ['Job Created', 'Dispatched from Rig', 'At JDIL Location', 'At Vendor', mid, 'Back at JDIL', 'In Transit to Rig', 'Delivered to Rig']
}

// Enriched status-pill TEXT (pipeline stage unchanged; adds the specific
// location). Color still derives from the pipeline stage.
export function getRLDisplayStatus(job) {
  const s = calcReverseLogisticsStatus(job)
  switch (s) {
    case 'Dispatched from Rig':  return job.rig_dispatch_location   ? `Dispatched to ${job.rig_dispatch_location}` : s
    case 'At JDIL Location':     return job.jdil_in_received_location ? `At ${job.jdil_in_received_location}` : s
    case 'At Vendor':            return job.vendor_name             ? `At ${job.vendor_name}` : s
    case 'Repair Complete':
    case 'Replacement Ready':    return job.vendor_dispatch_location ? `In Transit to ${job.vendor_dispatch_location}` : s
    case 'Back at JDIL':         return job.jdil_out_received_location ? `At ${job.jdil_out_received_location}` : s
    case 'In Transit to Rig':    return job.jdil_out_dispatch_location ? `In Transit to ${job.jdil_out_dispatch_location}` : s
    case 'Delivered to Vendor':  return job.vendor_name             ? `At ${job.vendor_name}` : s
    default:                     return s   // Job Created, Delivered to Rig, Failed
  }
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

// STALE = overdue AND still in a PURCHASE-owned stage (purchase's responsibility).
export function isPurchaseStale(po, threshold = 45) {
  return PURCHASE_STAGES.includes(calcStatus(po)) && overdueDays(po) > threshold
}

// DELAYED DELIVERY = overdue AND in a LOGISTICS-owned stage, not yet delivered.
export function isDeliveryStale(po, threshold = 45) {
  return LOGISTICS_STAGES.includes(calcStatus(po)) && !po.delivered_to_rig_date && overdueDays(po) > threshold
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
