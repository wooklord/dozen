// Gap history (0.1.83): one entry per show, the Debut badge, "Longest" as
// longestGap() reads it, and the three sorts. docs/plan.md, "Gap history
// (2026-10-26)". The live check is the fold parity in scripts/gap-oracle.mjs,
// which holds every entry against Carton's Show Gap column; this file pins the
// rules on a fixture that has every case they have to get right.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIndex,
  gapAtShow,
  gapHistory,
  longestGap,
  compareHistoryNewest,
  compareHistoryOldest,
  compareHistoryLargest,
} from '../src/data/index.js';

/**
 * Twelve shows, positions by date. Shows 8 and 9 share a date.
 *
 *   show  1  2020-01-01  pos  1     show  7  2020-01-07  pos  7
 *   show  2  2020-01-02  pos  2     show  8  2020-01-08  pos  9
 *   show  3  2020-01-03  pos  3     show  9  2020-01-08  pos  9
 *   show  4  2020-01-04  pos  4     show 10  2020-01-09  pos 10
 *   show  5  2020-01-05  pos  5     show 11  2020-01-10  pos 11
 *   show  6  2020-01-06  pos  6     show 12  2020-01-11  pos 12  <- newest
 *   (show 6 has no setlist rows and still counts)
 *
 *   TIE      (10)  1 debut, 4 (Encore AND Set 1), 7, 10 -> gaps 3, 3, 3;
 *                  current 2. Three shows tied at the longest closed gap.
 *   SAME     (20)  2 debut, 8, 9 -> 7, then 0 at the second show that date;
 *                  current 3.
 *   OPEN     (30)  1 debut, 3 -> 2; current 9, longer than any closed gap.
 *   OPENTIE  (40)  2 debut, 7 -> 5; current 5, an exact tie, reads open.
 *   NEWDEBUT (50)  12 only -> debut at the newest show, current 0.
 *   ONESHOW  (60)  5 only -> no closed gap, current 7.
 *   UNPLAYED (70)  in the songs table, never played.
 */
function fixture() {
  const show = (id, date, extra = {}) => ({
    show_id: id,
    showdate: date,
    permalink: `show-${id}.html`,
    venuename: 'Test Venue',
    location: 'Testville, TS, USA',
    city: 'Testville',
    state: 'TS',
    country: 'USA',
    show_year: Number(date.slice(0, 4)),
    showorder: 1,
    venue_id: 1,
    artist_id: 1,
    show_tags: [],
    ...extra,
  });
  const dates = {
    1: '2020-01-01', 2: '2020-01-02', 3: '2020-01-03', 4: '2020-01-04', 5: '2020-01-05', 6: '2020-01-06',
    7: '2020-01-07', 8: '2020-01-08', 9: '2020-01-08', 10: '2020-01-09', 11: '2020-01-10', 12: '2020-01-11',
  };
  let uid = 0;
  const row = (showId, songId, songName, position, settype = 'Set', setnumber = '1') => ({
    uniqueid: String(++uid),
    show_id: showId,
    showdate: dates[showId],
    songname: songName,
    song_id: songId,
    slug: songName.toLowerCase(),
    settype,
    setnumber,
    position,
    transition_id: 1,
    transition: ', ',
    footnote: '',
    footnotes: null,
    isjamchart: 0,
    venue_id: 1,
    venuename: 'Test Venue',
    city: 'Testville',
    state: 'TS',
    country: 'USA',
    showyear: 2020,
    showorder: showId === 9 ? 2 : 1,
    isoriginal: 1,
    original_artist: '',
    isreprise: 0,
    isjam: 0,
    artist_id: 1,
  });

  const song = (id, name) => ({ id, name, slug: name.toLowerCase(), isoriginal: 1, original_artist: 'Eggy' });
  return {
    shows: Object.entries(dates).map(([id, d]) => show(Number(id), d, Number(id) === 9 ? { showorder: 2 } : {})),
    setlists: [
      row(1, 10, 'TIE', 1),
      // The Encore row comes FIRST in the table on purpose: the labels must
      // come out in setlist order, Set 1 then Encore, whatever order the
      // rows arrive in.
      row(4, 10, 'TIE', 1, 'Encore', 'e'),
      row(4, 10, 'TIE', 2),
      row(7, 10, 'TIE', 1),
      row(10, 10, 'TIE', 1),
      row(2, 20, 'SAME', 1),
      row(8, 20, 'SAME', 1),
      row(9, 20, 'SAME', 1),
      row(1, 30, 'OPEN', 2),
      row(3, 30, 'OPEN', 1),
      row(2, 40, 'OPENTIE', 2),
      row(7, 40, 'OPENTIE', 2),
      row(12, 50, 'NEWDEBUT', 1),
      row(5, 60, 'ONESHOW', 1),
    ],
    songs: [
      song(10, 'TIE'), song(20, 'SAME'), song(30, 'OPEN'), song(40, 'OPENTIE'),
      song(50, 'NEWDEBUT'), song(60, 'ONESHOW'), song(70, 'UNPLAYED'),
    ],
    venues: [{ venue_id: 1, venuename: 'Test Venue', city: 'Testville', state: 'TS', country: 'USA', slug: 'test-venue' }],
    jamcharts: [],
    albums: [],
  };
}

