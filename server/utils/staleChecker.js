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
    const stale = orders.filter(o => {
      if (!o.po_date) return false
      const days = Math.floor((now - new Date(o.po_date)) / 86400000)
      return days > overdueDays
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
          message: `${po.po_number} for ${po.rig_name} has been open for ${Math.floor((now - new Date(po.po_date)) / 86400000)} days`,
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
