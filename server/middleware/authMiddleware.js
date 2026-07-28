const { supabase } = require('../utils/supabaseAdmin')
const { isAllowedEmail } = require('../utils/constants')

/**
 * Verifies the Supabase JWT from the Authorization header,
 * fetches the user's profile row, and attaches it to req.user.
 * Returns 401 if missing/invalid, 403 if account is inactive or wrong domain.
 */
async function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization header' })
  }

  // Verify the JWT with Supabase
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  // Enforce email domain restriction (with whitelist exceptions).
  // Error message deliberately does not reveal the whitelist.
  if (!isAllowedEmail(user.email)) {
    return res.status(403).json({ error: 'Only @jindalmumbai.com email addresses are allowed' })
  }

  // Fetch the profile row for role + is_active + name/email (used in email attribution)
  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('id, role, is_active, team_code, rig_name, name, email')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    return res.status(401).json({ error: 'User profile not found' })
  }

  if (!profile.is_active) {
    return res.status(403).json({ error: 'Account is not active' })
  }

  req.user = profile
  next()
}

module.exports = { requireAuth }
