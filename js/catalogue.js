// Écran Catalogue : parcourir les titres de chaque catégorie, les écouter, exclure ou rétablir.
import { CATEGORIES, CAT_BY_ID } from './catalog.js';
import {
  catalogItems, analyzeTrack, wikiPausedFor, trackPreview, animeCatalogPage, animeOpening,
  excludeTrack, restoreTrack, excludeAnime, popCategories,
} from './sources.js';

const $ = id => document.getElementById(id);
const LEVEL_LABEL = { easy: 'Facile', medium: 'Moyen', hard: 'Difficile' };
const LEVEL_ORDER = { easy: 0, medium: 1, hard: 2 };
const PAGE = 120;          // lignes affichées d'un coup (le reste au défilement)
const ANIME_PAGES = 20;    // 20 pages AniList de 50 = les 1 000 anime de la catégorie

const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const C = {
  cat: null, level: 'all', query: '', rows: [], shown: 0, list: [],
  animePages: 0, loadingAnime: false, playing: null, analyzing: false, gen: 0,
};
let opts = {};
const audio = $('catAudio');
const video = $('catVideo');

export function initCatalog(o) {
  opts = o;
  const tabs = $('catalogTabs');
  for (const c of CATEGORIES) {
    const b = document.createElement('button');
    b.className = 'cat-tab';
    b.dataset.cat = c.id;
    b.style.setProperty('--cc', c.color);
    b.innerHTML = `<span>${c.emoji}</span>${esc(c.label)}`;
    b.onclick = () => selectCat(c.id);
    tabs.appendChild(b);
  }
  $('catalogBack').onclick = closeCatalog;
  let t;
  $('catalogSearch').oninput = e => { clearTimeout(t); t = setTimeout(() => { C.query = norm(e.target.value.trim()); render(); }, 150); };
  $('catalogLevels').onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    C.level = b.dataset.level;
    $('catalogLevels').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    render();
  };
  $('catalogList').onclick = onListClick;
  $('catalogList').addEventListener('scroll', onScroll, { passive: true });
  $('catalogAnalyzeBtn').onclick = () => (C.analyzing ? stopAnalysis() : analyze());
  for (const el of [audio, video]) el.addEventListener('ended', stopPlayback);
}

export function openCatalog(firstCat) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'catalog'));
  selectCat(C.cat || firstCat || 'films');
}

function closeCatalog() {
  stopAnalysis();
  stopPlayback();
  C.gen++;
  opts.onClose?.();
}

async function selectCat(id) {
  if (C.cat !== id) stopAnalysis();
  C.cat = id;
  const gen = ++C.gen;
  opts.setColor?.(id);
  $('catalogTabs').querySelectorAll('.cat-tab').forEach(b => {
    b.classList.toggle('on', b.dataset.cat === id);
    if (b.dataset.cat === id) {
      const tabs = $('catalogTabs');
      tabs.scrollTo({ left: b.offsetLeft - (tabs.clientWidth - b.offsetWidth) / 2, behavior: 'smooth' });
    }
  });
  C.rows = [];
  C.animePages = 0;
  $('catalogList').scrollTop = 0;
  $('catalogList').innerHTML = '<p class="cat-empty">Chargement…</p>';
  $('catalogCount').textContent = '';
  $('catalogAnalyze').classList.add('hidden');
  try {
    if (id === 'anime') {
      await loadAnimePages(4, gen);
    } else {
      const rows = await catalogItems(id);
      if (gen !== C.gen) return;
      C.rows = rows;
    }
  } catch (e) {
    if (gen !== C.gen) return;
    $('catalogList').innerHTML = '<p class="cat-empty">Impossible de charger cette catégorie.<br>Vérifie ta connexion.</p>';
    return;
  }
  if (gen !== C.gen) return;
  render();
}

async function loadAnimePages(upTo, gen) {
  if (C.loadingAnime) return;
  C.loadingAnime = true;
  try {
    while (C.animePages < Math.min(upTo, ANIME_PAGES)) {
      const rows = await animeCatalogPage(C.animePages + 1);
      if (gen !== C.gen) return;
      C.rows.push(...rows);
      C.animePages++;
    }
  } finally {
    C.loadingAnime = false;
  }
}

// ---------- Liste ----------
function filtered() {
  const out = C.level === 'out';
  const rows = C.rows.filter(r => (out ? r.state !== 'ok' : r.state === 'ok' && (C.level === 'all' || r.level === C.level)) &&
    (!C.query || norm(`${r.name} ${r.sub}`).includes(C.query)));
  // Anime : l'ordre AniList est déjà celui de la popularité.
  if (C.cat !== 'anime') {
    rows.sort((a, b) => (LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]) || a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  }
  return rows;
}

