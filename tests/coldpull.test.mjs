// Run: node --test
//
// COLD_PULL_STEPS has to equal the number of fetch-phase steps the cold pull
// actually emits, because src/app.js splits the loading carton's twelve cells
// by it. It did not: `albums` was added as a sixth pull and six places in the
// repo still said five, including the loader, which filled a sixth cell and
// then took it back on verification's first progress event.
//
// THE COUNT IS OBSERVED, NOT READ. An earlier draft of this test grepped
// source.js for `step(` calls -- which would have passed just as happily on a
// step() that no longer wraps a fetch, and would break on a comment mentioning
// step(). This runs fetchFullArchive against a stubbed global fetch and counts
// the events it really emits. Nothing here restates the number six except the
// assertion target itself, which comes out of the module.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchFullArchive, COLD_PULL_STEPS } from '../src/data/source.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/**
 * Enough of a Carton response to get through the pull.
 *
 * Verification is switched OFF for this test: it fires 14 more requests and
 * asserts row counts, none of which is what this file is about. The fetch
 * phase is the only phase under test and mixing the two in would make a
 * failure ambiguous.
 */
function stubFetch() {
  const real = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    const rows = String(url).includes('setlists')
      ? [{ showdate: '2013-02-23', show_id: 1, songid: 1, song: 'A' },
         { showdate: '2026-08-14', show_id: 2, songid: 1, song: 'A' }]
      : [{ id: 1 }];
    return {
      ok: true,
      status: 200,
      headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
      json: async () => ({ error: false, data: rows }),
      text: async () => JSON.stringify({ error: false, data: rows }),
    };
  };
  return { urls, restore: () => { globalThis.fetch = real; } };
}

test('COLD_PULL_STEPS equals the fetch-phase events the pull really emits', async () => {
  const stub = stubFetch();
  const labels = [];
  try {
    await fetchFullArchive({
      verify: false,
      onProgress: (p) => { if (p.phase === 'fetch') labels.push(p.label); },
    });
  } finally {
    stub.restore();
  }
  assert.equal(
    labels.length,
    COLD_PULL_STEPS,
    `the cold pull emitted ${labels.length} fetch steps (${labels.join(', ')}) but COLD_PULL_STEPS says ${COLD_PULL_STEPS}`,
  );
});

test('the loader splits its twelve cells so no cell can un-fill', () => {
  // The bug was arithmetic, not a typo: fill(filled) reached 6 and the verify
  // branch then called fill(COLD_PULL_STEPS + 0). Any split where the verify
  // phase starts BELOW the number of pulls makes a filled cell go dark.
  // Matched against the loader lines only, not the whole module: asserting on
  // 20 KB of source prints 20 KB on failure, and a failure nobody can read is
  // most of the way to a failure nobody acts on.
  const app = read('src/app.js');
  const fillLines = app.split('\n').filter((l) => /VERIFY_CELLS|loader\.fill\(|\+ frac \*/.test(l)).join('\n');

  assert.match(fillLines, /VERIFY_CELLS\s*=\s*12\s*-\s*COLD_PULL_STEPS/,
    'app.js must derive the verify cells from COLD_PULL_STEPS');
  assert.match(fillLines, /COLD_PULL_STEPS \+ frac \* VERIFY_CELLS/,
    'the verify phase must start where the pulls ended');
  assert.doesNotMatch(fillLines, /\b\d+\s*\+ frac/,
    'a literal start for the verify phase is what broke this the first time');
});

test('no doc still claims a five-request cold pull', () => {
  // The count is copied into prose in four files. A copy nothing checks will
  // drift, and the copy that drifts is the one being quoted at someone.
  const docs = ['README.md', 'docs/plan.md', 'docs/design.md', 'CLAUDE.md'];
  const stale = [];
  for (const f of docs) {
    const text = read(f);
    for (const m of text.matchAll(/\b(\w+|\d+)[ -]*(?:requests?|pulls)\b/gi)) {
      const word = m[1].toLowerCase();
      if (word === '5' || word === 'five') {
        const line = text.slice(0, m.index).split('\n').length;
        stale.push(`${f}:${line} "${m[0].trim()}"`);
      }
    }
  }
  assert.deepEqual(
    stale,
    [],
    `the cold pull is ${COLD_PULL_STEPS} requests; these still say five`,
  );
});
