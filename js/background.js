// Vidéo de fond muette à la révélation : clip MP4 (Apple) ou bande-annonce YouTube.
// Deux emplacements alternent : l'un sert la manche en cours, l'autre précharge la suivante.

const layer = document.getElementById('bgLayer');
const slots = [0, 1].map(i => {
  const video = document.createElement('video');
  video.className = 'bgvid';
  video.muted = true;
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.loop = true;
  video.preload = 'auto';
  const wrap = document.createElement('div');
  wrap.className = 'bgvid yt';
  layer.append(video, wrap);
  const slot = { i, video, wrap, kind: null, player: null, ready: false, failed: false, wantPlay: false, start: 0, warm: false, playingSince: 0, showTimer: 0 };
  video.addEventListener('playing', () => slot.kind === 'mp4' && video.classList.add('playing'));
  video.addEventListener('error', () => { if (slot.kind === 'mp4') slot.failed = true; });
  return slot;
});

let ytPromise = null;
function loadYouTube() {
  if (window.YT?.Player) return Promise.resolve();
  if (ytPromise) return ytPromise;
  ytPromise = new Promise((resolve, reject) => {
    const t = setTimeout(() => { ytPromise = null; reject(new Error('youtube timeout')); }, 10000);
    window.onYouTubeIframeAPIReady = () => { clearTimeout(t); resolve(); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { clearTimeout(t); ytPromise = null; reject(new Error('youtube')); };
    document.head.appendChild(s);
  });
  return ytPromise;
}

// Sur iPhone, le lecteur YouTube affiche ses boutons (lecture, ±10 s) pendant quelques secondes chaque fois que la
// vidéo démarre, repart d'une pause ou change de position. La bande-annonce est donc lancée cachée un peu avant la
// révélation, sans jamais être mise en pause ni déplacée ensuite, et ne devient visible qu'après HIDE_MS de lecture.
const HIDE_MS = 4000;
export const WARM_BEFORE_S = 5;   // lancement caché, en secondes avant la fin du compte à rebours

function scheduleShow(slot) {
  clearTimeout(slot.showTimer);
  if (!slot.wantPlay || slot.failed || !slot.playingSince) return;
  const delay = Math.max(0, slot.playingSince + HIDE_MS - Date.now());
  slot.showTimer = setTimeout(() => { if (slot.wantPlay && !slot.failed) slot.wrap.classList.add('playing'); }, delay);
}
function hideYt(slot) {
  clearTimeout(slot.showTimer);
  slot.playingSince = 0;
  slot.wrap.classList.remove('playing');
}

function reset(slot) {
  clearTimeout(slot.showTimer);
  slot.video.classList.remove('active', 'playing');
  slot.wrap.classList.remove('active', 'playing');
  slot.video.pause();
  slot.video.removeAttribute('src');
  slot.video.load();
  try { slot.player?.destroy(); } catch { /* ignore */ }
  slot.player = null;
  slot.wrap.innerHTML = '';
  Object.assign(slot, { kind: null, ready: false, failed: false, wantPlay: false, warm: false, playingSince: 0 });
}

// Prépare la vidéo de q dans l'emplacement qui n'est pas utilisé par la manche en cours.
export async function prepareBackground(q, busySlot) {
  if (!q.bg) return;
  const slot = slots.find(s => s !== busySlot) || slots[0];
  reset(slot);
  q.bgSlot = slot;
  if (q.bg.t === 'mp4') {
    slot.kind = 'mp4';
    slot.video.src = q.bg.src;
    slot.video.load();
    return;
  }
  slot.kind = 'yt';
  slot.start = q.bg.start || 0;
  try { await loadYouTube(); } catch { slot.failed = true; return; }
  if (q.bgSlot !== slot || slot.kind !== 'yt') return;
  const host = document.createElement('div');
  slot.wrap.appendChild(host);
  slot.player = new YT.Player(host, {
    videoId: q.bg.id,
    host: 'https://www.youtube-nocookie.com',
    playerVars: {
      autoplay: 0, mute: 1, controls: 0, playsinline: 1, rel: 0, modestbranding: 1,
      iv_load_policy: 3, disablekb: 1, fs: 0, start: slot.start, loop: 1, playlist: q.bg.id,
    },
    events: {
      onReady: e => {
        slot.ready = true;
        e.target.mute();
        if (slot.warm) e.target.playVideo(); // la révélation approche (ou a eu lieu) : on lance
      },
      onStateChange: e => {
        const S = YT.PlayerState;
        if (e.data === S.PLAYING) {
          if (!slot.playingSince) slot.playingSince = Date.now();
          scheduleShow(slot);
        } else if (e.data === S.PAUSED || e.data === S.ENDED || e.data === S.CUED) {
          hideYt(slot);
        }
      },
      onError: () => { slot.failed = true; hideYt(slot); },
    },
  });
}

// Quelques secondes avant la révélation : lance la bande-annonce, encore cachée, au début de l'extrait.
export function warmBackground(q) {
  const slot = q?.bgSlot;
  if (!slot || slot.kind !== 'yt' || slot.failed || slot.warm) return;
  slot.warm = true;
  if (slot.ready) try { slot.player.playVideo(); } catch { slot.failed = true; }
}

// À la révélation : affiche la vidéo (en fondu, dès qu'elle joue sans les boutons du lecteur).
export function startBackground(q) {
  const slot = q.bgSlot;
  if (!slot || slot.failed) return false;
  slot.wantPlay = true;
  if (slot.kind === 'mp4') {
    slot.video.classList.add('active');
    try { slot.video.currentTime = 0; } catch { /* ignore */ }
    slot.video.play().catch(() => { slot.failed = true; });
  } else {
    slot.wrap.classList.add('active');
    warmBackground(q);      // révélation anticipée : lancement maintenant
    scheduleShow(slot);
  }
  return true;
}

// Fin de manche : fondu de sortie puis arrêt.
export function stopBackground(q, delay = 700) {
  const slot = q?.bgSlot;
  if (!slot) return;
  slot.wantPlay = false;
  slot.video.classList.remove('active');
  slot.wrap.classList.remove('active');
  clearTimeout(slot.showTimer);
  setTimeout(() => {
    if (slot.wantPlay) return;
    slot.wrap.classList.remove('playing');
    slot.video.pause();
    try { slot.player?.pauseVideo(); } catch { /* ignore */ }
  }, delay);
}

export function pauseBackground(q, paused) {
  const slot = q?.bgSlot;
  if (!slot || !slot.wantPlay) return;
  if (slot.kind === 'mp4') paused ? slot.video.pause() : slot.video.play().catch(() => {});
  else {
    hideYt(slot);   // à la reprise, les boutons réapparaissent : la vidéo attend à nouveau HIDE_MS
    try { paused ? slot.player?.pauseVideo() : slot.player?.playVideo(); } catch { /* ignore */ }
    if (!paused) { slot.playingSince = Date.now(); scheduleShow(slot); }
  }
}

export function stopAllBackgrounds() { slots.forEach(reset); }