function render() {
  const list = $('catalogList');
  C.list = filtered();
  C.shown = 0;
  list.innerHTML = '';
  updateHeader();
  const approx = popCategories.includes(C.cat) && C.list.some(r => !r.exact);
  if (approx && C.level !== 'out') {
    list.insertAdjacentHTML('beforeend', '<p class="cat-legend">Niveau en pointillés : estimé d\'après Deezer, en attendant l\'analyse de l\'œuvre (Wikipédia). Les titres marqués « ? » ne sont pas encore identifiés.</p>');
  }
  if (!C.list.length) {
    const msg = C.level === 'out' ? 'Aucun titre écarté dans cette catégorie.' : C.query ? 'Aucun titre ne correspond.' : 'Aucun titre à ce niveau.';
    list.insertAdjacentHTML('beforeend', `<p class="cat-empty">${msg}</p>`);
  }
  more();
}

function more() {
  const list = $('catalogList');
  list.querySelector('.cat-more')?.remove();
  const slice = C.list.slice(C.shown, C.shown + PAGE);
  list.insertAdjacentHTML('beforeend', slice.map(rowHtml).join(''));
  C.shown += slice.length;
  const animeLeft = C.cat === 'anime' && C.animePages < ANIME_PAGES;
  if (C.shown < C.list.length || animeLeft) {
    const m = document.createElement('p');
    m.className = 'cat-more';
    m.textContent = animeLeft && C.shown >= C.list.length ? 'Chargement des anime suivants…' : '…';
    list.appendChild(m);
  }
}

// Suite de la liste quand on approche du bas.
let loadingMore = false;
async function onScroll() {
  const list = $('catalogList');
  if (loadingMore || !list.querySelector('.cat-more')) return;
  if (list.scrollTop + list.clientHeight < list.scrollHeight - 500) return;
  loadingMore = true;
  try {
    if (C.shown >= C.list.length && C.cat === 'anime' && C.animePages < ANIME_PAGES) {
      const gen = C.gen;
      await loadAnimePages(C.animePages + 2, gen).catch(() => {});
      if (gen !== C.gen) return;
      const keep = C.shown;
      C.list = filtered();
      C.shown = Math.min(keep, C.list.length);
      updateHeader();
    }
    more();
  } finally {
    loadingMore = false;
  }
}

