import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { fetchAllRows } from '../utils/supabaseHelpers'
import { useAuth } from '../context/AuthContext'
import { calcStatus, calcReverseLogisticsStatus } from '../utils/helpers'
import { PO_RIG_OPTIONS, OVERDUE_DAYS, LOGISTICS_LOCATION_GROUPS } from '../utils/constants'
import KPICard from '../components/ui/KPICard'
import JDILLogo from '../components/ui/JDILLogo'
import ReportsDropdown from '../components/ui/ReportsDropdown'
import DashboardDrilldown from '../components/ui/DashboardDrilldown'
import PODetailPanel from '../components/ui/PODetailPanel'

// Stacked-bar segment colours for the Performance-by-Rig chart.
const PERF_COLORS = { pending: '#F59E0B', done: '#10B981', overdue: '#EF4444' }

// Base rigs — DD variants are grouped under their base for the chart.
const RIG_BASES = [
  'Discovery 1', 'Virtue 1', 'Jindal Star', 'Jindal Explorer',
  'Jindal Pioneer', 'Jindal Supreme', 'Directional Drilling', 'MLU',
]

const notDelivered = o => calcStatus(o) !== 'Delivered to Rig'

// ── SVG icons ──────────────────────────────────────────────────────────────────
const IconDoc = <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
const IconClock = <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
const IconWarning = <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
const IconAlert = <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
const IconPackage = <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
const IconRepair = <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
const IconReturn = <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
const IconReplace = <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
const IconFailed = <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 5a7 7 0 100 14 7 7 0 000-14z" /></svg>

// Horizontal stacked bar — one row per rig/hub, scaled to the longest total so
// lengths are comparable. Segments: Completed (green) / Pending (yellow) / Overdue (red).
function pctOf(v, max) { return max > 0 ? `${(v / max) * 100}%` : '0%' }

function HBar({ data }) {
  if (!data.some(d => d.total > 0)) {
    return <div className="flex items-center justify-center h-[220px] text-gray-400 text-sm">No line-item data</div>
  }
  const max = Math.max(1, ...data.map(d => d.total))
  return (
    <div className="space-y-4 pt-1">
      {data.map(d => (
        <div key={d.name}>
          <div className="flex items-center justify-between text-xs mb-1 gap-2">
            <span className="font-medium text-gray-700 dark:text-gray-300 truncate">{d.name}</span>
            <span className="text-gray-500 dark:text-gray-400 shrink-0">
              {d.total} total
              {d.overdue > 0 && <> · <span className="text-red-600 dark:text-red-400 font-semibold">{d.overdue} Overdue</span></>}
            </span>
          </div>
          <div
            className="flex h-3.5 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-800"
            style={{ width: pctOf(d.total, max), minWidth: d.total > 0 ? 6 : 0 }}
          >
            <div style={{ width: pctOf(d.delivered, d.total), background: PERF_COLORS.done }} />
            <div style={{ width: pctOf(d.pending, d.total), background: PERF_COLORS.pending }} />
            <div style={{ width: pctOf(d.overdue, d.total), background: PERF_COLORS.overdue }} />
          </div>
          <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
            {d.total} total ({d.pending} Pending · {d.delivered} Completed · {d.overdue} Overdue)
          </div>
        </div>
      ))}
    </div>
  )
}

function PerfLegend() {
  const items = [['Completed', PERF_COLORS.done], ['Pending', PERF_COLORS.pending], ['Overdue', PERF_COLORS.overdue]]
  return (
    <div className="flex items-center justify-center gap-4 mt-4 flex-wrap">
      {items.map(([label, color]) => (
        <span key={label} className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: color }} />
          {label}
        </span>
      ))}
    </div>
  )
}

// ── Forward-logistics pill ─────────────────────────────────────────────────────
const PILL_STYLES = {
  blue:  'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-900/40',
  amber: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900/40',
  orange:'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-900/40',
  green: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border-green-200 dark:border-green-900/40',
  grey:  'bg-gray-100 dark:bg-gray-800/40 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700',
}

