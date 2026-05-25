import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatDate } from '../utils/helpers'
import { BUYER_CODES, LOGISTICS_CODES, PO_RIG_OPTIONS } from '../utils/constants'

const TABS = ['User Management', 'Audit Log', 'System Settings']

// ── API helper (calls Express /api/users with the user's JWT) ─────────────────
async function userApi(path, method = 'GET', body = undefined) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const res = await fetch(`/api/users${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Request failed')
  return json
}

// ── CSV export ────────────────────────────────────────────────────────────────
function downloadCSV(rows, filename = 'audit_log.csv') {
  if (!rows.length) return
  const headers = ['Date/Time', 'Changed By', 'Email', 'PO Number', 'Rig', 'Field', 'Old Value', 'New Value', 'Reason']
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [
    headers.join(','),
    ...rows.map(r => [
      r.changed_at ? new Date(r.changed_at).toLocaleString('en-IN') : '',
      r.users?.name ?? '',
      r.users?.email ?? '',
      r.po_orders?.po_number ?? r.po_id?.slice(0, 8) ?? '',
      r.po_orders?.rig_name ?? '',
      r.field_changed ?? '',
      r.old_value ?? '',
      r.new_value ?? '',
      r.reason ?? '',
    ].map(esc).join(',')),
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ── StatBadge ─────────────────────────────────────────────────────────────────
function StatBadge({ label, value, color = 'gray' }) {
  const colors = {
    gray:  'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300',
    green: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
    amber: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
    red:   'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
  }
  return (
    <div className={`rounded-lg px-4 py-3 flex flex-col items-center min-w-[80px] ${colors[color]}`}>
      <span className="text-2xl font-bold leading-none">{value}</span>
      <span className="text-xs mt-1 font-medium">{label}</span>
    </div>
  )
}

// ── EditUserModal ─────────────────────────────────────────────────────────────
function EditUserModal({ user, onClose, onSave }) {
  const [role, setRole]         = useState(user.role ?? '')
  const [teamCode, setTeamCode] = useState(user.team_code ?? '')
  const [rigName, setRigName]   = useState(user.rig_name ?? '')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  const teamCodes =
    role === 'purchase'  ? BUYER_CODES :
    role === 'logistics' ? LOGISTICS_CODES : []

  async function handleSave() {
    setSaving(true); setError('')
    try {
      await userApi(`/${user.id}`, 'PATCH', {
        role,
        team_code: teamCode || null,
        rig_name:  rigName  || null,
      })
      onSave()
    } catch (e) { setError(e.message) }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-sm p-6">
        <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 mb-4">
          Edit User — {user.name}
        </h3>

        <div className="space-y-3">
          <div>
            <label className="label">Role</label>
            <select className="input-field" value={role}
              onChange={e => { setRole(e.target.value); setTeamCode(''); setRigName('') }}>
              <option value="">Select role…</option>
              <option value="purchase">Purchase</option>
              <option value="logistics">Logistics</option>
              <option value="rig">Rig</option>
              <option value="csuite">C-Suite</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          {teamCodes.length > 0 && (
            <div>
              <label className="label">Team Code</label>
              <select className="input-field" value={teamCode} onChange={e => setTeamCode(e.target.value)}>
                <option value="">None</option>
                {teamCodes.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}

          {role === 'rig' && (
            <div>
              <label className="label">Assigned Rig</label>
              <select className="input-field" value={rigName} onChange={e => setRigName(e.target.value)}>
                <option value="">None</option>
                {PO_RIG_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          )}
        </div>

        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex gap-2 mt-5">
          <button onClick={handleSave} disabled={saving}
            className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-60">
            {saving && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AdminPage() {
  const { profile } = useAuth()
  const [tab, setTab] = useState(0)

  // ── User Management ──
  const [users, setUsers]               = useState([])
  const [usersLoading, setUsersLoading] = useState(true)
  const [usersError, setUsersError]     = useState('')
  const [search, setSearch]             = useState('')
  const [editingUser, setEditingUser]   = useState(null)
  const [actionBusy, setActionBusy]     = useState({}) // { [userId]: 'approve'|'reject'|'deactivate' }

  // ── Audit Log ──
  const [auditLog, setAuditLog]         = useState([])
  const [auditLoaded, setAuditLoaded]   = useState(false)
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditFilter, setAuditFilter]   = useState({ from: '', to: '', userId: '', poNumber: '' })

  // ── System Settings ──
  const [settings, setSettings]               = useState({
    overdue_threshold_days:      45,
    alert_emails:                [],
    email_notifications_enabled: true,
  })
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [settingsSaving, setSettingsSaving]   = useState(false)
  const [settingsMsg, setSettingsMsg]         = useState('')
  const [newEmail, setNewEmail]               = useState('')

  // ── Data loaders ──
  async function loadUsers() {
    setUsersLoading(true); setUsersError('')
    try {
      const data = await userApi('/')
      setUsers(data)
    } catch (e) { setUsersError(e.message) }
    setUsersLoading(false)
  }

  async function loadAudit() {
    setAuditLoading(true)
    const { data } = await supabase
      .from('audit_log')
      .select('*, users(name, email), po_orders(po_number, rig_name)')
      .order('changed_at', { ascending: false })
      .limit(500)
    setAuditLog(data || [])
    setAuditLoaded(true)
    setAuditLoading(false)
  }

  async function loadSettings() {
    setSettingsLoading(true)
    const { data } = await supabase.from('system_settings').select('*')
    if (data) {
      const map = Object.fromEntries(data.map(r => [r.key, r.value]))
      setSettings({
        overdue_threshold_days:      map.overdue_threshold_days      ?? 45,
        alert_emails:                map.alert_emails                ?? [],
        email_notifications_enabled: map.email_notifications_enabled ?? true,
      })
    }
    setSettingsLoading(false)
  }

  // Initial load
  useEffect(() => { loadUsers() }, [])

  // Lazy-load audit log when tab first opens
  useEffect(() => {
    if (tab === 1 && !auditLoaded) loadAudit()
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  // Lazy-load settings when tab first opens
  useEffect(() => {
    if (tab === 2) loadSettings()
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── User actions ──
  async function handleApprove(id) {
    setActionBusy(b => ({ ...b, [id]: 'approve' }))
    try { await userApi(`/${id}/approve`, 'PATCH'); await loadUsers() }
    catch (e) { alert(e.message) }
    setActionBusy(b => ({ ...b, [id]: null }))
  }

  async function handleReject(id, name) {
    if (!window.confirm(`Permanently delete "${name}"? This cannot be undone.`)) return
    setActionBusy(b => ({ ...b, [id]: 'reject' }))
    try { await userApi(`/${id}`, 'DELETE'); await loadUsers() }
    catch (e) { alert(e.message) }
    setActionBusy(b => ({ ...b, [id]: null }))
  }

  async function handleDeactivate(id) {
    setActionBusy(b => ({ ...b, [id]: 'deactivate' }))
    try { await userApi(`/${id}/deactivate`, 'PATCH'); await loadUsers() }
    catch (e) { alert(e.message) }
    setActionBusy(b => ({ ...b, [id]: null }))
  }

  async function handleReactivate(id) {
    setActionBusy(b => ({ ...b, [id]: 'reactivate' }))
    try { await userApi(`/${id}/approve`, 'PATCH'); await loadUsers() }
    catch (e) { alert(e.message) }
    setActionBusy(b => ({ ...b, [id]: null }))
  }

  // ── Derived state ──
  const pendingCount = users.filter(u => !u.is_active).length
  const activeCount  = users.filter(u =>  u.is_active).length

  // Pending users first, then active, filtered by search
  const filteredUsers = useMemo(() => {
    const q = search.toLowerCase().trim()
    const sorted = [...users.filter(u => !u.is_active), ...users.filter(u => u.is_active)]
    if (!q) return sorted
    return sorted.filter(u =>
      u.name?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q)
    )
  }, [users, search])

  const filteredAudit = useMemo(() => {
    let rows = auditLog
    if (auditFilter.from)
      rows = rows.filter(r => r.changed_at >= auditFilter.from)
    if (auditFilter.to)
      rows = rows.filter(r => r.changed_at <= auditFilter.to + 'T23:59:59')
    if (auditFilter.userId)
      rows = rows.filter(r => r.changed_by === auditFilter.userId)
    if (auditFilter.poNumber.trim()) {
      const q = auditFilter.poNumber.trim().toLowerCase()
      rows = rows.filter(r => r.po_orders?.po_number?.toLowerCase().includes(q))
    }
    return rows
  }, [auditLog, auditFilter])

  // Unique users who appear in the audit log (for the "Changed By" filter dropdown)
  const auditUsers = useMemo(() => {
    const map = {}
    auditLog.forEach(r => { if (r.changed_by && r.users?.name) map[r.changed_by] = r.users.name })
    return Object.entries(map).map(([id, name]) => ({ id, name }))
  }, [auditLog])

  // ── Settings actions ──
  async function handleSaveSettings() {
    setSettingsSaving(true); setSettingsMsg('')
    const rows = [
      { key: 'overdue_threshold_days',      value: settings.overdue_threshold_days,      updated_at: new Date().toISOString() },
      { key: 'alert_emails',                value: settings.alert_emails,                updated_at: new Date().toISOString() },
      { key: 'email_notifications_enabled', value: settings.email_notifications_enabled, updated_at: new Date().toISOString() },
    ]
    const { error } = await supabase.from('system_settings').upsert(rows, { onConflict: 'key' })
    setSettingsMsg(error ? `Error: ${error.message}` : 'Settings saved successfully!')
    setSettingsSaving(false)
    setTimeout(() => setSettingsMsg(''), 3500)
  }

  function addAlertEmail() {
    const e = newEmail.trim().toLowerCase()
    if (!e || !e.includes('@') || settings.alert_emails.includes(e)) return
    setSettings(s => ({ ...s, alert_emails: [...s.alert_emails, e] }))
    setNewEmail('')
  }

  function removeAlertEmail(email) {
    setSettings(s => ({ ...s, alert_emails: s.alert_emails.filter(x => x !== email) }))
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 lg:p-6">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Admin Panel</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">System administration &amp; configuration</p>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800 mb-6 overflow-x-auto scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={`px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors relative shrink-0 whitespace-nowrap ${
              tab === i
                ? 'border-jdil-green text-jdil-green'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}>
            {t}
            {t === 'User Management' && pendingCount > 0 && (
              <span className="ml-1.5 bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 leading-none">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════
          TAB 0 — USER MANAGEMENT
      ══════════════════════════════════════════════ */}
      {tab === 0 && (
        <div className="space-y-4">
          {/* Stat badges + search row */}
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            <div className="flex gap-2 flex-wrap">
              <StatBadge label="Total"   value={users.length} color="gray" />
              <StatBadge label="Pending" value={pendingCount} color={pendingCount > 0 ? 'amber' : 'gray'} />
              <StatBadge label="Active"  value={activeCount}  color="green" />
            </div>
            <div className="relative w-full sm:w-64">
              <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input type="text" className="input-field pl-9" placeholder="Search name or email…"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>

          {/* Error banner */}
          {usersError && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm rounded-lg px-4 py-3">
              {usersError} —{' '}
              <button onClick={loadUsers} className="underline font-medium">retry</button>
            </div>
          )}

          {/* Table */}
          {usersLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 border-4 border-jdil-green border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filteredUsers.length === 0 ? (
            <p className="text-center py-12 text-sm text-gray-400">No users found</p>
          ) : (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px]">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-800">
                      <th className="table-header">Name</th>
                      <th className="table-header">Email</th>
                      <th className="table-header">Role</th>
                      <th className="table-header">Team / Rig</th>
                      <th className="table-header">Status</th>
                      <th className="table-header">Registered</th>
                      <th className="table-header text-right pr-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {filteredUsers.map(u => {
                      const busy = actionBusy[u.id]
                      return (
                        <tr key={u.id} className={`hover:bg-gray-50 dark:hover:bg-gray-800/50 ${!u.is_active ? 'bg-amber-50/30 dark:bg-amber-900/5' : ''}`}>
                          <td className="table-cell font-medium text-sm">{u.name}</td>
                          <td className="table-cell text-xs text-gray-500 dark:text-gray-400">{u.email}</td>
                          <td className="table-cell">
                            <span className="text-xs capitalize bg-gray-100 dark:bg-gray-800 rounded px-2 py-0.5">
                              {u.role}
                            </span>
                          </td>
                          <td className="table-cell text-xs text-gray-500 dark:text-gray-400">
                            {u.team_code || u.rig_name || '—'}
                          </td>
                          <td className="table-cell">
                            {u.is_active
                              ? <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full px-2.5 py-0.5">Active</span>
                              : <span className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-full px-2.5 py-0.5">Pending</span>
                            }
                          </td>
                          <td className="table-cell text-xs text-gray-400 dark:text-gray-500">
                            {formatDate(u.created_at?.split('T')[0])}
                          </td>
                          <td className="table-cell">
                            <div className="flex items-center justify-end gap-1.5 flex-wrap">
                              {!u.is_active ? (
                                <>
                                  <button onClick={() => handleApprove(u.id)} disabled={!!busy}
                                    className="text-xs bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-2.5 py-1 rounded-md transition-colors">
                                    {busy === 'approve' ? '…' : 'Approve'}
                                  </button>
                                  <button onClick={() => handleReject(u.id, u.name)} disabled={!!busy}
                                    className="text-xs bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-2.5 py-1 rounded-md transition-colors">
                                    {busy === 'reject' ? '…' : 'Reject'}
                                  </button>
                                </>
                              ) : (
                                <button onClick={() => handleDeactivate(u.id)} disabled={!!busy}
                                  className="text-xs bg-gray-500 hover:bg-gray-600 disabled:opacity-50 text-white px-2.5 py-1 rounded-md transition-colors">
                                  {busy === 'deactivate' ? '…' : 'Deactivate'}
                                </button>
                              )}
                              <button onClick={() => setEditingUser(u)}
                                className="text-xs border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 px-2.5 py-1 rounded-md transition-colors">
                                Edit
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════
          TAB 1 — AUDIT LOG
      ══════════════════════════════════════════════ */}
      {tab === 1 && (
        <div className="space-y-4">
          {/* Filters bar */}
          <div className="card p-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="label">From</label>
                <input type="date" className="input-field" value={auditFilter.from}
                  onChange={e => setAuditFilter(f => ({ ...f, from: e.target.value }))} />
              </div>
              <div>
                <label className="label">To</label>
                <input type="date" className="input-field" value={auditFilter.to}
                  onChange={e => setAuditFilter(f => ({ ...f, to: e.target.value }))} />
              </div>
              <div>
                <label className="label">Changed By</label>
                <select className="input-field" value={auditFilter.userId}
                  onChange={e => setAuditFilter(f => ({ ...f, userId: e.target.value }))}>
                  <option value="">All Users</option>
                  {auditUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">PO Number</label>
                <input type="text" className="input-field" placeholder="e.g. PO-2025-001"
                  value={auditFilter.poNumber}
                  onChange={e => setAuditFilter(f => ({ ...f, poNumber: e.target.value }))} />
              </div>
              <button onClick={() => downloadCSV(filteredAudit)}
                className="btn-secondary flex items-center gap-2 text-sm ml-auto">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Export CSV
              </button>
            </div>
          </div>

          <p className="text-xs text-gray-400 dark:text-gray-500">
            {filteredAudit.length} record{filteredAudit.length !== 1 ? 's' : ''}
          </p>

          <div className="card overflow-hidden">
            {auditLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-8 h-8 border-4 border-jdil-green border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[920px]">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-800">
                      <th className="table-header whitespace-nowrap">Date / Time</th>
                      <th className="table-header">Changed By</th>
                      <th className="table-header">PO Number</th>
                      <th className="table-header">Rig</th>
                      <th className="table-header">Field</th>
                      <th className="table-header">Old Value</th>
                      <th className="table-header">New Value</th>
                      <th className="table-header">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {filteredAudit.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="text-center py-12 text-sm text-gray-400">
                          No audit records found
                        </td>
                      </tr>
                    ) : filteredAudit.map(log => (
                      <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                        <td className="table-cell text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                          {log.changed_at ? new Date(log.changed_at).toLocaleString('en-IN') : '—'}
                        </td>
                        <td className="table-cell text-xs">
                          <div className="font-medium text-gray-800 dark:text-gray-200">{log.users?.name || '—'}</div>
                          <div className="text-[10px] text-gray-400 dark:text-gray-500">{log.users?.email || ''}</div>
                        </td>
                        <td className="table-cell text-xs font-mono text-gray-700 dark:text-gray-300">
                          {log.po_orders?.po_number || (log.po_id ? log.po_id.slice(0, 8) + '…' : '—')}
                        </td>
                        <td className="table-cell text-xs text-gray-500 dark:text-gray-400">
                          {log.po_orders?.rig_name || '—'}
                        </td>
                        <td className="table-cell text-xs font-medium text-gray-800 dark:text-gray-200">
                          {log.field_changed}
                        </td>
                        <td className="table-cell text-xs text-red-600 dark:text-red-400 max-w-[110px] truncate">
                          {log.old_value || '—'}
                        </td>
                        <td className="table-cell text-xs text-green-600 dark:text-green-400 max-w-[110px] truncate">
                          {log.new_value || '—'}
                        </td>
                        <td className="table-cell text-xs text-gray-500 dark:text-gray-400 max-w-[160px] truncate">
                          {log.reason || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════
          TAB 2 — SYSTEM SETTINGS
      ══════════════════════════════════════════════ */}
      {tab === 2 && (
        <div className="max-w-2xl space-y-5">
          {settingsLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 border-4 border-jdil-green border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* ── Overdue Threshold ── */}
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-0.5">
                  Overdue Threshold
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                  POs open longer than this many days are flagged as overdue and trigger alert emails.
                </p>
                <div className="flex items-center gap-4">
                  <input
                    type="range" min={7} max={120} step={1}
                    value={settings.overdue_threshold_days}
                    onChange={e => setSettings(s => ({ ...s, overdue_threshold_days: Number(e.target.value) }))}
                    className="flex-1 accent-jdil-green cursor-pointer"
                  />
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number" min={1} max={365}
                      value={settings.overdue_threshold_days}
                      onChange={e => setSettings(s => ({ ...s, overdue_threshold_days: Math.max(1, Number(e.target.value)) }))}
                      className="input-field w-16 text-center font-mono"
                    />
                    <span className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">days</span>
                  </div>
                </div>
                <div className="flex justify-between mt-2 px-0.5">
                  <span className="text-[10px] text-gray-400">7 days</span>
                  <span className="text-[10px] text-gray-400">120 days</span>
                </div>
              </div>

              {/* ── Alert Email Recipients ── */}
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-0.5">
                  Overdue Alert Recipients
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                  These addresses receive automated overdue PO alert emails.
                </p>
                <div className="space-y-2 mb-3 min-h-[20px]">
                  {settings.alert_emails.length === 0 ? (
                    <p className="text-xs text-gray-400 dark:text-gray-500 italic">No recipients added yet.</p>
                  ) : settings.alert_emails.map(email => (
                    <div key={email}
                      className="flex items-center justify-between bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2">
                      <span className="text-sm text-gray-700 dark:text-gray-300">{email}</span>
                      <button onClick={() => removeAlertEmail(email)}
                        className="text-gray-400 hover:text-red-500 transition-colors ml-3">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input type="email" className="input-field flex-1"
                    placeholder="recipient@example.com"
                    value={newEmail}
                    onChange={e => setNewEmail(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addAlertEmail())} />
                  <button onClick={addAlertEmail} className="btn-primary px-4 shrink-0">Add</button>
                </div>
              </div>

              {/* ── Email Notifications Toggle ── */}
              <div className="card p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      Email Notifications
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Globally enable or disable all automated overdue alert emails.
                    </p>
                  </div>
                  {/* Toggle switch */}
                  <button
                    role="switch"
                    aria-checked={settings.email_notifications_enabled}
                    onClick={() => setSettings(s => ({ ...s, email_notifications_enabled: !s.email_notifications_enabled }))}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-jdil-green focus:ring-offset-2 ${
                      settings.email_notifications_enabled
                        ? 'bg-jdil-green'
                        : 'bg-gray-300 dark:bg-gray-600'
                    }`}>
                    <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform ${
                      settings.email_notifications_enabled ? 'translate-x-5' : 'translate-x-0.5'
                    }`} />
                  </button>
                </div>
              </div>

              {/* ── Save ── */}
              <div className="flex items-center gap-4">
                <button onClick={handleSaveSettings} disabled={settingsSaving}
                  className="btn-primary flex items-center gap-2 px-6 disabled:opacity-60">
                  {settingsSaving && (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  )}
                  {settingsSaving ? 'Saving…' : 'Save Settings'}
                </button>
                {settingsMsg && (
                  <p className={`text-sm font-medium ${
                    settingsMsg.startsWith('Error')
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-green-600 dark:text-green-400'
                  }`}>
                    {settingsMsg}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Edit User Modal ── */}
      {editingUser && (
        <EditUserModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSave={async () => { setEditingUser(null); await loadUsers() }}
        />
      )}
    </div>
  )
}
