// Run: node --test
//
// Gap counting. Built on a small synthetic archive so the convention is pinned
// exactly rather than asserted against live data that changes after each show.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, gapAtShow, gapChartForShow, longestObservedGap } from '../src/data/index.js';

/**
 * Six shows. Show 3 deliberately has NO setlist rows, so it must not count
 * toward any gap -- that is the convention under test.
 *
 *   show 1  2020-01-01   A, B
 *   show 2  2020-02-01   A
 *   show 3  2020-03-01   (no setlist data)
 *   show 4  2020-04-01   B
 *   show 5  2020-05-01   C   <- C's debut
 *   show 6  2020-06-01   A, C
 */
function fixture() {
  const show = (id, date) => ({
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
    show_tags: [],
  });

  const row = (uid, showId, date, songId, songName, position) => ({
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
  });

  return {
    shows: [
      show(1, '2020-01-01'),
      show(2, '2020-02-01'),
      show(3, '2020-03-01'), // no setlist rows
      show(4, '2020-04-01'),
      show(5, '2020-05-01'),
      show(6, '2020-06-01'),
    ],
    setlists: [
      row(1, 1, '2020-01-01', 10, 'A', 1),
      row(2, 1, '2020-01-01', 20, 'B', 2),
      row(3, 2, '2020-02-01', 10, 'A', 1),
      row(4, 4, '2020-04-01', 20, 'B', 1),
      row(5, 5, '2020-05-01', 30, 'C', 1),
      row(6, 6, '2020-06-01', 10, 'A', 1),
      row(7, 6, '2020-06-01', 30, 'C', 2),
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

test('shows without setlist data are excluded from the denominator', () => {
  // 6 shows exist, but show 3 has no setlist rows.
  assert.equal(index.counts.shows, 6);
  assert.equal(index.counts.countedShows, 5);
  assert.equal(index.counts.excludedNoSetlist, 1);
});

test('gap 0 means played at the immediately preceding counted show', () => {
  // B was played at show 1, then next at show 4. Between them: show 2 counts,
  // show 3 does NOT (no setlist). So ordinals 0 -> 2, gap 2.
  const r = gapAtShow(index, 20, 4);
  assert.equal(r.isDebut, false);
  assert.equal(r.gap, 2);
  assert.equal(r.previous.showdate, '2020-01-01');
});

test('the uncounted show does not inflate the gap', () => {
  // If show 3 were counted, B's gap at show 4 would be 3 rather than 2.
  assert.notEqual(gapAtShow(index, 20, 4).gap, 3);
});

test('consecutive counted shows give gap 1', () => {
  // A: show 1 -> show 2, adjacent in the counted ordering.
  assert.equal(gapAtShow(index, 10, 2).gap, 1);
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
  // B last played at show 4; newest counted show is 6. Counted ordinals:
  // show4 = 2, show6 = 4 -> 2 shows since.
  const b = index.songsById.get(20);
  assert.equal(b.showsSinceLastPlayed, 2);
  assert.equal(gapAtShow(index, 20, 6).gap, 2);

  // A was played at the newest show, so its current gap is 0.
  assert.equal(index.songsById.get(10).showsSinceLastPlayed, 0);
});

test('gap chart covers every song of that night, in set order', () => {
  const chart = gapChartForShow(index, 6);
  assert.equal(chart.length, 2);
  assert.deepEqual(chart.map((e) => e.songname), ['A', 'C']);
  // Counted ordering is show1=0, show2=1, show4=2, show5=3, show6=4.
  assert.equal(chart[0].gap, 3); // A: show 2 (ord 1) -> show 6 (ord 4)
  assert.equal(chart[1].gap, 1); // C: show 5 -> show 6, adjacent
});

test('gap chart marks a debut rather than reporting a number', () => {
  const chart = gapChartForShow(index, 5);
  assert.equal(chart.length, 1);
  assert.equal(chart[0].songname, 'C');
  assert.equal(chart[0].isDebut, true);
  assert.equal(chart[0].gap, null);
});

test('longest observed gap is the max over per-performance gaps', () => {
  // B: debut at show 1, then show 4 with gap 2. Only one real gap.
  const b = longestObservedGap(index, 20);
  assert.equal(b.gap, 2);
  assert.equal(b.at.showdate, '2020-04-01');

  // A: gaps of 1 (at show 2) and 3 (at show 6). Max is 3.
  const a = longestObservedGap(index, 10);
  assert.equal(a.gap, 3);
  assert.equal(a.at.showdate, '2020-06-01');
  assert.equal(a.previous.showdate, '2020-02-01');
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
    uniqueid: '8',
    setnumber: 'e',
    position: 1,
  });
  const idx = buildIndex(f);
  const chart = gapChartForShow(idx, 6);

  const a = chart.filter((e) => e.songname === 'A');
  assert.equal(a.length, 1, 'A should appear once, not twice');
  assert.equal(a[0].occurrences, 2);
  assert.equal(a[0].gap, 3, 'the gap is unchanged by the repeat');
  // Both placements are recorded.
  assert.ok(a[0].alsoIn.includes('Set 1'));
  assert.ok(a[0].alsoIn.includes('Encore'));
});
