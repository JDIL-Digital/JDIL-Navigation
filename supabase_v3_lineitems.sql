-- =============================================
-- JDIL Navigation — v3 Migration: PO Line Items
-- Run in Supabase SQL Editor AFTER supabase_v2_migration.sql
--
-- Adds multi-line-item support to Purchase Orders with quantity tracking
-- and partial-delivery status. Pipeline status remains PER-PO (unchanged) —
-- line items track their own delivery quantities independently.
-- =============================================

CREATE TABLE IF NOT EXISTS public.po_line_items (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id                UUID NOT NULL REFERENCES public.po_orders(id) ON DELETE CASCADE,
  item_name            TEXT NOT NULL,
  material_description TEXT,
  unit                 TEXT,
  quantity_ordered     NUMERIC NOT NULL DEFAULT 0,
  quantity_delivered   NUMERIC NOT NULL DEFAULT 0,
  quantity_pending     NUMERIC GENERATED ALWAYS AS (quantity_ordered - quantity_delivered) STORED,
  item_status          TEXT GENERATED ALWAYS AS (
    CASE
      WHEN quantity_delivered = 0 THEN 'Pending'
      WHEN quantity_delivered >= quantity_ordered THEN 'Fully Delivered'
      ELSE 'Partially Delivered'
    END
  ) STORED,
  remarks              TEXT,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);

-- ── Index for fast lookup of a PO's items ─────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_po_line_items_po_id ON public.po_line_items(po_id);
CREATE INDEX IF NOT EXISTS idx_po_line_items_status ON public.po_line_items(item_status);

-- ── Grants ────────────────────────────────────────────────────────────────────
GRANT ALL PRIVILEGES ON public.po_line_items TO service_role;
GRANT ALL PRIVILEGES ON public.po_line_items TO authenticated;

-- ── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE public.po_line_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can manage line items" ON public.po_line_items;
CREATE POLICY "Authenticated can manage line items" ON public.po_line_items
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ── Auto-update updated_at on row change ──────────────────────────────────────
DROP TRIGGER IF EXISTS po_line_items_updated_at ON public.po_line_items;
CREATE TRIGGER po_line_items_updated_at
  BEFORE UPDATE ON public.po_line_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Realtime (optional — keeps line item changes live) ───────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.po_line_items;

-- ── Done ──────────────────────────────────────────────────────────────────────
-- quantity_pending and item_status are GENERATED columns — never write to them.
-- Only quantity_ordered (purchase) and quantity_delivered (rig) are mutable.
