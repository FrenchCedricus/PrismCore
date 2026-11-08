# API hôte attendue par les plugins

Inventaire construit en agrégeant tous les appels des 478 plugins (nombre d'occurrences entre parenthèses).
Colonne **PrismCore** : ✅ implémenté · ◐ simplifié · ✗ non pris en charge (stub sans effet).

## `device` — transport HID

| Méthode | Sémantique | PrismCore |
|---|---|---|
| `set_endpoint(interface, usage, usage_page, collection?)` (211) | Sélectionne l'interface HID cible | ✅ (`collection` = n° `&ColXX` du chemin Windows) |
| `getHidEndpoints()` (28) | Liste `{interface, usage, usage_page, collection}` | ✅ |
| `write(data, len)` (1159) | Report de sortie, complété à `len` octets (octet 0 = report ID) | ✅ |
| `read(data, len, timeout?)` (332) | Lit un report d'entrée, renvoie un tableau de `len` octets | ✅ (timeout par défaut : `readTimeoutMs`) |
| `send_report(data, len)` (808) | Feature report SET | ✅ |
| `get_report(data, len)` (105) | Feature report GET (`data[0]` = report ID) | ✅ |
| `input_report(data, len)` (3) | Lecture d'un report d'entrée | ◐ alias de `read` |
| `clearReadBuffer()` (134) | Vide la file de lecture | ✅ |
| `getLastReadSize()` (43) | Taille de la dernière lecture | ✅ |
| `pause(ms)` (936) | Pause **synchrone** | ✅ (`Atomics.wait`) |
| `bulk_transfer` / `control_transfer` (47) | USB brut (plugins `rawusb`) | ✗ |

## `device` — géométrie, couleurs

| Méthode | Sémantique | PrismCore |
|---|---|---|
| `color(x, y)` (405) | Couleur `[r,g,b]` du canvas d'effet à la position (x,y) de la grille `Size()` | ✅ |
| `createColorArray(hex, n, "Inline"\|"Separate", ordre?)` (237) | Tableau de `n` fois la même couleur | ✅ |
| `setName`, `setSize`, `setControllableLeds(noms, positions)`, `setImageFromUrl`, `setFrameRateTarget` | Métadonnées affichées par l'UI | ✅ (stockées) |
| `createSubdevice`, `setSubdeviceName/Size/Leds`, `subdeviceColor(id, x, y)`, `removeSubdevice` | Zones indépendantes (ex. zones d'une carte mère) | ✅ |
| `SetLedLimit`, `addChannel(nom, limite)`, `channel(nom)` → `{LedCount(), ledCount, getColors(format, ordre), shouldPulseColors()}`, `getChannelPulseColor` | Canaux ARGB (headers) dont le nombre de LED est configuré par l'utilisateur | ◐ nombre de LED lu dans `config.json` → `channels` |
| `addProperty(def)`, `getProperty`, `removeProperty`, `setUserProperty` | Paramètres ajoutés à l'exécution (DPI…) | ✅ (globale créée avec sa valeur par défaut) |
| `addFeature("battery")`, `notify(titre, texte, niveau)`, `log(msg, {toFile})` | Divers | ✅ |
| Ventilateurs (`createFanControl`, `setRPM`, `getNormalizedFanlevel`…), capteurs, LCD | | ✗ |

## Autres globales

| Globale | Méthodes | PrismCore |
|---|---|---|
| `battery` | `setBatteryLevel(%)`, `setBatteryState(n)` | ✅ (affichée) |
| `bus` (plugins SMBUS) | `ReadByte`, `WriteByte`, `WriteBlock`, `WriteWord`, `Vendor`, `Product`, `IsNvidiaBus`… | ✗ — nécessite un pilote noyau d'accès SMBus |
| `mouse` / `keyboard` | `sendEvent`, `sendHid`, `sendKey` (injection de touches pour macros) | ✗ (volontairement ignoré) |
| `<propriété>` | une globale par entrée de `ControllableParameters()` | ✅ (défaut, puis `config.json` → `properties`) |

## Modules `@SignalRGB/*`

| Module | Exports utilisés | PrismCore |
|---|---|---|
| `Errors` | `Assert.{fail,isOk,…,soft*}`, `ContextError`, `globalContext` | ✅ (`soft*` avertit sans interrompre) |
| `systeminfo` | `GetMotherboardInfo()` → `{model,…}`, `GetBiosInfo()`, `GetRamInfo()` | ✅ via WMI (`Win32_BaseBoard.Product` = `model`) |
| `permissions` | `permissions()` → `{ <partenaire>: { lighting, … } }`, `setCallback(cb)` | ✅ (tout accordé localement) |
| `DeviceDiscovery` | `foundVirtualDevice(info)` (appareils derrière un récepteur sans fil) | ◐ signalé, non piloté |
| `lcd` | `initialize`, `getFrame` | ✗ |
| `serial` | `availablePorts`, `connect`, `write`… | ✗ |
