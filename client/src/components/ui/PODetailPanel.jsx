import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { calcStatus, getDisplayStatus, daysElapsed, formatDate } from '../../utils/helpers'
import { PO_RIG_OPTIONS, BUYER_CODES, DELIVERY_MODES, TRANSPORT_MODES, LOCATION_OPTIONS_NO_RIG, DISPATCH_LOCATION_OPTIONS, LOGISTICS_TEAM_CODES, RIG_REMARKS_OPTIONS, OVERDUE_DAYS } from '../../utils/constants'
import { canEditField, hasAnyEditableField } from '../../utils/fieldPermissions'
import { StatusPill, PipelineDots } from './StatusPill'
import { generateSinglePOReport } from '../../utils/pdfReports'
import VendorAutocomplete from './VendorAutocomplete'

// ─── DC field → logistics team code mapping (Issue 6) ─────────────────────────
const DC_TEAM_MAP = {
  'SV-01': 'dc_number_bkc',
  'SS-02': 'dc_number_bkc',
  'AK-03': 'dc_number_taloja',
  'KT-04': 'dc_number_taloja',
  'MK-05': 'dc_number_nhava',
  'RS-06': 'dc_number_nagothane',
}
const DC_FIELDS = new Set(['dc_number_bkc', 'dc_number_taloja', 'dc_number_nhava', 'dc_number_nagothane'])

// ─── Field section definitions (display grouping only, not permissions) ───────
const FIELD_SECTIONS = [
  {
    key: 'purchase',
    label: 'Purchase Details',
    fields: [
      { key: 'mr_number',             label: 'MR Number',                  type: 'text' },
      { key: 'po_number',             label: 'PO Number',                  type: 'text' },
      { key: 'po_date',               label: 'PO Date',                    type: 'date' },
      { key: 'rig_name',              label: 'Rig / Location',             type: 'select', options: PO_RIG_OPTIONS },
      { key: 'delivery_mode',         label: 'Delivery Mode',              type: 'select', options: DELIVERY_MODES },
      { key: 'buyer_code',            label: 'Buyer Code',                 type: 'select', options: BUYER_CODES },
      { key: 'material_description_2',label: 'Material Description 2',      type: 'textarea' },
      { key: 'promised_ready_date',   label: 'Promised Ready Date',        type: 'date' },
      { key: 'vendor_name',           label: 'Vendor Name (Company)',      type: 'text' },
      { key: 'vendor_contact_name',   label: 'Vendor Contact Person Name', type: 'text' },
      { key: 'vendor_phone_number',   label: 'Vendor Phone Number',        type: 'text' },
    ],
  },
  {
    key: 'logistics',
    label: 'Logistics Details',
    fields: [
      // Material Collection Date/Location removed from UI (DB columns retained for history)
      // 1 & 2. Material Received Date + Location (4 hub options, no Rig)
      { key: 'material_received_date',       label: 'Material Received Date',       type: 'date' },
      { key: 'material_received_location',   label: 'Material Received Location',    type: 'select', options: LOCATION_OPTIONS_NO_RIG },
      // 3–6. DC Numbers (BKC, Taloja, Nhava, Nagothane) — filtered per team_code in render
      { key: 'dc_number_bkc',                label: 'DC Number (BKC)',              type: 'text' },
      { key: 'dc_number_taloja',             label: 'DC Number (Taloja)',           type: 'text' },
      { key: 'dc_number_nhava',              label: 'DC Number (Nhava)',            type: 'text' },
      { key: 'dc_number_nagothane',          label: 'DC Number (Nagothane)',        type: 'text' },
      // 7. Material Dispatch Date (db column stays dispatch_date)
      { key: 'dispatch_date',                label: 'Material Dispatch Date',       type: 'date' },
      // 8. Material Dispatch Location — 17 options (hubs + rigs incl. DD variants)
      { key: 'jdil_location',                label: 'Material Dispatch Location',   type: 'select', options: DISPATCH_LOCATION_OPTIONS },
      // 9. Mode of Transport
      { key: 'mode_of_transport',            label: 'Mode of Transport',            type: 'select', options: TRANSPORT_MODES },
      // 10. Transporter Detail
      { key: 'transporter_details',          label: 'Transporter Detail',           type: 'text' },
      // 11. In Transit to Rig/JDIL Location Date (column stays in_transit_rig_date)
      { key: 'in_transit_rig_date',          label: 'In Transit to Rig/JDIL Location Date', type: 'date' },
      // 12. Logistics Team Code — special role-based rendering (see field render)
      { key: 'logistics_team_code',          label: 'Logistics Team Code',          type: 'logistics_code' },
    ],
  },
  {
    key: 'rig',
    label: 'Rig Delivery',
    fields: [
      { key: 'delivered_to_rig_date', label: 'Delivered to Rig Date', type: 'date' },
    ],
  },
  {
    key: 'remarks',
    label: 'Remarks',
    fields: [
      // CHANGE 7: Remarks is now a dropdown (rig + admin editable); details go in Other Remarks
      { key: 'remarks',       label: 'Remarks',       type: 'select', options: RIG_REMARKS_OPTIONS },
      { key: 'other_remarks', label: 'Other Remarks', type: 'textarea' },
    ],
  },
]

