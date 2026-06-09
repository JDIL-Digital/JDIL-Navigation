import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

const NotificationContext = createContext()

export function NotificationProvider({ children }) {
  const { user } = useAuth()
  const [notifications, setNotifications] = useState([])

  // Derive the unread count from state — single source of truth, no drift.
  const unreadCount = notifications.filter(n => !n.is_read).length

  async function fetchNotifications() {
    if (!user) return
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)
    if (data) setNotifications(data)
  }

  async function markAllRead() {
    if (!user) return
    console.log('[markAllRead] start — unread before:', notifications.filter(n => !n.is_read).length)

    // 1. Optimistic — clear the badge immediately for instant feedback.
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))

    // 2. Update via the SERVER (service role) — the client cannot UPDATE the
    //    notifications table directly (the `authenticated` role was only granted
    //    SELECT/INSERT, so a client-side update silently affects 0 rows).
    try {
      const resp = await fetch(`/api/notifications/${user.id}/read-all`, { method: 'PATCH' })
      const result = await resp.json().catch(() => ({}))
      console.log('[markAllRead] server result:', resp.status, result)
      if (!resp.ok) throw new Error(result.error || `HTTP ${resp.status}`)
    } catch (e) {
      console.error('[markAllRead] server update failed:', e)
    }

    // 3. Fresh fetch AFTER the update committed — overrides any stale in-flight
    //    fetch and guarantees the count matches DB reality.
    const { data: fresh, error: fetchErr } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)
    if (fetchErr) console.error('[markAllRead] post-update fetch failed:', fetchErr)
    else if (fresh) setNotifications(fresh)

    console.log('[markAllRead] unread after DB sync:', (fresh || []).filter(n => !n.is_read).length)
  }

  async function markRead(id) {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
    try {
      const resp = await fetch(`/api/notifications/read/${id}`, { method: 'PATCH' })
      if (!resp.ok) {
        const r = await resp.json().catch(() => ({}))
        throw new Error(r.error || `HTTP ${resp.status}`)
      }
    } catch (e) {
      console.error('markRead failed:', e)
      fetchNotifications()
    }
  }

  useEffect(() => {
    if (!user) { setNotifications([]); return }
    fetchNotifications()

    // Realtime INSERTs only update component state — they never reload the page.
    // New notifications arriving after "mark all read" are added unread, so the
    // badge correctly re-appears for genuinely new alerts.
    const channel = supabase
      .channel(`notifications-${user.id}`)
      // New notifications arrive unread → badge correctly re-appears.
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      }, payload => {
        console.log('[realtime] INSERT:', payload.new?.id)
        setNotifications(prev =>
          prev.some(n => n.id === payload.new.id) ? prev : [payload.new, ...prev]
        )
      })
      // UPDATEs (e.g. mark-all-read) merge the changed row so the channel
      // reflects read-state correctly instead of pushing back stale data.
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      }, payload => {
        console.log('[realtime] UPDATE:', payload.new?.id, 'is_read:', payload.new?.is_read)
        setNotifications(prev =>
          prev.map(n => n.id === payload.new.id ? { ...n, ...payload.new } : n)
        )
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [user])

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, markAllRead, markRead, fetchNotifications }}>
      {children}
    </NotificationContext.Provider>
  )
}

export const useNotifications = () => useContext(NotificationContext)
