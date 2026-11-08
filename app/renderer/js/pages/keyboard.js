// Clavier : chaque touche visible et colorable une à une, préréglages par jeu, et jeux associés au profil.
// Les couleurs sont enregistrées dans le profil actif (keyLayer). Les touches sans couleur suivent l'effet
// (complet, atténué ou éteint, au choix).

import { h, icon, attempt, modal, throttle, toggle, toast } from '../ui.js';
import { GAME_PRESETS, presetKeys, keyLabel, canonicalKey } from '../gamePresets.js';

const SWATCHES = ['#ff2d55', '#ff9f0a', '#ffd60a', '#30d158', '#64d2ff', '#0a84ff', '#bf5af2', '#ffffff'];
const emptyLayer = () => ({ base: 'dim', dim: 0.2, keys: {} });
const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } };

/** Colonnes occupées par chaque touche : les cases vides vont à la touche suivante, la barre d'espace prend les deux côtés. */
function spans(item) {
  const [gw] = item.size;
  const rows = new Map();
  item.leds.forEach(([x, y], i) => { if (!rows.has(y)) rows.set(y, []); rows.get(y).push({ i, x }); });
  const out = new Map();
  for (const row of rows.values()) {
    row.sort((a, b) => a.x - b.x);
    const sp = row.map((k) => ({ ...k, from: k.x, to: k.x }));
    sp.forEach((k, j) => {
      if (/^(espace|space|spacebar)$/.test(canonicalKey(item.names?.[k.i]))) {
        const prev = sp[j - 1], next = sp[j + 1];
        k.from = prev ? prev.x + 1 : 0;
        k.to = next ? next.x - 1 : gw - 1;
      }
    });
    sp.forEach((k, j) => {
      const prev = sp[j - 1];
      const start = prev ? prev.to + 1 : 0;
      if (start < k.from) k.from = start;
    });
    for (const k of sp) out.set(k.i, [k.from, k.to]);
  }
  return out;
}

