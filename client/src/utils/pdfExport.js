import jsPDF from 'jspdf'
import 'jspdf-autotable'
import { formatDate, calcStatus, daysElapsed } from './helpers'

function addHeader(doc, title) {
  // Green header bar
  doc.setFillColor(26, 122, 60)
  doc.rect(0, 0, 210, 22, 'F')

  // JINDAL text
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('JINDAL', 14, 10)

  // Subtitle
  doc.setFontSize(7)
  doc.setFont('helvetica', 'normal')
  doc.text('DRILLING & INDUSTRIES LTD.', 14, 16)

  // App title
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text('JDIL Navigation — Material Tracking', 105, 10, { align: 'center' })

  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text(title, 105, 16, { align: 'center' })

  // Date
  doc.text(`Generated: ${formatDate(new Date().toISOString().split('T')[0])}`, 196, 10, { align: 'right' })

  doc.setTextColor(0, 0, 0)
  return 28
}

function addFooter(doc) {
  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(150, 150, 150)
    doc.text(`Page ${i} of ${pageCount}`, 105, 290, { align: 'center' })
    doc.text('Confidential — Jindal Drilling & Industries Ltd.', 14, 290)
  }
}

export function generatePDF(type, orders, profile) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  if (type === 'single' && orders.length === 1) {
    const po = orders[0]
    let y = addHeader(doc, 'Purchase Order Detail Report')

    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.text(`PO: ${po.po_number || '—'}  |  MR: ${po.mr_number || '—'}`, 14, y + 4)
    y += 12

    const fields = [
      ['PO Date', formatDate(po.po_date)],
      ['Rig', po.rig_name],
      ['Vendor', po.vendor_name],
      ['Buyer Code', po.buyer_code],
      ['Delivery Mode', po.delivery_mode],
      ['Status', calcStatus(po)],
      ['Days Elapsed', `${daysElapsed(po.po_date)} days`],
      ['Promised Ready Date', formatDate(po.promised_ready_date)],
      ['Material Description', po.material_description],
      ['Material Description 2', po.material_description_2 || '—'],
    ]

    doc.autoTable({
      startY: y,
      head: [['Field', 'Value']],
      body: fields,
      theme: 'grid',
      headStyles: { fillColor: [26, 122, 60], textColor: 255, fontStyle: 'bold' },
      styles: { fontSize: 9 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 60 } },
    })

    const logistics = [
      ['Material Received Date', formatDate(po.material_received_date)],
      ['Material Received Location', po.material_received_location || '—'],
      ['DC Number (BKC)', po.dc_number_bkc || '—'],
      ['DC Number (Taloja)', po.dc_number_taloja || '—'],
      ['DC Number (Nhava)', po.dc_number_nhava || '—'],
      ['DC Number (Nagothane)', po.dc_number_nagothane || '—'],
      ['Material Dispatch Date', formatDate(po.dispatch_date)],
      ['Material Dispatch Location', po.jdil_location || '—'],
      ['Mode of Transport', po.mode_of_transport || '—'],
      ['Transporter Detail', po.transporter_details || '—'],
      ['In Transit to Rig/JDIL Location Date', formatDate(po.in_transit_rig_date)],
      ['Delivered to Rig Date', formatDate(po.delivered_to_rig_date)],
      ['Remarks', po.remarks || '—'],
    ]

    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 6,
      head: [['Logistics Field', 'Value']],
      body: logistics,
      theme: 'grid',
      headStyles: { fillColor: [230, 51, 41], textColor: 255, fontStyle: 'bold' },
      styles: { fontSize: 9 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 60 } },
    })

  } else {
    const titleMap = {
      dashboard: 'Dashboard Summary Report',
      weekly: 'Weekly Summary Report',
      monthly: 'Monthly Summary Report',
      quarterly: 'Quarterly Summary Report',
    }
    let y = addHeader(doc, titleMap[type] || 'Summary Report')

    const rows = orders.map(o => [
      o.po_number || '—',
      o.mr_number || '—',
      o.rig_name || '—',
      o.vendor_name || '—',
      (o.material_description || '').substring(0, 40),
      calcStatus(o),
      formatDate(o.po_date),
      formatDate(o.promised_ready_date),
      `${daysElapsed(o.po_date)}d`,
      formatDate(o.delivered_to_rig_date),
    ])

    doc.autoTable({
      startY: y,
      head: [['PO #', 'MR #', 'Rig', 'Vendor', 'Material', 'Status', 'PO Date', 'Promise Date', 'Days', 'Delivered']],
      body: rows,
      theme: 'striped',
      headStyles: { fillColor: [26, 122, 60], textColor: 255, fontStyle: 'bold', fontSize: 8 },
      styles: { fontSize: 7.5, overflow: 'ellipsize' },
      columnStyles: {
        5: { cellWidth: 30 },
        9: { cellWidth: 22 },
      },
    })
  }

  addFooter(doc)
  doc.save(`JDIL_${type}_${new Date().toISOString().split('T')[0]}.pdf`)
}
