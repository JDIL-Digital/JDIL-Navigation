---
name: GitHub sync workflow
description: How to pull latest code from the JDIL-Navigation GitHub repo and what to preserve
---

Direct git commands (fetch/pull/merge/reset) are blocked for the main agent in this environment.

**How to pull latest code:**
1. Download tarball: `curl -sL https://github.com/JDIL-Digital/JDIL-Navigation/archive/refs/heads/main.tar.gz` (404 means the repo was made private again — ask the user to make it public).
2. Extract to /tmp, diff against workspace to see real changes.
3. `rm -f .replit` in the extracted dir, then `cp -rf . /home/runner/workspace/` — never overwrite the workspace `.replit` (owned by Replit tooling; direct edits are also blocked).

**After every pull, re-apply the ws patch:**
Upstream `server/utils/supabaseAdmin.js` lacks the Node 20 fix. Without it the server crashes: "Node.js 20 detected without native WebSocket support." Re-add `const ws = require('ws')` and `realtime: { transport: ws }` to createClient, and ensure `ws` is installed in /server.
**Why:** Repl runs Node 20; @supabase/realtime-js requires native WebSocket (Node 22+) or an explicit ws transport.

**Then:** `npm install` in /server and /client, `npm run build` in /client (server serves client/dist in production), restart the "Start application" workflow, verify HTTP 200 on :5000 and /api/health.

The post-merge script `scripts/post-merge.sh` automates deps + patch + rebuild for task merges.

Other notes:
- Supabase VITE_ keys are embedded at build time — client must be rebuilt after they change.
- Upstream ships SQL migrations (supabase_vN_*.sql); remind the user to run new ones against Supabase.
- User originally asked for port 3001, but Replit webview requires 5000; workflow runs `PORT=5000 NODE_ENV=production node server/index.js`.
