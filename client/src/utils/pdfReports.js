/**
 * JDIL Navigation — PDF Report Generator
 * Produces 4 report types using jsPDF + jspdf-autotable.
 * Every report opens in a new browser tab (preview + download).
 * Charts are drawn as pure PDF vector graphics (no canvas / html2canvas).
 */

import jsPDF from 'jspdf'
import 'jspdf-autotable'
import JindalLogoUrl from '../assets/Jindal_Logo.jpg'
import { calcStatus, daysElapsed, formatDate } from './helpers'
import { PO_STATUSES } from './constants'

// ── Design constants ──────────────────────────────────────────────────────────
const GREEN    = [26, 122, 60]
const SLATE    = [71, 85, 105]
const HEADER_H = 28           // mm — green bar height
const MARGIN   = 10           // mm — page left/right margin
const MONTHS   = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December']

// Short stage names for pipeline visual (must stay index-aligned with PO_STATUSES — 9 stages)
const STAGE_ABBR = [
  'MR', 'PO', 'Buyer', 'Conf', 'At JDIL',
  'Disp JDIL', 'JDIL Transit', 'Rig Transit', 'Delivered',
]

// Bar-chart labels (even shorter — must fit in ~7 mm)
const STAGE_BAR_LABEL = ['MR', 'PO', 'Buyer', 'Conf', 'AtJDIL', 'DispJDIL', 'J-Tran', 'R-Tran', 'Deliv']

// Donut colour palette (RGB arrays — matches dashboard hex colours exactly)
const DONUT_COLORS = {
  delivered:   [22, 163, 74],
  inTransit:   [59, 130, 246],
  atJDIL:      [249, 115, 22],
  readyVendor: [234, 179, 8],
  stale:       [239, 68, 68],
  other:       [156, 163, 175],
}

// ── Logo loader — fetches once, caches, returns natural dimensions ─────────────
let _logoCache = null   // { base64, w, h }

