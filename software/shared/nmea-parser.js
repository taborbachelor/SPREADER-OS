/**
 * nmea-parser.js — NMEA 0183 sentence parsing for spreader GPS input.
 * Supports $GPRMC / $GNRMC, $GPGGA / $GNGGA, $GPVTG / $GNVTG.
 * Pure functions — no side effects, no global state.
 */

export const KNOTS_TO_MPH = 1.15078;
export const KMH_TO_MPH   = 0.621371;

/** Convert ddmm.mmmm + hemisphere char to decimal degrees. Returns null on bad input. */
export function nmeaToDeg(raw, hemi) {
  const v = parseFloat(raw);
  if (isNaN(v)) return null;
  const deg = Math.floor(v / 100);
  const min = v - deg * 100;
  const dd  = deg + min / 60;
  return (hemi === 'S' || hemi === 'W') ? -dd : dd;
}

/** XOR checksum validation. Returns true if valid or if no checksum is present. */
export function checksumOk(sentence) {
  const star = sentence.indexOf('*');
  if (star === -1) return true;
  const body     = sentence.slice(1, star);
  const expected = sentence.slice(star + 1, star + 3).toUpperCase();
  const calc     = body.split('').reduce((a, c) => a ^ c.charCodeAt(0), 0);
  return calc.toString(16).toUpperCase().padStart(2, '0') === expected;
}

/**
 * Parse one NMEA sentence string.
 * @param {string} sentence  - Raw NMEA string including $ prefix.
 * @param {object} [prev]    - Previous GPS state used for heading fallback. Shape: { heading_deg }.
 * @returns {object|null}    - Partial GPS state update, or null if sentence is invalid/unknown.
 *
 * Returned object may contain any subset of:
 *   { lat, lon, speed_mph, heading_deg, fix_quality, satellites }
 */
export function parseNMEA(sentence, prev = {}) {
  sentence = sentence.trim();
  if (!sentence.startsWith('$')) return null;
  if (!checksumOk(sentence)) return null;

  const fields = sentence.split(',');
  const type   = fields[0].slice(1);  // strip $

  if (type === 'GPRMC' || type === 'GNRMC') return _parseRMC(fields, prev);
  if (type === 'GPGGA' || type === 'GNGGA') return _parseGGA(fields, prev);
  if (type === 'GPVTG' || type === 'GNVTG') return _parseVTG(fields, prev);
  return null;
}

function _parseRMC(f, prev) {
  // $GPRMC,time,status,lat,N/S,lon,E/W,knots,course,date,...
  if (f[2] !== 'A') return null;  // void/invalid fix
  const lat = nmeaToDeg(f[3], f[4]);
  const lon = nmeaToDeg(f[5], f[6]);
  const spd = parseFloat(f[7]);
  const crs = parseFloat(f[8]);
  if (lat === null || lon === null || isNaN(spd)) return null;
  return {
    lat,
    lon,
    speed_mph:   spd * KNOTS_TO_MPH,
    heading_deg: isNaN(crs) ? (prev.heading_deg ?? 0) : crs,
  };
}

function _parseGGA(f, prev) {
  // $GPGGA,time,lat,N/S,lon,E/W,fix,sats,...
  const fix  = parseInt(f[6]);
  const sats = parseInt(f[7]);
  const lat  = nmeaToDeg(f[2], f[3]);
  const lon  = nmeaToDeg(f[4], f[5]);
  if (isNaN(fix)) return null;
  return {
    lat:         lat ?? (prev.lat ?? 0),
    lon:         lon ?? (prev.lon ?? 0),
    fix_quality: fix,
    satellites:  isNaN(sats) ? 0 : sats,
  };
}

function _parseVTG(f, prev) {
  // $GPVTG,course_T,T,course_M,M,knots,N,km/h,K,...
  const crs   = parseFloat(f[1]);
  const knots = parseFloat(f[5]);
  const kmh   = parseFloat(f[7]);
  const speed_mph = !isNaN(knots) ? knots * KNOTS_TO_MPH
                  : !isNaN(kmh)   ? kmh   * KMH_TO_MPH
                  : null;
  if (speed_mph === null) return null;
  return {
    speed_mph,
    heading_deg: isNaN(crs) ? (prev.heading_deg ?? 0) : crs,
  };
}
