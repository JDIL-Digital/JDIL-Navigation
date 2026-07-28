// ════════════════════════════════════════════════════════════════════════════
//  chatbotEngine.js — JDIL Assistant answer engine (no external AI)
//
//  PUBLIC API
//    getResponse(userMessage, ctx) → Promise<{ text, chips, confidence, kind }>
//    getWelcome(name)              → string
//    getWelcomeChips(role)         → string[]
//
//  ctx = {
//    user: { name, role, rig_name, team_code, id },
//    data: <data provider from chatbotData.js>   // async query fns, role-scoped
//    aiFallback?: (message, ctx) => Promise<{text,chips}|null>  // FUTURE hook
//  }
//
//  ARCHITECTURE NOTE (future AI upgrade):
//    The matching pipeline produces a confidence score. When confidence is below
//    CONFIDENCE_MIN we call ctx.aiFallback (if provided) BEFORE giving the generic
//    "I'm not sure" reply. To add Claude later: pass an aiFallback that calls your
//    API. No UI changes required — the widget only consumes getResponse().
// ════════════════════════════════════════════════════════════════════════════

const CONFIDENCE_MIN = 0.45   // below this → AI fallback / "not sure"

// ── Text utilities ───────────────────────────────────────────────────────────
function normalize(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')   // keep word chars, spaces, hyphens (for PO-2026-001)
    .replace(/\s+/g, ' ')
    .trim()
}

// Levenshtein distance (small strings) for typo tolerance
function lev(a, b) {
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  return dp[m][n]
}

// Fuzzy single-word equality (typo tolerant for words length >= 4)
function fuzzyEq(token, keyword) {
  if (token === keyword) return true
  if (keyword.length >= 4 && token.length >= 3) {
    const d = lev(token, keyword)
    return d <= (keyword.length >= 7 ? 2 : 1)
  }
  return false
}

