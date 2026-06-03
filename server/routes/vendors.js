const router          = require('express').Router()
const { supabase }    = require('../utils/supabaseAdmin')
const { requireAuth } = require('../middleware/authMiddleware')

// ── Admin-only guard ──────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' })
  }
  next()
}

// Escape PostgREST ILIKE wildcards/commas in user input
function sanitizeQuery(q) {
  return String(q || '').replace(/[%,()]/g, ' ').trim()
}

// ─── GET /api/vendors/search?q=xxx — autocomplete (any authenticated user) ────
// Returns up to 10 matches, active vendors first.
router.get('/search', requireAuth, async (req, res) => {
  const q = sanitizeQuery(req.query.q)
  if (q.length < 2) return res.json([])

  const { data, error } = await supabase
    .from('vendors')
    .select('id, name, phone, contact_person, is_active')
    .ilike('name', `%${q}%`)
    .order('is_active', { ascending: false })
    .order('name',      { ascending: true })
    .limit(10)

  if (error) return res.status(500).json({ error: error.message })
  res.json(data || [])
})

// ─── GET /api/vendors — admin list (optional ?q= search, ?limit=) ─────────────
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  const q     = sanitizeQuery(req.query.q)
  const limit = Math.min(Number(req.query.limit) || 200, 1000)

  let query = supabase
    .from('vendors')
    .select('*', { count: 'exact' })
    .order('is_active', { ascending: false })
    .order('name',      { ascending: true })
    .limit(limit)

  if (q.length >= 1) query = query.ilike('name', `%${q}%`)

  const { data, error, count } = await query
  if (error) return res.status(500).json({ error: error.message })
  res.json({ vendors: data || [], total: count ?? (data?.length || 0), limit })
})

// ─── POST /api/vendors — create (admin) ───────────────────────────────────────
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { name, phone, contact_person, is_active } = req.body
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Vendor name is required' })
  }
  const row = {
    name:           String(name).trim(),
    phone:          phone          ? String(phone).trim()          : null,
    contact_person: contact_person ? String(contact_person).trim() : null,
    is_active:      is_active === undefined ? true : !!is_active,
  }
  const { data, error } = await supabase.from('vendors').insert(row).select().single()
  if (error) {
    const msg = error.code === '23505' ? 'A vendor with this name already exists' : error.message
    return res.status(400).json({ error: msg })
  }
  res.json({ success: true, data })
})

// ─── PATCH /api/vendors/:id — update / toggle active (admin) ──────────────────
router.patch('/:id', requireAuth, requireAdmin, async (req, res) => {
  const patch = {}
  if (req.body.name           !== undefined) patch.name           = String(req.body.name).trim()
  if (req.body.phone          !== undefined) patch.phone          = req.body.phone          ? String(req.body.phone).trim()          : null
  if (req.body.contact_person !== undefined) patch.contact_person = req.body.contact_person ? String(req.body.contact_person).trim() : null
  if (req.body.is_active      !== undefined) patch.is_active      = !!req.body.is_active
  patch.updated_at = new Date().toISOString()

  if (patch.name !== undefined && !patch.name) {
    return res.status(400).json({ error: 'Vendor name cannot be empty' })
  }

  const { data, error } = await supabase
    .from('vendors').update(patch).eq('id', req.params.id).select().single()
  if (error) {
    const msg = error.code === '23505' ? 'A vendor with this name already exists' : error.message
    return res.status(400).json({ error: msg })
  }
  res.json({ success: true, data })
})

// ─── DELETE /api/vendors/:id — remove (admin) ─────────────────────────────────
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const { error } = await supabase.from('vendors').delete().eq('id', req.params.id)
  if (error) return res.status(400).json({ error: error.message })
  res.json({ success: true })
})

// ─── POST /api/vendors/bulk — upsert from parsed Excel/CSV (admin) ────────────
// Body: { vendors: [{ name, phone, contact_person }, ...], deactivateMissing?: bool }
// Upserts on lower(name): existing names update phone/contact, new names insert.
router.post('/bulk', requireAuth, requireAdmin, async (req, res) => {
  const incoming = Array.isArray(req.body.vendors) ? req.body.vendors : []
  if (incoming.length === 0) {
    return res.status(400).json({ error: 'No vendor rows provided' })
  }

  // Normalise + dedupe by lower(name) (last occurrence wins)
  const byName = new Map()
  for (const v of incoming) {
    const name = (v.name ?? v.Name ?? '').toString().trim()
    if (!name) continue
    byName.set(name.toLowerCase(), {
      name,
      phone:          (v.phone ?? v['Phone No.'] ?? v.Phone ?? '').toString().trim() || null,
      contact_person: (v.contact_person ?? v['Contact Person'] ?? '').toString().trim() || null,
      is_active:      true,
    })
  }
  const rows = [...byName.values()]
  if (rows.length === 0) {
    return res.status(400).json({ error: 'No valid vendor names found in the file' })
  }

  // Upsert in chunks to stay within payload limits (5000 rows is fine in ~5 chunks)
  const CHUNK = 1000
  let upserted = 0
  try {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK)
      const { error } = await supabase
        .from('vendors')
        .upsert(slice, { onConflict: 'name', ignoreDuplicates: false })
      if (error) {
        // onConflict expects a unique constraint; lower(name) unique index covers it
        console.error('[vendors bulk] upsert chunk error:', error)
        return res.status(400).json({ error: error.message, upserted })
      }
      upserted += slice.length
    }
  } catch (e) {
    console.error('[vendors bulk] error:', e)
    return res.status(500).json({ error: e.message, upserted })
  }

  res.json({ success: true, upserted, received: incoming.length })
})

module.exports = router
