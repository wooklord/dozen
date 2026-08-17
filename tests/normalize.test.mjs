// Run: node --test
//
// Every value below is a REAL string observed in the live Carton data on
// 2026-08-17, not an invented case. The apostrophe tests are the important
// ones: U+2019 and U+0027 both occur in the same field in the same dataset,
// and case-folding alone missing that is a known live-bug class.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSongName,
  stripParenthetical,
  decodeEntities,
  cleanDisplayText,
} from '../src/data/normalize.js';

test('the apostrophe bug: U+2019 and U+0027 must produce the same key', () => {
  // "A Moment’s Notice" ships with U+2019 in the real data.
  const curly = 'A Moment’s Notice';
  const straight = "A Moment's Notice";
  assert.equal(curly.includes('’'), true, 'fixture must use a curly apostrophe');
  assert.equal(normalizeSongName(curly), normalizeSongName(straight));
  // ...and case-folding alone would NOT have been enough:
  assert.notEqual(curly.toLowerCase(), straight.toLowerCase());
});

test('every real curly-apostrophe song name matches its straight-quote spelling', () => {
  const pairs = [
    ['I’ll Take A Melody', "I'll Take A Melody"],
    ['Ain’t No Bread In The Breadbox', "Ain't No Bread In The Breadbox"],
    ['The Shape I’m In', "The Shape I'm In"],
    ['Feelin’ Alright', "Feelin' Alright"],
    ['Jumpin’ Jack Flash', "Jumpin' Jack Flash"],
    ['I’m Coming Out', "I'm Coming Out"],
    ['Reelin’ In The Years', "Reelin' In The Years"],
  ];
  for (const [curly, straight] of pairs) {
    assert.equal(normalizeSongName(curly), normalizeSongName(straight), `${curly} != ${straight}`);
  }
});

test('straight-apostrophe names from the same dataset still normalize', () => {
  // These use U+0027 in the live data, unlike the ones above.
  assert.equal(normalizeSongName("Hux (Wit' It)"), normalizeSongName('Hux (Wit’ It)'));
  assert.equal(normalizeSongName("I Was Born (No I Wasn't)"), normalizeSongName('I Was Born (No I Wasn’t)'));
  assert.equal(
    normalizeSongName("Saturday Night's Alright (For Fighting)"),
    normalizeSongName('Saturday Night’s Alright (For Fighting)'),
  );
});

test('trailing punctuation is ignored', () => {
  assert.equal(normalizeSongName('Yuck!'), normalizeSongName('Yuck'));
  assert.equal(normalizeSongName('Yuck!'), 'yuck');
});

test('NUMBERED VARIANTS STAY DISTINCT', () => {
  // The single most dangerous over-normalization: these are different songs.
  assert.notEqual(
    normalizeSongName('Burritos El Chavo 2'),
    normalizeSongName('Burritos El Chavo'),
  );
  assert.equal(normalizeSongName('Burritos El Chavo 2'), 'burritos el chavo 2');
});

test('short alphanumeric names survive intact', () => {
  assert.equal(normalizeSongName('B7'), 'b7');
  assert.notEqual(normalizeSongName('B7'), normalizeSongName('B'));
  assert.equal(normalizeSongName('12 Pounds of Pain'), '12 pounds of pain');
});

test('parentheticals are part of the name and are KEPT by default', () => {
  assert.equal(normalizeSongName('Silver Steed (My Blue)'), 'silver steed (my blue)');
  assert.notEqual(
    normalizeSongName('Silver Steed (My Blue)'),
    normalizeSongName('Silver Steed'),
  );
  // Real parenthetical names that must not collapse into each other:
  const names = [
    'All The Way Down (Shadow Pt. 2)',
    'Pigs (Three Different Ones)',
    'Brooklyn (Owes The Charmer Under Me)',
    'Man Smart (Woman Smarter)',
    'Sweet Harriet (Shabuzen Tonight)',
    "Rocket Man (I Think It's Going To Be A Long, Long Time)",
  ];
  const keys = names.map(normalizeSongName);
  assert.equal(new Set(keys).size, names.length, 'parenthetical names collapsed together');
});

