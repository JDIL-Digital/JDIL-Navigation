const { supabase } = require('./supabaseAdmin')
const { sendEmail, reverseLogisticsStaleEmail, renderSummaryEmail } = require('./email')
const { isVendorStale, isLogisticsStale, daysSince, calcStatus } = require('./poHelpers')
const { PINTO, MOORTHY, getRigManager, levelForDays } = require('./constants')

const RL_TERMINAL = new Set(['Delivered to Rig', 'Delivered to Vendor', 'Failed'])

// Flags newly-stale reverse logistics jobs (>threshold past expected return /
// rig dispatch / created date), emails purchase+admin+rig, and notifies in-app.
// (Reverse-logistics staleness is unchanged — it keeps the day-threshold model.)
async function checkStaleRLJobs({ overdueDays, emailEnabled }) {
  try {
    const { data: jobs } = await supabase.from('reverse_logistics_jobs').select('*')
    const active = (jobs || []).filter(j => !RL_TERMINAL.has(j.status))
    if (!active.length) return

    const now = new Date()
    const baseOf   = j => j.expected_return_date || j.rig_dispatch_date || j.created_at
    const daysPast = j => { const b = baseOf(j); return b ? Math.floor((now - new Date(b)) / 86400000) : 0 }
    const newlyStale = active.filter(j => !j.is_stale && baseOf(j) && daysPast(j) > overdueDays)
    if (!newlyStale.length) return

    await Promise.all(newlyStale.map(j =>
      supabase.from('reverse_logistics_jobs').update({ is_stale: true }).eq('id', j.id)))

    if (!emailEnabled) {
      console.log(`RL stale checker: flagged ${newlyStale.length} jobs (emails disabled)`)
      return
    }

    const { data: users } = await supabase
      .from('users').select('id, email, role, rig_name')
      .in('role', ['purchase', 'admin', 'rig']).eq('is_active', true)

    for (const j of newlyStale) {
      const relevant = (users || []).filter(u => u.role !== 'rig' || u.rig_name === j.rig_name)
      const emails = [...new Set(relevant.map(u => u.email).filter(Boolean))]
      if (emails.length) {
        await sendEmail({
          to: emails,
          subject: `Overdue Reverse Logistics — ${j.job_type} ${j.job_number}`,
          html: reverseLogisticsStaleEmail(j, daysPast(j)),
        })
      }
      if (relevant.length) {
        await supabase.from('notifications').insert(relevant.map(u => ({
          user_id: u.id, type: 'overdue',
          title:   `Overdue RL: ${j.job_type} ${j.job_number}`,
          message: `${j.job_number} for ${j.rig_name} is ${daysPast(j)} days past expected return`,
          is_read: false, created_at: now.toISOString(),
        })))
      }
    }
    console.log(`RL stale checker: flagged ${newlyStale.length} reverse logistics jobs`)
  } catch (err) {
    console.error('RL stale checker error:', err)
  }
}


const DEFAULT_OVERDUE_DAYS = 45

/**
 * Reads runtime config from system_settings table.
 * `overdueDays` is only used by the (unchanged) reverse-logistics checker now.
 * `emailEnabled` is the admin-facing second gate on top of ALERTS_ENABLED.
 */
async function loadSettings() {
  try {
    const { data } = await supabase.from('system_settings').select('*')
    if (!data) return { overdueDays: DEFAULT_OVERDUE_DAYS, emailEnabled: true }
    const map = Object.fromEntries(data.map(r => [r.key, r.value]))
    return {
      overdueDays:  Number(map.overdue_threshold_days) || DEFAULT_OVERDUE_DAYS,
      emailEnabled: map.email_notifications_enabled !== false,
    }
  } catch {
    return { overdueDays: DEFAULT_OVERDUE_DAYS, emailEnabled: true }
  }
}

// Per-recipient safety throttle: never send the same summary_type to the same
// recipient twice within this window. Cron runs once daily (9am IST); 20h keeps
// it strictly once/day while tolerating clock drift / manual re-runs.
const THROTTLE_HOURS = 20

