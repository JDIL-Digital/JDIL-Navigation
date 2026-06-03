// Single source of truth for field-level permissions.
// Mirrored on the client at client/src/utils/fieldPermissions.js.
// Any change here MUST be reflected there too.

const ROLE_EDITABLE_FIELDS = {
  purchase: [
    'mr_number', 'po_number', 'po_date', 'promised_ready_date',
    'rig_name', 'vendor_name', 'vendor_contact_name', 'vendor_phone_number',
    'buyer_code', 'material_description', 'material_description_2',
    'quantity_weight', 'delivery_mode', 'remarks',
  ],
  logistics: [
    // Formerly "Vendor Confirmed Date" and "Material Ready Date" — now logistics-owned
    'vendor_confirmed_date', 'material_ready_date', 'material_collection_location',
    'dispatch_date',
    'dc_number_bkc', 'dc_number_taloja', 'dc_number_nagothane', 'dc_number_nhava',
    'mode_of_transport', 'transporter_details', 'jdil_location', 'in_transit_rig_date',
  ],
  rig: [
    'delivered_to_rig_date', 'other_remarks',
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

module.exports = { ROLE_EDITABLE_FIELDS, SYSTEM_FIELDS, canEditField, canCreatePO, validateUpdateFields }
