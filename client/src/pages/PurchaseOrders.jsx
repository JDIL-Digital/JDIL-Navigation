import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { calcStatus, daysElapsed } from '../utils/helpers'
import { PO_RIG_OPTIONS, PO_STATUSES, OVERDUE_DAYS } from '../utils/constants'
import POTable from '../components/ui/POTable'
import PODetailPanel from '../components/ui/PODetailPanel'
import NewPOPanel from '../components/ui/NewPOPanel'

export default function PurchaseOrders() {
  const { profile } = useAuth()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [rigFilter, setRigFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [staleOnly, setStaleOnly] = useState(false)
  const [selectedPO, setSelectedPO] = useState(null)
  const [newPOOpen, setNewPOOpen] = useState(false)

  async function load() {
    setLoading(true)
    let q = supabase.from('po_orders').select('*').order('updated_at', { ascending: false })
    if (profile?.role === 'purchase' && profile?.team_code)
      q = q.eq('buyer_code', profile.team_code)
    const { data } = await q
    setOrders(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [profile])

  const filtered = useMemo(() => {
    let r = orders
    if (rigFilter !== 'all') r = r.filter(o => o.rig_name === rigFilter)
    if (statusFilter !== 'all') r = r.filter(o => calcStatus(o) === statusFilter)
    if (staleOnly) r = r.filter(o => daysElapsed(o.po_date) > OVERDUE_DAYS && calcStatus(o) !== 'Delivered to Rig')
    if (search.trim()) {
      const q = search.toLowerCase()
      r = r.filter(o =>
        (o.po_number || '').toLowerCase().includes(q) ||
        (o.mr_number || '').toLowerCase().includes(q) ||
        (o.material_description || '').toLowerCase().includes(q) ||
        (o.vendor_name || '').toLowerCase().includes(q)
      )
    }
    return r
  }, [orders, rigFilter, statusFilter, staleOnly, search])

  const canCreate = profile?.role === 'purchase' || profile?.role === 'admin'

  return (
    <div className="p-4 lg:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Purchase Orders</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{filtered.length} orders</p>
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

      {/* Filters */}
      <div className="card p-3 mb-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              className="input-field pl-9"
              placeholder="Search PO, MR, material, vendor…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select className="input-field w-full sm:w-44" value={rigFilter} onChange={e => setRigFilter(e.target.value)}>
            <option value="all">All Rigs</option>
            {PO_RIG_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select className="input-field w-full sm:w-52" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">All Statuses</option>
            {PO_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <label className="flex items-center gap-2 cursor-pointer shrink-0">
            <div
              onClick={() => setStaleOnly(s => !s)}
              className={`w-10 h-5 rounded-full transition-colors relative cursor-pointer ${staleOnly ? 'bg-jdil-red' : 'bg-gray-300 dark:bg-gray-600'}`}
            >
              <div className={`w-4 h-4 bg-white rounded-full absolute top-0.5 transition-transform shadow ${staleOnly ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </div>
            <span className="text-sm text-gray-600 dark:text-gray-400">Stale Only</span>
          </label>
        </div>
      </div>

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
    </div>
  )
}
