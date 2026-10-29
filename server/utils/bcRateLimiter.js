/**
 * bcRateLimiter.js — deliberately simple client-side throttle for BC calls.
 *
 * Rebuilt small and isolated after an earlier, more complex version caused
 * "Could not reach Business Central API". This module has NO queue, NO token
 * bucket, NO timing math, and NO imports from bcAuth/bcIntegration. Just two
 * counters:
 *   1. a concurrency cap (max 3 active at once)
 *   2. a rolling 60s request cap (max 100/min — very conservative)
 *
 * acquire() polls every 500ms for a free slot and THROWS a TimeoutError rather
 * than ever blocking forever (ceiling: 60 waits = 30s). Nothing real is wrapped
 * yet — see the self-test endpoint.
 */

const MAX_CONCURRENT  = 3
const MAX_PER_MINUTE  = 100
const WAIT_MS         = 500
const MAX_WAIT_LOOPS  = 60          // 60 × 500ms = 30s hard ceiling

let active = 0
const recent_requests = []          // timestamps (ms) of acquisitions in the last 60s

const sleep = ms => new Promise(r => setTimeout(r, ms))

// Drop timestamps older than 60s.
function prune() {
  const cutoff = Date.now() - 60_000
  while (recent_requests.length && recent_requests[0] < cutoff) recent_requests.shift()
}

/**
 * Wait until a slot is free, then reserve it. Call release() exactly once after.
 * @throws {Error} name 'TimeoutError' if no slot frees up within ~30s.
 */
async function acquire() {
  let loops = 0
  while (true) {
    prune()
    if (active < MAX_CONCURRENT && recent_requests.length < MAX_PER_MINUTE) {
      active++
      recent_requests.push(Date.now())
      return
    }
    if (loops >= MAX_WAIT_LOOPS) {
      const e = new Error(`Rate limiter timeout — no slot after ${(MAX_WAIT_LOOPS * WAIT_MS) / 1000}s (active=${active}, last_minute=${recent_requests.length})`)
      e.name = 'TimeoutError'
      e.code = 'RATE_LIMITER_TIMEOUT'
      throw e
    }
    loops++
    await sleep(WAIT_MS)
  }
}

/** Free a slot. Safe to call even if active is already 0. */
function release() {
  active = Math.max(0, active - 1)
}

function getStats() {
  prune()
  return {
    active,
    requests_last_minute: recent_requests.length,
    limits: { concurrent: MAX_CONCURRENT, per_minute: MAX_PER_MINUTE },
  }
}

module.exports = { acquire, release, getStats }
