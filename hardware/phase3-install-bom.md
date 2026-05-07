# Phase 3 — Cabinet Install BOM

**Goal:** Replace the Topcon Athene stack (SM-1 + SL2210) with Spreader OS running on a Windows tablet,
connected to the existing Digi-Star SL-2 scale, John Deere StarFire GPS, and new section gate relay board.

**Target BOM: ~$375–$975** (varies by tablet choice)

---

## Computer

| Option | Est. Cost | Notes |
|---|---|---|
| Refurb Microsoft Surface Pro 4/5/6 | ~$200 | Good option for low-budget install; USB-A hub needed |
| Panasonic Toughpad FZ-G1 (used) | ~$400 | Semi-rugged, sunlight-readable, farm-appropriate |
| Getac F110 G5/G6 (used) | ~$600–800 | MIL-STD-810H, IP65, best for production deploy |

**Minimum spec:** Windows 10/11, 4 GB RAM, 2× USB-A ports (or USB-C with hub), 1280×800 display.
For USC supply-agreement units, target Getac or Panasonic for durability.

---

## Peripherals & Interfaces

| Part | Qty | Est. Cost | Source / Notes |
|---|---|---|---|
| USB-to-RS-232 adapter (FTDI chip) | 2 | $24 | One for GPS, one for Digi-Star SL-2. Plugable USBC-232 or StarTech ICUSB232V2. FTDI chip required — CH340 adapters drop bytes at 19200 baud |
| Waveshare 8-ch USB relay board | 1 | $25 | CH340 USB; 10A/250VAC contacts; connects as virtual COM port. Item: "Waveshare USB relay 8-ch" |
| Powered USB 3.0 hub (4-port) | 1 | $18 | Only needed if tablet has < 3 USB-A ports |

---

## Power

| Part | Qty | Est. Cost | Notes |
|---|---|---|---|
| 12V → 65W USB-C PD adapter | 1 | $25 | Powers tablet from tractor 12V battery. Must support USB-C PD at tablet's required wattage |
| 12V → 5V 1A USB-A adapter | 1 | $8 | Powers Waveshare relay board via USB |

---

## Mounting & Enclosure

| Part | Qty | Est. Cost | Notes |
|---|---|---|---|
| RAM Mount double-ball arm + tablet tray | 1 | $45 | RAM-B-201-UN10U + appropriate tablet cradle. Drill-mount base to cab console |
| ABS DIN rail enclosure (~150×100mm) | 1 | $18 | Houses relay board and terminal blocks. Mount under console or on firewall |
| DIN rail + mounting hardware | 1 | $6 | For relay board inside enclosure |
| Terminal block strip, 10-pos | 1 | $8 | Section valve wiring inside enclosure |

---

## Wiring

| Part | Qty | Est. Cost | Notes |
|---|---|---|---|
| DB9 female connector + 6ft cable | 2 | $12 | One for Digi-Star SL-2 RS-232, one for StarFire RS-232 (if not USB-native) |
| 18 AWG wire, assorted colors (25ft) | 1 lot | $10 | Relay → section valve solenoids |
| Heat shrink assortment | 1 lot | $5 | |
| Ferrule crimping kit | 1 | $12 | For clean terminal block connections |

---

## **Total: ~$416–$1,016**

---

## Connections Reference

### GPS — John Deere StarFire

StarFire 2 / 3000 / 6000 receivers have a serial data output port.

```
StarFire RS-232 port → USB-RS-232 adapter → tablet USB
Protocol: NMEA 0183, 19,200 baud, 8N1
Sentences: $GPRMC, $GPGGA, $GPVTG
```

StarFire 6000 / SF3 units also have USB direct output — use that if available (no adapter needed).

### Scale — Digi-Star SL-2

The SL-2 indicator has a DB9 RS-232 output on the rear panel.

```
SL-2 DB9 Pin 2 (TX) → adapter RX
SL-2 DB9 Pin 5 (GND) → adapter GND
Protocol: 9,600 baud, 8N1
Format: " +012345 LB G\r\n" (see docs/digistar-sl2-protocol.md)
```

Must be in **Gross (G)** mode — if set to Net, LIW delta reads zero.
Setting: on SL-2 front panel → Menu → Output → Gross.

### Section Gates — Waveshare 8-ch USB Relay

```
Relay board USB → tablet USB (via hub if needed)
Board appears as virtual COM port (Windows: COMx via CH340 driver)
Spreader OS sends 1-byte bitmask: bit 0 = section 1, bit 7 = section 8
Relay NO contact → solenoid valve + (gate open when energized)
Relay COM contact → 12V switched power from tractor
Solenoid return → tractor ground
```

Install the CH340 driver if not auto-installed: [WCH CH341SER.EXE](https://www.wch.cn/download/CH341SER_EXE.html)

### Floor Belt Control

The floor belt drive valve accepts a 0–100% speed command. Spreader OS sends a two-byte frame
`[0xFF, speed_pct]` over the output port immediately after the section bitmask.

Exact valve interface TBD by Caleb. Options:
- **PWM solenoid valve:** microcontroller (Arduino Nano) receives the two-byte frame and outputs PWM
- **On/off hydraulic:** relay NO contact directly to floor belt solenoid (any speed > 0 = full on)

Tag Caleb on the GitHub issue before wiring the floor belt — controller selection affects firmware.

---

## Software Setup (Windows)

1. Install SpreaderOS from the NSIS installer (`SpreaderOS-Setup-x.x.x.exe`)
2. Launch Spreader OS; open Settings
3. Connect GPS port (select COM port, 19200 baud)
4. Connect Scale port (select COM port, 9600 baud)
5. Connect Output port (select relay board COM port, 9600 baud)
6. Tare the scale with empty spreader
7. Set target rate and spread width
8. Start Job

---

## What We're Replacing

| Topcon Component | Replaced By |
|---|---|
| SM-1 rate controller | Spreader OS rate controller (RC) |
| SL2210 display terminal | Windows tablet running Spreader OS |
| Topcon GPS receiver | John Deere StarFire (existing, NMEA pass-through) |
| Topcon section control outputs | Waveshare relay board |
| Topcon hydraulic output | TBD valve controller (Phase 3+) |

The Digi-Star SL-2 load cell indicator is **retained** — it already outputs RS-232 weight data.
The existing Topcon load cell wiring taps into the SL-2 input side; no load cell re-wiring needed.
