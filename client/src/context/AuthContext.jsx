import { createContext, useContext, useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

const AuthContext = createContext()

// Isolated client used ONLY to validate a password without creating a session
// on the main client. persistSession:false + its own storageKey means it never
// writes the main auth token or fires the main client's onAuthStateChange — so
// the 2FA flow can validate the password and then show the OTP screen without
// the app briefly seeing a logged-in user and navigating away.
const verifyClient = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'sb-jdil-verify' } }
)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  // loading: true while the initial auth session check is in flight
  // profileLoading: true while the profile row fetch is in flight
  const [loading, setLoading] = useState(true)
  const [profileLoading, setProfileLoading] = useState(false)

  async function fetchProfile(userId) {
    setProfileLoading(true)
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single()
    if (error) {
      console.error('fetchProfile error:', error.message, error.code)
    }
    console.log('fetchProfile result:', {
      userId,
      data,
      is_active: data?.is_active,
      role: data?.role,
      error: error ?? null,
    })
    setProfile(data ?? null)
    setProfileLoading(false)
    return data
  }

  useEffect(() => {
    // Await the profile fetch before clearing loading so ProtectedRoute
    // never evaluates profile=null as "inactive".
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) await fetchProfile(session.user.id)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchProfile(session.user.id)
      } else {
        setProfile(null)
        setProfileLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }

  /**
   * Step 1 of 2FA: confirm credentials WITHOUT touching the main session.
   * Runs on an isolated client so no SIGNED_IN fires on the main client (which
   * would otherwise redirect away from /login and unmount the OTP screen).
   */
  async function verifyPassword(email, password) {
    const { error } = await verifyClient.auth.signInWithPassword({ email, password })
    if (!error) { try { await verifyClient.auth.signOut() } catch { /* ignore */ } }
    return { error }
  }

  /**
   * Step 2 of 2FA – part a: send a one-time passcode to the email address.
   * Uses Supabase Email OTP (signInWithOtp).
   */
  async function sendOTP(email) {
    // Send a 6-digit code only (no magic link). The Supabase email template uses
    // {{ .Token }}; omitting emailRedirectTo keeps this a pure code flow.
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    })
    return { error }
  }

  /**
   * Step 2 of 2FA – part b: exchange the 6-digit token for a real session.
   * On success Supabase fires onAuthStateChange which calls fetchProfile.
   */
  async function verifyOTP(email, token) {
    const { error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email',
    })
    return { error }
  }

  async function signOut() {
    // Clear any chatbot session history so the next user starts fresh
    try {
      Object.keys(sessionStorage)
        .filter(k => k.startsWith('jdil-chat-'))
        .forEach(k => sessionStorage.removeItem(k))
    } catch { /* ignore */ }
    await supabase.auth.signOut()
    setProfile(null)
  }

  async function register({ name, email, password, role, teamCode, rigName }) {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) return { error }

    const { error: profileError } = await supabase.from('users').insert({
      id: data.user.id,
      name,
      email,
      role,
      team_code: teamCode,
      rig_name:  rigName,
      is_active: false,
    })
    if (profileError) return { error: profileError }

    // Fire-and-forget: notify admins via email (don't block registration on failure)
    fetch('/api/users/register-notify', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, role, team_code: teamCode, rig_name: rigName }),
    }).catch(e => console.warn('register-notify failed (non-critical):', e))

    return { error: null }
  }

  const value = { user, profile, loading, profileLoading, signIn, verifyPassword, sendOTP, verifyOTP, signOut, register }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
