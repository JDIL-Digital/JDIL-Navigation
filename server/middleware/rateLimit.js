// Lightweight in-memory rate limiter (no external dependency).
// Suitable for a single-process deployment (Replit). Fixed-window per IP.

function createRateLimiter({ windowMs, max, message }) {
  const hits = new Map() // ip -> { count, resetAt }

  // Periodic cleanup so the map can't grow unbounded. unref() so it never
  // keeps the process alive on its own.
  const timer = setInterval(() => {
    const now = Date.now()
    for (const [ip, rec] of hits) if (rec.resetAt <= now) hits.delete(ip)
  }, windowMs)
  if (timer.unref) timer.unref()

  return function rateLimit(req, res, next) {
    const ip =
      req.ip ||
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.socket?.remoteAddress ||
      'unknown'

    const now = Date.now()
    let rec = hits.get(ip)
    if (!rec || rec.resetAt <= now) {
      rec = { count: 0, resetAt: now + windowMs }
      hits.set(ip, rec)
    }
    rec.count++

    res.setHeader('X-RateLimit-Limit', max)
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - rec.count))

    if (rec.count > max) {
      const retryAfter = Math.ceil((rec.resetAt - now) / 1000)
      res.setHeader('Retry-After', retryAfter)
      return res.status(429).json({
        error: message || 'Too many requests — please slow down and try again shortly.',
        retryAfter,
      })
    }
    next()
  }
}

// General API: 100 requests / minute / IP
const generalLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 100,
  message: 'Too many requests. Please wait a minute and try again.',
})

// Auth-sensitive endpoints: 10 requests / minute / IP
const authLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many attempts. Please wait a minute before trying again.',
})

module.exports = { createRateLimiter, generalLimiter, authLimiter }
