/**
 * Server-side shared constants for the escalation system.
 * Change recipients / rig managers here (and restart) — nothing about the
 * ladder is editable from the UI by design.
 */

const PINTO   = 'minguel.pinto@jindalmumbai.com'   // vendor-side owner / fallback
const MOORTHY = 'moorthy@jindalmumbai.com'         // logistics-side owner / fallback

// ── Login domain restriction + whitelist exceptions ──────────────────────────
// Mirror of client/src/utils/constants.js EMAIL_WHITELIST — keep the two in
// sync. Entries must be lowercase (matched against a normalized email).
const ALLOWED_DOMAIN = 'jindalmumbai.com'
const EMAIL_WHITELIST = [
  'advisor@jindaldrilling.in',
]

/** True if the email is on the allowed domain OR an explicit whitelist entry. */
function isAllowedEmail(email = '') {
  const normalized = String(email).trim().toLowerCase()
  if (normalized.endsWith(`@${ALLOWED_DOMAIN}`)) return true
  if (EMAIL_WHITELIST.includes(normalized)) return true
  return false
}

// Pipeline stages by owning team (used to classify the two escalation flows).
const PURCHASE_STAGES  = ['MR Created', 'PO Released', 'Buyer Assigned', 'Vendor Confirmed']
const LOGISTICS_STAGES = ['At JDIL Location', 'Dispatched from JDIL', 'In Transit to JDIL', 'In Transit to Rig']

// Rig → rig-manager email. "DD" variants share the base rig's manager.
// Directional Drilling and MLU are intentionally excluded — getRigManager()
// returns null for them, which means "skip the Rig Manager CC".
const RIG_MANAGERS = {
  'Discovery 1':       'sanjay.mahavar@jindalmumbai.com',
  'Discovery 1 DD':    'sanjay.mahavar@jindalmumbai.com',
  'Virtue 1':          's.mancharkar@jindalmumbai.com',
  'Virtue 1 DD':       's.mancharkar@jindalmumbai.com',
  'Jindal Star':       'vivek.verma@jindalmumbai.com',
  'Jindal Star DD':    'vivek.verma@jindalmumbai.com',
  'Jindal Explorer':   'sk.sinha@jindalmumbai.com',
  'Jindal Explorer DD':'sk.sinha@jindalmumbai.com',
  'Jindal Pioneer':    'varun.aggarwal@jindalmumbai.com',
  'Jindal Pioneer DD': 'varun.aggarwal@jindalmumbai.com',
  'Jindal Supreme':    'nidhish.kumar@jindalmumbai.com',
  'Jindal Supreme DD': 'nidhish.kumar@jindalmumbai.com',
}

/** Rig-manager email for a rig, or null if the rig has no mapped manager. */
function getRigManager(rigName) {
  if (!rigName) return null
  return RIG_MANAGERS[rigName] || null
}

/**
 * Progressive escalation ladder. Purely descriptive — the actual routing is
 * built in staleChecker.js. Exposed to the admin UI as read-only reference.
 * `minDays` is inclusive; a level applies when daysLate >= minDays and below
 * the next level's minDays.
 */
const ESCALATION_LEVELS = [
  {
    key: 'early', label: 'EARLY', range: 'Day 1–2', minDays: 1,
    vendor:    'TO: Buyer',
    logistics: 'TO: Logistics user',
  },
  {
    key: 'concerning', label: 'CONCERNING', range: 'Day 3–4', minDays: 3,
    vendor:    'TO: Buyer · CC: Pinto',
    logistics: 'TO: Logistics user · CC: Moorthy',
  },
  {
    key: 'serious', label: 'SERIOUS', range: 'Day 5+', minDays: 5,
    vendor:    'TO: Buyer · CC: Pinto (Rig Manager gets a dedicated per-rig email)',
    logistics: 'TO: Logistics user · CC: Moorthy (Rig Manager gets a dedicated per-rig email)',
  },
]

/** Classify a days-late count into an escalation level key. */
function levelForDays(daysLate) {
  if (daysLate >= 5) return 'serious'
  if (daysLate >= 3) return 'concerning'
  return 'early' // 1–2 (callers only pass daysLate >= 1)
}

module.exports = {
  PINTO, MOORTHY,
  ALLOWED_DOMAIN, EMAIL_WHITELIST, isAllowedEmail,
  PURCHASE_STAGES, LOGISTICS_STAGES,
  RIG_MANAGERS, getRigManager,
  ESCALATION_LEVELS, levelForDays,
}
