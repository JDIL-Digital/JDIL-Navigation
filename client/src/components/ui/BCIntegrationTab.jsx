import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'

// ── API helper (Express /api/admin/bc-mapping with JWT) ───────────────────────
async function bcApi(path = '', method = 'GET', body = undefined) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`/api/admin/bc-mapping${path}`, {
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

// API helper for the /api/admin/bc-integration endpoints (carries .hint on errors).
async function biApi(path = '', method = 'GET', body = undefined) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`/api/admin/bc-integration${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) { const e = new Error(json.error || `Request failed (HTTP ${res.status})`); e.hint = json.hint; e.status = res.status; e.serverMessage = json.message; throw e }
  return json
}

const fmtDateTime = d => {
  if (!d) return '—'
  try { return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) }
  catch { return d }
}
const isToday = d => {
  if (!d) return false
  const x = new Date(d), n = new Date()
  return x.getFullYear() === n.getFullYear() && x.getMonth() === n.getMonth() && x.getDate() === n.getDate()
}

// ── Shared small pieces ───────────────────────────────────────────────────────
function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-4 border-jdil-green border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function Toggle({ on, busy, onClick, title }) {
  return (
    <button
      role="switch" aria-checked={on} disabled={busy} onClick={onClick} title={title}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        on ? 'bg-jdil-green' : 'bg-gray-300 dark:bg-gray-600'}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
        on ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  )
}

function ModalShell({ title, children, onClose, onSave, saving, saveLabel = 'Save', error, canSave = true }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-sm p-6">
        <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 mb-4">{title}</h3>
        <div className="space-y-3">{children}</div>
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex gap-2 mt-5">
          <button onClick={onSave} disabled={saving || !canSave}
            className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-60">
            {saving && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {saving ? 'Saving…' : saveLabel}
          </button>
          <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
        </div>
      </div>
    </div>
  )
}

// Clickable sort header. `col` is the field key; `sort` is { key, dir }.
function Th({ label, col, sort, setSort, className = '' }) {
  const active = sort.key === col
  return (
    <th className={`table-header cursor-pointer select-none ${className}`}
      onClick={() => setSort(s => ({ key: col, dir: s.key === col && s.dir === 'asc' ? 'desc' : 'asc' }))}>
      <span className="inline-flex items-center gap-1">
        {label}
        <span className="text-[10px] text-gray-400">{active ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
      </span>
    </th>
  )
}

function useSorted(rows, sort) {
  return useMemo(() => {
    if (!sort.key) return rows
    const sorted = [...rows].sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key]
      if (av == null) return 1
      if (bv == null) return -1
      return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' })
    })
    return sort.dir === 'desc' ? sorted.reverse() : sorted
  }, [rows, sort])
}

function ErrorBanner({ error, onRetry }) {
  if (!error) return null
  return (
    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm rounded-lg px-4 py-3">
      {error}{onRetry && <> — <button onClick={onRetry} className="underline font-medium">retry</button></>}
    </div>
  )
}

const AddButton = ({ label, onClick }) => (
  <button onClick={onClick} className="btn-primary flex items-center gap-2 text-sm">
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
    {label}
  </button>
)

// ═══════════════════════════════════════════════════════════════════════════════
//  SUB-TAB 1 — RIG MAPPING
// ═══════════════════════════════════════════════════════════════════════════════
function RigModal({ row, onClose, onSaved }) {
  const isEdit = !!row?.bc_prefix
  const [prefix, setPrefix]   = useState(row?.bc_prefix ?? '')
  const [name, setName]       = useState(row?.jdil_rig_name ?? '')
  const [notes, setNotes]     = useState(row?.notes ?? '')
  const [active, setActive]   = useState(row?.active ?? true)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  async function save() {
    if (!isEdit && !prefix.trim()) { setError('BC prefix is required.'); return }
    if (!name.trim()) { setError('JDIL rig name is required.'); return }
    setSaving(true); setError('')
    try {
      if (isEdit) await bcApi(`/rigs/${encodeURIComponent(row.bc_prefix)}`, 'PATCH', { jdil_rig_name: name.trim(), active, notes: notes.trim() })
      else        await bcApi('/rigs', 'POST', { bc_prefix: prefix.trim(), jdil_rig_name: name.trim(), notes: notes.trim() })
      onSaved()
    } catch (e) { setError(e.message) }
    setSaving(false)
  }

  return (
    <ModalShell title={isEdit ? `Edit Rig Mapping — ${row.bc_prefix}` : 'Add Rig Mapping'}
      onClose={onClose} onSave={save} saving={saving} error={error}>
      <div>
        <label className="label">BC Prefix {!isEdit && <span className="text-red-500">*</span>}</label>
        <input className="input-field disabled:opacity-60" value={prefix} disabled={isEdit}
          onChange={e => setPrefix(e.target.value)} autoFocus={!isEdit} placeholder="e.g. RD1" />
      </div>
      <div>
        <label className="label">JDIL Rig Name <span className="text-red-500">*</span></label>
        <input className="input-field" value={name} onChange={e => setName(e.target.value)} autoFocus={isEdit} placeholder="e.g. Discovery 1" />
      </div>
      <div>
        <label className="label">Notes</label>
        <input className="input-field" value={notes} onChange={e => setNotes(e.target.value)} />
      </div>
      {isEdit && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="accent-jdil-green w-4 h-4" />
          <span className="text-sm text-gray-700 dark:text-gray-300">Active</span>
        </label>
      )}
    </ModalShell>
  )
}

function RigMappingSub() {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [busy, setBusy]       = useState({})
  const [editing, setEditing] = useState(null)
  const [sort, setSort]       = useState({ key: 'prefix_length', dir: 'desc' })
  const sorted = useSorted(rows, sort)

  async function load() {
    setLoading(true); setError('')
    try { setRows(await bcApi('/rigs')) } catch (e) { setError(e.message) }
    setLoading(false)
  }
  useEffect(() => { load() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  async function toggle(r) {
    setBusy(b => ({ ...b, [r.bc_prefix]: true }))
    try { await bcApi(`/rigs/${encodeURIComponent(r.bc_prefix)}`, 'PATCH', { active: !r.active }); await load() }
    catch (e) { alert(e.message) }
    setBusy(b => ({ ...b, [r.bc_prefix]: false }))
  }
  async function del(r) {
    if (!window.confirm(`Deactivate rig mapping "${r.bc_prefix}" → "${r.jdil_rig_name}"? It will be marked inactive (not deleted).`)) return
    setBusy(b => ({ ...b, [r.bc_prefix]: true }))
    try { await bcApi(`/rigs/${encodeURIComponent(r.bc_prefix)}`, 'DELETE'); await load() }
    catch (e) { alert(e.message) }
    setBusy(b => ({ ...b, [r.bc_prefix]: false }))
  }

  const activeCount = rows.filter(r => r.active).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {loading ? 'Loading…' : <><strong>{rows.length}</strong> total mappings ({activeCount} active, {rows.length - activeCount} inactive)</>}
        </p>
        <AddButton label="Add New Rig Mapping" onClick={() => setEditing({})} />
      </div>
      <ErrorBanner error={error} onRetry={load} />
      {loading ? <Spinner /> : rows.length === 0 ? (
        <p className="text-center py-12 text-sm text-gray-400">No rig mappings found</p>
      ) : (
        <div className="card overflow-hidden"><div className="overflow-x-auto">
          <table className="w-full min-w-[680px]">
            <thead><tr className="border-b border-gray-200 dark:border-gray-800">
              <Th label="BC Prefix" col="bc_prefix" sort={sort} setSort={setSort} />
              <Th label="JDIL Rig Name" col="jdil_rig_name" sort={sort} setSort={setSort} />
              <Th label="Active" col="active" sort={sort} setSort={setSort} />
              <th className="table-header">Notes</th>
              <th className="table-header text-right pr-4">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {sorted.map(r => (
                <tr key={r.bc_prefix} className={`hover:bg-gray-50 dark:hover:bg-gray-800/50 ${!r.active ? 'opacity-50' : ''}`}>
                  <td className="table-cell font-mono text-xs font-medium">{r.bc_prefix}</td>
                  <td className="table-cell text-sm">{r.jdil_rig_name}</td>
                  <td className="table-cell"><Toggle on={r.active} busy={!!busy[r.bc_prefix]} onClick={() => toggle(r)}
                    title={r.active ? 'Active — click to deactivate' : 'Inactive — click to activate'} /></td>
                  <td className="table-cell text-xs text-gray-500 dark:text-gray-400">{r.notes || '—'}</td>
                  <td className="table-cell"><div className="flex items-center justify-end gap-1.5">
                    <button onClick={() => setEditing(r)} className="text-xs border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 px-2.5 py-1 rounded-md">Edit</button>
                    <button onClick={() => del(r)} disabled={!!busy[r.bc_prefix]} className="text-xs bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-2.5 py-1 rounded-md">Delete</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      )}
      {editing && <RigModal row={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load() }} />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SUB-TAB 2 — BUYER MAPPING
// ═══════════════════════════════════════════════════════════════════════════════
function BuyerModal({ row, onClose, onSaved }) {
  const isEdit = !!row?.bc_buyer_code
  const [code, setCode]       = useState(row?.bc_buyer_code ?? '')
  const [jdil, setJdil]       = useState(row?.jdil_buyer_code ?? '')
  const [fullName, setFull]   = useState(row?.full_name ?? '')
  const [notes, setNotes]     = useState(row?.notes ?? '')
  const [active, setActive]   = useState(row?.active ?? true)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  async function save() {
    if (!isEdit && !code.trim()) { setError('BC buyer code is required.'); return }
    if (!jdil.trim()) { setError('JDIL buyer code is required.'); return }
    setSaving(true); setError('')
    try {
      if (isEdit) await bcApi(`/buyers/${encodeURIComponent(row.bc_buyer_code)}`, 'PATCH', { jdil_buyer_code: jdil.trim(), full_name: fullName.trim(), active, notes: notes.trim() })
      else        await bcApi('/buyers', 'POST', { bc_buyer_code: code.trim(), jdil_buyer_code: jdil.trim(), full_name: fullName.trim(), notes: notes.trim() })
      onSaved()
    } catch (e) { setError(e.message) }
    setSaving(false)
  }

  return (
    <ModalShell title={isEdit ? `Edit Buyer Mapping — ${row.bc_buyer_code}` : 'Add Buyer Mapping'}
      onClose={onClose} onSave={save} saving={saving} error={error}>
      <div>
        <label className="label">BC Buyer Code {!isEdit && <span className="text-red-500">*</span>}</label>
        <input className="input-field disabled:opacity-60" value={code} disabled={isEdit}
          onChange={e => setCode(e.target.value)} autoFocus={!isEdit} placeholder="e.g. Avinash P." />
      </div>
      <div>
        <label className="label">JDIL Buyer Code <span className="text-red-500">*</span></label>
        <input className="input-field" value={jdil} onChange={e => setJdil(e.target.value)} autoFocus={isEdit} placeholder="e.g. AP-31" />
      </div>
      <div>
        <label className="label">Full Name</label>
        <input className="input-field" value={fullName} onChange={e => setFull(e.target.value)} placeholder="e.g. Avinash Pol" />
      </div>
      <div>
        <label className="label">Notes</label>
        <input className="input-field" value={notes} onChange={e => setNotes(e.target.value)} />
      </div>
      {isEdit && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="accent-jdil-green w-4 h-4" />
          <span className="text-sm text-gray-700 dark:text-gray-300">Active</span>
        </label>
      )}
    </ModalShell>
  )
}

function BuyerMappingSub() {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [busy, setBusy]       = useState({})
  const [editing, setEditing] = useState(null)
  const [sort, setSort]       = useState({ key: 'bc_buyer_code', dir: 'asc' })
  const sorted = useSorted(rows, sort)

  async function load() {
    setLoading(true); setError('')
    try { setRows(await bcApi('/buyers')) } catch (e) { setError(e.message) }
    setLoading(false)
  }
  useEffect(() => { load() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  async function toggle(r) {
    setBusy(b => ({ ...b, [r.bc_buyer_code]: true }))
    try { await bcApi(`/buyers/${encodeURIComponent(r.bc_buyer_code)}`, 'PATCH', { active: !r.active }); await load() }
    catch (e) { alert(e.message) }
    setBusy(b => ({ ...b, [r.bc_buyer_code]: false }))
  }
  async function del(r) {
    if (!window.confirm(`Deactivate buyer mapping "${r.bc_buyer_code}" → "${r.jdil_buyer_code}"? It will be marked inactive (not deleted).`)) return
    setBusy(b => ({ ...b, [r.bc_buyer_code]: true }))
    try { await bcApi(`/buyers/${encodeURIComponent(r.bc_buyer_code)}`, 'DELETE'); await load() }
    catch (e) { alert(e.message) }
    setBusy(b => ({ ...b, [r.bc_buyer_code]: false }))
  }

  const activeCount = rows.filter(r => r.active).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {loading ? 'Loading…' : <><strong>{rows.length}</strong> total mappings ({activeCount} active, {rows.length - activeCount} inactive)</>}
        </p>
        <AddButton label="Add New Buyer Mapping" onClick={() => setEditing({})} />
      </div>
      <ErrorBanner error={error} onRetry={load} />
      {loading ? <Spinner /> : rows.length === 0 ? (
        <p className="text-center py-12 text-sm text-gray-400">No buyer mappings found</p>
      ) : (
        <div className="card overflow-hidden"><div className="overflow-x-auto">
          <table className="w-full min-w-[680px]">
            <thead><tr className="border-b border-gray-200 dark:border-gray-800">
              <Th label="BC Buyer Code" col="bc_buyer_code" sort={sort} setSort={setSort} />
              <Th label="JDIL Buyer Code" col="jdil_buyer_code" sort={sort} setSort={setSort} />
              <Th label="Full Name" col="full_name" sort={sort} setSort={setSort} />
              <Th label="Active" col="active" sort={sort} setSort={setSort} />
              <th className="table-header text-right pr-4">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {sorted.map(r => (
                <tr key={r.bc_buyer_code} className={`hover:bg-gray-50 dark:hover:bg-gray-800/50 ${!r.active ? 'opacity-50' : ''}`}>
                  <td className="table-cell text-sm font-medium">{r.bc_buyer_code}</td>
                  <td className="table-cell font-mono text-xs">{r.jdil_buyer_code}</td>
                  <td className="table-cell text-xs text-gray-500 dark:text-gray-400">{r.full_name || '—'}</td>
                  <td className="table-cell"><Toggle on={r.active} busy={!!busy[r.bc_buyer_code]} onClick={() => toggle(r)}
                    title={r.active ? 'Active — click to deactivate' : 'Inactive — click to activate'} /></td>
                  <td className="table-cell"><div className="flex items-center justify-end gap-1.5">
                    <button onClick={() => setEditing(r)} className="text-xs border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 px-2.5 py-1 rounded-md">Edit</button>
                    {r.jdil_buyer_code === 'ACCOUNTS' ? (
                      <button disabled title="System entry — cannot be deleted" className="text-xs bg-gray-300 dark:bg-gray-700 text-gray-400 dark:text-gray-500 px-2.5 py-1 rounded-md cursor-not-allowed">Delete</button>
                    ) : (
                      <button onClick={() => del(r)} disabled={!!busy[r.bc_buyer_code]} className="text-xs bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-2.5 py-1 rounded-md">Delete</button>
                    )}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      )}
      {editing && <BuyerModal row={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load() }} />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SUB-TAB 3 — BUYER ALIASES
// ═══════════════════════════════════════════════════════════════════════════════
function AliasModal({ buyers, onClose, onSaved }) {
  const [alias, setAlias]   = useState('')
  const [code, setCode]     = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  async function save() {
    if (!alias.trim()) { setError('Alias is required.'); return }
    if (!code) { setError('Select the buyer this alias maps to.'); return }
    setSaving(true); setError('')
    try { await bcApi('/aliases', 'POST', { alias: alias.trim(), canonical_bc_code: code }); onSaved() }
    catch (e) { setError(e.message) }
    setSaving(false)
  }

  return (
    <ModalShell title="Add Alias" onClose={onClose} onSave={save} saving={saving} error={error}>
      <div>
        <label className="label">Alias <span className="text-red-500">*</span></label>
        <input className="input-field" value={alias} onChange={e => setAlias(e.target.value)} autoFocus placeholder="e.g. Avinash P" />
      </div>
      <div>
        <label className="label">Maps To (canonical buyer) <span className="text-red-500">*</span></label>
        <select className="input-field" value={code} onChange={e => setCode(e.target.value)}>
          <option value="">Select buyer…</option>
          {buyers.map(b => <option key={b.bc_buyer_code} value={b.bc_buyer_code}>{b.bc_buyer_code} → {b.jdil_buyer_code}</option>)}
        </select>
      </div>
    </ModalShell>
  )
}

function AliasesSub() {
  const [rows, setRows]       = useState([])
  const [buyers, setBuyers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [busy, setBusy]       = useState({})
  const [adding, setAdding]   = useState(false)

  async function load() {
    setLoading(true); setError('')
    try {
      const [a, b] = await Promise.all([bcApi('/aliases'), bcApi('/buyers')])
      setRows(a); setBuyers(b)
    } catch (e) { setError(e.message) }
    setLoading(false)
  }
  useEffect(() => { load() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleConfirmed(r) {
    setBusy(b => ({ ...b, [r.id]: true }))
    try { await bcApi(`/aliases/${r.id}`, 'PATCH', { confirmed: !r.confirmed }); await load() }
    catch (e) { alert(e.message) }
    setBusy(b => ({ ...b, [r.id]: false }))
  }
  async function del(r) {
    if (!window.confirm(`Delete alias "${r.alias}"? This cannot be undone.`)) return
    setBusy(b => ({ ...b, [r.id]: true }))
    try { await bcApi(`/aliases/${r.id}`, 'DELETE'); await load() }
    catch (e) { alert(e.message) }
    setBusy(b => ({ ...b, [r.id]: false }))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {loading ? 'Loading…' : <><strong>{rows.length}</strong> alias{rows.length !== 1 ? 'es' : ''}</>}
        </p>
        <AddButton label="Add Alias" onClick={() => setAdding(true)} />
      </div>
      <ErrorBanner error={error} onRetry={load} />
      {loading ? <Spinner /> : rows.length === 0 ? (
        <p className="text-center py-12 text-sm text-gray-400">No aliases yet. Aliases provide typo-tolerance for BC buyer values.</p>
      ) : (
        <div className="card overflow-hidden"><div className="overflow-x-auto">
          <table className="w-full min-w-[620px]">
            <thead><tr className="border-b border-gray-200 dark:border-gray-800">
              <th className="table-header">Alias</th>
              <th className="table-header">Maps To</th>
              <th className="table-header">Source</th>
              <th className="table-header">Confirmed</th>
              <th className="table-header text-right pr-4">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="table-cell text-sm font-medium">{r.alias}</td>
                  <td className="table-cell text-xs text-gray-600 dark:text-gray-400">
                    {r.canonical ? <>{r.canonical.bc_buyer_code} <span className="text-gray-400">({r.canonical.jdil_buyer_code})</span></> : r.canonical_bc_code}
                  </td>
                  <td className="table-cell text-xs">
                    <span className="bg-gray-100 dark:bg-gray-800 rounded px-2 py-0.5">{r.source || 'admin_added'}</span>
                  </td>
                  <td className="table-cell"><Toggle on={r.confirmed} busy={!!busy[r.id]} onClick={() => toggleConfirmed(r)}
                    title={r.confirmed ? 'Confirmed' : 'Unconfirmed'} /></td>
                  <td className="table-cell"><div className="flex items-center justify-end">
                    <button onClick={() => del(r)} disabled={!!busy[r.id]} className="text-xs bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-2.5 py-1 rounded-md">Delete</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      )}
      {adding && <AliasModal buyers={buyers} onClose={() => setAdding(false)} onSaved={async () => { setAdding(false); await load() }} />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SUB-TAB 4 — DATA QUALITY ALERTS
// ═══════════════════════════════════════════════════════════════════════════════
const ALERT_ROW_BG = {
  typo_detected: 'bg-yellow-50 dark:bg-yellow-900/10',
  unknown_buyer: 'bg-orange-50 dark:bg-orange-900/10',
  empty_buyer:   'bg-blue-50 dark:bg-blue-900/10',
  unknown_rig:   'bg-red-50 dark:bg-red-900/10',
}

const ALERT_FILTERS = [
  { value: 'unresolved',    label: 'All Unresolved' },
  { value: 'resolved',      label: 'All Resolved' },
  { value: 'all',           label: 'Everything' },
  { value: 'unknown_buyer', label: 'Type: Unknown Buyer' },
  { value: 'empty_buyer',   label: 'Type: Empty Buyer' },
  { value: 'unknown_rig',   label: 'Type: Unknown Rig' },
]

function ResolveModal({ alert, onClose, onSaved }) {
  const [notes, setNotes]   = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  async function save() {
    setSaving(true); setError('')
    try { await bcApi(`/alerts/${alert.id}`, 'PATCH', { resolution_notes: notes.trim() }); onSaved() }
    catch (e) { setError(e.message) }
    setSaving(false)
  }

  return (
    <ModalShell title="Resolve Alert" onClose={onClose} onSave={save} saving={saving} saveLabel="Mark Resolved" error={error}>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {alert.alert_type} — <span className="font-medium">{alert.bc_value || '—'}</span>
      </p>
      <div>
        <label className="label">Resolution notes</label>
        <textarea rows={3} className="input-field resize-none" value={notes} onChange={e => setNotes(e.target.value)}
          autoFocus placeholder="What was done to resolve this?" />
      </div>
    </ModalShell>
  )
}

// Map an unknown-buyer alert to an existing buyer (creates an alias + resolves).
function MapToBuyerModal({ alert, buyers, onClose, onSaved }) {
  const [code, setCode]     = useState('')
  const [note, setNote]     = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  async function save() {
    if (!code) { setError('Select a buyer to map to.'); return }
    setSaving(true); setError('')
    try { await bcApi(`/alerts/${alert.id}/resolve-with-alias`, 'POST', { canonical_bc_code: code, note: note.trim() }); onSaved() }
    catch (e) { setError(e.message) }
    setSaving(false)
  }

  return (
    <ModalShell title="Map to Existing Buyer" onClose={onClose} onSave={save} saving={saving} saveLabel="Create Alias & Resolve" error={error}>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        An alias <span className="font-medium">{alert.bc_value}</span> will be created pointing to the selected buyer, and this alert resolved.
      </p>
      <div>
        <label className="label">Map to buyer <span className="text-red-500">*</span></label>
        <select className="input-field" value={code} onChange={e => setCode(e.target.value)}>
          <option value="">Select buyer…</option>
          {buyers.filter(b => b.active).map(b => (
            <option key={b.bc_buyer_code} value={b.bc_buyer_code}>{b.bc_buyer_code} → {b.jdil_buyer_code}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">Note (optional)</label>
        <input className="input-field" value={note} onChange={e => setNote(e.target.value)} />
      </div>
    </ModalShell>
  )
}

// Simple info modal showing the PO(s) recorded for an empty-buyer alert.
function ViewPOsModal({ alert, onClose }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-sm p-6">
        <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 mb-3">POs with empty buyer</h3>
        <div className="space-y-1 text-sm text-gray-700 dark:text-gray-300">
          <p>First document: <span className="font-mono">{alert.bc_document_no || '—'}</span></p>
          <p>Total occurrences: <strong>{alert.occurrence_count ?? 1}</strong></p>
        </div>
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-3">
          Alerts are grouped by value, so only the first document is recorded. Run a preview filtered to the rig to see all affected POs.
        </p>
        <button onClick={onClose} className="btn-secondary w-full mt-5">Close</button>
      </div>
    </div>
  )
}

function AlertsSub() {
  const [rows, setRows]       = useState([])
  const [buyers, setBuyers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [filter, setFilter]   = useState('unresolved')
  const [resolving, setResolving] = useState(null)   // ResolveModal
  const [mapping, setMapping]     = useState(null)   // MapToBuyerModal
  const [viewingPOs, setViewingPOs] = useState(null) // ViewPOsModal

  async function load() {
    setLoading(true); setError('')
    try {
      const [a, b] = await Promise.all([bcApi('/alerts?includeResolved=true'), bcApi('/buyers')])
      setRows(a); setBuyers(b)
    } catch (e) { setError(e.message) }
    setLoading(false)
  }
  useEffect(() => { load() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const unresolved = rows.filter(r => !r.resolved).length
  const filtered = rows.filter(r => {
    if (filter === 'unresolved') return !r.resolved
    if (filter === 'resolved')   return r.resolved
    if (filter === 'all')        return true
    return r.alert_type === filter   // type filters
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-sm bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-full px-3 py-1 font-semibold">
          {loading ? 'Loading…' : `${unresolved} unresolved alert${unresolved !== 1 ? 's' : ''}`}
        </span>
        <select className="input-field w-auto min-w-[200px]" value={filter} onChange={e => setFilter(e.target.value)}>
          {ALERT_FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </div>
      <ErrorBanner error={error} onRetry={load} />
      {loading ? <Spinner /> : filtered.length === 0 ? (
        <p className="text-center py-12 text-sm text-gray-400">
          No alerts for this filter. Alerts are populated when a Preview Sync encounters unknown or empty buyer codes.
        </p>
      ) : (
        <div className="card overflow-hidden"><div className="overflow-x-auto">
          <table className="w-full min-w-[920px]">
            <thead><tr className="border-b border-gray-200 dark:border-gray-800">
              <th className="table-header">Alert Type</th>
              <th className="table-header">BC Value</th>
              <th className="table-header">Document(s)</th>
              <th className="table-header">First Detected</th>
              <th className="table-header">Last Seen</th>
              <th className="table-header text-center">Occurrences</th>
              <th className="table-header">Status</th>
              <th className="table-header text-right pr-4">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {filtered.map(r => {
                const occ = r.occurrence_count ?? 1
                return (
                  <tr key={r.id} className={ALERT_ROW_BG[r.alert_type] || ''}>
                    <td className="table-cell text-xs font-medium">{r.alert_type}</td>
                    <td className="table-cell text-xs">{r.bc_value || '—'}</td>
                    <td className="table-cell text-xs font-mono">
                      {r.bc_document_no || '—'}{occ > 1 ? <span className="font-sans text-gray-400"> +{occ - 1} more</span> : ''}
                    </td>
                    <td className="table-cell text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{fmtDateTime(r.detected_at)}</td>
                    <td className="table-cell text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{fmtDateTime(r.last_seen_at || r.detected_at)}</td>
                    <td className="table-cell text-xs text-center">{occ}</td>
                    <td className="table-cell text-xs">
                      {r.resolved
                        ? <span className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full px-2 py-0.5">Resolved</span>
                        : <span className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-full px-2 py-0.5">Open</span>}
                    </td>
                    <td className="table-cell"><div className="flex items-center justify-end gap-1.5 flex-wrap">
                      {!r.resolved && r.alert_type === 'unknown_buyer' && (
                        <button onClick={() => setMapping(r)} className="text-xs bg-jdil-green hover:brightness-110 text-white px-2.5 py-1 rounded-md">Map to Existing Buyer</button>
                      )}
                      {!r.resolved && r.alert_type === 'empty_buyer' && (
                        <button onClick={() => setViewingPOs(r)} className="text-xs border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 px-2.5 py-1 rounded-md">View POs</button>
                      )}
                      {!r.resolved && (
                        <button onClick={() => setResolving(r)} className="text-xs border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 px-2.5 py-1 rounded-md">Mark Resolved</button>
                      )}
                      {r.resolved && <span className="text-[11px] text-gray-400">by {r.resolved_by || '—'}</span>}
                    </div></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div></div>
      )}
      {resolving && <ResolveModal alert={resolving} onClose={() => setResolving(null)} onSaved={async () => { setResolving(null); await load() }} />}
      {mapping && <MapToBuyerModal alert={mapping} buyers={buyers} onClose={() => setMapping(null)} onSaved={async () => { setMapping(null); await load() }} />}
      {viewingPOs && <ViewPOsModal alert={viewingPOs} onClose={() => setViewingPOs(null)} />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BC CONNECTION TEST (OAuth auth check — no data fetched)
// ═══════════════════════════════════════════════════════════════════════════════
function BCConnectionTest() {
  const [status, setStatus] = useState('idle')  // idle | loading | success | error
  const [result, setResult] = useState(null)    // success payload
  const [err, setErr]       = useState(null)     // { error, hint }

  async function run() {
    setStatus('loading'); setResult(null); setErr(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/admin/bc-integration/test-auth', {
        headers: { ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok && json.success) { setResult(json); setStatus('success') }
      else { setErr({ error: json.error || `Request failed (HTTP ${res.status})`, hint: json.hint }); setStatus('error') }
    } catch (e) {
      setErr({ error: e.message || 'Network error', hint: 'Check your connection and that you are signed in as an admin.' })
      setStatus('error')
    }
  }

  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-jdil-green mb-0.5">BC Connection Test</h3>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        Test if the server can authenticate with Business Central.
      </p>

      <button onClick={run} disabled={status === 'loading'}
        className="btn-primary flex items-center gap-2 text-sm disabled:opacity-60 disabled:bg-gray-400">
        {status === 'loading' && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
        {status === 'loading' ? 'Testing…' : 'Test Authentication'}
      </button>

      <div className="mt-4">
        {status === 'idle' && (
          <p className="text-xs text-gray-400 dark:text-gray-500 italic">Click the button to test the connection.</p>
        )}

        {status === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            Contacting Business Central…
          </div>
        )}

        {status === 'success' && result && (
          <div className="flex items-start gap-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-4 py-3">
            <svg className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <p className="text-sm text-green-700 dark:text-green-400">
              Authentication successful! Token received (length: {result.token_length} chars, expires in {result.expires_in_seconds} seconds)
              {result.from_cache && <span className="text-green-600/70 dark:text-green-500/70"> · served from cache</span>}
            </p>
          </div>
        )}

        {status === 'error' && err && (
          <div className="flex items-start gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3">
            <svg className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            <div>
              <p className="text-sm text-red-700 dark:text-red-400 font-medium">Authentication failed: {err.error}</p>
              {err.hint && <p className="text-xs text-red-600/80 dark:text-red-400/70 mt-1">{err.hint}</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BC DATA FETCH TEST (reads sample Blanket Orders — does NOT persist)
// ═══════════════════════════════════════════════════════════════════════════════
function Collapsible({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="mt-3 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/60 hover:bg-gray-100 dark:hover:bg-gray-800">
        <span>{title}</span>
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
      </button>
      {open && <div className="bg-gray-50 dark:bg-gray-900/40">{children}</div>}
    </div>
  )
}

function JsonBlock({ value }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return (
    <pre className="text-[11px] leading-relaxed font-mono text-gray-700 dark:text-gray-300 p-3 overflow-auto max-h-[600px] whitespace-pre">
      {text}
    </pre>
  )
}

function DiscoverTable({ result }) {
  const rowBg = a =>
    a.kind === 'orderby' ? 'bg-yellow-50 dark:bg-yellow-900/10'
    : a.filterable       ? 'bg-green-50 dark:bg-green-900/10'
    :                      'bg-red-50 dark:bg-red-900/10'
  const s = result.summary || {}
  return (
    <>
      <div className="card overflow-hidden"><div className="overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead><tr className="border-b border-gray-200 dark:border-gray-800">
            <th className="table-header">#</th>
            <th className="table-header">Description</th>
            <th className="table-header">Status</th>
            <th className="table-header">Result</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {(result.attempts || []).map(a => (
              <tr key={a.attempt_number} className={rowBg(a)}>
                <td className="table-cell text-xs align-top">{a.attempt_number}</td>
                <td className="table-cell align-top">
                  <div className="text-xs font-medium text-gray-800 dark:text-gray-200">{a.description}</div>
                  <div className="text-[10px] font-mono text-gray-400 dark:text-gray-500 break-all mt-0.5">{a.full_url}</div>
                </td>
                <td className="table-cell text-xs align-top">{a.status_code ?? '—'}</td>
                <td className="table-cell text-xs align-top">
                  {a.kind === 'orderby'
                    ? (a.filterable ? <span className="text-yellow-700 dark:text-yellow-400 font-medium">orderby supported ✓</span>
                                    : <span className="text-red-700 dark:text-red-400 font-medium">orderby failed ✗</span>)
                    : (a.filterable ? <span className="text-green-700 dark:text-green-400 font-medium">Filterable ✓</span>
                                    : <span className="text-red-700 dark:text-red-400 font-medium">Not filterable ✗</span>)}
                  {a.filterable && a.records_returned != null && <span className="text-gray-400"> ({a.records_returned} rec)</span>}
                  {a.error && <div className="text-[11px] text-red-600/80 dark:text-red-400/70 mt-0.5 break-words">{a.error}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div></div>
      <div className="mt-3 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 text-sm space-y-1">
        <p><span className="font-medium text-gray-700 dark:text-gray-300">Filterable fields found:</span> {s.filterable_fields?.length ? s.filterable_fields.join(', ') : 'none'}</p>
        {s.non_filterable_fields?.length > 0 && (
          <p><span className="font-medium text-gray-700 dark:text-gray-300">Not filterable:</span> {s.non_filterable_fields.join(', ')}</p>
        )}
        <p><span className="font-medium text-gray-700 dark:text-gray-300">$orderby supported:</span> {s.orderby_supported ? 'yes' : 'no'}</p>
        {s.trailing_slash_filtering_supported !== undefined && (
          <p><span className="font-medium text-gray-700 dark:text-gray-300">Trailing-slash filtering supported:</span> {s.trailing_slash_filtering_supported ? 'yes' : 'no'}</p>
        )}
        <p><span className="font-medium text-jdil-green">Recommended strategy:</span> {s.recommended_filter_strategy}</p>
        {s.recommended_sync_strategy && (
          <p><span className="font-medium text-jdil-green">Recommended sync strategy:</span> {s.recommended_sync_strategy}</p>
        )}
      </div>
    </>
  )
}

function BCDataFetchTest() {
  const [status, setStatus] = useState('idle')  // idle | loading | success | error
  const [result, setResult] = useState(null)
  const [err, setErr]       = useState(null)

  async function run(type) {
    setStatus('loading'); setResult(null); setErr(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/api/admin/bc-integration/test-fetch?type=${type}`, {
        headers: { ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok && json.success) { setResult(json); setStatus('success') }
      else { setErr({ error: json.error || `Request failed (HTTP ${res.status})`, hint: json.hint, response_body: json.response_body }); setStatus('error') }
    } catch (e) {
      setErr({ error: e.message || 'Network error', hint: 'Check your connection and that you are signed in as an admin.' })
      setStatus('error')
    }
  }

  const loading = status === 'loading'
  const s = result?.summary

  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-jdil-green mb-0.5">BC Data Fetch Test</h3>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        Fetch sample Blanket Orders from BC to verify data flow. This does NOT save data to the database.
      </p>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => run('simple')} disabled={loading}
          className="btn-primary flex items-center gap-2 text-sm disabled:opacity-60 disabled:bg-gray-400">
          {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          Fetch Simple (Level 1 only)
        </button>
        <button onClick={() => run('full')} disabled={loading}
          className="flex items-center gap-2 text-sm text-white px-4 py-2 rounded-lg font-medium bg-[#145f30] hover:bg-[#0f4a26] disabled:opacity-60 disabled:bg-gray-400">
          {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          Fetch Full (All 5 levels)
        </button>
        <button onClick={() => run('recent')} disabled={loading}
          className="flex items-center gap-2 text-sm text-white px-4 py-2 rounded-lg font-medium bg-[#1976d2] hover:bg-[#145ea8] disabled:opacity-60 disabled:bg-gray-400">
          {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          Fetch Recent (July+ with full expand)
        </button>
        <button onClick={() => run('discover')} disabled={loading}
          className="flex items-center gap-2 text-sm text-white px-4 py-2 rounded-lg font-medium bg-[#f57c00] hover:bg-[#d96c00] disabled:opacity-60 disabled:bg-gray-400">
          {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          Discover Filterable Fields
        </button>
      </div>

      <div className="mt-4">
        {status === 'idle' && (
          <p className="text-xs text-gray-400 dark:text-gray-500 italic">Click a button to fetch sample data from Business Central.</p>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            Fetching from BC…
          </div>
        )}

        {status === 'success' && result && result.fetch_type === 'discover' && (
          <DiscoverTable result={result} />
        )}

        {status === 'success' && result && result.fetch_type !== 'discover' && (
          <>
            <div className="flex items-start gap-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-4 py-3">
              <svg className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <div className="text-sm text-green-700 dark:text-green-400 space-y-0.5">
                {result.fetch_type === 'recent' && (
                  <p className="font-medium">Date filter applied: MRReleasedDate &gt;= '2026-07-01' (string comparison)</p>
                )}
                <p className="font-medium">
                  Successfully fetched {result.records_returned} record{result.records_returned !== 1 ? 's' : ''} in {result.response_time_ms} ms
                  <span className="font-normal text-green-600/80 dark:text-green-500/80"> ({result.fetch_type} fetch)</span>
                </p>
                <p>Response size: {(result.response_size_bytes / 1024).toFixed(1)} KB</p>
                {s?.unique_rig_prefixes?.length > 0 && <p>Rig prefixes found: {s.unique_rig_prefixes.join(', ')}</p>}
                {(result.fetch_type === 'full' || result.fetch_type === 'recent') && (
                  <>
                    <p>Buyer codes found: {s?.unique_buyer_codes?.length ? s.unique_buyer_codes.join(', ') : '—'}</p>
                    <p>Empty buyer codes: {s?.empty_buyer_count ?? 0} of {s?.total_po_count ?? 0} POs</p>
                  </>
                )}
                {s?.document_numbers?.length > 0 && <p className="break-all">Document numbers: {s.document_numbers.join(', ')}</p>}
              </div>
            </div>
            <Collapsible title="Raw JSON Response">
              <JsonBlock value={result.raw_data} />
            </Collapsible>
          </>
        )}

        {status === 'error' && err && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3">
            <div className="flex items-start gap-2">
              <svg className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              <div>
                <p className="text-sm text-red-700 dark:text-red-400 font-medium">Fetch failed: {err.error}</p>
                {err.hint && <p className="text-xs text-red-600/80 dark:text-red-400/70 mt-1">{err.hint}</p>}
              </div>
            </div>
            {err.response_body != null && (
              <Collapsible title="BC Error Response">
                <JsonBlock value={err.response_body} />
              </Collapsible>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PREVIEW SYNC (DRY RUN) — fetches BC data, runs the processor, shows what WOULD sync
// ═══════════════════════════════════════════════════════════════════════════════
const RIG_PREFIX_OPTIONS = [
  { value: '',        label: 'All rigs' },
  { value: 'RD1',     label: 'RD1 - Discovery 1' },
  { value: 'RD1DD',   label: 'RD1DD - Discovery 1 Dry Dock' },
  { value: 'RV1',     label: 'RV1 - Virtue 1' },
  { value: 'RV1DD',   label: 'RV1DD - Virtue 1 Dry Dock' },
  { value: 'RJS',     label: 'RJS - Jindal Star' },
  { value: 'RJSDD',   label: 'RJSDD - Jindal Star Dry Dock' },
  { value: 'RJE',     label: 'RJE - Jindal Explorer' },
  { value: 'RJEDD',   label: 'RJEDD - Jindal Explorer Dry Dock' },
  { value: 'RJSUP',   label: 'RJSUP - Jindal Supreme' },
  { value: 'RJSUPDD', label: 'RJSUPDD - Jindal Supreme Dry Dock' },
  { value: 'MLU',     label: 'MLU - Mud Logging Unit' },
  { value: 'DDD',     label: 'DDD - Directional Drilling' },
  { value: 'TAWS',    label: 'TAWS - Taloja (TAWS)' },
  { value: 'RIG',     label: 'RIG - Taloja (RIG)' },
  { value: 'RGEN',    label: 'RGEN - Nagothane (General)' },
]

const FISCAL_YEAR_OPTIONS = [
  { value: '2627,2728', label: 'Current + Next (2627, 2728)' },
  { value: '2627',      label: 'Current Only (2627)' },
  { value: '2526,2627', label: 'Previous + Current (2526, 2627)' },
]

const ACTION_BADGE = {
  INSERT: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  UPDATE: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
  SKIP:   'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
}

function StatCard({ label, value, color = 'gray' }) {
  const colors = {
    gray:   'bg-gray-50 dark:bg-gray-800/60 text-gray-700 dark:text-gray-300',
    green:  'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400',
    orange: 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400',
  }
  return (
    <div className={`rounded-lg px-3 py-2 ${colors[color] || colors.gray}`}>
      <div className="text-lg font-bold leading-none">{value}</div>
      <div className="text-[11px] mt-1">{label}</div>
    </div>
  )
}

function PreviewSyncCard() {
  const [prefix, setPrefix] = useState('')
  const [fiscalYears, setFiscalYears] = useState('2627,2728')
  const [status, setStatus] = useState('idle')   // idle | loading | success | error
  const [result, setResult] = useState(null)
  const [err, setErr]       = useState(null)

  const rigLabel = RIG_PREFIX_OPTIONS.find(o => o.value === prefix)?.label || 'All rigs'

  async function run() {
    setStatus('loading'); setResult(null); setErr(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/api/admin/bc-integration/preview-sync?rig_prefix=${encodeURIComponent(prefix)}&fiscal_years=${encodeURIComponent(fiscalYears)}`, {
        headers: { ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok && json.success) { setResult(json); setStatus('success') }
      else { setErr({ error: json.error || `Request failed (HTTP ${res.status})`, hint: json.hint, response_body: json.response_body }); setStatus('error') }
    } catch (e) {
      setErr({ error: e.message || 'Network error', hint: 'Check your connection and that you are signed in as an admin.' })
      setStatus('error')
    }
  }

  const loading = status === 'loading'
  const p = result?.preview
  const rows = p ? p.blanket_orders.flatMap(bo => bo.pos_processed.map(po => ({ bo, po }))) : []
  const autoAccountsCount = rows.filter(({ po }) => po.buyer_lookup?.auto_assigned_to_accounts).length

  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-jdil-green mb-0.5">Preview Sync (Dry Run)</h3>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        Fetches real BC data, processes it through our transformation logic, and shows what WOULD be synced. No database changes.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="label">Filter by Rig</label>
          <select className="input-field w-auto min-w-[220px]" value={prefix} onChange={e => setPrefix(e.target.value)} disabled={loading}>
            {RIG_PREFIX_OPTIONS.map(o => <option key={o.value || 'all'} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Fiscal Years</label>
          <select className="input-field w-auto min-w-[220px]" value={fiscalYears} onChange={e => setFiscalYears(e.target.value)} disabled={loading}>
            {FISCAL_YEAR_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <button onClick={run} disabled={loading}
          className="btn-primary flex items-center gap-2 text-sm disabled:opacity-60 disabled:bg-gray-400">
          {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          {loading ? 'Running…' : 'Run Preview'}
        </button>
      </div>

      <div className="mt-4">
        {status === 'idle' && (
          <p className="text-xs text-gray-400 dark:text-gray-500 italic">Pick a rig filter (or All rigs) and click Run Preview.</p>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            Fetching current fiscal year BOs for {rigLabel}…
          </div>
        )}

        {status === 'error' && err && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3">
            <div className="flex items-start gap-2">
              <svg className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              <div>
                <p className="text-sm text-red-700 dark:text-red-400 font-medium">Preview failed: {err.error}</p>
                {err.hint && <p className="text-xs text-red-600/80 dark:text-red-400/70 mt-1">{err.hint}</p>}
              </div>
            </div>
            {err.response_body != null && (
              <Collapsible title="BC Error Response"><JsonBlock value={err.response_body} /></Collapsible>
            )}
          </div>
        )}

        {status === 'success' && p && (
          <div className="space-y-4">
            {/* Section D — warnings */}
            {p.unknown_rigs.length > 0 && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm rounded-lg px-4 py-2.5">
                ⚠ Unknown rig prefix{p.unknown_rigs.length !== 1 ? 'es' : ''}: {p.unknown_rigs.join(', ')} — add a mapping in the Rig Mapping tab.
              </div>
            )}
            {autoAccountsCount > 0 && (
              <div className="bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm rounded-lg px-4 py-2.5">
                {autoAccountsCount} PO{autoAccountsCount !== 1 ? 's' : ''} auto-assigned to Accounts team (unknown or empty BC buyer code).
              </div>
            )}
            {p.bos_within_sync_range === 0 && (
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 text-yellow-700 dark:text-yellow-500 text-sm rounded-lg px-4 py-2.5">
                Nothing to sync in this fetch (0 blanket orders within the sync range).
              </div>
            )}

            {/* Section A — summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              <StatCard label="Total BOs" value={p.total_bos} />
              <StatCard label="Total POs" value={p.total_pos} />
              <StatCard label="BOs within range" value={p.bos_within_sync_range} color="green" />
              <StatCard label="BOs before cutoff" value={p.bos_before_cutoff} />
              <StatCard label="Unknown rigs" value={p.unknown_rigs.length || 'None'} />
              <StatCard label="Unknown buyers" value={p.unknown_buyers.length || 'None'} />
            </div>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">
              {result.rig_prefix_filter ? `Filter: ${result.rig_prefix_filter}/ · ` : ''}
              {result.rig_prefix_filter && result.fiscal_years?.length ? `FY: ${result.fiscal_years.join(', ')} · ` : ''}
              fetched {result.bc_response_size_kb} KB in {(result.fetch_time_ms / 1000).toFixed(1)}s · processed in {result.processing_time_ms} ms
            </p>

            {/* Section B — per-PO breakdown */}
            {rows.length === 0 ? (
              <p className="text-center py-8 text-sm text-gray-400">No POs returned for this filter.</p>
            ) : (
              <div className="card overflow-hidden"><div className="overflow-x-auto">
                <table className="w-full min-w-[820px]">
                  <thead><tr className="border-b border-gray-200 dark:border-gray-800">
                    <th className="table-header">PO Number</th>
                    <th className="table-header">MR Date</th>
                    <th className="table-header">Rig</th>
                    <th className="table-header">Vendor</th>
                    <th className="table-header">Buyer</th>
                    <th className="table-header">Status</th>
                    <th className="table-header">Action</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {rows.map(({ bo, po }, i) => {
                      const td = po.transformed_data
                      const autoAccounts = po.buyer_lookup.auto_assigned_to_accounts === true
                      const cell = 'table-cell text-xs'
                      const redCell = 'table-cell text-xs bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                      return (
                        <tr key={`${po.po_number}-${i}`} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                          <td className={`${cell} font-mono`}>{po.po_number || '—'}</td>
                          <td className={cell}>{td.mr_date || '—'}</td>
                          <td className={bo.rig_matched ? cell : redCell}>{bo.rig_matched ? (td.rig_name || '—') : `? ${bo.rig_prefix || ''}`}</td>
                          <td className={cell}>{td.vendor_name || '—'}</td>
                          <td className={autoAccounts ? `${cell} text-gray-400 dark:text-gray-500` : cell}>
                            {autoAccounts
                              ? po.buyer_lookup.full_name
                              : <>{td.buyer_code}{td.buyer_code_raw ? <span className="text-gray-400"> ({td.buyer_code_raw})</span> : ''}</>}
                          </td>
                          <td className={cell}>{td.po_status || '—'}</td>
                          <td className="table-cell">
                            <span title={po.skip_reason || ''} className={`text-[11px] font-medium rounded-full px-2 py-0.5 ${ACTION_BADGE[po.action_needed] || ACTION_BADGE.SKIP}`}>
                              {po.action_needed}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div></div>
            )}

            {/* Section C — raw preview JSON */}
            <Collapsible title="Raw Preview Data"><JsonBlock value={p} /></Collapsible>
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SYNC TO STAGING (Phase 2 — writes to bc_po_staging, NOT po_orders)
// ═══════════════════════════════════════════════════════════════════════════════
const RUN_STATUS_BADGE = {
  running:         'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
  success:         'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  partial_failure: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',
  failed:          'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
  timeout:         'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
  stale:           'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
}

// Friendly status labels with an at-a-glance icon.
const RUN_STATUS_LABEL = {
  running:         '⚡ Running',
  success:         '✓ Success',
  partial_failure: '⚠️ Partial',
  failed:          '❌ Failed',
  timeout:         '⏱️ Timeout',
  stale:           '⚪ Stale',
}

// One run-status pill. Falls back to the raw status if it's an unknown value.
function RunBadge({ status, className = '' }) {
  return (
    <span className={`rounded-full px-2 py-0.5 ${RUN_STATUS_BADGE[status] || 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'} ${className}`}>
      {RUN_STATUS_LABEL[status] || status}
    </span>
  )
}

// Human label for how a run was triggered. Cron runs carry a trigger_source
// (v28); older manual runs only have a triggered_by UUID.
function triggerLabel(run) {
  const t = run.trigger_source || ''
  if (t === 'cron-9am') return '🕘 Cron 9am'
  if (t === 'cron-6pm') return '🕕 Cron 6pm'
  if (t.startsWith('manual-admin')) return '👤 Manual'
  if (run.triggered_by) return '👤 Manual'
  return '—'
}

const RIG_RESULT_DOT = {
  success: 'text-green-600 dark:text-green-400',
  partial: 'text-amber-600 dark:text-amber-400',
  failed:  'text-red-600 dark:text-red-400',
}

// One run row; expandable when it carries a per-rig breakdown (rig_results, v28).
function RunRow({ run }) {
  const [open, setOpen] = useState(false)
  const rigs = Array.isArray(run.rig_results) ? run.rig_results : []
  const truncated = Array.isArray(run.truncation_warnings) ? run.truncation_warnings : []
  const expandable = rigs.length > 0
  return (
    <>
      <tr className={expandable ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50' : ''} onClick={expandable ? () => setOpen(o => !o) : undefined}>
        <td className="table-cell text-xs whitespace-nowrap">
          {expandable && <span className={`inline-block mr-1 transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>}
          {fmtDateTime(run.started_at)}
        </td>
        <td className="table-cell text-xs whitespace-nowrap">{triggerLabel(run)}</td>
        <td className="table-cell text-xs">{run.rig_filter || 'All'}</td>
        <td className="table-cell text-xs">
          <RunBadge status={run.status} />
          {truncated.length > 0 && (
            <span
              className="ml-1 rounded-full px-2 py-0.5 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 whitespace-nowrap"
              title={`These rigs returned 100 BOs - may need pagination: ${truncated.join(', ')}`}
            >⚠️ Possible truncation</span>
          )}
        </td>
        <td className="table-cell text-xs text-center">{run.staging_rows_inserted ?? 0}</td>
        <td className="table-cell text-xs text-center">{run.pos_promoted ?? 0}</td>
        <td className="table-cell text-xs">{run.processing_time_ms != null ? `${(run.processing_time_ms / 1000).toFixed(1)}s` : '—'}</td>
      </tr>
      {open && expandable && (
        <tr>
          <td colSpan={7} className="bg-gray-50 dark:bg-gray-900/40 px-6 py-2">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-1">
              {rigs.map((r, i) => (
                <div key={i} className="text-xs flex items-center gap-1.5">
                  <span className={RIG_RESULT_DOT[r.status] || 'text-gray-400'}>●</span>
                  <span className="font-mono">{r.rig}</span>
                  {truncated.includes(r.rig) && (
                    <span className="text-orange-600 dark:text-orange-400 whitespace-nowrap" title="Returned 100 BOs - may be truncated">⚠️ 100 BOs</span>
                  )}
                  <span className="text-gray-500 dark:text-gray-400">
                    {r.staging_rows ?? 0} staged{r.pos_promoted ? `, ${r.pos_promoted} promoted` : ''}
                    {r.error ? ` — ${r.error}` : ''}
                  </span>
                </div>
              ))}
            </div>
            {run.error_message && <p className="text-xs text-red-600 dark:text-red-400 mt-2">First error: {run.error_message}</p>}
          </td>
        </tr>
      )}
    </>
  )
}

function RecentRunsTable({ runs }) {
  if (!runs.length) return <p className="text-xs text-gray-400 dark:text-gray-500 p-3">No sync runs yet.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px]">
        <thead><tr className="border-b border-gray-200 dark:border-gray-800">
          <th className="table-header">Started</th>
          <th className="table-header">Trigger</th>
          <th className="table-header">Rig</th>
          <th className="table-header">Status</th>
          <th className="table-header text-center">Staged</th>
          <th className="table-header text-center">Promoted</th>
          <th className="table-header">Duration</th>
        </tr></thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {runs.map(run => <RunRow key={run.id} run={run} />)}
        </tbody>
      </table>
    </div>
  )
}

// ── Automated Sync (cron) status + manual trigger ──────────────────────────────
function AutomatedSyncCard({ onViewHistory }) {
  const [st, setSt]       = useState(null)   // cron-status payload
  const [loadErr, setLoadErr]   = useState('')
  const [triggering, setTriggering] = useState(false)
  const [triggerErr, setTriggerErr] = useState('')
  const [triggerMsg, setTriggerMsg] = useState('')

  async function load() {
    try { setSt(await biApi('/cron-status')); setLoadErr('') }
    catch (e) { setLoadErr(e.message) }
  }
  useEffect(() => {
    load()
    const id = setInterval(load, 5000)   // live refresh every 5s
    return () => clearInterval(id)
  }, [])

  const run = st?.current_run
  const active = !!run

  async function trigger() {
    if (!window.confirm('This will sync ALL 15 rigs sequentially (~15-20 minutes). Continue?')) return
    setTriggering(true); setTriggerErr(''); setTriggerMsg('')
    try {
      const res = await biApi('/trigger-sync-now', 'POST')
      setTriggerMsg(res.message || 'Sync started.')
      await load()
    } catch (e) {
      // 409 → a sync is already running; show the server's friendly message.
      setTriggerErr(e.status === 409 ? (e.serverMessage || 'A sync is already running. Please wait.') : e.message)
      await load()
    }
    setTriggering(false)
  }

  const last = st?.last_run_info
  const pct = run && run.total_rigs ? Math.round((run.rig_index / run.total_rigs) * 100) : 0
  // A 'running' row with no live in-memory progress (e.g. after a server restart
  // mid-run) — surface a simple banner so the operator knows a sync is active.
  const runningMins = last?.status === 'running' && last.started_at
    ? Math.max(0, Math.round((Date.now() - new Date(last.started_at).getTime()) / 60000))
    : null

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-jdil-green mb-0.5">Automated Sync</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Scheduled BC → staging sync for all 15 rigs. Promotion to po_orders runs only when enabled on the server.
          </p>
        </div>
        <button onClick={trigger} disabled={triggering || active}
          className="flex items-center gap-2 text-sm text-white px-4 py-2 rounded-lg font-medium bg-jdil-green hover:brightness-110 disabled:opacity-60 disabled:bg-gray-400">
          {(triggering || active) && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          {active ? 'Sync running…' : triggering ? 'Starting…' : 'Run Sync Now'}
        </button>
      </div>

      {/* Sync-in-progress banner (covers a running row with no live progress, e.g. after restart) */}
      {runningMins !== null && !active && (
        <div className="mt-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400 text-xs font-medium rounded-lg px-3 py-2 flex items-center gap-2">
          <div className="w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          ⚡ Sync in progress — started {runningMins} minute{runningMins === 1 ? '' : 's'} ago
        </div>
      )}

      {/* Promote-disabled safety banner */}
      {st && !st.promote_enabled && (
        <div className="mt-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-400 text-xs font-medium rounded-lg px-3 py-2">
          ⚠️ Promote is DISABLED. Set <span className="font-mono">BC_SYNC_ENABLED=true</span> in server env to enable. Syncs will stage data for review only.
        </div>
      )}

      {/* Status grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
        <div className="rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-800/60">
          <div className="text-[11px] text-gray-500 dark:text-gray-400">Scheduler</div>
          <div className={`text-sm font-semibold ${st?.enabled ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}`}>
            {st?.enabled ? 'Enabled' : 'Disabled'}
          </div>
        </div>
        <div className="rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-800/60">
          <div className="text-[11px] text-gray-500 dark:text-gray-400">Promote to po_orders</div>
          <div className={`text-sm font-semibold ${st?.promote_enabled ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'}`}>
            {st?.promote_enabled ? 'ON' : 'OFF (stage only)'}
          </div>
        </div>
        <div className="rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-800/60">
          <div className="text-[11px] text-gray-500 dark:text-gray-400">Next scheduled run</div>
          <div className="text-sm font-semibold text-gray-700 dark:text-gray-200">{st?.next_run ? fmtDateTime(st.next_run) : '—'}</div>
        </div>
        <div className="rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-800/60">
          <div className="text-[11px] text-gray-500 dark:text-gray-400">Last automated run</div>
          <div className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            {last ? (
              <span>{fmtDateTime(last.started_at)} <RunBadge status={last.status} className="ml-1 text-[10px]" /></span>
            ) : '—'}
          </div>
          <button onClick={() => onViewHistory?.()} className="text-[11px] text-jdil-green hover:underline font-medium mt-1">
            View all sync history →
          </button>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2">Schedule: {st?.schedule || '09:00 & 18:00 IST daily'}</p>

      {/* Live progress */}
      {active && (
        <div className="mt-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400 font-medium">
            <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            Syncing rig {run.rig_index} of {run.total_rigs}: {run.current_rig || '…'}…
          </div>
          <div className="mt-2 h-2 rounded-full bg-amber-100 dark:bg-amber-900/40 overflow-hidden">
            <div className="h-full bg-amber-500 transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80 mt-1">
            Promotion {run.promote_enabled ? 'ON' : 'OFF'} · started {fmtDateTime(run.started_at)}
          </p>
        </div>
      )}

      {triggerMsg && !active && <p className="text-xs text-green-600 dark:text-green-400 mt-3">{triggerMsg}</p>}
      {triggerErr && <p className="text-xs text-red-600 dark:text-red-400 mt-2">{triggerErr}</p>}
      {loadErr  && <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">Status unavailable: {loadErr}</p>}

      {/* Last run per-rig breakdown */}
      {last && Array.isArray(last.rig_results) && last.rig_results.length > 0 && (
        <Collapsible title="Last run — per-rig breakdown" defaultOpen={false}>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-1 p-3">
            {last.rig_results.map((r, i) => (
              <div key={i} className="text-xs flex items-center gap-1.5">
                <span className={RIG_RESULT_DOT[r.status] || 'text-gray-400'}>●</span>
                <span className="font-mono">{r.rig}</span>
                <span className="text-gray-500 dark:text-gray-400">
                  {r.staging_rows ?? 0} staged{r.pos_promoted ? `, ${r.pos_promoted} promoted` : ''}{r.error ? ` — ${r.error}` : ''}
                </span>
              </div>
            ))}
          </div>
        </Collapsible>
      )}
    </div>
  )
}

// ── BC Rate Limiter status + self-test (nothing real is wrapped yet) ────────────
function RateLimiterStatusCard() {
  const [stats, setStats]       = useState(null)
  const [testing, setTesting]   = useState(false)
  const [testResult, setResult] = useState(null)
  const [testErr, setTestErr]   = useState('')

  async function load() {
    try { setStats(await biApi('/rate-limit-status')) } catch { /* non-critical */ }
  }
  useEffect(() => {
    load()
    const id = setInterval(load, 10000)   // poll every 10s
    return () => clearInterval(id)
  }, [])

  async function runTest() {
    setTesting(true); setTestErr(''); setResult(null)
    try { setResult(await biApi('/rate-limiter-test')) }
    catch (e) { setTestErr(e.message) }
    setTesting(false)
    await load()
  }

  const active       = stats?.active ?? 0
  const rpm          = stats?.requests_last_minute ?? 0
  const concurrentMax = stats?.limits?.concurrent ?? 3
  const perMinMax     = stats?.limits?.per_minute ?? 100
  // grey when idle, yellow when any activity, orange when approaching a cap.
  const approaching = active >= concurrentMax - 1 || rpm >= Math.round(perMinMax * 0.7)
  const toneCls = approaching ? 'text-orange-600 dark:text-orange-400'
    : active > 0 ? 'text-amber-600 dark:text-amber-400'
    : 'text-gray-600 dark:text-gray-300'
  const boxCls = approaching ? 'bg-orange-50 dark:bg-orange-900/20'
    : active > 0 ? 'bg-amber-50 dark:bg-amber-900/20'
    : 'bg-gray-50 dark:bg-gray-800/60'

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-jdil-green mb-0.5">BC Rate Limiter Status</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Standalone throttle (max {concurrentMax} concurrent, {perMinMax}/min). Not wrapping any BC call yet — this is for verification.
          </p>
        </div>
        <button onClick={runTest} disabled={testing}
          className="flex items-center gap-2 text-sm text-white px-4 py-2 rounded-lg font-medium bg-jdil-green hover:brightness-110 disabled:opacity-60 disabled:bg-gray-400">
          {testing && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          {testing ? 'Testing…' : 'Test Limiter'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-4">
        <div className={`rounded-lg px-3 py-2 ${boxCls}`}>
          <div className="text-[11px] text-gray-500 dark:text-gray-400">Active requests</div>
          <div className={`text-lg font-bold leading-none ${toneCls}`}>{active} / {concurrentMax}</div>
        </div>
        <div className={`rounded-lg px-3 py-2 ${boxCls}`}>
          <div className="text-[11px] text-gray-500 dark:text-gray-400">Requests in last minute</div>
          <div className={`text-lg font-bold leading-none ${toneCls}`}>{rpm} / {perMinMax}</div>
        </div>
      </div>

      {testErr && <p className="text-xs text-red-600 dark:text-red-400 mt-3">Test failed: {testErr}</p>}
      {testResult && (
        <div className={`mt-3 rounded-lg px-4 py-3 border ${testResult.max_active_observed <= 3
          ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
          : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'}`}>
          <p className={`text-sm font-medium ${testResult.max_active_observed <= 3 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
            {testResult.message}
          </p>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">Max active observed: {testResult.max_active_observed}</p>
          <Collapsible title={`Per-job results (${testResult.test_results?.length || 0})`} defaultOpen={false}>
            <div className="p-2 grid grid-cols-2 sm:grid-cols-5 gap-1">
              {(testResult.test_results || []).map((r, i) => (
                <div key={i} className="text-xs font-mono text-gray-600 dark:text-gray-400">
                  {r.time}: active={r.active_during}
                </div>
              ))}
            </div>
          </Collapsible>
        </div>
      )}
    </div>
  )
}

function SyncToStagingCard({ onViewStaging }) {
  const [prefix, setPrefix]   = useState('')
  const [fiscalYears, setFiscalYears] = useState('2627,2728')
  const [status, setStatus]   = useState('idle')  // idle | loading | success | error
  const [result, setResult]   = useState(null)
  const [err, setErr]         = useState(null)
  const [runs, setRuns]       = useState([])
  const [historyOpen, setHistoryOpen] = useState(false)

  async function loadRuns() {
    try { setRuns(await biApi('/sync-runs')) } catch { /* non-critical */ }
  }
  useEffect(() => { loadRuns() }, [])

  const loading = status === 'loading'
  const rigLabel = RIG_PREFIX_OPTIONS.find(o => o.value === prefix)?.label || 'All rigs'

  async function run() {
    if (!window.confirm('This will fetch BC data and insert rows into the bc_po_staging table. Continue?')) return
    setStatus('loading'); setResult(null); setErr(null)
    try {
      const json = await biApi(`/sync-to-staging?rig_prefix=${encodeURIComponent(prefix)}&fiscal_years=${encodeURIComponent(fiscalYears)}`, 'POST')
      setResult(json); setStatus('success')
      await loadRuns()
    } catch (e) {
      setErr({ error: e.message, hint: e.hint }); setStatus('error')
      await loadRuns()
    }
  }

  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-[#f57c00] mb-0.5">Sync to Staging (Phase 2 — Testing)</h3>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        Fetches BC data and writes to the staging table (bc_po_staging). This does NOT touch po_orders. Review staging rows before promoting.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="label">Filter by Rig</label>
          <select className="input-field w-auto min-w-[220px]" value={prefix} onChange={e => setPrefix(e.target.value)} disabled={loading}>
            {RIG_PREFIX_OPTIONS.map(o => <option key={o.value || 'all'} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Fiscal Years</label>
          <select className="input-field w-auto min-w-[220px]" value={fiscalYears} onChange={e => setFiscalYears(e.target.value)} disabled={loading}>
            {FISCAL_YEAR_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <button onClick={run} disabled={loading}
          className="flex items-center gap-2 text-sm text-white px-4 py-2 rounded-lg font-medium bg-[#f57c00] hover:bg-[#d96c00] disabled:opacity-60 disabled:bg-gray-400">
          {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          {loading ? 'Syncing…' : 'Run Sync to Staging'}
        </button>
      </div>

      <div className="mt-4">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            Syncing to staging for {rigLabel}… (this can take 30–60s)
          </div>
        )}

        {status === 'success' && result && (
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-4 py-3 space-y-2">
            <p className="text-sm text-green-700 dark:text-green-400 font-medium">{result.message}</p>
            <p className="text-xs text-green-700/80 dark:text-green-400/80 font-mono">Sync Run ID: {result.sync_run_id}</p>
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
              <StatCard label="BOs fetched" value={result.summary.total_bos_fetched} />
              <StatCard label="POs processed" value={result.summary.total_pos_processed} />
              <StatCard label="Within range" value={result.summary.pos_within_range} color="green" />
              <StatCard label="Before cutoff" value={result.summary.pos_before_cutoff} />
              <StatCard label="Staged rows" value={result.summary.staging_rows_inserted} color="green" />
              <StatCard label="Pages" value={result.pages_fetched ?? '—'} color={result.likely_truncated ? 'orange' : undefined} />
            </div>
            {result.warnings_count > 0 && (
              <p className="text-xs text-gray-600 dark:text-gray-400">{result.warnings_count} row(s) have warnings (unknown rig / auto-assigned buyer).</p>
            )}
            <div className="flex gap-2 pt-1">
              <button onClick={() => onViewStaging?.(result.sync_run_id)} className="btn-primary text-xs px-3 py-1.5">View Staging Rows</button>
              <button onClick={() => { setHistoryOpen(true); loadRuns() }} className="btn-secondary text-xs px-3 py-1.5">View Sync History</button>
            </div>
          </div>
        )}

        {status === 'error' && err && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3">
            <p className="text-sm text-red-700 dark:text-red-400 font-medium">Sync failed: {err.error}</p>
            {err.hint && <p className="text-xs text-red-600/80 dark:text-red-400/70 mt-1">{err.hint}</p>}
          </div>
        )}
      </div>

      <Collapsible title={`Recent Sync Runs (${Math.min(runs.length, 5)})`} defaultOpen={false}>
        <RecentRunsTable runs={runs.slice(0, 5)} />
      </Collapsible>
      {historyOpen && runs.length > 5 && (
        <div className="mt-2 card overflow-hidden"><RecentRunsTable runs={runs} /></div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SUB-TAB 5 — STAGING ROWS (view only; no promote/delete yet)
// ═══════════════════════════════════════════════════════════════════════════════
const PROMO_BADGE = {
  pending:  'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
  promoted: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  rejected: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
  failed:   'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
}
const PROMO_FILTERS = ['pending', 'promoted', 'rejected', 'all']

// Received-vs-ordered status for a staged line item.
function receiptStatus(ordered, received) {
  const o = Number(ordered) || 0, r = Number(received) || 0
  if (r <= 0)  return { label: 'Not received', cls: 'text-red-700 dark:text-red-400' }
  if (r >= o)  return { label: 'Fully received', cls: 'text-green-700 dark:text-green-400' }
  return { label: 'Partial', cls: 'text-amber-700 dark:text-amber-400' }
}

// Expandable line-items panel for one staging PO (lazy-loads on first open).
// `plan` (optional) is the preview-promote analysis for this row.
function LineItemsRow({ row, plan, colSpan }) {
  const [open, setOpen]       = useState(false)
  const [items, setItems]     = useState(null)   // null = not loaded
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && items === null) {
      setLoading(true); setError('')
      try { setItems(await biApi(`/staging-line-items/${row.id}`)) }
      catch (e) { setError(e.message); setItems([]) }
      setLoading(false)
    }
  }

  const matchStatus = !plan ? '—'
    : plan.action === 'INSERT' ? 'New PO'
    : plan.action === 'UPDATE' ? `Existing PO (${String(plan.existing_po_id || '').slice(0, 8)}…)`
    : (plan.skip_reason || 'skip')

  return (
    <>
      <tr className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
        <td className="table-cell text-xs">
          <button onClick={toggle} className="text-gray-500 hover:text-jdil-green" title={open ? 'Collapse' : 'Expand line items'}>
            <span className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
          </button>
        </td>
        <td className="table-cell text-xs font-mono">{row.po_number || '—'}</td>
        <td className="table-cell text-xs">{row.mr_date || '—'}</td>
        <td className="table-cell text-xs">{row.rig_name || '—'}</td>
        <td className="table-cell text-xs">{row.vendor_name || '—'}</td>
        <td className={`table-cell text-xs ${row.buyer_code === 'ACCOUNTS' ? 'text-gray-400 dark:text-gray-500' : ''}`}>
          {row.buyer_code || '—'}{row.buyer_code_raw && row.buyer_code_raw !== row.buyer_code ? <span className="text-gray-400"> ({row.buyer_code_raw})</span> : ''}
        </td>
        <td className="table-cell text-xs">
          {row.po_status === 'Delivered to Rig'
            ? <span className="rounded-full px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">{row.po_status}</span>
            : (row.po_status || '—')}
        </td>
        <td className="table-cell text-xs">
          {plan ? <span className={`rounded-full px-2 py-0.5 ${ACTION_BADGE[plan.action] || ACTION_BADGE.SKIP}`}>{plan.action}</span>
            : row.sync_action ? <span className={`rounded-full px-2 py-0.5 ${ACTION_BADGE[row.sync_action] || ACTION_BADGE.SKIP}`}>{row.sync_action}</span>
            : '—'}
        </td>
        <td className="table-cell text-xs text-gray-500 dark:text-gray-400">{matchStatus}</td>
        <td className="table-cell text-xs">
          <span className={`rounded-full px-2 py-0.5 ${PROMO_BADGE[row.promotion_status] || ''}`} title={row.promotion_status === 'failed' ? (row.promotion_notes || '') : ''}>
            {row.promotion_status || 'pending'}
          </span>
          {row.promotion_status === 'promoted' && row.promoted_po_id && (
            <span className="block text-[10px] text-gray-400 font-mono mt-0.5">{String(row.promoted_po_id).slice(0, 8)}…</span>
          )}
        </td>
        <td className="table-cell text-xs text-gray-500 dark:text-gray-400 max-w-[240px]">
          {row.quantities_pending_confirmation && (
            <div><span className="inline-block rounded-full px-2 py-0.5 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 font-medium">⚠️ Confirm quantities</span></div>
          )}
          {Array.isArray(row.processed_warnings) && row.processed_warnings.length
            ? <div title={row.processed_warnings.join('; ')} className={row.quantities_pending_confirmation ? 'mt-0.5' : ''}>{row.processed_warnings.join('; ')}</div>
            : (row.quantities_pending_confirmation ? null : '—')}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={colSpan} className="bg-gray-50 dark:bg-gray-900/40 px-6 py-3">
            {/* Promotion plan detail (if analyzed) */}
            {plan && plan.action === 'INSERT' && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">No existing match — this PO will be inserted.</p>
            )}
            {plan && plan.action === 'SKIP' && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Will skip: {plan.skip_reason || '—'}</p>
            )}
            {plan && plan.action === 'UPDATE' && (
              <div className="mb-3">
                <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Field changes (purchase-side):</p>
                {Object.keys(plan.field_changes || {}).length === 0 ? (
                  <p className="text-xs text-gray-400">No field-level changes (line items differ).</p>
                ) : (
                  <table className="text-xs mb-1">
                    <thead><tr className="text-gray-500 dark:text-gray-400">
                      <th className="text-left pr-4 font-medium">Field</th><th className="text-left pr-4 font-medium">From</th><th className="text-left font-medium">To</th>
                    </tr></thead>
                    <tbody>
                      {Object.entries(plan.field_changes).map(([f, c]) => (
                        <tr key={f}>
                          <td className="pr-4 font-mono">{f}</td>
                          <td className="pr-4 text-red-600 dark:text-red-400">{String(c.from ?? '—')}</td>
                          <td className="text-green-600 dark:text-green-400">{String(c.to ?? '—')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <div className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" /> Loading line items…
              </div>
            ) : error ? (
              <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
            ) : !items || items.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500">No line items staged for this PO.</p>
            ) : (
              <table className="w-full text-xs">
                <thead><tr className="text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left py-1.5 pr-3 font-medium">Item Code</th>
                  <th className="text-left py-1.5 pr-3 font-medium">Description</th>
                  <th className="text-center py-1.5 px-2 font-medium">Qty Ordered</th>
                  <th className="text-center py-1.5 px-2 font-medium">Qty Received</th>
                  <th className="text-center py-1.5 px-2 font-medium">Pending</th>
                  <th className="text-left py-1.5 px-2 font-medium">UoM</th>
                  <th className="text-left py-1.5 pl-2 font-medium">Status</th>
                </tr></thead>
                <tbody>
                  {items.map(li => {
                    const ordered = Number(li.qty_ordered) || 0
                    const received = Number(li.qty_received) || 0
                    const pending = Math.max(0, ordered - received)
                    const st = receiptStatus(ordered, received)
                    return (
                      <tr key={li.id} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-1.5 pr-3 font-mono">{li.item_code || '—'}</td>
                        <td className="py-1.5 pr-3">{li.item_description || '—'}</td>
                        <td className="py-1.5 px-2 text-center">{ordered}</td>
                        <td className="py-1.5 px-2 text-center">{received}</td>
                        <td className="py-1.5 px-2 text-center">{pending}</td>
                        <td className="py-1.5 px-2">{li.uom || '—'}</td>
                        <td className={`py-1.5 pl-2 font-medium ${st.cls}`}>{st.label}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

function StagingRowsSub({ initialRunId = '' }) {
  const [rows, setRows]       = useState([])
  const [runs, setRuns]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [runFilter, setRunFilter]       = useState(initialRunId)
  const [statusFilter, setStatusFilter] = useState('pending')
  const [plan, setPlan]         = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [planErr, setPlanErr]   = useState('')
  const [batchSize, setBatchSize] = useState('10')
  const [dryRun, setDryRun]       = useState(true)
  const [promoting, setPromoting] = useState(false)
  const [promoteResult, setPromoteResult] = useState(null)
  const [promoteErr, setPromoteErr]       = useState('')
  const [syncEnabled, setSyncEnabled]     = useState(null)   // null = unknown until /env-status loads

  async function loadRuns() {
    try { setRuns(await biApi('/sync-runs')) } catch { /* non-critical */ }
  }
  async function loadEnv() {
    try { const e = await biApi('/env-status'); setSyncEnabled(!!e.bc_sync_enabled) } catch { /* non-critical */ }
  }
  async function loadRows() {
    setLoading(true); setError('')
    try {
      const qs = `?status=${encodeURIComponent(statusFilter)}${runFilter ? `&sync_run_id=${encodeURIComponent(runFilter)}` : ''}`
      const res = await biApi(`/staging-rows${qs}`)
      setRows(res.rows || [])
    } catch (e) { setError(e.message) }
    setLoading(false)
  }
  useEffect(() => { loadRuns(); loadEnv() }, [])            // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadRows(); setPlan(null); setPlanErr('') }, [runFilter, statusFilter])  // eslint-disable-line react-hooks/exhaustive-deps

  async function analyze() {
    if (!runFilter) return
    setAnalyzing(true); setPlanErr('')
    try {
      const res = await biApi(`/preview-promote?sync_run_id=${encodeURIComponent(runFilter)}`, 'POST')
      setPlan(res)
      await loadRows()   // refresh to pick up persisted sync_action
    } catch (e) { setPlanErr(e.message) }
    setAnalyzing(false)
  }

  const planById = useMemo(() => new Map((plan?.rows || []).map(r => [r.staging_id, r])), [plan])
  const planWarnings = plan ? plan.rows.filter(r => Array.isArray(r.warnings) && r.warnings.length).length : 0

  async function promote() {
    if (!runFilter) return
    const n = batchSize === 'all' ? 'all remaining' : batchSize
    const msg = dryRun
      ? `Dry run: analyze promoting ${n} POs. No data will be written. Continue?`
      : `You are about to promote ${n} POs to the production po_orders table. This action is IRREVERSIBLE (except via Supabase backup restore). Continue?`
    if (!window.confirm(msg)) return
    setPromoting(true); setPromoteErr(''); setPromoteResult(null)
    try {
      const bs = batchSize === 'all' ? 1000 : batchSize
      const res = await biApi(`/promote-to-po-orders?sync_run_id=${encodeURIComponent(runFilter)}&batch_size=${bs}&dry_run=${dryRun}`, 'POST')
      setPromoteResult(res)
      await loadRows()
    } catch (e) { setPromoteErr(e.message) }
    setPromoting(false)
  }

  return (
    <div className="space-y-4">
      {/* Promotion Plan (dry run) */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-[#1976d2] mb-0.5">Promotion Plan</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Analyze what will happen when staging data is promoted to the main po_orders table, then execute in safe batches.
        </p>
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-xs font-medium rounded-lg px-3 py-2 mb-3">
          ⚠️ PRODUCTION WRITE — the Execute Promotion section below writes to po_orders. Proceed with caution; use Dry Run first.
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={analyze} disabled={!runFilter || analyzing}
            className="flex items-center gap-2 text-sm text-white px-4 py-2 rounded-lg font-medium bg-[#1976d2] hover:bg-[#145ea8] disabled:opacity-60 disabled:bg-gray-400">
            {analyzing && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {analyzing ? 'Analyzing…' : 'Analyze Promotion Plan'}
          </button>
          {!runFilter && <span className="text-xs text-gray-400 dark:text-gray-500">Select a Sync Run below to analyze.</span>}
        </div>
        {planErr && <p className="text-xs text-red-600 dark:text-red-400 mt-2">{planErr}</p>}
        {plan && (
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <StatCard label="Will INSERT" value={plan.summary.will_insert} color="green" />
              <StatCard label="Will UPDATE" value={plan.summary.will_update} />
              <StatCard label="Will SKIP" value={plan.summary.will_skip} />
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Inserts with GRN: {plan.summary.inserts_with_grn} · Updates with GRN: {plan.summary.updates_with_grn} · Rows with warnings: {planWarnings}
            </p>
          </div>
        )}

        {/* Execute Promotion */}
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-800">
          <h4 className="text-sm font-semibold text-red-600 dark:text-red-400 mb-2">Execute Promotion</h4>
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="label">Batch Size</label>
              <select className="input-field w-auto min-w-[120px]" value={batchSize} onChange={e => setBatchSize(e.target.value)} disabled={promoting}>
                {['1', '5', '10', '25', '50', 'all'].map(b => <option key={b} value={b}>{b === 'all' ? 'All remaining' : b}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300 pb-2">
              <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)} className="accent-jdil-green w-4 h-4" disabled={promoting} />
              Dry Run (no writes)
            </label>
            <button onClick={promote} disabled={!runFilter || promoting || (!dryRun && syncEnabled === false)}
              title={!dryRun && syncEnabled === false ? 'BC_SYNC_ENABLED=false in server environment' : undefined}
              className="flex items-center gap-2 text-sm text-white px-4 py-2 rounded-lg font-medium bg-red-600 hover:bg-red-700 disabled:opacity-60 disabled:bg-gray-400">
              {promoting && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {!dryRun && syncEnabled === false ? 'Promote (DISABLED)' : promoting ? 'Promoting…' : (dryRun ? 'Promote Batch (Dry Run)' : 'Promote Batch')}
            </button>
            {!runFilter && <span className="text-xs text-gray-400 dark:text-gray-500 pb-2">Select a Sync Run below first.</span>}
          </div>

          {promoteErr && <p className="text-xs text-red-600 dark:text-red-400 mt-2">{promoteErr}</p>}

          {promoteResult && (
            <div className={`mt-3 rounded-lg px-4 py-3 border ${promoteResult.dry_run
              ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
              : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'}`}>
              <p className={`text-sm font-medium ${promoteResult.dry_run ? 'text-blue-700 dark:text-blue-400' : 'text-green-700 dark:text-green-400'}`}>
                {promoteResult.dry_run
                  ? `Dry run: ${promoteResult.pos_promoted} PO(s) would be promoted, ${promoteResult.line_items_promoted} line item(s) created.`
                  : `${promoteResult.pos_promoted} PO(s) promoted, ${promoteResult.line_items_promoted} line item(s) created.`}
                {promoteResult.pos_failed > 0 && <span className="text-red-600 dark:text-red-400"> · {promoteResult.pos_failed} failed</span>}
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">Remaining pending INSERTs: {promoteResult.remaining_pending}</p>
              <div className="flex gap-2 mt-2">
                {!promoteResult.dry_run && promoteResult.remaining_pending > 0 && (
                  <button onClick={promote} disabled={promoting || syncEnabled === false} className="btn-primary text-xs px-3 py-1.5">Promote Next Batch</button>
                )}
                <button onClick={loadRows} className="btn-secondary text-xs px-3 py-1.5">Refresh Rows</button>
              </div>
              {Array.isArray(promoteResult.details) && promoteResult.details.some(d => d.status === 'failed') && (
                <Collapsible title={`Failures (${promoteResult.details.filter(d => d.status === 'failed').length})`}>
                  <div className="p-2 text-xs space-y-1">
                    {promoteResult.details.filter(d => d.status === 'failed').map((d, i) => (
                      <div key={i} className="text-red-600 dark:text-red-400"><span className="font-mono">{d.po_number}</span>: {d.error}</div>
                    ))}
                  </div>
                </Collapsible>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-end gap-2 flex-wrap">
        <div>
          <label className="label">Sync Run</label>
          <select className="input-field w-auto min-w-[260px]" value={runFilter} onChange={e => setRunFilter(e.target.value)}>
            <option value="">All runs</option>
            {runs.map(r => (
              <option key={r.id} value={r.id}>{fmtDateTime(r.started_at)} · {r.rig_filter || 'All'} · {r.staging_rows_inserted ?? 0} rows</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Promotion Status</label>
          <select className="input-field w-auto min-w-[150px]" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            {PROMO_FILTERS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 ml-auto self-center">{loading ? 'Loading…' : `${rows.length} row${rows.length !== 1 ? 's' : ''}`}</p>
      </div>
      <ErrorBanner error={error} onRetry={loadRows} />
      {loading ? <Spinner /> : rows.length === 0 ? (
        <p className="text-center py-12 text-sm text-gray-400">No staging rows for this filter. Run a "Sync to Staging" above to populate.</p>
      ) : (
        <div className="card overflow-hidden"><div className="overflow-x-auto">
          <table className="w-full min-w-[1140px]">
            <thead><tr className="border-b border-gray-200 dark:border-gray-800">
              <th className="table-header w-8"></th>
              <th className="table-header">PO Number</th>
              <th className="table-header">MR Date</th>
              <th className="table-header">Rig</th>
              <th className="table-header">Vendor</th>
              <th className="table-header">Buyer</th>
              <th className="table-header">PO Status</th>
              <th className="table-header">Planned Action</th>
              <th className="table-header">Match Status</th>
              <th className="table-header">Promotion</th>
              <th className="table-header">Warnings</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {rows.map(r => <LineItemsRow key={r.id} row={r} plan={planById.get(r.id)} colSpan={11} />)}
            </tbody>
          </table>
        </div></div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SUB-TAB 6 — SYNC HISTORY (paginated, filterable view of bc_sync_runs)
// ═══════════════════════════════════════════════════════════════════════════════
const HISTORY_STATUS_FILTERS = [
  { value: '',                label: 'All statuses' },
  { value: 'success',         label: '✓ Success' },
  { value: 'partial_failure', label: '⚠️ Partial Failure' },
  { value: 'failed',          label: '❌ Failed' },
  { value: 'timeout',         label: '⏱️ Timeout' },
  { value: 'running',         label: '⚡ Running' },
]
const HISTORY_TRIGGER_FILTERS = [
  { value: '',         label: 'All triggers' },
  { value: 'manual',   label: '👤 Manual' },
  { value: 'cron-9am', label: '🕘 Cron 9am' },
  { value: 'cron-6pm', label: '🕕 Cron 6pm' },
]
const HISTORY_DATE_FILTERS = [
  { value: 7,  label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'All (last 90 days)' },
]

// Rigs attempted/completed for a run. Master cron runs carry rig_results (v28);
// single-rig manual syncs don't, so fall back to the overall status.
function rigCounts(run) {
  const rigs = Array.isArray(run.rig_results) ? run.rig_results : []
  if (rigs.length) {
    return { attempted: rigs.length, completed: rigs.filter(r => r.status !== 'failed').length }
  }
  const attempted = run.rig_filter && run.rig_filter !== 'ALL' ? 1 : (run.rig_filter === 'ALL' ? 0 : 1)
  const failed    = ['failed', 'timeout'].includes(run.status)
  const running   = ['running', 'stale'].includes(run.status)
  return { attempted, completed: running ? 0 : (failed ? 0 : attempted) }
}

// One expandable history row. Detail reveals per-rig breakdown, errors,
// truncation warnings, promote-skip reason, and a link to this run's staging rows.
function HistoryRow({ run, onViewStaging }) {
  const [open, setOpen] = useState(false)
  const rigs      = Array.isArray(run.rig_results) ? run.rig_results : []
  const truncated = Array.isArray(run.truncation_warnings) ? run.truncation_warnings : []
  const { attempted, completed } = rigCounts(run)
  const skipReasons = [...new Set(rigs.filter(r => r.promote_skipped && r.promote_skip_reason).map(r => r.promote_skip_reason))]

  return (
    <>
      <tr className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
        <td className="table-cell text-xs whitespace-nowrap">
          <button onClick={() => setOpen(o => !o)} className="text-gray-500 hover:text-jdil-green mr-1" title={open ? 'Collapse' : 'View details'}>
            <span className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
          </button>
          {fmtDateTime(run.started_at)}
        </td>
        <td className="table-cell text-xs whitespace-nowrap">{triggerLabel(run)}</td>
        <td className="table-cell text-xs text-center whitespace-nowrap">
          {attempted ? <>{completed}<span className="text-gray-400"> / {attempted}</span></> : '—'}
        </td>
        <td className="table-cell text-xs text-center">{run.total_pos_processed ?? '—'}</td>
        <td className="table-cell text-xs text-center">{run.staging_rows_inserted ?? 0}</td>
        <td className="table-cell text-xs">
          <RunBadge status={run.status} />
          {truncated.length > 0 && (
            <span className="ml-1 rounded-full px-2 py-0.5 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 whitespace-nowrap"
              title={`These rigs returned a full page — possible truncation: ${truncated.join(', ')}`}>⚠️ Truncation</span>
          )}
        </td>
        <td className="table-cell text-xs whitespace-nowrap">{run.processing_time_ms != null ? `${(run.processing_time_ms / 1000).toFixed(1)}s` : '—'}</td>
        <td className="table-cell text-xs text-right pr-4">
          <button onClick={() => setOpen(o => !o)} className="text-xs border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 px-2.5 py-1 rounded-md">
            {open ? 'Hide' : 'View Details'}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={8} className="bg-gray-50 dark:bg-gray-900/40 px-6 py-3">
            {/* Per-rig breakdown */}
            {rigs.length > 0 ? (
              <>
                <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">Per-rig breakdown ({rigs.length} rigs)</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-1">
                  {rigs.map((r, i) => (
                    <div key={i} className="text-xs flex items-center gap-1.5">
                      <span className={RIG_RESULT_DOT[r.status] || 'text-gray-400'}>●</span>
                      <span className="font-mono">{r.rig}</span>
                      {truncated.includes(r.rig) && (
                        <span className="text-orange-600 dark:text-orange-400 whitespace-nowrap" title="Returned a full page — may be truncated">⚠️ {r.bo_count ?? 'full'} BOs</span>
                      )}
                      <span className="text-gray-500 dark:text-gray-400">
                        {r.staging_rows ?? 0} staged{r.pos_promoted ? `, ${r.pos_promoted} promoted` : ''}{r.error ? ` — ${r.error}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Single-rig sync ({run.rig_filter || '—'}) — no per-rig breakdown recorded.
              </p>
            )}

            {/* Truncation warnings */}
            {truncated.length > 0 && (
              <p className="text-xs text-orange-600 dark:text-orange-400 mt-2">
                ⚠️ Possible truncation on: <span className="font-mono">{truncated.join(', ')}</span> (returned a full page — data may be incomplete).
              </p>
            )}

            {/* Promote skip reason */}
            {skipReasons.length > 0 && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                Promotion skipped: {skipReasons.join('; ')} (staged for review only).
              </p>
            )}

            {/* Error message */}
            {run.error_message && (
              <p className="text-xs text-red-600 dark:text-red-400 mt-2">Error: {run.error_message}</p>
            )}

            {/* Link to staging rows for this run */}
            <div className="mt-3">
              <button onClick={() => onViewStaging?.(run.id)} className="text-xs text-jdil-green hover:underline font-medium">
                View staging rows from this run →
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function SyncHistorySub({ onViewStaging }) {
  const [data, setData]       = useState(null)   // full /sync-history payload
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [statusFilter, setStatusFilter]   = useState('')
  const [triggerFilter, setTriggerFilter] = useState('')
  const [days, setDays]       = useState(7)
  const [page, setPage]       = useState(1)

  async function load() {
    setLoading(true); setError('')
    try {
      const qs = new URLSearchParams({ days: String(days), page: String(page), per_page: '20' })
      if (statusFilter)  qs.set('status', statusFilter)
      if (triggerFilter) qs.set('trigger', triggerFilter)
      setData(await biApi(`/sync-history?${qs.toString()}`))
    } catch (e) { setError(e.message) }
    setLoading(false)
  }
  // Reload whenever filters/page change. Reset to page 1 when a filter changes.
  useEffect(() => { load() }, [statusFilter, triggerFilter, days, page])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1) }, [statusFilter, triggerFilter, days])

  const stats = data?.stats
  const runs  = data?.runs || []
  const pg    = data?.pagination

  return (
    <div className="space-y-4">
      {/* Header stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <div className="rounded-lg px-3 py-2 bg-green-50 dark:bg-green-900/20">
          <div className="text-[11px] text-gray-500 dark:text-gray-400">Last successful run</div>
          <div className="text-sm font-semibold text-green-700 dark:text-green-400">{stats?.last_successful ? fmtDateTime(stats.last_successful.started_at) : '—'}</div>
        </div>
        <div className="rounded-lg px-3 py-2 bg-red-50 dark:bg-red-900/20">
          <div className="text-[11px] text-gray-500 dark:text-gray-400">Last failed run</div>
          <div className="text-sm font-semibold text-red-700 dark:text-red-400" title={stats?.last_failed?.error_message || ''}>
            {stats?.last_failed ? fmtDateTime(stats.last_failed.started_at) : '—'}
          </div>
        </div>
        <div className="rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-800/60">
          <div className="text-[11px] text-gray-500 dark:text-gray-400">Total runs ({days}d)</div>
          <div className="text-lg font-bold leading-none text-gray-700 dark:text-gray-200 mt-1">{stats ? stats.total_runs : '—'}</div>
        </div>
        <div className="rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-800/60">
          <div className="text-[11px] text-gray-500 dark:text-gray-400">Success rate ({days}d)</div>
          <div className="text-lg font-bold leading-none text-gray-700 dark:text-gray-200 mt-1">{stats ? `${Math.round(stats.success_rate * 100)}%` : '—'}</div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-end gap-2 flex-wrap">
        <div>
          <label className="label">Status</label>
          <select className="input-field w-auto min-w-[160px]" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            {HISTORY_STATUS_FILTERS.map(f => <option key={f.value || 'all'} value={f.value}>{f.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Trigger</label>
          <select className="input-field w-auto min-w-[150px]" value={triggerFilter} onChange={e => setTriggerFilter(e.target.value)}>
            {HISTORY_TRIGGER_FILTERS.map(f => <option key={f.value || 'all'} value={f.value}>{f.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Date range</label>
          <select className="input-field w-auto min-w-[150px]" value={days} onChange={e => setDays(Number(e.target.value))}>
            {HISTORY_DATE_FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
        <button onClick={load} className="btn-secondary text-sm ml-auto" disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
      </div>

      <ErrorBanner error={error} onRetry={load} />

      {loading ? <Spinner /> : runs.length === 0 ? (
        <p className="text-center py-12 text-sm text-gray-400">No sync runs match these filters.</p>
      ) : (
        <>
          <div className="card overflow-hidden"><div className="overflow-x-auto">
            <table className="w-full min-w-[860px]">
              <thead><tr className="border-b border-gray-200 dark:border-gray-800">
                <th className="table-header">Started</th>
                <th className="table-header">Trigger</th>
                <th className="table-header text-center">Rigs done / tried</th>
                <th className="table-header text-center">POs processed</th>
                <th className="table-header text-center">Rows inserted</th>
                <th className="table-header">Status</th>
                <th className="table-header">Duration</th>
                <th className="table-header text-right pr-4">Actions</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {runs.map(run => <HistoryRow key={run.id} run={run} onViewStaging={onViewStaging} />)}
              </tbody>
            </table>
          </div></div>

          {/* Pagination */}
          {pg && (
            <div className="flex items-center justify-between gap-3 flex-wrap text-sm">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Page {pg.page} of {pg.total_pages} · {pg.total} run{pg.total !== 1 ? 's' : ''} total
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={pg.page <= 1 || loading}
                  className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-50">← Prev</button>
                <button onClick={() => setPage(p => Math.min(pg.total_pages, p + 1))} disabled={pg.page >= pg.total_pages || loading}
                  className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-50">Next →</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN — BC INTEGRATION TAB
// ═══════════════════════════════════════════════════════════════════════════════
const SUB_TABS = ['Rig Mapping', 'Buyer Mapping', 'Buyer Aliases', 'Data Quality Alerts', 'Staging Rows', '⏱ Sync History']

export default function BCIntegrationTab() {
  const [sub, setSub] = useState(0)
  const [stagingRunId, setStagingRunId] = useState('')
  return (
    <div className="space-y-4">
      {/* Connection test (above the sub-tabs) */}
      <BCConnectionTest />

      {/* Data fetch test (below connection test, above the sub-tabs) */}
      <BCDataFetchTest />

      {/* Preview sync dry-run (below data fetch, above the sub-tabs) */}
      <PreviewSyncCard />

      {/* Automated sync (cron) status + manual trigger (above Sync to Staging) */}
      <AutomatedSyncCard onViewHistory={() => setSub(5)} />

      {/* Rate limiter status + self-test (below Automated Sync, above Sync to Staging) */}
      <RateLimiterStatusCard />

      {/* Sync to staging (writes to bc_po_staging, above the sub-tabs) */}
      <SyncToStagingCard onViewStaging={id => { setStagingRunId(id); setSub(4) }} />

      {/* Sub-tab bar */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800 overflow-x-auto scrollbar-none">
        {SUB_TABS.map((t, i) => (
          <button key={t} onClick={() => setSub(i)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors shrink-0 whitespace-nowrap ${
              sub === i ? 'border-jdil-green text-jdil-green' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
            {t}
          </button>
        ))}
      </div>

      {sub === 0 && <RigMappingSub />}
      {sub === 1 && <BuyerMappingSub />}
      {sub === 2 && <AliasesSub />}
      {sub === 3 && <AlertsSub />}
      {sub === 4 && <StagingRowsSub initialRunId={stagingRunId} />}
      {sub === 5 && <SyncHistorySub onViewStaging={id => { setStagingRunId(id); setSub(4) }} />}
    </div>
  )
}
