// Single source of truth for field-level permissions.
// Mirrored on the client at client/src/utils/fieldPermissions.js.
// Any change here MUST be reflected there too.

const ROLE_EDITABLE_FIELDS = {
  purchase: [
    'mr_number', 'po_number', 'po_date', 'promised_ready_date',
    'rig_name', 'vendor_name', 'vendor_contact_name', 'vendor_phone_number',
    'buyer_code', 'material_description', 'material_description_2',
    'quantity_weight', 'delivery_mode',
  ],
  logistics: [
    // Formerly "Vendor Confirmed Date" and "Material Ready Date" — now logistics-owned
    'vendor_confirmed_date', 'material_ready_date', 'material_collection_location',
    'dispatch_date',
    'dc_number_bkc', 'dc_number_taloja', 'dc_number_nagothane', 'dc_number_nhava',
    'mode_of_transport', 'transporter_details', 'jdil_location', 'in_transit_rig_date',
    'material_received_date', 'material_received_location', 'logistics_team_code',
  ],
  rig: [
    'delivered_to_rig_date', 'remarks', 'other_remarks',
  ],
  admin: null,  // null = all user-facing fields permitted
  csuite: [],   // empty = no fields permitted (read-only)
}

// Fields that are always system-managed — never accepted from any client update.
const SYSTEM_FIELDS = new Set([
  'id', 'status', 'days_elapsed', 'is_stale', 'created_by', 'updated_at',
])

function canEditField(role, fieldKey) {
  if (SYSTEM_FIELDS.has(fieldKey)) return false
  const allowed = ROLE_EDITABLE_FIELDS[role]
  if (allowed === null) return true   // admin
  if (!allowed) return false          // csuite or unknown role
  return allowed.includes(fieldKey)
}

function canCreatePO(role) {
  return role === 'purchase' || role === 'admin'
}

/**
 * Given a role and a plain-object update body, returns
 * { ok: true } if all keys are permitted, or
 * { ok: false, forbidden: ['field1', ...] } listing the violated fields.
 */
function validateUpdateFields(role, updateBody) {
  const forbidden = Object.keys(updateBody).filter(k => !canEditField(role, k))
  if (forbidden.length > 0) return { ok: false, forbidden }
  return { ok: true }
}

// ─── Reverse Logistics field permissions ─────────────────────────────────────
const RL_ROLE_EDITABLE_FIELDS = {
  rig: [
    // Section 1 — Rig dispatch
    'material_description_2', 'rig_dispatch_date', 'rig_dispatch_location', 'rig_mode_of_transport',
    // Section 6 — Rig receives
    'rig_received_date', 'rig_remarks', 'rig_other_remarks',
  ],
  logistics: [
    // Section 2 — Inbound from rig
    'jdil_in_logistics_code', 'jdil_in_received_date', 'jdil_in_received_location',
    'jdil_in_dispatch_date', 'jdil_in_dispatch_location', 'jdil_in_mode_of_transport', 'jdil_in_remarks',
    'jdil_in_dc_bkc', 'jdil_in_dc_taloja', 'jdil_in_dc_nhava', 'jdil_in_dc_nagothane',
    // Section 5 — Outbound to rig
    'jdil_out_received_date', 'jdil_out_received_location', 'jdil_out_dispatch_date',
    'jdil_out_dispatch_location', 'jdil_out_dc_number', 'jdil_out_mode_of_transport',
  ],
  purchase: [
    // Section 3 — Vendor received
    'vendor_name', 'vendor_contact', 'vendor_phone', 'vendor_received_date',
    // Section 4 — Vendor ship back
    'repair_description', 'expected_return_date', 'vendor_dispatch_date',
    'vendor_dispatch_location', 'vendor_mode_of_transport',
  ],
  admin: null,   // all fields
  csuite: [],    // read-only
}

// Never accepted from a client update — system/meta or create-only.
const RL_SYSTEM_FIELDS = new Set([
  'id', 'job_type', 'job_number', 'mr_number', 'po_number', 'rig_name', 'status',
  'is_stale', 'created_by', 'created_at', 'updated_at',
])

function canEditRLField(role, fieldKey) {
  if (RL_SYSTEM_FIELDS.has(fieldKey)) return false
  const allowed = RL_ROLE_EDITABLE_FIELDS[role]
  if (allowed === null) return true
  if (!allowed || allowed.length === 0) return false
  return allowed.includes(fieldKey)
}

function validateRLUpdateFields(role, updateBody) {
  const forbidden = Object.keys(updateBody).filter(k => !canEditRLField(role, k))
  if (forbidden.length > 0) return { ok: false, forbidden }
  return { ok: true }
}

module.exports = {
  ROLE_EDITABLE_FIELDS, SYSTEM_FIELDS, canEditField, canCreatePO, validateUpdateFields,
  RL_ROLE_EDITABLE_FIELDS, RL_SYSTEM_FIELDS, canEditRLField, validateRLUpdateFields,
}
