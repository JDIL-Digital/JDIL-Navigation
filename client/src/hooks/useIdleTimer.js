import { useEffect, useRef, useCallback } from 'react'

// ── Configuration (easy to change) ────────────────────────────────────────────
export const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000  // 30 minutes total
export const WARNING_BEFORE_MS     = 2 * 60 * 1000   // show warning 2 min before

// Delay before the warning fires = total timeout minus the warning window.
const IDLE_BEFORE_WARNING_MS = INACTIVITY_TIMEOUT_MS - WARNING_BEFORE_MS

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'click', 'keydown', 'scroll', 'touchstart']

// Treat a focused input/textarea/contenteditable as "active" (in-flight form).
function isEditingField() {
  const el = document.activeElement
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true
}

/**
 * Fires `onIdle` after IDLE_BEFORE_WARNING_MS of no activity. Any of the tracked
 * activity events restarts the countdown (throttled to once/second). Timers live
 * in refs so activity never triggers React re-renders.
 *
 * @param {object}   opts
 * @param {Function} opts.onIdle   — called when the idle threshold is reached
 * @param {boolean}  opts.enabled  — when false, all listeners/timers are torn down
 */
export default function useIdleTimer({ onIdle, enabled = true }) {
  const onIdleRef = useRef(onIdle)
  onIdleRef.current = onIdle

  const timerRef = useRef(null)
  const startRef = useRef(() => {})

  useEffect(() => {
    if (!enabled) return

    function start() {
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        // In-flight form protection: if the user is in a field, they're not idle.
        if (isEditingField()) { start(); return }
        onIdleRef.current?.()
      }, IDLE_BEFORE_WARNING_MS)
    }
    startRef.current = start
    start()

    // Throttle activity handling to at most once per second for efficiency.
    let throttled = false
    let throttleTimer = null
    function onActivity() {
      if (throttled) return
      throttled = true
      throttleTimer = setTimeout(() => { throttled = false }, 1000)
      start()
    }

    ACTIVITY_EVENTS.forEach(ev => window.addEventListener(ev, onActivity, { passive: true }))

    return () => {
      ACTIVITY_EVENTS.forEach(ev => window.removeEventListener(ev, onActivity))
      clearTimeout(throttleTimer)
      clearTimeout(timerRef.current)
    }
  }, [enabled])

  // Manual restart (not required by the modal flow, but handy/expressive).
  const reset = useCallback(() => startRef.current(), [])
  return { reset }
}
