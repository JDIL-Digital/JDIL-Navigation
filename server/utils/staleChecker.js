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

async function checkStaleOrders() {
  try {
    const { overdueDays, alertEmails, emailEnabled } = await loadSettings()

    // Reverse logistics staleness runs independently of PO early-returns below.
    await checkStaleRLJobs({ overdueDays, emailEnabled })

    const { data: orders } = await supabase
      .from('po_orders')
      .select('*')
      .neq('status', 'Delivered to Rig')

    if (!orders?.length) return

    const now = new Date()
    // Overdue is measured from promised_ready_date; fall back to po_date if absent.
    const baseDate = o => o.promised_ready_date || o.po_date
    const daysPastBase = o => {
      const base = baseDate(o)
      return base ? Math.floor((now - new Date(base)) / 86400000) : 0
    }
    const stale = orders.filter(o => {
      if (!baseDate(o)) return false
      return daysPastBase(o) > overdueDays
    })

    if (!stale.length) return

    // Update is_stale flag
    await Promise.all(stale.map(o =>
      supabase.from('po_orders').update({ is_stale: true }).eq('id', o.id)
    ))

    if (!emailEnabled) {
      console.log(`Stale checker: flagged ${stale.length} POs (email notifications disabled)`)
      return
    }

    // Get csuite email recipients
    const { data: csuiteUsers } = await supabase
      .from('users')
      .select('email')
      .eq('role', 'csuite')
      .eq('is_active', true)

    const recipients = [
      ...alertEmails,
      ...(csuiteUsers?.map(u => u.email) || []),
    ]

    await sendEmail({
      to: [...new Set(recipients)],
      subject: `⚠️ JDIL Navigation: ${stale.length} Stale PO${stale.length > 1 ? 's' : ''} — Action Required`,
      html: staleAlertEmail(stale, overdueDays),
    })

    // Create in-app notifications
    const notifs = []
    for (const po of stale) {
      const { data: allUsers } = await supabase
        .from('users')
        .select('id')
        .in('role', ['admin', 'csuite'])
        .eq('is_active', true)

      if (allUsers) {
        notifs.push(...allUsers.map(u => ({
          user_id: u.id,
          type: 'overdue',
          title: `Stale PO: ${po.po_number}`,
          message: `${po.po_number} for ${po.rig_name} is ${daysPastBase(po)} days past its promised ready date`,
          is_read: false,
          created_at: now.toISOString(),
        })))
      }
    }
    if (notifs.length) await supabase.from('notifications').insert(notifs)

    console.log(`Stale checker: flagged ${stale.length} POs, notified ${recipients.length} recipients`)
  } catch (err) {
    console.error('Stale checker error:', err)
  }
}

module.exports = { checkStaleOrders }
