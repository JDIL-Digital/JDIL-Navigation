-- =============================================
-- JDIL Navigation — v9 Migration: Logistics Team Code
-- Run in Supabase SQL Editor. Idempotent — safe to re-run.
-- =============================================

ALTER TABLE public.po_orders
  ADD COLUMN IF NOT EXISTS logistics_team_code TEXT;

GRANT ALL PRIVILEGES ON public.po_orders TO service_role;
GRANT ALL PRIVILEGES ON public.po_orders TO authenticated;
