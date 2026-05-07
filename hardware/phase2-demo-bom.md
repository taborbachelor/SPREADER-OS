# Phase 2 — Demo Unit Build

**Goal:** Wire into a USC spreader's existing Topcon load cells, display accurate live weight and application rate on our own UI. Get this in front of USC.

**Target BOM: ~$170**

---

## Bill of Materials

| Part | Qty | Est. Cost | Source |
|---|---|---|---|
| Raspberry Pi 4 (2GB) | 1 | $45 | rpilocator.com / PiShop.us |
| Official Pi 7" Touchscreen | 1 | $55 | Adafruit, Amazon |
| HX711 load cell amplifier module | 2 | $4 | Amazon (cheap pack) |
| IP65 project enclosure (ABS, ~200×150mm) | 1 | $18 | Amazon |
| 12V → 5V 3A buck converter (USB-C out) | 1 | $8 | Amazon |
| USB GPS dongle (u-blox chipset) | 1 | $25 | Amazon |
| Terminal block strip (12-pos) | 1 | $6 | Amazon |
| 22 AWG shielded 4-conductor cable (10ft) | 1 | $8 | Amazon |
| DIN rail + mounting hardware | 1 | $6 | Amazon |
| Jumper wires, heat shrink, connectors | lot | $5 | Amazon |
| **Total** | | **~$180** | |

---

## Load Cell Wiring

The Topcon 1058115-01 is a 4-wire shear beam load cell.

```
Load Cell Wire → HX711 Pin
─────────────────────────────
Red   (EXC+)  → E+
Black (EXC-)  → E-
White (SIG+)  → A+
Green (SIG-)  → A-
```

**Important:** Do NOT disconnect the Topcon SL2210 from the load cells during testing — you'll need to tap in parallel using a breakout/junction point, not cut wires. Use a terminal block to split the signal without breaking the existing connection.

If USC's spreader is actively in use, coordinate with Caleb to do this when it's parked.

---

## HX711 → Raspberry Pi Wiring

```
HX711 Pin → Pi GPIO (BCM numbering)
────────────────────────────────────
VCC       → 3.3V (Pin 1)
GND       → GND  (Pin 6)

First HX711:
DT        → GPIO 5  (Pin 29)
SCK       → GPIO 6  (Pin 31)

Second HX711:
DT        → GPIO 13 (Pin 33)
SCK       → GPIO 19 (Pin 35)
```

Use the `hx711` Python library for reading.

---

## Calibration Procedure

1. With empty spreader, zero the scale (`tare`)
2. Place a known weight in the spreader (at least 500 lbs for accuracy — use a pallet of fertilizer bags if available)
3. Record raw HX711 value at known weight
4. Calculate `scale_factor = known_weight_lbs / raw_value`
5. Store in `firmware/calibration.json`
6. Repeat with a second known weight to verify linearity

Log all calibration runs in `field-notes/` with date, temperature, and results.

---

## Software Setup (Raspberry Pi)

```bash
# Flash Raspberry Pi OS Lite (64-bit) to SD card via Raspberry Pi Imager
# Enable SSH, set hostname: spreader-pi, set your WiFi

# After first boot:
sudo apt update && sudo apt upgrade -y
sudo apt install python3-pip git chromium-browser -y
pip3 install hx711 pyserial RPi.GPIO

# Clone the repo
git clone https://github.com/taborbachelor/spreader-project.git

# Auto-launch UI on boot (kiosk mode)
# Add to /etc/rc.local before exit 0:
chromium-browser --kiosk --noerrdialogs --disable-infobars \
  file:///home/pi/spreader-project/software/prototype/index.html &
```

---

## Demo Script (for the USC meeting)

1. Power on the Pi from tractor 12V
2. UI loads in ~30 seconds
3. Show empty spreader weight (tared to zero)
4. Load product — show live weight climbing
5. Show calculated load (tons in box)
6. Drive slowly — show GPS speed, LIW rate calculating live
7. Show coverage map updating
8. Show job report at end

Keep it under 10 minutes. Let the numbers speak.

---

## What We're NOT Showing Yet

- Hydraulic floor control output (Phase 3)
- Section control actuation (Phase 3)
- Cloud sync (Phase 3+)

That's intentional. The demo proves instrumentation and UI. Control comes after USC says yes.
