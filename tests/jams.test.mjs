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
import { buildIndex, jamKey, jamNoteText } from '../src/data/index.js';
import { mergeYear } from '../src/data/cache.js';

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

// --- the note decodes once ---------------------------------------------------
//
// The second clean this replaces was on the fallback path alone, so a note's
// fate depended on which table it came through. Both paths are held here, on
// the same three spellings. A double decode turns the third into a real tag's
// text, which the DOM would still print safely, and that is the point: this is
// about the words being Carton's, and the DOM check is in scripts/smoke.mjs.

const RAW_TAG = '<img src=x onerror="window.__x=1">';
const ONE_ENCODED = '&lt;img src=x onerror=&quot;window.__x=1&quot;&gt;';
const TWO_ENCODED = '&amp;lt;img src=x onerror=1&amp;gt;';

function noteFor(rowNote, tableNote) {
  const f = fixture();
  f.setlists = f.setlists.map((r) => (r.songname === 'Mango' ? { ...r, jamchart_notes: rowNote } : r));
  f.jamcharts = tableNote === undefined
    ? f.jamcharts.filter((j) => j.songname !== 'Mango')
    : f.jamcharts.map((j) => (j.songname === 'Mango' ? { ...j, jamchartnote: tableNote } : j));
  return buildIndex(f).jamByShow.get(1).find((j) => j.songname === 'Mango').note;
}

for (const [path, read] of [
  ['the setlist row, no jamcharts row', (s) => noteFor(s)],
  ['the jamcharts row', (s) => noteFor('ignored', s)],
]) {
  test(`a note decodes exactly once through ${path}`, () => {
    assert.equal(read(RAW_TAG), RAW_TAG, 'a literal tag stays as text; cleaning does not strip it');
    assert.equal(read(ONE_ENCODED), RAW_TAG);
    assert.equal(read(TWO_ENCODED), '&lt;img src=x onerror=1&gt;', 'twice would read <img');
    assert.equal(read('  spaced   out  '), 'spaced out');
  });
}

test('a null note on a flagged row is an empty note, not the string "null"', () => {
  assert.equal(noteFor(null), '');
});

// --- "(Recommended)" ---------------------------------------------------------

test('jamNoteText appends The Carton\'s word to a flagged note and nothing else', () => {
  assert.equal(jamNoteText('a note', true), 'a note (Recommended)');
  assert.equal(jamNoteText('a note', false), 'a note');
  assert.equal(jamNoteText('', true), '', 'no note, nothing to attach the word to');
  assert.equal(jamNoteText('', false), '');
});

function flagged(setRows, setTable) {
  const f = fixture();
  f.setlists = f.setlists.map((r) => ({ ...r, isrecommended: setRows(r) }));
  f.jamcharts = f.jamcharts.map((j) => ({ ...j, isrecommended: setTable(j) }));
  return buildIndex(f).jamByShow.get(1);
}

test('isRecommended is per performance: only the flagged Zebra of the two', () => {
  const entries = flagged(() => null, (j) => (j.songname === 'Zebra' && j.position === 4 ? 1 : 0));
  assert.deepEqual(
    entries.map((e) => [e.songname, e.position, e.isRecommended]),
    [['Zebra', 1, false], ['Mango', 3, false], ['Zebra', 4, true], ['Cider', 1, false]],
  );
});

test('isrecommended of null and of 0 both read false', () => {
  assert.ok(flagged(() => null, () => null).every((e) => e.isRecommended === false));
  assert.ok(flagged(() => 0, () => 0).every((e) => e.isRecommended === false));
});

test('the jamcharts row decides the flag where one exists, the setlist row where none does', () => {
  // The same source as the note, so an entry cannot print one table's words
  // with the other table's flag.
  const fromTable = flagged(() => 1, () => 0);
  assert.ok(fromTable.every((e) => e.isRecommended === false));

  const f = fixture();
  f.setlists = f.setlists.map((r) => ({ ...r, isrecommended: r.songname === 'Mango' ? 1 : 0 }));
  f.jamcharts = f.jamcharts.filter((j) => j.songname !== 'Mango');
  const mango = buildIndex(f).jamByShow.get(1).find((e) => e.songname === 'Mango');
  assert.equal(mango.isRecommended, true);
});