// ── Knowledge base intents ───────────────────────────────────────────────────
const KB_INTENTS = [
  {
    id: 'create_po',
    keywords: ['create po', 'new po', 'add po', 'make po', 'raise po', 'create purchase', 'new purchase order', 'start po', 'create a po', 'creating po'],
    answer:
`Here's how to create a Purchase Order (Purchase team):

1. Click "Purchase" in the sidebar.
2. Click the "+ New PO" button (top right).
3. The MR Number and PO Number are auto-generated — edit if needed.
4. Set the PO Date and Promised Ready Date.
5. Choose the Rig / Location.
6. Type the Vendor name — pick from the autocomplete dropdown (contact & phone auto-fill).
7. Your Buyer Code is filled in automatically from your profile.
8. Add one or more Line Items (item code, description, quantity, unit).
9. Click "Create PO".

Your draft is auto-saved, so you can close and finish later.`,
    chips: ['How do I add multiple items to a PO?', 'How does vendor search work?'],
  },
  {
    id: 'line_items',
    keywords: ['line item', 'line items', 'multiple item', 'multiple items', 'add item', 'add items', 'more items', 'items to a po', 'add line'],
    answer:
`Each PO can have multiple line items:

• In the New PO form, scroll to the "Line Items" section.
• Each row has: Item Code, Material Description, Quantity Ordered, and Unit (e.g. pcs, kg, set).
• Click "+ Add Item" to add another row, or the trash icon to remove one.
• At least one line item is required to create a PO.

After dispatch, the Rig team records delivered quantities per item — each item shows Pending / Partially Delivered / Fully Delivered.`,
    chips: ['How do I create a PO?', 'How do I mark delivery?'],
  },
  {
    id: 'vendor_search',
    keywords: ['vendor search', 'vendor autocomplete', 'find vendor', 'search vendor', 'vendor name', 'vendor dropdown', 'how does vendor', 'vendor lookup'],
    answer:
`Vendor search (autocomplete):

• Start typing a vendor name (at least 2 letters) in the Vendor field.
• A dropdown shows matching vendors — active vendors appear first with a green "Active" badge.
• Click a vendor to auto-fill its Contact Person and Phone Number.
• Not in the list? Just type the full name — free-text new vendors are allowed.

Admins manage the master vendor list under Admin → Vendors (including bulk Excel/CSV upload).`,
    chips: ['How do I create a PO?'],
  },
  {
    id: 'logistics_edit',
    keywords: ['what can i edit', 'logistics edit', 'my fields', 'editable fields', 'what fields', 'edit as logistics', 'logistics fields'],
    answer:
`As Logistics, you can edit:

• Material Collection Date
• Material Collection Location
• Mode of Transport (Road / Air / Sea / Courier)
• Transporter Detail
• Dispatch Date
• DC Number — only for YOUR location
• JDIL Location and In-Transit to Rig Date

Purchase-only fields (vendor, buyer code, etc.) are shown but locked for you.`,
    chips: ["Why can't I see all DC numbers?", 'How do I update dispatch?'],
  },
  {
    id: 'dc_visibility',
    keywords: ['dc number', 'dc numbers', 'see all dc', 'cant see dc', 'location based', 'my location', 'why cant i see', 'hidden dc', 'other dc'],
    answer:
`DC Number fields are filtered by your logistics location (team code):

• SV-01, SS-02 → DC Number (BKC)
• AK-03, KT-04 → DC Number (Taloja)
• MK-05 → DC Number (Nhava)
• RS-06 → DC Number (Nagothane)

You only see and edit the DC field for your own location — the other location DC fields are hidden to keep things clean. All other logistics fields stay visible to everyone.`,
    chips: ['What can I edit?', 'How do I update dispatch?'],
  },
  {
    id: 'update_dispatch',
    keywords: ['update dispatch', 'mark dispatch', 'enter dispatch', 'dispatch date', 'how do i dispatch', 'record dispatch', 'dispatched'],
    answer:
`To update dispatch / logistics info:

1. Open the PO (click it in the Logistics list).
2. Fill in your fields — Material Collection Date/Location, Mode of Transport, Transporter, your DC Number, Dispatch Date, JDIL Location, etc.
3. Click "Save Changes".

The pipeline status updates automatically based on which fields you fill (e.g. a Dispatch Date moves it to "In Transit to JDIL").`,
    chips: ['What can I edit?', 'What do the pipeline stages mean?'],
  },
  {
    id: 'mark_delivery',
    keywords: ['mark delivery', 'mark delivered', 'delivered quantity', 'quantity delivered', 'receive material', 'received', 'how do i deliver', 'record delivery', 'delivery quantity'],
    answer:
`To mark a delivery (Rig team):

1. Open the PO from your Rig list.
2. In the "Line Items" table, enter the Quantity Delivered for each item.
3. Click "Save Deliveries".

• Delivered = Ordered → item shows "Fully Delivered" (green).
• Delivered < Ordered → "Partially Delivered" (amber) and an email alert goes to the rig & purchase teams.
You can't change the ordered quantity — only what was delivered.`,
    chips: ['What is partial delivery?'],
  },
  {
    id: 'partial_delivery',
    keywords: ['partial delivery', 'partial', 'part delivered', 'partially', 'incomplete delivery', 'short delivery'],
    answer:
`Partial delivery means only some of an item's ordered quantity arrived:

• Enter the amount actually received in "Quantity Delivered" (less than ordered).
• The item is flagged "Partially Delivered" and the Pending quantity is shown.
• An automatic email alert is sent to the rig managers for that rig and the purchase team, noting delivered/ordered/pending.
• When the rest arrives, update the delivered quantity again — once it matches ordered, it becomes "Fully Delivered".`,
    chips: ['How do I mark delivery?'],
  },
  {
    id: 'pipeline_stages',
    keywords: ['pipeline', 'stages', 'stage mean', 'status mean', 'what do the stages', 'pipeline stages', 'statuses', 'what are the stages', 'stage meaning'],
    answer:
`The PO pipeline stages (auto-calculated from filled fields):

1. MR Created — material request logged
2. PO Released — PO number assigned
3. Buyer Assigned — buyer code set
4. Vendor Confirmed — material collection date set
5. Material Ready at Vendor — collection location set
6. Dispatched from Vendor — a DC number is entered
7. In Transit to JDIL — dispatch date set
8. At JDIL Location — JDIL location recorded
9. In Transit to Rig — in-transit-to-rig date set
10. Delivered to Rig — delivered date set (complete)

Status is never set manually — it follows whichever field was last filled.`,
    chips: ['What is a stale PO?', 'How do I generate a report?'],
  },
  {
    id: 'stale_explain',
    keywords: ['what is stale', 'what is a stale', 'explain stale', 'define stale', 'stale meaning', 'stale mean', 'overdue meaning', 'what does stale', 'meaning of stale', 'what is overdue'],
    answer:
`A "stale" PO is one that has been open for more than 45 days without being delivered:

• It's flagged red in the lists and on the dashboard.
• A daily check (8 AM) emails all C-Suite users plus any extra alert addresses configured in Admin → System Settings.
• The threshold (45 days) is configurable by admins.

Tip: ask me "show me stale POs" to see the current list.`,
    chips: ['Show me stale POs', 'What do the pipeline stages mean?'],
  },
  {
    id: 'dark_mode',
    keywords: ['dark mode', 'light mode', 'theme', 'night mode', 'change theme', 'switch theme'],
    answer:
`To switch between light and dark mode:

• Use the theme toggle (sun/moon icon) in the sidebar — or the top-right corner on the login screen.
• Your choice is remembered on this device.`,
    chips: ['How do I generate a report?'],
  },
  {
    id: 'generate_report',
    keywords: ['report', 'generate report', 'pdf', 'download report', 'export', 'weekly report', 'monthly report', 'quarterly report', 'make a report'],
    answer:
`To generate a PDF report:

1. Go to the Dashboard.
2. Click the "Reports" dropdown (top right).
3. Choose a type — Weekly, Monthly, or Quarterly summary.
4. The PDF is generated and opens automatically.

You can also open any single PO and click "Download PDF" (admin / C-Suite) for a full detail report including line items and change history.`,
    chips: ['What do the pipeline stages mean?'],
  },
]

