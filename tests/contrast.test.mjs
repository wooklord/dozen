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
import {
  readPalette, audit, ratio, r2, bStar, deltaE, PAIRS,
  deriveRulePairs, tokensUsedByRules, KNOWN_GAPS, composite,
} from '../scripts/contrast.mjs';

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
  // A floor, and a weak one, kept only for the four tokens that have actually
  // moved. It asserts a token appears as SOME foreground, so dropping
  // `jam on surface-up` while keeping `jam on shell` passes it -- its own
  // comment conceded that and nothing acted on it for several builds.
  //
  // THE REAL COVERAGE CHECK IS "EVERY TOKEN A RULE USES IS AUDITED SOMEWHERE"
  // below, which reads the stylesheet instead of this list. This one now only
  // guards the case that check cannot see: a token still painted by a rule,
  // still technically audited, but audited on fewer grounds than before.
  for (const fg of ['jam', 'yolk', 'btn-line', 'ink-faint']) {
    assert.ok(PAIRS.some((p) => p.fg === fg), `${fg} is no longer audited`);
  }
});

// --- CIEDE2000, validated against published data ----------------------------
//
// deltaE00 decides a real design question (see docs/design.md): it is the
// metric that says whether the jam colour separates from the body text beside
// it. A wrong implementation would answer that question confidently and
// incorrectly, so it is checked against Sharma, Wu & Dalal (2005) Table 1
// rather than against itself.
//
// These pairs are chosen from that table for the cases that catch the usual
// implementation mistakes: hue-angle wrapping across 0/360, the Rt rotation
// term in the blue region, and the chroma-dependent G factor.
//
// One further pair from the table (L*35 greens) is deliberately NOT included:
// the implementation and an independent hand-derivation both give 1.8645 for
// it, and the published figure could not be confirmed with enough confidence
// to assert against. Recording an unverified number as "published data" would
// make this file lie about what it proves. Nineteen pairs still pin every
// branch of the formula.
import { deltaE00Lab } from '../scripts/contrast.mjs';

