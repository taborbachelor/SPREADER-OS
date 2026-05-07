# Architecture

How the system is designed and why.

---

## System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                         TRACTOR CAB                              │
│                                                                  │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │                    Spreader OS UI                        │  │
│   │   Phase 1: browser file://   Phase 3: Electron .exe      │  │
│   │                                                          │  │
│   │  ┌──────────┐  ┌────────────┐  ┌──────────────────────┐ │  │
│   │  │  Live    │  │  Coverage  │  │  Job / Rate Control  │ │  │
│   │  │  Metrics │  │    Map     │  │  Prescription Rx     │ │  │
│   │  └──────────┘  └────────────┘  └──────────────────────┘ │  │
│   └──────────────────────────────────────────────────────────┘  │
│          │              │ WebSocket         │                    │
│     GPS Serial      Pi Bridge          Output Serial            │
│     (USB dongle)    localhost:8765      (USB relay / MCU)        │
└──────────┼──────────────┼───────────────────┼────────────────────┘
           │              │                   │
   ┌───────────────┐  ┌───────────────┐  ┌────────────────────┐
   │ John Deere    │  │ Raspberry Pi  │  │  Section Gate      │
   │ StarFire GPS  │  │ + HX711 ×2    │  │  Valve Controller  │
   │ NMEA 0183     │  │ hx711-bridge  │  │  (Phase 3 — TBD    │
   │ 19,200 baud   │  │ .py           │  │   by Caleb)        │
   └───────────────┘  └───────┬───────┘  └────────────────────┘
                              │
                  ┌───────────────────────┐
                  │   Topcon Load Cells   │
                  │   1058115-01          │
                  │   2× tapped parallel  │
                  │   from SL2210         │
                  └───────────────────────┘
```

---

## Software Layers

```
software/
├── prototype/index.html      ← Phase 1 + 2: single file, runs file://
│                               Imports nothing — all logic inline
│
├── shared/                   ← Pure ES modules, no DOM/global state
│   ├── nmea-parser.js        ← parseNMEA(), checksumOk(), nmeaToDeg()
│   ├── liw-calc.js           ← smoothWeight(), calcDeltaWeight(), calculateRate()
│   ├── asc-engine.js         ← runASCCheck(), markSwathCoverage()
│   ├── coverage-map.js       ← buildMapTransform(), drawCoverageMap()
│   └── prescription-map.js   ← parsePrescription(), getTargetRate(), drawPrescriptionZones()
│
└── electron/                 ← Phase 3: Electron + Node.js
    ├── main.js               ← BrowserWindow, IPC handlers (serial, files, outputs)
    ├── preload.js            ← contextBridge → window.spreaderAPI
    └── renderer/
        ├── index.html        ← UI shell (same layout as prototype)
        ├── app.js            ← Imports from shared/; wires spreaderAPI events
        └── style.css         ← Shared design tokens
```

---

## Data Flows

### GPS → Rate
1. StarFire outputs NMEA at 19,200 baud via USB serial
2. Phase 1/2: Web Serial API → `processNMEA()` inline
3. Phase 3: `serialport` in main process → IPC `gps:sentence` → `parseNMEA()` from shared
4. Speed (mph) + heading feed LIW rate calculation and ASC logic

### Load Cell → Weight
1. Topcon 1058115-01 load cells output differential mV
2. **Phase 2 (Pi):** HX711 ADC → `hx711-bridge.py` → WebSocket `ws://localhost:8765` → UI
3. **Phase 3 (direct):** Digi-Star SL-2 RS-232 → `parseSL2Line()` in main process → IPC `scale:weight` → UI
4. 5-sample rolling average applied via `smoothWeight()` before rate calc

### LIW Rate Calculation
```
lbs_per_acre = (delta_weight_lbs_per_sec × 43,560)
               ÷ (speed_mph × (5,280 / 3,600) × effective_width_ft)
```
- `effective_width_ft` = open section count × 5 ft/section
- Minimum speed threshold (0.3 mph) prevents divide-by-zero at rest

