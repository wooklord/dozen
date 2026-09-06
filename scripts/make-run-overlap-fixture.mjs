// Regenerate tests/fixtures/run-overlap.json.
//
// Run: node scripts/make-run-overlap-fixture.mjs   (needs the network)
//
// WHY A FIXTURE OF REAL ROWS, AND NOT A HAND-WRITTEN ONE.
//
// The case this covers -- an anchor show whose consecutive-date run contains an
// earlier show at the same venue, so one show qualifies for BOTH lists on
// Home's "Previous set structures" card -- cannot be seen on the live site
// outside a tour: every upcoming show today has an empty run list, because the
// earlier shows in its run are upcoming too and have no setlist yet.
//
// Hand-written rows have already cost this repo once: a `{ city: 'Somewhere' }`
// venue row of a shape the API does not produce. So every row below is copied
// verbatim out of the live archive. Nothing is edited, nothing is synthesised;
// the only thing this script decides is WHICH rows to keep.
//
// The anchor is 2022-06-12, Charleston Pour House (venue_id 22). It was chosen
// because its run list contains BOTH a show that overlaps the venue list
// (2022-06-11, same venue) and shows that do not (2022-06-09 at venue 151,
// 2022-06-10 at venue 174), so a dedupe has to remove some rows and keep
// others. A case where the lists overlap completely would pass against a
// filter that emptied the run list unconditionally.
//
// THE WINDOW IS PART OF THE FIXTURE AND HAS TO BE CHECKED. consecutiveRun()
// walks index.shows outward until it finds a date gap, so trimming the shows
// table can invent a run boundary that does not exist in the archive. This
// script therefore builds the index BOTH ways -- full archive and trimmed
// fixture -- and refuses to write a fixture whose lists differ from the real
// ones.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchShows, fetchVenues, fetchAllSetlists } from '../src/data/source.js';
import { buildIndex, previousSetStructures } from '../src/data/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'fixtures', 'run-overlap.json');

const ANCHOR_DATE = '2022-06-12';
const ANCHOR_VENUE = 22;
// A window wide enough that the run's real boundaries fall inside it. The
// assertion at the bottom is what proves it actually is.
const FROM = '2022-06-01';
const TO = '2022-06-22';

const [shows, venues, setlists] = await Promise.all([fetchShows(), fetchVenues(), fetchAllSetlists()]);

const anchorOf = (index) =>
  index.shows.find((s) => s.showdate === ANCHOR_DATE && Number(s.venue_id) === ANCHOR_VENUE);
const describe = (index) => {
  const { venueRows, runRows } = previousSetStructures(index, anchorOf(index));
  return {
    venue: venueRows.map((s) => Number(s.show_id)),
    run: runRows.map((s) => Number(s.show_id)),
  };
};

const full = buildIndex({
  shows: shows.rows,
  venues: venues.rows,
  setlists: setlists.rows,
  songs: [],
  jamcharts: [],
  albums: [],
});

// Every show at the anchor venue (the venue list needs its whole history so
// the cap is exercised against real depth), plus a window of real neighbours
// around the run so the consecutive-date walk terminates where the archive
// says it does rather than at the edge of the fixture.
const keepShows = shows.rows.filter(
  (s) => Number(s.venue_id) === ANCHOR_VENUE || (s.showdate >= FROM && s.showdate <= TO),
);
// Setlist rows only for the shows that need a structure rendered. Shows after
// the anchor never appear in either list, so their rows are dead weight.
const wantSetlists = new Set(
  keepShows.filter((s) => s.showdate <= ANCHOR_DATE).map((s) => Number(s.show_id)),
);
const keepSetlists = setlists.rows.filter((r) => wantSetlists.has(Number(r.show_id)));
const venueIds = new Set(keepShows.map((s) => Number(s.venue_id)));
const keepVenues = venues.rows.filter((v) => venueIds.has(Number(v.venue_id)));

// `songs` is empty on purpose rather than trimmed: nothing this fixture covers
// reads the songs table, and 500-odd real song rows would quadruple the file
// to make no assertion stronger.
const fixture = {
  shows: keepShows,
  setlists: keepSetlists,
  venues: keepVenues,
  songs: [],
  jamcharts: [],
  albums: [],
};

const trimmed = buildIndex(fixture);
const a = describe(full);
const b = describe(trimmed);
const same = JSON.stringify(a) === JSON.stringify(b);
console.log('full archive :', JSON.stringify(a));
console.log('fixture      :', JSON.stringify(b));
if (!same) {
  console.error('FAIL: the trimmed fixture does not reproduce the archive lists. Widen the window.');
  process.exit(1);
}

fs.writeFileSync(OUT, JSON.stringify(fixture));
console.log(
  `wrote ${path.relative(ROOT, OUT)} — ${keepShows.length} shows, ${keepSetlists.length} setlist rows, ` +
    `${keepVenues.length} venues, ${fs.statSync(OUT).size} bytes`,
);