export default {
  id: 'keyboard',
  title: 'Clavier',
  icon: 'keyboard',
  mount(root, { api, store }) {
    let items = [];
    let selectedKey = lsGet('prism.kb.item', null);
    let layer = structuredClone(store.state.profiles.active.keyLayer ?? emptyLayer());
    let color = lsGet('prism.kb.color', '#ff2d55');
    let tool = 'paint';
    let layout = lsGet('prism.kb.layout', 'azerty');
    let painting = null; // 'paint' | 'erase' pendant un glisser
    let keyEls = [];

    const board = h('div', { class: 'kb-board' });
    const hoverInfo = h('div', { class: 'field-help kb-hover' }, 'Clique ou glisse sur les touches pour les colorer. Clic droit : effacer.');
    const itemTabs = h('div', { class: 'kb-tabs' });
    const toolsBar = h('div', { class: 'kb-tools' });
    const baseCard = h('div', { class: 'card' });
    const gamesCard = h('div', { class: 'card', style: { marginTop: '14px' } });
    const presetSelect = h('select', {}, h('option', { value: '' }, 'Préréglage de jeu…'), GAME_PRESETS.map((p) => h('option', { value: p.id }, p.name)));

    root.append(
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', {}, 'Clavier'), h('p', {}, 'Colore chaque touche à la main ou pars d\'un préréglage de jeu. Les couleurs sont enregistrées dans le profil actif.')),
        h('div', { class: 'page-actions' },
          presetSelect,
          h('button', { class: 'btn primary', onclick: applyPreset }, icon('wand', 16), 'Appliquer'),
          h('button', { class: 'btn ghost', onclick: clearItem }, icon('trash', 16), 'Tout effacer'))),
      h('div', { class: 'kb-layout' },
        h('div', { class: 'card' }, itemTabs, board, hoverInfo, toolsBar),
        h('div', {}, baseCard, gamesCard)),
    );

    // ---------------------------------------------------------------- enregistrement

    const sendLayer = throttle(() => api.keys.set(layer).catch((e) => toast(e.message, 'error')), 60);
    const pushLayer = () => { store.state.profiles.active.keyLayer = structuredClone(layer); sendLayer(); };
    const currentItem = () => items.find((i) => i.key === selectedKey);

    function setKey(pos, hex) {
      const k = selectedKey;
      layer.keys[k] = layer.keys[k] ?? {};
      if (hex) layer.keys[k][pos] = hex; else delete layer.keys[k][pos];
      if (Object.keys(layer.keys[k]).length === 0) delete layer.keys[k];
      markOverrides();
      pushLayer();
    }

    // ---------------------------------------------------------------- appareils

    function sync() {
      const next = (store.state.devices?.devices ?? []).flatMap((d) => d.items
        .filter((it) => it.kind !== 'channel')
        .map((it) => ({ ...it, deviceType: d.deviceType })));
      const changed = next.length !== items.length || next.some((it, i) => it.key !== items[i]?.key || it.leds.length !== items[i]?.leds.length);
      items = next;
      if (!items.some((i) => i.key === selectedKey)) {
        selectedKey = (items.find((i) => i.deviceType === 'keyboard' && i.names?.length) ?? items[0])?.key ?? null;
      }
      if (changed) renderAll();
    }

    function renderAll() {
      renderTabs();
      renderBoard();
      renderTools();
      renderBase();
      renderGames();
    }

    function renderTabs() {
      itemTabs.replaceChildren(...(items.length > 1 ? items.map((it) => h('button', {
        class: `btn sm ${it.key === selectedKey ? 'primary' : ''}`,
        onclick: () => { selectedKey = it.key; lsSet('prism.kb.item', it.key); renderAll(); },
      }, it.label)) : []));
    }

    function renderBoard() {
      const it = currentItem();
      keyEls = [];
      if (!it) {
        board.replaceChildren(h('div', { class: 'empty' }, 'Aucun appareil à touches détecté. Branche ton clavier, puis patiente quelques secondes.'));
        board.style.gridTemplateColumns = '';
        return;
      }
      const [gw, gh] = it.size;
      board.style.gridTemplateColumns = `repeat(${gw}, minmax(0, 1fr))`;
      board.style.gridTemplateRows = `repeat(${gh}, auto)`;
      const sp = spans(it);
      board.replaceChildren(...it.leds.map(([x, y], i) => {
        const [from, to] = sp.get(i) ?? [x, x];
        const name = it.names?.[i] ?? `LED ${i + 1}`;
        const el = h('button', {
          class: 'kb-key', title: name,
          style: { gridColumn: `${from + 1} / ${to + 2}`, gridRow: `${y + 1}` },
        }, h('span', {}, it.names?.length ? keyLabel(name, layout) : String(i + 1)));
        el.dataset.pos = `${x},${y}`;
        el.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          painting = e.button === 2 || tool === 'erase' ? 'erase' : 'paint';
          paintAt(el);
        });
        el.addEventListener('pointerenter', () => {
          hoverInfo.textContent = describe(el, name);
          if (painting) paintAt(el);
        });
        el.addEventListener('contextmenu', (e) => e.preventDefault());
        keyEls[i] = el;
        return el;
      }));
      markOverrides();
    }

    function describe(el, name) {
      const hex = layer.keys[selectedKey]?.[el.dataset.pos];
      return `${name}${hex ? ` · ${hex}` : ' · suit l\'effet'}`;
    }

    function paintAt(el) {
      if (painting === 'erase') setKey(el.dataset.pos, null);
      else setKey(el.dataset.pos, color);
    }

    function markOverrides() {
      const map = layer.keys[selectedKey] ?? {};
      for (const el of keyEls) el?.classList.toggle('custom', !!map[el.dataset.pos]);
    }

    const stopPaint = () => { painting = null; };
    window.addEventListener('pointerup', stopPaint);

    function renderTools() {
      const picker = h('input', { type: 'color', value: color, oninput: (e) => setColor(e.target.value) });
      const sw = SWATCHES.map((c) => h('button', { class: `kb-swatch ${c === color ? 'active' : ''}`, style: { background: c }, title: c, onclick: () => setColor(c) }));
      const toolBtn = (id, label) => h('button', { class: `btn sm ${tool === id ? 'primary' : ''}`, onclick: () => { tool = id; renderTools(); } }, label);
      const layoutSel = h('select', { onchange: (e) => { layout = e.target.value; lsSet('prism.kb.layout', layout); renderBoard(); } },
        h('option', { value: 'azerty', selected: layout === 'azerty' }, 'AZERTY'),
        h('option', { value: 'qwerty', selected: layout === 'qwerty' }, 'QWERTY'));
      toolsBar.replaceChildren(
        h('div', { class: 'kb-tool-group' }, toolBtn('paint', 'Pinceau'), toolBtn('erase', 'Gomme')),
        h('div', { class: 'kb-tool-group' }, picker, ...sw),
        h('label', { class: 'kb-tool-group faint' }, 'Libellés', layoutSel));
    }

    function setColor(c) {
      color = c;
      lsSet('prism.kb.color', c);
      if (tool === 'erase') tool = 'paint';
      renderTools();
    }

    // ---------------------------------------------------------------- touches non colorées

    function renderBase() {
      const radio = (value, label, help) => h('label', { class: `kb-radio ${layer.base === value ? 'active' : ''}` },
        h('input', { type: 'radio', name: 'kb-base', checked: layer.base === value, onchange: () => { layer.base = value; pushLayer(); renderBase(); } }),
        h('div', {}, h('div', {}, label), h('div', { class: 'field-help' }, help)));
      const pct = h('span', { class: 'val' }, `${Math.round((layer.dim ?? 0.2) * 100)} %`);
      baseCard.replaceChildren(
        h('div', { class: 'card-title' }, h('h3', {}, 'Touches sans couleur')),
        radio('effect', 'Effet complet', 'L\'effet actif reste visible derrière.'),
        radio('dim', 'Effet atténué', 'Les touches colorées ressortent mieux.'),
        radio('black', 'Éteintes', 'Seules les touches colorées s\'allument.'),
        layer.base === 'dim' ? h('div', { class: 'field', style: { marginTop: '10px' } },
          h('div', { class: 'field-label' }, h('span', {}, 'Intensité de l\'effet'), pct),
          h('input', { type: 'range', min: 0, max: 0.8, step: 0.05, value: layer.dim ?? 0.2, oninput: (e) => { layer.dim = Number(e.target.value); pct.textContent = `${Math.round(layer.dim * 100)} %`; pushLayer(); } })) : '',
        h('div', { class: 'field-help' }, 'Ce réglage ne concerne que les appareils qui ont au moins une touche colorée.'));
    }

    // ---------------------------------------------------------------- jeux associés

    let processes = [];
    async function loadProcesses() {
      processes = (await attempt(() => api.system.processes())) ?? [];
      renderGames();
    }

    function renderGames() {
      const prof = store.state.profiles.active;
      const games = prof.games ?? [];
      const listId = 'kb-procs';
      const input = h('input', { type: 'text', placeholder: 'ex. League of Legends.exe', list: listId });
      const add = () => {
        let v = input.value.trim();
        if (!v) return;
        if (!/\.exe$/i.test(v)) v += '.exe';
        attempt(() => api.profiles.games(prof.id, [...games, v]));
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
      gamesCard.replaceChildren(
        h('div', { class: 'card-title' }, h('h3', {}, 'Jeux associés'),
          toggle(store.state.settings.gameDetection !== false, (on) => attempt(() => api.settings.set({ gameDetection: on })))),
        h('div', { class: 'field-help', style: { marginBottom: '10px' } },
          `Quand un de ces programmes tourne, le profil « ${prof.name} » s'active tout seul. PrismCore revient au profil précédent quand le jeu se ferme.`),
        h('div', { class: 'kb-chips' }, games.length
          ? games.map((g) => h('span', { class: 'badge accent kb-chip' }, g,
            h('button', { class: 'kb-chip-x', title: 'Retirer', onclick: () => attempt(() => api.profiles.games(prof.id, games.filter((x) => x !== g))) }, '×')))
          : h('span', { class: 'faint' }, 'Aucun jeu associé à ce profil.')),
        h('div', { class: 'kb-add' }, input, h('button', { class: 'btn sm', onclick: add }, icon('plus', 14), 'Ajouter')),
        h('datalist', { id: listId }, processes.map((p) => h('option', { value: p }))),
        h('button', { class: 'btn ghost sm', style: { marginTop: '6px' }, onclick: loadProcesses }, icon('refresh', 14), 'Lister les programmes ouverts'),
        store.state.game ? h('div', { class: 'badge ok', style: { marginTop: '10px', display: 'inline-block' } }, `En jeu : ${store.state.game.exe}`) : '',
      );
    }

    // ---------------------------------------------------------------- actions

    async function applyPreset() {
      const preset = GAME_PRESETS.find((p) => p.id === presetSelect.value);
      const it = currentItem();
      if (!preset) { toast('Choisis d\'abord un jeu dans la liste.', 'info'); return; }
      if (!it?.names?.length) { toast('Ce pilote ne donne pas le nom de ses touches : colore-les à la main.', 'error', 5000); return; }
      const { keys, missing } = presetKeys(preset, it);
      const prof = store.state.profiles.active;
      const inPlace = prof.name === preset.name;
      const ok = await modal({
        title: inPlace ? `Réappliquer « ${preset.name} » ?` : `Créer le profil « ${preset.name} » ?`,
        message: inPlace
          ? 'Les couleurs de ce clavier seront remplacées par celles du préréglage.'
          : `Un nouveau profil est créé à partir du profil actuel, avec les couleurs du jeu. Il s'activera tout seul quand ${preset.games[0]} sera lancé.`,
        confirm: inPlace ? 'Remplacer' : 'Créer',
      });
      if (!ok) return;
      let target = prof;
      if (!inPlace) target = await attempt(() => api.profiles.create(preset.name, true));
      if (!target) return;
      layer = { base: 'dim', dim: 0.15, keys: { ...(inPlace ? layer.keys : structuredClone(target.keyLayer?.keys ?? {})), [it.key]: keys } };
      store.state.profiles.active.keyLayer = structuredClone(layer);
      await attempt(() => api.keys.set(layer));
      if (!(target.games?.length)) await attempt(() => api.profiles.games(target.id, preset.games));
      toast(missing.length ? `Préréglage appliqué. Touches absentes de ce clavier : ${missing.join(', ')}` : `Préréglage « ${preset.name} » appliqué`, 'ok', 4500);
      presetSelect.value = '';
      renderAll();
    }

    async function clearItem() {
      if (!layer.keys[selectedKey]) return;
      if (!(await modal({ title: 'Effacer toutes les couleurs ?', message: 'Les touches de cet appareil suivront à nouveau l\'effet.', confirm: 'Effacer', danger: true }))) return;
      delete layer.keys[selectedKey];
      markOverrides();
      store.state.profiles.active.keyLayer = structuredClone(layer);
      await attempt(() => api.keys.set(layer));
    }

    // ---------------------------------------------------------------- aperçu en direct

    function drawPreview(p) {
      const colors = p?.leds?.[selectedKey];
      if (!colors) return;
      keyEls.forEach((el, i) => {
        if (!el) return;
        const r = colors[i * 3], g = colors[i * 3 + 1], b = colors[i * 3 + 2];
        el.style.setProperty('--led', `rgb(${r},${g},${b})`);
        el.classList.toggle('light', r * 0.299 + g * 0.587 + b * 0.114 > 150);
      });
    }

    const offs = [
      store.on('devices', sync),
      store.on('preview', drawPreview),
      store.on('profiles', (pp) => {
        if (!painting) { layer = structuredClone(pp.active.keyLayer ?? emptyLayer()); markOverrides(); renderBase(); }
        renderGames();
      }),
      store.on('settings', renderGames),
      store.on('game', renderGames),
    ];
    sync();
    renderAll();
    loadProcesses();
    return () => { offs.forEach((f) => f()); window.removeEventListener('pointerup', stopPaint); };
  },
};
