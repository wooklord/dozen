// Run: node --test
//
// Keeps the config module honest.
//
// "Site name and API base live in one config module, no hardcoded strings
// elsewhere" was stated from Task 0 and was NEVER true: two base-URL
// declarations sat in two files and no site-name constant existed at all. The
// rule got cited repeatedly as though it were a guarantee.
//
// Same reasoning as the BUILD meta tag: duplication is only safe when drift is
// impossible. This is a claim that can quietly stop being true, so it is
// enforced rather than described.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const CONFIG = path.join(SRC, 'config.js');

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? jsFiles(full) : full.endsWith('.js') ? [full] : [];
  });
}

// Any appearance at all, including inside comments. Deliberately strict: a
// looser rule ("only in string literals") is one someone can satisfy while
// still hardcoding a host, and the whole point is that nothing else can
// satisfy this check.
const FORBIDDEN = [/thecarton\.net/i, /google\.com/i];

test('no external host literal appears in src/ outside config.js', () => {
  const offenders = [];
  for (const file of jsFiles(SRC)) {
    if (path.resolve(file) === path.resolve(CONFIG)) continue;
    const src = fs.readFileSync(file, 'utf8');
    src.split('\n').forEach((line, i) => {
      for (const re of FORBIDDEN) {
        if (re.test(line)) {
          offenders.push(`${path.relative(ROOT, file)}:${i + 1}  ${line.trim().slice(0, 90)}`);
        }
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    'external host literals must live only in src/config.js:\n  ' + offenders.join('\n  '),
  );
});

test('config.js actually exports what the rule promises', async () => {
  const cfg = await import('../src/config.js');
  for (const key of ['SITE_NAME', 'CARTON_BASE', 'CARTON_API_BASE', 'MAPS_SEARCH_BASE']) {
    assert.equal(typeof cfg[key], 'string', `config must export ${key}`);
    assert.ok(cfg[key].length > 0, `${key} must not be empty`);
  }
});

test('the API base is derived from the site base, not restated', () => {
  const src = fs.readFileSync(CONFIG, 'utf8');
  assert.match(
    src,
    /CARTON_API_BASE\s*=\s*`\$\{CARTON_BASE\}/,
    'CARTON_API_BASE should build on CARTON_BASE so the host exists once',
  );
});

test('the Maps base is the key-less documented search form', async () => {
  const { MAPS_SEARCH_BASE } = await import('../src/config.js');
  assert.ok(MAPS_SEARCH_BASE.includes('api=1'));
  assert.ok(MAPS_SEARCH_BASE.endsWith('query='));
  assert.ok(!/key=/.test(MAPS_SEARCH_BASE), 'no API key belongs in an outbound link');
});
