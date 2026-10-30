-- =====================================================
-- v31: Truncation tracking for BC sync runs
-- Flags rigs that returned a full page ($top=100) of blanket orders,
-- which may indicate silently truncated data (pagination needed).
-- =====================================================

ALTER TABLE public.bc_sync_runs
  ADD COLUMN IF NOT EXISTS truncation_warnings TEXT[];

-- truncation_warnings stores array of rig prefixes that may have been truncated
-- Example: ['RV1DD', 'RJSDD']
-- NULL/empty = no truncation detected

CREATE INDEX IF NOT EXISTS idx_sync_runs_truncation
  ON public.bc_sync_runs(id)
  WHERE truncation_warnings IS NOT NULL AND array_length(truncation_warnings, 1) > 0;

-- Verification
SELECT 'Column added:' AS info,
  CASE WHEN EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bc_sync_runs'
    AND column_name = 'truncation_warnings'
  ) THEN 'YES' ELSE 'NO' END AS status;
