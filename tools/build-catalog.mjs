#!/usr/bin/env node
// Construit le catalogue commun de Blindr (data/catalog/<catégorie>.json), lu par tous les appareils.
//
//   node tools/build-catalog.mjs            construit (les réponses des API sont mises en cache dans tools/.cache)
//   node tools/build-catalog.mjs --refresh  re-télécharge les playlists Deezer (le reste du cache est gardé)
//
// Étapes :
//  1. Morceaux de toutes les playlists Deezer des catégories (js/catalog.js).
//  2. Œuvres (films, séries, dessins animés, anime, émissions, jeux) : chaque morceau est rattaché à une entité
//     Wikidata, et c'est le TYPE de cette entité qui décide de la catégorie (pas la playlist d'origine).
//  3. Notoriété : vues de la page Wikipédia française sur 12 mois → niveaux (un tiers par niveau).
//  4. Corrections manuelles (tools/overrides.json), prioritaires sur tout le reste.
//  5. Fichiers du catalogue + page de revue (tools/review.html).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES } from '../js/catalog.js';
import { norm, cleanTitle, cleanShowTitle, cleanWork, findWork, COMPIL_RE, SOUNDTRACK_RE, GENERIC_ARTIST, sameName } from '../js/names.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = path.join(ROOT, 'tools/.cache');
const OUT_DIR = path.join(ROOT, 'data/catalog');
const REFRESH = process.argv.includes('--refresh');
const UA = 'BlindrCatalogBuilder/1.0 (personal blind test project)';

const WORK_CATS = ['films', 'series', 'disney', 'cartoons', 'anime', 'games', 'tv'];
const MUSIC_CATS = CATEGORIES.map(c => c.id).filter(id => !WORK_CATS.includes(id));
const LABEL = Object.fromEntries(CATEGORIES.map(c => [c.id, c.label]));

// ---------- Cache et requêtes ----------
fs.mkdirSync(CACHE_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });
const caches = {};
function cache(name) {
  if (!caches[name]) {
    const f = path.join(CACHE_DIR, `${name}.json`);
    caches[name] = { f, data: fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}, dirty: 0 };
  }
  return caches[name];
}
function saveCaches(force = false) {
  for (const c of Object.values(caches)) {
    if (c.dirty && (force || c.dirty > 25)) { fs.writeFileSync(c.f, JSON.stringify(c.data)); c.dirty = 0; }
  }
}
async function cached(name, key, fn) {
  const c = cache(name);
  if (key in c.data) return c.data[key];
  const v = await fn();
  c.data[key] = v; c.dirty++;
  saveCaches();
  return v;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const GAP = { 'api.deezer.com': 130, 'www.wikidata.org': 250, 'query.wikidata.org': 1200, 'fr.wikipedia.org': 2500, 'wikimedia.org': 120 };
const nextAt = {};
async function http(url, opts = {}, tries = 6) {
  const host = new URL(url).host;
  for (let i = 0; i < tries; i++) {
    const wait = Math.max(0, (nextAt[host] || 0) - Date.now());
    nextAt[host] = Date.now() + wait + (GAP[host] || 200);
    if (wait) await sleep(wait);
    let r;
    try { r = await fetch(url, { ...opts, headers: { 'User-Agent': UA, Accept: 'application/json', ...(opts.headers || {}) } }); } catch { r = null; }
    if (r && r.ok) {
      const text = await r.text();
      try { return JSON.parse(text); } catch { /* page d'erreur HTML : on attend */ }
    }
    if (r && r.status === 404) return null;
    const retryAfter = +(r?.headers.get('retry-after') || 0);
    const pause = Math.max(retryAfter * 1000, 2000 * 2 ** i);
    process.stdout.write(`\n  … ${host} ${r ? r.status : 'réseau'}, nouvelle tentative dans ${Math.round(pause / 1000)} s\n`);
    nextAt[host] = Date.now() + pause;
  }
  throw new Error(`Échec : ${url}`);
}
let lastLine = 0;
function progress(label, i, n) {
  if (Date.now() - lastLine < 400 && i < n) return;
  lastLine = Date.now();
  process.stdout.write(`\r  ${label} ${i}/${n}   `);
  if (i >= n) process.stdout.write('\n');
}

// ---------- 1. Playlists Deezer ----------
async function playlistTracks(pid) {
  const c = cache('playlists');
  if (!REFRESH && c.data[pid]) return c.data[pid];
  const out = [];
  let url = `https://api.deezer.com/playlist/${pid}/tracks?limit=400`;
  while (url && out.length < 2000) {
    const d = await http(url);
    if (!d || d.error) break;
    for (const t of d.data || []) {
      if (!t.preview || t.readable === false) continue;
      out.push({ id: t.id, t: t.title, ts: t.title_short, a: t.artist?.name || '', al: t.album?.title || '', m: t.album?.md5_image || '', r: t.rank || 0 });
    }
    url = d.next || null;
  }
  c.data[pid] = out; c.dirty++;
  saveCaches();
  return out;
}

// ---------- 2. Wikidata ----------
const T = {
  film: 'Q11424', animFilm: 'Q202866', series: 'Q5398426', animSeries: 'Q581714', animeSeries: 'Q63952888',
  animeFilm: 'Q20650540', ova: 'Q220898', tvProg: 'Q15416', game: 'Q7889', gameSeries: 'Q7058673',
  filmSeries: 'Q24856', franchise: 'Q196600', album: 'Q482994', song: 'Q7366', single: 'Q134556',
  musicWork: 'Q2188189', human: 'Q5', band: 'Q215380', character: 'Q95074',
};
const TYPE_OF = Object.fromEntries(Object.entries(T).map(([k, v]) => [v, k]));
// Studios et chaînes Disney (pas tout le groupe : la Fox ou Marvel en font partie, mais Titanic n'est pas un Disney).
const DISNEY = ['Q7414', 'Q191224', 'Q1047410', 'Q127552', 'Q2081339', 'Q178837', 'Q1858139', 'Q3030443', 'Q313173',
  'Q3565599', 'Q2216535', 'Q1392453', 'Q3565642'];

// Recherche des noms par lots via SPARQL (service EntitySearch) : l'API de recherche classique limite très vite
// le débit, pas le point d'accès SPARQL. Résultat par nom : [{ id, l (libellé fr), m (libellé en), d (description) }].
async function searchAll(names, store = 'search', limit = 7) {
  const c = cache(store);
  const todo = [...new Set(names)].filter(n => !(norm(n) in c.data));
  const lit = n => '"' + n.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ') + '"';
  for (let i = 0; i < todo.length; i += 40) {
    progress('Recherches', i, todo.length);
    const batch = todo.slice(i, i + 40);
    const q = `SELECT ?name ?item ?num ?lfr ?len ?dfr WHERE {
      VALUES ?name { ${batch.map(lit).join(' ')} }
      SERVICE wikibase:mwapi { bd:serviceParam wikibase:endpoint "www.wikidata.org"; wikibase:api "EntitySearch";
        mwapi:search ?name; mwapi:language "fr". ?item wikibase:apiOutputItem mwapi:item. ?num wikibase:apiOrdinal true. }
      FILTER(?num < ${limit})
      OPTIONAL { ?item rdfs:label ?lfr FILTER(lang(?lfr) = 'fr') }
      OPTIONAL { ?item rdfs:label ?len FILTER(lang(?len) = 'en') }
      OPTIONAL { ?item schema:description ?dfr FILTER(lang(?dfr) = 'fr') }
    }`;
    const d = await http('https://query.wikidata.org/sparql', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json' },
      body: 'query=' + encodeURIComponent(q),
    });
    const res = Object.fromEntries(batch.map(n => [n, new Map()]));
    for (const b of d.results.bindings) {
      const m = res[b.name.value];
      if (!m) continue;
      const id = b.item.value.split('/').pop();
      if (!m.has(id)) m.set(id, { id, n: +b.num.value, l: b.lfr?.value || b.len?.value || '', m: b.len?.value || '', d: b.dfr?.value || '' });
    }
    for (const n of batch) { c.data[norm(n)] = [...res[n].values()].sort((x, y) => x.n - y.n).map(({ n: _, ...r }) => r); }
    c.dirty += batch.length;
    saveCaches();
  }
  progress('Recherches', todo.length, todo.length);
}

