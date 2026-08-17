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
 */
async function fetchJson(url) {
  let res;
  try {
    res = await fetch(url);
  } catch (cause) {
    throw new DataSourceError(`Network request failed: ${url}`, { url, cause });
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    // An unknown method or column name lands here: HTML body, HTTP 200.
    throw new DataSourceError(
      `Expected JSON but got "${contentType || 'unknown'}" -- likely a bad method or column name.`,
      { url, detail: `http=${res.status}` },
    );
  }

  let body;
  try {
    body = await res.json();
  } catch (cause) {
    throw new DataSourceError(`Response was not parseable JSON: ${url}`, { url, cause });
  }

  // `error` is a JSON boolean here, NOT the 0/1 integer the published docs
  // describe. Truthiness covers both spellings anyway.
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

/** The authoritative year list, used to drive the recount. */
export async function fetchYears() {
  const url = `${BASE}/list/year.json`;
  const rows = await fetchJson(url);
  // The `list` method returns a flat array of { field: value }.
  return { years: rows.map((r) => Number(r.field)).filter(Number.isFinite).sort(), url };
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
export async function verifyArchive(fullRows, fullUrl, onProgress) {
  const { years, url: yearsUrl } = await fetchYears();
  if (!years.length) {
    throw new DataSourceError('Year list came back empty; cannot verify the archive.', {
      url: yearsUrl,
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
    onProgress?.({ phase: 'verify', label: 'verifying archive', done: 0, total: 14 });
    verification = await verifyArchive(setlists.rows, setlists.url, (done, total) =>
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
