-- ═══════════════════════════════════════════════════════════════════════════
-- supabase_v17_grace_period.sql
-- 3-layer alert safety rebuild:
--   1. alert_send_log table  — per-recipient summary-email tracking (replaces
--      per-PO last_stale_alert_sent throttling)
--   2. Grace-period columns  — currently-stale backlog is marked "known" so it
--      does NOT trigger alert emails (still counts in Dashboard KPIs)
-- Run this whole file once in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. alert_send_log — one row per summary email sent ──────────────────────
CREATE TABLE IF NOT EXISTS public.alert_send_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_email TEXT NOT NULL,
  summary_type TEXT NOT NULL, -- 'buyer_summary', 'pinto_unassigned', 'pinto_master', 'logistics_summary', 'moorthy_unassigned', 'moorthy_master'
  po_count INTEGER NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT now(),
  cron_run_time TEXT -- '9am', '1pm', '6pm'
);

CREATE INDEX IF NOT EXISTS idx_alert_log_recipient ON public.alert_send_log(recipient_email, sent_at DESC);

GRANT ALL PRIVILEGES ON public.alert_send_log TO service_role, authenticated;

-- ── 2. Grace-period columns on po_orders ─────────────────────────────────────
ALTER TABLE public.po_orders
  ADD COLUMN IF NOT EXISTS alert_grace_period BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS grace_period_reason TEXT,
  ADD COLUMN IF NOT EXISTS grace_period_set_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS grace_period_set_by TEXT;

CREATE INDEX IF NOT EXISTS idx_po_grace ON public.po_orders(alert_grace_period) WHERE alert_grace_period = true;

GRANT ALL PRIVILEGES ON public.po_orders TO service_role, authenticated;

-- ── 3. BACKFILL: mark all currently stuck POs as grace-period ────────────────
UPDATE public.po_orders
SET
  alert_grace_period = true,
  grace_period_reason = 'Initial backlog at system launch',
  grace_period_set_at = now(),
  grace_period_set_by = 'system'
WHERE
  (
    status IN ('MR Created','PO Released','Buyer Assigned','Vendor Confirmed')
    AND (
      (promised_ready_date IS NOT NULL AND (CURRENT_DATE - promised_ready_date) >= 45)
      OR (promised_ready_date IS NULL AND po_date IS NOT NULL AND (CURRENT_DATE - po_date) >= 45)
    )
  )
  OR
  (
    status IN ('At JDIL Location','Dispatched from JDIL','In Transit to JDIL','In Transit to Rig')
    AND delivered_to_rig_date IS NULL
    AND (
      (promised_ready_date IS NOT NULL AND (CURRENT_DATE - promised_ready_date) >= 45)
      OR (promised_ready_date IS NULL AND po_date IS NOT NULL AND (CURRENT_DATE - po_date) >= 45)
    )
  );

-- ── 4. Verify ─────────────────────────────────────────────────────────────────
SELECT COUNT(*) AS grace_period_pos FROM public.po_orders WHERE alert_grace_period = true;
