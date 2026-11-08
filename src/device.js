// Implémentation de l'objet global `device` vu par les plugins, sur un transport HID (node-hid).
// Chaque méthode correspond à un appel observé dans les plugins ; voir docs/API_HOTE.md.
// Les couleurs sont fournies par un "sampler" (le moteur), qui projette les LED sur le canvas virtuel.

import HID from 'node-hid';
import { sleepSync, hexToRgb, rgbToHex, formatColors, padTo } from './util.js';

/** Convertit une entrée node-hid en "endpoint" au format attendu par Validate(). */
export function toEndpoint(d) {
  const col = /&col([0-9a-f]{2})/i.exec(d.path ?? '');
  return {
    interface: d.interface ?? -1,
    usage: d.usage ?? 0,
    usage_page: d.usagePage ?? 0,
    collection: col ? parseInt(col[1], 16) : 0,
    vendor_id: d.vendorId,
    product_id: d.productId,
  };
}

/** Faux handle HID : enregistre les paquets au lieu de les envoyer (mode test). */
export function createRecorder() {
  const packets = [];
  const make = (path) => ({
    write: (b) => { packets.push({ kind: 'write', path, data: b }); return b.length; },
    sendFeatureReport: (b) => { packets.push({ kind: 'feature', path, data: b }); return b.length; },
    getFeatureReport: (id, len) => { packets.push({ kind: 'get_feature', path, data: [id] }); return [id, ...new Array(Math.max(0, len - 1)).fill(0)]; },
    readTimeout: () => [],
    close: () => {},
  });
  return { packets, make };
}

/** Convertit la valeur par défaut d'une propriété (stockée en texte) vers son type réel. */
export function coerceDefault(def) {
  const v = def.default;
  switch (def.type) {
    case 'boolean': return v === true || v === 'true';
    case 'number': return Number(v);
    default: return v;
  }
}

/**
 * @param {object} o
 * @param {object[]} o.hidInfos   entrées node-hid de l'appareil physique (toutes ses interfaces)
 * @param {{main(x,y,size):number[], sub(id,x,y,size):number[], strip(name,count):number[][], pulse():number[]}} o.sampler
 * @param {() => object} o.getContext contexte global du plugin (pour les propriétés)
 * @param {(name:string, limit:number) => number} o.channelCount nombre de LED configuré pour un canal
 */
