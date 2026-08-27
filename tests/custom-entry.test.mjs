// Run: node --test
//
// Free-text setlist entries are not songs.
//
// The Carton records banter and announcements as setlist rows with
// `slug === '_custom_'`. There are three in the archive and all three carry
// `song_id = 1`, which does not exist in the `songs` table. Keyed on song_id,
// as the index is, they collapsed into ONE browsable song called "Why Should I
// Worry" claiming three performances across three unrelated shows -- and it
// was the 367th entry in a catalogue the API reports as 366.
//
// buildIndex is exercised against a fixture rather than the live API: this is
// a `node --test` file and must stay offline and instant. The fixture is shaped
// from the real rows, and tests/coldpull.test.mjs separately proves the pull
// itself.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, isCustomEntry, gapChartForShow, showStructure } from '../src/data/index.js';

const SHOW = { show_id: 900, showdate: '2022-11-05', showyear: '2022', venue_id: 5, venuename: 'The Foundry', permalink: 'x' };

/** Two real songs and one free-text row, in one show. */
const RAW = {
  shows: [SHOW],
  venues: [{ venue_id: 5, venuename: 'The Foundry', city: 'Philadelphia', state: 'PA', slug: 'the-foundry' }],
  songs: [
    { id: 10, name: 'Real Song', slug: 'real-song', isoriginal: 1, original_artist: 'Eggy' },
    { id: 11, name: 'Other Song', slug: 'other-song', isoriginal: 1, original_artist: 'Eggy' },
  ],
  jamcharts: [],
  albums: [],
  setlists: [
    { show_id: 900, showdate: '2022-11-05', showyear: '2022', song_id: 10, songname: 'Real Song', slug: 'real-song', settype: 'Set', setnumber: '1', position: 1, showorder: 1, uniqueid: 'a', isoriginal: 1 },
    { show_id: 900, showdate: '2022-11-05', showyear: '2022', song_id: 1, songname: 'NYE Announcement', slug: '_custom_', settype: 'Set', setnumber: 'e', position: 2, showorder: 2, uniqueid: 'b', isoriginal: 0 },
    { show_id: 900, showdate: '2022-11-05', showyear: '2022', song_id: 11, songname: 'Other Song', slug: 'other-song', settype: 'Set', setnumber: 'e', position: 3, showorder: 3, uniqueid: 'c', isoriginal: 1 },
  ],
};

test('isCustomEntry matches on the slug, not the id', () => {
  // The slug says what the row IS; song_id 1 is only where those rows happen
  // to point. Verified against live data that both predicates select the same
  // three rows, so this is a choice about which fact to depend on.
  assert.equal(isCustomEntry({ slug: '_custom_', song_id: 1 }), true);
  assert.equal(isCustomEntry({ slug: '_custom_', song_id: 999 }), true, 'a renumbered custom row is still custom');
  assert.equal(isCustomEntry({ slug: 'real-song', song_id: 1 }), false, 'a real song at id 1 is still a song');
  assert.equal(isCustomEntry({}), false);
  assert.equal(isCustomEntry(null), false);
});

test('THE CATALOGUE EXCLUDES FREE-TEXT ENTRIES', () => {
  const index = buildIndex(RAW);
  // Two songs in, two songs out -- not three.
  assert.equal(index.counts.songs, 2, 'the free-text row must not become a song');
  assert.equal(index.songsById.has(1), false, 'song_id 1 must not be in the catalogue');
  assert.deepEqual(
    index.songs.map((s) => s.name).sort(),
    ['Other Song', 'Real Song'],
  );
});

test('the row still renders in the setlist, where The Carton shows it', () => {
  // The point of excluding on identity rather than dropping the row. If this
  // app's setlist disagreed with the page it links to, that would be a worse
  // failure than a count being one too high.
  const index = buildIndex(RAW);
  const rows = index.setlistByShow.get(900);
  assert.equal(rows.length, 3, 'all three rows stay in the setlist');
  assert.ok(rows.some((r) => r.songname === 'NYE Announcement'));
});

test('the show structure is unchanged by the exclusion', () => {
  // Measured against live data: each of the three free-text rows sits in a set
  // with other entries, so no show loses a set either way. Pinned because
  // dropping the rows instead of excluding them WOULD have risked this.
  const index = buildIndex(RAW);
  assert.equal(showStructure(index, 900), 'S1+E');
});

test('the gap chart reports no gap for a free-text entry', () => {
  // A gap is a property of a song entering a show. Keyed on the shared
  // song_id, this one would report a figure computed across three unrelated
  // announcements.
  const index = buildIndex(RAW);
  const entries = gapChartForShow(index, 900);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((e) => e.songname).sort(), ['Other Song', 'Real Song']);
});

test('a catalogue song that is never played still counts', () => {
  // The exclusion must not take the never-played songs with it -- those are
  // real catalogue entries and "Never played" is the honest answer for them.
  const withUnplayed = {
    ...RAW,
    songs: [...RAW.songs, { id: 12, name: 'Never Played', slug: 'never-played', isoriginal: 1, original_artist: 'Eggy' }],
  };
  const index = buildIndex(withUnplayed);
  assert.equal(index.counts.songs, 3);
  const never = index.songs.find((s) => s.name === 'Never Played');
  assert.equal(never.timesPlayed, 0);
  assert.equal(never.showsSinceLastPlayed, null, 'no gap, which is not the same as a large gap');
});
