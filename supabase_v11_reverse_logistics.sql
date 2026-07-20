-- =============================================
-- JDIL Navigation — v11 Migration: Reverse Logistics
-- Run in Supabase SQL Editor. Idempotent — safe to re-run.
-- =============================================

CREATE TABLE IF NOT EXISTS public.reverse_logistics_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL CHECK (job_type IN ('Repair','Return','Replacement')),
  job_number TEXT NOT NULL,
  rig_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Job Created',

  -- Stage 1: Rig (dispatch out)
  material_description_2 TEXT,
  rig_dispatch_date DATE,
  rig_dispatch_location TEXT,
  rig_mode_of_transport TEXT,

  -- Stage 2: JDIL inbound from rig (Logistics)
  jdil_in_received_date DATE,
  jdil_in_received_location TEXT,
  jdil_in_dispatch_date DATE,
  jdil_in_dispatch_location TEXT,
  jdil_in_mode_of_transport TEXT,
  jdil_in_remarks TEXT,
  jdil_in_logistics_code TEXT,
  jdil_in_dc_bkc TEXT,
  jdil_in_dc_taloja TEXT,
  jdil_in_dc_nhava TEXT,
  jdil_in_dc_nagothane TEXT,

  -- Stage 3: Vendor received (Purchase)
  vendor_name TEXT,
  vendor_contact TEXT,
  vendor_phone TEXT,
  vendor_received_date DATE,

  -- Stage 4: Vendor ships back (Purchase) — for Repair/Replacement only
  repair_description TEXT,
  expected_return_date DATE,
  vendor_dispatch_date DATE,
  vendor_dispatch_location TEXT,
  vendor_mode_of_transport TEXT,

  -- Stage 5: JDIL outbound back to rig (Logistics)
  jdil_out_received_date DATE,
  jdil_out_received_location TEXT,
  jdil_out_dispatch_date DATE,
  jdil_out_dispatch_location TEXT,
  jdil_out_dc_number TEXT,
  jdil_out_mode_of_transport TEXT,

  -- Stage 6: Rig receives
  rig_received_date DATE,
  rig_remarks TEXT,
  rig_other_remarks TEXT,

  -- Meta
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(job_type, job_number)
);

CREATE TABLE IF NOT EXISTS public.reverse_logistics_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.reverse_logistics_jobs(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  material_description TEXT,
  unit TEXT,
  quantity NUMERIC NOT NULL DEFAULT 0,
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rlj_type_status ON public.reverse_logistics_jobs(job_type, status);
CREATE INDEX IF NOT EXISTS idx_rlj_rig ON public.reverse_logistics_jobs(rig_name);
CREATE INDEX IF NOT EXISTS idx_rlj_created ON public.reverse_logistics_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rli_job ON public.reverse_logistics_line_items(job_id);

ALTER TABLE public.reverse_logistics_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reverse_logistics_line_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can manage rl jobs" ON public.reverse_logistics_jobs;
CREATE POLICY "Authenticated can manage rl jobs" ON public.reverse_logistics_jobs
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated can manage rl items" ON public.reverse_logistics_line_items;
CREATE POLICY "Authenticated can manage rl items" ON public.reverse_logistics_line_items
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

GRANT ALL PRIVILEGES ON public.reverse_logistics_jobs TO service_role, authenticated;
GRANT ALL PRIVILEGES ON public.reverse_logistics_line_items TO service_role, authenticated;

-- Auto-update updated_at (reuses the shared trigger fn from supabase_schema.sql)
DROP TRIGGER IF EXISTS rlj_updated_at ON public.reverse_logistics_jobs;
CREATE TRIGGER rlj_updated_at BEFORE UPDATE ON public.reverse_logistics_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS rli_updated_at ON public.reverse_logistics_line_items;
CREATE TRIGGER rli_updated_at BEFORE UPDATE ON public.reverse_logistics_line_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
