# Analyse de l'application installée (rétro-ingénierie d'interopérabilité)

Cible : `%LOCALAPPDATA%\VortxEngine\app-2.5.86` — SignalRGB 2.5.86 (WhirlwindFX), installée via Squirrel.
Objectif : comprendre comment l'application communique avec les périphériques, pour les piloter avec un hôte indépendant.

## Ce qui a été observé

| Élément | Constat | Source |
|---|---|---|
| Lanceur | `SignalRgbLauncher.exe` (Qt 6 Widgets) + `Update.exe` (Squirrel) gèrent installation et mises à jour | VersionInfo PE, `SquirrelSetup.log` |
| Moteur | `Signal-x64\SignalRgb.exe` (~120 Mo), Qt 6 Quick/QML + QtWebEngine + Ultralight pour l'UI, FFmpeg/Tesseract pour la capture d'écran/jeux | inventaire des DLL |
| Pilotes d'appareils | **478 fichiers JavaScript** (modules ES) dans `Signal-x64\Plugins\<Marque>\` — un par famille d'appareil | inventaire, REA |
| Effets | `Signal-x64\Effects` (HTML/JS), rendus dans un canvas | inventaire |
| SMBus | plugins de `Type() === "SMBUS"` (RAM, GPU, certaines cartes mères) : accès bas niveau via le moteur natif | plugins |
| FTDI | `post\CDM21228_Setup` : pilote FTDI D2XX livré pour certains contrôleurs série | inventaire |

## Analyse REA du dossier Plugins

- Evidence parent : `ev_986ede0025bc856b2173e3415955c9565598ba7e891790c15065db0620b87d25`
  (vue résumé `ev_544571fec1c72a3cab27e489e4ed3d0b61bfb445df74bc9f2377917f5e50995b`)
- 480 fichiers JS analysés statiquement, **0 échec de parsing**, aucun code exécuté pendant l'analyse.
- Seules dépendances externes : les modules hôte `@SignalRGB/{Errors,systeminfo,permissions,DeviceDiscovery,lcd,serial}`.
- Le reste de l'API hôte est injecté sous forme de **globales** : `device`, `bus`, `battery`, `mouse`, `keyboard`
  et une globale par paramètre utilisateur (`LightingMode`, `forcedColor`, …).
- Limite : le graphe sémantique est partiel (plafond de nœuds atteint) ; l'inventaire de l'API (docs/API_HOTE.md)
  a donc été complété par une agrégation exhaustive par recherche textuelle de tous les appels `objet.méthode(`.

## Modèle d'un plugin

Chaque plugin exporte des fonctions que l'hôte appelle :

1. **Métadonnées** : `Name`, `VendorId`, `ProductId` (nombre ou liste), `Type` (`hid` par défaut, `rawusb`, `serial`, `SMBUS`, `hybrid`),
   `DeviceType`, `Size` → `[largeur, hauteur]` de la grille de LED, `LedNames`, `LedPositions`, `ControllableParameters`, `ConflictingProcesses`.
2. **Sélection d'interface** : `Validate(endpoint)` reçoit chaque interface HID `{interface, usage, usage_page, collection}` et renvoie `true` pour celle à ouvrir.
3. **Cycle de vie** : `Initialize()` → `Render()` à chaque image (~30-60 FPS) → `Shutdown(systemSuspending)`.
4. **Rendu** : dans `Render`, le plugin demande `device.color(x, y)` pour chaque LED (échantillonnage du canvas d'effet à sa position dans la grille),
   construit le paquet propriétaire du fabricant, puis l'envoie par `device.write` (report de sortie) ou `device.send_report` (feature report).
5. **Callbacks** : `on<propriété>Changed()` quand l'utilisateur modifie un paramètre.

## Protocoles de tes appareils (relevés en exécution à sec puis vérifiés sur le matériel)

| Appareil | VID:PID | Interface ouverte | Trame par image |
|---|---|---|---|
| SteelSeries Apex 9 Mini | 1038:1620 | if 1, usage 0x0001, page 0xFFC0 | 1 feature report de 513 o : `00 40 <nbTouches>` puis `<codeHID> R G B` × 63 |
| MSI Mystic Light (Z490 Gaming Plus) | 1462:7C75 | if 0 | feature report 185 o commençant par `52` (zones JRGB/JRainbow/onboard), + écriture `01 BA …` / lecture pour vérifier l'option EZ LED du BIOS |
| HyperX DuoCast | 03F0:098C | if 0, page 0xFF90 | 2 feature reports de 65 o : `00 04 F2 …` (en-tête) puis `00 81 R G B 81 R G B …` |
| Récepteur Logitech Lightspeed | 046D:C547 | if 2, page 0xFF00 | protocole HID++ 2.0 (`10 ff …` court 7 o, `11 ff …` long 20 o) ; détecte la G Pro X Superlight (sans RGB) et lit sa batterie |
