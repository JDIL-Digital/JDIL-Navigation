import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext()

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
   * Step 1 of 2FA: confirm credentials without creating a lasting session.
   * Signs in, then immediately signs out. Returns { error }.
   */
  async function verifyPassword(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error }
    await supabase.auth.signOut()
    return { error: null }
  }

  /**
   * Step 2 of 2FA – part a: send a one-time passcode to the email address.
   * Uses Supabase Email OTP (signInWithOtp).
   */
  async function sendOTP(email) {
    // The email contains BOTH a 6-digit code (entered in the original tab) and
    // a magic link. Point the magic link at /auth/callback so the tab it opens
    // can confirm the session and then self-close, leaving the original tab
    // logged in. The 6-digit OTP entry flow continues to work unchanged.
    const redirectTo = typeof window !== 'undefined'
      ? `${window.location.origin}/auth/callback`
      : undefined
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
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
