// Client-side mirror of server/utils/fieldPermissions.js
// Keep both files in sync if the role rules ever change.

export const ROLE_EDITABLE_FIELDS = {
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
  admin: null,  // null = all fields
  csuite: [],   // read-only
}

const SYSTEM_FIELDS = new Set([
  'id', 'status', 'days_elapsed', 'is_stale', 'created_by', 'updated_at',
])

export function canEditField(role, fieldKey) {
  if (SYSTEM_FIELDS.has(fieldKey)) return false
  const allowed = ROLE_EDITABLE_FIELDS[role]
  if (allowed === null) return true
  if (!allowed || allowed.length === 0) return false
  return allowed.includes(fieldKey)
}

export function canCreatePO(role) {
  return role === 'purchase' || role === 'admin'
}

export function hasAnyEditableField(role) {
  if (role === 'admin') return true
  if (role === 'csuite') return false
  const allowed = ROLE_EDITABLE_FIELDS[role]
  return Array.isArray(allowed) && allowed.length > 0
}
