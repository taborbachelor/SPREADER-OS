/**
 * prescription-map.js — Variable rate prescription map support.
 * Accepts a GeoJSON FeatureCollection where each Feature is a Polygon or
 * MultiPolygon with a rate property (default key: "rate_lbs_acre").
 *
 * Coordinate order follows GeoJSON spec: [longitude, latitude].
 * Pure functions — no side effects, no DOM access.
 *
 * Typical workflow:
 *   1. User loads a .geojson file exported from QGIS / SMS / John Deere Ops Center
 *   2. parsePrescription() extracts zones with their rates
 *   3. On each GPS update: getTargetRate(lat, lon, zones) → target lbs/acre
 *   4. drawPrescriptionZones(ctx, zones, transform) overlays zones on coverage map
 */

/**
 * Parse a GeoJSON FeatureCollection into an array of rate zones.
 *
 * @param {object} geojson         - GeoJSON FeatureCollection object.
 * @param {string} [rateProperty]  - Feature property key that holds the rate value.
 * @returns {object[]} Array of { rate, polygons, label } zone objects.
 *   polygons: array of polygon ring arrays (each = array of [lon, lat] pairs)
 *   label:    display name for the zone (from "name" or "label" property), or null
 */
export function parsePrescription(geojson, rateProperty = 'rate_lbs_acre') {
  if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
    return [];
  }

  return geojson.features
    .filter(f => f?.geometry && f.properties?.[rateProperty] != null)
    .map(f => {
      const rate     = parseFloat(f.properties[rateProperty]);
      const polygons = _extractPolygonRings(f.geometry);
      const label    = f.properties.name ?? f.properties.label ?? f.properties.zone ?? null;
      return { rate, polygons, label };
    })
    .filter(z => !isNaN(z.rate) && z.polygons.length > 0);
}

function _extractPolygonRings(geometry) {
  if (geometry.type === 'Polygon')      return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat(1);
  return [];
}

/**
 * Ray-casting point-in-ring test.
 * GeoJSON ring: array of [lon, lat] pairs.
 * Test point: (lat, lon) — matching GeoJSON's [lon, lat] order internally.
 */
function _pointInRing(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];  // xi = lon, yi = lat
    const xj = ring[j][0], yj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Test whether a point is inside a GeoJSON polygon (outer ring minus holes).
 * @param {number}   lat
 * @param {number}   lon
 * @param {Array}    rings - [[outerRing], [holeRing], ...] — GeoJSON Polygon.coordinates
 * @returns {boolean}
 */
export function pointInPolygon(lat, lon, rings) {
  if (!_pointInRing(lat, lon, rings[0])) return false;
  for (let h = 1; h < rings.length; h++) {
    if (_pointInRing(lat, lon, rings[h])) return false;  // inside a hole
  }
  return true;
}

/**
 * Return the target rate for the given GPS position, or null if outside all zones.
 * First matching zone wins — order your GeoJSON features accordingly if zones overlap.
 *
 * @param {number}   lat
 * @param {number}   lon
 * @param {object[]} zones - Output of parsePrescription().
 * @returns {number|null} Target rate in lbs/acre, or null if no zone matches.
 */
export function getTargetRate(lat, lon, zones) {
  for (const zone of zones) {
    for (const rings of zone.polygons) {
      if (pointInPolygon(lat, lon, rings)) return zone.rate;
    }
  }
  return null;
}

/**
 * Get the min and max rates across all zones (for color-mapping).
 * @param {object[]} zones
 * @returns {{ min: number, max: number }}
 */
export function getRateRange(zones) {
  if (!zones.length) return { min: 0, max: 1 };
  const rates = zones.map(z => z.rate);
  return { min: Math.min(...rates), max: Math.max(...rates) };
}

/**
 * Draw prescription rate zones onto a canvas rendering context.
 * Renders below swath coverage — call before drawCoverageMap's swath layer.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object[]} zones     - Output of parsePrescription().
 * @param {object}   transform - From buildMapTransform(): { toPixel, cosLat }.
 * @param {object}   [opts]
 * @param {number}   [opts.alpha=0.30]      - Fill opacity.
 * @param {boolean}  [opts.showLabels=true] - Draw rate label in zone centroid.
 */
export function drawPrescriptionZones(ctx, zones, transform, opts = {}) {
  if (!zones || zones.length === 0 || !transform) return;

  const { alpha = 0.30, showLabels = true } = opts;
  const { min, max } = getRateRange(zones);
  const range = max - min || 1;

  for (const zone of zones) {
    const t = (zone.rate - min) / range;  // 0 = lowest rate, 1 = highest

    // Color ramp: amber (#F59E0B) → green (#22C55E) as rate increases
    const r = Math.round(245 - t * 223);   // 245 → 34
    const g = Math.round(158 + t * 39);    // 158 → 197
    const b = Math.round(11  + t * 83);    // 11  → 94
    ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
    ctx.strokeStyle = `rgba(${r},${g},${b},0.6)`;
    ctx.lineWidth = 1;

    for (const rings of zone.polygons) {
      const outer = rings[0];
      if (!outer || outer.length < 3) continue;

      ctx.beginPath();
      for (let i = 0; i < outer.length; i++) {
        const [lon, lat] = outer[i];
        const { x, y } = transform.toPixel(lat, lon);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Rate label at approximate centroid of first ring
    if (showLabels && zone.polygons.length > 0) {
      const outer = zone.polygons[0][0];
      if (outer && outer.length > 0) {
        const avgLon = outer.reduce((s, p) => s + p[0], 0) / outer.length;
        const avgLat = outer.reduce((s, p) => s + p[1], 0) / outer.length;
        const { x, y } = transform.toPixel(avgLat, avgLon);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = 'bold 11px Segoe UI, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${Math.round(zone.rate)}`, x, y);
      }
    }
  }
}
