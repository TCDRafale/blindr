// Génération des questions à partir du catalogue commun (data/catalog, construit par tools/build-catalog.mjs).
// Deezer ne sert plus qu'à obtenir un lien d'extrait frais ; les anime ajoutent les openings vidéo d'AnimeThemes.
import { CAT_BY_ID } from './catalog.js';
import { norm, workKey, cleanTitle, cleanShowTitle, cleanWork, COMPIL_RE, GENERIC_ARTIST } from './names.js';

export { workKey };
const DZ = 'https://api.deezer.com';
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

// ---------- Historique ----------
// Morceaux déjà joués, pour éviter les répétitions.
const recent = new Set(load(RECENT_KEY, []));
// Œuvres (film, série, jeu, anime…) : une même œuvre ne revient pas avant WORK_GAP extraits.
const WORKS_KEY = 'blindr.works';
const WORK_GAP = 100;
let recentWorks = load(WORKS_KEY, []);
const isRecentWork = w => !!w && recentWorks.includes(w);

// songKey : même chanson sous un autre identifiant Deezer (remaster, compilation, autre catégorie).
export function markPlayed(key, work = '', songKey = '') {
  for (const k of [key, songKey]) { if (!k) continue; recent.delete(k); recent.add(k); }
  while (recent.size > RECENT_MAX) recent.delete(recent.values().next().value);
  save(RECENT_KEY, [...recent]);
  recentWorks = [...recentWorks, work || ''].slice(-WORK_GAP);
  save(WORKS_KEY, recentWorks);
}
export function resetHistory() { recent.clear(); save(RECENT_KEY, []); recentWorks = []; save(WORKS_KEY, []); }

// ---------- Choix faits dans le catalogue (sur cet appareil) ----------
// out : œuvres ou titres exclus ; keep : titres écartés par le tri mais remis en jeu ({ cat, name, label }) ;
// anime : anime AniList exclus. Exportables pour être intégrés au catalogue commun (tools/overrides.json).
const USER_KEY = 'blindr.user2';
const user = load(USER_KEY, { out: {}, keep: {}, anime: [] });
const animeOut = new Set(user.anime);
const saveUser = () => { user.anime = [...animeOut]; save(USER_KEY, user); };
// key : 'w:<Qid>' (œuvre), 'n:<cat>:<nom>' (œuvre sans Qid) ou 'd:<id Deezer>' (titre).
export function setExcluded(key, label, out = true) { if (out) user.out[key] = label; else delete user.out[key]; saveUser(); }
export function setKept(id, info) { if (info) user.keep[id] = info; else delete user.keep[id]; saveUser(); }
export function excludeAnime(id, out = true) { out ? animeOut.add(id) : animeOut.delete(id); saveUser(); }

// Texte à transmettre pour intégrer les corrections au catalogue commun.
export function correctionsText() {
  const tracks = {}, works = {};
  for (const [k, label] of Object.entries(user.out)) {
    if (k.startsWith('w:')) works[k.slice(2)] = { out: true, _: label };
    else if (k.startsWith('d:')) tracks[k.slice(2)] = { out: true, _: label };
    else works[k] = { out: true, _: label };
  }
  for (const [id, v] of Object.entries(user.keep)) tracks[id] = { cat: v.cat, work: v.name, _: v.label };
  const anime = [...animeOut];
  const n = Object.keys(tracks).length + Object.keys(works).length + anime.length;
  return { n, text: 'Corrections Blindr\n' + JSON.stringify({ tracks, works, ...(anime.length ? { animeOut: anime } : {}) }, null, 1) };
}

// ---------- Catalogue ----------
const catalogs = {};
export function loadCatalog(catId) {
  if (!catalogs[catId]) {
    catalogs[catId] = fetch(`data/catalog/${catId}.json`, { cache: 'no-cache' })
      .then(r => { if (!r.ok) throw new Error('catalogue ' + r.status); return r.json(); })
      .catch(e => { delete catalogs[catId]; throw e; });
  }
  return catalogs[catId];
}
export const loadPool = loadCatalog; // préchauffage au lancement de la partie

