/**
 * liw-calc.js — Loss-In-Weight application rate calculation.
 * Pure functions — no side effects, no global state.
 *
 * Core formula:
 *   lbs_per_acre = (delta_weight_lbs_per_sec × 43,560)
 *                ÷ (speed_mph × (5,280 / 3,600) × effective_width_ft)
 */

export const SQ_FT_PER_ACRE    = 43560;   // sq ft per acre
export const FT_PER_MILE       = 5280;    // ft per mile
export const SEC_PER_HOUR      = 3600;    // seconds per hour
export const MPH_TO_FT_PER_SEC = FT_PER_MILE / SEC_PER_HOUR;  // ~1.4667

/**
 * Push one raw weight reading through a 5-sample rolling average buffer.
 *
 * @param {number[]} buffer     - Current rolling buffer (mutated — pass a copy if needed).
 * @param {number}   rawLbs     - New raw reading from load cell.
 * @param {number}   tareOffset - Offset to subtract from raw before buffering.
 * @param {number}   [size=5]   - Rolling buffer size.
 * @returns {{ buffer: number[], weight_lbs: number }}
 */
export function smoothWeight(buffer, rawLbs, tareOffset = 0, size = 5) {
  const net = rawLbs - tareOffset;
  const buf = [...buffer, net];
  if (buf.length > size) buf.shift();
  const weight_lbs = buf.reduce((a, b) => a + b, 0) / buf.length;
  return { buffer: buf, weight_lbs };
}

/**
 * Calculate weight-loss rate (lbs/sec) from two smoothed weight readings.
 * Returns 0 if the time window is outside [0, maxWindowSec] to reject stale samples.
 *
 * @param {number|null} prevWeight   - Smoothed weight at previous sample (lbs).
 * @param {number|null} prevTimeMs   - Timestamp of previous sample (ms).
 * @param {number}      currentWeight - Current smoothed weight (lbs).
 * @param {number}      nowMs         - Current timestamp (ms).
 * @param {number}      [maxWindowSec=5] - Reject deltas older than this.
 * @returns {number} delta_weight_per_sec (always >= 0; negative = loading, clamped to 0)
 */
export function calcDeltaWeight(prevWeight, prevTimeMs, currentWeight, nowMs, maxWindowSec = 5) {
  if (prevWeight === null || prevTimeMs === null) return 0;
  const dt = (nowMs - prevTimeMs) / 1000;
  if (dt <= 0 || dt > maxWindowSec) return 0;
  return Math.max(0, (prevWeight - currentWeight) / dt);
}

/**
 * Calculate the live application rate.
 *
 * @param {number} deltaWeightPerSec - Weight lost per second (lbs/s, >= 0).
 * @param {number} speedMph          - Ground speed (mph).
 * @param {number} effectiveWidthFt  - Active spread width in feet (open sections × section_width).
 * @param {object} [opts]
 * @param {number} [opts.minSpeedMph=0.3] - Speed below which rate is forced to 0.
 * @returns {number} Application rate in lbs/acre.
 */
export function calculateRate(deltaWeightPerSec, speedMph, effectiveWidthFt, { minSpeedMph = 0.3 } = {}) {
  if (speedMph < minSpeedMph)     return 0;  // stopped — avoid divide-by-zero
  if (deltaWeightPerSec <= 0)     return 0;  // not spreading (or loading)
  if (effectiveWidthFt  <= 0)     return 0;  // all sections closed
  return (deltaWeightPerSec * SQ_FT_PER_ACRE) /
         (speedMph * MPH_TO_FT_PER_SEC * effectiveWidthFt);
}
