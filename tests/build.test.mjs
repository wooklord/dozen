// Run: node --test
//
// The BUILD number now lives in two places: src/version.js (the source of
// truth, used by the app) and a <meta> tag in index.html (so a deploy can be
// verified with a plain fetch, no browser needed).
//
// Duplication is only safe if drift is impossible to miss. Bump one without
// the other and this test fails immediately, rather than the deploy check
// quietly reporting a stale number forever.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function buildFromVersionJs() {
  const m = read('src/version.js').match(/export const BUILD\s*=\s*(\d+)/);
  assert.ok(m, 'src/version.js must export a numeric BUILD');
  return `0.1.${m[1]}`;
}

function buildFromHtml() {
  const m = read('index.html').match(/<meta\s+name="dozen-build"\s+content="([^"]+)"/);
  assert.ok(m, 'index.html must carry a <meta name="dozen-build"> tag');
  return m[1];
}

test('index.html carries the build number in the served HTML', () => {
  assert.match(buildFromHtml(), /^0\.1\.\d+$/);
});

test('THE META TAG AND version.js AGREE', () => {
  assert.equal(
    buildFromHtml(),
    buildFromVersionJs(),
    'index.html <meta name="dozen-build"> is out of step with src/version.js — bump both',
  );
});

test('the service worker cache version tracks the build', () => {
  const sw = read('sw.js').match(/CACHE_VERSION\s*=\s*'dozen-shell-v(\d+)'/);
  assert.ok(sw, 'sw.js must define CACHE_VERSION');
  const build = buildFromVersionJs().split('.').pop();
  assert.equal(
    sw[1],
    build,
    'sw.js CACHE_VERSION is out of step with BUILD — a stale shell would be served',
  );
});

// The label past two digits (2026-10-27). BUILD_LABEL is assembled from the
// integer in src/version.js, so this evaluates THAT FILE'S OWN SOURCE with the
// integer swapped for 100 and for 1000: the expression under test is the
// shipped one, not a copy of it here. The swapped module must report the
// swapped BUILD, or a swap that matched nothing would hand back today's label
// and fail for the wrong reason -- or, at BUILD 100 itself, pass for one.
async function labelFor(n) {
  const src = read('src/version.js');
  const re = /export const BUILD\s*=\s*\d+/;
  assert.match(src, re, 'src/version.js must declare `export const BUILD = <int>` for the swap');
  const mod = await import(`data:text/javascript,${encodeURIComponent(src.replace(re, `export const BUILD = ${n}`))}`);
  assert.equal(mod.BUILD, n, `the swapped module reads BUILD ${mod.BUILD}, not ${n}`);
  return mod.BUILD_LABEL;
}

test('the BUILD label carries every digit at three and four digits', async () => {
  assert.equal(await labelFor(100), 'BUILD 0.1.100');
  assert.equal(await labelFor(1000), 'BUILD 0.1.1000');
});