// Niveaux du jeu → niveaux du catalogue (0 facile, 1 moyen, 2 difficile).
const LEVELS = { easy: [0], medium: [0, 1], hard: [1, 2], all: [0, 1, 2] };
const coverUrl = (m, size = 1000) => (m ? `https://e-cdns-images.dzcdn.net/images/cover/${m}/${size}x${size}-000000-80-0-0.jpg` : null);
const workId = (catId, w) => (w.q ? `w:${w.q}` : `n:${catId}:${norm(w.n)}`);

// Nom proposé pour un titre écarté par le tri qu'on remet en jeu.
export function guessName(catId, t) {
  if (['series', 'cartoons', 'anime', 'tv'].includes(catId)) return cleanShowTitle(cleanTitle(t.s || ''));
  const a = t.al && !COMPIL_RE.test(t.al) ? cleanWork(t.al) : '';
  return a || cleanTitle(t.s || '');
}

// Œuvres jouables d'une catégorie : catalogue, moins les exclusions, plus les titres remis en jeu.
async function playableWorks(catId) {
  const data = await loadCatalog(catId);
  const works = (data.works || []).filter(w => !user.out[workId(catId, w)])
    .map(w => ({ ...w, t: w.t.filter(t => !user.out[`d:${t.d}`]) })).filter(w => w.t.length);
  for (const [id, k] of Object.entries(user.keep)) {
    if (k.cat !== catId) continue;
    const t = (data.out || []).find(x => String(x.d) === String(id));
    if (t) works.push({ n: k.name, pv: 0, lvl: 1, t: [t] });
  }
  return works;
}

async function playableItems(catId) {
  const data = await loadCatalog(catId);
  const items = (data.items || []).filter(t => !user.out[`d:${t.d}`]);
  for (const [id, k] of Object.entries(user.keep)) {
    if (k.cat !== catId) continue;
    const t = (data.out || []).find(x => String(x.d) === String(id));
    if (t) items.push({ ...t, lvl: 1 });
  }
  return items;
}

// Lien d'extrait frais et infos du morceau (les liens Deezer expirent).
async function deezerTrack(id) {
  const t = await jsonp(`${DZ}/track/${id}`);
  if (!t || !t.preview) throw new Error('extrait indisponible');
  return t;
}
const validImg = url => url && !/\/images\/(artist|cover)\/\//.test(url);
const songKeyOf = (artist, song) => `s:${norm((artist || '').split(/,|&| feat/i)[0])}|${norm(cleanTitle(song || ''))}`;

function byLevel(all, difficulty) {
  const lv = LEVELS[difficulty] || LEVELS.all;
  const pool = all.filter(x => lv.includes(x.lvl ?? 1));
  return pool.length ? pool : all;
}

async function workQuestion(catId, difficulty) {
  const all = await playableWorks(catId);
  if (!all.length) throw new Error('catalogue vide');
  const pool = byLevel(all, difficulty);
  for (let attempt = 0; attempt < 10; attempt++) {
    let w;
    for (let i = 0; i < 40; i++) {
      w = pick(pool);
      if (!isRecentWork(workKey(w.n)) && w.t.some(t => !recent.has(`dz:${t.d}`))) break;
    }
    // Le morceau le plus emblématique le plus souvent, les autres de temps en temps.
    const fresh = w.t.filter(t => !recent.has(`dz:${t.d}`));
    const choices = fresh.length ? fresh : w.t;
    const tr = choices[0] === w.t[0] && Math.random() < 0.65 ? choices[0] : pick(choices);
    let t;
    try { t = await deezerTrack(tr.d); } catch { continue; }
    const artist = t.artist?.name || tr.a || '';
    const song = cleanTitle(t.title_short || t.title || tr.s);
    const showArtist = artist && !GENERIC_ARTIST.test(artist);
    const albumCover = validImg(t.album?.cover_xl) ? t.album.cover_xl : coverUrl(tr.m);
    return {
      key: `dz:${t.id}`,
      work: workKey(w.n),
      cat: catId,
      kind: 'audio',
      src: t.preview,
      title: w.n,
      subtitle: [norm(song) !== norm(w.n) ? song : '', showArtist ? artist : ''].filter(Boolean).join(' — '),
      year: w.y ? String(w.y) : '',
      cover: w.img || albumCover,
      backdrop: w.img || albumCover,
      genericCover: false,
      bgYt: w.yt || null,
      link: t.link,
      artist,
      song,
      search: w.n,
    };
  }
  throw new Error('aucun extrait disponible');
}

