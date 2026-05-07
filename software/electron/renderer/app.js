/**
 * Spreader OS — Phase 3 Electron renderer
 * Imports pure logic from software/shared/; hardware events arrive via window.spreaderAPI (preload).
 */

import { parseNMEA }                            from '../../shared/nmea-parser.js';
import { smoothWeight, calcDeltaWeight, calculateRate, SQ_FT_PER_ACRE, MPH_TO_FT_PER_SEC }
                                                from '../../shared/liw-calc.js';
import { runASCCheck, markSwathCoverage }       from '../../shared/asc-engine.js';
import { drawCoverageMap }                      from '../../shared/coverage-map.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const GPS_BAUD_RATE             = 19200;
const SCALE_BAUD_RATE           = 9600;
const SCALE_WS_URL              = 'ws://localhost:8765';
const SCALE_WS_RETRY_MS         = 3000;
const WEIGHT_BUFFER_SIZE        = 5;
const DEFAULT_SPREAD_WIDTH_FT   = 50;
const DEFAULT_SECTION_COUNT     = 10;
const DEFAULT_SECTION_WIDTH_FT  = 5;
const DEFAULT_MIN_SPEED_MPH     = 0.3;
const SIM_START_LAT             = 41.8500;
const SIM_START_LON             = -98.3500;
const SIM_INITIAL_WEIGHT        = 20000;
const SIM_SPEED_MPH             = 5.0;
const SIM_PASS_LENGTH_FT        = 660;
const SIM_TICK_MS               = 1000;
const SIM_WEIGHT_NOISE_LBS      = 10;
const JOBS_STORAGE_KEY          = 'spreader_jobs_v3';

// ── State ─────────────────────────────────────────────────────────────────────

let gpsState = {
  connected: false, simulated: false,
  lat: 0, lon: 0, speed_mph: 0, heading_deg: 0,
  fix_quality: 0, satellites: 0, last_update: null,
};

let scaleState = {
  connected: false, simulated: false, piBridge: false,
  weight_lbs: 0, weight_buffer: [], tare_offset: 0, last_update: null,
};

let calcState = {
  delta_weight_per_sec: 0,
  rate_lbs_per_acre:    0,
  effective_width_ft:   DEFAULT_SPREAD_WIDTH_FT,
  active_section_count: DEFAULT_SECTION_COUNT,
};

let jobState = {
  active: false, start_time: null, start_weight: 0,
  total_applied_lbs: 0, total_acres: 0, gps_track: [],
  coverage_cells: new Set(),
};

let settings = {
  target_rate_lbs_per_acre: 500,
  spread_width_ft:           DEFAULT_SPREAD_WIDTH_FT,
  section_count:             DEFAULT_SECTION_COUNT,
  section_width_ft:          DEFAULT_SECTION_WIDTH_FT,
  asc_enabled:               true,
  asc_overlap_threshold:     0.5,
  min_operating_speed_mph:   DEFAULT_MIN_SPEED_MPH,
};

let sections = Array.from({ length: DEFAULT_SECTION_COUNT }, (_, i) => ({
  index: i, active: true, manual_override: false, asc_covered: false,
}));

let mapPoints = [];

let _prevSmoothed     = null;
let _prevSmoothedTime = null;
let _portPickerTarget = null;   // 'gps' | 'scale'
let _selectedPortPath = null;

// ── Simulation ────────────────────────────────────────────────────────────────

let simState = {
  lat: SIM_START_LAT, lon: SIM_START_LON,
  speed_mph: SIM_SPEED_MPH, heading_deg: 0,
  pass_dist_ft: 0, pass_count: 0,
  raw_weight: SIM_INITIAL_WEIGHT,
  interval_id: null,
};

