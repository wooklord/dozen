// IndexedDB cache for the archive, under ONE key with ONE expiry.
//
// The setlist archive is ~5.2 MB, which is far past what localStorage can hold,
// so the bulk payload lives in IndexedDB. localStorage is used only for small
// user state (scratchpad, selected show) elsewhere.
//
// Nothing here ever writes a payload that failed verification -- callers are
// expected to throw before reaching writeArchive().

const DB_NAME = 'dozen';
const DB_VERSION = 1;
const STORE = 'payloads';

/**
 * How long the cached archive is considered fresh.
 *
 * ONE VALUE, because there is one thing to expire. This was a five-entry `TTL`
 * map keyed by data type -- setlists 6h, shows 6h, songs 24h, jamcharts 24h,
 * venues 7d -- and four of those five could never fire. Everything is written
 * as a single blob under a single key with a single `fetchedAt`, so there is
 * no per-type timestamp to compare against and `isStale()` only ever read
 * `TTL.setlists`. The map described a cache design the code does not have.
 *
 * Per-type expiry is not merely unimplemented, it is structurally impossible
 * here without splitting the payload into separate keys. That would be a real
 * change with a real benefit (venues genuinely never move), and it is not this
 * one -- so the constant now says what the code does. See docs/plan.md.
 *
 * Six hours because the setlists table is the one that moves, and it moves
 * after each show. Anything with a longer natural life rides along with it.
 */
export const ARCHIVE_TTL = 6 * 60 * 60 * 1000;

const ARCHIVE_KEY = 'archive.v1';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function idbSet(key, value) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function idbDelete(key) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Read the cached archive, or null. Never throws on a missing/corrupt store. */
export async function readArchive() {
  try {
    const stored = await idbGet(ARCHIVE_KEY);
    if (!stored || !Array.isArray(stored.setlists)) return null;
    return stored;
  } catch (err) {
    console.warn('[dozen] cache read failed, treating as cold start', err);
    return null;
  }
}

/**
 * Persist a verified archive. Callers must not reach this with unverified data
 * -- fetchFullArchive() throws instead of returning a failed pull.
 */
export async function writeArchive(archive) {
  const payload = {
    setlists: archive.setlists,
    shows: archive.shows,
    songs: archive.songs,
    venues: archive.venues,
    jamcharts: archive.jamcharts,
    albums: archive.albums || [],
    fetchedAt: archive.fetchedAt ?? Date.now(),
    fullFetchedAt: archive.fullFetchedAt ?? archive.fetchedAt ?? Date.now(),
    verification: archive.verification ?? null,
  };
  try {
    await idbSet(ARCHIVE_KEY, payload);
    return true;
  } catch (err) {
    // A failed write is not fatal -- the in-memory index still works for this
    // session. Surfaced so it is visible without dev tools.
    console.error('[dozen] cache write failed', err);
    return false;
  }
}

export async function clearArchive() {
  try {
    await idbDelete(ARCHIVE_KEY);
    return true;
  } catch (err) {
    console.error('[dozen] cache clear failed', err);
    return false;
  }
}

/** Is the cached archive past its TTL? */
export function isStale(archive, now = Date.now()) {
  if (!archive?.fetchedAt) return true;
  return now - archive.fetchedAt > ARCHIVE_TTL;
}

/** Age of the cache in ms. */
export function cacheAge(archive, now = Date.now()) {
  if (!archive?.fetchedAt) return null;
  return now - archive.fetchedAt;
}

/**
 * Merge a current-year fast-path pull into a cached archive.
 *
 * Rows are keyed by `uniqueid`, which is stable per song-performance. Every
 * row for the pulled year is replaced wholesale, so deletions within that year
 * are picked up too, not just additions and edits.
 */
export function mergeYear(archive, { setlists, shows, year }) {
  const y = Number(year);
  const kept = archive.setlists.filter((r) => Number(r.showyear) !== y);
  const merged = kept.concat(setlists);

  // Guard: a merge must never shrink the archive. If the year pull came back
  // short, keep what we had rather than quietly dropping shows.
  const priorForYear = archive.setlists.length - kept.length;
  if (setlists.length < priorForYear) {
    console.error(
      `[dozen] fast-path merge REJECTED for ${y}: pull had ${setlists.length} rows but ` +
        `the cache already held ${priorForYear}. Keeping cached data.`,
    );
    return { ...archive, mergeRejected: true };
  }

  return {
    ...archive,
    setlists: merged,
    shows: shows ?? archive.shows,
    fetchedAt: Date.now(),
    fullFetchedAt: archive.fullFetchedAt ?? archive.fetchedAt,
    mergeRejected: false,
  };
}
