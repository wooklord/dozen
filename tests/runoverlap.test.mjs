// Run: node --test
//
// Home's "Previous set structures" card: the ORDER of its two lists and the
// DIRECTION of the dedupe between them (0.1.72).
//
// WHAT THIS COVERS AND WHY IT NEEDS A FIXTURE.
//
// The two lists are different CRITERIA, not different periods: the venue list
// is this venue at any time, "earlier in this run" is any venue inside a
// consecutive-date run. A two-night stand or a festival's second day satisfies
// both, and before 0.1.72 rendered in both.
//
// That case CANNOT BE SEEN ON THE LIVE SITE OUTSIDE A TOUR. Every upcoming
// show today has an empty run list, because the earlier shows in its run are
// upcoming too and have no setlist yet. So there is nothing to look at, and
// the only honest way to check the behaviour is to construct the case.
//
// EVERY ROW IN THE FIXTURE IS COPIED VERBATIM FROM THE LIVE ARCHIVE and goes
// through the real buildIndex(). Nothing is hand-shaped -- a hand-written
// venue row of a shape the API does not produce (`{ city: 'Somewhere' }`) has
// already cost this repo a wrong conclusion once.
// scripts/make-run-overlap-fixture.mjs regenerates it, and refuses to write a
// fixture whose lists differ from the ones the full archive produces.
//
// The one thing the tests below DO synthesise is dates, in the last test, and
// only by adding a constant number of days to every date in the fixture at
// once. That turns the anchor into an upcoming show while leaving row shapes,
// venue ids, setlist contents and the spacing between shows untouched -- which
// is the whole of what "mid-tour" means to this code.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildIndex,
  consecutiveRun,
  previousSetStructures,
  VENUE_STRUCTURE_LIMIT,
} from '../src/data/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'run-overlap.json'), 'utf8'),
);

const ANCHOR_DATE = '2022-06-12';
const ANCHOR_VENUE = 22;

