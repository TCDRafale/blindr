import { CATEGORIES, CAT_BY_ID, DIFFICULTIES } from './catalog.js';
import { nextQuestion, markPlayed, resetHistory, loadPool, animeVideoSupported, reportVideoFailure, findBackground, findImage } from './sources.js';
import { prepareBackground, startBackground, stopBackground, pauseBackground, stopAllBackgrounds } from './background.js';

const $ = id => document.getElementById(id);

// ---------- Réglages ----------
const SETTINGS_KEY = 'blindr.settings';
const DEFAULTS = {
  categories: CATEGORIES.map(c => c.id),
  difficulty: 'medium',
  guess: 15,
  reveal: 8,
  animeVideo: true,
  score: true,
  chime: true,
};
let S;
try { S = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { S = { ...DEFAULTS }; }
S.categories = S.categories.filter(id => CAT_BY_ID[id]);
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(S)); } catch { /* ignore */ } };

let poolDirty = false; // catégories ou difficulté modifiées pendant la partie

function renderSettings() {
  const grid = $('catGrid');
  grid.innerHTML = '';
  for (const c of CATEGORIES) {
    const b = document.createElement('button');
    b.className = 'cat' + (S.categories.includes(c.id) ? ' on' : '');
    b.style.setProperty('--cc', c.color);
    b.innerHTML = `<span class="e">${c.emoji}</span><span>${c.label}</span>`;
    b.onclick = () => {
      S.categories = S.categories.includes(c.id) ? S.categories.filter(x => x !== c.id) : [...S.categories, c.id];
      b.classList.toggle('on');
      changed(true);
    };
    grid.appendChild(b);
  }
  document.querySelectorAll('[data-cats]').forEach(btn => {
    btn.onclick = () => {
      S.categories = btn.dataset.cats === 'all' ? CATEGORIES.map(c => c.id) : [];
      grid.querySelectorAll('.cat').forEach(el => el.classList.toggle('on', btn.dataset.cats === 'all'));
      changed(true);
    };
  });

  const seg = $('diffSeg');
  seg.innerHTML = '';
  for (const d of DIFFICULTIES) {
    const b = document.createElement('button');
    b.textContent = d.label;
    b.className = S.difficulty === d.id ? 'on' : '';
    b.onclick = () => {
      S.difficulty = d.id;
      seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      $('diffHint').textContent = d.hint;
      changed(true);
    };
    seg.appendChild(b);
  }
  $('diffHint').textContent = DIFFICULTIES.find(d => d.id === S.difficulty)?.hint || '';

  const bindRange = (input, label, key) => {
    input.value = S[key];
    label.textContent = `${S[key]} s`;
    input.oninput = () => { S[key] = +input.value; label.textContent = `${S[key]} s`; changed(false); };
  };
  bindRange($('guessRange'), $('guessVal'), 'guess');
  bindRange($('revealRange'), $('revealVal'), 'reveal');

  const bindToggle = (input, key, poolChange = false) => {
    input.checked = !!S[key];
    input.onchange = () => { S[key] = input.checked; changed(poolChange); };
  };
  bindToggle($('optAnimeVideo'), 'animeVideo', true);
  bindToggle($('optScore'), 'score');
  bindToggle($('optChime'), 'chime');
  if (!animeVideoSupported()) {
    $('optAnimeVideo').closest('.toggle').classList.add('disabled');
    $('optAnimeVideo').closest('.toggle').querySelector('small').textContent = 'Non pris en charge par ce navigateur';
  }
  $('resetHistory').onclick = () => { resetHistory(); toast('Historique effacé'); };
}

function changed(affectsPool) {
  saveSettings();
  if (affectsPool) poolDirty = true;
  updateHomeStatus();
  updateScore();
}

function updateHomeStatus() {
  const n = S.categories.length;
  $('homeStatus').textContent = n ? `${n} catégorie${n > 1 ? 's' : ''} · ${DIFFICULTIES.find(d => d.id === S.difficulty).label} · ${S.guess} s pour deviner` : 'Choisis au moins une catégorie';
  $('startBtn').disabled = !n;
}

function placeSettings(slot) {
  const s = $('settings');
  $(slot).appendChild(s);
  s.classList.add('placed');
}

// ---------- Médias ----------
// Deux lecteurs audio et deux lecteurs vidéo : pendant qu'un joue, l'autre précharge la manche suivante.
const audios = [$('a0'), $('a1')];
const videos = [$('video'), $('video2')];
let audioIdx = 0;
let videoIdx = 0;
let actx = null;

