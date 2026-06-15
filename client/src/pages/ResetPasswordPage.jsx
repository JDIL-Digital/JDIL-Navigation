import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import JDILLogo from '../components/ui/JDILLogo'

// Password rules: min 8 chars, at least one letter and one number.
const hasMinLen  = p => p.length >= 8
const hasLetter  = p => /[A-Za-z]/.test(p)
const hasNumber  = p => /\d/.test(p)

function EyeButton({ shown, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
      tabIndex={-1}
    >
      {shown ? (
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
  )
}

function Hint({ ok, children }) {
  return (
    <li className={`flex items-center gap-1.5 ${ok ? 'text-jdil-green' : 'text-gray-400 dark:text-gray-500'}`}>
      <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d={ok ? 'M5 13l4 4L19 7' : 'M12 8v4m0 4h.01'} />
      </svg>
      {children}
    </li>
  )
}

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [pwd, setPwd]           = useState('')
  const [confirm, setConfirm]   = useState('')
  const [showPwd, setShowPwd]   = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  // 'form' | 'success' | 'invalid'
  const [status, setStatus]     = useState('form')

  const recoveredRef = useRef(false)

  // The reset link carries a recovery token that Supabase parses on load,
  // creating a temporary session (PASSWORD_RECOVERY). If no session appears,
  // the link is expired/invalid.
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) recoveredRef.current = true
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) recoveredRef.current = true
    })
    const t = setTimeout(() => {
      if (!recoveredRef.current) setStatus(s => (s === 'form' ? 'invalid' : s))
    }, 5000)
    return () => { subscription.unsubscribe(); clearTimeout(t) }
  }, [])

  const rules = {
    len:    hasMinLen(pwd),
    alnum:  hasLetter(pwd) && hasNumber(pwd),
    match:  pwd.length > 0 && pwd === confirm,
  }
  const canSubmit = rules.len && rules.alnum && rules.match && !loading

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!rules.len)   { setError('Password must be at least 8 characters.'); return }
    if (!rules.alnum) { setError('Password must contain at least 1 letter and 1 number.'); return }
    if (!rules.match) { setError('Passwords do not match.'); return }

    setLoading(true)
    const { error: err } = await supabase.auth.updateUser({ password: pwd })
    setLoading(false)

    if (err) {
      // Most commonly the recovery session is missing/expired.
      if (/session|jwt|expired|invalid/i.test(err.message)) {
        setStatus('invalid')
      } else {
        setError(err.message)
      }
      return
    }

    setStatus('success')
    setTimeout(() => navigate('/login'), 2000)
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

          {status === 'success' ? (
            <div className="text-center">
              <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-jdil-green/10 border border-jdil-green/30 flex items-center justify-center">
                <svg className="w-7 h-7 text-jdil-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Password updated successfully</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Redirecting you to login…</p>
            </div>
          ) : status === 'invalid' ? (
            <div className="text-center">
              <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800 flex items-center justify-center">
                <svg className="w-7 h-7 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 5a7 7 0 100 14 7 7 0 000-14z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Link expired or invalid</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                This reset link has expired or is invalid. Request a new one.
              </p>
              <Link to="/forgot-password" className="btn-primary inline-flex mt-6 py-2.5 px-5 text-sm">
                Request a new link
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 text-center">Set new password</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center mt-1 mb-6">Enter your new password below</p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="label">New password</label>
                  <div className="relative">
                    <input
                      type={showPwd ? 'text' : 'password'}
                      value={pwd}
                      onChange={e => setPwd(e.target.value)}
                      className="input-field pr-10"
                      placeholder="••••••••"
                      required
                      autoComplete="new-password"
                    />
                    <EyeButton shown={showPwd} onToggle={() => setShowPwd(p => !p)} />
                  </div>
                </div>

                <div>
                  <label className="label">Confirm new password</label>
                  <div className="relative">
                    <input
                      type={showConfirm ? 'text' : 'password'}
                      value={confirm}
                      onChange={e => setConfirm(e.target.value)}
                      className="input-field pr-10"
                      placeholder="••••••••"
                      required
                      autoComplete="new-password"
                    />
                    <EyeButton shown={showConfirm} onToggle={() => setShowConfirm(p => !p)} />
                  </div>
                </div>

                <ul className="text-xs space-y-1 mt-1">
                  <Hint ok={rules.len}>At least 8 characters</Hint>
                  <Hint ok={rules.alnum}>Contains at least 1 letter and 1 number</Hint>
                  <Hint ok={rules.match}>Both passwords match</Hint>
                </ul>

                {error && (
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm rounded-lg px-4 py-3">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="btn-primary w-full flex items-center justify-center gap-2 py-2.5 text-base disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  {loading ? 'Updating…' : 'Update password'}
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
