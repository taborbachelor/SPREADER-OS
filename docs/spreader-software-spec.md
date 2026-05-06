# Spreader Project — Software Specification
*For use in Claude Code sessions. Read this fully before writing any code.*

---

## Project Context

This is a custom spreader control system replacing the Topcon Athene stack (SM-1 + SL2210) for dry granular manure spreader trailers. Built by Tabor (software) and Caleb (hardware). Commercial target: supply agreement with USC LLC.

The software must be operator-first. The person using this is sitting in a tractor cab, possibly in bright sunlight, with gloves on. Every decision about UI, layout, font size, and interaction model flows from that constraint.

---

## Active Phase: Phase 1 — HTML Prototype

**The deliverable is a single self-contained file: `software/prototype/index.html`**

- No build step. No npm. No bundler.
- Opens directly in Chrome or Edge via `file://`
- All JS, CSS, and HTML in one file
- Must work with zero network access
- Web Serial API handles all hardware connections
- Simulation mode activates automatically when no hardware is connected

This file must be fully functional as both a hardware-connected tool and a standalone demo.

---

## Core Domain Logic

### 1. Loss-In-Weight (LIW) Application Rate

This is the heart of the system. It calculates how many pounds of product are being applied per acre, in real time, using weight loss and GPS speed.

```
lbs_per_acre = (delta_weight_lbs_per_second × 43,560)
               ÷ (speed_mph × (5,280 / 3,600) × effective_width_ft)
```

Variables:
- `delta_weight_lbs_per_second` — weight lost in the last second (always positive; spreader is losing weight)
- `speed_mph` — ground speed from GPS
- `effective_width_ft` — active spread width, adjusted by how many sections are open (default: 50 ft = 10 sections × 5 ft each)
- `43,560` — square feet per acre (constant)
- `5,280 / 3,600` — converts mph to ft/sec (constant)

