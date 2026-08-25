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
 * Parsed rather than restated. rgba() values are skipped: the washes and line
 * tints are translucent, and a contrast figure for them would need the ground
 * composited in, which is a different calculation and not what this reports.
 */
export function readPalette(cssPath = path.join(ROOT, 'src/styles/tokens.css')) {
  const css = fs.readFileSync(cssPath, 'utf8');
  const out = { dk: {}, lt: {} };
  for (const m of css.matchAll(/--(dk|lt)-([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))\s*;/g)) {
    out[m[1]][m[2]] = m[3].toLowerCase();
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

  { fg: 'danger', bg: 'shell', min: 4.5, where: 'error text, the NO SW chip' },
];

/**
 * Measured shortfalls that are KNOWN, DOCUMENTED and NOT YET FIXED.
 *
 * Reported by the CLI, deliberately not asserted by tests/contrast.test.mjs --
 * a red suite for a thing nobody has decided to change trains you to ignore
 * red. Equally it is not omitted, because an unrecorded gap is one that gets
 * rediscovered from scratch.
 *
 * KEEP THIS LIST EMPTY IF YOU CAN. Every entry is a decision someone deferred.
 */
export const KNOWN_GAPS = [
  {
    what: '.chip[aria-pressed="true"] border (--yolk-line)',
    measured: 'dark 2.14:1 against its own fill, light 1.53:1 — needs 3:1',
    why:
      'Translucent --yolk-line over translucent --yolk-wash over the shell. ' +
      'Composited properly with composite(), not estimated. The SELECTED state ' +
      'of a sort/filter chip therefore has a weaker boundary than its ' +
      'unselected state, which now uses --btn-line at 3.4:1.',
    note:
      'Not a total loss of affordance: the pressed state also recolours the ' +
      'label to --yolk and fills with --yolk-wash. Fixing it means raising ' +
      "--yolk-line's alpha or giving the pressed chip an opaque border, and " +
      'both change how selection looks. Left for an explicit decision.',
  },
];

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

  if (KNOWN_GAPS.length) {
    console.log(`\n${KNOWN_GAPS.length} KNOWN GAP(S) — measured, documented, not yet fixed:`);
    for (const g of KNOWN_GAPS) {
      console.log(`  - ${g.what}`);
      console.log(`      ${g.measured}`);
    }
    console.log('  (not asserted by node --test; each is an open decision)');
  }
  process.exit(bad.length ? 1 : 0);
}