// ── KB scoring ───────────────────────────────────────────────────────────────
function scoreIntent(norm, tokens, intent) {
  let score = 0
  for (const kw of intent.keywords) {
    if (kw.includes(' ')) {
      if (norm.includes(kw)) score += 1.6          // multi-word phrase hit (strong)
    } else if (tokens.includes(kw)) {
      score += 1                                    // exact word
    } else if (tokens.some(t => fuzzyEq(t, kw))) {
      score += 0.6                                  // fuzzy (typo) word
    }
  }
  return score
}

function bestKBMatch(norm, tokens) {
  let best = null
  for (const intent of KB_INTENTS) {
    const score = scoreIntent(norm, tokens, intent)
    if (!best || score > best.score) best = { intent, score }
  }
  if (!best || best.score === 0) return null
  best.confidence = Math.min(1, best.score / 1.8)
  return best
}

// ── Live-data intent detection ───────────────────────────────────────────────
const RIGS = [
  'Discovery 1 DD', 'Virtue 1 DD', 'Jindal Star DD', 'Jindal Explorer DD',
  'Jindal Pioneer DD', 'Jindal Supreme DD', 'Discovery 1', 'Virtue 1',
  'Jindal Star', 'Jindal Explorer', 'Jindal Pioneer', 'Jindal Supreme',
  'Directional Drilling', 'MLU', 'BKC', 'Taloja', 'Nagothane', 'Nhava',
]

function extractPONumber(norm) {
  const m = norm.match(/\b((?:po|mr)[-\s]?\d{2,4}(?:[-\s]?\d{1,4})?)\b/i)
  return m ? m[1].replace(/[\s-]+/g, '-').toUpperCase() : null
}

function extractRig(norm) {
  // Longest names first so "Discovery 1 DD" wins over "Discovery 1"
  for (const r of RIGS) {
    if (norm.includes(r.toLowerCase())) return r
  }
  return null
}