// Type, pays, studio Disney, page Wikipédia française, libellé, bande-annonce et année de chaque entité.
async function classify(ids) {
  const c = cache('entities');
  const todo = [...new Set(ids)].filter(id => !(id in c.data));
  for (let i = 0; i < todo.length; i += 60) {
    progress('Types Wikidata', i, todo.length);
    const batch = todo.slice(i, i + 60);
    const q = `SELECT ?item ?t ?c ?prod ?net ?fr ?lfr ?len ?lmul ?yt ?date WHERE {
      VALUES ?item { ${batch.map(id => 'wd:' + id).join(' ')} }
      OPTIONAL { ?item wdt:P31/wdt:P279* ?t . VALUES ?t { ${Object.values(T).map(v => 'wd:' + v).join(' ')} } }
      OPTIONAL { ?item wdt:P495 ?c }
      OPTIONAL { ?item wdt:P272 ?prod . VALUES ?prod { ${DISNEY.map(v => 'wd:' + v).join(' ')} } }
      OPTIONAL { ?item wdt:P449 ?net . VALUES ?net { ${DISNEY.map(v => 'wd:' + v).join(' ')} } }
      OPTIONAL { ?fr schema:about ?item ; schema:isPartOf <https://fr.wikipedia.org/> }
      OPTIONAL { ?item rdfs:label ?lfr FILTER(lang(?lfr) = 'fr') }
      OPTIONAL { ?item rdfs:label ?len FILTER(lang(?len) = 'en') }
      OPTIONAL { ?item rdfs:label ?lmul FILTER(lang(?lmul) = 'mul') }
      OPTIONAL { ?item wdt:P1651 ?yt }
      OPTIONAL { ?item wdt:P577 ?date }
    }`;
    const d = await http('https://query.wikidata.org/sparql', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json' },
      body: 'query=' + encodeURIComponent(q),
    });
    const ents = Object.fromEntries(batch.map(id => [id, { types: [], countries: [], disney: false, fr: null, lfr: '', len: '', lmul: '', yt: null, year: null }]));
    for (const b of d.results.bindings) {
      const e = ents[b.item.value.split('/').pop()];
      const v = k => b[k]?.value;
      if (v('t')) { const k = TYPE_OF[v('t').split('/').pop()]; if (k && !e.types.includes(k)) e.types.push(k); }
      if (v('c')) { const k = v('c').split('/').pop(); if (!e.countries.includes(k)) e.countries.push(k); }
      if (v('prod') || v('net')) e.disney = true;
      if (v('fr')) e.fr = decodeURIComponent(v('fr').split('/wiki/')[1]).replace(/_/g, ' ');
      if (v('lfr')) e.lfr = v('lfr');
      if (v('len')) e.len = v('len');
      if (v('lmul')) e.lmul = v('lmul');
      if (v('yt') && !e.yt) e.yt = v('yt');
      if (v('date')) { const y = +v('date').slice(0, 4); if (y && (!e.year || y < e.year)) e.year = y; }
    }
    Object.assign(c.data, ents); c.dirty += batch.length;
    saveCaches();
  }
  progress('Types Wikidata', todo.length, todo.length);
  return c.data;
}

const has = (e, ...k) => k.some(x => e.types.includes(x));
const isWorkEntity = e => !e.episode && has(e, 'film', 'animFilm', 'series', 'animSeries', 'animeSeries', 'animeFilm', 'ova', 'tvProg', 'game', 'gameSeries', 'filmSeries', 'franchise');
const isMusicEntity = e => has(e, 'album', 'song', 'single', 'musicWork') && !isWorkEntity(e);
const SHOW_SRC = ['series', 'cartoons', 'anime', 'tv'];

