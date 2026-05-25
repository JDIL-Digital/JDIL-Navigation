-- =============================================
-- JDIL Navigation — RLS Policy Fix
-- Run this in Supabase SQL Editor to fix the
-- infinite recursion that causes 500 errors.
-- =============================================

-- PROBLEM: The original admin policies query public.users inside a policy
-- ON public.users, creating infinite recursion → 500 on every profile fetch.
--
-- FIX: A SECURITY DEFINER helper function bypasses RLS when checking the
-- caller's role, breaking the recursion.

-- Step 1: Create a helper function that reads the current user's role
-- without triggering RLS (SECURITY DEFINER runs as the function owner).
CREATE OR REPLACE FUNCTION public.my_role()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM public.users WHERE id = auth.uid()
$$;

-- Step 2: Drop the recursive policies
DROP POLICY IF EXISTS "Admins can read all users"  ON public.users;
DROP POLICY IF EXISTS "Admins can update users"    ON public.users;

-- Also drop the recursive policies on other tables if they exist
DROP POLICY IF EXISTS "Active users can read POs"             ON public.po_orders;
DROP POLICY IF EXISTS "Purchase and admin can insert POs"     ON public.po_orders;
DROP POLICY IF EXISTS "Purchase can update purchase fields"   ON public.po_orders;
DROP POLICY IF EXISTS "Admins can read audit log"             ON public.audit_log;
DROP POLICY IF EXISTS "Admins can insert audit log"           ON public.audit_log;

-- Step 3: Recreate policies using the non-recursive helper

-- users table
CREATE POLICY "Admins can read all users" ON public.users
  FOR SELECT USING (public.my_role() = 'admin');

CREATE POLICY "Admins can update users" ON public.users
  FOR UPDATE USING (public.my_role() = 'admin');

-- po_orders table
CREATE POLICY "Active users can read POs" ON public.po_orders
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND is_active = TRUE
    )
  );

CREATE POLICY "Purchase and admin can insert POs" ON public.po_orders
  FOR INSERT WITH CHECK (
    public.my_role() IN ('purchase', 'admin')
    AND EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_active = TRUE)
  );

CREATE POLICY "All roles can update POs" ON public.po_orders
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_active = TRUE)
  );

-- audit_log table
CREATE POLICY "Admins can read audit log" ON public.audit_log
  FOR SELECT USING (public.my_role() = 'admin');

CREATE POLICY "Admins can insert audit log" ON public.audit_log
  FOR INSERT WITH CHECK (public.my_role() = 'admin');
