-- =====================================================
-- v32: Clean up remaining pending staging from Phase 3 testing
-- Prepares clean state for Phase 4 development
-- =====================================================

-- Show before
SELECT 'Before cleanup:' AS info;
SELECT
  promotion_status,
  COUNT(*) as count
FROM public.bc_po_staging
GROUP BY promotion_status;

-- Delete all pending staging rows and their line items
DELETE FROM public.bc_po_line_items_staging
WHERE bc_staging_id IN (
  SELECT id FROM public.bc_po_staging
  WHERE promotion_status = 'pending'
);

DELETE FROM public.bc_po_staging
WHERE promotion_status = 'pending';

-- Delete orphan sync runs
DELETE FROM public.bc_sync_runs
WHERE id NOT IN (SELECT DISTINCT sync_run_id FROM public.bc_po_staging);

-- Show after
SELECT 'After cleanup:' AS info;
SELECT
  promotion_status,
  COUNT(*) as count
FROM public.bc_po_staging
GROUP BY promotion_status;

-- Should show only: promoted:73, skipped:73, failed:1
-- Total should be 147

SELECT COUNT(*) FROM public.po_orders;
-- Must be 308
