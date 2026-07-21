import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../utils/helpers'
import { PO_RIG_OPTIONS, DISPATCH_LOCATION_OPTIONS, TRANSPORT_MODES } from '../../utils/constants'

function emptyItem() {
  return { item_name: '', material_description: '', quantity: '', unit: '' }
}
function draftKey(type) { return `jdil-new-rl-${type}-draft` }

function emptyForm() {
  return {
    mr_number: '', po_number: '', rig_name: '',
    vendor_name: '', vendor_contact: '', vendor_phone: '',
    material_description_2: '',
    rig_dispatch_date: '', rig_dispatch_location: '', rig_mode_of_transport: '',
    line_items: [emptyItem()],
  }
}

export default function NewReverseLogisticsJobPanel({ jobType, onClose, onCreated }) {
  const KEY = draftKey(jobType)

  const [mode, setMode] = useState('search')          // 'search' | 'manual'
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [selectedPO, setSelectedPO] = useState(null)   // { ...po, line_items }
  const [selectedItem, setSelectedItem] = useState(null)
  const [qty, setQty] = useState(1)

  const [form, setForm] = useState(() => {
    try { const raw = localStorage.getItem(KEY); if (raw) return { ...emptyForm(), ...JSON.parse(raw) } } catch { /* ignore */ }
    return emptyForm()
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  const debounceRef = useRef(null)

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(form)) } catch { /* ignore */ } }, [KEY, form])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const items = Array.isArray(form.line_items) ? form.line_items : [emptyItem()]
  const setItem = (i, k, v) => setForm(f => { const arr = [...(f.line_items || [])]; arr[i] = { ...arr[i], [k]: v }; return { ...f, line_items: arr } })
  const addItem = () => setForm(f => ({ ...f, line_items: [...(f.line_items || []), emptyItem()] }))
  const removeItem = i => setForm(f => { const arr = (f.line_items || []).filter((_, idx) => idx !== i); return { ...f, line_items: arr.length ? arr : [emptyItem()] } })

  const linked = mode === 'search' && !!selectedPO && !!selectedItem

  // ── Debounced delivered-PO search ──────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'search' || selectedPO) return
    const q = query.trim()
    if (q.length < 2) { setResults([]); return }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const resp = await fetch(`/api/po/search-delivered?q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${session?.access_token}` } })
        if (resp.ok) setResults(await resp.json())
      } catch (e) { console.warn('PO search failed:', e) }
      setSearching(false)
    }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [query, mode, selectedPO])

  function pickPO(po) {
    setSelectedPO(po)
    setResults([])
    // Pre-fill identifiers + vendor from the source PO
    setForm(f => ({
      ...f,
      mr_number: po.mr_number || '',
      po_number: po.po_number || '',
      rig_name: po.rig_name || '',
      vendor_name: po.vendor_name || '',
      vendor_contact: po.vendor_contact_name || '',
      vendor_phone: po.vendor_phone_number || '',
      material_description_2: po.material_description_2 || '',
    }))
    // No recorded line items → auto-generate a virtual one from the material
    // description and skip straight to the quantity/form step.
    if (!po.line_items || po.line_items.length === 0) {
      const name = (po.material_description_2 && po.material_description_2.trim()) || 'Material'
      pickItem({ id: null, _virtual: true, item_name: name, material_description: po.material_description_2 || '', unit: 'pcs', quantity_ordered: null })
    } else {
      setSelectedItem(null)
    }
  }

  function pickItem(it) {
    setSelectedItem(it)
    const q = 1
    setQty(q)
    setForm(f => ({ ...f, line_items: [{ item_name: it.item_name, material_description: it.material_description || '', quantity: q, unit: it.unit || 'pcs' }] }))
  }

  function changeQty(v) {
    // Virtual (auto-generated) items have no original quantity → no max.
    const max = selectedItem?._virtual ? Infinity : (Number(selectedItem?.quantity_ordered) || 999999)
    let n = Number(v)
    if (Number.isNaN(n) || n < 1) n = 1
    if (n > max) n = max
    setQty(n)
    setForm(f => ({ ...f, line_items: [{ ...(f.line_items?.[0] || {}), quantity: n }] }))
  }

  function goManual() {
    setMode('manual')
    setSelectedPO(null)
    setSelectedItem(null)
    setResults([])
    setForm(emptyForm())
  }
  function backToSearch() {
    setMode('search')
    setForm(emptyForm())
  }

  async function handleCreate(e) {
    e?.preventDefault?.()
    setError('')
    if (!form.mr_number.trim()) { setError('MR Number is required.'); return }
    if (!form.po_number.trim()) { setError('PO Number is required.'); return }
    if (!form.rig_name)         { setError('Rig Name is required.'); return }
    const validItems = items.filter(it => it.item_name && it.item_name.trim())
    if (validItems.length === 0) { setError('At least one line item is required.'); return }

    setSaving(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const payload = {
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
      }
      if (linked) {
        payload.vendor_name = form.vendor_name || null
        payload.vendor_contact = form.vendor_contact || null
        payload.vendor_phone = form.vendor_phone || null
        payload.source_po_id = selectedPO.id
        payload.source_line_item_id = selectedItem._virtual ? null : selectedItem.id
        payload.is_external_item = false
      } else {
        payload.is_external_item = true
      }

      const resp = await fetch('/api/rl/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify(payload),
      })
      const result = await resp.json()
      if (!resp.ok) { setError(result.error || 'Create failed'); setSaving(false); return }
      localStorage.removeItem(KEY)
      onCreated?.()
      onClose()
    } catch (err) { setError(`Network error: ${err.message}`) }
    setSaving(false)
  }

  const readonlyBox = 'input-field bg-gray-50 dark:bg-gray-800/40 text-gray-700 dark:text-gray-300 cursor-not-allowed select-none flex items-center gap-1.5'
  const Lock = () => <svg className="w-3 h-3 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>

  // Shared editable tail — Rig, Material Description 2, Dispatch fields
  const tail = (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
      <div className="sm:col-span-2">
        <label className="label">Rig Name <span className="text-red-500">*</span>{linked && <span className="ml-1.5 text-xs font-normal text-gray-400">(from PO — editable for inter-rig transfer)</span>}</label>
        <select className="input-field" value={form.rig_name} onChange={e => set('rig_name', e.target.value)} required>
          <option value="">Select rig / location…</option>
          {PO_RIG_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className="label">Material Description 2</label>
        <textarea rows={2} className="input-field resize-none" value={form.material_description_2} onChange={e => set('material_description_2', e.target.value)} placeholder="Additional details (e.g. cracked casing)" />
      </div>
      <div>
        <label className="label">Rig Dispatch Date</label>
        <input type="date" className="input-field" value={form.rig_dispatch_date} onChange={e => set('rig_dispatch_date', e.target.value)} />
      </div>
      <div>
        <label className="label">Rig Dispatch Location</label>
        <select className="input-field" value={form.rig_dispatch_location} onChange={e => set('rig_dispatch_location', e.target.value)}>
          <option value="">Select…</option>{DISPATCH_LOCATION_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Mode of Transport</label>
        <select className="input-field" value={form.rig_mode_of_transport} onChange={e => set('rig_mode_of_transport', e.target.value)}>
          <option value="">Select…</option>{TRANSPORT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
    </div>
  )

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 pointer-events-none" />
      <div className="panel-slide z-50">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">New {jobType} Job</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">Reverse Logistics · {jobType}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500" title="Close (draft saved)">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-4">
            <label className="label">Job Type</label>
            <div className="input-field bg-gray-50 dark:bg-gray-800/40 text-gray-700 dark:text-gray-300 cursor-not-allowed select-none">{jobType}</div>
          </div>

          {/* ══ MANUAL MODE ══ */}
          {mode === 'manual' && (
            <>
              <div className="mb-4 flex items-center justify-between gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 text-amber-800 dark:text-amber-300 text-xs rounded-lg px-3 py-2.5">
                <span>⚠ External item — no link to original PO</span>
                <button type="button" onClick={backToSearch} className="shrink-0 font-medium text-jdil-green hover:text-jdil-green-dark">← Search original PO instead</button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">MR Number <span className="text-red-500">*</span></label>
                  <input className="input-field" value={form.mr_number} onChange={e => set('mr_number', e.target.value)} placeholder="Enter MR number" required />
                </div>
                <div>
                  <label className="label">PO Number <span className="text-red-500">*</span></label>
                  <input className="input-field" value={form.po_number} onChange={e => set('po_number', e.target.value)} placeholder="Enter PO number" required />
                </div>
              </div>

              {/* Manual multi-row line items */}
              <div className="mt-4">
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
              {tail}
            </>
          )}

          {/* ══ SEARCH MODE — step 1: search ══ */}
          {mode === 'search' && !selectedPO && (
            <div>
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Search original PO (recommended)</p>
              <div className="relative">
                <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                <input className="input-field pl-9" placeholder="Search by PO number, MR number, or vendor name..." value={query} onChange={e => setQuery(e.target.value)} autoFocus />
                {searching && <div className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 border-2 border-gray-300 border-t-jdil-green rounded-full animate-spin" />}
              </div>

              {results.length > 0 && (
                <ul className="mt-1 border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
                  {results.map(po => (
                    <li key={po.id}>
                      <button type="button" onClick={() => pickPO(po)} className="w-full text-left px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{po.po_number} · {po.rig_name}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                          {po.vendor_name || '—'} · Delivered {formatDate(po.delivered_to_rig_date)}
                          {(po.material_description || po.material_description_2) ? ` · ${po.material_description || po.material_description_2}` : ''}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {query.trim().length >= 2 && !searching && results.length === 0 && (
                <p className="text-xs text-gray-400 mt-2">No delivered POs match “{query.trim()}”.</p>
              )}

              <button type="button" onClick={goManual} className="mt-3 text-sm text-jdil-green hover:text-jdil-green-dark font-medium">
                + Add manually if not found
              </button>
            </div>
          )}

          {/* ══ SEARCH MODE — step 2: pick line item ══ */}
          {mode === 'search' && selectedPO && (
            <div>
              <div className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700/50 rounded-lg px-3 py-2 mb-4">
                <span className="text-sm text-green-700 dark:text-green-400 font-medium">✓ Selected: {selectedPO.po_number} · {selectedPO.rig_name}</span>
                <button type="button" onClick={() => { setSelectedPO(null); setSelectedItem(null) }} className="text-xs font-medium text-gray-500 hover:text-jdil-green">Change</button>
              </div>

              {!selectedItem ? (
                <>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Which line item are you sending?</p>
                  {(selectedPO.line_items || []).length === 0 ? (
                    <p className="text-xs text-gray-400">This PO has no recorded line items. <button type="button" onClick={goManual} className="text-jdil-green font-medium">Add manually</button>.</p>
                  ) : (
                    <div className="space-y-2">
                      {selectedPO.line_items.map(it => (
                        <button key={it.id} type="button" onClick={() => pickItem(it)} className="w-full text-left px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-jdil-green/50 hover:bg-jdil-green/5">
                          <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{it.item_name}</p>
                          <p className="text-xs text-gray-400 dark:text-gray-500">Original Qty: {it.quantity_ordered} {it.unit || ''}{it.material_description ? ` · ${it.material_description}` : ''}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700/50 rounded-lg px-3 py-2 mb-2">
                    <span className="text-sm text-green-700 dark:text-green-400 font-medium">✓ Item: {selectedItem.item_name}</span>
                    {!selectedItem._virtual && (
                      <button type="button" onClick={() => setSelectedItem(null)} className="text-xs font-medium text-gray-500 hover:text-jdil-green">Change</button>
                    )}
                  </div>

                  {selectedItem._virtual && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">ℹ Line item auto-generated from material description. You can adjust below.</p>
                  )}

                  <div className="mb-4">
                    <label className="label">
                      How many are you sending?
                      {!selectedItem._virtual && <span className="text-xs font-normal text-gray-400"> (max {selectedItem.quantity_ordered} {selectedItem.unit || ''})</span>}
                    </label>
                    <input type="number" min="1" max={selectedItem._virtual ? undefined : (selectedItem.quantity_ordered || undefined)} className="input-field w-32" value={qty} onChange={e => changeQty(e.target.value)} />
                  </div>

                  {/* Pre-filled identifiers + vendor */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="label">MR Number</label>
                      <div className={readonlyBox}>{form.mr_number || '—'}<Lock /></div>
                    </div>
                    <div>
                      <label className="label">PO Number</label>
                      <div className={readonlyBox}>{form.po_number || '—'}<Lock /></div>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="label">Vendor Name</label>
                      <div className={readonlyBox}>{form.vendor_name || '—'}<Lock /></div>
                    </div>
                    <div>
                      <label className="label">Vendor Contact</label>
                      <input className="input-field" value={form.vendor_contact} onChange={e => set('vendor_contact', e.target.value)} placeholder="Contact person" />
                    </div>
                    <div>
                      <label className="label">Vendor Phone</label>
                      <input className="input-field" value={form.vendor_phone} onChange={e => set('vendor_phone', e.target.value)} placeholder="Phone" />
                    </div>
                  </div>
                  {tail}
                </>
              )}
            </div>
          )}

          {error && <div className="mt-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm rounded-lg px-4 py-3 break-words">{error}</div>}
        </div>

        {/* Footer — Create shown once enough is filled (manual, or linked with item) */}
        <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-800 flex gap-3">
          <button type="button" onClick={() => { localStorage.removeItem(KEY); onClose() }} className="btn-secondary flex-1">Cancel</button>
          <button
            onClick={handleCreate}
            disabled={saving || (mode === 'search' && !linked)}
            className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {saving && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {saving ? 'Creating…' : `Create ${jobType} Job`}
          </button>
        </div>
      </div>
    </>
  )
}
