// Show and venue search.
//
// Deterministic matching only: normalized substrings, exact state codes, and
// date parsing. No relevance scoring, no fuzzy matching -- a query either
// matches a row or it does not, and the caller orders the results.

import { normalizeVenueName, normalizeQuery } from '../data/normalize.js';
import { localToday } from './dates.js';

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/** "aug"/"august" -> 8, else null. Unambiguous prefixes of >= 3 letters. */
function monthFromWord(word) {
  const w = String(word || '').toLowerCase();
  if (w.length < 3) return null;
  const hits = MONTHS.map((m, i) => (m.startsWith(w) ? i + 1 : 0)).filter(Boolean);
  return hits.length === 1 ? hits[0] : null;
}

const pad = (n) => String(n).padStart(2, '0');

/** Two-digit years are this century. "26" -> 2026. */
function expandYear(y) {
  const n = Number(y);
  if (!Number.isFinite(n)) return null;
  if (String(y).length <= 2) return 2000 + n;
  return n;
}

function validMonthDay(month, day) {
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

/**
 * Parse a date-like query into a descriptor, or null if it is not date-like.
 *
 * Accepted forms (M/D order, matching how these are typed):
 *   2026-08-07          exact date
 *   8/7/26  8/7/2026    exact date
 *   8/7                 month + day, ANY year
 *   august 2026  aug 26 month
 *   2019                year
 *
 * @returns {null | {kind:'exact'|'monthday'|'month'|'year', year?, month?, day?, label:string}}
 */
export function parseDateQuery(input) {
  const q = String(input || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return null;

  // 2026-08-07
  let m = q.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const [, y, mo, d] = m.map(Number);
    if (!validMonthDay(mo, d)) return null;
    return { kind: 'exact', year: y, month: mo, day: d, label: `${y}-${pad(mo)}-${pad(d)}` };
  }

  // 8/7/26 or 8/7/2026 (also accepts dashes and dots as separators)
  m = q.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) {
    const mo = Number(m[1]);
    const d = Number(m[2]);
    const y = expandYear(m[3]);
    if (!validMonthDay(mo, d) || !y) return null;
    return { kind: 'exact', year: y, month: mo, day: d, label: `${y}-${pad(mo)}-${pad(d)}` };
  }

  // 8/7 -- month and day, any year
  m = q.match(/^(\d{1,2})[/.-](\d{1,2})$/);
  if (m) {
    const mo = Number(m[1]);
    const d = Number(m[2]);
    if (!validMonthDay(mo, d)) return null;
    return { kind: 'monthday', month: mo, day: d, label: `${pad(mo)}/${pad(d)}` };
  }

  // "august 2026" / "aug 26"
  m = q.match(/^([a-z]+)\s+(\d{2}|\d{4})$/);
  if (m) {
    const mo = monthFromWord(m[1]);
    const y = expandYear(m[2]);
    if (mo && y) return { kind: 'month', year: y, month: mo, label: `${MONTHS[mo - 1]} ${y}` };
  }

  // Bare year. Without this, the 786 played shows are only reachable by
  // already knowing a venue or date inside them.
  m = q.match(/^(\d{4})$/);
  if (m) {
    const y = Number(m[1]);
    if (y >= 1900 && y <= 2999) return { kind: 'year', year: y, label: String(y) };
  }

  return null;
}

/**
 * Shows matching a parsed date query.
 *
 * A month+day query deliberately spans every year -- "8/7" hits 2021, 2025 and
 * 2026 in this archive -- and is ordered nearest-to-today first so the most
 * likely intent leads without the others being hidden.
 */
export function matchShowsByDate(shows, parsed, today = localToday()) {
  if (!parsed) return [];

  let hits;
  switch (parsed.kind) {
    case 'exact':
      hits = shows.filter((s) => s.showdate === parsed.label);
      break;
    case 'monthday': {
      const md = `-${pad(parsed.month)}-${pad(parsed.day)}`;
      hits = shows.filter((s) => String(s.showdate).slice(4) === md);
      break;
    }
    case 'month': {
      const prefix = `${parsed.year}-${pad(parsed.month)}-`;
      hits = shows.filter((s) => String(s.showdate).startsWith(prefix));
      break;
    }
    case 'year':
      hits = shows.filter((s) => String(s.showdate).startsWith(`${parsed.year}-`));
      break;
    default:
      return [];
  }

  if (parsed.kind === 'monthday') {
    // Nearest to today first; ties (same distance) fall back to newest.
    const dayNum = (d) => Math.round(new Date(`${d}T00:00:00`).getTime() / 86400000);
    const t = dayNum(today);
    return hits
      .slice()
      .sort((a, b) => {
        const da = Math.abs(dayNum(a.showdate) - t);
        const db = Math.abs(dayNum(b.showdate) - t);
        return da - db || b.showdate.localeCompare(a.showdate);
      });
  }
  return hits.slice().sort((a, b) => b.showdate.localeCompare(a.showdate));
}

/**
 * Venues matching a text query, with the reason each one matched.
 *
 * Name and city are normalized substrings. STATE IS AN EXACT MATCH: "ma" as a
 * substring hits 18 venue names in this archive, which would bury a real
 * query under noise.
 *
 * The reasons are surfaced in the UI so a query like "Portland" -- which is
 * both a city and part of "Portland House of Music" -- visibly shows why each
 * result is present rather than silently preferring one interpretation.
 *
 * @returns {Array<{venue: object, reasons: string[]}>}
 */
export function matchVenues(venues, query) {
  const raw = String(query || '').trim();
  if (!raw) return [];
  const q = normalizeQuery(raw);
  if (!q) return [];
  const stateQuery = raw.toLowerCase().trim();

  const out = [];
  for (const v of venues) {
    const reasons = [];
    if (normalizeVenueName(v.venuename).includes(q)) reasons.push('name');
    if (normalizeVenueName(v.city).includes(q)) reasons.push('city');
    if (String(v.state || '').toLowerCase().trim() === stateQuery) reasons.push('state');
    if (reasons.length) out.push({ venue: v, reasons });
  }
  return out;
}

/** Human label for why a venue matched, when it was not the name. */
export function matchReasonLabel(reasons) {
  const secondary = reasons.filter((r) => r !== 'name');
  if (!secondary.length) return null;
  if (secondary.includes('city') && secondary.includes('state')) return 'city + state match';
  if (secondary.includes('city')) return 'city match';
  if (secondary.includes('state')) return 'state match';
  return null;
}
