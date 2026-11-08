// Moteur PrismCore (orchestrateur).
//  - calcule l'effet sur le canvas virtuel et l'écrit dans une image partagée (SharedArrayBuffer) ;
//  - détecte les appareils HID (à chaud) et lance un worker par appareil (src/deviceWorker.js) ;
//  - tient le profil (disposition, réglages par appareil) et le diffuse aux workers ;
//  - surveille les workers (chien de garde) et relance ceux qui ne répondent plus.
// Indépendant de l'interface : utilisé par la CLI et par le daemon.

import { EventEmitter } from 'node:events';
import { Worker } from 'node:worker_threads';
import HID from 'node-hid';
import { getIndex, buildIndex, isHidTransport } from './pluginIndex.js';
import { VirtualCanvas, CANVAS_W, CANVAS_H } from './canvas.js';
import { FRAME_W, FRAME_H, sampleFrame, shade, ledPoint, layerColor } from './frame.js';
import { startTicker } from './util.js';

const WORKER_URL = new URL('./deviceWorker.js', import.meta.url);
const hex4 = (n) => (n ?? 0).toString(16).toUpperCase().padStart(4, '0');
const WATCHDOG_MS = 15000;

/** Regroupe les interfaces HID par appareil physique (VID:PID). */
export function enumerateHid() {
  const groups = new Map();
  for (const d of HID.devices()) {
    const key = `${hex4(d.vendorId)}:${hex4(d.productId)}`;
    if (!groups.has(key)) groups.set(key, { key, vendorId: d.vendorId, productId: d.productId, product: d.product, manufacturer: d.manufacturer, infos: [] });
    groups.get(key).infos.push(d);
  }
  return [...groups.values()];
}

/** Plugins HID de l'index qui déclarent ce VID/PID. */
export function matchPlugins(index, group, disabled = []) {
  return index.entries.filter((e) =>
    isHidTransport(e.transport) &&
    e.vendorId === group.vendorId &&
    e.productIds.includes(group.productId) &&
    !disabled.includes(e.name));
}

export function emptyProfile() {
  return { effect: { id: 'rainbow', params: {} }, brightness: 1, layout: {}, devices: {}, properties: {}, channels: {}, keyLayer: null };
}

/** Éléments positionnables d'un appareil (d'après l'état publié par son worker). */
function itemsOf(id, snap) {
  if (!snap) return [];
  const items = [];
  if (snap.ledPositions.length) items.push({ key: id, label: snap.name, kind: 'device', size: snap.size, leds: snap.ledPositions, names: Array.isArray(snap.ledNames) ? snap.ledNames : [] });
  for (const s of snap.subdevices) {
    if (s.ledPositions.length) items.push({ key: `${id}/${s.id}`, label: s.name, kind: 'subdevice', size: s.size, leds: s.ledPositions, names: s.ledNames ?? [] });
  }
  for (const c of snap.channels) {
    if (c.ledCount > 0) items.push({ key: `${id}#${c.name}`, label: `${snap.name} — ${c.name}`, kind: 'channel', size: [c.ledCount, 1], leds: Array.from({ length: c.ledCount }, (_, i) => [i, 0]) });
  }
  return items;
}

const structureKey = (items) => items.map((i) => `${i.key}:${i.leds.length}:${i.size}`).join('|');

export class Engine extends EventEmitter {
  /**
   * @param {object} o
   * @param {string[]} o.pluginDirs dossiers de pilotes, par priorité (intégrés d'abord)
   * @param {number} [o.fps]
   * @param {boolean} [o.dryRun] paquets capturés au lieu d'être envoyés
   * @param {number} [o.readTimeoutMs]
   * @param {string[]} [o.disabledPlugins]
   */
  constructor({ pluginDirs, fps = 30, dryRun = false, readTimeoutMs = 200, disabledPlugins = [] }) {
    super();
    this.pluginDirs = pluginDirs;
    this.fps = fps;
    this.dryRun = dryRun;
    this.readTimeoutMs = readTimeoutMs;
    this.disabledPlugins = disabledPlugins;
    this.canvas = new VirtualCanvas();
    this.sab = new SharedArrayBuffer(FRAME_W * FRAME_H * 3);
    this.frameBuf = new Uint8ClampedArray(this.sab);
    this.profile = emptyProfile();
    this.handles = new Map(); // id (VID:PID) → { id, entry, group, worker, snapshot, lastSeen }
    this.unsupported = [];
    this.retry = new Map();   // id → horodatage avant lequel on ne retente pas
    this.index = null;
    this.timer = null;
    this.scanTimer = null;
    this.running = false;
    this.suspended = false;
    this.scanning = false;
    this.stats = { fps: 0, frameMs: 0, frames: 0, lastStat: Date.now() };
    this.autoLayout = {};
  }

