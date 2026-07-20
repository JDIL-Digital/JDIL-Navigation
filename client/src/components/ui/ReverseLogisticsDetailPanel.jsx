import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { calcReverseLogisticsStatus, formatDate } from '../../utils/helpers'
import { canEditRLField } from '../../utils/fieldPermissions'
import {
  DISPATCH_LOCATION_OPTIONS, LOCATION_OPTIONS_NO_RIG, RIG_DISPATCH_OPTIONS,
  TRANSPORT_MODES, LOGISTICS_TEAM_CODES, RIG_REMARKS_OPTIONS,
} from '../../utils/constants'
import VendorAutocomplete from './VendorAutocomplete'

// DC field ↔ logistics team code visibility (same rule as Local Purchase)
const DC_TEAM_MAP = {
  'SV-01': 'jdil_in_dc_bkc', 'SS-02': 'jdil_in_dc_bkc',
  'AK-03': 'jdil_in_dc_taloja', 'KT-04': 'jdil_in_dc_taloja',
  'MK-05': 'jdil_in_dc_nhava', 'RS-06': 'jdil_in_dc_nagothane',
}
const DC_FIELDS = new Set(['jdil_in_dc_bkc', 'jdil_in_dc_taloja', 'jdil_in_dc_nhava', 'jdil_in_dc_nagothane'])

// Sections. `types` = job types that show the section.
const SECTIONS = [
  { key: 's1', label: 'Rig Dispatch', types: ['Repair', 'Return', 'Replacement'], fields: [
    { key: 'mr_number', label: 'MR Number', type: 'text' },   // read-only (create-only)
    { key: 'po_number', label: 'PO Number', type: 'text' },   // read-only (create-only)
    { key: 'material_description_2', label: 'Material Description 2', type: 'textarea' },
    { key: 'rig_dispatch_date',     label: 'Rig Dispatch Date',      type: 'date' },
    { key: 'rig_dispatch_location', label: 'Rig Dispatch Location',  type: 'select', options: DISPATCH_LOCATION_OPTIONS },
    { key: 'rig_mode_of_transport', label: 'Mode of Transport',      type: 'select', options: TRANSPORT_MODES },
  ]},
  { key: 's2', label: 'Logistics — Inbound from Rig', types: ['Repair', 'Return', 'Replacement'], fields: [
    { key: 'jdil_in_logistics_code',   label: 'Logistics Code',           type: 'logistics_code' },
    { key: 'jdil_in_received_date',    label: 'Material Received Date',   type: 'date' },
    { key: 'jdil_in_received_location',label: 'Material Received Location',type: 'select', options: LOCATION_OPTIONS_NO_RIG },
    { key: 'jdil_in_dispatch_date',    label: 'Material Dispatch Date',   type: 'date' },
    { key: 'jdil_in_dispatch_location',label: 'Material Dispatch Location',type: 'select', options: DISPATCH_LOCATION_OPTIONS },
    { key: 'jdil_in_dc_bkc',           label: 'DC Number (BKC)',          type: 'text' },
    { key: 'jdil_in_dc_taloja',        label: 'DC Number (Taloja)',       type: 'text' },
    { key: 'jdil_in_dc_nhava',         label: 'DC Number (Nhava)',        type: 'text' },
    { key: 'jdil_in_dc_nagothane',     label: 'DC Number (Nagothane)',    type: 'text' },
    { key: 'jdil_in_mode_of_transport',label: 'Mode of Transport',        type: 'select', options: TRANSPORT_MODES },
    { key: 'jdil_in_remarks',          label: 'Remarks',                  type: 'textarea' },
  ]},
  { key: 's3', label: 'Vendor — Received', types: ['Repair', 'Return', 'Replacement'], fields: [
    { key: 'vendor_name',          label: 'Vendor Name',    type: 'vendor' },
    { key: 'vendor_contact',       label: 'Vendor Contact', type: 'text' },
    { key: 'vendor_phone',         label: 'Vendor Phone',   type: 'text' },
    { key: 'vendor_received_date', label: 'Vendor Received Date', type: 'date' },
  ]},
  { key: 's4', label: 'Vendor — Ship Back', types: ['Repair', 'Replacement'], fields: [
    { key: 'repair_description',      label: 'Repair Description',     type: 'textarea' },
    { key: 'expected_return_date',    label: 'Expected Return Date',   type: 'date' },
    { key: 'vendor_dispatch_date',    label: 'Vendor Dispatch Date',   type: 'date' },
    { key: 'vendor_dispatch_location',label: 'Vendor Dispatch Location',type: 'select', options: LOCATION_OPTIONS_NO_RIG },
    { key: 'vendor_mode_of_transport',label: 'Mode of Transport',      type: 'select', options: TRANSPORT_MODES },
  ]},
  { key: 's5', label: 'Logistics — Outbound to Rig', types: ['Repair', 'Replacement'], fields: [
    { key: 'jdil_out_received_date',    label: 'Material Received Date',    type: 'date' },
    { key: 'jdil_out_received_location',label: 'Material Received Location', type: 'select', options: LOCATION_OPTIONS_NO_RIG },
    { key: 'jdil_out_dispatch_date',    label: 'Material Dispatch Date',    type: 'date' },
    { key: 'jdil_out_dispatch_location',label: 'Material Dispatch Location', type: 'select', options: RIG_DISPATCH_OPTIONS },
    { key: 'jdil_out_dc_number',        label: 'DC Number',                 type: 'text' },
    { key: 'jdil_out_mode_of_transport',label: 'Mode of Transport',         type: 'select', options: TRANSPORT_MODES },
  ]},
  { key: 's6', label: 'Rig Receives', types: ['Repair', 'Replacement'], fields: [
    { key: 'rig_received_date', label: 'Rig Received Date', type: 'date' },
    { key: 'rig_remarks',       label: 'Remarks',           type: 'select', options: RIG_REMARKS_OPTIONS },
    { key: 'rig_other_remarks', label: 'Other Remarks',     type: 'textarea' },
  ]},
]

