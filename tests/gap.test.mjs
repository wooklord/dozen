// Run: node --test
//
// Gap counting. Built on a small synthetic archive so the convention is pinned
// exactly rather than asserted against live data that changes after each show.
//
// The convention is The Carton's own Show Gap column (docs/plan.md, Scope
// rulings, 2026-10-24). scripts/gap-oracle.mjs proves the rule against the
// live site through the same functions; this file pins the arithmetic on a
// fixture that has every case the rule has to get right.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIndex,
  gapAtShow,
  gapChartForShow,
  longestObservedGap,
  compareByLongestGap,
  isPastLongestGap,
} from '../src/data/index.js';

/**
 * Eight shows. Positions are counted BY DATE over the Eggy shows played so far,
 * and a show with no setlist rows counts like any other -- that is the rule
 * under test, and it is the inverse of the fixture this replaced.
 *
 *   show 1  2020-01-01   A, B           position 1
 *   show 2  2020-02-01   A              position 2
 *   show 3  2020-03-01   (no setlist)   position 3   <- counts, as on Carton
 *   show 4  2020-04-01   B              position 4
 *   show 5  2020-05-01   C              position 5   <- C's debut
 *   show 6  2020-06-01   A, C           position 7   <- two shows on one date
 *   show 7  2020-06-01   C              position 7      share a position
 *   show 8  2020-07-01   A              artist_id 2: NOT in the universe, and
 *                                       A's row there is not a performance
 *
 * Newest played date 2020-06-01, position 7.
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

  const row = (uid, showId, date, songId, songName, position, artistId = 1) => ({
    uniqueid: String(uid),
    show_id: showId,
    showdate: date,
    songname: songName,
    song_id: songId,
    slug: songName.toLowerCase(),
    settype: 'Set',
    setnumber: '1',
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
    showyear: Number(date.slice(0, 4)),
    showorder: 1,
    isoriginal: 1,
    original_artist: '',
    isreprise: 0,
    isjam: 0,
    artist_id: artistId,
  });

  return {
    shows: [
      show(1, '2020-01-01'),
      show(2, '2020-02-01'),
      show(3, '2020-03-01'), // no setlist rows
      show(4, '2020-04-01'),
      show(5, '2020-05-01'),
      show(6, '2020-06-01'),
      show(7, '2020-06-01', { showorder: 2 }), // second show that day
      show(8, '2020-07-01', { artist_id: 2, artist: 'Other' }),
    ],
    setlists: [
      row(1, 1, '2020-01-01', 10, 'A', 1),
      row(2, 1, '2020-01-01', 20, 'B', 2),
      row(3, 2, '2020-02-01', 10, 'A', 1),
      row(4, 4, '2020-04-01', 20, 'B', 1),
      row(5, 5, '2020-05-01', 30, 'C', 1),
      row(6, 6, '2020-06-01', 10, 'A', 1),
      row(7, 6, '2020-06-01', 30, 'C', 2),
      row(8, 7, '2020-06-01', 30, 'C', 1),
      row(9, 8, '2020-07-01', 10, 'A', 1, 2),
    ],
    songs: [
      { id: 10, name: 'A', slug: 'a', isoriginal: 1, original_artist: 'Eggy' },
      { id: 20, name: 'B', slug: 'b', isoriginal: 1, original_artist: 'Eggy' },
      { id: 30, name: 'C', slug: 'c', isoriginal: 1, original_artist: 'Eggy' },
    ],
    venues: [{ venue_id: 1, venuename: 'Test Venue', city: 'Testville', state: 'TS', country: 'USA', slug: 'test-venue' }],
    jamcharts: [],
    albums: [],
  };
}

// All fixture dates are in the past, so "today" never truncates the archive.
const index = buildIndex(fixture());

test('shows without setlist data count toward the gap', () => {
  // 8 shows exist; 7 are Eggy shows played so far and all 7 count, show 3
  // with no setlist rows among them.
  assert.equal(index.counts.shows, 8);
  assert.equal(index.counts.playedShows, 8);
  assert.equal(index.counts.countedShows, 7);
  assert.equal(index.counts.countedNoSetlist, 1);
  assert.equal(index.counts.excludedOtherArtist, 1);
  assert.equal(index.counts.excludedFuture, 0);
});

test('gap 1 means played at the show before; the setlist-less show between counts', () => {
  // B was played at show 1, then next at show 4. Positions 1 -> 4, gap 3:
  // show 2 and the setlist-less show 3 both count.
  const r = gapAtShow(index, 20, 4);
  assert.equal(r.isDebut, false);
  assert.equal(r.gap, 3);
  assert.equal(r.previous.showdate, '2020-01-01');
});

test('the setlist-less show adds one, as on Carton', () => {
  // Under the withdrawn convention B's gap at show 4 read 2. It is 3.
  assert.notEqual(gapAtShow(index, 20, 4).gap, 2);
});

test('consecutive shows give gap 1', () => {
  // A: show 1 -> show 2, adjacent dates.
  assert.equal(gapAtShow(index, 10, 2).gap, 1);
});

test('two shows on one date share a position, and the second performance reads 0', () => {
  // Shows 6 and 7 are both 2020-06-01: position 7 for each.
  assert.equal(index.showOrdinal.get(6), 7);
  assert.equal(index.showOrdinal.get(7), 7);
  // C at show 6: previous performance is show 5, gap 7 - 5 = 2.
  assert.equal(gapAtShow(index, 30, 6).gap, 2);
  // C at show 7: previous performance is show 6, same date, gap 0 -- the
  // figure Carton prints on the second row of a double-show day.
  const r = gapAtShow(index, 30, 7);
  assert.equal(r.gap, 0);
  assert.equal(Number(r.previous.show_id), 6);
  // And the gap chart for the second show says so.
  assert.deepEqual(gapChartForShow(index, 7).map((e) => [e.songname, e.gap]), [['C', 0]]);
});

test('another artist’s show is outside the universe and its rows are not performances', () => {
  // Show 8 is in the archive (Shows and Venues still list it) ...
  assert.ok(index.showsById.has(8));
  // ... but has no position, and A's row there is not a play.
  assert.equal(index.showOrdinal.has(8), false);
  const a = index.songsById.get(10);
  assert.equal(a.timesPlayed, 3);
  assert.ok(a.performances.every((p) => Number(p.show_id) !== 8));
  assert.equal(a.lastPlayed, '2020-06-01');
  assert.equal(a.showsSinceLastPlayed, 0);
});

test('a debut is NOT gap 0', () => {
  const r = gapAtShow(index, 30, 5);
  assert.equal(r.isDebut, true);
  assert.equal(r.gap, null);
  assert.equal(r.previous, null);
  // The distinction matters: gap 0 is a real, different fact.
  assert.notEqual(r.gap, 0);
});

test('current gap is the same computation evaluated at the newest show', () => {
  // B last played at show 4 (position 4); newest played date is position 7.
  const b = index.songsById.get(20);
  assert.equal(b.showsSinceLastPlayed, 3);
  assert.equal(gapAtShow(index, 20, 6).gap, 3);

  // A was played at the newest show, so its current gap is 0.
  assert.equal(index.songsById.get(10).showsSinceLastPlayed, 0);
});

test('gap chart covers every song of that night, in set order', () => {
  const chart = gapChartForShow(index, 6);
  assert.equal(chart.length, 2);
  assert.deepEqual(chart.map((e) => e.songname), ['A', 'C']);
  assert.equal(chart[0].gap, 5); // A: show 2 (position 2) -> show 6 (position 7)
  assert.equal(chart[1].gap, 2); // C: show 5 (position 5) -> show 6 (position 7)
});

test('gap chart marks a debut rather than reporting a number', () => {
  const chart = gapChartForShow(index, 5);
  assert.equal(chart.length, 1);
  assert.equal(chart[0].songname, 'C');
  assert.equal(chart[0].isDebut, true);
  assert.equal(chart[0].gap, null);
});

test('longest observed gap is the max over per-performance gaps', () => {
  // B: debut at show 1, then show 4 with gap 3. Only one real gap.
  const b = longestObservedGap(index, 20);
  assert.equal(b.gap, 3);
  assert.equal(b.at.showdate, '2020-04-01');

  // A: gaps of 1 (at show 2) and 5 (at show 6). Max is 5.
  const a = longestObservedGap(index, 10);
  assert.equal(a.gap, 5);
  assert.equal(a.at.showdate, '2020-06-01');
  assert.equal(a.previous.showdate, '2020-02-01');
});

test('a debut is excluded from the longest gap', () => {
  // C debuted at position 5 -- the number Carton prints on that row -- and its
  // only gap between performances is 2 (then a 0 on the same-date second
  // show). The longest is 2, not the debut position (ruling 2026-10-24,
  // decision 1).
  const c = longestObservedGap(index, 30);
  assert.equal(c.gap, 2);
  assert.notEqual(c.gap, 5);
  // And that is what the entry stores, with the two dates that bound it.
  assert.deepEqual(index.songsById.get(30).longestObservedGap, {
    gap: 2,
    fromDate: '2020-05-01',
    toDate: '2020-06-01',
  });
});

test('a song played only once has no observed gap', () => {
  const single = buildIndex({
    ...fixture(),
    setlists: [
      {
        uniqueid: '1', show_id: 1, showdate: '2020-01-01', songname: 'Solo', song_id: 99,
        slug: 'solo', settype: 'Set', setnumber: '1', position: 1, transition_id: 1,
        transition: ', ', footnote: '', footnotes: null, isjamchart: 0, venue_id: 1,
        venuename: 'Test Venue', city: 'Testville', state: 'TS', country: 'USA',
        showyear: 2020, showorder: 1, isoriginal: 1, original_artist: '', isreprise: 0, isjam: 0,
      },
    ],
  });
  assert.equal(longestObservedGap(single, 99), null);
});

test('an unknown song or show yields nulls rather than throwing', () => {
  assert.deepEqual(gapAtShow(index, 999, 6), { gap: null, previous: null, isDebut: false });
  assert.deepEqual(gapAtShow(index, 10, 999), { gap: null, previous: null, isDebut: false });
  assert.deepEqual(gapChartForShow(index, 999), []);
});

test('a show with no setlist has an empty gap chart', () => {
  assert.deepEqual(gapChartForShow(index, 3), []);
});

test('a song played twice in one night appears once, with a count', () => {
  // Rebuild with A played twice at show 6 (set 1 and the encore).
  const f = fixture();
  f.setlists.push({
    ...f.setlists[5], // the show-6 "A" row
    uniqueid: '10',
    setnumber: 'e',
    position: 1,
  });
  const idx = buildIndex(f);
  const chart = gapChartForShow(idx, 6);

  const a = chart.filter((e) => e.songname === 'A');
  assert.equal(a.length, 1, 'A should appear once, not twice');
  assert.equal(a[0].occurrences, 2);
  assert.equal(a[0].gap, 5, 'the gap is unchanged by the repeat');
  // Both placements are recorded.
  assert.ok(a[0].alsoIn.includes('Set 1'));
  assert.ok(a[0].alsoIn.includes('Encore'));
});

// --- longestObservedGap on the entry: closed gaps only -----------------------
//
// Positions in the fixture: show1=1, show2=2, show3=3, show4=4, show5=5,
// show6=show7=7; newest = 7. The entry stores the longest CLOSED span with
// the two dates that bound it. The current gap is a separate figure and is
// never folded in: the 0.1.76 rule that took the larger of the two, and its
// tie rule, were withdrawn (docs/plan.md, 2026-10-24). Results are compared
// whole so a swapped date cannot slip past a check that only read the number.

/** The fixture plus D, played at shows 1 and 2 only: closed 1, current 5. */
function withD() {
  const f = fixture();
  f.setlists.push(
    { ...f.setlists[0], uniqueid: '101', show_id: 1, showdate: '2020-01-01', song_id: 40, songname: 'D', slug: 'd', position: 3 },
    { ...f.setlists[0], uniqueid: '102', show_id: 2, showdate: '2020-02-01', song_id: 40, songname: 'D', slug: 'd', position: 2 },
  );
  f.songs.push({ id: 40, name: 'D', slug: 'd', isoriginal: 1, original_artist: 'Eggy' });
  return f;
}

