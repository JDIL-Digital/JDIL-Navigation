import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, PieChart, Pie, Legend, LabelList,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { fetchAllRows } from '../utils/supabaseHelpers'
import { useAuth } from '../context/AuthContext'
import { calcStatus, daysElapsed, overdueDays, isPurchaseStale, isDeliveryStale } from '../utils/helpers'
import { PO_RIG_OPTIONS, OVERDUE_DAYS, LOGISTICS_LOCATION_GROUPS, PURCHASE_STAGES, LOGISTICS_STAGES } from '../utils/constants'
import KPICard from '../components/ui/KPICard'
import MaterialMap from '../components/ui/MaterialMap'
import ReportsDropdown from '../components/ui/ReportsDropdown'
import { useTheme } from '../context/ThemeContext'

// Stacked-bar segment colours (shared by both performance charts)
const PERF_COLORS = { pending: '#F59E0B', done: '#10B981', overdue: '#EF4444' }

// Tooltip: "SV-01: 45 total | 5 pending | 38 completed | 2 overdue"
function PerfTooltip({ active, payload, doneKey, doneLabel, dark }) {
  if (!active || !payload || !payload.length) return null
  const d = payload[0].payload
  return (
    <div style={{
      fontSize: 12, borderRadius: 8, padding: '8px 10px',
      border: `1px solid ${dark ? '#374151' : '#e5e7eb'}`,
      background: dark ? '#1f2937' : '#ffffff', color: dark ? '#f3f4f6' : '#111827',
    }}>
      <span style={{ fontWeight: 600 }}>{d.name}: {d.total} total</span>
      {' | '}{d.pending} pending{' | '}{d[doneKey]} {doneLabel}
      {' | '}<span style={{ color: '#EF4444' }}>{d.overdue} overdue</span>
      {Array.isArray(d.perCode) && d.perCode.length > 0 && (
        <div style={{ marginTop: 4, opacity: 0.85 }}>
          {d.perCode.map(c => `${c.code}: ${c.pending + c.completed + c.overdue} (${c.pending}P/${c.completed}D/${c.overdue}O)`).join(', ')}
        </div>
      )}
    </div>
  )
}

// Static legend rendered BELOW the chart (avoids overlap with X-axis labels).
function PerfLegend({ doneLabel }) {
  const items = [['Pending', PERF_COLORS.pending], [doneLabel, PERF_COLORS.done], ['Overdue', PERF_COLORS.overdue]]
  return (
    <div className="flex items-center justify-center gap-4 mt-2 flex-wrap">
      {items.map(([label, color]) => (
        <span key={label} className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: color }} />
          {label}
        </span>
      ))}
    </div>
  )
}