function nowIST() {
  return new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  })
}

/**
 * Sends ONE summary email, gated by:
 *  1. ALERTS_ENABLED kill switch — when off, logs what WOULD have been sent
 *  2. alert_send_log per-recipient throttle (same recipient + summary_type
 *     within THROTTLE_HOURS → skip). Fails CLOSED if the log can't be read.
 *  3. TEST_RECIPIENT_OVERRIDE — reroutes all mail to the test inbox; the
 *     ORIGINAL recipient is still logged (console + alert_send_log) so
 *     throttling behaves exactly as in production.
 * Returns 'sent' | 'dry' | 'skip' | 'noop'.
 */
async function dispatchSummary({ recipient, cc, summaryType, label, subject, html, poCount, detail, alertsEnabled }) {
  if (!recipient || !poCount) return 'noop'
  const ccList = (Array.isArray(cc) ? cc : [cc]).filter(Boolean).filter(c => c !== recipient)

  if (!alertsEnabled) {
    console.log(`[ALERTS_DISABLED] Would have sent ${label || summaryType} to ${recipient}${ccList.length ? ` (cc ${ccList.join(', ')})` : ''} with ${poCount} POs across escalation levels${detail ? ` (${detail})` : ''} at ${nowIST()} IST`)
    return 'dry'
  }

  const since = new Date(Date.now() - THROTTLE_HOURS * 3_600_000).toISOString()
  const { data: recent, error: logErr } = await supabase
    .from('alert_send_log')
    .select('id')
    .eq('recipient_email', recipient)
    .eq('summary_type', summaryType)
    .gte('sent_at', since)
    .limit(1)
  if (logErr) {
    console.error(`[alerts] alert_send_log check failed for ${summaryType} → ${recipient} — SKIPPING send (fail-safe):`, logErr.message)
    return 'skip'
  }
  if (recent?.length) {
    console.log(`[alerts] skip ${summaryType} → ${recipient} (already sent within last ${THROTTLE_HOURS}h)`)
    return 'skip'
  }

  const override = process.env.TEST_RECIPIENT_OVERRIDE
  if (override) {
    console.log(`[alerts] TEST_RECIPIENT_OVERRIDE active — ${summaryType} intended for to:[${recipient}]${ccList.length ? ` cc:[${ccList.join(', ')}]` : ''} rerouted to ${override}`)
  }

  await sendEmail({
    to: override || recipient,
    cc: override ? null : ccList,
    subject,
    html,
  })

  const { error: insErr } = await supabase.from('alert_send_log').insert({
    recipient_email: recipient,          // original recipient, even under override
    summary_type:    summaryType,
    po_count:        poCount,
    cron_run_time:   '9am',
  })
  if (insErr) console.error(`[alerts] failed to record ${summaryType} → ${recipient} in alert_send_log:`, insErr.message)
  return 'sent'
}

// Resolve the primary TO + CC list for one overdue PO given its flow + level.
// Rig Managers are NOT CC'd here — they receive their own dedicated per-rig
// summary (see the rig-manager pass in checkStaleOrders).
function resolveRouting(po, flow, level, byTeamCode) {
  const escalated = level === 'concerning' || level === 'serious' // Day 3+
  if (flow === 'vendor') {
    const buyer = po.buyer_code ? byTeamCode.get(po.buyer_code) : null
    if (buyer) return { to: buyer.email, cc: escalated ? [PINTO] : [] }
    return { to: PINTO, cc: [] }   // fallback — buyer missing = already urgent
  }
  // logistics
  const logi = po.logistics_team_code ? byTeamCode.get(po.logistics_team_code) : null
  if (logi) return { to: logi.email, cc: escalated ? [MOORTHY] : [] }
  return { to: MOORTHY, cc: [] }
}

function breakdown(items) {
  const c = { serious: 0, concerning: 0, early: 0 }
  items.forEach(i => { c[i.level]++ })
  return `${c.serious} serious, ${c.concerning} concerning, ${c.early} early`
}

const overdueSubject = n => `JDIL Navigation — ${n} overdue PO${n !== 1 ? 's' : ''} need your attention`

