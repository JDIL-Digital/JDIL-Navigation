-- =============================================
-- JDIL Navigation — Supabase Schema
-- Run this in Supabase SQL Editor
-- =============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- USERS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.users (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  email       TEXT UNIQUE NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('purchase', 'logistics', 'rig', 'admin', 'csuite')),
  team_code   TEXT,
  rig_name    TEXT,
  is_active   BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile" ON public.users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON public.users
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Admins can read all users" ON public.users
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can update users" ON public.users
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
  );

-- =============================================
-- PO_ORDERS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.po_orders (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mr_number               TEXT,
  po_number               TEXT UNIQUE,
  po_date                 DATE,
  promised_ready_date     DATE,
  rig_name                TEXT,
  vendor_name             TEXT,
  buyer_code              TEXT,
  material_description    TEXT,
  material_description_2  TEXT,
  delivery_mode           TEXT CHECK (delivery_mode IN ('OSV', 'CCB', 'CCC', 'Road', NULL)),
  vendor_confirmed_date   DATE,
  material_ready_date     DATE,
  dispatch_date           DATE,
  dc_number_bkc           TEXT,
  dc_number_taloja        TEXT,
  dc_number_nagothane     TEXT,
  dc_number_nhava         TEXT,
  transporter_details     TEXT,
  jdil_location           TEXT,
  in_transit_rig_date     DATE,
  delivered_to_rig_date   DATE,
  status                  TEXT DEFAULT 'MR Created',
  days_elapsed            INTEGER DEFAULT 0,
  is_stale                BOOLEAN DEFAULT FALSE,
  remarks                 TEXT,
  other_remarks           TEXT,
  created_by              UUID REFERENCES public.users(id),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.po_orders ENABLE ROW LEVEL SECURITY;

-- All active users can read all POs
CREATE POLICY "Active users can read POs" ON public.po_orders
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_active = TRUE)
  );

-- Purchase and admin can insert
CREATE POLICY "Purchase and admin can insert POs" ON public.po_orders
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('purchase', 'admin') AND is_active = TRUE)
  );

-- Role-based update policies
CREATE POLICY "Purchase can update purchase fields" ON public.po_orders
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('purchase', 'admin') AND is_active = TRUE)
  );

-- =============================================
-- AUDIT_LOG TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.audit_log (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id         UUID REFERENCES public.po_orders(id) ON DELETE CASCADE,
  changed_by    UUID REFERENCES public.users(id),
  field_changed TEXT NOT NULL,
  old_value     TEXT,
  new_value     TEXT,
  reason        TEXT NOT NULL,
  changed_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read audit log" ON public.audit_log
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can insert audit log" ON public.audit_log
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
  );

-- =============================================
-- NOTIFICATIONS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES public.users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('new_po', 'status_change', 'overdue', 'approval')),
  title       TEXT NOT NULL,
  message     TEXT,
  is_read     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own notifications" ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id);

-- Server-side insert (service role bypasses RLS anyway)
CREATE POLICY "Service role can insert notifications" ON public.notifications
  FOR INSERT WITH CHECK (TRUE);

-- =============================================
-- ENABLE REALTIME
-- =============================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.po_orders;

-- =============================================
-- INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_po_orders_rig_name ON public.po_orders(rig_name);
CREATE INDEX IF NOT EXISTS idx_po_orders_status ON public.po_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_orders_is_stale ON public.po_orders(is_stale);
CREATE INDEX IF NOT EXISTS idx_po_orders_buyer_code ON public.po_orders(buyer_code);
CREATE INDEX IF NOT EXISTS idx_audit_log_po_id ON public.audit_log(po_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON public.notifications(is_read);

-- =============================================
-- FUNCTION: auto-update updated_at on po_orders
-- =============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER po_orders_updated_at
  BEFORE UPDATE ON public.po_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
