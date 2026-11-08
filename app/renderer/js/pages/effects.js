// Effets : galerie avec aperçus animés (calculés localement avec le même code que le moteur),
// réglages de l'effet actif et aperçu réel du canvas.

import { h, paramControl, drawFrame, throttle, attempt } from '../ui.js';
import { VirtualCanvas } from '/src/canvas.js';

const CATEGORY_ORDER = ['Basique', 'Mouvement', 'Ambiance', 'Audio', 'Écran'];

/** Données audio / écran synthétiques pour animer les vignettes sans capture réelle. */
function fakeInputs(t) {
  const bands = Array.from({ length: 16 }, (_, i) => Math.max(0, 0.55 + 0.4 * Math.sin(t * 3 + i * 0.7) * Math.cos(t * 1.3 + i * 0.3) - i * 0.02));
  const beat = Math.floor(t * 2) !== Math.floor((t - 1 / 30) * 2);
  const w = 16, hh = 9, data = new Uint8Array(w * hh * 3);
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    data[i] = 128 + 127 * Math.sin(t + x * 0.4); data[i + 1] = 90 + 80 * Math.sin(t * 0.7 + y * 0.6); data[i + 2] = 160 + 90 * Math.cos(t * 0.5 + x * 0.2);
  }
  return { audio: { bands, level: 0.6, bass: bands[1], mid: bands[6], treble: bands[12], beat }, screen: { w, h: hh, data } };
}

export default {
  id: 'effects',
  title: 'Effets',
  icon: 'effects',
  mount(root, { api, store }) {
    const effects = store.state.effects;
    const thumbs = [];
    let raf = 0;

    const preview = h('canvas', { class: 'preview-canvas' });
    const paramsBox = h('div');
    const title = h('h2');
    const requiresNote = h('div', { class: 'field-help', style: { marginTop: '6px' } });
    const cards = new Map();

    const groups = CATEGORY_ORDER.map((cat) => {
      const list = effects.filter((e) => e.category === cat);
      if (!list.length) return null;
      return h('div', { class: 'effect-group' },
        h('h3', {}, cat),
        h('div', { class: 'effect-grid' }, list.map((e) => {
          const c = h('canvas', { width: 48, height: 28 });
          const vc = new VirtualCanvas({ effect: e.id });
          thumbs.push({ canvas: c, vc, requires: e.requires });
          const card = h('button', { class: 'effect-card', onclick: () => attempt(() => api.effects.set(e.id)) },
            c,
            h('div', { class: 'effect-label' }, h('span', {}, e.name), e.requires ? h('span', { class: 'badge accent' }, e.requires === 'audio' ? 'Son' : 'Écran') : null));
          cards.set(e.id, card);
          return card;
        })));
    });

    root.append(
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', {}, 'Effets'), h('p', {}, "Choisis un effet : il est calculé sur tout le canvas et traverse tes appareils selon leur position."))),
      h('div', { class: 'effects-layout' },
        h('div', {}, groups),
        h('div', { class: 'sticky' },
          h('div', { class: 'card' },
            h('div', { class: 'card-title' }, h('h3', {}, 'Aperçu en direct'), h('span', { class: 'badge ok' }, 'Moteur')),
            preview),
          h('div', { class: 'card', style: { marginTop: '14px' } },
            h('div', { class: 'card-title' }, title),
            requiresNote,
            paramsBox))),
    );

    function renderParams() {
      const prof = store.state.profiles.active;
      const id = prof.effect?.id;
      const def = effects.find((e) => e.id === id);
      for (const [eid, card] of cards) card.classList.toggle('active', eid === id);
      if (!def) return;
      title.textContent = def.name;
      requiresNote.textContent = def.requires === 'audio' ? 'Utilise le son de ton PC, analysé localement.'
        : def.requires === 'screen' ? "Utilise l'image de ton écran, réduite à 64×36 pixels et analysée localement." : '';
      const values = prof.effect.params ?? {};
      const send = throttle((patch) => api.effects.params(patch), 50);
      paramsBox.replaceChildren(...def.params.map((p) => paramControl(p, values[p.key] ?? p.default, (v) => send({ [p.key]: v }))));
    }

    // Ne reconstruit les contrôles que si le profil ou l'effet change (pas à chaque réglage).
    const keyOf = (p) => `${p.active.id}:${p.active.effect?.id}`;
    let lastKey = keyOf(store.state.profiles);
    const offProfiles = store.on('profiles', (p) => {
      if (keyOf(p) !== lastKey) { lastKey = keyOf(p); renderParams(); }
    });
    const offPreview = store.on('preview', (p) => drawFrame(preview, p));
    renderParams();

    const img = new ImageData(48, 28);
    function animate() {
      const t = performance.now() / 1000;
      const fake = fakeInputs(t);
      for (const th of thumbs) {
        if (th.requires === 'audio') th.vc.setAudio(fake.audio);
        if (th.requires === 'screen') th.vc.setScreen(fake.screen);
        th.vc.tick();
        th.vc.render(48, 28, img.data);
        th.canvas.getContext('2d').putImageData(img, 0, 0);
      }
      raf = requestAnimationFrame(animate);
    }
    animate();

    return () => { cancelAnimationFrame(raf); offProfiles(); offPreview(); };
  },
};