const index = buildIndex(fixture());
const H = (id) => gapHistory(index, id);
const shape = (h) => h.entries.map((e) => [e.show_id, e.isDebut ? 'debut' : e.gap]);

test('one entry per SHOW: two performances at one show fold into one entry', () => {
  const h = H(10);
  // Five performance rows, four shows.
  assert.equal(index.songsById.get(10).timesPlayed, 5);
  assert.equal(h.entries.length, 4);
  const at4 = h.entries.find((e) => e.show_id === 4);
  assert.equal(at4.count, 2);
  // Both set labels, in setlist order although the Encore row came first.
  assert.deepEqual(at4.setLabels, ['Set 1', 'Encore']);
  // Its number is the gap AT THAT SHOW -- not Carton's 0 on the repeat row.
  assert.equal(at4.gap, 3);
  // And no entry anywhere reads the repeat row's 0.
  assert.ok(h.entries.every((e) => e.count === 1 || e.gap !== 0));
});

test('the debut is a badge and no number', () => {
  for (const id of [10, 20, 30, 40, 50, 60]) {
    const first = H(id).entries[0];
    assert.equal(first.isDebut, true, `song ${id}: first entry is the debut`);
    assert.equal(first.gap, null, `song ${id}: the debut carries no gap -- Carton prints a position there`);
    assert.equal(H(id).entries.filter((e) => e.isDebut).length, 1, `song ${id}: exactly one debut`);
  }
});

test('two shows on one date stay two entries, and the second reads 0', () => {
  assert.deepEqual(shape(H(20)), [[2, 'debut'], [8, 7], [9, 0]]);
});

test('every entry is gapAtShow() at that show -- no second gap walk', () => {
  for (const id of [10, 20, 30, 40, 50, 60]) {
    for (const e of H(id).entries) {
      const g = gapAtShow(index, id, e.show_id);
      assert.equal(e.gap, g.gap, `song ${id} at show ${e.show_id}`);
      assert.equal(e.isDebut, g.isDebut, `song ${id} at show ${e.show_id}`);
    }
  }
});

test('entries run oldest to newest, and the current gap is ordered after all of them', () => {
  const h = H(10);
  assert.deepEqual(h.entries.map((e) => e.order), [0, 1, 2, 3]);
  assert.deepEqual(h.entries.map((e) => e.showdate), ['2020-01-01', '2020-01-04', '2020-01-07', '2020-01-09']);
  assert.equal(h.current.order, 4);
});

test('the current gap is the song’s own, dated from its last performance', () => {
  for (const id of [10, 20, 30, 40, 50, 60]) {
    const song = index.songsById.get(id);
    const { current } = H(id);
    assert.equal(current.gap, song.showsSinceLastPlayed, `song ${id}`);
    assert.equal(current.sinceDate, song.lastPlayed, `song ${id}`);
  }
  assert.equal(H(20).current.gap, 3);
});

