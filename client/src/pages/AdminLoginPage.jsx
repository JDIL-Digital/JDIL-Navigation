import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import jindalLogo from '../assets/Jindal_Logo.jpg'
import OTPScreen from '../components/ui/OTPScreen'
import { isAllowedEmail, DOMAIN_ERROR, recordFailedAttempt } from '../utils/authValidation'

export default function AdminLoginPage() {
  const { verifyPassword, sendOTP, verifyOTP } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [showPwd, setShowPwd]   = useState(false)

  // OTP step
  const [step, setStep]             = useState('form')   // 'form' | 'otp'
  const [otpLoading, setOtpLoading] = useState(false)
  const [otpError, setOtpError]     = useState('')

  // ── Cross-tab login detection ─────────────────────────────────────────────
  // If the user completes login in another tab (e.g. via a magic link) while
  // this tab is on the "check your email" screen, detect the new session here
  // and move straight into the admin panel.
  useEffect(() => {
    if (step !== 'otp') return

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session) {
        navigate('/admin', { replace: true })
      }
    })

    async function onStorage(e) {
      if (e.key && e.key.includes('-auth-token') && e.newValue) {
        const { data: { session } } = await supabase.auth.getSession()
        if (session) navigate('/admin', { replace: true })
      }
    }
    window.addEventListener('storage', onStorage)

    return () => {
      subscription.unsubscribe()
      window.removeEventListener('storage', onStorage)
    }
  }, [step, navigate])

  // ── Step 1: verify domain + password, then send OTP ──────────────────────
  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!isAllowedEmail(email)) {
      setError(DOMAIN_ERROR)
      return
    }

    setLoading(true)

    const { error: pwErr } = await verifyPassword(email, password)
    if (pwErr) {
      setError(pwErr.message)
      setLoading(false)
      return
    }

    const { error: otpErr } = await sendOTP(email)
    setLoading(false)
    if (otpErr) {
      setError(`Could not send verification code: ${otpErr.message}`)
      return
    }

    setStep('otp')
  }

  // ── Step 2: verify OTP ────────────────────────────────────────────────────
  async function handleVerify(token) {
    setOtpError('')
    setOtpLoading(true)

    const { error: err } = await verifyOTP(email, token)
    setOtpLoading(false)

    if (err) {
      recordFailedAttempt(email)
      setOtpError(err.message || 'Invalid or expired code. Please try again.')
      return
    }

    navigate('/admin')
  }

  async function handleResend() {
    setOtpError('')
    const { error: err } = await sendOTP(email)
    if (err) setOtpError(`Could not resend code: ${err.message}`)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex bg-gray-950">

      {/* Left panel — decorative */}
      <div className="hidden lg:flex lg:w-1/2 flex-col items-center justify-center bg-gradient-to-br from-gray-900 via-gray-950 to-black border-r border-gray-800 p-12 relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-5"
          style={{
            backgroundImage: 'linear-gradient(#1a7a3c 1px, transparent 1px), linear-gradient(90deg, #1a7a3c 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
        <div className="relative z-10 text-center">
          <img src={jindalLogo} alt="Jindal Drilling & Industries Ltd." className="h-24 w-auto object-contain mx-auto mb-8 opacity-90" />
          <h1 className="text-3xl font-bold text-white mb-3 tracking-tight">JDIL Navigation</h1>
          <p className="text-gray-400 text-base mb-10">Material Tracking System</p>
          <div className="space-y-3 text-left max-w-xs mx-auto">
            {[
              'Full system access across all rigs',
              'User registration approvals',
              'Complete audit trail',
              'Field-level change history',
            ].map(item => (
              <div key={item} className="flex items-center gap-3 text-gray-400 text-sm">
                <div className="w-1.5 h-1.5 rounded-full bg-jdil-green shrink-0" />
                {item}
              </div>
            ))}
          </div>
        </div>
        <div className="absolute bottom-8 left-0 right-0 text-center">
          <span className="text-xs text-gray-600">Restricted Access — Authorised Personnel Only</span>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center px-6 py-12 bg-gray-950">
        <div className="w-full max-w-sm">

          {/* Mobile logo */}
          <div className="lg:hidden flex justify-center mb-8">
            <img src={jindalLogo} alt="Jindal Drilling & Industries Ltd." className="h-14 w-auto object-contain" />
          </div>

          {step === 'form' ? (
            <>
              {/* Header */}
              <div className="mb-8">
                <div className="inline-flex items-center gap-2 bg-jdil-green/10 border border-jdil-green/30 rounded-full px-3 py-1 mb-4">
                  <svg className="w-3.5 h-3.5 text-jdil-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  <span className="text-xs font-medium text-jdil-green">Admin Access</span>
                </div>
                <h2 className="text-2xl font-bold text-white">Administrator Login</h2>
                <p className="text-gray-500 text-sm mt-1">Sign in with your admin credentials</p>
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Email Address</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg bg-gray-900 border border-gray-700 text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-jdil-green focus:border-transparent text-sm transition-colors"
                    placeholder="admin@jindalmumbai.com"
                    required
                    autoComplete="email"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Password</label>
                  <div className="relative">
                    <input
                      type={showPwd ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="w-full px-3 py-2.5 pr-10 rounded-lg bg-gray-900 border border-gray-700 text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-jdil-green focus:border-transparent text-sm transition-colors"
                      placeholder="••••••••"
                      required
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd(p => !p)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400 transition-colors"
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

                <div className="text-right -mt-1">
                  <Link to="/forgot-password" className="text-sm text-jdil-green hover:text-jdil-green-dark font-medium">
                    Forgot password?
                  </Link>
                </div>

                {error && (
                  <div className="bg-red-950/50 border border-red-800/60 text-red-400 text-sm rounded-lg px-4 py-3">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-jdil-green hover:bg-jdil-green-dark text-white font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-2"
                >
                  {loading ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                    </svg>
                  )}
                  {loading ? 'Sending code…' : 'Continue'}
                </button>
              </form>

              <div className="mt-6 flex items-center gap-3">
                <div className="flex-1 h-px bg-gray-800" />
                <span className="text-xs text-gray-700">not an admin?</span>
                <div className="flex-1 h-px bg-gray-800" />
              </div>

              <Link
                to="/login"
                className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border border-gray-800 text-gray-500 hover:text-gray-300 hover:border-gray-600 text-sm font-medium transition-colors"
              >
                ← Back to main login
              </Link>
            </>
          ) : (
            /* ── OTP screen (dark theme) ── */
            <OTPScreen
              email={email}
              onVerify={handleVerify}
              onBack={() => { setStep('form'); setOtpError('') }}
              onResend={handleResend}
              loading={otpLoading}
              error={otpError}
              darkTheme={true}
            />
          )}

          <p className="text-center text-xs text-gray-700 mt-8">
            © {new Date().getFullYear()} Jindal Drilling &amp; Industries Ltd.
          </p>
        </div>
      </div>
    </div>
  )
}
