// Stockage local (aucun compte, aucun cloud) : réglages + profils en JSON dans le dossier utilisateur.
//   <userData>/settings.json
//   <userData>/profiles/<id>.json

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DEFAULT_SETTINGS = {
  activeProfile: null,
  startWithWindows: false,
  startupConfigured: false, // passe à true après le premier lancement de la version installée
  startMinimized: false,
  minimizeToTray: true,
  fps: 30,
  hotplugSeconds: 5,
  pluginsDir: null,
  captureSourceId: null,
  gameDetection: true, // bascule automatique sur le profil associé au jeu lancé
};

export function newProfile(name, base = {}) {
  const now = new Date().toISOString();
  return {
    effect: { id: 'rainbow', params: {} },
    effectParams: {}, // mémorise les réglages de chaque effet pour y revenir
    brightness: 1,
    layout: {},
    devices: {},
    properties: {},
    channels: {},
    keyLayer: null, // couleurs par touche (voir src/frame.js, layerColor)
    games: [],      // exécutables qui activent ce profil automatiquement
    ...structuredClone(base),
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
  };
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export class Store {
  constructor(dir) {
    this.dir = dir;
    this.profilesDir = path.join(dir, 'profiles');
    fs.mkdirSync(this.profilesDir, { recursive: true });
    this.settings = { ...DEFAULT_SETTINGS, ...readJson(path.join(dir, 'settings.json'), {}) };
    this.profiles = new Map();
    for (const f of fs.readdirSync(this.profilesDir).filter((f) => f.endsWith('.json'))) {
      const p = readJson(path.join(this.profilesDir, f), null);
      if (p?.id) this.profiles.set(p.id, p);
    }
    if (this.profiles.size === 0) {
      const p = newProfile('Par défaut');
      this.profiles.set(p.id, p);
      this.writeProfile(p);
    }
    if (!this.profiles.has(this.settings.activeProfile)) {
      this.settings.activeProfile = [...this.profiles.keys()][0];
      this.saveSettings();
    }
    this.pending = new Map();
  }

  saveSettings() {
    writeJsonAtomic(path.join(this.dir, 'settings.json'), this.settings);
  }

  setSettings(patch) {
    Object.assign(this.settings, patch);
    this.saveSettings();
    return this.settings;
  }

  get active() {
    return this.profiles.get(this.settings.activeProfile);
  }

  list() {
    return [...this.profiles.values()]
      .map(({ id, name, effect, games, keyLayer, updatedAt, createdAt }) => ({ id, name, effect: effect?.id, games: games ?? [], keyCount: Object.values(keyLayer?.keys ?? {}).reduce((n, k) => n + Object.keys(k).length, 0), updatedAt, createdAt }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  writeProfile(p) {
    writeJsonAtomic(path.join(this.profilesDir, `${p.id}.json`), p);
  }

  /** Modifie un profil en mémoire et l'écrit sur disque après un court délai (regroupe les rafales). */
  update(id, mutate) {
    const p = this.profiles.get(id);
    if (!p) throw new Error('Profil introuvable');
    mutate(p);
    p.updatedAt = new Date().toISOString();
    clearTimeout(this.pending.get(id));
    this.pending.set(id, setTimeout(() => { this.pending.delete(id); this.writeProfile(p); }, 400));
    return p;
  }

  flush() {
    for (const [id, t] of this.pending) { clearTimeout(t); this.writeProfile(this.profiles.get(id)); }
    this.pending.clear();
  }

  create(name, fromId) {
    const base = fromId ? this.profiles.get(fromId) : null;
    const { id, name: _n, createdAt, updatedAt, ...rest } = base ?? {};
    const p = newProfile(name, rest);
    this.profiles.set(p.id, p);
    this.writeProfile(p);
    return p;
  }

  rename(id, name) {
    return this.update(id, (p) => { p.name = String(name).slice(0, 60) || p.name; });
  }

  remove(id) {
    if (this.profiles.size <= 1) throw new Error('Impossible de supprimer le dernier profil');
    this.profiles.delete(id);
    fs.rmSync(path.join(this.profilesDir, `${id}.json`), { force: true });
    if (this.settings.activeProfile === id) {
      this.settings.activeProfile = [...this.profiles.keys()][0];
      this.saveSettings();
    }
  }

  activate(id) {
    if (!this.profiles.has(id)) throw new Error('Profil introuvable');
    this.settings.activeProfile = id;
    this.saveSettings();
    return this.active;
  }

  exportProfile(id, file) {
    const { id: _id, ...data } = this.profiles.get(id);
    fs.writeFileSync(file, JSON.stringify({ format: 'prismcore-profile', version: 1, ...data }, null, 2));
  }

  importProfile(file) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data.format !== 'prismcore-profile') throw new Error("Ce fichier n'est pas un profil PrismCore");
    const { format, version, id, createdAt, updatedAt, ...rest } = data;
    const p = newProfile(rest.name ?? 'Profil importé', rest);
    this.profiles.set(p.id, p);
    this.writeProfile(p);
    return p;
  }
}