test('a recommended row that is not a jam chart row makes no entry', () => {
  // Real: 12 Pounds of Pain and Boom or Bust, 2024-05-10. isrecommended is not
  // a subset of isjamchart, so the flag must never add a row by itself.
  const f = fixture();
  f.setlists = f.setlists.map((r) => (r.songname === 'Apple' ? { ...r, isrecommended: 1 } : r));
  const names = buildIndex(f).jamByShow.get(1).map((e) => e.songname);
  assert.deepEqual(names, ['Zebra', 'Mango', 'Zebra', 'Cider']);
});

test('each entry carries the uniqueid of the setlist row it came from', () => {
  // setlistBlock finds a title's entry by this, and the two Zebras are why it
  // cannot be the song.
  const entries = buildIndex(fixture()).jamByShow.get(1);
  assert.deepEqual(entries.map((e) => e.uniqueid), ['1', '3', '4', '6']);
});

// --- the fast path keeps the jamcharts table current -------------------------

function cachedArchive() {
  const f = fixture();
  return { ...f, setlists: f.setlists.map((r) => ({ ...r, showyear: 2020 })), fetchedAt: 1 };
}

test('mergeYear takes the pulled jamcharts table, and song detail then lists the new entry', () => {
  const archive = cachedArchive();
  const added = { ...archive.jamcharts[0], uniqueid: 'new', song_id: 20, songname: 'Blossom', setnumber: '1', position: 5, jamchartnote: 'new note' };
  const pulled = [...archive.jamcharts, added];
  const merged = mergeYear(archive, { setlists: [], shows: archive.shows, jamcharts: pulled, year: 2019 });

  assert.equal(merged.mergeRejected, false);
  assert.strictEqual(merged.jamcharts, pulled);
  const blossom = buildIndex(merged).songsById.get(20);
  assert.deepEqual(blossom.jamcharts.map((j) => j.jamchartnote), ['new note']);
});

test('a short jamcharts pull keeps the cached table, still merges the rows, and logs the url', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const archive = cachedArchive();
  const row = { ...archive.setlists[0], uniqueid: 'y', showyear: 2019 };
  const merged = mergeYear(archive, {
    setlists: [row],
    shows: archive.shows,
    jamcharts: archive.jamcharts.slice(1),
    jamchartsUrl: 'https://example.test/jamcharts.json?limit=20000',
    year: 2019,
  });

  assert.strictEqual(merged.jamcharts, archive.jamcharts);
  assert.equal(merged.mergeRejected, false, 'a short table is not a rejected merge');
  assert.equal(merged.setlists.length, archive.setlists.length + 1, 'the good rows still merge');
  assert.notEqual(merged.fetchedAt, archive.fetchedAt);
  assert.equal(warn.mock.callCount(), 1);
  const said = warn.mock.calls[0].arguments[0];
  assert.match(said, /3 rows/);
  assert.match(said, /already held 4/);
  assert.match(said, /jamcharts\.json\?limit=20000/);
});

test('an equal-sized jamcharts pull replaces the table: an edited note comes through', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const archive = cachedArchive();
  const pulled = archive.jamcharts.map((j) => ({ ...j, jamchartnote: `edited ${j.jamchartnote}` }));
  const merged = mergeYear(archive, { setlists: [], shows: archive.shows, jamcharts: pulled, year: 2019 });
  assert.strictEqual(merged.jamcharts, pulled);
  assert.equal(warn.mock.callCount(), 0);
});

test('a pull with no jamcharts at all leaves the cached table alone', () => {
  const archive = cachedArchive();
  const merged = mergeYear(archive, { setlists: [], shows: archive.shows, year: 2019 });
  assert.strictEqual(merged.jamcharts, archive.jamcharts);
});

test('a rejected year merge changes nothing, the jamcharts table included', (t) => {
  t.mock.method(console, 'error', () => {});
  const archive = cachedArchive();
  const merged = mergeYear(archive, {
    setlists: [],
    shows: [],
    jamcharts: [...archive.jamcharts, { ...archive.jamcharts[0], uniqueid: 'more' }],
    year: 2020,
  });
  assert.equal(merged.mergeRejected, true);
  assert.strictEqual(merged.jamcharts, archive.jamcharts);
});
