// Route smoke test.  Run:  node scripts/smoke.mjs
//
// WHY THIS EXISTS
// A missing import in views/gapchart.js shipped in three consecutive releases.
// The view threw, route() abandoned the render, and the screen simply stayed
// where it was -- a dead-looking button and nothing else. The old ad-hoc
// checks missed it for two reasons, and this script fixes both:
//
//   1. They did not visit every route. Screens were spot-checked, and the gap
//      chart was not in the sweep after the regression landed.
//   2. Taking a screenshot "succeeded" even when the route never rendered,
//      because the PREVIOUS screen was still on display. A green run proved
//      nothing.
//
// So every route is visited, and each must render its OWN expected marker.
// Uncaught exceptions and console.error are failures. The error boundary's
// banner appearing anywhere is a failure. Exits non-zero so it can gate a push.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8123 + Math.floor(Math.random() * 400);
const DEVPORT = 9123 + Math.floor(Math.random() * 400);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Throwaway profile in the OS temp dir, not the repo.
const PROFILE = path.join(os.tmpdir(), 'dozen-smoke-' + Date.now());

const CHROME_CANDIDATES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const CHROME = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!CHROME) {
  console.error('No Chrome found. Set CHROME=/path/to/chrome');
  process.exit(2);
}

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png',
};

// Each route must render text unique to ITSELF. A marker that also appears on
// the previous screen would let a failed render pass.
const ROUTES = [
  { hash: '#/home', expect: 'On this date' },
  { hash: '#/songs', expect: 'songs in the archive' },
  { hash: '#/shows', expect: 'shows in the archive' },
  { hash: '#/jams', expect: 'Jam charts' },
  { hash: '#/picks', expect: 'Your picks' },
  { hash: '#/song/49', expect: 'Where it has landed' },
  { hash: '#/venue/73', expect: 'Every show' },
];

// Redirects must land somewhere real, not just change the hash.
const REDIRECTS = [
  { from: '#/gap', to: '#/songs' },
  { from: '#/recent', to: '#/shows' },
  { from: '#/', to: '#/home' },
];

// The four ways into a gap chart. Each is clicked for real.
const GAP_ENTRY_POINTS = [
  { name: 'Shows card', at: '#/shows',
    click: `[...document.querySelectorAll('.btn-small')].find(b => b.textContent.trim() === 'Gap chart')` },
  { name: 'show detail', at: null, // filled in at runtime from a real show id
    click: `[...document.querySelectorAll('.btn-small')].find(b => b.textContent.trim() === 'Gap chart')` },
  { name: 'Home venue history', at: '#/home',
    click: `[...document.querySelectorAll('.btn-small')].find(b => b.textContent.trim() === 'Gap chart')` },
  { name: 'song performance row', at: '#/song/49',
    click: `document.querySelector('.row-action')` },
];

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});

let failures = 0;
const problems = [];
const fail = (msg) => { failures++; problems.push(msg); console.log(`  FAIL  ${msg}`); };
const pass = (msg) => console.log(`  ok    ${msg}`);