/** The fixture plus E, played once at show 1, and F, played twice at show 6. */
function withOneShowSongs() {
  const f = fixture();
  f.setlists.push(
    { ...f.setlists[0], uniqueid: '103', song_id: 50, songname: 'E', slug: 'e', position: 3 },
    { ...f.setlists[0], uniqueid: '104', show_id: 6, showdate: '2020-06-01', song_id: 55, songname: 'F', slug: 'f', position: 4 },
    { ...f.setlists[0], uniqueid: '105', show_id: 6, showdate: '2020-06-01', song_id: 55, songname: 'F', slug: 'f', position: 5 },
  );
  f.songs.push(
    { id: 50, name: 'E', slug: 'e', isoriginal: 1, original_artist: 'Eggy' },
    { id: 55, name: 'F', slug: 'f', isoriginal: 1, original_artist: 'Eggy' },
  );
  return f;
}

test('the entry stores the longest closed gap with both bounding dates', () => {
  // A: closed gaps 1 (show 2) and 5 (show 6). The entry is the 5, dated.
  assert.deepEqual(index.songsById.get(10).longestObservedGap, {
    gap: 5,
    fromDate: '2020-02-01',
    toDate: '2020-06-01',
  });
});

test('a current gap longer than every closed gap does not become the longest', () => {
  // D: closed 1, current 7 - 2 = 5. The longest observed is still the 1 --
  // the current gap is the other figure, not a candidate for this one.
  const idx = buildIndex(withD());
  assert.equal(idx.songsById.get(40).showsSinceLastPlayed, 5);
  assert.deepEqual(idx.songsById.get(40).longestObservedGap, {
    gap: 1,
    fromDate: '2020-01-01',
    toDate: '2020-02-01',
  });
});

