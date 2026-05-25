-- ─── System Settings Table ───────────────────────────────────────────────────
-- Run this in Supabase SQL Editor once to enable the System Settings tab.

CREATE TABLE IF NOT EXISTS public.system_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Default values (skipped if row already exists)
INSERT INTO public.system_settings (key, value) VALUES
  ('overdue_threshold_days',      '45'),
  ('alert_emails',                '[]'),
  ('email_notifications_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

-- Enable Row Level Security
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- Admins and c-suite can read settings
CREATE POLICY "settings_read"
  ON public.system_settings FOR SELECT
  USING (public.my_role() IN ('admin', 'csuite'));

-- Only admins can insert / update / delete
CREATE POLICY "settings_write"
  ON public.system_settings FOR ALL
  USING (public.my_role() = 'admin')
  WITH CHECK (public.my_role() = 'admin');
