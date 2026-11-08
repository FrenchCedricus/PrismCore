// Pont de la fenêtre de capture (invisible) : remonte les mesures audio / l'image d'écran au processus principal.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('capture', {
  audio: (data) => ipcRenderer.send('capture:audio', data),
  screen: (data) => ipcRenderer.send('capture:screen', data),
  status: (s) => ipcRenderer.send('capture:status', s),
});
