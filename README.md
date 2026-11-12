# Blindr

Blind test infini pour iPhone, sous forme de web app (PWA) : pas de compilation, pas de signature Apple, pas d'expiration.

## Catalogue commun
Le contenu de chaque catégorie est construit une fois, sur un ordinateur, et publié avec l'app : tous les appareils jouent le même catalogue.

```bash
node tools/build-catalog.mjs            # reconstruit data/catalog/ (réponses des API en cache dans tools/.cache)
node tools/build-catalog.mjs --refresh  # re-télécharge aussi les playlists Deezer
```

- **Sources** : playlists Deezer de chaque catégorie (`js/catalog.js`), plus les œuvres les plus connues de Wikidata dont le thème est trouvé sur Deezer.
- **Une œuvre, une catégorie** : chaque morceau est rattaché à une entité Wikidata, et c'est son type qui décide de la catégorie (film, film d'animation Disney, série, série animée, anime, émission, jeu). Les génériques français d'anime vont en Anime.
- **Difficulté** : œuvres classées par vues de leur page Wikipédia française sur 12 mois, un tiers par niveau. Musique : popularité Deezer.
- **Corrections** : `tools/overrides.json` (exclure, forcer une œuvre ou une catégorie, renommer, fixer un niveau), prioritaire sur le tri automatique. Une correction peut nommer l'œuvre (« Top Gun ») : le script retrouve sa fiche Wikidata, donc sa popularité et son image. Le fichier contient la relecture manuelle de tout le catalogue. L'écran Catalogue de l'app permet d'exclure ou de remettre en jeu un titre et de copier ces corrections.
- **Revue** : chaque construction produit `tools/review.html` (œuvres par niveau, titres écartés avec leur raison).

## En jeu
- **Extraits** : 30 s, lien Deezer frais demandé au moment de jouer.
- **Anime** : openings japonais en vidéo (AnimeThemes, parmi les 1 000 anime les plus populaires d'AniList) et génériques français du catalogue.
- **Vidéo de fond à la révélation** (muette) : clip officiel (Apple) pour la musique, bande-annonce YouTube (Wikidata) pour les œuvres.
- **Sortie audio** : le bouton en haut à droite (sur iPhone) ouvre le sélecteur de sortie d'iOS ; mode AirPlay pour HomePod.

## Lancer en local
```bash
python3 -m http.server 8765 --directory blindr
```
Puis ouvrir http://localhost:8765.

## Installer sur iPhone
Il faut l'héberger en HTTPS (gratuit), par exemple avec GitHub Pages :
1. Créer un dépôt GitHub et y pousser le contenu du dossier `blindr/`.
2. Settings → Pages → Branch `main`, dossier `/ (root)`.
3. Sur l'iPhone, ouvrir l'URL dans **Safari**, puis Partager → **Sur l'écran d'accueil**.

Autres options sans compte GitHub : Netlify Drop (glisser-déposer le dossier) ou Cloudflare Pages.

## Structure
- `index.html`, `styles.css` : interface
- `js/catalog.js` : catégories, playlists Deezer, niveaux de difficulté
- `js/sources.js` : génération des questions à partir du catalogue (Deezer, AniList, AnimeThemes)
- `js/names.js` : nettoyage des noms, commun à l'app et au script
- `tools/build-catalog.mjs`, `tools/overrides.json` : construction et corrections du catalogue
- `data/catalog/` : catalogue publié
- `js/app.js` : moteur de jeu, réglages, lecture audio/vidéo
- `js/catalogue.js` : écran Catalogue
- `sw.js`, `manifest.webmanifest`, `icons/` : installation en app

Ajouter une catégorie = ajouter une entrée dans `js/catalog.js` avec des identifiants de playlists Deezer, puis reconstruire le catalogue.
