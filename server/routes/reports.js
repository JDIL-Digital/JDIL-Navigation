const router = require('express').Router()
const { supabase } = require('../utils/supabaseAdmin')

function getDateRange(type) {
  const now = new Date()
  const start = new Date()
  if (type === 'weekly') start.setDate(now.getDate() - 7)
  else if (type === 'monthly') start.setMonth(now.getMonth() - 1)
  else if (type === 'quarterly') start.setMonth(now.getMonth() - 3)
  return start.toISOString().split('T')[0]
}

router.get('/:type', async (req, res) => {
  const { type } = req.params
  const { rig } = req.query
  let q = supabase.from('po_orders').select('*').order('po_date', { ascending: false })
  if (rig) q = q.eq('rig_name', rig)
  if (type !== 'all') q = q.gte('po_date', getDateRange(type))
  const { data, error } = await q
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

module.exports = router
