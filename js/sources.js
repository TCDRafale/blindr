// Génération automatique des questions : Deezer (extraits 30 s) + AniList/AnimeThemes (openings en vidéo).
import { CAT_BY_ID, DIFFICULTY_RANGE } from './catalog.js';

const DZ = 'https://api.deezer.com';
const POOL_TTL = 24 * 3600 * 1000;
const RECENT_KEY = 'blindr.recent';
const RECENT_MAX = 1500;

// ---------- Utilitaires ----------
let jsonpSeq = 0;
// L'API Deezer n'autorise pas le CORS : on passe par JSONP.
function jsonp(url, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const cb = `__dz${Date.now().toString(36)}${jsonpSeq++}`;
    const s = document.createElement('script');
    const timer = setTimeout(() => done(new Error('timeout')), timeout);
    function done(err, data) {
      clearTimeout(timer);
      delete window[cb];
      s.remove();
      err ? reject(err) : resolve(data);
    }
    window[cb] = data => (data && data.error ? done(new Error(data.error.message || 'deezer')) : done(null, data));
    s.onerror = () => done(new Error('network'));
    s.src = `${url}${url.includes('?') ? '&' : '?'}output=jsonp&callback=${cb}`;
    document.head.appendChild(s);
  });
}

const rand = n => Math.floor(Math.random() * n);
const pick = arr => arr[rand(arr.length)];

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* stockage indisponible */ }
}

// Mémoire des morceaux déjà joués, pour éviter les répétitions.
const recent = new Set(load(RECENT_KEY, []));
// Mémoire des œuvres (film, série, jeu, anime…) : une même œuvre ne revient pas avant WORK_GAP extraits.
const WORKS_KEY = 'blindr.works';
const WORK_GAP = 100;
let recentWorks = load(WORKS_KEY, []);          // une entrée par extrait joué ('' si pas d'œuvre)
const isRecentWork = w => !!w && recentWorks.includes(w);

// Clé d'une œuvre, commune aux suites d'une saga : « Shrek 2 », « Shrek le troisième » → « shrek ».
export function workKey(name) {
  let k = (name || '').split(/\s*[:–]\s*|\s+-\s+/)[0];
  k = norm(k)
    .replace(/^(the|le|la|les|l)\s+/, '')
    .replace(/\s+(\d+|[ivx]+|part \w+|chapter \w+|chapitre \w+)$/, '')
    .replace(/\s+(the |le |la )?(second|third|fourth|final|deuxieme|troisieme|quatrieme|dernier|derniere)\b.*$/, '')
    .replace(/\s+(forever after|returns|reloaded|revolutions|begins|rises|resurrection|reloaded)$/, '');
  return k.trim();
}

// songKey : même chanson sous un autre identifiant Deezer (remaster, compilation, autre playlist).
export function markPlayed(key, work = '', songKey = '') {
  for (const k of [key, songKey]) { if (!k) continue; recent.delete(k); recent.add(k); }
  while (recent.size > RECENT_MAX) recent.delete(recent.values().next().value);
  save(RECENT_KEY, [...recent]);
  recentWorks = [...recentWorks, work || ''].slice(-WORK_GAP);
  save(WORKS_KEY, recentWorks);
}
export function resetHistory() { recent.clear(); save(RECENT_KEY, []); recentWorks = []; save(WORKS_KEY, []); }

// ---------- Nettoyage des titres ----------
const NOISE_PAREN = /\s*[\(\[][^\)\]]*(from|de "|de «|du film|remaster|version|edit|mix|bande originale|soundtrack|theme|générique|generique|live|mono|stereo|original|feat\.?|ft\.)[^\)\]]*[\)\]]?/gi;
const NOISE_DASH = /\s+[-–]\s+(remaster|radio edit|single|edit|version|live|mono|stereo|original|from|bande|générique).*$/i;

export function cleanTitle(t) {
  return t.replace(NOISE_PAREN, '').replace(NOISE_DASH, '').replace(/\s{2,}/g, ' ').trim() || t;
}

// Titre qui est le nom d'une série ou d'un dessin animé : on retire « Main Theme », « Générique »…
export function cleanShowTitle(t) {
  return t
    .replace(/^g[ée]n[ée]rique\s+(de\s+|du\s+|des\s+)?/i, '')
    .replace(/^th[èe]me\s+(de\s+|du\s+|des\s+|from\s+)?/i, '')
    .replace(/\s*[\(\[][^\)\]]*[\)\]]\s*$/, '') // « La petite maison dans la prairie (Little House On the Prairie) »
    .replace(/\s+[-–]\s+(part|partie|pt\.?|vol\.?|volume)\s*\w+$/i, '') // « Game of Thrones - Part 1 »
    .replace(/\s*[-–:]?\s*(main titles?|main theme|theme song|opening theme|opening|theme|g[ée]n[ée]rique( de fin| original)?|intro)\s*$/i, '')
    .replace(/[:\-–,\s]+$/, '')
    .trim() || t;
}

const SOUNDTRACK_RE = /(soundtrack|motion picture|bande originale|\bscore\b|video game|original game|o\.s\.t|\bost\b|music from|original series|générique original|du film|complete recordings|tv series)/i;
const COMPIL_RE = /(best of|génériques|generiques|plus belles|hits|vol\.|volume|magie|compil|collection|essentials|ultimate|greatest|meilleur|\btop\b|disneyland|revisit)/i;

