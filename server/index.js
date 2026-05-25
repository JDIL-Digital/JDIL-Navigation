const express = require('express')
const cors    = require('cors')
const path    = require('path')
const cron    = require('node-cron')
require('dotenv').config()

const app  = express()
const PORT = process.env.PORT || 3001
const IS_PROD = process.env.NODE_ENV === 'production'

// ── CORS ──────────────────────────────────────────────────────────────────────
// In production the React build is served by this same Express process,
// so browser requests are same-origin and CORS headers aren't needed.
// We only restrict to localhost origins in development.
app.use(cors({
  origin: IS_PROD
    ? false                                           // same-origin; no CORS header needed
    : ['http://localhost:5173', 'http://localhost:4173'],
  credentials: true,
}))

app.use(express.json())

// ── API routes ────────────────────────────────────────────────────────────────
const poRoutes     = require('./routes/po')
const userRoutes   = require('./routes/users')
const notifRoutes  = require('./routes/notifications')
const reportRoutes = require('./routes/reports')

app.use('/api/po',            poRoutes)
app.use('/api/users',         userRoutes)
app.use('/api/notifications', notifRoutes)
app.use('/api/reports',       reportRoutes)

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

// ── Stale PO checker — runs every day at 8 am ─────────────────────────────────
cron.schedule('0 8 * * *', async () => {
  const { checkStaleOrders } = require('./utils/staleChecker')
  await checkStaleOrders()
})

app.listen(PORT, () => {
  console.log(`JDIL Navigation server running on port ${PORT} [${IS_PROD ? 'production' : 'development'}]`)
})