function startSimulation() {
  simState.lat         = SIM_START_LAT;
  simState.lon         = SIM_START_LON;
  simState.speed_mph   = SIM_SPEED_MPH;
  simState.raw_weight  = SIM_INITIAL_WEIGHT;
  simState.pass_dist_ft = 0;
  simState.pass_count  = 0;
  gpsState.simulated   = true;
  scaleState.simulated = true;
  simState.interval_id = setInterval(simTick, SIM_TICK_MS);
  simTick();
}

function simTick() {
  const MPH_TO_FT = MPH_TO_FT_PER_SEC;
  const speedFtPerSec = simState.speed_mph * MPH_TO_FT;
  const rad = simState.heading_deg * Math.PI / 180;
  const LAT_PER_FT = 1 / 364000;
  const LON_PER_FT = 1 / (364000 * Math.cos(simState.lat * Math.PI / 180));
  simState.lat          += Math.cos(rad) * speedFtPerSec * LAT_PER_FT;
  simState.lon          += Math.sin(rad) * speedFtPerSec * LON_PER_FT;
  simState.pass_dist_ft += speedFtPerSec;

  if (simState.pass_dist_ft >= SIM_PASS_LENGTH_FT) {
    simState.pass_dist_ft = 0;
    simState.pass_count++;
    simState.heading_deg = simState.heading_deg === 0 ? 180 : 0;
    simState.lon += DEFAULT_SPREAD_WIDTH_FT * LON_PER_FT;
  }

  simState.speed_mph = Math.max(4.0, Math.min(6.0, SIM_SPEED_MPH + (Math.random() - 0.5)));

  Object.assign(gpsState, {
    lat: simState.lat, lon: simState.lon,
    speed_mph: simState.speed_mph, heading_deg: simState.heading_deg,
    fix_quality: 4, satellites: 8 + Math.floor(Math.random() * 3),
    last_update: Date.now(),
  });

  if (!scaleState.piBridge) {
    const lbsPerSec = (settings.target_rate_lbs_per_acre * simState.speed_mph * MPH_TO_FT * calcState.effective_width_ft) / SQ_FT_PER_ACRE;
    const noise     = (Math.random() - 0.5) * SIM_WEIGHT_NOISE_LBS * 2;
    simState.raw_weight = Math.max(0, simState.raw_weight - lbsPerSec + noise);
    pushWeight(simState.raw_weight);
  }

  recalculate();
}

// ── Weight processing ─────────────────────────────────────────────────────────

function pushWeight(rawLbs) {
  const { buffer, weight_lbs } = smoothWeight(
    scaleState.weight_buffer, rawLbs, scaleState.tare_offset, WEIGHT_BUFFER_SIZE
  );
  scaleState.weight_buffer = buffer;
  scaleState.weight_lbs    = weight_lbs;
  const now = Date.now();
  const delta = calcDeltaWeight(_prevSmoothed, _prevSmoothedTime, weight_lbs, now);
  calcState.delta_weight_per_sec = delta;
  _prevSmoothed     = weight_lbs;
  _prevSmoothedTime = now;
  scaleState.last_update = now;
}

// ── Rate / ASC recalculate ────────────────────────────────────────────────────