function LogisticsPill({ label, count, color, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 min-w-[130px] rounded-xl border px-3 py-2.5 text-left transition-all hover:shadow-sm ${PILL_STYLES[color]} ${active ? 'ring-2 ring-jdil-green/60' : ''}`}
    >
      <span className="block text-xl font-bold leading-none">{count}</span>
      <span className="block text-xs font-medium mt-1 opacity-90">{label}</span>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [orders, setOrders]       = useState([])
  const [lineItems, setLineItems] = useState([])
  const [rlJobs, setRlJobs]       = useState([])
  const [loading, setLoading]     = useState(true)
  const [rigFilter, setRigFilter] = useState('all')
  const [activeDrill, setActiveDrill] = useState(null) // { group, key, title, predicate }
  const [selectedPO, setSelectedPO] = useState(null)

  // ── Fetch ────────────────────────────────────────────────────────────────
  async function load() {
    setLoading(true)
    let q = supabase.from('po_orders').select('*').order('updated_at', { ascending: false })
    if (profile?.role === 'rig' && profile?.rig_name) q = q.eq('rig_name', profile.rig_name)
    const itemsQuery = supabase.from('po_line_items').select('id, po_id, quantity_ordered, quantity_delivered, quantity_pending')
    let data = [], items = []
    try {
      [data, items] = await Promise.all([fetchAllRows(q), fetchAllRows(itemsQuery)])
    } catch (err) {
      console.error('Dashboard fetch error:', err)
    }
    setOrders(data || [])
    setLineItems(items || [])
    // Reverse-logistics jobs via the server (respects rig scoping).
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch('/api/rl/jobs', { headers: { Authorization: `Bearer ${session?.access_token}` } })
      if (resp.ok) setRlJobs(await resp.json())
    } catch (e) { console.warn('Dashboard RL fetch failed:', e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [profile])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Rig-scoped dataset ──────────────────────────────────────────────────────
  const filtered = useMemo(
    () => (rigFilter === 'all' ? orders : orders.filter(o => o.rig_name === rigFilter)),
    [orders, rigFilter]
  )

  // Date thresholds (local midnight).
  const { today, cutoff45 } = useMemo(() => {
    const t = new Date(); t.setHours(0, 0, 0, 0)
    const c = new Date(t); c.setDate(c.getDate() - OVERDUE_DAYS)
    return { today: t, cutoff45: c }
  }, [])

  // ── Line-item scoping for "Items Pending Delivery" ──────────────────────────
  const { itemsPendingCount, pendingPoIds } = useMemo(() => {
    const poIds = new Set(filtered.map(o => o.id))
    const pending = lineItems.filter(li => poIds.has(li.po_id) && Number(li.quantity_pending) > 0)
    return { itemsPendingCount: pending.length, pendingPoIds: new Set(pending.map(li => li.po_id)) }
  }, [lineItems, filtered])

  // ── KPI definitions (match the business SQL) ────────────────────────────────
  const kpi = useMemo(() => ({
    total:   filtered.length,
    open:    filtered.filter(notDelivered).length,
    stale:   filtered.filter(o => o.promised_ready_date && new Date(o.promised_ready_date) < today && notDelivered(o)).length,
    delayed: filtered.filter(o => o.po_date && new Date(o.po_date) < cutoff45 && notDelivered(o)).length,
    items:   itemsPendingCount,
  }), [filtered, today, cutoff45, itemsPendingCount])

  // ── Forward logistics counts (by pipeline stage) ────────────────────────────
  const fl = useMemo(() => {
    const by = s => filtered.filter(o => calcStatus(o) === s).length
    const inSet = set => filtered.filter(o => set.includes(calcStatus(o))).length
    return {
      released:  by('PO Released'),
      atJdil:    by('At JDIL Location'),
      transit:   inSet(['Dispatched from JDIL', 'In Transit to JDIL']),
      delivered: by('Delivered to Rig'),
      other:     inSet(['Vendor Confirmed', 'Pending Approval', 'Buyer Assigned']),
    }
  }, [filtered])

  // ── MR → Rig material pipeline (partitions all POs into 4 stages) ───────────
  const pipeline = useMemo(() => {
    const inSet = set => filtered.filter(o => set.includes(calcStatus(o))).length
    const stages = [
      { label: 'MR Approved',       count: filtered.filter(o => calcStatus(o) === 'MR Created').length },
      { label: 'PO Issued',         count: inSet(['PO Released', 'Buyer Assigned', 'Vendor Confirmed']) },
      { label: 'At Factory / Transit', count: inSet(['At JDIL Location', 'Dispatched from JDIL', 'In Transit to JDIL', 'In Transit to Rig']) },
      { label: 'Delivered to Rig',  count: filtered.filter(o => calcStatus(o) === 'Delivered to Rig').length },
    ]
    const max = Math.max(1, ...stages.map(s => s.count))
    return stages.map(s => ({ ...s, pct: Math.round((s.count / max) * 100) }))
  }, [filtered])

  // Classify one PO into delivered / overdue / pending (partitions the total).
  const bucketOf = o => {
    if (calcStatus(o) === 'Delivered to Rig') return 'delivered'
    if (o.po_date && new Date(o.po_date) < cutoff45) return 'overdue'
    return 'pending'
  }

  // ── Performance of Logistics — PO COUNTS by hub (via logistics_team_code) ─────
  // No office_location column exists; hubs are derived from the team code using
  // LOGISTICS_LOCATION_GROUPS → BKC / Taloja / Nhava-Pipavav / Nagothane.
  const logisticsPerf = useMemo(() => {
    const codeToHub = {}
    Object.entries(LOGISTICS_LOCATION_GROUPS).forEach(([hub, codes]) => codes.forEach(c => { codeToHub[c] = hub }))
    const hubs = Object.keys(LOGISTICS_LOCATION_GROUPS)
    const acc = Object.fromEntries(hubs.map(h => [h, { delivered: 0, pending: 0, overdue: 0 }]))
    filtered.forEach(o => {
      const hub = codeToHub[o.logistics_team_code]
      if (!hub) return
      acc[hub][bucketOf(o)]++
    })
    return hubs.map(h => ({ name: h, ...acc[h], total: acc[h].delivered + acc[h].pending + acc[h].overdue }))
  }, [filtered, cutoff45])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Performance by Rig — PO COUNTS (delivered / pending / overdue) ────────────
  const rigPerf = useMemo(() => {
    const acc = Object.fromEntries(RIG_BASES.map(b => [b, { delivered: 0, pending: 0, overdue: 0 }]))
    filtered.forEach(o => {
      const rig = (o.rig_name || '').toLowerCase()
      const base = RIG_BASES.find(b => rig.startsWith(b.toLowerCase()))
      if (!base) return
      acc[base][bucketOf(o)]++
    })
    return RIG_BASES.map(b => ({ name: b, ...acc[b], total: acc[b].delivered + acc[b].pending + acc[b].overdue }))
      .filter(r => r.total > 0)
  }, [filtered, cutoff45])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reverse-logistics KPI counts (open per type + failed) ────────────────────
  const rlStats = useMemo(() => {
    const TERMINAL = new Set(['Delivered to Rig', 'Delivered to Vendor', 'Failed'])
    const openOf = t => rlJobs.filter(j => j.job_type === t && !TERMINAL.has(calcReverseLogisticsStatus(j))).length
    return {
      repair:      openOf('Repair'),
      ret:         openOf('Return'),
      replacement: openOf('Replacement'),
      failed:      rlJobs.filter(j => calcReverseLogisticsStatus(j) === 'Failed').length,
    }
  }, [rlJobs])

  // ── Drill-down helpers ──────────────────────────────────────────────────────
  function toggleDrill(group, key, title, predicate) {
    setActiveDrill(prev => (prev && prev.group === group && prev.key === key ? null : { group, key, title, predicate }))
  }
  const drillOrders = useMemo(
    () => (activeDrill ? filtered.filter(activeDrill.predicate) : []),
    [activeDrill, filtered]
  )
  const drillPanel = (group) => (
    activeDrill && activeDrill.group === group ? (
      <DashboardDrilldown
        title={activeDrill.title}
        orders={drillOrders}
        onRowClick={setSelectedPO}
        onClose={() => setActiveDrill(null)}
      />
    ) : null
  )

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-jdil-green border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-4 lg:p-6 space-y-6">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <JDILLogo size="sm" />
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 leading-tight">Dashboard</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Material Tracking</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {profile?.role !== 'rig' && (
            <select value={rigFilter} onChange={e => setRigFilter(e.target.value)} className="input-field w-48">
              <option value="all">All Rigs</option>
              {PO_RIG_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          )}
          <button
            onClick={load}
            className="btn-secondary p-2"
            title="Refresh"
            aria-label="Refresh dashboard"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <ReportsDropdown />
        </div>
      </div>

      {/* ── 5 KPI cards (clickable → inline list) ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <KPICard
          title="Total POs" value={kpi.total} sub="all purchase orders" color="blue" icon={IconDoc}
          onClick={() => toggleDrill('kpi', 'total', 'Total POs', () => true)}
        />
        <KPICard
          title="Open POs" value={kpi.open} sub="not yet delivered" color="purple" icon={IconClock}
          onClick={() => toggleDrill('kpi', 'open', 'Open POs', notDelivered)}
        />
        <KPICard
          title="Stale POs" value={kpi.stale} sub="past promised ready date" color="orange" icon={IconWarning}
          onClick={() => toggleDrill('kpi', 'stale', 'Stale POs', o => o.promised_ready_date && new Date(o.promised_ready_date) < today && notDelivered(o))}
        />
        <KPICard
          title="Delayed Deliveries" value={kpi.delayed} sub="PO date >45 days, undelivered" color="red" icon={IconAlert}
          onClick={() => toggleDrill('kpi', 'delayed', 'Delayed Deliveries', o => o.po_date && new Date(o.po_date) < cutoff45 && notDelivered(o))}
        />
        <KPICard
          title="Items Pending Delivery" value={kpi.items} sub="line items not fully delivered" color="orange" icon={IconPackage}
          onClick={() => toggleDrill('kpi', 'items', 'POs with Items Pending Delivery', o => pendingPoIds.has(o.id))}
        />
      </div>

      {/* Inline drill-down for a KPI card */}
      {drillPanel('kpi')}

      {/* ── Forward Logistics ── */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Forward Logistics</h2>
        <div className="flex flex-wrap gap-2">
          <LogisticsPill label="PO Released" count={fl.released} color="blue"
            active={activeDrill?.key === 'fl-released'}
            onClick={() => toggleDrill('logistics', 'fl-released', 'PO Released', o => calcStatus(o) === 'PO Released')} />
          <LogisticsPill label="At JDIL Location" count={fl.atJdil} color="amber"
            active={activeDrill?.key === 'fl-atjdil'}
            onClick={() => toggleDrill('logistics', 'fl-atjdil', 'At JDIL Location', o => calcStatus(o) === 'At JDIL Location')} />
          <LogisticsPill label="In Transit" count={fl.transit} color="orange"
            active={activeDrill?.key === 'fl-transit'}
            onClick={() => toggleDrill('logistics', 'fl-transit', 'In Transit', o => ['Dispatched from JDIL', 'In Transit to JDIL'].includes(calcStatus(o)))} />
          <LogisticsPill label="Delivered to Rig" count={fl.delivered} color="green"
            active={activeDrill?.key === 'fl-delivered'}
            onClick={() => toggleDrill('logistics', 'fl-delivered', 'Delivered to Rig', o => calcStatus(o) === 'Delivered to Rig')} />
          <LogisticsPill label="Other (VC+PA+BA)" count={fl.other} color="grey"
            active={activeDrill?.key === 'fl-other'}
            onClick={() => toggleDrill('logistics', 'fl-other', 'Other (Vendor Confirmed / Pending Approval / Buyer Assigned)', o => ['Vendor Confirmed', 'Pending Approval', 'Buyer Assigned'].includes(calcStatus(o)))} />
        </div>
      </div>

      {/* Inline drill-down for a logistics pill */}
      {drillPanel('logistics')}

      {/* ── Reverse Logistics ── */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Reverse Logistics</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPICard title="Open Repair Jobs" value={rlStats.repair} sub="in progress" color="blue"
            icon={IconRepair} onClick={() => navigate('/repair?filter=open')} />
          <KPICard title="Open Return Jobs" value={rlStats.ret} sub="in progress" color="teal"
            icon={IconReturn} onClick={() => navigate('/return?filter=open')} />
          <KPICard title="Open Replacement Jobs" value={rlStats.replacement} sub="in progress" color="purple"
            icon={IconReplace} onClick={() => navigate('/replacement?filter=open')} />
          <KPICard title="Failed Jobs" value={rlStats.failed} sub="all reverse logistics" color="red"
            icon={IconFailed} onClick={() => navigate('/reverse-logistics?filter=failed')} />
        </div>
      </div>

      {/* ── MR → Rig Material Pipeline ── */}
      <div className="card p-4">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">MR → Rig Material Pipeline</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {pipeline.map((s, i) => (
            <div key={s.label} className="relative">
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{i + 1}. {s.label}</span>
                <span className="text-lg font-bold text-gray-900 dark:text-gray-100">{s.count}</span>
              </div>
              <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                <div className="h-full rounded-full bg-jdil-green transition-all" style={{ width: `${s.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Performance charts (horizontal, side by side) ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Performance of Logistics</h3>
          <HBar data={logisticsPerf} />
          <PerfLegend />
        </div>
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Performance by Rig</h3>
          <HBar data={rigPerf} />
          <PerfLegend />
        </div>
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
