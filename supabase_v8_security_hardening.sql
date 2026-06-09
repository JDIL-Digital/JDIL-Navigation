-- =============================================
-- JDIL Navigation — v8 Security Hardening
-- Run in Supabase SQL Editor. Idempotent — safe to re-run.
-- =============================================

-- ── 1. AUDIT: list every public table, whether RLS is on, and its policy count
--    Run this SELECT first to see the current state.
-- SELECT t.tablename,
--        t.rowsecurity                              AS rls_enabled,
--        COUNT(p.policyname)                        AS policy_count
-- FROM pg_tables t
-- LEFT JOIN pg_policies p
--   ON p.schemaname = t.schemaname AND p.tablename = t.tablename
-- WHERE t.schemaname = 'public'
-- GROUP BY t.tablename, t.rowsecurity
-- ORDER BY t.tablename;

-- ── 2. Ensure RLS is ENABLED on every app table (no-op if already enabled) ────
ALTER TABLE public.po_orders        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.po_line_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendors          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings  ENABLE ROW LEVEL SECURITY;

-- ── 3. Notifications: allow the authenticated role to UPDATE its own rows ─────
--    (Mark-as-read also works via the server/service-role route, but this lets
--     the client update directly too. The RLS policy below scopes it to self.)
GRANT SELECT, INSERT, UPDATE ON public.notifications TO authenticated;

DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
CREATE POLICY "Users can update own notifications" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── Done ──────────────────────────────────────────────────────────────────────
-- After running, re-run the audit SELECT in section 1 and confirm every table
-- shows rls_enabled = true and policy_count >= 1.
