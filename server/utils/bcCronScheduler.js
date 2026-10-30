/**
 * bcCronScheduler.js — automated BC sync on a schedule.
 *
 * Runs the full BC → staging pipeline for all 14 rigs sequentially, 30s apart,
 * twice a day (09:00 and 18:00 IST). Promotion to po_orders happens ONLY when
 * BC_SYNC_ENABLED=true; otherwise the cron stages data for admin review and
 * leaves po_orders untouched.
 *
 * Scheduling is registered only when BC_CRON_ENABLE=true OR NODE_ENV=production
 * (see initializeScheduler + server/index.js). The manual "Run Sync Now" button
 * calls runFullSync() directly regardless of the schedule.
 *
 * Safety:
 *   • One run at a time — a DB guard (status='running' master row) plus an
 *     in-process flag prevent concurrent/overlapping syncs.
 *   • Per-rig errors are caught; the run continues with the next rig.
 *   • 50%+ rigs failing marks the whole run 'failed'; any failure → 'partial_failure'.
 */

const cron = require('node-cron')
const { supabase } = require('./supabaseAdmin')
const { stageRig, promoteRun } = require('./bcSyncService')

// 15 rig prefixes, iterated in order. Matches RIG_PREFIX_OPTIONS in the client.
const RIG_PREFIXES = ['RD1', 'RD1DD', 'RV1', 'RV1DD', 'RJS', 'RJSDD', 'RJE', 'RJEDD', 'RJSUP', 'RJSUPDD', 'MLU', 'DDD', 'TAWS', 'RIG', 'RGEN']
const FISCAL_YEARS = ['2627', '2728']         // current + next
const RIG_DELAY_MS = 30_000                     // be gentle on BC between rigs
const STALE_RUN_MS = 90 * 60_000                // a 'running' row older than this is treated as stale (kept well above the timeout)
const PROMOTE_BATCH = 1000                      // promote all eligible INSERTs per rig run
const SYNC_TIMEOUT_MS = 60 * 60_000             // whole-run ceiling — stop between rigs if exceeded

const sleep = ms => new Promise(r => setTimeout(r, ms))

let _task = null                                // node-cron task handle (null until initialized)
let _scheduled = false
let _busy = false                               // synchronous guard against a double-fire before _current is set
// In-memory progress for the live "Syncing rig X of 14" UI (not persisted).
let _current = null   // { running, sync_run_id, triggered_by, started_at, total_rigs, rig_index, current_rig, per_rig: [] }

// ── Next-run computation (IST = UTC+5:30, no DST) ──────────────────────────────
function nextRunISO() {
  const now = Date.now()
  const istShift = 330 * 60_000
  const istNow = new Date(now + istShift)   // IST wall-clock expressed in UTC fields
  const out = []
  for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
    for (const h of [9, 18]) {
      const istWall = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() + dayOffset, h, 0, 0)
      out.push(istWall - istShift)            // back to real UTC epoch
    }
  }
  const next = out.filter(t => t > now).sort((a, b) => a - b)[0]
  return next ? new Date(next).toISOString() : null
}

// Which scheduled slot is firing right now, by IST hour.
function slotLabel() {
  const istHour = new Date(Date.now() + 330 * 60_000).getUTCHours()
  return istHour < 12 ? 'cron-9am' : 'cron-6pm'
}

// ── Concurrency guard (survives restarts via the DB) ───────────────────────────
// Finds any status='running' rows and tells which (if any) is still FRESH, i.e.
// younger than STALE_RUN_MS. A fresh one means a sync is genuinely in progress;
// older ones are leftovers from a crashed run and can be cleared.
async function freshRunningRun() {
  const { data } = await supabase
    .from('bc_sync_runs').select('id, started_at')
    .eq('status', 'running')
    .order('started_at', { ascending: false })
  const rows = data || []
  const fresh = rows.find(r => (Date.now() - new Date(r.started_at).getTime()) < STALE_RUN_MS) || null
  return { fresh, allRunning: rows }
}

// Read-only lock check for the route (no mutations). Returns whether a sync is
// genuinely running and, if so, which run id.
async function peekLock() {
  if (_busy || _current?.running) return { blocked: true, existing_run_id: _current?.sync_run_id || null }
  const { fresh } = await freshRunningRun()
  return fresh ? { blocked: true, existing_run_id: fresh.id } : { blocked: false }
}

// ── The full sync ──────────────────────────────────────────────────────────────
/**
 * Sync all rigs sequentially under a single master bc_sync_runs row.
 * @param {string} triggeredBy  label: 'cron-9am' | 'cron-6pm' | 'manual-admin-<uuid>'
 * @param {string|null} userId  users(id) to stamp on promoted po_orders (null for cron)
 */