const SHARMA = [
  [[50.0000, 2.6772, -79.7751], [50.0000, 0.0000, -82.7485], 2.0425],
  [[50.0000, 3.1571, -77.2803], [50.0000, 0.0000, -82.7485], 2.8615],
  [[50.0000, 2.8361, -74.0200], [50.0000, 0.0000, -82.7485], 3.4412],
  [[50.0000, -1.3802, -84.2814], [50.0000, 0.0000, -82.7485], 1.0000],
  [[50.0000, -1.1848, -84.8006], [50.0000, 0.0000, -82.7485], 1.0000],
  [[50.0000, -0.9009, -85.5211], [50.0000, 0.0000, -82.7485], 1.0000],
  [[50.0000, 0.0000, 0.0000], [50.0000, -1.0000, 2.0000], 2.3669],
  [[50.0000, -1.0000, 2.0000], [50.0000, 0.0000, 0.0000], 2.3669],
  [[50.0000, 2.4900, -0.0010], [50.0000, -2.4900, 0.0009], 7.1792],
  [[50.0000, 2.4900, -0.0010], [50.0000, -2.4900, 0.0011], 7.2195],
  [[50.0000, -0.0010, 2.4900], [50.0000, 0.0009, -2.4900], 4.8045],
  [[50.0000, 2.5000, 0.0000], [50.0000, 0.0000, -2.5000], 4.3065],
  [[50.0000, 2.5000, 0.0000], [73.0000, 25.0000, -18.0000], 27.1492],
  [[50.0000, 2.5000, 0.0000], [50.0000, 3.1736, 0.5854], 1.0000],
  [[50.0000, 2.5000, 0.0000], [50.0000, 3.2972, 0.0000], 1.0000],
  [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  [[63.0109, -31.0961, -5.8663], [62.8187, -29.7946, -4.0864], 1.2630],
  [[22.7233, 20.0904, -46.6940], [23.0331, 14.9730, -42.5619], 2.0373],
  [[2.0776, 0.0795, -1.1350], [0.9033, -0.0636, -0.5514], 0.9082],
];

test('CIEDE2000 matches Sharma, Wu & Dalal (2005) test data', () => {
  const wrong = [];
  for (const [a, b, want] of SHARMA) {
    const got = deltaE00Lab(a, b);
    if (Math.abs(got - want) > 0.01) wrong.push(`${JSON.stringify(a)} vs ${JSON.stringify(b)}: got ${got}, expected ${want}`);
  }
  assert.deepEqual(wrong, [], 'CIEDE2000 implementation disagrees with published values');
});

test('CIEDE2000 is symmetric', () => {
  for (const [a, b] of SHARMA) {
    assert.equal(deltaE00Lab(a, b), deltaE00Lab(b, a));
  }
});

// --- the half that comes out of the stylesheet ------------------------------
//
// PAIRS pairs TOKEN NAMES, and its `where` field is prose. Nothing tied
// `{ fg: 'chip-sel-ink', bg: 'chip-sel-fill' }` to the rule that renders it, so
// a rule could switch which token it used and every listed pair stayed green --
// the palette had not moved. The list was checking the palette while claiming
// to check the app.
//
// A rule that sets BOTH a foreground and a background is a complete pair with
// no DOM involved, and that subset is now derived and measured as written.
// Text on an ANCESTOR's background still needs the DOM and stays in PAIRS;
// scripts/smoke.mjs measures those against the rendered page.

test('EVERY SAME-RULE PAIR IN app.css CLEARS ITS THRESHOLD', () => {
  const { pairs } = deriveRulePairs();
  // A derivation that found nothing would pass this vacuously, and a parser
  // returning [] is far likelier than the stylesheet losing every rule that
  // sets a colour on a background.
  assert.ok(pairs.length >= 12, `only ${pairs.length} same-rule pairs derived; the parse is broken`);

  const palette = readPalette();
  const bad = [];
  for (const p of pairs) {
    for (const theme of ['dk', 'lt']) {
      const v = r2(palette[theme][p.fg], palette[theme][p.bg]);
      if (v < p.min) bad.push(`${theme} ${p.where}: ${p.fg} on ${p.bg} = ${v}:1 (min ${p.min})`);
    }
  }
  assert.deepEqual(bad, []);
});

test('the derivation actually reaches the rules it claims to', () => {
  // Named rules rather than a count: a refactor that stopped matching
  // attribute selectors, or `border` shorthand, would drop pairs silently and
  // the threshold test above would keep passing on the smaller set.
  const { pairs } = deriveRulePairs();
  const seen = pairs.map((p) => p.where);
  for (const want of [
    '.chip[aria-pressed="true"] { color }',      // attribute selector
    '.chip[aria-pressed="true"] { border-color }',
    '.btn { border-color }',                      // `border:` shorthand
    '.btn-accent { color }',                      // the inverted pair
  ]) {
    assert.ok(seen.includes(want), `derivation no longer reaches ${want}`);
  }
});

test('EVERY TOKEN A RULE USES IS AUDITED SOMEWHERE', () => {
  // The real answer to "a rule could switch tokens and stay green". If a rule
  // starts painting with a token that appears in no pair -- listed or derived
  // -- it is unmeasured, and this is the only check that would notice.
  const used = tokensUsedByRules();
  const { pairs } = deriveRulePairs();
  // KNOWN_GAPS counts as ACCOUNTED FOR, not as passing. A measured shortfall
  // somebody has written down and deferred is a different state from a token
  // nobody has ever looked at, and this check is about the second. The gaps
  // are reported by the CLI every run and carry their own numbers; failing
  // here for one would make the suite red for an open decision, which trains
  // people to ignore red. Their tokens are declared as fields precisely so
  // this can tell the two states apart.
  const auditedFg = new Set([...PAIRS.map((p) => p.fg), ...pairs.map((p) => p.fg), ...KNOWN_GAPS.map((g) => g.fg)]);
  const auditedBg = new Set([...PAIRS.map((p) => p.bg), ...pairs.map((p) => p.bg), ...KNOWN_GAPS.map((g) => g.bg)]);

  // A translucent ground that flattens to one already audited. --shell-alpha
  // is the shell colour at .86 OVER the shell, so it composites back to
  // exactly --shell and everything in the header is measured by the `bg:
  // shell` pairs. An alias, not an exemption -- the pair is really checked.
  const GROUND_ALIAS = { 'shell-alpha': 'shell' };

  // Grounds that carry no text, named by SELECTOR rather than by token, so
  // exempting the grip cannot also exempt a future rule that puts text on a
  // --line background. Each needs a reason.
  const NO_TEXT_ON_IT = {
    '.sheet-grip': 'a 4px drag handle; nothing renders on top of it',
  };

  // Tokens that are not a colour on a ground at all.
  const NOT_A_COLOUR_PAIR = new Set([
    'jam-weight',   // a font-weight
    'heat-floor',   // an opacity
    'scrim',        // a full-screen overlay whose job is to obscure
    'shadow-up', 'shadow-sheet', 'cell-inset',
  ]);

  const unaudited = [];
  for (const [token, selector] of used.color) {
    if (NOT_A_COLOUR_PAIR.has(token)) continue;
    if (!auditedFg.has(token)) unaudited.push(`color --${token} (${selector})`);
  }
  for (const [token, selector] of used.background) {
    if (NOT_A_COLOUR_PAIR.has(token)) continue;
    if (NO_TEXT_ON_IT[selector]) continue;
    const resolved = GROUND_ALIAS[token] || token;
    if (!auditedBg.has(resolved)) unaudited.push(`background --${token} (${selector})`);
  }
  assert.deepEqual(unaudited, [], 'these tokens are painted by a rule but appear in no measured pair');
});

test('every KNOWN_GAP names real tokens', () => {
  // The gaps are consulted by the coverage check above, so a typo in one would
  // silently exempt nothing and quietly re-open a hole. They also have to stay
  // measurable: a gap naming a token that has been removed is a record of a
  // problem that no longer exists, which is the stalest kind of record.
  const p = readPalette();
  for (const g of KNOWN_GAPS) {
    assert.ok(g.fg && g.bg, `KNOWN_GAP "${g.what}" has no fg/bg tokens`);
    for (const t of [g.fg, g.bg]) {
      assert.ok(p.dk[t] && p.lt[t], `KNOWN_GAP "${g.what}" names --${t}, which is not in tokens.css`);
    }
  }
});

test('a KNOWN_GAP that has started passing is reported, not left in the list', () => {
  // "Not yet fixed" has to keep being true. A gap that a palette retune
  // silently fixed would sit here forever describing a problem nobody has,
  // and the CLI would go on printing it as an open decision.
  const p = readPalette();
  const nowPassing = KNOWN_GAPS.filter((g) => {
    // `min` is REQUIRED, not defaulted. The first version of this defaulted to
    // 3, so the 4.00:1 --ink-faint TEXT gap -- which needs 4.5 -- came back as
    // "now passing" and would have been moved into PAIRS, where it would have
    // failed the threshold test for real. A default here is an invented
    // threshold, which is the thing this whole file exists to avoid.
    assert.ok(typeof g.min === 'number', `KNOWN_GAP "${g.what}" has no min; it cannot be judged`);
    const min = g.min;
    return ['dk', 'lt'].every((t) => {
      const bg = String(p[t][g.bg]).startsWith('#') ? p[t][g.bg] : composite(p[t][g.bg], p[t].surface);
      const fg = String(p[t][g.fg]).startsWith('#') ? p[t][g.fg] : composite(p[t][g.fg], bg);
      return r2(fg, bg) >= min;
    });
  });
  assert.deepEqual(nowPassing.map((g) => g.what), [], 'these KNOWN_GAPS now clear their threshold — move them into PAIRS');
});
