// Date helpers.
//
// EVERY date comparison in this app is against a LOCAL calendar date, never
// toISOString(). At 8pm EDT `new Date().toISOString()` already reports
// tomorrow -- which is exactly when someone is standing in a venue looking at
// the upcoming-show screen. Carton's `showdate` is a local calendar date with
// no timezone, so comparing it to a UTC-derived string is simply wrong.

/** Today as a local YYYY-MM-DD string. */
export function localToday(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Current local year as a number. Used to pick the fast-path pull. */
export function localYear(now = new Date()) {
  return now.getFullYear();
}

/**
 * Parse a Carton `showdate` ("2026-08-14") as a LOCAL date at midnight.
 * `new Date("2026-08-14")` parses as UTC midnight and can render as the
 * previous day in western timezones, so the parts are passed explicitly.
 */
export function parseShowDate(showdate) {
  if (!showdate || typeof showdate !== 'string') return null;
  const m = showdate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Whole days between two YYYY-MM-DD strings (b - a). */
export function daysBetween(a, b) {
  const da = parseShowDate(a);
  const db = parseShowDate(b);
  if (!da || !db) return null;
  return Math.round((db - da) / 86400000);
}

/** "2026-08-14" -> "Fri Aug 14, 2026" */
export function formatShowDate(showdate) {
  const d = parseShowDate(showdate);
  if (!d) return showdate ?? '';
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** "2026-08-14" -> "Aug 14, 2026" */
export function formatShowDateShort(showdate) {
  const d = parseShowDate(showdate);
  if (!d) return showdate ?? '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "2026-08-14" -> "8/14/26", matching how Carton writes LTP footnotes. */
export function formatShowDateTiny(showdate) {
  const d = parseShowDate(showdate);
  if (!d) return showdate ?? '';
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

/** Month-day key "08-14" for "On This Date" lookups. */
export function monthDayKey(showdate) {
  if (!showdate || typeof showdate !== 'string') return '';
  return showdate.slice(5, 10);
}

/** Human elapsed time, for the cache-age readout. */
export function formatAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}
