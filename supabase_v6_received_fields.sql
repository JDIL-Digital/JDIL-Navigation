-- =============================================
-- JDIL Navigation — v6 Migration: Material Received fields
-- Run in Supabase SQL Editor AFTER supabase_v5_vendors.sql
-- =============================================

-- CHANGE 3 — two new logistics fields on po_orders
ALTER TABLE public.po_orders
  ADD COLUMN IF NOT EXISTS material_received_date DATE;

ALTER TABLE public.po_orders
  ADD COLUMN IF NOT EXISTS material_received_location TEXT;

-- Optional value guard for the received location (BKC / Taloja / Nagothane / Nhava / Rig)
ALTER TABLE public.po_orders
  DROP CONSTRAINT IF EXISTS po_orders_material_received_location_check;
ALTER TABLE public.po_orders
  ADD CONSTRAINT po_orders_material_received_location_check
    CHECK (material_received_location IS NULL
           OR material_received_location IN ('BKC', 'Taloja', 'Nagothane', 'Nhava', 'Rig'));

-- CHANGE 5 — JDIL Location becomes a dropdown in the UI only. We intentionally
-- do NOT add a DB CHECK constraint here, to avoid failing on any pre-existing
-- free-text jdil_location values already stored.

-- Grants (idempotent — safe to re-run)
GRANT ALL PRIVILEGES ON public.po_orders TO service_role;
GRANT ALL PRIVILEGES ON public.po_orders TO authenticated;
