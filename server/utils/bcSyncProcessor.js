/**
 * bcSyncProcessor.js — turns a BC Blanket-Order fetch into a JDIL-shaped
 * preview. Uses the pure helpers in bcTransform.js plus READ-ONLY mapping
 * lookups. STILL NO DATABASE WRITES — this is a dry-run/preview only.
 *
 * Both functions take the Supabase client as a parameter (reads only), so this
 * module has no import-time side effects and nothing loads it yet.
 */

const {
  extractRigPrefix,
  lookupRigName,
  lookupBuyerCode,
  transformLinkedOrder,
  processReceiptHeaders,
  parseDate,
  isWithinSyncRange,
} = require('./bcTransform')

// Flatten Level-4/5 receiptHeaders → receiptLines into JDIL line-item shape.
// NOTE: BC receipt-line field names are best-effort guesses until verified
// against real JSON — adjust the fallbacks once a sample is available.
function extractLineItems(receiptHeaders) {
  if (!Array.isArray(receiptHeaders)) return []
  const items = []
  for (const h of receiptHeaders) {
    const lines = Array.isArray(h.receiptLines) ? h.receiptLines : []
    for (const rl of lines) {
      items.push({
        item_code:    rl.itemNo ?? rl.ItemNo ?? rl.no ?? null,
        description:  rl.description ?? rl.Desc1 ?? rl.itemDescription ?? null,
        qty_ordered:  rl.orderQuantity ?? rl.quantityOrdered ?? rl.qtyOrdered ?? null,
        qty_received: rl.quantity ?? rl.Quantity ?? rl.qtyReceived ?? rl.receivedQuantity ?? null,
        uom:          rl.unitOfMeasureCode ?? rl.unitOfMeasure ?? rl.uom ?? rl.UOM ?? null,
      })
    }
  }
  return items
}

// Log an unresolved unknown-buyer alert, grouped by bc_value (increments the
// occurrence count if one already exists). Non-critical — never throws.
async function logUnknownBuyer(bcValue, bcDocumentNo, supabaseAdmin) {
  try {
    const { data: existing } = await supabaseAdmin
      .from('bc_data_quality_alerts')
      .select('id, occurrence_count')
      .eq('alert_type', 'unknown_buyer')
      .eq('bc_value', bcValue)
      .eq('resolved', false)
      .maybeSingle()

    if (existing) {
      await supabaseAdmin
        .from('bc_data_quality_alerts')
        .update({ occurrence_count: existing.occurrence_count + 1, last_seen_at: new Date().toISOString() })
        .eq('id', existing.id)
    } else {
      await supabaseAdmin
        .from('bc_data_quality_alerts')
        .insert({ alert_type: 'unknown_buyer', bc_value: bcValue, bc_document_no: bcDocumentNo, confidence_score: 0, suggested_match: null })
    }
  } catch (err) {
    console.error('[bc-sync] Error logging unknown buyer:', err.message)   // non-critical
  }
}

// Log an unresolved empty-buyer alert, grouped under the special '(empty)' value.
async function logEmptyBuyer(bcDocumentNo, supabaseAdmin) {
  try {
    const { data: existing } = await supabaseAdmin
      .from('bc_data_quality_alerts')
      .select('id, occurrence_count')
      .eq('alert_type', 'empty_buyer')
      .eq('bc_value', '(empty)')
      .eq('resolved', false)
      .maybeSingle()

    if (existing) {
      await supabaseAdmin
        .from('bc_data_quality_alerts')
        .update({ occurrence_count: existing.occurrence_count + 1, last_seen_at: new Date().toISOString() })
        .eq('id', existing.id)
    } else {
      await supabaseAdmin
        .from('bc_data_quality_alerts')
        .insert({ alert_type: 'empty_buyer', bc_value: '(empty)', bc_document_no: bcDocumentNo })
    }
  } catch (err) {
    console.error('[bc-sync] Error logging empty buyer:', err.message)   // non-critical
  }
}

/**
 * Process ONE Blanket Order (with nested lines/POs/receipts).
 * Writes unknown/empty-buyer rows to bc_data_quality_alerts (non-critical).
 * @param {object} bcBO  one BO from the BC response
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @returns {Promise<object>} per-BO result (see shape below)
 */