function LockIcon() {
  return <svg className="w-3 h-3 text-gray-400 dark:text-gray-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
}

export default function ReverseLogisticsDetailPanel({ job, onClose, onSave }) {
  const { profile } = useAuth()
  const role = profile?.role
  const teamCode = profile?.team_code

  const [form, setForm] = useState({ ...job })
  const [pending, setPending] = useState({})
  const [origItems, setOrigItems] = useState([])   // last-loaded from server
  const [items, setItems] = useState([])            // editable working copy
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [itemsSaving, setItemsSaving] = useState(false)
  const [itemsMsg, setItemsMsg] = useState('')
  const [failOpen, setFailOpen] = useState(false)
  const [failReason, setFailReason] = useState('')

  useEffect(() => { setForm({ ...job }); setPending({}) }, [job])

  async function loadItems() {
    const { data } = await supabase.from('reverse_logistics_line_items')
      .select('*').eq('job_id', job.id).order('created_at', { ascending: true })
    setOrigItems(data || [])
    setItems((data || []).map(it => ({ ...it })))
  }

  useEffect(() => {
    if (job?.id) { setItemsMsg(''); loadItems() }
    // Auto-fill logistics code for logistics users when empty
    if (role === 'logistics' && teamCode && !job?.jdil_in_logistics_code) {
      setForm(f => ({ ...f, jdil_in_logistics_code: teamCode }))
      setPending(p => ({ ...p, jdil_in_logistics_code: teamCode }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id])

  const canEditItems = ['rig', 'purchase', 'admin'].includes(role)
  const canEdit = k => canEditRLField(role, k)

  // ── Line-item editing helpers ────────────────────────────────────────────
  function setItemField(idx, key, val) {
    setItems(arr => arr.map((it, i) => i === idx ? { ...it, [key]: val } : it))
  }
  function addItemRow() {
    setItems(arr => [...arr, { item_name: '', material_description: '', quantity: '', unit: '', remarks: '' }])
  }
  function removeItemRow(idx) {
    setItems(arr => arr.filter((_, i) => i !== idx))
  }

  async function saveItems() {
    setItemsSaving(true); setItemsMsg(''); setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` }
      const currentIds = new Set(items.filter(it => it.id).map(it => it.id))
      const toDelete = origItems.filter(o => !currentIds.has(o.id))
      const toCreate = items.filter(it => !it.id && it.item_name?.trim())
      const toUpdate = items.filter(it => {
        if (!it.id) return false
        const orig = origItems.find(o => o.id === it.id)
        if (!orig) return false
        return ['item_name', 'material_description', 'quantity', 'unit', 'remarks']
          .some(k => String(it[k] ?? '') !== String(orig[k] ?? ''))
      })

      for (const d of toDelete) {
        const r = await fetch(`/api/rl/items/${d.id}`, { method: 'DELETE', headers: auth })
        if (!r.ok) throw new Error((await r.json()).error || 'Delete failed')
      }
      for (const u of toUpdate) {
        const r = await fetch(`/api/rl/items/${u.id}`, { method: 'PATCH', headers: auth,
          body: JSON.stringify({ item_name: u.item_name, material_description: u.material_description, quantity: Number(u.quantity) || 0, unit: u.unit, remarks: u.remarks }) })
        if (!r.ok) throw new Error((await r.json()).error || 'Update failed')
      }
      if (toCreate.length) {
        const r = await fetch(`/api/rl/jobs/${job.id}/items`, { method: 'POST', headers: auth,
          body: JSON.stringify({ items: toCreate.map(it => ({ item_name: it.item_name.trim(), material_description: it.material_description || null, quantity: Number(it.quantity) || 0, unit: it.unit || null, remarks: it.remarks || null })) }) })
        if (!r.ok) throw new Error((await r.json()).error || 'Create failed')
      }
      await loadItems()
      setItemsMsg('Line items saved.')
    } catch (e) {
      setError(`Line items: ${e.message}`)
    }
    setItemsSaving(false)
  }
  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setPending(p => ({ ...p, [k]: v })) }

  function showDC(fieldKey) {
    if (!DC_FIELDS.has(fieldKey)) return true
    if (role !== 'logistics' || !teamCode) return true
    const allowed = DC_TEAM_MAP[teamCode]
    return allowed ? fieldKey === allowed : true
  }

  const status = calcReverseLogisticsStatus(form)
  const visibleSections = SECTIONS.filter(s => s.types.includes(job.job_type))
  const canSave = role === 'admin' || ['rig', 'logistics', 'purchase'].includes(role)
  const hasPending = Object.keys(pending).length > 0

  async function doSave() {
    const safe = Object.fromEntries(Object.entries(pending).filter(([k]) => canEdit(k)))
    if (Object.keys(safe).length === 0) { onClose(); return }
    setSaving(true); setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch(`/api/rl/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ fields: safe }),
      })
      const result = await resp.json()
      if (!resp.ok) { setError(result.error || 'Save failed'); setSaving(false); return }
      setPending({}); onSave?.()
    } catch (err) { setError(`Network error: ${err.message}`) }
    setSaving(false)
  }

  async function doMarkFailed() {
    if (!failReason.trim()) return
    setSaving(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch(`/api/rl/jobs/${job.id}/mark-failed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ reason: failReason.trim() }),
      })
      const result = await resp.json()
      if (!resp.ok) { setError(result.error || 'Failed'); setSaving(false); return }
      setFailOpen(false); onSave?.()
    } catch (err) { setError(`Network error: ${err.message}`) }
    setSaving(false)
  }

  function renderField(f) {
    if (!showDC(f.key)) return null
    const wide = f.type === 'textarea'
    const editable = canEdit(f.key)
    if (!editable) {
      const val = f.type === 'date' ? formatDate(form[f.key]) : (form[f.key] || '')
      return (
        <div key={f.key} className={wide ? 'sm:col-span-2' : ''}>
          <label className="flex items-center gap-1.5 text-sm font-medium text-gray-500 mb-1">{f.label}<LockIcon /></label>
          <div className="w-full px-3 py-2 rounded-lg border border-dashed border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/30 text-sm text-gray-400 min-h-[36px]">{val || '—'}</div>
        </div>
      )
    }
    return (
      <div key={f.key} className={wide ? 'sm:col-span-2' : ''}>
        <label className="label">{f.label}</label>
        {f.key === 'vendor_name' ? (
          <VendorAutocomplete value={form.vendor_name || ''} onChange={v => set('vendor_name', v)}
            onSelect={v => { set('vendor_name', v.name); if (v.contact_person && canEdit('vendor_contact')) set('vendor_contact', v.contact_person); if (v.phone && canEdit('vendor_phone')) set('vendor_phone', v.phone) }}
            placeholder="Search or type vendor name" />
        ) : f.type === 'logistics_code' ? (
          role === 'admin' ? (
            <select className="input-field" value={form.jdil_in_logistics_code || ''} onChange={e => set('jdil_in_logistics_code', e.target.value)}>
              <option value="">—</option>{LOGISTICS_TEAM_CODES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          ) : (
            <div className="input-field flex items-center justify-between bg-gray-50 dark:bg-gray-800/40 text-gray-700 dark:text-gray-300 cursor-not-allowed select-none">
              <span>{form.jdil_in_logistics_code || teamCode || '—'}</span><LockIcon />
            </div>
          )
        ) : f.type === 'select' ? (
          <select className="input-field" value={form[f.key] || ''} onChange={e => set(f.key, e.target.value)}>
            <option value="">—</option>{f.options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : f.type === 'textarea' ? (
          <textarea rows={2} className="input-field resize-none" value={form[f.key] || ''} onChange={e => set(f.key, e.target.value)} />
        ) : (
          <input type={f.type} className="input-field" value={form[f.key] || ''} onChange={e => set(f.key, e.target.value)} />
        )}
      </div>
    )
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="panel-slide z-50">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">{job.po_number || job.job_number || 'RL Job'}</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">{job.job_type} · MR {job.mr_number || '—'} · {job.rig_name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Status bar */}
        <div className="px-5 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
          <span className={`status-pill ${status === 'Failed' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'}`}>{status}</span>
          {['purchase', 'admin'].includes(role) && status !== 'Failed' && (
            <button onClick={() => setFailOpen(true)} className="text-xs font-medium text-red-600 dark:text-red-400 border border-red-300 dark:border-red-800 rounded-lg px-2.5 py-1 hover:bg-red-50 dark:hover:bg-red-900/20">
              Mark as Failed
            </button>
          )}
        </div>

        {/* Sections */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Line Items ({items.length})</h3>
              {canEditItems && (
                <div className="flex items-center gap-2">
                  <button onClick={addItemRow} className="text-xs font-medium text-jdil-green hover:text-green-700 flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>Add Item
                  </button>
                  <button onClick={saveItems} disabled={itemsSaving} className="btn-primary text-xs py-1 px-2.5 flex items-center gap-1.5 disabled:opacity-60">
                    {itemsSaving && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                    {itemsSaving ? 'Saving…' : 'Save Items'}
                  </button>
                </div>
              )}
            </div>

            {canEditItems ? (
              <div className="space-y-2">
                {items.map((it, idx) => (
                  <div key={it.id || `new-${idx}`} className="grid grid-cols-12 gap-2 items-start bg-gray-50 dark:bg-gray-800/40 rounded-lg p-2.5 border border-gray-200 dark:border-gray-700">
                    <div className="col-span-12 sm:col-span-3"><input className="input-field text-sm" value={it.item_name || ''} onChange={e => setItemField(idx, 'item_name', e.target.value)} placeholder="Item name *" /></div>
                    <div className="col-span-12 sm:col-span-3"><input className="input-field text-sm" value={it.material_description || ''} onChange={e => setItemField(idx, 'material_description', e.target.value)} placeholder="Description" /></div>
                    <div className="col-span-4 sm:col-span-2"><input type="number" min="0" step="any" className="input-field text-sm" value={it.quantity ?? ''} onChange={e => setItemField(idx, 'quantity', e.target.value)} placeholder="Qty" /></div>
                    <div className="col-span-3 sm:col-span-1"><input className="input-field text-sm" value={it.unit || ''} onChange={e => setItemField(idx, 'unit', e.target.value)} placeholder="Unit" /></div>
                    <div className="col-span-4 sm:col-span-2"><input className="input-field text-sm" value={it.remarks || ''} onChange={e => setItemField(idx, 'remarks', e.target.value)} placeholder="Remarks" /></div>
                    <div className="col-span-1 flex justify-center pt-1.5">
                      <button onClick={() => removeItemRow(idx)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" title="Remove">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </div>
                ))}
                {items.length === 0 && <p className="text-sm text-gray-400 italic">No line items. Use “Add Item”.</p>}
                {itemsMsg && <p className="text-xs text-green-600 dark:text-green-400">{itemsMsg}</p>}
              </div>
            ) : items.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[320px]">
                  <thead><tr className="border-b border-gray-200 dark:border-gray-700 text-xs text-gray-500"><th className="text-left py-1.5 pr-2">Item</th><th className="text-center py-1.5 px-2">Qty</th><th className="text-left py-1.5 px-2">Unit</th><th className="text-left py-1.5 pl-2">Remarks</th></tr></thead>
                  <tbody>{items.map(it => (
                    <tr key={it.id} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-1.5 pr-2"><p className="font-medium text-gray-800 dark:text-gray-200">{it.item_name}</p>{it.material_description && <p className="text-xs text-gray-400">{it.material_description}</p>}</td>
                      <td className="text-center py-1.5 px-2 text-gray-600 dark:text-gray-400">{it.quantity}</td>
                      <td className="py-1.5 px-2 text-gray-600 dark:text-gray-400">{it.unit || '—'}</td>
                      <td className="py-1.5 pl-2 text-gray-600 dark:text-gray-400">{it.remarks || '—'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">No line items.</p>
            )}
          </div>

          {visibleSections.map(section => (
            <div key={section.key}>
              <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">{section.label}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {section.fields.map(renderField)}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        {canSave && (
          <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-800 space-y-2">
            {error && <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2 break-words">{error}</p>}
            <div className="flex gap-3">
              <button onClick={onClose} className="btn-secondary flex-1">Close</button>
              <button onClick={doSave} disabled={saving || !hasPending} className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50">
                {saving && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {saving ? 'Saving…' : `Save Changes${hasPending ? ` (${Object.keys(pending).length})` : ''}`}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Mark as Failed modal */}
      {failOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 p-6 w-full max-w-sm">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">Mark Job as Failed</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Provide a reason — it will be appended to Other Remarks.</p>
            <textarea className="input-field resize-none mb-4" rows={3} placeholder="Reason for failure…" value={failReason} onChange={e => setFailReason(e.target.value)} autoFocus />
            <div className="flex gap-3">
              <button onClick={() => { setFailOpen(false); setFailReason('') }} className="btn-secondary flex-1">Cancel</button>
              <button onClick={doMarkFailed} disabled={!failReason.trim() || saving} className="flex-1 px-4 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-60">
                {saving ? 'Saving…' : 'Confirm Failed'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