  log(level, msg) {
    this.emit('log', { level, msg, time: Date.now() });
  }

  async init({ onProgress } = {}) {
    this.index = await getIndex(this.pluginDirs, { onProgress });
    const builtin = this.index.entries.filter((e) => e.source === 'builtin').length;
    this.log('info', `${this.index.entries.length} pilotes disponibles (${builtin} intégrés, ${this.index.entries.length - builtin} externes)`);
    if (this.pluginDirs.length < 2) this.log('info', 'Aucun dossier de plugins externe : seuls les pilotes intégrés sont utilisés.');
  }

  async reindex(opts) {
    this.index = await buildIndex(this.pluginDirs, opts);
    this.log('info', `Index reconstruit : ${this.index.entries.length} plugins, ${this.index.failures.length} échecs`);
    return { plugins: this.index.entries.length, failures: this.index.failures };
  }

  // ------------------------------------------------------------------ découverte / hot-plug / workers

  /** Compare les appareils branchés à ceux pilotés : attache les nouveaux, détache les débranchés. */
  async scan({ only } = {}) {
    if (this.scanning) return false;
    this.scanning = true;
    try {
      const groups = enumerateHid();
      const present = new Set(groups.map((g) => g.key));
      let changed = false;

      for (const [id, h] of this.handles) {
        if (!present.has(id)) {
          this.log('info', `[${h.entry.name}] débranché`);
          await this.closeHandle(h, { skipShutdown: true });
          changed = true;
        }
      }

      const unsupported = [];
      for (const group of groups) {
        if (this.handles.has(group.key)) continue;
        let plugins = matchPlugins(this.index, group, this.disabledPlugins);
        if (only) plugins = plugins.filter((p) => p.name.toLowerCase().includes(only.toLowerCase()));
        if (plugins.length === 0) {
          unsupported.push({ id: group.key, product: group.product ?? '', manufacturer: group.manufacturer ?? '' });
          continue;
        }
        if ((this.retry.get(group.key) ?? 0) > Date.now()) continue;
        for (const entry of plugins) {
          const h = await this.spawn(entry, group);
          if (h) { changed = true; break; }
        }
      }
      this.unsupported = unsupported;
      if (changed) this.layoutChanged();
      return changed;
    } finally {
      this.scanning = false;
    }
  }

  startHotplug(intervalMs = 5000) {
    clearInterval(this.scanTimer);
    if (intervalMs > 0) {
      this.scanTimer = setInterval(() => {
        if (this.suspended) return;
        this.watchdog();
        this.scan().catch((e) => this.log('error', `scan : ${e.message}`));
      }, intervalMs);
    }
  }

