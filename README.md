# Blindr

Blind test infini pour iPhone, sous forme de web app (PWA) : pas de compilation, pas de signature Apple, pas d'expiration.

## Contenu généré automatiquement
- **Musique, films, séries, Disney, dessins animés, jeux vidéo** : extraits de 30 s tirés de playlists Deezer (API publique, sans clé). La popularité Deezer sert à régler la difficulté.
- **Difficulté** : pour la musique et les jeux, popularité Deezer du morceau. Pour les films, séries, Disney et dessins animés, notoriété de l'œuvre en France (vues de sa page Wikipédia française), avec repli sur Deezer si Wikipédia ne répond pas.
- **Une œuvre, une catégorie** : un titre présent dans plusieurs catégories est rangé dans la plus précise (Anime > Disney > Dessins animés > Séries > Films). Un anime assez populaire pour sortir en Anime n'apparaît pas en Dessins animés.
- **Anime** : les openings et endings officiels en vidéo (AnimeThemes), choisis parmi les anime les plus populaires d'AniList. Si la vidéo ne passe pas, l'app se rabat sur des playlists Deezer d'anime.

- **Vidéo de fond à la révélation** (muette) : extrait du clip officiel (Apple) pour la musique, bande-annonce YouTube référencée par Wikidata pour les films, séries, Disney et jeux. Sans vidéo trouvée, la pochette animée s'affiche.
- **Sortie audio** : le bouton en haut à droite (sur iPhone) ouvre le sélecteur de sortie d'iOS.

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
- `js/sources.js` : génération des questions (Deezer, AniList, AnimeThemes)
- `js/app.js` : moteur de jeu, réglages, lecture audio/vidéo
- `sw.js`, `manifest.webmanifest`, `icons/` : installation en app

Ajouter une catégorie = ajouter une entrée dans `js/catalog.js` avec des identifiants de playlists Deezer.
