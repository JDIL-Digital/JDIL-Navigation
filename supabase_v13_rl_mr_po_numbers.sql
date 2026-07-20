-- =============================================
-- JDIL Navigation — v13 Migration: RL MR/PO Numbers
-- Run in Supabase SQL Editor AFTER v11/v12. Idempotent — safe to re-run.
-- =============================================

ALTER TABLE public.reverse_logistics_jobs ADD COLUMN IF NOT EXISTS mr_number TEXT;
ALTER TABLE public.reverse_logistics_jobs ADD COLUMN IF NOT EXISTS po_number TEXT;

-- Backfill existing test data (if any) so records stay valid.
UPDATE public.reverse_logistics_jobs SET po_number = job_number WHERE po_number IS NULL;
UPDATE public.reverse_logistics_jobs SET mr_number = job_number WHERE mr_number IS NULL;

-- Swap the unique constraint from job_number to po_number (per type).
ALTER TABLE public.reverse_logistics_jobs
  DROP CONSTRAINT IF EXISTS reverse_logistics_jobs_job_type_job_number_key;
ALTER TABLE public.reverse_logistics_jobs
  DROP CONSTRAINT IF EXISTS reverse_logistics_jobs_type_po_unique;
ALTER TABLE public.reverse_logistics_jobs
  ADD CONSTRAINT reverse_logistics_jobs_type_po_unique UNIQUE (job_type, po_number);

-- job_number column is intentionally KEPT for backward compatibility (not dropped).

GRANT ALL PRIVILEGES ON public.reverse_logistics_jobs TO service_role, authenticated;
