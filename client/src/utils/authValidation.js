import { EMAIL_WHITELIST } from './constants'

export const ALLOWED_DOMAIN = 'jindalmumbai.com'
export const DOMAIN_ERROR   = 'Only @jindalmumbai.com email addresses are allowed'

export function isAllowedEmail(email = '') {
  const normalized = email.trim().toLowerCase()
  if (normalized.endsWith(`@${ALLOWED_DOMAIN}`)) return true
  if (EMAIL_WHITELIST.includes(normalized)) return true
  return false
}

// ─── OTP lockout helpers (stored in localStorage per email) ──────────────────
const LOCK_KEY   = 'jdil-otp-lock'
const MAX_ATTEMPTS = 3
const LOCK_MS      = 5 * 60 * 1000   // 5 minutes

function getLockState(email) {
  try {
    const raw = localStorage.getItem(`${LOCK_KEY}:${email}`)
    return raw ? JSON.parse(raw) : { attempts: 0, lockedUntil: null }
  } catch {
    return { attempts: 0, lockedUntil: null }
  }
}

function saveLockState(email, state) {
  localStorage.setItem(`${LOCK_KEY}:${email}`, JSON.stringify(state))
}

export function clearLockState(email) {
  localStorage.removeItem(`${LOCK_KEY}:${email}`)
}

/** Returns { locked: false } or { locked: true, remainingMs: number } */
export function checkLock(email) {
  const s = getLockState(email)
  if (s.lockedUntil) {
    const remaining = s.lockedUntil - Date.now()
    if (remaining > 0) return { locked: true, remainingMs: remaining }
    // lock has expired — reset
    saveLockState(email, { attempts: 0, lockedUntil: null })
  }
  return { locked: false }
}

/** Called on a failed OTP attempt. Returns new state. */
export function recordFailedAttempt(email) {
  const s = getLockState(email)
  const attempts = s.attempts + 1
  const lockedUntil = attempts >= MAX_ATTEMPTS ? Date.now() + LOCK_MS : null
  const next = { attempts, lockedUntil }
  saveLockState(email, next)
  return { attempts, locked: !!lockedUntil, remainingAttempts: MAX_ATTEMPTS - attempts }
}
