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
  const slot = { i, video, wrap, kind: null, player: null, ready: false, failed: false, wantPlay: false, start: 0, clean: false, showTimer: 0 };
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

// Sur iPhone, une vidéo YouTube qui repart après une pause affiche ses boutons (lecture, ±10 s) quelques secondes.
// Elle n'apparaît donc qu'une fois ces boutons disparus, sauf si elle n'a jamais été mise en pause.
const CONTROLS_FADE = 3200;
function showYt(slot, delay) {
  clearTimeout(slot.showTimer);
  slot.showTimer = setTimeout(() => { if (slot.wantPlay && !slot.failed) slot.wrap.classList.add('playing'); }, delay);
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
  Object.assign(slot, { kind: null, ready: false, failed: false, wantPlay: false, clean: false });
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
        // Lancée tout de suite, cachée et muette, et jamais mise en pause avant la révélation : une pause ferait
        // réapparaître les boutons du lecteur au moment où la vidéo devient visible.
        e.target.playVideo();
      },
      onStateChange: e => {
        const S = YT.PlayerState;
        if (e.data === S.PLAYING) {
          if (!slot.wantPlay) slot.clean = true;
          else showYt(slot, slot.clean ? 0 : CONTROLS_FADE);
        } else if (e.data === S.PAUSED || e.data === S.ENDED) {
          slot.clean = false;
          if (slot.wantPlay) { clearTimeout(slot.showTimer); slot.wrap.classList.remove('playing'); }
        }
      },
      onError: () => { slot.failed = true; slot.wrap.classList.remove('playing'); },
    },
  });
}

// À la révélation : lance la vidéo (elle apparaît en fondu dès qu'elle joue vraiment).
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
    if (slot.ready) {
      try {
        // Déjà en lecture (cachée) : on revient au début de l'extrait, sans pause, donc sans boutons.
        slot.clean = slot.clean && slot.player.getPlayerState() === YT.PlayerState.PLAYING;
        slot.player.seekTo(slot.start, true);
        slot.player.playVideo();
        if (slot.clean) showYt(slot, 150);
      } catch { slot.failed = true; }
    }
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
    if (paused) { slot.clean = false; clearTimeout(slot.showTimer); slot.wrap.classList.remove('playing'); }
    try { paused ? slot.player?.pauseVideo() : slot.player?.playVideo(); } catch { /* ignore */ }
    if (!paused) showYt(slot, CONTROLS_FADE);
  }
}

export function stopAllBackgrounds() { slots.forEach(reset); }