export function createDevice({ hidInfos, sampler, getContext, channelCount = () => 0, log, debug, readTimeoutMs = 200, recorder = null }) {
  const first = hidInfos[0] ?? {};
  const state = {
    name: first.product ?? 'Appareil',
    size: [1, 1],
    ledNames: [],
    ledPositions: [],
    fps: null,
    subdevices: new Map(),
    channels: new Map(),
    ledLimit: Infinity,
    properties: new Map(),
    features: new Set(),
    battery: null,
    handle: null,
    handlePath: null,
    lastReadSize: 0,
    notifications: [],
  };
  const handles = new Map();
  const warned = new Set();
  const warnOnce = (key, msg) => { if (!warned.has(key)) { warned.add(key); log(msg); } };

  function open(info) {
    if (!handles.has(info.path)) handles.set(info.path, recorder ? recorder.make(info.path) : new HID.HID(info.path));
    state.handle = handles.get(info.path);
    state.handlePath = info.path;
  }

  function requireHandle() {
    if (!state.handle) throw new Error('Aucun endpoint HID ouvert (set_endpoint non appelé ?)');
    return state.handle;
  }

  function makeChannel(name) {
    const ch = state.channels.get(name);
    if (!ch) return undefined;
    return {
      LedCount: () => ch.ledCount,
      get ledCount() { return ch.ledCount; },
      LedLimit: () => ch.ledLimit,
      SetLedLimit: (n) => { ch.ledLimit = n; },
      shouldPulseColors: () => false,
      getComponentNames: () => [],
      getComponentData: () => ({}),
      getColors: (format = 'Inline', order = 'RGB') => formatColors(sampler.strip(name, ch.ledCount), format, order),
    };
  }

  const api = {
    // --- identité / journalisation ---
    log: (msg) => debug(typeof msg === 'string' ? msg : JSON.stringify(msg)),
    notify: (title, desc) => {
      state.notifications.push({ title, desc, time: Date.now() });
      log(`⚠ ${title}${desc ? ' — ' + desc : ''}`);
    },
    productId: () => first.productId,
    vendorId: () => first.vendorId,
    getDeviceInfo: () => ({ product: first.product, manufacturer: first.manufacturer, serial: first.serialNumber }),
    getHidInfo: () => ({ product: first.product, manufacturer: first.manufacturer, serial: first.serialNumber, path: state.handlePath }),
    getHidEndpoints: () => hidInfos.map(toEndpoint),
    pause: (ms) => sleepSync(ms),

    // --- transport HID ---
    set_endpoint(iface, usage, usagePage, collection) {
      const eps = hidInfos.map((d) => [d, toEndpoint(d)]);
      const match = (withCol) => eps.find(([, e]) =>
        e.interface === iface &&
        (usage === undefined || e.usage === usage) &&
        (usagePage === undefined || e.usage_page === usagePage) &&
        (!withCol || collection === undefined || e.collection === collection));
      const found = match(true) ?? match(false);
      if (!found) {
        log(`set_endpoint introuvable : interface=${iface} usage=0x${(usage ?? 0).toString(16)} page=0x${(usagePage ?? 0).toString(16)}`);
        return false;
      }
      open(found[0]);
      return true;
    },
    write: (data, len) => requireHandle().write(padTo(data, len)),
    send_report: (data, len) => requireHandle().sendFeatureReport(padTo(data, len)),
    get_report(data, len) {
      const id = (data?.[0] ?? 0) & 0xff;
      try {
        const r = requireHandle().getFeatureReport(id, len);
        state.lastReadSize = r.length;
        return padTo(r, len);
      } catch (e) {
        debug(`get_report échec : ${e.message}`);
        state.lastReadSize = 0;
        return new Array(len).fill(0);
      }
    },
    input_report: (data, len) => api.read(data, len),
    read(data, len, timeout) {
      const r = requireHandle().readTimeout(timeout ?? readTimeoutMs) ?? [];
      state.lastReadSize = r.length;
      return padTo(r, len ?? r.length);
    },
    getLastReadSize: () => state.lastReadSize,
    clearReadBuffer() {
      const h = requireHandle();
      for (let i = 0; i < 256; i++) {
        const r = h.readTimeout(0);
        if (!r || r.length === 0) break;
      }
    },
    flush: () => {},
    bulk_transfer: () => { warnOnce('usb', 'Transfert USB brut (libusb) non géré.'); return []; },
    control_transfer: () => { warnOnce('usb', 'Transfert USB brut (libusb) non géré.'); return []; },

    // --- géométrie / LED ---
    setName: (n) => { state.name = n; },
    setSize: (w, h) => { state.size = Array.isArray(w) ? [w[0], w[1]] : [w, h]; },
    setControllableLeds: (names, positions) => { state.ledNames = names ?? []; state.ledPositions = positions ?? []; },
    setImageFromUrl: () => {}, // images distantes volontairement ignorées (aucune requête réseau)
    setImage: () => {},
    setFrameRateTarget: (fps) => { state.fps = fps; },
    setProtocol: () => {},
    getLedCount: () => state.ledNames.length,
    color: (x, y) => sampler.main(x, y, state.size),
    getBrightness: () => 100,
    createColorArray(hex, count, format = 'Inline', order = 'RGB') {
      const c = hexToRgb(hex);
      return formatColors(Array.from({ length: count }, () => c), format, order);
    },
    ConvertColorToImageBuffer: () => [],

    // --- sous-appareils ---
    createSubdevice: (id) => { state.subdevices.set(id, { id, name: id, size: [1, 1], ledNames: [], ledPositions: [] }); },
    removeSubdevice: (id) => { state.subdevices.delete(id); },
    setSubdeviceName: (id, name) => { const s = state.subdevices.get(id); if (s) s.name = name; },
    setSubdeviceSize: (id, w, h) => { const s = state.subdevices.get(id); if (s) s.size = Array.isArray(w) ? w : [w, h]; },
    setSubdeviceLeds: (id, names, positions) => { const s = state.subdevices.get(id); if (s) { s.ledNames = names ?? []; s.ledPositions = positions ?? []; } },
    setSubdeviceImage: () => {},
    setSubdeviceImageUrl: () => {},
    SetIsSubdeviceController: () => {},
    getCurrentSubdevices: () => [...state.subdevices.keys()],
    subdeviceColor: (id, x, y) => sampler.sub(id, x, y, state.subdevices.get(id)?.size ?? [1, 1]),

    // --- canaux ARGB (headers de carte mère, contrôleurs) ---
    SetLedLimit: (n) => { state.ledLimit = n; },
    addChannel(name, ledLimit) {
      const limit = ledLimit ?? Infinity;
      state.channels.set(name, { name, ledLimit: limit, ledCount: Math.min(Number(channelCount(name, limit)) || 0, limit) });
    },
    removeChannel: (name) => { state.channels.delete(name); },
    channel: (name) => makeChannel(name),
    getChannelNames: () => [...state.channels.keys()],
    getChannelPulseColor: () => rgbToHex(sampler.pulse()),

    // --- propriétés utilisateur ajoutées dynamiquement ---
    addProperty(def) {
      state.properties.set(def.property, def);
      const ctx = getContext();
      if (ctx && !(def.property in ctx)) ctx[def.property] = coerceDefault(def);
    },
    removeProperty: (name) => { state.properties.delete(name); },
    getProperty: (name) => {
      const def = state.properties.get(name);
      return def ? { ...def, value: getContext()?.[name] } : undefined;
    },
    setUserProperty: (name, value) => { const ctx = getContext(); if (ctx) ctx[name] = value; },
    addFeature: (f) => { state.features.add(f); },

    // --- ventilateurs / capteurs / LCD : non pris en charge ---
    fanControlDisabled: () => true,
    createFanControl: () => {}, removeFanControl: () => {},
    getNormalizedFanlevel: () => 0, getFanlevel: () => 0, setRPM: () => {},
    createTemperatureSensor: () => {}, removeTemperatureSensor: () => {}, SetTemperature: () => {},
    lcdControlAllowed: () => false, reportLcdSupport: () => {},
  };

  const device = new Proxy(api, {
    get(target, prop) {
      if (prop in target || typeof prop === 'symbol') return target[prop];
      return () => { warnOnce(prop, `device.${String(prop)}() non implémenté`); return undefined; };
    },
  });

  return {
    device,
    state,
    /** Ouvre l'endpoint retenu par Validate() comme endpoint par défaut. */
    openDefault(info) { open(info); },
    /** Modifie à chaud le nombre de LED d'un canal (lu à chaque image par le plugin). */
    setChannelCount(name, count) {
      const ch = state.channels.get(name);
      if (ch) ch.ledCount = Math.max(0, Math.min(Number(count) || 0, ch.ledLimit));
    },
    close() {
      for (const h of handles.values()) { try { h.close(); } catch { /* déjà fermé */ } }
      handles.clear();
      state.handle = null;
    },
  };
}
