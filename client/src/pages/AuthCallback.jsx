import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Mobile devices typically have no "original window" to return to, and
// window.close() doesn't work on tabs not opened by JavaScript (e.g. Safari).
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

/**
 * Magic-link landing page.
 *
 * The magic link opens this route in a NEW tab. Supabase parses the token from
 * the URL and establishes the session (which syncs to the original tab via
 * localStorage, advancing it into the app). Once the session is confirmed here
 * we try to close this tab automatically; if the browser blocks window.close()
 * (it only works for script-opened tabs or tabs with no history), we show a
 * friendly "you can close this tab" message instead.
 */
export default function AuthCallback() {
  const [status, setStatus] = useState('working')  // 'working' | 'done' | 'error'

  useEffect(() => {
    let finished = false

    function finish() {
      if (finished) return
      finished = true
      // On mobile there's no original window to return to and window.close()
      // won't work — just go straight into the app on this same tab.
      if (isMobile) {
        window.location.href = '/'
        return
      }
      // Desktop: attempt auto-close. Succeeds for script-opened tabs / no-history
      // tabs; otherwise it's a silent no-op and the fallback message below shows.
      try { window.close() } catch { /* ignore */ }
      // If we're still here a moment later, the browser blocked the close.
      setTimeout(() => setStatus('done'), 400)
    }

    // The session may already be present (Supabase parses the URL on load).
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) finish()
    })

    // Or it arrives shortly after, via detectSessionInUrl → SIGNED_IN.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') && session) {
        finish()
      }
    })

    // Safety net: if no session materialises (expired/invalid link), inform the user.
    const timeout = setTimeout(() => { if (!finished) setStatus('error') }, 6000)

    return () => { subscription.unsubscribe(); clearTimeout(timeout) }
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-950 dark:to-gray-900 px-4">
      <div className="w-full max-w-md text-center">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 p-10">

          {status === 'working' && (
            <>
              <div className="w-12 h-12 mx-auto mb-5 border-4 border-jdil-green border-t-transparent rounded-full animate-spin" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Completing sign-in…</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Verifying your secure link.</p>
            </>
          )}

          {status === 'done' && (
            <>
              <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-jdil-green/10 border border-jdil-green/30 flex items-center justify-center">
                <svg className="w-9 h-9 text-jdil-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Login successful!</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 leading-relaxed">
                You can close this tab and return to your original window —
                it's already signed in and ready to go.
              </p>
              <button
                onClick={() => { try { window.close() } catch { /* ignore */ } }}
                className="mt-6 inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-jdil-green hover:bg-jdil-green-dark text-white font-medium text-sm transition-colors"
              >
                Close this tab
              </button>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800 flex items-center justify-center">
                <svg className="w-8 h-8 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 5a7 7 0 100 14 7 7 0 000-14z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Link expired or invalid</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                This sign-in link could not be verified. Please return to the login page and try again.
              </p>
              <a
                href="/login"
                className="mt-6 inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Back to login
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
