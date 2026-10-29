/**
 * bcRetry.js — tiny retry wrapper with exponential backoff. Pure utility:
 * NO imports from other BC files, NO rate limiter, NO token/401 handling
 * (bcAuth owns the token; each caller fetches a fresh token before the request).
 *
 * withRetry(fetchFn, options) returns the FINAL Response — even on an error
 * status — so the caller keeps its own non-2xx handling. It only throws when
 * every attempt was a network error.
 */

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function withRetry(fetchFn, options = {}) {
  const {
    maxAttempts       = 3,
    baseDelayMs       = 1000,
    maxDelayMs        = 10000,
    retryableStatuses = [429, 500, 502, 503, 504],
  } = options

  let lastNetErr = null

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let response
    try {
      response = await fetchFn()
    } catch (netErr) {
      // Network error (fetch rejected). Retry with backoff; throw if last attempt.
      lastNetErr = netErr
      if (attempt < maxAttempts - 1) {
        const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs)
        console.log(`[bc-retry] attempt ${attempt + 1}/${maxAttempts} network error: ${netErr.message} — waiting ${delay}ms`)
        await sleep(delay)
        continue
      }
      throw netErr
    }

    if (response.ok) return response

    // Retryable status with attempts left → back off and retry.
    if (retryableStatuses.includes(response.status) && attempt < maxAttempts - 1) {
      let delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs)
      if (response.status === 429) {
        const ra = response.headers?.get?.('retry-after')
        const secs = ra != null ? Number(ra) : NaN
        if (Number.isFinite(secs)) delay = Math.min(secs * 1000, maxDelayMs)
      }
      console.log(`[bc-retry] attempt ${attempt + 1}/${maxAttempts} status ${response.status} — waiting ${delay}ms`)
      await sleep(delay)
      continue
    }

    // Non-retryable 4xx, or retryable but out of attempts → hand the response back.
    return response
  }

  // Unreachable in practice (the loop always returns or throws); defensive only.
  throw lastNetErr || new Error('withRetry: exhausted with no response')
}

module.exports = { withRetry }