function recalculate() {
  calcState.active_section_count = sections.filter(s => s.active).length;
  calcState.effective_width_ft   = calcState.active_section_count * settings.section_width_ft;
  calcState.rate_lbs_per_acre    = calculateRate(
    calcState.delta_weight_per_sec,
    gpsState.speed_mph,
    calcState.effective_width_ft,
    { minSpeedMph: settings.min_operating_speed_mph }
  );

  // ASC: check before marking so first pass never self-closes
  const { sections: updated, changed } = runASCCheck({
    lat: gpsState.lat, lon: gpsState.lon, headingDeg: gpsState.heading_deg,
    sections, coverageCells: jobState.coverage_cells,
    sectionWidthFt: settings.section_width_ft,
    ascEnabled: settings.asc_enabled, jobActive: jobState.active,
  });
  if (changed) { sections = updated; renderSections(); sendSectionOutputs(); }

  if (jobState.active && gpsState.speed_mph >= settings.min_operating_speed_mph) {
    jobState.total_applied_lbs = Math.max(0, jobState.start_weight - scaleState.weight_lbs);
    jobState.total_acres += (gpsState.speed_mph * MPH_TO_FT_PER_SEC * calcState.effective_width_ft) / SQ_FT_PER_ACRE;
    jobState.gps_track.push({ lat: gpsState.lat, lon: gpsState.lon, ts: Date.now() });
    mapPoints.push({ lat: gpsState.lat, lon: gpsState.lon, heading: gpsState.heading_deg, width_ft: calcState.effective_width_ft });
    jobState.coverage_cells = markSwathCoverage({
      lat: gpsState.lat, lon: gpsState.lon, headingDeg: gpsState.heading_deg,
      sections, coverageCells: jobState.coverage_cells,
      sectionWidthFt: settings.section_width_ft,
      speedMph: gpsState.speed_mph, jobActive: true,
      minSpeedMph: settings.min_operating_speed_mph,
    });
  }

  updateStatusBar();
  updateMetricsDisplay();
  updateJobDisplay();
  const canvas = document.getElementById('coverage-canvas');
  if (canvas) drawCoverageMap(canvas, { mapPoints, gpsState, sections, settings });
}

// ── GPS — real hardware via spreaderAPI ───────────────────────────────────────

async function connectGPS(portPath, baudRate) {
  try {
    await window.spreaderAPI.gpsConnect(portPath, baudRate);
    gpsState.connected = true;
    gpsState.simulated = false;
    updateStatusBar();
  } catch (err) {
    console.error('[GPS] connect failed:', err);
  }
}

window.spreaderAPI.onGpsSentence(sentence => {
  const update = parseNMEA(sentence, gpsState);
  if (!update) return;
  Object.assign(gpsState, update, { connected: true, simulated: false, last_update: Date.now() });
  recalculate();
});

window.spreaderAPI.onGpsDisconnect(() => {
  gpsState.connected = false;
  gpsState.simulated = true;
  updateStatusBar();
});

// ── Scale — WebSocket Pi Bridge (priority) + serial fallback ──────────────────

let scaleWs       = null;
let _wsRetryTimer = null;

function connectScaleWs() {
  if (scaleWs && (scaleWs.readyState === WebSocket.OPEN || scaleWs.readyState === WebSocket.CONNECTING)) return;
  try { scaleWs = new WebSocket(SCALE_WS_URL); } catch { _scheduleWsRetry(); return; }

  scaleWs.onopen = () => {
    clearTimeout(_wsRetryTimer);
    scaleState.connected = true;
    scaleState.piBridge  = true;
    scaleState.simulated = false;
    updateStatusBar();
  };

  scaleWs.onmessage = ev => {
    try {
      const msg = JSON.parse(ev.data);
      if (typeof msg.weight_lbs === 'number') { pushWeight(msg.weight_lbs); recalculate(); }
    } catch { /* ignore */ }
  };

  scaleWs.onclose = scaleWs.onerror = () => {
    if (!scaleState.piBridge) return;
    scaleState.connected = false;
    scaleState.piBridge  = false;
    scaleState.simulated = true;
    scaleWs = null;
    updateStatusBar();
    _scheduleWsRetry();
  };
}

function _scheduleWsRetry() {
  clearTimeout(_wsRetryTimer);
  _wsRetryTimer = setTimeout(connectScaleWs, SCALE_WS_RETRY_MS);
}

async function connectScale(portPath, baudRate) {
  try {
    await window.spreaderAPI.scaleConnect(portPath, baudRate);
    scaleState.connected = true;
    scaleState.simulated = false;
    scaleState.piBridge  = false;
    updateStatusBar();
  } catch (err) {
    console.error('[SCALE] connect failed:', err);
  }
}

