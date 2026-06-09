import { calcStatus } from './helpers'

// Shared PO filter state + logic used by the Purchase / Logistics / Rig pages.

export function emptyPOFilters() {
  return {
    search:    '',
    dateFrom:  '',
    dateTo:    '',
    dateField: 'po_date',   // 'po_date' | 'promised_ready_date' | 'updated_at'
    rig:       'all',
    vendor:    '',
    status:    'all',
    buyerCode: 'all',
  }
}

export function hasActivePOFilters(f) {
  return Boolean(
    f.search?.trim() ||
    f.dateFrom ||
    f.dateTo ||
    (f.rig && f.rig !== 'all') ||
    f.vendor?.trim() ||
    (f.status && f.status !== 'all') ||
    (f.buyerCode && f.buyerCode !== 'all')
  )
}

// Applies all filters with AND logic. Returns the filtered array.
export function applyPOFilters(orders, f) {
  let r = orders

  if (f.rig && f.rig !== 'all')             r = r.filter(o => o.rig_name === f.rig)
  if (f.status && f.status !== 'all')       r = r.filter(o => calcStatus(o) === f.status)
  if (f.buyerCode && f.buyerCode !== 'all') r = r.filter(o => o.buyer_code === f.buyerCode)

  if (f.vendor && f.vendor.trim()) {
    const q = f.vendor.toLowerCase()
    r = r.filter(o => (o.vendor_name || '').toLowerCase().includes(q))
  }

  if (f.dateFrom || f.dateTo) {
    const field = f.dateField || 'po_date'
    const from = f.dateFrom ? new Date(f.dateFrom + 'T00:00:00') : null
    const to   = f.dateTo   ? new Date(f.dateTo   + 'T23:59:59') : null
    r = r.filter(o => {
      const raw = field === 'updated_at' ? o.updated_at : o[field]
      if (!raw) return false
      const d = new Date(raw)
      if (isNaN(d)) return false
      if (from && d < from) return false
      if (to   && d > to)   return false
      return true
    })
  }

  if (f.search && f.search.trim()) {
    const q = f.search.toLowerCase()
    r = r.filter(o =>
      (o.po_number || '').toLowerCase().includes(q) ||
      (o.mr_number || '').toLowerCase().includes(q) ||
      (o.material_description || '').toLowerCase().includes(q) ||
      (o.material_description_2 || '').toLowerCase().includes(q) ||
      (o.vendor_name || '').toLowerCase().includes(q)
    )
  }

  return r
}