// Petit WAV silencieux : jouer un média pendant le geste de l'utilisateur débloque la lecture sur iOS.
const SILENT = (() => {
  const n = 800, buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
  const w = (o, s) => [...s].forEach((ch, i) => dv.setUint8(o + i, ch.charCodeAt(0)));
  w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, 8000, true); dv.setUint32(28, 16000, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  w(36, 'data'); dv.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
})();

function unlockMedia() {
  for (const el of [...audios, ...videos]) {
    if (el.dataset.unlocked) continue;
    el.src = SILENT;
    const p = el.play();
    if (p) p.then(() => { el.pause(); el.dataset.unlocked = '1'; }).catch(() => {});
  }
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    actx.resume();
    routeAudio();
  } catch { actx = null; }
}

// Volume par lecteur via Web Audio (sur iOS, la propriété volume est en lecture seule).
// Seuls les lecteurs audio passent par là : les vidéos AnimeThemes n'autorisent pas le CORS.
const gains = new Map();
function routeAudio() {
  if (!actx) return;
  for (const el of audios) {
    if (gains.has(el)) continue;
    try {
      const g = actx.createGain();
      actx.createMediaElementSource(el).connect(g).connect(actx.destination);
      gains.set(el, g);
    } catch { /* lecture directe, sans fondu */ }
  }
}
// Diagnostic depuis la console : état du son.
window.blindrAudio = () => ({ context: actx?.state, gains: audios.map(a => gains.get(a)?.gain.value ?? 'direct') });

function setGain(el, v) {
  const g = gains.get(el);
  if (!g) return;
  g.gain.cancelScheduledValues(actx.currentTime);
  g.gain.setValueAtTime(v, actx.currentTime);
}
function fadeIn(el, s) {
  const g = gains.get(el);
  if (!g) return;
  if (actx.state !== 'running') actx.resume();
  const t = actx.currentTime;
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(1, t + s);
}
function fadeOut(el, s) {
  const g = gains.get(el);
  if (!g || !s) { el.pause(); return; }
  const t = actx.currentTime;
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(g.gain.value, t);
  g.gain.linearRampToValueAtTime(0, t + s);
  setTimeout(() => { if (el !== G.el) el.pause(); }, s * 1000 + 50);
}

function chime() {
  if (!S.chime || !actx) return;
  const t = actx.currentTime;
  [880, 1320].forEach((f, i) => {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0, t + i * 0.09);
    g.gain.linearRampToValueAtTime(0.18, t + i * 0.09 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.6);
    o.connect(g).connect(actx.destination);
    o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.7);
  });
}

function stopAllMedia() {
  for (const el of [...audios, ...videos]) { try { el.pause(); } catch { /* ignore */ } }
}

// Attend que le média ait assez de données pour démarrer (sans jamais échouer).
function mediaReady(el, timeout) {
  return new Promise(resolve => {
    if (el.readyState >= 3) return resolve();
    const done = () => { clearTimeout(t); el.removeEventListener('canplay', done); el.removeEventListener('error', done); resolve(); };
    const t = setTimeout(done, timeout);
    el.addEventListener('canplay', done);
    el.addEventListener('error', done);
  });
}

// Attend que le média joue vraiment (ou échoue).
function playWhenReady(el, timeout = 12000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (ok, err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      el.removeEventListener('playing', onPlaying);
      el.removeEventListener('error', onError);
      ok ? resolve() : reject(err);
    };
    const onPlaying = () => finish(true);
    const onError = () => finish(false, new Error('media error'));
    const timer = setTimeout(() => finish(false, new Error('media timeout')), timeout);
    el.addEventListener('playing', onPlaying);
    el.addEventListener('error', onError);
    const p = el.play();
    if (p) p.catch(err => finish(false, err));
  });
}

// Évite que l'écran verrouillé / le Centre de contrôle affiche le titre pendant qu'on devine.
function maskNowPlaying() {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: 'Blindr', artist: 'Blind test en cours…' });
    navigator.mediaSession.setActionHandler('play', () => setPaused(false));
    navigator.mediaSession.setActionHandler('pause', () => setPaused(true));
    navigator.mediaSession.setActionHandler('nexttrack', skip);
  } catch { /* ignore */ }
}
function showNowPlaying(q) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: q.title, artist: q.subtitle || 'Blindr', artwork: q.cover ? [{ src: q.cover, sizes: '1000x1000' }] : [],
    });
  } catch { /* ignore */ }
}

let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* ignore */ }
}

