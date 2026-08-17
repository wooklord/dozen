// Run: node --test
//
// Alphabetical ordering. One comparator serves Songs, Jams and the canonical
// index order, so these tests pin the behaviour for all three at once.
//
// Every name below is real, taken from the live catalog on 2026-08-17.

import test from 'node:test';
import assert from 'node:assert/strict';
import { sortKeyForName } from '../src/data/normalize.js';
import { buildIndex, compareSongsByName } from '../src/data/index.js';

const song = (song_id, name) => ({ song_id, name });
const order = (names) => names.map((n, i) => song(i + 1, n)).sort(compareSongsByName).map((s) => s.name);

test('a leading article is ignored: "A Moment’s Notice" files under M', () => {
  assert.equal(sortKeyForName('A Moment’s Notice'), 'moments notice');
  // It sorts between Middle and Music, not at the top under "A".
  const sorted = order(['The Vortex', 'A Moment’s Notice', 'Agatha', 'Zugzwang']);
  assert.deepEqual(sorted, ['Agatha', 'A Moment’s Notice', 'The Vortex', 'Zugzwang']);
});

test('a leading "The" is ignored: "The Shape I’m In" files under S', () => {
  assert.equal(sortKeyForName('The Shape I’m In'), 'shape im in');
  const sorted = order(['Zugzwang', 'The Shape I’m In', 'Razi', 'Trixieville']);
  // Files under S: after Razi, before Trixieville.
  assert.deepEqual(sorted, ['Razi', 'The Shape I’m In', 'Trixieville', 'Zugzwang']);
});

test('THE TRAP: words merely starting with a/an/the are NOT stripped', () => {
  // Prefix matching without the space boundary would mangle all of these.
  // All are real catalog names.
  const cases = [
    ['Althea', 'althea'],
    ['All The Way Down (Shadow Pt. 2)', 'all the way down (shadow pt 2)'],
    ['All Wheels Turnin\'', 'all wheels turnin'],
    ['Agatha', 'agatha'],
    ['American Music', 'american music'],
    ['Amoreena', 'amoreena'],
    ['And It Stoned Me', 'and it stoned me'],
    ['Apology', 'apology'],
    ['Atomic Age', 'atomic age'],
    ['Ain’t No Bread In The Breadbox', 'aint no bread in the breadbox'],
    // "These"/"They" prefix-match "the" -- the sharper version of the bug.
    ['These Days', 'these days'],
    ['They Love Each Other', 'they love each other'],
  ];
  for (const [name, expected] of cases) {
    assert.equal(sortKeyForName(name), expected, `${name} was mangled`);
  }
});

test('"Althea" sorts under A, not under L', () => {
  const sorted = order(['Zugzwang', 'Althea', 'Lightning', 'Banjo']);
  assert.deepEqual(sorted, ['Althea', 'Banjo', 'Lightning', 'Zugzwang']);
});

test('"They Love Each Other" sorts under T, not under Y', () => {
  const sorted = order(['Yuck!', 'They Love Each Other', 'Shatter', 'Zugzwang']);
  assert.deepEqual(sorted, ['Shatter', 'They Love Each Other', 'Yuck!', 'Zugzwang']);
});

test('articles are stripped for ordering but never for display', () => {
  const sorted = ['The Vortex', 'A Moment’s Notice'].map((n, i) => song(i + 1, n)).sort(compareSongsByName);
  // Display names come through untouched, articles and curly apostrophes intact.
  assert.deepEqual(sorted.map((s) => s.name), ['A Moment’s Notice', 'The Vortex']);
});

test('the whole real article set interleaves rather than piling up', () => {
  // 4 of the 17 real article-led titles, mixed with non-article neighbours.
  const sorted = order([
    'The Windup', 'Wayless', 'The Best', 'Backyard Bear',
    'The Sip', 'Shatter', 'A Apolitical Blues', 'Apology',
  ]);
  assert.deepEqual(sorted, [
    'A Apolitical Blues',   // apolitical blues  (i < o at the 5th char)
    'Apology',              // apology
    'Backyard Bear',        // backyard bear
    'The Best',             // best
    'Shatter',              // shatter
    'The Sip',              // sip
    'Wayless',              // wayless
    'The Windup',           // windup
  ]);
});

test('a song named only "The" or "A" does not sort as an empty string', () => {
  assert.equal(sortKeyForName('The'), 'the');
  assert.equal(sortKeyForName('A'), 'a');
});

