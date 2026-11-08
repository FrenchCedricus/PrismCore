// Bibliothèque d'effets. Module pur (sans dépendance Node) : utilisé par le moteur ET par l'interface
// pour les aperçus animés.
//
// Un effet = { id, name, category, requires?, params: [schéma], setup?(p), update?(s, p, dt, t, ctx), sample(s, p, u, v, ctx) }
//   u, v ∈ [0,1] : position sur le canvas virtuel ; ctx.aspect = largeur / hauteur
//   ctx.audio = { bands[16], level, bass, mid, treble, beat } ; ctx.screen = { w, h, data(RGB) } | null
//   sample() renvoie [r, g, b] en 0..255 (flottants acceptés).

import { hexToRgb, hsvToRgb } from './util.js';

const TAU = Math.PI * 2;
const color = (key, label, def) => ({ key, label, type: 'color', default: def });
const range = (key, label, min, max, step, def) => ({ key, label, type: 'range', min, max, step, default: def });
const select = (key, label, options, def) => ({ key, label, type: 'select', options, default: def });
const bool = (key, label, def) => ({ key, label, type: 'boolean', default: def });

const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const fract = (x) => x - Math.floor(x);

/** Projection de (u,v) sur une direction (degrés), centrée : renvoie ~[0,1]. */
function project(u, v, deg, aspect) {
  const a = (deg * Math.PI) / 180;
  return ((u - 0.5) * aspect * Math.cos(a) + (v - 0.5) * Math.sin(a)) / Math.max(1, aspect) + 0.5;
}

// Bruit de valeur 2D (déterministe) pour feu / plasma.
function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(x, y) {
  return noise(x, y) * 0.5 + noise(x * 2, y * 2) * 0.25 + noise(x * 4, y * 4) * 0.125 + noise(x * 8, y * 8) * 0.0625;
}

const FIRE_RAMP = [[0, 0, 0], [140, 10, 0], [230, 60, 0], [255, 150, 10], [255, 230, 120], [255, 255, 230]];
function ramp(stops, k) {
  const x = clamp01(k) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return mix(stops[i], stops[i + 1], x - i);
}

