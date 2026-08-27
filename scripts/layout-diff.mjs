// Layout regression diff.  Run:  node scripts/layout-diff.mjs [ref] [width]
//
//   node scripts/layout-diff.mjs                    HEAD at 390px
//   node scripts/layout-diff.mjs HEAD~3             three builds back
//   node scripts/layout-diff.mjs HEAD 1440          desktop
//   node scripts/layout-diff.mjs HEAD 390 light     force the light theme
//
// THE THEME ARGUMENT IS NOT OPTIONAL POLISH. Without it this renders whatever
// the headless browser happens to default to, so a change that only applies in
// one theme would be "verified" by a run that never rendered it. That is a
// check passing for the wrong reason. Pass the theme whenever the change is
// theme-specific.
//
// WHAT IT ANSWERS
// "I changed one screen -- did anything ELSE move?" It renders every route
// twice, once from a git worktree at `ref` and once from the working tree, and
// diffs the geometry of every visible box. Untouched screens must come back
// byte-identical.
//
// WHY IT IS ON DEMAND AND NOT IN THE SMOKE RUN
// It goes red on any INTENDED layout change, which is most commits, so as a
// gate it would train you to ignore it. It also needs a worktree, two servers
// and two full cold boots -- minutes, not seconds. Run it when you have
// deliberately moved something and want to know what came along.
//
// IT LIED ONCE, AND THAT IS WHY IT COUNTS BOXES
// An earlier version reported a route "identical" when BOTH sides had rendered
// nothing -- two empty arrays compare equal. It read as proof that a screen was
// untouched when it was proof of nothing at all. Every route now reports how
// many boxes were compared, and a route that captured nothing on either side is
// a FAILURE, not a pass. Same trap as every other verification failure in this
// project: the check tested a side effect with more than one cause.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROUTES } from './routes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REF = process.argv[2] || 'HEAD';
const WIDTH = Number(process.argv[3] || 390);
const THEME = process.argv[4] || null; // 'light' | 'dark' | null (browser default)
// TWO ports, so the two builds are two ORIGINS. This matters more than it
// looks: served from one origin at the same urls, the second boot reused the
// FIRST build's parsed stylesheet -- it fetched the new CSS (verified) while
// still rendering the old one -- and every route diffed as identical. A false
// negative for any change at all. Cache-Control, Network.setCacheDisabled and
// ?nosw all failed to prevent it; separate origins do.
//
// The cost is that each boot pulls the archive itself: ~19 API requests per
// boot, ~38 per run. That trips The Carton's documented 60/minute limit if
// this is run more than about twice in a row, which surfaces as an error
// boundary. DO NOT run this in a tight loop -- wait a minute between runs.
const PORT_A = 8700 + Math.floor(Math.random() * 100);
const PORT_B = 8850 + Math.floor(Math.random() * 100);
const DEVPORT = 9700 + Math.floor(Math.random() * 200);
const PROFILE = path.join(os.tmpdir(), 'dozen-layout-' + Date.now());
const WORKTREE = path.join(os.tmpdir(), 'dozen-ref-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROME = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean).find((p) => fs.existsSync(p));
if (!CHROME) { console.error('No Chrome found. Set CHROME=/path/to/chrome'); process.exit(2); }

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png',
};

function serve(root, port) {
  return new Promise((res) => {
    const s = http.createServer((req, out) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const f = path.join(root, p);
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { out.writeHead(404); out.end('not found'); return; }
      out.writeHead(200, {
        'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream',
        // Both builds are served from ONE origin at the SAME urls, so without
        // this the second boot gets the first build's CSS out of Chrome's HTTP
        // disk cache and every route diffs as identical. ?nosw does not help:
        // it disables the service worker, not the HTTP cache.
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
      });
      out.end(fs.readFileSync(f));
    });
    s.listen(port, () => res(s));
  });
}

// Every element class that carries visible layout. Position AND size, so a box
// that changed height without moving still shows up.
//
// `.sortbar` and `.chip` were MISSING until 0.1.60, and their absence was
// invisible in the output: a chip bar is fixed-height and scrolls its contents
// horizontally, so adding, removing or resizing a chip moves nothing this
// probe was looking at, and the route still reported "identical". Two claims
// in the repo rested on that blind spot -- the chip tap-target change was
// recorded as "layout-diff reports every route byte-identical" when layout-diff
// had never once measured a chip. It happened to be true; it was not evidence.
// A selector list is only as good as the things it names.
const PROBE = `(() => {
  const round = (n) => Math.round(n * 10) / 10;
  const out = [];
  for (const sel of [
    '.screen-title', '.section-title', '.card', '.btn', '.btn-small',
    '.setlist-song', '.setlist-label', '.fn-list li', '.venue-line',
    '.carton-link', '.info-link', '.stat', '.row-shell', '.tab', '.jam-card-song',
    '.sortbar', '.chip',
  ]) {
    document.querySelectorAll(sel).forEach((n, i) => {
      const r = n.getBoundingClientRect();
      out.push([sel + '#' + i, round(r.x), round(r.y), round(r.width), round(r.height)].join(' '));
    });
  }
  return out;
})()`;

