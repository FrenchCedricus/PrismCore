// Processus moteur : lancé par l'application Electron (child_process.fork, sérialisation "advanced").
// Protocole :
//   parent → moteur : { id, method, params }  (réponse { id, result } ou { id, error })
//                     { method, params }      (sans id : notification, pas de réponse — audio/écran)
//   moteur → parent : { event, data }         (devices, preview, log, ready)
// Lancé seul (hors Electron), il pilote les appareils avec config.json — pratique pour un service.

import { Engine } from './engine.js';
import { loadConfig, resolvePluginDirs } from './config.js';

const send = (msg) => { if (process.send) process.send(msg); };
let engine = null;
let previewTimer = null;
let devicesTimer = null;
let previewOn = true;

function wire(e) {
  e.on('log', (entry) => {
    if (process.send) send({ event: 'log', data: entry });
    else if (entry.level !== 'debug') console.log(entry.msg);
  });
  e.on('devices', (data) => send({ event: 'devices', data }));
}

function startTimers() {
  clearInterval(previewTimer);
  clearInterval(devicesTimer);
  previewTimer = setInterval(() => { if (previewOn && engine) send({ event: 'preview', data: engine.preview() }); }, 66);
  devicesTimer = setInterval(() => engine && engine.emitDevices(), 2000);
}

const methods = {
  async init({ pluginsDir, fps = 30, hotplugMs = 5000, profile }) {
    await engine?.stop();
    engine = new Engine({ pluginDirs: resolvePluginDirs(pluginsDir), fps });
    wire(engine);
    await engine.init();
    if (profile) engine.applyProfile(profile);
    engine.start(); // l'image partagée est calculée avant que les appareils ne la lisent
    await engine.scan();
    engine.startHotplug(hotplugMs);
    startTimers();
    return engine.describeDevices();
  },
  applyProfile: (profile) => { engine.applyProfile(profile); return true; },
  setEffect: ({ id, params }) => { engine.setEffect(id, params); return true; },
  setEffectParams: (params) => { engine.setEffectParams(params); return true; },
  setBrightness: (b) => { engine.setBrightness(b); return true; },
  setLayout: (layout) => { engine.setLayout(layout); return true; },
  setKeyLayer: (layer) => { engine.setKeyLayer(layer); return true; },
  setDevice: ({ id, settings }) => { engine.setDevice(id, settings); return true; },
  setProperty: ({ id, prop, value }) => { engine.setProperty(id, prop, value); return true; },
  setChannel: ({ id, name, count }) => { engine.setChannel(id, name, count); return true; },
  setFps: (fps) => { engine.setFps(fps); return true; },
  setHotplug: (ms) => { engine.startHotplug(ms); return true; },
  setPreview: (on) => { previewOn = !!on; return true; },
  getDevices: () => engine.describeDevices(),
  rescan: async () => { await engine.scan(); return engine.describeDevices(); },
  reindex: async () => { const r = await engine.reindex(); await engine.scan(); return r; },
  suspend: () => { engine.suspend(); return true; },
  resume: async () => { await engine.resume(); return true; },
  audio: (data) => engine?.setAudio(data),
  screen: (data) => engine?.setScreen(data),
  shutdown: async () => {
    clearInterval(previewTimer);
    clearInterval(devicesTimer);
    await engine?.stop(); // chaque appareil applique sa couleur d'arrêt
    setTimeout(() => process.exit(0), 20);
    return true;
  },
};

process.on('message', async (msg) => {
  const { id, method, params } = msg ?? {};
  const fn = methods[method];
  if (id === undefined) { try { fn?.(params); } catch { /* notification : pas de réponse */ } return; }
  try {
    if (!fn) throw new Error(`Méthode inconnue : ${method}`);
    if (!engine && method !== 'init') throw new Error('Moteur non initialisé');
    send({ id, result: await fn(params) });
  } catch (e) {
    send({ id, error: e?.message ?? String(e) });
  }
});

process.on('disconnect', async () => { await engine?.stop(); process.exit(0); });
process.on('uncaughtException', (e) => send({ event: 'log', data: { level: 'error', msg: `Moteur : ${e.stack ?? e}`, time: Date.now() } }));

if (process.send) {
  send({ event: 'ready', data: { pid: process.pid } });
} else {
  // Mode autonome : node --experimental-vm-modules src/daemon.js
  const cfg = loadConfig();
  await methods.init({ pluginsDir: cfg.pluginsDir, fps: cfg.fps, profile: { effect: { id: cfg.effect.name, params: cfg.effect }, brightness: cfg.effect.brightness, properties: cfg.properties, channels: cfg.channels } });
  previewOn = false;
  const stop = () => { methods.shutdown(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
