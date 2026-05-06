# Architecture

How the system is designed and why.

---

## System Overview

```
┌─────────────────────────────────────────────────────────┐
│                    TRACTOR CAB                          │
│                                                         │
│   ┌─────────────────────────────────────────────────┐  │
│   │              Spreader OS UI                     │  │
│   │   (React/Electron or HTML prototype)            │  │
│   │                                                 │  │
│   │  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │  │
│   │  │ Live     │  │ Coverage │  │  Job / Rate  │  │  │
│   │  │ Weight   │  │   Map    │  │   Control    │  │  │
│   │  └──────────┘  └──────────┘  └──────────────┘  │  │
│   └─────────────────────────────────────────────────┘  │
│           │                    │                        │
│     GPS Serial           Load Cell Serial               │
└───────────┼────────────────────┼────────────────────────┘
            │                    │
    ┌───────────────┐   ┌────────────────┐
    │ John Deere    │   │  Load Cell     │
    │ StarFire GPS  │   │  Amplifier     │
    │ NMEA 0183     │   │  (HX711 or     │
    │ 19200 baud    │   │   Digi-Star    │
    └───────────────┘   │   SL2 RS-232) │
                        └────────┬───────┘
                                 │
                    ┌────────────┴────────────┐
                    │   Topcon Load Cells     │
                    │   1058115-01            │
                    │   20,000 kg / 2.2 mV/V  │
                    └─────────────────────────┘
```

---

## Data Flows

### GPS → Speed
1. StarFire outputs NMEA sentences at 19,200 baud
2. Parser extracts `$GPRMC` or `$GPVTG` for speed over ground
3. Speed (mph) feeds into LIW rate calculation and ASC logic

### Load Cell → Weight
1. Load cells output differential mV proportional to load
2. Amplifier converts to readable signal (RS-232 or ADC bits)
3. Rolling average applied (5-sample window) to smooth noise
4. Weight delta per second feeds into LIW rate calculation

### LIW Rate Calculation
```
lbs_per_acre = (delta_weight_lbs_per_sec × 43560)
               ÷ (speed_mph × 5280/3600 × spread_width_ft)
```
- `spread_width_ft` = 50 ft (10 sections × 5 ft)
- Active section count adjusts effective width for ASC

### Auto Section Control (ASC)
1. Coverage canvas tracks every GPS coordinate where material was applied
2. On each GPS update, check if current swath overlaps prior coverage
3. If overlap > threshold (default 50%), flag sections as covered
4. Covered sections: stop output signal to that section's gate

---

## Protocol Reference

### NMEA 0183 Sentences Used
| Sentence | Data Used |
|---|---|
| `$GPGGA` | Lat/lon, fix quality, satellites |
| `$GPRMC` | Speed over ground, lat/lon |
| `$GPVTG` | Speed over ground (backup) |

### Digi-Star SL2 RS-232 Format
- Baud: 9,600
- Data: 8N1
- Output: continuous weight string, format varies by model
- See `docs/digistar-sl2-protocol.md` for full parse spec

---

## UI Design Principles

1. **Primary values** — pure white, large. Weight, rate, speed.
2. **Labels** — medium gray. Never competes with values.
3. **Active/live state** — amber only. Not for decoration.
4. **Running state** — green only. Machine is operating.
5. **Everything must be readable at arm's length** — minimum 32px for operational values.
6. **No unnecessary chrome** — if it doesn't help the operator, remove it.

---

## Phase Boundaries

| Phase | Output | Key Constraint |
|---|---|---|
| 1 — HTML Prototype | Browser-based demo | Single HTML file, no build step |
| 2 — Demo Unit | Pi + HX711 + screen | $170 BOM, uses USC's existing load cells |
| 3 — Electron App | Windows .exe | Runs on cab laptop, real serial ports |
| 4 — Embedded Display | Standalone unit | 12V, IP67, no laptop needed |
| 5 — Commercial | Per-unit product | USC supplier agreement |
