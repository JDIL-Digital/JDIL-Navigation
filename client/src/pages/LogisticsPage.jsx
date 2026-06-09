import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import POTable from '../components/ui/POTable'
import PODetailPanel from '../components/ui/PODetailPanel'
import POFilterBar from '../components/ui/POFilterBar'
import ExportModal from '../components/ui/ExportModal'
import { emptyPOFilters, applyPOFilters } from '../utils/poFilters'

export default function LogisticsPage() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState(emptyPOFilters())
  const [selectedPO, setSelectedPO] = useState(null)
  const [exportOpen, setExportOpen] = useState(false)

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

  const filtered = useMemo(() => applyPOFilters(orders, filters), [orders, filters])

  return (
    <div className="p-4 lg:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Logistics</h1>
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

      {exportOpen && (
        <ExportModal tab="Logistics" rows={filtered} onClose={() => setExportOpen(false)} />
      )}
    </div>
  )
}