// Épisodes de séries (« Leçon de séduction » n'est pas une émission) et nombre de wikis (pour départager des homonymes :
// « Titanic » de 1997 plutôt que « Le Titanic » de 1943).
async function markExtra(ids, ents) {
  const c = cache('extra');
  const todo = [...new Set(ids)].filter(id => !(id in c.data));
  for (let i = 0; i < todo.length; i += 80) {
    progress('Épisodes et notoriété', i, todo.length);
    const batch = todo.slice(i, i + 80);
    const q = `SELECT ?item ?sl ?ep WHERE { VALUES ?item { ${batch.map(id => 'wd:' + id).join(' ')} }
      OPTIONAL { ?item wikibase:sitelinks ?sl }
      OPTIONAL { ?item wdt:P31/wdt:P279* ?t . VALUES ?t { wd:Q21191270 wd:Q1983062 } BIND(1 AS ?ep) } }`;
    const d = await http('https://query.wikidata.org/sparql', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json' },
      body: 'query=' + encodeURIComponent(q),
    });
    for (const id of batch) c.data[id] = { ep: false, sl: 0 };
    for (const b of d.results.bindings) {
      const x = c.data[b.item.value.split('/').pop()];
      if (b.ep) x.ep = true;
      if (b.sl) x.sl = +b.sl.value;
    }
    c.dirty += batch.length;
    saveCaches();
  }
  progress('Épisodes et notoriété', todo.length, todo.length);
  for (const id of ids) if (ents[id] && c.data[id]) { ents[id].episode = c.data[id].ep; ents[id].sl = c.data[id].sl; }
}

// Catégorie d'une œuvre d'après son type (et pas d'après la playlist d'où vient le morceau).
function categoryOf(e, srcCats) {
  const animated = has(e, 'animFilm', 'animSeries', 'animeSeries', 'animeFilm', 'ova');
  const japanese = e.countries.includes('Q17') && e.countries.every(c => c === 'Q17');
  if (has(e, 'game', 'gameSeries')) return 'games';
  if (has(e, 'animeSeries', 'animeFilm', 'ova') || (animated && japanese)) return 'anime';
  if (has(e, 'film', 'animFilm', 'filmSeries')) {
    // Disney : studios Disney, et seulement l'animation ou ce qui vient des playlists Disney (comédies musicales).
    return e.disney && (animated || srcCats.has('disney')) ? 'disney' : 'films';
  }
  if (has(e, 'series', 'animSeries')) {
    if (animated) return e.disney ? 'disney' : 'cartoons';
    return e.disney && srcCats.has('disney') ? 'disney' : japanese && srcCats.has('anime') ? 'anime' : 'series';
  }
  if (has(e, 'tvProg')) return 'tv';
  if (has(e, 'franchise')) {
    for (const c of ['anime', 'disney', 'games', 'films', 'cartoons', 'series']) if (srcCats.has(c)) return c;
  }
  return null;
}

// Noms possibles de l'œuvre d'un morceau, du plus sûr au moins sûr.
function candidates(t, srcCats) {
  const title = t.t || '';
  const out = [];
  const add = (n, kind) => { n = (n || '').replace(/:(?=\S)/g, ': ').trim(); if (n.length > 1 && !out.some(x => norm(x.n) === norm(n))) out.push({ n, kind }); };
  const fw = findWork(title, t.al);
  if (fw) add(fw, /from|theme|soundtrack|ost|bande/i.test(title) ? 'from' : 'album');
  const albumW = t.al && !COMPIL_RE.test(t.al) ? cleanWork(t.al) : '';
  const titleW = cleanShowTitle(cleanTitle(title));
  const showLike = ['series', 'cartoons', 'anime', 'tv'].some(c => srcCats.has(c));
  // « Goldorak : La légende d'Actarus », « Capitaine Flam: La chevauchée… » : l'œuvre est avant les deux-points.
  const beforeColon = s => (s.match(/^([^:]{2,}?)\s*:\s*\S/) || [])[1] || '';
  if (showLike) { add(titleW, 'title'); add(beforeColon(titleW), 'title'); add(beforeColon(albumW || ''), 'album'); if (norm(albumW) !== norm(title)) add(albumW, 'album'); }
  else { if (norm(albumW) !== norm(title)) add(albumW, 'album'); add(titleW, 'title'); }
  return out;
}

// Libellés de la recherche, complétés par ceux de l'étape des types (la recherche en renvoie parfois de vides).
let ENTS = {};
const frTitle = e => (e?.fr || '').replace(/\s*\([^)]*\)\s*$/, '');
// « Silver Hawks » = « SilverHawks », « Assassin's Creed 3 » = « Assassin's Creed III ».
const ROMAN = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16 };
const squash = s => norm(s).replace(/(?<=\S) (ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii|xiii|xiv|xv|xvi)\b/g, (_, r) => ' ' + ROMAN[r]).replace(/ /g, '');
const labelMatches = (r, name) => [r.l, r.m, ENTS[r.id]?.lfr, ENTS[r.id]?.len, ENTS[r.id]?.lmul, frTitle(ENTS[r.id])].some(x => x && (sameName(x, name) || squash(x) === squash(name)));

