-- =====================================================
-- v29: Add RGEN prefix mapping to Nagothane
-- RGEN POs are raised from Nagothane yard for general/base operations
-- Confirmed by user: Nagothane yard handles cross-rig consumables
--
-- NOTE: actual column names differ from the original spec —
--   bc_rig_mapping uses jdil_rig_name  (not rig_name)
--   bc_data_quality_alerts uses resolution_notes (not resolution_note)
-- This migration uses the real column names.
-- =====================================================

-- Add RGEN mapping to bc_rig_mapping
INSERT INTO public.bc_rig_mapping (bc_prefix, jdil_rig_name, active, notes)
VALUES (
  'RGEN',
  'Nagothane',
  true,
  'Nagothane yard general procurement - cross-rig consumables, base operations, facility materials'
)
ON CONFLICT (bc_prefix) DO UPDATE
  SET jdil_rig_name = 'Nagothane',
      active        = true,
      updated_at    = now();

-- Verification: should now show 15 total rigs
SELECT bc_prefix, jdil_rig_name, active
FROM public.bc_rig_mapping
WHERE active = true
ORDER BY prefix_length DESC, bc_prefix;

-- Count check
SELECT COUNT(*) AS total_active_mappings
FROM public.bc_rig_mapping
WHERE active = true;
-- Expected: 15

-- =====================================================
-- Part 4 — Backfill rig_name for existing RGEN staging rows
-- =====================================================
UPDATE public.bc_po_staging
SET rig_name = 'Nagothane'
WHERE po_number LIKE 'RGEN/%'
  AND rig_name IS NULL;

-- Verify backfill
SELECT COUNT(*) AS rgen_staging_rows_fixed
FROM public.bc_po_staging
WHERE po_number LIKE 'RGEN/%'
  AND rig_name = 'Nagothane';
-- Expected: 227 (matches yesterday's count)

-- =====================================================
-- Part 5 — Clear data quality alerts for RGEN (now resolved)
-- =====================================================
UPDATE public.bc_data_quality_alerts
SET resolved          = true,
    resolved_at       = now(),
    resolution_notes  = 'RGEN mapped to Nagothane via v29 migration'
WHERE alert_type = 'unknown_rig'
  AND bc_value   = 'RGEN'
  AND resolved   = false;
