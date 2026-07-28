---
name: GitHub sync workflow
description: How to sync with the JDIL-Navigation GitHub repo and what to preserve
---

As of July 28, 2026, GitHub main contains all local production fixes (Node 20 ws transport + ws dep, SEO middleware/lazy loading/robots.txt, grace-period labels) — histories were merged (`--allow-unrelated-histories`) and pushed, so local main and origin/main share history now. Plain `gitPull`/`gitPush` (git-remote skill callbacks, which carry GitHub credentials) work; the old tarball workflow is no longer needed.

**Pulling latest code:**
1. Prefer the `gitPull` callback. Anonymous access (tarball/`git fetch` from shell) returns 404/auth errors whenever the user makes the repo private — use the authenticated callbacks instead.
2. Never overwrite the workspace `.replit` (owned by Replit tooling; direct edits are blocked).
3. `gitPush({branch})` pushes the *current local branch*; it cannot push a differently named local branch onto an existing remote branch (returns BRANCH_ALREADY_EXISTS).

**After pulling:**
- Verify `server/utils/supabaseAdmin.js` still has `const ws = require('ws')` + `realtime: { transport: ws }` and `ws` in server/package.json — if upstream teammates edit that file without the fix, the server crash-loops on Node 20 ("Node.js 20 detected without native WebSocket support"). Deployments install only from package.json, so a workspace-only `ws` install crash-loops production.
- `npm install` in /server and /client, `npm run build` in /client (server serves client/dist in production), restart "Start application", verify HTTP 200 on :5000 and /api/health.
- The post-merge script `scripts/post-merge.sh` automates deps + patch + rebuild for task merges.

Other notes:
- Supabase VITE_ keys are embedded at build time — client must be rebuilt after they change.
- Upstream ships SQL migrations (supabase_vN_*.sql); remind the user to run new ones against Supabase.
- User originally asked for port 3001, but Replit webview requires 5000; workflow runs `PORT=5000 NODE_ENV=production node server/index.js`.