async function runFullSync(triggeredBy = 'cron', userId = null) {
  // Synchronous guard first: closes the race between two fire-and-forget triggers
  // that both arrive before _current is set by the DB round-trip below.
  if (_busy || _current?.running) {
    console.warn('[cron-sync] a sync is already running — skipping this trigger')
    return { skipped: true, reason: 'concurrent_sync_running', existing_run_id: _current?.sync_run_id || null }
  }
  _busy = true

  const promoteEnabled = process.env.BC_SYNC_ENABLED === 'true'
  const startedAt = Date.now()
  let runId = null
  let timer = null

  try {
    // DB-backed lock (survives restarts). A FRESH running row blocks us; stale
    // ones (crashed runs) are marked 'stale' so they never block permanently.
    const { fresh, allRunning } = await freshRunningRun()
    if (fresh) {
      console.warn(`[cron-sync] a sync is already running (run ${fresh.id}) — skipping this trigger`)
      return { skipped: true, reason: 'concurrent_sync_running', existing_run_id: fresh.id }
    }
    for (const r of allRunning) {
      await supabase.from('bc_sync_runs').update({
        status: 'stale', completed_at: new Date().toISOString(),
        error_message: 'Marked stale — running >90 min with no completion',
      }).eq('id', r.id)
      console.warn(`[cron-sync] marked stale run ${r.id} (crashed/abandoned)`)
    }

    // Master run row (rig_filter='ALL'). triggered_by is UUID — store the admin id
    // when we have one; the human-readable label goes in trigger_source (v28).
    const { data: run, error: runErr } = await supabase
      .from('bc_sync_runs')
      .insert({
        triggered_by: userId || null,
        trigger_source: triggeredBy,
        rig_filter: 'ALL',
        fiscal_years: FISCAL_YEARS.join(','),
        status: 'running',
      })
      .select().single()
    if (runErr) {
      console.error('[cron-sync] could not create master run:', runErr.message)
      return { error: `Could not create sync run: ${runErr.message}` }
    }
    runId = run.id

    _current = {
      running: true, sync_run_id: runId, triggered_by: triggeredBy, started_at: new Date(startedAt).toISOString(),
      total_rigs: RIG_PREFIXES.length, rig_index: 0, current_rig: null, promote_enabled: promoteEnabled, per_rig: [],
    }

    // Whole-run timeout: a flag flipped after SYNC_TIMEOUT_MS, checked between rigs.
    let timeoutHit = false
    timer = setTimeout(() => { timeoutHit = true }, SYNC_TIMEOUT_MS)

    console.log(`[cron-sync] run ${runId} started — ${RIG_PREFIXES.length} rigs, promote=${promoteEnabled ? 'ON' : 'OFF'} (${triggeredBy})`)

    const perRig = []
    const truncationWarnings = []   // rig prefixes that returned a full page (possible truncation)
    let totalBos = 0, totalPos = 0, within = 0, before = 0, stagingRows = 0, posPromoted = 0
    let firstError = null, rigsFailed = 0

    for (let i = 0; i < RIG_PREFIXES.length; i++) {
      if (timeoutHit) {
        console.warn(`[cron-sync] run ${runId}: 60-min timeout reached — stopping after ${i} of ${RIG_PREFIXES.length} rigs`)
        break
      }
      const rig = RIG_PREFIXES[i]
      _current.rig_index = i + 1
      _current.current_rig = rig
      console.log(`[cron-sync] run ${runId}: starting rig ${i + 1} of ${RIG_PREFIXES.length}: ${rig}`)

      const rigResult = { rig, status: 'success', staging_rows: 0, pos_promoted: 0, error: null }
      try {
        const s = await stageRig({ rig_prefix: rig, fiscal_years: FISCAL_YEARS, runId, label: `run ${runId} ${rig}` })
        totalBos += s.total_bos; totalPos += s.total_pos; within += s.within; before += s.before; stagingRows += s.staging_rows
        rigResult.staging_rows = s.staging_rows
        if (s.likely_truncated) { rigResult.likely_truncated = true; rigResult.bo_count = s.bo_count; truncationWarnings.push(rig) }

        // Promote is gated behind BC_SYNC_ENABLED. When off, stage only.
        if (!promoteEnabled) {
          rigResult.promote_skipped = true
          rigResult.promote_skip_reason = 'BC_SYNC_ENABLED=false'
        } else if (s.staging_rows > 0) {
          const p = await promoteRun({ sync_run_id: runId, batch_size: PROMOTE_BATCH, dry_run: false, createdBy: userId || null })
          rigResult.pos_promoted = p.pos_promoted
          posPromoted += p.pos_promoted
          if (p.pos_failed > 0) { rigResult.status = 'partial'; rigResult.error = `${p.pos_failed} promotion(s) failed` }
        }
        console.log(`[cron-sync] run ${runId}: rig ${rig} done — ${s.staging_rows} staged, ${rigResult.promote_skipped ? 'promote skipped (gate off)' : `${rigResult.pos_promoted} promoted`}`)
      } catch (e) {
        rigsFailed++
        rigResult.status = 'failed'
        rigResult.error = e.message
        if (!firstError) firstError = `${rig}: ${e.message}`
        console.error(`[cron-sync] run ${runId}: rig ${rig} FAILED — ${e.message}`)
      }

      perRig.push(rigResult)
      _current.per_rig = perRig

      if (i < RIG_PREFIXES.length - 1) await sleep(RIG_DELAY_MS)   // 30s between rigs
    }

    // Overall status: timeout wins; else >=50% rigs failed → failed; any failure → partial.
    let status = 'success'
    if (timeoutHit) status = 'timeout'
    else if (rigsFailed >= Math.ceil(RIG_PREFIXES.length / 2)) status = 'failed'
    else if (rigsFailed > 0) status = 'partial_failure'

    const errMsg = timeoutHit
      ? `Exceeded 60 minute limit${firstError ? ` — first error: ${firstError}` : ''}`
      : firstError

    const processing_time_ms = Date.now() - startedAt
    await supabase.from('bc_sync_runs').update({
      status, completed_at: new Date().toISOString(),
      total_bos_fetched: totalBos, total_pos_processed: totalPos,
      pos_within_range: within, pos_before_cutoff: before,
      staging_rows_inserted: stagingRows, pos_promoted: posPromoted,
      rig_results: perRig, error_message: errMsg, processing_time_ms,
      truncation_warnings: truncationWarnings.length ? truncationWarnings : null,
    }).eq('id', runId)

    _current = { ...(_current || {}), running: false, finished_at: new Date().toISOString(), status }

    console.log(`[cron-sync] run ${runId} ${status} — ${stagingRows} staged, ${posPromoted} promoted, ${rigsFailed}/${RIG_PREFIXES.length} rigs failed, ${(processing_time_ms / 1000).toFixed(0)}s`)
    return { sync_run_id: runId, status, staging_rows: stagingRows, pos_promoted: posPromoted, rigs_failed: rigsFailed }
  } catch (e) {
    // Uncaught error outside the per-rig handling — mark the run failed so the
    // 'running' row never lingers and block future syncs.
    console.error(`[cron-sync] run ${runId || '(uncreated)'} uncaught error:`, e.message)
    if (runId) {
      await supabase.from('bc_sync_runs').update({
        status: 'failed', completed_at: new Date().toISOString(),
        error_message: `Uncaught: ${e.message}`, processing_time_ms: Date.now() - startedAt,
      }).eq('id', runId)
      _current = { ...(_current || {}), running: false, finished_at: new Date().toISOString(), status: 'failed' }
    }
    return { sync_run_id: runId, status: 'failed', error: e.message }
  } finally {
    clearTimeout(timer)   // null-safe
    _busy = false
  }
}

