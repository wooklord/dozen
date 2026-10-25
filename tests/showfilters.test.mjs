// Run: node --test
//
// The Shows filter (0.1.82): set count, encore presence and venue state, each
// a Carton field or a count over Carton rows, ANDed. The predicates are proven
// here on a fixture; scripts/smoke.mjs ties three rows under each filter to
// their show detail, which is the part a unit test cannot see.
//
// Red proofs (0.1.82), each applied alone and the file restored by hash:
//   matchesSets reading `>` for '3+'          -> the three-set show leaves 3+
//   matchesEncore with its branches swapped   -> 'with' keeps the no-encore shows
//   matchesState as a substring match         -> 'T' matches 'TS'
//   setSummary counting encores as sets       -> "Set 1 + Encore" reads 2 sets

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIndex,
  setSummary,
  setBadgeText,
  matchesSets,
  matchesEncore,
  matchesState,
  filterShows,
  venueStates,
  SETS_OPTIONS,
  ENCORE_OPTIONS,
} from '../src/data/index.js';

/**
 * Seven played shows across five venues:
 *
 *   show 1  2020-01-01  venue 1 (TS)    Set 1                        1 set, no encore
 *   show 2  2020-02-01  venue 1 (TS)    Set 1 + Set 2 + Encore       2 sets, encore
 *   show 3  2020-03-01  venue 2 (MI)    (no setlist rows)            null
 *   show 4  2020-04-01  venue 2 (MI)    One Set + Encore             1 set, encore
 *   show 5  2020-05-01  venue 3 (blank) Set 1 + Set 2 + Set 3        3 sets, no encore
 *   show 6  2020-06-01  venue 4 (D.C.)  Set 1 + Encore + Encore 2    1 set, encore (e2)
 *   show 7  2020-07-01  venue 5 (DC)    Set 1 + Set 2                2 sets, no encore
 */
function fixture() {
  const show = (id, date, venue_id) => ({
    show_id: id, showdate: date, permalink: `show-${id}.html`, venue_id,
    venuename: `Venue ${venue_id}`, city: 'Testville', state: 'TS', country: 'USA',
    show_year: Number(date.slice(0, 4)), showorder: 1, artist_id: 1, show_tags: [],
  });
  let uid = 0;
  const row = (showId, date, settype, setnumber, position, songId = 10) => ({
    uniqueid: String(++uid), show_id: showId, showdate: date, songname: `Song ${songId}`, song_id: songId,
    slug: `song-${songId}`, settype, setnumber, position, transition_id: 1, transition: ', ', footnote: '',
    footnotes: null, isjamchart: 0, venue_id: 1, venuename: 'Venue', city: 'Testville', state: 'TS', country: 'USA',
    showyear: Number(date.slice(0, 4)), showorder: 1, isoriginal: 1, original_artist: '', isreprise: 0, isjam: 0, artist_id: 1,
  });
  return {
    shows: [
      show(1, '2020-01-01', 1), show(2, '2020-02-01', 1), show(3, '2020-03-01', 2), show(4, '2020-04-01', 2),
      show(5, '2020-05-01', 3), show(6, '2020-06-01', 4), show(7, '2020-07-01', 5),
    ],
    setlists: [
      row(1, '2020-01-01', 'Set', '1', 1),
      row(2, '2020-02-01', 'Set', '1', 1), row(2, '2020-02-01', 'Set', '2', 1), row(2, '2020-02-01', 'Set', 'e', 1),
      row(4, '2020-04-01', 'One Set', '1', 1), row(4, '2020-04-01', 'One Set', 'e', 1),
      row(5, '2020-05-01', 'Set', '1', 1), row(5, '2020-05-01', 'Set', '2', 1), row(5, '2020-05-01', 'Set', '3', 1),
      row(6, '2020-06-01', 'Set', '1', 1), row(6, '2020-06-01', 'Set', 'e', 1), row(6, '2020-06-01', 'Set', 'e2', 1),
      row(7, '2020-07-01', 'Set', '1', 1), row(7, '2020-07-01', 'Set', '2', 1),
    ],
    songs: [{ id: 10, name: 'Song 10', slug: 'song-10', isoriginal: 1, original_artist: 'Eggy' }],
    venues: [
      { venue_id: 1, venuename: 'Venue 1', city: 'Testville', state: 'TS', country: 'USA', slug: 'v1' },
      { venue_id: 2, venuename: 'Venue 2', city: 'Detroit', state: 'MI', country: 'USA', slug: 'v2' },
      { venue_id: 3, venuename: 'Venue 3', city: 'Atlantic Ocean', state: '', country: '', slug: 'v3' },
      { venue_id: 4, venuename: 'Venue 4', city: 'Washington', state: 'D.C.', country: 'USA', slug: 'v4' },
      { venue_id: 5, venuename: 'Venue 5', city: 'Washington', state: 'DC', country: 'USA', slug: 'v5' },
    ],
    jamcharts: [],
    albums: [],
  };
}

const index = buildIndex(fixture());
const shows = index.playedShows;
const ids = (list) => list.map((s) => Number(s.show_id));
const byId = (id) => shows.find((s) => Number(s.show_id) === id);

