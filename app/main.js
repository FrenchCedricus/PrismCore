// Processus principal Electron : fenêtres, zone de notification, stockage, capture locale,
// et routage IPC entre l'interface (renderer) et le moteur (processus séparé).

import { app, BrowserWindow, Tray, Menu, ipcMain, protocol, session, desktopCapturer, dialog, shell, powerMonitor } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EngineBridge } from './engineBridge.js';
import { Store } from './store.js';
import { createIcon } from './icon.js';
import { describeEffects, EFFECT_MAP, defaultParams } from '../src/effects.js';
import { detectPluginsDir } from '../src/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const START_HIDDEN = process.argv.includes('--hidden');

// ------------------------------------------------------------------ instance unique

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

app.setAppUserModelId('PrismCore');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required'); // analyse audio sans interaction
// Zéro trafic réseau : coupe les services d'arrière-plan de Chromium (mises à jour de composants,
// rapports de fiabilité, pings, préchargement DNS…). PrismCore n'a besoin d'aucune connexion.
for (const sw of ['disable-background-networking', 'disable-component-update', 'disable-domain-reliability', 'no-pings', 'disable-breakpad', 'dns-prefetch-disable', 'disable-sync']) {
  app.commandLine.appendSwitch(sw);
}
// Légèreté : pas de processus GPU séparé (~70 Mo). L'interface (quelques canvas 2D) se dessine très bien
// en logiciel, dans le processus principal.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('disable-features', ['SpareRendererForSitePerProcess', 'MediaRouter', 'OptimizationHints', 'Translate', 'AutofillServerCommunication', 'CertificateTransparencyComponentUpdater', ...(process.env.PRISM_DF ? process.env.PRISM_DF.split(',') : [])].join(','));
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let store;
let tray = null;
let mainWindow = null;
let captureWindow = null;
let captureConfig = null;
let captureMonitor = false;
let quitting = false;
const bridge = new EngineBridge();
const logs = [];
let lastDevices = { devices: [], unsupported: [], stats: { fps: 0, frameMs: 0 }, canvas: { width: 100, height: 60 } };
let engineStatus = { running: false, error: null };
let gameAuto = null; // { profileId, previousId, exe, dismissed } : profil activé par la détection de jeu
const icon = () => createIcon(32);

// ------------------------------------------------------------------ utilitaires

function send(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
}

function pushLog(entry) {
  logs.push(entry);
  if (logs.length > 1000) logs.splice(0, logs.length - 1000);
  send('log', entry);
}

function profilesPayload() {
  return { list: store.list(), active: store.active };
}

function broadcastProfiles() {
  send('profiles', profilesPayload());
  rebuildTrayMenu();
}

function setEngineStatus(patch) {
  engineStatus = { ...engineStatus, ...patch };
  send('engine:status', engineStatus);
}

// ------------------------------------------------------------------ protocole app:// (fichiers de l'interface)

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const ALLOWED = ['app/renderer/', 'app/capture/', 'src/effects.js', 'src/canvas.js', 'src/util.js'];

function registerProtocol() {
  protocol.handle('app', async (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '');
    if (rel.includes('..') || !ALLOWED.some((p) => rel === p || rel.startsWith(p))) return new Response('Interdit', { status: 403 });
    try {
      const body = await fs.promises.readFile(path.join(ROOT, rel));
      return new Response(body, { headers: { 'content-type': MIME[path.extname(rel)] ?? 'application/octet-stream' } });
    } catch {
      return new Response('Introuvable', { status: 404 });
    }
  });
}

// ------------------------------------------------------------------ moteur

async function startEngine() {
  setEngineStatus({ running: false, error: null });
  try {
    await bridge.start();
    const s = store.settings;
    // Pilotes intégrés toujours chargés ; dossier externe facultatif (choisi, sinon détecté).
    lastDevices = await bridge.call('init', { pluginsDir: s.pluginsDir, fps: s.fps, hotplugMs: s.hotplugSeconds * 1000, profile: store.active }, 180000);
    send('devices', lastDevices);
    setEngineStatus({ running: true, error: null });
    await bridge.call('setPreview', !!(mainWindow?.isVisible()));
    bridge.restarts = 0;
  } catch (e) {
    setEngineStatus({ running: false, error: e.message });
    pushLog({ level: 'error', msg: `Démarrage du moteur impossible : ${e.message}`, time: Date.now() });
  }
}

