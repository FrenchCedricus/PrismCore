// Journal : messages du moteur et des plugins, filtrables.

import { h, icon, toggle } from '../ui.js';

export default {
  id: 'logs',
  title: 'Journal',
  icon: 'logs',
  mount(root, { api, store }) {
    let showDebug = false;
    let filter = '';
    const box = h('div', { class: 'logs' });

    const line = (e) => h('div', { class: `log-line ${e.level}` },
      h('time', {}, new Date(e.time).toLocaleTimeString('fr-FR')),
      h('span', {}, e.msg));
    const visible = (e) => (showDebug || e.level !== 'debug') && (!filter || e.msg.toLowerCase().includes(filter));

    function render() {
      box.replaceChildren(...store.state.logs.filter(visible).slice(-500).map(line));
      box.scrollTop = box.scrollHeight;
    }

    root.append(
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', {}, 'Journal'), h('p', {}, 'Messages du moteur et des plugins.')),
        h('div', { class: 'page-actions' },
          h('input', { type: 'text', placeholder: 'Filtrer…', style: { width: '220px' }, oninput: (e) => { filter = e.target.value.toLowerCase(); render(); } }),
          h('label', { class: 'field-row', style: { gap: '8px' } }, h('span', { class: 'muted' }, 'Détails'), toggle(false, (on) => { showDebug = on; render(); })),
          h('button', { class: 'btn', onclick: async () => { await api.app.clearLogs(); store.state.logs.length = 0; render(); } }, icon('trash', 16), 'Vider'))),
      box,
    );

    const off = store.on('log', (e) => {
      if (!visible(e)) return;
      const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
      box.append(line(e));
      if (box.childElementCount > 600) box.firstElementChild.remove();
      if (atBottom) box.scrollTop = box.scrollHeight;
    });
    render();
    return off;
  },
};
