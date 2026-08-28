// Run: node --test
//
// formatMonthDay, the "On this date" header's formatter.
//
// It exists because the header rendered `md.replace('-', '/')` -- "10/15",
// the only numeric date anywhere in the UI, next to a card whose own date
// reads "Wed Oct 15, 2025". Two spellings of the same day, two inches apart.

import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMonthDay, formatShowDate, formatShowDateShort, monthDayKey } from '../src/util/dates.js';

test('a month-day key renders the month by name', () => {
  assert.equal(formatMonthDay('10-15'), 'Oct 15');
  assert.equal(formatMonthDay('08-14'), 'Aug 14');
});

test('the day is not zero-padded and the month is not numeric', () => {
  // "Jan 01" and "1/1" are both things a naive fix produces.
  assert.equal(formatMonthDay('01-01'), 'Jan 1');
  assert.equal(formatMonthDay('12-31'), 'Dec 31');
  assert.doesNotMatch(formatMonthDay('10-15'), /\d{2}\/|\//);
});

test('Feb 29 formats rather than rolling into March', () => {
  // The month-day key carries no year, so the formatter picks one. 2000 is a
  // leap year for exactly this row; 2001 would silently render "Mar 1" for a
  // date shows have actually been played on.
  assert.equal(formatMonthDay('02-29'), 'Feb 29');
});

test('an impossible key comes back unchanged, never as a plausible wrong date', () => {
  // new Date(2000, 12, 40) is a real date in 2001 and would render as a
  // confident "Feb 9". A header that invents a day is worse than one that
  // shows its raw key.
  assert.equal(formatMonthDay('13-40'), '13-40');
  assert.equal(formatMonthDay('02-31'), '02-31');
  assert.equal(formatMonthDay('00-00'), '00-00');
});

test('malformed input degrades rather than throwing', () => {
  // The header renders this inline; a throw here takes the whole Home view
  // down to the error boundary.
  assert.equal(formatMonthDay('8-1'), '8-1');
  assert.equal(formatMonthDay(''), '');
  assert.equal(formatMonthDay(null), '');
  assert.equal(formatMonthDay(undefined), '');
  assert.equal(formatMonthDay(1015), '');
});

test('the header month matches the month the cards under it show', () => {
  // THE POINT OF THE CHANGE. The header names a date and the cards beneath it
  // name the same date; if the two formatters ever disagree on how a month is
  // spelled, the section reads as being about two different days. Derived from
  // one showdate through both paths rather than compared against literals --
  // a literal here is the copy that drifts.
  for (const showdate of ['2025-10-15', '2019-01-05', '2024-02-29', '2013-09-07']) {
    const header = formatMonthDay(monthDayKey(showdate));
    const month = header.split(' ')[0];
    assert.ok(
      formatShowDate(showdate).includes(month),
      `${showdate}: header "${header}" vs card "${formatShowDate(showdate)}"`,
    );
    assert.ok(
      formatShowDateShort(showdate).startsWith(month),
      `${showdate}: header "${header}" vs "${formatShowDateShort(showdate)}"`,
    );
  }
});