// Choisit l'entité d'un nom. Renvoie { id } ou { why } (raison du rejet).
function pick(results, name, kind, artist, ents, srcCats, album = '', title = '') {
  const matched = results.filter(r => labelMatches(r, name) && ents[r.id]);
  if (!matched.length) return { why: 'œuvre introuvable sur Wikidata' };
  const E = r => ents[r.id];
  const who = norm(artist);
  // Album de l'artiste lui-même (« Nevermind » de Nirvana) : ce n'est pas une BO.
  if (who.length > 2 && !SOUNDTRACK_RE.test(album) && matched.some(r => has(E(r), 'album') && !isWorkEntity(E(r)) && norm(r.d).includes(who))) {
    return { why: `album de ${artist}, pas une œuvre` };
  }
  const showSrc = SHOW_SRC.some(c => srcCats.has(c));
  const filmSrc = ['films', 'disney', 'games'].some(c => srcCats.has(c));
  const music = matched.some(r => isMusicEntity(E(r)));
  const works = matched.filter(r => isWorkEntity(E(r)));
  if (!works.length) return { why: music ? 'chanson ou album, pas une œuvre' : 'pas un film, une série, une émission ni un jeu' };
  // L'album dit souvent de quel type d'œuvre il s'agit (« Original Motion Picture Soundtrack », « Video Game Soundtrack »).
  const hint = /video ?game|game (sound|music)|jeu vid/i.test(album) ? 'game'
    : /motion picture|\bfilm\b|\bmovie\b|du film/i.test(album) ? 'film'
    : /\bseries\b|s[ée]rie|\btv\b|t[ée]l[ée]vis/i.test(album) ? 'show' : '';
  // Préférence : une œuvre de la catégorie de la playlist, le type indiqué par l'album, le type attendu (série pour une
  // playlist de génériques, film pour une playlist de BO), puis la plus connue (nombre de wikis).
  const showType = e => has(e, 'series', 'animSeries', 'animeSeries', 'ova', 'tvProg');
  const filmType = e => has(e, 'film', 'animFilm', 'animeFilm');
  const score = r => {
    const e = E(r);
    let sc = 0;
    if (srcCats.has(categoryOf(e, srcCats))) sc += 4;
    if (hint === 'game' && has(e, 'game', 'gameSeries')) sc += 6;
    if (hint === 'film' && filmType(e)) sc += 6;
    if (hint === 'show' && showType(e)) sc += 6;
    if (showSrc ? showType(e) : filmType(e) || has(e, 'game')) sc += 2;
    if (has(e, 'franchise') && !has(e, 'film', 'series', 'animSeries', 'game')) sc -= 3;
    return sc * 10000 + Math.min(e.sl || 0, 9999);
  };
  let best = [...works].sort((a, b) => score(b) - score(a))[0];
  // Playlists de jeux pleines de musiques de films (« Gladiator », « Braveheart ») : sans indice dans l'album,
  // le film l'emporte s'il est bien plus connu que le jeu homonyme.
  if (!hint && has(E(best), 'game', 'gameSeries')) {
    const film = works.filter(r => filmType(E(r))).sort((a, b) => (E(b).sl || 0) - (E(a).sl || 0))[0];
    if (film && (E(film).sl || 0) > 2 * (E(best).sl || 0)) best = film;
  }
  const be = E(best);
  // Playlist de génériques seulement : un film en prises de vues réelles est un homonyme (« Les Chevaliers du Zodiaque »
  // de 2023 pour le générique du dessin animé), sauf si le morceau le cite explicitement.
  if (showSrc && !filmSrc && kind !== 'from' && filmType(be) && !has(be, 'animFilm', 'animeFilm')) {
    return { why: 'film homonyme d\'un générique' };
  }
  if (kind === 'title') {
    // Le titre du morceau n'est le nom de l'œuvre que pour un générique, et seulement si une chanson du même nom
    // ne passe pas avant (« La Bamba », « Hallelujah », « Happy Together »).
    const musicFirst = matched.findIndex(r => isMusicEntity(E(r)));
    const workIdx = matched.findIndex(r => r.id === best.id);
    // Chanson-titre d'un film connu (« No Time To Die », « Footloose », « Pretty Woman ») dans une playlist de films.
    if (!showSrc && filmType(be) && (be.sl || 0) >= 30) return { id: best.id };
    // Playlist de génériques : une série du même nom que le titre est l'œuvre si le morceau ressemble à un générique
    // (« Lady Oscar » sur une compilation de génériques), ou si elle est de la catégorie de la playlist et qu'aucune
    // chanson du même nom ne passe avant (« My Dearest » d'une playlist d'anime n'est pas une série).
    const themeish = THEME_RE.test(title) || GENERIC_ARTIST.test(artist) || COVER_RE.test(artist)
      || /g[ée]n[ée]rique|\btv\b|t[ée]l[ée]|dessins? anim|cartoon|s[ée]ries|\btheme/i.test(`${album} ${artist}`);
    const songFirst = musicFirst >= 0 && musicFirst < workIdx;
    if (showSrc && showType(be) && (themeish || (srcCats.has(categoryOf(be, srcCats)) && !songFirst))) return { id: best.id };
    if (songFirst) return { why: 'titre de chanson, pas une œuvre' };
    if (music) return { why: 'titre de chanson, pas une œuvre' };
    if (showSrc && !has(be, 'animFilm', 'animeFilm', 'game')) return { why: 'titre de chanson, pas une œuvre' };
    if (!showSrc && matched[0].id !== best.id) return { why: 'titre de chanson, pas une œuvre' };
  }
  return { id: best.id };
}

// Œuvre nommée par une correction : la plus connue des entités de ce nom qui tombe dans la catégorie voulue.
function resolveNamed(results, name, cat, ents) {
  const ok = results.filter(r => labelMatches(r, name) && ents[r.id] && isWorkEntity(ents[r.id]) && categoryOf(ents[r.id], new Set([cat])) === cat);
  if (ok.length) return ok.sort((a, b) => (ents[b.id].sl || 0) - (ents[a.id].sl || 0))[0].id;
  // Sinon l'œuvre la plus connue de ce nom (Wikidata la classe parfois autrement : coproduction franco-japonaise…).
  const any = results.filter(r => labelMatches(r, name) && ents[r.id] && isWorkEntity(ents[r.id]));
  return any.sort((a, b) => (ents[b.id].sl || 0) - (ents[a.id].sl || 0))[0]?.id || null;
}

