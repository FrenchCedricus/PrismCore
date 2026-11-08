// Icône générée à l'exécution (aucun fichier binaire à maintenir) : anneau dégradé violet → cyan.

import { nativeImage } from 'electron';

export function createIcon(size = 32) {
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const outer = size / 2 - 0.5, inner = size * 0.24;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - c, dy = y - c;
      const d = Math.hypot(dx, dy);
      const edge = Math.min(1, Math.max(0, outer - d + 0.5)) * Math.min(1, Math.max(0, d - inner + 0.5));
      const t = (Math.atan2(dy, dx) / Math.PI + 1) / 2; // 0..1 autour de l'anneau
      const r = Math.round(124 + (0 - 124) * t), g = Math.round(77 + (229 - 77) * t), b = 255;
      const i = (y * size + x) * 4;
      buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = Math.round(edge * 255); // BGRA
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}
