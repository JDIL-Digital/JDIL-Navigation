import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import jindalLogo from '../../assets/Jindal_Logo.jpg'
import { getResponse, getWelcome, getWelcomeChips } from '../../utils/chatbotEngine'
import { createDataProvider } from '../../utils/chatbotData'

function storageKey(userId) { return `jdil-chat-${userId || 'anon'}` }

export default function ChatbotWidget() {
  const { profile } = useAuth()
  const [open, setOpen]         = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [messages, setMessages] = useState([])   // { role:'user'|'bot', text, chips? }
  const [input, setInput]       = useState('')
  const [typing, setTyping]     = useState(false)

  const scrollRef = useRef(null)
  const inputRef  = useRef(null)

  // Data provider bound to supabase + current user (role-scoped)
  const data = useMemo(
    () => createDataProvider(supabase, profile),
    [profile?.id, profile?.role, profile?.rig_name]
  )
  const ctx = useMemo(
    () => ({ user: profile ? { name: profile.name, role: profile.role, rig_name: profile.rig_name, team_code: profile.team_code, id: profile.id } : {}, data }),
    [profile, data]
  )

  // ── Load session history once profile is known ─────────────────────────────
  useEffect(() => {
    if (!profile?.id) return
    try {
      const saved = sessionStorage.getItem(storageKey(profile.id))
      if (saved) setMessages(JSON.parse(saved))
    } catch { /* ignore */ }
  }, [profile?.id])

  // ── Persist history for the session ────────────────────────────────────────
  useEffect(() => {
    if (!profile?.id) return
    try { sessionStorage.setItem(storageKey(profile.id), JSON.stringify(messages)) } catch { /* ignore */ }
  }, [messages, profile?.id])

  // ── Seed welcome message the first time the panel opens ────────────────────
  useEffect(() => {
    if (open && !minimized && messages.length === 0 && profile) {
      setMessages([{ role: 'bot', text: getWelcome(profile.name), chips: getWelcomeChips(profile.role) }])
    }
  }, [open, minimized, profile]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-scroll to newest ──────────────────────────────────────────────────
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, typing])

  // Focus input when opened
  useEffect(() => { if (open && !minimized) setTimeout(() => inputRef.current?.focus(), 150) }, [open, minimized])

  // ── Send a message (typed or chip) ─────────────────────────────────────────
  async function send(text) {
    const msg = (text ?? input).trim()
    if (!msg || typing) return
    setInput('')
    setMessages(m => [...m, { role: 'user', text: msg }])
    setTyping(true)

    // Small delay for a natural "thinking" feel
    await new Promise(r => setTimeout(r, 200))
    let res
    try {
      res = await getResponse(msg, ctx)
    } catch (e) {
      console.error('[chatbot] getResponse error:', e)
      res = { text: 'Something went wrong. Please try again.', chips: getWelcomeChips(profile?.role) }
    }
    setTyping(false)
    setMessages(m => [...m, { role: 'bot', text: res.text, chips: res.chips || [] }])
  }

  // Active chips = those attached to the most recent bot message
  const lastBot = [...messages].reverse().find(m => m.role === 'bot')
  const activeChips = lastBot?.chips || []

  // ── Floating button (panel closed) ─────────────────────────────────────────
  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); setMinimized(false) }}
        style={{ backgroundColor: '#1a7a3c' }}
        className="group fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full flex items-center justify-center text-white shadow-[0_6px_20px_rgba(0,0,0,0.20)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.28)] transition-all duration-200 ease-out hover:scale-105 active:scale-95 hover:[background-color:#155f2f]"
        aria-label="Open JDIL Assistant"
        title="JDIL Assistant"
      >
        {/* Clean, minimal rounded speech-bubble outline (white, not filled) */}
        <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2}
          strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <path d="M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      </button>
    )
  }

  // ── Minimized pill ─────────────────────────────────────────────────────────
  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className="fixed bottom-5 right-5 lg:bottom-6 lg:right-6 z-40 flex items-center gap-2 pl-3 pr-4 py-2.5 rounded-full bg-jdil-green hover:bg-jdil-green-dark shadow-lg text-white text-sm font-medium transition-colors"
      >
        <span className="w-2 h-2 rounded-full bg-white/90 animate-pulse" />
        JDIL Assistant
      </button>
    )
  }

  // ── Full chat panel ────────────────────────────────────────────────────────
  return (
    <div className="fixed z-50 inset-0 sm:inset-auto sm:bottom-6 sm:right-6 sm:w-[380px] sm:h-[560px] sm:max-h-[calc(100vh-3rem)] bg-white dark:bg-gray-900 sm:rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-jdil-green to-jdil-green-dark text-white shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shrink-0 overflow-hidden">
            <img src={jindalLogo} alt="JDIL" className="w-6 h-6 object-contain" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm leading-tight">JDIL Assistant</p>
            <p className="text-[11px] text-white/70 leading-tight">Always here to help</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setMinimized(true)} title="Minimize"
            className="p-1.5 rounded-lg hover:bg-white/15 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </button>
          <button onClick={() => setOpen(false)} title="Close"
            className="p-1.5 rounded-lg hover:bg-white/15 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 space-y-3 bg-gray-50 dark:bg-gray-950">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-line break-words ${
              m.role === 'user'
                ? 'bg-jdil-green text-white rounded-br-sm'
                : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700 rounded-bl-sm'
            }`}>
              {m.text}
            </div>
          </div>
        ))}

        {typing && (
          <div className="flex justify-start">
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl rounded-bl-sm px-4 py-3">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Suggestion chips */}
      {activeChips.length > 0 && !typing && (
        <div className="px-3 py-2 flex flex-wrap gap-1.5 border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shrink-0">
          {activeChips.map((c, i) => (
            <button key={i} onClick={() => send(c)}
              className="text-xs px-2.5 py-1.5 rounded-full bg-jdil-green/10 text-jdil-green hover:bg-jdil-green/20 border border-jdil-green/20 transition-colors">
              {c}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <form
        onSubmit={e => { e.preventDefault(); send() }}
        className="flex items-center gap-2 px-3 py-3 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shrink-0"
      >
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ask about the app or your POs…"
          className="flex-1 px-3 py-2 rounded-full bg-gray-100 dark:bg-gray-800 border border-transparent focus:border-jdil-green focus:bg-white dark:focus:bg-gray-900 text-sm text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none transition-colors"
        />
        <button type="submit" disabled={!input.trim() || typing}
          className="w-9 h-9 shrink-0 rounded-full bg-jdil-green hover:bg-jdil-green-dark text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </button>
      </form>
    </div>
  )
}
