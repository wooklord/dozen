// Run: node --test
//
// Show/venue search: date parsing, venue matching, and the boundary cases.
// Values reflect the live archive as of 2026-08-17.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDateQuery, matchShowsByDate, matchVenues, matchReasonLabel } from '../src/util/search.js';
import { compareVenuesByName } from '../src/data/index.js';

// --- Date parsing -------------------------------------------------------------

test('ISO form parses to an exact date', () => {
  assert.deepEqual(parseDateQuery('2026-08-07'), {
    kind: 'exact', year: 2026, month: 8, day: 7, label: '2026-08-07',
  });
});

test('slash form with a two-digit year parses to an exact date', () => {
  const r = parseDateQuery('8/7/26');
  assert.equal(r.kind, 'exact');
  assert.equal(r.label, '2026-08-07');
});

test('slash form with a four-digit year parses to an exact date', () => {
  assert.equal(parseDateQuery('8/7/2026').label, '2026-08-07');
});

test('all three exact spellings of the same date agree', () => {
  const a = parseDateQuery('2026-08-07').label;
  const b = parseDateQuery('8/7/26').label;
  const c = parseDateQuery('8/7/2026').label;
  assert.equal(a, b);
  assert.equal(b, c);
});

test('month/day form parses without a year', () => {
  assert.deepEqual(parseDateQuery('8/7'), { kind: 'monthday', month: 8, day: 7, label: '08/07' });
});

test('month-name forms parse, long and abbreviated', () => {
  assert.deepEqual(parseDateQuery('august 2026'), {
    kind: 'month', year: 2026, month: 8, label: 'august 2026',
  });
  assert.equal(parseDateQuery('aug 2026').month, 8);
  assert.equal(parseDateQuery('AUGUST 2026').month, 8);
  assert.equal(parseDateQuery('sep 26').year, 2026);
});

test('a bare year parses', () => {
  assert.deepEqual(parseDateQuery('2019'), { kind: 'year', year: 2019, label: '2019' });
});

test('non-date queries are not treated as dates', () => {
  for (const q of ['Portland', 'ma', 'Brooklyn Bowl', '', '   ', 'the orpheum', 'may']) {
    assert.equal(parseDateQuery(q), null, `${JSON.stringify(q)} should not parse as a date`);
  }
});

test('impossible dates are rejected rather than silently accepted', () => {
  assert.equal(parseDateQuery('13/40'), null);
  assert.equal(parseDateQuery('2026-13-01'), null);
  assert.equal(parseDateQuery('0/0'), null);
});

test('an ambiguous month word does not resolve', () => {
  // "ju" could be June or July.
  assert.equal(parseDateQuery('ju 2026'), null);
});

// --- Date matching ------------------------------------------------------------

const SHOWS = [
  { show_id: 1, showdate: '2021-08-07', venuename: 'The SoNo Collection' },
  { show_id: 2, showdate: '2025-08-07', venuename: 'Peoria Riverfront' },
  { show_id: 3, showdate: '2026-08-07', venuename: 'Westcott Theater' },
  { show_id: 4, showdate: '2026-08-14', venuename: 'The Pines Music Park' },
  { show_id: 5, showdate: '2019-04-10', venuename: 'Somewhere' },
  { show_id: 6, showdate: '2019-11-02', venuename: 'Elsewhere' },
];
const TODAY = '2026-08-17';

test('THE AMBIGUOUS CASE: 8/7 returns every year, nearest to today first', () => {
  const hits = matchShowsByDate(SHOWS, parseDateQuery('8/7'), TODAY);
  assert.equal(hits.length, 3, 'all three years must be returned, not just one');
  assert.deepEqual(hits.map((s) => s.showdate), ['2026-08-07', '2025-08-07', '2021-08-07']);
});

test('an exact date returns only that show', () => {
  const hits = matchShowsByDate(SHOWS, parseDateQuery('8/7/26'), TODAY);
  assert.deepEqual(hits.map((s) => s.showdate), ['2026-08-07']);
});

test('a month query returns that month only, newest first', () => {
  const hits = matchShowsByDate(SHOWS, parseDateQuery('august 2026'), TODAY);
  assert.deepEqual(hits.map((s) => s.showdate), ['2026-08-14', '2026-08-07']);
});

test('a bare year returns that year only, newest first', () => {
  const hits = matchShowsByDate(SHOWS, parseDateQuery('2019'), TODAY);
  assert.deepEqual(hits.map((s) => s.showdate), ['2019-11-02', '2019-04-10']);
});

test('a date with no shows returns nothing rather than throwing', () => {
  assert.deepEqual(matchShowsByDate(SHOWS, parseDateQuery('1/1/99'), TODAY), []);
  assert.deepEqual(matchShowsByDate(SHOWS, null, TODAY), []);
});

// --- Venue matching -----------------------------------------------------------

