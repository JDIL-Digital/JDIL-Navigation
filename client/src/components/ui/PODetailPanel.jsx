import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { calcStatus, daysElapsed, formatDate } from '../../utils/helpers'
import { PO_RIG_OPTIONS, BUYER_CODES, DELIVERY_MODES, OVERDUE_DAYS } from '../../utils/constants'
import { canEditField, hasAnyEditableField } from '../../utils/fieldPermissions'
import { StatusPill, PipelineDots } from './StatusPill'
import { generateSinglePOReport } from '../../utils/pdfReports'

// ─── Field section definitions (display grouping only, not permissions) ───────
const FIELD_SECTIONS = [
  {
    key: 'purchase',
    label: 'Purchase Details',
    fields: [
      { key: 'mr_number',             label: 'MR Number',              type: 'text' },
      { key: 'po_number',             label: 'PO Number',              type: 'text' },
      { key: 'po_date',               label: 'PO Date',                type: 'date' },
      { key: 'promised_ready_date',   label: 'Promised Ready Date',    type: 'date' },
      { key: 'rig_name',              label: 'Rig / Location',         type: 'select', options: PO_RIG_OPTIONS },
      { key: 'vendor_name',           label: 'Vendor',                 type: 'text' },
      { key: 'vendor_contact_name',   label: 'Vendor Contact Name',    type: 'text' },
      { key: 'vendor_phone_number',   label: 'Vendor Phone Number',    type: 'text' },
      { key: 'buyer_code',            label: 'Buyer Code',             type: 'select', options: BUYER_CODES },
      { key: 'material_description',  label: 'Material Description',   type: 'textarea' },
      { key: 'material_description_2',label: 'Material Description 2', type: 'textarea' },
      { key: 'delivery_mode',         label: 'Delivery Mode',          type: 'select', options: DELIVERY_MODES },
    ],
  },
  {
    key: 'logistics',
    label: 'Logistics Details',
    fields: [
      { key: 'vendor_confirmed_date', label: 'Vendor Confirmed Date',  type: 'date' },
      { key: 'material_ready_date',   label: 'Material Ready Date',    type: 'date' },
      { key: 'dispatch_date',         label: 'Dispatch Date',          type: 'date' },
      { key: 'dc_number_bkc',         label: 'DC Number (BKC)',        type: 'text' },
      { key: 'dc_number_taloja',      label: 'DC Number (Taloja)',     type: 'text' },
      { key: 'dc_number_nagothane',   label: 'DC Number (Nagothane)',  type: 'text' },
      { key: 'dc_number_nhava',       label: 'DC Number (Nhava)',      type: 'text' },
      { key: 'transporter_details',   label: 'Transporter Details',    type: 'text' },
      { key: 'jdil_location',         label: 'JDIL Location',          type: 'text' },
      { key: 'in_transit_rig_date',   label: 'In Transit to Rig Date', type: 'date' },
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
      { key: 'remarks',       label: 'Remarks',       type: 'textarea' },
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

  useEffect(() => { setForm({ ...po }); setPendingChanges({}) }, [po])

  async function handleDownloadPDF() {
    setPdfLoading(true)
    try {
      // Fetch the audit log for this specific PO (joined with user names)
      const { data: auditLog } = await supabase
        .from('audit_log')
        .select('*, users(name, email)')
        .eq('po_id', po.id)
        .order('changed_at', { ascending: false })
      await generateSinglePOReport(form, auditLog || [])
    } catch (e) {
      console.error('PDF generation error:', e)
    }
    setPdfLoading(false)
  }

  const role      = profile?.role
  const canEdit   = (key) => canEditField(role, key)
  const canSave   = hasAnyEditableField(role)
  const isCSuite  = role === 'csuite'

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
              <StatusPill status={status} />
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

        {/* Fields */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {FIELD_SECTIONS.map(section => (
            <div key={section.key}>
              <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">
                {section.label}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {section.fields.map(f => {
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
                      {f.type === 'select' ? (
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