// ---------- Moteur de jeu ----------
const game = $('game');
const G = {
  gen: 0,             // incrémenté à chaque changement de manche, pour annuler les tâches périmées
  phase: 'idle',
  q: null,
  el: null,
  next: null,         // promesse de la question suivante
  elapsed: 0,
  last: 0,
  paused: false,
  round: 0,
  found: 0,
  judged: 0,
  streak: 0,
  lastSec: -1,
  raf: 0,
};

const FADE_MS = 650; // un peu plus que la plus longue transition de sortie (fond : 0,6 s)
const CROSSFADE_S = 0.6; // durée du fondu enchaîné entre deux extraits

function setPhase(p) { G.phase = p; game.dataset.phase = p; }

function setColor(catId, override) {
  const c = override || CAT_BY_ID[catId]?.color || '#ff3d81';
  for (const el of [game, document.documentElement]) el.style.setProperty('--c', c);
}

// Prépare entièrement la manche suivante pendant que la manche en cours se joue.
function prefetch() {
  const p = (async () => {
    const q = await nextQuestion(S);
    // Vidéo de fond pour la révélation (clip ou bande-annonce) : on n'attend pas plus de 4 s.
    const within = (p, ms) => Promise.race([p.catch(() => null), new Promise(r => setTimeout(() => r(null), ms))]);
    const [bg, img] = await Promise.all([within(findBackground(q), 4000), within(findImage(q), 4000)]);
    q.bg = bg;
    // Pochette de compilation : on la remplace par l'image de l'œuvre (ou rien plutôt que le logo de la compil).
    if (q.genericCover) { q.cover = img; q.backdrop = img; }
    if (q.backdrop) new Image().src = q.backdrop;
    if (q.cover) new Image().src = q.cover;
    // Un préchargement périmé (réglages changés entre-temps) ne doit pas toucher aux lecteurs.
    const current = () => G.next === p;
    if (q.kind === 'audio') {
      // L'extrait Deezer (~480 Ko) est téléchargé en entier : la lecture démarre instantanément.
      try {
        const r = await fetch(q.src);
        if (!r.ok) throw new Error(r.status);
        q.blobUrl = URL.createObjectURL(await r.blob());
      } catch { /* on lira directement depuis Deezer */ }
      const idle = audios[1 - audioIdx];
      if (current() && G.el !== idle) {
        idle.src = q.blobUrl || q.src;
        idle.load();
        q.el = idle;
      }
    } else {
      // Vidéo trop lourde pour être téléchargée : on laisse le lecteur libre en charger le début.
      const idle = videos[1 - videoIdx];
      if (current() && G.el !== idle) {
        idle.src = q.src;
        idle.load();
        q.el = idle;
        await mediaReady(idle, 6000);
      }
    }
    if (current() && q.bg) prepareBackground(q, G.q?.bgSlot);
    return q;
  })();
  p.catch(() => {});
  G.next = p;
  return p;
}

const LOADING_DELAY_MS = 700; // on n'affiche le chargement que si l'attente dure vraiment

async function startGame() {
  unlockMedia();
  G.round = 0; G.found = 0; G.judged = 0; G.streak = 0;
  poolDirty = false;
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s === game));
  setPaused(false);
  keepAwake(true);
  updateScore();
  G.next = null;
  // Préchauffe les réservoirs des catégories choisies, sans bloquer.
  S.categories.forEach((id, i) => setTimeout(() => loadPool(id), 400 + i * 250));
  loop();
  runRound();
}

function quitGame() {
  G.gen++;
  clearInterval(G.raf);
  stopAllMedia();
  setPhase('idle');
  keepAwake(false);
  closeSheet(true);
  game.classList.remove('is-video', 'has-bg', 'paused');
  stopAllBackgrounds();
  $('backdrop').classList.remove('show');
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'home'));
  placeSettings('settingsHome');
  if (S.score && G.judged) toast(`Score : ${G.found} / ${G.judged} 🎯`);
}

