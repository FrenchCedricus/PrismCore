// Pilote PrismCore — HyperX DuoCast (03F0:098C, interface de contrôle)
//
// Protocole (relevé par observation, voir docs/ANALYSE.md) :
//   interface HID 0, page vendeur 0xFF90
//   deux feature reports de 65 octets par image :
//     1. en-tête     : [0x00, 0x04, 0xF2, 0…]
//     2. couleurs    : [0x00, 0x81, R, G, B, 0x81, R, G, B, 0…]   (une entrée « 0x81 R G B » par zone)

export function Name() { return 'HyperX DuoCast'; }
export function Publisher() { return 'PrismCore'; }
export function VendorId() { return 0x03f0; }
export function ProductId() { return 0x098c; }
export function DeviceType() { return 'microphone'; }
export function Type() { return 'hid'; }
export function Size() { return [1, 2]; }

/* global shutdownColor:readonly, LightingMode:readonly, forcedColor:readonly */
export function ControllableParameters() {
  return [
    { property: 'shutdownColor', group: 'lighting', label: "Couleur à l'arrêt", type: 'color', default: '#000000' },
    { property: 'LightingMode', group: 'lighting', label: 'Source des couleurs', type: 'combobox', values: ['Canvas', 'Forced'], default: 'Canvas' },
    { property: 'forcedColor', group: 'lighting', label: 'Couleur forcée', type: 'color', default: '#009bde' },
  ];
}

const ZONES = [['Haut', 0, 0], ['Bas', 0, 1]];

export function LedNames() { return ZONES.map((z) => z[0]); }
export function LedPositions() { return ZONES.map((z) => [z[1], z[2]]); }

export function Validate(endpoint) {
  return endpoint.interface === 0 && endpoint.usage_page === 0xff90;
}

export function Initialize() {
  device.setName('HyperX DuoCast');
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
  device.send_report([0x00, 0x04, 0xf2], 65);
  const packet = [0x00];
  for (const [, x, y] of ZONES) {
    const [r, g, b] = fixed ?? device.color(x, y);
    packet.push(0x81, r, g, b);
  }
  device.send_report(packet, 65);
}
