// Nettoyage et comparaison des noms (titres, œuvres) : commun à l'app et au script qui construit le catalogue.
// Aucune dépendance au navigateur.

export const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\(.*?\)|\[.*?\]|feat\..*$|ft\..*$/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export const looseMatch = (a, b) => { a = norm(a); b = norm(b); return !!a && !!b && (a.startsWith(b) || b.startsWith(a)); };

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

export const SOUNDTRACK_RE = /(soundtrack|motion picture|bande originale|\bscore\b|video game|original game|o\.s\.t|\bost\b|music from|original series|générique original|du film|complete recordings|tv series)/i;
export const COMPIL_RE = /(best of|génériques|generiques|plus belles|hits|vol\.|volume|magie|compil|collection|essentials|ultimate|greatest|meilleur|\btop\b|disneyland|revisit)/i;

export function cleanWork(s) {
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

export const GENERIC_ARTIST = /^(génériques?|generiques?|tv themes|soundtrack|various|cast|bande originale)/i;

// « Pour l'amour du risque » ≈ « L'amour du risque ». Le nom court doit couvrir au moins la moitié du long.
export function sameName(a, b) {
  a = norm(a).replace(/^(the|le|la|les|l)\s+/, ''); b = norm(b).replace(/^(the|le|la|les|l)\s+/, '');
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return long.includes(short) && short.length / long.length >= 0.5;
}