Edge cases to handle:
- If speed is 0 or below ~0.3 mph, output rate = 0 (machine is stopped; don't divide by zero)
- If weight delta is negative (weight going up — shouldn't happen during spread, but can during loading), output rate = 0
- If no sections are active, output rate = 0

### 2. Weight Smoothing

Raw load cell readings are noisy. Apply a **5-sample rolling average** before using any weight value in calculations.

- Maintain a circular buffer of the last 5 weight readings
- Always use the average of those 5 samples as the "current weight"
- Calculate delta as: `avg_weight_now - avg_weight_1_second_ago`
- Do not use instantaneous deltas

### 3. Effective Width for ASC

When Auto Section Control closes a section (because that ground is already covered), reduce effective width:

```
effective_width_ft = active_section_count × 5
```

Where `active_section_count` is the number of sections currently open (0–10).

---

## Hardware Inputs

### GPS — John Deere StarFire (NMEA 0183)

**Connection:** USB Serial, 19,200 baud, 8N1

**Sentences to parse:**
- `$GPGGA` — latitude, longitude, fix quality, satellite count, altitude
- `$GPRMC` — latitude, longitude, speed over ground (knots), course, date/time
- `$GPVTG` — speed over ground (knots and km/h), course — use as speed backup if RMC missing

**Speed:**
- Primary source: `$GPRMC` field 7 (speed over ground in knots) → convert to mph: `knots × 1.15078`
- Backup: `$GPVTG` field 7 (speed in km/h) → convert: `km/h × 0.621371`
- Round to 1 decimal place for display

**Position:**
- Parse lat/lon from `$GPGGA` or `$GPRMC` (ddmm.mmmm format)
- Convert to decimal degrees: `degrees + (minutes / 60)`
- North/East = positive, South/West = negative
- Store with full precision (6+ decimal places) for coverage mapping

**Fix quality (from `$GPGGA` field 6):**
- 0 = no fix — show warning, disable rate output
- 1 = GPS fix — show as "GPS"
- 2 = DGPS fix — show as "DGPS"
- 4 = RTK fixed — show as "RTK"
- 5 = RTK float — show as "Float"

**Update rate:** Typically 1 Hz from StarFire. All calculations triggered on each new GPS sentence.

### Load Cell — HX711 (Phase 2) / Digi-Star SL2 RS-232 (Phase 3)

**Phase 1 (prototype):** Simulated weight input, or accept any serial stream that outputs a weight value in lbs as a plain number or simple string.

**Phase 2 HX711 (Raspberry Pi):**
- Python reads HX711 via GPIO (not serial)
- Calibration factor stored in `firmware/calibration.json` as `scale_factor`
- Raw value divided by scale factor = weight in lbs
- Feed weight into the web UI via a local WebSocket or injected JS variable

**Digi-Star SL2 RS-232 (Phase 3):**
- 9,600 baud, 8N1
- Outputs continuous weight string — parse the numeric weight value in lbs
- Protocol details: `docs/digistar-sl2-protocol.md` (to be created)

**Topcon load cell specs (for reference):**
- Model: 1058115-01
- Capacity: 44,092 lbs / 20,000 kg
- Output: 2.2061 mV/V
- 4-wire: Red=EXC+, Black=EXC-, White=SIG+, Green=SIG-

---

## Web Serial API Integration

Both GPS and load cell connect through the browser's Web Serial API (`navigator.serial`).

### Port Selection Flow
1. On startup, check if `navigator.serial` is available. If not, immediately enter simulation mode.
2. Present a connection panel with two "Connect" buttons: one for GPS, one for load cell.
3. Each button calls `navigator.serial.requestPort()` — this opens the browser's native port picker.
4. After port selection, open at the correct baud rate with 8N1.
5. Use a `ReadableStream` reader in a loop to continuously receive data.
6. Parse incoming bytes as UTF-8 text, buffer until newline, then process each complete sentence.

### Disconnection Handling
- Detect serial disconnect via stream errors
- Show a clear "GPS DISCONNECTED" or "SCALE DISCONNECTED" banner
- Continue displaying last known values, clearly marked as stale (grayed out or with a timestamp)
- Attempt to fall back to simulation for that input if disconnected

### Simulation Mode
When hardware is not connected (or on any non-Chrome/Edge browser):
- GPS simulation: generate a fake lat/lon position moving in a straight line. Increment position at ~5 mph. Output a new simulated `$GPRMC` sentence every 1 second.
- Weight simulation: start at a realistic spreader load (e.g., 20,000 lbs). Decrease by a random amount each second proportional to simulated speed and a target rate (e.g., 500 lbs/acre). Add small random noise (±10 lbs) to mimic real sensor noise.
- Show a visible "SIMULATION MODE" indicator in the UI at all times when running simulated data.

---

## Auto Section Control (ASC)

### What it does
Tracks where product has already been applied. When the machine drives over previously covered ground, it closes the gate on the overlapping sections to prevent double-application.

### Coverage Canvas
- Maintain an in-memory map (2D array or canvas) of covered GPS coordinates
- Each cell represents approximately 5 ft × 5 ft of real-world ground
- When the spreader is running (weight decreasing, speed > threshold), mark the current swath as covered
- Current swath = a rectangle centered on current GPS position, `effective_width_ft` wide, extending back along the direction of travel

### ASC Logic (runs on each GPS update)
1. Get current GPS position and heading
2. Project the current swath footprint (50 ft wide, 1 swath step long)
3. For each of the 10 sections (each 5 ft wide), check: does this section's footprint overlap any previously covered cells?
4. If overlap percentage exceeds the threshold (default 50%, user-adjustable), mark that section as "covered" → set its gate to CLOSED
5. If overlap is below threshold, section stays OPEN
6. Sections can reopen if the machine drives into uncovered ground (e.g., turning around at field edge)

### Section Output Signals
Phase 1: Log section state changes to console and display section status in UI
Phase 3+: Output actual digital signals to section gate valves (GPIO or serial command)

### ASC Settings
- Enable/disable ASC globally (toggle)
- Overlap threshold: 0–100%, default 50%
- Minimum speed to apply coverage: default 0.3 mph (don't mark coverage while creeping or stopped)

---

## UI Layout & Design Rules

These are hard constraints. Do not deviate.

### Display Requirements
- Primary values (weight, rate, speed): pure white, minimum 32px font size
- Labels (the word "WEIGHT", "RATE", "SPEED"): medium gray, never competes with values
- Active/live state (data actively updating): amber color only (`#F59E0B` or similar)
- Running/operating state (spreader is actively applying): green only (`#22C55E` or similar)
- Warning/error states: red (`#EF4444`)
- Background: dark — near black (`#0F1117` or similar). This is a cab display. White backgrounds wash out in sunlight.
- No decorative elements. No gradients. No animations beyond data updating. No icons that don't serve a function.
- Everything must be readable at arm's length (~3 feet from a tablet/screen in a cab)

### Main Screen Layout

The main screen has three primary panels visible at all times:

**Panel 1 — Live Metrics (top priority, largest text)**
- Current weight (lbs) — largest value on screen
- Current application rate (lbs/acre) — second largest
- GPS speed (mph)
- Load remaining (% of starting weight, or tons remaining)

**Panel 2 — Coverage Map**
- Top-down view of the field being worked
- Shows covered area in green
- Shows current machine position and heading as a marker
- Section status shown at machine position (which sections are open/closed)
- Map must zoom to fit covered area automatically
- Show scale reference

**Panel 3 — Job / Rate Control**
- Target rate input (lbs/acre) — user sets this
- Actual vs. target rate comparison (are we on target?)
- Start Job / Stop Job button
- Job timer (elapsed time)
- Total applied this job (lbs, tons, acres)

**Section Control Panel (collapsible or sidebar)**
- 10 section indicators in a row (representing the 50 ft boom)
- Each shows: OPEN (green) or CLOSED (amber/red)
- Manual override per section
- ASC enable/disable toggle

**Status Bar (always visible, bottom or top)**
- GPS fix status and satellite count
- Scale connection status
- Simulation mode indicator (if active)
- Current time

### Settings Screen (separate from main)
- Spread width (default 50 ft) — total and per-section count
- Section width (default 5 ft per section, 10 sections)
- ASC overlap threshold (0–100%)
- Minimum operating speed (default 0.3 mph)
- Target application rate (lbs/acre)
- GPS port / baud rate
- Scale port / baud rate
- Calibration factor (for HX711, Phase 2)
- Unit toggle: lbs/lbs-per-acre vs. kg/kg-per-hectare (future)

---

## Job Management

### Job Lifecycle
1. User presses "Start Job" → system begins logging, recording coverage, calculating totals
2. System logs GPS track, weight readings, section states, and rate at ~1 Hz
3. User presses "Stop Job" → system freezes totals, saves job record, prompts for field name
4. Job data is stored in localStorage (Phase 1) or local file (Phase 3)

### Per-Job Data to Record
- Job ID (timestamp-based)
- Field name (user input)
- Operator name (optional)
- Date and time (start and end)
- Total material applied (lbs)
- Total acres covered
- Average application rate (lbs/acre)
- GPS track (array of lat/lon points with timestamps)
- Coverage map snapshot
- Min/max/avg speed
- Any ASC events (section closed, section reopened, coordinates)

### Job History Screen
- List of past jobs, sorted by date (most recent first)
- Each job shows: date, field name, total lbs applied, total acres, avg rate
- Tap/click a job to see full detail and map replay
- Export button: generates a CSV or JSON file of job data

### Data Export
Phase 1: Download as JSON file via browser download
Phase 3: Save to local filesystem, optionally sync to cloud

---

## State Management

The application has these top-level state objects:

```javascript
// Hardware state
gpsState: {
  connected: boolean,
  simulated: boolean,
  lat: number,
  lon: number,
  speed_mph: number,
  heading_deg: number,
  fix_quality: number,
  satellites: number,
  last_update: timestamp
}

scaleState: {
  connected: boolean,
  simulated: boolean,
  weight_lbs: number,          // current smoothed weight
  weight_buffer: number[],     // last 5 raw readings
  tare_offset: number,         // subtracted from raw to get net weight
  last_update: timestamp
}

// Calculated values (derived, never stored directly)
calcState: {
  delta_weight_per_sec: number,
  rate_lbs_per_acre: number,
  effective_width_ft: number,
  active_section_count: number
}

// Job state
jobState: {
  active: boolean,
  start_time: timestamp,
  start_weight: number,
  total_applied_lbs: number,
  total_acres: number,
  gps_track: Array<{lat, lon, timestamp}>,
  coverage_cells: Set<string>   // "lat_cell:lon_cell" keys
}

// Section state (array of 10)
sections: Array<{
  index: number,        // 0–9, left to right
  active: boolean,      // is gate open?
  manual_override: boolean,
  asc_covered: boolean
}>

// Settings
settings: {
  spread_width_ft: 50,
  section_count: 10,
  section_width_ft: 5,
  asc_enabled: true,
  asc_overlap_threshold: 0.5,
  min_operating_speed_mph: 0.3,
  target_rate_lbs_per_acre: number,
  // ... etc
}
```

---

## Update Loop

The system runs on two independent update loops:

**GPS Loop** (event-driven, fires on each complete NMEA sentence)
1. Parse incoming sentence
2. Update `gpsState`
3. If job is active and speed > min threshold: record GPS track point
4. Run ASC check against coverage map
5. Update section states
6. Recalculate `calcState`
7. Trigger UI update for all GPS-dependent displays

**Scale Loop** (either event-driven from serial, or polled at 10 Hz)
1. Read new weight value
2. Push to 5-sample rolling buffer
3. Calculate smoothed weight
4. Update `scaleState`
5. Calculate `delta_weight_per_sec`
6. Recalculate `calcState`
7. Trigger UI update for all weight-dependent displays

**Do not** use `setInterval` as the primary calculation trigger. Calculations must be driven by real data events. `setInterval` can be used only for display refresh or simulation tick.

---

## File Structure

```
spreader-project/
├── software/
│   ├── prototype/
│   │   └── index.html          ← ACTIVE DEVELOPMENT (single file, everything here)
│   ├── electron/               ← Phase 3 (don't touch yet)
│   └── shared/                 ← Shared logic extracted from prototype for reuse
│       ├── nmea-parser.js      ← NMEA sentence parsing
│       ├── liw-calc.js         ← Loss-in-weight rate calculation
│       ├── asc-engine.js       ← Auto section control logic
│       └── coverage-map.js     ← Coverage tracking and map rendering
├── hardware/                   ← Caleb's domain
├── firmware/
│   └── calibration.json        ← HX711 scale factor: { "scale_factor": 12345.0 }
├── docs/
│   └── architecture.md
├── field-notes/
│   └── TEMPLATE.md
└── [root files only: README, .gitignore, LICENSE, CLAUDE.md]
```

For Phase 1, everything lives in `software/prototype/index.html`. As logic matures, extract it into `software/shared/` so Phase 3 (Electron) can import it without rewriting.

---

## Code Quality Rules

- **No external dependencies** in Phase 1. Vanilla JS only. No React, no Vue, no lodash.
- **No build step** in Phase 1. The file must open as-is.
- **Comment all formulas** with units. If a number is `43560`, the comment must say `// sq ft per acre`.
- **Constants at the top** of the file, named in SCREAMING_SNAKE_CASE. Never hardcode magic numbers inside functions.
- **Function names describe what they return or do**, not how: `calculateRateFromWeight()` not `doTheMath()`.
- **Fail loudly in simulation, silently in production**. Log simulation events to `console.debug`. Don't litter the console in hardware mode.
- **Never mutate state directly** — all state changes go through update functions that also trigger the relevant UI refresh.
- **GPS and scale are always optional** — the app never crashes because hardware isn't connected.

---

## Branch & Commit Rules

- Active work happens on `dev`, not `main`
- `main` = demo-ready only. Never push broken code there.
- Feature branches: `feature/[short-name]`
- Commit prefixes: `feat` `fix` `docs` `hardware` `field` `refactor` `chore`

Good commit examples:
```
feat: add 5-sample rolling average to weight smoothing
fix: rate calculation divides by zero at low speed
refactor: extract NMEA parser into shared module
docs: add ASC overlap threshold explanation
```

---

## Phase 2 Notes (Raspberry Pi Demo Unit)

Phase 2 builds on the Phase 1 prototype. The same `index.html` runs in Chromium kiosk mode on a Pi 4 with a 7" touchscreen.

Key additions for Phase 2:
- A Python bridge script (`firmware/hx711-bridge.py`) reads the HX711 via GPIO and feeds weight data to the browser via WebSocket on `localhost:8765`
- The HTML prototype detects the WebSocket and uses it instead of Web Serial for weight
- GPS still comes via USB serial (u-blox dongle at 19,200 baud)
- Calibration factor loaded from `firmware/calibration.json`
- UI must be fully touch-operable — minimum tap target size 44×44px
- No keyboard required for any normal operation

HX711 GPIO pins (BCM numbering):
- First HX711: DT → GPIO 5, SCK → GPIO 6
- Second HX711: DT → GPIO 13, SCK → GPIO 19

Pi auto-launch (kiosk mode, add to `/etc/rc.local`):
```bash
chromium-browser --kiosk --noerrdialogs --disable-infobars \
  file:///home/pi/spreader-project/software/prototype/index.html &
```

---

## What is NOT in Phase 1 or 2

Do not build these yet. They come in Phase 3+:
- Hydraulic floor belt control output
- Section gate actuation (physical outputs)
- Cloud sync or remote data access
- Variable rate prescription map (shapefile input)
- Windows Electron packaging
- Multi-user or multi-machine support

---

## Demo Script (for USC meeting)

The Phase 2 unit must be able to do this in under 10 minutes:
1. Power on from tractor 12V — UI loads in ~30 seconds
2. Show empty spreader weight (tared to zero)
3. Load product — show live weight climbing on screen
4. Show calculated load (tons in box)
5. Drive slowly — show GPS speed, LIW rate calculating live
6. Show coverage map updating in real time
7. Show job report at end with total applied and acres covered

The numbers do the selling. Don't add features to impress — add accuracy to build trust.

---

*Tabor & Caleb — Spreader Project, 2025*
