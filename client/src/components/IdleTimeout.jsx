import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import useIdleTimer, { WARNING_BEFORE_MS } from '../hooks/useIdleTimer'

/**
 * Renders nothing until the user has been idle long enough to warrant a warning.
 * Mounted inside Layout, so it's active only for authenticated app pages — never
 * on login/register/forgot/reset/callback/pending (those don't render Layout).
 */
export default function IdleTimeout() {
  const { signOut } = useAuth()
  const navigate = useNavigate()

  const [warning, setWarning]     = useState(false)
  const [remaining, setRemaining] = useState(WARNING_BEFORE_MS)
  const intervalRef = useRef(null)
  const loggingOut  = useRef(false)

  // While the warning modal is open, the idle hook is disabled (enabled=!warning)
  // so background mouse movement can't silently extend the session — the user
  // must explicitly choose "Stay signed in".
  useIdleTimer({ onIdle: () => setWarning(true), enabled: !warning })

  const doLogout = useCallback(async () => {
    if (loggingOut.current) return
    loggingOut.current = true
    clearInterval(intervalRef.current)
    setWarning(false)
    try { sessionStorage.setItem('jdil-idle-logout', '1') } catch { /* ignore */ }
    try { await signOut() } catch (e) { console.warn('idle signOut:', e) }
    navigate('/login', { replace: true })
  }, [signOut, navigate])

  // Drive the 2-minute countdown while the warning is shown.
  useEffect(() => {
    if (!warning) return
    const deadline = Date.now() + WARNING_BEFORE_MS
    setRemaining(WARNING_BEFORE_MS)
    intervalRef.current = setInterval(() => {
      const left = deadline - Date.now()
      if (left <= 0) { setRemaining(0); doLogout() }
      else setRemaining(left)
    }, 250)
    return () => clearInterval(intervalRef.current)
  }, [warning, doLogout])

  function staySignedIn() {
    clearInterval(intervalRef.current)
    setWarning(false)   // re-enables the idle hook with a fresh countdown
  }

  if (!warning) return null

  const totalSec = Math.max(0, Math.ceil(remaining / 1000))
  const mmss = `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`

  return (
    // Backdrop blocks interaction; intentionally NOT closable by clicking outside.
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-sm p-6 text-center">
        <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-amber-100 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 flex items-center justify-center">
          <svg className="w-7 h-7 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>

        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Are you still there?</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          You will be logged out in{' '}
          <span className="font-semibold text-gray-700 dark:text-gray-200 tabular-nums">{mmss}</span>{' '}
          due to inactivity
        </p>

        <div className="my-5 text-4xl font-bold text-jdil-green tabular-nums tracking-wider">{mmss}</div>

        <div className="flex gap-3">
          <button onClick={staySignedIn} className="btn-primary flex-1">Stay signed in</button>
          <button
            onClick={doLogout}
            className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Logout now
          </button>
        </div>
      </div>
    </div>
  )
}
