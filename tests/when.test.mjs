// Run: node --test
//
// The When control's states (0.1.91), src/util/when.js: the list the Shows
// view labels by and scripts/smoke.mjs walks. These hold the list to the three
// states the view builds and the mapping from a When value onto them; the
// smoke test holds each state reachable and escapable on the screen, which no
// unit test can see.
//
// Red proofs (0.1.91), each applied alone and the file restored by hash:
//   whenKind reading { year, month } as 'year'  -> "a year and a month is the month state"
//   whenLabel printing the month's number        -> 'Aug 2019' reads '8 2019'
//   a fourth state appended to WHEN_STATES       -> "every listed state is one whenKind produces"

import test from 'node:test';
import assert from 'node:assert/strict';
import { WHEN_STATES, whenKind, whenLabel, MONTH_SHORT } from '../src/util/when.js';

test('WHEN_STATES is all, year, month -- and nothing else', () => {
  assert.deepEqual(WHEN_STATES, ['all', 'year', 'month']);
});

test('whenKind lands every When value on one of the three', () => {
  assert.equal(whenKind(null), 'all');
  assert.equal(whenKind(undefined), 'all');
  assert.equal(whenKind({ year: 2019 }), 'year');
  assert.equal(whenKind({ year: 2019, month: null }), 'year', 'a null month is the year state');
  assert.equal(whenKind({ year: 2019, month: 8 }), 'month', 'a year and a month is the month state');
  assert.equal(whenKind({ year: 2019, month: 12 }), 'month');
});

test('every listed state is one whenKind produces, and every produced state is listed', () => {
  const produced = new Set([null, { year: 2019 }, { year: 2019, month: 8 }].map(whenKind));
  assert.deepEqual([...produced].sort(), [...WHEN_STATES].sort());
});

test('whenLabel reads All, the year, or the short month and the year', () => {
  assert.equal(whenLabel(null), 'All');
  assert.equal(whenLabel({ year: 2019 }), '2019');
  assert.equal(whenLabel({ year: 2019, month: 8 }), 'Aug 2019');
  assert.equal(whenLabel({ year: 2026, month: 1 }), 'Jan 2026');
  assert.equal(whenLabel({ year: 2026, month: 12 }), 'Dec 2026');
  assert.equal(MONTH_SHORT.length, 12);
  assert.deepEqual(MONTH_SHORT.slice(0, 3), ['Jan', 'Feb', 'Mar']);
});
