// Run: node --test
//
// Search matching. Deterministic, no relevance scoring -- these tests pin the
// exact behaviour asked for: typing without the apostrophe, and searching a
// mid-title word without leading with the article.

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSongName, normalizeQuery, matchesQuery } from '../src/data/normalize.js';

/** Helper mirroring how the Songs view filters. */
function search(query, names) {
  const q = normalizeQuery(query);
  return names.filter((n) => matchesQuery(normalizeSongName(n), q));
}

// Real names from the live archive.
const CATALOG = [
  'A Moment’s Notice',
  'Moments Passed',
  'The Shape I’m In',
  'Shatter',
  'Shallow Rivers',
  'Burritos El Chavo',
  'Burritos El Chavo 2',
  'Silver Steed (My Blue)',
  "Hux (Wit' It)",
  'Yuck!',
  'B7',
  '12 Pounds of Pain',
  'I’ll Take A Melody',
  'Here Comes Sunshine',
];

test('typing without the apostrophe finds the song', () => {
  const hits = search('moments notice', CATALOG);
  assert.ok(hits.includes('A Moment’s Notice'), 'should find A Moment’s Notice');
});

test('every apostrophe spelling of the query works identically', () => {
  for (const q of ["a moment's notice", 'a moment’s notice', 'a moments notice', 'A MOMENTS NOTICE']) {
    assert.ok(search(q, CATALOG).includes('A Moment’s Notice'), `failed for ${q}`);
  }
});

test('a mid-title word finds the song without leading with the article', () => {
  const hits = search('shape', CATALOG);
  assert.ok(hits.includes('The Shape I’m In'), 'should find The Shape I’m In');
});

test('multi-token queries match out of order and across the title', () => {
  assert.ok(search('shape in', CATALOG).includes('The Shape I’m In'));
  assert.ok(search('in shape', CATALOG).includes('The Shape I’m In'));
  assert.ok(search('melody take', CATALOG).includes('I’ll Take A Melody'));
});

test('numbered variants both appear, and the exact one is reachable', () => {
  const both = search('burritos', CATALOG);
  assert.ok(both.includes('Burritos El Chavo'), 'base missing');
  assert.ok(both.includes('Burritos El Chavo 2'), 'numbered variant missing');

  // The exact numbered query must not match the base song.
  const exact = search('burritos el chavo 2', CATALOG);
  assert.deepEqual(exact, ['Burritos El Chavo 2']);
});

test('parenthetical contents are searchable', () => {
  assert.ok(search('my blue', CATALOG).includes('Silver Steed (My Blue)'));
  assert.ok(search('wit it', CATALOG).includes("Hux (Wit' It)"));
});

test('trailing punctuation in the catalog does not block a match', () => {
  assert.deepEqual(search('yuck', CATALOG), ['Yuck!']);
});

test('short and numeric names are findable and do not over-match', () => {
  assert.ok(search('b7', CATALOG).includes('B7'));
  assert.ok(search('12 pounds', CATALOG).includes('12 Pounds of Pain'));
});

test('an empty query returns everything', () => {
  assert.equal(search('', CATALOG).length, CATALOG.length);
  assert.equal(search('   ', CATALOG).length, CATALOG.length);
});

test('a query matching nothing returns nothing', () => {
  assert.deepEqual(search('zzzzz not a song', CATALOG), []);
});

test('single-token queries require a real substring, not scattered letters', () => {
  // "shtr" must NOT match "Shatter" -- there is no fuzzy matching.
  assert.deepEqual(search('shtr', CATALOG), []);
});

test('substring matching is prefix-independent', () => {
  // "sha" hits several; all are genuine substrings.
  const hits = search('sha', CATALOG);
  assert.ok(hits.includes('Shatter'));
  assert.ok(hits.includes('Shallow Rivers'));
  assert.ok(hits.includes('The Shape I’m In'));
  for (const h of hits) assert.ok(normalizeSongName(h).includes('sha'));
});

test('matchesQuery works directly on pre-normalized keys', () => {
  assert.equal(matchesQuery(normalizeSongName('Yuck!'), normalizeQuery('yuck')), true);
  assert.equal(matchesQuery('', 'anything'), false);
  assert.equal(matchesQuery('anything', ''), true);
});
