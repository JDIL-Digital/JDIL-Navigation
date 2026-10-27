-- =====================================================
-- v25: BC PO Line Items Staging Table
-- Stores line items (materials) for each staged PO
-- =====================================================

CREATE TABLE IF NOT EXISTS public.bc_po_line_items_staging (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link to parent staged PO
  bc_staging_id UUID NOT NULL REFERENCES public.bc_po_staging(id) ON DELETE CASCADE,
  po_number TEXT NOT NULL,

  -- From Level 2 (blanketLines) - ordered quantities
  bc_line_no INTEGER,
  item_code TEXT,
  item_description TEXT,
  qty_ordered NUMERIC,
  uom TEXT,

  -- From Level 5 (receiptLines) - received quantities (aggregated)
  qty_received NUMERIC DEFAULT 0,

  -- BC tracking
  bc_blanket_line_id TEXT,

  -- Promotion tracking
  promotion_status TEXT DEFAULT 'pending',
  promoted_at TIMESTAMPTZ,
  promoted_line_item_id UUID,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_line_items_staging_po
  ON public.bc_po_line_items_staging(bc_staging_id);
CREATE INDEX IF NOT EXISTS idx_bc_line_items_staging_po_number
  ON public.bc_po_line_items_staging(po_number);

GRANT ALL PRIVILEGES ON public.bc_po_line_items_staging TO service_role, authenticated;

-- Verification
SELECT 'bc_po_line_items_staging exists:' AS info,
  CASE WHEN EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'bc_po_line_items_staging') THEN 'YES' ELSE 'NO' END AS status;
