// Contrast measurement.  Run:  node scripts/contrast.mjs [fg bg]
//
// WHY THIS IS IN THE REPO
// docs/design.md has said "re-run scratchpad/contrast.mjs after any palette
// change" since 0.1.26. That file was never committed, so by the next session
// it did not exist and had to be rebuilt from scratch -- while the doc went on
// confidently pointing at it. A check that lives in scratch is written once and
// trusted forever; this one was neither maintained nor available.
//
// Two modes:
//   node scripts/contrast.mjs                 audit every documented pair
//   node scripts/contrast.mjs '#8ace98' '#1c1815'   measure one pair
//
// The audit reads its hexes OUT OF src/styles/tokens.css. Nothing here restates
// a palette value: a copy would drift from the stylesheet and start reporting
// the contrast of colours the app no longer uses.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRules } from './deadcss.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// --- WCAG relative luminance ------------------------------------------------

export function hex(h) {
  let s = String(h).trim().replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(s)) throw new Error(`not a hex colour: ${h}`);
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}

export function luminance([r, g, b]) {
  const f = (v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function ratio(a, b) {
  const [hi, lo] = [luminance(hex(a)), luminance(hex(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const r2 = (a, b) => Math.round(ratio(a, b) * 100) / 100;

// --- Lab, for the warm/cool axis --------------------------------------------
//
// b* is the yellow(+) / blue(-) axis. The jam colour was chosen on it: every
// token in this palette is warm, so a candidate's b* says whether it will read
// as part of the set or as the one cold thing on screen. See docs/design.md.

function srgbToLinear(v) {
  const x = v / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

export function lab(h) {
  const [r, g, b] = hex(h).map(srgbToLinear);
  let x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  let y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  let z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  [x, y, z] = [f(x), f(y), f(z)];
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

export const bStar = (h) => Math.round(lab(h)[2] * 10) / 10;

export function deltaE(a, b) {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.round(Math.hypot(l1 - l2, a1 - a2, b1 - b2) * 10) / 10;
}

/**
 * CIEDE2000 colour difference.
 *
 * USE THIS, NOT deltaE(), WHEN COMPARING TWO DARK COLOURS.
 *
 * Plain CIE76 deltaE treats a unit of Lab distance as equally visible
 * everywhere, which it is not. Between two dark colours it substantially
 * OVERSTATES the difference. That is not academic here: measured against the
 * body text beside it, the jam green scores deltaE76 42.7 in light and 40.3 in
 * dark -- predicting light mode separates BETTER, which is the opposite of what
 * the screen shows. CIEDE2000's lightness and chroma weighting is what fixes
 * that ordering.
 *
 * Implementation follows Sharma, Wu & Dalal (2005), including the hue-angle
 * wrapping the original paper leaves ambiguous. Validated against that paper's
 * test data in tests/contrast.test.mjs -- do not "simplify" it without running
 * those.
 */
export function deltaE00(c1, c2) {
  return deltaE00Lab(lab(c1), lab(c2));
}

/** CIEDE2000 on raw Lab triples, so it can be validated against published data. */
export function deltaE00Lab([L1, A1, B1], [L2, A2, B2]) {
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;

  const C1 = Math.hypot(A1, B1);
  const C2 = Math.hypot(A2, B2);
  const Cbar = (C1 + C2) / 2;
  const Cbar7 = Cbar ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 25 ** 7)));

  const a1p = (1 + G) * A1;
  const a2p = (1 + G) * A2;
  const C1p = Math.hypot(a1p, B1);
  const C2p = Math.hypot(a2p, B2);

  const hp = (b, ap) => {
    if (b === 0 && ap === 0) return 0;
    const h = Math.atan2(b, ap) * deg;
    return h >= 0 ? h : h + 360;
  };
  const h1p = hp(B1, a1p);
  const h2p = hp(B2, a2p);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  let dhp;
  if (C1p * C2p === 0) dhp = 0;
  else if (Math.abs(h2p - h1p) <= 180) dhp = h2p - h1p;
  else if (h2p - h1p > 180) dhp = h2p - h1p - 360;
  else dhp = h2p - h1p + 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);

  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;

  let hbarp;
  if (C1p * C2p === 0) hbarp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
  else if (h1p + h2p < 360) hbarp = (h1p + h2p + 360) / 2;
  else hbarp = (h1p + h2p - 360) / 2;

  const T = 1
    - 0.17 * Math.cos((hbarp - 30) * rad)
    + 0.24 * Math.cos(2 * hbarp * rad)
    + 0.32 * Math.cos((3 * hbarp + 6) * rad)
    - 0.20 * Math.cos((4 * hbarp - 63) * rad);

  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const Cbarp7 = Cbarp ** 7;
  const Rc = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbarp;
  const Sh = 1 + 0.015 * Cbarp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;

  const dE = Math.sqrt(
    (dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh),
  );
  return Math.round(dE * 100) / 100;
}

// --- Translucent colours ----------------------------------------------------
//
// Several tokens are rgba(): --yolk-line, --yolk-wash, --shell-alpha. A
// contrast figure for those is meaningless until they are composited onto
// whatever is behind them, and the answer changes depending on what that is.
// The pressed-chip border is translucent over a translucent wash over an
// opaque card, so it needs compositing twice.
//
// Source-over compositing, which is what the browser does:
//   result = fg * alpha + bg * (1 - alpha)
// Correct in sRGB byte space here because that is where the browser blends
// too; blending in linear light would give a different (and wrong) answer.

/** Parse `rgba(r, g, b, a)` or `rgb(r, g, b)` into [r, g, b, a]. */
export function rgba(value) {
  const m = String(value).match(/rgba?\(([^)]+)\)/i);
  if (!m) throw new Error(`not an rgb/rgba colour: ${value}`);
  const parts = m[1].split(',').map((x) => parseFloat(x.trim()));
  if (parts.length < 3) throw new Error(`malformed colour: ${value}`);
  return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
}

const toHex = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');

/**
 * Flatten a translucent colour onto an opaque one, returning an opaque hex.
 * `over` may itself be a hex or another rgba(), so calls can be nested.
 */
export function composite(fg, over) {
  const [fr, fg_, fb, fa] = typeof fg === 'string' && fg.startsWith('#')
    ? [...hex(fg), 1]
    : rgba(fg);
  const [br, bg_, bb] = typeof over === 'string' && over.startsWith('#') ? hex(over) : rgba(over);
  return '#' + [
    toHex(fr * fa + br * (1 - fa)),
    toHex(fg_ * fa + bg_ * (1 - fa)),
    toHex(fb * fa + bb * (1 - fa)),
  ].join('');
}

// --- Reading the palette out of tokens.css ----------------------------------

/**
 * Every `--dk-*` / `--lt-*` hex declared in tokens.css, as { dk: {...}, lt: {...} }.
 *
 * Parsed rather than restated. rgba() values are kept as written: the washes
 * and line tints are translucent, and a contrast figure for them is meaningless
 * until composite() flattens them onto a ground.
 *
 * ALIASES ARE RESOLVED. A raw token may be declared as `var(--dk-yolk-deep)`
 * rather than a hex, which is how a colour used in two roles stays edited in
 * one place -- tokens.css's own rule. An unresolved alias would leave the token
 * absent from this map, PAIRS would report it MISSING, and the pair would stop
 * being audited: a check dying quietly, which is the failure mode this whole
 * file exists to prevent. Chains resolve; a cycle throws rather than hanging.
 */
export function readPalette(cssPath = path.join(ROOT, 'src/styles/tokens.css')) {
  const css = fs.readFileSync(cssPath, 'utf8');
  const out = { dk: {}, lt: {} };
  for (const m of css.matchAll(
    /--(dk|lt)-([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|var\(\s*--(?:dk|lt)-[a-z0-9-]+\s*\))\s*;/g,
  )) {
    out[m[1]][m[2]] = m[3].toLowerCase();
  }
  for (const theme of ['dk', 'lt']) {
    for (const key of Object.keys(out[theme])) {
      const seen = new Set([key]);
      let hops = 0;
      let ref;
      while ((ref = /^var\(\s*--(dk|lt)-([a-z0-9-]+)\s*\)$/.exec(out[theme][key]))) {
        if (++hops > 10 || seen.has(ref[2])) {
          throw new Error(`--${theme}-${key} resolves in a cycle via --${ref[1]}-${ref[2]}`);
        }
        seen.add(ref[2]);
        const target = out[ref[1]][ref[2]];
        if (!target) throw new Error(`--${theme}-${key} points at --${ref[1]}-${ref[2]}, which is not declared`);
        out[theme][key] = target;
      }
    }
  }
  if (!Object.keys(out.dk).length || !Object.keys(out.lt).length) {
    throw new Error(`no --dk-*/--lt-* hex tokens found in ${cssPath}`);
  }
  return out;
}

/**
 * The pairs that actually occur on screen, and the threshold each must clear.
 *
 * THIS LIST IS THE CONTRACT. It is deliberately not "every foreground against
 * every background": asserting combinations the app never renders produces
 * failures nobody can act on, and the noise is how a real one gets ignored.
 * Each entry names where it is used.
 *
 * `min` is the WCAG floor: 4.5 for normal text, 3 for large/bold text and for
 * non-text boundaries (1.4.11).
 */
export const PAIRS = [
  // Body and headings on the two grounds text sits on.
  { fg: 'ink', bg: 'shell', min: 4.5, where: 'screen titles, body text on the page ground' },
  { fg: 'ink', bg: 'surface', min: 4.5, where: 'setlist text, row titles inside cards' },
  { fg: 'ink-dim', bg: 'shell', min: 4.5, where: 'screen sub-lines' },
  { fg: 'ink-dim', bg: 'surface', min: 4.5, where: 'footnote text, jam entry notes' },
  { fg: 'ink-place', bg: 'shell', min: 4.5, where: 'venue city/state' },
  { fg: 'ink-place', bg: 'surface', min: 4.5, where: 'venue city/state inside a card' },
  // Its own token, and it was in no pair at all until the coverage check
  // below started reading the stylesheet. `.venue-line` is primary
  // information -- which Brooklyn Bowl of three you are looking at -- so it is
  // held to the text threshold like any other body copy.
  { fg: 'ink-venue', bg: 'shell', min: 4.5, where: 'venue name on the page ground' },
  { fg: 'ink-venue', bg: 'surface', min: 4.5, where: 'venue name inside a card or row' },

  // The accent. Carries meaning, so it is held to the text threshold even
  // where it renders bold -- see docs/design.md.
  { fg: 'yolk', bg: 'shell', min: 4.5, where: 'set labels, footnote markers, gap figures' },
  { fg: 'yolk', bg: 'surface', min: 4.5, where: 'set labels inside the setlist card' },

  // The jam highlight. Recolours body text that gets read, not a glyph.
  { fg: 'jam', bg: 'shell', min: 4.5, where: 'jam key on the page ground' },
  { fg: 'jam', bg: 'surface', min: 4.5, where: 'jam-charted song titles, jam key' },
  { fg: 'jam', bg: 'surface-up', min: 4.5, where: 'jam titles on a pressed card' },

  // Tertiary. .carton-link renders at 10px, which is normal text under WCAG,
  // so it gets 4.5 and not 3 -- this pair is why the colour cannot go dimmer.
  { fg: 'ink-faint', bg: 'shell', min: 4.5, where: 'Carton links, cache chip' },
  { fg: 'ink-faint', bg: 'surface', min: 4.5, where: 'Carton links inside a card' },
  // THE PRESSED GROUND, which was missing and was failing at 4.33:1 dark.
  // `.cover-note` and `.row-meta .sep` are --ink-faint inside `.row`, and
  // `.row:active` sets background: var(--surface-up); `.gap-unit` is the same
  // story under `button.gap-figure:active`. Pressed grounds were already in
  // scope -- jam on surface-up and btn-line on surface-up are both asserted --
  // so this was an inconsistency in the list, not a scoping decision.
  //
  // --dk-ink-faint moved #8d8375 -> #918779 to clear it (4.33 -> 4.56).
  // ΔE 1.6, below the threshold at which the change is visible side by side,
  // and it moves the token UP, which the "must not go dimmer" floor in
  // docs/design.md permits. The hierarchy it sits in is unchanged: still far
  // below --ink-label (6.85 on the shell), so section labels stay clearly
  // brighter than Carton links, which smoke.mjs asserts independently.
  { fg: 'ink-faint', bg: 'surface-up', min: 4.5, where: 'cover note, row-meta separator and gap unit on a PRESSED row' },

  // Section and stat labels. A dedicated token so brightening them cannot
  // drag up .carton-link, .creator-credit or .attrib, which share --ink-faint
  // and are deliberately quiet.
  { fg: 'ink-label', bg: 'shell', min: 4.5, where: 'section labels on the page ground' },
  { fg: 'ink-label', bg: 'surface', min: 4.5, where: 'section labels and stat labels in a card' },

  // Non-text: the button edge has to read as an edge.
  // One token now carries every control edge in the app: .btn, .chip,
  // .status-chip, .icon-btn-bordered, .search and .segmented. Each sits on a
  // different ground, so all three are asserted rather than assuming one
  // covers the rest.
  { fg: 'btn-line', bg: 'surface', min: 3, where: 'button, chip and search border against their fill' },
  { fg: 'btn-line', bg: 'shell', min: 3, where: 'status chip and settings gear in the header; search on the page' },
  { fg: 'btn-line', bg: 'surface-up', min: 3, where: 'pressed button, and the segmented theme control fill' },

  // The SELECTED sort/filter chip. Four pairs, because the old one-token
  // version failed on exactly the pair nobody asserted (the border against its
  // own fill, at 1.53:1 light) while the pairs that were asserted stayed green.
  //
  // `chip-sel-fill` is opaque on purpose -- a translucent fill under .sortbar's
  // backdrop-filter composites whatever is scrolling underneath, so any figure
  // measured for it would be true only at scroll position zero. See tokens.css.
  //
  // `bg: shell` is the sortbar ground: the bar paints --shell-alpha over the
  // shell, and that composites back to exactly --shell.
  //
  // `chip-sel-line on surface` USED TO BE HERE AND HAS BEEN REMOVED, which is
  // a reduction in the list and deliberate. It asserted a selected chip's
  // border against a NEIGHBOURING chip's fill, at 7.15:1 light. The mirror of
  // it -- `btn-line on chip-sel-fill`, an unselected border beside a selected
  // fill -- measures 2.61 dark / 2.89 light and would fail. The two rest on
  // identical reasoning, so the list was asserting the non-adjacency that
  // passes and omitting the one that does not.
  //
  // NEITHER IS AN ADJACENCY. `.sortbar` sets `gap: var(--s-2)`, so 8px of bar
  // ground sits between any two chips and no border ever meets a neighbour's
  // fill. A border's real boundaries are its own fill and the bar ground, and
  // both are asserted below for chip-sel-line and above for btn-line. Adding
  // the failing mirror would have been recording a WCAG failure that does not
  // exist on screen; keeping the passing one was recording a pass that means
  // nothing. The measured figures are kept here so they are not re-derived.
  { fg: 'chip-sel-ink', bg: 'chip-sel-fill', min: 4.5, where: 'selected sort/filter chip label' },
  { fg: 'chip-sel-line', bg: 'chip-sel-fill', min: 3, where: 'selected chip border against its own fill' },
  { fg: 'chip-sel-line', bg: 'shell', min: 3, where: 'selected chip border against the sortbar ground' },

  // The pressed state of the SELECTED segment in the theme control. The
  // colour comes from the non-pressed rule and the ground from the `:active`
  // one, so it is two rules and the derivation cannot see it -- exactly the
  // shape that has to stay hand-listed, and exactly the shape that goes
  // unnoticed. Found by the coverage check below, not by reading the file.
  { fg: 'yolk-ink', bg: 'yolk-deep', min: 4.5, where: 'selected theme segment while pressed' },

  { fg: 'danger', bg: 'shell', min: 4.5, where: 'error text, the NO SW chip' },
];

/**
 * Measured shortfalls that are KNOWN, DOCUMENTED and NOT FIXED.
 *
 * Reported by the CLI, deliberately not asserted by tests/contrast.test.mjs --
 * a red suite for a thing nobody has decided to change trains you to ignore
 * red. Equally it is not omitted, because an unrecorded gap is one that gets
 * rediscovered from scratch.
 *
 * EVERY ENTRY DECLARES A `status`, AND THE TWO ARE NOT THE SAME THING:
 *
 *   'accepted'  — someone looked at it, on the device this app is used on,
 *                 and decided the shortfall is not worth what fixing it costs.
 *                 A closed decision. Says who assessed it and how.
 *   'deferred'  — measured, recorded, and nobody has decided anything yet.
 *                 An open question.
 *
 * This distinction used to be missing and the list asserted that every entry
 * was deferred. "We looked and it is fine" and "nobody has looked" produce the
 * same silence on screen and are completely different states of knowledge; a
 * record that cannot tell them apart invites the accepted one to be
 * re-litigated every audit, and lets the deferred one pass as settled.
 *
 * KEEP THIS LIST SHORT. A 'deferred' entry is a decision someone owes.
 */
export const KNOWN_GAPS = [
  {
    fg: 'ink-faint',
    bg: 'yolk-wash',
    min: 4.5,
    status: 'accepted',
    what: '--ink-faint text on a PICKED row (--yolk-wash over --surface)',
    measured: 'dark 4.00:1, light 4.91:1 — needs 4.5. Dark falls 0.5 short.',
    why:
      'Found in 0.1.63 by the token-coverage check, not by reading the list: ' +
      '--yolk-wash was painted by .row-shell[data-picked="true"] and appeared ' +
      'in no pair, so nothing had ever measured text against it. .row has no ' +
      'background of its own, so the wash reaches .cover-note, .row-meta .sep ' +
      'and .gap-unit, all of which are --ink-faint. Unlike the pressed-row case ' +
      'fixed in the same build, this state PERSISTS -- a picked row stays ' +
      'picked.',
    assessed:
      'ACCEPTED 2026-08-27 by the repo owner, ON A REAL PHONE IN DARK MODE, ' +
      'looking at an actual picked row: the dim second line reads clearly. ' +
      'This is a judgement made against the device the app is used on, not a ' +
      'waiver written on paper. WCAG 4.5:1 is calibrated for the worst ' +
      'realistic viewing case; it is not a claim that 4.00:1 is illegible, and ' +
      'a 0.5 shortfall that survives on-device inspection is a different ' +
      'finding from the yolk and jam failures this discipline was built for. ' +
      'DO NOT re-open this by measurement alone -- the number is known. ' +
      'Re-open it only with new evidence from the screen.',
    note:
      'BOTH FIXES WERE COSTED AND BOTH ARE REJECTED. Brightening --ink-faint ' +
      'far enough (roughly #9c9285) clears it, but --ink-faint is worn by 26 ' +
      'selectors and the move would push attribution links, the cache chip and ' +
      'the creator credit up across every screen, against the deliberate ' +
      '"present and findable, not prominent" intent in docs/design.md. The ' +
      'small #8d8375 -> #918779 move in 0.1.63 was ΔE 1.6, cleared the PRESSED ' +
      'row, and deliberately stopped there. Lowering --yolk-wash\'s alpha ' +
      'clears it by weakening the picked-row highlight, which is the one thing ' +
      'that highlight exists to do. Neither is worth spending on a difference ' +
      'that could not be perceived on the device.',
  },
  // The .chip[aria-pressed="true"] border that lived here (dark 2.14:1, light
  // 1.53:1) is FIXED as of 0.1.59 and has moved into PAIRS as four asserted
  // pairs. Do not re-add it; if it regresses, `node --test` goes red.
  {
    fg: 'yolk-line',
    bg: 'surface',
    min: 3,
    status: 'deferred',
    what: '.badge-jam border (--yolk-line over --surface)',
    measured: 'dark 2.17:1, light 1.60:1 — needs 3:1',
    why:
      'Found while measuring the chip accent, because it is the same ' +
      '--yolk-line token with the same root cause: a translucent warm tint on ' +
      'a warm ground has very little to work with. The badge sits on --surface ' +
      'rather than the sortbar, so it was never covered by the chip pairs and ' +
      'has been failing unrecorded.',
    note:
      'The badge also carries --yolk label text, so the border is not the only ' +
      'signal and this is a weaker failure than the chip one was. The chip fix ' +
      'deliberately did NOT touch --yolk-line: that token is shared with ' +
      '.row-shell[data-picked="true"], and changing it would move the picked-row ' +
      'highlight too. Scoped out on purpose, pending an explicit decision.',
  },
];

/**
 * PAIRS DERIVED FROM THE STYLESHEET, not from the list above.
 *
 * THE STRUCTURAL PROBLEM THIS ADDRESSES. PAIRS pairs TOKEN NAMES. Its `where`
 * field is prose -- nothing connects `{ fg: 'chip-sel-ink', bg: 'chip-sel-fill' }`
 * to the rule that actually renders it. A rule could switch which token it
 * uses and every hand-listed pair would stay green, because the palette had
 * not changed. What the list checks is the palette; what it claims to check is
 * the app. docs/design.md said "every foreground/background pair in use" when
 * it was every pair someone remembered to write down.
 *
 * WHAT CAN HONESTLY BE DERIVED, AND WHAT CANNOT. A rule that sets BOTH a
 * foreground and a background is a complete pair on its own -- no DOM, no
 * nesting, no ancestry. `.btn-accent`, `.segmented-item[aria-pressed="true"]`
 * and `.badge-accent` are all of this shape, and so is the selected chip. That
 * subset is derived here and measured exactly as written.
 *
 * Text on an ANCESTOR's background is not derivable from CSS alone: knowing
 * that `.cover-note` sits inside `.row` requires the DOM. Those stay in PAIRS,
 * and scripts/smoke.mjs measures them for real against the rendered page --
 * see "contrast, measured on the rendered page" there. This function is the
 * static half and does not pretend to be the whole contract.
 *
 * Translucent grounds are SKIPPED rather than guessed at: a colour over
 * `--shell-alpha` composites whatever is scrolling beneath it, so any figure
 * would be true only at scroll position zero. Those are listed explicitly in
 * PAIRS with the composited ground stated, which is the honest way to handle
 * them. Skipped rules are returned so nothing is silently dropped.
 */
export function deriveRulePairs(cssPath = path.join(ROOT, 'src/styles/app.css'), palette = readPalette()) {
  const rules = parseRules(fs.readFileSync(cssPath, 'utf8'));
  const tokenOf = (value) => {
    const m = String(value).match(/var\(\s*--([a-z0-9-]+)\s*\)/);
    return m ? m[1] : null;
  };
  const opaque = (theme, token) => {
    const v = palette[theme][token];
    return typeof v === 'string' && v.startsWith('#');
  };

  const pairs = [];
  const skipped = [];
  for (const r of rules) {
    const bg = tokenOf(r.decls.get('background') || r.decls.get('background-color') || '');
    if (!bg) continue;

    // A foreground on the same rule. `color` is text (4.5); a border is a
    // non-text boundary (3, WCAG 1.4.11).
    const fgs = [
      ['color', tokenOf(r.decls.get('color') || ''), 4.5],
      ['border-color', tokenOf(r.decls.get('border-color') || r.decls.get('border') || ''), 3],
    ];
    for (const [prop, fg, min] of fgs) {
      if (!fg) continue;
      if (!palette.dk[bg] || !palette.dk[fg]) {
        skipped.push({ selector: r.selector, prop, fg, bg, why: 'not a palette token' });
        continue;
      }
      if (!opaque('dk', bg) || !opaque('lt', bg)) {
        skipped.push({ selector: r.selector, prop, fg, bg, why: 'translucent ground — belongs in PAIRS with the composited value' });
        continue;
      }

      // A border painted in its own fill colour is not a boundary anyone is
      // meant to see. `.btn-accent` and `.stat-grid` both do this deliberately
      // -- the accent button reads as a solid block, and .stat-grid's
      // background IS its 1px grid gutter. Measuring them yields 1:1 and says
      // nothing.
      if (fg === bg) {
        skipped.push({ selector: r.selector, prop, fg, bg, why: 'border matches its own fill — deliberate, not a boundary' });
        continue;
      }

      // `--line` is DOCUMENTED as a hairline that is meant to be barely there
      // (see tokens.css): it separates rows and outlines containers. WCAG
      // 1.4.11's 3:1 covers boundaries needed to identify a CONTROL, and the
      // token for those is `--btn-line`, which every control uses and which is
      // asserted here at 3:1 on all three of its grounds.
      //
      // This is not a loophole for putting `--line` on a control: smoke.mjs
      // sweeps .btn, .chip, .status-chip, .icon-btn-bordered, .search and
      // .segmented across screens and requires every one to render the SAME
      // border colour as a real .btn. A control wearing --line fails there.
      if (prop === 'border-color' && fg === 'line') {
        skipped.push({ selector: r.selector, prop, fg, bg, why: 'decorative container hairline; control edges use --btn-line and are asserted' });
        continue;
      }

      pairs.push({ fg, bg, min, prop, selector: r.selector, where: `${r.selector} { ${prop} }` });
    }
  }
  return { pairs, skipped };
}

/** Every palette token a rule in app.css actually uses, by property. */
export function tokensUsedByRules(cssPath = path.join(ROOT, 'src/styles/app.css')) {
  const rules = parseRules(fs.readFileSync(cssPath, 'utf8'));
  const out = { color: new Map(), background: new Map() };
  for (const r of rules) {
    for (const [prop, key] of [['color', 'color'], ['background', 'background'], ['background-color', 'background']]) {
      const v = r.decls.get(prop);
      if (!v) continue;
      const m = String(v).match(/var\(\s*--([a-z0-9-]+)\s*\)/);
      if (m && !out[key].has(m[1])) out[key].set(m[1], r.selector);
    }
  }
  return out;
}

/** Measure every pair in both themes. Returns rows, worst first. */
export function audit(palette = readPalette()) {
  const rows = [];
  for (const theme of ['dk', 'lt']) {
    for (const p of PAIRS) {
      const fg = palette[theme][p.fg];
      const bg = palette[theme][p.bg];
      if (!fg || !bg) {
        rows.push({ theme, ...p, fg: p.fg, bg: p.bg, value: null, missing: true, pass: false });
        continue;
      }
      const value = r2(fg, bg);
      rows.push({ theme, ...p, fgHex: fg, bgHex: bg, value, pass: value >= p.min });
    }
  }
  return rows.sort((a, b) => (a.value ?? -1) - (b.value ?? -1));
}

// --- CLI --------------------------------------------------------------------

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const [a, b] = process.argv.slice(2);
  if (a && b) {
    console.log(`${a} on ${b}`);
    console.log(`  contrast ${r2(a, b)}:1`);
    console.log(`  b*       ${bStar(a)} (yellow +, blue -)`);
    console.log(`  deltaE   ${deltaE(a, b)}`);
    process.exit(0);
  }

  const rows = audit();
  const bad = rows.filter((r) => !r.pass);
  console.log(`contrast audit of src/styles/tokens.css — ${rows.length} pairs\n`);
  for (const r of rows) {
    const mark = r.pass ? 'ok  ' : 'FAIL';
    const val = r.missing ? 'MISSING TOKEN' : `${String(r.value).padStart(6)}:1 (min ${r.min})`;
    console.log(`  ${mark} ${r.theme}  ${(r.fg + ' on ' + r.bg).padEnd(26)} ${val}   ${r.where}`);
  }
  console.log(`\n${bad.length ? `${bad.length} pair(s) below threshold` : 'all pairs clear their threshold'}`);

  // The half that comes out of the stylesheet rather than the list above.
  const derived = deriveRulePairs();
  const palette = readPalette();
  const derivedBad = [];
  for (const p of derived.pairs) {
    for (const theme of ['dk', 'lt']) {
      const v = r2(palette[theme][p.fg], palette[theme][p.bg]);
      if (v < p.min) derivedBad.push(`${theme} ${p.where} — ${p.fg} on ${p.bg} = ${v}:1 (min ${p.min})`);
    }
  }
  console.log(`\nDERIVED FROM app.css — ${derived.pairs.length} same-rule pair(s), ${derived.skipped.length} skipped:`);
  for (const p of derived.pairs) {
    const d = r2(palette.dk[p.fg], palette.dk[p.bg]);
    const l = r2(palette.lt[p.fg], palette.lt[p.bg]);
    const mark = d < p.min || l < p.min ? 'FAIL' : 'ok  ';
    console.log(`  ${mark} ${p.where.padEnd(46)} ${p.fg} on ${p.bg}  dk ${d} / lt ${l}`);
  }
  for (const s of derived.skipped) console.log(`  skip ${(s.selector + ' [' + s.prop + ']').padEnd(46)} ${s.why}`);

  if (KNOWN_GAPS.length) {
    const deferred = KNOWN_GAPS.filter((g) => g.status === 'deferred');
    console.log(`\n${KNOWN_GAPS.length} KNOWN GAP(S) — measured and documented:`);
    for (const g of KNOWN_GAPS) {
      // The status leads, because "someone looked and accepted this" and
      // "nobody has decided" read identically otherwise.
      console.log(`  - [${(g.status || 'UNDECLARED').toUpperCase()}] ${g.what}`);
      console.log(`      ${g.measured}`);
      if (g.assessed) console.log(`      ${g.assessed.split('. ')[0]}.`);
    }
    console.log(
      deferred.length
        ? `  (not asserted by node --test; ${deferred.length} still awaiting a decision)`
        : '  (not asserted by node --test; all accepted, none awaiting a decision)',
    );
  }
  process.exit(bad.length + derivedBad.length ? 1 : 0);
}