test('a song played at one show only has no observed gap, and sorts last', () => {
  // E once at show 1; F twice at show 6, on one date. Neither has a gap
  // between two performances, so neither has a longest observed gap --
  // F's second row is a repeat on the same date, not a return.
  const idx = buildIndex(withOneShowSongs());
  assert.equal(idx.songsById.get(50).longestObservedGap, null);
  assert.equal(idx.songsById.get(55).longestObservedGap, null);
  assert.equal(idx.songsById.get(55).timesPlayed, 2, 'F was played twice');
  const order = idx.songs.slice().sort(compareByLongestGap).map((x) => x.name);
  assert.deepEqual(order, ['A', 'B', 'C', 'E', 'F']);
});

test('a never-played catalogue song is not listed, and is still reachable by id', () => {
  const f = fixture();
  f.songs.push({ id: 60, name: 'Aardvark', slug: 'aardvark', isoriginal: 1, original_artist: 'Eggy' });
  const idx = buildIndex(f);
  // Aardvark would lead A-Z; it is not in the list at all, because Carton's
  // own song list does not list it (docs/plan.md, 2026-10-24).
  assert.ok(!idx.songs.some((s) => s.song_id === 60));
  assert.deepEqual(idx.unplayedSongs.map((s) => s.name), ['Aardvark']);
  assert.equal(idx.counts.songs, 3);
  assert.equal(idx.counts.songsUnplayed, 1);
  const entry = idx.songsById.get(60);
  assert.equal(entry.timesPlayed, 0);
  assert.equal(entry.longestObservedGap, null);
  assert.equal(entry.showsSinceLastPlayed, null);
});

