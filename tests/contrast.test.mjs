// Run: node --test
//
// The palette audit, as a test rather than a thing someone remembers to run.
//
// docs/design.md told people to "re-run scratchpad/contrast.mjs after any
// palette change" for twenty-two builds. That file was not in the repo, so the
// instruction was unfollowable and the audit only ever happened when somebody
// rebuilt the script by hand. Contrast is measured from tokens.css here, on
// every `node --test`, with no network and no browser.
//
// Every hex comes OUT of src/styles/tokens.css. Nothing in this file restates a
// palette value, because a copy would keep passing after the stylesheet moved
// on -- it would be measuring colours the app no longer uses.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readPalette, audit, ratio, r2, bStar, deltaE, PAIRS } from '../scripts/contrast.mjs';

test('the palette parses out of tokens.css', () => {
  const p = readPalette();
  // Both themes must be present and non-trivial. A regex that silently matched
  // nothing would make every pair "missing" and the suite would still be green
  // if the audit skipped absent tokens -- it does not, but the parse is
  // asserted here so the failure is legible rather than mysterious.
  assert.ok(Object.keys(p.dk).length >= 15, `dark palette looks short: ${Object.keys(p.dk).length}`);
  assert.ok(Object.keys(p.lt).length >= 15, `light palette looks short: ${Object.keys(p.lt).length}`);
  for (const t of ['shell', 'surface', 'surface-up', 'ink', 'yolk', 'jam', 'btn-line']) {
    assert.ok(p.dk[t], `--dk-${t} missing`);
    assert.ok(p.lt[t], `--lt-${t} missing`);
  }
});

test('every documented pair is actually measurable', () => {
  // A pair naming a token that no longer exists would otherwise be skipped and
  // quietly stop being checked -- the exact way a check dies without anyone
  // noticing it died.
  const missing = audit().filter((r) => r.missing);
  assert.deepEqual(
    missing.map((r) => `${r.theme}: ${r.fg} on ${r.bg}`),
    [],
    'PAIRS names a token that is not in tokens.css',
  );
});

test('EVERY PAIR CLEARS ITS WCAG THRESHOLD, both themes', () => {
  const bad = audit().filter((r) => !r.pass);
  assert.deepEqual(
    bad.map((r) => `${r.theme} ${r.fg} on ${r.bg} = ${r.value}:1 (min ${r.min}) — ${r.where}`),
    [],
  );
});

test('the two themes do not share a hex where they must not', () => {
  // Stated in tokens.css and in docs/design.md: yolk and jam are tuned per
  // theme because equally READABLE is not the same as identical. A palette
  // edit that copied one into the other would pass the threshold test above
  // while undoing a deliberate decision.
  const p = readPalette();
  for (const t of ['yolk', 'jam']) {
    assert.notEqual(p.dk[t], p.lt[t], `--dk-${t} and --lt-${t} are the same hex`);
  }
});

test('the jam colour stays inside its documented warmth band', () => {
  // b* 15-24. Below it the colour reads as the one cold thing on a palette
  // where every token leans yellow; above it, it stops being a green and
  // starts competing with yolk. Both failures were rendered and rejected --
  // see docs/design.md. The band is the part worth enforcing; the exact hex
  // is not.
  const p = readPalette();
  for (const theme of ['dk', 'lt']) {
    const b = bStar(p[theme].jam);
    assert.ok(b >= 15 && b <= 24, `--${theme}-jam b* is ${b}, outside the documented 15-24 band`);
  }
});

test('the jam colour stays clearly distinct from the accent', () => {
  // The whole point of a second colour is that it is not the first one.
  const p = readPalette();
  for (const theme of ['dk', 'lt']) {
    const d = deltaE(p[theme].jam, p[theme].yolk);
    assert.ok(d > 40, `--${theme}-jam is only deltaE ${d} from --${theme}-yolk`);
  }
});

// --- the maths itself, against values that cannot drift ---------------------

test('ratio() matches known WCAG figures', () => {
  // Black on white is exactly 21:1; a colour against itself is exactly 1:1.
  assert.equal(r2('#000000', '#ffffff'), 21);
  assert.equal(r2('#ffffff', '#ffffff'), 1);
  assert.equal(r2('#777777', '#ffffff'), 4.48); // the classic just-fails grey
  // Order must not matter.
  assert.equal(ratio('#8ace98', '#1c1815'), ratio('#1c1815', '#8ace98'));
});

test('hex shorthand and case are handled', () => {
  assert.equal(r2('#FFF', '#000'), 21);
  assert.equal(r2('#fff', '#000000'), 21);
});

test('b* separates warm from cool', () => {
  // Pure yellow is strongly positive, pure blue strongly negative. This is the
  // axis the jam colour was chosen on, so a sign error would silently invert
  // the band check above.
  assert.ok(bStar('#ffff00') > 90, 'yellow should be strongly warm');
  assert.ok(bStar('#0000ff') < -90, 'blue should be strongly cool');
});

test('PAIRS covers the tokens most likely to be retuned', () => {
  // Not a completeness proof -- it is a floor. jam, yolk, btn-line and
  // ink-faint are the four that have actually moved, and each has cost a
  // measurement round. If one drops out of PAIRS it stops being audited.
  for (const fg of ['jam', 'yolk', 'btn-line', 'ink-faint']) {
    assert.ok(PAIRS.some((p) => p.fg === fg), `${fg} is no longer audited`);
  }
});