function detectDataIntent(norm, tokens, ctx) {
  const data = ctx.data || {}
  const user = ctx.user || {}
  const poNum = extractPONumber(norm)

  // PO change history (admin)
  if (poNum && /\b(history|changes|change|audit|log|who\s*changed|edited)\b/.test(norm)) {
    return { confidence: 0.92, run: () => data.poHistory?.(poNum).then(r => formatHistory(r, poNum)) }
  }

  // PO status / lookup (any PO-number mention)
  if (poNum) {
    return { confidence: 0.9, run: () => data.findPO?.(poNum).then(r => formatPO(r, poNum)) }
  }

  // Stale / overdue LIST (but not the "what is stale?" explanation)
  if (/\b(stale|overdue)\b/.test(norm) && !/\b(what|explain|define|meaning|mean|does)\b/.test(norm)) {
    return { confidence: 0.85, run: () => data.listStale?.().then(formatStale) }
  }

  // Count open POs
  if (/\b(how many|number of|count|total)\b/.test(norm) && /\b(open|pending|po|pos|order|orders)\b/.test(norm)) {
    return { confidence: 0.82, run: () => data.countOpen?.().then(formatCount) }
  }

  // Slowest vendor
  if (/\b(slow|slowest|worst|laggard)\b/.test(norm) && /\bvendor/.test(norm)) {
    return { confidence: 0.85, run: () => data.slowestVendor?.().then(formatSlowest) }
  }

  // Pending for a named rig
  const rig = extractRig(norm)
  if (rig && /\b(pending|open|outstanding|waiting|status|show|whats|what is|list)\b/.test(norm)) {
    return { confidence: 0.85, run: () => data.pendingForRig?.(rig).then(r => formatPending(r, rig)) }
  }

  // Generic "what's pending / my open POs" — default to rig user's own rig
  if (/\b(pending|open|outstanding)\b/.test(norm) && /\b(po|pos|order|orders|mine|my|me)\b/.test(norm)) {
    const r = user.role === 'rig' ? user.rig_name : null
    return {
      confidence: 0.68,
      run: () => r ? data.pendingForRig?.(r).then(x => formatPending(x, r))
                   : data.countOpen?.().then(formatCount),
    }
  }

  return null
}