test('longest gap sort: closed gap descending, then current gap descending, then name', () => {
  // Fixture values: A 5 (current 0), B 3 (current 3), C 2 (current 0).
  const order = index.songs.slice().sort(compareByLongestGap).map((x) => x.name);
  assert.deepEqual(order, ['A', 'B', 'C']);

  // Tie on the closed gap, different current gaps: the larger current gap first.
  const mk = (name, gap, current) => ({
    name,
    sortkey: name.toLowerCase(),
    longestObservedGap: gap === null ? null : { gap },
    showsSinceLastPlayed: current,
  });
  assert.deepEqual(
    [mk('Zed', 5, 1), mk('Ann', 5, 4)].sort(compareByLongestGap).map((x) => x.name),
    ['Ann', 'Zed'],
  );
  // Tie on both: name order, through the shared comparator.
  assert.deepEqual(
    [mk('Zed', 5, 1), mk('Ann', 5, 1)].sort(compareByLongestGap).map((x) => x.name),
    ['Ann', 'Zed'],
  );
  // The sign is the one the chip promises: a bigger gap comes FIRST.
  assert.ok(compareByLongestGap(mk('x', 9, 0), mk('y', 1, 0)) < 0);
  // No closed gap sorts after any closed gap, however small.
  assert.ok(compareByLongestGap(mk('x', null, 50), mk('y', 1, 0)) > 0);
});

// --- isPastLongestGap: the "Past longest gap" filter -------------------------
//
// True only when the current gap is STRICTLY longer than the longest closed
// gap. Each case names its two figures so a flipped or loosened comparison
// fails on the row that says why.

test('past longest gap: strictly longer, and a closed gap is required', () => {
  // A: closed 5, current 0 -- the current gap is shorter.
  assert.equal(isPastLongestGap(index.songsById.get(10)), false);
  // B: closed 3, current 3 -- equal is not longer.
  assert.equal(index.songsById.get(20).showsSinceLastPlayed, 3);
  assert.equal(index.songsById.get(20).longestObservedGap.gap, 3);
  assert.equal(isPastLongestGap(index.songsById.get(20)), false, 'a tie is not kept');
  // C: closed 2, current 0.
  assert.equal(isPastLongestGap(index.songsById.get(30)), false);
  // D: closed 1, current 5 -- longer, kept.
  const withDIdx = buildIndex(withD());
  assert.equal(isPastLongestGap(withDIdx.songsById.get(40)), true);
  // E: no closed gap, current 6 -- nothing to compare, not kept.
  const oneShow = buildIndex(withOneShowSongs());
  assert.equal(oneShow.songsById.get(50).showsSinceLastPlayed, 6);
  assert.equal(isPastLongestGap(oneShow.songsById.get(50)), false, 'no closed gap is not zero');
  assert.equal(isPastLongestGap(oneShow.songsById.get(55)), false);
  // Shapes that must not throw or pass: nothing, and a closed gap with no current one.
  assert.equal(isPastLongestGap(null), false);
  assert.equal(isPastLongestGap({ longestObservedGap: { gap: 1 }, showsSinceLastPlayed: null }), false);
});