test('setSummary counts sets without encores, and is null with no rows', () => {
  assert.deepEqual(setSummary(index, 1), { setCount: 1, hasEncore: false });
  assert.deepEqual(setSummary(index, 2), { setCount: 2, hasEncore: true });
  assert.equal(setSummary(index, 3), null);
  assert.deepEqual(setSummary(index, 4), { setCount: 1, hasEncore: true }, 'One Set is one set');
  assert.deepEqual(setSummary(index, 5), { setCount: 3, hasEncore: false });
  assert.deepEqual(setSummary(index, 6), { setCount: 1, hasEncore: true }, 'Encore 2 is still an encore, not a set');
  assert.deepEqual(setSummary(index, 7), { setCount: 2, hasEncore: false });
});

test('setBadgeText: words, singular/plural, encore mark, No setlist', () => {
  assert.equal(setBadgeText(setSummary(index, 1)), '1 set');
  assert.equal(setBadgeText(setSummary(index, 2)), '2 sets + E');
  assert.equal(setBadgeText(setSummary(index, 5)), '3 sets');
  assert.equal(setBadgeText(setSummary(index, 6)), '1 set + E');
  assert.equal(setBadgeText(null), 'No setlist');
});

test('Sets: 1 / 2 / 3+ exactly, and a show with no setlist fails every choice', () => {
  assert.deepEqual(SETS_OPTIONS, ['1', '2', '3+']);
  assert.deepEqual(ids(shows.filter((s) => matchesSets(s, '1', index))), [1, 4, 6]);
  assert.deepEqual(ids(shows.filter((s) => matchesSets(s, '2', index))), [2, 7]);
  assert.deepEqual(ids(shows.filter((s) => matchesSets(s, '3+', index))), [5]);
  for (const want of SETS_OPTIONS) assert.equal(matchesSets(byId(3), want, index), false, `no setlist, Sets=${want}`);
});

test('Encore: with / without, and a show with no setlist fails both', () => {
  assert.deepEqual(ENCORE_OPTIONS, ['with', 'without']);
  assert.deepEqual(ids(shows.filter((s) => matchesEncore(s, 'with', index))), [2, 4, 6]);
  assert.deepEqual(ids(shows.filter((s) => matchesEncore(s, 'without', index))), [1, 5, 7]);
  assert.equal(matchesEncore(byId(3), 'with', index), false);
  assert.equal(matchesEncore(byId(3), 'without', index), false);
  // with + without partition the shows that HAVE a setlist, and only those.
  const withE = ids(shows.filter((s) => matchesEncore(s, 'with', index)));
  const without = ids(shows.filter((s) => matchesEncore(s, 'without', index)));
  assert.deepEqual([...withE, ...without].sort(), [1, 2, 4, 5, 6, 7]);
});

test('State: exact match on the VENUE row, never a substring, blank matches nothing', () => {
  assert.deepEqual(ids(shows.filter((s) => matchesState(s, 'MI', index))), [3, 4], 'the no-setlist show is in: state is a venue fact');
  assert.deepEqual(ids(shows.filter((s) => matchesState(s, 'TS', index))), [1, 2]);
  assert.deepEqual(ids(shows.filter((s) => matchesState(s, 'T', index))), [], 'a prefix is not a match');
  assert.deepEqual(ids(shows.filter((s) => matchesState(s, 'DC', index))), [7], 'DC and D.C. are two values');
  assert.deepEqual(ids(shows.filter((s) => matchesState(s, 'D.C.', index))), [6]);
  assert.deepEqual(ids(shows.filter((s) => matchesState(s, '', index))), [], 'blank is not a state to match');
  // The venue row rules, not the show's own copy of the field: every fixture
  // show carries state 'TS' on itself, and only venue 1's shows match TS.
  assert.equal(byId(4).state, 'TS');
  assert.equal(matchesState(byId(4), 'TS', index), false);
});

test('filterShows ANDs the groups; null is Any', () => {
  assert.deepEqual(ids(filterShows(shows, {}, index)), [1, 2, 3, 4, 5, 6, 7], 'nothing set keeps everything, no-setlist show included');
  assert.deepEqual(ids(filterShows(shows, { sets: null, encore: null, state: null }, index)), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(ids(filterShows(shows, { sets: '1', encore: 'with' }, index)), [4, 6]);
  assert.deepEqual(ids(filterShows(shows, { sets: '2', encore: 'without' }, index)), [7]);
  assert.deepEqual(ids(filterShows(shows, { state: 'MI', sets: '1' }, index)), [4], 'the MI show with no setlist leaves once Sets is set');
  assert.deepEqual(ids(filterShows(shows, { state: 'MI', encore: 'with', sets: '2' }, index)), []);
  // The intersection equals the intersection of the single-filter sets -- the
  // identity the smoke test checks on live rows.
  const a = new Set(ids(filterShows(shows, { sets: '1' }, index)));
  const b = ids(filterShows(shows, { encore: 'with' }, index));
  assert.deepEqual(ids(filterShows(shows, { sets: '1', encore: 'with' }, index)), b.filter((id) => a.has(id)));
});

test('venueStates: distinct, non-blank, A–Z, from the venues table', () => {
  assert.deepEqual(venueStates(index), ['D.C.', 'DC', 'MI', 'TS']);
});