async function runRound() {
  const gen = ++G.gen;
  const leavingReveal = G.phase === 'reveal' || G.phase === 'transition';
  const prev = G.el;
  const prevQ = G.q;
  // Entre deux manches : simple transition (fond animé seul), pas d'écran de chargement.
  setPhase(leavingReveal ? 'transition' : 'loading');
  $('backdrop').classList.remove('show');
  $('retryBtn').classList.add('hidden');
  $('loadingText').textContent = G.round ? 'Chargement du prochain extrait…' : 'Préparation des extraits…';
  $('progressBar').style.width = '0%';
  maskNowPlaying();
  stopBackground(prevQ);
  // L'image doit attendre la fin du fondu (sinon elle donne un indice), mais pas le son.
  const visualFade = leavingReveal ? new Promise(r => setTimeout(r, FADE_MS)) : Promise.resolve();
  const slowTimer = setTimeout(() => {
    if (gen === G.gen && G.phase === 'transition') setPhase('loading');
  }, (leavingReveal ? FADE_MS : 0) + LOADING_DELAY_MS);
  const fail = () => { clearTimeout(slowTimer); if (prev) fadeOut(prev, 0); };

  // L'extrait précédent n'est plus utilisé : on libère sa mémoire une fois son fondu terminé.
  if (prevQ?.blobUrl) { const u = prevQ.blobUrl; prevQ.blobUrl = null; setTimeout(() => URL.revokeObjectURL(u), 3000); }
  if (poolDirty) { G.next = null; poolDirty = false; }
  let q;
  try {
    q = await (G.next || prefetch());
  } catch (e) {
    if (gen !== G.gen) return;
    fail();
    G.next = null;
    setPhase('loading');
    $('loadingText').textContent = e.message || 'Erreur de chargement';
    $('retryBtn').classList.remove('hidden');
    return;
  }
  if (gen !== G.gen) return;
  G.next = null;
  G.q = q;

  // Prépare le média (normalement déjà chargé par prefetch).
  let el;
  if (q.kind === 'video') {
    el = q.el || videos[1 - videoIdx];
    if (el.src !== q.src) el.src = q.src;
    videoIdx = videos.indexOf(el);
    el.loop = false;
  } else {
    el = q.el || audios[1 - audioIdx];
    const src = q.blobUrl || q.src;
    if (el.src !== src) el.src = src;
    audioIdx = audios.indexOf(el);
    el.loop = true; // extrait de 30 s : on boucle si deviner + réponse dépasse
  }
  // Coupe tout ce qui n'est ni l'ancien extrait (en fondu) ni le nouveau.
  for (const m of [...audios, ...videos]) if (m !== el && m !== prev) m.pause();
  try { el.currentTime = 0; } catch { /* ignore */ }
  G.el = el;

  // Fondu enchaîné : l'ancien extrait s'efface pendant que le nouveau démarre.
  setGain(el, 0);
  try {
    await playWhenReady(el);
  } catch (e) {
    if (gen !== G.gen) return;
    fail();
    console.warn('Lecture impossible', e);
    if (q.kind === 'video') reportVideoFailure();
    toast('Extrait indisponible, on passe au suivant');
    G.next = null;
    return runRound();
  }
  if (gen !== G.gen) { el.pause(); return; }
  if (prev && prev !== el) fadeOut(prev, CROSSFADE_S);
  fadeIn(el, CROSSFADE_S);
  if (G.paused) el.pause();

  await visualFade;
  if (gen !== G.gen) return;
  clearTimeout(slowTimer);

  videos.forEach(v => v.classList.toggle('active', v === el));
  prepareReveal(q);
  markPlayed(q.key, q.work);
  G.round++;
  $('roundLabel').textContent = `Manche ${G.round}`;
  G.elapsed = 0;
  G.lastSec = -1;
  setPhase('guess');
  prefetch();
}

function prepareReveal(q) {
  const cat = CAT_BY_ID[q.cat];
  setColor(q.cat);
  $('catChip').textContent = `${cat.emoji} ${cat.label}`;
  game.classList.toggle('is-video', q.kind === 'video');
  game.classList.remove('has-bg');

  const bd = $('backdrop');
  bd.classList.remove('show');
  bd.removeAttribute('src');
  if (q.backdrop) bd.src = q.backdrop;

  const cover = $('cover');
  cover.classList.toggle('missing', !q.cover);
  if (q.cover) cover.src = q.cover; else cover.removeAttribute('src');

  $('ansTitle').textContent = q.title;
  $('ansAlt').textContent = q.altTitle || '';
  $('ansSub').textContent = q.subtitle || '';
  $('ansMeta').textContent = [cat.emoji + ' ' + cat.label, q.year].filter(Boolean).join(' · ');
  const judge = $('judge');
  judge.classList.toggle('hidden', !S.score);
  judge.classList.remove('done');
  judge.querySelectorAll('button').forEach(b => b.classList.remove('picked'));
  $('skipBtn').textContent = 'Révéler';
}

function reveal() {
  if (G.phase !== 'guess') return;
  G.elapsed = 0;
  setPhase('reveal');
  if (G.q.backdrop) $('backdrop').classList.add('show');
  game.classList.toggle('has-bg', startBackground(G.q));
  $('skipBtn').textContent = 'Suivant ⏭';
  showNowPlaying(G.q);
  chime();
  if (navigator.vibrate) navigator.vibrate(30);
}