async function processSingleBlanketOrder(bcBO, supabaseAdmin) {
  const rig_prefix = extractRigPrefix(bcBO.documentNo)
  const rigLookup  = await lookupRigName(rig_prefix, supabaseAdmin)
  const rig_name   = rigLookup.rig_name
  const rig_matched = rigLookup.matched
  const rig_unknown_warning = rig_matched ? null : `Unknown prefix: ${rig_prefix ?? '(none)'}`
  if (!rig_matched) console.warn(`[bcSync] ${rig_unknown_warning} (BO ${bcBO.documentNo})`)

  const pos_processed = []
  let buyers_matched = 0, buyers_unmatched = 0

  for (const line of (Array.isArray(bcBO.blanketLines) ? bcBO.blanketLines : [])) {
    for (const po of (Array.isArray(line.linkedOrders) ? line.linkedOrders : [])) {
      const buyer_lookup = await lookupBuyerCode(po.BuyerCode, supabaseAdmin)
      if (buyer_lookup.matched) {
        buyers_matched++
      } else {
        buyers_unmatched++
        // Silent mode: unknown/empty buyers are auto-assigned to ACCOUNTS, so we
        // no longer write Data Quality Alerts from preview. (Helpers kept below
        // in case we want to re-enable alerting later.)
        // if (buyer_lookup.is_empty) await logEmptyBuyer(po.documentNo, supabaseAdmin)
        // else await logUnknownBuyer(buyer_lookup.bc_value ?? po.BuyerCode, po.documentNo, supabaseAdmin)
      }

      const transformed_data = transformLinkedOrder(po, bcBO, { rigName: rig_name, buyerLookupResult: buyer_lookup })
      const gran_data = processReceiptHeaders(po.receiptHeaders)
      const line_items = extractLineItems(po.receiptHeaders)

      pos_processed.push({
        po_number:      po.documentNo,
        transformed_data,
        buyer_lookup,
        gran_data,
        line_items,
        action_needed:  'INSERT',   // placeholder — INSERT/UPDATE/SKIP logic added next phase
        skip_reason:    null,
      })
    }
  }

  return {
    blanket_order_id:     bcBO.id,
    blanket_order_number: bcBO.documentNo,
    rig_prefix,
    rig_name,
    rig_matched,
    rig_unknown_warning,
    pos_processed,
    summary: {
      total_pos:        pos_processed.length,
      buyers_matched,
      buyers_unmatched,
      rigs_matched:     rig_matched,
    },
  }
}

/**
 * Preview a full BC fetch response (dry-run — no writes).
 * @param {object|Array} bcData  the BC response ({ value: [...] }) or a raw BO array
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @returns {Promise<object>} overall preview (see shape below)
 */
async function previewSync(bcData, supabaseAdmin) {
  const started = Date.now()
  const bos = Array.isArray(bcData?.value) ? bcData.value : (Array.isArray(bcData) ? bcData : [])

  const blanket_orders = []
  let total_pos = 0, bos_within_sync_range = 0, bos_before_cutoff = 0
  const unknownRigs = new Set(), unknownBuyers = new Set()

  for (const bo of bos) {
    const result = await processSingleBlanketOrder(bo, supabaseAdmin)
    blanket_orders.push(result)
    total_pos += result.summary.total_pos

    if (!result.rig_matched && result.rig_prefix) unknownRigs.add(result.rig_prefix)
    for (const po of result.pos_processed) {
      const bl = po.buyer_lookup
      if (!bl.matched && !bl.is_empty && bl.bc_value) unknownBuyers.add(bl.bc_value)
    }

    if (isWithinSyncRange(parseDate(bo.MRReleasedDate))) bos_within_sync_range++
    else bos_before_cutoff++
  }

  return {
    total_bos:             bos.length,
    total_pos,
    bos_within_sync_range,
    bos_before_cutoff,
    unknown_rigs:          [...unknownRigs],
    unknown_buyers:        [...unknownBuyers],
    blanket_orders,
    processing_time_ms:    Date.now() - started,
  }
}

module.exports = { processSingleBlanketOrder, previewSync, extractLineItems, logUnknownBuyer, logEmptyBuyer }
