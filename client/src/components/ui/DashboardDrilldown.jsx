import { useState, useMemo, useEffect } from 'react'
import { calcStatus, getDisplayStatus, daysElapsed, formatDate } from '../../utils/helpers'
import { PO_RIG_OPTIONS, PO_STATUSES, BUYER_CODES } from '../../utils/constants'
import { emptyPOFilters, applyPOFilters } from '../../utils/poFilters'
import { StatusPill } from './StatusPill'

const PAGE_SIZE = 50

// Days a PO has been open: po_date → delivery (if delivered) else po_date → today.
function daysOpen(o) {
  if (o.delivered_to_rig_date && o.po_date) {
    return Math.max(0, Math.floor((new Date(o.delivered_to_rig_date) - new Date(o.po_date)) / 86400000))
  }
  return daysElapsed(o.po_date)
}

// Minimal CSV export (client-side download — nothing leaves the browser).
function exportCsv(rows, filename) {
  const headers = ['PO Number', 'MR Number', 'Rig', 'Vendor', 'Status', 'PO Date', 'Days Open']
  const esc = v => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.join(',')]
  rows.forEach(o => {
    lines.push([
      o.po_number || '',
      o.mr_number || '',
      o.rig_name || '',
      o.vendor_name || '',
      calcStatus(o),
      formatDate(o.po_date),
      daysOpen(o),
    ].map(esc).join(','))
  })
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * Inline, expandable filtered PO list shown beneath a Dashboard KPI/logistics card.
 * Props:
 *   title     — heading (e.g. "Open POs")
 *   orders    — rows already narrowed by the card's predicate
 *   onRowClick(po) — open the PO detail panel
 *   onClose   — collapse the panel
 */
export default function DashboardDrilldown({ title, orders, onRowClick, onClose }) {
  const [filters, setFilters] = useState(emptyPOFilters())
  const [page, setPage] = useState(1)

  const set = (k, v) => setFilters(prev => ({ ...prev, [k]: v }))

  // Advanced filters applied on top of the card's predicate-narrowed rows.
  const filtered = useMemo(() => applyPOFilters(orders, filters), [orders, filters])

  // Reset to first page whenever the result set changes.
  useEffect(() => { setPage(1) }, [filters, orders])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const buyerOptions = useMemo(() => {
    const extra = [...new Set(orders.map(o => o.buyer_code).filter(Boolean))]
    return [...new Set([...BUYER_CODES, ...extra])]
  }, [orders])

  return (
    <div className="card p-4 border-jdil-green/30 ring-1 ring-jdil-green/10">
      {/* Panel header */}
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{title}</h3>
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-full px-2 py-0.5">
            {filtered.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportCsv(filtered, `JDIL_${title.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`)}
            disabled={filtered.length === 0}
            className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 disabled:opacity-50"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export CSV
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"
            aria-label="Collapse"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Advanced filters */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 mb-3">
        <input
          type="text"
          value={filters.search}
          onChange={e => set('search', e.target.value)}
          placeholder="Search PO / vendor / item…"
          className="input-field text-xs col-span-2 lg:col-span-2"
        />
        <input
          type="date"
          value={filters.dateFrom}
          onChange={e => set('dateFrom', e.target.value)}
          className="input-field text-xs"
          title="PO date from"
        />
        <input
          type="date"
          value={filters.dateTo}
          onChange={e => set('dateTo', e.target.value)}
          className="input-field text-xs"
          title="PO date to"
        />
        <select value={filters.rig} onChange={e => set('rig', e.target.value)} className="input-field text-xs">
          <option value="all">All Rigs</option>
          {PO_RIG_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={filters.status} onChange={e => set('status', e.target.value)} className="input-field text-xs">
          <option value="all">All Statuses</option>
          {PO_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filters.buyerCode} onChange={e => set('buyerCode', e.target.value)} className="input-field text-xs">
          <option value="all">All Buyers</option>
          {buyerOptions.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-800">
              <th className="table-header">PO Number</th>
              <th className="table-header">Rig</th>
              <th className="table-header hidden sm:table-cell">Vendor</th>
              <th className="table-header">Status</th>
              <th className="table-header hidden md:table-cell">PO Date</th>
              <th className="table-header">Days Open</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-10 text-sm text-gray-400 dark:text-gray-500">
                  No matching purchase orders
                </td>
              </tr>
            ) : (
              pageRows.map(po => (
                <tr
                  key={po.id}
                  onClick={() => onRowClick?.(po)}
                  className="cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
                >
                  <td className="table-cell">
                    <p className="font-medium text-gray-900 dark:text-gray-100 text-xs">{po.po_number || '—'}</p>
                    <p className="text-gray-400 dark:text-gray-500 text-xs">{po.mr_number || ''}</p>
                  </td>
                  <td className="table-cell text-xs">{po.rig_name || '—'}</td>
                  <td className="table-cell hidden sm:table-cell">
                    <span className="text-xs truncate max-w-[160px] block">{po.vendor_name || '—'}</span>
                  </td>
                  <td className="table-cell">
                    <StatusPill status={calcStatus(po)} label={getDisplayStatus(po)} />
                  </td>
                  <td className="table-cell text-xs hidden md:table-cell">{formatDate(po.po_date)}</td>
                  <td className="table-cell">
                    <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">{daysOpen(po)}d</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-3 text-xs text-gray-500 dark:text-gray-400">
          <span>
            {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="btn-secondary text-xs py-1 px-2.5 disabled:opacity-40"
            >
              Prev
            </button>
            <span className="px-2">Page {safePage} / {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="btn-secondary text-xs py-1 px-2.5 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