test('EVERY show tied at the longest closed gap is tagged, and nothing else', () => {
  const h = H(10);
  assert.deepEqual(h.entries.filter((e) => e.isLongest).map((e) => e.show_id), [4, 7, 10]);
  assert.equal(h.current.isLongest, false);
  assert.equal(h.max, 3);
});

test('when the open gap is longer, only the current gap is tagged', () => {
  const h = H(30);
  assert.equal(longestGap(index.songsById.get(30)).open, true);
  assert.equal(h.current.isLongest, true);
  assert.deepEqual(h.entries.filter((e) => e.isLongest), [], 'a closed row tagged while the open gap is the longest');
  assert.equal(h.max, 9);
});

test('an exact tie between the open gap and a closed one reads open', () => {
  const h = H(40);
  assert.equal(h.entries.find((e) => e.show_id === 7).gap, 5);
  assert.equal(h.current.gap, 5);
  assert.equal(h.current.isLongest, true);
  assert.equal(h.entries.some((e) => e.isLongest), false);
});

test('a song first played at the newest show has no longest tag -- no gap has passed', () => {
  const h = H(50);
  assert.equal(h.current.gap, 0);
  assert.equal(h.max, 0);
  assert.equal(h.current.isLongest, false);
  assert.equal(h.entries.some((e) => e.isLongest), false);
});

test('a song played at one show: the debut, and the open gap as its longest', () => {
  const h = H(60);
  assert.deepEqual(shape(h), [[5, 'debut']]);
  assert.equal(h.current.gap, 7);
  assert.equal(h.current.isLongest, true);
});

test('a song never played has no entries and no current gap; an unknown id has no history', () => {
  const h = H(70);
  assert.deepEqual(h.entries, []);
  assert.equal(h.current, null);
  assert.equal(h.max, 0);
  assert.equal(H(9999), null);
});

// The screen's longest tile reads `longest`, so it must BE song detail's
// figure: longestGap() itself, null where that has no answer -- not `max`,
// which is 0 there and read "0" on a song whose detail reads a dash (cold
// review, 0.1.83).
test('`longest` is longestGap() for every song, null included', () => {
  for (const id of [10, 20, 30, 40, 50, 60, 70]) {
    assert.deepEqual(H(id).longest, longestGap(index.songsById.get(id)), `song ${id}`);
  }
  assert.equal(H(70).longest, null);
  assert.equal(H(50).longest.gap, 0, 'a gap of 0 is an answer, not a missing one');
});

// --- The three sorts, over the rows the screen lists: every show, then now ---
const rowsOf = (h) => [...h.entries, ...(h.current ? [{ now: true, ...h.current }] : [])];
const label = (r) => (r.now ? 'now' : r.show_id);

test('newest first leads with the gap still open; oldest first with the debut', () => {
  assert.deepEqual(rowsOf(H(10)).sort(compareHistoryNewest).map(label), ['now', 10, 7, 4, 1]);
  assert.deepEqual(rowsOf(H(10)).sort(compareHistoryOldest).map(label), [1, 4, 7, 10, 'now']);
});

test('largest gap: biggest first, ties newest first, the debut last', () => {
  // TIE: 3, 3, 3 at shows 4, 7, 10 tie -> newest first; current 2; debut last.
  assert.deepEqual(rowsOf(H(10)).sort(compareHistoryLargest).map(label), [10, 7, 4, 'now', 1]);
  // OPENTIE: the open 5 ties the closed 5 and, being newer, leads.
  assert.deepEqual(rowsOf(H(40)).sort(compareHistoryLargest).map(label), ['now', 7, 2]);
  // SAME: 7, then current 3, then the second-show 0, then the debut.
  assert.deepEqual(rowsOf(H(20)).sort(compareHistoryLargest).map(label), [8, 'now', 9, 2]);
});
