import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { calcStatus } from '../utils/helpers'
import { PO_RIG_OPTIONS, PO_STATUSES } from '../utils/constants'
import POTable from '../components/ui/POTable'
import PODetailPanel from '../components/ui/PODetailPanel'

const LOGISTICS_STATUSES = [
  'Vendor Confirmed', 'Material Ready at Vendor', 'Dispatched from Vendor',
  'In Transit to JDIL', 'At JDIL Location', 'In Transit to Rig',
]

export default function LogisticsPage() {
  const { profile } = useAuth()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [rigFilter, setRigFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedPO, setSelectedPO] = useState(null)

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('po_orders')
      .select('*')
      .order('updated_at', { ascending: false })
    setOrders(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    let r = orders
    if (rigFilter !== 'all') r = r.filter(o => o.rig_name === rigFilter)
    if (statusFilter !== 'all') r = r.filter(o => calcStatus(o) === statusFilter)
    else r = r.filter(o => LOGISTICS_STATUSES.includes(calcStatus(o)) || calcStatus(o) === 'Buyer Assigned')
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
  }, [orders, rigFilter, statusFilter, search])

  return (
    <div className="p-4 lg:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Logistics</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{filtered.length} orders in logistics pipeline</p>
        </div>
      </div>

      <div className="card p-3 mb-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              className="input-field pl-9"
              placeholder="Search PO, MR, material…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select className="input-field w-full sm:w-44" value={rigFilter} onChange={e => setRigFilter(e.target.value)}>
            <option value="all">All Rigs</option>
            {PO_RIG_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select className="input-field w-full sm:w-52" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">Logistics Stages</option>
            {LOGISTICS_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-jdil-green border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <POTable orders={filtered} onRowClick={setSelectedPO} visibleColumns="logistics" />
        )}
      </div>

      {selectedPO && (
        <PODetailPanel
          po={selectedPO}
          onClose={() => setSelectedPO(null)}
          onSave={() => { load(); setSelectedPO(null) }}
        />
      )}
    </div>
  )
}
