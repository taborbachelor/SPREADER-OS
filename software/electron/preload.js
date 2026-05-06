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

  // Scale serial (Digi-Star SL2)
  scaleConnect:    (portPath, baudRate) => ipcRenderer.invoke('scale:connect', { portPath, baudRate }),
  scaleDisconnect: ()                   => ipcRenderer.invoke('scale:disconnect'),
  onScaleLine:       cb => ipcRenderer.on('scale:line',       (_e, l) => cb(l)),
  onScaleDisconnect: cb => ipcRenderer.on('scale:disconnect',  ()      => cb()),
  onScaleError:      cb => ipcRenderer.on('scale:error',       (_e, m) => cb(m)),

  // App info
  getVersion: () => ipcRenderer.invoke('app:version'),
});
