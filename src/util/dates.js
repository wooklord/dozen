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

/**
 * A month-day key rendered for a human: "08-14" -> "Aug 14".
 *
 * NOT `md.replace('-', '/')`. "10/15" was the only numeric date rendered
 * anywhere in the UI, and it was ambiguous to exactly the reader this app is
 * for: an "On this date" header names a calendar day, and 10/15 reads as a
 * fraction before it reads as October. Every other date on screen goes
 * through formatShowDate/formatShowDateShort and spells its month, and this
 * one now comes out of the same locale call, so the abbreviations cannot
 * drift apart.
 *
 * The year is arbitrary and never rendered. 2000 is used because it is a leap
 * year, so "02-29" formats as Feb 29 rather than rolling into March.
 *
 * `formatShowDateTiny()` was deleted here in 0.1.70. It rendered "8/14/26" to
 * match how Carton writes its LTP footnotes, it worked correctly, and it had
 * never had a caller. Removed rather than kept for a someday use: it was a
 * ready-made way to put a numeric date back on screen, which is the thing this
 * function exists to have taken off. If Carton's own footnote spelling is ever
 * needed verbatim, quote Carton's string rather than rebuilding it — the house
 * rule is that their text renders as-is and ours names its months.
 */
export function formatMonthDay(monthDay) {
  if (typeof monthDay !== 'string') return '';
  const m = monthDay.match(/^(\d{2})-(\d{2})$/);
  if (!m) return monthDay;
  const mo = Number(m[1]);
  const day = Number(m[2]);
  const d = new Date(2000, mo - 1, day);
  // Reject 13-40 and 02-31 rather than letting Date roll them into a
  // plausible-looking wrong month.
  if (d.getMonth() !== mo - 1 || d.getDate() !== day) return monthDay;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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
