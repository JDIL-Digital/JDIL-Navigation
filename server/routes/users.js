const router       = require('express').Router()
const { supabase } = require('../utils/supabaseAdmin')
const { requireAuth } = require('../middleware/authMiddleware')
const {
  sendEmail,
  accountApprovedEmail,
  newRegistrationEmail,
} = require('../utils/email')

// ── Admin-only guard ──────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' })
  }
  next()
}

// ── GET /api/users — list all users ──────────────────────────────────────────
router.get('/', requireAuth, requireAdmin, async (_req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .order('is_active', { ascending: true })   // pending first
    .order('created_at', { ascending: false })
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// ── POST /api/users/register-notify ──────────────────────────────────────────
// Called by the client immediately after a successful Supabase auth sign-up.
// Does NOT require auth (the new user is inactive and can't pass requireAuth).
// Sends a notification email to all active admin users.
router.post('/register-notify', async (req, res) => {
  const { name, email, role, team_code, rig_name } = req.body

  if (!email) return res.status(400).json({ error: 'email is required' })

  try {
    // Fetch all active admin emails
    const { data: admins } = await supabase
      .from('users')
      .select('email')
      .eq('role', 'admin')
      .eq('is_active', true)

    const adminEmails = (admins || []).map(u => u.email).filter(Boolean)

    if (adminEmails.length) {
      await sendEmail({
        to:      adminEmails,
        subject: `New user registration pending approval — ${name || email}`,
        html:    newRegistrationEmail({ name, email, role, team_code, rig_name }),
      })
      console.log(`[email] New registration for ${email} → ${adminEmails.length} admin(s) notified`)
    }

    res.json({ ok: true })
  } catch (e) {
    console.error('[email] register-notify error:', e)
    // Don't fail the registration flow — just log and respond OK
    res.json({ ok: true, warning: e.message })
  }
})

// ── PATCH /api/users/:id/approve — activate + send approval email ─────────────
router.patch('/:id/approve', requireAuth, requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .update({ is_active: true })
    .eq('id', req.params.id)
    .select()
    .single()

  if (error) return res.status(400).json({ error: error.message })

  // In-app notification
  try {
    await supabase.from('notifications').insert({
      user_id:    req.params.id,
      type:       'approval',
      title:      'Account Approved',
      message:    'Your account has been approved. You can now sign in to JDIL Navigation.',
      is_read:    false,
      created_at: new Date().toISOString(),
    })
  } catch (e) { console.error('[notify] in-app approval error:', e) }

  // Email notification — use the branded template from email.js
  if (data?.email) {
    try {
      await sendEmail({
        to:      data.email,
        subject: 'Your JDIL Navigation account has been approved',
        html:    accountApprovedEmail(data),
      })
      console.log(`[email] Approval email sent to ${data.email}`)
    } catch (e) { console.error('[email] approval email error:', e) }
  }

  res.json(data)
})

// ── PATCH /api/users/:id/deactivate — revoke access (reversible) ──────────────
router.patch('/:id/deactivate', requireAuth, requireAdmin, async (req, res) => {
  // Prevent self-deactivation
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'You cannot deactivate your own account' })
  }
  const { data, error } = await supabase
    .from('users')
    .update({ is_active: false })
    .eq('id', req.params.id)
    .select()
    .single()
  if (error) return res.status(400).json({ error: error.message })
  res.json(data)
})

// ── PATCH /api/users/:id — update role / team_code / rig_name ─────────────────
router.patch('/:id', requireAuth, requireAdmin, async (req, res) => {
  const { role, team_code, rig_name } = req.body
  const patch = {}
  if (role       !== undefined) patch.role       = role
  if (team_code  !== undefined) patch.team_code  = team_code  || null
  if (rig_name   !== undefined) patch.rig_name   = rig_name   || null

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'Nothing to update' })
  }

  const { data, error } = await supabase
    .from('users')
    .update(patch)
    .eq('id', req.params.id)
    .select()
    .single()
  if (error) return res.status(400).json({ error: error.message })
  res.json(data)
})

// ── DELETE /api/users/:id — permanently remove from auth + public.users ────────
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  // Prevent self-deletion
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own account' })
  }

  // Delete profile row first (FK constraints)
  const { error: profileErr } = await supabase
    .from('users')
    .delete()
    .eq('id', req.params.id)
  if (profileErr) {
    return res.status(400).json({ error: `Profile delete failed: ${profileErr.message}` })
  }

  // Delete auth record (Supabase Admin API, uses secret key)
  const { error: authErr } = await supabase.auth.admin.deleteUser(req.params.id)
  if (authErr) {
    // Profile is already gone; log but don't block the response
    console.error('[users] Auth user delete error (profile already removed):', authErr.message)
  }

  res.json({ success: true })
})

module.exports = router