test('stripParenthetical is opt-in and does not fire by default', () => {
  assert.equal(stripParenthetical('Silver Steed (My Blue)'), 'silver steed');
  assert.equal(stripParenthetical('Hux (Wit’ It)'), 'hux');
  // Never returns empty for a name that is entirely parenthetical.
  assert.equal(stripParenthetical('(Reprise)'), '(reprise)');
});

test('case, whitespace and diacritics fold', () => {
  assert.equal(normalizeSongName('  YUCK!  '), 'yuck');
  assert.equal(normalizeSongName('Silver   Steed'), 'silver steed');
  assert.equal(normalizeSongName('Café'), normalizeSongName('Cafe'));
});

test('ampersand and "and" agree', () => {
  assert.equal(normalizeSongName('Blues & Brews'), normalizeSongName('Blues and Brews'));
});

test('null and undefined are safe', () => {
  assert.equal(normalizeSongName(null), '');
  assert.equal(normalizeSongName(undefined), '');
  assert.equal(normalizeSongName(''), '');
  assert.equal(decodeEntities(null), '');
});

test('HTML entities decode -- real values from the shows method', () => {
  assert.equal(decodeEntities('Annabel&#039;s'), "Annabel's");
  assert.equal(decodeEntities('Telluride Blues &amp; Brews Festival'), 'Telluride Blues & Brews Festival');
  assert.equal(decodeEntities('Toad&apos;s Place'), "Toad's Place");
  assert.equal(decodeEntities('&#x27;'), "'");
  assert.equal(decodeEntities('plain text'), 'plain text');
  // Unknown entities are left alone rather than mangled.
  assert.equal(decodeEntities('A &nonsense; B'), 'A &nonsense; B');
});

test('entity-encoded and raw venue names converge -- the cross-method hazard', () => {
  // `shows` gives "Annabel&#039;s"; `setlists` gives "Annabel's".
  assert.equal(cleanDisplayText('Annabel&#039;s'), cleanDisplayText("Annabel's"));
  assert.equal(
    normalizeSongName('Telluride Blues &amp; Brews Festival'),
    normalizeSongName('Telluride Blues & Brews Festival'),
  );
});

test('entity decoding happens before normalization, not after', () => {
  // If decode ran after punctuation-stripping, "&#039;" would leave "039".
  assert.equal(normalizeSongName('Annabel&#039;s'), 'annabels');
  assert.ok(!normalizeSongName('Annabel&#039;s').includes('039'));
});

test('display text keeps case and punctuation, collapses whitespace only', () => {
  assert.equal(cleanDisplayText('  Toad&apos;s   Place '), "Toad's Place");
  assert.equal(cleanDisplayText('Yuck!'), 'Yuck!');
});

test('normalization is idempotent', () => {
  const samples = ['A Moment’s Notice', 'Yuck!', 'Burritos El Chavo 2', 'Hux (Wit\' It)', 'B7'];
  for (const s of samples) {
    const once = normalizeSongName(s);
    assert.equal(normalizeSongName(once), once, `not idempotent: ${s}`);
  }
});

test('distinct real song names never collide', () => {
  // Guards against an over-aggressive normalizer merging the catalog.
  const names = [
    '12 Pounds of Pain', 'B7', 'Yuck!', 'Burritos El Chavo', 'Burritos El Chavo 2',
    'Silver Steed (My Blue)', 'Silver Steed', 'A Moment’s Notice', 'Hux (Wit\' It)',
    'All The Way Down (Shadow Pt. 2)', 'I’ll Take A Melody', 'The Shape I’m In',
    'Pigs (Three Different Ones)', 'Man Smart (Woman Smarter)', 'Feelin’ Alright',
  ];
  const keys = names.map(normalizeSongName);
  assert.equal(new Set(keys).size, names.length, 'two distinct song names produced the same key');
  assert.ok(keys.every((k) => k.length > 0), 'a real song name normalized to empty');
});