// ── Registration + status ──────────────────────────────────────────────────────
function initializeScheduler() {
  if (_scheduled) return
  // 09:00 and 18:00 IST, every day.
  _task = cron.schedule('0 9,18 * * *', () => {
    const label = slotLabel()
    runFullSync(label, null).catch(e => console.error('[cron-sync] unhandled error:', e))
  }, { timezone: 'Asia/Kolkata' })
  _scheduled = true
  console.log('[cron] BC sync scheduler initialized (9am + 6pm IST)')
}

async function getSchedulerStatus() {
  let last_run_info = null
  try {
    const { data } = await supabase
      .from('bc_sync_runs')
      .select('id, started_at, completed_at, status, trigger_source, triggered_by, rig_filter, staging_rows_inserted, pos_promoted, rig_results, error_message, processing_time_ms')
      .eq('rig_filter', 'ALL')
      .order('started_at', { ascending: false }).limit(1)
    last_run_info = (data && data[0]) || null
  } catch { /* v28 not run yet, or transient — leave null */ }

  return {
    enabled: _scheduled,
    schedule: '09:00 & 18:00 IST daily',
    promote_enabled: process.env.BC_SYNC_ENABLED === 'true',
    next_run: _scheduled ? nextRunISO() : null,
    current_run: _current && _current.running ? _current : null,
    last_run_info,
  }
}

module.exports = { initializeScheduler, runFullSync, getSchedulerStatus, peekLock }
