// Catégories et playlists Deezer (éditoriales ou très suivies) qui servent de réservoir.
// "work: true" = la réponse est l'œuvre (film, série, jeu…), pas le titre du morceau.
// Le contenu réel de chaque catégorie vient du catalogue construit par tools/build-catalog.mjs (data/catalog).
export const CATEGORIES = [
  { id: 'hits',     label: 'Hits du moment',    emoji: '🔥', color: '#ff4d6d', playlists: [1109890291, 3155776842, 1363560485] },
  { id: '80s',      label: 'Années 80',         emoji: '🕺', color: '#ff7ae0', playlists: [867825522, 1163842311, 791349661, 10727755642] },
  { id: '90s',      label: 'Années 90',         emoji: '📼', color: '#7a5cff', playlists: [1251125011, 9927915042, 1252278051] },
  { id: '2000s',    label: 'Années 2000',       emoji: '💿', color: '#3fb4ff', playlists: [1560256341, 11837091441, 751764391, 1977689462] },
  { id: '2010s',    label: 'Années 2010+',      emoji: '📱', color: '#22d3c5', playlists: [5339620562, 5311155022, 3185085222] },
  { id: 'fr',       label: 'Chanson française', emoji: '🇫🇷', color: '#4f7cff', playlists: [700895155, 1420459465, 1884320402, 788022051] },
  { id: 'rapfr',    label: 'Rap français',      emoji: '🎤', color: '#ffb020', playlists: [3272614282, 5175061384, 6568026624, 9563400362] },
  { id: 'rock',     label: 'Rock',              emoji: '🎸', color: '#ff5a36', playlists: [1306931615, 1419215845, 1437011185] },
  { id: 'electro',  label: 'Électro / Dance',   emoji: '🎧', color: '#00e5ff', playlists: [1902101402, 943229685, 687945565] },
  { id: 'films',    label: 'Films',             emoji: '🎬', color: '#f5c518', work: true, playlists: [754776991, 6478306844, 6223140704, 6238866284, 13013668743, 1033974391, 6548712124] },
  { id: 'series',   label: 'Séries',            emoji: '📺', color: '#e50914', work: true, playlists: [6166580664, 6448621904, 4526313244, 106164531, 11661862924] },
  { id: 'disney',   label: 'Disney',            emoji: '🏰', color: '#4cc9f0', work: true, playlists: [613860315, 14511914743, 7548451242, 1962379246, 11817251201] },
  { id: 'cartoons', label: 'Dessins animés',    emoji: '🧸', color: '#ff9f1c', work: true, playlists: [9976576142, 4218596522, 9862479622, 12537130863, 14348880581, 4267475282, 4998980944] },
  // Anime : openings japonais (vidéo AnimeThemes, en direct) + génériques français (Club Dorothée…) depuis le catalogue.
  { id: 'anime',    label: 'Anime',             emoji: '⛩️', color: '#ff3d81', work: true, playlists: [5206929684, 9016993522, 11225266244, 11225268324, 11215654264, 7490833544, 12324246211, 11170914824, 4859699704, 8977497562, 14630236521, 11170572584] },
  { id: 'games',    label: 'Jeux vidéo',        emoji: '🎮', color: '#8bff5a', work: true, playlists: [7747193762, 4335231942, 13252291043, 8520282922] },
  { id: 'tv',       label: 'Émissions TV',      emoji: '🎙️', color: '#b388ff', work: true, playlists: [53041454, 15874573521, 11360363604, 31165972, 1647632711, 2156993722, 14179152301, 33852468] },
];

export const CAT_BY_ID = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

export const DIFFICULTIES = [
  { id: 'easy',   label: 'Facile',    hint: 'Les plus connus' },
  { id: 'medium', label: 'Moyen',     hint: 'Connus' },
  { id: 'hard',   label: 'Difficile', hint: 'Moins connus' },
  { id: 'all',    label: 'Mixte',     hint: 'Tout' },
];

// Part du classement de popularité (0 = le plus connu, 1 = le moins connu) utilisée par niveau.
export const DIFFICULTY_RANGE = {
  easy:   [0, 0.3],
  medium: [0, 0.65],
  hard:   [0.4, 1],
  all:    [0, 1],
};