// ─── Donut status colours ─────────────────────────────────────────────────────
const STATUS_COLORS = {
  'Delivered':    '#16a34a',
  'In Transit':   '#3b82f6',
  'At JDIL':      '#f97316',
  'Ready@Vendor': '#eab308',
  'Stale/Overdue':'#ef4444',
  'Other':        '#9ca3af',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function daysBetween(d1, d2) {
  if (!d1 || !d2) return 0
  return Math.max(0, Math.floor((new Date(d2) - new Date(d1)) / 86400000))
}

// ─── Score colour ─────────────────────────────────────────────────────────────
function scoreColor(pct, variant = 'text') {
  if (pct === null || pct === undefined) return variant === 'text' ? 'text-gray-400' : 'bg-gray-300'
  if (pct >= 80) return variant === 'text' ? 'text-green-600 dark:text-green-400'  : 'bg-jdil-green'
  if (pct >= 60) return variant === 'text' ? 'text-yellow-600 dark:text-yellow-400' : 'bg-yellow-500'
  return variant === 'text' ? 'text-red-600 dark:text-red-400' : 'bg-red-500'
}

// ─────────────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { profile } = useAuth()
  const { dark } = useTheme()
  const navigate = useNavigate()
  const [orders, setOrders]       = useState([])
  const [lineItems, setLineItems] = useState([])
  const [rlJobs, setRlJobs]       = useState([])
  const [loading, setLoading]     = useState(true)
  const [rigFilter, setRigFilter] = useState('all')

  // Navigate to the Purchase Orders page with a quick-filter + current rig pre-applied.
  function goToPurchase(filterKey) {
    const params = new URLSearchParams()
    if (filterKey) params.set('filter', filterKey)
    if (rigFilter && rigFilter !== 'all') params.set('rig', rigFilter)
    const qs = params.toString()
    navigate(`/purchase${qs ? `?${qs}` : ''}`)
  }

  // ── Fetch ────────────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      let q = supabase.from('po_orders').select('*').order('updated_at', { ascending: false })
      if (profile?.role === 'rig' && profile?.rig_name) {
        q = q.eq('rig_name', profile.rig_name)
      }
      const itemsQuery = supabase.from('po_line_items').select('id, po_id, quantity_ordered, quantity_delivered, item_status')
      let data = [], items = []
      try {
        [data, items] = await Promise.all([fetchAllRows(q), fetchAllRows(itemsQuery)])
      } catch (err) {
        console.error('Dashboard fetch error:', err)
      }
      setOrders(data || [])
      setLineItems(items || [])
      // Reverse logistics jobs (via server — respects rig scoping)
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const resp = await fetch('/api/rl/jobs', { headers: { Authorization: `Bearer ${session?.access_token}` } })
        if (resp.ok) setRlJobs(await resp.json())
      } catch (e) { console.warn('Dashboard RL fetch failed:', e) }
      setLoading(false)
    }
    load()
  }, [profile])

  // ── Reverse logistics KPI counts ──────────────────────────────────────────
  const rlStats = useMemo(() => {
    const openOf = t => rlJobs.filter(j =>
      j.job_type === t &&
      j.status !== 'Failed' &&
      j.status !== 'Delivered to Rig' &&
      j.status !== 'Delivered to Vendor'
    ).length
    return {
      repair:      openOf('Repair'),
      ret:         openOf('Return'),
      replacement: openOf('Replacement'),
      failed:      rlJobs.filter(j => j.status === 'Failed').length,
    }
  }, [rlJobs])

  // ── Filtered dataset ──────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (rigFilter === 'all') return orders
    return orders.filter(o => o.rig_name === rigFilter)
  }, [orders, rigFilter])

  const openPOs = useMemo(
    () => filtered.filter(o => calcStatus(o) !== 'Delivered to Rig'),
    [filtered]
  )
  const deliveredPOs = useMemo(
    () => filtered.filter(o => !!o.delivered_to_rig_date),
    [filtered]
  )

  // ── Line item stats (scoped to the filtered POs) ──────────────────────────
  const itemStats = useMemo(() => {
    const ids   = new Set(filtered.map(o => o.id))
    const items = lineItems.filter(it => ids.has(it.po_id))
    const pending = items.filter(it => it.item_status !== 'Fully Delivered').length
    return { pending }
  }, [lineItems, filtered])

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    // 1. On-time delivery %
    const onTime = deliveredPOs.filter(
      o => o.promised_ready_date &&
           new Date(o.delivered_to_rig_date) <= new Date(o.promised_ready_date)
    )
    const onTimePct = deliveredPOs.length
      ? Math.round((onTime.length / deliveredPOs.length) * 100)
      : null

    // 2. Avg cycle time (po_date → delivered_to_rig_date)
    const cycleTimes = deliveredPOs
      .filter(o => o.po_date)
      .map(o => daysBetween(o.po_date, o.delivered_to_rig_date))
      .filter(d => d > 0)
    const avgCycle = cycleTimes.length
      ? Math.round(cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length)
      : null

    // 3. Open POs
    const openCount = openPOs.length

    // 4. Stale POs — overdue AND still in a purchase-owned stage
    const staleCount     = filtered.filter(o => isPurchaseStale(o, OVERDUE_DAYS)).length
    // 4b. Delayed deliveries — overdue AND stuck in a logistics-owned stage
    const delayedCount   = filtered.filter(o => isDeliveryStale(o, OVERDUE_DAYS)).length

    // 5. Vendor score — average of per-vendor on-time %
    const vendorMap = {}
    deliveredPOs.forEach(o => {
      if (!o.vendor_name) return
      if (!vendorMap[o.vendor_name]) vendorMap[o.vendor_name] = { total: 0, onTime: 0 }
      vendorMap[o.vendor_name].total++
      if (o.promised_ready_date && new Date(o.delivered_to_rig_date) <= new Date(o.promised_ready_date))
        vendorMap[o.vendor_name].onTime++
    })
    const vendorScores = Object.values(vendorMap)
      .filter(v => v.total > 0)
      .map(v => (v.onTime / v.total) * 100)
    const avgVendorScore = vendorScores.length
      ? Math.round(vendorScores.reduce((a, b) => a + b, 0) / vendorScores.length)
      : null

    return { onTimePct, avgCycle, openCount, staleCount, delayedCount, avgVendorScore }
  }, [filtered, openPOs, deliveredPOs])

  // ── Performance of Logistics (grouped by location) ────────────────────────
  const logisticsPerf = useMemo(() => {
    const PENDING = new Set(['At JDIL Location', 'Vendor Confirmed', 'PO Released', 'Buyer Assigned', 'MR Created'])
    const countsFor = code => {
      const mine = orders.filter(o => o.logistics_team_code === code)
      const completed = mine.filter(o => o.dispatch_date).length
      const pendingList = mine.filter(o => !o.dispatch_date && PENDING.has(calcStatus(o)))
      const overdue = pendingList.filter(o => overdueDays(o) > OVERDUE_DAYS).length
      return { code, pending: pendingList.length - overdue, completed, overdue }
    }
    return Object.entries(LOGISTICS_LOCATION_GROUPS).map(([label, codes]) => {
      const perCode = codes.map(countsFor)
      const pending   = perCode.reduce((s, c) => s + c.pending, 0)
      const completed = perCode.reduce((s, c) => s + c.completed, 0)
      const overdue   = perCode.reduce((s, c) => s + c.overdue, 0)
      return { name: label, pending, completed, overdue, total: pending + completed + overdue, perCode }
    })
  }, [orders])

  // ── Performance of Rig (DD variants grouped under base rig) ────────────────
  const RIG_BASES = ['Discovery 1', 'Virtue 1', 'Jindal Star', 'Jindal Explorer', 'Jindal Pioneer', 'Jindal Supreme', 'Directional Drilling', 'MLU']
  const rigPerf = useMemo(() => {
    const PENDING = new Set(['In Transit to Rig', 'In Transit to JDIL', 'Dispatched from JDIL', 'At JDIL Location'])
    return RIG_BASES.map(base => {
      const b = base.toLowerCase()
      const mine = orders.filter(o => (o.rig_name || '').toLowerCase().startsWith(b))
      const delivered = mine.filter(o => o.delivered_to_rig_date).length
      const pendingList = mine.filter(o => !o.delivered_to_rig_date && PENDING.has(calcStatus(o)))
      const overdue = pendingList.filter(o => overdueDays(o) > OVERDUE_DAYS).length
      const pending = pendingList.length - overdue
      return { name: base, pending, delivered, overdue, total: pending + delivered + overdue }
    })
  }, [orders])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── 12-week PO creation trend ─────────────────────────────────────────────
  const weeklyTrend = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const end   = new Date()
      end.setDate(end.getDate() - (11 - i) * 7)
      const start = new Date(end)
      start.setDate(start.getDate() - 6)
      return {
        week:  `${end.getDate()}/${end.getMonth() + 1}`,
        count: filtered.filter(o => {
          const d = new Date(o.po_date)
          return !isNaN(d) && d >= start && d <= end
        }).length,
      }
    })
  }, [filtered])

  // ── Status distribution (donut) ───────────────────────────────────────────
  const statusDist = useMemo(() => {
    const delivered    = filtered.filter(o => calcStatus(o) === 'Delivered to Rig').length
    const stale        = openPOs.filter(o => isPurchaseStale(o, OVERDUE_DAYS)).length
    const nonStale     = openPOs.filter(o => !isPurchaseStale(o, OVERDUE_DAYS))
    const inTransit    = nonStale.filter(o => ['In Transit to Rig','In Transit to JDIL'].includes(calcStatus(o))).length
    const atJDIL       = nonStale.filter(o => calcStatus(o) === 'At JDIL Location').length
    const readyVendor  = nonStale.filter(o => calcStatus(o) === 'Material Ready at Vendor').length
    const other        = Math.max(0, nonStale.length - inTransit - atJDIL - readyVendor)
    return [
      { name: 'Delivered',     value: delivered,   fill: STATUS_COLORS['Delivered']    },
      { name: 'In Transit',    value: inTransit,   fill: STATUS_COLORS['In Transit']   },
      { name: 'At JDIL',       value: atJDIL,      fill: STATUS_COLORS['At JDIL']      },
      { name: 'Ready@Vendor',  value: readyVendor, fill: STATUS_COLORS['Ready@Vendor'] },
      { name: 'Stale/Overdue', value: stale,       fill: STATUS_COLORS['Stale/Overdue']},
      { name: 'Other',         value: other,       fill: STATUS_COLORS['Other']        },
    ].filter(d => d.value > 0)
  }, [filtered, openPOs])

  // ── Top 10 stale POs ─────────────────────────────────────────────────────
  const stalePOList = useMemo(() =>
    openPOs
      .filter(o => isPurchaseStale(o, OVERDUE_DAYS))
      .sort((a, b) => overdueDays(b) - overdueDays(a))
      .slice(0, 10),
    [openPOs]
  )

  // ── Vendor performance ────────────────────────────────────────────────────
  const vendorPerf = useMemo(() => {
    const vm = {}
    filtered.forEach(o => {
      if (!o.vendor_name) return
      if (!vm[o.vendor_name]) vm[o.vendor_name] = { total: 0, onTime: 0, leadDays: [] }
      vm[o.vendor_name].total++
      if (o.delivered_to_rig_date) {
        if (o.promised_ready_date && new Date(o.delivered_to_rig_date) <= new Date(o.promised_ready_date))
          vm[o.vendor_name].onTime++
        if (o.po_date) {
          const d = daysBetween(o.po_date, o.delivered_to_rig_date)
          if (d > 0) vm[o.vendor_name].leadDays.push(d)
        }
      }
    })
    return Object.entries(vm)
      .map(([name, v]) => {
        const deliv     = v.leadDays.length
        const onTimePct = deliv > 0 ? Math.round((v.onTime / deliv) * 100) : null
        const avgLead   = deliv > 0
          ? Math.round(v.leadDays.reduce((a, b) => a + b, 0) / deliv)
          : null
        return { name, onTimePct, avgLead, total: v.total, delivered: deliv }
      })
      .sort((a, b) => (b.onTimePct ?? -1) - (a.onTimePct ?? -1))
  }, [filtered])

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-jdil-green border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const fmt = v => v !== null && v !== undefined ? v : '—'

  return (
    <div className="p-4 lg:p-6 space-y-6">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Dashboard</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Material Tracking Overview
            {rigFilter !== 'all' && (
              <span className="ml-2 text-jdil-green font-medium">· {rigFilter}</span>
            )}
            <span className="ml-2">· {filtered.length} total POs</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          {profile?.role !== 'rig' && (
            <select
              value={rigFilter}
              onChange={e => setRigFilter(e.target.value)}
              className="input-field w-52"
            >
              <option value="all">All Rigs</option>
              {PO_RIG_OPTIONS.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          )}
          <ReportsDropdown />
        </div>
      </div>

      {/* ── KPI Row — clickable, deep-links into /purchase with a filter ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-3 gap-3">
        <KPICard
          title="On-Time Delivery"
          value={kpis.onTimePct !== null ? `${kpis.onTimePct}%` : '—'}
          sub={`${deliveredPOs.length} delivered POs`}
          color="green"
          onClick={() => goToPurchase('on-time-delivered')}
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
        />
        <KPICard
          title="Avg Cycle Time"
          value={kpis.avgCycle !== null ? `${kpis.avgCycle}d` : '—'}
          sub="PO date → delivery"
          color="blue"
          onClick={() => goToPurchase('delivered')}
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
        />
        <KPICard
          title="Open POs"
          value={kpis.openCount}
          sub="not yet delivered"
          color="purple"
          onClick={() => goToPurchase('open')}
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>}
        />
        <KPICard
          title="Stale POs"
          value={kpis.staleCount}
          sub="past promised ready date"
          color="red"
          onClick={() => goToPurchase('stale')}
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>}
        />
        <KPICard
          title="Delayed Deliveries"
          value={kpis.delayedCount}
          sub="awaiting delivery to rig"
          color="red"
          onClick={() => goToPurchase('delayed-delivery')}
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>}
        />
        <KPICard
          title="Vendor Score"
          value={kpis.avgVendorScore !== null ? `${kpis.avgVendorScore}%` : '—'}
          sub="avg on-time % per vendor"
          color="teal"
          onClick={() => goToPurchase(null)}
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>}
        />
        <KPICard
          title="Items Pending Delivery"
          value={itemStats.pending}
          sub="not fully delivered"
          color="orange"
          onClick={() => goToPurchase('items-pending')}
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>}
        />
      </div>

      {/* ── Reverse Logistics KPI Row ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard
          title="Open Repair Jobs"
          value={rlStats.repair}
          sub="in progress"
          color="blue"
          onClick={() => navigate('/repair?filter=open')}
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /></svg>}
        />
        <KPICard
          title="Open Return Jobs"
          value={rlStats.ret}
          sub="in progress"
          color="teal"
          onClick={() => navigate('/return?filter=open')}
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>}
        />
        <KPICard
          title="Open Replacement Jobs"
          value={rlStats.replacement}
          sub="in progress"
          color="purple"
          onClick={() => navigate('/replacement?filter=open')}
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>}
        />
        <KPICard
          title="Failed Jobs"
          value={rlStats.failed}
          sub="all reverse logistics"
          color="red"
          onClick={() => navigate('/reverse-logistics?filter=failed')}
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 5a7 7 0 100 14 7 7 0 000-14z" /></svg>}
        />
      </div>

      {/* ── Charts Row ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

        {/* Performance of Logistics */}
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
            Performance of Logistics
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={logisticsPerf} margin={{ top: 18, right: 4, left: -20, bottom: 30 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={dark ? '#374151' : '#e5e7eb'} />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: dark ? '#6b7280' : '#9ca3af' }} angle={-45} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 11, fill: dark ? '#6b7280' : '#9ca3af' }} allowDecimals={false} />
              <Tooltip cursor={{ fill: 'rgba(148,163,184,0.08)' }} content={props => <PerfTooltip {...props} doneKey="completed" doneLabel="completed" dark={dark} />} />
              <Bar dataKey="pending"   stackId="a" name="Pending"   fill={PERF_COLORS.pending} />
              <Bar dataKey="completed" stackId="a" name="Completed" fill={PERF_COLORS.done} />
              <Bar dataKey="overdue"   stackId="a" name="Overdue"   fill={PERF_COLORS.overdue} radius={[4, 4, 0, 0]}>
                <LabelList dataKey="total" position="top" style={{ fontSize: 10, fontWeight: 600, fill: dark ? '#9ca3af' : '#6b7280' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <PerfLegend doneLabel="Completed" />
        </div>

        {/* Performance of Rig */}
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
            Performance of Rig
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={rigPerf} margin={{ top: 18, right: 4, left: -20, bottom: 78 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={dark ? '#374151' : '#e5e7eb'} />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: dark ? '#6b7280' : '#9ca3af' }} angle={-45} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 11, fill: dark ? '#6b7280' : '#9ca3af' }} allowDecimals={false} />
              <Tooltip cursor={{ fill: 'rgba(148,163,184,0.08)' }} content={props => <PerfTooltip {...props} doneKey="delivered" doneLabel="delivered" dark={dark} />} />
              <Bar dataKey="pending"   stackId="a" name="Pending"   fill={PERF_COLORS.pending} />
              <Bar dataKey="delivered" stackId="a" name="Delivered" fill={PERF_COLORS.done} />
              <Bar dataKey="overdue"   stackId="a" name="Overdue"   fill={PERF_COLORS.overdue} radius={[4, 4, 0, 0]}>
                <LabelList dataKey="total" position="top" style={{ fontSize: 10, fontWeight: 600, fill: dark ? '#9ca3af' : '#6b7280' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <PerfLegend doneLabel="Delivered" />
        </div>
      </div>

      {/* ── Trend + Donut + Stale Row ── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

        {/* 12-Week PO Trend Line Chart */}
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
            PO Creation Trend — Last 12 Weeks
          </h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={weeklyTrend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={dark ? '#374151' : '#e5e7eb'} />
              <XAxis
                dataKey="week"
                tick={{ fontSize: 10, fill: dark ? '#6b7280' : '#9ca3af' }}
                interval={2}
              />
              <YAxis tick={{ fontSize: 11, fill: dark ? '#6b7280' : '#9ca3af' }} allowDecimals={false} />
              <Tooltip
                formatter={v => [`${v} POs`]}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${dark ? '#374151' : '#e5e7eb'}`, background: dark ? '#1f2937' : '#ffffff', color: dark ? '#f3f4f6' : '#111827' }}
                cursor={{ stroke: '#16a34a', strokeWidth: 1 }}
              />
              <Line
                type="monotone"
                dataKey="count"
                stroke="#16a34a"
                strokeWidth={2.5}
                dot={{ r: 3, fill: '#16a34a', strokeWidth: 0 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Status Distribution Donut */}
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            PO Status Distribution
          </h3>
          {statusDist.length === 0 ? (
            <div className="flex items-center justify-center h-[240px] text-gray-400 text-sm">
              No data
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={statusDist}
                  cx="50%"
                  cy="45%"
                  innerRadius={55}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {statusDist.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v, name) => [`${v} POs`, name]}
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: `1px solid ${dark ? '#374151' : '#e5e7eb'}`, background: dark ? '#1f2937' : '#ffffff', color: dark ? '#f3f4f6' : '#111827' }}
                />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 10, paddingTop: 6 }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Top Stale POs */}
        <div className="card p-4 flex flex-col">
          <div className="flex items-center justify-between mb-3 shrink-0">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Top Stale POs</h3>
            {stalePOList.length > 0 && (
              <span className="text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-full px-2 py-0.5">
                {stalePOList.length} over {OVERDUE_DAYS}d
              </span>
            )}
          </div>
          {stalePOList.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 py-6 text-gray-400">
              <svg className="w-10 h-10 mb-2 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm">No stale POs — all on track!</p>
            </div>
          ) : (
            <div className="space-y-1.5 overflow-y-auto max-h-[240px] flex-1">
              {stalePOList.map(po => (
                <div
                  key={po.id}
                  className="flex items-center gap-2 p-2 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/20"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate">
                      {po.po_number || po.mr_number || '—'}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {po.vendor_name || '—'} · {po.rig_name || '—'}
                    </p>
                  </div>
                  <span className="shrink-0 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 text-xs font-bold rounded-full px-2 py-0.5 whitespace-nowrap">
                    {overdueDays(po)}d
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Vendor + Map Row ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

        {/* Vendor Performance Table */}
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            Vendor Performance
          </h3>
          {vendorPerf.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No vendor data yet</p>
          ) : (
            <div className="overflow-auto max-h-72">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white dark:bg-gray-900 z-10">
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left py-2 pr-4 font-medium text-gray-500 dark:text-gray-400">#</th>
                    <th className="text-left py-2 pr-4 font-medium text-gray-500 dark:text-gray-400">Vendor</th>
                    <th className="text-center py-2 px-2 font-medium text-gray-500 dark:text-gray-400">Score</th>
                    <th className="text-center py-2 px-2 font-medium text-gray-500 dark:text-gray-400">On-Time %</th>
                    <th className="text-center py-2 px-2 font-medium text-gray-500 dark:text-gray-400">Avg Lead</th>
                    <th className="text-center py-2 pl-2 font-medium text-gray-500 dark:text-gray-400">Delivered</th>
                  </tr>
                </thead>
                <tbody>
                  {vendorPerf.map((v, i) => (
                    <tr
                      key={v.name}
                      className={`border-b border-gray-100 dark:border-gray-800 ${i % 2 === 0 ? 'bg-gray-50/50 dark:bg-gray-800/20' : ''}`}
                    >
                      <td className="py-2 pr-4 text-gray-400 dark:text-gray-600 font-medium">{i + 1}</td>
                      <td
                        className="py-2 pr-4 font-medium text-gray-700 dark:text-gray-300 max-w-[140px] truncate"
                        title={v.name}
                      >
                        {v.name}
                      </td>
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-1.5 min-w-[60px]">
                          <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full">
                            <div
                              className={`h-full rounded-full ${scoreColor(v.onTimePct, 'bg')}`}
                              style={{ width: `${v.onTimePct ?? 0}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className={`text-center py-2 px-2 font-bold ${scoreColor(v.onTimePct)}`}>
                        {v.onTimePct !== null ? `${v.onTimePct}%` : '—'}
                      </td>
                      <td className="text-center py-2 px-2 text-gray-600 dark:text-gray-400">
                        {v.avgLead !== null ? `${v.avgLead}d` : '—'}
                      </td>
                      <td className="text-center py-2 pl-2 text-gray-500 dark:text-gray-500">
                        {v.delivered}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Material Location Map */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Material Location Map
            </h3>
            <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" />
                Rigs (click for details)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-orange-500 inline-block" />
                JDIL Hubs
              </span>
            </div>
          </div>
          <MaterialMap poOrders={filtered} />
        </div>
      </div>
    </div>
  )
}
