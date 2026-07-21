#!/bin/bash
set -e

# Install dependencies (no-op when already up to date)
npm install --prefix server --no-audit --no-fund
npm install --prefix server ws --no-audit --no-fund
npm install --prefix client --no-audit --no-fund

# Re-apply Node 20 ws realtime-transport patch if a merge overwrote it
if ! grep -q "require('ws')" server/utils/supabaseAdmin.js; then
  cat > server/utils/supabaseAdmin.js <<'EOF'
const { createClient } = require('@supabase/supabase-js')
const ws = require('ws')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  }
)

module.exports = { supabase }
EOF
fi

# Rebuild the React client (server serves client/dist in production)
npm run build --prefix client
