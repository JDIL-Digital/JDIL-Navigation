# JDIL Navigation — Material Tracking System

**Jindal Drilling & Industries Ltd.**  
Full-stack PO tracking app: React 18 + Vite frontend, Node.js/Express backend, Supabase database & auth.

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Local Development](#local-development)
3. [Environment Variables](#environment-variables)
4. [Database Setup](#database-setup)
5. [Creating the First Admin](#creating-the-first-admin)
6. [Replit Deployment](#replit-deployment)
7. [User Roles](#user-roles)
8. [PO Status Pipeline](#po-status-pipeline)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + Tailwind CSS |
| Backend | Node.js + Express |
| Database & Auth | Supabase (PostgreSQL + Row Level Security) |
| Charts | Recharts |
| Map | Leaflet.js + OpenStreetMap / CARTO |
| PDF Export | jsPDF + jsPDF-AutoTable |
| Email | Nodemailer (Gmail) |
| Cron | node-cron (stale PO check, daily 8 AM) |

---

## Local Development

### Prerequisites
- Node.js ≥ 18
- A [Supabase](https://supabase.com) project

### 1. Clone & install

```bash
git clone https://github.com/JDIL-Digital/JDIL-Navigation.git
cd JDIL-Navigation

# Installs root devDependencies + client + server dependencies automatically
npm install
```

### 2. Configure environment variables

```bash
# Client — Supabase public keys (embedded at build time by Vite)
cp client/.env.example client/.env
# Edit client/.env with your Supabase URL and anon key

# Server — service role key + email credentials
cp server/.env.example server/.env
# Edit server/.env with all required values
```

### 3. Set up the database

Run the following SQL files **in order** in your Supabase SQL Editor:

```
supabase_schema.sql            ← Main schema, RLS policies, triggers
supabase_settings_migration.sql ← system_settings table
```

### 4. Run in development mode

```bash
npm run dev
# Client → http://localhost:5173
# Server → http://localhost:3001
# API proxy: /api/* is automatically forwarded to the server by Vite
```

---

## Environment Variables

### `client/.env`

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_public_key
```

> ⚠ These are embedded into the JS bundle at build time. Never put secret keys here.

### `server/.env`

```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SECRET_KEY=your_service_role_key

PORT=3001
NODE_ENV=development

# Optional — defaults to http://localhost:5173 if not set
APP_URL=https://your-replit-app.replit.app

# Gmail — use an App Password (not your account password)
# Generate at: myaccount.google.com → Security → App Passwords
EMAIL_USER=your-email@jindalmumbai.com
EMAIL_PASS=your_16_char_app_password
```

---

## Database Setup

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run `supabase_schema.sql` — creates all tables, indexes, RLS policies, and the `my_role()` helper function
3. Run `supabase_settings_migration.sql` — creates the `system_settings` table used by the Admin Panel and stale-check cron
4. Copy your **Project URL** and **anon/public key** from **Settings → API** into `client/.env`
5. Copy your **service_role key** (secret) from the same page into `server/.env`

---

## Creating the First Admin

Because all new registrations start as `is_active = false`, the very first admin account must be activated manually:

1. Open the app, go to `/register`, and register with **Role = Admin**
2. In Supabase → Table Editor → `users` table, find your row and set `is_active = true`
3. Log in — you now have full admin access
4. All future user registrations can be approved from the **Admin Panel → User Management** tab

---

## Replit Deployment

### One-time setup

1. **Import the repo** into Replit: *Create Repl → Import from GitHub → paste repo URL*

2. **Set Secrets** in Replit (the equivalent of `.env` files):

   Go to **Tools → Secrets** and add every variable from both `.env` files:

   | Secret Key | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://your-project-id.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | your Supabase anon key |
   | `SUPABASE_URL` | `https://your-project-id.supabase.co` |
   | `SUPABASE_SECRET_KEY` | your Supabase **service_role** key |
   | `NODE_ENV` | `production` |
   | `APP_URL` | your Replit app URL (e.g. `https://jdil-navigation.replit.app`) |
   | `EMAIL_USER` | your Gmail address |
   | `EMAIL_PASS` | your 16-character Gmail App Password |
   | `PORT` | `3001` |

3. **Build the React client** (run once, or whenever you update the frontend):

   Open the Replit Shell and run:
   ```bash
   npm run build
   ```
   This compiles the React app into `client/dist/`.

4. **Start the server**:

   Click the green **Run** button, or in Shell:
   ```bash
   npm start
   ```

   Express serves:
   - `POST/GET /api/*` — backend API
   - Everything else → `client/dist/index.html` (React SPA)

   Only **one port (3001)** is used. Replit exposes it publicly.

### Re-deploying after code changes

```bash
# Pull latest changes
git pull

# Rebuild the React client (only needed if frontend changed)
npm run build

# Restart the server
npm start
```

### Replit Deployments (always-on)

For a permanent always-on deployment, use **Replit Deployments**:

1. Click **Deploy** in the top-right of the Replit editor
2. Choose **Autoscale** or **Reserved VM**
3. Replit will run `npm run build` then `npm start` automatically

---

## User Roles

| Role | Access |
|---|---|
| `purchase` | Create POs, edit purchase-section fields (PO date, vendor, buyer code, etc.) |
| `logistics` | Edit logistics fields (DC numbers, dispatch date, JDIL location, transporter) |
| `rig` | Edit rig-delivery fields (in-transit date, delivered date) |
| `admin` | Full edit access on all fields; must provide a reason for every change; approves/rejects users |
| `csuite` | Read-only — full dashboard, all rigs, PDF export |

### Buyer Codes
`AP-31` · `RT-13` · `MP` · `MB-42` · `DC-22` · `PM-29` · `AD-44` · `AC-36` · `UN-45` · `MC-38`

### Logistics Codes
`SV-01` · `SS-02` · `AK-03` · `KT-04` · `MK-05` · `RS-06`

---

## PO Status Pipeline

Status is **auto-calculated** from whichever date/field has been filled in — it is never set manually.

```
MR Created
  └─ PO Released            (po_number filled)
       └─ Buyer Assigned    (buyer_code filled)
            └─ Vendor Confirmed        (vendor_confirmed_date)
                 └─ Material Ready at Vendor  (material_ready_date)
                      └─ Dispatched from Vendor    (dc_number_* filled)
                           └─ In Transit to JDIL   (dispatch_date)
                                └─ At JDIL Location     (jdil_location)
                                     └─ In Transit to Rig    (in_transit_rig_date)
                                          └─ Delivered to Rig (delivered_to_rig_date)
```

**Overdue rule:** POs open for more than the configured threshold (default 45 days) are flagged as stale. The daily cron job at 8 AM emails all C-Suite users and any additional addresses configured in **Admin Panel → System Settings**.

---

## Email Notifications

Automated emails are sent for:

| Event | Recipients |
|---|---|
| New PO created | All active logistics users |
| Status transitions (Purchase → Logistics) | All active logistics users |
| Status transitions (Logistics → Rig) | Rig users for that rig + logistics users |
| Overdue / stale PO alert (daily) | All C-Suite users + `alert_emails` in System Settings |
| Account approved | The approved user |
| New user registration | All active admin users |

---

*© 2026 Jindal Drilling & Industries Ltd. Internal use only.*
