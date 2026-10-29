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
  'https://jdil-navigation.replit.app',   // kept for backward compatibility
  'https://jdilnavigation.com',           // custom domain
  'https://www.jdilnavigation.com',       // custom domain (www)
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
const settingsRoutes = require('./routes/settings')
const bcMappingRoutes = require('./routes/bcMapping')
const bcIntegrationRoutes = require('./routes/bcIntegration')

app.use('/api/po',            poRoutes)
app.use('/api/users',         userRoutes)
app.use('/api/notifications', notifRoutes)
app.use('/api/reports',       reportRoutes)
app.use('/api/vendors',       vendorRoutes)
app.use('/api/rl',            rlRoutes)
app.use('/api/settings',      settingsRoutes)
app.use('/api/admin/bc-mapping', bcMappingRoutes)
app.use('/api/admin/bc-integration', bcIntegrationRoutes)

app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', env: IS_PROD ? 'production' : 'development', ts: new Date().toISOString() })
)

// ── Serve React build in production ──────────────────────────────────────────
// Must come AFTER the API routes so /api/* is handled first.
if (IS_PROD) {
  const clientDist = path.join(__dirname, '../client/dist')
  const fs = require('fs')

  // Serve static assets (JS, CSS, images, etc.)
  // robots.txt is emitted into dist by Vite from client/public/ and is served here.
  app.use(express.static(clientDist))

  // Governance endpoints that are NOT published as static files must return a
  // real 404 — never the SPA shell — so crawlers see an honest response.
  app.get('/sitemap.xml', (_req, res) => res.status(404).end())
  app.get('/llms.txt',    (_req, res) => res.status(404).end())

  // Per-route metadata for public auth pages.
  // These are internal utility pages — crawlers should not index them.
  const AUTH_ROUTE_META = {
    '/login': {
      title: 'Login | JDIL Navigation',
      description: 'Secure employee sign-in for the JDIL Navigation material tracking system.',
      ogTitle: 'JDIL Navigation Login',
      ogDescription: 'Secure employee sign-in for JDIL Navigation.',
    },
    '/admin-login': {
      title: 'Admin Login | JDIL Navigation',
      description: 'Administrator sign-in for the JDIL Navigation material tracking system.',
      ogTitle: 'JDIL Navigation Admin Login',
      ogDescription: 'Administrator sign-in for JDIL Navigation.',
    },
    '/register': {
      title: 'Register | JDIL Navigation',
      description: 'Request an account for the JDIL Navigation material tracking system.',
      ogTitle: 'JDIL Navigation Registration',
      ogDescription: 'Request an account for JDIL Navigation.',
    },
    '/forgot-password': {
      title: 'Forgot Password | JDIL Navigation',
      description: 'Reset your JDIL Navigation account password.',
      ogTitle: 'JDIL Navigation Password Reset',
      ogDescription: 'Reset your JDIL Navigation account password.',
    },
    '/reset-password': {
      title: 'Reset Password | JDIL Navigation',
      description: 'Set a new password for your JDIL Navigation account.',
      ogTitle: 'JDIL Navigation Password Reset',
      ogDescription: 'Set a new password for your JDIL Navigation account.',
    },
  }

  // Handler that injects per-route meta tags and sends noindex headers.
  function serveAuthRoute(meta) {
    return (_req, res) => {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow')
      try {
        let html = fs.readFileSync(path.join(clientDist, 'index.html'), 'utf8')
        const injected = [
          `<title>${meta.title}</title>`,
          `<meta name="description" content="${meta.description}" />`,
          `<meta name="robots" content="noindex, nofollow" />`,
          `<meta property="og:title" content="${meta.ogTitle}" />`,
          `<meta property="og:description" content="${meta.ogDescription}" />`,
          `<meta name="twitter:card" content="summary" />`,
        ].join('\n    ')
        html = html.replace('<title>JDIL Navigation — Material Tracking</title>', injected)
        res.setHeader('Content-Type', 'text/html')
        res.send(html)
      } catch {
        res.sendFile(path.join(clientDist, 'index.html'))
      }
    }
  }

  // Register specific handlers for auth routes — inject noindex meta before the catch-all.
  for (const [route, meta] of Object.entries(AUTH_ROUTE_META)) {
    app.get(route, serveAuthRoute(meta))
  }

  // Known client-side routes that should receive the SPA shell.
  const CLIENT_ROUTES = [
    '/',
    '/login',
    '/admin-login',
    '/register',
    '/pending',
    '/auth/callback',
    '/forgot-password',
    '/reset-password',
    '/purchase',
    '/logistics',
    '/rig',
    '/admin',
    '/repair',
    '/return',
    '/replacement',
    '/reverse-logistics',
  ]

  // Only serve index.html for known routes; return a real 404 for everything
  // else so search engines do not treat unknown URLs as valid pages.
  app.get('*', (req, res) => {
    if (CLIENT_ROUTES.includes(req.path)) {
      return res.sendFile(path.join(clientDist, 'index.html'))
    }
    res.status(404).end()
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

// ── Progressive escalation summaries — once daily at 9am IST ──────────────────
cron.schedule('0 9 * * *', async () => {
  try {
    const { checkStaleOrders } = require('./utils/staleChecker')
    await checkStaleOrders()
  } catch (e) {
    console.error('[cron] stale checker error:', e)
  }
}, { timezone: 'Asia/Kolkata' })

// ── Process-level safety nets — never exit on a stray async error ─────────────
process.on('unhandledRejection', reason => {
  console.error('[process] Unhandled promise rejection:', reason)
})
process.on('uncaughtException', err => {
  console.error('[process] Uncaught exception:', err)
})

app.listen(PORT, () => {
  console.log(`JDIL Navigation server running on port ${PORT} [${IS_PROD ? 'production' : 'development'}]`)

  // ── BC automated sync scheduler (9am + 6pm IST) ─────────────────────────────
  // Only register the schedule in production, or when explicitly enabled for
  // local testing via BC_CRON_ENABLE=true. Promotion to po_orders is separately
  // gated behind BC_SYNC_ENABLED (default off).
  if (IS_PROD || process.env.BC_CRON_ENABLE === 'true') {
    try {
      require('./utils/bcCronScheduler').initializeScheduler()
    } catch (e) {
      console.error('[cron] failed to initialize BC sync scheduler:', e.message)
    }
  } else {
    console.log('[cron] BC sync scheduler NOT started (set BC_CRON_ENABLE=true to enable locally)')
  }
})
