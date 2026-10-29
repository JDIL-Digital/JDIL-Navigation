-- ─────────────────────────────────────────────────────────────────────────────
-- v28 — BC automated sync (cron) support columns on bc_sync_runs
--
-- Additive and safe to re-run. Needed because:
--   • triggered_by is a UUID column and cannot store a trigger LABEL
--     ('cron-9am', 'manual-admin', …) — so we add trigger_source (TEXT).
--   • A cron run touches all 14 rigs; rig_results (JSONB) stores the per-rig
--     breakdown for the "Automated Sync" history drill-down.
--   • pos_promoted records how many POs a run promoted to po_orders
--     (only when BC_SYNC_ENABLED=true; otherwise stays 0).
--
-- No existing column is altered or dropped. No data is modified.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.bc_sync_runs
  ADD COLUMN IF NOT EXISTS trigger_source TEXT,
  ADD COLUMN IF NOT EXISTS rig_results    JSONB,
  ADD COLUMN IF NOT EXISTS pos_promoted   INTEGER DEFAULT 0;

-- Verification
SELECT 'trigger_source exists:' AS info,
  CASE WHEN EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bc_sync_runs' AND column_name = 'trigger_source') THEN 'YES' ELSE 'NO' END AS status;
SELECT 'rig_results exists:' AS info,
  CASE WHEN EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bc_sync_runs' AND column_name = 'rig_results') THEN 'YES' ELSE 'NO' END AS status;
SELECT 'pos_promoted exists:' AS info,
  CASE WHEN EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bc_sync_runs' AND column_name = 'pos_promoted') THEN 'YES' ELSE 'NO' END AS status;
