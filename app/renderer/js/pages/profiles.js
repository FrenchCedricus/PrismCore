// Profils : configurations d'éclairage complètes (effet + réglages, disposition, appareils), stockées localement.

import { h, icon, attempt, modal, timeAgo } from '../ui.js';

export default {
  id: 'profiles',
  title: 'Profils',
  icon: 'profiles',
  mount(root, { api, store }) {
    const grid = h('div', { class: 'grid profiles' });
    const effectName = (id) => store.state.effects.find((e) => e.id === id)?.name ?? id ?? '—';

    root.append(
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', {}, 'Profils'), h('p', {}, 'Chaque profil mémorise l\'effet et ses réglages, la disposition du canvas et les paramètres des appareils.')),
        h('div', { class: 'page-actions' },
          h('button', { class: 'btn', onclick: () => attempt(() => api.profiles.import(), null) }, icon('upload', 16), 'Importer'),
          h('button', {
            class: 'btn primary',
            onclick: async () => {
              const name = await modal({ title: 'Nouveau profil', message: 'Le profil part de la configuration actuelle.', input: 'Nouveau profil', confirm: 'Créer' });
              if (name) attempt(() => api.profiles.create(name, true), `Profil « ${name} » créé et activé`);
            },
          }, icon('plus', 16), 'Nouveau profil'))),
      grid,
    );

    function render() {
      const { list, active } = store.state.profiles;
      grid.replaceChildren(...list.map((p) => {
        const isActive = p.id === active.id;
        return h('div', { class: `card profile-card ${isActive ? 'active' : ''}` },
          h('div', { class: 'field-row' },
            h('h2', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, p.name),
            isActive ? h('span', { class: 'badge accent' }, 'Actif') : null),
          h('div', { class: 'muted' }, `Effet : ${effectName(p.effect)}`),
          p.keyCount ? h('div', { class: 'muted' }, `${p.keyCount} touche${p.keyCount > 1 ? 's' : ''} colorée${p.keyCount > 1 ? 's' : ''}`) : null,
          p.games?.length ? h('div', { class: 'kb-chips', style: { margin: 0 } }, p.games.map((g) => h('span', { class: 'badge accent' }, g))) : null,
          h('div', { class: 'faint', style: { fontSize: '12px' } }, `Modifié ${timeAgo(p.updatedAt)}`),
          h('div', { class: 'profile-actions' },
            isActive ? null : h('button', { class: 'btn sm primary', onclick: () => attempt(() => api.profiles.activate(p.id)) }, icon('check', 14), 'Activer'),
            h('button', {
              class: 'btn sm', title: 'Renommer',
              onclick: async () => { const n = await modal({ title: 'Renommer le profil', input: p.name, confirm: 'Renommer' }); if (n) attempt(() => api.profiles.rename(p.id, n)); },
            }, icon('edit', 14)),
            h('button', { class: 'btn sm', title: 'Dupliquer', onclick: () => attempt(() => api.profiles.duplicate(p.id), 'Profil dupliqué') }, icon('copy', 14)),
            h('button', { class: 'btn sm', title: 'Exporter', onclick: () => attempt(async () => { if (await api.profiles.export(p.id)) return true; return null; }) }, icon('download', 14)),
            h('button', {
              class: 'btn sm danger', title: 'Supprimer', disabled: list.length <= 1,
              onclick: async () => { if (await modal({ title: `Supprimer « ${p.name} » ?`, message: 'Cette action est définitive.', confirm: 'Supprimer', danger: true })) attempt(() => api.profiles.remove(p.id), 'Profil supprimé'); },
            }, icon('trash', 14))));
      }));
    }

    const off = store.on('profiles', render);
    render();
    return off;
  },
};