let failures = 0;
const fingerprints = {};

const main = async () => {
  console.log(`layout-diff: ${REF} vs working tree, ${WIDTH}px\n`);
  execFileSync('git', ['worktree', 'add', '--detach', WORKTREE, REF], { cwd: ROOT, stdio: 'pipe' });


  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
    `--remote-debugging-port=${DEVPORT}`, `--user-data-dir=${PROFILE}`,
    `--window-size=${WIDTH},844`, 'about:blank',
  ], { stdio: 'ignore' });

  await sleep(2500);
  const targets = await (await fetch(`http://127.0.0.1:${DEVPORT}/json/list`)).json();
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  };
  await new Promise((r) => (ws.onopen = r));
  const send = (method, params = {}) =>
    new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr, awaitPromise = false) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise }))?.result?.value;

  await send('Runtime.enable');
  // Belt and braces with the no-store headers above: the browser must not
  // reuse ANYTHING between the two builds, which share an origin and urls.
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: 844, deviceScaleFactor: 2, mobile: WIDTH < 720,
  });

  const snap = async (port, label) => {
    process.stdout.write(`  booting ${label}`);
    // ?nosw IS LOAD-BEARING HERE, not hygiene.
    //
    // Both boots share one origin (see PORT above), so the service worker the
    // FIRST boot registers stays active and serves ITS cached shell to the
    // second. The second snapshot then renders the reference build's CSS and
    // every route diffs as identical -- a false negative for any change at
    // all. This tool briefly reported exactly that.
    // ?nosw IS LOAD-BEARING HERE, not hygiene.
    //
    // Both boots share one origin (see PORT above), so the service worker the
    // FIRST boot registers stays active and serves ITS cached shell to the
    // second. The second snapshot then renders the REFERENCE build's CSS and
    // every route diffs as identical -- a false negative for any change at
    // all. This tool briefly reported exactly that before the flag was added.
    await send('Page.navigate', { url: `http://localhost:${port}/?nosw#/home` });
    let booted = false;
    for (let i = 0; i < 90; i++) {
      await sleep(1500);
      process.stdout.write('.');
      if (await ev(`!!document.querySelector('#main .screen')`)) { booted = true; break; }
    }
    console.log('');
    if (!booted) throw new Error(`${label} never finished booting`);

    // SELF-CHECK INPUT: fingerprint the stylesheets this side actually got.
    // The tool once fetched the new CSS while still applying the OLD parsed
    // sheet, and reported every route identical -- a false negative for any
    // change at all. Comparing fingerprints catches that directly, rather than
    // trusting that a different server implies different styles.
    // CR IS STRIPPED BEFORE MEASURING, and that is the whole check working.
    // `git worktree add` honours core.autocrlf, which is true on the machine
    // this runs on, so the ref side is served CRLF and the working tree LF.
    // The raw lengths therefore differed by exactly one byte per line -- 1502
    // for app.css, 344 for tokens.css -- on every run, CSS change or not. The
    // guard below fires only when the fingerprints MATCH, so a difference that
    // can never go away is a guard that can never fire: it had no way to
    // report the false negative it exists for. Normalising line endings is
    // what makes equal mean equal.
    fingerprints[label] = await ev(
      `Promise.all(['/src/styles/tokens.css', '/src/styles/app.css'].map((u) =>
         fetch(u, { cache: 'no-store' }).then((r) => r.text()).then((t) => t.replace(/\\r/g, '').length)
       )).then((n) => n.join('/'))`,
      true,
    );
    globalThis.__diagLabel = label;
    if (THEME) {
      await ev(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(THEME)});`);
      await sleep(400);
      const got = await ev(`document.documentElement.getAttribute('data-theme')`);
      if (got !== THEME) throw new Error(`could not force theme ${THEME} (got ${got})`);
    }

    const out = {};
    for (const r of ROUTES) {
      await ev(`location.hash = ${JSON.stringify(r.hash)}; window.scrollTo(0, 0);`);
      // WAIT FOR THE ROUTE TO ACTUALLY RENDER before measuring it. Probing a
      // half-rendered screen produced a snapshot missing whole elements, and
      // because boxes were compared index-by-index a single missing element
      // shifted every later one -- reporting "54 of 54 boxes changed" for a
      // change that touched none of them. Two runs of the same comparison
      // disagreed, which is how this was caught.
      // Text AND selector, where the route carries one -- see routes.mjs.
      // Show detail's text marker is not unique on its own.
      let rendered = false;
      for (let i = 0; i < 20; i++) {
        await sleep(300);
        const text = String(await ev(`(document.getElementById('main').innerText || '')`));
        const selOk = !r.selector || (await ev(`!!document.querySelector(${JSON.stringify(r.selector)})`));
        if (text.toLowerCase().includes(r.expect.toLowerCase()) && selOk) { rendered = true; break; }
      }
      if (!rendered) {
        // A failing check must say what it FOUND, not just that it failed.
        const saw = await ev(`(() => {
          const main = document.getElementById('main');
          return {
            hash: location.hash,
            screens: document.querySelectorAll('#main .screen').length,
            loader: !!document.querySelector('.loader'),
            banner: !!document.querySelector('.banner'),
            text: (main.innerText || '').replace(/\\s+/g, ' ').slice(0, 160),
          };
        })()`);
        throw new Error(
          `${label}: ${r.hash} never rendered its marker (${JSON.stringify(r.expect)})\n` +
          `      hash=${saw.hash} screens=${saw.screens} loader=${saw.loader} banner=${saw.banner}\n` +
          `      saw: ${JSON.stringify(saw.text)}`,
        );
      }
      await sleep(250);
      out[r.hash] = await ev(PROBE);
    }
    return out;
  };

  // closeAllConnections() IS REQUIRED, not tidiness.
  //
  // server.close() only stops NEW connections; the browser's keep-alive socket
  // to the first server stays open and that server keeps answering on it. The
  // second boot then loaded the REFERENCE build's files over the old socket
  // while believing it was on the new server, and every route diffed as
  // identical. A false negative for any change at all.
  const sA = await serve(WORKTREE, PORT_A);
  const sB = await serve(ROOT, PORT_B);
  const a = await snap(PORT_A, REF);
  const b = await snap(PORT_B, 'working tree');
  console.log('');

  // If the working tree differs from the ref in CSS but both sides rendered
  // byte-identical stylesheets, this run proved nothing and must say so.
  const cssChanged = execFileSync('git', ['diff', '--name-only', REF, '--', 'src/styles'], { cwd: ROOT })
    .toString().trim();
  const fpA = fingerprints[REF];
  const fpB = fingerprints['working tree'];
  console.log(`  stylesheets: ${REF}=${fpA}  working tree=${fpB}`);
  if (cssChanged && fpA === fpB) {
    failures++;
    console.log(`  SELF-CHECK FAILED: git reports CSS changes (${cssChanged.replace(/\s+/g, ', ')})`);
    console.log('  but both sides rendered identical stylesheets — this run cannot detect anything.');
  }

  let changed = 0;
  for (const r of ROUTES) {
    const A = a[r.hash] || [];
    const B = b[r.hash] || [];

    // A route that captured nothing on BOTH sides diffs as equal and proves
    // nothing. It is a failure, never a pass.
    if (!A.length && !B.length) {
      failures++;
      console.log(`  NO BOXES   ${r.hash}  <- captured nothing on either side; this route proved nothing`);
      continue;
    }

    // MULTISET comparison, not index-aligned.
    //
    // Index alignment cascades: one added or removed box renames every later
    // one, and a change touching nothing reports the whole route as changed.
    // That happened -- two runs of the same comparison disagreed, one saying
    // "7 of 54" and the next "54 of 54". Set difference isolates exactly what
    // appeared and what disappeared.
    const countOf = (arr) => arr.reduce((m, k) => m.set(k, (m.get(k) || 0) + 1), new Map());
    const ca = countOf(A);
    const cb = countOf(B);
    const gone = [];
    const added = [];
    for (const [k, n] of ca) { const d = n - (cb.get(k) || 0); for (let i = 0; i < d; i++) gone.push(k); }
    for (const [k, n] of cb) { const d = n - (ca.get(k) || 0); for (let i = 0; i < d; i++) added.push(k); }
    const max = Math.max(A.length, B.length);
    const diffs = [];
    for (let i = 0; i < Math.max(gone.length, added.length); i++) {
      diffs.push(`      ${REF}: ${gone[i] ?? '(none)'}\n      now : ${added[i] ?? '(none)'}`);
    }
    if (!diffs.length) {
      console.log(`  identical  ${r.hash}  (${A.length} boxes)`);
    } else {
      changed++;
      console.log(`  CHANGED    ${r.hash}  (${diffs.length} of ${max} boxes)`);
      diffs.slice(0, 8).forEach((d) => console.log(d));
      if (diffs.length > 8) console.log(`      … ${diffs.length - 8} more`);
    }
  }

  console.log(
    `\n${changed} route(s) changed, ${ROUTES.length - changed - failures} identical` +
    (failures ? `, ${failures} PROVED NOTHING` : ''),
  );
  console.log('Changed routes are only a problem if you did not intend them.');

  try { chrome.kill(); } catch {}
  sA.closeAllConnections(); sA.close();
  sB.closeAllConnections(); sB.close();
};

main()
  .catch((err) => { failures++; console.error(`\nlayout-diff failed: ${err.message}`); })
  .finally(() => {
    // Best effort; a cleanup failure must never mask the result.
    try { execFileSync('git', ['worktree', 'remove', '--force', WORKTREE], { cwd: ROOT, stdio: 'pipe' }); } catch {}
    try { execFileSync('git', ['worktree', 'prune'], { cwd: ROOT, stdio: 'pipe' }); } catch {}
    try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 3 }); } catch {}
    process.exit(failures ? 1 : 0);
  });
