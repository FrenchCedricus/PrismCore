// Pilote PrismCore — MSI Mystic Light, contrôleur « 185 octets » (cartes mères MSI Z490 / B550 / Z590…)
//
// Pilote les LED intégrées, le header JRGB (12 V) et les deux headers ARGB JRAINBOW
// (ventilateurs, ventirad, bandes LED branchés sur la carte mère).
//
// Protocole (documentation publique de la communauté, ex. wiki OpenRGB « MSI Mystic Light ») :
//   1. Activation du mode « par LED » : feature report 0x52 de 185 octets décrivant chaque zone.
//      L'octet 184 (« save ») reste à 0 : rien n'est jamais écrit dans la mémoire flash de la carte.
//   2. À chaque image : feature report 0x53 de 725 octets = [0x53, 0x25, 0x06, 0x00, 0x00] + 240 × RGB,
//      dans l'ordre : LED intégrées, JPIPE1, JPIPE2, JRGB, JRAINBOW1 (40), JRAINBOW2 (40), JCORSAIR (120).
//
// Mode « synchronisé » : jusqu'à 40 LED par header JRAINBOW, une seule trame par image.

export function Name() { return 'MSI Mystic Light'; }
export function Publisher() { return 'PrismCore'; }
export function VendorId() { return 0x1462; }
export function DeviceType() { return 'motherboard'; }
export function Type() { return 'hid'; }

// Cartes dont la disposition est connue : PID → [LED intégrées, LED JPIPE1, LED JPIPE2, headers JRGB, nom].
const BOARDS = {
  0x7c75: [6, 0, 0, 1, 'MPG Z490 GAMING PLUS'],
  0x7c56: [6, 0, 0, 1, 'MPG B550 GAMING PLUS'],
  0x7c71: [6, 6, 0, 1, 'MEG Z490 ACE'],
  0x7c73: [6, 4, 0, 1, 'MPG Z490 GAMING CARBON WIFI'],
  0x7c79: [6, 0, 0, 2, 'MPG Z490 GAMING EDGE WIFI'],
  0x7c80: [6, 0, 0, 2, 'MAG Z490 TOMAHAWK'],
  0x7c81: [6, 0, 0, 2, 'MAG B460 TOMAHAWK'],
  0x7c90: [6, 4, 0, 1, 'MPG B550 GAMING CARBON WIFI'],
  0x7c91: [6, 0, 0, 2, 'MAG B550 TOMAHAWK'],
  0x7d08: [6, 0, 0, 2, 'MAG Z590 TOMAHAWK'],
  0x7d93: [6, 0, 0, 1, 'Z790 GAMING PRO WIFI'],
};
export function ProductId() { return Object.keys(BOARDS).map(Number); }

/* global shutdownColor:readonly, LightingMode:readonly, forcedColor:readonly */
export function ControllableParameters() {
  return [
    { property: 'shutdownColor', group: 'lighting', label: "Couleur à l'arrêt", description: 'Appliquée à la carte, aux ventilateurs et bandes quand PrismCore s\'arrête', type: 'color', default: '#000000' },
    { property: 'LightingMode', group: 'lighting', label: 'Source des couleurs', type: 'combobox', values: ['Canvas', 'Forced'], default: 'Canvas' },
    { property: 'forcedColor', group: 'lighting', label: 'Couleur forcée', type: 'color', default: '#009bde' },
  ];
}

const REPORT_CONFIG = 0x52;
const REPORT_PER_LED = 0x53;
const CONFIG_LEN = 185;
const PER_LED_LEN = 725;
const PER_LED_SLOTS = 240;
const SYNC_RAINBOW_LEDS = 40;
const SYNC_CORSAIR_LEDS = 120;
const CHANNELS = ['JRAINBOW 1', 'JRAINBOW 2'];

let layout = null; // { onboard, pipe1, pipe2, jrgb }

function boardLayout() {
  const [onboard, pipe1, pipe2, jrgb] = BOARDS[device.productId()] ?? [6, 0, 0, 1];
  return { onboard, pipe1, pipe2, jrgb };
}

function ledNames(l) {
  return [
    ...Array.from({ length: l.onboard }, (_, i) => `Carte mère ${i + 1}`),
    ...Array.from({ length: l.pipe1 }, (_, i) => `JPIPE1 ${i + 1}`),
    ...Array.from({ length: l.pipe2 }, (_, i) => `JPIPE2 ${i + 1}`),
    ...Array.from({ length: l.jrgb }, (_, i) => `JRGB ${i + 1} (12 V)`),
  ];
}

