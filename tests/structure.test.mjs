// Run: node --test
//
// The compact set-structure badge.
//
// "Set 1 + Set 2 + Encore" was eating most of a Shows row and pushing venue
// names into ellipsis, and the venue is what the row is scanned for.
//
// THE FIXTURES BELOW ARE THE NINE STRUCTURES THAT ACTUALLY OCCUR, measured
// against the live archive on 2026-08-27 across all 610 shows with setlists --
// not the five that are obvious. Four of them are easy to miss: "Set 1 + Set 2"
// with no encore (17 shows), "Set 1 + Set 2 + Set 3" (4), "Set 1 + Set 2 +
// Set 3 + Encore" (1) and "Set 1 + Encore + Encore 2" (1). Set 3 and Encore 2
// both exist in the data.

import test from 'node:test';
import assert from 'node:assert/strict';
import { setLabel, shortSetLabel } from '../src/data/index.js';

/** [structure as setLabel() produces it, expected short form, shows observed] */
const OBSERVED = [
  ['Set 1', 'S1', 192],
  ['Set 1 + Set 2 + Encore', 'S1+S2+E', 174],
  ['One Set', 'One set', 100],
  ['One Set + Encore', 'One set+E', 74],
  ['Set 1 + Encore', 'S1+E', 47],
  ['Set 1 + Set 2', 'S1+S2', 17],
  ['Set 1 + Set 2 + Set 3', 'S1+S2+S3', 4],
  ['Set 1 + Encore + Encore 2', 'S1+E+E2', 1],
  ['Set 1 + Set 2 + Set 3 + Encore', 'S1+S2+S3+E', 1],
];

const shorten = (structure) => structure.split(' + ').map(shortSetLabel).join('+');

test('every structure that occurs in the archive maps as intended', () => {
  for (const [full, want] of OBSERVED) {
    assert.equal(shorten(full), want, `${JSON.stringify(full)} should shorten to ${JSON.stringify(want)}`);
  }
});

test('ONE SET NEVER COLLAPSES INTO SET 1', () => {
  // The hard requirement. 1493 setlist rows are "One Set" against 3031
  // "Set 1", and a festival one-set opener is a different pick from a two-set
  // show's opener. An abbreviation that blurred them would be wrong however
  // short it was.
  const one = shortSetLabel('One Set');
  const s1 = shortSetLabel('Set 1');
  assert.notEqual(one, s1);

  // Stronger than "not equal", and specific about WHY. `S1` vs `1 set` would
  // pass a naive inequality check while putting a digit in both -- and the
  // digit is the character the eye grabs scanning a dense list of badges. The
  // one-set form therefore carries NO digit at all, which is the whole reason
  // it is spelled with a word.
  //
  // An earlier version of this asserted the two share no character whatsoever.
  // That failed on "s", which both forms contain because both mean *set* --
  // unavoidable for any sane abbreviation, and not the confusion that matters.
  assert.match(s1, /\d/, 'the numbered-set form should carry its number');
  assert.doesNotMatch(one, /\d/, `"${one}" contains a digit, which is what makes it confusable with "${s1}"`);

  // The rejected alternative, asserted so the reasoning cannot quietly rot:
  // "1 set" satisfies inequality and fails the property above.
  assert.match('1 set', /\d/, 'sanity: the rejected form is the one with a digit');
});

test('the whole structure is shorter than what it replaced', () => {
  // The point of the change. Checked per structure rather than on a total, so
  // a mapping that shortened the common case while lengthening a rare one
  // could not hide inside an average.
  for (const [full, want] of OBSERVED) {
    assert.ok(want.length <= full.length, `${JSON.stringify(want)} is not shorter than ${JSON.stringify(full)}`);
  }
  const worst = OBSERVED.reduce((m, [, w]) => Math.max(m, w.length), 0);
  assert.ok(worst <= 10, `worst-case badge is ${worst} characters`);
});

test('each label shortens on its own, so an unseen combination still composes', () => {
  // Mapping whole structure strings would cover today's nine and produce
  // nothing for a tenth. These are the labels setLabel() can emit.
  assert.equal(shortSetLabel('Set 1'), 'S1');
  assert.equal(shortSetLabel('Set 2'), 'S2');
  assert.equal(shortSetLabel('Set 3'), 'S3');
  assert.equal(shortSetLabel('Set 4'), 'S4', 'a fourth set has not occurred but must not break');
  assert.equal(shortSetLabel('Encore'), 'E');
  assert.equal(shortSetLabel('Encore 2'), 'E2');
  assert.equal(shortSetLabel('One Set'), 'One set');
});

test('an unrecognised label passes through rather than being mangled', () => {
  // A badge that is too long is a layout problem. A badge that is confidently
  // wrong is a data problem, and the second is worse.
  assert.equal(shortSetLabel('Soundcheck'), 'Soundcheck');
  assert.equal(shortSetLabel(''), '');
});

test('shortSetLabel covers everything setLabel can produce', () => {
  // Derived from setLabel rather than listed, so a new branch there cannot
  // quietly start emitting something this does not handle. The settype and
  // setnumber values are the distinct ones observed in the archive.
  const SETTYPES = ['Set', 'One Set'];
  const SETNUMBERS = ['1', '2', '3', 'e', 'e2'];
  const unhandled = [];
  for (const t of SETTYPES) {
    for (const n of SETNUMBERS) {
      const label = setLabel(t, n);
      const short = shortSetLabel(label);
      // "Handled" means it actually changed, or it is the one label that is
      // deliberately left as a word.
      if (short === label && label !== 'One set' && label !== 'One Set') {
        unhandled.push(`${t}/${n} -> ${JSON.stringify(label)}`);
      }
    }
  }
  assert.deepEqual(unhandled, [], 'setLabel emits these and shortSetLabel does not shorten them');
});
