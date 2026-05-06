/**
 * asc-engine.js — Auto Section Control: coverage tracking and overlap detection.
 * Pure functions — no side effects on external state, no DOM access.
 *
 * Coverage is tracked as a Set of cell key strings. Each cell represents a
 * COVERAGE_CELL_FT × COVERAGE_CELL_FT square of real-world ground.
 *
 * Call order per GPS update:
 *   1. runASCCheck(...)  → get updated sections (before marking — first pass never self-closes)
 *   2. markSwathCoverage(...) → get updated coverage Set
 */

export const COVERAGE_CELL_FT = 5;  // must match section_width_ft
const FT_TO_LAT = 1 / 364000;       // feet → decimal degrees latitude

/**
 * Build the map cell key for a lat/lon coordinate.
 * @param {number} lat
 * @param {number} lon
 * @param {number} cosLat - Math.cos(lat_radians), passed in to avoid repeated trig.
 * @returns {string}
 */
export function cellKey(lat, lon, cosLat) {
  const latCell = Math.round(lat / (COVERAGE_CELL_FT * FT_TO_LAT));
  const lonCell = Math.round(lon / (COVERAGE_CELL_FT * FT_TO_LAT / cosLat));
  return `${latCell}_${lonCell}`;
}

/**
 * Check each section against existing coverage and return an updated sections array.
 * Does NOT modify the coverageCells Set — call markSwathCoverage() after this.
 *
 * @param {object} params
 * @param {number}   params.lat             - Current GPS latitude.
 * @param {number}   params.lon             - Current GPS longitude.
 * @param {number}   params.headingDeg      - Current heading (degrees, true north = 0).
 * @param {object[]} params.sections        - Array of section objects { active, manual_override, asc_covered, ... }.
 * @param {Set}      params.coverageCells   - Current coverage cell Set (read-only here).
 * @param {number}   params.sectionWidthFt  - Width per section (default 5 ft).
 * @param {boolean}  params.ascEnabled      - ASC toggle.
 * @param {boolean}  params.jobActive       - Only runs when a job is active.
 * @returns {{ sections: object[], changed: boolean }}
 */
export function runASCCheck({
  lat, lon, headingDeg,
  sections,
  coverageCells,
  sectionWidthFt = 5,
  ascEnabled = true,
  jobActive  = false,
}) {
  if (!ascEnabled || !jobActive) return { sections, changed: false };

  const cosLat  = Math.cos(lat * Math.PI / 180);
  const perp    = (headingDeg + 90) * Math.PI / 180;
  const headRad = headingDeg        * Math.PI / 180;

  // Look slightly ahead to give advance notice before driving onto covered ground.
  const lookAheadFt = COVERAGE_CELL_FT * 0.5;
  const aLat = lat + Math.cos(headRad) * lookAheadFt * FT_TO_LAT;
  const aLon = lon + Math.sin(headRad) * lookAheadFt * FT_TO_LAT / cosLat;

  const half    = (sections.length - 1) / 2;
  let   changed = false;
  const updated = sections.map((sec, i) => {
    if (sec.manual_override) return sec;
    const off     = (i - half) * sectionWidthFt;
    const dLat    = Math.cos(perp) * off * FT_TO_LAT;
    const dLon    = Math.sin(perp) * off * FT_TO_LAT / cosLat;
    const covered = coverageCells.has(cellKey(aLat + dLat, aLon + dLon, cosLat));
    if (covered === sec.asc_covered) return sec;
    changed = true;
    return { ...sec, asc_covered: covered, active: !covered };
  });

  return { sections: updated, changed };
}

/**
 * Mark every section's footprint at the current position as covered.
 * Returns a new Set with the added cells (the original is not mutated).
 *
 * @param {object} params
 * @param {number}   params.lat             - Current GPS latitude.
 * @param {number}   params.lon             - Current GPS longitude.
 * @param {number}   params.headingDeg      - Current heading (degrees).
 * @param {object[]} params.sections        - Section array.
 * @param {Set}      params.coverageCells   - Current coverage cell Set.
 * @param {number}   params.sectionWidthFt  - Width per section.
 * @param {number}   params.speedMph        - Current speed.
 * @param {boolean}  params.jobActive       - Only marks when a job is active.
 * @param {number}   [params.minSpeedMph=0.3] - Don't mark coverage while creeping/stopped.
 * @returns {Set} Updated coverage cells Set.
 */
export function markSwathCoverage({
  lat, lon, headingDeg,
  sections,
  coverageCells,
  sectionWidthFt = 5,
  speedMph       = 0,
  jobActive      = false,
  minSpeedMph    = 0.3,
}) {
  if (!jobActive || speedMph < minSpeedMph) return coverageCells;

  const cosLat = Math.cos(lat * Math.PI / 180);
  const perp   = (headingDeg + 90) * Math.PI / 180;
  const half   = (sections.length - 1) / 2;
  const next   = new Set(coverageCells);

  for (let i = 0; i < sections.length; i++) {
    const off  = (i - half) * sectionWidthFt;
    const dLat = Math.cos(perp) * off * FT_TO_LAT;
    const dLon = Math.sin(perp) * off * FT_TO_LAT / cosLat;
    next.add(cellKey(lat + dLat, lon + dLon, cosLat));
  }

  return next;
}
