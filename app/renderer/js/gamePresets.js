// Préréglages de touches par jeu, et correspondance des noms de touches.
//
// Les touches sont désignées par leur POSITION PHYSIQUE, avec le nom QWERTY qu'utilisent les pilotes
// (ex. « Q » = la touche à droite de Tab, qui s'appelle A sur un clavier AZERTY). Les jeux lisent eux aussi
// la position physique par défaut : un préréglage s'affiche donc juste sur un clavier AZERTY comme QWERTY.
// Les couleurs restent modifiables touche par touche si tu as changé tes raccourcis.

const C = {
  ability: '#ff9f0a',
  ultimate: '#ff2d55',
  summoner: '#ffd60a',
  items: '#30d158',
  move: '#0a84ff',
  moveAlt: '#64d2ff',
  weapon: '#ffd60a',
  combat: '#ff453a',
  heal: '#30d158',
  ui: '#bf5af2',
  shop: '#30d158',
  white: '#ffffff',
};

export const GAME_PRESETS = [
  {
    id: 'lol', name: 'League of Legends', games: ['League of Legends.exe'],
    groups: [
      { label: 'Sorts', color: C.ability, keys: ['Q', 'W', 'E'] },
      { label: 'Ultime', color: C.ultimate, keys: ['R'] },
      { label: 'Invocateurs', color: C.summoner, keys: ['D', 'F'] },
      { label: 'Objets', color: C.items, keys: ['1', '2', '3', '5', '6', '7'] },
      { label: 'Balise', color: C.moveAlt, keys: ['4'] },
      { label: 'Rappel', color: C.move, keys: ['B'] },
      { label: 'Interface', color: C.ui, keys: ['Tab', 'P', 'Y', 'Espace', 'Échap'] },
    ],
  },
  {
    id: 'apex', name: 'Apex Legends', games: ['r5apex.exe', 'r5apex_dx12.exe'],
    groups: [
      { label: 'Déplacements', color: C.move, keys: ['W', 'A', 'S', 'D'] },
      { label: 'Saut, sprint, accroupi', color: C.moveAlt, keys: ['Espace', 'Maj gauche', 'Ctrl gauche', 'C'] },
      { label: 'Tactique', color: C.ability, keys: ['Q'] },
      { label: 'Ultime', color: C.ultimate, keys: ['Z'] },
      { label: 'Armes', color: C.weapon, keys: ['1', '2', '3'] },
      { label: 'Combat', color: C.combat, keys: ['R', 'G', 'V'] },
      { label: 'Soins', color: C.heal, keys: ['4'] },
      { label: 'Interface', color: C.ui, keys: ['E', 'Tab', 'M', 'Échap'] },
    ],
  },
  {
    id: 'fortnite', name: 'Fortnite', games: ['FortniteClient-Win64-Shipping.exe'],
    groups: [
      { label: 'Déplacements', color: C.move, keys: ['W', 'A', 'S', 'D'] },
      { label: 'Saut, sprint, accroupi', color: C.moveAlt, keys: ['Espace', 'Maj gauche', 'Ctrl gauche'] },
      { label: 'Inventaire', color: C.weapon, keys: ['1', '2', '3', '4', '5', '6'] },
      { label: 'Combat', color: C.combat, keys: ['R'] },
      { label: 'Construction', color: C.ability, keys: ['Q', 'F', 'G'] },
      { label: 'Interface', color: C.ui, keys: ['E', 'Tab', 'M', 'Échap'] },
    ],
  },
  {
    id: 'valorant', name: 'Valorant', games: ['VALORANT-Win64-Shipping.exe'],
    groups: [
      { label: 'Déplacements', color: C.move, keys: ['W', 'A', 'S', 'D'] },
      { label: 'Saut, marche, accroupi', color: C.moveAlt, keys: ['Espace', 'Maj gauche', 'Ctrl gauche'] },
      { label: 'Capacités', color: C.ability, keys: ['C', 'Q', 'E'] },
      { label: 'Ultime', color: C.ultimate, keys: ['X'] },
      { label: 'Armes', color: C.weapon, keys: ['1', '2', '3'] },
      { label: 'Spike', color: C.combat, keys: ['4', 'R'] },
      { label: 'Achat', color: C.shop, keys: ['B'] },
      { label: 'Interface', color: C.ui, keys: ['Tab', 'M', 'Échap'] },
    ],
  },
  {
    id: 'cs2', name: 'Counter-Strike 2', games: ['cs2.exe'],
    groups: [
      { label: 'Déplacements', color: C.move, keys: ['W', 'A', 'S', 'D'] },
      { label: 'Saut, marche, accroupi', color: C.moveAlt, keys: ['Espace', 'Maj gauche', 'Ctrl gauche'] },
      { label: 'Armes', color: C.weapon, keys: ['1', '2', '3', '4', '5', 'Q'] },
      { label: 'Combat', color: C.combat, keys: ['R', 'G'] },
      { label: 'Utiliser', color: C.white, keys: ['E'] },
      { label: 'Achat', color: C.shop, keys: ['B'] },
      { label: 'Interface', color: C.ui, keys: ['Tab', 'Échap'] },
    ],
  },
];

