-- =====================================================
-- v22: ACCOUNTS system buyer for auto-assignment
-- POs with unknown or empty BC buyer codes are auto-assigned to this entry
-- by the BC sync, so buyer_code is never left null.
-- =====================================================

-- Add ACCOUNTS as a system-level buyer code for auto-assignment
INSERT INTO public.bc_buyer_mapping
  (bc_buyer_code, jdil_buyer_code, full_name, active, notes)
VALUES
  ('ACCOUNTS.SYSTEM', 'ACCOUNTS', 'Accounts (Auto-assigned)', true,
   'System buyer for POs with unknown or empty BC buyer codes. Auto-assigned by BC sync.')
ON CONFLICT (bc_buyer_code) DO NOTHING;

-- Verify
SELECT * FROM public.bc_buyer_mapping WHERE jdil_buyer_code = 'ACCOUNTS';