export function Size() { return [1, ledNames(layout ?? { onboard: 6, pipe1: 0, pipe2: 0, jrgb: 1 }).length]; }
export function LedNames() { return ledNames(layout ?? { onboard: 6, pipe1: 0, pipe2: 0, jrgb: 1 }); }
export function LedPositions() { return LedNames().map((_, i) => [0, i]); }

export function Validate(endpoint) {
  return endpoint.interface === 0 && endpoint.usage_page === 0x0001;
}

/** Zone standard de 10 octets : effet, couleur, vitesse/luminosité, couleur 2, drapeaux, réserve. */
function zone(buf, offset, { effect = 0x01, speedBrightness = 0x28, colorFlags = 0x80 } = {}) {
  buf[offset] = effect;
  buf[offset + 4] = speedBrightness;
  buf[offset + 8] = colorFlags;
}

/** Trame 0x52 qui bascule toutes les zones en mode « par LED synchronisé ». */
function perLedEnablePacket() {
  const b = new Array(CONFIG_LEN).fill(0);
  b[0] = REPORT_CONFIG;
  zone(b, 1, { speedBrightness: 0x08 });                      // JRGB 1
  zone(b, 11, { speedBrightness: 0x2a });                     // JPIPE 1
  zone(b, 21, { speedBrightness: 0x2a });                     // JPIPE 2
  zone(b, 31, { speedBrightness: 0x29 }); b[41] = SYNC_RAINBOW_LEDS;  // JRAINBOW 1 (+ nombre de LED)
  zone(b, 42, { speedBrightness: 0x29 }); b[52] = SYNC_RAINBOW_LEDS;  // JRAINBOW 2
  b[53] = 0x01; b[57] = 0x29; b[58] = 0x00; b[61] = 0x82; b[63] = SYNC_CORSAIR_LEDS; // JCORSAIR
  zone(b, 64);                                                 // JCORSAIR Outer LL120
  // LED intégrées : effet « direct » (0x25), synchronisation de toutes les zones sur la trame par LED.
  zone(b, 74, { effect: 0x25, speedBrightness: 0x29 | 0x80, colorFlags: 0x80 | 0x01 | 0x02 | 0x04 | 0x08 | 0x10 | 0x20 });
  for (let i = 1; i <= 9; i++) zone(b, 74 + i * 10);           // LED intégrées 1 à 9
  zone(b, 174, { speedBrightness: 0x2a });                    // JRGB 2
  b[184] = 0;                                                  // ne jamais sauvegarder en flash
  return b;
}

export function Initialize() {
  layout = boardLayout();
  const name = BOARDS[device.productId()]?.[4];
  device.setName(name ? `MSI ${name}` : 'MSI Mystic Light');
  device.setSize(Size());
  device.setControllableLeds(LedNames(), LedPositions());
  device.SetLedLimit(SYNC_RAINBOW_LEDS * CHANNELS.length);
  for (const ch of CHANNELS) device.addChannel(ch, SYNC_RAINBOW_LEDS);
  device.send_report(perLedEnablePacket(), CONFIG_LEN);
  device.pause(30);
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

/** Couleurs d'un header ARGB : par LED si leur nombre est réglé, sinon couleur moyenne sur les 40 positions. */
function channelColors(name, fixed) {
  if (fixed) return Array.from({ length: SYNC_RAINBOW_LEDS }, () => fixed);
  const ch = device.channel(name);
  const count = ch ? ch.LedCount() : 0;
  if (count > 0) {
    const flat = ch.getColors('Inline');
    return Array.from({ length: count }, (_, i) => [flat[i * 3], flat[i * 3 + 1], flat[i * 3 + 2]]);
  }
  const c = hex(device.getChannelPulseColor(name));
  return Array.from({ length: SYNC_RAINBOW_LEDS }, () => c);
}

function send(overrideColor) {
  const fixed = overrideColor ? hex(overrideColor) : LightingMode === 'Forced' ? hex(forcedColor) : null;
  const slots = new Array(PER_LED_SLOTS).fill(null);
  let i = 0;
  const total = layout.onboard + layout.pipe1 + layout.pipe2 + layout.jrgb;
  for (let led = 0; led < total; led++) slots[i++] = fixed ?? device.color(0, led);
  CHANNELS.forEach((name, n) => {
    const base = total + n * SYNC_RAINBOW_LEDS;
    channelColors(name, fixed).slice(0, SYNC_RAINBOW_LEDS).forEach((c, k) => { slots[base + k] = c; });
  });

  const packet = [REPORT_PER_LED, 0x25, 0x06, 0x00, 0x00];
  for (const c of slots) packet.push(...(c ?? [0, 0, 0]));
  device.send_report(packet, PER_LED_LEN);
}
