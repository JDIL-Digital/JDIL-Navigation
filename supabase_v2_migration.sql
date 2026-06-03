-- =============================================
-- JDIL Navigation — v2 Migration
-- Run this in Supabase SQL Editor AFTER supabase_schema.sql
-- =============================================

-- ── 1. New columns on po_orders ───────────────────────────────────────────────

-- Issue 2: Quantity / Weight (purchase section)
ALTER TABLE public.po_orders
  ADD COLUMN IF NOT EXISTS quantity_weight TEXT;

-- Issue 3/5: Material Collection Location
--   (replaces material_ready_date semantically; kept as text not date)
ALTER TABLE public.po_orders
  ADD COLUMN IF NOT EXISTS material_collection_location TEXT;

-- Issue 5: Mode of Transport
ALTER TABLE public.po_orders
  ADD COLUMN IF NOT EXISTS mode_of_transport TEXT
    CHECK (mode_of_transport IN ('Road', 'Air', 'Sea', 'Courier', NULL));

-- Issue 5: Vendor contact fields (if not already present)
ALTER TABLE public.po_orders
  ADD COLUMN IF NOT EXISTS vendor_contact_name   TEXT;
ALTER TABLE public.po_orders
  ADD COLUMN IF NOT EXISTS vendor_phone_number   TEXT;

-- Fix delivery_mode constraint to match UI values
ALTER TABLE public.po_orders
  DROP CONSTRAINT IF EXISTS po_orders_delivery_mode_check;
ALTER TABLE public.po_orders
  ADD CONSTRAINT po_orders_delivery_mode_check
    CHECK (delivery_mode IN ('Vendor Delivery', 'JDIL Pickup', 'OSV', 'CCB', 'CCC', 'Road', NULL));

-- ── 2. Fix RLS — grant authenticated role table-level access ──────────────────
-- Issue 7: Supabase requires both a GRANT and an RLS policy.
-- The service role key bypasses RLS, but explicit grants prevent edge-case errors.

GRANT SELECT, INSERT, UPDATE ON public.po_orders TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.po_orders TO anon;

-- ── 3. Fix UPDATE policy — allow logistics and rig roles to update their fields
-- Drop old restrictive policy and replace with a permissive one.
-- Field-level enforcement is handled in the server middleware (fieldPermissions.js).

DROP POLICY IF EXISTS "Purchase can update purchase fields" ON public.po_orders;

CREATE POLICY "Active users can update POs" ON public.po_orders
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND role IN ('purchase', 'logistics', 'rig', 'admin')
        AND is_active = TRUE
    )
  );

-- ── 4. Ensure audit_log grants are also in place ──────────────────────────────
GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT SELECT, INSERT ON public.notifications TO authenticated;

-- ── Done ──────────────────────────────────────────────────────────────────────
-- After running this migration:
-- 1. The new columns are available in po_orders
-- 2. Logistics + rig users can now UPDATE po_orders through RLS
-- 3. The server-side field permissions (fieldPermissions.js) still enforce
--    which FIELDS each role may edit — this is the main security layer
