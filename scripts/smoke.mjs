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

  // --- Jam chart highlight + per-show jam entries ---------------------------
  //
  // 2024-12-31: 6 jam entries spread across Set 1, Set 2 and the encore. The
  // multi-set spread is the point -- for this show setlist order and
  // alphabetical order are DIFFERENT, so an accidental alphabetical sort
  // cannot pass. A single-set show would not discriminate.
  console.log('\njam chart highlight and entries:');
  await evaluate(`location.hash = '#/show/1728657865';`);
  await sleep(1200);

  const jam = await evaluate(`(() => {
    const songs = [...document.querySelectorAll('.setlist-song')];
    const marked = songs.filter((s) => s.dataset.jam === 'true');
    const plain = songs.filter((s) => s.dataset.jam !== 'true');
    const cs = (n) => getComputedStyle(n).color;
    const token = getComputedStyle(document.documentElement).getPropertyValue('--jam').trim();
    // Resolve the token through a throwaway node so the comparison is between
    // two rgb() strings rather than a hex against a computed colour.
    const probe = document.createElement('span');
    probe.style.color = token;
    document.body.appendChild(probe);
    const tokenRgb = getComputedStyle(probe).color;
    probe.remove();
    return {
      total: songs.length,
      marked: marked.length,
      markedNames: marked.map((s) => s.textContent),
      jamColor: marked.length ? cs(marked[0]) : null,
      plainColor: plain.length ? cs(plain[0]) : null,
      tokenRgb,
      sectionNames: [...document.querySelectorAll('.jam-card-song')].map((n) => n.textContent),
    };
  })()`);

  if (!jam || !jam.total) {
    fail('jam: the 2024-12-31 setlist did not render at all');
  } else {
    // The highlight is applied at all, and to the right number of songs.
    if (jam.marked !== 6) fail(`jam: expected 6 highlighted songs, found ${jam.marked}`);
    else pass(`6 setlist entries carry data-jam`);

    // A class with no CSS rule behind it would still set data-jam, so assert
    // the COLOUR, not the attribute -- and against the token specifically, so
    // "some colour got applied" cannot pass for "the jam colour got applied".
    if (jam.jamColor !== jam.tokenRgb) {
      fail(`jam: highlighted song is ${jam.jamColor}, --jam is ${jam.tokenRgb}`);
    } else if (jam.jamColor === jam.plainColor) {
      fail(`jam: highlighted and plain songs are both ${jam.jamColor}`);
    } else pass(`highlight ${jam.jamColor} differs from body ${jam.plainColor}`);

    // The section exists and has one card per highlighted song.
    if (jam.sectionNames.length !== jam.marked) {
      fail(`jam: ${jam.marked} highlighted songs but ${jam.sectionNames.length} entry cards`);
    } else pass(`${jam.sectionNames.length} entry cards under the setlist`);

    // THE ORDER CHECK. Compared against the rendered setlist itself rather
    // than a hardcoded list, so it tests the actual requirement: the entries
    // read in the order they were played. Also asserted NOT to be
    // alphabetical -- for this show those two orders differ, which is why
    // this show was chosen.
    const inSetlistOrder = JSON.stringify(jam.sectionNames) === JSON.stringify(jam.markedNames);
    const alpha = JSON.stringify([...jam.markedNames].sort());
    if (!inSetlistOrder) {
      fail(`jam: entries out of setlist order\n      setlist: ${jam.markedNames.join(', ')}\n      section: ${jam.sectionNames.join(', ')}`);
    } else if (JSON.stringify(jam.sectionNames) === alpha) {
      fail('jam: entries are alphabetical, not setlist order');
    } else pass(`entries in setlist order: ${jam.sectionNames.join(', ')}`);
  }

  // A show with NO jam entries must render no section at all, not an empty
  // one. 2019-12-14: 28 setlist rows, zero jam entries -- a long setlist on
  // purpose, so "rendered nothing" cannot be satisfied by the view having
  // failed to render. The setlist length is asserted for exactly that reason.
  await evaluate(`location.hash = '#/show/1627919708';`);
  await sleep(1100);
  const noJam = await evaluate(`(() => ({
    songs: document.querySelectorAll('.setlist-song').length,
    marked: document.querySelectorAll('.setlist-song[data-jam="true"]').length,
    cards: document.querySelectorAll('.jam-card-song').length,
    heading: (document.getElementById('main').innerText || '').toLowerCase().includes('jam chart entries'),
  }))()`);
  if (noJam.songs !== 28) fail(`jam: the no-jam show did not render (expected 28 songs, got ${noJam.songs})`);
  else if (noJam.marked !== 0) fail(`jam: expected 0 highlighted songs on this show, found ${noJam.marked}`);
  else if (noJam.cards || noJam.heading) fail('jam: a show with no entries rendered the section anyway');
  else pass('a show with 28 songs and no entries renders no section');

  // --- The same, in the light theme ----------------------------------------
  // The two themes do not share a hex, so a light-theme regression (a value
  // missing from one of the three mapping blocks) would be invisible here
  // otherwise. Both the colour AND its difference from body text are checked.
  console.log('\nlight theme:');
  await evaluate(`document.documentElement.setAttribute('data-theme', 'light');`);
  await evaluate(`location.hash = '#/show/1728657865';`);
  await sleep(1200);
  const lightJam = await evaluate(`(() => {
    const marked = document.querySelector('.setlist-song[data-jam="true"]');
    const plain = [...document.querySelectorAll('.setlist-song')].find((s) => s.dataset.jam !== 'true');
    const probe = document.createElement('span');
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--jam').trim();
    document.body.appendChild(probe);
    const tokenRgb = getComputedStyle(probe).color;
    probe.remove();
    return {
      jamColor: marked && getComputedStyle(marked).color,
      plainColor: plain && getComputedStyle(plain).color,
      tokenRgb,
    };
  })()`);
  if (!lightJam?.jamColor) fail('jam (light): no highlighted song found');
  else if (lightJam.jamColor !== lightJam.tokenRgb) {
    fail(`jam (light): song is ${lightJam.jamColor}, --jam is ${lightJam.tokenRgb}`);
  } else if (lightJam.jamColor === jam.jamColor) {
    fail(`jam (light): same hex as dark (${lightJam.jamColor}) — the light mapping is missing`);
  } else if (lightJam.jamColor === lightJam.plainColor) {
    fail(`jam (light): highlight and body text are both ${lightJam.jamColor}`);
  } else pass(`light highlight ${lightJam.jamColor} differs from dark and from body text`);
  await evaluate(`document.documentElement.removeAttribute('data-theme');`);

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
