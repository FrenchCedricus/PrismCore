// Canvas virtuel : disposition des appareils les uns par rapport aux autres.
// Glisser pour déplacer, poignée pour redimensionner. L'effet est calculé sur toute la surface :
// une vague passe ainsi du clavier à la carte mère puis au micro sans rupture.

import { h, icon, drawFrame, throttle, attempt, modal } from '../ui.js';

const SNAP = 0.5;
const snap = (v) => Math.round(v / SNAP) * SNAP;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export default {
  id: 'canvas',
  title: 'Canvas',
  icon: 'canvas',
  mount(root, { api, store }) {
    let W = store.state.devices?.canvas?.width ?? 100;
    let H = store.state.devices?.canvas?.height ?? 60;
    let items = [];          // éléments positionnables (aplatis depuis les appareils)
    let layout = {};         // key → {x,y,w,h} : copie de travail
    let selected = null;
    let dragging = false;

    const bg = h('canvas', { class: 'bg' });
    const leds = h('canvas');
    const stage = h('div', { class: 'stage' }, bg, h('div', { class: 'grid-lines' }), leds);
    const list = h('div', { class: 'item-list' });
    const inspector = h('div');

    root.append(
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', {}, 'Canvas virtuel'), h('p', {}, 'Place tes appareils comme sur ton bureau : les effets se propagent de l\'un à l\'autre.')),
        h('div', { class: 'page-actions' },
          h('button', { class: 'btn', onclick: autoArrange }, icon('wand', 16), 'Agencement automatique'),
          h('button', { class: 'btn ghost', onclick: reset }, icon('refresh', 16), 'Réinitialiser'))),
      h('div', { class: 'canvas-layout' },
        h('div', { class: 'card stage-wrap' }, stage,
          h('div', { class: 'field-help', style: { marginTop: '10px' } }, `Surface de ${W} × ${H} unités. Glisser pour déplacer, poignée blanche pour redimensionner, flèches du clavier pour ajuster (Maj = pas de 5).`)),
        h('div', {},
          h('div', { class: 'card' }, h('div', { class: 'card-title' }, h('h3', {}, 'Éléments')), list),
          h('div', { class: 'card', style: { marginTop: '14px' } }, inspector))),
    );

    const pushLive = throttle(() => api.layout.preview(layout), 40);
    const save = () => attempt(() => api.layout.set(layout));

    function sync() {
      const data = store.state.devices;
      W = data?.canvas?.width ?? W; H = data?.canvas?.height ?? H;
      const next = (data?.devices ?? []).flatMap((d) => d.items.map((it) => ({ ...it, device: d.id })));
      const changed = next.length !== items.length || next.some((it, i) => it.key !== items[i]?.key || it.leds.length !== items[i]?.leds.length);
      items = next;
      if (!dragging) for (const it of items) layout[it.key] = { ...it.rect };
      if (changed) renderItems();
      else if (!dragging) positionAll();
    }

    function renderItems() {
      stage.querySelectorAll('.item').forEach((e) => e.remove());
      for (const it of items) {
        const handle = h('div', { class: 'handle' });
        const el = h('div', { class: `item ${it.kind}`, 'data-key': it.key, tabIndex: 0 }, h('span', { class: 'item-label' }, it.label), handle);
        el.addEventListener('pointerdown', (e) => startDrag(e, it.key, e.target === handle ? 'resize' : 'move'));
        el.addEventListener('keydown', (e) => nudge(e, it.key));
        stage.append(el);
      }
      list.replaceChildren(...(items.length ? items.map((it) => h('div', { class: `item-row ${it.kind}`, 'data-key': it.key, onclick: () => select(it.key) },
        h('span', { class: 'dot' }), h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, it.label),
        h('span', { class: 'faint mono' }, `${it.leds.length}`))) : [h('div', { class: 'muted' }, 'Aucun appareil.')]));
      positionAll();
      renderInspector();
    }

    function positionAll() {
      for (const el of stage.querySelectorAll('.item')) {
        const r = layout[el.dataset.key];
        if (!r) continue;
        Object.assign(el.style, { left: `${(r.x / W) * 100}%`, top: `${(r.y / H) * 100}%`, width: `${(r.w / W) * 100}%`, height: `${(r.h / H) * 100}%` });
        el.classList.toggle('selected', el.dataset.key === selected);
      }
      list.querySelectorAll('.item-row').forEach((r) => r.classList.toggle('selected', r.dataset.key === selected));
    }

    function select(key) {
      selected = key;
      positionAll();
      renderInspector();
    }

    function renderInspector() {
      const it = items.find((i) => i.key === selected);
      if (!it) { inspector.replaceChildren(h('div', { class: 'muted' }, 'Sélectionne un élément pour régler sa position précisément.')); return; }
      const r = layout[it.key];
      const field = (k, label) => h('label', { class: 'field', style: { margin: 0 } }, h('span', { class: 'field-label' }, label),
        h('input', { type: 'number', step: SNAP, value: r[k], onchange: (e) => { layout[it.key][k] = Number(e.target.value); clampRect(layout[it.key]); positionAll(); save(); } }));
      inspector.replaceChildren(
        h('div', { class: 'card-title' }, h('h3', {}, it.label)),
        h('div', { class: 'rect-fields' }, field('x', 'X'), field('y', 'Y'), field('w', 'Largeur'), field('h', 'Hauteur')),
        h('div', { class: 'field-help', style: { marginTop: '10px' } }, `${it.leds.length} LED · grille ${it.size[0]} × ${it.size[1]}`));
    }

    function clampRect(r) {
      r.w = clamp(r.w, 1, W); r.h = clamp(r.h, 1, H);
      r.x = clamp(r.x, 0, W - r.w); r.y = clamp(r.y, 0, H - r.h);
    }

    function startDrag(e, key, mode) {
      e.preventDefault();
      e.stopPropagation();
      select(key);
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
      dragging = true;
      const box = stage.getBoundingClientRect();
      const sx = e.clientX, sy = e.clientY;
      const start = { ...layout[key] };
      const move = (ev) => {
        const dx = ((ev.clientX - sx) / box.width) * W;
        const dy = ((ev.clientY - sy) / box.height) * H;
        const r = layout[key];
        if (mode === 'move') { r.x = snap(start.x + dx); r.y = snap(start.y + dy); }
        else { r.w = snap(Math.max(1, start.w + dx)); r.h = snap(Math.max(1, start.h + dy)); }
        clampRect(r);
        positionAll();
        pushLive();
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.classList.remove('dragging');
        dragging = false;
        renderInspector();
        save();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    }

    function nudge(e, key) {
      const step = e.shiftKey ? 5 : SNAP;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!d) return;
      e.preventDefault();
      layout[key].x += d[0]; layout[key].y += d[1];
      clampRect(layout[key]);
      positionAll();
      renderInspector();
      save();
    }

    /** Range les éléments de gauche à droite, en respectant les proportions de leur grille de LED. */
    function autoArrange() {
      let x = 2, y = 2, rowH = 0;
      for (const it of items) {
        const r = layout[it.key];
        if (x + r.w > W - 2) { x = 2; y += rowH + 2; rowH = 0; }
        r.x = x; r.y = Math.min(y, H - r.h);
        x += r.w + 2; rowH = Math.max(rowH, r.h);
      }
      positionAll();
      renderInspector();
      save();
    }

    async function reset() {
      if (!(await modal({ title: 'Réinitialiser la disposition ?', message: 'Les positions personnalisées de ce profil seront remplacées par la disposition automatique.', confirm: 'Réinitialiser', danger: true }))) return;
      const data = await attempt(() => api.layout.reset());
      if (data) { layout = {}; store.set('devices', data); }
    }

    function drawLeds(preview) {
      if (!preview) return;
      drawFrame(bg, preview);
      const rect = stage.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const Wpx = Math.round(rect.width * dpr), Hpx = Math.round(rect.height * dpr);
      if (leds.width !== Wpx || leds.height !== Hpx) { leds.width = Wpx; leds.height = Hpx; }
      const g = leds.getContext('2d');
      g.clearRect(0, 0, Wpx, Hpx);
      for (const it of items) {
        const r = layout[it.key];
        const colors = preview.leds[it.key];
        if (!r || !colors) continue;
        const gw = Math.max(1, it.size[0]), gh = Math.max(1, it.size[1]);
        const cellW = (r.w / gw / W) * Wpx, cellH = (r.h / gh / H) * Hpx;
        const size = Math.max(2, Math.min(cellW, cellH) * 0.62);
        it.leds.forEach(([lx, ly], i) => {
          const px = ((r.x + ((lx + 0.5) / gw) * r.w) / W) * Wpx;
          const py = ((r.y + ((ly + 0.5) / gh) * r.h) / H) * Hpx;
          g.fillStyle = `rgb(${colors[i * 3]},${colors[i * 3 + 1]},${colors[i * 3 + 2]})`;
          g.shadowColor = g.fillStyle;
          g.shadowBlur = size;
          g.beginPath();
          g.roundRect(px - size / 2, py - size / 2, size, size, size * 0.25);
          g.fill();
        });
      }
      g.shadowBlur = 0;
    }

    const offDevices = store.on('devices', sync);
    const offPreview = store.on('preview', drawLeds);
    sync();
    renderItems();
    return () => { offDevices(); offPreview(); };
  },
};
