// Run: node --test
//
// The place string venue text is built from.
//
// venueLine() renders records out of FOUR different Carton tables -- shows,
// setlists, jamcharts and venues -- and only `shows` carries a `location`
// field. Preferring it meant the same venue read three ways depending on which
// screen you were on. These pin the one rule that replaced it.
//
// components.js cannot be imported here: it reaches for `document` at module
// scope through dom.js. The function under test is a pure string join, so it
// is parsed out of the source and evaluated -- which also means a rename or a
// rewrite fails loudly rather than silently testing a stale copy.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'src/ui/components.js'), 'utf8');

const start = src.indexOf('function placeOf(');
assert.ok(start > 0, 'placeOf() is gone or renamed — this file is testing nothing');
const body = src.slice(start, src.indexOf('\n}', start) + 2);
// eslint-disable-next-line no-new-func
const placeOf = new Function(`${body}; return placeOf;`)();

test('a US venue drops the country, which is noise on every row', () => {
  assert.equal(placeOf({ city: 'Syracuse', state: 'NY', country: 'USA' }), 'Syracuse, NY');
  assert.equal(placeOf({ city: 'New Haven', state: 'CT', country: 'USA' }), 'New Haven, CT');
});

test('a non-US venue keeps its country', () => {
  // The filter names USA specifically. "Toronto, ON" would be a worse line
  // than "Syracuse, NY, USA" ever was.
  assert.equal(placeOf({ city: 'Toronto', state: 'ON', country: 'Canada' }), 'Toronto, ON, Canada');
});

test('USA survives only when it is the ONLY thing known', () => {
  // THIS TEST ASSERTED THE OPPOSITE IN 0.1.67 AND WAS WRONG (corrected 0.1.68).
  // It read:
  //
  //     assert.equal(placeOf({ city: 'Somewhere', country: 'USA' }), 'Somewhere, USA');
  //
  // and its comment said "with two parts or fewer the country is carrying
  // information". That is false for the only two-part row that actually exists
  // -- venue 443, The Atlantis, city "Washington, D.C." with a blank state --
  // where "USA" carries nothing and the line read "Washington, D.C., USA".
  //
  // The withdrawal is worth more than the fix. `{ city: 'Somewhere' }` is not
  // a row in this archive; it is a shape I invented to describe a rule I had
  // assumed. A test written against invented data cannot disagree with you,
  // so it locked the assumption in and then read as evidence for it. Every
  // case below this line is a real row, quoted by venue_id.
  assert.equal(placeOf({ city: 'Somewhere', country: 'USA' }), 'Somewhere');
  assert.equal(placeOf({ country: 'USA' }), 'USA');
});

test('blank fields drop out without leaving a dangling comma', () => {
  // The six Atlantic Ocean cruise shows are exactly this: a city and nothing
  // else. Carton's own `location` renders them "Atlantic Ocean, " -- with the
  // comma -- which is the reason this function no longer defers to it.
  assert.equal(placeOf({ city: 'Atlantic Ocean', state: '', country: '' }), 'Atlantic Ocean');
  assert.equal(placeOf({ city: 'Atlantic Ocean' }), 'Atlantic Ocean');
  assert.equal(placeOf({}), '');
});

test('a `location` field on the record is ignored', () => {
  // THE WHOLE POINT. `shows` rows carry one and the other three tables do not,
  // so honouring it makes the same venue render differently on Home than on
  // song detail. Asserted with a location that DISAGREES with the parts, so a
  // reintroduced `showOrVenue.location ||` cannot pass by coincidence.
  assert.equal(
    placeOf({ location: 'SOMEWHERE ELSE ENTIRELY', city: 'Syracuse', state: 'NY', country: 'USA' }),
    'Syracuse, NY',
  );
});

test('every table renders one venue identically', () => {
  // The four record shapes as the API actually returns them, verified live:
  // only `shows` has `location`, and all four carry city/state/country.
  const shows = { location: 'Syracuse, NY, USA', city: 'Syracuse', state: 'NY', country: 'USA' };
  const setlists = { city: 'Syracuse', state: 'NY', country: 'USA' };
  const jamcharts = { city: 'Syracuse', state: 'NY', country: 'USA' };
  const venues = { city: 'Syracuse', state: 'NY', country: 'USA' };
  const rendered = [shows, setlists, jamcharts, venues].map(placeOf);
  assert.equal(new Set(rendered).size, 1, `tables disagree: ${JSON.stringify(rendered)}`);
});

// --- The three rows in the archive with a blank field ------------------------
//
// Every venue with a blank city, state or country, checked across all 440
// venues, 804 shows, 6361 setlist rows and 807 jamchart rows on 2026-08-27.
// There are three, they behave three different ways, and each is pinned by its
// REAL field values rather than by an invented shape -- the whole reason
// "Washington, D.C., USA" survived 0.1.67 is that the guard was written against
// an assumption about the data instead of against the data.

test('The Atlantis: a state packed into the city field still drops USA', () => {
  // venue_id 443. The reported bug. `state` is blank because the state is
  // sitting inside `city`, so .filter(Boolean) leaves two parts and the old
  // `arr.length > 2` guard never fired.
  assert.equal(
    placeOf({ venuename: 'The Atlantis', city: 'Washington, D.C.', state: '', country: 'USA' }),
    'Washington, D.C.',
  );
});

test('The Atlantis reads consistently with its own sibling row', () => {
  // 283 "Atlantis" (city Washington, state DC) and 443 "The Atlantis" are the
  // same room in two rows. They rendered "Washington, DC" and
  // "Washington, D.C., USA" -- which is what the report was actually seeing.
  // Carton's own punctuation still differs; the SHAPE must not.
  const a283 = placeOf({ city: 'Washington', state: 'DC', country: 'USA' });
  const a443 = placeOf({ city: 'Washington, D.C.', state: '', country: 'USA' });
  assert.ok(!/USA/.test(a283) && !/USA/.test(a443), `${a283} vs ${a443}`);
});

test('Jamburg: USA survives when it is the only thing known', () => {
  // venue_id 192, city and state both blank. Dropping the country here would
  // leave an EMPTY place string and the venue line would render a bare name.
  // This is the case the guard exists for.
  assert.equal(placeOf({ venuename: 'Jamburg', city: '', state: '', country: 'USA' }), 'USA');
});

test('MSC Divina: the cruise shows carry no country to strip', () => {
  // venue_id 282, six shows. Already correct since 0.1.67 dropped `location`,
  // whose value for these rows is "Atlantic Ocean, " -- trailing comma, nothing
  // after it. Pinned so a future change to placeOf cannot resurrect it.
  const row = { venuename: 'MSC Divina', location: 'Atlantic Ocean, ', city: 'Atlantic Ocean', state: '', country: '' };
  assert.equal(placeOf(row), 'Atlantic Ocean');
  assert.doesNotMatch(placeOf(row), /,\s*$/, 'no trailing comma');
});

test('the ordinary three-field row is untouched by the widened guard', () => {
  // `> 2` to `> 1` must not change the 437 venues that have all three fields.
  assert.equal(placeOf({ city: 'Syracuse', state: 'NY', country: 'USA' }), 'Syracuse, NY');
  assert.equal(placeOf({ city: 'Washington', state: 'DC', country: 'USA' }), 'Washington, DC');
  assert.equal(placeOf({ city: 'Washington', state: 'D.C.', country: 'USA' }), 'Washington, D.C.');
  assert.equal(placeOf({ city: 'Toronto', state: 'ON', country: 'Canada' }), 'Toronto, ON, Canada');
});
