import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { PO_RIG_OPTIONS, DISPATCH_LOCATION_OPTIONS, TRANSPORT_MODES } from '../../utils/constants'

function emptyItem() {
  return { item_name: '', material_description: '', quantity: '', unit: '' }
}

function draftKey(type) { return `jdil-new-rl-${type}-draft` }

export default function NewReverseLogisticsJobPanel({ jobType, onClose, onCreated }) {
  const KEY = draftKey(jobType)

  const [form, setForm] = useState(() => {
    try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw) } catch { /* ignore */ }
    return {
      mr_number: '', po_number: '', rig_name: '', material_description_2: '',
      rig_dispatch_date: '', rig_dispatch_location: '', rig_mode_of_transport: '',
      line_items: [emptyItem()],
    }
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(form)) } catch { /* ignore */ } }, [KEY, form])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const items = Array.isArray(form.line_items) ? form.line_items : [emptyItem()]
  const setItem = (i, k, v) => setForm(f => {
    const arr = [...(f.line_items || [])]; arr[i] = { ...arr[i], [k]: v }; return { ...f, line_items: arr }
  })
  const addItem = () => setForm(f => ({ ...f, line_items: [...(f.line_items || []), emptyItem()] }))
  const removeItem = i => setForm(f => {
    const arr = (f.line_items || []).filter((_, idx) => idx !== i); return { ...f, line_items: arr.length ? arr : [emptyItem()] }
  })

  async function handleCreate(e) {
    e.preventDefault()
    setError('')
    if (!form.mr_number.trim())  { setError('MR Number is required.'); return }
    if (!form.po_number.trim())  { setError('PO Number is required.'); return }
    if (!form.rig_name)          { setError('Rig Name is required.'); return }
    const validItems = items.filter(it => it.item_name && it.item_name.trim())
    if (validItems.length === 0) { setError('At least one line item is required.'); return }

    setSaving(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch('/api/rl/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          job_type: jobType,
          mr_number: form.mr_number.trim(),
          po_number: form.po_number.trim(),
          rig_name: form.rig_name,
          material_description_2: form.material_description_2 || null,
          rig_dispatch_date: form.rig_dispatch_date || null,
          rig_dispatch_location: form.rig_dispatch_location || null,
          rig_mode_of_transport: form.rig_mode_of_transport || null,
          line_items: validItems.map(it => ({
            item_name: it.item_name.trim(),
            material_description: it.material_description?.trim() || null,
            quantity: Number(it.quantity) || 0,
            unit: it.unit?.trim() || null,
          })),
        }),
      })
      const result = await resp.json()
      if (!resp.ok) { setError(result.error || 'Create failed'); setSaving(false); return }
      localStorage.removeItem(KEY)
      onCreated?.()
      onClose()
    } catch (err) {
      setError(`Network error: ${err.message}`)
    }
    setSaving(false)
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 pointer-events-none" />
      <div className="panel-slide z-50">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">New {jobType} Job</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">Reverse Logistics · {jobType}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500" title="Close (draft saved)">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <form onSubmit={handleCreate} className="flex-1 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Job Type</label>
              <div className="input-field bg-gray-50 dark:bg-gray-800/40 text-gray-700 dark:text-gray-300 cursor-not-allowed select-none">{jobType}</div>
            </div>
            <div />
            <div>
              <label className="label">MR Number <span className="text-red-500">*</span></label>
              <input className="input-field" value={form.mr_number} onChange={e => set('mr_number', e.target.value)} placeholder="Enter MR number" required />
            </div>
            <div>
              <label className="label">PO Number <span className="text-red-500">*</span></label>
              <input className="input-field" value={form.po_number} onChange={e => set('po_number', e.target.value)} placeholder="Enter PO number" required />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Rig Name <span className="text-red-500">*</span></label>
              <select className="input-field" value={form.rig_name} onChange={e => set('rig_name', e.target.value)} required>
                <option value="">Select rig / location…</option>
                {PO_RIG_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>

          {/* Line Items */}
          <div className="mt-6">
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">Line Items <span className="text-red-500">*</span></label>
              <button type="button" onClick={addItem} className="text-xs font-medium text-jdil-green hover:text-green-700 flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>Add Item
              </button>
            </div>
            <div className="space-y-2">
              {items.map((it, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-start bg-gray-50 dark:bg-gray-800/40 rounded-lg p-2.5 border border-gray-200 dark:border-gray-700">
                  <div className="col-span-12 sm:col-span-4"><input className="input-field text-sm" value={it.item_name} onChange={e => setItem(idx, 'item_name', e.target.value)} placeholder="Item name *" /></div>
                  <div className="col-span-12 sm:col-span-4"><input className="input-field text-sm" value={it.material_description} onChange={e => setItem(idx, 'material_description', e.target.value)} placeholder="Material description" /></div>
                  <div className="col-span-5 sm:col-span-2"><input type="number" min="0" step="any" className="input-field text-sm" value={it.quantity} onChange={e => setItem(idx, 'quantity', e.target.value)} placeholder="Qty" /></div>
                  <div className="col-span-5 sm:col-span-1"><input className="input-field text-sm" value={it.unit} onChange={e => setItem(idx, 'unit', e.target.value)} placeholder="Unit" /></div>
                  <div className="col-span-2 sm:col-span-1 flex justify-center pt-1.5">
                    <button type="button" onClick={() => removeItem(idx)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" title="Remove">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Dispatch details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
            <div className="sm:col-span-2">
              <label className="label">Material Description 2</label>
              <textarea rows={2} className="input-field resize-none" value={form.material_description_2} onChange={e => set('material_description_2', e.target.value)} placeholder="Additional description (optional)" />
            </div>
            <div>
              <label className="label">Rig Dispatch Date</label>
              <input type="date" className="input-field" value={form.rig_dispatch_date} onChange={e => set('rig_dispatch_date', e.target.value)} />
            </div>
            <div>
              <label className="label">Rig Dispatch Location</label>
              <select className="input-field" value={form.rig_dispatch_location} onChange={e => set('rig_dispatch_location', e.target.value)}>
                <option value="">Select…</option>
                {DISPATCH_LOCATION_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Mode of Transport</label>
              <select className="input-field" value={form.rig_mode_of_transport} onChange={e => set('rig_mode_of_transport', e.target.value)}>
                <option value="">Select…</option>
                {TRANSPORT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          {error && <div className="mt-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm rounded-lg px-4 py-3 break-words">{error}</div>}
        </form>

        <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-800 flex gap-3">
          <button type="button" onClick={() => { localStorage.removeItem(KEY); onClose() }} className="btn-secondary flex-1">Cancel</button>
          <button onClick={handleCreate} disabled={saving} className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-60">
            {saving && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {saving ? 'Creating…' : `Create ${jobType} Job`}
          </button>
        </div>
      </div>
    </>
  )
}
