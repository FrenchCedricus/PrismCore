// Configuration : fichier config.json à la racine du projet + détection du dossier de plugins installé.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Dans l'exe, le moteur tourne depuis app.asar.unpacked ; ne convertit que les chemins encore dans app.asar.
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..').replace(/app\.asar(?=[\\/]|$)/, 'app.asar.unpacked');
/** Pilotes intégrés à PrismCore (prioritaires sur les plugins externes). */
export const BUILTIN_DRIVERS = path.join(ROOT, 'drivers');

/** Liste ordonnée des dossiers de pilotes : intégrés, puis dossier externe (choisi ou détecté) s'il existe. */
export function resolvePluginDirs(externalDir) {
  const ext = externalDir || detectPluginsDir();
  return [BUILTIN_DRIVERS, ...(ext && fs.existsSync(ext) ? [ext] : [])];
}

const DEFAULTS = {
  pluginsDir: null, // null = détection automatique
  fps: 30,
  effect: { name: 'rainbow', color: '#009bde', speed: 1, brightness: 1 },
  properties: {}, // { "<Nom du plugin>": { "<propriété>": valeur } }
  channels: {}, // { "<Nom du plugin>": { "<nom du canal>": nombreDeLed } }
  disabled: [], // noms de plugins à ignorer
  readTimeoutMs: 200,
};

/** Cherche le dossier Plugins de l'installation locale (le numéro de version change à chaque mise à jour). */
export function detectPluginsDir() {
  const local = process.env.LOCALAPPDATA ?? '';
  const roots = ['VortxEngine', 'WhirlwindFX\\SignalRgb'].map((r) => path.join(local, r));
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const apps = fs.readdirSync(root)
      .filter((d) => /^app-\d/.test(d))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const app of apps) {
      const p = path.join(root, app, 'Signal-x64', 'Plugins');
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

export function loadConfig(overrides = {}) {
  const file = path.join(ROOT, 'config.json');
  let user = {};
  if (fs.existsSync(file)) {
    user = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  const cfg = { ...DEFAULTS, ...user, effect: { ...DEFAULTS.effect, ...(user.effect ?? {}) } };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) continue;
    if (k === 'effect') Object.assign(cfg.effect, v);
    else cfg[k] = v;
  }
  cfg.pluginDirs = resolvePluginDirs(cfg.pluginsDir);
  return cfg;
}
