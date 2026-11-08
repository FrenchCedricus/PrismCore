# PrismCore

Suite d'éclairage RGB **locale et libre** pour Windows : sans compte, sans télémétrie, sans abonnement.

## Fonctionnalités

- **14 effets** paramétrables : statique, arc-en-ciel, vague, plasma, feu, étoiles… plus des effets **audio** (son du PC) et **écran** (ambiance), analysés localement.
- **Clavier touche par touche** : colore chaque touche à la main, avec l'aperçu en direct. Les touches sans couleur suivent l'effet (complet, atténué ou éteintes).
- **Préréglages de jeux** : League of Legends, Apex Legends, Fortnite, Valorant, Counter-Strike 2. Les couleurs suivent la position physique des touches, donc ils fonctionnent en AZERTY comme en QWERTY.
- **Bascule automatique** : associe un jeu à un profil. PrismCore l'active au lancement du jeu et revient au profil précédent à sa fermeture, comme la détection de jeux de Discord (simple lecture de la liste des processus, rien n'est lu dans le jeu).
- **Canvas virtuel** : place tes appareils les uns par rapport aux autres, l'effet passe de l'un à l'autre sans rupture.
- **Profils** avec export et import JSON, **icône dans la zone de notification**, démarrage avec Windows, couleur d'arrêt en veille.
- **Robuste** : un worker par appareil, détection à chaud, chien de garde qui relance un pilote bloqué.

## Appareils pris en charge

| Appareil | Statut |
|---|---|
| SteelSeries Apex 9 Mini | ✅ 63 touches, couleurs par touche |
| HyperX DuoCast | ✅ 2 zones |
| MSI Mystic Light (Z490 Gaming Plus et cartes « 185 octets ») | ✅ LED de la carte, JRGB et ARGB sur JRAINBOW 1 et 2. Rien n'est écrit dans la flash de la carte |

Les pilotes sont de petits fichiers JavaScript, exécutés dans un bac à sable. Pour en ajouter un, voir [docs/PILOTES.md](docs/PILOTES.md). Un dossier de plugins externe au même format peut aussi être choisi dans les Paramètres.

## Installation

Télécharge l'installateur ou la version portable dans les [Releases](../../releases), ou lance depuis les sources :

```powershell
git clone <url-du-dépôt> PrismCore
cd PrismCore
npm install
node node_modules/electron/install.js   # si npm n'a pas téléchargé le binaire Electron
npm start
```

> Ferme les autres logiciels RGB (SteelSeries GG, MSI Center…) avant de lancer PrismCore, sinon deux programmes écrivent sur les mêmes appareils.

Pour construire l'installateur et la version portable (dans `dist/`) :

```powershell
npm run dist
```

## Utilisation rapide

1. **Effets** : choisis un effet et règle-le.
2. **Clavier** : peins les touches, ou choisis un jeu dans « Préréglage de jeu… » puis **Appliquer**. Un profil au nom du jeu est créé et associé à son exécutable.
3. Repasse sur ton profil habituel : il reviendra tout seul après chaque partie.

Pour un jeu sans préréglage, ajoute son `.exe` dans **Jeux associés** (le bouton « Lister les programmes ouverts » aide à le trouver).

## Ligne de commande

Le moteur fonctionne aussi sans interface :

```powershell
node index.js scan                  # appareils détectés et pilotes associés
node index.js test                  # exécution à sec : paquets générés, rien n'est envoyé
node index.js run --effect plasma   # pilotage réel (Ctrl+C pour arrêter)
npm run daemon                      # moteur seul, réglages de config.json
```

## Confidentialité

- Aucune connexion réseau, aucune télémétrie, aucune mise à jour automatique. Toute requête réseau venant de l'interface est bloquée et notée dans le Journal.
- Le son et l'écran sont analysés en mémoire puis oubliés.
- Les réglages et profils sont de simples fichiers JSON dans `%APPDATA%\PrismCore`.
- Une seule dépendance d'exécution : `node-hid`.

## Structure

```
app/        application Electron : processus principal, stockage, interface (renderer/)
src/        moteur Node : effets, canvas, workers d'appareils, API des pilotes
drivers/    pilotes intégrés
scripts/    démarrage avec Windows, génération de l'icône
docs/       ARCHITECTURE.md, PILOTES.md, API_HOTE.md, ANALYSE.md
```

Les détails techniques sont dans [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Licence

MIT
