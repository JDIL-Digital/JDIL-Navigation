const router = require('express').Router()
const { requireAuth } = require('../middleware/authMiddleware')

// ─── GET /api/settings/alerts-status ──────────────────────────────────────────
// Read-only view of the ALERTS_ENABLED master kill switch. Deliberately NOT
// changeable via the UI — the env variable is the only control, so the alert
// system can't be switched on by an accidental click.
router.get('/alerts-status', requireAuth, (_req, res) => {
  res.json({ enabled: process.env.ALERTS_ENABLED === 'true' })
})

module.exports = router
