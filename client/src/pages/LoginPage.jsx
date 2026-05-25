import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import JDILLogo from '../components/ui/JDILLogo'
import OTPScreen from '../components/ui/OTPScreen'
import { useTheme } from '../context/ThemeContext'
import { isAllowedEmail, DOMAIN_ERROR, recordFailedAttempt } from '../utils/authValidation'

export default function LoginPage() {
  const { verifyPassword, sendOTP, verifyOTP } = useAuth()
  const { dark, toggle } = useTheme()
  const navigate = useNavigate()

  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [showPwd, setShowPwd]   = useState(false)

  // OTP step
  const [step, setStep]         = useState('form')   // 'form' | 'otp'
  const [otpLoading, setOtpLoading] = useState(false)
  const [otpError, setOtpError]     = useState('')

  // ── Step 1: verify domain + password, then send OTP ──────────────────────
  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!isAllowedEmail(email)) {
      setError(DOMAIN_ERROR)
      return
    }

    setLoading(true)

    // Confirm credentials first (signs in then immediately signs out)
    const { error: pwErr } = await verifyPassword(email, password)
    if (pwErr) {
      setError(pwErr.message)
      setLoading(false)
      return
    }

    // Send OTP
    const { error: otpErr } = await sendOTP(email)
    setLoading(false)
    if (otpErr) {
      setError(`Could not send verification code: ${otpErr.message}`)
      return
    }

    setStep('otp')
  }

  // ── Step 2: verify OTP code ───────────────────────────────────────────────
  async function handleVerify(token) {
    setOtpError('')
    setOtpLoading(true)

    const { error: err } = await verifyOTP(email, token)
    setOtpLoading(false)

    if (err) {
      // Record failed attempt for lockout tracking
      recordFailedAttempt(email)
      setOtpError(err.message || 'Invalid or expired code. Please try again.')
      return
    }

    // Success — onAuthStateChange fires, ProtectedRoute takes over
    navigate('/')
  }

  async function handleResend() {
    setOtpError('')
    const { error: err } = await sendOTP(email)
    if (err) setOtpError(`Could not resend code: ${err.message}`)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-950 dark:to-gray-900 px-4">

      {/* Theme toggle */}
      <button
        onClick={toggle}
        className="fixed top-4 right-4 p-2 rounded-lg bg-white dark:bg-gray-800 shadow border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        title="Toggle dark mode"
      >
        {dark ? (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
          </svg>
        )}
      </button>

      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 p-8">

          {/* Logo */}
          <div className="flex flex-col items-center mb-8">
            <JDILLogo size="lg" />
            <div className="mt-2 text-center">
              <p className="text-base font-semibold text-gray-700 dark:text-gray-300 tracking-wide">Navigation</p>
              <p className="text-xs text-gray-400 dark:text-gray-500">Material Tracking System</p>
            </div>
          </div>

          {step === 'form' ? (
            <>
              {/* ── Password form ── */}
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="label">Email Address</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="input-field"
                    placeholder="you@jindalmumbai.com"
                    required
                    autoComplete="email"
                  />
                </div>

                <div>
                  <label className="label">Password</label>
                  <div className="relative">
                    <input
                      type={showPwd ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="input-field pr-10"
                      placeholder="••••••••"
                      required
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd(p => !p)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      {showPwd ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm rounded-lg px-4 py-3">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary w-full flex items-center justify-center gap-2 py-2.5 text-base disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading && (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  )}
                  {loading ? 'Sending code…' : 'Continue'}
                </button>
              </form>

              <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-6">
                Don't have an account?{' '}
                <Link to="/register" className="text-jdil-green hover:text-jdil-green-dark font-medium">
                  Register
                </Link>
              </p>

              {/* Divider + Admin login */}
              <div className="flex items-center gap-3 mt-6">
                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">or</span>
                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
              </div>

              <Link
                to="/admin-login"
                className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-400 dark:hover:border-gray-500 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                Login as Admin
              </Link>
            </>
          ) : (
            /* ── OTP screen ── */
            <OTPScreen
              email={email}
              onVerify={handleVerify}
              onBack={() => { setStep('form'); setOtpError('') }}
              onResend={handleResend}
              loading={otpLoading}
              error={otpError}
              darkTheme={false}
            />
          )}
        </div>

        <p className="text-center text-xs text-gray-400 dark:text-gray-600 mt-4">
          © {new Date().getFullYear()} Jindal Drilling &amp; Industries Ltd.
        </p>
      </div>
    </div>
  )
}
