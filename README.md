# spreader-project

A smarter, open spreader control system — built to outperform Topcon's Athene stack at a fraction of the cost.

Built by **Tabor** (software, IoT, UI, AI) and **Caleb** (hardware, wiring, field testing).

---

## What This Is

A full spreader control platform for dry granular manure spreader trailers. It replaces the Topcon SM-1 + SL2210 ISO stack with our own hardware and software, and adds capabilities Topcon doesn't offer:

- Real-time loss-in-weight (LIW) application rate from load cells
- GPS speed-proportional floor belt control
- Auto Section Control (ASC) with configurable overlap
- Variable rate zone support (shapefile/prescription)
- Field coverage mapping
- Job history, reporting, and data export
- A UI that's actually readable from a tractor cab

---

## Project Phases

### ✅ Phase 1 — HTML Prototype (current)
Single-file HTML/JS prototype running in a browser. Proves the UI and core logic. Web Serial API connects to real GPS and load cell hardware when available, simulation fallback when not.

### 🔲 Phase 2 — Demo Unit (~$170 BOM)
Raspberry Pi 4 + HX711 load cell amplifiers + 7" touchscreen in an IP65 enclosure. Wires directly into existing Topcon load cells on USC spreaders. Proves real-world hardware integration and weight accuracy. No rate control yet — just weight, rate calc, and display.

### 🔲 Phase 3 — Electron App (Windows)
Migrate prototype to a proper Electron-based Windows application. Runs on a laptop in the cab. Full Web Serial integration for GPS (John Deere StarFire, NMEA 0183) and load cell (Digi-Star SL2 RS-232).

### 🔲 Phase 4 — Dedicated Cab Display
Custom embedded Linux display unit (replaces laptop). Ruggedized, 12V powered, plug-and-play for the spreader.

### 🔲 Phase 5 — Commercial
Supply agreement with USC LLC. Per-unit pricing. Ongoing software support.

---

## Hardware Targets

| Component | Spec |
|---|---|
| GPS Receiver | John Deere StarFire — NMEA 0183 (GGA/VTG/RMC), 19,200 baud |
| Load Cell | Topcon 1058115-01 — 44,092 lb / 20,000 kg, 2.2061 mV/V |
| Scale Amplifier | Topcon SL2210 ISO (Phase 1-2) → custom HX711 board (Phase 2+) |
| Spreader Controller | Topcon SM-3X dry granular (competitive reference) |
| Spreader Specs | 50 ft width, 10 sections @ 5 ft each, dry granular only |

---

## Repo Structure

```
spreader-project/
├── software/
│   ├── prototype/        # Single-file HTML prototype (current active dev)
│   ├── electron/         # Electron Windows app (Phase 3)
│   └── shared/           # Shared logic: NMEA parsing, LIW calc, ASC, etc.
├── hardware/             # Wiring diagrams, BOM, enclosure specs, PCB files
├── firmware/             # Raspberry Pi setup scripts, embedded config
├── docs/                 # Architecture notes, field test results, API docs
├── field-notes/          # Real-world test logs, calibration records
└── assets/               # Logos, UI screenshots, demo media
```

---

## Core Formula

**Loss-In-Weight Application Rate:**
```
lbs/acre = (ΔWeight_per_second × 43,560) ÷ (speed_mph × 5,280/3,600 × width_ft)
```

---

## Getting Started (Prototype)

1. Open `software/prototype/index.html` in Chrome or Edge
2. Connect GPS via USB serial — select port when prompted (19,200 baud)
3. Connect load cell indicator via USB serial (9,600 baud)
4. If no hardware connected, simulation mode activates automatically

---

## Status

> 🚧 Active prototype development. Not production ready.

---

*Tabor & Caleb — 2025*
