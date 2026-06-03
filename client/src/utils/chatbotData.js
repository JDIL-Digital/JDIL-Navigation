// ════════════════════════════════════════════════════════════════════════════
//  chatbotData.js — role-scoped Supabase query layer for the JDIL Assistant.
//  Kept separate from chatbotEngine.js so the engine stays pure/testable and an
//  AI layer can later reuse the same data functions.
//
//  createDataProvider(supabase, user) → { findPO, listStale, pendingForRig,
//                                          countOpen, poHistory, slowestVendor }
//  Every function enforces the user's role scope (rig users see only their rig).
// ════════════════════════════════════════════════════════════════════════════

const DELIVERED = 'Delivered to Rig'

export function createDataProvider(supabase, user) {
  const role    = user?.role
  const rigName = user?.rig_name

  // Apply rig-user scoping to a query builder
  const scope = (q) => (role === 'rig' && rigName ? q.eq('rig_name', rigName) : q)

  // Escape PostgREST or()-filter reserved chars in user-supplied values
  const esc = (s) => String(s || '').replace(/[,()]/g, ' ').trim()

  return {
    // Look up a single PO by PO number or MR number (case-insensitive contains)
    async findPO(poNum) {
      const v = esc(poNum)
      let q = supabase.from('po_orders').select('*')
        .or(`po_number.ilike.%${v}%,mr_number.ilike.%${v}%`)
      q = scope(q)
      const { data, error } = await q.limit(1)
      if (error) throw error
      return data?.[0] || null
    },

    // List stale POs (over threshold, not delivered), newest-elapsed first
    async listStale() {
      let q = supabase.from('po_orders').select('*')
        .eq('is_stale', true)
        .neq('status', DELIVERED)
        .order('days_elapsed', { ascending: false })
        .limit(25)
      q = scope(q)
      const { data, error } = await q
      if (error) throw error
      return data || []
    },

    // Open POs for a specific rig (returns null if a rig user asks about another rig)
    async pendingForRig(targetRig) {
      if (role === 'rig' && rigName && targetRig !== rigName) return null
      const { data, error } = await supabase.from('po_orders').select('*')
        .eq('rig_name', targetRig)
        .neq('status', DELIVERED)
        .order('days_elapsed', { ascending: false })
        .limit(25)
      if (error) throw error
      return data || []
    },

    // Count of open (not-delivered) POs in scope
    async countOpen() {
      let q = supabase.from('po_orders')
        .select('id', { count: 'exact', head: true })
        .neq('status', DELIVERED)
      q = scope(q)
      const { count, error } = await q
      if (error) throw error
      return count || 0
    },

    // Admin-only: change history for a PO
    async poHistory(poNum) {
      if (role !== 'admin') return { denied: true }
      const v = esc(poNum)
      const { data: po, error: e1 } = await supabase.from('po_orders')
        .select('id, po_number')
        .or(`po_number.ilike.%${v}%,mr_number.ilike.%${v}%`)
        .limit(1)
      if (e1) throw e1
      if (!po?.length) return null
      const { data: log, error: e2 } = await supabase.from('audit_log')
        .select('*, users(name)')
        .eq('po_id', po[0].id)
        .order('changed_at', { ascending: false })
        .limit(20)
      if (e2) throw e2
      return { po: po[0], log: log || [] }
    },

    // Vendor with the highest average lead time (po_date → delivered_to_rig_date)
    async slowestVendor() {
      let q = supabase.from('po_orders')
        .select('vendor_name, po_date, delivered_to_rig_date')
        .not('delivered_to_rig_date', 'is', null)
      q = scope(q)
      const { data, error } = await q
      if (error) throw error

      const map = {}
      for (const o of data || []) {
        if (!o.vendor_name || !o.po_date) continue
        const days = Math.floor((new Date(o.delivered_to_rig_date) - new Date(o.po_date)) / 86400000)
        if (isNaN(days) || days < 0) continue
        if (!map[o.vendor_name]) map[o.vendor_name] = { sum: 0, n: 0 }
        map[o.vendor_name].sum += days
        map[o.vendor_name].n++
      }
      let worst = null
      for (const [name, v] of Object.entries(map)) {
        const avg = v.sum / v.n
        if (!worst || avg > worst.avg) worst = { name, avg: Math.round(avg), n: v.n }
      }
      return worst
    },
  }
}
