-- =============================================
-- JDIL Navigation — v10 Migration: One-time Status Backfill
-- Run ONCE in Supabase SQL Editor. Idempotent — safe to re-run (recomputes
-- deterministically from the same fields, only the `status` column is written).
--
-- Mirrors calcStatus() (latest filled field wins). The In-Transit branch uses
-- case-insensitive ILIKE keyword matching on jdil_location (Material Dispatch
-- Location) to bucket Rig vs JDIL — the same RIG_KEYWORDS the app uses, so
-- "...DD" variants (e.g. "Discovery 1 DD") are caught by the base-name match.
-- =============================================

UPDATE public.po_orders
SET status = CASE
  WHEN delivered_to_rig_date IS NOT NULL THEN 'Delivered to Rig'
  WHEN in_transit_rig_date IS NOT NULL THEN
    CASE WHEN (
      jdil_location ILIKE '%Discovery%'            OR
      jdil_location ILIKE '%Virtue%'               OR
      jdil_location ILIKE '%Jindal Star%'          OR
      jdil_location ILIKE '%Jindal Explorer%'      OR
      jdil_location ILIKE '%Jindal Pioneer%'       OR
      jdil_location ILIKE '%Jindal Supreme%'       OR
      jdil_location ILIKE '%Directional Drilling%' OR
      jdil_location ILIKE '%MLU%'                  OR
      jdil_location ILIKE '%Pipavav%'
    ) THEN 'In Transit to Rig' ELSE 'In Transit to JDIL' END
  WHEN dispatch_date IS NOT NULL                          THEN 'Dispatched from JDIL'
  WHEN material_received_date IS NOT NULL                 THEN 'At JDIL Location'
  WHEN promised_ready_date IS NOT NULL                    THEN 'Vendor Confirmed'
  WHEN buyer_code IS NOT NULL AND buyer_code <> ''        THEN 'Buyer Assigned'
  WHEN po_number  IS NOT NULL AND po_number  <> ''        THEN 'PO Released'
  WHEN mr_number  IS NOT NULL AND mr_number  <> ''        THEN 'MR Created'
  ELSE 'MR Created'
END;

-- Row count (total rows in the table — all were recalculated above).
SELECT COUNT(*) AS total_po_rows FROM public.po_orders;

-- Optional: see the resulting status distribution after backfill.
-- SELECT status, COUNT(*) FROM public.po_orders GROUP BY status ORDER BY 2 DESC;
