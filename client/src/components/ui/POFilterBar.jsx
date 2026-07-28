import { PO_RIG_OPTIONS, PO_STATUSES, BUYER_CODES } from '../../utils/constants'
import { emptyPOFilters, hasActivePOFilters } from '../../utils/poFilters'
import VendorAutocomplete from './VendorAutocomplete'

const DATE_FIELDS = [
  { value: 'po_date',              label: 'PO Date' },
  { value: 'promised_ready_date',  label: 'Promised Ready Date' },
  { value: 'delivered_to_rig_date', label: 'GRAN Date' },
  { value: 'updated_at',           label: 'Last Updated' },
]

/**
 * Reusable filter bar for the Purchase / Logistics / Rig pages.
 * Props:
 *   filters       — current filter object (see poFilters.emptyPOFilters)
 *   onChange      — (nextFilters) => void
 *   showBuyerCode — true to render the Buyer Code filter (Purchase tab only)
 *   total, shown  — counts for the "Showing X of Y" line
 *   onExport      — opens the Export modal
 */
export default function POFilterBar({ filters, onChange, showBuyerCode = false, total = 0, shown = 0, onExport }) {
  const set = (key, val) => onChange({ ...filters, [key]: val })
  const active = hasActivePOFilters(filters)

  return (
    <div className="card p-3 mb-3 space-y-3">
      {/* Row 1 — search + export */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            className="input-field pl-9"
            placeholder="Search PO, MR, material, vendor, GRAN…"
            value={filters.search}
            onChange={e => set('search', e.target.value)}
          />
        </div>
        <button onClick={onExport} className="btn-secondary flex items-center justify-center gap-2 text-sm shrink-0">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Export to Excel
        </button>
      </div>

      {/* Row 2 — date range + field selector */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex items-center gap-2 flex-1">
          <select className="input-field w-auto sm:w-44" value={filters.dateField} onChange={e => set('dateField', e.target.value)}>
            {DATE_FIELDS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
          <input type="date" className="input-field" value={filters.dateFrom} onChange={e => set('dateFrom', e.target.value)} title="From" />
          <span className="text-gray-400 text-sm">to</span>
          <input type="date" className="input-field" value={filters.dateTo} onChange={e => set('dateTo', e.target.value)} title="To" />
        </div>
      </div>

      {/* Row 3 — dropdown filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <select className="input-field" value={filters.rig} onChange={e => set('rig', e.target.value)}>
          <option value="all">All Rigs / Locations</option>
          {PO_RIG_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>

        <select className="input-field" value={filters.status} onChange={e => set('status', e.target.value)}>
          <option value="all">All Statuses</option>
          {PO_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        {showBuyerCode && (
          <select className="input-field" value={filters.buyerCode} onChange={e => set('buyerCode', e.target.value)}>
            <option value="all">All Buyer Codes</option>
            {BUYER_CODES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}

        <div className={showBuyerCode ? '' : 'lg:col-span-2'}>
          <VendorAutocomplete
            value={filters.vendor}
            onChange={v => set('vendor', v)}
            onSelect={vendor => set('vendor', vendor.name)}
            placeholder="Filter by vendor…"
          />
        </div>
      </div>

      {/* Footer — count + clear */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Showing <span className="font-semibold text-gray-700 dark:text-gray-300">{shown}</span> of {total} POs
        </p>
        {active && (
          <button
            onClick={() => onChange(emptyPOFilters())}
            className="text-xs font-medium text-jdil-green hover:text-jdil-green-dark flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Clear all filters
          </button>
        )}
      </div>
    </div>
  )
}
