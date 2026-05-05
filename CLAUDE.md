# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project Overview

A custom spreader control system replacing the Topcon Athene stack (SM-1 + SL2210) for dry granular manure spreader trailers. Built by Tabor (software) and Caleb (hardware). Commercial target: supply agreement with USC LLC.

---

## Current Phase

**Phase 1 — HTML Prototype** is the active development target. It lives in `software/prototype/index.html` as a single self-contained file with no build step.

Open it directly in Chrome or Edge. Web Serial API connects to real hardware; simulation mode activates automatically when no hardware is connected.

---

## Core Domain Logic

**Loss-In-Weight (LIW) Application Rate:**
```
lbs/acre = (ΔWeight_per_second × 43,560) ÷ (speed_mph × 5,280/3,600 × width_ft)
```
- Spread width: 50 ft (10 sections × 5 ft)
- Active section count adjusts effective width for ASC (Auto Section Control)
- Weight readings use a 5-sample rolling average to smooth noise

**GPS input:** NMEA 0183 sentences `$GPGGA`, `$GPRMC`, `$GPVTG` at 19,200 baud (John Deere StarFire)

**Load cell input:** HX711 (Phase 2 Pi) or Digi-Star SL2 RS-232 at 9,600 baud 8N1

**ASC logic:** On each GPS update, check current swath against coverage canvas. If overlap exceeds threshold (default 50%), close that section's gate output.

---

## Phase 2 — Raspberry Pi Demo Unit

Software setup for the Pi demo unit:
```bash
sudo apt install python3-pip git chromium-browser -y
pip3 install hx711 pyserial RPi.GPIO
git clone https://github.com/[yourhandle]/spreader-project.git
```

Kiosk auto-launch (add to `/etc/rc.local`):
```bash
chromium-browser --kiosk --noerrdialogs --disable-infobars \
  file:///home/pi/spreader-project/software/prototype/index.html &
```

HX711 calibration factor stored in `firmware/calibration.json`. Calibration procedure documented in `phase2-demo-bom.md`.

---

## File Placement Rules

- UI / prototype code → `software/prototype/`
- Shared parsing and calculation logic → `software/shared/`
- Electron app (Phase 3) → `software/electron/`
- Wiring diagrams, BOM, enclosure specs → `hardware/`
- Pi setup scripts, calibration config → `firmware/`
- Architecture decisions → `docs/`
- Field test logs → `field-notes/YYYY-MM-DD.md` (use `TEMPLATE.md`)
- Nothing goes in the root except README, .gitignore, LICENSE, CLAUDE.md

---

## Branch and Commit Strategy

- `main` — stable, demo-ready only
- `dev` — active development; PRs target `dev`, not `main`
- Feature branches: `feature/[short-name]` for work spanning more than a day

Commit prefixes: `feat` `fix` `docs` `hardware` `field` `refactor` `chore`

---

## UI Design Constraints

These are hard rules for the operator-facing UI:

- Primary values (weight, rate, speed): pure white, minimum 32px
- Labels: medium gray — never competes with values
- Active/live state: amber only
- Running/operating state: green only
- No decorative chrome — if it doesn't help the operator, remove it

---

## Ownership

- **Tabor** owns: software, UI/UX, NMEA parsing, LIW calculation, ASC, data layer, AI features
- **Caleb** owns: hardware wiring, load cell calibration, enclosure, physical install, field testing

Cross-domain work (new sensor integrations, etc.) requires an issue tagged to both before starting.
