// Run: node --test
//
// Per-show jam chart entries: the join, and the ORDER.
//
// Order is the whole point of index.jamByShow. These entries render directly
// under the setlist on show detail and are supposed to read alongside it, so
// "setlist order" is the behaviour under test -- not a presentation detail.
//
// The fixture is built so that setlist order disagrees with every ordering
// this could accidentally fall into. If jamByShow ever gets an alphabetical
// sort, a by-date sort, or the raw jamcharts array order, these tests go red.
// A fixture where those orders coincide would prove nothing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, jamKey } from '../src/data/index.js';

/**
 * One show, one set of 5 songs plus an encore, four of them jam-charted.
 *
 *   set 1  pos 1  Zebra      <- jam-charted
 *   set 1  pos 2  Apple
 *   set 1  pos 3  Mango      <- jam-charted
 *   set 1  pos 4  Zebra      <- jam-charted AGAIN (same song, second entry)
 *   set 1  pos 5  Blossom
 *   enc    pos 1  Cider      <- jam-charted
 *
 * Setlist order is therefore: Zebra, Mango, Zebra, Cider.
 *   - Alphabetical would give:      Cider, Mango, Zebra, Zebra
 *   - Raw jamcharts array order is: Cider, Zebra(4), Mango, Zebra(1)
 * Both differ from the expected result, so neither can pass by accident.
 *
 * Show 2 has a setlist but NO jam entries, which is the "render nothing" case.
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

  const row = (uid, showId, songId, songName, setnumber, position, isjam) => ({
    uniqueid: String(uid),
    show_id: showId,
    showdate: showId === 1 ? '2020-01-01' : '2020-02-01',
    songname: songName,
    song_id: songId,
    slug: songName.toLowerCase(),
    settype: 'Set',
    setnumber,
    position,
    transition_id: 1,
    transition: ', ',
    footnote: '',
    footnotes: null,
    isjamchart: isjam ? 1 : 0,
    jamchart_notes: isjam ? `fallback note for ${songName}` : null,
    venue_id: 1,
    venuename: 'Test Venue',
    city: 'Testville',
    state: 'TS',
    country: 'USA',
    showyear: 2020,
    showorder: 1,
    isoriginal: 1,
    original_artist: '',
    isreprise: 0,
    isjam: 0,
  });

  // NOTE the field name: jamcharts uses `showid`, setlists uses `show_id`.
  const jam = (songId, songName, setnumber, position, note) => ({
    uniqueid: `j${songId}-${position}`,
    showid: 1,
    song_id: songId,
    songname: songName,
    song_slug: songName.toLowerCase(),
    setnumber,
    position,
    showdate: '2020-01-01',
    jamchartnote: note,
    venuename: 'Test Venue',
    city: 'Testville',
    state: 'TS',
    country: 'USA',
    permalink: 'show-1.html',
  });

  return {
    shows: [show(1, '2020-01-01'), show(2, '2020-02-01')],
    setlists: [
      row(1, 1, 90, 'Zebra', '1', 1, true),
      row(2, 1, 10, 'Apple', '1', 2, false),
      row(3, 1, 50, 'Mango', '1', 3, true),
      row(4, 1, 90, 'Zebra', '1', 4, true),
      row(5, 1, 20, 'Blossom', '1', 5, false),
      row(6, 1, 30, 'Cider', 'e', 1, true),
      row(7, 2, 10, 'Apple', '1', 1, false),
    ],
    // Deliberately shuffled, and NOT in setlist order.
    jamcharts: [
      jam(30, 'Cider', 'e', 1, 'encore note'),
      jam(90, 'Zebra', '1', 4, 'second Zebra note'),
      jam(50, 'Mango', '1', 3, 'mango note'),
      jam(90, 'Zebra', '1', 1, 'first Zebra note'),
    ],
    songs: [
      { id: 90, name: 'Zebra', slug: 'zebra', isoriginal: 1, original_artist: 'Eggy' },
      { id: 10, name: 'Apple', slug: 'apple', isoriginal: 1, original_artist: 'Eggy' },
      { id: 50, name: 'Mango', slug: 'mango', isoriginal: 1, original_artist: 'Eggy' },
      { id: 20, name: 'Blossom', slug: 'blossom', isoriginal: 1, original_artist: 'Eggy' },
      { id: 30, name: 'Cider', slug: 'cider', isoriginal: 1, original_artist: 'Eggy' },
    ],
    venues: [
      { venue_id: 1, venuename: 'Test Venue', city: 'Testville', state: 'TS', country: 'USA', slug: 'test-venue' },
    ],
    albums: [],
  };
}

const index = buildIndex(fixture());

test('jam entries come back in SETLIST order, not alphabetical', () => {
  const names = index.jamByShow.get(1).map((j) => j.songname);
  assert.deepEqual(names, ['Zebra', 'Mango', 'Zebra', 'Cider']);

  // Prove the assertion is actually discriminating: the two orders this could
  // plausibly have been are different from the expected one.
  assert.notDeepEqual(names, ['Cider', 'Mango', 'Zebra', 'Zebra'], 'alphabetical');
  assert.notDeepEqual(names, ['Cider', 'Zebra', 'Mango', 'Zebra'], 'raw jamcharts order');
});

test('the encore sorts after set 1, as it is played', () => {
  const entries = index.jamByShow.get(1);
  assert.equal(entries[entries.length - 1].songname, 'Cider');
  assert.equal(entries[entries.length - 1].setnumber, 'e');
});

test('a song charted twice in one night keeps BOTH entries, with its own note', () => {
  const zebras = index.jamByShow.get(1).filter((j) => j.songname === 'Zebra');
  assert.equal(zebras.length, 2, 'keying on song_id alone would collapse these');
  assert.equal(zebras[0].position, 1);
  assert.equal(zebras[0].note, 'first Zebra note');
  assert.equal(zebras[1].position, 4);
  assert.equal(zebras[1].note, 'second Zebra note');
});

test('only jam-charted songs appear — the rest of the setlist does not', () => {
  const names = index.jamByShow.get(1).map((j) => j.songname);
  assert.ok(!names.includes('Apple'));
  assert.ok(!names.includes('Blossom'));
});

test('a show with no jam entries is ABSENT, not an empty array', () => {
  // Show detail renders nothing at all in this case, same rule as album
  // membership. An empty array would render an empty section.
  assert.equal(index.jamByShow.has(2), false);
  assert.equal(index.jamByShow.get(2), undefined);
});

test('jamKey bridges the showid / show_id field-name mismatch', () => {
  // The single trap in this join: jamcharts says `showid`, setlists says
  // `show_id`. jamKey takes values, so both sides produce the same key.
  assert.equal(jamKey(1, 90, '1', 4), jamKey('1', '90', '1', '4'));
  // setnumber is case-folded, so 'E' and 'e' cannot split an encore in two.
  assert.equal(jamKey(1, 30, 'E', 1), jamKey(1, 30, 'e', 1));
  // position is part of the key -- this is what keeps the two Zebras apart.
  assert.notEqual(jamKey(1, 90, '1', 1), jamKey(1, 90, '1', 4));
});

test('a flagged setlist row with no jamcharts row still renders, from its own note', () => {
  // Does not occur in live data (verified both directions, zero disagreement),
  // but if the two tables ever diverge the entry must not silently vanish --
  // the setlist row carries jamchart_notes of its own.
  const f = fixture();
  f.jamcharts = f.jamcharts.filter((j) => j.songname !== 'Mango');
  const idx = buildIndex(f);
  const mango = idx.jamByShow.get(1).find((j) => j.songname === 'Mango');
  assert.ok(mango, 'the entry must survive a missing jamcharts row');
  assert.equal(mango.note, 'fallback note for Mango');
});
