import { useEffect, useState, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { calcStatus, overdueDays } from '../utils/helpers'
import { OVERDUE_DAYS } from '../utils/constants'
import POTable from '../components/ui/POTable'
import PODetailPanel from '../components/ui/PODetailPanel'
import NewPOPanel from '../components/ui/NewPOPanel'
import POFilterBar from '../components/ui/POFilterBar'
import ExportModal from '../components/ui/ExportModal'
import { emptyPOFilters, applyPOFilters } from '../utils/poFilters'

// Quick-filters arriving from Dashboard KPI cards via the ?filter= query param.
const QUICK_FILTERS = {
  'on-time-delivered': {
    label: 'On-time delivered',
    predicate: o => o.delivered_to_rig_date && o.promised_ready_date &&
                    new Date(o.delivered_to_rig_date) <= new Date(o.promised_ready_date),
  },
  'delivered': {
    label: 'Delivered',
    predicate: o => !!o.delivered_to_rig_date,
  },
  'open': {
    label: 'Open (not delivered)',
    predicate: o => calcStatus(o) !== 'Delivered to Rig',
  },
  'stale': {
    label: `Stale (> ${OVERDUE_DAYS}d past promised)`,
    predicate: o => overdueDays(o) > OVERDUE_DAYS && calcStatus(o) !== 'Delivered to Rig',
  },
  'items-pending': {
    label: 'Items pending delivery',
    predicate: (o, ctx) => ctx.pendingItemPoIds.has(o.id),
  },
}

export default function PurchaseOrders() {
  const { profile } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [orders, setOrders] = useState([])
  const [pendingItemPoIds, setPendingItemPoIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState(emptyPOFilters())
  const [quickFilter, setQuickFilter] = useState(null)  // { key, label, predicate }
  const [selectedPO, setSelectedPO] = useState(null)
  const [newPOOpen, setNewPOOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

  // Apply ?filter= and ?rig= from the URL on mount (Dashboard deep-links).
  useEffect(() => {
    const f   = searchParams.get('filter')
    const rig = searchParams.get('rig')
    if (rig) setFilters(prev => ({ ...prev, rig }))
    if (f && QUICK_FILTERS[f]) setQuickFilter({ key: f, ...QUICK_FILTERS[f] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function load() {
    setLoading(true)
    let q = supabase.from('po_orders').select('*').order('updated_at', { ascending: false })
    if (profile?.role === 'purchase' && profile?.team_code)
      q = q.eq('buyer_code', profile.team_code)
    const [{ data }, { data: items }] = await Promise.all([
      q,
      supabase.from('po_line_items').select('po_id, quantity_pending'),
    ])
    setOrders(data || [])
    setPendingItemPoIds(new Set((items || []).filter(it => Number(it.quantity_pending) > 0).map(it => it.po_id)))
    setLoading(false)
  }

  useEffect(() => { load() }, [profile])

  const filtered = useMemo(() => {
    let r = applyPOFilters(orders, filters)
    if (quickFilter) r = r.filter(o => quickFilter.predicate(o, { pendingItemPoIds }))
    return r
  }, [orders, filters, quickFilter, pendingItemPoIds])

  function clearQuickFilter() {
    setQuickFilter(null)
    // Drop the filter param from the URL so a refresh doesn't re-pin it.
    const next = new URLSearchParams(searchParams)
    next.delete('filter')
    setSearchParams(next, { replace: true })
  }

  const canCreate = profile?.role === 'purchase' || profile?.role === 'admin'

  return (
    <div className="p-4 lg:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Purchase Orders</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{orders.length} orders</p>
        </div>
        {canCreate && (
          <button onClick={() => setNewPOOpen(true)} className="btn-primary flex items-center gap-2 text-sm py-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New PO
          </button>
        )}
      </div>

      {/* Active quick-filter chip (from a Dashboard KPI card) */}
      {quickFilter && (
        <div className="mb-3 flex items-center gap-2">
          <span className="inline-flex items-center gap-2 bg-jdil-green/10 border border-jdil-green/30 text-jdil-green text-sm font-medium rounded-full pl-3 pr-2 py-1">
            Filtered: {quickFilter.label}
            <button
              onClick={clearQuickFilter}
              className="hover:bg-jdil-green/20 rounded-full p-0.5"
              aria-label="Clear filter"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        </div>
      )}

      {/* Filter bar */}
      <POFilterBar
        filters={filters}
        onChange={setFilters}
        showBuyerCode={true}
        total={orders.length}
        shown={filtered.length}
        onExport={() => setExportOpen(true)}
      />

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-jdil-green border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <POTable orders={filtered} onRowClick={setSelectedPO} visibleColumns="purchase" />
        )}
      </div>

      {selectedPO && (
        <PODetailPanel
          po={selectedPO}
          onClose={() => setSelectedPO(null)}
          onSave={() => { load(); setSelectedPO(null) }}
        />
      )}

      {newPOOpen && (
        <NewPOPanel
          onClose={() => setNewPOOpen(false)}
          onCreated={load}
          existingCount={orders.length}
        />
      )}

      {exportOpen && (
        <ExportModal tab="Purchase" rows={filtered} onClose={() => setExportOpen(false)} />
      )}
    </div>
  )
}