// ─── Lock icon ────────────────────────────────────────────────────────────────
function LockIcon() {
  return (
    <svg className="w-3 h-3 text-gray-400 dark:text-gray-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  )
}

// ─── Read-only field display ──────────────────────────────────────────────────
function ReadOnlyField({ label, value, wide }) {
  const display = value || '—'
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <label className="flex items-center gap-1.5 text-sm font-medium text-gray-500 dark:text-gray-500 mb-1">
        {label}
        <LockIcon />
      </label>
      <div className="w-full px-3 py-2 rounded-lg border border-dashed border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/30 text-sm text-gray-400 dark:text-gray-500 min-h-[36px]">
        {display}
      </div>
    </div>
  )
}

// ─── Line item status pill ─────────────────────────────────────────────────────
function ItemStatusPill({ status }) {
  const styles = {
    'Pending':             'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
    'Partially Delivered': 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    'Fully Delivered':     'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  }
  return (
    <span className={`inline-block text-xs font-medium rounded-full px-2 py-0.5 whitespace-nowrap ${styles[status] || styles['Pending']}`}>
      {status || 'Pending'}
    </span>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function PODetailPanel({ po, onClose, onSave }) {
  const { profile } = useAuth()
  const [form, setForm]                   = useState({ ...po })
  const [saving, setSaving]               = useState(false)
  const [error, setError]                 = useState('')
  const [reasonModal, setReasonModal]     = useState(false)
  const [reason, setReason]               = useState('')
  const [pendingChanges, setPendingChanges] = useState({})
  const [pdfLoading, setPdfLoading]       = useState(false)

  // ── Line items ──────────────────────────────────────────────────────────────
  const [lineItems, setLineItems]         = useState([])
  const [itemDeliveries, setItemDeliveries] = useState({})  // { [itemId]: stringValue }
  const [itemsSaving, setItemsSaving]     = useState(false)
  const [itemsError, setItemsError]       = useState('')
  const [itemsMsg, setItemsMsg]           = useState('')

  useEffect(() => { setForm({ ...po }); setPendingChanges({}) }, [po])

  async function loadLineItems() {
    const { data, error } = await supabase
      .from('po_line_items')
      .select('*')
      .eq('po_id', po.id)
      .order('created_at', { ascending: true })
    if (error) { console.error('Load line items error:', error); return }
    setLineItems(data || [])
    setItemDeliveries(Object.fromEntries((data || []).map(it => [it.id, String(it.quantity_delivered ?? 0)])))
  }

  useEffect(() => {
    if (po?.id) { setItemsError(''); setItemsMsg(''); loadLineItems() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [po?.id])

  // Auto-fill Logistics Team Code for logistics users when the PO has none yet
  // (mirrors the buyer_code auto-fill for purchase). Stages it for save.
  useEffect(() => {
    if (profile?.role === 'logistics' && profile?.team_code && !po?.logistics_team_code) {
      setForm(f => ({ ...f, logistics_team_code: profile.team_code }))
      setPendingChanges(p => ({ ...p, logistics_team_code: profile.team_code }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [po?.id])

  // Warn before tab close / reload if there are unsaved field or delivery edits
  useEffect(() => {
    const itemsDirty = lineItems.some(it =>
      (itemDeliveries[it.id] ?? String(it.quantity_delivered ?? 0)) !== String(it.quantity_delivered ?? 0)
    )
    const dirty = Object.keys(pendingChanges).length > 0 || itemsDirty
    if (!dirty) return
    function onBeforeUnload(e) {
      e.preventDefault()
      e.returnValue = 'You have unsaved changes. Are you sure you want to leave?'
      return e.returnValue
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [pendingChanges, lineItems, itemDeliveries])

  async function handleDownloadPDF() {
    setPdfLoading(true)
    try {
      // Fetch the audit log for this specific PO (joined with user names)
      const { data: auditLog } = await supabase
        .from('audit_log')
        .select('*, users(name, email)')
        .eq('po_id', po.id)
        .order('changed_at', { ascending: false })
      await generateSinglePOReport(form, auditLog || [], lineItems || [])
    } catch (e) {
      console.error('PDF generation error:', e)
    }
    setPdfLoading(false)
  }

  // ── Alert grace period (admin only) ─────────────────────────────────────────
  const [graceBusy, setGraceBusy]           = useState(false)
  const [graceFormOpen, setGraceFormOpen]   = useState(false)
  const [graceReason, setGraceReason]       = useState('')
  const [graceError, setGraceError]         = useState('')
  async function handleGracePeriod(enabled) {
    setGraceBusy(true); setGraceError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch(`/api/po/${po.id}/grace-period`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ enabled, reason: graceReason.trim() }),
      })
      const result = await resp.json()
      if (!resp.ok) { setGraceError(result.error || 'Request failed'); setGraceBusy(false); return }
      setForm(f => ({ ...f, ...result.data }))
      setGraceFormOpen(false)
      setGraceReason('')
      onSave?.()
    } catch (e) {
      console.error('Grace period error:', e)
      setGraceError(`Network error: ${e.message}`)
    }
    setGraceBusy(false)
  }

  const [clearing, setClearing] = useState(false)
  async function handleClearAlerts() {
    setClearing(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch(`/api/po/${po.id}/clear-alerts`, {
        method: 'POST', headers: { Authorization: `Bearer ${session?.access_token}` },
      })
      if (resp.ok) onSave?.()
    } catch (e) { console.error('Clear alerts error:', e) }
    setClearing(false)
  }

  const role      = profile?.role
  const teamCode  = profile?.team_code
  const canEdit   = (key) => canEditField(role, key)
  const canSave   = hasAnyEditableField(role)
  const isCSuite  = role === 'csuite'

  const canEditDeliveries = role === 'rig' || role === 'admin'

  // ── Save changed line-item delivered quantities (rig + admin) ───────────────
  async function handleSaveDeliveries() {
    setItemsError('')
    setItemsMsg('')

    // Only items whose delivered value actually changed
    const changed = lineItems.filter(it => {
      const newVal = Number(itemDeliveries[it.id])
      return !Number.isNaN(newVal) && newVal !== Number(it.quantity_delivered ?? 0)
    })

    if (changed.length === 0) { setItemsMsg('No delivery changes to save.'); return }

    // Client-side validation: delivered cannot exceed ordered
    for (const it of changed) {
      const newVal = Number(itemDeliveries[it.id])
      if (newVal < 0) { setItemsError(`"${it.item_name}": delivered cannot be negative.`); return }
      if (newVal > Number(it.quantity_ordered)) {
        setItemsError(`"${it.item_name}": delivered (${newVal}) cannot exceed ordered (${it.quantity_ordered}).`)
        return
      }
    }

    setItemsSaving(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      for (const it of changed) {
        const resp = await fetch(`/api/po/items/${it.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ quantity_delivered: Number(itemDeliveries[it.id]) }),
        })
        const result = await resp.json()
        if (!resp.ok) {
          setItemsError(result.error || `Failed to update "${it.item_name}"`)
          setItemsSaving(false)
          return
        }
      }
      await loadLineItems()
      setItemsMsg(`Updated ${changed.length} item${changed.length > 1 ? 's' : ''}.`)
      onSave?.()
    } catch (err) {
      console.error('Save deliveries error:', err)
      setItemsError(`Network error: ${err.message}`)
    }
    setItemsSaving(false)
  }

  // Issue 6: logistics DC field visibility — each team code sees only their DC field.
  // All other roles see all fields.
  function showField(fieldKey) {
    if (!DC_FIELDS.has(fieldKey)) return true           // non-DC fields always shown
    if (role !== 'logistics' || !teamCode) return true  // non-logistics or no team code → all DC fields
    const allowedDC = DC_TEAM_MAP[teamCode]
    if (!allowedDC) return true                         // unknown team code → show all
    return fieldKey === allowedDC
  }

  function set(key, val) {
    setForm(f => ({ ...f, [key]: val }))
    setPendingChanges(p => ({ ...p, [key]: val }))
  }

  async function handleSave() {
    if (Object.keys(pendingChanges).length === 0) { onClose(); return }
    if (role === 'admin') { setReasonModal(true); return }
    await doSave('')
  }

  async function doSave(rsn) {
    setSaving(true)
    setError('')

    // Filter to only this role's allowed fields (defence in depth)
    const safePatch = Object.fromEntries(
      Object.entries(pendingChanges).filter(([key]) => canEditField(role, key))
    )

    if (Object.keys(safePatch).length === 0) {
      setSaving(false)
      setReasonModal(false)
      onSave?.()
      return
    }

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch(`/api/po/${po.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ fields: safePatch, reason: rsn }),
      })

      const result = await resp.json()

      if (!resp.ok) {
        console.error('Save PO error:', result)
        setError(result.error || 'Save failed')
        setSaving(false)
        return
      }

      console.log('Save PO success:', result)
      setSaving(false)
      setPendingChanges({})
      setReasonModal(false)
      setReason('')
      onSave?.()
    } catch (err) {
      console.error('Save PO network error:', err)
      setError(`Network error: ${err.message}`)
      setSaving(false)
    }
  }

  const status = calcStatus(form)
  const days   = daysElapsed(form.po_date)
  const hasPendingChanges = Object.keys(pendingChanges).length > 0

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="panel-slide z-50">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">{form.po_number || 'PO Detail'}</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">{form.mr_number}</p>
          </div>
          <div className="flex items-center gap-2">
            {['admin', 'csuite'].includes(role) && (
              <button
                onClick={handleDownloadPDF}
                disabled={pdfLoading}
                className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 disabled:opacity-60"
                title="Download full PO detail report as PDF"
              >
                {pdfLoading ? (
                  <div className="w-3 h-3 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                )}
                {pdfLoading ? 'Generating…' : 'Download PDF'}
              </button>
            )}
            {role === 'admin' && (form.is_stale || form.is_delivery_stale) && (
              <button
                onClick={handleClearAlerts}
                disabled={clearing}
                className="text-xs py-1.5 px-3 rounded-lg border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-60"
                title="Clear stale/delivery alerts for this PO"
              >
                {clearing ? 'Clearing…' : 'Clear Alert'}
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Role badge + status bar */}
        <div className="px-5 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <StatusPill status={status} label={getDisplayStatus(form)} />
              {isCSuite && (
                <span className="inline-flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 rounded-full px-2 py-0.5">
                  <LockIcon /> Read-only
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {days > OVERDUE_DAYS && (
                <span className="bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 text-xs font-bold rounded-full px-2 py-0.5">
                  {days}d OVERDUE
                </span>
              )}
              <span className="text-xs text-gray-500 dark:text-gray-400">{days} days elapsed</span>
            </div>
          </div>
          <PipelineDots status={status} />
        </div>

        {/* Alert grace period (admin only) */}
        {role === 'admin' && (
          <div className="px-5 py-2.5 border-b border-gray-200 dark:border-gray-800">
            {form.alert_grace_period ? (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                      🕓 Alert grace period active — excluded from escalation emails
                    </p>
                    <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5 truncate">
                      {form.grace_period_reason || 'No reason recorded'}
                      {form.grace_period_set_at && ` · since ${formatDate(form.grace_period_set_at.split('T')[0])}`}
                    </p>
                  </div>
                  <button
                    onClick={() => handleGracePeriod(false)}
                    disabled={graceBusy}
                    className="text-xs shrink-0 border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 px-2.5 py-1 rounded-md disabled:opacity-60">
                    {graceBusy ? 'Removing…' : 'Remove from grace period'}
                  </button>
                </div>
              </div>
            ) : graceFormOpen ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  className="input-field flex-1 text-xs"
                  placeholder="Reason for grace period (required)…"
                  value={graceReason}
                  autoFocus
                  onChange={e => setGraceReason(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && graceReason.trim() && handleGracePeriod(true)}
                />
                <button
                  onClick={() => handleGracePeriod(true)}
                  disabled={graceBusy || !graceReason.trim()}
                  className="text-xs bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white px-2.5 py-1.5 rounded-md shrink-0">
                  {graceBusy ? 'Adding…' : 'Add'}
                </button>
                <button
                  onClick={() => { setGraceFormOpen(false); setGraceReason(''); setGraceError('') }}
                  className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-1.5 py-1.5 shrink-0">
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setGraceFormOpen(true)}
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-amber-700 dark:hover:text-amber-400 transition-colors">
                🕓 Add to grace period (mute escalation emails for this PO)
              </button>
            )}
            {graceError && (
              <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">{graceError}</p>
            )}
          </div>
        )}

        {/* Fields */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {FIELD_SECTIONS.map(section => (
            <div key={section.key}>
              <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">
                {section.label}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {section.fields.filter(f => showField(f.key)).map(f => {
                  const wide = f.type === 'textarea'
                  const editable = canEdit(f.key)

                  if (!editable) {
                    // Display read-only with lock icon
                    const displayVal = f.type === 'date'
                      ? formatDate(form[f.key])
                      : (form[f.key] || '')
                    return (
                      <ReadOnlyField
                        key={f.key}
                        label={f.label}
                        value={displayVal}
                        wide={wide}
                      />
                    )
                  }

                  // Editable input
                  const baseClass = 'input-field'
                  const wideClass = wide ? 'sm:col-span-2' : ''

                  return (
                    <div key={f.key} className={wideClass}>
                      <label className="label">{f.label}</label>
                      {f.key === 'vendor_name' ? (
                        <VendorAutocomplete
                          value={form.vendor_name || ''}
                          onChange={v => set('vendor_name', v)}
                          onSelect={vendor => {
                            set('vendor_name', vendor.name)
                            if (vendor.contact_person && canEdit('vendor_contact_name')) set('vendor_contact_name', vendor.contact_person)
                            if (vendor.phone && canEdit('vendor_phone_number')) set('vendor_phone_number', vendor.phone)
                          }}
                          placeholder="Search or type vendor name"
                        />
                      ) : f.key === 'logistics_team_code' ? (
                        role === 'admin' ? (
                          <select
                            className={baseClass}
                            value={form.logistics_team_code || ''}
                            onChange={e => set('logistics_team_code', e.target.value)}
                          >
                            <option value="">—</option>
                            {LOGISTICS_TEAM_CODES.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        ) : (
                          // Logistics user — auto-filled, read-only with lock
                          <div className="input-field flex items-center justify-between bg-gray-50 dark:bg-gray-800/40 text-gray-700 dark:text-gray-300 cursor-not-allowed select-none">
                            <span>{form.logistics_team_code || profile?.team_code || '—'}</span>
                            <LockIcon />
                          </div>
                        )
                      ) : f.type === 'select' ? (
                        <select
                          className={baseClass}
                          value={form[f.key] || ''}
                          onChange={e => set(f.key, e.target.value)}
                        >
                          <option value="">—</option>
                          {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : f.type === 'textarea' ? (
                        <textarea
                          rows={2}
                          className={`${baseClass} resize-none`}
                          value={form[f.key] || ''}
                          onChange={e => set(f.key, e.target.value)}
                        />
                      ) : (
                        <input
                          type={f.type}
                          className={baseClass}
                          value={form[f.key] || ''}
                          onChange={e => set(f.key, e.target.value)}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {/* ── Line Items ─────────────────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                Line Items {lineItems.length > 0 && `(${lineItems.length})`}
              </h3>
              {canEditDeliveries && lineItems.length > 0 && (
                <button
                  onClick={handleSaveDeliveries}
                  disabled={itemsSaving}
                  className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5 disabled:opacity-60"
                >
                  {itemsSaving && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  {itemsSaving ? 'Saving…' : 'Save Deliveries'}
                </button>
              )}
            </div>

            {lineItems.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 italic py-2">No line items for this PO.</p>
            ) : (
              <div className="overflow-x-auto -mx-1 px-1">
                <table className="w-full text-sm min-w-[420px]">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
                      <th className="text-left py-2 pr-2 font-medium">Item</th>
                      <th className="text-center py-2 px-2 font-medium">Ordered</th>
                      <th className="text-center py-2 px-2 font-medium">Delivered</th>
                      <th className="text-center py-2 px-2 font-medium">Pending</th>
                      <th className="text-right py-2 pl-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map(it => {
                      const ordered   = Number(it.quantity_ordered) || 0
                      const delivered = canEditDeliveries
                        ? (itemDeliveries[it.id] ?? '')
                        : (it.quantity_delivered ?? 0)
                      const pending = Math.max(0, ordered - (Number(delivered) || 0))
                      return (
                        <tr key={it.id} className="border-b border-gray-100 dark:border-gray-800 align-top">
                          <td className="py-2 pr-2">
                            <p className="font-medium text-gray-800 dark:text-gray-200">{it.item_name}</p>
                            {it.material_description && (
                              <p className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-[160px]" title={it.material_description}>
                                {it.material_description}
                              </p>
                            )}
                          </td>
                          <td className="text-center py-2 px-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                            {ordered}{it.unit ? ` ${it.unit}` : ''}
                          </td>
                          <td className="text-center py-2 px-2">
                            {canEditDeliveries ? (
                              <input
                                type="number"
                                min="0"
                                max={ordered}
                                step="any"
                                className="input-field text-sm text-center w-20 py-1 px-1.5 mx-auto"
                                value={itemDeliveries[it.id] ?? ''}
                                onChange={e => setItemDeliveries(p => ({ ...p, [it.id]: e.target.value }))}
                              />
                            ) : (
                              <span className="text-gray-600 dark:text-gray-400">{it.quantity_delivered ?? 0}</span>
                            )}
                          </td>
                          <td className="text-center py-2 px-2 font-medium text-gray-700 dark:text-gray-300">
                            {pending}
                          </td>
                          <td className="text-right py-2 pl-2">
                            <ItemStatusPill status={it.item_status} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {itemsError && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2 break-words">
                {itemsError}
              </p>
            )}
            {itemsMsg && !itemsError && (
              <p className="mt-2 text-xs text-green-600 dark:text-green-400">{itemsMsg}</p>
            )}
            {canEditDeliveries && lineItems.length > 0 && (
              <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
                Saving a partial delivery (delivered &lt; ordered) notifies the rig &amp; purchase teams by email.
              </p>
            )}
          </div>
        </div>

        {/* Footer — hidden for csuite, shown for all editing roles */}
        {canSave && (
          <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-800 space-y-2">
            {error && (
              <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2 break-words">
                {error}
              </p>
            )}
            <div className="flex gap-3">
              <button onClick={onClose} className="btn-secondary flex-1">Close</button>
              <button
                onClick={handleSave}
                disabled={saving || !hasPendingChanges}
                className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                title={!hasPendingChanges ? 'No changes to save' : ''}
              >
                {saving && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {saving ? 'Saving…' : `Save Changes${hasPendingChanges ? ` (${Object.keys(pendingChanges).length})` : ''}`}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Admin reason modal */}
      {reasonModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 p-6 w-full max-w-sm">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">Reason for Change</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
              Admin must provide a reason for every modification.
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
              Changing {Object.keys(pendingChanges).length} field{Object.keys(pendingChanges).length > 1 ? 's' : ''}:{' '}
              <span className="font-mono">{Object.keys(pendingChanges).join(', ')}</span>
            </p>
            <textarea
              className="input-field resize-none mb-4"
              rows={3}
              placeholder="Enter reason for these changes…"
              value={reason}
              onChange={e => setReason(e.target.value)}
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setReasonModal(false); setReason('') }}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                onClick={() => reason.trim() && doSave(reason.trim())}
                disabled={!reason.trim() || saving}
                className="btn-primary flex-1 disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Confirm Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
