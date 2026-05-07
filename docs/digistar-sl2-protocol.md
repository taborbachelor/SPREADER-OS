# Digi-Star SL-2 RS-232 Protocol

**Applies to:** Digi-Star SL-2 weight indicator (and compatible Digi-Star series indicators)
**Connection:** RS-232, 9,600 baud, 8N1, no flow control
**Cable:** Straight-through DB9. TX on indicator → RX on Pi/PC.

---

## Output Format

The SL-2 transmits a continuous stream of weight records at approximately 10 Hz.
Each record is a fixed-width ASCII string terminated with CR+LF (`\r\n`).

```
 +012345 LB G\r\n
```

### Field breakdown

| Bytes | Content | Example |
|-------|---------|---------|
| 1     | Space (always) | ` ` |
| 1     | Sign: `+` (positive) or `-` (negative) | `+` |
| 6     | Weight digits, zero-padded, no decimal | `012345` |
| 1     | Space | ` ` |
| 2     | Unit: `LB` or `KG` | `LB` |
| 1     | Space | ` ` |
| 1     | Mode: `G` (gross) or `N` (net) | `G` |
| 2     | CR + LF | `\r\n` |

**Total record length:** 15 bytes including the terminator.

### Weight value in lbs

```
weight_lbs = sign × integer_value
```

- Sign is positive for a load bearing down on the load cell
- A negative value indicates the reading has gone below tare (overshot — treat as 0)
- No decimal point in the raw stream; the SL-2 reports whole pounds only

### Mode byte

| Char | Meaning |
|------|---------|
| `G`  | Gross weight (raw load cell, no tare applied) |
| `N`  | Net weight (tare subtracted by indicator) |

**Use gross (`G`) mode** — we apply our own tare in software so we can zero mid-job without losing the starting gross weight reference.

---

## Indicator Configuration

Access via the front panel keypad (hold **MODE** for 3 s to enter setup):

| Setting | Value |
|---------|-------|
| Baud rate | 9600 |
| Data bits | 8 |
| Parity | None |
| Stop bits | 1 |
| Output mode | Continuous (not demand) |
| Weight mode | Gross (`G`) |
| Units | LB |
| Decimal | None (whole pounds) |

Save and exit setup — the indicator will begin streaming immediately on power-on.

---

## Parser Implementation

```javascript
// Matches the fixed 15-byte SL-2 record format.
const SL2_RE = /^[ ]([+-])(\d{6}) (LB|KG) [GN]\r?$/;

function parseSL2Line(line) {
  const m = line.match(SL2_RE);
  if (!m) return null;
  const sign   = m[1] === '+' ? 1 : -1;
  const raw    = sign * parseInt(m[2], 10);
  const isKg   = m[3] === 'KG';
  const lbs    = isKg ? raw * 2.20462 : raw;
  return Math.max(0, lbs);  // clamp negative (below-tare) to 0
}
```

This is what `main.js` uses in the `scale:data` IPC handler.

---

## Wiring

```
SL-2 DB9 female    →    USB-to-RS232 adapter
Pin 2 (TX)         →    Pin 3 (RX)
Pin 3 (RX)         →    Pin 2 (TX)   [optional — for demand mode only]
Pin 5 (GND)        →    Pin 5 (GND)
```

Power the SL-2 from the tractor 12V supply via its included DC adapter.

---

## Troubleshooting

| Symptom | Likely cause |
|---------|-------------|
| No data received | TX/RX swapped — try a null-modem adapter |
| Garbage characters | Baud rate mismatch — verify 9600 in indicator setup |
| Weight jumps / spikes | Ground loop — connect indicator chassis to tractor frame |
| Always reads 0 | Indicator in demand mode — switch to continuous output |
| Negative readings at rest | Tare not applied — press TARE on indicator, then TARE in UI |

---

## Field Notes

- Verified format against SL-2 firmware v2.1x. Earlier firmware (v1.x) may output 14-byte records (no leading space) — adjust regex if needed.
- Caleb: confirm unit is set to **Gross** before each field day. Net mode will cause the LIW delta to read zero once the indicator auto-tares.
- Log `field-notes/YYYY-MM-DD.md` with firmware version and any format anomalies observed.
