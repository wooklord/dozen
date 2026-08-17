// Pick scratchpad: a local-only shortlist.
//
// localStorage, no account, no server, no external integration. The list is
// ordered by the user and copied out as plain text so they can type it into
// whatever they are actually playing. It is never sent anywhere.

const KEY = 'dozen.picks.v1';
const listeners = new Set();

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p) => p && p.song_id) : [];
  } catch {
    return [];
  }
}

function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch (err) {
    // Quota or private-mode failure. The in-memory list still works for this
    // session; surfaced rather than silently swallowed.
    console.error('[dozen] could not save picks', err);
  }
  for (const fn of listeners) fn(list);
}

export function getPicks() {
  return read();
}

export function isPicked(songId) {
  return read().some((p) => Number(p.song_id) === Number(songId));
}

export function togglePick(song) {
  const list = read();
  const id = Number(song.song_id);
  const i = list.findIndex((p) => Number(p.song_id) === id);
  if (i >= 0) list.splice(i, 1);
  else list.push({ song_id: id, name: song.name, slug: song.slug });
  write(list);
  return list;
}

export function removePick(songId) {
  write(read().filter((p) => Number(p.song_id) !== Number(songId)));
}

export function reorder(fromIndex, toIndex) {
  const list = read();
  if (fromIndex < 0 || fromIndex >= list.length) return list;
  const [item] = list.splice(fromIndex, 1);
  list.splice(Math.max(0, Math.min(toIndex, list.length)), 0, item);
  write(list);
  return list;
}

export function clearPicks() {
  write([]);
}

export function count() {
  return read().length;
}

/** Plain text, numbered, ready to type into the fantasy app by hand. */
export function asPlainText() {
  return read().map((p, i) => `${i + 1}. ${p.name}`).join('\n');
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Clipboard with a fallback for browsers that block the async API. */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
