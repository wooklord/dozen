// Tours (0.1.84): the tour line on show detail and the Venue rows both read
// tourName(). docs/plan.md, "Tours (2026-10-25)": the name renders exactly as
// Carton stores it (rule 1), and tour_id 1 renders nothing (rule 2).
//
// WHAT ELSE COULD SATISFY THIS? On the live data tour_id 1 and the name "Not
// Part of a Tour" are one-to-one, so a helper keyed on the STRING renders the
// same screens as one keyed on the id, and the smoke test cannot tell them
// apart. The fixture can: it carries tour_id 1 under another name, and the
// string under another id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tourName } from '../src/data/index.js';

test('tour_id 1 names nothing, whatever its name says', () => {
  assert.equal(tourName({ tour_id: 1, tourname: 'Not Part of a Tour' }), null);
  assert.equal(tourName({ tour_id: 1, tourname: 'Fall Tour 2021' }), null);
  assert.equal(tourName({ tour_id: '1', tourname: 'Not Part of a Tour' }), null, 'an id that arrives as a string');
});

test('the id decides, not the string: a named tour on another id is a tour', () => {
  assert.equal(tourName({ tour_id: 13, tourname: 'Not Part of a Tour' }), 'Not Part of a Tour');
});

test('a named tour comes back exactly as stored -- never corrected', () => {
  // 2019-10-25, Melody's, Beckley WV: filed under Fall Tour 2021, inside the
  // Fall Tour 2019 dates. It reads as Carton files it.
  assert.equal(tourName({ tour_id: 4, tourname: 'Fall Tour 2021', showdate: '2019-10-25' }), 'Fall Tour 2021');
  assert.equal(tourName({ tour_id: 5, tourname: 'Quarantine Streams' }), 'Quarantine Streams');
});

test('a blank or missing name names nothing; no show names nothing', () => {
  assert.equal(tourName({ tour_id: 4, tourname: '' }), null);
  assert.equal(tourName({ tour_id: 4, tourname: '   ' }), null);
  assert.equal(tourName({ tour_id: 4 }), null);
  assert.equal(tourName(null), null);
});
