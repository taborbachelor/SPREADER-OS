/**
 * job-sync.js — Cloud sync for completed job records.
 * Pure functions — no side effects, no global state, no fetch calls.
 * Fetch is handled by the caller so this module stays testable in Node.
 *
 * API contract (POST to configured endpoint):
 *   Content-Type: application/json
 *   Authorization: Bearer <api_key>  (omitted if no key configured)
 *   Body: SyncPayload (see below)
 *
 * Expected 2xx response = success. Any other status or network error = retry later.
 */

export const SYNC_VERSION = 1;

/**
 * Build the JSON payload for a job sync request.
 * GPS track is sampled to keep payload size reasonable (≤ 500 points).
 *
 * @param {object} job          - Job record from localStorage.
 * @param {object} [meta]       - Optional extra metadata to include.
 * @returns {object} SyncPayload
 */
export function buildSyncPayload(job, meta = {}) {
  const track = sampleTrack(job.gps_track ?? [], 500);
  return {
    sync_version:      SYNC_VERSION,
    id:                job.id,
    field_name:        job.field_name,
    start_time:        job.start_time,
    end_time:          job.end_time,
    total_applied_lbs: job.total_applied_lbs,
    total_acres:       job.total_acres,
    avg_rate_lbs_acre: job.avg_rate_lbs_acre,
    gps_track:         track,
    ...meta,
  };
}

/**
 * Build fetch() init options for the sync POST request.
 *
 * @param {object} payload   - From buildSyncPayload().
 * @param {string} apiKey    - Bearer token (pass '' to omit the header).
 * @returns {object} fetch RequestInit
 */
export function buildSyncRequest(payload, apiKey = '') {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  return { method: 'POST', headers, body: JSON.stringify(payload) };
}

/**
 * Determine if a job needs syncing.
 * @param {object} job
 * @returns {boolean}
 */
export function needsSync(job) {
  return !job.synced && !job.sync_error_permanent;
}

/**
 * Return a copy of the job marked as successfully synced.
 * @param {object} job
 * @param {string} [syncedAt] - ISO timestamp, defaults to now.
 * @returns {object}
 */
export function markSynced(job, syncedAt = new Date().toISOString()) {
  return { ...job, synced: true, sync_pending: false, synced_at: syncedAt };
}

/**
 * Return a copy of the job marked as sync-pending (will retry next launch).
 * @param {object} job
 * @param {string} errorMessage
 * @returns {object}
 */
export function markSyncPending(job, errorMessage = '') {
  return { ...job, synced: false, sync_pending: true, sync_last_error: errorMessage };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sampleTrack(track, maxPoints) {
  if (!Array.isArray(track) || track.length <= maxPoints) return track;
  const step = track.length / maxPoints;
  return Array.from({ length: maxPoints }, (_, i) => track[Math.round(i * step)]);
}
