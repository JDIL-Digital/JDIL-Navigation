-- =====================================================
-- v24: BC PO Staging Table
-- Intermediate landing zone for BC data before promotion to po_orders
-- =====================================================

CREATE TABLE IF NOT EXISTS public.bc_po_staging (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- MR fields (from Level 1 BC data)
  mr_number TEXT,
  mr_description TEXT,
  mr_date TEXT,
  rig_name TEXT,
  office_location TEXT,

  -- PO fields (from Level 3 BC data)
  po_number TEXT NOT NULL,
  vendor_code TEXT,
  vendor_name TEXT,
  material_description TEXT,
  material_description_2 TEXT,
  po_date TEXT,
  po_status TEXT,
  buyer_code TEXT,
  buyer_code_raw TEXT,

  -- GRAN fields (from Level 4 BC data)
  grn_number TEXT,
  gran_date TEXT,

  -- BC tracking
  bc_blanket_order_id TEXT,
  bc_linked_order_id TEXT,
  bc_fetch_timestamp TIMESTAMPTZ DEFAULT now(),

  -- Sync workflow fields
  sync_run_id UUID NOT NULL,
  sync_action TEXT NOT NULL,
  promotion_status TEXT DEFAULT 'pending',
  promotion_notes TEXT,
  promoted_at TIMESTAMPTZ,
  promoted_po_id UUID,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  processed_warnings TEXT[]
);

CREATE INDEX IF NOT EXISTS idx_bc_staging_sync_run
  ON public.bc_po_staging(sync_run_id);
CREATE INDEX IF NOT EXISTS idx_bc_staging_po_number
  ON public.bc_po_staging(po_number);
CREATE INDEX IF NOT EXISTS idx_bc_staging_promotion
  ON public.bc_po_staging(promotion_status)
  WHERE promotion_status = 'pending';

-- Sync run log table
CREATE TABLE IF NOT EXISTS public.bc_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'running',
  triggered_by UUID,
  rig_filter TEXT,
  fiscal_years TEXT,

  total_bos_fetched INTEGER DEFAULT 0,
  total_pos_processed INTEGER DEFAULT 0,
  pos_within_range INTEGER DEFAULT 0,
  pos_before_cutoff INTEGER DEFAULT 0,
  staging_rows_inserted INTEGER DEFAULT 0,

  error_message TEXT,
  processing_time_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_started
  ON public.bc_sync_runs(started_at DESC);

GRANT ALL PRIVILEGES ON public.bc_po_staging TO service_role, authenticated;
GRANT ALL PRIVILEGES ON public.bc_sync_runs TO service_role, authenticated;

-- Verification
SELECT 'bc_po_staging exists:' AS info,
  CASE WHEN EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'bc_po_staging') THEN 'YES' ELSE 'NO' END AS status;
SELECT 'bc_sync_runs exists:' AS info,
  CASE WHEN EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'bc_sync_runs') THEN 'YES' ELSE 'NO' END AS status;
