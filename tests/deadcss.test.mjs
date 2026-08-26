// Run: node --test
//
// The dead-declaration audit, as a test rather than a thing someone remembers
// to run. Three rules in app.css have been entirely inert -- .btn-small,
// .sortbar-secondary and .chip-quiet -- and each was found by a human reading
// the file, months apart. Three instances of one mistake is a missing check.
//
// See scripts/deadcss.mjs for what "dead" means here and why the scope is
// narrow.

import test from 'node:test';
import assert from 'node:assert/strict';
import { findDead, readClassSets, parseRules, pureClassChain, expand } from '../scripts/deadcss.mjs';

test('the stylesheet parses into rules', () => {
  // An empty parse would make every declaration "live" and the audit below
  // would pass by finding nothing -- the check would be green because it never
  // ran. Same trap as an empty palette in tests/contrast.test.mjs.
  const rules = parseRules('.a { color: red } .b, .c { top: 0; padding: 1px }');
  assert.equal(rules.length, 3);
  assert.equal(rules[0].decls.get('color'), 'red');
  assert.equal(rules[2].selector, '.c');
  assert.equal(rules[2].decls.get('padding'), '1px');
});

test('at-rule bodies are skipped, not flattened', () => {
  // A declaration inside @media is conditional. Calling it dead because an
  // unconditional rule beats it would be wrong exactly where it matters --
  // which is the whole light/dark token mapping.
  const rules = parseRules('@media (x) { .a { color: red } } .b { top: 0 }');
  assert.deepEqual(rules.map((r) => r.selector), ['.b']);
});

test('only plain class chains are considered', () => {
  assert.deepEqual(pureClassChain('.chip.chip-quiet'), ['chip', 'chip-quiet']);
  assert.equal(pureClassChain('.chip[aria-pressed="true"]'), null);
  assert.equal(pureClassChain('.chip::after'), null);
  assert.equal(pureClassChain('.row-main > .venue-line'), null);
  assert.equal(pureClassChain('button.fn-marker'), null);
});

test('shorthands are known to reset their longhands', () => {
  // .sortbar's `padding` shorthand is what killed .sortbar-secondary's
  // `padding-top`. Without this the audit would have missed two of the four.
  assert.ok(expand('padding').includes('padding-top'));
  assert.ok(expand('margin').includes('margin-bottom'));
  assert.ok(expand('font').includes('font-weight'));
});

test('class combinations are readable from the source', () => {
  // If this came back empty every rule would be judged against nothing and
  // reported as live. The audit would then be permanently, silently green.
  const sets = readClassSets();
  assert.ok(sets.length > 100, `only ${sets.length} class combinations found in src/`);
  const joined = sets.map((s) => s.classes.join('.'));
  assert.ok(joined.includes('chip.chip-quiet'), 'the Songs filter chip should be readable');
  assert.ok(joined.includes('sortbar.sortbar-secondary'), 'the secondary bar should be readable');
});

test('NO DECLARATION IN app.css IS DEAD', () => {
  const dead = findDead();
  assert.deepEqual(
    dead.map((d) => `${d.selector} { ${d.prop} } beaten by ${d.beatenBy.join(', ')}`),
    [],
    'these declarations can never take effect on any element that carries them',
  );
});
