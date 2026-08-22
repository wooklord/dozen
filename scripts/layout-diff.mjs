// Layout regression diff.  Run:  node scripts/layout-diff.mjs [ref] [width]
//
//   node scripts/layout-diff.mjs              HEAD at 390px
//   node scripts/layout-diff.mjs HEAD~3       three builds back
//   node scripts/layout-diff.mjs HEAD 1440    desktop
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
const PORT_A = 8700 + Math.floor(Math.random() * 100);
const PORT_B = 8800 + Math.floor(Math.random() * 100);
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
      out.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
      out.end(fs.readFileSync(f));
    });
    s.listen(port, () => res(s));
  });
}

// Every element class that carries visible layout. Position AND size, so a box
// that changed height without moving still shows up.
const PROBE = `(() => {
  const round = (n) => Math.round(n * 10) / 10;
  const out = [];
  for (const sel of [
    '.screen-title', '.section-title', '.card', '.btn', '.btn-small',
    '.setlist-song', '.setlist-label', '.fn-list li', '.venue-line',
    '.carton-link', '.info-link', '.stat', '.row-shell', '.tab', '.jam-card-song',
  ]) {
    document.querySelectorAll(sel).forEach((n, i) => {
      const r = n.getBoundingClientRect();
      out.push([sel + '#' + i, round(r.x), round(r.y), round(r.width), round(r.height)].join(' '));
    });
  }
  return out;
})()`;

let failures = 0;

const main = async () => {
  console.log(`layout-diff: ${REF} vs working tree, ${WIDTH}px\n`);
  execFileSync('git', ['worktree', 'add', '--detach', WORKTREE, REF], { cwd: ROOT, stdio: 'pipe' });

  const sA = await serve(WORKTREE, PORT_A);
  const sB = await serve(ROOT, PORT_B);

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
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true }))?.result?.value;

  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: 844, deviceScaleFactor: 2, mobile: WIDTH < 720,
  });

  const snap = async (port, label) => {
    process.stdout.write(`  booting ${label}`);
    await send('Page.navigate', { url: `http://localhost:${port}/#/home` });
    let booted = false;
    for (let i = 0; i < 90; i++) {
      await sleep(1500);
      process.stdout.write('.');
      if (await ev(`!document.querySelector('.loader')`)) { booted = true; break; }
    }
    console.log('');
    if (!booted) throw new Error(`${label} never finished booting`);
    const out = {};
    for (const r of ROUTES) {
      await ev(`location.hash = ${JSON.stringify(r.hash)}; window.scrollTo(0, 0);`);
      await sleep(900);
      out[r.hash] = await ev(PROBE);
    }
    return out;
  };

  const a = await snap(PORT_A, REF);
  const b = await snap(PORT_B, 'working tree');
  console.log('');

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

    const max = Math.max(A.length, B.length);
    const diffs = [];
    for (let i = 0; i < max; i++) {
      if (A[i] !== B[i]) diffs.push(`      ${REF}: ${A[i] ?? '(absent)'}\n      now : ${B[i] ?? '(absent)'}`);
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
  sA.close();
  sB.close();
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
