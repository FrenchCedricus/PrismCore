// Petits utilitaires d'interface : création d'éléments, icônes, contrôles, modales, toasts.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const PATHS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  effects: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  canvas: '<rect x="3" y="4" width="18" height="16" rx="2"/><rect x="6" y="7" width="6" height="4" rx="1"/><rect x="13" y="12" width="5" height="5" rx="1"/>',
  profiles: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  capture: '<path d="M3 12h2l2-6 3 12 3-9 2 5 2-2h4"/>',
  settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  logs: '<path d="M4 6h16M4 10h10M4 14h16M4 18h8"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  mouse: '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 7v4"/>',
  motherboard: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"/>',
  headphones: '<path d="M4 15v-3a8 8 0 0116 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>',
  microphone: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>',
  light: '<path d="M9 18h6M10 21h4M12 3a6 6 0 00-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0012 3z"/>',
  chip: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 9h6v6H9z"/>',
  other: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  battery: '<rect x="2" y="7" width="18" height="10" rx="2"/><path d="M22 11v2"/>',
  refresh: '<path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
  power: '<path d="M12 3v9M6.3 6.3a8 8 0 1011.4 0"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  wand: '<path d="M4 20L16 8M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM19 11l.5 1 1 .5-1 .5-.5 1-.5-1-1-.5 1-.5z"/>',
};

const TYPE_ICON = {
  keyboard: 'keyboard', mouse: 'mouse', mousepad: 'mouse', motherboard: 'motherboard', headphones: 'headphones',
  microphone: 'microphone', speakers: 'headphones', lightingcontroller: 'light', gpu: 'chip', ram: 'chip', aio: 'chip', dongle: 'other',
};

export function icon(name, size = 18) {
  const span = document.createElement('span');
  span.style.display = 'inline-flex';
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${PATHS[name] ?? PATHS.other}</svg>`;
  return span;
}

export const deviceIcon = (type, size) => icon(TYPE_ICON[type] ?? 'other', size);

export function toast(message, kind = 'info', ms = 3200) {
  const el = h('div', { class: `toast ${kind}` }, message);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), ms);
}

/** Exécute une action asynchrone et affiche l'erreur éventuelle. */
export async function attempt(fn, okMessage) {
  try {
    const r = await fn();
    if (okMessage) toast(okMessage, 'ok');
    return r;
  } catch (e) {
    toast(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error', 5000);
    return undefined;
  }
}

/** Modale de confirmation ou de saisie. Renvoie la valeur saisie / true, ou null si annulé. */
export function modal({ title, message = '', input = null, confirm = 'Valider', danger = false }) {
  return new Promise((resolve) => {
    const field = input !== null ? h('input', { type: 'text', value: input, maxLength: 60 }) : null;
    const close = (v) => { backdrop.remove(); resolve(v); };
    const ok = () => close(field ? field.value.trim() || null : true);
    const backdrop = h('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === backdrop) close(null); } },
      h('div', { class: 'modal' },
        h('h2', {}, title),
        message ? h('p', {}, message) : null,
        field,
        h('div', { class: 'modal-actions' },
          h('button', { class: 'btn ghost', onclick: () => close(null) }, 'Annuler'),
          h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: ok }, confirm))));
    backdrop.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') close(null); });
    document.body.append(backdrop);
    (field ?? backdrop.querySelector('.btn.primary, .btn.danger')).focus();
    field?.select();
  });
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function throttle(fn, ms) {
  let last = 0, t;
  return (...a) => {
    const now = Date.now();
    clearTimeout(t);
    if (now - last >= ms) { last = now; fn(...a); } else t = setTimeout(() => { last = Date.now(); fn(...a); }, ms - (now - last));
  };
}

export function toggle(checked, onChange) {
  const input = h('input', { type: 'checkbox', checked: !!checked, onchange: () => onChange(input.checked) });
  return h('label', { class: 'toggle' }, input, h('span'));
}

/**
 * Contrôle de paramètre générique.
 * Accepte le schéma des effets ({key,type:color|range|select|boolean}) et celui des plugins
 * ({property,type:color|combobox|boolean|number|textfield}).
 */
export function paramControl(def, value, onChange) {
  const label = def.label ?? def.key ?? def.property;
  const type = def.type;
  if (type === 'boolean') {
    return h('div', { class: 'field' }, h('div', { class: 'field-row' }, h('span', { class: 'field-label' }, label), toggle(value === true || value === 'true', onChange)), def.description ? h('div', { class: 'field-help' }, def.description) : null);
  }
  let control;
  let valEl = null;
  if (type === 'color') {
    control = h('input', { type: 'color', value: value ?? def.default ?? '#ffffff', oninput: (e) => onChange(e.target.value) });
    return h('div', { class: 'field' }, h('div', { class: 'field-row' }, h('span', { class: 'field-label' }, label), control), def.description ? h('div', { class: 'field-help' }, def.description) : null);
  }
  if (type === 'select' || type === 'combobox') {
    const opts = (def.options ?? def.values ?? []).map((o) => (Array.isArray(o) ? o : [o, o]));
    control = h('select', { onchange: (e) => onChange(e.target.value) }, opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));
  } else if (type === 'range' || type === 'number' || type === 'int') {
    const min = Number(def.min ?? 0), max = Number(def.max ?? 100), step = Number(def.step ?? (type === 'range' ? 0.01 : 1));
    valEl = h('span', { class: 'val' }, format(value, step));
    control = h('input', { type: 'range', min, max, step, value: value ?? def.default, oninput: (e) => { valEl.textContent = format(e.target.value, step); onChange(Number(e.target.value)); } });
  } else {
    control = h('input', { type: 'text', value: value ?? '', onchange: (e) => onChange(e.target.value) });
  }
  return h('div', { class: 'field' }, h('div', { class: 'field-label' }, h('span', {}, label), valEl), control, def.description ? h('div', { class: 'field-help' }, def.description) : null);
}

function format(v, step) {
  const n = Number(v);
  return step >= 1 ? String(Math.round(n)) : n.toFixed(step >= 0.1 ? 1 : 2);
}

/** Dessine une image RGBA basse résolution, agrandie avec lissage, dans un canvas. */
const scratch = document.createElement('canvas');
export function drawFrame(canvas, preview) {
  if (!preview) return;
  const { w, h: hh, frame } = preview;
  if (scratch.width !== w || scratch.height !== hh) { scratch.width = w; scratch.height = hh; }
  scratch.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(frame.buffer ?? frame, frame.byteOffset ?? 0, w * hh * 4), w, hh), 0, 0);
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(1, Math.round(rect.width * dpr)), H = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(scratch, 0, 0, W, H);
}

export function timeAgo(iso) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "à l'instant";
  if (d < 3600) return `il y a ${Math.floor(d / 60)} min`;
  if (d < 86400) return `il y a ${Math.floor(d / 3600)} h`;
  return new Date(iso).toLocaleDateString('fr-FR');
}

export const hex4 = (n) => (n ?? 0).toString(16).toUpperCase().padStart(4, '0');
