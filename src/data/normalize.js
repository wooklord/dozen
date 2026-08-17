// Song-name normalization and HTML entity decoding.
//
// ONE normalizer, used everywhere. Case-folding alone is NOT enough -- that
// mistake has already caused a live bug in another app.
//
// Hazards this must handle, all present in the live Carton data:
//   - U+2019 curly apostrophe   "A Moment’s Notice", "I’ll Take A Melody"
//   - U+0027 straight apostrophe "Hux (Wit' It)", "I Was Born (No I Wasn't)"
//     ...both forms occur in the same field in the same dataset.
//   - trailing punctuation       "Yuck!"
//   - parentheticals             "Silver Steed (My Blue)"
//   - numbered variants          "Burritos El Chavo 2"  <- MUST stay distinct
//   - short alphanumerics        "B7"
//
// Prefer song_id / slug for identity wherever available. This normalizer is
// for matching user-typed input and for joining the rare places where only a
// name is present. It is not the primary key.

/** Named HTML entities that actually occur in Carton data. */
const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
};

/**
 * Decode HTML entities. Carton is inconsistent: `venuename` is entity-encoded
 * in the `shows` method ("Annabel&#039;s") and raw in `setlists` ("Toad's
 * Place"). This runs once at the data-source boundary so no view ever sees an
 * entity, and two views can never disagree about a name.
 *
 * Pure string implementation on purpose -- no DOM, so it behaves identically
 * in the browser and under `node --test`.
 */
export function decodeEntities(input) {
  if (input == null) return '';
  const str = String(input);
  if (!str.includes('&')) return str;

  return str.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      // Lone surrogates would throw; leave them untouched.
      if (code >= 0xd800 && code <= 0xdfff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? match : named;
  });
}

/**
 * Fold the many Unicode apostrophe/quote forms onto their ASCII equivalents.
 * U+2019 and U+0027 MUST end up identical -- both appear in the live data.
 */
function foldQuotes(str) {
  return str
    .replace(/[‘’ʼʹ′´`]/g, "'")
    .replace(/[“”″]/g, '"');
}

/** Fold dash variants to ASCII hyphen. */
function foldDashes(str) {
  return str.replace(/[‐‑‒–—―−]/g, '-');
}

/** Strip diacritics (NFD, then drop combining marks). */
function foldDiacritics(str) {
  return str.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Canonical matching key for a song name.
 *
 * Deliberate choices:
 *   - Parentheticals are KEPT. "Silver Steed (My Blue)" is the song's actual
 *     name, not decoration. Use stripParenthetical() explicitly for the looser
 *     match, never by default.
 *   - Trailing *punctuation* is stripped ("Yuck!" -> "yuck") but trailing
 *     *digits* are NOT ("Burritos El Chavo 2" stays distinct from "...Chavo",
 *     and "B7" stays "b7").
 *   - Internal punctuation that carries no meaning for matching is dropped,
 *     so "Wit' It" and "Wit It" agree.
 */
export function normalizeSongName(input) {
  if (input == null) return '';
  let s = decodeEntities(String(input));

  s = foldQuotes(s);
  s = foldDashes(s);
  s = foldDiacritics(s);
  s = s.toLowerCase();

  // "&" and "and" are the same song to a human typing it.
  s = s.replace(/\s*&\s*/g, ' and ');

  // Drop apostrophes entirely rather than keeping them: once U+2019 and U+0027
  // are folded together, whether the apostrophe survives no longer matters, and
  // dropping it also matches people who omit it.
  s = s.replace(/'/g, '');

  // Remaining punctuation becomes a space so words stay separated.
  // NOTE: digits and letters are preserved -- numbered variants must survive.
  s = s.replace(/[^\p{L}\p{N}()]+/gu, ' ');

  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Looser key with any trailing parenthetical removed:
 *   "Silver Steed (My Blue)" -> "silver steed"
 * NOT the default. Only for explicitly opt-in fuzzy lookup, because it will
 * happily collapse genuinely different songs.
 */
export function stripParenthetical(input) {
  const normalized = normalizeSongName(input);
  const stripped = normalized.replace(/\s*\([^()]*\)\s*$/, '').trim();
  return stripped || normalized;
}

/** Normalize free-text search input the same way song names are normalized. */
export function normalizeQuery(input) {
  return normalizeSongName(input);
}

/**
 * Venue/city display cleanup. Entity-decoded and whitespace-collapsed, but
 * case and punctuation preserved -- this is for DISPLAY, not matching.
 */
export function cleanDisplayText(input) {
  if (input == null) return '';
  return decodeEntities(String(input)).replace(/\s+/g, ' ').trim();
}

/** Matching key for venue names. */
export function normalizeVenueName(input) {
  return normalizeSongName(input);
}
