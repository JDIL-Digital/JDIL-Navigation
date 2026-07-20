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

// ── Reverse Logistics (mirror of server RL_ROLE_EDITABLE_FIELDS) ──────────────
export const RL_ROLE_EDITABLE_FIELDS = {
  rig: [
    'material_description_2', 'rig_dispatch_date', 'rig_dispatch_location', 'rig_mode_of_transport',
    'rig_received_date', 'rig_remarks', 'rig_other_remarks',
  ],
  logistics: [
    'jdil_in_logistics_code', 'jdil_in_received_date', 'jdil_in_received_location',
    'jdil_in_dispatch_date', 'jdil_in_dispatch_location', 'jdil_in_mode_of_transport', 'jdil_in_remarks',
    'jdil_in_dc_bkc', 'jdil_in_dc_taloja', 'jdil_in_dc_nhava', 'jdil_in_dc_nagothane',
    'jdil_out_received_date', 'jdil_out_received_location', 'jdil_out_dispatch_date',
    'jdil_out_dispatch_location', 'jdil_out_dc_number', 'jdil_out_mode_of_transport',
  ],
  purchase: [
    'vendor_name', 'vendor_contact', 'vendor_phone', 'vendor_received_date',
    'repair_description', 'expected_return_date', 'vendor_dispatch_date',
    'vendor_dispatch_location', 'vendor_mode_of_transport',
  ],
  admin: null,
  csuite: [],
}

const RL_SYSTEM_FIELDS = new Set([
  'id', 'job_type', 'job_number', 'mr_number', 'po_number', 'rig_name', 'status',
  'is_stale', 'created_by', 'created_at', 'updated_at',
])

export function canEditRLField(role, fieldKey) {
  if (RL_SYSTEM_FIELDS.has(fieldKey)) return false
  const allowed = RL_ROLE_EDITABLE_FIELDS[role]
  if (allowed === null) return true
  if (!allowed || allowed.length === 0) return false
  return allowed.includes(fieldKey)
}

export function canCreateRLJob(role) {
  return role === 'rig' || role === 'admin'
}
