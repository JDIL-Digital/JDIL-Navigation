-- =============================================
-- JDIL Navigation — v16 Migration: Delivery-stale + alert tracking
-- Run in Supabase SQL Editor. Idempotent — safe to re-run.
-- =============================================

ALTER TABLE public.po_orders
  ADD COLUMN IF NOT EXISTS is_delivery_stale BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_stale_alert_sent TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_delivery_stale_alert_sent TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_po_delivery_stale ON public.po_orders(is_delivery_stale) WHERE is_delivery_stale = true;

GRANT ALL PRIVILEGES ON public.po_orders TO service_role, authenticated;
