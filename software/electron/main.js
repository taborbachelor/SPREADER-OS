'use strict';

const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path  = require('path');
const { SerialPort } = require('serialport');

// ── Window ────────────────────────────────────────────────────────────────────

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width:           1024,
    height:          600,
    fullscreen:      false,       // set true for in-cab tablet
    backgroundColor: '#0F1117',   // matches --bg token; prevents white flash
    autoHideMenuBar: true,
    webPreferences: {
      preload:         path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,    // all Node APIs flow through preload IPC
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Remove default menu in production
  if (!process.env.SPREADER_DEV) {
    Menu.setApplicationMenu(null);
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ── IPC — Serial port enumeration ────────────────────────────────────────────

ipcMain.handle('serial:list', async () => {
  const ports = await SerialPort.list();
  return ports.map(p => ({ path: p.path, manufacturer: p.manufacturer ?? '', friendlyName: p.friendlyName ?? '' }));
});

// ── IPC — GPS serial port ─────────────────────────────────────────────────────

let gpsPort = null;

ipcMain.handle('gps:connect', async (_e, { portPath, baudRate }) => {
  if (gpsPort && gpsPort.isOpen) gpsPort.close();
  return new Promise((resolve, reject) => {
    gpsPort = new SerialPort({ path: portPath, baudRate }, err => {
      if (err) return reject(err.message);
      let buf = '';
      gpsPort.on('data', chunk => {
        buf += chunk.toString('utf8');
        let nl;
        while ((nl = buf.indexOf('\n')) !== -1) {
          const sentence = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (sentence.startsWith('$')) {
            mainWindow?.webContents.send('gps:sentence', sentence);
          }
        }
      });
      gpsPort.on('close', () => mainWindow?.webContents.send('gps:disconnect'));
      gpsPort.on('error', e => mainWindow?.webContents.send('gps:error', e.message));
      resolve({ ok: true });
    });
  });
});

ipcMain.handle('gps:disconnect', async () => {
  if (gpsPort && gpsPort.isOpen) gpsPort.close();
  gpsPort = null;
});

// ── Digi-Star SL-2 parser (docs/digistar-sl2-protocol.md) ────────────────────

// Fixed 15-byte record: " +012345 LB G\r\n"
const SL2_RE = /^[ ]([+-])(\d{6}) (LB|KG) [GN]\r?$/;

function parseSL2Line(line) {
  const m = line.match(SL2_RE);
  if (!m) return null;
  const sign = m[1] === '+' ? 1 : -1;
  const raw  = sign * parseInt(m[2], 10);
  const lbs  = m[3] === 'KG' ? raw * 2.20462 : raw;
  return Math.max(0, lbs);  // clamp below-tare negatives to 0
}

// ── IPC — Scale serial port (Digi-Star SL-2 RS-232) ──────────────────────────

let scalePort = null;

ipcMain.handle('scale:connect', async (_e, { portPath, baudRate }) => {
  if (scalePort && scalePort.isOpen) scalePort.close();
  return new Promise((resolve, reject) => {
    scalePort = new SerialPort({ path: portPath, baudRate }, err => {
      if (err) return reject(err.message);
      let buf = '';
      scalePort.on('data', chunk => {
        buf += chunk.toString('latin1');  // SL-2 uses ASCII/Latin-1
        let nl;
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line   = buf.slice(0, nl);
          buf          = buf.slice(nl + 1);
          const weight = parseSL2Line(line);
          if (weight !== null) {
            mainWindow?.webContents.send('scale:weight', weight);
          }
        }
      });
      scalePort.on('close', () => mainWindow?.webContents.send('scale:disconnect'));
      scalePort.on('error', e => mainWindow?.webContents.send('scale:error', e.message));
      resolve({ ok: true });
    });
  });
});

ipcMain.handle('scale:disconnect', async () => {
  if (scalePort && scalePort.isOpen) scalePort.close();
  scalePort = null;
});

// ── IPC — Section gate output (USB relay board / serial controller) ───────────
//
// Section states are sent as a compact bitmask over a serial output port.
// Each bit = one section (bit 0 = section 1, MSB-first within the byte).
// Output format: single byte, e.g. 0b11111111 = all open, 0b00000000 = all closed.
//
// Wire to a USB relay board (e.g. Waveshare 8-ch USB relay) or a microcontroller
// that translates the bitmask to individual gate valve signals.

let outputPort = null;

ipcMain.handle('output:connect', async (_e, { portPath, baudRate = 9600 }) => {
  if (outputPort && outputPort.isOpen) outputPort.close();
  return new Promise((resolve, reject) => {
    outputPort = new SerialPort({ path: portPath, baudRate }, err => {
      if (err) return reject(err.message);
      outputPort.on('error', e => console.error('[OUTPUT]', e.message));
      resolve({ ok: true });
    });
  });
});

ipcMain.handle('output:disconnect', async () => {
  if (outputPort && outputPort.isOpen) outputPort.close();
  outputPort = null;
});

// sections: array of booleans (true = open/active)
ipcMain.handle('output:setSections', async (_e, { sections }) => {
  if (!outputPort || !outputPort.isOpen) return { ok: false, reason: 'not connected' };
  let mask = 0;
  for (let i = 0; i < Math.min(sections.length, 8); i++) {
    if (sections[i]) mask |= (1 << i);
  }
  return new Promise(resolve => {
    outputPort.write(Buffer.from([mask]), err => resolve({ ok: !err, mask }));
  });
});

// ── IPC — Hydraulic floor belt control (Phase 3) ──────────────────────────────
//
// The floor belt drive valve accepts a 0–100% duty command over the same output
// serial port, sent as a second byte immediately after the section bitmask.
// Format: two-byte frame — [section_mask, floor_speed_0_to_100]
//
// This is a stub: the exact protocol depends on the hydraulic valve controller
// Caleb selects. Update the write() call once the controller is chosen.

ipcMain.handle('output:setFloorSpeed', async (_e, { speedPct }) => {
  if (!outputPort || !outputPort.isOpen) return { ok: false, reason: 'not connected' };
  const clamped = Math.max(0, Math.min(100, Math.round(speedPct)));
  return new Promise(resolve => {
    // 0xFF = floor speed command marker, followed by speed byte
    outputPort.write(Buffer.from([0xFF, clamped]), err => resolve({ ok: !err, speedPct: clamped }));
  });
});

// ── IPC — App info ────────────────────────────────────────────────────────────

ipcMain.handle('app:version', () => app.getVersion());
