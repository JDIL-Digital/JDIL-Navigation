/**
 * ReportsDropdown — Dashboard "Reports" button for admin & csuite.
 * Fetches a fresh complete dataset from Supabase before generating each
 * report so the output is always unfiltered and up-to-date.
 */

import { useState, useRef, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import {
  generateWeeklyReport,
  generateMonthlyReport,
  generateQuarterlyReport,
} from '../../utils/pdfReports'

const REPORT_TYPES = [
  {
    key:   'weekly',
    label: 'Weekly Summary',
    desc:  'Last 7 days — KPIs, orders & vendor perf.',
    fn:    generateWeeklyReport,
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    key:   'monthly',
    label: 'Monthly Summary',
    desc:  'Current month + month-over-month comparison.',
    fn:    generateMonthlyReport,
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    key:   'quarterly',
    label: 'Quarterly Summary',
    desc:  'Current quarter — trends, rigs & vendors.',
    fn:    generateQuarterlyReport,
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
      </svg>
    ),
  },
]

export default function ReportsDropdown() {
  const { profile } = useAuth()
  const [open, setOpen]           = useState(false)
  const [generating, setGenerating] = useState(null) // key of the report being generated
  const [error, setError]           = useState('')
  const wrapperRef = useRef(null)

  // Only admin and csuite can generate reports
  if (!['admin', 'csuite'].includes(profile?.role)) return null

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function handleGenerate(report) {
    setGenerating(report.key)
    setError('')
    setOpen(false)
    try {
      // Always fetch a fresh, complete dataset — unaffected by any dashboard filters
      const { data: orders, error: fetchErr } = await supabase
        .from('po_orders')
        .select('*')
        .order('po_date', { ascending: false })

      if (fetchErr) throw fetchErr
      await report.fn(orders || [])
    } catch (e) {
      console.error(`Report generation error (${report.key}):`, e)
      setError(`Failed to generate report: ${e.message}`)
    }
    setGenerating(null)
  }

  const isBusy = generating !== null

  return (
    <div ref={wrapperRef} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => { if (!isBusy) setOpen(o => !o) }}
        disabled={isBusy}
        className="btn-primary flex items-center gap-2 text-sm py-2 shrink-0 disabled:opacity-70"
      >
        {isBusy ? (
          <>
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Generating…
          </>
        ) : (
          <>
            {/* Document stack icon */}
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Reports
            <svg
              className={`w-3 h-3 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
            </svg>
          </>
        )}
      </button>

      {/* Error toast */}
      {error && (
        <div className="absolute right-0 mt-1 w-72 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-400 text-xs rounded-lg px-3 py-2 z-50 shadow-lg">
          {error}
          <button onClick={() => setError('')} className="ml-2 font-medium underline">dismiss</button>
        </div>
      )}

      {/* Dropdown panel */}
      {open && !isBusy && (
        <div className="absolute right-0 mt-2 w-72 bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 z-50 overflow-hidden">
          {/* Panel header */}
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
              Generate Report
            </p>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
              Opens in new tab · PDF format
            </p>
          </div>

          {/* Report options */}
          <div className="py-1">
            {REPORT_TYPES.map(report => (
              <button
                key={report.key}
                onClick={() => handleGenerate(report)}
                className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-start gap-3 group"
              >
                <span className="shrink-0 mt-0.5 text-jdil-green group-hover:scale-110 transition-transform">
                  {report.icon}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200 group-hover:text-jdil-green transition-colors">
                    {report.label}
                  </p>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                    {report.desc}
                  </p>
                </div>
                <svg className="w-3.5 h-3.5 shrink-0 mt-1 text-gray-300 dark:text-gray-600 group-hover:text-jdil-green transition-colors"
                  fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ))}
          </div>

          {/* Footer note */}
          <div className="px-4 py-2.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
            <p className="text-[10px] text-gray-400 dark:text-gray-500 flex items-center gap-1.5">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Data is fetched fresh each time. Single-PO reports are available from the PO detail panel.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
