const express = require('express')
const cors    = require('cors')
const path    = require('path')
const cron    = require('node-cron')
require('dotenv').config()

const { generalLimiter, authLimiter } = require('./middleware/rateLimit')

const app  = express()
const PORT = process.env.PORT || 3001
const IS_PROD = process.env.NODE_ENV === 'production'

// Behind Replit's proxy — needed so req.ip reflects the real client IP for
// rate limiting (otherwise every request looks like it comes from the proxy).
app.set('trust proxy', 1)

// ── CORS ──────────────────────────────────────────────────────────────────────
// Allow only known origins. Requests with no Origin header (same-origin browser
// navigations, server-to-server, curl) are permitted; everything else is blocked.
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'https://jdil-navigation.replit.app',
]
app.use(cors({
  origin(origin, cb) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true)
    return cb(new Error(`Origin ${origin} not allowed by CORS`))
  },
  credentials: true,
}))

// Cap request body size to prevent oversized-payload abuse.
app.use(express.json({ limit: '1mb' }))

// ── Rate limiting ───────────────────────────────────────────────────────────
// General cap on all API traffic; stricter cap on the public registration ping.
app.use('/api', generalLimiter)
app.use('/api/users/register-notify', authLimiter)

// ── API routes ────────────────────────────────────────────────────────────────
const poRoutes     = require('./routes/po')
const userRoutes   = require('./routes/users')
const notifRoutes  = require('./routes/notifications')
const reportRoutes = require('./routes/reports')
const vendorRoutes = require('./routes/vendors')
const rlRoutes     = require('./routes/reverseLogistics')

app.use('/api/po',            poRoutes)
app.use('/api/users',         userRoutes)
app.use('/api/notifications', notifRoutes)
app.use('/api/reports',       reportRoutes)
app.use('/api/vendors',       vendorRoutes)
app.use('/api/rl',            rlRoutes)

app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', env: IS_PROD ? 'production' : 'development', ts: new Date().toISOString() })
)

// ── Serve React build in production ──────────────────────────────────────────
// Must come AFTER the API routes so /api/* is handled first.
if (IS_PROD) {
  const clientDist = path.join(__dirname, '../client/dist')

  // Serve static assets (JS, CSS, images, etc.)
  app.use(express.static(clientDist))

  // Any non-API route gets the React index.html so client-side routing works
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'))
  })

  console.log(`[server] Serving React build from ${clientDist}`)
}

// ── Global error handler ──────────────────────────────────────────────────────
// Catches synchronous throws and anything passed to next(err) so a single bad
// request returns a clean 500 instead of crashing the process.
app.use((err, _req, res, _next) => {
  if (err && /not allowed by CORS/i.test(err.message || '')) {
    return res.status(403).json({ error: 'Origin not allowed' })
  }
  console.error('[server] Unhandled route error:', err)
  if (res.headersSent) return
  res.status(500).json({ error: 'Internal server error' })
})

// ── Stale PO checker — runs every day at 8 am ─────────────────────────────────
cron.schedule('0 8 * * *', async () => {
  try {
    const { checkStaleOrders } = require('./utils/staleChecker')
    await checkStaleOrders()
  } catch (e) {
    console.error('[cron] stale checker error:', e)
  }
})

// ── Process-level safety nets — never exit on a stray async error ─────────────
process.on('unhandledRejection', reason => {
  console.error('[process] Unhandled promise rejection:', reason)
})
process.on('uncaughtException', err => {
  console.error('[process] Uncaught exception:', err)
})

app.listen(PORT, () => {
  console.log(`JDIL Navigation server running on port ${PORT} [${IS_PROD ? 'production' : 'development'}]`)
})
