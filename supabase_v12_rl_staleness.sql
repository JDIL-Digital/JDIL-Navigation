-- =============================================
-- JDIL Navigation — v12 Migration: Reverse Logistics staleness
-- Run in Supabase SQL Editor. Idempotent — safe to re-run.
-- =============================================

ALTER TABLE public.reverse_logistics_jobs
  ADD COLUMN IF NOT EXISTS is_stale BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_rlj_stale ON public.reverse_logistics_jobs(is_stale);

GRANT ALL PRIVILEGES ON public.reverse_logistics_jobs TO service_role, authenticated;
