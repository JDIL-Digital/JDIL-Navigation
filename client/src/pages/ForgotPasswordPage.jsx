import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import JDILLogo from '../components/ui/JDILLogo'
import { isAllowedEmail, DOMAIN_ERROR } from '../utils/authValidation'

export default function ForgotPasswordPage() {
  const [email, setEmail]     = useState('')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent]       = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!isAllowedEmail(email)) {
      setError(DOMAIN_ERROR)
      return
    }

    setLoading(true)
    // Always show success regardless of whether the email exists (don't reveal
    // which addresses are registered).
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin + '/reset-password',
    })
    if (err) console.warn('resetPasswordForEmail:', err.message)
    setLoading(false)
    setSent(true)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-950 dark:to-gray-900 px-4">
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

          {sent ? (
            <div className="text-center">
              <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-jdil-green/10 border border-jdil-green/30 flex items-center justify-center">
                <svg className="w-7 h-7 text-jdil-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Check your inbox</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                We sent a reset link to <span className="font-medium text-jdil-green break-all">{email.trim()}</span>.
                Check your inbox. The link expires in 30 minutes.
              </p>
              <Link
                to="/login"
                className="mt-6 inline-block text-sm text-gray-500 dark:text-gray-400 hover:text-jdil-green transition-colors"
              >
                ← Back to login
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 text-center">Reset your password</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center mt-1 mb-6">
                Enter your @jindalmumbai.com email and we'll send you a reset link
              </p>

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
                    autoFocus
                  />
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
                  {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  {loading ? 'Sending…' : 'Send reset link'}
                </button>
              </form>

              <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-6">
                <Link to="/login" className="hover:text-jdil-green transition-colors">← Back to login</Link>
              </p>
            </>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 dark:text-gray-600 mt-4">
          © {new Date().getFullYear()} Jindal Drilling &amp; Industries Ltd.
        </p>
      </div>
    </div>
  )
}
