// Capture locale : choix de l'écran, état des flux audio / écran, visualisation en direct.

import { h, icon, toggle, attempt } from '../ui.js';

const LABEL = { off: ['', 'Inactif'], starting: ['warn', 'Démarrage…'], running: ['ok', 'En cours'], error: ['err', 'Erreur'] };

export default {
  id: 'capture',
  title: 'Capture',
  icon: 'capture',
  mount(root, { api, store }) {
    const sources = h('div', { class: 'sources' }, h('div', { class: 'muted' }, 'Recherche des écrans…'));
    const audioBadge = h('span', { class: 'badge' });
    const screenBadge = h('span', { class: 'badge' });
    const errorLine = h('div', { class: 'field-help' });
    const viz = h('canvas', { class: 'viz' });
    const thumb = h('canvas', { class: 'screen-thumb', width: 64, height: 36 });
    const levels = h('div', { class: 'muted mono', style: { marginTop: '8px' } }, '—');
    let monitoring = false;

    root.append(
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', {}, 'Capture audio & écran'), h('p', {}, "Alimente les effets « Son » et « Écran ». L'analyse est faite sur ta machine, rien n'est envoyé nulle part."))),
      h('div', { class: 'card', style: { marginBottom: '14px' } },
        h('div', { class: 'field-row' },
          h('div', {}, h('strong', {}, 'Tester la capture'), h('div', { class: 'field-help' }, "Active la capture tant que cette page est ouverte, même si l'effet actif n'en a pas besoin.")),
          toggle(false, (on) => { monitoring = on; attempt(() => api.capture.monitor(on)); }))),
      h('div', { class: 'grid capture-layout' },
        h('div', { class: 'card' },
          h('div', { class: 'card-title' }, h('h3', {}, 'Son du système'), audioBadge),
          viz, levels),
        h('div', { class: 'card' },
          h('div', { class: 'card-title' }, h('h3', {}, 'Écran capturé'), screenBadge),
          thumb, errorLine)),
      h('div', { class: 'card', style: { marginTop: '14px' } },
        h('div', { class: 'card-title' }, h('h3', {}, "Écran source"), h('button', { class: 'btn sm', onclick: loadSources }, icon('refresh', 14), 'Actualiser')),
        sources),
    );

    function renderStatus(st = store.state.captureStatus ?? { audio: 'off', screen: 'off' }) {
      const [ac, al] = LABEL[st.audio] ?? LABEL.off;
      const [sc, sl] = LABEL[st.screen] ?? LABEL.off;
      audioBadge.className = `badge ${ac}`; audioBadge.textContent = al;
      screenBadge.className = `badge ${sc}`; screenBadge.textContent = sl;
      errorLine.textContent = st.error ? `Dernière erreur : ${st.error}` : '';
    }

    async function loadSources() {
      const list = await attempt(() => api.capture.sources());
      if (!list) return;
      const current = store.state.settings.captureSourceId ?? list[0]?.id;
      sources.replaceChildren(...list.map((s) => {
        const btn = h('button', {
          class: `source ${s.id === current ? 'active' : ''}`,
          onclick: async () => {
            await attempt(() => api.settings.set({ captureSourceId: s.id }), `Source : ${s.name}`);
            sources.querySelectorAll('.source').forEach((b) => b.classList.toggle('active', b === btn));
          },
        }, h('img', { src: s.thumbnail, alt: '' }), h('span', {}, s.name));
        return btn;
      }));
    }

    function drawAudio(a) {
      const rect = viz.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const W = Math.round(rect.width * dpr), H = Math.round(rect.height * dpr);
      if (viz.width !== W) { viz.width = W; viz.height = H; }
      const g = viz.getContext('2d');
      g.clearRect(0, 0, W, H);
      const n = a.bands.length, gap = 4 * dpr, bw = (W - gap * (n - 1)) / n;
      const grad = g.createLinearGradient(0, H, 0, 0);
      grad.addColorStop(0, '#8b5cf6'); grad.addColorStop(1, '#22d3ee');
      g.fillStyle = grad;
      a.bands.forEach((b, i) => {
        const bh = Math.max(2 * dpr, b * (H - 8 * dpr));
        g.beginPath();
        g.roundRect(i * (bw + gap), H - bh, bw, bh, 3 * dpr);
        g.fill();
      });
      if (a.beat) { g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(0, 0, W, H); }
      levels.textContent = `niveau ${(a.level * 100).toFixed(0)} %  ·  graves ${(a.bass * 100).toFixed(0)}  ·  médiums ${(a.mid * 100).toFixed(0)}  ·  aigus ${(a.treble * 100).toFixed(0)}`;
    }

    function drawScreen(sc) {
      if (thumb.width !== sc.w) { thumb.width = sc.w; thumb.height = sc.h; }
      const img = new ImageData(sc.w, sc.h);
      for (let i = 0, j = 0; j < sc.data.length; i += 4, j += 3) { img.data[i] = sc.data[j]; img.data[i + 1] = sc.data[j + 1]; img.data[i + 2] = sc.data[j + 2]; img.data[i + 3] = 255; }
      thumb.getContext('2d').putImageData(img, 0, 0);
    }

    const offs = [
      store.on('captureStatus', renderStatus),
      store.on('capture:audio', drawAudio),
      store.on('capture:screen', drawScreen),
    ];
    renderStatus();
    loadSources();
    return () => { offs.forEach((f) => f()); if (monitoring) api.capture.monitor(false); };
  },
};
