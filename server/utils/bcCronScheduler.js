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

// 14 rig prefixes, iterated in order. Matches RIG_PREFIX_OPTIONS in the client.
const RIG_PREFIXES = ['RD1', 'RD1DD', 'RV1', 'RV1DD', 'RJS', 'RJSDD', 'RJE', 'RJEDD', 'RJSUP', 'RJSUPDD', 'MLU', 'DDD', 'TAWS', 'RIG']
const FISCAL_YEARS = ['2627', '2728']         // current + next
const RIG_DELAY_MS = 30_000                     // be gentle on BC between rigs
const STALE_RUN_MS = 30 * 60_000                // a 'running' row older than this is treated as stale
const PROMOTE_BATCH = 1000                      // promote all eligible INSERTs per rig run

const sleep = ms => new Promise(r => setTimeout(r, ms))

let _task = null                                // node-cron task handle (null until initialized)
let _scheduled = false
// In-memory progress for the live "Syncing rig X of 14" UI (not persisted).
let _current = null   // { running, triggered_by, started_at, total_rigs, rig_index, current_rig, per_rig: [] }

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

// ── A concurrency guard that survives restarts ─────────────────────────────────
async function anotherRunActive() {
  if (_current?.running) return true
  const { data } = await supabase
    .from('bc_sync_runs').select('id, started_at')
    .eq('status', 'running')
    .order('started_at', { ascending: false }).limit(1)
  const row = data && data[0]
  if (!row) return false
  // Ignore a stale 'running' row left behind by a crashed run.
  return (Date.now() - new Date(row.started_at).getTime()) < STALE_RUN_MS
}

// ── The full sync ──────────────────────────────────────────────────────────────
/**
 * Sync all rigs sequentially under a single master bc_sync_runs row.
 * @param {string} triggeredBy  label: 'cron-9am' | 'cron-6pm' | 'manual-admin-<uuid>'
 * @param {string|null} userId  users(id) to stamp on promoted po_orders (null for cron)
 */
async function runFullSync(triggeredBy = 'cron', userId = null) {
  if (await anotherRunActive()) {
    console.warn('[cron-sync] a sync is already running — skipping this trigger')
    return { skipped: true, reason: 'another sync already running' }
  }

  const promoteEnabled = process.env.BC_SYNC_ENABLED === 'true'
  const startedAt = Date.now()

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
  const runId = run.id

  _current = {
    running: true, triggered_by: triggeredBy, started_at: new Date(startedAt).toISOString(),
    total_rigs: RIG_PREFIXES.length, rig_index: 0, current_rig: null, promote_enabled: promoteEnabled, per_rig: [],
  }

  console.log(`[cron-sync] run ${runId} started — ${RIG_PREFIXES.length} rigs, promote=${promoteEnabled ? 'ON' : 'OFF'} (${triggeredBy})`)

  const perRig = []
  let totalBos = 0, totalPos = 0, within = 0, before = 0, stagingRows = 0, posPromoted = 0
  let firstError = null, rigsFailed = 0

  for (let i = 0; i < RIG_PREFIXES.length; i++) {
    const rig = RIG_PREFIXES[i]
    _current.rig_index = i + 1
    _current.current_rig = rig
    console.log(`[cron-sync] run ${runId}: starting rig ${i + 1} of ${RIG_PREFIXES.length}: ${rig}`)

    const rigResult = { rig, status: 'success', staging_rows: 0, pos_promoted: 0, error: null }
    try {
      const s = await stageRig({ rig_prefix: rig, fiscal_years: FISCAL_YEARS, runId, label: `run ${runId} ${rig}` })
      totalBos += s.total_bos; totalPos += s.total_pos; within += s.within; before += s.before; stagingRows += s.staging_rows
      rigResult.staging_rows = s.staging_rows

      if (promoteEnabled && s.staging_rows > 0) {
        const p = await promoteRun({ sync_run_id: runId, batch_size: PROMOTE_BATCH, dry_run: false, createdBy: userId || null })
        rigResult.pos_promoted = p.pos_promoted
        posPromoted += p.pos_promoted
        if (p.pos_failed > 0) { rigResult.status = 'partial'; rigResult.error = `${p.pos_failed} promotion(s) failed` }
      }
      console.log(`[cron-sync] run ${runId}: rig ${rig} done — ${s.staging_rows} staged, ${rigResult.pos_promoted} promoted`)
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

  // Overall status: all-good → success; >=50% rigs failed → failed; else partial.
  let status = 'success'
  if (rigsFailed >= Math.ceil(RIG_PREFIXES.length / 2)) status = 'failed'
  else if (rigsFailed > 0) status = 'partial_failure'

  const processing_time_ms = Date.now() - startedAt
  await supabase.from('bc_sync_runs').update({
    status, completed_at: new Date().toISOString(),
    total_bos_fetched: totalBos, total_pos_processed: totalPos,
    pos_within_range: within, pos_before_cutoff: before,
    staging_rows_inserted: stagingRows, pos_promoted: posPromoted,
    rig_results: perRig, error_message: firstError, processing_time_ms,
  }).eq('id', runId)

  _current = { ...(_current || {}), running: false, finished_at: new Date().toISOString(), status }

  console.log(`[cron-sync] run ${runId} ${status} — ${stagingRows} staged, ${posPromoted} promoted, ${rigsFailed}/${RIG_PREFIXES.length} rigs failed, ${(processing_time_ms / 1000).toFixed(0)}s`)
  return { sync_run_id: runId, status, staging_rows: stagingRows, pos_promoted: posPromoted, rigs_failed: rigsFailed }
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

module.exports = { initializeScheduler, runFullSync, getSchedulerStatus }
