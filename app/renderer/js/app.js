// Point d'entrée de l'interface : état partagé, abonnement aux événements du moteur, navigation.

import { h, icon, toast } from './ui.js';
import dashboard from './pages/dashboard.js';
import effects from './pages/effects.js';
import canvas from './pages/canvas.js';
import keyboard from './pages/keyboard.js';
import profiles from './pages/profiles.js';
import capture from './pages/capture.js';
import settings from './pages/settings.js';
import logs from './pages/logs.js';

const api = window.prism;
const PAGES = [dashboard, effects, keyboard, canvas, profiles, capture, settings, logs];

/** État partagé + bus d'événements minimal. */
export const store = {
  state: {},
  listeners: new Map(),
  on(evt, fn) {
    if (!this.listeners.has(evt)) this.listeners.set(evt, new Set());
    this.listeners.get(evt).add(fn);
    return () => this.listeners.get(evt).delete(fn);
  },
  emit(evt, data) {
    for (const fn of this.listeners.get(evt) ?? []) {
      try { fn(data); } catch (e) { console.error(e); }
    }
  },
  set(key, value) {
    this.state[key] = value;
    this.emit(key, value);
  },
};

export const ctx = { api, store };

// ------------------------------------------------------------------ barre de titre

function renderTitlebar() {
  const sel = document.getElementById('profileSelect');
  const { list, active } = store.state.profiles;
  sel.replaceChildren(...list.map((p) => h('option', { value: p.id, selected: p.id === active.id }, p.name)));
  sel.onchange = () => api.profiles.activate(sel.value).catch((e) => toast(e.message, 'error'));
}

function renderEngineStatus() {
  const el = document.getElementById('engineStatus');
  const eng = store.state.engine;
  const d = store.state.devices;
  if (eng?.error) { el.className = 'pill err no-drag'; el.textContent = 'Moteur arrêté'; el.title = eng.error; return; }
  if (!eng?.running) { el.className = 'pill warn no-drag'; el.textContent = 'Démarrage du moteur…'; el.title = ''; return; }
  const n = d?.devices?.filter((x) => x.status === 'ok').length ?? 0;
  el.className = 'pill ok no-drag';
  el.textContent = `${n} appareil${n > 1 ? 's' : ''} · ${d?.stats?.fps ?? 0} FPS`;
  el.title = `Temps de rendu moyen : ${d?.stats?.frameMs ?? 0} ms par image`;
}

// ------------------------------------------------------------------ navigation

let current = null;
let unmount = null;

function navigate(id) {
  const page = PAGES.find((p) => p.id === id) ?? PAGES[0];
  if (current === page.id) return;
  unmount?.();
  closeDrawer();
  current = page.id;
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.page === page.id));
  const view = document.getElementById('view');
  view.replaceChildren();
  view.scrollTop = 0;
  unmount = page.mount(view, ctx) ?? null;
  try { localStorage.setItem('prism.page', page.id); } catch { /* stockage indisponible */ }
}

function renderNav() {
  const nav = document.getElementById('nav');
  nav.replaceChildren(
    ...PAGES.map((p) => h('button', { class: 'nav-item', 'data-page': p.id, onclick: () => navigate(p.id) }, icon(p.icon), p.title)),
    h('div', { class: 'nav-spacer' }),
    h('div', { class: 'nav-footer' }, `PrismCore ${store.state.version}`, h('br'), 'Local · sans compte · sans télémétrie'),
  );
}

// ------------------------------------------------------------------ tiroir latéral (détails d'un appareil)

export function openDrawer(content) {
  const drawer = document.getElementById('drawer');
  drawer.replaceChildren(content);
  drawer.classList.add('open');
  document.getElementById('drawerBackdrop').classList.add('open');
}

export function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawerBackdrop').classList.remove('open');
  store.emit('drawer:closed');
}

// ------------------------------------------------------------------ démarrage

async function boot() {
  const s = await api.getState();
  Object.assign(store.state, s, { preview: null });

  api.on('devices', (d) => { store.set('devices', d); renderEngineStatus(); });
  api.on('preview', (p) => store.set('preview', p));
  api.on('log', (entry) => {
    store.state.logs.push(entry);
    if (store.state.logs.length > 1000) store.state.logs.splice(0, 200);
    store.emit('log', entry);
  });
  api.on('profiles', (p) => { store.set('profiles', p); renderTitlebar(); });
  api.on('settings', (st) => store.set('settings', st));
  api.on('engine:status', (st) => { store.set('engine', st); renderEngineStatus(); });
  api.on('capture:status', (st) => store.set('captureStatus', st));
  api.on('capture:audio', (a) => store.emit('capture:audio', a));
  api.on('capture:screen', (sc) => store.emit('capture:screen', sc));
  api.on('game', (g) => { store.set('game', g); if (g) toast(`Jeu détecté : profil « ${g.profileName} »`, 'ok'); });

  document.getElementById('drawerBackdrop').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  renderNav();
  renderTitlebar();
  renderEngineStatus();
  let start = 'dashboard';
  try { start = localStorage.getItem('prism.page') ?? start; } catch { /* stockage indisponible */ }
  navigate(start);
}

boot().catch((e) => {
  document.getElementById('view').append(h('div', { class: 'empty' }, `Erreur de démarrage de l'interface : ${e.message}`));
});
