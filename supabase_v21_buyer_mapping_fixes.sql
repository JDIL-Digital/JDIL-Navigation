-- =====================================================
-- v21: BC buyer mapping comprehensive fix
-- Based on real production data findings
-- =====================================================

-- Step 1: Update existing buyers to BC full-name format
UPDATE public.bc_buyer_mapping
  SET bc_buyer_code = 'AVINASH.POL'
  WHERE jdil_buyer_code = 'AP-31';

UPDATE public.bc_buyer_mapping
  SET bc_buyer_code = 'ROSHAN.THAKARE'
  WHERE jdil_buyer_code = 'RT-13';

UPDATE public.bc_buyer_mapping
  SET bc_buyer_code = 'MADHURA.BHURKE'
  WHERE jdil_buyer_code = 'MB-42';

UPDATE public.bc_buyer_mapping
  SET bc_buyer_code = 'DHARMA.CHAUHAN'
  WHERE jdil_buyer_code = 'DC-22';

UPDATE public.bc_buyer_mapping
  SET bc_buyer_code = 'PRATIK.MORE'
  WHERE jdil_buyer_code = 'PM-29';

UPDATE public.bc_buyer_mapping
  SET bc_buyer_code = 'ARCHANA.DALVI',
      full_name = 'Archana Dalvi'
  WHERE jdil_buyer_code = 'AD-44';

UPDATE public.bc_buyer_mapping
  SET bc_buyer_code = 'ANIL.CHAVAN'
  WHERE jdil_buyer_code = 'AC-36';

UPDATE public.bc_buyer_mapping
  SET bc_buyer_code = 'UMESH.NIKAM'
  WHERE jdil_buyer_code = 'UN-45';

UPDATE public.bc_buyer_mapping
  SET bc_buyer_code = 'MAHESH.CHAUMAL'
  WHERE jdil_buyer_code = 'MC-38';

-- Step 2: Fix Sahil Kini and Anthony Ranjire with proper codes
UPDATE public.bc_buyer_mapping
  SET bc_buyer_code = 'SAHIL.KINI'
  WHERE full_name = 'Sahil Kini';

UPDATE public.bc_buyer_mapping
  SET bc_buyer_code = 'ANTHONY.RANJIRE'
  WHERE full_name = 'Anthony Ranjire';

-- Step 3: Add short-form aliases
-- BC sometimes uses "DHARMA.C" instead of "DHARMA.CHAUHAN"
-- These aliases handle that variation

INSERT INTO public.bc_buyer_aliases (alias, canonical_bc_code, source, confirmed) VALUES
  ('AVINASH.P', 'AVINASH.POL', 'admin_added', true),
  ('ROSHAN.T', 'ROSHAN.THAKARE', 'admin_added', true),
  ('MADHURA.B', 'MADHURA.BHURKE', 'admin_added', true),
  ('DHARMA.C', 'DHARMA.CHAUHAN', 'admin_added', true),
  ('PRATIK.M', 'PRATIK.MORE', 'admin_added', true),
  ('ARCHANA.D', 'ARCHANA.DALVI', 'admin_added', true),
  ('ANIL.C', 'ANIL.CHAVAN', 'admin_added', true),
  ('UMESH.N', 'UMESH.NIKAM', 'admin_added', true),
  ('MAHESH.C', 'MAHESH.CHAUMAL', 'admin_added', true),
  ('SAHIL.K', 'SAHIL.KINI', 'admin_added', true),
  ('ANTHONY.R', 'ANTHONY.RANJIRE', 'admin_added', true)
ON CONFLICT (alias) DO NOTHING;

-- Step 4: Verification
SELECT 'Buyer mappings after update:' AS info;
SELECT bc_buyer_code, jdil_buyer_code, full_name, active
FROM public.bc_buyer_mapping
ORDER BY jdil_buyer_code;

SELECT 'Buyer aliases:' AS info;
SELECT alias, canonical_bc_code, confirmed
FROM public.bc_buyer_aliases
ORDER BY canonical_bc_code;

-- Expected final count:
-- bc_buyer_mapping: 11 rows (9 procurement + 2 fixed)
-- bc_buyer_aliases: 11 rows (one per buyer, short-form)
