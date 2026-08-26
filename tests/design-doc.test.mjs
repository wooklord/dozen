// Run: node --test
//
// docs/design.md copies values out of the code. Every copy nothing checks will
// drift, and the copy that drifts is the one being quoted at someone.
//
// The palette block went stale without anyone noticing for long enough that it
// contradicted its own document: it listed `--ink-faint` as #6E655B, which
// measures 3.29:1 on the shell, while a later section of the SAME file states
// that token is at its 4.5:1 floor and must not go dimmer. Both paragraphs read
// with equal authority. Only one was true.
//
// WHAT ELSE COULD SATISFY THIS? A block that fails to parse would compare zero
// tokens and pass. So the parse is asserted first, with a floor on how many
// tokens it must find -- an empty match is a failure, never a quiet success.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPalette } from '../scripts/contrast.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const design = fs.readFileSync(path.join(ROOT, 'docs/design.md'), 'utf8');

/** The `--token  #hex  description` lines in design.md's fenced palette block. */
function documentedPalette() {
  const out = {};
  for (const m of design.matchAll(/^--([a-z-]+)\s+(#[0-9a-fA-F]{3,8})\s/gm)) {
    out[m[1]] = m[2].toLowerCase();
  }
  return out;
}

test('the documented palette block parses', () => {
  const doc = documentedPalette();
  assert.ok(
    Object.keys(doc).length >= 6,
    `only ${Object.keys(doc).length} tokens found in design.md's palette block — a block that does not parse compares nothing and passes`,
  );
});

test('EVERY HEX IN design.md MATCHES tokens.css', () => {
  const doc = documentedPalette();
  const palette = readPalette();

  // design.md documents tokens both ways: the main palette block uses the
  // resolved name (`--ink-dim`, dark being the default theme) while the jam
  // section names both raw tokens (`--dk-jam`, `--lt-jam`) because the whole
  // point there is that the two themes diverge. Resolve either spelling rather
  // than only understanding one -- the version that understood only the first
  // reported the jam tokens as missing, which is a check inventing drift.
  const resolve = (token) => {
    const m = token.match(/^(dk|lt)-(.+)$/);
    return m ? palette[m[1]][m[2]] : palette.dk[token];
  };

  const drifted = [];
  for (const [token, hex] of Object.entries(doc)) {
    const actual = resolve(token);
    // A token the doc names that no longer exists is drift too, and the
    // loudest kind: it reads as documentation of something real.
    if (!actual) {
      drifted.push(`--${token} is documented as ${hex} but no such token exists in tokens.css`);
    } else if (actual.toLowerCase() !== hex) {
      drifted.push(`--${token}: design.md says ${hex}, tokens.css says ${actual}`);
    }
  }
  assert.deepEqual(drifted, [], 'docs/design.md has drifted from src/styles/tokens.css');
});

test('no doc still points at the renamed .build-marker class', () => {
  // Renamed to .status-chip precisely so nothing could read the cache-age chip
  // and believe it had found a BUILD number. A doc still naming the old class
  // sends the next person to write exactly that check.
  //
  // The historical record in CLAUDE.md is exempt BY CONTENT, not by file: those
  // mentions describe the rename as a past failure and name the current class.
  // Exempting the whole file would let a new stale instruction hide inside it.
  //
  // Judged on the enclosing PARAGRAPH, not the line. Prose wraps, so the
  // sentence that says "it is `status-chip` now" routinely lands on the line
  // after the mention -- a line-scoped version of this flagged both genuine
  // history entries in the repo and would have been argued down to an
  // exemption list, which is how a check stops checking.
  const files = ['README.md', 'docs/design.md', 'docs/plan.md', 'CLAUDE.md'];
  const hits = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (!/build-marker/.test(line)) return;
      let start = i;
      let end = i;
      while (start > 0 && lines[start - 1].trim()) start--;
      while (end < lines.length - 1 && lines[end + 1].trim()) end++;
      const para = lines.slice(start, end + 1).join(' ');
      const isHistory = /status-chip|used to|renamed|would have read|same class|no longer/i.test(para);
      if (!isHistory) hits.push(`${f}:${i + 1} ${line.trim().slice(0, 90)}`);
    });
  }
  assert.deepEqual(hits, [], 'these lines instruct a reader to use a class that does not exist');
});