async function getLogoData() {
  if (_logoCache) return _logoCache
  try {
    const resp  = await fetch(JindalLogoUrl)
    const blob  = await resp.blob()
    const base64 = await new Promise(res => {
      const reader = new FileReader()
      reader.onloadend = () => res(reader.result)
      reader.readAsDataURL(blob)
    })
    const dims = await new Promise(res => {
      const img = new Image()
      img.onload  = () => res({ w: img.naturalWidth, h: img.naturalHeight })
      img.onerror = () => res({ w: 1, h: 1 })
      img.src = base64
    })
    _logoCache = { base64, ...dims }
    return _logoCache
  } catch {
    return null
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  SHARED DRAWING HELPERS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Draws the green header bar on the current page.
 * Logo height is fixed at ~17 mm; width scales to maintain original aspect ratio.
 * Returns the y-coordinate where content should begin.
 */
function drawHeader(doc, reportTitle, subtitle, logoData) {
  const pageW = doc.internal.pageSize.getWidth()

  doc.setFillColor(...GREEN)
  doc.rect(0, 0, pageW, HEADER_H, 'F')

  // ── Logo (fixed height, proportional width, padded) ──
  let textStartX = 12
  if (logoData?.base64) {
    try {
      const LOGO_H   = 18                                   // mm fixed height
      const LOGO_PAD = 4                                    // mm top/bottom padding → centred in bar
      const logoW    = Math.round((logoData.w / logoData.h) * LOGO_H)
      const logoY    = (HEADER_H - LOGO_H) / 2
      doc.addImage(logoData.base64, 'JPEG', MARGIN, logoY, logoW, LOGO_H)
      textStartX = MARGIN + logoW + 5
    } catch { /* logo unavailable — fall through */ }
  }

  // ── Left block: company name ──
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text('JDIL Navigation', textStartX, 13)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.text('Material Tracking System  ·  Jindal Drilling & Industries Ltd.', textStartX, 20)

  // ── Right block: report title + generated time ──
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text(reportTitle, pageW - MARGIN, 12, { align: 'right' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  const now    = new Date()
  const genStr = `Generated: ${now.toLocaleDateString('en-IN')} ${now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
  doc.text(genStr, pageW - MARGIN, 19, { align: 'right' })
  if (subtitle) doc.text(subtitle, pageW - MARGIN, 25, { align: 'right' })

  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'normal')
  return HEADER_H + 7   // content start y
}

/** Adds footer (confidential + page numbers) to ALL pages. Call last. */
function addFooters(doc) {
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const fy    = pageH - 5
  const n     = doc.internal.getNumberOfPages()
  for (let i = 1; i <= n; i++) {
    doc.setPage(i)
    doc.setFontSize(7)
    doc.setTextColor(160, 160, 160)
    doc.text('Confidential — Jindal Drilling & Industries Ltd.', MARGIN, fy)
    doc.text(`Page ${i} of ${n}`, pageW / 2, fy, { align: 'center' })
    doc.text('JDIL Navigation', pageW - MARGIN, fy, { align: 'right' })
  }
  doc.setTextColor(0, 0, 0)
}

/** Gray section bar with green left accent. Returns y after the bar. */
function sectionTitle(doc, text, y) {
  const pageW = doc.internal.pageSize.getWidth()
  doc.setFillColor(241, 245, 249)
  doc.rect(MARGIN, y, pageW - 2 * MARGIN, 8, 'F')
  doc.setFillColor(...GREEN)
  doc.rect(MARGIN, y, 3, 8, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(30, 41, 59)
  doc.text(text, MARGIN + 6, y + 5.5)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(0, 0, 0)
  return y + 12
}

/** Row of coloured KPI cards. Each kpi: { label, value, sub?, color? } */
function drawKPIs(doc, kpis, y) {
  const pageW = doc.internal.pageSize.getWidth()
  const n     = kpis.length
  const gap   = 3
  const boxW  = (pageW - 2 * MARGIN - gap * (n - 1)) / n
  const boxH  = 24

  kpis.forEach(({ label, value, sub, color = GREEN }, i) => {
    const x = MARGIN + i * (boxW + gap)
    doc.setFillColor(248, 252, 249)
    doc.rect(x, y, boxW, boxH, 'F')
    doc.setFillColor(...color)
    doc.rect(x, y, boxW, 2.5, 'F')
    doc.setDrawColor(220, 225, 220)
    doc.rect(x, y, boxW, boxH, 'S')

    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(110, 115, 110)
    doc.text(label, x + boxW / 2, y + 9, { align: 'center' })

    doc.setFontSize(16)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...color)
    doc.text(String(value), x + boxW / 2, y + 18, { align: 'center' })

    if (sub) {
      doc.setFontSize(6)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(140, 140, 140)
      doc.text(sub, x + boxW / 2, y + 22.5, { align: 'center' })
    }
  })

  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'normal')
  doc.setDrawColor(0, 0, 0)
  return y + boxH + 5
}

/**
 * 10-stage pipeline progress bar.
 * Returns y after the bar + label.
 */
function drawPipeline(doc, status, y) {
  const pageW    = doc.internal.pageSize.getWidth()
  const currentIdx = PO_STATUSES.indexOf(status)
  const n   = 10
  const gap = 1
  const boxW = (pageW - 2 * MARGIN - gap * (n - 1)) / n
  const boxH = 13

  PO_STATUSES.forEach((_, i) => {
    const x = MARGIN + i * (boxW + gap)
    if (i === currentIdx)     doc.setFillColor(...GREEN)
    else if (i < currentIdx)  doc.setFillColor(187, 247, 208)
    else                      doc.setFillColor(229, 231, 235)
    doc.rect(x, y, boxW, boxH, 'F')

    doc.setFontSize(4.5)
    doc.setFont('helvetica', i === currentIdx ? 'bold' : 'normal')
    doc.setTextColor(i === currentIdx ? 255 : (i < currentIdx ? 22 : 107),
                     i === currentIdx ? 255 : (i < currentIdx ? 101 : 114),
                     i === currentIdx ? 255 : (i < currentIdx ? 52 : 128))
    doc.text(STAGE_ABBR[i] || '', x + boxW / 2, y + boxH / 2 + 1.5, { align: 'center' })
  })

  doc.setFontSize(6)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(120, 120, 120)
  doc.text(`Stage ${currentIdx + 1} of ${n}: ${status}`, doc.internal.pageSize.getWidth() / 2, y + boxH + 5, { align: 'center' })
  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'normal')
  return y + boxH + 10
}

/** Saves the PDF to disk with the given filename (native browser download). */
function openPDF(doc, filename) {
  doc.save(filename)
}

// ══════════════════════════════════════════════════════════════════════════════
//  CHART DRAWING — pure jsPDF vector primitives
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Draws a vertical bar chart inside the bounding box (x, y, w, h).
 * data: [{ name: string, value: number }]
 */
function drawBarChartPDF(doc, data, x, y, w, h, title) {
  if (!data.length) return

  const maxVal = Math.max(...data.map(d => d.value), 1)
  const padL = 12, padR = 3, padT = 10, padB = 12
  const plotW = w - padL - padR
  const plotH = h - padT - padB
  const barGap = plotW / data.length
  const barW   = barGap * 0.65

  // Title
  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(71, 85, 105)
  doc.text(title, x + w / 2, y + padT - 2, { align: 'center' })

  // Light horizontal grid lines
  doc.setDrawColor(235, 237, 240)
  doc.setLineWidth(0.25)
  for (let i = 1; i <= 4; i++) {
    const gy = y + padT + plotH - (plotH / 4) * i
    doc.line(x + padL, gy, x + padL + plotW, gy)
  }

  // Axes
  doc.setDrawColor(180, 185, 190)
  doc.setLineWidth(0.4)
  doc.line(x + padL, y + padT, x + padL, y + padT + plotH)           // Y-axis
  doc.line(x + padL, y + padT + plotH, x + padL + plotW, y + padT + plotH) // X-axis

  // Y-axis labels
  doc.setFontSize(5)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(140, 140, 140)
  doc.text('0', x + padL - 1.5, y + padT + plotH + 0.5, { align: 'right' })
  doc.text(String(maxVal), x + padL - 1.5, y + padT + 2, { align: 'right' })

  // Bars
  data.forEach((d, i) => {
    const bh = d.value > 0 ? (d.value / maxVal) * plotH : 0
    const bx = x + padL + i * barGap + (barGap - barW) / 2
    const by = y + padT + plotH - bh

    doc.setFillColor(d.value > 0 ? GREEN[0] : 210, d.value > 0 ? GREEN[1] : 214, d.value > 0 ? GREEN[2] : 219)
    if (bh > 0) doc.rect(bx, by, barW, bh, 'F')

    // Value on top of bar
    if (d.value > 0) {
      doc.setFontSize(4.5)
      doc.setTextColor(...GREEN)
      doc.text(String(d.value), bx + barW / 2, by - 0.8, { align: 'center' })
    }

    // X-axis label
    doc.setFontSize(4)
    doc.setTextColor(100, 105, 115)
    doc.text(d.name || '', bx + barW / 2, y + padT + plotH + 4, { align: 'center' })
  })

  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'normal')
  doc.setLineWidth(0.2)
  doc.setDrawColor(0, 0, 0)
}

/**
 * Draws a line chart inside the bounding box (x, y, w, h).
 * data: [{ name: string, value: number }]
 */
function drawLineChartPDF(doc, data, x, y, w, h, title) {
  if (data.length < 2) return

  const maxVal = Math.max(...data.map(d => d.value), 1)
  const padL = 12, padR = 3, padT = 10, padB = 10
  const plotW = w - padL - padR
  const plotH = h - padT - padB

  // Title
  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(71, 85, 105)
  doc.text(title, x + w / 2, y + padT - 2, { align: 'center' })

  // Horizontal grid lines
  doc.setDrawColor(235, 237, 240)
  doc.setLineWidth(0.25)
  for (let i = 0; i <= 4; i++) {
    const gy = y + padT + plotH - (plotH / 4) * i
    doc.line(x + padL, gy, x + padL + plotW, gy)
  }

  // Axes
  doc.setDrawColor(180, 185, 190)
  doc.setLineWidth(0.4)
  doc.line(x + padL, y + padT, x + padL, y + padT + plotH)
  doc.line(x + padL, y + padT + plotH, x + padL + plotW, y + padT + plotH)

  // Y-axis labels
  doc.setFontSize(5)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(140, 140, 140)
  doc.text('0', x + padL - 1.5, y + padT + plotH + 0.5, { align: 'right' })
  doc.text(String(maxVal), x + padL - 1.5, y + padT + 2, { align: 'right' })

  // Compute point positions
  const stepX  = plotW / (data.length - 1)
  const points = data.map((d, i) => ({
    px: x + padL + i * stepX,
    py: y + padT + plotH - (maxVal > 0 ? (d.value / maxVal) * plotH : 0),
  }))

  // Line segments
  doc.setDrawColor(...GREEN)
  doc.setLineWidth(1)
  for (let i = 0; i < points.length - 1; i++) {
    doc.line(points[i].px, points[i].py, points[i + 1].px, points[i + 1].py)
  }

  // Data-point dots
  doc.setFillColor(...GREEN)
  points.forEach(p => doc.circle(p.px, p.py, 0.9, 'F'))

  // X-axis labels (every other point if 8+)
  const step = data.length >= 8 ? 2 : 1
  data.forEach((d, i) => {
    if (i % step !== 0 && i !== data.length - 1) return
    doc.setFontSize(4)
    doc.setTextColor(100, 105, 115)
    doc.text(String(d.name), points[i].px, y + padT + plotH + 4, { align: 'center' })
  })

  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'normal')
  doc.setLineWidth(0.2)
  doc.setDrawColor(0, 0, 0)
}

/**
 * Draws a single pie slice as a triangle fan (arc approximation).
 * startDeg / endDeg in degrees, 0 = top, clockwise.
 */
function drawPieSlice(doc, cx, cy, r, startDeg, endDeg, color) {
  if (endDeg - startDeg < 0.5) return
  const steps = Math.max(4, Math.ceil((endDeg - startDeg) / 4))
  doc.setFillColor(...color)
  doc.setDrawColor(255, 255, 255)
  doc.setLineWidth(0.5)
  for (let i = 0; i < steps; i++) {
    const a1 = ((startDeg + (endDeg - startDeg) * i / steps) - 90) * Math.PI / 180
    const a2 = ((startDeg + (endDeg - startDeg) * (i + 1) / steps) - 90) * Math.PI / 180
    doc.triangle(
      cx,                       cy,
      cx + r * Math.cos(a1),    cy + r * Math.sin(a1),
      cx + r * Math.cos(a2),    cy + r * Math.sin(a2),
      'FD'
    )
  }
}

/**
 * Draws a donut chart inside the bounding box (x, y, w, h).
 * data: [{ name, value, color: [r,g,b] }]
 */
function drawDonutChartPDF(doc, data, x, y, w, h, title) {
  const validData = data.filter(d => d.value > 0)
  if (!validData.length) return

  const total  = validData.reduce((s, d) => s + d.value, 0)
  const r      = Math.min(h / 2 - 8, 18)     // outer radius
  const innerR = r * 0.52                      // donut hole radius
  const cx     = x + r + 8                    // centre x (donut on left)
  const cy     = y + h / 2                    // centre y

  // Title
  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(71, 85, 105)
  doc.text(title, x + w / 2, y + 7, { align: 'center' })

  // Pie slices
  let angle = 0
  validData.forEach(d => {
    const sweep = (d.value / total) * 360
    drawPieSlice(doc, cx, cy, r, angle, angle + sweep, d.color)
    angle += sweep
  })

  // White donut hole
  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(255, 255, 255)
  doc.circle(cx, cy, innerR, 'FD')

  // Total label in centre
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(40, 40, 40)
  doc.text(String(total), cx, cy + 1.5, { align: 'center' })
  doc.setFontSize(5)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(140, 140, 140)
  doc.text('total', cx, cy + 5.5, { align: 'center' })

  // Legend (right of circle)
  const legendX  = cx + r + 5
  const itemH    = (h - 14) / validData.length
  validData.forEach((d, i) => {
    const ly    = y + 12 + i * itemH
    const pct   = Math.round(d.value / total * 100)
    doc.setFillColor(...d.color)
    doc.rect(legendX, ly - 2.5, 3.5, 3.5, 'F')
    doc.setFontSize(5.5)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(60, 60, 60)
    doc.text(`${d.name}`, legendX + 5, ly + 0.5)
    doc.setTextColor(120, 120, 120)
    doc.text(`${d.value} (${pct}%)`, legendX + 5, ly + 5)
  })

  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'normal')
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(0.2)
}

/**
 * Draws Bar + Line + Donut charts in a horizontal row.
 * Returns y after the row.
 */
function drawChartsRow(doc, barData, lineData, donutData, y) {
  const pageW  = doc.internal.pageSize.getWidth()
  const gap    = 4
  const chartW = (pageW - 2 * MARGIN - 2 * gap) / 3
  const chartH = 56

  // Thin border boxes for chart areas
  doc.setDrawColor(228, 232, 238)
  doc.setLineWidth(0.3)
  doc.rect(MARGIN, y, chartW, chartH)
  doc.rect(MARGIN + chartW + gap, y, chartW, chartH)
  doc.rect(MARGIN + 2 * (chartW + gap), y, chartW, chartH)

  drawBarChartPDF(doc, barData, MARGIN,                       y, chartW, chartH, 'Pipeline Stage Distribution')
  drawLineChartPDF(doc, lineData, MARGIN + chartW + gap,       y, chartW, chartH, 'PO Count Trend')
  drawDonutChartPDF(doc, donutData, MARGIN + 2*(chartW + gap), y, chartW, chartH, 'Status Distribution')

  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(0.2)
  return y + chartH + 6
}

// ══════════════════════════════════════════════════════════════════════════════
//  DATA HELPERS  (compute chart data from raw orders array)
// ══════════════════════════════════════════════════════════════════════════════

function daysBetween(d1, d2) {
  if (!d1 || !d2) return 0
  return Math.max(0, Math.floor((new Date(d2) - new Date(d1)) / 86400000))
}

function vendorStats(list) {
  const vm = {}
  list.forEach(o => {
    if (!o.vendor_name) return
    if (!vm[o.vendor_name]) vm[o.vendor_name] = { total: 0, delivered: 0, onTime: 0, lead: [] }
    vm[o.vendor_name].total++
    if (o.delivered_to_rig_date) {
      vm[o.vendor_name].delivered++
      if (o.promised_ready_date && new Date(o.delivered_to_rig_date) <= new Date(o.promised_ready_date))
        vm[o.vendor_name].onTime++
      if (o.po_date) { const d = daysBetween(o.po_date, o.delivered_to_rig_date); if (d > 0) vm[o.vendor_name].lead.push(d) }
    }
  })
  return Object.entries(vm).map(([name, v]) => {
    const pct     = v.delivered > 0 ? Math.round(v.onTime / v.delivered * 100) : null
    const avgLead = v.lead.length   > 0 ? Math.round(v.lead.reduce((a, b) => a + b, 0) / v.lead.length) : null
    return { name, pct, avgLead, total: v.total, delivered: v.delivered }
  }).sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1))
}

function periodKPIs(list) {
  const delivered  = list.filter(o => !!o.delivered_to_rig_date)
  const onTime     = delivered.filter(o => o.promised_ready_date && new Date(o.delivered_to_rig_date) <= new Date(o.promised_ready_date))
  const cycleTimes = delivered.filter(o => o.po_date).map(o => daysBetween(o.po_date, o.delivered_to_rig_date)).filter(d => d > 0)
  return {
    created:   list.length,
    delivered: delivered.length,
    inTransit: list.filter(o => calcStatus(o) === 'In Transit to Rig').length,
    stale:     list.filter(o => daysElapsed(o.po_date) > 45).length,
    onTimePct: delivered.length > 0 ? Math.round(onTime.length / delivered.length * 100) : null,
    avgCycle:  cycleTimes.length > 0 ? Math.round(cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length) : null,
  }
}

/** Returns pipeline stage distribution for bar chart */
function getPipelineData(orders) {
  return PO_STATUSES.map((s, i) => ({
    name:  STAGE_BAR_LABEL[i],
    value: orders.filter(o => calcStatus(o) === s).length,
  }))
}

/** Returns status distribution for donut chart (mutually exclusive buckets) */
function getStatusDist(orders) {
  const delivered   = orders.filter(o => calcStatus(o) === 'Delivered to Rig').length
  const inTransit   = orders.filter(o => ['In Transit to Rig','In Transit to JDIL'].includes(calcStatus(o))).length
  const atJDIL      = orders.filter(o => calcStatus(o) === 'At JDIL Location').length
  const readyVendor = orders.filter(o => calcStatus(o) === 'Material Ready at Vendor').length
  const stale       = orders.filter(o => !o.delivered_to_rig_date && daysElapsed(o.po_date) > 45).length
  const other       = Math.max(0, orders.length - delivered - inTransit - atJDIL - readyVendor - stale)
  return [
    { name: 'Delivered',       value: delivered,   color: DONUT_COLORS.delivered   },
    { name: 'In Transit',      value: inTransit,   color: DONUT_COLORS.inTransit   },
    { name: 'At JDIL',         value: atJDIL,      color: DONUT_COLORS.atJDIL      },
    { name: 'Ready@Vendor',    value: readyVendor, color: DONUT_COLORS.readyVendor },
    { name: 'Stale/Overdue',   value: stale,       color: DONUT_COLORS.stale       },
    { name: 'Other',           value: other,       color: DONUT_COLORS.other       },
  ].filter(d => d.value > 0)
}

/** Daily PO trend for last N days (for weekly report) */
function getDailyTrend(allOrders, days = 7) {
  return Array.from({ length: days }, (_, i) => {
    const d      = new Date(); d.setDate(d.getDate() - (days - 1 - i))
    const dayStr = d.toISOString().slice(0, 10)
    return {
      name:  `${d.getDate()}/${d.getMonth() + 1}`,
      value: allOrders.filter(o => (o.po_date || '').slice(0, 10) === dayStr).length,
    }
  })
}

/** Weekly PO trend for last N weeks (for monthly report) */
function getWeeklyTrend(allOrders, weeks = 5) {
  return Array.from({ length: weeks }, (_, i) => {
    const end   = new Date(); end.setDate(end.getDate() - (weeks - 1 - i) * 7)
    const start = new Date(end); start.setDate(start.getDate() - 6)
    return {
      name:  `${start.getDate()}/${start.getMonth() + 1}`,
      value: allOrders.filter(o => { const d = new Date(o.po_date); return !isNaN(d) && d >= start && d <= end }).length,
    }
  })
}

/** Monthly PO trend across the current quarter (for quarterly report) */
function getMonthlyTrend(allOrders) {
  const now       = new Date()
  const qStartMth = Math.floor(now.getMonth() / 3) * 3
  return [0, 1, 2].map(offset => {
    const m     = qStartMth + offset
    const start = new Date(now.getFullYear(), m, 1)
    const end   = new Date(now.getFullYear(), m + 1, 1)
    return {
      name:  MONTHS[m].slice(0, 3),
      value: allOrders.filter(o => { const d = new Date(o.po_date); return !isNaN(d) && d >= start && d < end }).length,
    }
  })
}

// ══════════════════════════════════════════════════════════════════════════════
//  REPORT 1 — SINGLE PO DETAIL
// ══════════════════════════════════════════════════════════════════════════════
export async function generateSinglePOReport(po, auditLog = [], lineItems = []) {
  const logoData = await getLogoData()
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()

  let y = drawHeader(doc, 'PO Detail Report', `${po.po_number || 'No PO #'} · ${po.rig_name || ''}`, logoData)

  // ── PO identification block ───────────────────────────────────────────────
  doc.setFillColor(248, 250, 252)
  doc.rect(MARGIN, y, pageW - 2 * MARGIN, 22, 'F')
  doc.setDrawColor(226, 232, 240)
  doc.rect(MARGIN, y, pageW - 2 * MARGIN, 22, 'S')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(15, 23, 42)
  doc.text(po.po_number || 'No PO Number', MARGIN + 5, y + 9)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(100, 116, 139)
  doc.text(`MR: ${po.mr_number || '—'}   ·   Rig: ${po.rig_name || '—'}   ·   Vendor: ${po.vendor_name || '—'}`, MARGIN + 5, y + 16)

  const status  = calcStatus(po)
  const elapsed = daysElapsed(po.po_date)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...GREEN)
  doc.text(status, pageW - MARGIN - 5, y + 9, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(100, 116, 139)
  doc.text(`${elapsed} days elapsed`, pageW - MARGIN - 5, y + 16, { align: 'right' })
  if (elapsed > 45) {
    doc.setTextColor(220, 38, 38)
    doc.setFont('helvetica', 'bold')
    doc.text('⚠ OVERDUE', pageW - MARGIN - 5, y + 20.5, { align: 'right' })
  }
  doc.setTextColor(0, 0, 0)
  y += 27

  // ── Pipeline visual ───────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(71, 85, 105)
  doc.text('PIPELINE STATUS', MARGIN, y)
  y += 4
  y = drawPipeline(doc, status, y)

  // ── Purchase Details ──────────────────────────────────────────────────────
  y = sectionTitle(doc, 'PURCHASE DETAILS', y)
  doc.autoTable({
    startY: y,
    margin: { left: MARGIN, right: MARGIN, top: HEADER_H + 10, bottom: 18 },
    body: [
      ['PO Number',           po.po_number             || '—'],
      ['MR Number',           po.mr_number             || '—'],
      ['PO Date',             formatDate(po.po_date)],
      ['Promised Ready Date', formatDate(po.promised_ready_date)],
      ['Rig / Location',      po.rig_name              || '—'],
      ['Vendor',              po.vendor_name           || '—'],
      ['Vendor Contact',      po.vendor_contact_name   || '—'],
      ['Vendor Phone',        po.vendor_phone_number   || '—'],
      ['Buyer Code',          po.buyer_code            || '—'],
      ['Delivery Mode',       po.delivery_mode         || '—'],
      ['Material Description',   po.material_description   || '—'],
      ['Material Description 2', po.material_description_2 || '—'],
    ],
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 2.5 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 56, fillColor: [248, 250, 252], textColor: [71, 85, 105] } },
  })
  y = doc.lastAutoTable.finalY + 6

  // ── Line Items ────────────────────────────────────────────────────────────
  if (lineItems && lineItems.length > 0) {
    y = sectionTitle(doc, `LINE ITEMS (${lineItems.length})`, y)
    doc.autoTable({
      startY: y,
      margin: { left: MARGIN, right: MARGIN, top: HEADER_H + 10, bottom: 18 },
      head: [['Item Name', 'Material Description', 'Unit', 'Ordered', 'Delivered', 'Pending', 'Status']],
      body: lineItems.map(it => {
        const ordered   = Number(it.quantity_ordered)   || 0
        const delivered = Number(it.quantity_delivered)  || 0
        const pending   = Math.max(0, ordered - delivered)
        return [
          it.item_name            || '—',
          it.material_description || '—',
          it.unit                 || '—',
          String(ordered),
          String(delivered),
          String(pending),
          it.item_status          || 'Pending',
        ]
      }),
      theme: 'striped',
      headStyles: { fillColor: SLATE, textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
      styles: { fontSize: 8, cellPadding: 2 },
      columnStyles: {
        3: { halign: 'center', cellWidth: 18 },
        4: { halign: 'center', cellWidth: 18 },
        5: { halign: 'center', cellWidth: 18 },
        6: { cellWidth: 28 },
      },
    })
    y = doc.lastAutoTable.finalY + 6
  }

  // ── Logistics Details ─────────────────────────────────────────────────────
  y = sectionTitle(doc, 'LOGISTICS DETAILS', y)
  doc.autoTable({
    startY: y,
    margin: { left: MARGIN, right: MARGIN, top: HEADER_H + 10, bottom: 18 },
    body: [
      ['Material Received Date',       formatDate(po.material_received_date)],
      ['Material Received Location',   po.material_received_location || '—'],
      ['DC Number (BKC)',              po.dc_number_bkc       || '—'],
      ['DC Number (Taloja)',           po.dc_number_taloja    || '—'],
      ['DC Number (Nhava)',            po.dc_number_nhava     || '—'],
      ['DC Number (Nagothane)',        po.dc_number_nagothane || '—'],
      ['Material Dispatch Date',       formatDate(po.dispatch_date)],
      ['Material Dispatch Location',   po.jdil_location       || '—'],
      ['Mode of Transport',            po.mode_of_transport   || '—'],
      ['Transporter Detail',           po.transporter_details || '—'],
      ['In Transit to Rig/JDIL Location Date', formatDate(po.in_transit_rig_date)],
    ],
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 2.5 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 56, fillColor: [248, 250, 252], textColor: [71, 85, 105] } },
  })
  y = doc.lastAutoTable.finalY + 6

  // ── Rig Delivery ──────────────────────────────────────────────────────────
  y = sectionTitle(doc, 'RIG DELIVERY', y)
  doc.autoTable({
    startY: y,
    margin: { left: MARGIN, right: MARGIN, top: HEADER_H + 10, bottom: 18 },
    body: [
      ['Delivered to Rig Date', formatDate(po.delivered_to_rig_date) || 'Not yet delivered'],
      ['Total Days Elapsed',    `${elapsed} days since PO date`],
    ],
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 2.5 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 56, fillColor: [248, 250, 252], textColor: [71, 85, 105] } },
  })
  y = doc.lastAutoTable.finalY + 6

  // ── Remarks ───────────────────────────────────────────────────────────────
  if (po.remarks || po.other_remarks) {
    y = sectionTitle(doc, 'REMARKS', y)
    doc.autoTable({
      startY: y,
      margin: { left: MARGIN, right: MARGIN, top: HEADER_H + 10, bottom: 18 },
      body: [
        ['Remarks',       po.remarks       || '—'],
        ['Other Remarks', po.other_remarks || '—'],
      ],
      theme: 'grid',
      styles: { fontSize: 8.5, cellPadding: 2.5 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 56, fillColor: [248, 250, 252], textColor: [71, 85, 105] } },
    })
    y = doc.lastAutoTable.finalY + 6
  }

  // ── Change History ────────────────────────────────────────────────────────
  y = sectionTitle(doc, `CHANGE HISTORY${auditLog.length > 0 ? ` (${auditLog.length} records)` : ''}`, y)
  if (auditLog.length === 0) {
    doc.setFontSize(8); doc.setTextColor(150, 150, 150)
    doc.text('No change history recorded for this PO.', MARGIN + 5, y + 4)
    doc.setTextColor(0, 0, 0)
  } else {
    doc.autoTable({
      startY: y,
      margin: { left: MARGIN, right: MARGIN, top: HEADER_H + 10, bottom: 18 },
      head: [['Date / Time', 'Changed By', 'Field', 'Old Value', 'New Value', 'Reason']],
      body: auditLog.map(log => [
        log.changed_at ? new Date(log.changed_at).toLocaleString('en-IN') : '—',
        log.users?.name || '—',
        log.field_changed || '—',
        log.old_value     || '—',
        log.new_value     || '—',
        log.reason        || '—',
      ]),
      theme: 'striped',
      headStyles: { fillColor: SLATE, textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
      styles: { fontSize: 7.5, overflow: 'ellipsize', cellPadding: 2 },
      columnStyles: { 0: { cellWidth: 30 }, 1: { cellWidth: 28 }, 2: { cellWidth: 28 }, 5: { cellWidth: 38 } },
    })
  }

  addFooters(doc)
  openPDF(doc, `JDIL_Navigation_PO_${(po.po_number || 'detail').replace(/\//g, '-')}_${new Date().toISOString().slice(0, 10)}.pdf`)
}

// ══════════════════════════════════════════════════════════════════════════════
//  REPORT 2 — WEEKLY SUMMARY
// ══════════════════════════════════════════════════════════════════════════════
export async function generateWeeklyReport(orders) {
  const logoData = await getLogoData()
  const doc      = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  const now     = new Date()
  const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7)
  const dateRange = `${formatDate(weekAgo.toISOString().slice(0, 10))} — ${formatDate(now.toISOString().slice(0, 10))}`

  let y = drawHeader(doc, 'Weekly Summary Report', dateRange, logoData)

  const weekOrders = orders.filter(o => {
    const d = new Date(o.po_date || o.updated_at || o.created_at)
    return !isNaN(d) && d >= weekAgo
  })
  const kpis = periodKPIs(weekOrders)

  y = drawKPIs(doc, [
    { label: 'POs This Week',    value: kpis.created,   color: GREEN },
    { label: 'Delivered',        value: kpis.delivered, color: [16, 185, 129] },
    { label: 'In Transit',       value: kpis.inTransit, color: [245, 158, 11] },
    { label: 'Stale POs',        value: kpis.stale,     color: [239, 68, 68] },
    { label: 'On-Time Delivery', value: kpis.onTimePct !== null ? `${kpis.onTimePct}%` : '—', color: GREEN },
  ], y)

  // ── Visual charts row ─────────────────────────────────────────────────────
  y = sectionTitle(doc, 'VISUAL OVERVIEW', y)
  y = drawChartsRow(doc,
    getPipelineData(weekOrders),
    getDailyTrend(orders, 7),
    getStatusDist(weekOrders),
    y
  )

  // ── Orders table ──────────────────────────────────────────────────────────
  y = sectionTitle(doc, `ALL ORDERS THIS WEEK (${weekOrders.length})`, y)
  doc.autoTable({
    startY: y,
    margin: { left: MARGIN, right: MARGIN, top: HEADER_H + 8, bottom: 15 },
    head: [['PO #', 'MR #', 'Rig', 'Vendor', 'Material', 'Status', 'PO Date', 'Promise Date', 'Days', 'Delivered']],
    body: weekOrders.map(o => [
      o.po_number || '—', o.mr_number || '—', o.rig_name || '—', o.vendor_name || '—',
      (o.material_description || '').substring(0, 32),
      calcStatus(o), formatDate(o.po_date), formatDate(o.promised_ready_date),
      `${daysElapsed(o.po_date)}d`, formatDate(o.delivered_to_rig_date),
    ]),
    theme: 'striped',
    headStyles: { fillColor: GREEN, textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
    styles: { fontSize: 7.5, overflow: 'ellipsize', cellPadding: 2 },
    columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 22 }, 5: { cellWidth: 32 } },
  })
  y = doc.lastAutoTable.finalY + 7

  // ── Vendor performance ────────────────────────────────────────────────────
  const vendors = vendorStats(weekOrders)
  if (vendors.length > 0) {
    y = sectionTitle(doc, 'VENDOR PERFORMANCE THIS WEEK', y)
    doc.autoTable({
      startY: y,
      margin: { left: MARGIN, right: MARGIN, top: HEADER_H + 8, bottom: 15 },
      head: [['#', 'Vendor', 'Total POs', 'Delivered', 'On-Time %', 'Avg Lead Time']],
      body: vendors.map((v, i) => [i + 1, v.name, v.total, v.delivered, v.pct !== null ? `${v.pct}%` : '—', v.avgLead !== null ? `${v.avgLead} days` : '—']),
      theme: 'grid',
      headStyles: { fillColor: GREEN, textColor: 255, fontStyle: 'bold', fontSize: 8 },
      styles: { fontSize: 8, cellPadding: 2.5 },
      columnStyles: { 0: { cellWidth: 10 }, 1: { cellWidth: 75 } },
    })
  }

  addFooters(doc)
  openPDF(doc, `JDIL_Navigation_Weekly_Report_${now.toISOString().slice(0, 10)}.pdf`)
}

// ══════════════════════════════════════════════════════════════════════════════
//  REPORT 3 — MONTHLY SUMMARY
// ══════════════════════════════════════════════════════════════════════════════
export async function generateMonthlyReport(orders) {
  const logoData  = await getLogoData()
  const doc       = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  const now           = new Date()
  const monthStart    = new Date(now.getFullYear(), now.getMonth(), 1)
  const prevStart     = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const monthName     = `${MONTHS[now.getMonth()]} ${now.getFullYear()}`
  const prevMonthName = `${MONTHS[(now.getMonth() + 11) % 12]} ${now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()}`

  let y = drawHeader(doc, 'Monthly Summary Report', monthName, logoData)

  const monthOrders = orders.filter(o => { const d = new Date(o.po_date); return !isNaN(d) && d >= monthStart })
  const prevOrders  = orders.filter(o => { const d = new Date(o.po_date); return !isNaN(d) && d >= prevStart && d < monthStart })
  const curr = periodKPIs(monthOrders)
  const prev = periodKPIs(prevOrders)

  y = drawKPIs(doc, [
    { label: 'POs This Month', value: curr.created,   color: GREEN },
    { label: 'Delivered',      value: curr.delivered, color: [16, 185, 129], sub: `prev: ${prev.delivered}` },
    { label: 'In Transit',     value: curr.inTransit, color: [245, 158, 11] },
    { label: 'Stale POs',      value: curr.stale,     color: [239, 68, 68], sub: `prev: ${prev.stale}` },
    { label: 'On-Time %',      value: curr.onTimePct !== null ? `${curr.onTimePct}%` : '—', color: GREEN, sub: prev.onTimePct !== null ? `prev: ${prev.onTimePct}%` : 'prev: —' },
    { label: 'Avg Cycle',      value: curr.avgCycle  !== null ? `${curr.avgCycle}d`  : '—', color: SLATE, sub: prev.avgCycle  !== null ? `prev: ${prev.avgCycle}d`  : 'prev: —' },
  ], y)

  // ── Visual charts row ─────────────────────────────────────────────────────
  y = sectionTitle(doc, 'VISUAL OVERVIEW', y)
  y = drawChartsRow(doc,
    getPipelineData(monthOrders),
    getWeeklyTrend(orders, 5),
    getStatusDist(monthOrders),
    y
  )

  // ── Month-over-month comparison ───────────────────────────────────────────
  y = sectionTitle(doc, 'MONTH-OVER-MONTH COMPARISON', y)
  const diff = (a, b) => (a !== null && b !== null) ? (a - b > 0 ? `+${a - b}` : String(a - b)) : '—'
  doc.autoTable({
    startY: y,
    margin: { left: MARGIN, right: MARGIN, top: HEADER_H + 8, bottom: 15 },
    head: [['Metric', monthName, prevMonthName, 'Change']],
    body: [
      ['POs Created',    curr.created,   prev.created,   diff(curr.created,   prev.created)],
      ['Delivered',      curr.delivered, prev.delivered, diff(curr.delivered, prev.delivered)],
      ['On-Time %',      curr.onTimePct !== null ? `${curr.onTimePct}%` : '—', prev.onTimePct !== null ? `${prev.onTimePct}%` : '—', diff(curr.onTimePct, prev.onTimePct) !== '—' ? diff(curr.onTimePct, prev.onTimePct) + '%' : '—'],
      ['Avg Cycle Time', curr.avgCycle  !== null ? `${curr.avgCycle}d`  : '—', prev.avgCycle  !== null ? `${prev.avgCycle}d`  : '—', diff(curr.avgCycle,   prev.avgCycle)   !== '—' ? diff(curr.avgCycle,   prev.avgCycle)  + 'd' : '—'],
      ['Stale POs',      curr.stale,     prev.stale,     diff(curr.stale,     prev.stale)],
    ],
    theme: 'grid',
    headStyles: { fillColor: GREEN, textColor: 255, fontStyle: 'bold', fontSize: 8 },
    styles: { fontSize: 8.5, cellPadding: 2.5 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50, fillColor: [248, 250, 252] } },
  })
  y = doc.lastAutoTable.finalY + 7

  // ── Pipeline snapshot ─────────────────────────────────────────────────────
  y = sectionTitle(doc, 'PIPELINE SNAPSHOT — CURRENT MONTH', y)
  const counts = PO_STATUSES.map(s => ({ stage: s, count: monthOrders.filter(o => calcStatus(o) === s).length }))
  const snapRows = []
  for (let i = 0; i < counts.length; i += 3) snapRows.push([counts[i]?.stage || '', counts[i]?.count ?? '', counts[i+1]?.stage || '', counts[i+1]?.count ?? '', counts[i+2]?.stage || '', counts[i+2]?.count ?? ''])
  doc.autoTable({
    startY: y,
    margin: { left: MARGIN, right: MARGIN, top: HEADER_H + 8, bottom: 15 },
    head: [['Stage', 'Count', 'Stage', 'Count', 'Stage', 'Count']],
    body: snapRows,
    theme: 'grid',
    headStyles: { fillColor: SLATE, textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
    styles: { fontSize: 8, cellPadding: 2.5 },
    columnStyles: { 1: { halign: 'center', cellWidth: 15 }, 3: { halign: 'center', cellWidth: 15 }, 5: { halign: 'center', cellWidth: 15 } },
  })
  y = doc.lastAutoTable.finalY + 7

  // ── All orders this month ─────────────────────────────────────────────────
  y = sectionTitle(doc, `ALL ORDERS THIS MONTH (${monthOrders.length})`, y)
  doc.autoTable({
    startY: y,
    margin: { left: MARGIN, right: MARGIN, top: HEADER_H + 8, bottom: 15 },
    head: [['PO #', 'MR #', 'Rig', 'Vendor', 'Material', 'Status', 'PO Date', 'Promise Date', 'Days', 'Delivered']],
    body: monthOrders.map(o => [
      o.po_number || '—', o.mr_number || '—', o.rig_name || '—', o.vendor_name || '—',
      (o.material_description || '').substring(0, 30), calcStatus(o),
      formatDate(o.po_date), formatDate(o.promised_ready_date), `${daysElapsed(o.po_date)}d`, formatDate(o.delivered_to_rig_date),
    ]),
    theme: 'striped',
    headStyles: { fillColor: GREEN, textColor: 255, fontStyle: 'bold', fontSize: 7 },
    styles: { fontSize: 7, overflow: 'ellipsize', cellPadding: 2 },
    columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 22 }, 5: { cellWidth: 30 } },
  })
  y = doc.lastAutoTable.finalY + 7

  // ── Vendor performance ────────────────────────────────────────────────────
  const vendors = vendorStats(monthOrders)
  if (vendors.length > 0) {
    y = sectionTitle(doc, 'VENDOR PERFORMANCE THIS MONTH', y)
    doc.autoTable({
      startY: y,
      margin: { left: MARGIN, right: MARGIN, top: HEADER_H + 8, bottom: 15 },
      head: [['#', 'Vendor', 'Total POs', 'Delivered', 'On-Time %', 'Avg Lead Time']],
      body: vendors.map((v, i) => [i + 1, v.name, v.total, v.delivered, v.pct !== null ? `${v.pct}%` : '—', v.avgLead !== null ? `${v.avgLead} days` : '—']),
      theme: 'grid',
      headStyles: { fillColor: GREEN, textColor: 255, fontStyle: 'bold', fontSize: 8 },
      styles: { fontSize: 8, cellPadding: 2.5 },
      columnStyles: { 0: { cellWidth: 10 }, 1: { cellWidth: 75 } },
    })
  }

  addFooters(doc)
  openPDF(doc, `JDIL_Navigation_Monthly_${monthName.replace(/ /g, '_')}.pdf`)
}

// ══════════════════════════════════════════════════════════════════════════════
//  REPORT 4 — QUARTERLY SUMMARY
// ══════════════════════════════════════════════════════════════════════════════
export async function generateQuarterlyReport(orders) {
  const logoData = await getLogoData()
  const doc      = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  const now         = new Date()
  const qNum        = Math.floor(now.getMonth() / 3) + 1
  const qLabel      = `Q${qNum} ${now.getFullYear()}`
  const qStartMonth = (qNum - 1) * 3
  const qStart      = new Date(now.getFullYear(), qStartMonth, 1)

  const qOrders = orders.filter(o => { const d = new Date(o.po_date); return !isNaN(d) && d >= qStart })
  const kpis    = periodKPIs(qOrders)

  let y = drawHeader(doc, 'Quarterly Summary Report', qLabel, logoData)

  y = drawKPIs(doc, [
    { label: 'POs This Quarter', value: kpis.created,   color: GREEN },
    { label: 'Delivered',        value: kpis.delivered, color: [16, 185, 129] },
    { label: 'In Transit',       value: kpis.inTransit, color: [245, 158, 11] },
    { label: 'Stale POs',        value: kpis.stale,     color: [239, 68, 68] },
    { label: 'On-Time %',        value: kpis.onTimePct !== null ? `${kpis.onTimePct}%` : '—', color: GREEN },
    { label: 'Avg Cycle Time',   value: kpis.avgCycle  !== null ? `${kpis.avgCycle}d`  : '—', color: SLATE },
  ], y)

  // ── Visual charts row ─────────────────────────────────────────────────────
  y = sectionTitle(doc, 'VISUAL OVERVIEW', y)
  y = drawChartsRow(doc,
    getPipelineData(qOrders),
    getMonthlyTrend(orders),
    getStatusDist(qOrders),
    y
  )

  // ── Month-by-month KPI trends ─────────────────────────────────────────────
  y = sectionTitle(doc, `KPI TRENDS — ${qLabel}`, y)
  const monthRows = [0, 1, 2].map(offset => {
    const m      = qStartMonth + offset
    const mStart = new Date(now.getFullYear(), m, 1)
    const mEnd   = new Date(now.getFullYear(), m + 1, 1)
    const mk     = periodKPIs(orders.filter(o => { const d = new Date(o.po_date); return !isNaN(d) && d >= mStart && d < mEnd }))
    return [`${MONTHS[m]} ${now.getFullYear()}`, mk.created, mk.delivered, mk.onTimePct !== null ? `${mk.onTimePct}%` : '—', mk.avgCycle !== null ? `${mk.avgCycle}d` : '—', mk.stale]
  })
  doc.autoTable({
    startY: y,
    margin: { left: MARGIN, right: MARGIN, top: HEADER_H + 8, bottom: 15 },
    head: [['Month', 'POs Created', 'Delivered', 'On-Time %', 'Avg Cycle Time', 'Stale POs']],
    body: monthRows,
    theme: 'grid',
    headStyles: { fillColor: GREEN, textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
    styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 48, fillColor: [248, 250, 252] }, 1: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'center' }, 4: { halign: 'center' }, 5: { halign: 'center' } },
  })
  y = doc.lastAutoTable.finalY + 7

  // ── Rig-wise delivery performance ─────────────────────────────────────────
  const rigMap = {}
  qOrders.forEach(o => {
    if (!o.rig_name) return
    if (!rigMap[o.rig_name]) rigMap[o.rig_name] = { total: 0, delivered: 0, onTime: 0, stale: 0 }
    rigMap[o.rig_name].total++
    if (o.delivered_to_rig_date) {
      rigMap[o.rig_name].delivered++
      if (o.promised_ready_date && new Date(o.delivered_to_rig_date) <= new Date(o.promised_ready_date)) rigMap[o.rig_name].onTime++
    }
    if (daysElapsed(o.po_date) > 45) rigMap[o.rig_name].stale++
  })
  const rigRows = Object.entries(rigMap)
    .map(([rig, r]) => [rig, r.total, r.delivered, r.delivered > 0 ? `${Math.round(r.onTime / r.delivered * 100)}%` : '—', r.total - r.delivered, r.stale])
    .sort((a, b) => b[1] - a[1])

  if (rigRows.length > 0) {
    y = sectionTitle(doc, 'RIG-WISE DELIVERY PERFORMANCE', y)
    doc.autoTable({
      startY: y,
      margin: { left: MARGIN, right: MARGIN, top: HEADER_H + 8, bottom: 15 },
      head: [['Rig / Unit', 'Total POs', 'Delivered', 'On-Time %', 'Pending', 'Overdue']],
      body: rigRows,
      theme: 'striped',
      headStyles: { fillColor: GREEN, textColor: 255, fontStyle: 'bold', fontSize: 8 },
      styles: { fontSize: 8.5, cellPadding: 2.5 },
      columnStyles: { 0: { cellWidth: 52, fontStyle: 'bold' }, 1: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'center' }, 4: { halign: 'center' }, 5: { halign: 'center' } },
    })
    y = doc.lastAutoTable.finalY + 7
  }

  // ── Top vendors ───────────────────────────────────────────────────────────
  const topVendors = vendorStats(qOrders).slice(0, 10)
  if (topVendors.length > 0) {
    y = sectionTitle(doc, 'TOP PERFORMING VENDORS', y)
    doc.autoTable({
      startY: y,
      margin: { left: MARGIN, right: MARGIN, top: HEADER_H + 8, bottom: 15 },
      head: [['#', 'Vendor', 'Total POs', 'Delivered', 'On-Time %', 'Avg Lead Time']],
      body: topVendors.map((v, i) => [i + 1, v.name, v.total, v.delivered, v.pct !== null ? `${v.pct}%` : '—', v.avgLead !== null ? `${v.avgLead} days` : '—']),
      theme: 'grid',
      headStyles: { fillColor: GREEN, textColor: 255, fontStyle: 'bold', fontSize: 8 },
      styles: { fontSize: 8.5, cellPadding: 2.5 },
      columnStyles: { 0: { cellWidth: 10 }, 1: { cellWidth: 80 } },
    })
    y = doc.lastAutoTable.finalY + 7
  }

  // ── Top stale POs ─────────────────────────────────────────────────────────
  const staleList = qOrders.filter(o => !o.delivered_to_rig_date && daysElapsed(o.po_date) > 45)
    .sort((a, b) => daysElapsed(b.po_date) - daysElapsed(a.po_date)).slice(0, 15)
  if (staleList.length > 0) {
    y = sectionTitle(doc, `TOP STALE POs (${staleList.length})`, y)
    doc.autoTable({
      startY: y,
      margin: { left: MARGIN, right: MARGIN, top: HEADER_H + 8, bottom: 15 },
      head: [['PO #', 'MR #', 'Rig', 'Vendor', 'Material', 'PO Date', 'Days Open', 'Status']],
      body: staleList.map(o => [o.po_number || '—', o.mr_number || '—', o.rig_name || '—', o.vendor_name || '—', (o.material_description || '').substring(0, 35), formatDate(o.po_date), `${daysElapsed(o.po_date)}d`, calcStatus(o)]),
      theme: 'striped',
      headStyles: { fillColor: [185, 28, 28], textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
      styles: { fontSize: 7.5, overflow: 'ellipsize', cellPadding: 2 },
      columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 22 }, 6: { cellWidth: 18, halign: 'center' }, 7: { cellWidth: 30 } },
    })
  }

  addFooters(doc)
  openPDF(doc, `JDIL_Navigation_${qLabel.replace(/ /g, '_')}.pdf`)
}
