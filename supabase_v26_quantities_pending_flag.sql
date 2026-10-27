-- =====================================================
-- v26: quantities_pending_confirmation flag on bc_po_staging
-- Set when BC has a GRN but the rig team still needs to confirm quantities.
-- =====================================================

ALTER TABLE public.bc_po_staging
  ADD COLUMN IF NOT EXISTS quantities_pending_confirmation BOOLEAN DEFAULT false;

-- Also add index for queries that filter by this
CREATE INDEX IF NOT EXISTS idx_bc_staging_qty_pending
  ON public.bc_po_staging(quantities_pending_confirmation)
  WHERE quantities_pending_confirmation = true;

-- Verification
SELECT 'Column added:' AS info,
  CASE WHEN EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bc_po_staging'
    AND column_name = 'quantities_pending_confirmation'
  ) THEN 'YES' ELSE 'NO' END AS status;
