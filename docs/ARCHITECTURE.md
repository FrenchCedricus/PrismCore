# Architecture

## Processus

```
┌──────────────────────── Electron ────────────────────────┐
│ Renderer (interface)        Fenêtre de capture (invisible)│
│  window.prism.* ──invoke──┐   getDisplayMedia (loopback)  │
│  ◄──── événements ────┐   │   FFT 16 bandes · image 64×36 │
│                       │   │          │ ipc send           │
│        Processus principal (app/main.js)                  │
│   Store (profils JSON) · Tray · protocole app:// · IPC    │
└───────────────────────────┬──────────────────────────────┘
                            │ child_process.fork (sérialisation "advanced")
┌───────────── Processus moteur (src/daemon.js) ───────────┐
│ Engine : effet → canvas virtuel → SharedArrayBuffer 160×96│
│   │ hot-plug (node-hid), profil, chien de garde           │
│   ├── worker Apex 9 Mini  ── lit l'image ── HID ──► clavier│
│   ├── worker DuoCast      ── lit l'image ── HID ──► micro  │
│   └── worker …                                            │
└───────────────────────────────────────────────────────────┘
```

**Pourquoi un processus moteur séparé ?** Les pilotes appellent `device.pause()` et lisent le HID de façon synchrone. Exécutés dans le processus principal d'Electron, ils figeraient l'interface et la zone de notification. Si le moteur plante, `EngineBridge` le relance avec un délai croissant.

**Pourquoi un worker par appareil ?** Un appareil lent bloque son propre fil, et pas celui des autres. Exemple : une souris sans fil en veille, dont chaque lecture attend jusqu'à 200 ms. Le moteur publie l'image de l'effet dans une mémoire partagée, et chaque worker y échantillonne ses LED à son rythme. Sans battement de cœur pendant 15 s, le worker est terminé puis relancé.

**Cadence.** Sous Windows, `setTimeout(33)` attend environ 46 ms. `startTicker` (src/util.js) vise donc des échéances absolues, ce qui donne 30 FPS mesurés au lieu de 21.

## Canvas virtuel

- Surface de 100 × 60 unités. Chaque élément (appareil, sous-appareil, canal ARGB) y occupe un rectangle `{x, y, w, h}`.
- Une LED en position `(x, y)` dans une grille `Size() = [gw, gh]` est échantillonnée au point `rect.x + (x+0.5)/gw·rect.w`, `rect.y + (y+0.5)/gh·rect.h`.
- Les éléments sans position enregistrée sont placés automatiquement. Les positions personnalisées sont stockées dans le profil (`layout`).
- `effects.js` et `canvas.js` sont des modules purs, chargés aussi par l'interface pour animer les vignettes d'effets avec le même code.

## Pont IPC

### Interface → processus principal (`window.prism`, preload.cjs)

| Appel | Canal | Effet |
|---|---|---|
| `getState()` | `state:get` | réglages, profils, effets, appareils, journal |
| `effects.set(id, params?)` | `effect:set` | change d'effet (réglages mémorisés par effet et par profil) |
| `effects.params(patch)` | `effect:params` | ajuste l'effet actif |
| `effects.brightness(b)` | `brightness:set` | luminosité globale |
| `layout.set(layout)` / `preview` / `reset` | `layout:*` | disposition du canvas (`preview` sans enregistrer, pendant un glisser) |
| `devices.set(id, {enabled, brightness})` | `device:set` | réglages par appareil |
| `devices.property(id, prop, value)` | `device:property` | paramètre d'un pilote (appelle `on<prop>Changed`) |
| `devices.channel(id, name, count)` | `device:channel` | nombre de LED d'un canal ARGB |
| `profiles.create / activate / rename / duplicate / remove / export / import` | `profile:*` | gestion des profils |
| `settings.set(patch)` | `settings:set` | démarrage Windows, FPS, hot-plug, dossier de plugins, source de capture |
| `capture.sources()` / `capture.monitor(on)` | `capture:*` | écrans disponibles / test de capture |
| `engine.reindex()` / `engine.restart()` | `engine:*` | maintenance |

Événements poussés : `devices`, `preview` (image du canvas et couleurs de chaque LED, environ 15/s, seulement quand la fenêtre est visible), `log`, `profiles`, `settings`, `engine:status`, `capture:status`, `capture:audio`, `capture:screen`.

### Processus principal → moteur (src/daemon.js)

- Requête : `{ id, method, params }`, réponse `{ id, result }` ou `{ id, error }`.
- Notification sans réponse : `{ method, params }`. Sert au flux audio et écran (30 et 20/s) et à `setLayout` pendant un glisser.
- Événement : `{ event, data }`, parmi `ready`, `devices`, `preview`, `log`.

Méthodes : `init`, `applyProfile`, `setEffect`, `setEffectParams`, `setBrightness`, `setLayout`, `setDevice`, `setProperty`, `setChannel`, `setFps`, `setHotplug`, `setPreview`, `getDevices`, `rescan`, `reindex`, `suspend`, `resume`, `audio`, `screen`, `shutdown`.

### Moteur ↔ worker d'appareil (src/deviceWorker.js)

- Vers le worker : `settings`, `rects`, `property`, `channel`, `fps`, `suspend`, `testFrames`, `shutdown`.
- Depuis le worker : `attached` / `rejected` (résultat de `Validate`), `state` (état complet, une fois par seconde, sert aussi de battement de cœur), `log`, `packets` (mode test), `closed`.

## Cycle de vie

- **Démarrage** : le processus principal charge le profil actif et démarre le moteur. Le moteur calcule la première image, détecte les appareils et lance un worker par appareil reconnu.
- **Veille** (`powerMonitor`) : chaque pilote reçoit `Shutdown(true)`. Au réveil, les workers sont relancés, car les appareils ont pu perdre leur mode logiciel.
- **Quitter** : profils écrits sur disque, puis `Shutdown(false)` sur chaque appareil (couleur d'arrêt), puis fin des processus.

## Sécurité

- Interface : `contextIsolation`, `sandbox`, sans `nodeIntegration`. CSP stricte, navigation et nouvelles fenêtres bloquées. Fichiers servis par `app://` avec une liste blanche de chemins.
- Pilotes : exécutés dans un contexte V8 isolé (`vm`). Ils ne voient que l'API hôte, et `require` y est indisponible.