// ── Formatters (turn query results into chat text) ───────────────────────────
function fmtDate(d) {
  if (!d) return '—'
  const dt = new Date(d)
  return isNaN(dt) ? '—' : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatPO(po, poNum) {
  if (!po) return { text: `I couldn't find a PO matching "${poNum}". Double-check the number, or you may not have access to it.`, chips: ['Show me stale POs', 'How many open POs?'] }
  const days = po.days_elapsed ?? '—'
  const overdue = (po.days_elapsed ?? 0) > 45 ? '  ⚠️ OVERDUE' : ''
  return {
    text:
`📦 ${po.po_number || po.mr_number}
• Status: ${po.status || '—'}${overdue}
• Rig / Location: ${po.rig_name || '—'}
• Vendor: ${po.vendor_name || '—'}
• PO Date: ${fmtDate(po.po_date)}
• Days elapsed: ${days}`,
    chips: ['Show me stale POs', 'What do the pipeline stages mean?'],
  }
}

function formatStale(list) {
  if (!list || list.length === 0) return { text: '✅ No stale POs right now — everything is within the 45-day window.', chips: ['How many open POs?'] }
  const lines = list.slice(0, 10).map(p => `• ${p.po_number || p.mr_number} — ${p.rig_name || '—'} — ${p.vendor_name || '—'} (${p.days_elapsed}d)`)
  const more = list.length > 10 ? `\n…and ${list.length - 10} more.` : ''
  return { text: `⚠️ ${list.length} stale PO${list.length > 1 ? 's' : ''} (over 45 days):\n\n${lines.join('\n')}${more}`, chips: ['What is a stale PO?'] }
}

function formatCount(n) {
  return { text: `There ${n === 1 ? 'is' : 'are'} currently ${n ?? 0} open PO${n === 1 ? '' : 's'} (not yet delivered).`, chips: ['Show me stale POs'] }
}

function formatPending(list, rig) {
  if (list === null) return { text: `You can only view data for your own assigned rig.`, chips: ["What's pending for my rig?"] }
  if (!list || list.length === 0) return { text: `✅ Nothing pending for ${rig} — all POs are delivered.`, chips: ['How many open POs?'] }
  const lines = list.slice(0, 10).map(p => `• ${p.po_number || p.mr_number} — ${p.status} (${p.days_elapsed}d)`)
  const more = list.length > 10 ? `\n…and ${list.length - 10} more.` : ''
  return { text: `${list.length} open PO${list.length > 1 ? 's' : ''} for ${rig}:\n\n${lines.join('\n')}${more}`, chips: ['Show me stale POs'] }
}

function formatSlowest(v) {
  if (!v) return { text: `I don't have enough delivered-PO data yet to rank vendors by speed.`, chips: ['How many open POs?'] }
  return { text: `🐢 Slowest vendor by average lead time: ${v.name} — ${v.avg} days on average across ${v.n} delivered PO${v.n > 1 ? 's' : ''}.`, chips: ['Show me stale POs'] }
}

function formatHistory(res, poNum) {
  if (res?.denied) return { text: `Change history is available to admins only.`, chips: ['What do the pipeline stages mean?'] }
  if (!res || !res.po) return { text: `I couldn't find a PO matching "${poNum}".`, chips: ['Show me stale POs'] }
  if (!res.log || res.log.length === 0) return { text: `No change history recorded for ${res.po.po_number}.`, chips: [] }
  const lines = res.log.slice(0, 8).map(l =>
    `• ${fmtDate(l.changed_at)} — ${l.users?.name || 'someone'} changed ${l.field_changed}: "${l.old_value || '—'}" → "${l.new_value || '—'}"`)
  const more = res.log.length > 8 ? `\n…and ${res.log.length - 8} older changes.` : ''
  return { text: `🕓 Change history for ${res.po.po_number}:\n\n${lines.join('\n')}${more}`, chips: [] }
}

// ── Welcome + chips ──────────────────────────────────────────────────────────
export function getWelcome(name) {
  return `Hi ${name || 'there'}! I can help you use the app and check your PO status. Try asking me something or pick a topic below.`
}

export function getWelcomeChips(role) {
  switch (role) {
    case 'purchase':
      return ['How do I create a PO?', 'How do I add multiple items to a PO?', 'How does vendor search work?', 'Show me stale POs']
    case 'logistics':
      return ['What can I edit?', "Why can't I see all DC numbers?", 'How do I update dispatch?', 'Show me stale POs']
    case 'rig':
      return ['How do I mark delivery?', 'What is partial delivery?', "What's pending for my rig?", 'What do the pipeline stages mean?']
    default: // admin, csuite
      return ['Show me stale POs', 'How many open POs?', 'Which vendor is slowest?', 'What do the pipeline stages mean?']
  }
}

function lowConfidenceChips(role) {
  return getWelcomeChips(role).slice(0, 4)
}

// ── MAIN ENTRY ───────────────────────────────────────────────────────────────
export async function getResponse(userMessage, ctx = {}) {
  const norm = normalize(userMessage)
  const tokens = norm.split(' ').filter(Boolean)
  const role = ctx.user?.role

  if (!norm) {
    return { text: "Ask me anything about using JDIL Navigation, or pick a topic below.", chips: lowConfidenceChips(role), confidence: 0, kind: 'empty' }
  }

  const dataIntent = detectDataIntent(norm, tokens, ctx)
  const kb = bestKBMatch(norm, tokens)
  const dataConf = dataIntent?.confidence ?? 0
  const kbConf = kb?.confidence ?? 0

  // Prefer the higher-confidence interpretation
  if (dataIntent && dataConf >= kbConf && dataConf >= CONFIDENCE_MIN) {
    try {
      const res = await dataIntent.run()
      return { ...res, confidence: dataConf, kind: 'data' }
    } catch (e) {
      console.error('[chatbot] data query error:', e)
      return { text: "I couldn't fetch that data right now — please try again in a moment.", chips: lowConfidenceChips(role), confidence: dataConf, kind: 'error' }
    }
  }

  if (kb && kbConf >= CONFIDENCE_MIN) {
    return { text: kb.intent.answer, chips: kb.intent.chips || lowConfidenceChips(role), confidence: kbConf, kind: 'kb' }
  }

  // ── FUTURE AI FALLBACK SEAM ────────────────────────────────────────────────
  // Low confidence: hand off to an AI layer if one is wired up. Adding this later
  // requires NO UI changes — just pass ctx.aiFallback into getResponse().
  if (typeof ctx.aiFallback === 'function') {
    try {
      const ai = await ctx.aiFallback(userMessage, ctx)
      if (ai && ai.text) return { chips: lowConfidenceChips(role), ...ai, confidence: 0.5, kind: 'ai' }
    } catch (e) {
      console.warn('[chatbot] aiFallback failed:', e)
    }
  }

  // ── Generic low-confidence reply ───────────────────────────────────────────
  return {
    text: "I'm not sure I understood that. Here are some topics I can help with — tap one, or try rephrasing:",
    chips: lowConfidenceChips(role),
    confidence: Math.max(dataConf, kbConf),
    kind: 'fallback',
  }
}
