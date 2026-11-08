// Paramètres : démarrage avec Windows, comportement de la fenêtre, performances, plugins, confidentialité.

import { h, icon, toggle, attempt, debounce } from '../ui.js';

export default {
  id: 'settings',
  title: 'Paramètres',
  icon: 'settings',
  mount(root, { api, store }) {
    const s = store.state.settings;
    const set = (patch, msg) => attempt(() => api.settings.set(patch), msg);

    const row = (title, desc, control) => h('div', { class: 'setting' },
      h('div', {}, h('div', {}, title), desc ? h('div', { class: 'desc' }, desc) : null),
      h('div', { class: 'setting-control' }, control));

    const fpsVal = h('span', { class: 'mono', style: { width: '56px', textAlign: 'right' } }, `${s.fps} FPS`);
    const saveFps = debounce((v) => set({ fps: v }), 300);
    const fps = h('input', { type: 'range', min: 10, max: 60, step: 5, value: s.fps, style: { width: '200px' }, oninput: (e) => { fpsVal.textContent = `${e.target.value} FPS`; saveFps(Number(e.target.value)); } });

    const hotplug = h('select', { style: { width: '160px' }, onchange: (e) => set({ hotplugSeconds: Number(e.target.value) }) },
      [[0, 'Désactivée'], [2, 'Toutes les 2 s'], [5, 'Toutes les 5 s'], [15, 'Toutes les 15 s']].map(([v, l]) => h('option', { value: v, selected: v === s.hotplugSeconds }, l)));

    const pluginsInput = h('input', { type: 'text', value: s.pluginsDir ?? '', placeholder: 'Détection automatique', style: { width: '340px' } });
    const applyPlugins = () => set({ pluginsDir: pluginsInput.value.trim() || null }, 'Dossier enregistré, redémarrage du moteur');

    root.append(
      h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Paramètres'), h('p', {}, 'Tout est enregistré localement sur ce PC.'))),
      h('div', { class: 'settings' },
        h('div', { class: 'card' },
          h('h2', { style: { marginBottom: '6px' } }, 'Démarrage'),
          row('Lancer PrismCore au démarrage de Windows', "L'application démarre réduite dans la zone de notification et applique ton profil actif.",
            toggle(s.startWithWindows, (on) => set({ startWithWindows: on }, on ? 'Démarrage automatique activé' : 'Démarrage automatique désactivé'))),
          row('Démarrer réduit', 'Ne pas afficher la fenêtre au lancement.', toggle(s.startMinimized, (on) => set({ startMinimized: on }))),
          row('Garder actif à la fermeture', "Fermer la fenêtre la réduit dans la zone de notification ; l'éclairage continue.", toggle(s.minimizeToTray, (on) => set({ minimizeToTray: on })))),
        h('div', { class: 'card' },
          h('h2', { style: { marginBottom: '6px' } }, 'Performances'),
          row('Fréquence de rendu', 'Plus haut = animations plus fluides, mais davantage de trafic USB.', h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, fps, fpsVal)),
          row('Détection des appareils branchés à chaud', 'Fréquence de recherche de nouveaux périphériques.', hotplug)),
        h('div', { class: 'card' },
          h('h2', { style: { marginBottom: '6px' } }, 'Plugins d\'appareils'),
          row('Dossier des plugins', 'Plugins JavaScript chargés au lancement. Vide = détection automatique de l\'installation locale.',
            h('div', { style: { display: 'flex', gap: '6px' } },
              pluginsInput,
              h('button', { class: 'btn icon', title: 'Parcourir', onclick: async () => { const d = await api.app.pickPluginsDir(); if (d) { pluginsInput.value = d; applyPlugins(); } } }, icon('folder', 16)),
              h('button', { class: 'btn', onclick: applyPlugins }, 'Appliquer'))),
          row('Index des plugins', 'À relancer après une mise à jour des plugins.',
            h('div', { style: { display: 'flex', gap: '6px' } },
              h('button', { class: 'btn', onclick: () => attempt(async () => { const r = await api.engine.reindex(); return r; }, 'Index reconstruit') }, icon('refresh', 16), 'Réindexer'),
              h('button', { class: 'btn', onclick: () => attempt(() => api.engine.restart(), 'Moteur redémarré') }, icon('power', 16), 'Redémarrer le moteur')))),
        h('div', { class: 'card' },
          h('h2', { style: { marginBottom: '6px' } }, 'Données'),
          row('Dossier de données', store.state.dataDir, h('button', { class: 'btn', onclick: () => api.app.openDataDir() }, icon('folder', 16), 'Ouvrir'))),
        h('div', { class: 'card' },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' } }, icon('shield'), h('h2', {}, 'Confidentialité')),
          h('ul', { class: 'privacy' },
            h('li', {}, 'Aucune télémétrie, aucune statistique d\'usage, aucun compte.'),
            h('li', {}, 'Aucune requête réseau : les images distantes déclarées par les plugins sont ignorées.'),
            h('li', {}, 'Le son et l\'écran sont analysés en mémoire, sur cette machine, puis oubliés.'),
            h('li', {}, 'Profils et réglages : de simples fichiers JSON dans le dossier de données.')))),
    );
    return null;
  },
};
