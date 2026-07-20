import { useState, useEffect, useRef } from 'react'
import { checkLock } from '../../utils/authValidation'

const OTP_LENGTH = 6

function formatCountdown(ms) {
  const totalSec = Math.ceil(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * Reusable OTP entry screen.
 *
 * Props:
 *   email       – email address the code was sent to
 *   onVerify    – called with the 6-digit string when user taps Verify
 *   onBack      – called when user taps "← Back to login"
 *   onResend    – called when user requests a new code
 *   loading     – show spinner / disable buttons
 *   error       – external error message (e.g. "Invalid code")
 *   darkTheme   – true to use dark-only colour classes (AdminLoginPage)
 */
export default function OTPScreen({
  email,
  onVerify,
  onBack,
  onResend,
  loading = false,
  error = '',
  darkTheme = false,
}) {
  const [digits, setDigits]           = useState(Array(OTP_LENGTH).fill(''))
  const [resendSec, setResendSec]     = useState(30)   // 30-second resend cooldown
  const [expirySec, setExpirySec]     = useState(600)  // 10-minute code lifetime
  const [lockInfo, setLockInfo]       = useState(() => checkLock(email))
  const [lockMs, setLockMs]           = useState(() => lockInfo.locked ? lockInfo.remainingMs : 0)
  const inputRefs                     = useRef([])
  const submittedRef                  = useRef('')     // last auto-submitted code

  // Auto-focus first box on mount
  useEffect(() => { inputRefs.current[0]?.focus() }, [])

  // Resend countdown
  useEffect(() => {
    if (resendSec <= 0) return
    const id = setInterval(() => setResendSec(s => s - 1), 1000)
    return () => clearInterval(id)
  }, [resendSec])

  // Code-expiry countdown
  useEffect(() => {
    if (expirySec <= 0) return
    const id = setInterval(() => setExpirySec(s => (s > 0 ? s - 1 : 0)), 1000)
    return () => clearInterval(id)
  }, [expirySec])

  // Lock countdown — polls checkLock every second while locked
  useEffect(() => {
    if (!lockInfo.locked) return
    const id = setInterval(() => {
      const info = checkLock(email)
      setLockInfo(info)
      if (!info.locked) {
        setLockMs(0)
      } else {
        setLockMs(info.remainingMs)
      }
    }, 1000)
    return () => clearInterval(id)
  }, [lockInfo.locked, email])

  // Re-check lock whenever an external error arrives (parent called recordFailedAttempt)
  useEffect(() => {
    if (error) {
      const info = checkLock(email)
      setLockInfo(info)
      setLockMs(info.locked ? info.remainingMs : 0)
    }
  }, [error, email])

  // ── Input handlers ────────────────────────────────────────────────────────
  function handleChange(idx, raw) {
    const digit = raw.replace(/\D/g, '').slice(-1)
    const next  = [...digits]
    next[idx]   = digit
    setDigits(next)
    if (digit && idx < OTP_LENGTH - 1) inputRefs.current[idx + 1]?.focus()
  }

  function handleKeyDown(idx, e) {
    if (e.key === 'Backspace') {
      if (digits[idx]) {
        const next = [...digits]; next[idx] = ''; setDigits(next)
      } else if (idx > 0) {
        inputRefs.current[idx - 1]?.focus()
        const next = [...digits]; next[idx - 1] = ''; setDigits(next)
      }
    } else if (e.key === 'ArrowLeft'  && idx > 0)            inputRefs.current[idx - 1]?.focus()
    else if    (e.key === 'ArrowRight' && idx < OTP_LENGTH - 1) inputRefs.current[idx + 1]?.focus()
  }

  function handlePaste(e) {
    e.preventDefault()
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH)
    if (!text) return
    const next = Array(OTP_LENGTH).fill('')
    text.split('').forEach((ch, i) => { next[i] = ch })
    setDigits(next)
    inputRefs.current[Math.min(text.length, OTP_LENGTH - 1)]?.focus()
  }

  function handleResendClick() {
    setResendSec(30)
    setExpirySec(600)
    submittedRef.current = ''
    setDigits(Array(OTP_LENGTH).fill(''))
    inputRefs.current[0]?.focus()
    onResend?.()
  }

  // ── Derived state ─────────────────────────────────────────────────────────
  const otpValue = digits.join('')
  const isLocked = lockInfo.locked
  const canVerify = otpValue.length === OTP_LENGTH && !loading && !isLocked

  // Auto-submit once all 6 digits are entered (guard against re-submitting the
  // same code, e.g. after an error clears loading).
  useEffect(() => {
    if (otpValue.length === OTP_LENGTH && !loading && !isLocked && submittedRef.current !== otpValue) {
      submittedRef.current = otpValue
      onVerify?.(otpValue)
    }
    if (otpValue.length < OTP_LENGTH) submittedRef.current = ''
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otpValue, loading, isLocked])

  // ── Dynamic classes ───────────────────────────────────────────────────────
  const inputCls = darkTheme
    ? 'w-10 h-12 sm:w-12 sm:h-14 text-center text-xl font-bold rounded-lg border bg-gray-900 border-gray-700 text-gray-100 focus:outline-none focus:ring-2 focus:ring-jdil-green focus:border-transparent transition-colors caret-transparent'
    : 'w-10 h-12 sm:w-12 sm:h-14 text-center text-xl font-bold rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-jdil-green focus:border-transparent transition-colors caret-transparent'

  const mutedCls  = darkTheme ? 'text-gray-500'                                                            : 'text-gray-500 dark:text-gray-400'
  const labelCls  = darkTheme ? 'text-white'                                                               : 'text-gray-900 dark:text-gray-100'
  const errorCls  = darkTheme ? 'bg-red-950/50 border border-red-800/60 text-red-400'                     : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'

  return (
    <div className="w-full">

      {/* Icon + heading */}
      <div className="flex flex-col items-center mb-6">
        <div className="w-14 h-14 rounded-full bg-jdil-green/10 border border-jdil-green/30 flex items-center justify-center mb-4">
          <svg className="w-6 h-6 text-jdil-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <h3 className={`text-lg font-semibold ${labelCls} mb-1`}>Check your email</h3>
        <p className={`text-sm text-center ${mutedCls}`}>
          We sent a 6-digit verification code to
        </p>
        <p className="text-sm font-medium text-jdil-green mt-0.5 break-all text-center">{email}</p>
        <p className={`text-xs ${mutedCls} mt-1`}>
          {expirySec > 0 ? <>Code expires in <strong>{formatCountdown(expirySec * 1000)}</strong></> : 'Code expired — request a new one.'}
        </p>
      </div>

      {/* Lockout banner */}
      {isLocked && (
        <div className={`rounded-lg px-4 py-3 mb-4 text-sm ${errorCls}`}>
          Too many incorrect attempts. Try again in{' '}
          <strong>{formatCountdown(lockMs)}</strong>.
        </div>
      )}

      {/* OTP boxes */}
      <div className="flex justify-center gap-2 mb-5" onPaste={handlePaste}>
        {Array.from({ length: OTP_LENGTH }).map((_, i) => (
          <input
            key={i}
            ref={el => (inputRefs.current[i] = el)}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={2}
            value={digits[i]}
            onChange={e => handleChange(i, e.target.value)}
            onKeyDown={e => handleKeyDown(i, e)}
            disabled={isLocked || loading}
            className={`${inputCls} ${(isLocked || loading) ? 'opacity-40 cursor-not-allowed' : ''}`}
          />
        ))}
      </div>

      {/* External error (wrong code etc.) */}
      {error && !isLocked && (
        <div className={`rounded-lg px-4 py-3 mb-4 text-sm ${errorCls}`}>
          {error}
        </div>
      )}

      {/* Verify button */}
      <button
        onClick={() => canVerify && onVerify(otpValue)}
        disabled={!canVerify}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-jdil-green hover:bg-jdil-green-dark text-white font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-4"
      >
        {loading && (
          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
        )}
        {loading ? 'Verifying…' : 'Verify Code'}
      </button>

      {/* Resend */}
      <p className={`text-center text-sm ${mutedCls} mb-3`}>
        Didn't receive it?{' '}
        {resendSec > 0 ? (
          <span>
            Resend in{' '}
            <strong className={darkTheme ? 'text-gray-400' : 'text-gray-600 dark:text-gray-300'}>
              {resendSec}s
            </strong>
          </span>
        ) : (
          <button
            onClick={handleResendClick}
            disabled={loading}
            className="text-jdil-green hover:text-jdil-green-dark font-medium underline disabled:opacity-50"
          >
            Resend code
          </button>
        )}
      </p>

      {/* Back */}
      <div className="text-center">
        <button
          onClick={onBack}
          disabled={loading}
          className={`text-sm ${mutedCls} hover:text-jdil-green transition-colors disabled:opacity-50`}
        >
          ← Back to login
        </button>
      </div>
    </div>
  )
}
