-- =============================================
-- JDIL Navigation — v5 Migration: Vendors
-- Run in Supabase SQL Editor AFTER supabase_v3_lineitems.sql
--
-- Master vendor list (~5000 rows) powering autocomplete on the New PO form
-- and PO detail panel, plus the Admin → Vendors management tab.
-- =============================================

-- Trigram extension for fast case-insensitive ILIKE '%...%' searches
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS public.vendors (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  phone          TEXT,
  contact_person TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

-- ── Indexes for efficient search at 5000+ rows ────────────────────────────────
-- GIN trigram index makes ILIKE '%query%' fast regardless of row count.
CREATE INDEX IF NOT EXISTS idx_vendors_name_trgm ON public.vendors USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_vendors_is_active ON public.vendors (is_active);
-- Unique index on name so bulk upserts can dedupe via ON CONFLICT (name).
-- (PostgREST upsert onConflict requires a unique index on the exact column.)
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_name_unique ON public.vendors (name);

-- ── Grants ────────────────────────────────────────────────────────────────────
GRANT ALL PRIVILEGES ON public.vendors TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendors TO authenticated;

-- ── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read vendors" ON public.vendors;
CREATE POLICY "Authenticated can read vendors" ON public.vendors
  FOR SELECT USING (auth.role() = 'authenticated');

-- Writes go through the server (service_role) which bypasses RLS; this policy
-- additionally allows admins to write directly if ever needed.
DROP POLICY IF EXISTS "Admins can manage vendors" ON public.vendors;
CREATE POLICY "Admins can manage vendors" ON public.vendors
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin' AND is_active = TRUE))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin' AND is_active = TRUE));

-- ── Auto-update updated_at ────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS vendors_updated_at ON public.vendors;
CREATE TRIGGER vendors_updated_at
  BEFORE UPDATE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Done ──────────────────────────────────────────────────────────────────────
-- Bulk upload upserts on lower(name): existing vendors get phone/contact updated,
-- new names are inserted. See POST /api/vendors/bulk.
