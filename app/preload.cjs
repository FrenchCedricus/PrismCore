// Pont sécurisé exposé à l'interface : window.prism. Aucune API Node n'est accessible au renderer.
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (arg) => ipcRenderer.invoke(channel, arg);
const EVENTS = ['devices', 'preview', 'log', 'profiles', 'settings', 'engine:status', 'capture:status', 'capture:audio', 'capture:screen', 'game'];

contextBridge.exposeInMainWorld('prism', {
  getState: invoke('state:get'),
  effects: {
    set: (id, params) => ipcRenderer.invoke('effect:set', { id, params }),
    params: invoke('effect:params'),
    brightness: invoke('brightness:set'),
  },
  layout: {
    set: invoke('layout:set'),
    preview: invoke('layout:preview'),
    reset: invoke('layout:reset'),
  },
  devices: {
    set: (id, settings) => ipcRenderer.invoke('device:set', { id, settings }),
    property: (id, prop, value) => ipcRenderer.invoke('device:property', { id, prop, value }),
    channel: (id, name, count) => ipcRenderer.invoke('device:channel', { id, name, count }),
    rescan: invoke('engine:rescan'),
  },
  profiles: {
    create: (name, fromCurrent = true) => ipcRenderer.invoke('profile:create', { name, fromCurrent }),
    activate: invoke('profile:activate'),
    rename: (id, name) => ipcRenderer.invoke('profile:rename', { id, name }),
    duplicate: invoke('profile:duplicate'),
    remove: invoke('profile:delete'),
    export: invoke('profile:export'),
    import: invoke('profile:import'),
    games: (id, games) => ipcRenderer.invoke('profile:games', { id, games }),
  },
  keys: { set: invoke('keys:set') },
  system: { processes: invoke('system:processes') },
  settings: { set: invoke('settings:set') },
  capture: { sources: invoke('capture:sources'), monitor: invoke('capture:monitor') },
  engine: { reindex: invoke('engine:reindex'), restart: invoke('engine:restart') },
  app: {
    openDataDir: invoke('app:openDataDir'),
    pickPluginsDir: invoke('app:pickPluginsDir'),
    detectPluginsDir: invoke('app:detectPluginsDir'),
    clearLogs: invoke('logs:clear'),
  },
  on(event, cb) {
    if (!EVENTS.includes(event)) throw new Error(`Événement inconnu : ${event}`);
    const listener = (_e, data) => cb(data);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
});
