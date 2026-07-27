const { supabase } = require('./supabaseAdmin')
const { sendEmail, staleAlertEmail, reverseLogisticsStaleEmail } = require('./email')

const RL_TERMINAL = new Set(['Delivered to Rig', 'Delivered to Vendor', 'Failed'])

// Flags newly-stale reverse logistics jobs (>threshold past expected return /
// rig dispatch / created date), emails purchase+admin+rig, and notifies in-app.
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

    // Recipients: all active purchase + admin, plus rig users for that rig.
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
 * Falls back to hardcoded defaults if the table doesn't exist yet.
 */
async function loadSettings() {
  try {
    const { data } = await supabase.from('system_settings').select('*')
    if (!data) return { overdueDays: DEFAULT_OVERDUE_DAYS, alertEmails: [], emailEnabled: true }
    const map = Object.fromEntries(data.map(r => [r.key, r.value]))
    return {
      overdueDays:  Number(map.overdue_threshold_days)      || DEFAULT_OVERDUE_DAYS,
      alertEmails:  Array.isArray(map.alert_emails) ? map.alert_emails : [],
      emailEnabled: map.email_notifications_enabled !== false,
    }
  } catch {
    return { overdueDays: DEFAULT_OVERDUE_DAYS, alertEmails: [], emailEnabled: true }
  }
}

const PURCHASE_STAGES  = new Set(['MR Created', 'PO Released', 'Buyer Assigned', 'Vendor Confirmed'])
const LOGISTICS_STAGES = new Set(['At JDIL Location', 'Dispatched from JDIL', 'In Transit to JDIL', 'In Transit to Rig'])
const MINGUEL = 'minguel.pinto@jindalmumbai.com'
const MOORTHY = 'moorthy@jindalmumbai.com'

function hoursSince(ts) {
  if (!ts) return Infinity
  return (Date.now() - new Date(ts).getTime()) / 3_600_000
}
async function userByTeamCode(code) {
  if (!code) return null
  const { data } = await supabase
    .from('users').select('email, name').eq('team_code', code).eq('is_active', true).limit(1)
  return data && data[0] ? data[0] : null
}

async function checkStaleOrders() {
  try {
    const { overdueDays, emailEnabled } = await loadSettings()

    // Is this the 9am IST run? (buyer escalation is once-daily, on the 9am run)
    const istHour = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }))
    const is9amRun = istHour === 9

    // Reverse logistics staleness runs independently.
    await checkStaleRLJobs({ overdueDays, emailEnabled })

    const { data: orders } = await supabase.from('po_orders').select('*')
    if (!orders?.length) return

    const baseDate = o => o.promised_ready_date || o.po_date
    const daysPast = o => { const b = baseDate(o); return b ? Math.floor((Date.now() - new Date(b).getTime()) / 86400000) : 0 }

    const { overduePurchaseEmail, delayedDeliveryEmail } = require('./email')
    let purchaseAlerts = 0, deliveryAlerts = 0

    for (const po of orders) {
      const status = po.status
      const overdue = baseDate(po) && daysPast(po) > overdueDays

      // ── PATH 1 — purchase-stuck ─────────────────────────────────────────────
      if (PURCHASE_STAGES.has(status)) {
        if (!overdue) continue
        if (!po.is_stale) await supabase.from('po_orders').update({ is_stale: true }).eq('id', po.id)
        if (!emailEnabled) continue
        try {
          const buyer = await userByTeamCode(po.buyer_code)
          let to, cc, throttleH, gated
          if (buyer) {
            to = buyer.email; cc = MINGUEL; throttleH = 20; gated = is9amRun   // once/day on the 9am run
          } else {
            to = MINGUEL; cc = null; throttleH = 3; gated = true               // 3x/day
          }
          if (gated && hoursSince(po.last_stale_alert_sent) >= throttleH) {
            await sendEmail({ to, cc, subject: `Overdue Purchase Order — ${po.po_number}`, html: overduePurchaseEmail(po, buyer?.name, daysPast(po)) })
            await supabase.from('po_orders').update({ last_stale_alert_sent: new Date().toISOString() }).eq('id', po.id)
            purchaseAlerts++
          }
        } catch (e) { console.error(`[stale] purchase alert failed for ${po.po_number}:`, e.message) }
        continue
      }

      // ── PATH 2 — logistics-stuck ────────────────────────────────────────────
      if (LOGISTICS_STAGES.has(status) && !po.delivered_to_rig_date) {
        if (!overdue) continue
        if (!po.is_delivery_stale) await supabase.from('po_orders').update({ is_delivery_stale: true }).eq('id', po.id)
        if (!emailEnabled) continue
        try {
          const logi = await userByTeamCode(po.logistics_team_code)
          const to = logi ? logi.email : MOORTHY
          const cc = logi ? MOORTHY : null
          if (hoursSince(po.last_delivery_stale_alert_sent) >= 3) {   // 3x/day
            await sendEmail({ to, cc, subject: `Delayed Delivery — ${po.po_number} stuck at ${status}`, html: delayedDeliveryEmail(po, daysPast(po)) })
            await supabase.from('po_orders').update({ last_delivery_stale_alert_sent: new Date().toISOString() }).eq('id', po.id)
            deliveryAlerts++
          }
        } catch (e) { console.error(`[stale] delivery alert failed for ${po.po_number}:`, e.message) }
        continue
      }
      // Delivered or otherwise not stuck → nothing to do (clearing handled in PATCH).
    }

    console.log(`Stale checker (${is9amRun ? '9am' : istHour + ':00'} IST): ${purchaseAlerts} purchase alerts, ${deliveryAlerts} delivery alerts`)
  } catch (err) {
    console.error('Stale checker error:', err)
  }
}

module.exports = { checkStaleOrders }
