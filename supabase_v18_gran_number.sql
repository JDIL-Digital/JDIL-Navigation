-- ═══════════════════════════════════════════════════════════════════════════
-- supabase_v18_gran_number.sql
-- Adds a GRAN Number field (stored as grn_number) alongside the existing
-- delivered_to_rig_date column. The DB column delivered_to_rig_date is NOT
-- renamed — only its DISPLAY label changes to "GRAN Date" in the app.
-- Run this whole file once in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.po_orders
  ADD COLUMN IF NOT EXISTS grn_number TEXT;

CREATE INDEX IF NOT EXISTS idx_po_grn_number ON public.po_orders(grn_number) WHERE grn_number IS NOT NULL;

GRANT ALL PRIVILEGES ON public.po_orders TO service_role, authenticated;

-- Verify
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'po_orders' AND column_name = 'grn_number';
