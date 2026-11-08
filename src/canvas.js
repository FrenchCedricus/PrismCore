// Canvas virtuel : surface commune (unités arbitraires, 100 × 60 par défaut) sur laquelle l'effet est calculé.
// Les appareils y sont positionnés par des rectangles ; un effet traverse donc les appareils de façon continue.
// Module pur : utilisé par le moteur et par l'interface (aperçus).

import { EFFECT_MAP, parseParams, defaultParams } from './effects.js';
import { clamp8 } from './util.js';

export const CANVAS_W = 100;
export const CANVAS_H = 60;

export function emptyAudio() {
  return { bands: new Array(16).fill(0), level: 0, bass: 0, mid: 0, treble: 0, beat: false };
}

export class VirtualCanvas {
  constructor({ width = CANVAS_W, height = CANVAS_H, effect = 'rainbow', params = {}, brightness = 1 } = {}) {
    this.width = width;
    this.height = height;
    this.brightness = brightness;
    this.ctx = { t: 0, aspect: width / height, audio: emptyAudio(), screen: null };
    this.start = Date.now();
    this.last = this.start;
    this.setEffect(effect, params);
  }

  setEffect(id, raw = {}) {
    const def = EFFECT_MAP[id];
    if (!def) throw new Error(`Effet inconnu : ${id}`);
    this.def = def;
    this.effectId = id;
    this.raw = { ...defaultParams(id), ...raw };
    this.p = parseParams(id, this.raw);
    this.state = def.setup ? def.setup(this.p) : {};
  }

  setParams(raw = {}) {
    this.raw = { ...this.raw, ...raw };
    this.p = parseParams(this.effectId, this.raw);
  }

  setAudio(audio) {
    this.ctx.audio = { ...emptyAudio(), ...audio };
  }

  setScreen(screen) {
    this.ctx.screen = screen;
  }

  /** Avance le temps (une fois par image). */
  tick(now = Date.now()) {
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    this.ctx.t = (now - this.start) / 1000;
    this.def.update?.(this.state, this.p, dt, this.ctx.t, this.ctx);
    if (this.ctx.audio.beat) this.ctx.audio.beat = false; // un temps fort ne dure qu'une image
  }

  /** Couleur au point (cx, cy) en unités canvas. */
  sample(cx, cy) {
    const u = Math.max(0, Math.min(1, cx / this.width));
    const v = Math.max(0, Math.min(1, cy / this.height));
    const c = this.def.sample(this.state, this.p, u, v, this.ctx);
    const k = this.brightness;
    return [clamp8(c[0] * k), clamp8(c[1] * k), clamp8(c[2] * k)];
  }

  /** Image basse résolution (RGBA) du canvas complet, pour l'aperçu. */
  render(w, h, out = new Uint8ClampedArray(w * h * 4)) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = this.sample(((x + 0.5) / w) * this.width, ((y + 0.5) / h) * this.height);
        const i = (y * w + x) * 4;
        out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = 255;
      }
    }
    return out;
  }
}
