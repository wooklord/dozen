// Run: node --test
//
// venueMapsUrl builds an OUTBOUND deep link out of Carton's own venue fields.
// Nothing is fetched from or rendered by Google -- see CLAUDE.md.
//
// Values below are real rows from the live venue table.

import test from 'node:test';
import assert from 'node:assert/strict';
import { venueMapsUrl } from '../src/ui/components.js';
import { MAPS_SEARCH_BASE } from '../src/config.js';

const query = (url) => decodeURIComponent(url.slice(MAPS_SEARCH_BASE.length));

test('name, city and state are joined comma-separated', () => {
  const url = venueMapsUrl({ venuename: 'The Peach Music Festival', city: 'Scranton', state: 'PA' });
  assert.ok(url.startsWith(MAPS_SEARCH_BASE));
  assert.equal(query(url), 'The Peach Music Festival, Scranton, PA');
});

test('the query is encoded, not raw', () => {
  const url = venueMapsUrl({ venuename: 'Brooklyn Bowl', city: 'Las Vegas', state: 'NV' });
  assert.ok(!url.includes(' '), 'spaces must be encoded');
  assert.ok(url.includes('%20') || url.includes('%2C'), 'expected percent-encoding');
  assert.equal(query(url), 'Brooklyn Bowl, Las Vegas, NV');
});

test('a colon in the name survives encoding — the real 9:30 Club rows', () => {
  // Both duplicate rows produce the same link. That is expected, not a bug.
  const a = venueMapsUrl({ venuename: '9:30 Club', city: 'Washington, D.C.', state: '' });
  const b = venueMapsUrl({ venuename: '9:30 Club', city: 'Washington, DC', state: '' });
  assert.equal(query(a), '9:30 Club, Washington, D.C.');
  assert.equal(query(b), '9:30 Club, Washington, DC');
  assert.ok(a.includes('9%3A30'), 'the colon must be percent-encoded');
});

test('an apostrophe in the name is handled', () => {
  const url = venueMapsUrl({ venuename: "Annabel's", city: 'Toronto', state: 'ON' });
  assert.equal(query(url), "Annabel's, Toronto, ON");
});

test('a missing state drops out without a dangling comma', () => {
  // Real row: The Atlantis has a city but no state.
  const url = venueMapsUrl({ venuename: 'The Atlantis', city: 'Washington, D.C.', state: '' });
  assert.equal(query(url), 'The Atlantis, Washington, D.C.');
  assert.ok(!query(url).endsWith(','));
});

test('missing city AND state falls back to the venue name alone', () => {
  // Real row: Jamburg has neither.
  const url = venueMapsUrl({ venuename: 'Jamburg', city: '', state: '' });
  assert.equal(query(url), 'Jamburg');
});

test('absent keys behave like blank ones', () => {
  assert.equal(query(venueMapsUrl({ venuename: 'Somewhere' })), 'Somewhere');
});

test('a blank or whitespace name returns null, never a search for nothing', () => {
  assert.equal(venueMapsUrl({ venuename: '', city: 'Boston', state: 'MA' }), null);
  assert.equal(venueMapsUrl({ venuename: '   ', city: 'Boston', state: 'MA' }), null);
  assert.equal(venueMapsUrl({}), null);
  assert.equal(venueMapsUrl(null), null);
  assert.equal(venueMapsUrl(undefined), null);
});

test('placeholder names return null', () => {
  for (const name of ['Unknown', 'unknown venue', 'TBD', 'TBA', 'N/A', 'NA', 'none', '-', '???']) {
    assert.equal(
      venueMapsUrl({ venuename: name, city: 'Boston', state: 'MA' }),
      null,
      `${JSON.stringify(name)} should not produce a link`,
    );
  }
});

test('a real name that merely contains a placeholder word still links', () => {
  // Guard against over-matching: these are legitimate venues.
  assert.ok(venueMapsUrl({ venuename: 'The Unknown Bar', city: 'Austin', state: 'TX' }));
  assert.ok(venueMapsUrl({ venuename: 'Nonesuch Hall', city: 'Portland', state: 'ME' }));
});

test('the URL uses the config base and the documented key-less form', () => {
  const url = venueMapsUrl({ venuename: 'Ocean Mist', city: 'South Kingstown', state: 'RI' });
  assert.ok(url.startsWith(MAPS_SEARCH_BASE));
  assert.ok(url.includes('api=1'), 'must use the key-less search form');
});