function cleanWork(s) {
  return s
    .replace(/\s*[\(\[].*?([\)\]]|$)/g, '')
    .replace(/^selections from (the )?(original )?(motion picture )?(soundtrack )?/i, '')       // « Selections From The Original Soundtrack The Woman In Red »
    .replace(/^music from (the )?((mgm|disney|warner bros\.?|paramount|universal|columbia|dreamworks) )?(motion picture|film|movie)?\s*/i, '') // « Music From The MGM Motion Picture Die Another Day »
    .replace(/^[^-–:]*:\s*(?:more )?music (?:from|of) (?:the )?/i, '')   // « Distant Worlds II: More Music from Final Fantasy »
    .replace(/^(quentin tarantino|tim burton|wes anderson|baz luhrmann|steven spielberg|stanley kubrick|guillermo del toro|james cameron|christopher nolan|martin scorsese|walt disney|disney|pixar)[’']s\s+/i, '')
    .replace(/\s+[-–]\s+.*$/, '')
    .replace(/\b(the )?(official )?(original )?(video game |motion picture |game |tv |series |music )*(soundtrack|score)( recordings?)?\b.*$/i, '')
    .replace(/\bbande originale.*$/i, '')
    .replace(/\b(original )?motion picture\b.*$/i, '')
    .replace(/\s+(ost|o\.s\.t\.?)$/i, '')
    .replace(/["“”«»]/g, '')
    .replace(/,?\s*(seasons?|saison|saisons|vol\.?|volume|part)\s+[\d&\s,]+.*$/i, '')
    .replace(/\b(special|deluxe|collector'?s?|anniversary|legacy|expanded|remastered)\s+(edition|collection|version)\b.*$/i, '')
    .replace(/[:\-–,\/\s]+$/, '')
    .trim();
}

// Retrouve l'œuvre (film, série, jeu…) à partir du titre du morceau ou de l'album.
export function findWork(title, album) {
  let m = title.match(/(?:theme from|from|de|du film|thème de)(?:\s+the\s+(?:motion picture|movie|film|series))?\s*[«"“'‘]\s*([^"”»’]+?)\s*(?:["”»’]|$)/i);
  if (m) return m[1].trim();
  m = title.match(/\(([^()]+?)\s+(?:main\s+)?theme\)/i);
  if (m) return m[1].trim();
  // « Like A Friend (Great Expectations Soundtrack) », « Calling You (Bagdad Cafe/Soundtrack Version) »
  m = title.match(/\(([^()\/]+?)\s*(?:\/\s*|\s)(?:original\s+)?(?:sou?n?d?track|ost|bande originale)(?:\s+version)?\)/i);
  if (m) return m[1].trim();
  if (album && SOUNDTRACK_RE.test(album) && !COMPIL_RE.test(album)) {
    const w = cleanWork(album);
    if (w.length > 1) return w;
  }
  return null;
}

const GENERIC_ARTIST = /^(génériques?|generiques?|tv themes|soundtrack|various|cast|bande originale)/i;

// ---------- Titres écartés ----------
const REJECT_KEY = 'blindr.rejected2'; // v2 : règles de tri revues (séries, dessins animés)
const rejected = new Set(load(REJECT_KEY, []));
function reject(id) { rejected.add(id); save(REJECT_KEY, [...rejected]); }
// Choix faits dans le catalogue : titres exclus à la main, et titres rétablis (gardés malgré le tri automatique).
const USER_KEY = 'blindr.user';
const userStore = load(USER_KEY, { out: [], keep: [], anime: [] });
const userOut = new Set(userStore.out), kept = new Set(userStore.keep), animeOut = new Set(userStore.anime);
const saveUser = () => save(USER_KEY, { out: [...userOut], keep: [...kept], anime: [...animeOut] });
export function excludeTrack(id) { userOut.add(id); kept.delete(id); reject(id); saveUser(); }
export function restoreTrack(id) {
  userOut.delete(id); kept.add(id); rejected.delete(id);
  save(REJECT_KEY, [...rejected]); saveUser();
}
export function excludeAnime(id, out = true) { out ? animeOut.add(id) : animeOut.delete(id); saveUser(); }

// ---------- Réservoirs Deezer ----------
const pools = {};        // catId -> [{ id, r }] trié du plus connu au moins connu
const poolLoading = {};

async function fetchPlaylist(pid, withWork) {
  try {
    const d = await jsonp(`${DZ}/playlist/${pid}/tracks?limit=400`);
    return (d.data || []).filter(t => t.preview && t.readable !== false).map(t => {
      // t, a, al, m : titre, artiste, album, pochette (pour le catalogue et l'analyse sans requête Deezer).
      const item = { id: t.id, r: t.rank || 0, t: t.title, a: t.artist?.name || '', al: t.album?.title || '', m: t.album?.md5_image || '' };
      const w = withWork && findWork(t.title, t.album?.title);
      if (w) item.w = workKey(w);
      return item;
    });
  } catch {
    return [];
  }
}

// Une œuvre n'appartient qu'à une catégorie : un titre présent dans plusieurs playlists revient à la plus précise
// (un opening d'anime n'est pas un dessin animé, « Aladdin » est un Disney avant d'être un film).
const OWNER_ORDER = ['anime', 'disney', 'cartoons', 'series', 'films', 'games'];

export function loadPool(catId) {
  if (pools[catId]) return Promise.resolve(pools[catId]);
  if (poolLoading[catId]) return poolLoading[catId];
  const cached = load(`blindr.pool5.${catId}`, null);
  if (cached && Date.now() - cached.ts < POOL_TTL && cached.items.length > 20) {
    pools[catId] = cached.items;
    return Promise.resolve(cached.items);
  }
  const cat = CAT_BY_ID[catId];
  const owners = OWNER_ORDER.slice(0, Math.max(0, OWNER_ORDER.indexOf(catId)));
  poolLoading[catId] = Promise.all([
    Promise.all(cat.playlists.map(pid => fetchPlaylist(pid, cat.work))),
    Promise.all(owners.map(id => loadPool(id).catch(() => []))),
  ]).then(([lists, higher]) => {
    const takenIds = new Set(), takenWorks = new Set();
    higher.flat().forEach(t => { takenIds.add(t.id); if (t.w) takenWorks.add(t.w); });
    const seen = new Map();
    lists.flat().forEach(t => { if (!takenIds.has(t.id) && !(t.w && takenWorks.has(t.w))) seen.set(t.id, t); });
    const items = [...seen.values()].sort((a, b) => b.r - a.r);
    items.forEach((t, i) => (t.p = Math.round(1000 * i / items.length) / 1000)); // rang Deezer, 0 = le plus écouté
    if (items.length) {
      pools[catId] = items;
      save(`blindr.pool5.${catId}`, { ts: Date.now(), items });
    }
    delete poolLoading[catId];
    return items;
  });
  return poolLoading[catId];
}

function slice(items, difficulty) {
  const [a, b] = DIFFICULTY_RANGE[difficulty] || DIFFICULTY_RANGE.all;
  const s = items.slice(Math.floor(items.length * a), Math.max(Math.ceil(items.length * b), Math.floor(items.length * a) + 1));
  return s.length ? s : items;
}

function sliceRange(items, [a, b]) {
  const s = items.slice(Math.floor(items.length * a), Math.ceil(items.length * b));
  return s.length ? s : items;
}

// ---------- Notoriété des œuvres ----------
// Mesurée par les vues de la page Wikipédia française (moyenne quotidienne sur 60 jours) : reflète ce qui est
// connu en France (« Hélène et les garçons », « Les Mystérieuses Cités d'or »), contrairement à la popularité
// internationale ou aux écoutes de la BO sur Deezer.
const POP_CATS = new Set(['films', 'series', 'disney', 'cartoons']);
export const popCategories = [...POP_CATS];
const PRIOR_RANGE = { easy: [0, 0.7], medium: [0, 0.9], hard: [0.15, 1], all: [0, 1] };
// Œuvres d'autres catégories, repérées par leur description Wikipédia.
const ANIM_DESC = /\banimation\b|dessins? animes?|serie animee|\bcartoon/;
// i.dis : la page est classée en animation Disney/Pixar (la description de « La Reine des neiges »
// dit seulement « film d'animation américain de 2013 »).
const OWNED_ELSEWHERE = {
  films: i => i.dis || (/disney|pixar/.test(i.d) && ANIM_DESC.test(i.d)), // classique d'animation Disney
  series: i => ANIM_DESC.test(i.d),                                        // série animée → Dessins animés
  cartoons: i => i.dis || /disney/.test(i.d),                              // série Disney → Disney
};
const DISNEY_CAT = /animation disney|d'animation de disney|pixar|disney television animation|disneytoon|s[ée]rie d'animation disney/i;
// Type attendu de la page Wikipédia (évite « Saturday Night Fever (album) » pour le film).
const POP_TYPE = {
  films: /\bfilms?\b/, disney: /\bfilms?\b|animation/, series: /serie|feuilleton|sitcom|telenovela/, cartoons: /anim|dessin/,
};
const NOT_WORK = /homonymie|\balbum\b|chanson|single|personnage|franchise|bande originale/;

// Requêtes Wikimedia espacées, avec une pause de 2 min si le serveur demande de ralentir.
let wikiNext = 0, wikiPauseUntil = 0;
async function wikiFetch(url) {
  if (Date.now() < wikiPauseUntil) throw new Error('wikimedia en pause');
  const wait = Math.max(0, wikiNext - Date.now());
  wikiNext = Date.now() + wait + 350;
  if (wait) await new Promise(r => setTimeout(r, wait));
  const r = await fetch(url).catch(() => null);
  if (!r || !r.ok) {
    if (!r || r.status === 429 || r.status >= 500) wikiPauseUntil = Date.now() + 120000;
    throw new Error('wikimedia ' + (r?.status || 'network'));
  }
  try { return await r.json(); } catch { wikiPauseUntil = Date.now() + 120000; throw new Error('wikimedia ralenti'); }
}

// Dessins animés : un anime assez populaire pour sortir dans la catégorie Anime (Dragon Ball Z) n'y est pas repris.
// Les anime plus confidentiels (Goldorak, Bouba, Capitaine Flam) restent des dessins animés.
const ANIME_MIN_POP = 75000; // popularité AniList du dernier anime de la catégorie Anime (page 20)
const AL_KEY = 'blindr.al';
const alCache = load(AL_KEY, {});
async function inAnimeCategory(name) {
  const key = norm(name);
  if (!key) return false;
  if (key in alCache) return alCache[key];
  // Recherche avec et sans accents (« Pokémon » ne trouve qu'un spin-off, « Pokemon » trouve la série).
  const plainName = name.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const fields = 'perPage:1){media(type:ANIME,search:';
  const query = 'query($a:String,$b:String){a:Page(' + fields + '$a){popularity countryOfOrigin}} b:Page(' + fields + '$b){popularity countryOfOrigin}}}';
  const r = await fetch('https://graphql.anilist.co', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables: { a: name, b: plainName } }),
  });
  if (!r.ok) throw new Error('anilist ' + r.status);
  const d = (await r.json()).data || {};
  const hits = [d.a?.media?.[0], d.b?.media?.[0]].filter(m => m && m.countryOfOrigin === 'JP');
  alCache[key] = hits.some(m => m.popularity >= ANIME_MIN_POP);
  save(AL_KEY, alCache);
  return alCache[key];
}
// Repères de départ (vues/jour, triées) tant que l'app n'a pas mesuré assez d'œuvres de la catégorie.
// Mesurés sur un échantillon des playlists (novembre 2026).
const POP_REF = {
  films:    [600, 400, 300, 240, 210, 180, 155, 135, 120, 105, 90, 75, 60, 48, 36, 26, 18, 12, 7, 3],
  disney:   [500, 350, 280, 240, 200, 170, 145, 125, 105, 90, 75, 62, 50, 40, 31, 23, 16, 10, 6, 2],
  series:   [700, 450, 330, 260, 210, 175, 145, 120, 100, 85, 70, 57, 46, 37, 29, 22, 15, 10, 6, 2],
  cartoons: [350, 200, 140, 105, 85, 70, 58, 48, 40, 34, 28, 23, 19, 15, 12, 9, 7, 5, 3, 1],
};
const POP_KEY = 'blindr.pop';
const popStore = load(POP_KEY, { id: {}, cat: {} });
const popById = popStore.id;          // id Deezer -> vues/jour (null si inconnue)
function rememberPop(id, v) {
  popById[id] = v;
  const ids = Object.keys(popById);
  if (ids.length > 4000) ids.slice(0, ids.length - 4000).forEach(k => delete popById[k]);
  save(POP_KEY, popStore);
}
// Rang de notoriété dans la catégorie : 0 = la plus connue, 1 = la moins connue.
function popRank(catId, v) {
  const seen = Object.values(popStore.cat[catId] || {}).filter(x => x != null);
  const ref = seen.length >= 40 ? seen : [...seen, ...POP_REF[catId]];
  return ref.filter(x => x > v).length / ref.length;
}
function inBand(catId, v, difficulty, deezerPos = 0.5) {
  if (difficulty === 'all') return true;
  const [a, b] = DIFFICULTY_RANGE[difficulty] || DIFFICULTY_RANGE.all;
  const r = v == null ? deezerPos : popRank(catId, v); // œuvre introuvable : on se fie au rang Deezer
  return r >= a && r <= b;
}

const INFO_KEY = 'blindr.info2'; // v2 : + catégories Disney
const infoCache = load(INFO_KEY, {});
// Page Wikipédia française de l'œuvre : vues, description et image, en une seule requête.
async function workInfo(catId, name) {
  const key = `${catId}:${norm(name)}`;
  if (!norm(name)) return null;
  if (key in infoCache) return infoCache[key];
  const u = 'https://fr.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1' +
    `&generator=search&gsrlimit=4&gsrsearch=${encodeURIComponent(`${name} ${WIKI_HINT[catId] || ''}`)}` +
    '&prop=pageviews|description|pageimages|categories&cllimit=max&pvipdays=60&piprop=thumbnail&pithumbsize=1000';
  const d = await wikiFetch(u);
  const pages = Object.values(d.query?.pages || {}).sort((x, y) => x.index - y.index)
    .filter(p => !NOT_WORK.test(norm(p.description || '')));
  const named = p => sameName(p.title, name) || norm(p.title).startsWith(norm(name));
  const typed = p => POP_TYPE[catId].test(norm(p.description || ''));
  // La page porte le nom de l'œuvre et en a le type ; sinon, un des deux premiers résultats du bon type
  // (titre français : « Saturday Night Fever » → « La Fièvre du samedi soir »).
  // Séries et dessins animés : le titre est déjà le nom de l'œuvre, on exige donc la correspondance.
  const loose = catId === 'films' || catId === 'disney';
  const page = pages.find(p => named(p) && typed(p)) || (loose && pages.slice(0, 2).find(typed)) ||
    pages.find(p => named(p) && !p.description);
  let info = null;
  if (page) {
    const days = Object.values(page.pageviews || {}).filter(x => x != null);
    info = {
      v: days.length ? Math.round(days.reduce((a, x) => a + x, 0) / days.length) : null,
      d: norm(page.description || ''),
      img: page.thumbnail?.source || null,
      dis: (page.categories || []).some(c => DISNEY_CAT.test(c.title)) ||
        ((page.categories || []).some(c => /Portail:Disney/.test(c.title)) && (page.categories || []).some(c => /d'animation/i.test(c.title))),
    };
    if (info.v != null) {
      const bucket = (popStore.cat[catId] ||= {});
      bucket[workKey(name)] = info.v;
      save(POP_KEY, popStore);
    }
  }
  infoCache[key] = info;
  const keys = Object.keys(infoCache);
  if (keys.length > 3000) keys.slice(0, keys.length - 3000).forEach(k => delete infoCache[k]);
  save(INFO_KEY, infoCache);
  return info;
}

const validImg = url => url && !/\/images\/(artist|cover)\/\//.test(url);

// Ce que représente un morceau : nom de l'œuvre (films, séries…), notoriété, ou null s'il est écarté
// (pas une œuvre de la catégorie, ou œuvre d'une autre catégorie). undefined : service injoignable.
// t : morceau Deezer ({ id, title, album: { title }, artist: { name } }).
const IDENT_KEY = 'blindr.ident';
const identCache = load(IDENT_KEY, {});      // id Deezer -> { n: nom affiché, v: vues/jour ou null }
function rememberIdent(id, n, v) {
  identCache[id] = { n, v };
  const ids = Object.keys(identCache);
  if (ids.length > 6000) ids.slice(0, ids.length - 6000).forEach(k => delete identCache[k]);
  save(IDENT_KEY, identCache);
}
async function identify(catId, t) {
  const cat = CAT_BY_ID[catId];
  const keep = kept.has(t.id);
  const drop = () => { if (keep) return false; reject(t.id); return true; };
  const song = cleanTitle(t.title_short || t.title);
  const artist = t.artist?.name || '';
  let work = cat.work ? findWork(t.title, t.album?.title) : null;
  // Disney : un album au nom court qui n'est pas une compilation porte le nom du film (« Pinocchio »).
  const album = t.album?.title || '';
  if (!work && catId === 'disney' && album && !COMPIL_RE.test(album) && norm(album) !== norm(t.title)) {
    const w = cleanWork(album);
    if (w && w.length <= 40) work = w;
  }
  if (catId === 'films' && /s[ée]rie|\bseries\b|tv show|netflix|hbo/i.test(`${t.title} ${album}`) && drop()) return null;
  if ((cat.exclude?.test(cleanShowTitle(song)) || cat.excludeArtist?.test(artist)) && drop()) return null;
  let title = work || song;
  // Dessins animés : on vérifie toujours (une BO trouvée par l'album peut être celle d'une série, comme « JAG »).
  if (cat.work && (!work || catId === 'cartoons')) {
    const check = await checkWork(catId, album, work || song, artist).catch(() => undefined);
    if (check === undefined) return undefined;
    if (check === false && drop()) return null; // pas une œuvre de cette catégorie
    if (typeof check === 'string') work = title = check;
    else if (!work) title = cleanShowTitle(song); // séries, dessins animés : le titre est le nom de l'œuvre
  }
  let info = null;
  if (POP_CATS.has(catId)) {
    info = await workInfo(catId, title).catch(() => undefined);
    // Œuvre qui appartient à une autre catégorie (Disney, anime, dessin animé).
    if (info && OWNED_ELSEWHERE[catId]?.(info) && drop()) return null;
    if (info !== undefined) rememberPop(t.id, info?.v ?? null);
  }
  if (catId === 'cartoons' && !keep && await inAnimeCategory(title).catch(() => false)) { reject(t.id); return null; }
  if (cat.work) rememberIdent(t.id, title, info?.v ?? null);
  return { song, artist, album, work, title, info };
}

async function deezerQuestion(catId, difficulty) {
  const items = await loadPool(catId);
  if (!items.length) throw new Error('pool vide');
  const usable = items.filter(t => !rejected.has(t.id));
  const cat = CAT_BY_ID[catId];
  const byPop = POP_CATS.has(catId) && difficulty !== 'all';
  // Films, séries, Disney, dessins animés : la difficulté vient de la notoriété de l'œuvre. Le rang Deezer
  // ne sert qu'à dégrossir (une BO très écoutée est plus souvent celle d'une œuvre connue).
  const range = byPop ? sliceRange(usable.length ? usable : items, PRIOR_RANGE[difficulty])
    : slice(usable.length ? usable : items, difficulty);
  let fallback = null;
  for (let attempt = 0; attempt < (byPop ? 20 : 12); attempt++) {
    let candidate;
    for (let i = 0; i < 40; i++) {
      candidate = pick(range);
      if (recent.has(`dz:${candidate.id}`) || isRecentWork(candidate.w)) continue;
      // Notoriété déjà connue et hors du niveau choisi : on passe sans rien télécharger.
      if (byPop && candidate.id in popById && !inBand(catId, popById[candidate.id], difficulty, candidate.p)) continue;
      break;
    }
    // On recharge le morceau pour obtenir un lien d'extrait frais (ils expirent vite).
    let t;
    try { t = await jsonp(`${DZ}/track/${candidate.id}`); } catch { continue; }
    if (!t || !t.preview) continue;
    const id = await identify(catId, t);
    if (!id) continue;                     // écarté, ou service injoignable : on essaie un autre titre
    const { song, artist, album, work, title, info } = id;
    const wk = cat.work ? workKey(title) : '';
    if (isRecentWork(wk)) continue; // même œuvre jouée il y a moins de 100 extraits
    const songKey = cat.work ? '' : `s:${norm(artist.split(/,|&| feat/i)[0])}|${norm(song)}`;
    if (songKey && recent.has(songKey)) continue; // même chanson, autre version
    const showArtist = artist && !GENERIC_ARTIST.test(artist);
    const year = (t.album?.release_date || t.release_date || '').slice(0, 4);
    const cover = validImg(t.album?.cover_xl) ? t.album.cover_xl : null;
    const artistPic = validImg(t.artist?.picture_xl) && !cat.work ? t.artist.picture_xl : null;
    const q = {
      key: `dz:${t.id}`,
      work: wk,
      songKey,
      pop: info?.v ?? null,
      image: info?.img || null,
      // Pochette de compilation (« 70 Génériques TV »…) plutôt que celle de l'œuvre : on cherchera une vraie image.
      genericCover: !!cat.work && catId !== 'anime' && !norm(cleanWork(album)).includes(wk || norm(title)),
      cat: catId,
      kind: 'audio',
      src: t.preview,
      title,
      subtitle: work ? [song, showArtist ? artist : ''].filter(Boolean).join(' — ') : (showArtist ? artist : ''),
      // Pour les BO, l'année de l'album est souvent celle d'une compilation : on la masque.
      year: !cat.work && year && year !== '0000' ? year : '',
      cover,
      backdrop: artistPic || cover,
      link: t.link,
      artist,
      song,
      // Ce qu'on cherchera pour la vidéo de fond (œuvre pour les BO, sinon le morceau).
      search: cat.work ? title : null,
    };
    if (!byPop || inBand(catId, q.pop, difficulty, candidate.p)) return q;
    fallback = fallback || q; // hors niveau : gardé en secours si rien de mieux n'est trouvé
  }
  if (fallback) return fallback;
  throw new Error('aucun extrait disponible');
}

// ---------- Anime : AniList (popularité) + AnimeThemes (vidéos des openings) ----------
const anime = { ok: true, failures: 0, pages: {} };
const webmOK = (() => {
  const v = document.createElement('video');
  return !!(v.canPlayType && v.canPlayType('video/webm; codecs="vp9, opus"'));
})();
export const animeVideoSupported = () => webmOK && anime.ok;

const ANIME_PAGES = { easy: [1, 2], medium: [1, 6], hard: [4, 20], all: [1, 20] };

async function anilistPage(page) {
  if (anime.pages[page]) return anime.pages[page];
  const query = `query($p:Int){Page(page:$p,perPage:50){media(type:ANIME,sort:POPULARITY_DESC,format_in:[TV,TV_SHORT,ONA,MOVIE],isAdult:false){
    id title{romaji english} coverImage{extraLarge color} bannerImage seasonYear }}}`;
  const r = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables: { p: page } }),
  });
  if (!r.ok) throw new Error('anilist ' + r.status);
  const j = await r.json();
  return (anime.pages[page] = j.data.Page.media);
}

// Une seule requête GraphQL récupère les openings/endings de toute une page AniList.
const THEMES_QUERY = `query($ids:[Int!]){ findAnimeByExternalSite(site: ANILIST, id: $ids){
  resources(site: ANILIST){ nodes{ externalId } }
  animethemes{ id type sequence song{ title{ romaji } performances{ alias artist{ name{ main } } } }
    animethemeentries{ spoiler nsfw videos{ nodes{ link resolution nc overlap } } } } } }`;
const themesByAnilist = {};

async function loadThemes(ids) {
  const missing = ids.filter(id => !(id in themesByAnilist));
  if (!missing.length) return;
  const r = await fetch('https://graphql.animethemes.moe/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: THEMES_QUERY, variables: { ids: missing } }),
  });
  if (!r.ok) throw new Error('animethemes ' + r.status);
  const j = await r.json();
  if (!j.data) throw new Error('animethemes: réponse invalide');
  missing.forEach(id => (themesByAnilist[id] = []));
  for (const a of j.data.findAnimeByExternalSite || []) {
    const themes = (a.animethemes || [])
      .map(t => ({ ...t, entries: t.animethemeentries.filter(e => !e.nsfw && e.videos.nodes.length) }))
      .filter(t => t.entries.length && !/instrumental|off vocal|tv size/i.test(t.song?.title?.romaji || ''));
    for (const res of a.resources?.nodes || []) themesByAnilist[res.externalId] = themes;
  }
}

async function animeQuestion(difficulty) {
  const [a, b] = ANIME_PAGES[difficulty] || ANIME_PAGES.all;
  for (let attempt = 0; attempt < 4; attempt++) {
    const media = await anilistPage(a + rand(b - a + 1));
    await loadThemes(media.map(m => m.id));
    const withThemes = media.filter(m => themesByAnilist[m.id]?.length && !animeOut.has(m.id));
    if (!withThemes.length) continue;
    const fresh = withThemes.filter(m => !isRecentWork(workKey(m.title.romaji)) && themesByAnilist[m.id].some(t => !recent.has(`at:${t.id}`)));
    if (!fresh.length && attempt < 3) continue; // tous déjà vus récemment : autre page
    const m = pick(fresh.length ? fresh : withThemes);
    const themes = themesByAnilist[m.id];
    const ops = themes.filter(t => t.type === 'OP');
    const pool = ops.length && Math.random() < 0.8 ? ops : themes;
    const order = [...pool].sort(() => Math.random() - 0.5);
    const theme = order.find(t => !recent.has(`at:${t.id}`)) || order[0];
    const entry = theme.entries.find(e => !e.spoiler) || theme.entries[0];
    // On préfère la version 720p avec génériques (plus légère, plus reconnaissable).
    const videos = [...entry.videos.nodes].sort((x, y) =>
      (x.nc - y.nc) || (Math.abs((x.resolution || 720) - 720) - Math.abs((y.resolution || 720) - 720)));
    const video = videos[0];
    const name = m.title.english || m.title.romaji;
    const kind = theme.type === 'OP' ? 'Opening' : 'Ending';
    const artists = (theme.song?.performances || []).map(p => p.alias || p.artist?.name?.main).filter(Boolean).join(', ');
    return {
      key: `at:${theme.id}`,
      work: workKey(m.title.romaji),
      cat: 'anime',
      kind: 'video',
      src: video.link,
      title: name,
      altTitle: m.title.english && m.title.romaji !== m.title.english ? m.title.romaji : '',
      subtitle: [`${kind}${theme.sequence ? ' ' + theme.sequence : ''}`, [theme.song?.title?.romaji, artists].filter(Boolean).join(' — ')].filter(Boolean).join(' · '),
      year: m.seasonYear ? String(m.seasonYear) : '',
      cover: m.coverImage?.extraLarge,
      backdrop: m.bannerImage || m.coverImage?.extraLarge,
      color: m.coverImage?.color,
    };
  }
  throw new Error('aucun opening trouvé');
}

// ---------- Vidéos de fond à la révélation ----------
// Musique : extrait du clip officiel (Apple, MP4 de 30 s, sans clé).
// Films, séries, Disney, dessins animés, jeux : bande-annonce YouTube référencée par Wikidata (sans clé).
const BG_KEY = 'blindr.bg2'; // v2 : les anciens résultats pouvaient contenir des clips sans rapport avec le film
const BG_MAX = 3000;
const bgCache = load(BG_KEY, {});
function bgRemember(key, value) {
  bgCache[key] = value;
  const keys = Object.keys(bgCache);
  if (keys.length > BG_MAX) keys.slice(0, keys.length - BG_MAX).forEach(k => delete bgCache[k]);
  save(BG_KEY, bgCache);
}

const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\(.*?\)|\[.*?\]|feat\..*$|ft\..*$/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const looseMatch = (a, b) => { a = norm(a); b = norm(b); return !!a && !!b && (a.startsWith(b) || b.startsWith(a)); };

// mustMention : pour une BO, le clip n'est gardé que s'il est rattaché à l'œuvre
// (« Let It Go (From "Frozen") » reprend les images du film ; le clip de Ronan Keating n'a rien à voir avec Notting Hill).
async function itunesClip(artist, song, mustMention = '') {
  const term = encodeURIComponent(`${artist} ${song}`);
  const r = await fetch(`https://itunes.apple.com/search?term=${term}&entity=musicVideo&limit=8&country=fr`);
  if (!r.ok) throw new Error('itunes ' + r.status);
  const d = await r.json();
  const firstArtist = artist.split(/,|&| et | x | feat/i)[0];
  const work = norm(mustMention);
  const hit = (d.results || []).find(r => r.previewUrl && looseMatch(r.trackName, song) &&
    (norm(r.artistName).includes(norm(firstArtist)) || norm(firstArtist).includes(norm(r.artistName))) &&
    (!work || norm(`${r.trackName} ${r.trackCensoredName || ''} ${r.collectionName || ''}`.replace(/[()]/g, ' ')).includes(work)));
  return hit ? { t: 'mp4', src: hit.previewUrl } : null;
}

const WD_TYPES = {
  films: /film|long metrage|court metrage/,
  disney: /film|long metrage|animation/,
  series: /serie|feuilleton|sitcom|emission/,
  cartoons: /serie|dessin anime|animation|anime|emission/,
  games: /jeu video|video game/,
};
// Recherche Wikidata : pour chaque résultat, sa description (« film américain de 1989 »…) et ses bandes-annonces.
const WD_KEY = 'blindr.wd2'; // v2 : + libellés
const wdCache = load(WD_KEY, {});
async function wikidataEntities(name) {
  const key = norm(name);
  if (!key) return [];
  if (wdCache[key]) return wdCache[key];
  const api = 'https://www.wikidata.org/w/api.php?format=json&origin=*';
  const s = await wikiFetch(`${api}&action=wbsearchentities&language=fr&uselang=fr&type=item&limit=7&search=${encodeURIComponent(name)}`);
  const ids = (s.search || []).map(x => x.id);
  let ents = [];
  if (ids.length) {
    const e = await wikiFetch(`${api}&action=wbgetentities&props=claims|descriptions|labels&languages=fr|en&ids=${ids.join('|')}`);
    ents = ids.map(id => e.entities?.[id]).filter(Boolean).map(ent => ({
      l: ent.labels?.fr?.value || ent.labels?.en?.value || '',
      d: norm(ent.descriptions?.fr?.value || ent.descriptions?.en?.value || ''),
      yt: (ent.claims?.P1651 || []).map(c => c.mainsnak?.datavalue?.value).filter(Boolean).slice(0, 2),
    }));
  }
  wdCache[key] = ents;
  const keys = Object.keys(wdCache);
  if (keys.length > 2000) keys.slice(0, keys.length - 2000).forEach(k => delete wdCache[k]);
  save(WD_KEY, wdCache);
  return ents;
}

// Interprètes / albums de compilations de génériques de séries télé.
const SERIES_SOURCE_RE = /s[ée]ries|g[ée]n[ée]ration tv|top tv|compilation g[ée]n[ée]rique tv|kitsch and camp|tv toons|prime time|hollywood'?s? martins|edwin davids|towenda|crypt|hit crew/i;
const SERIES_RE = /serie(?! d(e|') (jeux|films|livres|romans|bandes|albums|comics|mangas))|sitcom|feuilleton|telefilm|emission|telenovela|tv series|television series/;
const ANIMATED_RE = /anim|dessin|cartoon|manga/;

// Quand l'œuvre n'est pas évidente : renvoie son nom (string), true (le titre est déjà le nom de l'œuvre),
// ou false (le morceau n'a rien à faire dans cette catégorie).
// TVmaze : nom, type (Animation, Scripted…), autres titres (dont les titres français) et affiche.
const TV_KEY = 'blindr.tv2'; // v2 : correspondance des noms plus stricte
const tvCache = load(TV_KEY, {});
async function tvmazeShow(name) {
  const key = norm(name);
  if (!key) return null;
  if (key in tvCache) return tvCache[key];
  const r = await fetch(`https://api.tvmaze.com/singlesearch/shows?embed=akas&q=${encodeURIComponent(name)}`);
  let show = null;
  if (r.ok) {
    const d = await r.json();
    const names = [d.name, ...((d._embedded?.akas || []).map(a => a.name))].filter(Boolean);
    // TVmaze cherche large : on ne garde le résultat que si un de ses titres correspond vraiment.
    if (names.some(n => sameName(n, name))) show = { n: d.name, t: d.type, img: d.image?.original || d.image?.medium || null };
  } else if (r.status !== 404) {
    throw new Error('tvmaze ' + r.status);
  }
  tvCache[key] = show;
  const keys = Object.keys(tvCache);
  if (keys.length > 2000) keys.slice(0, keys.length - 2000).forEach(k => delete tvCache[k]);
  save(TV_KEY, tvCache);
  return show;
}

// « Pour l'amour du risque » ≈ « L'amour du risque », « Flipper » ≈ « Flipper le dauphin ».
// Le nom court doit couvrir au moins la moitié du long (« The Tetris Murders » ≠ « Tetris »).
function sameName(a, b) {
  a = norm(a).replace(/^(the|le|la|les|l)\s+/, ''); b = norm(b).replace(/^(the|le|la|les|l)\s+/, '');
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return long.includes(short) && short.length / long.length >= 0.5;
}

// Descriptions Wikidata qui désignent une œuvre musicale ou un artiste (pas un film ni un jeu).
const MUSIC_RE = /\balbum\b|chanson|single|\bep\b|groupe|musicien|chanteu|rappeu|compositeu/;

export async function checkWork(catId, album, song, artist = '') {
  const type = WD_TYPES[catId];
  if (catId === 'films' || catId === 'disney' || catId === 'games') {
    // Album au nom de l'œuvre (« Batman » de Prince, « Le grand bleu »…) : on vérifie sur Wikidata.
    const names = [];
    const a = cleanWork(album || '');
    if (a && !COMPIL_RE.test(album) && norm(a) !== norm(song)) names.push(a);
    if (catId === 'games') names.push(cleanShowTitle(song)); // reprises : le titre est souvent le nom du jeu
    const who = norm(artist);
    for (const n of names) {
      const ents = await wikidataEntities(n);
      // On regarde ce que le nom désigne en premier : un film/jeu, ou un album/une chanson/un groupe ?
      // Ex. « Nevermind » : l'album de Nirvana passe avant le film homonyme, donc ce n'est pas un film.
      const first = ents.find(e => type.test(e.d) || MUSIC_RE.test(e.d));
      if (!first || !type.test(first.d)) continue;
      if (who && who.length > 2 && first.d.includes(who)) continue; // « album de <l'artiste> »
      return n;
    }
    return false;
  }
  if (catId === 'series' || catId === 'cartoons') {
    // Le titre doit être le nom d'une série (pas celui d'une chanson, comme « Je m'appelle Hélène »),
    // et en Dessins animés, d'une série animée (pas « L'amour du risque »).
    const name = cleanShowTitle(song);
    const tv = await tvmazeShow(name);
    if (catId === 'cartoons') {
      // Gardé dès qu'une version animée porte ce nom ; écarté seulement si c'est une série non animée confirmée.
      if (tv?.t === 'Animation') return true;
      const ents = await wikidataEntities(name);
      // Preuve d'une version animée : correspondance souple (« Nicky Larson: Private Eyes, film d'animation »).
      const n = norm(name);
      if (ents.some(e => ANIMATED_RE.test(e.d) && (norm(e.l).includes(n) || n.includes(norm(e.l))) && norm(e.l).length > 2)) return true;
      if (SERIES_SOURCE_RE.test(`${artist} ${album}`)) return false; // tiré d'une compilation de génériques de séries
      return !ents.some(e => SERIES_RE.test(e.d) && sameName(e.l, name)); // série non animée confirmée
    }
    // Séries : Wikidata d'abord (TVmaze a des homonymes, comme une émission « Tetris »).
    const ents = await wikidataEntities(name);
    // Série animée : elle appartient aux Dessins animés.
    const hit = ents.find(e => (SERIES_RE.test(e.d) || ANIMATED_RE.test(e.d)) && sameName(e.l, name));
    if (hit) return !ANIMATED_RE.test(hit.d);
    if (tv?.t === 'Animation') return false;
    if (ents.some(e => MUSIC_RE.test(e.d) && sameName(e.l, name))) return false; // une chanson (« Je m'appelle Hélène »)
    if (tv) return true; // série connue de TVmaze (« Batman » 1966)
    if (ents.some(e => /\bfilm\b|jeu video|video game/.test(e.d) && sameName(e.l, name))) return false; // un film ou un jeu (« Tetris »)
    return true; // inconnu (vieux génériques peu documentés) : on garde
  }
  return true; // anime (repli Deezer)
}

async function wikidataTrailer(name, catId) {
  const type = WD_TYPES[catId];
  for (const e of await wikidataEntities(name)) {
    if (type && !type.test(e.d)) continue; // évite les homonymes (livre, chanson, personnage…)
    if (e.yt.length) return { t: 'yt', id: e.yt[0], start: catId === 'games' ? 5 : 12 };
  }
  return null;
}

// ---------- Image de l'œuvre (quand la pochette est celle d'une compilation) ----------
const IMG_KEY = 'blindr.img';
const imgCache = load(IMG_KEY, {});

async function tvmazeImage(name) {
  return (await tvmazeShow(name))?.img || null;
}

async function wikiImage(lang, query) {
  const u = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrlimit=1` +
    `&gsrsearch=${encodeURIComponent(query)}&prop=pageimages&piprop=thumbnail&pithumbsize=1000`;
  const d = await wikiFetch(u);
  const page = Object.values(d.query?.pages || {})[0];
  return page?.thumbnail?.source || null;
}

const WIKI_HINT = {
  series: 'série télévisée', cartoons: 'série d\'animation', films: 'film', disney: 'film Disney', games: 'jeu vidéo',
};
export async function findImage(q) {
  if (!q.genericCover || !q.title) return null;
  const key = `${q.cat}:${norm(q.title)}`;
  if (key in imgCache) return imgCache[key];
  let img = null;
  try {
    if (q.cat === 'series' || q.cat === 'cartoons') img = await tvmazeImage(q.title);
    if (!img) img = q.image || await wikiImage('fr', `${q.title} ${WIKI_HINT[q.cat] || ''}`);
    if (!img) img = await wikiImage('en', `${q.title} ${q.cat === 'games' ? 'video game' : q.cat === 'series' ? 'TV series' : 'film'}`);
  } catch {
    return null; // erreur réseau : on ne mémorise pas
  }
  imgCache[key] = img;
  const keys = Object.keys(imgCache);
  if (keys.length > 2000) keys.slice(0, keys.length - 2000).forEach(k => delete imgCache[k]);
  save(IMG_KEY, imgCache);
  return img;
}

export async function findBackground(q) {
  if (q.kind !== 'audio') return null;
  const cat = CAT_BY_ID[q.cat];
  const key = cat.work ? `w:${q.cat}:${norm(q.search)}` : `m:${q.key}`;
  if (key in bgCache) return bgCache[key];
  let bg = null;
  try {
    if (cat.work) {
      if (q.search) bg = await wikidataTrailer(q.search, q.cat);
      // Pas de bande-annonce : la chanson du film a peut-être un clip officiel.
      if (!bg && q.artist && q.song) bg = await itunesClip(q.artist, q.song, q.title);
    } else if (q.artist) {
      bg = await itunesClip(q.artist, q.song);
    }
  } catch {
    return null; // erreur réseau : on ne mémorise pas, on réessaiera plus tard
  }
  bgRemember(key, bg);
  return bg;
}

// ---------- Catalogue ----------
// Niveau d'un rang de popularité (0 = le plus connu) : mêmes bornes que les niveaux de jeu.
const levelOf = r => (r < 0.3 ? 'easy' : r < 0.65 ? 'medium' : 'hard');
const coverUrl = m => (m ? `https://e-cdns-images.dzcdn.net/images/cover/${m}/112x112-000000-80-0-0.jpg` : null);

// Nom provisoire d'un morceau pas encore analysé.
function guessName(catId, it) {
  return guessNameRaw(catId, it).replace(/^["“”«»\s]+|["“”«»\s]+$/g, '').replace(/^["“](.+?)["”]/, '$1') || cleanTitle(it.t || '');
}
function guessNameRaw(catId, it) {
  const cat = CAT_BY_ID[catId];
  if (!cat.work) return cleanTitle(it.t || '');
  const w = findWork(it.t || '', it.al || '');
  if (w) return w;
  if (catId === 'series' || catId === 'cartoons' || catId === 'anime') return cleanShowTitle(cleanTitle(it.t || ''));
  const a = cleanWork(it.al || '');
  return a && !COMPIL_RE.test(it.al || '') ? a : cleanTitle(it.t || '');
}

// Lignes du catalogue pour une catégorie Deezer.
export async function catalogItems(catId) {
  const items = await loadPool(catId);
  const cat = CAT_BY_ID[catId];
  return items.map(it => {
    const id = identCache[it.id];
    const v = id?.v ?? popById[it.id];
    const byPop = POP_CATS.has(catId) && v != null;
    const song = cleanTitle(it.t || '');
    const name = id?.n || guessName(catId, it);
    return {
      id: it.id,
      name,
      sub: cat.work ? [norm(song) !== norm(name) ? song : '', it.a && !GENERIC_ARTIST.test(it.a) ? it.a : ''].filter(Boolean).join(' — ') : it.a,
      cover: coverUrl(it.m),
      level: levelOf(byPop ? popRank(catId, v) : it.p ?? 0.5),
      exact: !POP_CATS.has(catId) || byPop,       // niveau tiré de la notoriété réelle (sinon rang Deezer)
      checked: !cat.work || !!id,                 // œuvre identifiée
      state: userOut.has(it.id) ? 'user' : rejected.has(it.id) ? 'auto' : 'ok',
    };
  });
}

// Analyse d'un titre du catalogue (sans requête Deezer) : identifie l'œuvre et mesure sa notoriété.
export async function analyzeTrack(catId, id) {
  const it = (await loadPool(catId)).find(x => x.id === id);
  if (!it || identCache[id] || rejected.has(id)) return 'skip';
  const r = await identify(catId, { id, title: it.t || '', album: { title: it.al || '' }, artist: { name: it.a || '' } });
  return r === undefined ? 'retry' : r ? 'ok' : 'rejected';
}
export const wikiPausedFor = () => Math.max(0, wikiPauseUntil - Date.now());

// Extrait à jour (les liens Deezer expirent).
export async function trackPreview(id) {
  const t = await jsonp(`${DZ}/track/${id}`);
  return t?.preview || null;
}

// Anime : les 1 000 plus populaires d'AniList, par pages de 50 (niveau selon la page, comme en jeu).
export async function animeCatalogPage(page) {
  const media = await anilistPage(page);
  const level = page <= 2 ? 'easy' : page <= 6 ? 'medium' : 'hard';
  return media.map(m => ({
    id: m.id, anime: true,
    name: m.title.english || m.title.romaji,
    sub: [m.title.english && m.title.romaji !== m.title.english ? m.title.romaji : '', m.seasonYear || ''].filter(Boolean).join(' · '),
    cover: m.coverImage?.extraLarge, level, exact: true, checked: true,
    state: animeOut.has(m.id) ? 'user' : 'ok',
  }));
}
export async function animeOpening(id) {
  await loadThemes([id]);
  const themes = themesByAnilist[id] || [];
  const t = themes.find(x => x.type === 'OP') || themes[0];
  if (!t) return null;
  const entry = t.entries.find(e => !e.spoiler) || t.entries[0];
  const v = [...entry.videos.nodes].sort((x, y) => (x.nc - y.nc) || (Math.abs((x.resolution || 720) - 720) - Math.abs((y.resolution || 720) - 720)))[0];
  return v?.link || null;
}

// ---------- Point d'entrée ----------
export async function nextQuestion(settings) {
  const cats = settings.categories.length ? settings.categories : Object.keys(CAT_BY_ID);
  for (let attempt = 0; attempt < 5; attempt++) {
    const catId = pick(cats);
    try {
      if (catId === 'anime' && settings.animeVideo && animeVideoSupported()) {
        try {
          const q = await animeQuestion(settings.difficulty);
          anime.failures = 0;
          return q;
        } catch (e) {
          if (++anime.failures >= 3) anime.ok = false; // on bascule sur l'audio Deezer
          console.warn('Anime vidéo indisponible, repli sur Deezer', e);
        }
      }
      return await deezerQuestion(catId, settings.difficulty);
    } catch (e) {
      console.warn('Question impossible pour', catId, e);
    }
  }
  throw new Error('Impossible de générer une question. Vérifie ta connexion.');
}

export const reportVideoFailure = () => { if (++anime.failures >= 3) anime.ok = false; };
