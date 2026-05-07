'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Expose a narrow, typed API to the renderer — no raw ipcRenderer access.
contextBridge.exposeInMainWorld('spreaderAPI', {

  // Serial port listing
  listPorts: () => ipcRenderer.invoke('serial:list'),

  // GPS serial
  gpsConnect:    (portPath, baudRate) => ipcRenderer.invoke('gps:connect', { portPath, baudRate }),
  gpsDisconnect: ()                   => ipcRenderer.invoke('gps:disconnect'),
  onGpsSentence:    cb => ipcRenderer.on('gps:sentence',    (_e, s) => cb(s)),
  onGpsDisconnect:  cb => ipcRenderer.on('gps:disconnect',  ()      => cb()),
  onGpsError:       cb => ipcRenderer.on('gps:error',       (_e, m) => cb(m)),

  // Scale serial (Digi-Star SL-2) — main process parses SL2 and sends weight_lbs directly
  scaleConnect:    (portPath, baudRate) => ipcRenderer.invoke('scale:connect', { portPath, baudRate }),
  scaleDisconnect: ()                   => ipcRenderer.invoke('scale:disconnect'),
  onScaleWeight:     cb => ipcRenderer.on('scale:weight',     (_e, w) => cb(w)),
  onScaleDisconnect: cb => ipcRenderer.on('scale:disconnect',  ()      => cb()),
  onScaleError:      cb => ipcRenderer.on('scale:error',       (_e, m) => cb(m)),

  // Section gate + floor belt output (USB relay / serial controller)
  outputConnect:     (portPath, baudRate) => ipcRenderer.invoke('output:connect', { portPath, baudRate }),
  outputDisconnect:  ()                   => ipcRenderer.invoke('output:disconnect'),
  setSections:       (sections)           => ipcRenderer.invoke('output:setSections', { sections }),
  setFloorSpeed:     (speedPct)           => ipcRenderer.invoke('output:setFloorSpeed', { speedPct }),

  // Prescription map
  loadPrescription: () => ipcRenderer.invoke('prescription:load'),

  // App info
  getVersion: () => ipcRenderer.invoke('app:version'),
});