async function checkStaleOrders() {
  try {
    const { overdueDays, emailEnabled } = await loadSettings()

    // Master kill switch — env only, defaults OFF. Admin email toggle is a
    // second gate on top of it.
    const killSwitchOn  = process.env.ALERTS_ENABLED === 'true'
    const alertsEnabled = killSwitchOn && emailEnabled
    if (!killSwitchOn)      console.log('[alerts] ALERTS_ENABLED is not "true" — running in dry-run mode (no emails)')
    else if (!emailEnabled) console.log('[alerts] email notifications disabled in System Settings — running in dry-run mode (no emails)')

    // Reverse logistics staleness runs independently (kill switch applies too).
    await checkStaleRLJobs({ overdueDays, emailEnabled: alertsEnabled })

    const { data: orders } = await supabase.from('po_orders').select('*')
    if (!orders?.length) { console.log('Stale checker: no POs'); return }

    // ── Classify the two flows (day-1+ progressive; grace POs INCLUDED) ────────
    const vendorStale     = orders.filter(isVendorStale)
    const logisticsStale  = orders.filter(isLogisticsStale)
    const vendorIds       = new Set(vendorStale.map(o => o.id))
    const logisticsIds    = new Set(logisticsStale.map(o => o.id))

    // Recompute Dashboard KPI flags for EVERY PO (write only when changed).
    const flagWrites = []
    for (const po of orders) {
      const s  = vendorIds.has(po.id)
      const ds = logisticsIds.has(po.id)
      if (!!po.is_stale !== s || !!po.is_delivery_stale !== ds) {
        flagWrites.push(supabase.from('po_orders')
          .update({ is_stale: s, is_delivery_stale: ds }).eq('id', po.id))
      }
    }
    if (flagWrites.length) await Promise.all(flagWrites)

    // ── Resolve assignees (one users query) ────────────────────────────────────
    const { data: activeUsers } = await supabase
      .from('users').select('email, name, team_code').eq('is_active', true)
    const byTeamCode = new Map()
    for (const u of activeUsers || []) {
      if (u.team_code && u.email && !byTeamCode.has(u.team_code)) byTeamCode.set(u.team_code, u)
    }

    // ── Build per-PO items + group by primary TO ───────────────────────────────
    const groups = new Map() // to -> { items: [{po, daysLate, level}], ccs: Set }
    const addToGroup = (to, cc, item) => {
      let g = groups.get(to)
      if (!g) { g = { items: [], ccs: new Set() }; groups.set(to, g) }
      g.items.push(item)
      cc.forEach(c => { if (c && c !== to) g.ccs.add(c) })
    }

    // POs auto-assigned to ACCOUNTS (unknown/empty BC buyer) are routed silently:
    // skip escalation entirely for them (no buyer/Pinto/Moorthy/rig-manager emails).
    // Dashboard stale flags are still recomputed above — only the emails are suppressed.
    const notAccounts = po => po.buyer_code !== 'ACCOUNTS'

    const vendorItems = vendorStale.filter(notAccounts).map(po => {
      const d = daysSince(po.promised_ready_date)
      return { po, daysLate: d, level: levelForDays(d) }
    })
    const logisticsItems = logisticsStale.filter(notAccounts).map(po => {
      const d = daysSince(po.material_received_date)
      return { po, daysLate: d, level: levelForDays(d) }
    })

    for (const it of vendorItems) {
      const { to, cc } = resolveRouting(it.po, 'vendor', it.level, byTeamCode)
      addToGroup(to, cc, it)
    }
    for (const it of logisticsItems) {
      const { to, cc } = resolveRouting(it.po, 'logistics', it.level, byTeamCode)
      addToGroup(to, cc, it)
    }

    const tally = { sent: 0, dry: 0, skip: 0, noop: 0 }
    const record = outcome => { tally[outcome] = (tally[outcome] || 0) + 1 }

    // ── 1. Per-recipient progressive summaries ─────────────────────────────────
    for (const [to, g] of groups) {
      try {
        record(await dispatchSummary({
          recipient: to, cc: [...g.ccs], summaryType: 'progressive_summary',
          label: 'progressive summary',
          subject: overdueSubject(g.items.length),
          html: renderSummaryEmail(g.items),
          poCount: g.items.length, detail: breakdown(g.items), alertsEnabled,
        }))
      } catch (e) { console.error(`[alerts] progressive_summary → ${to} failed:`, e.message) }
    }

    // ── 2. Pinto master — ALL vendor-side overdue POs ──────────────────────────
    if (vendorItems.length) {
      try {
        record(await dispatchSummary({
          recipient: PINTO, cc: [], summaryType: 'pinto_master',
          label: 'Pinto master summary',
          subject: `JDIL Navigation — Master Summary: ${vendorItems.length} vendor-side overdue PO${vendorItems.length !== 1 ? 's' : ''}`,
          html: renderSummaryEmail(vendorItems),
          poCount: vendorItems.length, detail: breakdown(vendorItems), alertsEnabled,
        }))
      } catch (e) { console.error('[alerts] pinto_master failed:', e.message) }
    }

    // ── 3. Moorthy master — ALL logistics-side overdue POs ─────────────────────
    if (logisticsItems.length) {
      try {
        record(await dispatchSummary({
          recipient: MOORTHY, cc: [], summaryType: 'moorthy_master',
          label: 'Moorthy master summary',
          subject: `JDIL Navigation — Master Summary: ${logisticsItems.length} logistics-side overdue PO${logisticsItems.length !== 1 ? 's' : ''}`,
          html: renderSummaryEmail(logisticsItems),
          poCount: logisticsItems.length, detail: breakdown(logisticsItems), alertsEnabled,
        }))
      } catch (e) { console.error('[alerts] moorthy_master failed:', e.message) }
    }

    // ── 4. Per-rig manager summaries — ONLY that rig's Day-5+ (serious) POs ─────
    //    Groups vendor-side AND logistics-side serious POs for the rig into one
    //    email. Rig managers are never CC'd elsewhere, so this is their only view.
    const rigManagerGroups = new Map() // manager email -> { rigNames: Set, items: [] }
    for (const it of [...vendorItems, ...logisticsItems]) {
      if (it.level !== 'serious') continue
      const mgr = getRigManager(it.po.rig_name)
      if (!mgr) continue // Directional Drilling / MLU / unmapped → skip
      let g = rigManagerGroups.get(mgr)
      if (!g) { g = { rigNames: new Set(), items: [] }; rigManagerGroups.set(mgr, g) }
      g.rigNames.add(it.po.rig_name)
      g.items.push(it)
    }
    for (const [mgr, g] of rigManagerGroups) {
      try {
        const rigLabel = [...g.rigNames].sort().join(', ')
        record(await dispatchSummary({
          recipient: mgr, cc: [], summaryType: 'rig_manager_summary',
          label: `rig manager summary (${rigLabel})`,
          subject: `JDIL Navigation — ${g.items.length} serious overdue PO${g.items.length !== 1 ? 's' : ''} for ${rigLabel}`,
          html: renderSummaryEmail(g.items),
          poCount: g.items.length, detail: breakdown(g.items), alertsEnabled,
        }))
      } catch (e) { console.error(`[alerts] rig_manager_summary → ${mgr} failed:`, e.message) }
    }

    const outcome = [
      `${tally.sent} sent`,
      ...(tally.dry  ? [`${tally.dry} suppressed (ALERTS_ENABLED off)`] : []),
      ...(tally.skip ? [`${tally.skip} skipped (throttled)`] : []),
    ].join(', ')
    console.log(
      `Stale checker (9am IST): ${vendorStale.length} vendor-side overdue, ` +
      `${logisticsStale.length} logistics-side overdue, ${groups.size} recipient group(s), ` +
      `${rigManagerGroups.size} rig-manager summary(ies) — summary emails: ${outcome}`
    )
  } catch (err) {
    console.error('Stale checker error:', err)
  }
}

module.exports = { checkStaleOrders }
