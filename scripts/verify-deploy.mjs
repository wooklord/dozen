// Deploy verification.  Run:  node scripts/verify-deploy.mjs [expectedBuild]
//
// Reads the BUILD number back off the LIVE host and reports what it actually
// found -- never what was set locally.
//
// WHY IT LOOKS IN THREE PLACES
// A check that hunts for a value in one specific position silently starts
// passing (or failing) for the wrong reason the moment that position moves.
// BUILD used to be a header chip; it is now a <meta> tag plus an entry in the
// Settings & data sheet. So this searches the WHOLE document for the meta,
// reads src/version.js independently, and confirms the number a person can
// actually reach in the UI. All three must agree.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { ROUTES } from './routes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = process.env.DOZEN_HOST || 'https://dozen.wooklord.net';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Expected build: argv, else whatever the working tree says.
const expected =
  process.argv[2] ||
  `0.1.${fs.readFileSync(path.join(ROOT, 'src/version.js'), 'utf8').match(/BUILD\s*=\s*(\d+)/)[1]}`;

console.log(`expecting BUILD ${expected} at ${HOST}\n`);

const bust = () => `?t=${Date.now()}`;
let failures = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => { failures++; console.log(`  FAIL  ${m}`); };

// --- 1. the meta tag, found ANYWHERE in the served HTML ---------------------
async function checkHtml() {
  const res = await fetch(HOST + '/' + bust(), { cache: 'no-store' });
  const html = await res.text();
  // Deliberately position-independent: any <meta name="dozen-build"> in the
  // document, in any attribute order.
  const m = html.match(/<meta[^>]*name=["']dozen-build["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']dozen-build["']/i);
  if (!m) return bad('no <meta name="dozen-build"> found anywhere in the served HTML');
  if (m[1] !== expected) return bad(`served HTML meta says ${m[1]}, expected ${expected}`);
  ok(`served HTML meta = ${m[1]}`);
}

// --- 2. src/version.js, the source of truth the app itself uses -------------
async function checkVersionJs() {
  const res = await fetch(`${HOST}/src/version.js${bust()}`, { cache: 'no-store' });
  if (!res.ok) return bad(`src/version.js returned ${res.status}`);
  const m = (await res.text()).match(/BUILD\s*=\s*(\d+)/);
  if (!m) return bad('could not read BUILD from the served src/version.js');
  const got = `0.1.${m[1]}`;
  if (got !== expected) return bad(`served version.js says ${got}, expected ${expected}`);
  ok(`served version.js = ${got}`);
}

// --- 3. what a person can actually reach in the UI --------------------------
async function checkRenderedUi() {
  const CHROME = [
    process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean).find((p) => fs.existsSync(p));
  if (!CHROME) { console.log('  skip  rendered UI check (no Chrome found)'); return; }

  const DEVPORT = 9500 + Math.floor(Math.random() * 400);
  const profile = path.join(os.tmpdir(), 'dozen-verify-' + Date.now());
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
    `--remote-debugging-port=${DEVPORT}`, `--user-data-dir=${profile}`,
    '--window-size=390,844', 'about:blank',
  ], { stdio: 'ignore' });

  try {
    await sleep(2500);
    const list = await (await fetch(`http://127.0.0.1:${DEVPORT}/json/list`)).json();
    const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
    let id = 0; const pending = new Map();
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
    await new Promise((r) => (ws.onopen = r));
    // EVERY CDP CALL IS TIMED OUT. Without this a dropped or lost reply leaves
    // the promise pending forever and the script exits with "unsettled
    // top-level await" -- no result, no failure, nothing to act on. That
    // happened on the first run of the live route walk: a check that hangs is
    // worse than one that fails, because it reports nothing at all.
    const CDP_TIMEOUT = 20000;
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const i = ++id;
        const timer = setTimeout(() => {
          pending.delete(i);
          reject(new Error(`CDP ${method} timed out after ${CDP_TIMEOUT}ms`));
        }, CDP_TIMEOUT);
        pending.set(i, (result) => { clearTimeout(timer); resolve(result); });
        try { ws.send(JSON.stringify({ id: i, method, params })); }
        catch (err) { clearTimeout(timer); pending.delete(i); reject(err); }
      });
    const ev = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true }))?.result?.value;

    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    // Cache-bust the NAVIGATION, not just the fetches above.
    //
    // This check once reported 0.1.33 while both file checks read 0.1.42 --
    // nine builds apart. The fetches carried `?t=` and got fresh copies; the
    // page navigation did not, and the browser was served a stale module from
    // a CDN edge mid-propagation. The check was right: at that moment a real
    // visitor was getting the old app. But it could not distinguish that from
    // a genuinely bad deploy, which is what this fixes.
    await send('Page.navigate', { url: HOST + '/' + bust() });
    let booted = false;
    for (let i = 0; i < 150; i++) {
      await sleep(2000);
      if (await ev(`!document.querySelector('.loader')`)) { booted = true; break; }
    }
    if (!booted) return bad('live app never finished booting');

    // Two taps: settings button, then read the build stat.
    const opened = await ev(
      `(() => { const b = document.querySelector('.header-status .icon-btn-bordered');
         if (!b) return false; b.click(); return true; })()`,
    );
    if (!opened) return bad('no settings control in the header');
    await sleep(800);

    const shown = await ev(
      `(() => {
         const labels = [...document.querySelectorAll('.sheet .stat-label')];
         const l = labels.find(x => x.textContent.trim().toLowerCase() === 'build');
         if (!l) return null;
         const v = l.parentElement.querySelector('.stat-value');
         return v ? v.textContent.trim() : null;
       })()`,
    );
    if (!shown) return bad('no BUILD entry reachable in the Settings & data sheet');
    if (shown !== expected) return bad(`sheet shows ${shown}, expected ${expected}`);
    ok(`reachable in the UI in two taps = ${shown}`);

    // --- 4. every route actually renders, live -----------------------------
    //
    // The three checks above all confirm ONE THING: that a build number
    // propagated. They do not establish that every module did. Pages is
    // CDN-fronted and edges do not flip together -- pushing 0.1.44, the live
    // site served a fresh version.js and a STALE views/show.js at the same
    // moment, which every build-number check happily passed.
    //
    // So the deploy gate also walks the routes and requires each to render its
    // own marker, exactly as the smoke test does locally. Same shared list, so
    // the two cannot disagree about what a route should say.
    for (const r of ROUTES) {
      await ev(`location.hash = ${JSON.stringify(r.hash)};`);
      await sleep(900);
      const text = String(await ev(`(document.getElementById('main').innerText || '')`));
      const boundary = await ev(
        `!!(document.querySelector('.banner strong') &&
            document.querySelector('.banner strong').textContent.includes('failed to load'))`,
      );
      if (boundary) bad(`${r.hash} rendered the error boundary on the live site`);
      else if (!text.toLowerCase().includes(r.expect.toLowerCase())) {
        bad(`${r.hash} did not render live (expected ${JSON.stringify(r.expect)})`);
      } else ok(`${r.hash} renders live`);
    }
  } finally {
    try { chrome.kill(); } catch {}
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch {}
  }
}

await checkHtml();
await checkVersionJs();
// A thrown check must FAIL the run, not abort it silently. Before this, a CDP
// timeout escaped as an unhandled rejection and the process exited without
// printing a verdict at all.
await checkRenderedUi().catch((err) => bad(`rendered UI check threw: ${err.message}`));

console.log('\n' + (failures ? `DEPLOY NOT VERIFIED — ${failures} problem(s)` : `DEPLOY VERIFIED — live BUILD is ${expected}`));
process.exit(failures ? 1 : 0);
