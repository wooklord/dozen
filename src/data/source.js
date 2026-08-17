// THE ONLY MODULE THAT TOUCHES THE NETWORK.
//
// Keeping every fetch behind this one interface means the strategy (live API
// vs. a committed snapshot) is swappable in one file.
//
// CORS was verified from a real page context: the API sends
// Access-Control-Allow-Origin: *, so direct client-side fetches work.
// Two constraints come with that and are enforced here:
//
//   1. SIMPLE REQUESTS ONLY. The server does not answer OPTIONS, so any custom
//      request header triggers a preflight and fails outright. Never pass a
//      `headers` option to fetch(). Not one.
//   2. A bad method or column name returns an HTML error page under HTTP 200,
//      so res.json() would throw a confusing SyntaxError. Content-type is
//      checked before parsing and the offending URL is always reported.
//
// /api/ is robots-disallowed for crawlers. We are user-initiated, not a
// crawler, but we behave accordingly: no polling loops, no per-keystroke
// requests, aggressive caching, one batched cold pull.

const BASE = 'https://thecarton.net/api/v2';

// Full-table pulls MUST pass an explicit oversized limit. Without it,
// /setlists.json silently returns exactly 4000 well-formed rows and stops at
// 2024-10-10 while the real archive is 6361. See CLAUDE.md.
const FULL_LIMIT = 20000;

/** Row counts that look like a server-side default rather than real data. */
const SUSPICIOUS_ROUND_COUNTS = new Set([1000, 2000, 4000, 5000, 10000]);

export class DataSourceError extends Error {
  constructor(message, { url, cause, detail } = {}) {
    super(message);
    this.name = 'DataSourceError';
    this.url = url;
    this.cause = cause;
    this.detail = detail;
  }
}

/**
 * Fetch one API URL and return its `data` array.
 * No headers, ever -- see constraint 1 above.
 *
 * Content-type is a HINT here, not the test. The `list` special method returns
 * perfectly valid JSON served as `text/html; charset=UTF-8`, while a bad method
 * or column name also returns `text/html` -- but with an actual HTML document
 * in it. So we parse first and use the shape of the body to tell them apart.
 * Testing content-type alone would reject `list` outright.
 */
async function fetchJson(url) {
  let res;
  try {
    res = await fetch(url);
  } catch (cause) {
    throw new DataSourceError(`Network request failed: ${url}`, { url, cause });
  }

  const text = await res.text();

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON at all. An unknown method or column lands here: an HTML error
    // page served with HTTP 200. Report the URL that caused it.
    const looksHtml = /^\s*(<!doctype|<html)/i.test(text);
    throw new DataSourceError(
      looksHtml
        ? 'Got an HTML page instead of data — likely a bad method or column name.'
        : 'Response was not parseable JSON.',
      { url, detail: `http=${res.status} first80=${text.slice(0, 80)}` },
    );
  }

  // `error` is a JSON boolean (`false`) on the regular methods but the integer
  // `0` on the `list` method. Truthiness covers both spellings.
  if (body.error) {
    throw new DataSourceError(body.error_message || 'API reported an error', {
      url,
      detail: JSON.stringify(body.error_message),
    });
  }

  if (!Array.isArray(body.data)) {
    throw new DataSourceError('Response had no `data` array', { url });
  }

  return body.data;
}

// --- Individual methods -----------------------------------------------------

export async function fetchAllSetlists() {
  const url = `${BASE}/setlists.json?limit=${FULL_LIMIT}`;
  return { rows: await fetchJson(url), url };
}

export async function fetchSetlistsForYear(year) {
  const url = `${BASE}/setlists/showyear/${year}.json?limit=${FULL_LIMIT}`;
  return { rows: await fetchJson(url), url };
}

export async function fetchSongs() {
  const url = `${BASE}/songs.json?limit=${FULL_LIMIT}`;
  return { rows: await fetchJson(url), url };
}

export async function fetchShows() {
  const url = `${BASE}/shows.json?limit=${FULL_LIMIT}`;
  return { rows: await fetchJson(url), url };
}

export async function fetchVenues() {
  const url = `${BASE}/venues.json?limit=${FULL_LIMIT}`;
  return { rows: await fetchJson(url), url };
}

export async function fetchJamcharts() {
  const url = `${BASE}/jamcharts.json?limit=${FULL_LIMIT}`;
  return { rows: await fetchJson(url), url };
}

/** Album membership. Tiny table -- 13 track rows across 5 albums. */
export async function fetchAlbums() {
  const url = `${BASE}/albums.json?limit=${FULL_LIMIT}`;
  return { rows: await fetchJson(url), url };
}

/**
 * The year list that drives the recount.
 *
 * NOT from /list/year.json. The `list` special method sends NO
 * Access-Control-Allow-Origin header -- unlike every regular method, which
 * sends `*` -- so it is unreachable from a browser and fetch() rejects
 * outright. Verified against the live API.
 *
 * Deriving years from the `shows` payload is actually the better cross-check:
 * it is independent of the setlists pull (which is the thing being verified),
 * costs no extra request, and is the authoritative list of years that have
 * shows.
 *
 * Note `shows` spells it `show_year`, while `setlists` uses `showyear`.
 * Implausible years are dropped -- the shows table contains one corrupt row
 * dated 0015-08-28.
 */
export function yearsFromShows(showRows) {
  const years = new Set();
  for (const s of showRows) {
    const y = Number(s.show_year ?? String(s.showdate).slice(0, 4));
    if (Number.isFinite(y) && y >= 2000 && y <= 2100) years.add(y);
  }
  return [...years].sort((a, b) => a - b);
}

// --- Integrity ---------------------------------------------------------------