// main process parses SL-2 format and sends the weight_lbs float directly
window.spreaderAPI.onScaleWeight(weightLbs => {
  pushWeight(weightLbs);
  recalculate();
});

window.spreaderAPI.onScaleDisconnect(() => {
  scaleState.connected = false;
  scaleState.simulated = true;
  scaleState.piBridge  = false;
  updateStatusBar();
});

// ── Port picker ───────────────────────────────────────────────────────────────

async function openPortPicker(target) {
  _portPickerTarget = target;
  _selectedPortPath = null;
  document.getElementById('port-picker-title').textContent = target === 'gps' ? 'Connect GPS' : 'Connect Scale';
  document.getElementById('port-baud').value = target === 'gps' ? GPS_BAUD_RATE : SCALE_BAUD_RATE;

  const ports = await window.spreaderAPI.listPorts();
  const list  = document.getElementById('port-list');
  list.innerHTML = '';
  if (ports.length === 0) {
    list.innerHTML = '<div style="color:var(--text-label);padding:8px">No serial ports found</div>';
  } else {
    ports.forEach(p => {
      const btn = document.createElement('button');
      btn.className   = 'port-item';
      btn.textContent = `${p.path}${p.friendlyName ? ' — ' + p.friendlyName : ''}`;
      btn.onclick = () => {
        document.querySelectorAll('.port-item').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        _selectedPortPath = p.path;
      };
      list.appendChild(btn);
    });
  }

  document.getElementById('port-picker-overlay').style.display = '';
}

function closePortPicker() { document.getElementById('port-picker-overlay').style.display = 'none'; }

async function confirmPortConnect() {
  if (!_selectedPortPath) return;
  const baud = parseInt(document.getElementById('port-baud').value);
  closePortPicker();
  if (_portPickerTarget === 'gps')   await connectGPS(_selectedPortPath, baud);
  if (_portPickerTarget === 'scale') await connectScale(_selectedPortPath, baud);
  if (_portPickerTarget === 'output') {
    await window.spreaderAPI.outputConnect(_selectedPortPath, baud);
    _outputConnected = true;
    updateStatusBar();
    sendSectionOutputs();  // push current state immediately on connect
  }
}

// ── Section output ────────────────────────────────────────────────────────────

// Send current section states to the physical output port (if connected).
// Called whenever section states change for any reason (ASC, manual, settings reset).
function sendSectionOutputs() {
  const states = sections.map(s => s.active);
  window.spreaderAPI.setSections(states).catch(() => { /* output port may not be connected */ });
}

// ── Sections ──────────────────────────────────────────────────────────────────

function renderSections() {
  const container = document.getElementById('sections-container');
  container.innerHTML = '';
  sections.forEach((sec, i) => {
    const btn = document.createElement('button');
    btn.className = 'section-btn ' + (sec.manual_override ? 'manual' : sec.active ? 'open' : 'closed');
    btn.textContent = i + 1;
    btn.onclick = () => {
      sections[i] = { ...sections[i], manual_override: !sections[i].manual_override, active: sections[i].manual_override };
      renderSections();
      sendSectionOutputs();
    };
    container.appendChild(btn);
  });
}

// ── Tare ──────────────────────────────────────────────────────────────────────

document.getElementById('btn-tare').addEventListener('click', () => {
  if (scaleState.piBridge && scaleWs?.readyState === WebSocket.OPEN) {
    scaleWs.send(JSON.stringify({ cmd: 'tare' }));
  } else {
    scaleState.tare_offset = scaleState.weight_lbs + scaleState.tare_offset;
  }
});

// ── Job management ────────────────────────────────────────────────────────────

function toggleJob() {
  if (jobState.active) stopJob();
  else startJob();
}

function startJob() {
  jobState.active            = true;
  jobState.start_time        = Date.now();
  jobState.start_weight      = scaleState.weight_lbs;
  jobState.total_applied_lbs = 0;
  jobState.total_acres       = 0;
  jobState.gps_track         = [];
  jobState.coverage_cells    = new Set();
  mapPoints                  = [];
  document.getElementById('btn-job').textContent = 'STOP JOB';
  document.getElementById('btn-job').style.background = 'var(--red)';
}

