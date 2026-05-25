import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { PO_RIG_OPTIONS, BUYER_CODES, DELIVERY_MODES, OVERDUE_DAYS } from '../../utils/constants'
import { generateMRNumber, generatePONumber, daysElapsed } from '../../utils/helpers'

const DRAFT_KEY = 'jdil-new-po-draft'

function defaultForm(profile, existingCount) {
  return {
    mr_number:             generateMRNumber(existingCount),
    po_number:             generatePONumber(existingCount),
    po_date:               new Date().toISOString().split('T')[0],
    promised_ready_date:   '',
    rig_name:              '',
    vendor_name:           '',
    vendor_contact_name:   '',
    vendor_phone_number:   '',
    buyer_code:            profile?.team_code || '',
    material_description:  '',
    material_description_2:'',
    delivery_mode:         '',
  }
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveDraft(form) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(form))
  } catch { /* storage full — silently ignore */ }
}

function clearDraft() {
  localStorage.removeItem(DRAFT_KEY)
}

export default function NewPOPanel({ onClose, onCreated, existingCount = 0 }) {
  const { profile } = useAuth()

  // Initialise form from draft or defaults — runs synchronously, no flicker
  const [form, setForm] = useState(() => {
    const draft = loadDraft()
    return draft ?? defaultForm(profile, existingCount)
  })
  const [draftRestored, setDraftRestored] = useState(() => loadDraft() !== null)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  // Persist every keystroke to localStorage
  useEffect(() => {
    saveDraft(form)
  }, [form])

  function set(k, v) {
    setForm(f => ({ ...f, [k]: v }))
  }

  function handleCancel() {
    clearDraft()
    onClose()
  }

  async function handleCreate(e) {
    e.preventDefault()
    setError('')

    if (!form.rig_name)                    { setError('Rig / Location is required.');       return }
    if (!form.vendor_name.trim())          { setError('Vendor name is required.');           return }
    if (!form.material_description.trim()) { setError('Material description is required.');  return }

    setSaving(true)

    const elapsed = daysElapsed(form.po_date)
    const payload = {
      mr_number:              form.mr_number              || null,
      po_number:              form.po_number              || null,
      po_date:                form.po_date                || null,
      promised_ready_date:    form.promised_ready_date    || null,
      rig_name:               form.rig_name,
      vendor_name:            form.vendor_name,
      vendor_contact_name:    form.vendor_contact_name    || null,
      vendor_phone_number:    form.vendor_phone_number    || null,
      buyer_code:             form.buyer_code             || null,
      material_description:   form.material_description,
      material_description_2: form.material_description_2 || null,
      delivery_mode:          form.delivery_mode          || null,
      status:                 'PO Released',
      days_elapsed:           elapsed,
      is_stale:               elapsed > OVERDUE_DAYS,
      created_by:             profile.id,
      updated_at:             new Date().toISOString(),
    }

    console.log('Creating PO — payload:', payload)

    const { data, error: err } = await supabase
      .from('po_orders')
      .insert(payload)
      .select()
      .single()

    setSaving(false)

    if (err) {
      console.error('Create PO error:', {
        message: err.message,
        code:    err.code,
        details: err.details,
        hint:    err.hint,
      })
      setError(`Save failed: ${err.message}${err.hint ? ` — ${err.hint}` : ''}`)
      return
    }

    console.log('Create PO success:', data)
    clearDraft()   // only clear on successful save
    onCreated?.()
    onClose()
  }

  return (
    <>
      {/* Backdrop — visual dim only, NOT clickable to close */}
      <div className="fixed inset-0 z-40 bg-black/30 pointer-events-none" />

      <div className="panel-slide z-50">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">New Purchase Order</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">Fill in purchase details</p>
          </div>
          {/* X closes but intentionally does NOT clear the draft */}
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"
            title="Close (draft is saved)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Draft restored banner */}
        {draftRestored && (
          <div className="mx-5 mt-4 flex items-center justify-between gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 text-amber-700 dark:text-amber-400 text-xs rounded-lg px-3 py-2.5">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>Draft restored from your last session.</span>
            </div>
            <button
              onClick={() => setDraftRestored(false)}
              className="shrink-0 text-amber-500 hover:text-amber-700 dark:hover:text-amber-300"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleCreate} className="flex-1 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            <div>
              <label className="label">
                MR Number
                <span className="ml-1.5 text-xs font-normal text-gray-400">(auto-generated, editable)</span>
              </label>
              <input
                className="input-field"
                value={form.mr_number}
                onChange={e => set('mr_number', e.target.value)}
                placeholder="MR-2026-001"
              />
            </div>

            <div>
              <label className="label">
                PO Number
                <span className="ml-1.5 text-xs font-normal text-gray-400">(auto-generated, editable)</span>
              </label>
              <input
                className="input-field"
                value={form.po_number}
                onChange={e => set('po_number', e.target.value)}
                placeholder="PO-2026-001"
              />
            </div>

            <div>
              <label className="label">PO Date</label>
              <input
                type="date"
                className="input-field"
                value={form.po_date}
                onChange={e => set('po_date', e.target.value)}
                required
              />
            </div>

            <div>
              <label className="label">Promised Ready Date</label>
              <input
                type="date"
                className="input-field"
                value={form.promised_ready_date}
                onChange={e => set('promised_ready_date', e.target.value)}
              />
            </div>

            <div>
              <label className="label">Rig / Location <span className="text-red-500">*</span></label>
              <select
                className="input-field"
                value={form.rig_name}
                onChange={e => set('rig_name', e.target.value)}
                required
              >
                <option value="">Select rig / location…</option>
                {PO_RIG_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            <div>
              <label className="label">Delivery Mode</label>
              <select
                className="input-field"
                value={form.delivery_mode}
                onChange={e => set('delivery_mode', e.target.value)}
              >
                <option value="">Select mode…</option>
                {DELIVERY_MODES.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            <div>
              <label className="label">Buyer Code</label>
              <select
                className="input-field"
                value={form.buyer_code}
                onChange={e => set('buyer_code', e.target.value)}
              >
                <option value="">Select code…</option>
                {BUYER_CODES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            {/* Spacer */}
            <div />

            <div>
              <label className="label">Vendor Name <span className="text-red-500">*</span></label>
              <input
                className="input-field"
                value={form.vendor_name}
                onChange={e => set('vendor_name', e.target.value)}
                placeholder="Vendor company name"
                required
              />
            </div>

            <div>
              <label className="label">Vendor Contact Name</label>
              <input
                className="input-field"
                value={form.vendor_contact_name}
                onChange={e => set('vendor_contact_name', e.target.value)}
                placeholder="Contact person"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="label">Vendor Phone Number</label>
              <input
                type="tel"
                className="input-field"
                value={form.vendor_phone_number}
                onChange={e => set('vendor_phone_number', e.target.value)}
                placeholder="+91 98765 43210"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="label">Material Description <span className="text-red-500">*</span></label>
              <textarea
                className="input-field resize-none"
                rows={2}
                value={form.material_description}
                onChange={e => set('material_description', e.target.value)}
                placeholder="Primary material description"
                required
              />
            </div>

            <div className="sm:col-span-2">
              <label className="label">Material Description 2</label>
              <textarea
                className="input-field resize-none"
                rows={2}
                value={form.material_description_2}
                onChange={e => set('material_description_2', e.target.value)}
                placeholder="Additional description (optional)"
              />
            </div>

          </div>

          {error && (
            <div className="mt-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm rounded-lg px-4 py-3 break-words">
              {error}
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-800 space-y-3">
          <div className="flex gap-3">
            {/* Cancel clears the draft */}
            <button type="button" onClick={handleCancel} className="btn-secondary flex-1">
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={saving}
              className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {saving && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {saving ? 'Creating…' : 'Create PO'}
            </button>
          </div>
          <p className="text-center text-xs text-gray-400 dark:text-gray-500">
            Draft auto-saved · Close with ✕ to keep your draft for later
          </p>
        </div>
      </div>
    </>
  )
}
