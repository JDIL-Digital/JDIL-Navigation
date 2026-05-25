const router = require('express').Router()
const { supabase } = require('../utils/supabaseAdmin')

router.get('/:userId', async (req, res) => {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', req.params.userId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.patch('/:userId/read-all', async (req, res) => {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', req.params.userId)
  if (error) return res.status(400).json({ error: error.message })
  res.json({ ok: true })
})

module.exports = router
