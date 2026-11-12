// Écran Catalogue : parcourir le catalogue commun, écouter, exclure ou remettre en jeu, et copier ses corrections
// pour qu'elles soient intégrées au catalogue de tous les appareils.
import { CATEGORIES, CAT_BY_ID } from './catalog.js';
import {
  catalogRows, trackPreview, animeCatalogPage, animeOpening,
  setExcluded, setKept, excludeAnime, correctionsText, guessName,
} from './sources.js';

const $ = id => document.getElementById(id);
const LEVEL_LABEL = { easy: 'Facile', medium: 'Moyen', hard: 'Difficile' };
const LEVEL_ORDER = { easy: 0, medium: 1, hard: 2 };
const PAGE = 120;          // lignes affichées d'un coup (le reste au défilement)
const ANIME_PAGES = 20;    // 20 pages AniList de 50 = les 1 000 anime de la catégorie

const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const C = { cat: null, level: 'all', query: '', rows: [], shown: 0, list: [], animePages: 0, loadingAnime: false, playing: null, gen: 0 };
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
  $('catalogCorrBtn').onclick = copyCorrections;
  for (const el of [audio, video]) el.addEventListener('ended', stopPlayback);
}

export function openCatalog(firstCat) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'catalog'));
  updateCorrections();
  selectCat(C.cat || firstCat || 'films');
}

function closeCatalog() {
  stopPlayback();
  C.gen++;
  opts.onClose?.();
}

async function selectCat(id) {
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
  try {
    const rows = await catalogRows(id);
    if (gen !== C.gen) return;
    C.rows = rows;
    if (id === 'anime') await loadAnimePages(2, gen);
  } catch {
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
  // Œuvres du catalogue triées par niveau puis par nom ; anime AniList dans leur ordre de popularité, à la suite.
  const rank = r => (r.anime ? 1 : 0);
  return rows.sort((a, b) => rank(a) - rank(b) ||
    (a.anime ? 0 : (LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]) || a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' })));
}

function render() {
  const list = $('catalogList');
  C.list = filtered();
  C.shown = 0;
  list.innerHTML = '';
  updateHeader();
  if (C.level === 'out' && C.list.some(r => r.state === 'auto')) {
    list.insertAdjacentHTML('beforeend', '<p class="cat-legend">Titres écartés par le tri automatique (avec la raison) et titres que tu as exclus. ↺ les remet dans le blind test.</p>');
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
  const animeLeft = C.cat === 'anime' && C.animePages < ANIME_PAGES && C.level !== 'out';
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
    : `<span class="lvl ${r.level}">${r.kept ? 'Remis' : LEVEL_LABEL[r.level]}</span>`;
  const icon = CAT_BY_ID[C.cat]?.emoji || '🎵';
  return `<div class="cat-row${out ? ' out' : ''}${C.playing === r.key ? ' playing' : ''}" data-key="${esc(r.key)}" role="button">
    <div class="thumb">${icon}${r.cover ? `<img src="${esc(r.cover)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</div>
    <div class="txt"><div class="nm">${esc(r.name)}</div><div class="sb">${esc(r.sub)}</div></div>
    ${badge}
    <button class="row-act" data-act="${out ? 'restore' : 'exclude'}" aria-label="${out ? 'Remettre dans le jeu' : 'Exclure du jeu'}">${out ? '↺' : '✕'}</button>
  </div>`;
}

function updateHeader() {
  const ok = C.rows.filter(r => r.state === 'ok');
  const anime = ok.filter(r => r.anime).length;
  const own = ok.length - anime;
  const isWork = CAT_BY_ID[C.cat]?.work;
  const parts = [];
  if (own || !anime) parts.push(`${own} ${C.cat === 'anime' ? 'génériques' : isWork ? 'œuvres' : 'titres'}`);
  if (anime) parts.push(`${anime}${C.animePages < ANIME_PAGES ? '+' : ''} anime`);
  $('catalogCount').textContent = parts.join(' · ');
}

function updateCorrections() {
  const { n } = correctionsText();
  $('catalogCorr').classList.toggle('hidden', !n);
  $('catalogCorrText').textContent = `${n} correction${n > 1 ? 's' : ''} sur cet appareil. Copie-les et envoie-les à Claude pour les appliquer à tous tes appareils.`;
}

async function copyCorrections() {
  const { text } = correctionsText();
  try {
    await navigator.clipboard.writeText(text);
    opts.toast?.('Corrections copiées');
  } catch {
    window.prompt('Copie ce texte :', text);
  }
}

function rowOf(key) { return C.rows.find(r => r.key === key); }

async function onListClick(e) {
  const rowEl = e.target.closest('.cat-row');
  if (!rowEl) return;
  const r = rowOf(rowEl.dataset.key);
  if (!r) return;
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'exclude') {
    if (r.anime) { excludeAnime(r.id, true); r.state = 'user'; }
    else if (r.kept) { setKept(r.id, null); r.kept = false; r.state = 'auto'; r.name = r.raw.s; r.sub = `${r.raw.a} · ${r.raw.why}`; }
    else { setExcluded(r.key, r.label, true); r.state = 'user'; }
    if (C.playing === r.key) stopPlayback();
    rowEl.remove();
    updateHeader(); updateCorrections();
    opts.toast?.('Retiré du blind test');
    return;
  }
  if (act === 'restore') {
    if (r.anime) excludeAnime(r.id, false);
    else if (r.state === 'auto') {
      // Titre écarté par le tri : on demande sous quel nom il doit apparaître (l'œuvre, pour les catégories d'œuvres).
      const isWork = CAT_BY_ID[C.cat]?.work;
      const proposed = isWork ? guessName(C.cat, r.raw) : r.raw.s;
      const name = isWork ? window.prompt('Nom de l\'œuvre à deviner :', proposed) : proposed;
      if (name == null || !name.trim()) return;
      setKept(r.id, { cat: C.cat, name: name.trim(), label: r.label });
      r.kept = true; r.name = name.trim(); r.sub = `${r.raw.s} — ${r.raw.a} · remis en jeu`;
    } else setExcluded(r.key, r.label, false);
    r.state = 'ok';
    rowEl.remove();
    updateHeader(); updateCorrections();
    opts.toast?.('Remis dans le blind test');
    return;
  }
  togglePlay(r, rowEl);
}

// ---------- Écoute ----------
async function togglePlay(r, rowEl) {
  if (C.playing === r.key) { stopPlayback(); return; }
  stopPlayback();
  const el = r.anime ? video : audio;
  // iOS : la lecture doit démarrer pendant le geste ; on débloque le lecteur avant de chercher l'extrait.
  if (!el.dataset.unlocked && opts.silent) {
    el.src = opts.silent;
    el.play().then(() => { el.pause(); el.dataset.unlocked = '1'; }).catch(() => {});
  }
  C.playing = r.key;
  rowEl.classList.add('loading');
  try {
    const src = r.anime ? await animeOpening(r.id) : await trackPreview(r.id);
    if (C.playing !== r.key) return;
    if (!src) throw new Error('aucun extrait');
    el.src = src;
    el.currentTime = 0;
    await el.play();
    rowEl.classList.remove('loading');
    rowEl.classList.add('playing');
  } catch {
    if (C.playing === r.key) { stopPlayback(); opts.toast?.('Extrait indisponible'); }
  }
}

function stopPlayback() {
  C.playing = null;
  for (const el of [audio, video]) { try { el.pause(); } catch { /* ignore */ } }
  document.querySelectorAll('.cat-row.playing, .cat-row.loading').forEach(x => x.classList.remove('playing', 'loading'));
}