  /** Lance le worker d'un appareil ; renvoie le handle, ou null si le plugin refuse l'appareil. */
  spawn(entry, group) {
    const id = group.key;
    const h = { id, entry, group, worker: null, snapshot: null, lastSeen: Date.now(), closing: null, packets: null };
    const worker = new Worker(WORKER_URL, {
      workerData: {
        id, entry,
        hidInfos: group.infos,
        frame: { sab: this.sab, w: FRAME_W, h: FRAME_H },
        canvas: { W: CANVAS_W, H: CANVAS_H },
        settings: this.workerSettings(id, entry),
        fps: this.fps,
        dryRun: this.dryRun,
        readTimeoutMs: this.readTimeoutMs,
      },
    });
    h.worker = worker;

    return new Promise((resolve) => {
      let settled = false;
      const settle = (v) => { if (!settled) { settled = true; clearTimeout(t); resolve(v); } };
      const t = setTimeout(() => { this.log('warn', `[${entry.name}] délai de démarrage dépassé`); worker.terminate(); settle(null); }, 30000);

      worker.on('message', (m) => {
        h.lastSeen = Date.now();
        switch (m.type) {
          case 'attached':
            this.handles.set(id, h);
            settle(h);
            break;
          case 'rejected':
            settle(null);
            break;
          case 'state': {
            const before = structureKey(itemsOf(id, h.snapshot));
            const statusBefore = h.snapshot?.status;
            h.snapshot = m.snapshot;
            if (structureKey(itemsOf(id, h.snapshot)) !== before) this.layoutChanged();
            else if (statusBefore !== h.snapshot.status) this.emitDevices();
            break;
          }
          case 'log': this.emit('log', { level: m.level, msg: m.msg, time: Date.now() }); break;
          case 'packets': h.packets?.(m.packets); break;
          default: break;
        }
      });
      worker.on('error', (e) => this.log('error', `[${entry.name}] plantage du worker : ${e.message}`));
      worker.on('exit', () => {
        settle(null);
        h.closing?.();
        if (this.handles.get(id) === h) {
          this.handles.delete(id);
          if (this.running) {
            this.log('warn', `[${entry.name}] arrêté de façon inattendue, nouvelle tentative dans 10 s`);
            this.retry.set(id, Date.now() + 10000);
          }
          this.layoutChanged();
        }
      });
    });
  }

  closeHandle(h, { skipShutdown = false, suspending = false } = {}) {
    if (this.handles.get(h.id) === h) this.handles.delete(h.id);
    return new Promise((resolve) => {
      const t = setTimeout(() => { h.worker.terminate(); resolve(); }, 3000);
      h.closing = () => { clearTimeout(t); resolve(); };
      h.worker.postMessage({ type: 'shutdown', skipShutdown, suspending });
    });
  }

  /** Relance les workers qui ne donnent plus signe de vie (plugin bloqué). */
  watchdog() {
    const now = Date.now();
    for (const h of this.handles.values()) {
      if (!this.dryRun && now - h.lastSeen > WATCHDOG_MS) {
        this.log('warn', `[${h.entry.name}] ne répond plus depuis ${Math.round((now - h.lastSeen) / 1000)} s : redémarrage`);
        this.handles.delete(h.id);
        this.retry.set(h.id, now + 5000);
        h.worker.terminate();
      }
    }
  }

  // ------------------------------------------------------------------ profil

  deviceSettings(id) {
    return { enabled: true, brightness: 1, ...(this.profile.devices?.[id] ?? {}) };
  }

  workerSettings(id, entry) {
    return {
      rects: this.resolvedRects(),
      device: this.deviceSettings(id),
      properties: { ...(this.profile.properties?.[entry.name] ?? {}), ...(this.profile.properties?.[id] ?? {}) },
      channels: { ...(this.profile.channels?.[entry.name] ?? {}), ...(this.profile.channels?.[id] ?? {}) },
      keyLayer: this.resolvedKeyLayer(),
    };
  }

  /** Calque de touches du profil, avec la luminosité globale (appliquée aussi aux touches colorées). */
  resolvedKeyLayer() {
    const l = this.profile.keyLayer;
    if (!l?.keys || Object.keys(l.keys).length === 0) return null;
    return { ...l, brightness: this.profile.brightness ?? 1 };
  }

  pushSettings() {
    for (const h of this.handles.values()) h.worker.postMessage({ type: 'settings', settings: this.workerSettings(h.id, h.entry) });
  }

  applyProfile(profile) {
    this.profile = { ...emptyProfile(), ...profile };
    const { id, params } = this.profile.effect ?? {};
    this.canvas.setEffect(id ?? 'rainbow', params ?? {});
    this.canvas.brightness = this.profile.brightness ?? 1;
    this.computeAutoLayout();
    this.pushSettings();
    this.renderFrame();
    this.emitDevices();
  }

  setEffect(id, params) {
    this.canvas.setEffect(id, params);
    this.profile.effect = { id, params };
  }

  setEffectParams(params) {
    this.canvas.setParams(params);
    this.profile.effect = { id: this.canvas.effectId, params: { ...this.canvas.raw } };
  }

  setBrightness(b) {
    this.profile.brightness = this.canvas.brightness = Math.max(0, Math.min(1, Number(b)));
    if (this.profile.keyLayer) this.pushSettings();
  }