bridge.on('event', (event, data) => {
  if (event === 'devices') { lastDevices = data; send('devices', data); }
  else if (event === 'preview') send('preview', data);
  else if (event === 'log') pushLog(data);
});
bridge.on('crashed', () => { if (!quitting) startEngine(); });

/** Envoie au moteur sans faire échouer l'interface si le moteur redémarre. */
async function engine(method, params) {
  try { return await bridge.call(method, params); } catch (e) { pushLog({ level: 'warn', msg: `${method} : ${e.message}`, time: Date.now() }); return null; }
}

async function applyActiveProfile() {
  await engine('applyProfile', store.active);
  updateCapture();
  broadcastProfiles();
}

// ------------------------------------------------------------------ capture audio / écran (100 % locale)

function updateCapture() {
  const requires = EFFECT_MAP[store.active?.effect?.id]?.requires;
  const want = { audio: requires === 'audio' || captureMonitor, screen: requires === 'screen' || captureMonitor };
  if (!want.audio && !want.screen) {
    captureConfig = null;
    if (captureWindow && !captureWindow.isDestroyed()) captureWindow.destroy();
    captureWindow = null;
    send('capture:status', { audio: 'off', screen: 'off' });
    return;
  }
  const key = JSON.stringify(want);
  if (captureWindow && !captureWindow.isDestroyed() && captureConfig === key) return;
  captureConfig = key;
  if (!captureWindow || captureWindow.isDestroyed()) {
    captureWindow = new BrowserWindow({
      show: false,
      width: 320, height: 200,
      webPreferences: { preload: path.join(ROOT, 'app', 'capturePreload.cjs'), backgroundThrottling: false, contextIsolation: true, sandbox: true },
    });
    captureWindow.on('closed', () => { captureWindow = null; });
  }
  captureWindow.loadURL(`app://prism/app/capture/capture.html?audio=${want.audio ? 1 : 0}&screen=${want.screen ? 1 : 0}`);
}

let screenForward = 0;
ipcMain.on('capture:audio', (e, data) => {
  bridge.notify('audio', data);
  send('capture:audio', data);
});
ipcMain.on('capture:screen', (e, data) => {
  bridge.notify('screen', data);
  if (++screenForward % 3 === 0) send('capture:screen', data);
});
ipcMain.on('capture:status', (e, status) => {
  send('capture:status', status);
  if (status.error) pushLog({ level: 'warn', msg: `Capture : ${status.error}`, time: Date.now() });
});

