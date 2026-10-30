-- =====================================================
-- v30: Clean up pending staging rows for fresh pagination test
-- Keeps history of promoted/skipped/failed rows for audit trail
-- =====================================================

-- Before deletion, show current state
SELECT 'Before cleanup:' AS info;
SELECT
  promotion_status,
  COUNT(*) as count,
  COUNT(DISTINCT sync_run_id) as runs
FROM public.bc_po_staging
GROUP BY promotion_status
ORDER BY promotion_status;

-- Delete pending staging rows (keep promoted/skipped/failed for audit)
-- This also cascades to bc_po_line_items_staging

DELETE FROM public.bc_po_line_items_staging
WHERE bc_staging_id IN (
  SELECT id FROM public.bc_po_staging
  WHERE promotion_status = 'pending'
);

DELETE FROM public.bc_po_staging
WHERE promotion_status = 'pending';

-- Delete orphan sync runs (runs with no remaining staging rows)
DELETE FROM public.bc_sync_runs
WHERE id NOT IN (SELECT DISTINCT sync_run_id FROM public.bc_po_staging);

-- Verification
SELECT 'After cleanup:' AS info;
SELECT
  promotion_status,
  COUNT(*) as count,
  COUNT(DISTINCT sync_run_id) as runs
FROM public.bc_po_staging
GROUP BY promotion_status;

-- Should show only:
-- promoted: 73
-- skipped: 73
-- failed: 1

-- Confirm po_orders unaffected
SELECT 'po_orders check:' AS info;
SELECT COUNT(*) FROM public.po_orders;
-- Must be 308