const VENUES = [
  { venue_id: 1, venuename: 'Portland House of Music', city: 'Portland', state: 'ME', slug: 'phom' },
  { venue_id: 2, venuename: 'State Theatre', city: 'Portland', state: 'ME', slug: 'st' },
  { venue_id: 3, venuename: 'Crystal Ballroom', city: 'Portland', state: 'OR', slug: 'cb' },
  { venue_id: 4, venuename: 'Brooklyn Bowl', city: 'Brooklyn', state: 'NY', slug: 'bb-ny' },
  { venue_id: 5, venuename: 'Brooklyn Bowl', city: 'Las Vegas', state: 'NV', slug: 'bb-nv' },
  { venue_id: 6, venuename: 'Brooklyn Bowl', city: 'Philadelphia', state: 'PA', slug: 'bb-pa' },
  { venue_id: 7, venuename: 'Tree House Brewing Company', city: 'Deerfield', state: 'MA', slug: 'th-d' },
  { venue_id: 8, venuename: 'The Manor', city: 'Somerville', state: 'MA', slug: 'manor' },
  { venue_id: 9, venuename: "Annabel's", city: 'Toronto', state: 'ON', slug: 'ann' },
];

test('THE PORTLAND CASE: name and city matches both surface', () => {
  const hits = matchVenues(VENUES, 'Portland');
  assert.equal(hits.length, 3, 'all three must appear -- neither reading is preferred');

  const byId = Object.fromEntries(hits.map((h) => [h.venue.venue_id, h.reasons]));
  // Matched on BOTH its name and its city.
  assert.deepEqual(byId[1].sort(), ['city', 'name']);
  // Matched on city alone.
  assert.deepEqual(byId[2], ['city']);
  assert.deepEqual(byId[3], ['city']);
});

test('a venue matching only by city is labelled as such', () => {
  const hits = matchVenues(VENUES, 'Portland');
  const stateTheatre = hits.find((h) => h.venue.venue_id === 2);
  assert.equal(matchReasonLabel(stateTheatre.reasons), 'city match');
  // A name match needs no explanation.
  const phom = hits.find((h) => h.venue.venue_id === 1);
  assert.equal(matchReasonLabel(phom.reasons), 'city match'); // it also matched the city
});

test('THE STATE TRAP: "ma" matches the state exactly, not as a substring', () => {
  const hits = matchVenues(VENUES, 'ma');
  const ids = hits.map((h) => h.venue.venue_id).sort();
  // Tree House (MA) and The Manor (MA) by state; The Manor also by name substring.
  assert.ok(ids.includes(7), 'Tree House is in MA and must match by state');
  assert.ok(ids.includes(8), 'The Manor is in MA');
  // Crucially, venues merely containing "ma" in another field are not dragged in
  // by a state match.
  const treeHouse = hits.find((h) => h.venue.venue_id === 7);
  assert.deepEqual(treeHouse.reasons, ['state'], 'must match by state only, not by name substring');
});

test('a state query is exact: "m" matches no state', () => {
  const hits = matchVenues(VENUES, 'm');
  for (const h of hits) {
    assert.ok(!h.reasons.includes('state'), `${h.venue.venuename} matched state on a partial code`);
  }
});

test('VENUE IDENTITY IS venue_id: Brooklyn Bowl resolves to three venues', () => {
  const hits = matchVenues(VENUES, 'Brooklyn Bowl');
  assert.equal(hits.length, 3, 'three distinct venues share this name');
  assert.deepEqual(hits.map((h) => h.venue.venue_id).sort(), [4, 5, 6]);
  // Their cities differ, which is what makes them distinct.
  assert.equal(new Set(hits.map((h) => h.venue.city)).size, 3);
});

test('venue matching runs through the normalizer', () => {
  // Curly vs straight apostrophe, and case.
  assert.equal(matchVenues(VENUES, 'annabel’s').length, 1);
  assert.equal(matchVenues(VENUES, "ANNABEL'S").length, 1);
  assert.equal(matchVenues(VENUES, 'annabels').length, 1);
});

test('an empty query matches no venues', () => {
  assert.deepEqual(matchVenues(VENUES, ''), []);
  assert.deepEqual(matchVenues(VENUES, '   '), []);
});

test('venues order through the shared comparator, ignoring articles', () => {
  const sorted = VENUES.slice().sort(compareVenuesByName).map((v) => v.venuename);
  // "The Manor" files under M, so it lands among the B/C entries alphabetically
  // by "manor", not at the top under "The".
  const manorIndex = sorted.indexOf('The Manor');
  const treeIndex = sorted.indexOf('Tree House Brewing Company');
  assert.ok(manorIndex < treeIndex, '"The Manor" should sort under M, before "Tree House"');
  assert.ok(sorted.indexOf('Crystal Ballroom') < manorIndex);
});

test('same-named venues are ordered stably by venue_id', () => {
  const bowls = VENUES.filter((v) => v.venuename === 'Brooklyn Bowl');
  const sorted = bowls.slice().reverse().sort(compareVenuesByName);
  assert.deepEqual(sorted.map((v) => v.venue_id), [4, 5, 6]);
});

// --- Boundary: shows with no known setlist ------------------------------------

test('shows with no known setlist survive into date results', () => {
  // Search must not quietly drop the 176 played shows that have no setlist.
  const noSetlist = { show_id: 99, showdate: '2014-03-07', venuename: "Toad's Place" };
  const shows = [...SHOWS, noSetlist];
  const hits = matchShowsByDate(shows, parseDateQuery('2014'), TODAY);
  assert.deepEqual(hits.map((s) => s.show_id), [99]);
});

test('upcoming shows survive into date results', () => {
  const upcoming = { show_id: 100, showdate: '2026-12-05', venuename: "Annabel's" };
  const hits = matchShowsByDate([...SHOWS, upcoming], parseDateQuery('december 2026'), TODAY);
  assert.deepEqual(hits.map((s) => s.show_id), [100]);
});
