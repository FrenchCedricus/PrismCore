// Tableau de bord : appareils connectés, état en temps réel, réglages rapides, détails.

import { h, icon, deviceIcon, toggle, paramControl, attempt, throttle, debounce, hex4 } from '../ui.js';
import { openDrawer, closeDrawer } from '../app.js';

const STATUS = {
  ok: ['ok', 'Actif'],
  warning: ['warn', 'Avertissement'],
  paused: ['', 'En pause'],
  error: ['err', 'Erreur'],
};

export default {
  id: 'dashboard',
  title: 'Tableau de bord',
  icon: 'dashboard',
  mount(root, { api, store }) {
    const cards = new Map(); // id → { el, refs }
    let drawerFor = null;

    const statDevices = h('div', { class: 'value' }, '0');
    const statLeds = h('div', { class: 'value' }, '0');
    const statFps = h('div', { class: 'value' }, '0');
    const statEffect = h('div', { class: 'value', style: { fontSize: '18px' } }, '—');
    const brightnessVal = h('span', { class: 'val' });
    const brightness = h('input', {
      type: 'range', min: 0, max: 1, step: 0.01,
      oninput: throttle((e) => { brightnessVal.textContent = `${Math.round(e.target.value * 100)} %`; api.effects.brightness(Number(e.target.value)); }, 60),
    });

    const grid = h('div', { class: 'grid devices' });
    const unsupported = h('div');

    root.append(
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', {}, 'Tableau de bord'), h('p', {}, 'Périphériques détectés et pilotés en temps réel.')),
        h('div', { class: 'page-actions' },
          h('button', { class: 'btn', onclick: () => attempt(() => api.devices.rescan(), 'Détection relancée') }, icon('refresh', 16), 'Détecter'))),
      h('div', { class: 'grid stats' },
        h('div', { class: 'card stat' }, h('span', { class: 'label' }, 'Appareils actifs'), statDevices),
        h('div', { class: 'card stat' }, h('span', { class: 'label' }, 'LED pilotées'), statLeds),
        h('div', { class: 'card stat' }, h('span', { class: 'label' }, 'Images / seconde'), statFps),
        h('div', { class: 'card stat' }, h('span', { class: 'label' }, 'Effet actif'), statEffect)),
      h('div', { class: 'card', style: { marginBottom: '18px' } },
        h('div', { class: 'field-row' },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', minWidth: '200px' } }, icon('sun'), h('strong', {}, 'Luminosité globale')),
          h('div', { style: { flex: 1 } }, brightness),
          brightnessVal)),
      grid,
      unsupported,
    );

    function syncHeader() {
      const prof = store.state.profiles.active;
      brightness.value = prof.brightness ?? 1;
      brightnessVal.textContent = `${Math.round((prof.brightness ?? 1) * 100)} %`;
      statEffect.textContent = store.state.effects.find((e) => e.id === prof.effect?.id)?.name ?? '—';
    }

    function buildCard(d) {
      const refs = {};
      refs.name = h('div', { class: 'device-name' });
      refs.sub = h('div', { class: 'device-sub' });
      refs.status = h('span', { class: 'badge' });
      refs.leds = h('span', { class: 'badge' });
      refs.battery = h('span', { class: 'badge' });
      refs.render = h('span', { class: 'badge' });
      refs.strip = h('canvas', { class: 'led-strip' });
      refs.bVal = h('span', { class: 'muted mono', style: { width: '42px', textAlign: 'right' } });
      refs.brightness = h('input', {
        type: 'range', min: 0, max: 1, step: 0.01,
        oninput: throttle((e) => { refs.bVal.textContent = `${Math.round(e.target.value * 100)}%`; api.devices.set(d.id, { brightness: Number(e.target.value) }); }, 80),
      });
      refs.toggleWrap = h('span');
      const el = h('div', { class: 'card device-card' },
        h('div', { class: 'device-head' },
          h('div', { class: 'device-icon' }, deviceIcon(d.deviceType, 22)),
          h('div', { style: { minWidth: 0, flex: 1 } }, refs.name, refs.sub),
          refs.toggleWrap),
        h('div', { class: 'device-meta' }, refs.status, refs.leds, refs.render, refs.battery),
        refs.strip,
        h('div', { class: 'device-controls' }, icon('sun', 16), refs.brightness, refs.bVal),
        h('div', { class: 'device-footer' },
          h('span', { class: 'faint mono' }, `${hex4(d.vendorId)}:${hex4(d.productId)}`),
          h('button', { class: 'btn sm', onclick: () => showDetails(d.id) }, 'Détails')));
      return { el, refs, toggleState: null };
    }

    function updateCard(card, d) {
      const { refs } = card;
      refs.name.textContent = d.name;
      refs.name.title = d.name;
      refs.sub.textContent = d.plugin !== d.name ? d.plugin : d.product || d.deviceType;
      const [cls, label] = STATUS[d.status] ?? STATUS.error;
      refs.status.className = `badge ${cls}`;
      refs.status.textContent = label;
      refs.status.title = d.error ?? '';
      refs.leds.textContent = `${d.ledCount} LED`;
      refs.render.textContent = `${d.renderMs} ms`;
      refs.render.title = 'Temps moyen de rendu pour cet appareil';
      refs.battery.style.display = d.battery?.level !== undefined ? '' : 'none';
      if (d.battery?.level !== undefined) refs.battery.textContent = `🔋 ${d.battery.level} %`;
      if (document.activeElement !== refs.brightness) {
        refs.brightness.value = d.brightness ?? 1;
        refs.bVal.textContent = `${Math.round((d.brightness ?? 1) * 100)}%`;
      }
      if (card.toggleState !== d.enabled) {
        card.toggleState = d.enabled;
        refs.toggleWrap.replaceChildren(toggle(d.enabled, (on) => attempt(() => api.devices.set(d.id, { enabled: on }))));
      }
      card.el.classList.toggle('off', !d.enabled);
      card.items = d.items;
    }

    function renderDevices() {
      const data = store.state.devices;
      const devices = data?.devices ?? [];
      statDevices.textContent = devices.filter((d) => d.status === 'ok').length;
      statLeds.textContent = devices.reduce((s, d) => s + d.ledCount, 0);
      statFps.textContent = data?.stats?.fps ?? 0;

      const ids = new Set(devices.map((d) => d.id));
      for (const [id, c] of cards) if (!ids.has(id)) { c.el.remove(); cards.delete(id); }
      for (const d of devices) {
        if (!cards.has(d.id)) { const c = buildCard(d); cards.set(d.id, c); grid.append(c.el); }
        updateCard(cards.get(d.id), d);
      }
      if (devices.length === 0 && !grid.querySelector('.empty')) {
        grid.append(h('div', { class: 'card empty', style: { gridColumn: '1 / -1' } }, icon('other', 32), h('div', {}, store.state.engine?.running ? 'Aucun appareil pris en charge détecté.' : 'Démarrage du moteur…')));
      } else if (devices.length) grid.querySelector('.empty')?.remove();

      const un = data?.unsupported ?? [];
      unsupported.replaceChildren(...(un.length ? [h('div', { class: 'unsupported' },
        h('h3', { class: 'muted' }, `Périphériques USB sans plugin compatible (${un.length})`),
        h('div', { class: 'unsupported-list' }, un.map((u) => h('span', { class: 'badge', title: u.id }, `${u.manufacturer} ${u.product}`.trim() || u.id))))] : []));

      if (drawerFor) { const d = devices.find((x) => x.id === drawerFor); if (d) refreshDrawerValues(d); }
    }

    function drawStrips(preview) {
      if (!preview) return;
      for (const card of cards.values()) {
        const canvas = card.refs.strip;
        const colors = [];
        for (const it of card.items ?? []) {
          const arr = preview.leds[it.key];
          if (arr) for (let i = 0; i < arr.length; i += 3) colors.push([arr[i], arr[i + 1], arr[i + 2]]);
        }
        const rect = canvas.getBoundingClientRect();
        const W = Math.round(rect.width), H = Math.round(rect.height);
        if (!W) continue;
        if (canvas.width !== W) { canvas.width = W; canvas.height = H; }
        const g = canvas.getContext('2d');
        g.clearRect(0, 0, W, H);
        const n = colors.length;
        if (!n) continue;
        const cellW = W / n;
        colors.forEach(([r, gg, b], i) => {
          g.fillStyle = `rgb(${r},${gg},${b})`;
          g.fillRect(Math.floor(i * cellW), 0, Math.ceil(cellW) - (cellW > 3 ? 1 : 0), H);
        });
      }
    }

    // --------------------------------------------------------------- tiroir de détails
    let drawerRefs = null;

    function showDetails(id) {
      const d = store.state.devices.devices.find((x) => x.id === id);
      if (!d) return;
      drawerFor = id;
      drawerRefs = { params: new Map() };
      const saveChannel = debounce((name, v) => attempt(() => api.devices.channel(id, name, v)), 250);

      const params = d.parameters.filter((p) => p.type !== 'hidden');
      openDrawer(h('div', { style: { display: 'contents' } },
        h('div', { class: 'drawer-head' },
          h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } },
            h('div', { class: 'device-icon' }, deviceIcon(d.deviceType, 22)),
            h('div', {}, h('h2', {}, d.name), h('div', { class: 'muted' }, d.plugin))),
          h('button', { class: 'btn icon ghost', onclick: closeDrawer }, icon('close'))),
        h('div', { class: 'drawer-body' },
          d.notifications.length ? h('div', { class: 'drawer-section' }, h('h3', {}, 'Messages du plugin'), d.notifications.map((n) => h('div', { class: 'card', style: { padding: '10px 12px', marginBottom: '6px', borderColor: '#5a4a1a' } }, h('strong', {}, n.title), h('div', { class: 'muted' }, n.desc)))) : null,
          params.length ? h('div', { class: 'drawer-section' }, h('h3', {}, 'Paramètres de l\'appareil'),
            params.map((p) => {
              const el = paramControl(p, p.value, (v) => attempt(() => api.devices.property(id, p.property, v)));
              drawerRefs.params.set(p.property, el);
              return el;
            })) : null,
          d.channels.length ? h('div', { class: 'drawer-section' }, h('h3', {}, 'Canaux ARGB'),
            h('p', { class: 'field-help', style: { marginTop: 0 } }, 'Indique le nombre de LED branchées sur chaque header. Les bandes apparaissent ensuite dans le Canvas.'),
            d.channels.map((c) => h('div', { class: 'field' },
              h('div', { class: 'field-label' }, h('span', {}, c.name), h('span', {}, c.ledLimit ? `max ${c.ledLimit}` : '')),
              h('input', { type: 'number', min: 0, max: c.ledLimit ?? 1000, value: c.ledCount, oninput: (e) => saveChannel(c.name, Number(e.target.value)) })))) : null,
          h('div', { class: 'drawer-section' }, h('h3', {}, 'Informations'),
            h('dl', { class: 'kv' },
              h('dt', {}, 'Identifiant'), h('dd', { class: 'mono' }, `${hex4(d.vendorId)}:${hex4(d.productId)}`),
              h('dt', {}, 'Produit USB'), h('dd', {}, d.product || '—'),
              h('dt', {}, 'Type'), h('dd', {}, d.deviceType),
              h('dt', {}, 'LED'), h('dd', {}, String(d.ledCount)),
              h('dt', {}, 'Plugin'), h('dd', { class: 'mono' }, d.file),
              h('dt', {}, 'État'), h('dd', {}, d.error ?? STATUS[d.status]?.[1] ?? d.status))))));
    }

    function refreshDrawerValues() { /* les valeurs saisies restent celles de l'utilisateur ; rien à forcer ici */ }

    const offDrawer = store.on('drawer:closed', () => { drawerFor = null; drawerRefs = null; });
    const offDevices = store.on('devices', renderDevices);
    const offProfiles = store.on('profiles', syncHeader);
    const offPreview = store.on('preview', drawStrips);
    const offEngine = store.on('engine', renderDevices);
    syncHeader();
    renderDevices();

    return () => { offDevices(); offProfiles(); offPreview(); offEngine(); offDrawer(); };
  },
};
