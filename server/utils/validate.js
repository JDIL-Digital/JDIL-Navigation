// Lightweight input validation / sanitisation helpers (no external dependency).
// Supabase's client uses parameterised queries, so classic SQL injection isn't
// possible, but we still cap lengths and reject malformed payloads to prevent
// abuse and oversized writes.

// Per-field maximum lengths for po_orders text columns.
const FIELD_MAX_LENGTHS = {
  mr_number: 60,
  po_number: 60,
  rig_name: 120,
  vendor_name: 200,
  vendor_contact_name: 200,
  vendor_phone_number: 40,
  buyer_code: 20,
  material_description: 2000,
  material_description_2: 2000,
  quantity_weight: 200,
  delivery_mode: 40,
  mode_of_transport: 40,
  transporter_details: 500,
  jdil_location: 60,
  material_collection_location: 120,
  material_received_location: 60,
  grn_number: 100,
  dc_number_bkc: 100,
  dc_number_taloja: 100,
  dc_number_nagothane: 100,
  dc_number_nhava: 100,
  remarks: 1000,
  other_remarks: 1000,
}

// Default cap for any string field not explicitly listed above.
const DEFAULT_MAX = 2000

/**
 * Validates string field lengths in an update/create body.
 * Returns { ok: true } or { ok: false, error: '...' }.
 */
function validateFieldLengths(body, limits = FIELD_MAX_LENGTHS) {
  for (const [key, val] of Object.entries(body)) {
    if (typeof val !== 'string') continue
    const max = limits[key] ?? DEFAULT_MAX
    if (val.length > max) {
      return { ok: false, error: `Field "${key}" exceeds the maximum length of ${max} characters.` }
    }
  }
  return { ok: true }
}

/** Trims a string and enforces a max length; returns null for empty. */
function cleanString(val, maxLen = DEFAULT_MAX) {
  if (val === undefined || val === null) return null
  const s = String(val).trim()
  if (!s) return null
  return s.slice(0, maxLen)
}

module.exports = { FIELD_MAX_LENGTHS, DEFAULT_MAX, validateFieldLengths, cleanString }
