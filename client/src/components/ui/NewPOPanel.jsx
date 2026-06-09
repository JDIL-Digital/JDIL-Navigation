import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import VendorAutocomplete from './VendorAutocomplete'
import { PO_RIG_OPTIONS, BUYER_CODES, DELIVERY_MODES, OVERDUE_DAYS } from '../../utils/constants'
import { daysElapsed, calcStatus, overdueDays } from '../../utils/helpers'

const DRAFT_KEY = 'jdil-new-po-draft'

function emptyLineItem() {
  return { item_name: '', material_description: '', quantity_ordered: '', unit: '' }
}

function defaultForm(profile) {
  return {
    mr_number:             '',
    po_number:             '',
    po_date:               new Date().toISOString().split('T')[0],
    promised_ready_date:   '',
    rig_name:              '',
    vendor_name:           '',
    vendor_contact_name:   '',
    vendor_phone_number:   '',
    buyer_code:            profile?.team_code || '',
    material_description_2:'',
    delivery_mode:         '',
    line_items:            [emptyLineItem()],
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

  // Purchase users have a single buyer code (their team_code); admins do not.
  const isPurchase = profile?.role === 'purchase'

  // For purchase users, always force buyer_code to their own team_code —
  // even if a restored draft carried a different/empty value.
  useEffect(() => {
    if (isPurchase && profile?.team_code && form.buyer_code !== profile.team_code) {
      setForm(f => ({ ...f, buyer_code: profile.team_code }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPurchase, profile?.team_code])

  // Persist every keystroke to localStorage
  useEffect(() => {
    saveDraft(form)
  }, [form])

  // Warn before tab close / reload if the form has unsaved content
  useEffect(() => {
    const dirty = Boolean(
      form.mr_number || form.po_number || form.vendor_name ||
      form.material_description_2 ||
      (form.line_items || []).some(it => it.item_name?.trim())
    )
    if (!dirty) return
    function onBeforeUnload(e) {
      e.preventDefault()
      e.returnValue = 'You have unsaved changes. Are you sure you want to leave?'
      return e.returnValue
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [form])

  function set(k, v) {
    setForm(f => ({ ...f, [k]: v }))
  }

  // ── Line item helpers ──────────────────────────────────────────────────────
  const lineItems = Array.isArray(form.line_items) ? form.line_items : [emptyLineItem()]

  function setLineItem(idx, key, val) {
    setForm(f => {
      const items = [...(Array.isArray(f.line_items) ? f.line_items : [emptyLineItem()])]
      items[idx] = { ...items[idx], [key]: val }
      return { ...f, line_items: items }
    })
  }

  function addLineItem() {
    setForm(f => ({
      ...f,
      line_items: [...(Array.isArray(f.line_items) ? f.line_items : []), emptyLineItem()],
    }))
  }

  function removeLineItem(idx) {
    setForm(f => {
      const items = (Array.isArray(f.line_items) ? f.line_items : []).filter((_, i) => i !== idx)
      return { ...f, line_items: items.length ? items : [emptyLineItem()] }
    })
  }

  function handleCancel() {
    clearDraft()
    onClose()
  }

  async function handleCreate(e) {
    e.preventDefault()
    setError('')

    if (!form.mr_number.trim())            { setError('MR Number is required.');             return }
    if (!form.po_number.trim())            { setError('PO Number is required.');             return }
    if (!form.rig_name)                    { setError('Rig / Location is required.');       return }
    if (!form.vendor_name.trim())          { setError('Vendor name is required.');           return }

    // At least one line item with a name is required
    const validItems = lineItems.filter(it => it.item_name && it.item_name.trim())
    if (validItems.length === 0) {
      setError('At least one line item with an item name is required.')
      return
    }

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
      material_description_2: form.material_description_2 || null,
      delivery_mode:          form.delivery_mode          || null,
      status:                 calcStatus(form),
      days_elapsed:           elapsed,
      is_stale:               overdueDays(form) > OVERDUE_DAYS,
      created_by:             profile.id,
      updated_at:             new Date().toISOString(),
    }

    console.log('Creating PO — payload:', payload)

    const { data, error: err } = await supabase
      .from('po_orders')
      .insert(payload)
      .select()
      .single()

    if (err) {
      setSaving(false)
      console.error('Create PO error:', {
        message: err.message,
        code:    err.code,
        details: err.details,
        hint:    err.hint,
      })
      setError(`Save failed: ${err.message}${err.hint ? ` — ${err.hint}` : ''}`)
      return
    }

    // ── Insert line items (quantity_pending & item_status are generated cols) ──
    const itemRows = validItems.map(it => ({
      po_id:                data.id,
      item_name:            it.item_name.trim(),
      material_description: it.material_description?.trim() || null,
      unit:                 it.unit?.trim() || null,
      quantity_ordered:     Number(it.quantity_ordered) || 0,
      quantity_delivered:   0,
    }))

    const { error: itemsErr } = await supabase.from('po_line_items').insert(itemRows)
    setSaving(false)

    if (itemsErr) {
      // PO was created but items failed — surface the error, don't clear draft
      console.error('Create line items error:', itemsErr)
      setError(`PO created but line items failed to save: ${itemsErr.message}. Please add them from the PO detail panel.`)
      onCreated?.()   // refresh the list so the PO appears
      return
    }

    console.log('Create PO success:', data, 'with', itemRows.length, 'line items')
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
              <label className="label">MR Number <span className="text-red-500">*</span></label>
              <input
                className="input-field"
                value={form.mr_number}
                onChange={e => set('mr_number', e.target.value)}
                placeholder="Enter MR number"
                required
              />
            </div>

            <div>
              <label className="label">PO Number <span className="text-red-500">*</span></label>
              <input
                className="input-field"
                value={form.po_number}
                onChange={e => set('po_number', e.target.value)}
                placeholder="Enter PO number"
                required
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
              <label className="label">
                Buyer Code
                {isPurchase && (
                  <span className="ml-1.5 text-xs font-normal text-gray-400">(your code)</span>
                )}
              </label>
              {isPurchase ? (
                <div className="input-field flex items-center bg-gray-50 dark:bg-gray-800/40 text-gray-700 dark:text-gray-300 cursor-not-allowed select-none">
                  {form.buyer_code || profile?.team_code || '—'}
                </div>
              ) : (
                <select
                  className="input-field"
                  value={form.buyer_code}
                  onChange={e => set('buyer_code', e.target.value)}
                >
                  <option value="">Select code…</option>
                  {BUYER_CODES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
            </div>

          </div>

          {/* ── Line Items ─────────────────────────────────────────────────── */}
          <div className="mt-6">
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">
                Line Items <span className="text-red-500">*</span>
                <span className="ml-1.5 text-xs font-normal text-gray-400">(at least one required)</span>
              </label>
              <button
                type="button"
                onClick={addLineItem}
                className="text-xs font-medium text-jdil-green hover:text-green-700 flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Item
              </button>
            </div>

            <div className="space-y-2">
              {lineItems.map((it, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-12 gap-2 items-start bg-gray-50 dark:bg-gray-800/40 rounded-lg p-2.5 border border-gray-200 dark:border-gray-700"
                >
                  <div className="col-span-12 sm:col-span-4">
                    <input
                      className="input-field text-sm"
                      value={it.item_name}
                      onChange={e => setLineItem(idx, 'item_name', e.target.value)}
                      placeholder="Item name *"
                    />
                  </div>
                  <div className="col-span-12 sm:col-span-4">
                    <input
                      className="input-field text-sm"
                      value={it.material_description}
                      onChange={e => setLineItem(idx, 'material_description', e.target.value)}
                      placeholder="Material description"
                    />
                  </div>
                  <div className="col-span-5 sm:col-span-2">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      className="input-field text-sm"
                      value={it.quantity_ordered}
                      onChange={e => setLineItem(idx, 'quantity_ordered', e.target.value)}
                      placeholder="Qty"
                    />
                  </div>
                  <div className="col-span-5 sm:col-span-1">
                    <input
                      className="input-field text-sm"
                      value={it.unit}
                      onChange={e => setLineItem(idx, 'unit', e.target.value)}
                      placeholder="Unit"
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-1 flex justify-center pt-1.5">
                    <button
                      type="button"
                      onClick={() => removeLineItem(idx)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                      title="Remove item"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">
              Item name & quantity ordered. Delivery quantities are tracked by the rig team after dispatch.
            </p>
          </div>

          {/* ── Additional details ──────────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
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
              <label className="label">Vendor Name (Company) <span className="text-red-500">*</span></label>
              <VendorAutocomplete
                value={form.vendor_name}
                onChange={v => set('vendor_name', v)}
                onSelect={vendor => setForm(f => ({
                  ...f,
                  vendor_name:         vendor.name,
                  vendor_contact_name: vendor.contact_person || f.vendor_contact_name,
                  vendor_phone_number: vendor.phone          || f.vendor_phone_number,
                }))}
                placeholder="Search or type vendor name"
                required
              />
            </div>

            <div>
              <label className="label">Vendor Contact Person Name</label>
              <input
                className="input-field"
                value={form.vendor_contact_name}
                onChange={e => set('vendor_contact_name', e.target.value)}
                placeholder="Auto-fills from vendor"
              />
            </div>

            <div>
              <label className="label">Vendor Phone Number</label>
              <input
                type="tel"
                className="input-field"
                value={form.vendor_phone_number}
                onChange={e => set('vendor_phone_number', e.target.value)}
                placeholder="Auto-fills from vendor"
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
