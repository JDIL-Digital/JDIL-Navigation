-- =============================================
-- JDIL Navigation — PO Orders Table Patch
-- Run this in Supabase SQL Editor BEFORE
-- creating new POs with the updated form.
-- =============================================

-- 1. Add vendor contact columns (safe to run even if they already exist)
ALTER TABLE public.po_orders
  ADD COLUMN IF NOT EXISTS vendor_contact_name TEXT,
  ADD COLUMN IF NOT EXISTS vendor_phone_number TEXT;

-- 2. Fix the delivery_mode CHECK constraint.
--    The original only allowed OSV/CCB/CCC/Road — now using Vendor Delivery / JDIL Pickup.
--
--    Find the constraint name first (it's auto-named by Postgres):
--      SELECT conname FROM pg_constraint
--      WHERE conrelid = 'public.po_orders'::regclass AND contype = 'c' AND conname LIKE '%delivery%';
--
--    Then drop it and replace with the new allowed values:

DO $$
DECLARE
  v_constraint TEXT;
BEGIN
  SELECT conname INTO v_constraint
  FROM pg_constraint
  WHERE conrelid = 'public.po_orders'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%delivery_mode%';

  IF v_constraint IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.po_orders DROP CONSTRAINT ' || quote_ident(v_constraint);
    RAISE NOTICE 'Dropped constraint: %', v_constraint;
  ELSE
    RAISE NOTICE 'No delivery_mode constraint found — skipping drop.';
  END IF;
END $$;

-- Add the new constraint with updated allowed values
ALTER TABLE public.po_orders
  ADD CONSTRAINT po_orders_delivery_mode_check
  CHECK (delivery_mode IN ('Vendor Delivery', 'JDIL Pickup', NULL));
