-- ═══════════════════════════════════════════════════════════════════════════
-- supabase_v20_buyer_format_update.sql
-- Updates bc_buyer_mapping.bc_buyer_code to Business Central's actual format
-- (UPPERCASE, dot-separated, no spaces) so BC values match on lookup.
-- The buyer lookup also normalizes case/format at runtime, but storing the real
-- BC format keeps the mapping table accurate and readable.
-- Run this whole file once in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE public.bc_buyer_mapping SET bc_buyer_code = 'AVINASH.P' WHERE jdil_buyer_code = 'AP-31';
UPDATE public.bc_buyer_mapping SET bc_buyer_code = 'ROSHAN.T'  WHERE jdil_buyer_code = 'RT-13';
UPDATE public.bc_buyer_mapping SET bc_buyer_code = 'MADHURA.B' WHERE jdil_buyer_code = 'MB-42';
UPDATE public.bc_buyer_mapping SET bc_buyer_code = 'DHARMA.C'  WHERE jdil_buyer_code = 'DC-22';
UPDATE public.bc_buyer_mapping SET bc_buyer_code = 'PRATIK.M'  WHERE jdil_buyer_code = 'PM-29';
UPDATE public.bc_buyer_mapping SET bc_buyer_code = 'ARCHANA.P' WHERE jdil_buyer_code = 'AD-44';
UPDATE public.bc_buyer_mapping SET bc_buyer_code = 'ANIL.C'    WHERE jdil_buyer_code = 'AC-36';
UPDATE public.bc_buyer_mapping SET bc_buyer_code = 'UMESH.N'   WHERE jdil_buyer_code = 'UN-45';
UPDATE public.bc_buyer_mapping SET bc_buyer_code = 'MAHESH.C'  WHERE jdil_buyer_code = 'MC-38';
UPDATE public.bc_buyer_mapping SET bc_buyer_code = 'SAHIL.K'   WHERE jdil_buyer_code = 'Sahil Kini';
UPDATE public.bc_buyer_mapping SET bc_buyer_code = 'ANTHONY.R' WHERE jdil_buyer_code = 'Anthony Ranjire';

-- Verify
SELECT bc_buyer_code, jdil_buyer_code, full_name FROM public.bc_buyer_mapping ORDER BY jdil_buyer_code;
