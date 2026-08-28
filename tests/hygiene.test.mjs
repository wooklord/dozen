// Run: node --test
//
// Small invariants about the source that have each already been violated once,
// grouped because none of them needs a browser and all of them are the same
// kind of claim: something the repo asserts about itself in prose.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROUTES } from '../scripts/routes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function srcFiles(dir = path.join(ROOT, 'src'), out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) srcFiles(p, out);
    else out.push(p);
  }
  return out;
}

// --- innerHTML ---------------------------------------------------------------

test('el() offers no innerHTML door', () => {
  // dom.js opens by promising nothing user-facing goes through innerHTML, and
  // shipped an `html:` prop that did exactly that -- with zero call sites, so
  // it was never even earning its risk. Every display string in this app comes
  // from a third-party API.
  //
  // COMMENTS ARE STRIPPED FIRST. The comment recording why the prop was
  // removed says the word innerHTML, so a check reading the raw text failed
  // against the fixed file -- and would equally have passed against a broken
  // one whose comment happened not to. Prose about a line is not the line.
  const dom = read('src/ui/dom.js').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const propHandling = dom.slice(dom.indexOf('for (const [k, v] of Object.entries(props))'));
  assert.doesNotMatch(
    propHandling.slice(0, propHandling.indexOf('\n  }')),
    /innerHTML/,
    'el() must not assign innerHTML from a prop',
  );
});