// ------------------------------------------------------------------ fenêtres / zone de notification

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); return; }
  mainWindow = new BrowserWindow({
    width: 1360, height: 860, minWidth: 1040, minHeight: 680,
    backgroundColor: '#0b0d12',
    title: 'PrismCore',
    icon: icon(),
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0b0d12', symbolColor: '#9aa3b2', height: 40 },
    webPreferences: { preload: path.join(ROOT, 'app', 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  // Erreurs de l'interface → journal (visible dans la page Journal).
  mainWindow.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning') pushLog({ level: e.level === 'error' ? 'error' : 'warn', msg: `[interface] ${e.message} (${e.sourceId}:${e.lineNumber})`, time: Date.now() });
  });
  mainWindow.webContents.on('preload-error', (e, p, err) => pushLog({ level: 'error', msg: `[preload] ${err.message}`, time: Date.now() }));
  mainWindow.loadURL('app://prism/app/renderer/index.html');
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('show', () => bridge.notify('setPreview', true));
  mainWindow.on('hide', () => bridge.notify('setPreview', false));
  mainWindow.on('minimize', () => bridge.notify('setPreview', false));
  mainWindow.on('restore', () => bridge.notify('setPreview', true));
  // Fermer = la fenêtre est détruite (libère ~100 Mo) ; l'éclairage continue depuis la zone de notification.
  mainWindow.on('close', () => { bridge.notify('setPreview', false); });
  mainWindow.on('closed', () => { mainWindow = null; bridge.notify('setPreview', false); });
  // Liens externes : navigateur système, jamais dans l'application.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
}

function rebuildTrayMenu() {
  if (!tray) return;
  const active = store.active;
  const quickEffects = ['rainbow', 'solid', 'breathing', 'wave', 'plasma', 'audio-pulse', 'screen'];
  tray.setToolTip(`PrismCore — ${active?.name ?? ''}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ouvrir PrismCore', click: createMainWindow },
    { type: 'separator' },
    { label: 'Profils', submenu: store.list().map((p) => ({ label: p.name, type: 'radio', checked: p.id === active?.id, click: () => activateProfile(p.id) })) },
    { label: 'Effet', submenu: quickEffects.map((id) => ({ label: EFFECT_MAP[id].name, type: 'radio', checked: active?.effect?.id === id, click: () => setEffect(id) })) },
    { label: 'Luminosité', submenu: [1, 0.75, 0.5, 0.25, 0].map((b) => ({ label: b === 0 ? 'Éteint' : `${b * 100} %`, type: 'radio', checked: Math.abs((active?.brightness ?? 1) - b) < 0.01, click: () => setBrightness(b) })) },
    { type: 'separator' },
    { label: 'Quitter', click: () => app.quit() },
  ]));
}

function createTray() {
  tray = new Tray(icon());
  tray.on('double-click', createMainWindow);
  tray.on('click', createMainWindow);
  rebuildTrayMenu();
}

// ------------------------------------------------------------------ actions (partagées IPC / zone de notification)

async function setEffect(id, params) {
  if (!EFFECT_MAP[id]) throw new Error(`Effet inconnu : ${id}`);
  const p = store.update(store.active.id, (prof) => {
    prof.effectParams = prof.effectParams ?? {};
    if (prof.effect?.id) prof.effectParams[prof.effect.id] = prof.effect.params;
    const merged = { ...defaultParams(id), ...(prof.effectParams[id] ?? {}), ...(params ?? {}) };
    prof.effect = { id, params: merged };
  });
  await engine('setEffect', p.effect);
  updateCapture();
  broadcastProfiles();
  return p.effect;
}

async function setBrightness(b) {
  store.update(store.active.id, (p) => { p.brightness = Number(b); });
  await engine('setBrightness', Number(b));
  broadcastProfiles();
}

async function activateProfile(id, { auto = false } = {}) {
  // Changement manuel pendant une partie : on respecte le choix, sans rebasculer ni restaurer ensuite.
  if (!auto && gameAuto && id !== gameAuto.profileId) gameAuto.dismissed = true;
  store.flush();
  store.activate(id);
  await applyActiveProfile();
}

// ------------------------------------------------------------------ détection des jeux (100 % locale)

/** Noms des exécutables en cours (minuscules), via tasklist. */
function runningProcesses() {
  return new Promise((resolve) => {
    execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
      if (err) return resolve(new Set());
      const names = new Set();
      for (const line of out.split(/\r?\n/)) {
        const m = /^"([^"]+)"/.exec(line);
        if (m) names.add(m[1].toLowerCase());
      }
      resolve(names);
    });
  });
}

const gamePayload = () => (gameAuto && !gameAuto.dismissed ? { exe: gameAuto.exe, profileId: gameAuto.profileId, profileName: store.profiles.get(gameAuto.profileId)?.name ?? '' } : null);

let polling = false;
async function pollGames() {
  if (polling || !store.settings.gameDetection) return;
  const linked = [...store.profiles.values()].filter((p) => p.games?.length);
  if (!linked.length && !gameAuto) return;
  polling = true;
  try {
    const procs = await runningProcesses();
    let match = null, exe = null;
    for (const p of linked) {
      exe = p.games.find((g) => procs.has(g.toLowerCase()));
      if (exe) { match = p; break; }
    }
    if (match) {
      if (gameAuto?.profileId === match.id) return; // déjà géré (actif, ou écarté par l'utilisateur)
      if (store.active.id === match.id && !gameAuto) return; // déjà activé à la main
      const previousId = gameAuto?.previousId ?? store.active.id;
      gameAuto = { profileId: match.id, previousId, exe, dismissed: false };
      pushLog({ level: 'info', msg: `Jeu détecté (${exe}) : profil « ${match.name} » activé`, time: Date.now() });
      await activateProfile(match.id, { auto: true });
      send('game', gamePayload());
    } else if (gameAuto) {
      const { previousId, profileId, dismissed } = gameAuto;
      gameAuto = null;
      if (!dismissed && store.active.id === profileId && store.profiles.has(previousId)) {
        pushLog({ level: 'info', msg: `Jeu fermé : retour au profil « ${store.profiles.get(previousId).name} »`, time: Date.now() });
        await activateProfile(previousId, { auto: true });
      }
      send('game', null);
    }
  } catch (e) {
    pushLog({ level: 'warn', msg: `Détection des jeux : ${e.message}`, time: Date.now() });
  } finally {
    polling = false;
  }
}

/**
 * Démarrage avec Windows : entrée « Exécuter » de l'utilisateur (HKCU), celle qu'affiche le Gestionnaire
 * des tâches dans « Applications de démarrage » (et qu'on peut y désactiver). Lance l'appli réduite.
 */
function setLoginItem(enabled) {
  app.setLoginItemSettings({
    openAtLogin: !!enabled,
    name: 'PrismCore',
    path: process.execPath,
    args: app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden'],
  });
}

// ------------------------------------------------------------------ IPC

/** Valide un calque de touches venu de l'interface. */
function sanitizeKeyLayer(layer) {
  if (!layer || typeof layer !== 'object') return null;
  const keys = {};
  for (const [item, map] of Object.entries(layer.keys ?? {})) {
    if (!map || typeof map !== 'object') continue;
    const out = {};
    for (const [pos, hex] of Object.entries(map)) {
      if (/^\d{1,3},\d{1,3}$/.test(pos) && /^#[0-9a-f]{6}$/i.test(hex)) out[pos] = hex.toLowerCase();
    }
    if (Object.keys(out).length) keys[String(item).slice(0, 200)] = out;
  }
  const base = ['effect', 'dim', 'black'].includes(layer.base) ? layer.base : 'dim';
  const dim = Math.max(0, Math.min(1, Number(layer.dim ?? 0.2) || 0));
  return { base, dim, keys };
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (e, arg) => fn(arg, e));
}

function registerIpc() {
  handle('state:get', () => ({
    settings: store.settings,
    profiles: profilesPayload(),
    effects: describeEffects(),
    devices: lastDevices,
    logs: logs.slice(-400),
    engine: engineStatus,
    game: gamePayload(),
    dataDir: store.dir,
    version: app.getVersion(),
  }));

  handle('effect:set', ({ id, params }) => setEffect(id, params));
  handle('effect:params', async (params) => {
    const p = store.update(store.active.id, (prof) => { prof.effect.params = { ...prof.effect.params, ...params }; });
    await engine('setEffectParams', params);
    return p.effect;
  });
  handle('brightness:set', (b) => setBrightness(b));

  handle('layout:set', async (layout) => {
    store.update(store.active.id, (p) => { p.layout = layout; });
    await engine('setLayout', layout);
    return true;
  });
  handle('layout:preview', (layout) => { bridge.notify('setLayout', layout); return true; }); // pendant un glisser
  handle('layout:reset', async () => {
    store.update(store.active.id, (p) => { p.layout = {}; });
    await engine('setLayout', {});
    return engine('getDevices');
  });

  handle('keys:set', async (layer) => {
    const clean = sanitizeKeyLayer(layer);
    store.update(store.active.id, (p) => { p.keyLayer = clean; });
    await engine('setKeyLayer', clean);
    return true; // pas de diffusion des profils : l'interface garde sa copie pendant qu'on peint
  });

  handle('device:set', async ({ id, settings }) => {
    store.update(store.active.id, (p) => { p.devices = { ...p.devices, [id]: { ...(p.devices?.[id] ?? {}), ...settings } }; });
    return engine('setDevice', { id, settings });
  });
  handle('device:property', async ({ id, prop, value }) => {
    store.update(store.active.id, (p) => { p.properties = { ...p.properties, [id]: { ...(p.properties?.[id] ?? {}), [prop]: value } }; });
    return engine('setProperty', { id, prop, value });
  });
  handle('device:channel', async ({ id, name, count }) => {
    store.update(store.active.id, (p) => { p.channels = { ...p.channels, [id]: { ...(p.channels?.[id] ?? {}), [name]: Number(count) || 0 } }; });
    return engine('setChannel', { id, name, count });
  });

  handle('profile:create', async ({ name, fromCurrent = true }) => {
    const p = store.create(name || 'Nouveau profil', fromCurrent ? store.active.id : null);
    await activateProfile(p.id);
    return p;
  });
  handle('profile:activate', (id) => activateProfile(id));
  handle('profile:games', ({ id, games }) => {
    const clean = [...new Set((Array.isArray(games) ? games : []).map((g) => String(g).trim()).filter((g) => /^[^\\/:*?"<>|]{1,120}\.exe$/i.test(g)))].slice(0, 20);
    store.update(id, (p) => { p.games = clean; });
    broadcastProfiles();
    setTimeout(pollGames, 200);
    return clean;
  });
  handle('system:processes', async () => [...await runningProcesses()].sort());
  handle('profile:rename', ({ id, name }) => { store.rename(id, name); broadcastProfiles(); return true; });
  handle('profile:duplicate', (id) => { const src = store.profiles.get(id); store.create(`${src.name} (copie)`, id); broadcastProfiles(); return true; });
  handle('profile:delete', async (id) => {
    const wasActive = store.active.id === id;
    store.remove(id);
    if (wasActive) await applyActiveProfile(); else broadcastProfiles();
    return true;
  });
  handle('profile:export', async (id) => {
    const p = store.profiles.get(id);
    const r = await dialog.showSaveDialog(mainWindow, { title: 'Exporter le profil', defaultPath: `${p.name}.prismprofile.json`, filters: [{ name: 'Profil PrismCore', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return false;
    store.flush();
    store.exportProfile(id, r.filePath);
    return true;
  });
  handle('profile:import', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Importer un profil', filters: [{ name: 'Profil PrismCore', extensions: ['json'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return false;
    store.importProfile(r.filePaths[0]);
    broadcastProfiles();
    return true;
  });

  handle('settings:set', async (patch) => {
    const before = { ...store.settings };
    const s = store.setSettings(patch);
    if ('startWithWindows' in patch) setLoginItem(s.startWithWindows);
    if (patch.fps !== undefined && patch.fps !== before.fps) await engine('setFps', s.fps);
    if (patch.hotplugSeconds !== undefined) await engine('setHotplug', s.hotplugSeconds * 1000);
    if ('pluginsDir' in patch && patch.pluginsDir !== before.pluginsDir) { await bridge.stop(); startEngine(); }
    if ('captureSourceId' in patch && captureWindow) { captureConfig = null; updateCapture(); }
    if (patch.gameDetection === false && gameAuto) { gameAuto = null; send('game', null); }
    send('settings', s);
    return s;
  });

  handle('capture:sources', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 240, height: 135 } });
    return sources.map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }));
  });
  handle('capture:monitor', (on) => { captureMonitor = !!on; updateCapture(); return true; });

  handle('engine:rescan', () => engine('rescan'));
  handle('engine:reindex', () => engine('reindex'));
  handle('engine:restart', async () => { await bridge.stop(); await startEngine(); return true; });

  handle('app:openDataDir', () => shell.openPath(store.dir));
  handle('app:pickPluginsDir', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Dossier des plugins', properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('app:detectPluginsDir', () => detectPluginsDir());
  handle('logs:clear', () => { logs.length = 0; return true; });
}

// ------------------------------------------------------------------ outil de développement

/** PRISM_SCREENSHOTS=<dossier> : parcourt chaque page, enregistre une capture PNG, puis quitte. */
async function captureScreenshots(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  createMainWindow();
  await wait(3500);
  const wc = mainWindow.webContents;
  // Test de fumée du pont IPC : effet, profils, disposition, réglage d'appareil — puis remise en état.
  const smoke = await wc.executeJavaScript(`(async () => {
    const p = window.prism, out = {};
    const before = await p.getState();
    out.effect = (await p.effects.set('plasma', { speed: 2 })).id;
    out.params = (await p.effects.params({ scale: 9 })).params.scale;
    const created = await p.profiles.create('Test de fumée', true);
    const st = await p.getState();
    out.profileActive = st.profiles.active.name;
    out.profileInheritsEffect = st.profiles.active.effect.id;
    const dev = st.devices.devices[0];
    if (dev) {
      await p.devices.set(dev.id, { brightness: 0.5 });
      await p.layout.set({ [dev.items[0].key]: { x: 10, y: 10, w: 40, h: 15 } });
      const st2 = await p.getState();
      out.layoutApplied = JSON.stringify(st2.devices.devices[0]?.items[0]?.rect ?? null);
    }
    await p.profiles.activate(before.profiles.active.id);
    await p.profiles.remove(created.id);
    out.profilesAfter = (await p.getState()).profiles.list.length;
    await p.effects.set(before.profiles.active.effect.id, before.profiles.active.effect.params);
    return JSON.stringify(out);
  })()`).catch((e) => `ÉCHEC ${e.message}`);
  pushLog({ level: 'info', msg: `[test de fumée] ${smoke}`, time: Date.now() });
  wc.on('console-message', (e) => pushLog({ level: 'debug', msg: `[renderer] ${e.message}`, time: Date.now() }));
  for (const page of ['dashboard', 'effects', 'keyboard', 'canvas', 'profiles', 'capture', 'settings', 'logs']) {
    await wc.executeJavaScript(`document.querySelector('[data-page="${page}"]')?.click()`);
    if (page === 'capture') { await wc.executeJavaScript(`document.querySelector('.toggle input')?.click()`); await wait(4000); }
    await wait(1800);
    const img = await wc.capturePage();
    fs.writeFileSync(path.join(dir, `${page}.png`), img.toPNG());
  }
  fs.writeFileSync(path.join(dir, 'logs.txt'), logs.map((l) => `${l.level}\t${l.msg}`).join('\n'));
  app.quit();
}

// ------------------------------------------------------------------ cycle de vie

app.on('second-instance', () => createMainWindow());

app.whenReady().then(async () => {
  store = new Store(app.getPath('userData'));
  process.env.PRISM_CACHE_DIR = path.join(app.getPath('userData'), 'cache'); // hérité par le processus moteur

  // Version installée : démarrage avec Windows activé au premier lancement (désactivable dans
  // Paramètres ou dans le Gestionnaire des tâches). L'entrée est ensuite réécrite à chaque lancement
  // pour suivre l'emplacement de l'exe s'il a été déplacé ou mis à jour.
  if (app.isPackaged && !store.settings.startupConfigured) store.setSettings({ startWithWindows: true, startupConfigured: true });
  if (app.isPackaged || store.settings.startWithWindows) setLoginItem(store.settings.startWithWindows);

  // Garde-fou réseau : toute requête http(s)/ws(s) venant d'une page de l'application est refusée.
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, cb) => {
    pushLog({ level: 'warn', msg: `Requête réseau bloquée : ${details.url}`, time: Date.now() });
    cb({ cancel: true });
  });
  registerProtocol();
  registerIpc();

  // Capture d'écran + son système (loopback WASAPI) sans sélecteur : source choisie dans les paramètres.
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      const src = sources.find((s) => s.id === store.settings.captureSourceId) ?? sources[0];
      callback({ video: src, audio: 'loopback' });
    } catch {
      callback({});
    }
  });
  // Aucune permission web au-delà de la capture locale.
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(permission === 'media' || permission === 'display-capture'));

  createTray();
  if (!(START_HIDDEN || store.settings.startMinimized)) createMainWindow();
  await startEngine();
  updateCapture();
  setInterval(pollGames, 4000);
  pollGames();

  if (process.env.PRISM_SCREENSHOTS) captureScreenshots(process.env.PRISM_SCREENSHOTS);
  if (process.env.PRISM_DEBUG) {
    setTimeout(async () => {
      const { webContents } = await import('electron');
      console.log('[debug] webContents:', JSON.stringify(webContents.getAllWebContents().map((w) => ({ type: w.getType(), url: w.getURL() }))));
      console.log('[debug] metrics:', JSON.stringify(app.getAppMetrics().map((m) => ({ type: m.type, mo: Math.round(m.memory.workingSetSize / 1024), name: m.serviceName ?? '' }))));
    }, 8000);
  }

  powerMonitor.on('suspend', () => engine('suspend'));
  powerMonitor.on('resume', () => setTimeout(() => engine('resume'), 2000));
  powerMonitor.on('shutdown', (e) => { e.preventDefault(); app.quit(); });
});

app.on('window-all-closed', () => {
  // Reste actif dans la zone de notification, sauf si l'utilisateur a choisi de tout quitter à la fermeture.
  if (!store?.settings.minimizeToTray) app.quit();
});

app.on('before-quit', async (e) => {
  if (quitting) return;
  e.preventDefault();
  quitting = true;
  store?.flush();
  if (captureWindow && !captureWindow.isDestroyed()) captureWindow.destroy();
  await bridge.stop(); // le moteur applique la couleur d'arrêt de chaque appareil
  tray?.destroy();
  app.exit(0);
});