function stopJob() {
  jobState.active = false;
  document.getElementById('btn-job').textContent = 'START JOB';
  document.getElementById('btn-job').style.background = '';
  showJobSummary();
}

function showJobSummary() {
  const lbs     = jobState.total_applied_lbs;
  const acres   = jobState.total_acres;
  const elapsed = Math.floor((Date.now() - jobState.start_time) / 1000);
  const h       = String(Math.floor(elapsed / 3600)).padStart(2, '0');
  const m       = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
  document.getElementById('summary-lbs').textContent   = Math.round(lbs).toLocaleString() + ' lbs';
  document.getElementById('summary-tons').textContent  = (lbs / 2000).toFixed(1) + ' tons';
  document.getElementById('summary-acres').textContent = acres.toFixed(1) + ' ac';
  document.getElementById('summary-rate').textContent  = (acres > 0 ? Math.round(lbs / acres) : 0).toLocaleString() + ' lbs/ac';
  document.getElementById('summary-time').textContent  = `${h}:${m}`;
  document.getElementById('summary-field-name').value  = '';
  document.getElementById('job-summary-overlay').style.display = '';
}

function saveAndCloseJob() {
  const name  = document.getElementById('summary-field-name').value.trim();
  const lbs   = jobState.total_applied_lbs;
  const acres = jobState.total_acres;
  const job   = {
    id:                jobState.start_time,
    field_name:        name || 'Unnamed Field',
    start_time:        jobState.start_time,
    end_time:          Date.now(),
    total_applied_lbs: Math.round(lbs),
    total_acres:       parseFloat(acres.toFixed(2)),
    avg_rate_lbs_acre: acres > 0 ? Math.round(lbs / acres) : 0,
    gps_track:         jobState.gps_track,
  };
  const jobs = loadJobs();
  jobs.unshift(job);
  try { localStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify(jobs)); } catch { /* storage full */ }
  document.getElementById('job-summary-overlay').style.display = 'none';
  updateJobDisplay();
}

function loadJobs() {
  try { return JSON.parse(localStorage.getItem(JOBS_STORAGE_KEY) || '[]'); } catch { return []; }
}

