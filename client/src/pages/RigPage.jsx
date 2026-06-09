import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { calcStatus } from '../utils/helpers'
import POTable from '../components/ui/POTable'
import PODetailPanel from '../components/ui/PODetailPanel'
import POFilterBar from '../components/ui/POFilterBar'
import ExportModal from '../components/ui/ExportModal'
import { emptyPOFilters, applyPOFilters } from '../utils/poFilters'

export default function RigPage() {
  const { profile } = useAuth()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState(emptyPOFilters())
  const [selectedPO, setSelectedPO] = useState(null)
  const [exportOpen, setExportOpen] = useState(false)

  async function load() {
    setLoading(true)
    let q = supabase.from('po_orders').select('*').order('updated_at', { ascending: false })
    if (profile?.role === 'rig' && profile?.rig_name)
      q = q.eq('rig_name', profile.rig_name)
    const { data } = await q
    setOrders(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [profile])

  const filtered = useMemo(() => applyPOFilters(orders, filters), [orders, filters])

  return (
    <div className="p-4 lg:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            Rig {profile?.role === 'rig' && profile?.rig_name ? `— ${profile.rig_name}` : ''}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{orders.length} orders</p>
        </div>
      </div>

      <POFilterBar
        filters={filters}
        onChange={setFilters}
        total={orders.length}
        shown={filtered.length}
        onExport={() => setExportOpen(true)}
      />

      {/* Delivered summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {(['In Transit to Rig', 'Delivered to Rig', 'At JDIL Location', 'In Transit to JDIL']).map(s => (
          <div key={s} className="card p-3 text-center">
            <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {filtered.filter(o => calcStatus(o) === s).length}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{s}</p>
          </div>
        ))}
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-jdil-green border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <POTable orders={filtered} onRowClick={setSelectedPO} visibleColumns="rig" />
        )}
      </div>

      {selectedPO && (
        <PODetailPanel
          po={selectedPO}
          onClose={() => setSelectedPO(null)}
          onSave={() => { load(); setSelectedPO(null) }}
        />
      )}

      {exportOpen && (
        <ExportModal tab="Rig" rows={filtered} onClose={() => setExportOpen(false)} />
      )}
    </div>
  )
}
