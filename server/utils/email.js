/**
 * email.js — JDIL Navigation email utility
 * All outbound emails go through sendEmail().
 * Template functions return fully-formed HTML strings.
 */

const nodemailer = require('nodemailer')

const APP_URL = process.env.APP_URL || 'http://localhost:5173'

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
})

// ── Per-recipient throttle: max 10 emails / minute / address ──────────────────
const THROTTLE_WINDOW_MS = 60 * 1000
const THROTTLE_MAX = 10
const _sendLog = new Map() // email -> number[] (timestamps within the window)

function allowRecipient(email) {
  const now = Date.now()
  const arr = (_sendLog.get(email) || []).filter(t => now - t < THROTTLE_WINDOW_MS)
  if (arr.length >= THROTTLE_MAX) {
    _sendLog.set(email, arr)
    return false
  }
  arr.push(now)
  _sendLog.set(email, arr)
  return true
}

/**
 * Core send helper. `to` may be a string or an array of strings.
 * Silently returns null if the recipient list is empty.
 * Recipients over the per-minute throttle are skipped (logged, not thrown).
 */
async function sendEmail({ to, subject, html }) {
  const all = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean)
  const recipients = all.filter(addr => {
    const ok = allowRecipient(addr)
    if (!ok) console.warn(`[email] throttled (>${THROTTLE_MAX}/min): ${addr}`)
    return ok
  })
  if (!recipients.length) return null
  try {
    const info = await transporter.sendMail({
      from: `"JDIL Navigation" <${process.env.EMAIL_USER}>`,
      to:   recipients.join(', '),
      subject,
      html,
    })
    return info
  } catch (err) {
    console.error('[email] sendMail error:', err.message)
    throw err
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Base template helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wraps any body HTML in the standard JDIL branded email shell.
 * @param {string} subtitle  — shown top-right of the green header
 * @param {string} bodyHtml  — inner content between header and footer
 */
function emailBase(subtitle, bodyHtml) {
  const year = new Date().getFullYear()
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>JDIL Navigation</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Inter,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f3f4f6;padding:36px 16px">
  <tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%">

    <!-- ── Header ─────────────────────────────────────────────────────── -->
    <tr><td style="background:linear-gradient(135deg,#1a7a3c 0%,#145f30 100%);border-radius:12px 12px 0 0;padding:26px 30px">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
        <tr>
          <td>
            <p style="margin:0;font-size:21px;font-weight:700;color:#ffffff;letter-spacing:-0.4px;line-height:1.2">JDIL Navigation</p>
            <p style="margin:5px 0 0;font-size:12px;color:rgba(255,255,255,0.72);letter-spacing:0.1px">Jindal Drilling &amp; Industries Ltd &mdash; Material Tracking System</p>
          </td>
          <td align="right" valign="top">
            <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.60);white-space:nowrap;padding-top:3px">${subtitle}</p>
          </td>
        </tr>
      </table>
    </td></tr>

    <!-- ── Body ───────────────────────────────────────────────────────── -->
    <tr><td style="background:#ffffff;padding:30px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb">
      ${bodyHtml}
    </td></tr>

    <!-- ── Footer ─────────────────────────────────────────────────────── -->
    <tr><td style="background:#f9fafb;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:16px 30px">
      <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.7">
        This is an automated message from JDIL Navigation. Do not reply to this email.<br>
        &copy; ${year} Jindal Drilling &amp; Industries Ltd. All rights reserved.
      </p>
    </td></tr>

  </table>
  </td></tr>
</table>
</body>
</html>`
}

/** Renders a two-column label/value row inside a detail table. */
function detailRow(label, value, highlight = false) {
  const display = (value !== null && value !== undefined && value !== '') ? value : '&mdash;'
  return `<tr>
    <td style="padding:9px 14px;font-size:12px;color:#6b7280;background:#f9fafb;border-bottom:1px solid #f3f4f6;width:36%;vertical-align:top;white-space:nowrap">${label}</td>
    <td style="padding:9px 14px;font-size:13px;color:${highlight ? '#15803d' : '#111827'};font-weight:${highlight ? '600' : '400'};border-bottom:1px solid #f3f4f6">${display}</td>
  </tr>`
}

/** Renders a small uppercase section heading. */
function sectionHead(text) {
  return `<p style="margin:22px 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:0.8px;color:#9ca3af;font-weight:600">${text}</p>`
}

/** Formats a date string for Indian locale display. */
function fmtDate(d) {
  if (!d) return null
  try {
    return new Date(d).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    })
  } catch { return d }
}

/** Formats a date+time string. */
function fmtDateTime(d) {
  if (!d) return null
  try {
    return new Date(d).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    })
  } catch { return d }
}

/** Green CTA button */
function ctaButton(label, href, color = '#1a7a3c') {
  return `<a href="${href}" style="display:inline-block;margin-top:22px;background:${color};color:#ffffff;padding:12px 26px;border-radius:7px;text-decoration:none;font-size:13px;font-weight:600;letter-spacing:0.1px">${label} &rarr;</a>`
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. New PO Created
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Sent to all active logistics users when a new PO is created.
 * @param {object} po            — the newly created po_orders row
 * @param {string} createdByName — display name of the creating user
 */
function newPOEmail(po, createdByName = 'System') {
  const body = `
    <p style="margin:0 0 6px;font-size:16px;font-weight:600;color:#111827">A new Purchase Order has been created.</p>
    <p style="margin:0 0 22px;font-size:13px;color:#6b7280">This PO is now ready for logistics processing. Please review the details below.</p>

    ${sectionHead('Purchase Order Details')}
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;border-collapse:collapse">
      ${detailRow('PO Number',           po.po_number,          true)}
      ${detailRow('MR Number',           po.mr_number)}
      ${detailRow('Rig Name',            po.rig_name)}
      ${detailRow('Vendor',              po.vendor_name)}
      ${detailRow('Material',            po.material_description)}
      ${detailRow('Buyer Code',          po.buyer_code)}
      ${detailRow('Promised Ready Date', fmtDate(po.promised_ready_date))}
      ${detailRow('Created By',          createdByName)}
      ${detailRow('Created At',          fmtDateTime(new Date().toISOString()))}
    </table>

    ${ctaButton('Open PO in JDIL Navigation', APP_URL)}
  `
  return emailBase('New PO Notification', body)
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. PO Status Changed
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Sent to the relevant next team when a pipeline stage transition occurs.
 * @param {object} po            — the updated po_orders row
 * @param {string} oldStatus     — previous calcStatus() value
 * @param {string} newStatus     — new calcStatus() value
 * @param {string} updatedByName — display name of the editing user
 */
function statusChangedEmail(po, oldStatus, newStatus, updatedByName = 'System') {
  const isRig = ['In Transit to Rig', 'Delivered to Rig'].includes(newStatus)
  const arrowColor = isRig ? '#2563eb' : '#15803d'

  const body = `
    <p style="margin:0 0 20px;font-size:16px;font-weight:600;color:#111827">A Purchase Order status has been updated.</p>

    <!-- Status transition banner -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;margin-bottom:22px">
      <tr>
        <td style="padding:16px 20px;text-align:center">
          <p style="margin:0;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.6px">Previous Status</p>
          <p style="margin:5px 0 0;font-size:14px;font-weight:600;color:#374151">${oldStatus}</p>
        </td>
        <td style="padding:16px 4px;text-align:center;font-size:22px;color:#9ca3af;font-weight:300">&rarr;</td>
        <td style="padding:16px 20px;text-align:center">
          <p style="margin:0;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.6px">New Status</p>
          <p style="margin:5px 0 0;font-size:15px;font-weight:700;color:${arrowColor}">${newStatus}</p>
        </td>
      </tr>
    </table>

    ${sectionHead('Purchase Order Details')}
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;border-collapse:collapse">
      ${detailRow('PO Number',   po.po_number, true)}
      ${detailRow('Rig Name',    po.rig_name)}
      ${detailRow('Vendor',      po.vendor_name)}
      ${detailRow('Material',    po.material_description)}
      ${detailRow('Updated By',  updatedByName)}
      ${detailRow('Updated At',  fmtDateTime(new Date().toISOString()))}
    </table>

    ${ctaButton('View PO in JDIL Navigation', APP_URL)}
  `
  return emailBase('PO Status Update', body)
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Stale / Overdue Alert
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Sent to csuite + alert_emails when the daily stale checker runs.
 * @param {object[]} pos        — array of stale po_orders rows
 * @param {number}  overdueDays — the configured threshold (default 45)
 */
function staleAlertEmail(pos, overdueDays = 45) {
  const rows = pos.map(po => {
    const base = po.promised_ready_date || po.po_date
    const days = base ? Math.floor((Date.now() - new Date(base).getTime()) / 86400000) : 0
    return `<tr>
      <td style="padding:10px 14px;border-bottom:1px solid #fee2e2;font-size:13px;font-weight:600;color:#111827">${po.po_number || '&mdash;'}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #fee2e2;font-size:13px;color:#374151">${po.rig_name || '&mdash;'}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #fee2e2;font-size:13px;color:#374151">${po.vendor_name || '&mdash;'}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #fee2e2;font-size:13px;color:#374151">${po.status || '&mdash;'}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #fee2e2;font-size:13px;font-weight:700;color:#dc2626;text-align:center">${days}d</td>
    </tr>`
  }).join('')

  const body = `
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:14px 18px;margin-bottom:22px">
      <p style="margin:0;font-size:14px;color:#991b1b;line-height:1.5">
        &#9888;&#65039; <strong>${pos.length} Purchase Order${pos.length !== 1 ? 's are' : ' is'} more than <span style="color:#dc2626">${overdueDays} days past the promised ready date</span> and require${pos.length === 1 ? 's' : ''} immediate attention.</strong>
      </p>
    </div>

    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #fecaca;border-radius:8px;overflow:hidden;border-collapse:collapse">
      <thead>
        <tr style="background:#fee2e2">
          <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#7f1d1d;font-weight:600">PO Number</th>
          <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#7f1d1d;font-weight:600">Rig</th>
          <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#7f1d1d;font-weight:600">Vendor</th>
          <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#7f1d1d;font-weight:600">Current Status</th>
          <th style="padding:10px 14px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#7f1d1d;font-weight:600">Days Past Promised</th>
        </tr>
      </thead>
      <tbody style="background:#ffffff">${rows}</tbody>
    </table>

    ${ctaButton('Review Stale POs in JDIL Navigation', APP_URL, '#dc2626')}
  `
  return emailBase('&#9888;&#65039; Overdue PO Alert', body)
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Account Approved
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Sent directly to the newly approved user.
 * @param {object} user — the users row (name, email, role, team_code, rig_name)
 */
function accountApprovedEmail(user) {
  const roleLabel = user.role
    ? user.role.charAt(0).toUpperCase() + user.role.slice(1)
    : null

  const loginUrl = 'https://jdil-navigation.replit.app/login'

  const body = `
    <p style="margin:0 0 4px;font-size:22px;font-weight:700;color:#166534">Your JDIL Navigation account has been approved!</p>
    <p style="margin:8px 0 22px;font-size:13px;color:#6b7280">Hi ${user.name || 'there'}, welcome to JDIL Navigation.</p>

    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px 20px;margin-bottom:22px">
      <p style="margin:0;font-size:14px;color:#166534;line-height:1.5">
        &#10003; Your account has been <strong>approved</strong> by an administrator. You now have full access to the system based on your assigned role.
      </p>
    </div>

    ${sectionHead('Your Account Details')}
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;border-collapse:collapse">
      ${detailRow('Name',         user.name)}
      ${detailRow('Email',        user.email)}
      ${detailRow('Role',         roleLabel, true)}
      ${user.team_code ? detailRow('Team Code',    user.team_code) : ''}
      ${user.rig_name  ? detailRow('Assigned Rig', user.rig_name)  : ''}
    </table>

    <p style="margin:24px 0 6px;font-size:14px;color:#374151;font-weight:500">Click the button below to login to JDIL Navigation:</p>
    ${ctaButton('Login to JDIL Navigation', loginUrl)}

    <p style="margin:18px 0 0;font-size:12px;color:#9ca3af">
      Or copy this link into your browser:<br>
      <a href="${loginUrl}" style="color:#1a7a3c">${loginUrl}</a>
    </p>
  `
  return emailBase('Account Approved ✓', body)
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. New User Registration (notify admins)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Sent to all active admin users when someone registers.
 * @param {object} user — { name, email, role, team_code, rig_name }
 */
function newRegistrationEmail(user) {
  const roleLabel = user.role
    ? user.role.charAt(0).toUpperCase() + user.role.slice(1)
    : null

  const body = `
    <p style="margin:0 0 6px;font-size:16px;font-weight:600;color:#111827">A new user has registered and is awaiting approval.</p>
    <p style="margin:0 0 22px;font-size:13px;color:#6b7280">Please review the registration details below and approve or reject the account from the Admin Panel.</p>

    ${sectionHead('Registration Details')}
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;border-collapse:collapse">
      ${detailRow('Full Name',       user.name)}
      ${detailRow('Email',           user.email)}
      ${detailRow('Requested Role',  roleLabel)}
      ${user.team_code ? detailRow('Team Code',    user.team_code) : ''}
      ${user.rig_name  ? detailRow('Assigned Rig', user.rig_name)  : ''}
      ${detailRow('Registered At',   fmtDateTime(new Date().toISOString()))}
    </table>

    ${ctaButton('Review in Admin Panel', `${APP_URL}/admin`)}
  `
  return emailBase('New User Registration', body)
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Partial Delivery Alert (line item)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Sent to rig users for the PO's rig + all purchase users when a line item
 * is partially delivered (delivered < ordered).
 * @param {object} po   — the parent po_orders row
 * @param {object} item — the updated po_line_items row
 */
function partialDeliveryEmail(po, item) {
  const ordered   = Number(item.quantity_ordered)   || 0
  const delivered = Number(item.quantity_delivered)  || 0
  const pending   = Math.max(0, ordered - delivered)
  const unit      = item.unit ? ` ${item.unit}` : ''

  const body = `
    <p style="margin:0 0 20px;font-size:16px;font-weight:600;color:#111827">A line item has been partially delivered.</p>

    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:16px 20px;margin-bottom:22px">
      <p style="margin:0;font-size:14px;color:#92400e;line-height:1.6">
        Item <strong>${item.item_name}</strong>: <strong style="color:#b45309">${delivered}${unit}</strong> of
        <strong>${ordered}${unit}</strong> delivered.
        <strong style="color:#dc2626">${pending}${unit} pending.</strong><br>
        Rig: <strong>${po.rig_name || '—'}</strong>
      </p>
    </div>

    ${sectionHead('Line Item Details')}
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;border-collapse:collapse">
      ${detailRow('PO Number',          po.po_number, true)}
      ${detailRow('Rig / Location',     po.rig_name)}
      ${detailRow('Item Name',          item.item_name)}
      ${detailRow('Material',           item.material_description)}
      ${detailRow('Quantity Ordered',   `${ordered}${unit}`)}
      ${detailRow('Quantity Delivered', `${delivered}${unit}`, true)}
      ${detailRow('Quantity Pending',   `${pending}${unit}`)}
      ${detailRow('Updated At',         fmtDateTime(new Date().toISOString()))}
    </table>

    ${ctaButton('View PO in JDIL Navigation', APP_URL)}
  `
  return emailBase('Partial Delivery Alert', body)
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Overdue Reverse Logistics job
// ─────────────────────────────────────────────────────────────────────────────
function reverseLogisticsStaleEmail(job, days) {
  const body = `
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:14px 18px;margin-bottom:22px">
      <p style="margin:0;font-size:14px;color:#991b1b;line-height:1.5">
        &#9888;&#65039; Job <strong>${job.job_number}</strong> for <strong>${job.rig_name}</strong> is
        <strong style="color:#dc2626">${days} days past its expected return date</strong>.
        Vendor: <strong>${job.vendor_name || '—'}</strong>. Please follow up.
      </p>
    </div>

    ${sectionHead('Reverse Logistics Job')}
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;border-collapse:collapse">
      ${detailRow('Job Type',             job.job_type, true)}
      ${detailRow('Job Number',           job.job_number)}
      ${detailRow('Rig / Location',       job.rig_name)}
      ${detailRow('Vendor',               job.vendor_name)}
      ${detailRow('Rig Dispatch Date',    fmtDate(job.rig_dispatch_date))}
      ${detailRow('Expected Return Date', fmtDate(job.expected_return_date))}
      ${detailRow('Current Status',       job.status)}
    </table>

    ${ctaButton('Review in JDIL Navigation', `${APP_URL}/reverse-logistics`, '#dc2626')}
  `
  return emailBase('&#9888;&#65039; Overdue Reverse Logistics', body)
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  sendEmail,
  newPOEmail,
  statusChangedEmail,
  staleAlertEmail,
  accountApprovedEmail,
  newRegistrationEmail,
  partialDeliveryEmail,
  reverseLogisticsStaleEmail,
}
