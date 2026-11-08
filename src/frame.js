// Image partagée du canvas : le moteur y écrit l'effet calculé (RGB, FRAME_W × FRAME_H) à chaque image,
// et chaque worker d'appareil y lit les couleurs de ses LED. Une seule source de vérité pour tous les appareils.

export const FRAME_W = 160;
export const FRAME_H = 96;

/** Couleur au point (cx, cy) en unités canvas (W × H), par interpolation bilinéaire. */
export function sampleFrame(buf, cx, cy, W, H, fw = FRAME_W, fh = FRAME_H) {
  const fx = Math.max(0, Math.min(fw - 1, (cx / W) * fw - 0.5));
  const fy = Math.max(0, Math.min(fh - 1, (cy / H) * fh - 0.5));
  const x0 = fx | 0, y0 = fy | 0;
  const x1 = x0 + 1 < fw ? x0 + 1 : x0, y1 = y0 + 1 < fh ? y0 + 1 : y0;
  const tx = fx - x0, ty = fy - y0;
  const a = (y0 * fw + x0) * 3, b = (y0 * fw + x1) * 3, c = (y1 * fw + x0) * 3, d = (y1 * fw + x1) * 3;
  const out = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const top = buf[a + k] + (buf[b + k] - buf[a + k]) * tx;
    const bot = buf[c + k] + (buf[d + k] - buf[c + k]) * tx;
    out[k] = Math.round(top + (bot - top) * ty);
  }
  return out;
}

/** Applique la luminosité / l'activation propres à un appareil. */
export function shade(c, settings) {
  if (settings && settings.enabled === false) return [0, 0, 0];
  const k = settings?.brightness ?? 1;
  return k === 1 ? c : [Math.round(c[0] * k), Math.round(c[1] * k), Math.round(c[2] * k)];
}

const HEX_CACHE = new Map();
function parseHex(h) {
  let c = HEX_CACHE.get(h);
  if (!c) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h ?? '');
    c = m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
    if (HEX_CACHE.size > 512) HEX_CACHE.clear();
    HEX_CACHE.set(h, c);
  }
  return c;
}

/**
 * Calque de touches : couleur finale de la LED (x, y) de l'élément `key`.
 *   layer = { base: 'effect' | 'dim' | 'black', dim: 0..1, brightness: 0..1, keys: { [clé d'élément]: { "x,y": "#rrggbb" } } }
 * Un élément sans touche colorée garde l'effet tel quel. Sinon, ses touches colorées prennent leur couleur
 * (avec la luminosité globale) et les autres suivent `base` : effet complet, effet atténué ou éteintes.
 */
export function layerColor(layer, key, x, y, base) {
  const keys = layer?.keys?.[key];
  if (!keys) return base;
  const hex = keys[`${x},${y}`];
  if (hex) {
    const c = parseHex(hex);
    const k = layer.brightness ?? 1;
    return k === 1 ? c : [Math.round(c[0] * k), Math.round(c[1] * k), Math.round(c[2] * k)];
  }
  const mode = layer.base ?? 'dim';
  if (mode === 'effect') return base;
  if (mode === 'black') return [0, 0, 0];
  const k = layer.dim ?? 0.2;
  return [Math.round(base[0] * k), Math.round(base[1] * k), Math.round(base[2] * k)];
}

/** Positions (unités canvas) des LED d'un élément placé dans le rectangle r. */
export function ledPoint(r, size, x, y) {
  const gw = Math.max(1, size?.[0] ?? 1), gh = Math.max(1, size?.[1] ?? 1);
  return [r.x + ((x + 0.5) / gw) * r.w, r.y + ((y + 0.5) / gh) * r.h];
}
