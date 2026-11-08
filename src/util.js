// Utilitaires partagés : pause synchrone, couleurs.

// Créé à la demande : ce module est aussi chargé par l'interface, où SharedArrayBuffer n'existe pas.
let sleepCell = null;

/** Pause bloquante (les plugins appellent device.pause() de façon synchrone). Moteur uniquement. */
export function sleepSync(ms) {
  const n = Number(ms) || 0;
  if (n <= 0) return;
  sleepCell ??= new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(sleepCell, 0, 0, n);
}

/**
 * Boucle cadencée qui compense la dérive : vise des échéances absolues plutôt que des délais relatifs.
 * Indispensable sous Windows où setTimeout(33) attend en réalité ~46 ms (granularité de ~15,6 ms).
 * @param {() => number} getPeriod période en ms (relue à chaque image)
 * @param {() => void} fn
 * @returns {() => void} fonction d'arrêt
 */
export function startTicker(getPeriod, fn) {
  let next = performance.now();
  let stopped = false;
  let timer = null;
  const step = () => {
    if (stopped) return;
    fn();
    next += getPeriod();
    const now = performance.now();
    if (now - next > 250) next = now; // après une longue pause (veille, appareil lent) : pas de rafale de rattrapage
    timer = setTimeout(step, Math.max(0, next - now));
  };
  step();
  return () => { stopped = true; clearTimeout(timer); };
}

export function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex ?? ''));
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => clamp8(v).toString(16).padStart(2, '0')).join('');
}

export function clamp8(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** h ∈ [0,1), s,v ∈ [0,1] → [r,g,b] 0..255 */
export function hsvToRgb(h, s, v) {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  return [clamp8(r * 255), clamp8(g * 255), clamp8(b * 255)];
}

/** Réordonne un triplet RGB selon un ordre type "GRB", "BGR"… */
export function reorder(rgb, order = 'RGB') {
  const o = String(order || 'RGB').toUpperCase();
  const map = { R: rgb[0], G: rgb[1], B: rgb[2] };
  return [map[o[0]] ?? rgb[0], map[o[1]] ?? rgb[1], map[o[2]] ?? rgb[2]];
}

/** Tableau de couleurs au format attendu par les plugins : "Inline" = [r,g,b,r,g,b…], "Separate" = [[R…],[G…],[B…]] */
export function formatColors(colors, format = 'Inline', order = 'RGB') {
  const ordered = colors.map((c) => reorder(c, order));
  if (String(format).toLowerCase() === 'separate') {
    return [ordered.map((c) => c[0]), ordered.map((c) => c[1]), ordered.map((c) => c[2])];
  }
  return ordered.flat();
}

/** Copie `data` dans un tableau de longueur exacte `len` (complété par des zéros). */
export function padTo(data, len) {
  const src = Array.from(data ?? [], (v) => (Number(v) || 0) & 0xff);
  if (!len) return src;
  const out = new Array(len).fill(0);
  for (let i = 0; i < Math.min(len, src.length); i++) out[i] = src[i];
  return out;
}
