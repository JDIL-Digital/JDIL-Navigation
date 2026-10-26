-- ═══════════════════════════════════════════════════════════════════════════
-- supabase_v19_bc_mapping_tables.sql
-- Business Central (BC) integration mapping tables:
--   1. bc_rig_mapping          — BC rig prefix → JDIL rig name
--   2. bc_buyer_mapping        — BC buyer code → JDIL buyer code
--   3. bc_buyer_aliases        — typo-tolerant aliases for buyer codes
--   4. bc_data_quality_alerts  — unmatched/low-confidence BC value tracking
-- Creates new tables only — does NOT touch any existing tables or data.
-- Run this whole file once in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- TABLE 1 — BC RIG MAPPING
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.bc_rig_mapping (
  bc_prefix TEXT PRIMARY KEY,
  jdil_rig_name TEXT NOT NULL,
  prefix_length INTEGER GENERATED ALWAYS AS (length(bc_prefix)) STORED,
  active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rig_mapping_active
  ON public.bc_rig_mapping(active, prefix_length DESC)
  WHERE active = true;

-- Pre-populate with all 14 known rig prefixes
INSERT INTO public.bc_rig_mapping (bc_prefix, jdil_rig_name) VALUES
  ('RD1', 'Discovery 1'),
  ('RD1DD', 'Discovery 1 Dry Dock'),
  ('RV1', 'Virtue 1'),
  ('RV1DD', 'Virtue 1 Dry Dock'),
  ('RJS', 'Jindal Star'),
  ('RJSDD', 'Jindal Star Dry Dock'),
  ('RJE', 'Jindal Explorer'),
  ('RJEDD', 'Jindal Explorer Dry Dock'),
  ('RJSUP', 'Jindal Supreme'),
  ('RJSUPDD', 'Jindal Supreme Dry Dock'),
  ('MLU', 'Mud Logging Unit'),
  ('DDD', 'Directional Drilling'),
  ('TAWS', 'Taloja'),
  ('RIG', 'Taloja')
ON CONFLICT (bc_prefix) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- TABLE 2 — BC BUYER MAPPING
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.bc_buyer_mapping (
  bc_buyer_code TEXT PRIMARY KEY,
  jdil_buyer_code TEXT NOT NULL,
  full_name TEXT,
  active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_buyer_mapping_active
  ON public.bc_buyer_mapping(active)
  WHERE active = true;

-- Pre-populate with known buyers (format: "FirstName L." as discussed)
INSERT INTO public.bc_buyer_mapping (bc_buyer_code, jdil_buyer_code, full_name) VALUES
  ('Avinash P.', 'AP-31', 'Avinash Pol'),
  ('Roshan T.', 'RT-13', 'Roshan Thakare'),
  ('Madhura B.', 'MB-42', 'Madhura Bhurke'),
  ('Dharma C.', 'DC-22', 'Dharmendra Chauhan'),
  ('Pratik M.', 'PM-29', 'Pratik More'),
  ('Archana P.', 'AD-44', 'Archana Palvi'),
  ('Anil C.', 'AC-36', 'Anil Chavan'),
  ('Umesh N.', 'UN-45', 'Umesh Nikam'),
  ('Mahesh C.', 'MC-38', 'Mahesh Chaumal'),
  ('Sahil K.', 'Sahil Kini', 'Sahil Kini'),
  ('Anthony R.', 'Anthony Ranjire', 'Anthony Ranjire')
ON CONFLICT (bc_buyer_code) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- TABLE 3 — BC BUYER ALIASES (for typo tolerance)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.bc_buyer_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alias TEXT UNIQUE NOT NULL,
  canonical_bc_code TEXT NOT NULL REFERENCES public.bc_buyer_mapping(bc_buyer_code) ON DELETE CASCADE,
  source TEXT DEFAULT 'admin_added',
  confirmed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_buyer_aliases_lookup
  ON public.bc_buyer_aliases(alias);

-- ═══════════════════════════════════════════════════════════════════════════
-- TABLE 4 — BC DATA QUALITY ALERTS
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.bc_data_quality_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type TEXT NOT NULL,
  bc_value TEXT,
  suggested_match TEXT,
  confidence_score INTEGER,
  bc_document_no TEXT,
  occurrence_count INTEGER DEFAULT 1,
  detected_at TIMESTAMPTZ DEFAULT now(),
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  resolved BOOLEAN DEFAULT false,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_dq_alerts_unresolved
  ON public.bc_data_quality_alerts(detected_at DESC)
  WHERE resolved = false;

CREATE INDEX IF NOT EXISTS idx_dq_alerts_type
  ON public.bc_data_quality_alerts(alert_type, resolved);

-- ═══════════════════════════════════════════════════════════════════════════
-- GRANTS
-- ═══════════════════════════════════════════════════════════════════════════
GRANT ALL PRIVILEGES ON public.bc_rig_mapping TO service_role, authenticated;
GRANT ALL PRIVILEGES ON public.bc_buyer_mapping TO service_role, authenticated;
GRANT ALL PRIVILEGES ON public.bc_buyer_aliases TO service_role, authenticated;
GRANT ALL PRIVILEGES ON public.bc_data_quality_alerts TO service_role, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION QUERIES
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'Rig mappings:' AS info, COUNT(*) AS count FROM public.bc_rig_mapping;
SELECT 'Buyer mappings:' AS info, COUNT(*) AS count FROM public.bc_buyer_mapping;
SELECT 'All 14 rigs present:' AS info,
  CASE WHEN COUNT(*) = 14 THEN 'YES' ELSE 'NO - MISSING RIGS' END AS status
  FROM public.bc_rig_mapping;
