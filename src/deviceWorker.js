// Worker d'appareil : un fil d'exécution par périphérique.
// Charge le plugin, ouvre l'interface HID, et rend les LED à son propre rythme en lisant l'image partagée.
// Un appareil lent (souris sans fil en veille…) ou bloqué ne ralentit donc jamais les autres.
//
// Messages reçus : settings, property, channel, fps, suspend, testFrames, shutdown
// Messages émis  : rejected, attached, state (aussi battement de cœur), log, packets, closed

import { parentPort, workerData } from 'node:worker_threads';
import { execFileSync } from 'node:child_process';
import { loadPlugin, call } from './loader.js';
import { createDevice, createRecorder, toEndpoint, coerceDefault } from './device.js';
import { sampleFrame, shade, ledPoint, layerColor } from './frame.js';
import { startTicker } from './util.js';

const D = workerData;
const frame = new Uint8ClampedArray(D.frame.sab);
const post = (msg) => parentPort.postMessage(msg);
const log = (level, msg) => post({ type: 'log', level, msg: `[${D.entry.name}] ${msg}` });

let settings = D.settings; // { rects, device: {enabled, brightness}, properties, channels, keyLayer }
let fps = D.fps;
let context = null;
let ns = null;
let parameters = [];
let active = false, paused = false, suspended = false, running = true;
let error = null, errors = 0, renderMs = 0, renders = 0, measuredFps = 0, lastFpsAt = Date.now();

// ------------------------------------------------------------------ échantillonnage

const rectOf = (key) => settings.rects?.[key] ?? { x: 0, y: 0, w: D.canvas.W, h: D.canvas.H };
const raw = (cx, cy) => sampleFrame(frame, cx, cy, D.canvas.W, D.canvas.H, D.frame.w, D.frame.h);
const at = (cx, cy) => shade(raw(cx, cy), settings.device);
const grid = (key, x, y, size) => {
  const [cx, cy] = ledPoint(rectOf(key), size, x, y);
  return shade(layerColor(settings.keyLayer, key, x, y, raw(cx, cy)), settings.device);
};
const sampler = {
  main: (x, y, size) => grid(D.id, x, y, size),
  sub: (sid, x, y, size) => grid(`${D.id}/${sid}`, x, y, size),
  strip: (name, count) => {
    const r = rectOf(`${D.id}#${name}`);
    const out = [];
    for (let i = 0; i < count; i++) out.push(at(r.x + ((i + 0.5) / count) * r.w, r.y + r.h / 2));
    return out;
  },
  pulse: () => { const r = rectOf(D.id); return at(r.x + r.w / 2, r.y + r.h / 2); },
};

const recorder = D.dryRun ? createRecorder() : null;
const dev = createDevice({
  hidInfos: D.hidInfos,
  sampler,
  getContext: () => context,
  channelCount: (name) => settings.channels?.[name] ?? 0,
  log: (m) => log('info', m),
  debug: (m) => log('debug', m),
  readTimeoutMs: D.readTimeoutMs,
  recorder,
});

// ------------------------------------------------------------------ état publié

function snapshot() {
  const st = dev.state;
  return {
    name: st.name,
    size: st.size,
    ledNames: st.ledNames,
    ledPositions: st.ledPositions,
    subdevices: [...st.subdevices.values()].map((s) => ({ id: s.id, name: s.name, size: s.size, ledNames: s.ledNames ?? [], ledPositions: s.ledPositions ?? [] })),
    channels: [...st.channels.values()].map((c) => ({ name: c.name, ledLimit: Number.isFinite(c.ledLimit) ? c.ledLimit : null, ledCount: c.ledCount })),
    parameters: [...parameters, ...st.properties.values()].map((p) => ({ ...p, value: context?.[p.property] })),
    battery: st.battery,
    features: [...st.features],
    notifications: st.notifications.slice(-5),
    status: !active ? 'error' : paused ? 'paused' : error ? 'warning' : 'ok',
    error,
    renderMs: Math.round(renderMs * 10) / 10,
    fps: measuredFps,
  };
}
const publish = () => post({ type: 'state', snapshot: snapshot() });

// ------------------------------------------------------------------ paramètres

function setPropertyValue(prop, value) {
  if (!context || context[prop] === value) return;
  context[prop] = value;
  try { ns[`on${prop}Changed`]?.(); } catch (e) { log('warn', `on${prop}Changed : ${e.message}`); }
}

function applyEnabled() {
  const enabled = settings.device?.enabled !== false;
  if (!enabled && active && !paused) {
    try { ns.Shutdown?.(false); } catch { /* ignoré */ }
    paused = true;
  } else if (enabled && paused) {
    paused = false;
  }
}

function applySettings(next) {
  settings = next;
  for (const [k, v] of Object.entries(settings.properties ?? {})) setPropertyValue(k, v);
  for (const name of dev.state.channels.keys()) dev.setChannelCount(name, settings.channels?.[name] ?? 0);
  applyEnabled();
}

// ------------------------------------------------------------------ rendu

function isIdle() {
  const st = dev.state;
  return st.ledNames.length === 0 && [...st.subdevices.values()].every((s) => !s.ledNames?.length) && [...st.channels.values()].every((c) => c.ledCount === 0);
}

function renderOnce() {
  if (!active || paused || suspended) return;
  const s = performance.now();
  try {
    ns.Render();
    if (errors > 0) { error = null; publish(); }
    errors = 0;
  } catch (e) {
    errors++;
    error = e.message;
    if (errors === 1 || errors % 100 === 0) { log('error', `erreur de rendu : ${e.message}`); publish(); }
    if (errors >= 300) { active = false; log('error', "désactivé après trop d'erreurs"); publish(); }
  }
  renderMs = renderMs * 0.9 + (performance.now() - s) * 0.1;
  renders++;
}