/** Rebuild the fixture with every showdate moved by `days`. */
function indexShifted(days = 0) {
  const shift = (d) => {
    if (!days) return d;
    const t = new Date(`${d}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() + days);
    return t.toISOString().slice(0, 10);
  };
  const moveShow = (r) => ({ ...r, showdate: shift(r.showdate) });
  return {
    index: buildIndex({
      ...RAW,
      shows: RAW.shows.map(moveShow),
      setlists: RAW.setlists.map(moveShow),
    }),
    anchorDate: shift(ANCHOR_DATE),
  };
}

function anchorIn(index, date) {
  const show = index.shows.find(
    (s) => s.showdate === date && Number(s.venue_id) === ANCHOR_VENUE,
  );
  assert.ok(show, `fixture has no show on ${date} at venue ${ANCHOR_VENUE}`);
  return show;
}

/** The two lists as they were BEFORE any dedupe -- what the card used to show. */
function rawLists(index, show) {
  const played = (s) => s.showdate < show.showdate && index.setlistByShow.has(Number(s.show_id));
  return {
    venue: (index.showsByVenue.get(Number(show.venue_id)) || []).filter(played),
    run: consecutiveRun(index, show.showdate).filter(played),
  };
}

const ids = (rows) => rows.map((s) => Number(s.show_id));

test('the fixture really is the overlap case, before anything is deduped', () => {
  // The premise every assertion below rests on. If this ever stops holding --
  // The Carton edits one of these shows, someone regenerates against a
  // different anchor -- the other tests would pass while covering nothing,
  // which is the exact failure mode CLAUDE.md is about.
  const { index } = indexShifted(0);
  const show = anchorIn(index, ANCHOR_DATE);
  const raw = rawLists(index, show);

  assert.ok(raw.venue.length, 'the venue list is empty; nothing to dedupe against');
  assert.ok(raw.run.length, 'the run list is empty; this is not the mid-tour case');

  const shared = raw.run.filter((s) => ids(raw.venue).includes(Number(s.show_id)));
  assert.ok(shared.length, 'the two raw lists share no show, so no duplication occurs');
  assert.ok(
    shared.length < raw.run.length,
    'the run list is ENTIRELY inside the venue list; a filter that emptied it ' +
      'unconditionally would pass, so this case cannot tell a dedupe from a deletion',
  );
});

test('a show in both lists renders in the VENUE list and is dropped from the run list', () => {
  // THE DIRECTION, asserted in both halves. The venue list is the unlabelled
  // one sitting directly under the header, so a show disappearing from IT is
  // the confusing outcome -- there is no label there to explain an absence.
  const { index } = indexShifted(0);
  const show = anchorIn(index, ANCHOR_DATE);
  const raw = rawLists(index, show);
  const { venueRows, runRows } = previousSetStructures(index, show);

  const shared = raw.run.filter((s) => ids(raw.venue).includes(Number(s.show_id)));
  for (const s of shared) {
    assert.ok(
      ids(venueRows).includes(Number(s.show_id)),
      `${s.showdate} was dropped from the VENUE list`,
    );
    assert.ok(!ids(runRows).includes(Number(s.show_id)), `${s.showdate} is still in the run list`);
  }
});

test('deduping removes only the shared rows -- the rest of the run survives', () => {
  const { index } = indexShifted(0);
  const show = anchorIn(index, ANCHOR_DATE);
  const raw = rawLists(index, show);
  const { venueRows, runRows } = previousSetStructures(index, show);

  const notShared = raw.run.filter((s) => !ids(raw.venue).includes(Number(s.show_id)));
  assert.deepEqual(
    ids(runRows),
    ids(notShared),
    'the run list should keep every show the venue list is not already showing',
  );
  assert.equal(
    ids(venueRows).length,
    ids(raw.venue).length,
    'the venue list should be untouched by the dedupe',
  );
});

test('no show vanishes from both lists', () => {
  // The property the whole ordering was chosen for, checked as a set so it
  // cannot be satisfied by a row turning up somewhere unexpected: everything
  // that rendered before renders after, exactly once.
  const { index } = indexShifted(0);
  const show = anchorIn(index, ANCHOR_DATE);
  const raw = rawLists(index, show);
  const { venueRows, runRows } = previousSetStructures(index, show);

  const before = new Set([...ids(raw.venue).slice(-VENUE_STRUCTURE_LIMIT), ...ids(raw.run)]);
  const after = [...ids(venueRows), ...ids(runRows)];
  assert.equal(after.length, new Set(after).size, 'a show renders twice');
  assert.deepEqual(
    [...before].sort(),
    [...new Set(after)].sort(),
    'a show that used to render no longer does',
  );
});

test('the dedupe follows the rows that RENDER, not the whole venue history', () => {
  // The branch no real anchor can reach: a run-mate is within days of the
  // anchor, so it is always among the newest venue shows and never falls off
  // the cap. Shrinking the cap to zero is the only way to separate the two
  // possible implementations, and they differ exactly here -- filtering the
  // run list against the UNCAPPED venue history would make the shared show
  // vanish from a card that is displaying neither list it belongs to.
  const { index } = indexShifted(0);
  const show = anchorIn(index, ANCHOR_DATE);
  const raw = rawLists(index, show);
  const { venueRows, runRows } = previousSetStructures(index, show, 0);

  assert.equal(venueRows.length, 0, 'a zero cap should render no venue rows');
  assert.deepEqual(
    ids(runRows),
    ids(raw.run),
    'with nothing rendered in the venue list, the run list must keep every show it has',
  );
});

test('the venue list reads newest first and the run list reads forwards', () => {
  const { index } = indexShifted(0);
  const { venueRows, runRows } = previousSetStructures(index, anchorIn(index, ANCHOR_DATE));

  const dates = (rows) => rows.map((s) => s.showdate);
  assert.deepEqual(
    dates(venueRows),
    [...dates(venueRows)].sort().reverse(),
    'venue list is not newest-first',
  );
  assert.deepEqual(dates(runRows), [...dates(runRows)].sort(), 'run list is not in date order');
  assert.ok(venueRows.length <= VENUE_STRUCTURE_LIMIT, 'the venue list exceeded its cap');
});

test('the same case behaves identically when the anchor is an UPCOMING show', () => {
  // The shape the user actually meets: mid-tour, standing in a venue, looking
  // at a show that has not happened yet. Built by moving every date in the
  // fixture forward by the same number of days. Real rows, real spacing
  // between them, only the calendar moved.
  //
  // THE ANCHOR LANDS ON TOMORROW, not on some comfortable distance out. The
  // run is four days wide and the anchor is its LAST night, so pushing the
  // anchor three weeks ahead pushes the whole run ahead with it -- every
  // run-mate becomes upcoming, loses its setlist, and the run list empties.
  // That is not the mid-tour case, it is today's case with different numbers,
  // and it went green on `deepEqual` against an equally empty past list until
  // the "must be in the past" assertion below caught it. Tomorrow is the only
  // offset that leaves run-mates behind today, which is the whole point.
  const now = new Date();
  const anchorAt = Date.UTC(2022, 5, 12);
  const days =
    Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - anchorAt) / 86400000) +
    1;

  const past = indexShifted(0);
  const future = indexShifted(days);

  const anchor = anchorIn(future.index, future.anchorDate);
  assert.ok(
    future.index.futureShows.some((s) => Number(s.show_id) === Number(anchor.show_id)),
    'the shifted anchor is not an upcoming show; the shift did not do what this test needs',
  );

  const a = previousSetStructures(past.index, anchorIn(past.index, ANCHOR_DATE));
  const b = previousSetStructures(future.index, anchor);
  assert.deepEqual(ids(b.venueRows), ids(a.venueRows));
  assert.deepEqual(ids(b.runRows), ids(a.runRows));
  assert.ok(b.runRows.length, 'the upcoming anchor rendered no run rows at all');

  // And the run rows really are behind today, which is what makes them
  // renderable at all -- they need recorded setlists.
  const todayStr = new Date().toISOString().slice(0, 10);
  for (const s of b.runRows) assert.ok(s.showdate < todayStr, `${s.showdate} is not in the past`);
});
