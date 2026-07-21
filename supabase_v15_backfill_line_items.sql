-- =============================================
-- JDIL Navigation — v15 Migration: Backfill line items for historical POs
-- Run in Supabase SQL Editor. Safe & idempotent — only inserts for POs that
-- currently have ZERO line items; never touches existing line items.
-- =============================================

INSERT INTO public.po_line_items (po_id, item_name, material_description, quantity_ordered, unit, created_at, updated_at)
SELECT
  po.id AS po_id,
  COALESCE(NULLIF(TRIM(po.material_description_2), ''), 'Material') AS item_name,
  po.material_description_2 AS material_description,
  1 AS quantity_ordered,
  'pcs' AS unit,
  now(),
  now()
FROM public.po_orders po
LEFT JOIN public.po_line_items li ON li.po_id = po.id
WHERE li.id IS NULL;

-- Verify: total line items after backfill
SELECT COUNT(*) AS line_items_created FROM public.po_line_items;

-- Full verification (each PO should now have >= 1 line item)
SELECT
  COUNT(*) AS total_pos,
  COUNT(*) FILTER (WHERE po.delivered_to_rig_date IS NOT NULL) AS delivered_pos,
  (SELECT COUNT(*) FROM public.po_line_items) AS total_line_items
FROM public.po_orders po;