export const EFFECTS = [
  {
    id: 'solid', name: 'Statique', category: 'Basique',
    params: [color('color', 'Couleur', '#009bde')],
    sample: (s, p) => p.color,
  },
  {
    id: 'rainbow', name: 'Arc-en-ciel', category: 'Basique',
    params: [range('speed', 'Vitesse', 0, 5, 0.1, 1), range('scale', 'Répétitions', 0.2, 4, 0.1, 1), range('angle', 'Direction (°)', 0, 360, 5, 0), range('saturation', 'Saturation', 0, 1, 0.05, 1)],
    sample: (s, p, u, v, ctx) => hsvToRgb(project(u, v, p.angle, ctx.aspect) * p.scale - ctx.t * p.speed * 0.2, p.saturation, 1),
  },
  {
    id: 'spectrum', name: 'Cycle de couleurs', category: 'Basique',
    params: [range('speed', 'Vitesse', 0, 5, 0.1, 1), range('saturation', 'Saturation', 0, 1, 0.05, 1)],
    sample: (s, p, u, v, ctx) => hsvToRgb(ctx.t * p.speed * 0.05, p.saturation, 1),
  },
  {
    id: 'breathing', name: 'Respiration', category: 'Basique',
    params: [color('color', 'Couleur', '#7c4dff'), color('color2', 'Couleur basse', '#000000'), range('speed', 'Vitesse', 0.1, 5, 0.1, 1)],
    sample: (s, p, u, v, ctx) => mix(p.color2, p.color, 0.5 - 0.5 * Math.cos(ctx.t * p.speed * Math.PI * 0.5)),
  },
  {
    id: 'wave', name: 'Vague', category: 'Mouvement',
    params: [color('color', 'Couleur', '#00c8ff'), color('background', 'Fond', '#06001a'), range('speed', 'Vitesse', 0, 5, 0.1, 1), range('frequency', 'Fréquence', 0.5, 6, 0.1, 1.5), range('sharpness', 'Netteté', 1, 8, 0.5, 2), range('angle', 'Direction (°)', 0, 360, 5, 0)],
    sample: (s, p, u, v, ctx) => {
      const d = project(u, v, p.angle, ctx.aspect);
      const k = Math.pow(Math.max(0, Math.cos((d * p.frequency - ctx.t * p.speed * 0.5) * TAU)), p.sharpness);
      return mix(p.background, p.color, k);
    },
  },
  {
    id: 'gradient', name: 'Dégradé', category: 'Mouvement',
    params: [color('color1', 'Couleur 1', '#ff0080'), color('color2', 'Couleur 2', '#00e5ff'), range('angle', 'Direction (°)', 0, 360, 5, 0), range('speed', 'Défilement', 0, 3, 0.05, 0.3)],
    sample: (s, p, u, v, ctx) => {
      const x = fract(project(u, v, p.angle, ctx.aspect) - ctx.t * p.speed * 0.1);
      return mix(p.color1, p.color2, 1 - Math.abs(x * 2 - 1));
    },
  },
  {
    id: 'radial', name: 'Onde radiale', category: 'Mouvement',
    params: [select('mode', 'Couleurs', [['rainbow', 'Arc-en-ciel'], ['color', 'Couleur unie']], 'rainbow'), color('color', 'Couleur', '#ff3d00'), color('background', 'Fond', '#000000'), range('speed', 'Vitesse', 0, 5, 0.1, 1), range('frequency', 'Anneaux', 0.5, 8, 0.1, 2), range('cx', 'Centre X', 0, 1, 0.01, 0.5), range('cy', 'Centre Y', 0, 1, 0.01, 0.5)],
    sample: (s, p, u, v, ctx) => {
      const dist = Math.hypot((u - p.cx) * ctx.aspect, v - p.cy) / Math.max(1, ctx.aspect) * 2;
      const phase = dist * p.frequency - ctx.t * p.speed * 0.5;
      if (p.mode === 'rainbow') return hsvToRgb(phase * 0.5, 1, 1);
      return mix(p.background, p.color, 0.5 + 0.5 * Math.cos(phase * TAU));
    },
  },
  {
    id: 'plasma', name: 'Plasma', category: 'Mouvement',
    params: [range('speed', 'Vitesse', 0, 5, 0.1, 1), range('scale', 'Échelle', 1, 20, 0.5, 6), range('saturation', 'Saturation', 0, 1, 0.05, 1)],
    sample: (s, p, u, v, ctx) => {
      const x = u * ctx.aspect * p.scale, y = v * p.scale, t = ctx.t * p.speed;
      const val = Math.sin(x + t) + Math.sin(y * 0.7 + t * 1.1) + Math.sin((x + y) * 0.5 + t * 0.7) + Math.sin(Math.hypot(x - p.scale, y - p.scale * 0.5) - t * 1.3);
      return hsvToRgb(val / 8 + t * 0.02, p.saturation, 1);
    },
  },
  {
    id: 'twinkle', name: 'Étoiles', category: 'Ambiance',
    params: [color('color', 'Couleur', '#ffffff'), color('background', 'Fond', '#020414'), bool('rainbow', 'Étoiles multicolores', false), range('density', 'Densité', 0.1, 4, 0.1, 1), range('fade', 'Extinction', 0.3, 5, 0.1, 1.5)],
    setup: () => ({ cols: 48, rows: 28, level: new Float32Array(48 * 28), hue: new Float32Array(48 * 28) }),
    update: (s, p, dt) => {
      const n = s.level.length;
      for (let i = 0; i < n; i++) s.level[i] = Math.max(0, s.level[i] - dt * p.fade);
      let spawns = n * 0.02 * p.density * dt * 10;
      while (spawns > 0) {
        if (spawns >= 1 || Math.random() < spawns) {
          const i = Math.floor(Math.random() * n);
          s.level[i] = 1;
          s.hue[i] = Math.random();
        }
        spawns -= 1;
      }
    },
    sample: (s, p, u, v) => {
      const i = Math.min(s.rows - 1, Math.floor(v * s.rows)) * s.cols + Math.min(s.cols - 1, Math.floor(u * s.cols));
      const star = p.rainbow ? hsvToRgb(s.hue[i], 0.8, 1) : p.color;
      return mix(p.background, star, s.level[i] * s.level[i]);
    },
  },
  {
    id: 'fire', name: 'Feu', category: 'Ambiance',
    params: [range('speed', 'Vitesse', 0.1, 4, 0.1, 1), range('intensity', 'Intensité', 0.3, 2, 0.05, 1), range('scale', 'Échelle', 1, 8, 0.5, 3)],
    sample: (s, p, u, v, ctx) => {
      const n = fbm(u * ctx.aspect * p.scale, v * p.scale + ctx.t * p.speed * 1.5);
      return ramp(FIRE_RAMP, n * v * 1.8 * p.intensity);
    },
  },
  {
    id: 'audio-spectrum', name: 'Spectre audio', category: 'Audio', requires: 'audio',
    params: [color('colorLow', 'Couleur basse', '#00e676'), color('colorHigh', 'Couleur haute', '#ff1744'), color('background', 'Fond', '#050505'), range('gain', 'Sensibilité', 0.5, 4, 0.1, 1.5), bool('mirror', 'Symétrique (centre)', false)],
    sample: (s, p, u, v, ctx) => {
      const bands = ctx.audio.bands;
      const pos = p.mirror ? Math.abs(u * 2 - 1) : u;
      const b = bands[Math.min(bands.length - 1, Math.floor(pos * bands.length))] ?? 0;
      const height = 1 - v;
      return height <= clamp01(b * p.gain) ? mix(p.colorLow, p.colorHigh, height) : p.background;
    },
  },
  {
    id: 'audio-pulse', name: 'Pulsation audio', category: 'Audio', requires: 'audio',
    params: [select('mode', 'Couleur', [['color', 'Fixe'], ['beat', 'Change à chaque temps fort'], ['rainbow', 'Arc-en-ciel']], 'beat'), color('color', 'Couleur', '#ff00aa'), range('gain', 'Sensibilité', 0.5, 4, 0.1, 1.5), range('floor', 'Luminosité minimale', 0, 0.5, 0.01, 0.05)],
    setup: () => ({ hue: 0, level: 0 }),
    update: (s, p, dt, t, ctx) => {
      if (ctx.audio.beat && p.mode === 'beat') s.hue = fract(s.hue + 0.17);
      const target = clamp01(ctx.audio.bass * p.gain);
      s.level += (target - s.level) * (target > s.level ? 0.7 : 0.15);
    },
    sample: (s, p, u, v, ctx) => {
      const k = p.floor + (1 - p.floor) * s.level;
      let c = p.color;
      if (p.mode === 'beat') c = hsvToRgb(s.hue, 1, 1);
      else if (p.mode === 'rainbow') c = hsvToRgb(u * 0.5 + ctx.t * 0.05, 1, 1);
      return [c[0] * k, c[1] * k, c[2] * k];
    },
  },
  {
    id: 'audio-ripple', name: 'Ondes sonores', category: 'Audio', requires: 'audio',
    params: [range('speed', 'Vitesse des ondes', 0.2, 3, 0.1, 1), range('gain', 'Sensibilité', 0.5, 4, 0.1, 1.5), range('cx', 'Centre X', 0, 1, 0.01, 0.5), range('cy', 'Centre Y', 0, 1, 0.01, 0.5), color('background', 'Fond', '#000000')],
    setup: () => ({ ripples: [], hue: 0 }),
    update: (s, p, dt, t, ctx) => {
      if (ctx.audio.beat) {
        s.hue = fract(s.hue + 0.13);
        s.ripples.push({ t0: t, hue: s.hue, energy: clamp01(ctx.audio.bass * p.gain) });
      }
      s.ripples = s.ripples.filter((r) => t - r.t0 < 3 / p.speed);
    },
    sample: (s, p, u, v, ctx) => {
      const dist = Math.hypot((u - p.cx) * ctx.aspect, v - p.cy) / Math.max(1, ctx.aspect) * 2;
      let out = p.background;
      for (const r of s.ripples) {
        const radius = (ctx.t - r.t0) * p.speed;
        const k = Math.max(0, 1 - Math.abs(dist - radius) * 6) * r.energy * Math.max(0, 1 - radius / 3);
        if (k > 0) out = mix(out, hsvToRgb(r.hue, 1, 1), k);
      }
      return out;
    },
  },
  {
    id: 'screen', name: 'Ambiance écran', category: 'Écran', requires: 'screen',
    params: [select('mode', 'Mode', [['mirror', 'Miroir de l\'écran'], ['average', 'Couleur moyenne']], 'mirror'), range('saturation', 'Saturation', 0.5, 2.5, 0.05, 1.4), range('smoothing', 'Lissage', 0, 0.95, 0.05, 0.6)],
    setup: () => ({ tex: null, w: 0, h: 0, avg: [0, 0, 0] }),
    update: (s, p, dt, t, ctx) => {
      const sc = ctx.screen;
      if (!sc) return;
      if (!s.tex || s.w !== sc.w || s.h !== sc.h) { s.tex = Float32Array.from(sc.data); s.w = sc.w; s.h = sc.h; }
      const k = 1 - p.smoothing;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < s.tex.length; i += 3) {
        s.tex[i] += (sc.data[i] - s.tex[i]) * k;
        s.tex[i + 1] += (sc.data[i + 1] - s.tex[i + 1]) * k;
        s.tex[i + 2] += (sc.data[i + 2] - s.tex[i + 2]) * k;
        r += s.tex[i]; g += s.tex[i + 1]; b += s.tex[i + 2];
      }
      const n = s.tex.length / 3;
      s.avg = [r / n, g / n, b / n];
    },
    sample: (s, p, u, v) => {
      if (!s.tex) return [0, 0, 0];
      let c;
      if (p.mode === 'average') c = s.avg;
      else {
        const x = Math.min(s.w - 1, Math.floor(u * s.w)), y = Math.min(s.h - 1, Math.floor(v * s.h));
        const i = (y * s.w + x) * 3;
        c = [s.tex[i], s.tex[i + 1], s.tex[i + 2]];
      }
      const grey = (c[0] + c[1] + c[2]) / 3;
      return c.map((x) => grey + (x - grey) * p.saturation);
    },
  },
];

export const EFFECT_MAP = Object.fromEntries(EFFECTS.map((e) => [e.id, e]));
export const EFFECT_NAMES = EFFECTS.map((e) => e.id);

/** Valeurs par défaut d'un effet. */
export function defaultParams(id) {
  return Object.fromEntries((EFFECT_MAP[id]?.params ?? []).map((p) => [p.key, p.default]));
}

/** Convertit les paramètres bruts (texte, issus de l'UI) en valeurs prêtes à l'emploi. */
export function parseParams(id, raw = {}) {
  const out = {};
  for (const def of EFFECT_MAP[id]?.params ?? []) {
    const v = raw[def.key] ?? def.default;
    if (def.type === 'color') out[def.key] = hexToRgb(v);
    else if (def.type === 'range') out[def.key] = Number(v);
    else if (def.type === 'boolean') out[def.key] = v === true || v === 'true';
    else out[def.key] = v;
  }
  return out;
}

/** Description sérialisable (sans fonctions) pour l'interface. */
export function describeEffects() {
  return EFFECTS.map(({ id, name, category, requires, params }) => ({ id, name, category, requires: requires ?? null, params }));
}
