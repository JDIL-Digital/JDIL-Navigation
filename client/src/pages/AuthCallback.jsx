import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'

/**
 * Deprecated magic-link landing page. Login now uses a 6-digit OTP code, so this
 * route no longer establishes a session — it just informs the user and sends
 * them to /login. Kept (not deleted) in case a stale cached magic link is opened.
 */
export default function AuthCallback() {
  const navigate = useNavigate()

  useEffect(() => {
    const t = setTimeout(() => navigate('/login', { replace: true }), 3000)
    return () => clearTimeout(t)
  }, [navigate])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-950 dark:to-gray-900 px-4">
      <div className="w-full max-w-md text-center">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 p-10">
          <div className="w-14 h-14 mx-auto mb-5 rounded-full bg-jdil-green/10 border border-jdil-green/30 flex items-center justify-center">
            <svg className="w-7 h-7 text-jdil-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Sign in with your code</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 leading-relaxed">
            Please sign in using the 6-digit code sent to your email. Redirecting you to the login page…
          </p>
          <Link to="/login" className="btn-primary inline-flex mt-6 py-2.5 px-5 text-sm">
            Go to login
          </Link>
        </div>
      </div>
    </div>
  )
}
