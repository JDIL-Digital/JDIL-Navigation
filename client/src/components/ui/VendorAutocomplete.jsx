import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'

/**
 * Searchable vendor autocomplete backed by GET /api/vendors/search.
 * - Debounced 300ms, queries after >= 2 chars
 * - Active vendors shown first with a green "Active" badge
 * - Free-text allowed (user can type a vendor not in the list)
 *
 * Props:
 *   value      : current vendor name string
 *   onChange   : (text) => void          — free-text typing
 *   onSelect   : (vendor) => void         — { name, phone, contact_person, is_active }
 *   placeholder, className, required, id
 */
export default function VendorAutocomplete({
  value = '',
  onChange,
  onSelect,
  placeholder = 'Search or type vendor name…',
  className = 'input-field',
  required = false,
  id,
}) {
  const [results, setResults]   = useState([])
  const [open, setOpen]         = useState(false)
  const [loading, setLoading]   = useState(false)
  const [highlight, setHighlight] = useState(-1)

  const boxRef     = useRef(null)
  const skipNext   = useRef(false)   // suppress search right after a selection
  const debounceRef = useRef(null)

  // ── Debounced search ───────────────────────────────────────────────────────
  useEffect(() => {
    if (skipNext.current) { skipNext.current = false; return }

    const q = (value || '').trim()
    if (q.length < 2) { setResults([]); setOpen(false); return }

    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const resp = await fetch(`/api/vendors/search?q=${encodeURIComponent(q)}`, {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        })
        if (resp.ok) {
          const data = await resp.json()
          setResults(Array.isArray(data) ? data : [])
          setOpen(true)
          setHighlight(-1)
        }
      } catch (e) {
        console.warn('Vendor search failed:', e)
      }
      setLoading(false)
    }, 300)

    return () => clearTimeout(debounceRef.current)
  }, [value])

  // ── Close on outside click ───────────────────────────────────────────────
  useEffect(() => {
    function onDocClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  function choose(vendor) {
    skipNext.current = true
    onChange?.(vendor.name)
    onSelect?.(vendor)
    setOpen(false)
    setResults([])
    setHighlight(-1)
  }

  function onKeyDown(e) {
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter' && highlight >= 0) { e.preventDefault(); choose(results[highlight]) }
    else if (e.key === 'Escape') { setOpen(false) }
  }

  return (
    <div className="relative" ref={boxRef}>
      <input
        id={id}
        className={className}
        value={value}
        onChange={e => onChange?.(e.target.value)}
        onFocus={() => { if (results.length) setOpen(true) }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
      />

      {loading && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <div className="w-3.5 h-3.5 border-2 border-gray-300 border-t-jdil-green rounded-full animate-spin" />
        </div>
      )}

      {open && results.length > 0 && (
        <ul className="absolute z-[70] left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1">
          {results.map((v, i) => (
            <li key={v.id}>
              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); choose(v) }}
                onMouseEnter={() => setHighlight(i)}
                className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 ${
                  i === highlight ? 'bg-gray-100 dark:bg-gray-700' : ''
                }`}
              >
                <div className="min-w-0">
                  <p className="text-sm text-gray-800 dark:text-gray-200 truncate">{v.name}</p>
                  {(v.contact_person || v.phone) && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                      {[v.contact_person, v.phone].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
                {v.is_active && (
                  <span className="shrink-0 text-[10px] font-medium bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 rounded-full px-2 py-0.5">
                    Active
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
