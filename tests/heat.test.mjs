// Run: node --test
//
// One heat floor, in one place, and it is a per-theme TOKEN rather than a
// number in JS.
//
// It was four floors with three values: components.js clamped to 0.08,
// gapchart.js to 0.08 in a copy of the function rather than a call to it,
// jams.js to 0.12 and song.js to 0.15 -- each stacked on top of --heat-floor,
// which is what `.gap-bar` already applies and which is per-theme for a
// measured reason (0.1 dark, 0.32 light: a low opacity that registers on
// near-black disappears on white). So the real minimum differed per screen
// while design.md and app.css both stated it was a token and not a constant.
//
// WHAT ELSE COULD SATISFY THIS? A grep for "0.08" would pass the moment
// someone wrote 0.09, and would say nothing about a fifth call site. So the
// check is on the SHAPE of every `--heat` assignment in the app: each one must
// be heatFor(), and heatFor must not clamp.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every line in src/ that assigns the --heat custom property. */
function heatAssignments() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) {
        const src = fs.readFileSync(p, 'utf8');
        src.split('\n').forEach((line, i) => {
          if (/'--heat'\s*:/.test(line)) {
            out.push({ file: path.relative(ROOT, p).replace(/\\/g, '/'), line: i + 1, text: line.trim(), src });
          }
        });
      }
    }
  };
  walk(path.join(ROOT, 'src'));
  return out;
}

/**
 * Is this assignment's value heatFor(), directly or through a local?
 *
 * components.js writes `const heat = heatFor(...)` and uses `heat` twice --
 * once for the custom property and once for the data-heat attribute -- so a
 * check demanding the call ON the assignment line failed the correct code.
 * Requiring the identifier to be initialised from heatFor in the same file
 * keeps the property (nothing computes heat itself) without dictating style.
 */
function goesThroughHeatFor(f) {
  if (/heatFor\(/.test(f.text)) return true;
  const m = f.text.match(/'--heat'\s*:\s*String\(\s*([A-Za-z_$][\w$]*)\s*\)/);
  if (!m) return false;
  return new RegExp(`\\b(const|let|var)\\s+${m[1]}\\s*=\\s*heatFor\\(`).test(f.src);
}

test('every --heat assignment goes through heatFor()', () => {
  const found = heatAssignments();
  // An empty result would make the assertion below vacuous, and the walk
  // silently finding nothing is a far more likely failure than the app losing
  // every heat bar.
  assert.ok(found.length >= 4, `only ${found.length} --heat assignments found; the walk is broken`);

  const rogue = found.filter((f) => !goesThroughHeatFor(f));
  assert.deepEqual(
    rogue.map((f) => `${f.file}:${f.line} ${f.text}`),
    [],
    'these compute heat themselves instead of calling heatFor()',
  );
});

test('no JS heat floor is stacked on top of the token', () => {
  const clamped = heatAssignments().filter((f) => /Math\.max\s*\(\s*0?\./.test(f.text));
  assert.deepEqual(
    clamped.map((f) => `${f.file}:${f.line} ${f.text}`),
    [],
    'the minimum is --heat-floor in tokens.css and is per-theme; a JS clamp overrides it with a constant',
  );
});

test('heatFor clamps to 1 and returns 0 for an absent value', () => {
  // The absent-value behaviour is NOT a floor and must survive: .gap-bar
  // carries data-heat="none" for it and renders no bar at all. A song that has
  // never been played must not get a floor-height bar invented for it.
  const src = fs.readFileSync(path.join(ROOT, 'src/ui/components.js'), 'utf8');
  const fn = src.slice(src.indexOf('export function heatFor'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.match(body, /return 0;/, 'heatFor must return 0 for an absent value');
  assert.match(body, /Math\.min\(1,/, 'heatFor must clamp to 1');
  assert.doesNotMatch(body, /Math\.max\(0?\.\d/, 'heatFor must not apply a floor of its own');
});

test('--heat-floor is defined per theme, not once', () => {
  const tokens = fs.readFileSync(path.join(ROOT, 'src/styles/tokens.css'), 'utf8');
  const dk = tokens.match(/--dk-heat-floor:\s*([\d.]+)/);
  const lt = tokens.match(/--lt-heat-floor:\s*([\d.]+)/);
  assert.ok(dk && lt, 'both --dk-heat-floor and --lt-heat-floor must exist');
  assert.notEqual(dk[1], lt[1], 'the two themes sharing a floor is the constant this replaced');
});