async function musicQuestion(catId, difficulty) {
  const all = await playableItems(catId);
  if (!all.length) throw new Error('catalogue vide');
  const pool = byLevel(all, difficulty);
  for (let attempt = 0; attempt < 10; attempt++) {
    let it;
    for (let i = 0; i < 40; i++) {
      it = pick(pool);
      if (!recent.has(`dz:${it.d}`) && !recent.has(songKeyOf(it.a, it.s))) break;
    }
    let t;
    try { t = await deezerTrack(it.d); } catch { continue; }
    const artist = t.artist?.name || it.a;
    const song = it.n || cleanTitle(t.title_short || t.title);
    const year = (t.album?.release_date || t.release_date || '').slice(0, 4);
    const cover = validImg(t.album?.cover_xl) ? t.album.cover_xl : coverUrl(it.m);
    const artistPic = validImg(t.artist?.picture_xl) ? t.artist.picture_xl : null;
    return {
      key: `dz:${t.id}`,
      work: '',
      songKey: songKeyOf(artist, song),
      cat: catId,
      kind: 'audio',
      src: t.preview,
      title: song,
      subtitle: artist,
      year: year && year !== '0000' ? year : '',
      cover,
      backdrop: artistPic || cover,
      genericCover: false,
      link: t.link,
      artist,
      song,
      search: null,
    };
  }
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
// On préfère la version 720p avec génériques (plus légère, plus reconnaissable).
const bestVideo = entry => [...entry.videos.nodes].sort((x, y) =>
  (x.nc - y.nc) || (Math.abs((x.resolution || 720) - 720) - Math.abs((y.resolution || 720) - 720)))[0];

async function animeQuestion(difficulty) {
  const [a, b] = ANIME_PAGES[difficulty] || ANIME_PAGES.all;
  for (let attempt = 0; attempt < 4; attempt++) {
    const media = await anilistPage(a + rand(b - a + 1));
    await loadThemes(media.map(m => m.id));
    const shared = new Set((await loadCatalog('anime').catch(() => ({}))).aniOut || []);
    const withThemes = media.filter(m => themesByAnilist[m.id]?.length && !animeOut.has(m.id) && !shared.has(m.id));
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
    const video = bestVideo(entry);
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
// Musique : extrait du clip officiel (Apple, MP4 de 30 s, sans clé). Œuvres : bande-annonce YouTube du catalogue,
// sinon le clip de la chanson s'il est rattaché à l'œuvre.
const BG_KEY = 'blindr.bg3';
const BG_MAX = 3000;
const bgCache = load(BG_KEY, {});
function bgRemember(key, value) {
  bgCache[key] = value;
  const keys = Object.keys(bgCache);
  if (keys.length > BG_MAX) keys.slice(0, keys.length - BG_MAX).forEach(k => delete bgCache[k]);
  save(BG_KEY, bgCache);
}
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

export async function findBackground(q) {
  if (q.kind !== 'audio') return null;
  const cat = CAT_BY_ID[q.cat];
  if (cat.work && q.bgYt) return { t: 'yt', id: q.bgYt, start: q.cat === 'games' ? 5 : 12 };
  const key = cat.work ? `w:${q.cat}:${norm(q.search)}` : `m:${q.key}`;
  if (key in bgCache) return bgCache[key];
  let bg = null;
  try {
    if (q.artist && q.song) bg = await itunesClip(q.artist, q.song, cat.work ? q.title : '');
  } catch {
    return null; // erreur réseau : on ne mémorise pas, on réessaiera plus tard
  }
  bgRemember(key, bg);
  return bg;
}
// Les images des œuvres viennent du catalogue.
export async function findImage() { return null; }

// ---------- Écran Catalogue ----------
const ROW_LEVEL = ['easy', 'medium', 'hard'];
// Lignes d'une catégorie : œuvres (ou titres), puis titres écartés par le tri avec leur raison.
export async function catalogRows(catId) {
  const data = await loadCatalog(catId);
  const rows = [];
  for (const w of data.works || []) {
    const key = workId(catId, w);
    const first = w.t[0];
    rows.push({
      key, id: first.d, label: w.n, name: w.n,
      sub: [w.y, `${first.s} — ${first.a}`, w.t.length > 1 ? `+${w.t.length - 1} extrait${w.t.length > 2 ? 's' : ''}` : ''].filter(Boolean).join(' · '),
      cover: w.img || coverUrl(first.m, 120), level: ROW_LEVEL[w.lvl ?? 1],
      state: user.out[key] ? 'user' : 'ok',
    });
  }
  for (const t of data.items || []) {
    const key = `d:${t.d}`;
    rows.push({ key, id: t.d, label: `${t.s} — ${t.a}`, name: t.n || t.s, sub: t.a, cover: coverUrl(t.m, 120), level: ROW_LEVEL[t.lvl ?? 1], state: user.out[key] ? 'user' : 'ok' });
  }
  for (const t of data.out || []) {
    const kept = user.keep[t.d];
    rows.push({
      key: `d:${t.d}`, id: t.d, label: `${t.s} — ${t.a}`, name: kept?.name || t.s,
      sub: kept ? `${t.s} — ${t.a} · remis en jeu` : `${t.a} · ${t.why}`,
      cover: coverUrl(t.m, 120), level: 'medium', state: kept ? 'ok' : 'auto', kept: !!kept, raw: t,
    });
  }
  return rows;
}
export async function trackPreview(id) { return (await deezerTrack(id)).preview; }

// Anime : les 1 000 plus populaires d'AniList, par pages de 50 (niveau selon la page, comme en jeu).
export async function animeCatalogPage(page) {
  const media = await anilistPage(page);
  const level = page <= 2 ? 'easy' : page <= 6 ? 'medium' : 'hard';
  return media.map(m => ({
    key: `a:${m.id}`, id: m.id, anime: true, label: m.title.romaji,
    name: m.title.english || m.title.romaji,
    sub: ['Opening vidéo', m.title.english && m.title.romaji !== m.title.english ? m.title.romaji : '', m.seasonYear || ''].filter(Boolean).join(' · '),
    cover: m.coverImage?.extraLarge, level,
    state: animeOut.has(m.id) ? 'user' : 'ok',
  }));
}
export async function animeOpening(id) {
  await loadThemes([id]);
  const themes = themesByAnilist[id] || [];
  const t = themes.find(x => x.type === 'OP') || themes[0];
  if (!t) return null;
  const entry = t.entries.find(e => !e.spoiler) || t.entries[0];
  return bestVideo(entry)?.link || null;
}

// ---------- Point d'entrée ----------
export async function nextQuestion(settings) {
  const cats = settings.categories.length ? settings.categories : Object.keys(CAT_BY_ID);
  for (let attempt = 0; attempt < 5; attempt++) {
    const catId = pick(cats);
    try {
      if (catId === 'anime') {
        // Openings japonais en vidéo et génériques français du catalogue, à parts à peu près égales.
        const video = settings.animeVideo && animeVideoSupported();
        const fr = (await playableWorks('anime').catch(() => [])).length > 0;
        if (video && (!fr || Math.random() < 0.55)) {
          try {
            const q = await animeQuestion(settings.difficulty);
            anime.failures = 0;
            return q;
          } catch (e) {
            if (++anime.failures >= 3) anime.ok = false;
            console.warn('Anime vidéo indisponible', e);
          }
        }
        return await workQuestion('anime', settings.difficulty);
      }
      return CAT_BY_ID[catId].work ? await workQuestion(catId, settings.difficulty) : await musicQuestion(catId, settings.difficulty);
    } catch (e) {
      console.warn('Question impossible pour', catId, e);
    }
  }
  throw new Error('Impossible de générer une question. Vérifie ta connexion.');
}

export const reportVideoFailure = () => { if (++anime.failures >= 3) anime.ok = false; };
