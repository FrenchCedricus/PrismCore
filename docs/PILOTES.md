# Écrire un pilote PrismCore

Un pilote est un module JavaScript (ES module) placé dans `drivers/`. Il est indexé automatiquement au lancement : l'index est invalidé dès qu'un fichier change. Exemples complets : `drivers/steelseries-apex-9-mini.js` et `drivers/hyperx-duocast.js`.

## Squelette

```js
export function Name() { return 'Mon appareil'; }
export function VendorId() { return 0x1234; }
export function ProductId() { return [0x5678, 0x5679]; }   // un nombre ou une liste
export function DeviceType() { return 'keyboard'; }          // keyboard, mouse, motherboard, microphone, lightingcontroller…
export function Size() { return [10, 2]; }                   // grille de LED [largeur, hauteur]
export function LedNames() { return ['A', 'B']; }
export function LedPositions() { return [[0, 0], [9, 1]]; }  // position de chaque LED dans la grille

// Paramètres affichés dans l'interface ; chaque "property" devient une variable globale du pilote.
export function ControllableParameters() {
  return [{ property: 'shutdownColor', label: "Couleur à l'arrêt", type: 'color', default: '#000000' }];
}

// Choisit l'interface HID à ouvrir (appelé pour chaque interface de l'appareil).
export function Validate(endpoint) {          // { interface, usage, usage_page, collection }
  return endpoint.interface === 1;
}

export function Initialize() {                // une fois, à la connexion
  device.setControllableLeds(LedNames(), LedPositions());
}

export function Render() {                    // à chaque image (30 FPS par défaut)
  const packet = [0x00, 0x01];
  for (const [x, y] of LedPositions()) packet.push(...device.color(x, y));
  device.send_report(packet, 65);             // ou device.write(packet, 65)
}

export function Shutdown(systemSuspending) {  // arrêt de PrismCore ou mise en veille
  /* appliquer shutdownColor */
}
```

## API disponible

L'API complète est décrite dans [API_HOTE.md](API_HOTE.md). Les appels les plus utiles :

| Appel | Rôle |
|---|---|
| `device.color(x, y)` | couleur `[r, g, b]` de l'effet à la position de la LED (tient compte du canvas et de la luminosité) |
| `device.write(data, len)` / `device.read(data, len, timeout?)` | reports d'entrée et de sortie |
| `device.send_report(data, len)` / `device.get_report(data, len)` | feature reports |
| `device.set_endpoint(interface, usage, usagePage)` | changer d'interface HID en cours de route |
| `device.pause(ms)` | pause synchrone (le pilote a son propre fil, sans effet sur les autres appareils) |
| `device.addChannel(nom, max)` + `device.channel(nom).getColors('Inline', 'GRB')` | bandes ARGB, dont le nombre de LED est réglé dans l'interface |
| `device.createSubdevice(id)` + `device.subdeviceColor(id, x, y)` | zones positionnables séparément sur le canvas |
| `device.log(msg)` / `device.notify(titre, texte)` | journal et message affiché dans les détails de l'appareil |
| `battery.setBatteryLevel(%)` | niveau de batterie affiché sur le tableau de bord |

## Mettre au point

1. `node index.js scan --verbose` liste les interfaces HID (interface, usage, page) pour écrire `Validate`.
2. `node index.js test --only "Mon appareil"` exécute le pilote **sans rien envoyer** et affiche les paquets produits.
3. `node index.js run --only "Mon appareil" --effect solid --color "#ff0000" --duration 5` teste sur le matériel.
4. Dans l'application, la page **Journal** avec « Détails » activé montre les `device.log`.

## Découvrir un protocole

Pour un appareil sans documentation : capture les échanges USB du logiciel du fabricant avec Wireshark et USBPcap, en changeant une couleur à la fois. Repère la trame qui varie (souvent un en-tête fixe suivi de triplets RGB), puis reproduis-la avec `node index.js test`.
