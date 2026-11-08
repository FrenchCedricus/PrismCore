// Pilote PrismCore — SteelSeries Apex 9 Mini (1038:1620)
//
// Protocole (relevé par observation, voir docs/ANALYSE.md) :
//   interface HID 1, usage 0x0001 (page vendeur 0xFFC0)
//   un feature report de 513 octets par image :
//     [0x00, 0x40, nbTouches, (usageHID, R, G, B) × nbTouches, 0…]
//   Chaque touche est désignée par son code d'usage HID standard (table « Keyboard/Keypad », page 0x07).

export function Name() { return 'SteelSeries Apex 9 Mini'; }
export function Publisher() { return 'PrismCore'; }
export function VendorId() { return 0x1038; }
export function ProductId() { return 0x1620; }
export function DeviceType() { return 'keyboard'; }
export function Type() { return 'hid'; }
export function Size() { return [14, 5]; }
export function ConflictingProcesses() { return ['SteelSeriesGG.exe', 'SteelSeriesGGClient.exe', 'SteelSeriesEngine.exe']; }

/* global shutdownColor:readonly, LightingMode:readonly, forcedColor:readonly */
export function ControllableParameters() {
  return [
    { property: 'shutdownColor', group: 'lighting', label: "Couleur à l'arrêt", description: "Appliquée quand PrismCore s'arrête ou que le PC se met en veille", type: 'color', default: '#000000' },
    { property: 'LightingMode', group: 'lighting', label: 'Source des couleurs', description: "Canvas : l'effet actif. Forcée : une couleur fixe", type: 'combobox', values: ['Canvas', 'Forced'], default: 'Canvas' },
    { property: 'forcedColor', group: 'lighting', label: 'Couleur forcée', type: 'color', default: '#009bde' },
  ];
}

// [libellé, x, y, usage HID] — disposition 60 % avec les deux touches ISO.
const KEYS = [
  ['Échap', 0, 0, 0x29], ['1', 1, 0, 0x1e], ['2', 2, 0, 0x1f], ['3', 3, 0, 0x20], ['4', 4, 0, 0x21], ['5', 5, 0, 0x22], ['6', 6, 0, 0x23],
  ['7', 7, 0, 0x24], ['8', 8, 0, 0x25], ['9', 9, 0, 0x26], ['0', 10, 0, 0x27], ['-', 11, 0, 0x2d], ['=', 12, 0, 0x2e], ['Retour arrière', 13, 0, 0x2a],

  ['Tab', 0, 1, 0x2b], ['Q', 1, 1, 0x14], ['W', 2, 1, 0x1a], ['E', 3, 1, 0x08], ['R', 4, 1, 0x15], ['T', 5, 1, 0x17], ['Y', 6, 1, 0x1c],
  ['U', 7, 1, 0x18], ['I', 8, 1, 0x0c], ['O', 9, 1, 0x12], ['P', 10, 1, 0x13], ['[', 11, 1, 0x2f], [']', 12, 1, 0x30], ['\\', 13, 1, 0x31],

  ['Verr. Maj', 0, 2, 0x39], ['A', 1, 2, 0x04], ['S', 2, 2, 0x16], ['D', 3, 2, 0x07], ['F', 4, 2, 0x09], ['G', 5, 2, 0x0a], ['H', 6, 2, 0x0b],
  ['J', 7, 2, 0x0d], ['K', 8, 2, 0x0e], ['L', 9, 2, 0x0f], [';', 10, 2, 0x33], ["'", 11, 2, 0x34], ['# (ISO)', 12, 2, 0x32], ['Entrée', 13, 2, 0x28],

  ['Maj gauche', 0, 3, 0xe1], ['< (ISO)', 1, 3, 0x64], ['Z', 2, 3, 0x1d], ['X', 3, 3, 0x1b], ['C', 4, 3, 0x06], ['V', 5, 3, 0x19], ['B', 6, 3, 0x05],
  ['N', 7, 3, 0x11], ['M', 8, 3, 0x10], [',', 9, 3, 0x36], ['.', 10, 3, 0x37], ['/', 11, 3, 0x38], ['Maj droite', 13, 3, 0xe5],

  ['Ctrl gauche', 0, 4, 0xe0], ['Windows', 1, 4, 0xe3], ['Alt', 2, 4, 0xe2], ['Espace', 6, 4, 0x2c],
  ['Alt Gr', 10, 4, 0xe6], ['Fn', 11, 4, 0xe7], ['Menu', 12, 4, 0xf0], ['Ctrl droite', 13, 4, 0xe4],
];

export function LedNames() { return KEYS.map((k) => k[0]); }
export function LedPositions() { return KEYS.map((k) => [k[1], k[2]]); }

export function Validate(endpoint) {
  return endpoint.interface === 1 && endpoint.usage === 0x0001;
}

export function Initialize() {
  device.setName('SteelSeries Apex 9 Mini');
  device.setSize(Size());
  device.setControllableLeds(LedNames(), LedPositions());
}

export function Render() {
  send();
}

export function Shutdown(systemSuspending) {
  send(systemSuspending ? '#000000' : shutdownColor);
}

function hex(h) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h ?? '');
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}

function send(overrideColor) {
  const fixed = overrideColor ? hex(overrideColor) : LightingMode === 'Forced' ? hex(forcedColor) : null;
  const packet = [0x00, 0x40, KEYS.length];
  for (const [, x, y, usage] of KEYS) {
    const [r, g, b] = fixed ?? device.color(x, y);
    packet.push(usage, r, g, b);
  }
  device.send_report(packet, 513);
}
