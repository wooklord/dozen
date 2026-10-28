// Wait for a push to land.  Run:  node scripts/wait-deploy.mjs [expectedBuild] [timeoutSeconds]
//
// Polls the LIVE src/version.js every 10 seconds until its BUILD integer
// equals the one in the working tree, then exits 0. Exits 1 on timeout.
// It is the cheap "has Pages finished building yet" wait that goes BEFORE
// `verify-deploy.mjs`; it proves one file at one CDN edge carries the new
// number and nothing more. The three-place check is still the verdict.
//
// WHY IT COMPARES INTEGERS
// `src/version.js` stores `BUILD = 82`, a bare patch integer; the label
// "0.1.82" is assembled from it. The first version of this poll was a shell
// loop grepping the served file for the string "0.1.82", which the file never
// contains. It ran out its full timeout against a host that had already
// flipped, and reported "still not 0.1.82". A check that cannot pass is as
// useless as one that cannot fail -- see "The recurring failure" in CLAUDE.md.
// So the expected value is read out of the same file with the same regex the
// live read uses, and the two integers are compared directly.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = process.env.DOZEN_HOST || 'https://dozen.wooklord.net';
// Anchored to the declaration line. Unanchored, the first `BUILD = n` anywhere
// in the file won -- a comment above the declaration included.
const BUILD_RE = /^export const BUILD\s*=\s*(\d+);?\s*$/m;
const INTERVAL_MS = 10_000;

const readBuild = (text) => {
  const m = text.match(BUILD_RE);
  return m ? Number(m[1]) : null;
};

// Expected build: argv as either "82" or "0.1.82", else the working tree.
const arg = process.argv[2];
const expected = arg
  ? Number(String(arg).split('.').pop())
  : readBuild(fs.readFileSync(path.join(ROOT, 'src/version.js'), 'utf8'));
const timeoutS = Number(process.argv[3] || 300);

if (!Number.isInteger(expected)) {
  console.error(`could not derive an expected BUILD integer from ${arg ?? 'src/version.js'}`);
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 19);
const deadline = Date.now() + timeoutS * 1000;

console.log(`waiting for BUILD ${expected} at ${HOST}/src/version.js (timeout ${timeoutS}s)`);

while (true) {
  let got = null;
  let note = '';
  try {
    const res = await fetch(`${HOST}/src/version.js?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) note = `http ${res.status}`;
    else {
      got = readBuild(await res.text());
      if (got === null) note = 'no BUILD = <int> in the served file';
    }
  } catch (e) {
    note = e.message;
  }
  console.log(`  ${stamp()}  served BUILD = ${got ?? '?'}${note ? `  (${note})` : ''}`);
  if (got === expected) {
    console.log(`LIVE: version.js reads BUILD ${got} -- now run verify-deploy.mjs for the verdict`);
    process.exit(0);
  }
  if (Date.now() + INTERVAL_MS > deadline) {
    console.log(`TIMEOUT after ${timeoutS}s: served BUILD is ${got ?? '?'}, expected ${expected}`);
    process.exit(1);
  }
  await sleep(INTERVAL_MS);
}
