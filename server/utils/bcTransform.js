/**
 * bcTransform.js — Business Central → JDIL data transformation.
 *
 * Pure, side-effect-free helpers. The two lookup functions take a Supabase
 * client as a parameter and perform READ-ONLY queries against the bc_* mapping
 * tables — nothing here writes to the database. Not wired into index.js yet.
 */

const SYNC_CUTOFF_DATE = '2026-07-01'

// ─────────────────────────────────────────────────────────────────────────────
// 1. extractRigPrefix
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Extract the rig prefix from a BC documentNo.
 *   "RD1/BO/2627/00105"  → "RD1"
 *   "RD1DD/BO/2627/..."  → "RD1DD"
 *   "RIG/TAWS/BO/..."    → "RIG/TAWS"
 *   "TAWS/BO/..."        → "TAWS"
 *   "" / null            → null
 * @param {string|null|undefined} documentNo
 * @returns {string|null}
 */
function extractRigPrefix(documentNo) {
  if (!documentNo) return null
  const parts = String(documentNo).split('/')
  if (parts[0] === 'RIG' && parts[1]) return `RIG/${parts[1]}`
  return parts[0] || null
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. lookupRigName  (READ-ONLY DB lookup)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Resolve a BC rig prefix to a JDIL rig name via bc_rig_mapping.
 * Matches the exact (already-extracted) prefix among active rows, longest first.
 * @param {string|null} bcPrefix
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @returns {Promise<{ rig_name: string|null, matched: boolean, unknown_prefix?: string|null }>}
 */
async function lookupRigName(bcPrefix, supabaseAdmin) {
  if (!bcPrefix) return { rig_name: null, matched: false, unknown_prefix: bcPrefix || null }
  const { data, error } = await supabaseAdmin
    .from('bc_rig_mapping')
    .select('jdil_rig_name')
    .eq('bc_prefix', bcPrefix)
    .eq('active', true)
    .order('prefix_length', { ascending: false })  // longest prefix first (RD1DD before RD1)
    .limit(1)
  if (error || !data || !data.length) {
    return { rig_name: null, matched: false, unknown_prefix: bcPrefix }
  }
  return { rig_name: data[0].jdil_rig_name, matched: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. lookupBuyerCode  (READ-ONLY DB lookup)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Normalize a buyer code to a canonical form for case-/format-insensitive
 * comparison. Uppercases and strips ALL whitespace and periods, so every
 * variation collapses to the same key (e.g. "Dharma C.", "DHARMA.C",
 * "dharma c" all → "DHARMAC").
 * @param {string|null} code
 * @returns {string|null}
 */
function normalizeBuyerCode(code) {
  if (!code) return null
  return String(code)
    .trim()
    .toUpperCase()
    .replace(/[\s.]+/g, '')   // remove ALL whitespace and periods
}

/**
 * Resolve a BC buyer code (e.g. "DHARMA.C") to a JDIL buyer code (e.g. "DC-22").
 * Case-/format-insensitive: compares normalized forms against the mapping table,
 * then the alias table. No fuzzy matching.
 * @param {string|null} bcBuyerCode
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * Unmatched and empty buyers are auto-assigned to the ACCOUNTS team, so a PO
 * is never left without a buyer_code.
 * @returns {Promise<object>} one of:
 *   { jdil_code:'ACCOUNTS', full_name:'Accounts (unassigned)', matched:false, is_empty:true, auto_assigned_to_accounts:true }
 *   { jdil_code, full_name, matched:true, confidence:100 }
 *   { jdil_code, full_name, matched:true, confidence:100, via_alias:true }
 *   { jdil_code:'ACCOUNTS', full_name:'Accounts (<bcValue>)', matched:false, auto_assigned_to_accounts:true, bc_value:<bcBuyerCode> }
 */
async function lookupBuyerCode(bcBuyerCode, supabaseAdmin) {
  const normInput = normalizeBuyerCode(bcBuyerCode)
  if (!normInput) return { jdil_code: 'ACCOUNTS', full_name: 'Accounts (unassigned)', matched: false, is_empty: true, auto_assigned_to_accounts: true }

  // Compare against all active buyer mappings on their normalized forms.
  const { data: buyers } = await supabaseAdmin
    .from('bc_buyer_mapping')
    .select('bc_buyer_code, jdil_buyer_code, full_name')
    .eq('active', true)
  for (const b of buyers || []) {
    if (normalizeBuyerCode(b.bc_buyer_code) === normInput) {
      return { jdil_code: b.jdil_buyer_code, full_name: b.full_name, matched: true, confidence: 100 }
    }
  }

  // Alias fallback (normalized), resolving the canonical code to a JDIL code.
  const { data: aliases } = await supabaseAdmin
    .from('bc_buyer_aliases')
    .select('alias, canonical_bc_code')
  for (const a of aliases || []) {
    if (normalizeBuyerCode(a.alias) === normInput) {
      const b = (buyers || []).find(x => x.bc_buyer_code === a.canonical_bc_code)
      if (b) return { jdil_code: b.jdil_buyer_code, full_name: b.full_name, matched: true, confidence: 100, via_alias: true }
    }
  }

  // No match anywhere → auto-assign to the ACCOUNTS team (never leave null).
  return { jdil_code: 'ACCOUNTS', full_name: `Accounts (${bcBuyerCode})`, matched: false, auto_assigned_to_accounts: true, bc_value: bcBuyerCode }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. transformBlanketOrder  (pure)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Transform a Level-1 BC Blanket Order header into JDIL MR shape.
 * PO-level fields are left null — they come from linkedOrders (Level 3).
 * @param {object} bcData  one BO from the BC response
 * @param {{ rigName: string|null }} lookups
 * @returns {object}
 */
function transformBlanketOrder(bcData, lookups = {}) {
  return {
    mr_number:       bcData.documentNo,
    mr_description:  bcData.MRDesc || null,
    mr_date:         parseDate(bcData.MRReleasedDate),
    rig_name:        lookups.rigName ?? null,
    office_location: bcData.PurchaseLocation ? String(bcData.PurchaseLocation).trim() || null : null,
    bc_blanket_order_id: bcData.id,
    bc_source:       true,
    bc_last_synced:  new Date().toISOString(),

    // Populated later from linkedOrders (Level 3):
    po_number:   null,
    vendor_code: null,
    vendor_name: null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. transformLinkedOrder  (pure)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Transform a Level-3 Linked Order (actual PO) into po_orders shape,
 * inheriting MR fields from the parent Blanket Order.
 * Logistics fields are intentionally omitted (JDIL users fill those).
 * @param {object} linkedOrder  one PO from blanketLines[].linkedOrders[]
 * @param {object} parentBO     the parent Level-1 Blanket Order
 * @param {{ rigName: string|null, buyerCode?: string, buyerLookupResult: object }} lookups
 * @returns {object}
 */
function transformLinkedOrder(linkedOrder, parentBO, lookups = {}) {
  const buyerLookup = lookups.buyerLookupResult || {}
  return {
    // MR fields (inherited from the parent Blanket Order)
    mr_number:       parentBO.documentNo,
    mr_description:  parentBO.MRDesc || null,
    mr_date:         parseDate(parentBO.MRReleasedDate),
    rig_name:        lookups.rigName ?? null,
    office_location: parentBO.PurchaseLocation ? String(parentBO.PurchaseLocation).trim() || null : null,

    // PO fields (from the linked order)
    po_number:              linkedOrder.documentNo,
    vendor_code:            linkedOrder.vendorNo,
    vendor_name:            linkedOrder.vendorName,
    material_description:   linkedOrder.Desc1 || null,
    material_description_2: linkedOrder.Desc2 || null,
    po_date:                parseDate(linkedOrder.POReleasedDate),
    po_status:              mapPOStatus(linkedOrder.poStatus),

    // Buyer handling
    buyer_code:     buyerLookup.jdil_code ?? null,
    buyer_code_raw: linkedOrder.BuyerCode,   // original BC value, for debugging

    // BC tracking
    bc_blanket_order_id: parentBO.id,
    bc_linked_order_id:  linkedOrder.id,
    bc_source:           true,
    bc_last_synced:      new Date().toISOString(),

    // Logistics fields intentionally NOT set (dispatch_date, material_received_date,
    // delivered_to_rig_date, grn_number, etc.) — owned by JDIL users.
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. mapPOStatus  (pure)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Map a BC poStatus to a JDIL status value.
 * @param {string|null|undefined} bcStatus
 * @returns {string}
 */
function mapPOStatus(bcStatus) {
  if (bcStatus == null || String(bcStatus).trim() === '') return 'MR Created'
  const map = {
    'Released':         'PO Released',
    'Open':             'PO Released',
    'Pending Approval': 'MR Created',
    'Closed':           'Delivered to Rig',
    'Cancelled':        'Cancelled',
  }
  const key = String(bcStatus).trim()
  return map[key] !== undefined ? map[key] : bcStatus   // unknown → original value
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. parseDate  (pure)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Parse a BC date string into JDIL's YYYY-MM-DD text format (or null).
 * Accepts a leading YYYY-MM-DD (ignoring any time component); invalid → null.
 * @param {string|null|undefined} bcDateString
 * @returns {string|null}
 */
function parseDate(bcDateString) {
  if (bcDateString == null) return null
  const s = String(bcDateString).trim()
  if (!s) return null
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) { console.warn(`[bcTransform] parseDate: unrecognized date "${bcDateString}" → null`); return null }
  const [, y, mo, d] = m
  const month = Number(mo), day = Number(d)
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    console.warn(`[bcTransform] parseDate: out-of-range date "${bcDateString}" → null`)
    return null
  }
  return `${y}-${mo}-${d}`
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. isWithinSyncRange  (pure)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * True if an MR date is on/after the sync cutoff (2026-07-01). Null → false.
 * YYYY-MM-DD strings sort lexicographically == chronologically.
 * @param {string|null} mrDate
 * @returns {boolean}
 */
function isWithinSyncRange(mrDate) {
  if (!mrDate) return false
  return mrDate >= SYNC_CUTOFF_DATE
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. processReceiptHeaders  (pure)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Extract GRAN info from a Level-4 receiptHeaders array.
 * @param {Array|null|undefined} receiptHeaders
 * @returns {{ grn_number: string|null, gran_date: string|null, all_grans: Array }}
 */
function processReceiptHeaders(receiptHeaders) {
  if (!Array.isArray(receiptHeaders) || receiptHeaders.length === 0) {
    return { grn_number: null, gran_date: null, all_grans: [] }
  }
  const getNo   = h => h.receiptNo ?? h.documentNo ?? h.no ?? null   // BC field: receiptNo
  const rawDate = h => h.postingDate ?? h.PostingDate ?? h.postingDateTime ?? null

  // Sort by posting date DESC (ISO strings sort correctly; blanks sink to the end).
  const sorted = [...receiptHeaders].sort((a, b) =>
    String(rawDate(b) || '').localeCompare(String(rawDate(a) || '')))

  const latest = sorted[0]
  return {
    grn_number: getNo(latest),
    gran_date:  parseDate(rawDate(latest)),
    all_grans:  sorted.map(h => ({
      grn_number:    getNo(h),
      gran_date:     parseDate(rawDate(h)),
      receipt_lines: Array.isArray(h.receiptLines) ? h.receiptLines : [],
    })),
  }
}

module.exports = {
  extractRigPrefix,
  lookupRigName,
  normalizeBuyerCode,
  lookupBuyerCode,
  transformBlanketOrder,
  transformLinkedOrder,
  mapPOStatus,
  parseDate,
  isWithinSyncRange,
  processReceiptHeaders,
  SYNC_CUTOFF_DATE,
}