// ------------------------------------------------------------------ noms de touches

const strip = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Variantes connues d'un même nom de touche (pilotes en français ou en anglais). */
const ALIASES = [
  ['espace', 'space', 'spacebar', 'space bar'],
  ['echap', 'esc', 'escape'],
  ['maj gauche', 'left shift', 'lshift', 'shift', 'l shift'],
  ['maj droite', 'right shift', 'rshift', 'r shift'],
  ['ctrl gauche', 'left ctrl', 'left control', 'lctrl', 'ctrl', 'l ctrl'],
  ['ctrl droite', 'right ctrl', 'right control', 'rctrl', 'r ctrl'],
  ['alt', 'left alt', 'lalt', 'l alt'],
  ['tab', 'tabulation'],
  ['entree', 'enter', 'return'],
  ['retour arriere', 'backspace'],
  ['verr. maj', 'caps lock', 'capslock', 'verr maj'],
];
const CANON = new Map();
for (const group of ALIASES) for (const n of group) CANON.set(n, group[0]);
export const canonicalKey = (name) => { const s = strip(name); return CANON.get(s) ?? s; };

/** Index des LED d'un élément par nom canonique. */
export function indexByName(item) {
  const map = new Map();
  (item.names ?? []).forEach((n, i) => { const k = canonicalKey(n); if (!map.has(k)) map.set(k, i); });
  return map;
}

/** Calque d'un préréglage pour un élément : { "x,y": "#hex" } et la liste des touches introuvables. */
export function presetKeys(preset, item) {
  const idx = indexByName(item);
  const out = {}, missing = [];
  for (const g of preset.groups) {
    for (const k of g.keys) {
      const i = idx.get(canonicalKey(k));
      if (i === undefined) { missing.push(k); continue; }
      const [x, y] = item.leds[i];
      out[`${x},${y}`] = g.color;
    }
  }
  return { keys: out, missing };
}

// ------------------------------------------------------------------ affichage (AZERTY / QWERTY)

const AZERTY = {
  q: 'A', w: 'Z', a: 'Q', z: 'W', m: ',', ';': 'M', ',': ';', '.': ':', '/': '!',
  '-': ')', '[': '^', ']': '$', "'": 'ù', '# (iso)': '*', '< (iso)': '<',
};
const SHORT = {
  'retour arriere': '⌫', 'verr. maj': 'Verr', 'maj gauche': 'Maj', 'maj droite': 'Maj',
  'ctrl gauche': 'Ctrl', 'ctrl droite': 'Ctrl', windows: 'Win', espace: 'Espace', entree: 'Entrée',
  echap: 'Échap', tab: 'Tab', menu: 'Menu', 'alt gr': 'Alt Gr', '# (iso)': '#', '< (iso)': '<',
};

/** Libellé court d'une touche pour le clavier dessiné, selon la disposition choisie. */
export function keyLabel(name, layout = 'azerty') {
  const c = canonicalKey(name);
  if (layout === 'azerty' && AZERTY[c]) return AZERTY[c];
  if (SHORT[c]) return SHORT[c];
  return String(name ?? '').length <= 3 ? String(name).toUpperCase() : String(name);
}
