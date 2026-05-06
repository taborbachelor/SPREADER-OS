#!/usr/bin/env python3
"""
HX711 WebSocket Bridge — spreader Phase 2
Reads two HX711 load cell amplifiers via GPIO and broadcasts combined weight
over WebSocket on ws://localhost:8765 at 10 Hz.

GPIO pin mapping (BCM numbering):
  HX711 #1: DT → GPIO 5,  SCK → GPIO 6
  HX711 #2: DT → GPIO 13, SCK → GPIO 19

Commands accepted from clients (JSON):
  {"cmd": "tare"}
  {"cmd": "calibrate", "known_weight_lbs": 500.0}

Broadcast format (JSON, 10 Hz):
  {"weight_lbs": 12345.6, "source": "hx711"}

Simulation mode: if RPi.GPIO is unavailable (desktop testing), weight ramps
from 0 to 20000 lbs over ~60 s then holds. Tare/calibrate commands still work.
"""

import asyncio
import json
import logging
import math
import os
import time

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("hx711-bridge")

CALIB_PATH = os.path.join(os.path.dirname(__file__), "calibration.json")

# ─── GPIO / HX711 setup ────────────────────────────────────────────────────────

try:
    import RPi.GPIO as GPIO
    from hx711 import HX711
    HARDWARE = True
except ImportError:
    HARDWARE = False
    log.warning("RPi.GPIO / hx711 not available — running in simulation mode")


def load_calibration():
    try:
        with open(CALIB_PATH) as f:
            return json.load(f)
    except Exception:
        return {"scale_factor_1": 1.0, "scale_factor_2": 1.0, "tare_1": 0, "tare_2": 0}


def save_calibration(cal):
    with open(CALIB_PATH, "w") as f:
        json.dump(cal, f, indent=2)


# ─── Hardware reader ───────────────────────────────────────────────────────────

class HX711Reader:
    def __init__(self):
        self.cal = load_calibration()
        if HARDWARE:
            GPIO.setmode(GPIO.BCM)
            self.hx1 = HX711(dout_pin=5, pd_sck_pin=6)
            self.hx2 = HX711(dout_pin=13, pd_sck_pin=19)
            self.hx1.reset()
            self.hx2.reset()
        self._sim_start = time.monotonic()

    def _read_raw(self):
        if HARDWARE:
            r1 = self.hx1.get_raw_data_mean(readings=3)
            r2 = self.hx2.get_raw_data_mean(readings=3)
            if r1 is False or r2 is False:
                raise RuntimeError("HX711 read failed")
            return r1, r2
        # simulation: ramp 0 → 20000 lbs over 60 s
        elapsed = time.monotonic() - self._sim_start
        sim_weight = min(20000.0, elapsed * (20000.0 / 60.0))
        # split evenly across two cells
        half = sim_weight / 2.0
        return half, half

    def read_lbs(self):
        r1, r2 = self._read_raw()
        cal = self.cal
        w1 = (r1 - cal["tare_1"]) / cal["scale_factor_1"]
        w2 = (r2 - cal["tare_2"]) / cal["scale_factor_2"]
        return max(0.0, w1 + w2)

    def tare(self):
        r1, r2 = self._read_raw()
        self.cal["tare_1"] = r1
        self.cal["tare_2"] = r2
        save_calibration(self.cal)
        log.info("Tare complete: tare_1=%s tare_2=%s", r1, r2)
        if HARDWARE:
            self._sim_start = time.monotonic()

    def calibrate(self, known_weight_lbs):
        r1, r2 = self._read_raw()
        cal = self.cal
        gross_raw = (r1 - cal["tare_1"]) + (r2 - cal["tare_2"])
        if abs(gross_raw) < 1:
            raise ValueError("Net raw reading near zero — tare first")
        # distribute scale factor proportionally
        net1 = r1 - cal["tare_1"]
        net2 = r2 - cal["tare_2"]
        total_net = net1 + net2
        if total_net == 0:
            raise ValueError("Zero net signal — place a known weight first")
        cal["scale_factor_1"] = net1 / (known_weight_lbs * (net1 / total_net))
        cal["scale_factor_2"] = net2 / (known_weight_lbs * (net2 / total_net))
        save_calibration(cal)
        log.info(
            "Calibration saved: sf1=%.4f sf2=%.4f for %.1f lbs",
            cal["scale_factor_1"], cal["scale_factor_2"], known_weight_lbs,
        )

    def cleanup(self):
        if HARDWARE:
            GPIO.cleanup()


# ─── WebSocket server ──────────────────────────────────────────────────────────

try:
    import websockets
except ImportError:
    raise SystemExit("Install websockets: pip3 install websockets")

CLIENTS = set()
reader = HX711Reader()


async def broadcast_weight():
    while True:
        await asyncio.sleep(0.1)  # 10 Hz
        if not CLIENTS:
            continue
        try:
            weight = reader.read_lbs()
        except Exception as exc:
            log.error("Read error: %s", exc)
            continue
        msg = json.dumps({"weight_lbs": round(weight, 1), "source": "hx711"})
        dead = set()
        for ws in CLIENTS:
            try:
                await ws.send(msg)
            except Exception:
                dead.add(ws)
        CLIENTS -= dead


async def handle_client(websocket, path=None):
    CLIENTS.add(websocket)
    log.info("Client connected: %s (total=%d)", websocket.remote_address, len(CLIENTS))
    try:
        async for raw in websocket:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            cmd = msg.get("cmd")
            if cmd == "tare":
                reader.tare()
                await websocket.send(json.dumps({"ack": "tare"}))
            elif cmd == "calibrate":
                known = float(msg.get("known_weight_lbs", 0))
                if known <= 0:
                    await websocket.send(json.dumps({"error": "known_weight_lbs required"}))
                else:
                    try:
                        reader.calibrate(known)
                        await websocket.send(json.dumps({"ack": "calibrate", "known_weight_lbs": known}))
                    except ValueError as e:
                        await websocket.send(json.dumps({"error": str(e)}))
    except Exception:
        pass
    finally:
        CLIENTS.discard(websocket)
        log.info("Client disconnected (total=%d)", len(CLIENTS))


async def main():
    log.info("Starting HX711 bridge (hardware=%s)", HARDWARE)
    server = await websockets.serve(handle_client, "localhost", 8765)
    log.info("Listening on ws://localhost:8765")
    await asyncio.gather(server.wait_closed(), broadcast_weight())


if __name__ == "__main__":
    try:
        asyncio.run(main())
    finally:
        reader.cleanup()
