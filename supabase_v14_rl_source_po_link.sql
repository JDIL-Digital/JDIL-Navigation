-- =============================================
-- JDIL Navigation — v14 Migration: RL → source PO link
-- Run in Supabase SQL Editor AFTER v11/v12/v13. Idempotent — safe to re-run.
-- =============================================

ALTER TABLE public.reverse_logistics_jobs
  ADD COLUMN IF NOT EXISTS source_po_id UUID REFERENCES public.po_orders(id),
  ADD COLUMN IF NOT EXISTS source_line_item_id UUID REFERENCES public.po_line_items(id),
  ADD COLUMN IF NOT EXISTS is_external_item BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_rl_source_po ON public.reverse_logistics_jobs(source_po_id);

GRANT ALL PRIVILEGES ON public.reverse_logistics_jobs TO service_role, authenticated;

-- Existing rows: source_po_id / source_line_item_id stay NULL, is_external_item
-- defaults to false → neither banner shows. No data migration needed.
