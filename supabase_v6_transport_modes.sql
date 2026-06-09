-- =============================================
-- JDIL Navigation — v6 Migration: Mode of Transport options
-- Run in Supabase SQL Editor (order vs the received-fields migration doesn't matter)
-- =============================================

-- CHANGE 4 — restrict mode_of_transport to OSV / CCB / CCC / Road/Courier
ALTER TABLE public.po_orders
  DROP CONSTRAINT IF EXISTS po_orders_mode_of_transport_check;

-- Migrate any pre-existing values so the new constraint won't reject them:
--   Road, Courier  → 'Road/Courier'
--   Air, Sea        → NULL (those options were removed)
UPDATE public.po_orders SET mode_of_transport = 'Road/Courier'
  WHERE mode_of_transport IN ('Road', 'Courier');
UPDATE public.po_orders SET mode_of_transport = NULL
  WHERE mode_of_transport IN ('Air', 'Sea');

ALTER TABLE public.po_orders
  ADD CONSTRAINT po_orders_mode_of_transport_check
    CHECK (mode_of_transport IS NULL
           OR mode_of_transport IN ('OSV', 'CCB', 'CCC', 'Road/Courier'));