function exportAllJobs() {
  const jobs = loadJobs();
  const blob = new Blob([JSON.stringify(jobs, null, 2)], { type: 'application/json' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `spreader-jobs-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
}

// ── Settings panel ────────────────────────────────────────────────────────────

function openSettings() {
  document.getElementById('set-target-rate').value    = settings.target_rate_lbs_per_acre;
  document.getElementById('set-spread-width').value   = settings.spread_width_ft;
  document.getElementById('set-section-count').value  = settings.section_count;
  document.getElementById('set-section-width').value  = settings.section_width_ft;
  document.getElementById('set-asc-threshold').value  = Math.round(settings.asc_overlap_threshold * 100);
  document.getElementById('set-min-speed').value      = settings.min_operating_speed_mph;
  document.getElementById('settings-panel').style.display = '';
}

function closeSettings() { document.getElementById('settings-panel').style.display = 'none'; }

function applySettings() {
  settings.target_rate_lbs_per_acre  = parseFloat(document.getElementById('set-target-rate').value)  || 500;
  settings.spread_width_ft           = parseFloat(document.getElementById('set-spread-width').value)  || 50;
  settings.section_count             = parseInt(document.getElementById('set-section-count').value)   || 10;
  settings.section_width_ft          = parseFloat(document.getElementById('set-section-width').value) || 5;
  settings.asc_overlap_threshold     = (parseFloat(document.getElementById('set-asc-threshold').value) || 50) / 100;
  settings.min_operating_speed_mph   = parseFloat(document.getElementById('set-min-speed').value)     || 0.3;
  sections = Array.from({ length: settings.section_count }, (_, i) => ({
    index: i, active: true, manual_override: false, asc_covered: false,
  }));
  renderSections();
  closeSettings();
}

// ── History panel ─────────────────────────────────────────────────────────────

function openHistory() {
  const jobs = loadJobs();
  const list = document.getElementById('history-list');
  if (jobs.length === 0) {
    list.innerHTML = '<div style="color:var(--text-label);padding:8px">No jobs recorded yet</div>';
  } else {
    list.innerHTML = jobs.map(j => `
      <div class="history-item">
        <div class="history-date">${new Date(j.start_time).toLocaleDateString()}</div>
        <div class="history-field">${j.field_name}</div>
        <div class="history-stats">
          ${(j.total_applied_lbs / 2000).toFixed(1)} tons · ${j.total_acres.toFixed(1)} ac · ${j.avg_rate_lbs_acre} lbs/ac
        </div>
      </div>`).join('');
  }
  document.getElementById('history-panel').style.display = '';
}

function closeHistory() { document.getElementById('history-panel').style.display = 'none'; }

// ── Display updates ───────────────────────────────────────────────────────────

let _outputConnected = false;

function updateStatusBar() {
  const gpsDot     = document.getElementById('gps-dot');
  const gpsText    = document.getElementById('gps-status-text');
  const scaleDot   = document.getElementById('scale-dot');
  const scaleText  = document.getElementById('scale-status-text');
  const outputDot  = document.getElementById('output-dot');
  const outputText = document.getElementById('output-status-text');
  const simBadge   = document.getElementById('sim-badge');
  const btnGPS     = document.getElementById('btn-connect-gps');
  const btnScale   = document.getElementById('btn-connect-scale');
  const btnOutput  = document.getElementById('btn-connect-output');

  if (_outputConnected) {
    outputDot.className      = 'status-dot ok';
    outputText.textContent   = 'Output · Connected';
    outputText.style.color   = 'var(--text-value)';
    btnOutput.style.display  = 'none';
  } else {
    outputDot.className      = 'status-dot';
    outputText.textContent   = 'Output · Disconnected';
    outputText.style.color   = 'var(--text-secondary)';
    btnOutput.style.display  = '';
  }

  simBadge.style.display = (gpsState.simulated || scaleState.simulated) ? '' : 'none';

  if (gpsState.connected || gpsState.simulated) {
    const fixLabel = { 0: 'No Fix', 1: 'GPS', 2: 'DGPS', 4: 'RTK', 5: 'Float' };
    const fix = gpsState.simulated ? 'SIM' : (fixLabel[gpsState.fix_quality] || 'GPS');
    gpsDot.className = 'status-dot live';
    gpsText.textContent = `GPS · ${gpsState.satellites} sats · ${fix}`;
    gpsText.style.color = 'var(--text-value)';
    btnGPS.style.display = 'none';
  } else {
    gpsDot.className = 'status-dot err';
    gpsText.textContent = 'GPS · Disconnected';
    gpsText.style.color = 'var(--red)';
    btnGPS.style.display = '';
  }

  if (scaleState.connected || scaleState.simulated) {
    scaleDot.className = 'status-dot live';
    scaleText.textContent = scaleState.simulated
      ? 'Scale · SIM'
      : scaleState.piBridge ? 'Scale · Pi Bridge' : 'Scale · Connected';
    scaleText.style.color = 'var(--text-value)';
    btnScale.style.display = 'none';
  } else {
    scaleDot.className = 'status-dot';
    scaleText.textContent = 'Scale · Disconnected';
    scaleText.style.color = 'var(--text-secondary)';
    btnScale.style.display = '';
  }
}

function updateMetricsDisplay() {
  const isScale    = scaleState.connected || scaleState.simulated;
  const isGPS      = gpsState.connected   || gpsState.simulated;
  const isSpreading = isScale && isGPS && calcState.rate_lbs_per_acre > 0;

  document.getElementById('metric-weight').classList.toggle('is-live', isScale);
  const w = scaleState.weight_lbs;
  document.getElementById('display-weight').innerHTML = isScale
    ? `${w.toLocaleString('en-US', { maximumFractionDigits: 0 })}<span class="metric-unit">lbs</span>`
    : `—<span class="metric-unit">lbs</span>`;

  const rateBlock = document.getElementById('metric-rate');
  rateBlock.classList.toggle('is-live',    isSpreading);
  rateBlock.classList.toggle('on-target',  isSpreading && Math.abs(calcState.rate_lbs_per_acre - settings.target_rate_lbs_per_acre) / settings.target_rate_lbs_per_acre < 0.1);
  rateBlock.classList.toggle('off-target', isSpreading && Math.abs(calcState.rate_lbs_per_acre - settings.target_rate_lbs_per_acre) / settings.target_rate_lbs_per_acre >= 0.1);
  document.getElementById('display-rate').innerHTML = isSpreading
    ? `${Math.round(calcState.rate_lbs_per_acre).toLocaleString()}<span class="metric-unit">lbs/ac</span>`
    : `—<span class="metric-unit">lbs/ac</span>`;

  document.getElementById('display-speed').innerHTML = isGPS
    ? `${gpsState.speed_mph.toFixed(1)}<span class="metric-unit">mph</span>`
    : `—<span class="metric-unit">mph</span>`;

  const tonsLeft = scaleState.weight_lbs / 2000;
  document.getElementById('display-tons-left').textContent = isScale ? tonsLeft.toFixed(1) : '—';
  document.getElementById('display-target-rate').innerHTML = `${settings.target_rate_lbs_per_acre}<span class="metric-unit">lbs/ac</span>`;
}

function updateJobDisplay() {
  if (!jobState.active) return;
  const lbs   = jobState.total_applied_lbs;
  const acres = jobState.total_acres;
  document.getElementById('display-applied').innerHTML  = `${Math.round(lbs).toLocaleString()}<span class="metric-unit">lbs</span>`;
  document.getElementById('display-acres').textContent  = acres.toFixed(1);
  document.getElementById('display-avg-rate').innerHTML = `${acres > 0 ? Math.round(lbs / acres).toLocaleString() : '—'}<span class="metric-unit">lb/ac</span>`;
}

function updateJobTimer() {
  if (!jobState.active || !jobState.start_time) return;
  const elapsed = Math.floor((Date.now() - jobState.start_time) / 1000);
  const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
  const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  document.getElementById('display-timer').textContent = `${h}:${m}:${s}`;
}

function updateClock() {
  document.getElementById('clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function resizeCanvas() {
  const canvas = document.getElementById('coverage-canvas');
  const panel  = document.getElementById('panel-map');
  const header = panel.querySelector('.panel-header');
  canvas.width  = panel.clientWidth  - 2;
  canvas.height = panel.clientHeight - header.offsetHeight - 2;
  drawCoverageMap(canvas, { mapPoints, gpsState, sections, settings });
  requestAnimationFrame(resizeCanvas);
}

// ── Boot ──────────────────────────────────────────────────────────────────────

window.spreaderAPI.getVersion().then(v => {
  document.getElementById('app-version').textContent = `v${v}`;
});

renderSections();
updateClock();
setInterval(updateClock, 1000);
setInterval(updateJobTimer, 1000);
requestAnimationFrame(resizeCanvas);
startSimulation();
connectScaleWs();

// Expose functions referenced by inline HTML onclick attributes
Object.assign(window, {
  openPortPicker, closePortPicker, confirmPortConnect,
  openSettings, closeSettings, applySettings,
  openHistory, closeHistory, exportAllJobs,
  toggleJob, saveAndCloseJob,
  setFloorSpeed: pct => window.spreaderAPI.setFloorSpeed(pct),
});
