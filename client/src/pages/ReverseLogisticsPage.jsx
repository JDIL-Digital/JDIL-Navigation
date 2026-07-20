import { useEffect, useState, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { calcReverseLogisticsStatus, daysElapsed, formatDate } from '../utils/helpers'
import { PO_RIG_OPTIONS } from '../utils/constants'
import { RL_EXPORT_COLUMNS } from '../utils/rlExportColumns'
import { RLStatusPill, RLPipelineDots } from '../components/ui/StatusPill'
import VendorAutocomplete from '../components/ui/VendorAutocomplete'
import NewReverseLogisticsJobPanel from '../components/ui/NewReverseLogisticsJobPanel'
import ReverseLogisticsDetailPanel from '../components/ui/ReverseLogisticsDetailPanel'
import ExportModal from '../components/ui/ExportModal'

const TERMINAL = new Set(['Delivered to Vendor', 'Delivered to Rig'])

export default function ReverseLogisticsPage({ jobType }) {
  const { profile } = useAuth()
  const [searchParams] = useSearchParams()
  const [jobs, setJobs] = useState([])
  const [materialMap, setMaterialMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [rig, setRig] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [vendor, setVendor] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [quick, setQuick] = useState(null)   // 'open' | 'failed' | null
  const [selected, setSelected] = useState(null)
  const [newOpen, setNewOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

  useEffect(() => {
    const f = searchParams.get('filter')
    if (f === 'open' || f === 'failed') setQuick(f)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function load() {
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch(`/api/rl/jobs?type=${jobType}`, { headers: { Authorization: `Bearer ${session?.access_token}` } })
      const data = await resp.json()
      const list = Array.isArray(data) ? data : []
      setJobs(list)
      // First line-item name per job → "Material" column
      const ids = list.map(j => j.id)
      if (ids.length) {
        const { data: its } = await supabase
          .from('reverse_logistics_line_items').select('job_id, item_name').in('job_id', ids).order('created_at', { ascending: true })
        const m = {}
        ;(its || []).forEach(it => { if (!m[it.job_id]) m[it.job_id] = it.item_name })
        setMaterialMap(m)
      } else setMaterialMap({})
    } catch (e) { console.error('RL load error:', e) }
    setLoading(false)
  }
  useEffect(() => { load() }, [jobType])  // eslint-disable-line react-hooks/exhaustive-deps

  const withStatus = useMemo(() => jobs.map(j => ({ ...j, _status: calcReverseLogisticsStatus(j) })), [jobs])
  const statusOptions = useMemo(() => [...new Set(withStatus.map(j => j._status))].sort(), [withStatus])

  const filtered = useMemo(() => {
    let r = withStatus
    if (rig !== 'all') r = r.filter(j => j.rig_name === rig)
    if (statusFilter !== 'all') r = r.filter(j => j._status === statusFilter)
    if (quick === 'open') r = r.filter(j => !TERMINAL.has(j._status) && j._status !== 'Failed')
    if (quick === 'failed') r = r.filter(j => j._status === 'Failed')
    if (vendor.trim()) { const q = vendor.toLowerCase(); r = r.filter(j => (j.vendor_name || '').toLowerCase().includes(q)) }
    if (dateFrom || dateTo) {
      const from = dateFrom ? new Date(dateFrom + 'T00:00:00') : null
      const to = dateTo ? new Date(dateTo + 'T23:59:59') : null
      r = r.filter(j => { if (!j.rig_dispatch_date) return false; const d = new Date(j.rig_dispatch_date); if (from && d < from) return false; if (to && d > to) return false; return true })
    }
    if (search.trim()) { const q = search.toLowerCase(); r = r.filter(j => (j.job_number || '').toLowerCase().includes(q) || (j.rig_name || '').toLowerCase().includes(q) || (j.vendor_name || '').toLowerCase().includes(q)) }
    return r
  }, [withStatus, rig, statusFilter, quick, vendor, dateFrom, dateTo, search])

  const anyFilter = search || rig !== 'all' || statusFilter !== 'all' || vendor || dateFrom || dateTo || quick
  function clearFilters() { setSearch(''); setRig('all'); setStatusFilter('all'); setVendor(''); setDateFrom(''); setDateTo(''); setQuick(null) }

  const canCreate = profile?.role === 'rig' || profile?.role === 'admin'

  return (
    <div className="p-4 lg:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Reverse Logistics — {jobType}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{jobs.length} {jobType.toLowerCase()} jobs</p>
        </div>
        {canCreate && (
          <button onClick={() => setNewOpen(true)} className="btn-primary flex items-center gap-2 text-sm py-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            New Job
          </button>
        )}
      </div>

      {/* Filter bar */}
      <div className="card p-3 mb-3 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input className="input-field pl-9" placeholder="Search job #, rig, vendor…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button onClick={() => setExportOpen(true)} className="btn-secondary flex items-center justify-center gap-2 text-sm shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            Export to Excel
          </button>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <input type="date" className="input-field" value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="Dispatch from" />
          <span className="text-gray-400 text-sm self-center">to</span>
          <input type="date" className="input-field" value={dateTo} onChange={e => setDateTo(e.target.value)} title="Dispatch to" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <select className="input-field" value={rig} onChange={e => setRig(e.target.value)}>
            <option value="all">All Rigs</option>{PO_RIG_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select className="input-field" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">All Statuses</option>{statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <VendorAutocomplete value={vendor} onChange={setVendor} onSelect={v => setVendor(v.name)} placeholder="Filter by vendor…" />
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500 dark:text-gray-400">Showing <span className="font-semibold text-gray-700 dark:text-gray-300">{filtered.length}</span> of {jobs.length} jobs{quick ? ` · ${quick}` : ''}</p>
          {anyFilter && <button onClick={clearFilters} className="text-xs font-medium text-jdil-green hover:text-jdil-green-dark">Clear all filters</button>}
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16"><div className="w-8 h-8 border-4 border-jdil-green border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800">
                  <th className="table-header rounded-tl-lg">PO / MR</th>
                  <th className="table-header">Expected Return Date</th>
                  <th className="table-header hidden sm:table-cell">Vendor</th>
                  <th className="table-header hidden md:table-cell">Material</th>
                  <th className="table-header hidden lg:table-cell">Logistics Code</th>
                  <th className="table-header">Status</th>
                  <th className="table-header hidden lg:table-cell">Pipeline</th>
                  <th className="table-header">Days</th>
                  <th className="table-header rounded-tr-lg hidden sm:table-cell">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {filtered.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-12 text-sm text-gray-400">No {jobType.toLowerCase()} jobs found</td></tr>
                ) : filtered.map(j => (
                  <tr key={j.id} onClick={() => setSelected(j)} className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 ${j.is_stale ? 'bg-red-50/30 dark:bg-red-900/5' : ''}`}>
                    <td className="table-cell">
                      <p className="font-medium text-gray-900 dark:text-gray-100 text-xs">{j.po_number || j.job_number}</p>
                      <p className="text-gray-400 dark:text-gray-500 text-xs">{j.mr_number || ''}</p>
                    </td>
                    <td className="table-cell text-xs">{formatDate(j.expected_return_date)}</td>
                    <td className="table-cell hidden sm:table-cell"><span className="text-xs truncate max-w-[120px] block">{j.vendor_name || '—'}</span></td>
                    <td className="table-cell hidden md:table-cell"><span className="text-xs truncate max-w-[140px] block">{materialMap[j.id] || j.material_description_2 || '—'}</span></td>
                    <td className="table-cell text-xs hidden lg:table-cell">{j.jdil_in_logistics_code || '—'}</td>
                    <td className="table-cell"><RLStatusPill job={j} /></td>
                    <td className="table-cell hidden lg:table-cell"><RLPipelineDots job={j} /></td>
                    <td className="table-cell text-xs text-gray-600 dark:text-gray-400">{daysElapsed(j.created_at)}d</td>
                    <td className="table-cell text-xs text-gray-400 hidden sm:table-cell">{j.updated_at ? formatDate(j.updated_at.split('T')[0]) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <ReverseLogisticsDetailPanel job={selected} onClose={() => setSelected(null)} onSave={() => { load(); setSelected(null) }} />
      )}
      {newOpen && (
        <NewReverseLogisticsJobPanel jobType={jobType} onClose={() => setNewOpen(false)} onCreated={load} />
      )}
      {exportOpen && (
        <ExportModal tab={jobType} rows={filtered} columns={RL_EXPORT_COLUMNS} onClose={() => setExportOpen(false)} />
      )}
    </div>
  )
}
