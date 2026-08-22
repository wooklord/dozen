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
  for (const m of css.matchAll(/--(dk|lt)-([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
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

  // Non-text: the button edge has to read as an edge.
  { fg: 'btn-line', bg: 'surface', min: 3, where: 'small button border against its own fill' },
  { fg: 'btn-line', bg: 'shell', min: 3, where: 'small button border against the page' },
  { fg: 'btn-line', bg: 'surface-up', min: 3, where: 'small button border when pressed' },

  { fg: 'danger', bg: 'shell', min: 4.5, where: 'error text, the NO SW chip' },
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
  process.exit(bad.length ? 1 : 0);
}
