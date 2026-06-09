const { supabase } = require('./supabaseAdmin')
const { sendEmail, staleAlertEmail } = require('./email')


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