### Auto Section Control (ASC)
1. Coverage tracked as a Set of 5 ft × 5 ft grid cell keys
2. On each GPS update: `runASCCheck()` tests each section's look-ahead position
3. If cell is already covered → section `asc_covered = true`, `active = false`
4. `markSwathCoverage()` runs AFTER the check so first pass never self-closes
5. Section state changes immediately sent to output port via `setSections()` IPC

### Variable Rate Prescription
1. User loads a GeoJSON file (exported from QGIS, SMS, JD Ops Center)
2. `parsePrescription()` extracts Polygon/MultiPolygon features with `rate_lbs_acre` property
3. On each GPS update: `getTargetRate(lat, lon, zones)` → ray-cast point-in-polygon
4. If inside a zone: `settings.target_rate_lbs_per_acre` updates automatically
5. Zones rendered as amber→green color ramp overlay on coverage map

### Section Gate + Floor Output
1. Phase 3: output serial port connected to USB relay board or microcontroller
2. On any section state change: 8-bit bitmask → `output:setSections` IPC → one byte written
3. Hydraulic floor speed: `[0xFF, speed_0_to_100]` two-byte frame → `output:setFloorSpeed` IPC

---

## Protocol Reference

### NMEA 0183 Sentences
| Sentence | Data Used |
|---|---|
| `$GPGGA` / `$GNGGA` | Lat/lon, fix quality, satellite count |
| `$GPRMC` / `$GNRMC` | Speed (knots), lat/lon, heading |
| `$GPVTG` / `$GNVTG` | Speed backup, heading |

Baud: 19,200. Fix quality 4 = RTK Fixed (target for field use).

### Digi-Star SL-2 RS-232
- Baud: 9,600, 8N1, no flow control
- Record: `" +012345 LB G\r\n"` (15 bytes, fixed width)
- See `docs/digistar-sl2-protocol.md` for full spec and wiring

### HX711 WebSocket Bridge
- URL: `ws://localhost:8765`
- Broadcast: `{"weight_lbs": 12345.6, "source": "hx711"}` at 10 Hz
- Commands: `{"cmd": "tare"}` | `{"cmd": "calibrate", "known_weight_lbs": 500}`

### Section Output (bitmask)
- One byte per update: bit 0 = section 1, bit 7 = section 8
- High = open (spreading), Low = closed
- Hydraulic floor: `[0xFF, 0–100]` — marker byte + speed percent

---

## UI Design Constraints (hard rules)

1. Primary values (weight, rate, speed): pure white, ≥ 32px
2. Labels: medium gray — never competes with values
3. Live/active state: amber only (`#F59E0B`)
4. Running/spreading state: green only (`#22C55E`)
5. Warnings/errors: red (`#EF4444`)
6. Background: `#0F1117` — near black (cab display, sunlight readable)
7. No decorative chrome — every element must serve the operator
8. Minimum tap target: 44 × 44 px

---

## Phase Boundaries

| Phase | Deliverable | Status |
|---|---|---|
| 1 — HTML Prototype | Single `index.html`, simulation + Web Serial | ✅ Complete |
| 2 — Pi Demo Unit | Pi 4 + HX711 + 7" touchscreen, WebSocket bridge | ✅ Complete |
| 3 — Electron App | Windows .exe, real COM ports, section/floor output, variable rate Rx | 🔨 In progress |
| 4 — Embedded Display | Standalone 12V unit, IP67, no laptop | Not started |
| 5 — Commercial | Per-unit product, USC supplier agreement | Not started |

### Phase 3 checklist
- [x] Electron scaffold (window, IPC, preload)
- [x] GPS serial via Node serialport
- [x] Digi-Star SL-2 serial parser
- [x] Section gate output IPC (bitmask)
- [x] Hydraulic floor control IPC (stub)
- [x] Variable rate prescription map (GeoJSON)
- [ ] Windows NSIS installer (`npm run build:win`)
- [ ] Cloud job sync
- [ ] Field test on USC spreader
