import { useState } from 'react'
import { calcStatus, daysElapsed, formatDate } from '../../utils/helpers'
import { exportToExcel } from '../../utils/loadXlsx'

// Master export column set. `get(po)` returns the formatted cell value.
// Dates use formatDate() → DD-MM-YYYY.
const EXPORT_COLUMNS = [
  { key: 'po_number',                  label: 'PO Number',                  get: o => o.po_number || '' },
  { key: 'mr_number',                  label: 'MR Number',                  get: o => o.mr_number || '' },
  { key: 'po_date',                    label: 'PO Date',                    get: o => formatDate(o.po_date) },
  { key: 'promised_ready_date',        label: 'Collection Date',            get: o => formatDate(o.promised_ready_date) },
  { key: 'rig_name',                   label: 'Rig / Location',             get: o => o.rig_name || '' },
  { key: 'status',                     label: 'Status',                     get: o => calcStatus(o) },
  { key: 'days_elapsed',               label: 'Days Elapsed',               get: o => daysElapsed(o.po_date) },
  { key: 'buyer_code',                 label: 'Buyer Code',                 get: o => o.buyer_code || '' },
  { key: 'delivery_mode',              label: 'Delivery Mode',              get: o => o.delivery_mode || '' },
  { key: 'vendor_name',                label: 'Vendor Name',                get: o => o.vendor_name || '' },
  { key: 'vendor_contact_name',        label: 'Vendor Contact Person',      get: o => o.vendor_contact_name || '' },
  { key: 'vendor_phone_number',        label: 'Vendor Phone',               get: o => o.vendor_phone_number || '' },
  { key: 'material',                   label: 'Material',                   get: o => o.material_description || o.material_description_2 || '' },
  { key: 'material_received_date',     label: 'Material Received Date',     get: o => formatDate(o.material_received_date) },
  { key: 'material_received_location', label: 'Material Received Location', get: o => o.material_received_location || '' },
  { key: 'dc_number_bkc',              label: 'DC Number (BKC)',            get: o => o.dc_number_bkc || '' },
  { key: 'dc_number_taloja',           label: 'DC Number (Taloja)',         get: o => o.dc_number_taloja || '' },
  { key: 'dc_number_nhava',            label: 'DC Number (Nhava)',          get: o => o.dc_number_nhava || '' },
  { key: 'dc_number_nagothane',        label: 'DC Number (Nagothane)',      get: o => o.dc_number_nagothane || '' },
  { key: 'dispatch_date',              label: 'Material Dispatch Date',     get: o => formatDate(o.dispatch_date) },
  { key: 'jdil_location',              label: 'Material Dispatch Location', get: o => o.jdil_location || '' },
  { key: 'mode_of_transport',          label: 'Mode of Transport',          get: o => o.mode_of_transport || '' },
  { key: 'transporter_details',        label: 'Transporter Detail',         get: o => o.transporter_details || '' },
  { key: 'in_transit_rig_date',        label: 'In Transit to Rig/JDIL Location Date', get: o => formatDate(o.in_transit_rig_date) },
  { key: 'delivered_to_rig_date',      label: 'Delivered to Rig Date',      get: o => formatDate(o.delivered_to_rig_date) },
  { key: 'remarks',                    label: 'Remarks',                    get: o => o.remarks || '' },
  { key: 'other_remarks',              label: 'Other Remarks',              get: o => o.other_remarks || '' },
  { key: 'updated_at',                 label: 'Last Updated',               get: o => o.updated_at ? formatDate(o.updated_at.split('T')[0]) : '' },
]

/**
 * Column-picker + download modal for exporting the currently-filtered POs.
 * Props: tab ('Purchase'|'Logistics'|'Rig'), rows (already filtered), onClose.
 */
export default function ExportModal({ tab = 'Export', rows = [], onClose }) {
  const [selected, setSelected] = useState(() => new Set(EXPORT_COLUMNS.map(c => c.key)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function toggle(key) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }
  const allOn = selected.size === EXPORT_COLUMNS.length
  function toggleAll() {
    setSelected(allOn ? new Set() : new Set(EXPORT_COLUMNS.map(c => c.key)))
  }

  async function handleDownload() {
    const cols = EXPORT_COLUMNS.filter(c => selected.has(c.key))
    if (cols.length === 0) { setError('Select at least one column.'); return }
    setBusy(true); setError('')
    try {
      const data = rows.map(po => {
        const row = {}
        cols.forEach(c => { row[c.label] = c.get(po) })
        return row
      })
      const today = new Date().toISOString().slice(0, 10)   // YYYY-MM-DD
      await exportToExcel(data, `JDIL_Navigation_${tab}_${today}.xlsx`, tab)
      onClose()
    } catch (e) {
      console.error('Excel export error:', e)
      setError(e.message || 'Export failed. Check your internet connection and try again.')
    }
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-md max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">Export to Excel</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">{rows.length} row{rows.length !== 1 ? 's' : ''} (current filters)</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Column checkboxes */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Select columns to export</p>
            <button onClick={toggleAll} className="text-xs font-medium text-jdil-green hover:text-jdil-green-dark">
              {allOn ? 'Deselect all' : 'Select all'}
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {EXPORT_COLUMNS.map(c => (
              <label key={c.key} className="flex items-center gap-2 cursor-pointer py-1 px-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <input
                  type="checkbox"
                  checked={selected.has(c.key)}
                  onChange={() => toggle(c.key)}
                  className="accent-jdil-green w-4 h-4 shrink-0"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{c.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-800 space-y-2">
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex gap-3">
            <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button
              onClick={handleDownload}
              disabled={busy || rows.length === 0}
              className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {busy && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {busy ? 'Preparing…' : `Download (${selected.size})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
