import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { parseSpreadsheet } from '../../utils/loadXlsx'

// ── API helper (Express /api/vendors with JWT) ────────────────────────────────
async function vendorApi(path = '', method = 'GET', body = undefined) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`/api/vendors${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Request failed')
  return json
}

// ── Add / Edit modal ──────────────────────────────────────────────────────────
function VendorModal({ vendor, onClose, onSaved }) {
  const isEdit = !!vendor?.id
  const [name, setName]         = useState(vendor?.name ?? '')
  const [phone, setPhone]       = useState(vendor?.phone ?? '')
  const [contact, setContact]   = useState(vendor?.contact_person ?? '')
  const [active, setActive]     = useState(vendor?.is_active ?? true)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  async function handleSave() {
    if (!name.trim()) { setError('Vendor name is required.'); return }
    setSaving(true); setError('')
    try {
      const payload = { name: name.trim(), phone: phone.trim(), contact_person: contact.trim(), is_active: active }
      if (isEdit) await vendorApi(`/${vendor.id}`, 'PATCH', payload)
      else        await vendorApi('', 'POST', payload)
      onSaved()
    } catch (e) { setError(e.message) }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-sm p-6">
        <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 mb-4">
          {isEdit ? 'Edit Vendor' : 'Add Vendor'}
        </h3>
        <div className="space-y-3">
          <div>
            <label className="label">Name <span className="text-red-500">*</span></label>
            <input className="input-field" value={name} onChange={e => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="label">Phone</label>
            <input className="input-field" value={phone} onChange={e => setPhone(e.target.value)} />
          </div>
          <div>
            <label className="label">Contact Person</label>
            <input className="input-field" value={contact} onChange={e => setContact(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)}
              className="accent-jdil-green w-4 h-4" />
            <span className="text-sm text-gray-700 dark:text-gray-300">Active</span>
          </label>
        </div>
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex gap-2 mt-5">
          <button onClick={handleSave} disabled={saving}
            className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-60">
            {saving && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ── Main tab ────────────────────────────────────────────────────────────────
export default function VendorsTab() {
  const [vendors, setVendors] = useState([])
  const [total, setTotal]     = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [search, setSearch]   = useState('')
  const [editing, setEditing] = useState(null)   // vendor obj or {} for new
  const [busy, setBusy]       = useState({})      // { [id]: true }
  const [uploadMsg, setUploadMsg] = useState('')
  const [uploading, setUploading] = useState(false)

  const fileRef     = useRef(null)
  const debounceRef = useRef(null)

  async function load(q = search) {
    setLoading(true); setError('')
    try {
      const res = await vendorApi(`?q=${encodeURIComponent(q)}&limit=300`)
      setVendors(res.vendors || [])
      setTotal(res.total ?? (res.vendors?.length || 0))
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  useEffect(() => { load('') }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search
  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => load(search), 300)
    return () => clearTimeout(debounceRef.current)
  }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleActive(v) {
    setBusy(b => ({ ...b, [v.id]: true }))
    try { await vendorApi(`/${v.id}`, 'PATCH', { is_active: !v.is_active }); await load() }
    catch (e) { alert(e.message) }
    setBusy(b => ({ ...b, [v.id]: false }))
  }

  async function handleDelete(v) {
    if (!window.confirm(`Delete vendor "${v.name}"? This cannot be undone.`)) return
    setBusy(b => ({ ...b, [v.id]: true }))
    try { await vendorApi(`/${v.id}`, 'DELETE'); await load() }
    catch (e) { alert(e.message) }
    setBusy(b => ({ ...b, [v.id]: false }))
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''   // allow re-uploading the same file
    if (!file) return
    setUploading(true); setUploadMsg('')
    try {
      const rows = await parseSpreadsheet(file)
      if (!rows.length) throw new Error('The file has no data rows.')
      // Map to {name, phone, contact_person} — accept common header variants
      const vendorsPayload = rows.map(r => ({
        name:           r.Name ?? r.name ?? r['Vendor Name'] ?? r['VENDOR NAME'] ?? '',
        phone:          r['Phone No.'] ?? r.Phone ?? r.phone ?? r['Phone Number'] ?? '',
        contact_person: r['Contact Person'] ?? r.contact_person ?? r.Contact ?? '',
      })).filter(v => String(v.name).trim())

      if (!vendorsPayload.length) throw new Error('No "Name" column found. Expected columns: Name, Phone No., Contact Person.')

      const res = await vendorApi('/bulk', 'POST', { vendors: vendorsPayload })
      setUploadMsg(`✓ Uploaded — ${res.upserted} vendor(s) added/updated from ${res.received} row(s).`)
      await load('')
      setSearch('')
    } catch (err) {
      setUploadMsg(`✗ ${err.message}`)
    }
    setUploading(false)
    setTimeout(() => setUploadMsg(''), 8000)
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="relative w-full sm:w-72">
          <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input type="text" className="input-field pl-9" placeholder="Search vendors by name…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFile} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-60">
            {uploading
              ? <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
              : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>}
            {uploading ? 'Uploading…' : 'Bulk Upload'}
          </button>
          <button onClick={() => setEditing({})} className="btn-primary flex items-center gap-2 text-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Add Vendor
          </button>
        </div>
      </div>

      {uploadMsg && (
        <div className={`text-sm rounded-lg px-4 py-2.5 ${uploadMsg.startsWith('✓')
          ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
          : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'}`}>
          {uploadMsg}
        </div>
      )}

      <p className="text-xs text-gray-400 dark:text-gray-500">
        {loading ? 'Loading…' : `Showing ${vendors.length} of ${total} vendor${total !== 1 ? 's' : ''}${search ? ` matching "${search}"` : ''}`}
        {total > vendors.length && ' — refine your search to see more.'}
      </p>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm rounded-lg px-4 py-3">
          {error} — <button onClick={() => load()} className="underline font-medium">retry</button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-4 border-jdil-green border-t-transparent rounded-full animate-spin" />
        </div>
      ) : vendors.length === 0 ? (
        <p className="text-center py-12 text-sm text-gray-400">No vendors found</p>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800">
                  <th className="table-header">Name</th>
                  <th className="table-header">Phone</th>
                  <th className="table-header">Contact Person</th>
                  <th className="table-header">Active</th>
                  <th className="table-header text-right pr-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {vendors.map(v => (
                  <tr key={v.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="table-cell font-medium text-sm">{v.name}</td>
                    <td className="table-cell text-xs text-gray-500 dark:text-gray-400">{v.phone || '—'}</td>
                    <td className="table-cell text-xs text-gray-500 dark:text-gray-400">{v.contact_person || '—'}</td>
                    <td className="table-cell">
                      <button
                        role="switch"
                        aria-checked={v.is_active}
                        disabled={!!busy[v.id]}
                        onClick={() => toggleActive(v)}
                        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                          v.is_active ? 'bg-jdil-green' : 'bg-gray-300 dark:bg-gray-600'
                        }`}
                        title={v.is_active ? 'Active — click to deactivate' : 'Inactive — click to activate'}
                      >
                        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
                          v.is_active ? 'translate-x-4' : 'translate-x-0.5'
                        }`} />
                      </button>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => setEditing(v)}
                          className="text-xs border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 px-2.5 py-1 rounded-md transition-colors">
                          Edit
                        </button>
                        <button onClick={() => handleDelete(v)} disabled={!!busy[v.id]}
                          className="text-xs bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-2.5 py-1 rounded-md transition-colors">
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && (
        <VendorModal
          vendor={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load() }}
        />
      )}
    </div>
  )
}
