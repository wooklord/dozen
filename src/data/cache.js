// IndexedDB cache with explicit per-type TTLs.
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

/** TTLs by data type, in milliseconds. */
export const TTL = {
  setlists: 6 * 60 * 60 * 1000, // changes after each show
  shows: 6 * 60 * 60 * 1000,
  songs: 24 * 60 * 60 * 1000,
  jamcharts: 24 * 60 * 60 * 1000,
  venues: 7 * 24 * 60 * 60 * 1000, // effectively never changes
};

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
  return now - archive.fetchedAt > TTL.setlists;
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