test('innerHTML appears only where the content is a literal in this repo', () => {
  // icon() is the one allowed use: SVG path data written in ICONS, never API
  // data. Named explicitly so a second use has to be argued for rather than
  // slipping in beside an existing one.
  const ALLOWED = new Set(['src/ui/dom.js']);
  const hits = [];
  for (const f of srcFiles()) {
    if (!f.endsWith('.js')) continue;
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    read(rel).split('\n').forEach((line, i) => {
      if (/\.innerHTML\s*=/.test(line) && !ALLOWED.has(rel)) hits.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, [], 'innerHTML outside src/ui/dom.js — every string on screen is third-party data');
});

// --- routes ------------------------------------------------------------------

test('ROUTES covers the two screens that have broken in production', () => {
  // Show detail served a stale module in 0.1.44; the gap chart rendered
  // nothing for three consecutive releases. Neither was in this list, so the
  // deploy gate and the layout diff walked neither, while smoke covered both.
  const hashes = ROUTES.map((r) => r.hash);
  assert.ok(hashes.some((h) => h.startsWith('#/show/')), 'no show-detail route');
  assert.ok(hashes.some((h) => h.startsWith('#/gapchart/')), 'no gap-chart route');
});

test('every route has a marker and no two routes share one', () => {
  // A cheap structural pre-check. Whether a marker is unique on the RENDERED
  // screen is a browser question and smoke.mjs answers it -- both markers that
  // were wrong appeared on other screens via a component three files away, and
  // no amount of reading this file would have shown that.
  for (const r of ROUTES) {
    assert.ok(r.expect && r.expect.length > 3, `${r.hash} has no usable marker`);
  }
  const seen = new Map();
  for (const r of ROUTES) {
    const key = `${r.expect.toLowerCase()}|${r.selector || ''}`;
    assert.ok(!seen.has(key), `${r.hash} and ${seen.get(key)} share the marker ${JSON.stringify(r.expect)}`);
    seen.set(key, r.hash);
  }
});

test('the deploy check waits for a rendered screen, not for an absent loader', () => {
  // `!document.querySelector('.loader')` is satisfied by the document not
  // having parsed yet: Page.navigate resolves early, the first poll sees a
  // blank page, and every assertion after it runs on nothing. smoke.mjs and
  // layout-diff.mjs were moved off this poll when it was found; the deploy
  // gate kept it until 0.1.62, which was the copy that mattered most.
  for (const f of ['scripts/verify-deploy.mjs', 'scripts/smoke.mjs', 'scripts/layout-diff.mjs']) {
    const boot = read(f).split('\n').filter((l) => /booted = true/.test(l)).join('\n');
    assert.ok(boot, `${f}: no boot wait found — this check is looking at the wrong thing`);
    assert.match(boot, /#main \.screen/, `${f} must wait for a rendered screen`);
    assert.doesNotMatch(boot, /!document\.querySelector\('\.loader'\)/, `${f} still polls for an absent loader`);
  }
});

// --- cache -------------------------------------------------------------------

test('the cache declares exactly the expiry it can enforce', () => {
  // Five TTLs keyed by data type, four of which could never fire: the archive
  // is one blob under one key with one fetchedAt.
  const cache = read('src/data/cache.js');
  assert.match(cache, /export const ARCHIVE_TTL/, 'ARCHIVE_TTL must be the exported expiry');
  assert.doesNotMatch(cache, /export const TTL\s*=/, 'the per-type TTL map cannot be enforced by this cache');
  const stale = cache.slice(cache.indexOf('export function isStale'));
  assert.match(stale.slice(0, 200), /ARCHIVE_TTL/);
});

// --- tabular figures ---------------------------------------------------------

test('the tabular-nums rule names no element the app never emits', () => {
  // It listed `time`, `td` and `th`. There is no table anywhere and no <time>,
  // so three of its four selectors were decoration and the rule read as far
  // more thorough than it was.
  const css = read('src/styles/app.css');
  const rule = css.slice(css.indexOf('font-variant-numeric: tabular-nums') - 400, css.indexOf('font-variant-numeric: tabular-nums'));
  const selectors = rule.slice(rule.lastIndexOf('*/') + 2).split(',').map((s) => s.trim()).filter(Boolean);
  const elementSelectors = selectors.filter((s) => /^[a-z]+$/.test(s));

  const js = srcFiles().filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const never = elementSelectors.filter((tag) => !new RegExp(`el\\(\\s*['"\`]${tag}[.'"\`]`).test(js));
  assert.deepEqual(never, [], 'these element selectors match nothing the app ever creates');
});

test('.row-meta gets tabular figures', () => {
  // The densest list in the app: "Last {date} · {n}×" on every song row, and
  // the one place the old rule missed.
  const css = read('src/styles/app.css');
  const block = css.slice(0, css.indexOf('font-variant-numeric: tabular-nums'));
  const selectors = block.slice(block.lastIndexOf('*/') + 2);
  for (const want of ['.num', '.row-meta']) {
    assert.ok(selectors.includes(want), `${want} is not in the tabular-nums rule`);
  }
});

// --- venue text ----------------------------------------------------------------

test('no view builds .venue-line markup by hand', () => {
  // 0.1.24 added venueLine() so "no view can quietly drop this back into a
  // metadata style", and two views went on rendering the classes themselves --
  // the venue screen's place line and the venue search row's. Neither was
  // wrong on the day it was written; both were a second definition of the
  // treatment, free to drift from the helper without anything going red. They
  // are venuePlace() now.
  //
  // Matches the CLASS IN el(), not any mention of the string: components.js
  // and this file both talk ABOUT .venue-line, and a naive text search would
  // fail on the fixed tree.
  const offenders = [];
  for (const f of srcFiles().filter((p) => p.endsWith('.js'))) {
    if (f.endsWith(path.join('ui', 'components.js'))) continue; // the one definition
    const src = fs.readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    if (/el\(\s*[`'"][a-z]*\.[^`'"]*venue-line/.test(src)) offenders.push(path.relative(ROOT, f));
  }
  assert.deepEqual(offenders, [], 'venue text must come from venueLine()/venuePlace()');
});

test('venueLine takes no size option', () => {
  // THE ESCAPE HATCH IS THE BUG. 0.1.24 shipped the helper and a `small: true`
  // flag in one commit; seven of eleven call sites passed it, including card
  // heads with a full card width, and venue text was reported as too small
  // twice. Nothing tied the flag to the condition that justified it, so it
  // spread by copy-paste -- the same list-shaped contract failure recorded in
  // CLAUDE.md.
  //
  // The step-down now lives in `.row-main > .venue-line`, where the DOM states
  // the condition. This asserts the hatch is not reopened: no options argument
  // reaches venueLine from anywhere.
  const comp = read('src/ui/components.js');
  assert.match(comp, /export function venueLine\(showOrVenue\)/, 'venueLine must take exactly one argument');

  const callers = [];
  for (const f of srcFiles().filter((p) => p.endsWith('.js'))) {
    const src = fs.readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of src.matchAll(/venueLine\(([^)]*)\)/g)) {
      if (m[1].includes(',')) callers.push(`${path.relative(ROOT, f)}: venueLine(${m[1]})`);
    }
  }
  assert.deepEqual(callers, [], 'venueLine takes the record and nothing else');
});

test('the row step-down carries the size and the truncation together', () => {
  // They are one constraint -- a fixed-height row with a badge beside the line
  // -- and were two rules, one of them reachable only by a call-site flag.
  // Splitting them again is how the size half gets applied somewhere the
  // truncation half is not, or dropped where it is.
  const css = read('src/styles/app.css');
  const i = css.indexOf('.row-main > .venue-line');
  assert.ok(i > 0, '.row-main > .venue-line rule is gone');
  const body = css.slice(i, css.indexOf('}', i));
  for (const want of ['font-size', 'text-overflow']) {
    assert.ok(body.includes(want), `${want} must sit in the same rule as the rest of the row treatment`);
  }
  // COMMENTS STRIPPED FIRST. The comment above this very rule names
  // .venue-line-sm to record what it replaced, and the raw-text version of
  // this assertion failed against the FIXED stylesheet -- and would equally
  // have passed against a broken one whose comment happened not to mention it.
  // Same correction as the innerHTML check above.
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(rules, /\.venue-line-sm/, '.venue-line-sm is the flag-driven class the DOM now replaces');
});
