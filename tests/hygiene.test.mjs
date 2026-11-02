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
import { ROUTES, REDIRECTS } from '../scripts/routes.mjs';
import { SWEPT_PREFIXES } from '../scripts/cdp.mjs';

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

test('children go through replace() in dom.js, never to Element.replaceChildren(...)', () => {
  // The When sheet on Shows rendered "nullnull" under its year grid from
  // 0.1.82 to 0.1.90: two `year ? el(...) : null` children handed to
  // replaceChildren(), which prints a null as the text "null" where el() and
  // append() drop it. One null-safe door, replace(), and this guard so the
  // next re-render does not reach for the DOM method beside it. An empty
  // replaceChildren() is a clear and is allowed. The smoke test's literal
  // watch is the net under this: it reads the text, this reads the source.
  const hits = [];
  for (const f of srcFiles()) {
    if (!f.endsWith('.js')) continue;
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    read(rel).split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      if (/\.replaceChildren\(\s*[^)\s]/.test(code) || /\.replaceChildren\(\s*$/.test(code)) hits.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, [], 'replaceChildren(...) with children — use replace() from src/ui/dom.js, which drops a null instead of printing it');
});

// --- routes ------------------------------------------------------------------

test('ROUTES covers the screen that has broken in production, and the retired chart route redirects', () => {
  // Show detail served a stale module in 0.1.44; the gap chart rendered
  // nothing for three consecutive releases. Neither was in this list, so the
  // deploy gate and the layout diff walked neither, while smoke covered both.
  // Since 0.1.90 the chart is a section of show detail, so one route walks
  // both; its old hash must redirect to a show, because an unknown hash falls
  // through to Home and would take every old link there in silence.
  const hashes = ROUTES.map((r) => r.hash);
  assert.ok(hashes.some((h) => h.startsWith('#/show/')), 'no show-detail route');
  assert.ok(!hashes.some((h) => h.startsWith('#/gapchart/')), 'the retired gap-chart route is still walked as a screen');
  const chart = REDIRECTS.find((r) => r.from.startsWith('#/gapchart/'));
  assert.ok(chart, 'no redirect for the retired #/gapchart/ route');
  assert.equal(chart.to, chart.from.replace('#/gapchart/', '#/show/'), 'the chart redirect must land on the same show');
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

test('only scripts/cdp.mjs launches Chrome', () => {
  // Three scripts each launched and drove their own Chrome until 2026-10-28,
  // and the copies drifted: one timed its calls out, two never did, and none
  // of them closed the browser it had started. A fourth copy would start the
  // drift again, so a launch argument anywhere else fails here.
  const scripts = fs.readdirSync(path.join(ROOT, 'scripts')).filter((f) => f.endsWith('.mjs') && f !== 'cdp.mjs');
  const launching = scripts.filter((f) => /[`'"]--remote-debugging-port=/.test(read(`scripts/${f}`)));
  assert.deepEqual(launching, [], `launches its own Chrome instead of going through scripts/cdp.mjs`);
  for (const f of ['smoke.mjs', 'layout-diff.mjs', 'verify-deploy.mjs']) {
    assert.match(read(`scripts/${f}`), /^import \{[^}]*\bopenChrome\b[^}]*\} from '\.\/cdp\.mjs';$/m, `scripts/${f} must open Chrome through scripts/cdp.mjs`);
  }
});

test('Chrome and the local servers are assigned a port, never given one from a range', () => {
  // Each script drew its DevTools and server ports from a range until 0.1.94, and a
  // range can hold something else: an updater on 127.0.0.1:9180 stopped one run on
  // "Unexpected token '<'" with 10 Chrome processes left. Chrome picks its own now
  // and each server listens on 0, so a draw or a fixed port is the old fault back.
  assert.match(read('scripts/cdp.mjs'), /^\s*'--remote-debugging-port=0',/m, 'scripts/cdp.mjs must let Chrome pick its own DevTools port');
  for (const f of ['smoke.mjs', 'layout-diff.mjs', 'verify-deploy.mjs']) {
    const src = read(`scripts/${f}`);
    assert.doesNotMatch(src, /\bDEVPORT\b/, `scripts/${f} draws a DevTools port`);
    assert.doesNotMatch(src, /openChrome\(\{[^}]*\bport\b/, `scripts/${f} hands openChrome a port`);
    assert.doesNotMatch(src, /\bport\w*\s*=\s*\d+\s*\+\s*Math\.random|Math\.random\(\)[^;\n]*\bport\b|\bPORT\w*\s*=\s*\d/i, `scripts/${f} draws or fixes a port`);
    for (const m of src.matchAll(/\.listen\(([^,)]*)/g)) {
      assert.equal(m[1], '0', `scripts/${f} listens on ${m[1]}, not on the port the OS assigns`);
    }
  }
  // Two scripts serve the app. A listen written some other way would leave the loop
  // above with nothing to read, and it would pass.
  for (const f of ['smoke.mjs', 'layout-diff.mjs']) {
    assert.match(read(`scripts/${f}`), /\.listen\(0,/, `scripts/${f} must serve on the port listen(0) assigns`);
  }
});

test('every throwaway profile carries a prefix the sweep owns', () => {
  // openChrome() sweeps what earlier runs left -- every Chrome on a profile
  // under the temp directory with one of SWEPT_PREFIXES, and every such
  // directory -- before it launches (2026-11-01). A script whose profile is
  // named outside the list would leak past the sweep for good, and nothing on
  // a green run would say so.
  for (const f of ['smoke.mjs', 'layout-diff.mjs', 'verify-deploy.mjs']) {
    const m = read(`scripts/${f}`).match(/path\.join\(os\.tmpdir\(\), '([^']+)' \+ Date\.now\(\)\)/);
    assert.ok(m, `scripts/${f} must build its profile as path.join(os.tmpdir(), '<prefix>' + Date.now())`);
    assert.ok(SWEPT_PREFIXES.includes(m[1]), `scripts/${f} names its profile "${m[1]}...", which is not in SWEPT_PREFIXES ${JSON.stringify(SWEPT_PREFIXES)} -- the sweep would never remove it`);
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

// --- the offline shell -------------------------------------------------------

test('the service worker precaches every module and stylesheet under src/', () => {
  // The offline path is a shipped feature, used in venues on bad signal. A
  // view missing from SHELL loads fine online and fails only offline, the one
  // place nobody is testing -- and nothing compared the list with the tree
  // until a new view was added for the gap history (0.1.83).
  const sw = read('sw.js');
  // The SHELL array literal ONLY, with its comments removed. Matched against
  // the whole file, a path named in a comment -- or an entry commented out of
  // the list -- counted as precached (cold review, 0.1.83).
  const literal = (sw.match(/const SHELL = \[([\s\S]*?)\];/) || [])[1] || '';
  const live = literal.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const shell = new Set([...live.matchAll(/'\.\/(src\/[^']+)'/g)].map((m) => m[1]));
  assert.ok(shell.size >= 10, `only ${shell.size} src/ entries parsed out of SHELL -- a parse that matched nothing would pass`);
  const missing = srcFiles()
    .filter((f) => /\.(js|css)$/.test(f))
    .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
    .filter((f) => !shell.has(f));
  assert.deepEqual(missing, [], 'these files ship but the service worker does not precache them');
  // And the other way (0.1.90, when views/gapchart.js was retired): an entry
  // for a file that no longer exists. The install survives it by design, one
  // add failing on its own, so nothing on screen would ever say -- it is a
  // 404 on every install, for good, that only this comparison can see.
  const stale = [...shell].filter((f) => !fs.existsSync(path.join(ROOT, f)));
  assert.deepEqual(stale, [], 'the service worker precaches these files, which no longer exist');
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

// --- section heads -------------------------------------------------------------

test('a head prints its count through countedHead(), never in its title', () => {
  // Four heads carried a parenthesised value until 0.1.93, each built where it
  // was used, and one of them was a date. countedHead() is the one form now and
  // the smoke test holds what renders; this holds the source, so a fifth cannot
  // be written the old way on a screen the walk does not reach. Comments are
  // stripped first, because these files talk about the old form.
  const offenders = [];
  for (const f of srcFiles().filter((p) => p.endsWith('.js'))) {
    const src = fs.readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const hits = src.match(/sectionHead\(\s*[`'"][^`'"\n]*\(/g);
    if (hits) offenders.push(`${path.relative(ROOT, f)}: ${hits.join(', ')}`);
    if (/function countedHead/.test(src) && !f.endsWith(path.join('ui', 'components.js'))) {
      offenders.push(`${path.relative(ROOT, f)}: declares its own countedHead()`);
    }
  }
  assert.deepEqual(offenders, [], 'a count goes in the badge countedHead() builds');
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

// --- deploy wait ---------------------------------------------------------------

test('the deploy wait compares the BUILD integer version.js stores, never the label', () => {
  // src/version.js holds `BUILD = 82`; "0.1.82" is assembled from it and never
  // appears in the file. The first post-push poll grepped the served file for
  // the label, could not match, and ran out its timeout against a host that had
  // already flipped. A check that cannot pass is as useless as one that cannot
  // fail, so the wait reads the integer with the regex verify-deploy.mjs uses.
  const wait = read('scripts/wait-deploy.mjs');
  const verify = read('scripts/verify-deploy.mjs');
  // Matches the regex LITERAL as it appears in the source, i.e. the text
  // /^export const BUILD\s*=\s*(\d+);?\s*$/m with its backslashes, so a drift
  // in either file fails. Anchored since 0.1.85: unanchored, the first
  // `BUILD = n` in the file won, a comment above the declaration included.
  const re = (src) => src.match(/\/\^export const BUILD\\s\*=\\s\*\(\\d\+\);\?\\s\*\$\/m/g) || [];
  assert.ok(re(verify).length >= 1, 'verify-deploy.mjs reads BUILD with /^export const BUILD\\s*=\\s*(\\d+);?\\s*$/m');
  assert.ok(re(wait).length >= 1, 'wait-deploy.mjs must read BUILD with the same regex');
  // And nothing in either reads it any other way, beside the anchored one.
  // Every line that pairs BUILD with a digit class is a reader of the
  // integer, whatever shape it takes -- an inline .match(), a second named
  // constant, a RegExp built from a string -- and each must be the anchored
  // literal. The cold review of 0.1.85 found the first version of this guard
  // looked only for an inline `.match(/BUILD\s`, which a named constant passed.
  // The anchored constant must also be what .match() is given.
  for (const [name, src] of [['verify-deploy.mjs', verify], ['wait-deploy.mjs', wait]]) {
    const readers = src.split('\n').filter((l) => /BUILD/.test(l) && /\\d|\[0-9\]/.test(l));
    for (const l of readers) assert.ok(re(l).length === 1, `${name} reads BUILD with a regex other than the anchored one: ${l.trim()}`);
    assert.match(src, /const BUILD_RE = \/\^export const BUILD/, `${name} binds the anchored regex to BUILD_RE`);
    assert.match(src, /\.match\(BUILD_RE\)/, `${name} reads BUILD through BUILD_RE`);
  }
  assert.doesNotMatch(wait, /got\s*===?\s*['"`]0\.1\./, 'wait-deploy.mjs compares against a "0.1.N" string, which version.js never contains');
  assert.match(wait, /got === expected/, 'wait-deploy.mjs compares the two integers');
  const local = read('src/version.js');
  assert.match(local, /^export const BUILD\s*=\s*\d+;?\s*$/m, 'version.js stores a bare integer');
  assert.doesNotMatch(local, /BUILD\s*=\s*['"`]/, 'version.js stores the integer, not the label');
});