server.listen(PORT, async () => {
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
    `--remote-debugging-port=${DEVPORT}`,
    `--user-data-dir=${PROFILE}`,
    '--window-size=390,844', 'about:blank',
  ], { stdio: 'ignore' });

  await sleep(2500);
  const targets = await (await fetch(`http://127.0.0.1:${DEVPORT}/json/list`)).json();
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);

  let id = 0;
  const pending = new Map();
  const runtimeErrors = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      runtimeErrors.push('uncaught: ' + (d.exception?.description || d.text).split('\n')[0]);
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      runtimeErrors.push('console.error: ' + m.params.args.map((a) => a.description || a.value).join(' ').split('\n')[0]);
    }
  };
  await new Promise((r) => (ws.onopen = r));
  const send = (method, params = {}) =>
    new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) =>
    (await send('Runtime.evaluate', { expression, returnByValue: true }))?.result?.value;

  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: `http://localhost:${PORT}/` });

  process.stdout.write('booting (cold pull + verification)');
  let booted = false;
  for (let i = 0; i < 150; i++) {
    await sleep(2000);
    process.stdout.write('.');
    if (await evaluate(`!document.querySelector('.loader')`)) { booted = true; break; }
  }
  console.log('');
  if (!booted) { fail('app never finished booting'); finish(chrome); return; }

  const screenText = `(document.getElementById('main').innerText || '')`;
  const errorBanner = `!!(document.querySelector('.banner strong') &&
    document.querySelector('.banner strong').textContent.includes('failed to load'))`;

  console.log('\nroutes:');
  for (const r of ROUTES) {
    await evaluate(`location.hash = ${JSON.stringify(r.hash)};`);
    await sleep(900);
    const text = await evaluate(screenText);
    const boundary = await evaluate(errorBanner);
    if (boundary) fail(`${r.hash} rendered the error boundary`);
    else if (!String(text).toLowerCase().includes(r.expect.toLowerCase())) {
      // Case-insensitive on purpose: several markers live in .section-title,
      // which is text-transform: uppercase, and innerText reports RENDERED
      // casing rather than source casing.
      fail(`${r.hash} did not render (expected text ${JSON.stringify(r.expect)})`);
    } else pass(`${r.hash}`);
  }

  console.log('\nredirects:');
  for (const r of REDIRECTS) {
    await evaluate(`location.hash = ${JSON.stringify(r.from)};`);
    await sleep(900);
    const landed = await evaluate('location.hash');
    if (landed !== r.to) fail(`${r.from} -> ${landed}, expected ${r.to}`);
    else pass(`${r.from} -> ${r.to}`);
  }


  console.log('\ngap chart, all four entry points:');
  for (const ep of GAP_ENTRY_POINTS) {
    const at = ep.at || '#/shows';
    await evaluate(`location.hash = ${JSON.stringify(at)};`);
    await sleep(1000);
    if (!ep.at) {
      // show detail: reach it from a Shows card first
      const opened = await evaluate(
        `(() => { const b = [...document.querySelectorAll('.btn-small')].find(x => x.textContent.trim() === 'Show detail');
           if (!b) return false; b.click(); return true; })()`,
      );
      if (!opened) { fail(`${ep.name}: could not open show detail`); continue; }
      await sleep(900);
    }
    const clicked = await evaluate(`(() => { const b = ${ep.click}; if (!b) return false; b.click(); return true; })()`);
    if (!clicked) { fail(`${ep.name}: no gap chart control found`); continue; }
    await sleep(1100);
    const hash = await evaluate('location.hash');
    const text = String(await evaluate(screenText));
    const boundary = await evaluate(errorBanner);
    if (!String(hash).startsWith('#/gapchart/')) fail(`${ep.name}: did not navigate (hash ${hash})`);
    else if (boundary) fail(`${ep.name}: gap chart rendered the error boundary`);
    else if (!text.toLowerCase().includes('gap chart')) fail(`${ep.name}: gap chart did not render`);
    else pass(`${ep.name} -> ${hash}`);
  }

  console.log('\nruntime errors:');
  if (runtimeErrors.length) {
    for (const e of [...new Set(runtimeErrors)]) fail(e);
  } else pass('none');

  console.log('\n' + (failures ? `SMOKE FAILED — ${failures} problem(s)` : 'SMOKE PASSED — all routes rendered'));
  finish(chrome);

  function finish(proc) {
    try { proc.kill(); } catch {}
    // Best effort. Chrome may still hold the profile directory, and a cleanup
    // failure must never mask the smoke result.
    try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 3 }); } catch {}
    server.close(() => process.exit(failures ? 1 : 0));
    setTimeout(() => process.exit(failures ? 1 : 0), 1500).unref();
  }
});
