/**
 * coverage-map.js — Canvas-based coverage map renderer.
 * Operates on a provided HTMLCanvasElement — no document queries.
 *
 * Design tokens (passed via opts, with defaults matching the dark UI):
 *   bgColor, gridColor, swathColor, arrowColor, dotColors, labelColor
 */

const FT_LAT = 364000;  // feet per degree latitude

const DEFAULTS = {
  defaultWidthFt: 50,
  bgColor:        '#0A0C12',
  gridColor:      '#1A1E2E',
  swathColor:     'rgba(34, 197, 94, 0.35)',
  arrowColor:     '#FFFFFF',
  labelColor:     '#2A2F45',
  dotColors: {
    open:     '#22C55E',
    closed:   '#F59E0B',
    override: '#EF4444',
  },
};

/**
 * Build a coordinate transform from lat/lon → canvas pixels.
 *
 * @param {number}   W              - Canvas width (px).
 * @param {number}   H              - Canvas height (px).
 * @param {object[]} mapPoints      - Array of { lat, lon } track points.
 * @param {object|null} currentPos  - Current position { lat, lon } (may be null).
 * @param {number}   effectiveWidthFt - Active spread width, used for bounding-box padding.
 * @returns {object|null} Transform object { toPixel(lat,lon)→{x,y}, ftPerPixel, cosLat }, or null.
 */
export function buildMapTransform(W, H, mapPoints, currentPos, effectiveWidthFt = 50) {
  const pts = [...mapPoints];
  if (currentPos) pts.push(currentPos);
  if (pts.length === 0) return null;

  const originLat = pts[0].lat;
  const originLon = pts[0].lon;
  const cosLat    = Math.cos(originLat * Math.PI / 180);
  const FT_LON    = FT_LAT * cosLat;

  function toFt(lat, lon) {
    return { x: (lon - originLon) * FT_LON, y: (lat - originLat) * FT_LAT };
  }

  const hw = effectiveWidthFt / 2;
  let minX = -hw, maxX = hw, minY = -hw, maxY = hw;
  for (const p of pts) {
    const { x, y } = toFt(p.lat, p.lon);
    if (x - hw < minX) minX = x - hw;
    if (x + hw > maxX) maxX = x + hw;
    if (y - hw < minY) minY = y - hw;
    if (y + hw > maxY) maxY = y + hw;
  }

  const padX = Math.max((maxX - minX) * 0.15, hw * 2);
  const padY = Math.max((maxY - minY) * 0.15, hw * 2);
  minX -= padX; maxX += padX;
  minY -= padY; maxY += padY;

  const scale = Math.min(W / (maxX - minX), H / (maxY - minY));
  const offX  = (W - (maxX - minX) * scale) / 2 - minX * scale;
  const offY  = (H - (maxY - minY) * scale) / 2 + maxY * scale;

  return {
    toPixel: (lat, lon) => {
      const { x, y } = toFt(lat, lon);
      return { x: offX + x * scale, y: offY - y * scale };
    },
    ftPerPixel: 1 / scale,
    cosLat,
  };
}

/**
 * Render the coverage map onto a canvas element.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} state
 * @param {object[]}    state.mapPoints    - Track points: { lat, lon, heading, width_ft }.
 * @param {object}      state.gpsState     - { lat, lon, heading_deg, connected, simulated }.
 * @param {object[]}    state.sections     - Section array: { active, manual_override }.
 * @param {object}      state.settings     - { section_width_ft }.
 * @param {object}      [opts]             - Optional style overrides (see DEFAULTS).
 */