/**
 * Cheap tripwire. Runs before the expensive recount so an obvious truncation
 * fails in one request instead of fifteen.
 *
 * This is NOT sufficient on its own -- a round row count only catches the
 * failure mode we happened to find. verifyArchive() is the real invariant.
 */
export function quickTruncationCheck(rows, url, newestKnownShowdate) {
  const problems = [];

  if (SUSPICIOUS_ROUND_COUNTS.has(rows.length)) {
    problems.push(
      `Row count is exactly ${rows.length}, which is a server default rather than a real total.`,
    );
  }

  const maxShowdate = rows.reduce((max, r) => (r.showdate > max ? r.showdate : max), '');
  if (newestKnownShowdate && maxShowdate && maxShowdate < newestKnownShowdate) {
    problems.push(
      `Newest setlist row is ${maxShowdate} but the shows table goes to ${newestKnownShowdate}.`,
    );
  }

  return { ok: problems.length === 0, problems, maxShowdate, count: rows.length, url };
}

/**
 * THE REAL INVARIANT: an independent recount.
 *
 * Pulls the authoritative year list, pulls each year separately, and asserts
 * the full pull matches both the summed row count and the max showdate. This
 * is the check that found the 4000-row truncation in the first place.
 *
 * 14 extra requests, so callers run it on FULL REBUILDS ONLY -- never on the
 * incremental fast path. The expensive pull is the one worth verifying.
 *
 * @param {Function} [onProgress] called as (done, total)
 */
export async function verifyArchive(fullRows, fullUrl, years, onProgress) {
  if (!years?.length) {
    throw new DataSourceError('Year list came back empty; cannot verify the archive.', {
      url: fullUrl,
    });
  }

  let expectedCount = 0;
  let expectedMaxShowdate = '';
  const perYear = {};

  for (let i = 0; i < years.length; i++) {
    const year = years[i];
    const { rows } = await fetchSetlistsForYear(year);
    perYear[year] = rows.length;
    expectedCount += rows.length;
    for (const r of rows) {
      if (r.showdate > expectedMaxShowdate) expectedMaxShowdate = r.showdate;
    }
    onProgress?.(i + 1, years.length);
  }

  const actualCount = fullRows.length;
  const actualMaxShowdate = fullRows.reduce(
    (max, r) => (r.showdate > max ? r.showdate : max),
    '',
  );

  const countMatches = actualCount === expectedCount;
  const dateMatches = actualMaxShowdate === expectedMaxShowdate;

  const result = {
    ok: countMatches && dateMatches,
    expectedCount,
    actualCount,
    expectedMaxShowdate,
    actualMaxShowdate,
    perYear,
    url: fullUrl,
  };

  if (!result.ok) {
    // Log the exact URL and BOTH counts, per the integrity rule.
    console.error(
      '[dozen] ARCHIVE VERIFICATION FAILED — refusing to write cache.\n' +
        `  url:      ${fullUrl}\n` +
        `  rows:     received ${actualCount}, expected ${expectedCount}\n` +
        `  newest:   received ${actualMaxShowdate || '(none)'}, expected ${expectedMaxShowdate}\n` +
        `  per-year: ${JSON.stringify(perYear)}`,
    );
  }

  return result;
}

/**
 * One batched cold pull: 5 requests, then verification.
 *
 * On verification failure this THROWS rather than returning partial data, so
 * the caller keeps whatever was previously cached instead of replacing it with
 * something subtly wrong.
 */
export async function fetchFullArchive({ onProgress, verify = true } = {}) {
  const step = (label) => onProgress?.({ phase: 'fetch', label });

  step('setlists');
  const setlists = await fetchAllSetlists();
  step('shows');
  const shows = await fetchShows();
  step('songs');
  const songs = await fetchSongs();
  step('venues');
  const venues = await fetchVenues();
  step('jam charts');
  const jamcharts = await fetchJamcharts();
  step('albums');
  const albums = await fetchAlbums();

  const newestShow = shows.rows.reduce((max, r) => (r.showdate > max ? r.showdate : max), '');

  // Cheap tripwire first.
  const quick = quickTruncationCheck(setlists.rows, setlists.url, null);
  if (!quick.ok) {
    console.error(
      `[dozen] Truncation tripwire fired.\n  url: ${setlists.url}\n  ${quick.problems.join('\n  ')}`,
    );
    throw new DataSourceError('Setlist pull looks truncated.', {
      url: setlists.url,
      detail: quick.problems.join(' '),
    });
  }

  let verification = null;
  if (verify) {
    const years = yearsFromShows(shows.rows);
    onProgress?.({ phase: 'verify', label: 'verifying archive', done: 0, total: years.length });
    verification = await verifyArchive(setlists.rows, setlists.url, years, (done, total) =>
      onProgress?.({ phase: 'verify', label: 'verifying archive', done, total }),
    );
    if (!verification.ok) {
      throw new DataSourceError(
        `Archive verification failed: received ${verification.actualCount} rows, ` +
          `expected ${verification.expectedCount}. Keeping previously cached data.`,
        { url: setlists.url, detail: verification },
      );
    }
  }

  return {
    setlists: setlists.rows,
    shows: shows.rows,
    songs: songs.rows,
    venues: venues.rows,
    jamcharts: jamcharts.rows,
    albums: albums.rows,
    newestShow,
    verification,
    fetchedAt: Date.now(),
  };
}

/**
 * Fast path: current year only, for merging into an existing index.
 * Covers new shows and same-year edits. It CANNOT see retroactive edits to
 * older years -- that is what the manual full rebuild is for.
 */
export async function fetchCurrentYear(year) {
  const { rows, url } = await fetchSetlistsForYear(year);
  const shows = await fetchShows();
  return { setlists: rows, shows: shows.rows, url, year, fetchedAt: Date.now() };
}

export const __config = { BASE, FULL_LIMIT };
