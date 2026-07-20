import { calcReverseLogisticsStatus, formatDate } from './helpers'

// Column definitions for the Reverse Logistics Excel export (column-picker).
export const RL_EXPORT_COLUMNS = [
  { key: 'po_number',    label: 'PO Number',    get: j => j.po_number || j.job_number || '' },
  { key: 'mr_number',    label: 'MR Number',    get: j => j.mr_number || '' },
  { key: 'job_type',     label: 'Type',         get: j => j.job_type || '' },
  { key: 'rig_name',     label: 'Rig',          get: j => j.rig_name || '' },
  { key: 'status',       label: 'Status',       get: j => calcReverseLogisticsStatus(j) },
  { key: 'is_stale',     label: 'Stale',        get: j => (j.is_stale ? 'Yes' : 'No') },
  { key: 'material_description_2', label: 'Material Description 2', get: j => j.material_description_2 || '' },

  { key: 'rig_dispatch_date',     label: 'Rig Dispatch Date',     get: j => formatDate(j.rig_dispatch_date) },
  { key: 'rig_dispatch_location', label: 'Rig Dispatch Location', get: j => j.rig_dispatch_location || '' },
  { key: 'rig_mode_of_transport', label: 'Rig Mode of Transport', get: j => j.rig_mode_of_transport || '' },

  { key: 'jdil_in_received_date',    label: 'Inbound Received Date',     get: j => formatDate(j.jdil_in_received_date) },
  { key: 'jdil_in_received_location',label: 'Inbound Received Location', get: j => j.jdil_in_received_location || '' },
  { key: 'jdil_in_dispatch_date',    label: 'Inbound Dispatch Date',     get: j => formatDate(j.jdil_in_dispatch_date) },
  { key: 'jdil_in_dispatch_location',label: 'Inbound Dispatch Location', get: j => j.jdil_in_dispatch_location || '' },
  { key: 'jdil_in_logistics_code',   label: 'Logistics Code',            get: j => j.jdil_in_logistics_code || '' },
  { key: 'jdil_in_dc_bkc',           label: 'DC (BKC)',                  get: j => j.jdil_in_dc_bkc || '' },
  { key: 'jdil_in_dc_taloja',        label: 'DC (Taloja)',               get: j => j.jdil_in_dc_taloja || '' },
  { key: 'jdil_in_dc_nhava',         label: 'DC (Nhava)',                get: j => j.jdil_in_dc_nhava || '' },
  { key: 'jdil_in_dc_nagothane',     label: 'DC (Nagothane)',            get: j => j.jdil_in_dc_nagothane || '' },
  { key: 'jdil_in_mode_of_transport',label: 'Inbound Mode of Transport', get: j => j.jdil_in_mode_of_transport || '' },
  { key: 'jdil_in_remarks',          label: 'Inbound Remarks',           get: j => j.jdil_in_remarks || '' },

  { key: 'vendor_name',          label: 'Vendor Name',        get: j => j.vendor_name || '' },
  { key: 'vendor_contact',       label: 'Vendor Contact',     get: j => j.vendor_contact || '' },
  { key: 'vendor_phone',         label: 'Vendor Phone',       get: j => j.vendor_phone || '' },
  { key: 'vendor_received_date', label: 'Vendor Received Date', get: j => formatDate(j.vendor_received_date) },

  { key: 'repair_description',      label: 'Repair Description',     get: j => j.repair_description || '' },
  { key: 'expected_return_date',    label: 'Expected Return Date',   get: j => formatDate(j.expected_return_date) },
  { key: 'vendor_dispatch_date',    label: 'Vendor Dispatch Date',   get: j => formatDate(j.vendor_dispatch_date) },
  { key: 'vendor_dispatch_location',label: 'Vendor Dispatch Location', get: j => j.vendor_dispatch_location || '' },
  { key: 'vendor_mode_of_transport',label: 'Vendor Mode of Transport', get: j => j.vendor_mode_of_transport || '' },

  { key: 'jdil_out_received_date',    label: 'Outbound Received Date',     get: j => formatDate(j.jdil_out_received_date) },
  { key: 'jdil_out_received_location',label: 'Outbound Received Location', get: j => j.jdil_out_received_location || '' },
  { key: 'jdil_out_dispatch_date',    label: 'Outbound Dispatch Date',     get: j => formatDate(j.jdil_out_dispatch_date) },
  { key: 'jdil_out_dispatch_location',label: 'Outbound Dispatch Location', get: j => j.jdil_out_dispatch_location || '' },
  { key: 'jdil_out_dc_number',        label: 'Outbound DC Number',         get: j => j.jdil_out_dc_number || '' },
  { key: 'jdil_out_mode_of_transport',label: 'Outbound Mode of Transport', get: j => j.jdil_out_mode_of_transport || '' },

  { key: 'rig_received_date', label: 'Rig Received Date', get: j => formatDate(j.rig_received_date) },
  { key: 'rig_remarks',       label: 'Rig Remarks',       get: j => j.rig_remarks || '' },
  { key: 'rig_other_remarks', label: 'Other Remarks',     get: j => j.rig_other_remarks || '' },
  { key: 'updated_at',        label: 'Last Updated',      get: j => j.updated_at ? formatDate(j.updated_at.split('T')[0]) : '' },
]