function rowHtml(r) {
  const out = r.state !== 'ok';
  const badge = out
    ? `<span class="lvl ${r.state}">${r.state === 'user' ? 'Exclu' : 'Écarté'}</span>`
    : `<span class="lvl ${r.level}${r.exact ? '' : ' approx'}">${LEVEL_LABEL[r.level]}</span>`;
  const icon = CAT_BY_ID[C.cat]?.emoji || '🎵';
  return `<div class="cat-row${out ? ' out' : ''}${C.playing === r.id ? ' playing' : ''}" data-id="${r.id}" role="button">
    <div class="thumb">${icon}${r.cover ? `<img src="${esc(r.cover)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</div>
    <div class="txt"><div class="nm">${esc(r.name)}${r.checked ? '' : '<span class="unk">?</span>'}</div><div class="sb">${esc(r.sub)}</div></div>
    ${badge}
    <button class="row-act" data-act="${out ? 'restore' : 'exclude'}" aria-label="${out ? 'Remettre dans le jeu' : 'Exclure du jeu'}">${out ? '↺' : '✕'}</button>
  </div>`;
}

function updateHeader() {
  const ok = C.rows.filter(r => r.state === 'ok');
  const n = ok.length;
  const anime = C.cat === 'anime';
  $('catalogCount').textContent = `${n}${anime && C.animePages < ANIME_PAGES ? '+' : ''} ${anime ? 'anime' : 'titres'}`;
  // Analyse : seulement pour les catégories dont le niveau vient de la notoriété de l'œuvre.
  const box = $('catalogAnalyze');
  if (!popCategories.includes(C.cat)) { box.classList.add('hidden'); return; }
  const todo = ok.filter(r => !r.checked).length;
  box.classList.toggle('hidden', !todo && !C.analyzing);
  if (!C.analyzing) {
    $('catalogAnalyzeText').textContent = `${todo} titre${todo > 1 ? 's' : ''} pas encore analysé${todo > 1 ? 's' : ''} : œuvre et niveau à confirmer.`;
    $('catalogAnalyzeBtn').textContent = 'Analyser';
    $('catalogAnalyzeBtn').classList.remove('stop');
  }
}

function rowOf(id) { return C.rows.find(r => String(r.id) === String(id)); }

async function onListClick(e) {
  const rowEl = e.target.closest('.cat-row');
  if (!rowEl) return;
  const r = rowOf(rowEl.dataset.id);
  if (!r) return;
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'exclude') {
    if (r.anime) excludeAnime(r.id, true); else excludeTrack(r.id);
    r.state = 'user';
    if (C.playing === r.id) stopPlayback();
    rowEl.remove();
    updateHeader();
    opts.toast?.('Retiré du blind test');
    return;
  }
  if (act === 'restore') {
    if (r.anime) excludeAnime(r.id, false); else restoreTrack(r.id);
    r.state = 'ok';
    rowEl.remove();
    updateHeader();
    opts.toast?.('Remis dans le blind test');
    return;
  }
  togglePlay(r, rowEl);
}

// ---------- Écoute ----------
async function togglePlay(r, rowEl) {
  if (C.playing === r.id) { stopPlayback(); return; }
  stopPlayback();
  const el = r.anime ? video : audio;
  // iOS : la lecture doit démarrer pendant le geste ; on débloque le lecteur avant de chercher l'extrait.
  if (!el.dataset.unlocked && opts.silent) {
    el.src = opts.silent;
    el.play().then(() => { el.pause(); el.dataset.unlocked = '1'; }).catch(() => {});
  }
  C.playing = r.id;
  rowEl.classList.add('loading');
  try {
    const src = r.anime ? await animeOpening(r.id) : await trackPreview(r.id);
    if (C.playing !== r.id) return;
    if (!src) throw new Error('aucun extrait');
    el.src = src;
    el.currentTime = 0;
    await el.play();
    rowEl.classList.remove('loading');
    rowEl.classList.add('playing');
  } catch {
    if (C.playing === r.id) { stopPlayback(); opts.toast?.('Extrait indisponible'); }
  }
}

function stopPlayback() {
  C.playing = null;
  for (const el of [audio, video]) { try { el.pause(); } catch { /* ignore */ } }
  document.querySelectorAll('.cat-row.playing, .cat-row.loading').forEach(x => x.classList.remove('playing', 'loading'));
}

// ---------- Analyse ----------
async function analyze() {
  const cat = C.cat;
  const gen = C.gen;
  C.analyzing = true;
  $('catalogAnalyze').classList.remove('hidden');
  $('catalogAnalyzeBtn').textContent = 'Arrêter';
  $('catalogAnalyzeBtn').classList.add('stop');
  const todo = C.rows.filter(r => r.state === 'ok' && !r.checked).map(r => r.id);
  let done = 0, rejected = 0;
  const text = $('catalogAnalyzeText');
  for (let i = 0; i < todo.length && C.analyzing && gen === C.gen; ) {
    const pause = wikiPausedFor();
    if (pause) {
      text.textContent = `Wikipédia demande une pause : reprise dans ${Math.ceil(pause / 1000)} s (${done}/${todo.length}).`;
      await new Promise(r => setTimeout(r, Math.min(pause, 1000)));
      continue;
    }
    text.textContent = `Analyse en cours… ${done}/${todo.length}${rejected ? ` · ${rejected} écarté${rejected > 1 ? 's' : ''}` : ''}`;
    const res = await analyzeTrack(cat, todo[i]).catch(() => 'retry');
    if (res === 'retry' && wikiPausedFor()) continue; // on retentera ce titre après la pause
    if (res === 'rejected') rejected++;
    done++; i++;
    // Rafraîchit la liste de temps en temps (sans perdre la position de défilement).
    if (done % 10 === 0 || i === todo.length) await refreshRows(cat, gen);
  }
  const finished = C.analyzing && gen === C.gen;
  C.analyzing = false;
  if (gen !== C.gen) return;
  await refreshRows(cat, gen);
  if (finished) opts.toast?.(`Analyse terminée${rejected ? ` · ${rejected} titre${rejected > 1 ? 's' : ''} écarté${rejected > 1 ? 's' : ''}` : ''}`);
}

async function refreshRows(cat, gen) {
  const rows = await catalogItems(cat).catch(() => null);
  if (!rows || gen !== C.gen || C.cat !== cat) return;
  C.rows = rows;
  const list = $('catalogList');
  const top = list.scrollTop;
  const shown = C.shown;
  render();
  while (C.shown < Math.min(shown, C.list.length)) more();
  list.scrollTop = top;
}

function stopAnalysis() {
  C.analyzing = false;
}