function skip() {
  if (G.phase === 'guess') reveal();
  else if (G.phase === 'reveal') runRound();
}

function loop() {
  clearInterval(G.raf);
  G.last = performance.now();
  const frame = () => {
    const now = performance.now();
    const dt = Math.min(0.25, (now - G.last) / 1000);
    G.last = now;
    if (!G.paused) {
      if (G.phase === 'guess') {
        G.elapsed += dt;
        const total = S.guess;
        const left = Math.max(0, total - G.elapsed);
        $('ringBar').style.strokeDashoffset = String(339.29 * Math.min(1, G.elapsed / total));
        const sec = Math.ceil(left);
        if (sec !== G.lastSec) {
          G.lastSec = sec;
          const cd = $('countdown');
          cd.textContent = sec;
          cd.classList.remove('tick'); void cd.offsetWidth; cd.classList.add('tick');
        }
        $('progressBar').style.width = `${Math.min(100, (G.elapsed / total) * 100)}%`;
        if (left <= 0) reveal();
      } else if (G.phase === 'reveal') {
        G.elapsed += dt;
        $('progressBar').style.width = `${Math.min(100, (G.elapsed / S.reveal) * 100)}%`;
        // Vidéo terminée avant la fin : on passe à la suite.
        if (G.elapsed >= S.reveal || (G.q?.kind === 'video' && G.el?.ended)) runRound();
      }
    }
  };
  G.raf = setInterval(frame, 50);
}

function setPaused(p) {
  G.paused = p;
  game.classList.toggle('paused', p);
  $('pauseBtn').textContent = p ? '▶' : '❚❚';
  if (!G.el || (G.phase !== 'guess' && G.phase !== 'reveal')) return;
  if (G.phase === 'reveal') pauseBackground(G.q, p);
  if (p) G.el.pause();
  else { if (actx && actx.state !== 'running') actx.resume(); G.el.play().catch(() => {}); }
}

function updateScore() {
  $('scoreBox').textContent = S.score && G.judged ? `🎯 ${G.found}/${G.judged}${G.streak >= 3 ? `  🔥${G.streak}` : ''}` : '';
}

// ---------- Feuille de réglages ----------
let wasPaused = false;
function openSheet() {
  wasPaused = G.paused;
  placeSettings('settingsSheet');
  $('sheet').classList.add('open');
  game.classList.add('sheet-open');
  setPaused(true);
}
function closeSheet(silent) {
  if (!$('sheet').classList.contains('open')) return;
  $('sheet').classList.remove('open');
  game.classList.remove('sheet-open');
  if (!silent) {
    setPaused(wasPaused);
    $('judge').classList.toggle('hidden', !S.score);
  }
}

// ---------- Divers ----------
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- Branchements ----------
// Sortie audio : ouvre le sélecteur natif d'iOS (AirPods, Bluetooth, AirPlay…). Safari uniquement.
if (typeof audios[0].webkitShowPlaybackTargetPicker === 'function') {
  $('outputBtn').classList.remove('hidden');
  $('outputBtn').onclick = () => {
    const el = G.el && typeof G.el.webkitShowPlaybackTargetPicker === 'function' ? G.el : audios[audioIdx];
    try { el.webkitShowPlaybackTargetPicker(); } catch { toast('Sélecteur de sortie indisponible'); }
  };
}

$('startBtn').onclick = startGame;
$('quitBtn').onclick = quitGame;
$('pauseBtn').onclick = () => setPaused(!G.paused);
$('skipBtn').onclick = skip;
$('settingsBtn').onclick = openSheet;
$('retryBtn').onclick = () => { G.next = null; runRound(); };
document.querySelectorAll('[data-close]').forEach(el => (el.onclick = () => closeSheet()));
$('pausedOverlay').onclick = () => setPaused(false);
$('judge').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || $('judge').classList.contains('done')) return;
  const ok = b.dataset.ok === '1';
  G.judged++;
  if (ok) { G.found++; G.streak++; } else G.streak = 0;
  b.classList.add('picked');
  $('judge').classList.add('done');
  updateScore();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.classList.contains('active') && !G.paused && !window.__noAutoPause) setPaused(true);
  if (!document.hidden && game.classList.contains('active')) {
    keepAwake(true);
    if (actx && actx.state !== 'running') actx.resume().catch(() => {});
  }
});
$('backdrop').onerror = () => $('backdrop').removeAttribute('src');
$('cover').onerror = () => $('cover').classList.add('missing');

renderSettings();
placeSettings('settingsHome');
updateHomeStatus();
setColor(S.categories[0] || 'anime');

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
