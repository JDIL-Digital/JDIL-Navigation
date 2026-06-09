import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import POTable from '../components/ui/POTable'
import PODetailPanel from '../components/ui/PODetailPanel'
import NewPOPanel from '../components/ui/NewPOPanel'
import POFilterBar from '../components/ui/POFilterBar'
import ExportModal from '../components/ui/ExportModal'
import { emptyPOFilters, applyPOFilters } from '../utils/poFilters'

export default function PurchaseOrders() {
  const { profile } = useAuth()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState(emptyPOFilters())
  const [selectedPO, setSelectedPO] = useState(null)
  const [newPOOpen, setNewPOOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

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

  const filtered = useMemo(() => applyPOFilters(orders, filters), [orders, filters])

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