export function drawCoverageMap(canvas, { mapPoints, gpsState, sections, settings }, opts = {}) {
  const o   = { ...DEFAULTS, ...opts };
  const ctx = canvas.getContext('2d');
  const W   = canvas.width;
  const H   = canvas.height;
  if (W === 0 || H === 0) return;

  const hasGPS = gpsState.connected || gpsState.simulated;

  // Background
  ctx.fillStyle = o.bgColor;
  ctx.fillRect(0, 0, W, H);

  // Faint grid
  ctx.strokeStyle = o.gridColor;
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  if (!hasGPS && mapPoints.length === 0) {
    ctx.fillStyle = o.labelColor;
    ctx.font = '13px Segoe UI, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Start a job to begin mapping coverage', W / 2, H / 2);
    return;
  }

  const currentPos = hasGPS ? { lat: gpsState.lat, lon: gpsState.lon } : null;
  const t = buildMapTransform(W, H, mapPoints, currentPos, settings?.section_width_ft * (sections?.length ?? 10) || o.defaultWidthFt);
  if (!t) return;

  // Covered swaths
  if (mapPoints.length >= 2) {
    ctx.fillStyle = o.swathColor;
    for (let i = 1; i < mapPoints.length; i++) {
      const prev = mapPoints[i - 1];
      const curr = mapPoints[i];
      const hw   = (curr.width_ft || o.defaultWidthFt) / 2;
      const perp = (curr.heading + 90) * Math.PI / 180;
      const dLat = Math.cos(perp) * hw / FT_LAT;
      const dLon = Math.sin(perp) * hw / (FT_LAT * t.cosLat);
      const a = t.toPixel(prev.lat + dLat, prev.lon + dLon);
      const b = t.toPixel(prev.lat - dLat, prev.lon - dLon);
      const c = t.toPixel(curr.lat - dLat, curr.lon - dLon);
      const d = t.toPixel(curr.lat + dLat, curr.lon + dLon);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(d.x, d.y);
      ctx.lineTo(c.x, c.y); ctx.lineTo(b.x, b.y);
      ctx.closePath(); ctx.fill();
    }
  }

  // Machine position arrow
  if (hasGPS) {
    const { x, y } = t.toPixel(gpsState.lat, gpsState.lon);
    const rad = gpsState.heading_deg * Math.PI / 180;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rad);
    ctx.fillStyle = o.arrowColor;
    ctx.beginPath();
    ctx.moveTo(0, -12); ctx.lineTo(-8, 8); ctx.lineTo(0, 3); ctx.lineTo(8, 8);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    // Section dots
    if (sections && settings) {
      const perp = (gpsState.heading_deg + 90) * Math.PI / 180;
      const sw   = settings.section_width_ft;
      const half = (sections.length - 1) / 2;
      for (let i = 0; i < sections.length; i++) {
        const off  = (i - half) * sw;
        const dLat = Math.cos(perp) * off / FT_LAT;
        const dLon = Math.sin(perp) * off / (FT_LAT * t.cosLat);
        const sp   = t.toPixel(gpsState.lat + dLat, gpsState.lon + dLon);
        const sec  = sections[i];
        ctx.fillStyle = sec.manual_override ? o.dotColors.override
                      : sec.active          ? o.dotColors.open
                                            : o.dotColors.closed;
        ctx.beginPath(); ctx.arc(sp.x, sp.y, 3, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // Scale bar (bottom-right)
  const ftPerPx    = t.ftPerPixel;
  const candidates = [10, 25, 50, 100, 200, 250, 500, 1000];
  let niceFt = candidates[0];
  for (const c of candidates) {
    if (Math.abs(c / ftPerPx - 80) < Math.abs(niceFt / ftPerPx - 80)) niceFt = c;
  }
  const barPx = niceFt / ftPerPx;
  const bx    = W - barPx - 20;
  const by    = H - 16;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(bx - 6, by - 18, barPx + 12, 24);
  ctx.strokeStyle = '#9CA3AF'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(bx, by); ctx.lineTo(bx + barPx, by);
  ctx.moveTo(bx, by - 5); ctx.lineTo(bx, by + 3);
  ctx.moveTo(bx + barPx, by - 5); ctx.lineTo(bx + barPx, by + 3);
  ctx.stroke();
  ctx.fillStyle = '#9CA3AF';
  ctx.font = '11px Segoe UI, system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(`${niceFt} ft`, bx + barPx / 2, by - 1);
}
