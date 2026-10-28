-- =====================================================
-- v27: Add BC Integration columns to po_orders
-- Supports Promote from bc_po_staging to po_orders
-- =====================================================

-- Add BC tracking columns (NOT NULL on bc_source only, others nullable)
ALTER TABLE public.po_orders
  ADD COLUMN IF NOT EXISTS bc_blanket_order_id TEXT,
  ADD COLUMN IF NOT EXISTS bc_linked_order_id TEXT,
  ADD COLUMN IF NOT EXISTS bc_source BOOLEAN DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS bc_last_synced TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mr_description TEXT,
  ADD COLUMN IF NOT EXISTS mr_date DATE,
  ADD COLUMN IF NOT EXISTS vendor_code TEXT,
  ADD COLUMN IF NOT EXISTS office_location TEXT,
  ADD COLUMN IF NOT EXISTS quantities_pending_confirmation BOOLEAN DEFAULT false NOT NULL;

-- Indexes for BC-sourced POs (common queries)
CREATE INDEX IF NOT EXISTS idx_po_orders_bc_source
  ON public.po_orders(bc_source)
  WHERE bc_source = true;

CREATE INDEX IF NOT EXISTS idx_po_orders_bc_blanket
  ON public.po_orders(bc_blanket_order_id)
  WHERE bc_blanket_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_po_orders_qty_pending
  ON public.po_orders(quantities_pending_confirmation)
  WHERE quantities_pending_confirmation = true;

-- Verification
SELECT 'Columns added:' AS info;
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'po_orders'
  AND column_name IN (
    'bc_blanket_order_id',
    'bc_linked_order_id',
    'bc_source',
    'bc_last_synced',
    'mr_description',
    'mr_date',
    'vendor_code',
    'office_location',
    'quantities_pending_confirmation'
  );

-- Should return 9 rows

-- Confirm existing data unaffected
SELECT COUNT(*) as total_pos,
       COUNT(*) FILTER (WHERE bc_source = false) as manual_pos,
       COUNT(*) FILTER (WHERE bc_source = true) as bc_pos
FROM public.po_orders;

-- Should show: total_pos=235, manual_pos=235, bc_pos=0 (all defaulted to false)
