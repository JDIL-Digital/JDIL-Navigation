-- =====================================================
-- v23: Create ACCOUNTS user for auto-assigned BC POs
-- =====================================================
--
-- IMPORTANT — schema realities this migration had to account for:
--   * public.users columns are `name` / `is_active` (NOT full_name / active).
--   * public.users.id is UUID PRIMARY KEY REFERENCES auth.users(id) with NO
--     default — so a profile row CANNOT exist without a matching auth.users row.
--     A "login-less routing user" therefore needs an auth.users row too; it is
--     given a random (unguessable) password so no one can actually sign in.
--
-- Direct auth.users seeding is Supabase-version-sensitive. If the auth.users
-- INSERT below errors on a missing/NOT NULL column, use the FALLBACK instead:
--   1. Supabase Dashboard → Authentication → Add user:
--        email accounts@jindalmumbai.com, "Auto Confirm User" = on.
--   2. Then run ONLY the "public.users profile upsert" block at the bottom.
--
-- Requires the pgcrypto extension (enabled by default on Supabase).
-- =====================================================

DO $$
DECLARE
  v_id uuid;
BEGIN
  -- Reuse an existing auth user with this email, or create a login-less one.
  SELECT id INTO v_id FROM auth.users WHERE email = 'accounts@jindalmumbai.com';

  IF v_id IS NULL THEN
    v_id := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
      'accounts@jindalmumbai.com',
      crypt(gen_random_uuid()::text, gen_salt('bf')),   -- random: login impossible
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
    );
  END IF;

  -- Upsert the profile row keyed on the auth user id.
  INSERT INTO public.users (id, name, email, role, team_code, is_active)
  VALUES (v_id, 'Accounts Team', 'accounts@jindalmumbai.com', 'purchase', 'ACCOUNTS', true)
  ON CONFLICT (id) DO UPDATE
    SET name = 'Accounts Team', role = 'purchase', team_code = 'ACCOUNTS', is_active = true;
END $$;

-- =====================================================
-- FALLBACK — profile upsert only (run after creating the auth user via the
-- Dashboard, if the DO block above failed on the auth.users insert):
-- =====================================================
-- INSERT INTO public.users (id, name, email, role, team_code, is_active)
-- SELECT id, 'Accounts Team', 'accounts@jindalmumbai.com', 'purchase', 'ACCOUNTS', true
--   FROM auth.users WHERE email = 'accounts@jindalmumbai.com'
-- ON CONFLICT (id) DO UPDATE
--   SET name = 'Accounts Team', role = 'purchase', team_code = 'ACCOUNTS', is_active = true;

-- Verification
SELECT 'ACCOUNTS user:' AS info;
SELECT email, name, role, team_code, is_active
FROM public.users
WHERE team_code = 'ACCOUNTS';

-- Expected: 1 row with team_code='ACCOUNTS'