  setKeyLayer(layer) {
    this.profile.keyLayer = layer ?? null;
    this.pushSettings();
  }

  setLayout(layout) {
    this.profile.layout = { ...layout };
    this.layoutChanged(); // recalcule l'auto-placement des autres éléments, diffuse, publie
  }

  setDevice(id, settings) {
    this.profile.devices = { ...this.profile.devices, [id]: { ...(this.profile.devices?.[id] ?? {}), ...settings } };
    const h = this.handles.get(id);
    if (h) h.worker.postMessage({ type: 'settings', settings: this.workerSettings(id, h.entry) });
    this.emitDevices();
  }

  setProperty(id, prop, value) {
    const h = this.handles.get(id);
    if (!h) throw new Error(`Appareil inconnu : ${id}`);
    this.profile.properties = { ...this.profile.properties, [id]: { ...(this.profile.properties?.[id] ?? {}), [prop]: value } };
    h.worker.postMessage({ type: 'property', prop, value });
  }

  setChannel(id, name, count) {
    const h = this.handles.get(id);
    if (!h) throw new Error(`Appareil inconnu : ${id}`);
    this.profile.channels = { ...this.profile.channels, [id]: { ...(this.profile.channels?.[id] ?? {}), [name]: Number(count) || 0 } };
    h.worker.postMessage({ type: 'channel', name, count: Number(count) || 0 });
  }

  setAudio(audio) { this.canvas.setAudio(audio); }
  setScreen(screen) { this.canvas.setScreen(screen); }

  // ------------------------------------------------------------------ disposition

  /** Place automatiquement les éléments sans position enregistrée (rangées de gauche à droite). */
  computeAutoLayout() {
    const auto = {};
    let x = 4, y = 6, rowH = 0;
    for (const h of this.handles.values()) {
      for (const it of itemsOf(h.id, h.snapshot)) {
        if (this.profile.layout?.[it.key]) continue;
        const [gw, gh] = it.size;
        const w = it.kind === 'channel' ? Math.min(60, Math.max(10, gw * 1.5)) : Math.min(60, Math.max(6, gw * 3));
        const hh = it.kind === 'channel' ? 4 : Math.min(30, Math.max(6, gh * 3));
        if (x + w > CANVAS_W - 4) { x = 4; y += rowH + 4; rowH = 0; }
        auto[it.key] = { x, y: Math.min(y, CANVAS_H - hh), w, h: hh };
        x += w + 4;
        rowH = Math.max(rowH, hh);
      }
    }
    this.autoLayout = auto;
  }

  resolvedRects() {
    return { ...this.autoLayout, ...(this.profile.layout ?? {}) };
  }

  broadcastRects() {
    const rects = this.resolvedRects();
    for (const h of this.handles.values()) h.worker.postMessage({ type: 'rects', rects });
  }

  layoutChanged() {
    this.computeAutoLayout();
    this.broadcastRects();
    this.emitDevices();
  }

  rectOf(key) {
    return this.profile.layout?.[key] ?? this.autoLayout[key] ?? { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H };
  }

  // ------------------------------------------------------------------ boucle de calcul de l'effet

  renderFrame() {
    const buf = this.frameBuf;
    for (let y = 0; y < FRAME_H; y++) {
      const cy = ((y + 0.5) / FRAME_H) * CANVAS_H;
      for (let x = 0; x < FRAME_W; x++) {
        const c = this.canvas.sample(((x + 0.5) / FRAME_W) * CANVAS_W, cy);
        const i = (y * FRAME_W + x) * 3;
        buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
      }
    }
  }

  frame() {
    if (this.suspended) return;
    const t0 = performance.now();
    this.canvas.tick();
    this.renderFrame();
    const st = this.stats;
    st.frames++;
    st.frameMs = st.frameMs * 0.9 + (performance.now() - t0) * 0.1;
    const now = Date.now();
    if (now - st.lastStat >= 1000) {
      st.fps = Math.round((st.frames * 1000) / (now - st.lastStat));
      st.frames = 0;
      st.lastStat = now;
    }
  }

  /** Boucle de calcul cadencée sans dérive (voir startTicker). */
  start() {
    this.stopTicker?.();
    this.running = true;
    this.stopTicker = startTicker(() => 1000 / (this.fps || 30), () => this.frame());
  }

