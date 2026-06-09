-- =============================================
-- JDIL Navigation — v7 Migration: Overdue from Promised Ready Date
-- Run in Supabase SQL Editor (OPTIONAL but recommended).
--
-- The overdue/stale rule changed from "days since po_date" to
-- "days since promised_ready_date" (falling back to po_date when the promised
-- date is null). `is_stale` is an application-managed boolean (NOT a generated
-- column), so no schema change is required — the server re-computes it on every
-- create/update and the daily stale-checker cron.
--
-- This script is a one-time BACKFILL so existing rows immediately reflect the
-- new rule using the default 45-day threshold. Re-running it is safe.
-- =============================================

UPDATE public.po_orders
SET is_stale = (
  status <> 'Delivered to Rig'
  AND COALESCE(promised_ready_date, po_date) IS NOT NULL
  AND COALESCE(promised_ready_date, po_date) < (CURRENT_DATE - INTERVAL '45 days')
);

-- Note: the live threshold remains configurable in system_settings
-- (overdue_threshold_days). This backfill uses 45 just to seed existing rows.