// ---------- 2 bis. Œuvres connues absentes des playlists ----------
// Les plus connues de chaque type sur Wikidata (nombre de wikis), puis leur thème cherché sur Deezer.
const SEEDS = [
  { cat: 'films', limit: 400, where: '?w wdt:P31 wd:Q11424 ; wikibase:sitelinks ?sl . FILTER(?sl > 70)' },
  { cat: 'disney', limit: 150, where: `?w wdt:P31/wdt:P279* wd:Q202866 ; wdt:P272 ?p ; wikibase:sitelinks ?sl . VALUES ?p { ${DISNEY.map(v => 'wd:' + v).join(' ')} }` },
  { cat: 'series', limit: 250, where: '?w wdt:P31 wd:Q5398426 ; wikibase:sitelinks ?sl . FILTER(?sl > 45)' },
  { cat: 'cartoons', limit: 200, where: '?w wdt:P31/wdt:P279? wd:Q581714 ; wikibase:sitelinks ?sl . FILTER(?sl > 22)' },
  // Émissions : la requête équivalente est trop lourde pour Wikidata ; elles viennent des playlists.
];
async function seedIds(seed) {
  return cached('seeds', seed.cat + ':' + seed.limit, async () => {
    const q = `SELECT ?w ?sl WHERE { ${seed.where} ?fr schema:about ?w ; schema:isPartOf <https://fr.wikipedia.org/> . } ORDER BY DESC(?sl) LIMIT ${seed.limit}`;
    const d = await http('https://query.wikidata.org/sparql', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json' },
      body: 'query=' + encodeURIComponent(q),
    });
    return [...new Set(d.results.bindings.map(b => b.w.value.split('/').pop()))];
  });
}
async function deezerSearch(q) {
  return cached('dzsearch', q, async () => {
    const d = await http(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=15`);
    return (d?.data || []).filter(t => t.preview && t.readable !== false)
      .map(t => ({ id: t.id, t: t.title, ts: t.title_short, a: t.artist?.name || '', al: t.album?.title || '', m: t.album?.md5_image || '', r: t.rank || 0 }));
  });
}
// Thème d'une œuvre sur Deezer : l'album ou le titre doit nommer l'œuvre, et ressembler à une BO ou un générique.
async function findTheme(e, cat) {
  const fr = [e.lfr, e.fr && e.fr.replace(/\s*\([^)]*\)\s*$/, '')].find(n => n && norm(n).length >= 3);
  const en = [e.len, e.lmul].find(n => n && norm(n).length >= 3);
  const names = [...new Set([fr, en].filter(Boolean))];
  const show = ['series', 'cartoons', 'tv'].includes(cat);
  const queries = show ? [...names.flatMap(n => [`générique ${n}`, `${n} theme`]), en && `${en} soundtrack`].filter(Boolean)
    : [en && `${en} soundtrack`, fr && `${fr} bande originale`].filter(Boolean);
  const found = new Map();
  for (const q of queries) {
    for (const t of await deezerSearch(q)) {
      // L'œuvre nommée par le morceau ou son album doit être exactement celle-ci (pas « Seven Seas » pour « Seven »,
      // ni « Gravity Falls » pour « Gravity »), et l'album une BO (pas celle d'un jeu pour un film).
      const exact = x => x && names.some(n => norm(x).replace(/^(the|le|la|les|l) /, '') === norm(n).replace(/^(the|le|la|les|l) /, ''));
      const fromAlbum = SOUNDTRACK_RE.test(t.al) && exact(cleanWork(t.al));
      const fromTitle = exact(findWork(t.t, '')) || (THEME_RE.test(t.t) || show) && exact(cleanShowTitle(cleanTitle(t.t)));
      const gameAlbum = cat !== 'games' && /video ?game|game (sound|music)|\bgame\b/i.test(t.al);
      if ((fromAlbum || fromTitle) && !gameAlbum && !COMPIL_RE.test(t.al)) found.set(t.id, t);
    }
    if (found.size >= 3) break;
  }
  return [...found.values()].sort((a, b) => b.r - a.r).slice(0, 4);
}

// ---------- 3. Notoriété et images ----------
// Vues (60 derniers jours, ramenées à l'année) et image de la page Wikipédia française, par lots de 50 titres.
// L'API REST des vues limite très vite le débit ; l'API de Wikipédia accepte des lots.
async function pageInfo(titles) {
  const c = cache('pages');
  const todo = [...new Set(titles)].filter(t => t && !(t in c.data));
  for (let i = 0; i < todo.length; i += 50) {
    progress('Pages Wikipédia', i, todo.length);
    const batch = todo.slice(i, i + 50);
    const res = Object.fromEntries(batch.map(t => [t, { pv: 0, img: null }]));
    let cont = '';
    for (let guard = 0; guard < 20; guard++) {
      const d = await http(`https://fr.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=pageviews|pageimages&pvipdays=60&piprop=thumbnail&pithumbsize=800&titles=${encodeURIComponent(batch.join('|'))}${cont}`);
      const back = {};
      for (const r of [...(d?.query?.normalized || []), ...(d?.query?.redirects || [])]) back[r.to] = [...(back[r.to] || []), r.from];
      const origins = t => { const out = new Set([t]); for (let k = 0; k < 3; k++) for (const x of [...out]) for (const f of back[x] || []) out.add(f); return [...out]; };
      for (const p of Object.values(d?.query?.pages || {})) {
        const views = Object.values(p.pageviews || {}).reduce((a, v) => a + (v || 0), 0);
        for (const t of origins(p.title)) if (res[t]) {
          if (p.pageviews) res[t].pv = Math.round(views * 365 / 60);
          if (p.thumbnail?.source) res[t].img = p.thumbnail.source;
        }
      }
      if (!d?.continue) break;
      cont = '&' + Object.entries(d.continue).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    }
    Object.assign(c.data, res); c.dirty += batch.length;
    saveCaches();
  }
  progress('Pages Wikipédia', todo.length, todo.length);
  return c.data;
}

// ---------- Règles propres au blind test ----------
// Réenregistrements de compilations : gardés seulement si l'original manque.
const COVER_RE = /geek music|theme fantasy|coded channel|piano lover|imperial orchestra|video game players|tv theme|the tv theme players|musique de film|les petits loups|tv generation|g[ée]n[ée]riques? de s[ée]ries|compilation g[ée]n[ée]rique|g[ée]n[ée]ration tv|top tv|kitsch and camp|tv toons|hit crew|edwin davids|south bay groovy|fx costello|club des juniors|orchestra cinematique|l'orchestra|tv themes|tv sounds|movie sounds unlimited|london music works|the soundtrack studio stars|film score orchestra|starlight orchestra|tribute|henri garella|crypt|towenda|prime time|hollywood'?s? martins|soundtrack wonder band|cinematic orchestra|générique tv|generique tv|henrick garell|brian springstill|franck aravya|santana aria/i;
const THEME_RE = /g[ée]n[ée]rique|main (title|theme)|theme song|opening|\btheme\b|th[èe]me/i;
const isCover = t => COVER_RE.test(t.a) || GENERIC_ARTIST.test(t.a);

// Niveau par tiers dans la catégorie : 0 facile, 1 moyen, 2 difficile.
function levels(list, score) {
  const sorted = [...list].sort((a, b) => score(b) - score(a));
  sorted.forEach((x, i) => (x.lvl = i < sorted.length / 3 ? 0 : i < (2 * sorted.length) / 3 ? 1 : 2));
}

const displayName = (e, fallback) => e.lfr || frTitle(e) || e.len || e.lmul || fallback;

// ---------- Construction ----------
async function main() {
  const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/overrides.json'), 'utf8'));
  const trackOv = overrides.tracks || {}, workOv = overrides.works || {};

  console.log('1/5 Playlists Deezer');
  const tracks = new Map();   // id -> morceau, avec les catégories des playlists d'origine
  const plist = CATEGORIES.flatMap(c => c.playlists.map(p => [c.id, p]));
  for (let i = 0; i < plist.length; i++) {
    progress('Playlists', i, plist.length);
    const [cat, pid] = plist[i];
    for (const t of await playlistTracks(pid)) {
      const x = tracks.get(t.id) || { ...t, src: new Set() };
      x.src.add(cat);
      tracks.set(t.id, x);
    }
  }
  progress('Playlists', plist.length, plist.length);
  saveCaches(true);
  const all = [...tracks.values()];
  const workTracks = all.filter(t => [...t.src].some(c => WORK_CATS.includes(c)));
  console.log(`  ${all.length} morceaux, dont ${workTracks.length} issus de playlists d'œuvres`);

  console.log('2/5 Œuvres (Wikidata)');
  const cands = new Map(workTracks.map(t => [t.id, candidates(t, t.src)]));
  // Corrections qui nomment l'œuvre : le nom est cherché comme les autres pour retrouver son entité.
  const ovNames = Object.values(trackOv).map(o => o.work).filter(w => w && !/^Q\d+$/.test(w));
  const names = [...new Set([...[...cands.values()].flat().map(c => c.n), ...ovNames])];
  const forcedIds = Object.values(trackOv).map(o => o.work).filter(w => /^Q\d+$/.test(w || ''));
  await searchAll(names);
  saveCaches(true);
  const sc = cache('search').data;
  let ents = await classify([...names.flatMap(n => (sc[norm(n)] || []).map(r => r.id)), ...forcedIds, ...Object.keys(workOv)]);
  ENTS = ents;
  saveCaches(true);
  // Les 7 premiers résultats ne contiennent parfois pas l'œuvre (« Titanic » : le paquebot, la comédie musicale…) :
  // recherche plus profonde pour les noms sans œuvre correspondante.
  const workMatches = n => (sc[norm(n)] || []).filter(r => labelMatches(r, n) && ents[r.id] && isWorkEntity(ents[r.id]));
  await markExtra(names.flatMap(n => workMatches(n).map(r => r.id)), ents);
  // Aussi quand la seule œuvre trouvée est obscure : « Top Gun » de 1955 avant celui de 1986.
  const shallow = names.filter(n => (sc[norm(n)] || []).length >= 7 && (sc[norm(n)] || []).length < 25 && Math.max(0, ...workMatches(n).map(r => ents[r.id].sl || 0)) < 20);
  console.log(`  Recherche approfondie : ${shallow.length} noms`);
  await searchAll(shallow, 'deep', 25);
  const deep = cache('deep').data;
  for (const n of shallow) if (deep[norm(n)]?.length) sc[norm(n)] = deep[norm(n)];
  ents = await classify(shallow.flatMap(n => (sc[norm(n)] || []).map(r => r.id)));
  ENTS = ents;
  saveCaches(true);

  // Épisodes : vérifiés pour toutes les œuvres candidates (celles dont le nom correspond).
  const candIds = names.flatMap(n => (sc[norm(n)] || []).filter(r => labelMatches(r, n) && ents[r.id] && isWorkEntity(ents[r.id])).map(r => r.id));
  await markExtra([...candIds, ...forcedIds], ents);
  saveCaches(true);

  // Rattachement de chaque morceau à une œuvre.
  const works = new Map();    // Q -> { e, cat, tracks: [] }
  const rejected = [];        // { t, why }
  const custom = new Map();   // œuvres sans entité Wikidata (corrections manuelles) : nom -> œuvre
  for (const t of workTracks) {
    const ov = trackOv[t.id];
    if (ov?.out) { rejected.push({ t, why: 'exclu à la main' }); continue; }
    let id = null, why = 'œuvre introuvable';
    if (ov?.work && /^Q\d+$/.test(ov.work)) id = ov.work;
    else if (ov?.work && (id = resolveNamed(sc[norm(ov.work)] || [], ov.work, ov.cat, ents))) { /* entité trouvée */ }
    else if (ov?.work) {
      const key = `${ov.cat}:${norm(ov.work)}`;
      if (!custom.has(key)) custom.set(key, { name: ov.work, cat: ov.cat, tracks: [] });
      custom.get(key).tracks.push(t);
      continue;
    } else {
      for (const c of cands.get(t.id)) {
        const r = pick(sc[norm(c.n)] || [], c.n, c.kind, t.a, ents, t.src, t.al, t.t);
        if (r.id) { id = r.id; break; }
        why = r.why;
      }
    }
    if (!id) { rejected.push({ t, why }); continue; }
    const e = ents[id];
    const cat = ov?.cat || workOv[id]?.cat || categoryOf(e, t.src);
    if (!cat) { rejected.push({ t, why: 'type d\'œuvre non pris en charge' }); continue; }
    if (workOv[id]?.out) { rejected.push({ t, why: 'œuvre exclue à la main' }); continue; }
    if (!works.has(id)) works.set(id, { id, e, cat, tracks: [] });
    works.get(id).tracks.push(t);
  }
  console.log(`  ${works.size} œuvres, ${rejected.length} morceaux écartés`);

  console.log('2 bis. Œuvres connues absentes des playlists');
  const seeds = [];
  for (const sd of SEEDS) for (const id of await seedIds(sd)) seeds.push([sd.cat, id]);
  const seedEnts = await classify(seeds.map(([, id]) => id));
  let added = 0;
  const seededIds = new Set();
  const missing = seeds.filter(([, id]) => !works.has(id) && !workOv[id]?.out);
  for (let i = 0; i < missing.length; i++) {
    progress('Thèmes Deezer', i, missing.length);
    const [seedCat, id] = missing[i];
    if (works.has(id)) continue;
    const e = seedEnts[id];
    const cat = workOv[id]?.cat || categoryOf(e, new Set([seedCat]));
    if (!cat) continue;
    // Seulement des morceaux nouveaux : ceux des playlists sont déjà rattachés (ou écartés, ou corrigés à la main).
    const found = (await findTheme(e, cat)).filter(t => !trackOv[t.id] && !tracks.has(t.id) && !seededIds.has(t.id));
    if (!found.length) continue;
    found.forEach(t => seededIds.add(t.id));
    works.set(id, { id, e, cat, tracks: found.map(t => ({ ...t, src: new Set([seedCat]) })), seeded: true });
    added++;
  }
  progress('Thèmes Deezer', missing.length, missing.length);
  saveCaches(true);
  console.log(`  ${added} œuvres ajoutées (thème trouvé sur Deezer)`);

  console.log('3/5 Notoriété (vues de la page Wikipédia française)');
  const wl = [...works.values()];
  const pages = await pageInfo(wl.map(w => w.e.fr).filter(Boolean));
  for (const w of wl) w.pv = w.e.fr ? pages[w.e.fr]?.pv || 0 : 0;
  const imgs = Object.fromEntries(Object.entries(pages).map(([t, v]) => [t, v.img]));
  saveCaches(true);

  console.log('4/5 Fichiers du catalogue');
  const built = new Date().toISOString().slice(0, 10);
  const byCat = Object.fromEntries(CATEGORIES.map(c => [c.id, { works: [], items: [], out: [] }]));

  const trackOut = t => ({ d: t.id, s: cleanTitle(t.t), a: t.a, m: t.m });
  // Même nom dans une catégorie (« Dumbo » 1941 et 2019, « Titanic » et « Le Titanic ») : une seule entrée, au nom de
  // l'œuvre la plus connue, avec les morceaux des deux (classés ensemble ci-dessous).
  const merged = new Map();
  for (const w of wl) {
    w.name = workOv[w.id]?.name || displayName(w.e, cleanShowTitle(cleanTitle(w.tracks[0].t)));
    const k = w.cat + ':' + norm(w.name).replace(/^(the|le|la|les|l) /, '');
    const prev = merged.get(k);
    if (!prev) { merged.set(k, w); continue; }
    const [keep, drop] = (w.pv || 0) > (prev.pv || 0) ? [w, prev] : [prev, w];
    const ids = new Set(keep.tracks.map(t => t.id));
    keep.tracks = [...keep.tracks, ...drop.tracks.filter(t => !ids.has(t.id))];
    merged.set(k, keep);
  }
  for (const w of merged.values()) {
    // Morceaux : original avant reprise, générique avant chanson, BO avant compilation, puis le plus écouté.
    const originals = w.tracks.filter(t => !isCover(t));
    const list = (originals.length ? originals : w.tracks)
      .sort((a, b) => (THEME_RE.test(b.t) - THEME_RE.test(a.t)) || (SOUNDTRACK_RE.test(b.al) - SOUNDTRACK_RE.test(a.al)) || b.r - a.r);
    const seen = new Set();
    const tr = list.filter(t => { const k = norm(cleanTitle(t.t)) + '|' + norm(t.a); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 4);
    const ov = workOv[w.id] || {};
    byCat[w.cat].works.push({
      q: w.id,
      n: w.name,
      y: w.e.year || undefined,
      pv: w.pv,
      img: imgs[w.e.fr] || undefined,
      yt: w.e.yt || undefined,
      lvl: ov.level,
      t: tr.map(trackOut),
    });
  }
  for (const w of custom.values()) {
    byCat[w.cat].works.push({ n: w.name, pv: 0, t: w.tracks.sort((a, b) => b.r - a.r).slice(0, 4).map(trackOut) });
  }
  // Fusion des œuvres d'une même saga sous un nom commun ? Non : chaque film garde sa ligne, la saga ne sert
  // qu'à espacer les extraits en jeu (workKey).
  for (const id of WORK_CATS) {
    const c = byCat[id];
    const auto = c.works.filter(w => w.lvl == null);
    levels(auto, w => w.pv);
    c.works.sort((a, b) => a.lvl - b.lvl || b.pv - a.pv);
  }
  // Morceaux écartés : rangés dans la catégorie de leur playlist d'origine (pour l'onglet « Écartés »).
  for (const { t, why } of rejected) {
    for (const cat of t.src) if (WORK_CATS.includes(cat)) byCat[cat].out.push({ ...trackOut(t), al: t.al, why });
  }

  // Catégories musicales : une entrée par chanson, versions fusionnées.
  for (const id of MUSIC_CATS) {
    const seen = new Map();
    for (const t of all.filter(x => x.src.has(id))) {
      // Exclusion d'un titre musical : seulement si la correction vise cette catégorie (les autres concernent les œuvres).
      if (trackOv[t.id]?.out && trackOv[t.id].cat === id) { byCat[id].out.push({ ...trackOut(t), al: t.al, why: 'exclu à la main' }); continue; }
      const k = norm(t.a.split(/,|&| feat/i)[0]) + '|' + norm(cleanTitle(t.ts || t.t));
      const prev = seen.get(k);
      if (!prev || t.r > prev.r) seen.set(k, t);
    }
    const items = [...seen.values()].map(t => ({ ...trackOut(t), r: t.r, ...(trackOv[t.id]?.name ? { n: trackOv[t.id].name } : {}) }));
    levels(items, x => x.r);
    items.forEach(x => delete x.r);
    byCat[id].items = items.sort((a, b) => a.lvl - b.lvl);
  }

  const index = { built, cats: {} };
  for (const c of CATEGORIES) {
    const data = { v: 1, built, cat: c.id, ...(WORK_CATS.includes(c.id) ? { works: byCat[c.id].works } : { items: byCat[c.id].items }), out: byCat[c.id].out };
    if (c.id === 'anime' && overrides.animeOut?.length) data.aniOut = overrides.animeOut; // openings vidéo exclus (ids AniList)
    fs.writeFileSync(path.join(OUT_DIR, `${c.id}.json`), JSON.stringify(data));
    index.cats[c.id] = { n: (data.works || data.items).length, out: data.out.length };
  }
  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index));

  console.log('5/5 Page de revue');
  fs.writeFileSync(path.join(ROOT, 'tools/review.html'), reviewPage(byCat, built));
  saveCaches(true);
  console.log('\nRésumé :');
  for (const c of CATEGORIES) console.log(`  ${c.label.padEnd(20)} ${String(index.cats[c.id].n).padStart(5)} ${WORK_CATS.includes(c.id) ? 'œuvres' : 'titres'}   ${index.cats[c.id].out} écartés`);
}

