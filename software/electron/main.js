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

// ── IPC — Scale serial port (Digi-Star SL2 RS-232, Phase 3) ──────────────────

let scalePort = null;

ipcMain.handle('scale:connect', async (_e, { portPath, baudRate }) => {
  if (scalePort && scalePort.isOpen) scalePort.close();
  return new Promise((resolve, reject) => {
    scalePort = new SerialPort({ path: portPath, baudRate }, err => {
      if (err) return reject(err.message);
      let buf = '';
      scalePort.on('data', chunk => {
        buf += chunk.toString('utf8');
        let nl;
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line.length > 0) {
            mainWindow?.webContents.send('scale:line', line);
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

// ── IPC — App info ────────────────────────────────────────────────────────────

ipcMain.handle('app:version', () => app.getVersion());