let lastBeat = 0;
function tick() {
  renderOnce();
  const now = Date.now();
  if (now - lastFpsAt >= 1000) { measuredFps = Math.round((renders * 1000) / (now - lastFpsAt)); renders = 0; lastFpsAt = now; }
  if (now - lastBeat >= 1000) { lastBeat = now; publish(); } // sert aussi de battement de cœur
}
// Appareil sans LED : 2 images/s suffisent (batterie, état) ; sinon cadence du moteur, sans dérive.
const loop = () => { stopLoop = startTicker(() => (isIdle() ? 500 : 1000 / fps), tick); };
let stopLoop = () => {};

// ------------------------------------------------------------------ messages du moteur

parentPort.on('message', (m) => {
  switch (m.type) {
    case 'settings': applySettings(m.settings); publish(); break;
    case 'rects': settings = { ...settings, rects: m.rects }; break;
    case 'property':
      settings.properties = { ...settings.properties, [m.prop]: m.value };
      setPropertyValue(m.prop, m.value);
      publish();
      break;
    case 'channel':
      settings.channels = { ...settings.channels, [m.name]: m.count };
      dev.setChannelCount(m.name, m.count);
      publish();
      break;
    case 'fps': fps = Math.max(5, Math.min(120, m.fps)); break;
    case 'suspend':
      suspended = true;
      try { if (active && !paused) ns.Shutdown?.(true); } catch { /* ignoré */ }
      break;
    case 'testFrames':
      if (recorder) recorder.packets.length = 0;
      for (let i = 0; i < m.n; i++) renderOnce();
      post({ type: 'packets', packets: recorder?.packets ?? [] });
      break;
    case 'shutdown':
      running = false;
      stopLoop();
      try { if (active && !paused && !suspended && !m.skipShutdown) ns.Shutdown?.(!!m.suspending); } catch (e) { log('warn', `erreur à l'arrêt : ${e.message}`); }
      dev.close();
      post({ type: 'closed' });
      setImmediate(() => process.exit(0));
      break;
    default: break;
  }
});

// ------------------------------------------------------------------ démarrage

function runningProcesses() {
  try {
    return execFileSync('tasklist', ['/fo', 'csv', '/nh'], { encoding: 'utf8' })
      .split(/\r?\n/).map((l) => l.split('","')[0]?.replace(/^"/, '').toLowerCase()).filter(Boolean);
  } catch { return []; }
}

const globals = {
  device: dev.device,
  bus: new Proxy({}, { get: () => () => { throw new Error('SMBus non pris en charge'); } }),
  battery: {
    setBatteryLevel: (lvl) => { dev.state.battery = { ...dev.state.battery, level: Math.round(Number(lvl) || 0) }; },
    setBatteryState: (s) => { dev.state.battery = { ...dev.state.battery, state: s }; },
  },
  mouse: { sendEvent() {} },
  keyboard: { sendEvent() {}, sendHid() {}, sendKey() {} },
  console: {
    log: (...a) => log('debug', a.join(' ')), info: (...a) => log('debug', a.join(' ')), debug: (...a) => log('debug', a.join(' ')),
    warn: (...a) => log('info', a.join(' ')), error: (...a) => log('info', a.join(' ')),
  },
  require: () => { throw new Error('require() indisponible dans les plugins'); },
};

try {
  const loaded = await loadPlugin(D.entry.path, globals, (m) => log('info', m));
  ns = loaded.ns;
  context = loaded.context;

  // Paramètres utilisateur : défaut du plugin, surchargé par le profil.
  parameters = call(ns, 'ControllableParameters', []) ?? [];
  const overrides = settings.properties ?? {};
  for (const p of parameters) context[p.property] = p.property in overrides ? overrides[p.property] : coerceDefault(p);
  for (const [k, v] of Object.entries(overrides)) if (!(k in context)) context[k] = v;

  const candidates = D.hidInfos.filter((info) => {
    if (typeof ns.Validate !== 'function') return true;
    try { return !!ns.Validate(toEndpoint(info)); } catch { return false; }
  });
  if (candidates.length === 0) {
    post({ type: 'rejected' });
    process.exit(0);
  }

  const conflicts = (call(ns, 'ConflictingProcesses', []) ?? []).map((p) => p.toLowerCase());
  if (conflicts.length && !D.dryRun) {
    const running = runningProcesses();
    const hit = conflicts.filter((c) => running.includes(c));
    if (hit.length) log('warn', `logiciel concurrent en cours d'exécution : ${hit.join(', ')}`);
  }

  dev.openDefault(candidates[0]);
  dev.state.name = D.entry.name;
  dev.state.size = call(ns, 'Size', [1, 1]) ?? [1, 1];
  dev.state.ledNames = call(ns, 'LedNames', []) ?? [];
  dev.state.ledPositions = call(ns, 'LedPositions', []) ?? [];
  post({ type: 'attached' });

  try {
    ns.Initialize();
    active = true;
    log('info', `initialisé : ${dev.state.ledNames.length} LED, canaux : ${[...dev.state.channels.keys()].join(', ') || 'aucun'}`);
  } catch (e) {
    error = e.message;
    log('error', `échec d'Initialize : ${e.message}`);
  }
  applyEnabled();
  publish();
  if (!D.dryRun) loop();
} catch (e) {
  post({ type: 'log', level: 'warn', msg: `[${D.entry.name}] chargement impossible : ${e.message}` });
  post({ type: 'rejected', error: e.message });
  process.exit(0);
}