// ---------- Page de revue ----------
function reviewPage(byCat, built) {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  const LV = ['Facile', 'Moyen', 'Difficile'];
  let body = '';
  for (const c of CATEGORIES) {
    const d = byCat[c.id];
    const isWork = WORK_CATS.includes(c.id);
    body += `<section id="${c.id}"><h2>${c.emoji} ${esc(c.label)} <small>${isWork ? d.works.length + ' œuvres' : d.items.length + ' titres'} · ${d.out.length} écartés</small></h2>`;
    if (isWork) {
      body += '<table><tr><th>Niveau</th><th>Œuvre</th><th>Vues/an</th><th>Extraits (id Deezer)</th></tr>' + d.works.map(w =>
        `<tr><td class="l${w.lvl}">${LV[w.lvl]}</td><td><b>${esc(w.n)}</b>${w.y ? ` <i>${w.y}</i>` : ''}${w.q ? ` <code>${w.q}</code>` : ''}</td><td>${(w.pv || 0).toLocaleString('fr')}</td><td>${w.t.map(t => `${esc(t.s)} — ${esc(t.a)} <code>${t.d}</code>`).join('<br>')}</td></tr>`).join('') + '</table>';
    } else {
      body += '<details><summary>Voir les titres</summary><table>' + d.items.map(t => `<tr><td class="l${t.lvl}">${LV[t.lvl]}</td><td>${esc(t.s)} — ${esc(t.a)} <code>${t.d}</code></td></tr>`).join('') + '</table></details>';
    }
    if (d.out.length) {
      body += `<details><summary>Écartés (${d.out.length})</summary><table><tr><th>Morceau</th><th>Album</th><th>Raison</th></tr>` +
        d.out.map(t => `<tr><td>${esc(t.s)} — ${esc(t.a)} <code>${t.d}</code></td><td>${esc(t.al)}</td><td>${esc(t.why)}</td></tr>`).join('') + '</table></details>';
    }
    body += '</section>';
  }
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Revue du catalogue</title>
<style>body{font:14px -apple-system,system-ui,sans-serif;margin:0 auto;max-width:1100px;padding:16px;background:#0b0b12;color:#eee}
h1{margin:0 0 4px}h2{margin:28px 0 8px;border-bottom:1px solid #333;padding-bottom:6px}h2 small{color:#999;font-weight:400;font-size:13px}
nav a{color:#9cf;margin-right:10px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #222;padding:5px 6px;text-align:left;vertical-align:top}
th{color:#999;font-weight:600}code{color:#888;font-size:11px}i{color:#999}summary{cursor:pointer;color:#9cf;margin:8px 0}
.l0{color:#6ef0a6}.l1{color:#ffc75a}.l2{color:#ff8a9d}</style></head><body>
<h1>Revue du catalogue</h1><p>Construit le ${built}.</p><nav>${CATEGORIES.map(c => `<a href="#${c.id}">${esc(c.label)}</a>`).join('')}</nav>${body}</body></html>`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(e => { saveCaches(true); console.error(e); process.exit(1); });
export { resolveNamed, candidates, pick, categoryOf, cache, has, isWorkEntity, isMusicEntity, labelMatches };
export const setEnts = e => { ENTS = e; };