  setFps(fps) {
    this.fps = Math.max(5, Math.min(120, Number(fps) || 30));
    for (const h of this.handles.values()) h.worker.postMessage({ type: 'fps', fps: this.fps });
  }

  /** Mise en veille du PC : couleur d'arrêt sur chaque appareil, puis pause. */
  suspend() {
    this.suspended = true;
    for (const h of this.handles.values()) h.worker.postMessage({ type: 'suspend' });
  }

  /** Sortie de veille : les appareils ont pu perdre leur mode logiciel, on les réinitialise. */
  async resume() {
    await Promise.all([...this.handles.values()].map((h) => this.closeHandle(h, { skipShutdown: true })));
    this.suspended = false;
    this.retry.clear();
    await this.scan();
  }

  async stop({ suspending = false } = {}) {
    this.running = false;
    this.stopTicker?.();
    clearInterval(this.scanTimer);
    await Promise.all([...this.handles.values()].map((h) => this.closeHandle(h, { suspending })));
  }

  /** Mode test : fait rendre n images à chaque worker et renvoie les paquets capturés. */
  async testFrames(n = 3) {
    this.renderFrame();
    const out = [];
    for (const h of this.handles.values()) {
      const packets = await new Promise((resolve) => { h.packets = resolve; h.worker.postMessage({ type: 'testFrames', n }); });
      out.push({ name: h.entry.name, status: h.snapshot?.status ?? 'error', packets });
    }
    return out;
  }

  // ------------------------------------------------------------------ état exposé

  describeDevices() {
    const devices = [...this.handles.values()].filter((h) => h.snapshot).map((h) => {
      const s = h.snapshot;
      const settings = this.deviceSettings(h.id);
      const items = itemsOf(h.id, s);
      return {
        id: h.id,
        name: s.name,
        plugin: h.entry.name,
        file: h.entry.file,
        deviceType: h.entry.deviceType,
        vendorId: h.group.vendorId,
        productId: h.group.productId,
        product: h.group.product ?? '',
        status: s.status,
        error: s.error,
        enabled: settings.enabled,
        brightness: settings.brightness,
        ledCount: items.reduce((n, it) => n + it.leds.length, 0),
        renderMs: s.renderMs,
        fps: s.fps,
        battery: s.battery,
        features: s.features,
        notifications: s.notifications,
        parameters: s.parameters,
        channels: s.channels,
        items: items.map((it) => ({ ...it, rect: this.rectOf(it.key), custom: !!this.profile.layout?.[it.key] })),
      };
    });
    return { devices, unsupported: this.unsupported, stats: { fps: this.stats.fps, frameMs: Math.round(this.stats.frameMs * 10) / 10 }, canvas: { width: CANVAS_W, height: CANVAS_H } };
  }

  emitDevices() {
    this.emit('devices', this.describeDevices());
  }

  /** Aperçu : image du canvas (RGBA réduite) + couleurs de chaque LED telles qu'envoyées aux appareils. */
  preview() {
    const w = FRAME_W / 2, hh = FRAME_H / 2;
    const frame = new Uint8ClampedArray(w * hh * 4);
    const src = this.frameBuf;
    for (let y = 0; y < hh; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        for (let k = 0; k < 3; k++) {
          const a = ((2 * y) * FRAME_W + 2 * x) * 3 + k, b = ((2 * y + 1) * FRAME_W + 2 * x) * 3 + k;
          frame[o + k] = (src[a] + src[a + 3] + src[b] + src[b + 3]) >> 2;
        }
        frame[o + 3] = 255;
      }
    }
    const leds = {};
    const layer = this.resolvedKeyLayer();
    for (const h of this.handles.values()) {
      const settings = this.deviceSettings(h.id);
      for (const it of itemsOf(h.id, h.snapshot)) {
        const r = this.rectOf(it.key);
        const out = new Uint8Array(it.leds.length * 3);
        it.leds.forEach(([lx, ly], i) => {
          const [cx, cy] = ledPoint(r, it.size, lx, ly);
          const c = shade(layerColor(layer, it.key, lx, ly, sampleFrame(src, cx, cy, CANVAS_W, CANVAS_H)), settings);
          out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2];
        });
        leds[it.key] = out;
      }
    }
    return { w, h: hh, frame, leds };
  }
}
