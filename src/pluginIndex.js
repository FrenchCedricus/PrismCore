// Index des plugins : charge chaque plugin une fois (avec un `device` factice) pour lire ses métadonnées
// (nom, VID, PID, type de transport), puis met le résultat en cache.
// Plusieurs dossiers sont indexés dans l'ordre : les pilotes intégrés (drivers/) passent en premier.

import fs from 'node:fs';
import path from 'node:path';
import { loadPlugin, call } from './loader.js';
import { ROOT, BUILTIN_DRIVERS } from './config.js';

// Dans l'application installée, le dossier du programme peut être en lecture seule :
// le processus principal fournit un dossier de cache dans les données utilisateur.
const CACHE = path.join(process.env.PRISM_CACHE_DIR || path.join(ROOT, '.cache'), 'plugin-index.json');

function walk(dir) {
  const out = [];
  if (!dir || !fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.js') && !e.name.endsWith('.test.js')) out.push(p);
  }
  return out;
}

/** Empreinte des dossiers (nombre de fichiers + date de modification la plus récente) pour invalider le cache. */
function fingerprint(dirs) {
  let n = 0, latest = 0;
  for (const d of dirs) for (const f of walk(d)) { n++; latest = Math.max(latest, fs.statSync(f).mtimeMs); }
  return `${dirs.join('|')}#${n}#${Math.round(latest)}`;
}

const inert = () => new Proxy(function () {}, {
  get: (_, prop) => (prop === Symbol.toPrimitive ? () => 0 : inert()),
  apply: () => undefined,
});

function stubGlobals() {
  return {
    device: inert(), bus: inert(), mouse: inert(), keyboard: inert(), battery: inert(),
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    require: () => inert(),
  };
}

function toIds(v) {
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((x) => (typeof x === 'string' ? Number(x) : x)).filter((x) => Number.isInteger(x));
}

/** @param {string[]} dirs dossiers de plugins, par ordre de priorité */
export async function buildIndex(dirs, { onProgress } = {}) {
  const files = dirs.flatMap((dir) => walk(dir).map((file) => ({ dir, file })));
  const entries = [];
  const failures = [];
  for (const [i, { dir, file }] of files.entries()) {
    onProgress?.(i + 1, files.length);
    const rel = path.relative(dir, file);
    try {
      const { ns } = await loadPlugin(file, stubGlobals(), () => {});
      if (typeof ns.Initialize !== 'function' || typeof ns.Render !== 'function') continue; // fichier utilitaire
      entries.push({
        path: file,
        file: rel,
        source: path.resolve(dir) === path.resolve(BUILTIN_DRIVERS) ? 'builtin' : 'external',
        name: String(call(ns, 'Name', path.basename(file, '.js'))),
        vendorId: toIds(call(ns, 'VendorId', []))[0] ?? null,
        productIds: toIds(call(ns, 'ProductId', [])),
        transport: String(call(ns, 'Type', 'hid')).toLowerCase(),
        deviceType: String(call(ns, 'DeviceType', 'other')),
        publisher: String(call(ns, 'Publisher', '')),
      });
    } catch (e) {
      failures.push({ file: rel, error: String(e?.message ?? e) });
    }
  }
  const index = { dirs, fingerprint: fingerprint(dirs), builtAt: new Date().toISOString(), entries, failures };
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(index, null, 2));
  return index;
}

export async function getIndex(dirs, opts) {
  if (fs.existsSync(CACHE)) {
    try {
      const idx = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
      if (idx.fingerprint === fingerprint(dirs)) return idx;
    } catch { /* cache illisible : on reconstruit */ }
  }
  return buildIndex(dirs, opts);
}

export const isHidTransport = (t) => t === 'hid' || t === 'hybrid';