test('ordering is total and stable for names that normalize identically', () => {
  // Same normalized name, different ids -- must not compare equal ambiguously.
  const a = { song_id: 7, name: "A Moment's Notice" };
  const b = { song_id: 3, name: 'A Moment’s Notice' };
  assert.ok(compareSongsByName(a, b) > 0, 'ties break on song_id');
  assert.ok(compareSongsByName(b, a) < 0, 'and the reverse is consistent');
  assert.equal(compareSongsByName(a, a), 0);
});

test('the comparator works without precomputed keys', () => {
  // Views pass index entries that carry sortkey/songkey; these do not.
  assert.ok(compareSongsByName({ song_id: 1, name: 'The Best' }, { song_id: 2, name: 'Zugzwang' }) < 0);
});

// --- Both tabs order an identical set identically -----------------------------

function fixtureIndex() {
  const names = [
    [10, 'The Windup'],
    [20, 'Althea'],
    [30, 'A Moment’s Notice'],
    [40, 'They Love Each Other'],
    [50, 'Shatter'],
  ];
  const shows = names.map(([id], i) => ({
    show_id: 100 + i,
    showdate: `2020-0${i + 1}-01`,
    permalink: `s${i}.html`,
    venuename: 'V', location: 'L', city: 'C', state: 'S', country: 'USA',
    show_year: 2020, showorder: 1, venue_id: 1, show_tags: [],
  }));
  const setlists = names.map(([id, name], i) => ({
    uniqueid: String(i), show_id: 100 + i, showdate: `2020-0${i + 1}-01`,
    songname: name, song_id: id, slug: `s${id}`, settype: 'Set', setnumber: '1',
    position: 1, transition_id: 1, transition: ', ', footnote: '', footnotes: null,
    isjamchart: 1, venue_id: 1, venuename: 'V', city: 'C', state: 'S', country: 'USA',
    showyear: 2020, showorder: 1, isoriginal: 1, original_artist: '', isreprise: 0, isjam: 0,
  }));
  // Every song is on the jam chart, with deliberately different entry counts
  // so that a count-based order would differ from alphabetical.
  const jamcharts = names.flatMap(([id, name], i) =>
    Array.from({ length: 5 - i }, (_, k) => ({
      uniqueid: `${id}-${k}`, song_id: id, songname: name, showid: 100 + i,
      showdate: `2020-0${i + 1}-01`, setnumber: '1', position: 1,
      jamchartnote: '', venuename: 'V', city: 'C', state: 'S', country: 'USA',
      permalink: `s${i}.html`,
    })),
  );
  return buildIndex({
    shows, setlists, jamcharts, albums: [],
    songs: names.map(([id, name]) => ({ id, name, slug: `s${id}`, isoriginal: 1, original_artist: 'Eggy' })),
    venues: [{ venue_id: 1, venuename: 'V', city: 'C', state: 'S', country: 'USA', slug: 'v' }],
  });
}

test('Songs and Jams order an identical set identically', () => {
  const index = fixtureIndex();

  // What the Songs tab renders under its A-Z default.
  const songsTab = index.songs.slice().sort(compareSongsByName).map((s) => s.name);

  // What the Jams tab renders under its A-Z default: same comparator, applied
  // to the jam-chart subset (which here is every song).
  const jamsTab = index.songs.filter((s) => s.isJamChart).slice().sort(compareSongsByName).map((s) => s.name);

  assert.deepEqual(jamsTab, songsTab, 'the two tabs disagree about order');
  assert.deepEqual(songsTab, [
    'Althea',
    'A Moment’s Notice',
    'Shatter',
    'They Love Each Other',
    'The Windup',
  ]);
});

test('the canonical index order already matches the A-Z sort', () => {
  // buildIndex sorts through the same comparator, so a view that does not
  // re-sort still agrees with one that does.
  const index = fixtureIndex();
  assert.deepEqual(
    index.songs.map((s) => s.name),
    index.songs.slice().sort(compareSongsByName).map((s) => s.name),
  );
});

test('sorting by entry count still resolves ties alphabetically', () => {
  const index = fixtureIndex();
  const tied = index.songs.map((s) => ({ ...s, jamcharts: [{}, {}] })); // all equal
  const byEntries = tied
    .slice()
    .sort((a, b) => b.jamcharts.length - a.jamcharts.length || compareSongsByName(a, b))
    .map((s) => s.name);
  assert.deepEqual(byEntries, index.songs.map((s) => s.name));
});
