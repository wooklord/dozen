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
import { ROUTES, REDIRECTS } from './routes.mjs';
import { parseSongPage } from './gap-oracle.mjs';

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

// The four ways into a gap chart, as of 0.1.48. Each is clicked for real.
//
// The Home and Shows CARDS used to carry a Gap chart button and no longer do
// -- those cards are an entry point, not a control panel, and the button
// duplicated one on show detail. What remains is checked here, and the
// now-absent ones are asserted absent below, because "the button is gone" and
// "the route is unreachable" are different claims.
const GAP_ENTRY_POINTS = [
  { name: 'show detail', at: null, // filled in at runtime from a real show id
    click: `[...document.querySelectorAll('.btn-small')].find(b => b.textContent.trim() === 'Gap chart')` },
  // THE SHOWS ROW IS NOT AN ENTRY POINT. The Shows tab's compact rows (every
  // show, as of 0.1.82; search results only, 0.1.64 to 0.1.81) carry no gap
  // chart control: a row is an entry point to a show, and the gap chart lives
  // one tap further in, on show detail -- the same reasoning that took the
  // button off the Home and Shows cards. So there are three entry points, not
  // four, and the Shows section asserts the rows carry no .row-action.
  { name: 'song performance row', at: '#/song/49',
    click: `document.querySelector('.row-action')` },
  { name: 'venue show row', at: '#/venue/73',
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
// A SKIP IS NOT A PASS AND MUST NOT PRINT AS ONE.
//
// The Carton cross-check routed its unreachable case through pass(), so an
// unverified claim rendered as "ok    SKIPPED — ...". That is this repo's
// entire recurring failure in miniature: a green line reporting health that
// was never established, in the suite written to stop exactly that.
//
// Skips do not affect the exit code -- an unreachable third party is not a
// defect here -- but they are counted and repeated in the summary, so a run
// that checked less than it looks like cannot be read as a clean one.
let skips = 0;
const skip = (msg) => { skips++; console.log(`  SKIP  ${msg}`); };

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
  // Same thing, but resolves a promise instead of handing back "[object
  // Object]". Anything touching navigator.serviceWorker or caches is async and
  // MUST use this -- the plain one silently returns the unresolved promise,
  // which stringifies to something truthy and quietly passes a check.
  const evaluateAsync = async (expression) =>
    (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))?.result?.value;

  // --- Shows controls (0.1.82): page-side helpers and drivers -----------------
  //
  // The Shows tab is driven the way a thumb drives it: the lead chip, then the
  // sheet. A lead is found by its data-lead name -- the When chip carries no
  // label (docs/plan.md, 0.1.82 (a) as amended), so a label lookup would miss
  // exactly the chip whose state the When checks read -- and its state is its
  // .chip-value span, read with the non-breaking space in "N on" normalised.
  // The View choice persists in localStorage, so every section that needs
  // cards or rows on Shows SETS the view it needs rather than assuming what the
  // previous section left behind.
  const SHOWS_JS = `
    const leadBy = (name) => document.querySelector('.screen .sortbar .chip-lead[data-lead="' + name + '"]');
    const leadVal = (name) => { const c = leadBy(name); const v = c && c.querySelector('.chip-value'); return v ? v.textContent.trim().replace(/\\u00a0/g, ' ') : null; };
    const sheetOption = (name) => [...document.querySelectorAll('.sheet .sheet-option')].find((x) => ((x.querySelector('.sheet-option-name') || {}).textContent || '').trim() === name) || null;
    const closeSheet = () => { const b = document.querySelector('.sheet-backdrop'); if (b) b.click(); };
    const showRows = () => [...document.querySelectorAll('.screen .rows li .show-row')].map((r) => ({
      title: ((r.querySelector('.row-title') || {}).textContent || '').trim(),
      venue: ((r.querySelector('.venue-line') || {}).textContent || '').trim(),
      badge: ((r.querySelector('.badge-sets') || {}).textContent || '').trim(),
    }));
    const countLine = () => ([...document.querySelectorAll('.screen .note')].map((n) => n.textContent.trim()).find((t) => /^\\d+ shows?\\b/.test(t)) || '');`;

  const atShows = async () => {
    if ((await evaluate('location.hash')) !== '#/shows') { await evaluate(`location.hash = '#/shows';`); await sleep(1500); }
  };
  // Pick a view through the View sheet, and read the lead back: a view that
  // was "set" is not a view that is showing.
  const setShowsView = async (view) => {
    await atShows();
    const want = view === 'detail' ? 'Detail' : 'Compact';
    const r = await evaluate(`(() => {${SHOWS_JS}
      if (leadVal('view') === ${JSON.stringify(want)}) return 'already';
      const lead = leadBy('view'); if (!lead) return 'no lead'; lead.click();
      const o = sheetOption(${JSON.stringify(want)}); if (!o) { closeSheet(); return 'no option'; }
      o.click(); return 'picked'; })()`);
    await sleep(r === 'already' ? 200 : 1200);
    const now = await evaluate(`(() => {${SHOWS_JS} return leadVal('view'); })()`);
    if (now !== want) fail(`Shows view: asked for ${want}, the View lead reads ${JSON.stringify(now)} (${r})`);
    return now === want;
  };
  // When: null for All shows, a year, or a year and a three-letter month. Picking
  // a year keeps the sheet open (its months appear), so the year-only path
  // closes it by the backdrop; a month or All shows closes it itself.
  const setShowsWhen = async (year = null, month = null) => {
    await atShows();
    const r = await evaluate(`(() => {${SHOWS_JS}
      const lead = leadBy('when'); if (!lead) return 'no lead'; lead.click();
      const y = ${JSON.stringify(year)}, m = ${JSON.stringify(month)};
      if (y === null) { const o = sheetOption('All shows'); if (!o) { closeSheet(); return 'no All shows'; } o.click(); return 'all'; }
      const yc = [...document.querySelectorAll('.sheet .chip-grid .chip')].find((c) => c.textContent.trim() === String(y));
      if (!yc) { closeSheet(); return 'no year ' + y; }
      yc.click();
      if (m === null) { closeSheet(); return 'year'; }
      const mc = [...document.querySelectorAll('.sheet .month-grid .chip')].find((c) => c.textContent.trim() === m);
      if (!mc) { closeSheet(); return 'no month ' + m; }
      mc.click(); return 'month'; })()`);
    await sleep(1200);
    return r;
  };
  // Filter: apply { sets, encore, state } through the sheet, each null for Any.
  // The wheel is scrolled to its option by position -- 44px rows, the figure
  // app.css and views/shows.js share -- and the scroll event is dispatched so
  // the listbox reads its own position, as it does after a flick. Returns the
  // apply button's text ("Show N shows") so the caller can hold it against the
  // list, or false.
  const setShowsFilter = async ({ sets = null, encore = null, state = null } = {}) => {
    await atShows();
    const opened = await evaluate(`(() => {${SHOWS_JS}
      const lead = leadBy('filter'); if (!lead) return false; lead.click();
      return !!document.querySelector('.sheet .wheel'); })()`);
    if (!opened) { fail('Shows filter: the Filter sheet did not open with a wheel in it'); return false; }
    await sleep(300);
    const chip = async (group, label) => evaluate(`(() => {
      const g = document.querySelector('.sheet .sheet-choices[aria-label=${JSON.stringify(group)}]');
      const c = g && [...g.querySelectorAll('.chip')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
      if (!c) return false; c.click(); return true; })()`);
    const okSets = await chip('Sets', sets === null ? 'Any' : sets);
    await sleep(150);
    const okEnc = await chip('Encore', encore === null ? 'Any' : encore === 'with' ? 'With' : 'Without');
    await sleep(150);
    const okState = await evaluate(`(() => {
      const w = document.querySelector('.sheet .wheel'); if (!w) return false;
      const opts = [...w.querySelectorAll('.wheel-option')].map((o) => o.textContent.trim());
      const i = opts.indexOf(${JSON.stringify(state === null ? 'Any' : state)}); if (i < 0) return false;
      w.scrollTop = i * 44; w.dispatchEvent(new Event('scroll')); return true; })()`);
    await sleep(400);
    const applied = await evaluate(`(() => {
      const b = [...document.querySelectorAll('.sheet .sheet-actions .btn')].find((x) => /^Show \\d+ shows$/.test(x.textContent.trim()));
      if (!b) return null; const t = b.textContent.trim(); b.click(); return t; })()`);
    await sleep(1200);
    if (!okSets || !okEnc || !okState || !applied) {
      fail(`Shows filter: could not apply ${JSON.stringify({ sets, encore, state })} (sets ${okSets}, encore ${okEnc}, state ${okState}, apply ${JSON.stringify(applied)})`);
      await evaluate(`(() => {${SHOWS_JS} closeSheet(); })()`);
      return false;
    }
    return applied;
  };
  const setShowsQuery = async (v) => {
    await evaluate(`(() => { const s = document.querySelector('.search'); if (!s) return false;
      s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await sleep(1100);
  };

  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: `http://localhost:${PORT}/` });

  process.stdout.write('booting (cold pull + verification)');
  let booted = false;
  for (let i = 0; i < 150; i++) {
    await sleep(2000);
    process.stdout.write('.');
    if (await evaluate(`!!document.querySelector('#main .screen')`)) { booted = true; break; }
  }
  console.log('');
  if (!booted) { fail('app never finished booting'); finish(chrome); return; }

  const screenText = `(document.getElementById('main').innerText || '')`;
  const errorBanner = `!!(document.querySelector('.banner strong') &&
    document.querySelector('.banner strong').textContent.includes('failed to load'))`;

  console.log('\nroutes:');
  // Captured per route so the markers can be cross-checked against each other
  // once the walk is done -- see "route markers are unique" below.
  const routeText = {};
  const routeSel = {};
  for (const r of ROUTES) {
    await evaluate(`location.hash = ${JSON.stringify(r.hash)};`);
    await sleep(900);
    const text = String(await evaluate(screenText));
    const boundary = await evaluate(errorBanner);
    routeText[r.hash] = text;
    // Which of the selectors ANY route uses are present on THIS screen.
    routeSel[r.hash] = await evaluate(`(() => {
      const out = {};
      for (const s of ${JSON.stringify([...new Set(ROUTES.map((x) => x.selector).filter(Boolean))])}) {
        out[s] = !!document.querySelector(s);
      }
      return out;
    })()`);

    if (boundary) fail(`${r.hash} rendered the error boundary`);
    else if (!text.toLowerCase().includes(r.expect.toLowerCase())) {
      // Case-insensitive on purpose: several markers live in .section-title,
      // which is text-transform: uppercase, and innerText reports RENDERED
      // casing rather than source casing.
      fail(`${r.hash} did not render (expected text ${JSON.stringify(r.expect)})`);
    } else if (r.selector && !routeSel[r.hash][r.selector]) {
      fail(`${r.hash} rendered its text but not ${JSON.stringify(r.selector)}`);
    } else pass(`${r.hash}`);
  }

  // --- Route markers are unique, which routes.mjs only ever ASSERTED --------
  //
  // The whole apparatus rests on one property: a route's marker must not
  // appear on any other route, or a screen that failed to render passes
  // because the PREVIOUS screen is still on display. routes.mjs says so in a
  // comment. Two of its markers did not satisfy it -- 'shows in the archive'
  // renders on song detail too, 'Jam charts' rendered as a Songs filter chip
  // (in the filter sheet since 0.1.79) -- and both passed only because of
  // where they sat in the array.
  //
  // So the property is measured against what the routes actually rendered,
  // just now, in this browser. Not grepped from source: a marker can appear on
  // a screen through a component three files away, which is exactly how both
  // of these got there.
  console.log('\nroute markers are unique:');
  for (const r of ROUTES) {
    const matches = ROUTES.filter((other) => {
      const text = routeText[other.hash] || '';
      const textHit = text.toLowerCase().includes(r.expect.toLowerCase());
      const selHit = !r.selector || routeSel[other.hash]?.[r.selector];
      return textHit && selHit;
    }).map((o) => o.hash);

    if (matches.length === 0) {
      fail(`${r.hash}: its own marker matched nothing — the capture is broken, not the marker`);
    } else if (matches.length > 1) {
      const others = matches.filter((h) => h !== r.hash);
      fail(
        `${r.hash}: marker ${JSON.stringify(r.expect)}${r.selector ? ` + ${r.selector}` : ''} also matches ${others.join(', ')} — a failed render there would pass`,
      );
    } else if (matches[0] !== r.hash) {
      fail(`${r.hash}: its marker matches ${matches[0]} instead of itself`);
    } else pass(`${r.hash} — ${JSON.stringify(r.expect)}${r.selector ? ` + ${r.selector}` : ''}`);
  }

  console.log('\nredirects:');
  for (const r of REDIRECTS) {
    await evaluate(`location.hash = ${JSON.stringify(r.from)};`);
    await sleep(900);
    const landed = await evaluate('location.hash');
    if (landed !== r.to) fail(`${r.from} -> ${landed}, expected ${r.to}`);
    else pass(`${r.from} -> ${r.to}`);
  }


  console.log('\ngap chart, all three entry points:');
  for (const ep of GAP_ENTRY_POINTS) {
    const at = ep.at || '#/shows';
    await evaluate(`location.hash = ${JSON.stringify(at)};`);
    await sleep(1000);
    if (!ep.at) {
      // show detail: reach it from a Shows COMPACT ROW -- the first row WHOSE
      // SHOW HAS SETLIST ROWS, not the first row.
      //
      // WHAT THIS CHECK IS FOR: the gap chart button on a PLAYED show. Show
      // detail renders that button only when the show has setlist rows (there
      // is nothing to chart otherwise), and the Shows landing lists every show
      // dated on or before today, newest first. On a show day the first row
      // is today's show, in `shows` with no setlist yet, and it carries no
      // Gap chart button BY DESIGN. Clicking the first card failed this check
      // on 2026-10-18 for exactly that reason, with nothing wrong in the app.
      //
      // So walk the rows in order and open the first whose badge is not
      // "No setlist". The badge is derived from the same rows show detail
      // renders the button from, so the row chosen here is one the button is
      // REQUIRED on. Do not "simplify" this back to the first row: it would
      // go red every show day and teach the reader to ignore it.
      await setShowsView('compact');
      const opened = await evaluate(
        `(() => {
           const rows = [...document.querySelectorAll('.screen .rows li .show-row')];
           const i = rows.findIndex((r) => ((r.querySelector('.badge-sets') || {}).textContent || '').trim() !== 'No setlist');
           if (i < 0) return { ok: false, skipped: rows.length };
           rows[i].click(); return { ok: true, skipped: i };
         })()`,
      );
      if (!opened || !opened.ok) {
        fail(`${ep.name}: could not open a played show's detail (${opened ? opened.skipped : '?'} row(s) without a setlist)`);
        continue;
      }
      if (opened.skipped) console.log(`        (skipped ${opened.skipped} row(s) with no setlist -- unplayed show(s) at the top of the list)`);
      await sleep(900);
    }
    if (ep.setup) {
      const ready = await evaluate(ep.setup);
      if (!ready) { fail(`${ep.name}: setup failed`); continue; }
      await sleep(900); // search is debounced
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

  // The cards must carry Show detail and NOTHING else. Asserted as an exact
  // button list per card, not as "Gap chart is absent": a card that rendered no
  // actions at all would satisfy the weaker check while being just as broken.
  // Clear the search the Shows entry point typed. shows.js keeps its query at
  // MODULE level, so leaving it set puts every later Shows check on a
  // search-results screen -- a test contaminating the screen it goes on to
  // assert about. That is exactly what happened on the first run of this.
  await evaluate(`location.hash = '#/shows';`);
  await sleep(900);
  await evaluate(`(() => {
    const s = document.querySelector('.search');
    if (!s) return false;
    s.value = '';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(1000);

  await setShowsView('detail');
  console.log('\ncards carry one button:');
  for (const [screen, hash] of [['Home', '#/home'], ['Shows', '#/shows']]) {
    await evaluate(`location.hash = ${JSON.stringify(hash)};`);
    await sleep(1600);
    const r = await evaluate(`(() => {
      const cards = [...document.querySelectorAll('.card')].filter(c => c.querySelector('.setlist-song'));
      return {
        cards: cards.length,
        buttonSets: cards.map(c => [...c.querySelectorAll('.card-actions .btn-small')].map(b => b.textContent.trim())),
        anyGapChart: cards.some(c => [...c.querySelectorAll('.btn-small')].some(b => b.textContent.trim() === 'Gap chart')),
      };
    })()`);
    if (!r.cards) fail(`${screen}: no setlist cards rendered`);
    else if (r.anyGapChart) fail(`${screen}: a card still offers Gap chart`);
    else if (!r.buttonSets.every((s) => s.length === 1 && s[0] === 'Show detail')) {
      fail(`${screen}: expected exactly ['Show detail'] per card, got ${JSON.stringify(r.buttonSets)}`);
    } else pass(`${screen}: all ${r.cards} card(s) carry exactly ['Show detail']`);
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

  // --- Home: every setlist card offers Show detail --------------------------
  //
  // Counted against the cards that HAVE a setlist, not asserted as a fixed
  // number: Home's shape depends on whether an upcoming show exists and on how
  // many anniversaries today has, so a hardcoded count would pass or fail for
  // reasons unrelated to the buttons. Every card showing a past show's setlist
  // must offer a way into that show.
  console.log('\nHome show-detail buttons:');
  await evaluate(`location.hash = '#/home';`);
  await sleep(1400);
  // Position is asserted against the setlist itself, not just existence --
  // "the buttons are on the card" was true of the broken layout too, where
  // they sat ABOVE the setlist for twenty-one builds.
  const CARD_PROBE = `(() => {
    const cards = [...document.querySelectorAll('.card')].filter(c => c.querySelector('.setlist-song'));
    const label = (r, t) => [...r.querySelectorAll('.btn-small')].some(b => b.textContent.trim() === t);
    return {
      setlistCards: cards.length,
      withShowDetail: cards.filter(c => { const a = c.querySelector('.card-actions'); return a && label(a, 'Show detail'); }).length,
      withGapChart: cards.filter(c => { const a = c.querySelector('.card-actions'); return a && label(a, 'Gap chart'); }).length,
      // THE POSITION CHECK: actions must follow the LAST setlist song in
      // their own card, in document order.
      actionsBelowSetlist: cards.filter(c => {
        const a = c.querySelector('.card-actions');
        const songs = [...c.querySelectorAll('.setlist-song')];
        const last = songs[songs.length - 1];
        return a && last && !!(last.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING);
      }).length,
      // Button order within the row: the show, then the chart derived from it.
      buttonOrderOk: cards.every(c => {
        const a = c.querySelector('.card-actions');
        if (!a) return true;
        const t = [...a.querySelectorAll('.btn-small')].map(b => b.textContent.trim());
        const i = t.indexOf('Show detail'), j = t.indexOf('Gap chart');
        return i === -1 || j === -1 || i < j;
      }),
    };
  })()`;
  const home = await evaluate(CARD_PROBE);

  if (!home.setlistCards) fail('Home: no cards with a setlist found — the page did not render as expected');
  else if (home.withShowDetail !== home.setlistCards) {
    fail(`Home: ${home.setlistCards} setlist card(s), only ${home.withShowDetail} offer Show detail`);
  } else pass(`all ${home.setlistCards} setlist card(s) offer Show detail`);
  if (home.actionsBelowSetlist !== home.setlistCards) {
    fail(`Home: actions sit BELOW the setlist on only ${home.actionsBelowSetlist} of ${home.setlistCards} card(s)`);
  } else pass(`actions sit below the setlist on all ${home.setlistCards} card(s)`);
  if (!home.buttonOrderOk) fail('Home: Show detail must come before Gap chart');
  else pass('Show detail precedes Gap chart on every card');

  // The Shows tab is the screen Home is being made to match, and it was
  // already correct -- so it is checked too. If a shared renderer ever moves
  // the actions, both screens go red together instead of silently diverging
  // the way they did for twenty-one builds.
  await setShowsView('detail');
  await evaluate(`location.hash = '#/shows';`);
  await sleep(1600);
  const shows = await evaluate(CARD_PROBE);
  if (!shows.setlistCards) fail('Shows: no setlist cards rendered');
  else if (shows.actionsBelowSetlist !== shows.setlistCards) {
    fail(`Shows: actions sit BELOW the setlist on only ${shows.actionsBelowSetlist} of ${shows.setlistCards} card(s)`);
  } else pass(`Shows tab matches: actions below the setlist on all ${shows.setlistCards} card(s)`);

  // Each new button must actually navigate, not just exist. Clicking is the
  // only thing that proves the route it points at is real.
  const clicked = await evaluate(`(() => {
    const b = [...document.querySelectorAll('.card-actions .btn-small')].find(x => x.textContent.trim() === 'Show detail');
    if (!b) return false; b.click(); return true;
  })()`);
  await sleep(1100);
  const landed = String(await evaluate('location.hash'));
  const detailText = String(await evaluate(screenText));
  if (!clicked) fail('Home: no Show detail button to click');
  else if (!landed.startsWith('#/show/')) fail(`Home: Show detail went to ${landed}`);
  else if (!/setlist/i.test(detailText)) fail('Home: Show detail did not render a setlist');
  else pass(`Show detail navigates -> ${landed}`);

  // --- Jam chart coverage note, derived not hardcoded ------------------------
  //
  // Asserts the years shown MATCH THE DATA, by recomputing them from the index
  // the page is holding. A check for the literal "2024" would keep passing
  // after The Carton added an earlier entry and the sentence went wrong, which
  // is the whole reason the note is derived.
  console.log('\njam chart coverage note:');
  await evaluate(`location.hash = '#/jams';`);
  await sleep(1200);
  const cov = await evaluate(`(() => {
    const sub = document.querySelector('.screen-sub');
    return { text: sub ? sub.textContent.replace(/\\s+/g, ' ').trim() : null };
  })()`);
  // Cross-checked against THE CARTON, not against the app's own index.
  // Comparing the sentence to index.counts.jamchartsFrom would be comparing a
  // value to itself -- it would pass just as happily if the derivation picked
  // the wrong minimum. One extra request per run; the app is user-initiated
  // and this is not a loop.
  let expectedYears = null;
  let skipped = null;
  try {
    const [jamRes] = await Promise.all([fetch('https://thecarton.net/api/v2/jamcharts.json')]);
    const jamRows = (await jamRes.json()).data || [];
    expectedYears = {
      jam: jamRows.map((j) => j.showdate).sort()[0].slice(0, 4),
    };
  } catch (err) {
    // SKIP, NOT FAIL. This is the one assertion in the suite that depends on
    // reaching a third party, and an unreachable Carton is not a defect in this
    // repo -- failing here would train you to ignore a red run. It does not
    // claim health either: it says plainly that the claim went unchecked.
    skipped = `could not reach The Carton (${err.message})`;
  }

  if (skipped) skip(`coverage note not cross-checked: ${skipped}`);
  else if (!cov.text) fail('jams: no sub-line rendered');
  else if (!expectedYears) { /* already reported above */ }
  else if (!cov.text.includes(`Entries begin in ${expectedYears.jam}.`)) {
    fail(`jams: note says ${JSON.stringify(cov.text)}, Carton says entries begin ${expectedYears.jam}`);
  } else pass(`coverage note agrees with The Carton (entries begin ${expectedYears.jam})`);

  // --- The jam key ----------------------------------------------------------
  //
  // The key explains the green, so the check that matters is that its swatch
  // is THE SAME COLOUR as the highlighted titles it describes -- compared
  // against the rendered setlist, not against a hex written here. A literal
  // expected value would keep passing after the token was retuned and the key
  // had started explaining the wrong colour, which is the exact drift the CSS
  // avoids by using var(--jam).
  console.log('\njam key:');
  await evaluate(`location.hash = '#/show/1779890028';`);
  await sleep(1200);
  const key = await evaluate(`(() => {
    const card = document.querySelector('.section .card');
    const k = card ? card.querySelector('.jam-key') : null;
    const song = document.querySelector('.setlist-song[data-jam="true"]');
    const fn = card ? card.querySelector('.fn-list') : null;
    const notes = card ? card.querySelector('.setlist-shownotes') : null;
    const after = (a, b) => !!(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
    return {
      inCard: !!k,
      keyColor: k ? getComputedStyle(k).color : null,
      songColor: song ? getComputedStyle(song).color : null,
      text: k ? k.textContent.replace(/\\s+/g, ' ').trim() : null,
      hadFootnotes: !!fn,
      afterFootnotes: after(fn, k),
      beforeShowNotes: after(k, notes),
    };
  })()`);

  if (!key.inCard) fail('jam key: not rendered inside the setlist card');
  else pass('key renders inside the setlist card');

  // ALIGNMENT, not existence. The key must be a member of the footnote list
  // and its text must start in the same column as the footnote text -- the
  // previous version existed and was still misaligned, so "it is on the card"
  // proves nothing here.
  const align = await evaluate(`(() => {
    const list = document.querySelector('.card .fn-list');
    const key = list ? list.querySelector('li.jam-key') : null;
    if (!list || !key) return { inList: false };
    const fnRow = [...list.querySelectorAll('li')].find(li => li.querySelector('.fn-marker'));
    const x = (n) => n ? Math.round(n.getBoundingClientRect().x * 10) / 10 : null;
    const keyText = key.querySelector('span:not(.jam-key-bullet)');
    const fnText = fnRow ? fnRow.querySelector('span:not(.fn-marker)') : null;
    const bullet = key.querySelector('.jam-key-bullet');
    const marker = fnRow ? fnRow.querySelector('.fn-marker') : null;
    const song = document.querySelector('.setlist-song[data-jam="true"]');
    return {
      inList: true,
      isLast: list.lastElementChild === key,
      textX: x(keyText), fnTextX: x(fnText),
      bulletX: x(bullet), markerX: x(marker),
      bulletColor: bullet ? getComputedStyle(bullet).color : null,
      songColor: song ? getComputedStyle(song).color : null,
      textColor: keyText ? getComputedStyle(keyText).color : null,
      fnColor: fnText ? getComputedStyle(fnText).color : null,
    };
  })()`);

  if (!align.inList) fail('jam key: not a member of the footnote list');
  else {
    if (!align.isLast) fail('jam key: not the last item in the footnote list');
    else pass('key is the last item in the footnote list');
    if (align.textX !== align.fnTextX) {
      fail(`jam key: text starts at x=${align.textX}, footnote text at x=${align.fnTextX}`);
    } else pass(`text column matches the footnote rows (x=${align.textX})`);
    if (align.bulletX !== align.markerX) {
      fail(`jam key: bullet at x=${align.bulletX}, footnote markers at x=${align.markerX}`);
    } else pass(`bullet sits in the marker column (x=${align.bulletX})`);
    if (align.bulletColor !== align.songColor) {
      fail(`jam key: bullet ${align.bulletColor} != highlighted titles ${align.songColor}`);
    } else pass(`bullet matches the highlighted titles (${align.bulletColor})`);
    // The WORDS are green too, matching the rendered setlist -- not a hardcoded
    // hex, and deliberately NOT the footnote grey. The key shows you the thing
    // it names; green bullet beside grey words would explain the bullet.
    if (align.textColor !== align.songColor) {
      fail(`jam key: text ${align.textColor} != highlighted titles ${align.songColor}`);
    } else pass(`text is the jam colour, matching the setlist (${align.textColor})`);
    if (align.textColor === align.fnColor) {
      fail('jam key: text is the same grey as the footnotes — it reverted');
    } else pass(`text is distinct from the footnote grey (${align.fnColor})`);
  }

  // --- Small buttons: smaller box, 44px tap target intact -------------------
  //
  // The floor is the thing under test. Measured from the rendered ::after hit
  // region, not from the button box and not assumed from the CSS.
  console.log('\nsmall button tap targets:');
  const taps = await evaluate(`(() => {
    const btns = [...document.querySelectorAll('.btn.btn-small')];
    if (!btns.length) return null;
    const rows = btns.map(b => {
      const box = b.getBoundingClientRect();
      const after = getComputedStyle(b, '::after');
      // The hit region is the pseudo-element's height, centred on the box.
      const hit = parseFloat(after.height) || box.height;
      return { label: b.textContent.trim(), box: Math.round(box.height * 10) / 10, hit: Math.round(hit * 10) / 10 };
    });
    return { count: rows.length, minBox: Math.min(...rows.map(r => r.box)), minHit: Math.min(...rows.map(r => r.hit)), sample: rows.slice(0, 3) };
  })()`);
  if (!taps) fail('buttons: no .btn.btn-small found');
  else if (taps.minHit < 44) fail(`buttons: smallest tap target is ${taps.minHit}px — under the 44px floor`);
  else if (taps.minBox >= 44) fail(`buttons: visual box is still ${taps.minBox}px — it did not shrink`);
  else pass(`${taps.count} small buttons: box ${taps.minBox}px, tap target ${taps.minHit}px`);

  // Wording. The bullet is decorative and aria-hidden, so the words are read
  // off the text span rather than the row's textContent.
  const keyWords = await evaluate(
    `(() => { const s = document.querySelector('li.jam-key span:not(.jam-key-bullet)'); return s ? s.textContent.trim() : null; })()`,
  );
  if (keyWords !== 'jam chart entry') fail(`jam key: reads ${JSON.stringify(keyWords)}, expected "jam chart entry"`);
  else pass('reads "jam chart entry" and nothing else');

  if (!key.hadFootnotes) fail('jam key: this show was chosen because it HAS footnotes — it rendered none');
  else if (!key.afterFootnotes) fail('jam key: does not sit under the footnotes');
  else pass('sits under the last footnote');

  if (!key.beforeShowNotes) fail('jam key: does not sit above the show notes');
  else pass('card order is setlist -> footnotes -> key -> show notes');

  // THE NO-FOOTNOTES CASE. 2025-11-09 has 2 jam entries and zero footnotes --
  // one of exactly three such shows in the archive. The key must still render,
  // in the slot the footnote list would have occupied. This is the branch the
  // implementation deliberately does not have, so it is the one worth checking.
  await evaluate(`location.hash = '#/show/1753713777';`);
  await sleep(1100);
  const noFn = await evaluate(`(() => {
    const card = document.querySelector('.section .card');
    const k = card ? card.querySelector('.jam-key') : null;
    const song = document.querySelector('.setlist-song[data-jam="true"]');
    const sets = card ? [...card.querySelectorAll('.setlist-set')] : [];
    const last = sets[sets.length - 1];
    return {
      footnotes: card ? card.querySelectorAll('.fn-list').length : -1,
      songs: document.querySelectorAll('.setlist-song').length,
      key: !!k,
      text: k ? k.textContent.trim() : null,
      color: k ? getComputedStyle(k).color : null,
      songColor: song ? getComputedStyle(song).color : null,
      afterLastSet: !!(k && last && (last.compareDocumentPosition(k) & Node.DOCUMENT_POSITION_FOLLOWING)),
    };
  })()`);

  // With no real footnotes the list is created for the key alone, so it should
  // be a ONE-ITEM list -- still the footnote column, still aligned, not a
  // stray block. Asserting "exactly one item, and it is the key" is what
  // distinguishes that from the list failing to render at all.
  const noFnList = await evaluate(`(() => {
    const list = document.querySelector('.card .fn-list');
    if (!list) return { list: false };
    const items = [...list.children];
    const key = list.querySelector('li.jam-key');
    const bullet = key ? key.querySelector('.jam-key-bullet') : null;
    const song = document.querySelector('.setlist-song[data-jam="true"]');
    return {
      list: true,
      items: items.length,
      onlyItemIsKey: items.length === 1 && items[0] === key,
      realFootnotes: list.querySelectorAll('.fn-marker').length,
      bulletColor: bullet ? getComputedStyle(bullet).color : null,
      songColor: song ? getComputedStyle(song).color : null,
    };
  })()`);

  if (noFn.songs !== 9) fail(`jam key (no footnotes): show did not render (${noFn.songs} songs, expected 9)`);
  else if (!noFnList.list) fail('jam key (no footnotes): no list rendered — the key has nowhere to live');
  else if (noFnList.realFootnotes !== 0) fail(`jam key (no footnotes): expected no real footnotes, found ${noFnList.realFootnotes}`);
  else if (!noFnList.onlyItemIsKey) fail(`jam key (no footnotes): list has ${noFnList.items} items, expected just the key`);
  else if (noFnList.bulletColor !== noFnList.songColor) fail(`jam key (no footnotes): ${noFnList.bulletColor} vs ${noFnList.songColor}`);
  else pass('a show with no footnotes renders the key as a one-item list, aligned the same way');

  // ONE condition, shared with the entries section. Checked on a show with no
  // entries: neither may appear. If these ever split, this is what catches it.
  await evaluate(`location.hash = '#/show/1627919708';`);
  await sleep(1100);
  const noKey = await evaluate(`(() => ({
    songs: document.querySelectorAll('.setlist-song').length,
    key: document.querySelectorAll('.jam-key').length,
    cards: document.querySelectorAll('.jam-card-song').length,
  }))()`);
  if (noKey.songs !== 28) fail(`jam key: the no-jam show did not render (${noKey.songs} songs, expected 28)`);
  else if (noKey.key || noKey.cards) {
    fail(`jam key: show with no entries rendered key=${noKey.key} entryCards=${noKey.cards} — the two conditions have split`);
  } else pass('a show with no entries renders neither the key nor the section');

  // --- The key follows the colour, on every screen that renders a setlist ---
  //
  // Asserted PER CARD, not per page. "A key exists somewhere on Home" would be
  // satisfied by one card explaining another card's green, which is exactly the
  // bug this fixes -- the key was on show detail only while Home and Shows
  // showed unexplained green.
  //
  // The pairing is the assertion: a card with highlighted songs must have a
  // key, and a card without must not. Colour is compared against that card's
  // OWN highlighted title, never a hex.
  await setShowsView('detail');
  console.log('\njam key follows the colour:');
  for (const [screen, hash] of [['Home', '#/home'], ['Shows', '#/shows'], ['show detail', '#/show/1779890028']]) {
    await evaluate(`location.hash = ${JSON.stringify(hash)};`);
    await sleep(1600);
    const r = await evaluate(`(() => {
      const cards = [...document.querySelectorAll('.card')].filter(c => c.querySelector('.setlist-song'));
      return {
        cards: cards.length,
        rows: cards.map(c => {
          const jamSong = c.querySelector('.setlist-song[data-jam="true"]');
          const key = c.querySelector('li.jam-key');
          const bullet = key ? key.querySelector('.jam-key-bullet') : null;
          const words = key ? key.querySelector('span:not(.jam-key-bullet)') : null;
          return {
            hasJamSongs: !!jamSong,
            hasKey: !!key,
            inList: !!(key && key.parentElement && key.parentElement.classList.contains('fn-list')),
            songColor: jamSong ? getComputedStyle(jamSong).color : null,
            bulletColor: bullet ? getComputedStyle(bullet).color : null,
            wordsColor: words ? getComputedStyle(words).color : null,
            text: words ? words.textContent.trim() : null,
            realFootnotes: c.querySelectorAll('.fn-marker').length,
          };
        }),
      };
    })()`);

    if (!r.cards) { fail(`${screen}: no setlist cards rendered`); continue; }

    const withJams = r.rows.filter((x) => x.hasJamSongs);
    const without = r.rows.filter((x) => !x.hasJamSongs);
    const missing = withJams.filter((x) => !x.hasKey).length;
    const spurious = without.filter((x) => x.hasKey).length;

    if (missing) fail(`${screen}: ${missing} of ${withJams.length} card(s) with jam songs have NO key`);
    else if (spurious) fail(`${screen}: ${spurious} card(s) with no jam songs render a key anyway`);
    else pass(`${screen}: ${withJams.length} card(s) with jam songs keyed, ${without.length} without correctly bare`);

    // The colour, the wording and the placement, on every keyed card.
    const badColour = withJams.filter((x) => x.bulletColor !== x.songColor || x.wordsColor !== x.songColor);
    const badText = withJams.filter((x) => x.text !== 'jam chart entry');
    const notInList = withJams.filter((x) => !x.inList);
    if (withJams.length) {
      if (badColour.length) fail(`${screen}: ${badColour.length} key(s) do not match their card's jam colour`);
      else pass(`${screen}: every key matches its own card's jam colour (${withJams[0].songColor})`);
      if (badText.length) fail(`${screen}: a key reads ${JSON.stringify(badText[0].text)}`);
      if (notInList.length) fail(`${screen}: ${notInList.length} key(s) are not inside the footnote list`);
      else pass(`${screen}: every key sits inside the footnote list`);

      // The no-footnotes path, wherever it happens to occur on this screen.
      const bare = withJams.filter((x) => x.realFootnotes === 0);
      if (bare.length) pass(`${screen}: ${bare.length} keyed card(s) have no footnotes — key still in a list`);
    }
  }

  // --- Shows (0.1.82): When / Filter / View -----------------------------------
  //
  // The tab is every show played, newest first, under three lead chips on one
  // row (docs/plan.md, "0.1.82 design"). Each check below reads the SCREEN and
  // holds it against an independent derivation -- the raw Carton tables pulled
  // here in Node, or the same screen reached by a different route to the same
  // set -- never against the app's own index. The predicates are proven on a
  // fixture in tests/showfilters.test.mjs; what this section adds is the tie
  // between a row the screen kept and the show detail behind it, which no
  // unit test can see.
  //
  // Red proofs (0.1.82), each fault applied alone and the file restored by
  // hash: matchesSets reading '3+' as '>' -- the Sets=2 rows are unchanged but
  // the fixture test fails; matchesEncore's branches swapped -- "Encore =
  // Without" opens a row whose detail has an encore; matchesState as a
  // substring -- "State = MI" count disagrees with the venues table;
  // white-space: nowrap on .chip-value -- the bar at 360 reads wider than
  // 360 and the When value sits on one line where two are required.
  console.log('\nShows: compact rows and the No setlist count:');
  await evaluate(`location.hash = '#/home';`); await sleep(600);
  await evaluate(`location.hash = '#/shows';`); await sleep(1500);
  await setShowsView('compact');
  const compact = await evaluate(`(() => {${SHOWS_JS}
    return { rows: showRows(), count: countLine(), leads: [leadVal('when'), leadVal('filter'), leadVal('view')],
      labels: [...document.querySelectorAll('.screen .sortbar .chip-lead')].map((c) => !!c.querySelector('.chip-label')),
      cards: document.querySelectorAll('.screen .card').length,
      actions: document.querySelectorAll('.screen .rows .row-action').length,
      sections: [...document.querySelectorAll('.screen .section-title')].map((n) => n.textContent.trim()) };
  })()`);
  const badgeTally = {};
  for (const r of compact.rows) badgeTally[r.badge] = (badgeTally[r.badge] || 0) + 1;
  const noSetlistRows = compact.rows.filter((r) => r.badge === 'No setlist').length;
  const BADGE_WORDS = /^\d+ sets?( \+ E)?$/;
  const oddBadge = compact.rows.find((r) => r.badge !== 'No setlist' && !BADGE_WORDS.test(r.badge));
  if (!compact.rows.length) fail('Shows: no compact rows on the landing');
  else if (compact.cards) fail(`Shows: ${compact.cards} card(s) render under Compact view`);
  else if (compact.rows.some((r) => !r.badge)) fail(`Shows: ${compact.rows.filter((r) => !r.badge).length} row(s) carry no set badge`);
  else if (oddBadge) fail(`Shows: a badge reads ${JSON.stringify(oddBadge.badge)} -- neither "N sets" nor "No setlist"`);
  else if (compact.actions) fail(`Shows: ${compact.actions} row-action control(s) on compact rows -- one control per row`);
  else if (compact.leads.join('|') !== 'All|Off|Compact') fail(`Shows: the leads read ${JSON.stringify(compact.leads)}, expected All / Off / Compact at rest`);
  else if (compact.labels.join() !== 'false,true,true') fail(`Shows: lead labels present = ${JSON.stringify(compact.labels)}, expected the When chip bare and the other two labelled`);
  else if (compact.count !== `${compact.rows.length} shows · newest first`) fail(`Shows: the count line reads ${JSON.stringify(compact.count)} over ${compact.rows.length} rows`);
  else if (compact.sections.length) fail(`Shows: the landing renders section titles ${JSON.stringify(compact.sections)} -- the count line is the only header now`);
  else pass(`${compact.rows.length} compact rows, every row badged (${Object.entries(badgeTally).map(([k, v]) => `${k}: ${v}`).join(', ')}), leads All / Off / Compact, When chip bare, count line ${JSON.stringify(compact.count)}`);

  // The "No setlist" count against the RAW tables. The app's universe is every
  // show dated on or before today (string compare, the index's own rule); how
  // many of those have zero setlist rows is derived here from the two
  // endpoints, never from the index. SKIP, not pass, when Carton is unreachable.
  let rawShows = null, rawSetlists = null, rawVenues = null;
  try {
    const [a, b, c] = await Promise.all([
      fetch('https://thecarton.net/api/v2/shows.json?limit=20000'),
      fetch('https://thecarton.net/api/v2/setlists.json?limit=20000'),
      fetch('https://thecarton.net/api/v2/venues.json?limit=20000'),
    ]);
    if (a.ok && b.ok && c.ok) { rawShows = (await a.json()).data; rawSetlists = (await b.json()).data; rawVenues = (await c.json()).data; }
  } catch { /* reported as a SKIP below */ }
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (!rawShows || !rawSetlists || !rawVenues) skip('Shows: Carton unreachable -- the No setlist count and the state derivations were not checked');
  else {
    const played = rawShows.filter((s) => String(s.showdate) <= todayStr);
    const withRows = new Set(rawSetlists.map((r) => Number(r.show_id)));
    const rawNoSetlist = played.filter((s) => !withRows.has(Number(s.show_id))).length;
    if (played.length !== compact.rows.length) fail(`Shows: ${compact.rows.length} rows, the raw shows table has ${played.length} dated on or before ${todayStr}`);
    else if (rawNoSetlist !== noSetlistRows) fail(`Shows: ${noSetlistRows} rows read "No setlist", the raw tables say ${rawNoSetlist} played shows have zero setlist rows`);
    else pass(`"No setlist" on exactly ${noSetlistRows} rows = raw played shows with zero setlist rows; ${played.length} rows = raw shows dated on or before today`);
  }

  // --- Filter: each predicate tied to show detail on three rows ----------------
  //
  // First, middle and last of the filtered list, opened one at a time. Set
  // labels come from .setlist-label, which setlistBlock emits once per set;
  // "Encore" and "Encore 2" are not sets. The apply button's count, the count
  // line, the lead and the pills are held against the list in the same pass.
  console.log('\nShows: Sets = 2, Encore = Without, State = MI, and their intersection:');
  const detailSets = async (rowIndex) => {
    const clicked = await evaluate(`(() => { const r = [...document.querySelectorAll('.screen .rows li .show-row')][${rowIndex}]; if (!r) return false; r.click(); return true; })()`);
    await sleep(1200);
    const d = clicked ? await evaluate(`(() => ({ hash: location.hash, labels: [...document.querySelectorAll('.setlist-label')].map((n) => n.textContent.trim()) }))()`) : null;
    await evaluate(`location.hash = '#/shows';`); await sleep(1300);
    return d;
  };
  const threeOf = (n) => (n <= 3 ? [...Array(n).keys()] : [0, Math.floor(n / 2), n - 1]);
  const readFiltered = () => evaluate(`(() => {${SHOWS_JS} return { rows: showRows(), count: countLine(), lead: leadVal('filter'), pills: [...document.querySelectorAll('.screen .filter-pill')].map((p) => p.textContent.replace('✕', '').trim()) }; })()`);
  const checkThree = async (name, filters, words, assertOn) => {
    const applied = await setShowsFilter(filters);
    if (!applied) return null;
    const shot = await readFiltered();
    const n = shot.rows.length;
    const problems = [];
    if (!n) problems.push('no rows kept');
    if (applied !== `Show ${n} shows`) problems.push(`the apply button read ${JSON.stringify(applied)}, the list holds ${n}`);
    if (shot.count !== `${n} shows · ${words} · newest first`) problems.push(`count line ${JSON.stringify(shot.count)}, expected "${n} shows · ${words} · newest first"`);
    if (shot.lead !== '1 on') problems.push(`the Filter lead reads ${JSON.stringify(shot.lead)}, expected "1 on"`);
    if (shot.pills.join('|') !== words) problems.push(`pills ${JSON.stringify(shot.pills)}, expected ["${words}"]`);
    const badBadge = shot.rows.find((r) => assertOn({ row: r }));
    if (badBadge) problems.push(`row "${badBadge.title}" badge ${JSON.stringify(badBadge.badge)}: ${assertOn({ row: badBadge })}`);
    const seen = [];
    for (const i of threeOf(n)) {
      const d = await detailSets(i);
      if (!d) { problems.push(`row ${i + 1} did not open`); continue; }
      if (!/^#\/show\//.test(d.hash)) { problems.push(`row ${i + 1} went to ${d.hash}`); continue; }
      const sets = d.labels.filter((l) => !/^Encore/.test(l)).length;
      const encore = d.labels.some((l) => /^Encore/.test(l));
      seen.push(`${shot.rows[i].title} = ${d.labels.join(' + ')}`);
      const bad = assertOn({ sets, encore, row: shot.rows[i], detail: true });
      if (bad) problems.push(`row ${i + 1} (${shot.rows[i].title}): ${bad}`);
    }
    if (problems.length) for (const p of problems) fail(`Shows ${name}: ${p}`);
    else pass(`${name}: ${n} rows, lead "${shot.lead}", pill ${JSON.stringify(shot.pills)}, count ${JSON.stringify(shot.count)}; detail of rows ${threeOf(n).map((i) => i + 1).join('/')}: ${seen.join('; ')}`);
    return shot;
  };
  const sets2 = await checkThree('Sets = 2', { sets: '2' }, '2 sets', ({ sets, row, detail }) =>
    detail ? (sets !== 2 ? `${sets} non-encore sets on detail, expected exactly 2` : null) : (!/^2 sets/.test(row.badge) ? 'badge does not read 2 sets' : null));
  const noEnc = await checkThree('Encore = Without', { encore: 'without' }, 'without encore', ({ encore, row, detail }) =>
    detail ? (encore ? 'detail has an encore set' : null) : (/\+ E$/.test(row.badge) || row.badge === 'No setlist' ? 'badge shows an encore or no setlist' : null));

  const miApplied = await setShowsFilter({ state: 'MI' });
  const miShot = miApplied ? await readFiltered() : null;
  if (miShot) {
    const notMI = miShot.rows.filter((r) => !/, MI$/.test(r.venue));
    let rawMI = null;
    if (rawShows && rawVenues) {
      const ids = new Set(rawVenues.filter((v) => v.state === 'MI').map((v) => Number(v.venue_id)));
      rawMI = rawShows.filter((s) => String(s.showdate) <= todayStr && ids.has(Number(s.venue_id))).length;
    }
    if (!miShot.rows.length) fail('Shows State = MI: no rows');
    else if (notMI.length) fail(`Shows State = MI: ${notMI.length} row(s) not in MI -- ${JSON.stringify(notMI.slice(0, 3).map((r) => r.venue))}`);
    else if (miShot.count !== `${miShot.rows.length} shows · in MI · newest first`) fail(`Shows State = MI: the count line reads ${JSON.stringify(miShot.count)}`);
    else if (miShot.pills.join('|') !== 'in MI' || miShot.lead !== '1 on') fail(`Shows State = MI: pills ${JSON.stringify(miShot.pills)}, lead ${JSON.stringify(miShot.lead)}`);
    else if (rawMI === null) skip(`Shows State = MI: ${miShot.rows.length} rows all in MI; Carton unreachable, so the venues-table count was not checked`);
    else if (rawMI !== miShot.rows.length) fail(`Shows State = MI: ${miShot.rows.length} rows, the venues table gives ${rawMI} played shows at MI venues`);
    else pass(`State = MI: ${miShot.rows.length} rows, every venue line ends ", MI", = the venues-table derivation (${rawMI}); count ${JSON.stringify(miShot.count)}`);
  }

  // Two filters together: the intersection of the two single-filter lists, read
  // from the screen under each, in the same order. Sets = 2 and Encore =
  // Without, because the two overlap (17 shows in 2026-10) where MI and Sets=2
  // might not.
  if (sets2 && noEnc) {
    const key = (r) => `${r.title}|${r.venue}`;
    const inSets2 = new Set(sets2.rows.map(key));
    const expect = noEnc.rows.filter((r) => inSets2.has(key(r))).map(key);
    const bothApplied = await setShowsFilter({ sets: '2', encore: 'without' });
    const both = bothApplied ? await readFiltered() : null;
    if (both) {
      const got = both.rows.map(key);
      const same = got.length === expect.length && got.every((k, i) => k === expect[i]);
      if (!expect.length) fail('Shows Sets = 2 + Encore = Without: the two single filters do not overlap, so the intersection check proved nothing');
      else if (!same) fail(`Shows Sets = 2 + Encore = Without: ${got.length} rows, the intersection of the two single-filter lists is ${expect.length}`);
      else if (both.lead !== '2 on') fail(`Shows Sets = 2 + Encore = Without: the lead reads ${JSON.stringify(both.lead)}`);
      else if (both.pills.join('|') !== '2 sets|without encore') fail(`Shows Sets = 2 + Encore = Without: pills ${JSON.stringify(both.pills)} -- expected group order`);
      else if (both.count !== `${got.length} shows · 2 sets · without encore · newest first`) fail(`Shows Sets = 2 + Encore = Without: count line ${JSON.stringify(both.count)}`);
      else pass(`Sets = 2 + Encore = Without: ${got.length} rows = ${sets2.rows.length} ∩ ${noEnc.rows.length}, pills ${JSON.stringify(both.pills)}, count ${JSON.stringify(both.count)}`);

      // A pill clears ITS group only.
      const pilled = await evaluate(`(() => {${SHOWS_JS} const p = [...document.querySelectorAll('.screen .filter-pill')].find((x) => /without encore/.test(x.textContent)); if (!p) return null; p.click(); return true; })()`);
      await sleep(900);
      const after = pilled ? await readFiltered() : null;
      if (!after) fail('Shows pills: no "without encore" pill to remove');
      else if (after.rows.length !== sets2.rows.length || after.lead !== '1 on' || after.pills.join('|') !== '2 sets') {
        fail(`Shows pills: removing one pill left ${after.rows.length} rows, lead ${JSON.stringify(after.lead)}, pills ${JSON.stringify(after.pills)} -- expected ${sets2.rows.length} rows, "1 on", ["2 sets"]`);
      } else pass(`removing the "without encore" pill leaves Sets = 2 alone: ${after.rows.length} rows, lead "1 on"`);
    }
  }

  // Clear all, through the sheet: the lead reads Off and every row is back.
  const cleared = await evaluate(`(() => {${SHOWS_JS} const lead = leadBy('filter'); if (!lead) return null; lead.click();
    const c = [...document.querySelectorAll('.sheet .sheet-actions .btn')].find((b) => b.textContent.trim() === 'Clear all'); if (!c) { closeSheet(); return 'no Clear all'; } c.click();
    const a = [...document.querySelectorAll('.sheet .sheet-actions .btn')].find((b) => /^Show \\d+ shows$/.test(b.textContent.trim())); if (!a) { closeSheet(); return 'no apply'; } const t = a.textContent.trim(); a.click(); return t; })()`);
  await sleep(1000);
  const afterClear = await readFiltered();
  if (afterClear.lead !== 'Off' || afterClear.rows.length !== compact.rows.length || afterClear.pills.length) {
    fail(`Shows Clear all: lead ${JSON.stringify(afterClear.lead)}, ${afterClear.rows.length} rows, ${afterClear.pills.length} pill(s) (apply read ${JSON.stringify(cleared)})`);
  } else pass(`Clear all: lead "Off", ${afterClear.rows.length} rows, no pills (apply read ${JSON.stringify(cleared)})`);

  // --- The state wheel -----------------------------------------------------------
  //
  // A scroll-snap listbox, not a <select>: its options are the venues table's
  // distinct states (compared against the raw table), the first is Any, the
  // rows are the 44px the view and the stylesheet both assume, the band sits
  // two rows down, and ArrowDown on the focused wheel moves the selection and
  // the group title with it -- the chosen value readable without scrolling.
  console.log('\nShows: the state wheel:');
  const wheelProbe = await evaluate(`(() => {${SHOWS_JS}
    const lead = leadBy('filter'); if (!lead) return null; lead.click();
    const w = document.querySelector('.sheet .wheel'); if (!w) { closeSheet(); return { opened: false }; }
    const opts = [...w.querySelectorAll('.wheel-option')];
    const band = document.querySelector('.sheet .wheel-band');
    const rowH = opts.length ? Math.round(opts[0].getBoundingClientRect().height) : null;
    const before = opts.findIndex((o) => o.getAttribute('aria-selected') === 'true');
    w.focus();
    w.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const descs = [...document.querySelectorAll('.sheet .sheet-group-desc')].map((d) => d.textContent.trim());
    return { opened: true, role: w.getAttribute('role'), tabindex: w.getAttribute('tabindex'), options: opts.map((o) => o.textContent.trim()), rowH, band: !!band,
      bandTop: band ? Math.round(band.getBoundingClientRect().top - w.getBoundingClientRect().top) : null, before, focused: document.activeElement === w, descs, active: w.getAttribute('aria-activedescendant') };
  })()`);
  await sleep(800);
  const wheelAfter = await evaluate(`(() => { const w = document.querySelector('.sheet .wheel'); if (!w) return null;
    const opts = [...w.querySelectorAll('.wheel-option')]; const i = opts.findIndex((o) => o.getAttribute('aria-selected') === 'true');
    const title = [...document.querySelectorAll('.sheet .sheet-group-title')].map((d) => d.textContent.trim())[2];
    const apply = [...document.querySelectorAll('.sheet .sheet-actions .btn')].map((b) => b.textContent.trim())[0];
    const active = w.getAttribute('aria-activedescendant');
    const b = document.querySelector('.sheet-backdrop'); if (b) b.click();
    return { selected: i, label: opts[i] ? opts[i].textContent.trim() : null, scrollTop: Math.round(w.scrollTop), title, apply, activeOk: opts[i] ? opts[i].id === active : false }; })()`);
  await sleep(300);
  if (!wheelProbe || !wheelProbe.opened) fail('Shows wheel: the Filter sheet did not open with a wheel');
  else {
    const rawStates = rawVenues ? [...new Set(rawVenues.map((v) => String(v.state || '')).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en')) : null;
    const problems = [];
    if (wheelProbe.role !== 'listbox' || wheelProbe.tabindex !== '0') problems.push(`role ${wheelProbe.role}, tabindex ${wheelProbe.tabindex} -- not a focusable listbox`);
    if (wheelProbe.options[0] !== 'Any') problems.push(`first option is ${JSON.stringify(wheelProbe.options[0])}, not Any`);
    if (wheelProbe.rowH !== 44) problems.push(`option rows are ${wheelProbe.rowH}px; wheel() assumes 44`);
    if (wheelProbe.bandTop !== 88) problems.push(`the band sits ${wheelProbe.bandTop}px down, not two rows (88)`);
    if (wheelProbe.before !== 0) problems.push(`option ${wheelProbe.before} selected at rest, expected Any (0)`);
    if (!wheelProbe.focused) problems.push('the wheel did not take focus');
    if (rawStates && wheelProbe.options.slice(1).join('|') !== rawStates.join('|')) problems.push(`options ${JSON.stringify(wheelProbe.options.slice(1))} vs the venues table ${JSON.stringify(rawStates)}`);
    if (wheelProbe.descs.length !== 3 || wheelProbe.descs.some((d) => !d)) problems.push(`${wheelProbe.descs.length} group description(s), expected three non-empty`);
    if (!wheelAfter || wheelAfter.selected !== 1) problems.push(`ArrowDown left option ${wheelAfter && wheelAfter.selected} selected (scrollTop ${wheelAfter && wheelAfter.scrollTop})`);
    else if (wheelAfter.title !== `State · ${wheelAfter.label}`) problems.push(`after ArrowDown the group title reads ${JSON.stringify(wheelAfter.title)}, the wheel ${JSON.stringify(wheelAfter.label)}`);
    else if (!wheelAfter.activeOk) problems.push('aria-activedescendant does not name the selected option');
    if (problems.length) for (const p of problems) fail(`Shows wheel: ${p}`);
    else pass(`listbox of ${wheelProbe.options.length} (Any + ${wheelProbe.options.length - 1} states${rawStates ? ', = the venues table' : ''}), 44px rows, band at row 3, ArrowDown selects ${JSON.stringify(wheelAfter.label)} and the title reads it; apply reads ${JSON.stringify(wheelAfter.apply)}`);
    if (!rawStates) skip('Shows wheel: Carton unreachable -- the option list was not compared with the venues table');
  }

  // --- When: the sheet's year, then month, lands on the typed search's list ----
  //
  // Two routes to one set: When 2019 from the sheet against typing "2019" with
  // When on All, then Aug 2019 against "August 2019". The search box must NOT
  // be written to by When (0.1.75 did that; the two are separate narrowings
  // now and the sheet says so). The year grid is compared with the years the
  // compact rows actually span, two renderings of one source.
  console.log('\nShows: When:');
  await setShowsWhen(null);
  const typedRows = async (q) => {
    await setShowsQuery(q);
    const r = await evaluate(`(() => {${SHOWS_JS} return showRows().map((x) => x.title + '|' + x.venue); })()`);
    await setShowsQuery('');
    return r;
  };
  const typed2019 = await typedRows('2019');
  const typedAug2019 = await typedRows('August 2019');
  const whenYear = await setShowsWhen(2019);
  const yearShot = await evaluate(`(() => {${SHOWS_JS} return { lead: leadVal('when'), rows: showRows().map((x) => x.title + '|' + x.venue), search: document.querySelector('.search').value, count: countLine() }; })()`);
  const whenMonth = await setShowsWhen(2019, 'Aug');
  const monthShot = await evaluate(`(() => {${SHOWS_JS} return { lead: leadVal('when'), rows: showRows().map((x) => x.title + '|' + x.venue), count: countLine() }; })()`);
  const sameRows = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  if (whenYear !== 'year') fail(`Shows When: could not pick 2019 (${whenYear})`);
  else if (yearShot.lead !== '2019') fail(`Shows When: after picking 2019 the lead reads ${JSON.stringify(yearShot.lead)}`);
  else if (!yearShot.rows.length) fail('Shows When: 2019 has no rows -- the comparison proved nothing');
  else if (!sameRows(yearShot.rows, typed2019)) fail(`Shows When: 2019 from the sheet gives ${yearShot.rows.length} rows, typing "2019" gives ${typed2019.length}`);
  else if (yearShot.search !== '') fail(`Shows When: picking a year wrote ${JSON.stringify(yearShot.search)} into the search box`);
  else pass(`When 2019 = typing "2019": ${yearShot.rows.length} rows, lead "2019", search box untouched, count ${JSON.stringify(yearShot.count)}`);
  if (whenMonth !== 'month') fail(`Shows When: could not pick Aug 2019 (${whenMonth})`);
  else if (monthShot.lead !== 'Aug 2019') fail(`Shows When: the lead reads ${JSON.stringify(monthShot.lead)}, expected "Aug 2019"`);
  else if (!monthShot.rows.length) fail('Shows When: Aug 2019 has no rows -- the comparison proved nothing');
  else if (!sameRows(monthShot.rows, typedAug2019)) fail(`Shows When: Aug 2019 from the sheet gives ${monthShot.rows.length} rows, typing "August 2019" gives ${typedAug2019.length}`);
  else pass(`When Aug 2019 = typing "August 2019": ${monthShot.rows.length} rows, lead "Aug 2019"`);

  // The search narrows what When picked: a venue word taken FROM a row inside
  // Aug 2019, so at least one row must survive -- a word that matched nothing
  // would pass the "no kept row mismatches" test over an empty list, which is
  // the vacuous pass the cold review caught in the first version ("festival").
  const narrowWord = (() => {
    for (const r of monthShot.rows) {
      const w = (r.split('|')[1] || '').split(' · ')[0].split(/\s+/).find((t) => /^[A-Za-z]{4,}$/.test(t));
      if (w) return w;
    }
    return null;
  })();
  const insideShot = narrowWord ? await (async () => {
    await setShowsQuery(narrowWord);
    const r = await evaluate(`(() => {${SHOWS_JS} return { rows: showRows(), count: countLine(), lead: leadVal('when') }; })()`);
    await setShowsQuery('');
    return r;
  })() : null;
  const narrowRe = narrowWord ? new RegExp(narrowWord, 'i') : null;
  if (!insideShot) fail('Shows When + search: no venue word of four letters in any Aug 2019 row to search for');
  else if (insideShot.lead !== 'Aug 2019') fail(`Shows When + search: typing cleared When (lead ${JSON.stringify(insideShot.lead)})`);
  else if (!insideShot.rows.length) fail(`Shows When + search: "${narrowWord}" kept no rows inside Aug 2019, so the narrowing proved nothing`);
  else if (insideShot.rows.length > monthShot.rows.length) fail(`Shows When + search: "${narrowWord}" widened Aug 2019 (${insideShot.rows.length} > ${monthShot.rows.length})`);
  else if (insideShot.rows.some((r) => !narrowRe.test(r.venue))) fail(`Shows When + search: a kept row does not match "${narrowWord}": ${JSON.stringify(insideShot.rows.find((r) => !narrowRe.test(r.venue)))}`);
  else if (!insideShot.count.includes(`matching “${narrowWord}”`)) fail(`Shows When + search: count line ${JSON.stringify(insideShot.count)}`);
  else pass(`search narrows When: "${narrowWord}" inside Aug 2019 -> ${insideShot.rows.length} of ${monthShot.rows.length} rows, count ${JSON.stringify(insideShot.count)}`);

  const whenSheet = await evaluate(`(() => {${SHOWS_JS} const lead = leadBy('when'); if (!lead) return null; lead.click();
    const grids = [...document.querySelectorAll('.sheet .chip-grid')];
    const years = grids[0] ? [...grids[0].querySelectorAll('.chip')].map((c) => ({ t: c.textContent.trim(), on: c.getAttribute('aria-pressed') === 'true' })) : [];
    const months = [...document.querySelectorAll('.sheet .month-grid .chip')].map((c) => ({ t: c.textContent.trim(), on: c.getAttribute('aria-pressed') === 'true' }));
    const all = sheetOption('All shows');
    const out = { years, months, allDesc: all ? ((all.querySelector('.sheet-option-desc') || {}).textContent || '').trim() : null, allPressed: all ? all.getAttribute('aria-pressed') : null,
      titles: [...document.querySelectorAll('.sheet .sheet-group-title')].map((n) => n.textContent.trim()), overflowsX: grids[0] ? grids[0].scrollWidth > grids[0].clientWidth + 1 : null };
    if (all) all.click(); else closeSheet();
    return out; })()`);
  await sleep(1100);
  const afterAll = await evaluate(`(() => {${SHOWS_JS} return { lead: leadVal('when'), rows: showRows().length }; })()`);
  if (!whenSheet) fail('Shows When sheet: no When lead');
  else {
    const rowYears = [...new Set(compact.rows.map((r) => r.title.slice(-4)))].sort((a, b) => Number(b) - Number(a));
    const sheetYears = whenSheet.years.map((y) => y.t);
    const problems = [];
    if (sheetYears.join() !== rowYears.join()) problems.push(`the year grid ${JSON.stringify(sheetYears)} vs the years the rows span ${JSON.stringify(rowYears)}`);
    if (whenSheet.years.filter((y) => y.on).map((y) => y.t).join() !== '2019') problems.push(`pressed year(s) ${JSON.stringify(whenSheet.years.filter((y) => y.on).map((y) => y.t))}, expected ["2019"]`);
    if (whenSheet.months.filter((m) => m.on).map((m) => m.t).join() !== 'Aug') problems.push(`pressed month(s) ${JSON.stringify(whenSheet.months.filter((m) => m.on).map((m) => m.t))}, expected ["Aug"]`);
    if (whenSheet.months.length < 2) problems.push(`${whenSheet.months.length} month chip(s) for 2019`);
    if (whenSheet.allDesc !== 'Every show played, newest first.') problems.push(`the All shows row's description reads ${JSON.stringify(whenSheet.allDesc)}`);
    if (whenSheet.allPressed !== 'false') problems.push(`All shows reads pressed=${whenSheet.allPressed} while Aug 2019 is picked`);
    if (whenSheet.titles.join('|') !== 'Year|Month in 2019') problems.push(`group titles ${JSON.stringify(whenSheet.titles)}`);
    if (whenSheet.overflowsX) problems.push('the year grid scrolls horizontally');
    if (afterAll.lead !== 'All' || afterAll.rows !== compact.rows.length) problems.push(`"All shows" left the lead ${JSON.stringify(afterAll.lead)} and ${afterAll.rows} rows`);
    if (problems.length) for (const p of problems) fail(`Shows When sheet: ${p}`);
    else pass(`the When sheet: All shows (described) + ${sheetYears.length} years = the rows' years, 2019 and Aug pressed, ${whenSheet.months.length} months; "All shows" returns ${afterAll.rows} rows`);
  }

  // --- View: Detail is the card list, the choice sticks, re-entry resets the rest
  console.log('\nShows: View, and what re-entry resets:');
  await setShowsWhen(2019);
  const detailOk = await setShowsView('detail');
  const detailShot = await evaluate(`(() => {${SHOWS_JS}
    const cards = [...document.querySelectorAll('.screen .card')].filter((c) => c.querySelector('.setlist-song') || [...c.querySelectorAll('.badge')].some((b) => /No setlist recorded/.test(b.textContent)));
    return { cards: cards.length, rows: showRows().length, count: countLine(), when: leadVal('when'),
      loadOlder: !!([...document.querySelectorAll('.screen button')].find((b) => /^Load \\d+ older$/.test(b.textContent.trim()))),
      carton: cards.filter((c) => c.querySelector('.carton-link')).length }; })()`);
  const nYear = Number((detailShot.count.match(/^(\d+)/) || [])[1]);
  if (!detailOk) fail('Shows View: could not switch to Detail');
  else if (detailShot.rows) fail(`Shows View: ${detailShot.rows} compact rows render under Detail`);
  else if (!detailShot.cards) fail('Shows View: no cards under Detail');
  else if (detailShot.cards !== Math.min(15, nYear)) fail(`Shows View: ${detailShot.cards} cards for a count line of ${nYear} (page is 15)`);
  else if (nYear > 15 && !detailShot.loadOlder) fail('Shows View: more than one page and no "Load older"');
  else if (detailShot.carton !== detailShot.cards) fail(`Shows View: ${detailShot.carton} of ${detailShot.cards} cards carry a Carton link`);
  else pass(`Detail under When 2019: ${detailShot.cards} cards of ${nYear}, Load older ${detailShot.loadOlder}, every card links to Carton`);

  // Step into a show from a card and back: When, Filter and View all survive.
  await setShowsFilter({ encore: 'with' });
  const stepped = await evaluate(`(() => { const b = [...document.querySelectorAll('.screen .card .card-actions .btn-small')].find((x) => x.textContent.trim() === 'Show detail'); if (!b) return false; b.click(); return true; })()`);
  await sleep(1300);
  const onShow = await evaluate('location.hash');
  await evaluate(`location.hash = '#/shows';`); await sleep(1500);
  const back = await evaluate(`(() => {${SHOWS_JS} return { when: leadVal('when'), view: leadVal('view'), filter: leadVal('filter') }; })()`);
  // Re-enter from Home: When and Filter reset, View sticks.
  await evaluate(`location.hash = '#/home';`); await sleep(900);
  await evaluate(`location.hash = '#/shows';`); await sleep(1500);
  const reentered = await evaluate(`(() => {${SHOWS_JS} return { when: leadVal('when'), view: leadVal('view'), filter: leadVal('filter'), pills: document.querySelectorAll('.screen .filter-pill').length }; })()`);
  if (!stepped || !/^#\/show\//.test(String(onShow))) fail(`Shows re-entry: could not step into a show from a card (${onShow})`);
  else if (back.when !== '2019' || back.view !== 'Detail' || back.filter !== '1 on') fail(`Shows re-entry: stepping back from ${onShow} reads When ${JSON.stringify(back.when)}, Filter ${JSON.stringify(back.filter)}, View ${JSON.stringify(back.view)} -- expected 2019 / 1 on / Detail kept`);
  else pass(`stepping back from ${onShow} keeps When 2019, Filter "1 on" and View Detail`);
  if (reentered.when !== 'All' || reentered.filter !== 'Off' || reentered.pills) fail(`Shows re-entry: from Home the tab reads When ${JSON.stringify(reentered.when)}, Filter ${JSON.stringify(reentered.filter)}, ${reentered.pills} pill(s) -- expected All / Off, no pills`);
  else if (reentered.view !== 'Detail') fail(`Shows re-entry: the View did not stick (${JSON.stringify(reentered.view)})`);
  else pass('re-entering from Home resets When and Filter and keeps View Detail');

  // The View sheet: two described rows and the footer line, verbatim.
  const viewSheet = await evaluate(`(() => {${SHOWS_JS} const lead = leadBy('view'); if (!lead) return null; lead.click();
    const rows = [...document.querySelectorAll('.sheet .sheet-option')].map((r) => ({ name: ((r.querySelector('.sheet-option-name') || {}).textContent || '').trim(), desc: ((r.querySelector('.sheet-option-desc') || {}).textContent || '').trim(), on: r.getAttribute('aria-pressed') }));
    const foot = ((document.querySelector('.sheet .sheet-foot') || {}).textContent || '').trim();
    const o = sheetOption('Compact'); if (o) o.click(); else closeSheet();
    return { rows, foot }; })()`);
  await sleep(1100);
  if (!viewSheet) fail('Shows View sheet: no View lead');
  else if (viewSheet.rows.map((r) => r.name).join('|') !== 'Compact|Detail') fail(`Shows View sheet: rows ${JSON.stringify(viewSheet.rows.map((r) => r.name))}`);
  else if (viewSheet.rows.some((r) => !r.desc)) fail('Shows View sheet: a row has no description');
  else if (viewSheet.rows.filter((r) => r.on === 'true').map((r) => r.name).join() !== 'Detail') fail(`Shows View sheet: pressed ${JSON.stringify(viewSheet.rows.filter((r) => r.on === 'true').map((r) => r.name))}, expected Detail`);
  else if (viewSheet.foot !== 'The view sticks until changed. Either view respects When and Filter.') fail(`Shows View sheet: footer reads ${JSON.stringify(viewSheet.foot)}`);
  else pass('the View sheet: Compact and Detail, both described, Detail pressed, footer line verbatim');

  // --- The three leads fit their widest trio at 390px AND 360px -----------------
  //
  // The widest When value is a month and the newest year ("Oct 2026"), taken
  // from the newest row rather than typed, so the check follows the archive;
  // the Filter value is "3 on" with three groups set; the View value is the
  // longer of its two, "Compact". The 0.1.81 rules apply (docs/plan.md, 0.1.82
  // (a) as amended): the bar never overflows, no value is clipped or nowrap,
  // and at 360 the WHEN value is on two lines while Filter and View stay on
  // one -- a one-line When at 360 could only mean something was shortened. The
  // Filter value is one token: it contains the non-breaking space.
  console.log('\nShows: the chip bar fits its widest trio at 390px and 360px:');
  const newest = compact.rows[0].title.match(/([A-Z][a-z]{2}) \d{1,2}, (\d{4})$/);
  const widestWhen = newest ? `${newest[1]} ${newest[2]}` : null;
  const whenOk = newest ? await setShowsWhen(Number(newest[2]), newest[1]) : 'no newest row';
  const threeOn = await setShowsFilter({ sets: '2', encore: 'with', state: 'CT' });
  const MEASURE_TRIO = `(() => {
    const t = (n) => ((n || {}).textContent || '').trim();
    const lines = (n) => n ? Math.max(1, Math.round(n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight))) : null;
    const bar = document.querySelector('.screen .sortbar');
    return { viewport: window.innerWidth, docClient: document.documentElement.clientWidth, docScroll: document.documentElement.scrollWidth,
      bar: bar ? { client: bar.clientWidth, scroll: bar.scrollWidth, height: Math.round(bar.getBoundingClientRect().height),
        chips: [...bar.querySelectorAll('.chip-lead')].map((c) => { const v = c.querySelector('.chip-value'); return {
          lead: c.getAttribute('data-lead'), text: t(v).replace(/\\u00a0/g, ' '), nbsp: t(v).includes('\\u00a0'), chipWidth: Math.round(c.getBoundingClientRect().width), chipHeight: Math.round(c.getBoundingClientRect().height),
          valueLines: lines(v), valueClient: v ? v.clientWidth : null, valueScroll: v ? v.scrollWidth : null, chipClient: c.clientWidth, chipScroll: c.scrollWidth, nowrap: v ? getComputedStyle(v).whiteSpace === 'nowrap' : null }; }) } : null };
  })()`;
  const trio = {};
  for (const w of [390, 360]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 844, deviceScaleFactor: 2, mobile: true });
    await sleep(400);
    trio[w] = await evaluate(MEASURE_TRIO);
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  const trioProblems = [];
  const trioSummary = [];
  if (whenOk !== 'month' || !threeOn) trioProblems.push(`could not set the widest trio (When ${whenOk}, Filter ${JSON.stringify(threeOn)})`);
  for (const w of [390, 360]) {
    const m = trio[w];
    if (m.viewport !== w) trioProblems.push(`at ${w}px: the layout viewport reads ${m.viewport}px and the document is ${m.docScroll}px wide in ${m.docClient}px -- the page overflows horizontally (or the override did not take)`);
    if (!m.bar) { trioProblems.push(`at ${w}px: no bar`); continue; }
    const b = m.bar;
    if (b.chips.length !== 3) { trioProblems.push(`at ${w}px: ${b.chips.length} lead chip(s), expected When, Filter and View`); continue; }
    if (b.chips.map((c) => c.text).join('|') !== `${widestWhen}|3 on|Compact`) { trioProblems.push(`at ${w}px: measured ${JSON.stringify(b.chips.map((c) => c.text))}, not the widest trio`); continue; }
    if (b.scroll > b.client + 1) trioProblems.push(`at ${w}px: ${b.scroll}px of content in ${b.client}px — wider than the bar, so something is off-screen`);
    const clipped = b.chips.filter((c) => c.valueScroll > c.valueClient + 1 || c.chipScroll > c.chipClient + 1);
    if (clipped.length) trioProblems.push(`at ${w}px: ${clipped.map((c) => `"${c.text}" value ${c.valueScroll}px in ${c.valueClient}px, chip ${c.chipScroll}px in ${c.chipClient}px`).join(', ')} — a value clipped inside its chip`);
    if (b.chips.some((c) => c.nowrap)) trioProblems.push(`at ${w}px: a value is white-space: nowrap`);
    if (!b.chips[1].nbsp) trioProblems.push(`at ${w}px: the Filter value "3 on" is not one token (no non-breaking space)`);
    if (b.chips[1].valueLines !== 1 || b.chips[2].valueLines !== 1) trioProblems.push(`at ${w}px: Filter/View values on ${b.chips[1].valueLines}/${b.chips[2].valueLines} lines, expected one each`);
    trioSummary.push(`${w}px: bar ${b.scroll}/${b.client}px, ${b.height}px tall; ${b.chips.map((c) => `"${c.text}" ${c.chipWidth}×${c.chipHeight}px, ${c.valueLines} line${c.valueLines === 1 ? '' : 's'}`).join(' + ')}`);
  }
  const w390 = trio[390] && trio[390].bar, w360 = trio[360] && trio[360].bar;
  if (w390 && w390.chips.length === 3 && w390.chips[0].valueLines !== 1) trioProblems.push(`at 390px: the When value wrapped (${w390.chips[0].valueLines} lines) -- the trio fits at 390 and should not need to`);
  if (w360 && w360.chips.length === 3 && w360.chips[0].valueLines < 2) trioProblems.push(`at 360px: the When value is on ${w360.chips[0].valueLines} line -- the trio fits at 360 only if something was shortened`);
  if (trioProblems.length) for (const p of trioProblems) fail(`Shows chip bar ${p}`);
  else pass(`widest trio fits, no value clipped — ${trioSummary.join('; ')}`);
  await setShowsWhen(null);
  await evaluate(`(() => {${SHOWS_JS} const lead = leadBy('filter'); if (!lead) return; lead.click();
    const c = [...document.querySelectorAll('.sheet .sheet-actions .btn')].find((b) => b.textContent.trim() === 'Clear all'); if (c) c.click();
    const a = [...document.querySelectorAll('.sheet .sheet-actions .btn')].find((b) => /^Show \\d+ shows$/.test(b.textContent.trim())); if (a) a.click(); else closeSheet(); })()`);
  await sleep(1000);
  await evaluate(`location.hash = '#/home';`);
  await sleep(700);
  await evaluate(`location.hash = '#/shows';`);
  await sleep(1400);

  // --- A selected chip must LOOK selected, in both themes -------------------
  //
  // The Shows section above proves the When sheet lands on the same rows as
  // typing the query. 0.1.63's month bar passed that kind of check for several
  // builds while rendering no selected state at all: correct filtering,
  // invisible control. The leads and pills are the control now, and they have
  // to LOOK like the state they carry.
  //
  // ASSERTED ON THE PAINTED FILL, NOT ON THE ATTRIBUTE. Reading aria-pressed
  // would only re-state the line added to fix this; a renamed CSS selector or
  // a dropped token would leave it green with nothing on screen. The chip's
  // computed background is compared against --chip-sel-fill resolved through a
  // probe element, so this fails unless the chip is wearing the selected paint.
  //
  // Asserted as an EXACT set of painted labels per bar, never "at least one is
  // painted": that catches both directions -- a chip that should be lit and is
  // not, AND a stale chip still lit after the filter moved on. A degenerate
  // token where the selected fill equals --surface fails here too, because
  // then every chip in the bar reports as painted.
  //
  // BOTH THEMES, SET EXPLICITLY. The two do not share a hex, and data-theme is
  // never left off: with no attribute the tokens follow the headless browser's
  // OS preference, which is how layout-diff once "verified" a light-only
  // change in a dark-mode run. The two fills are compared at the end, so a run
  // that rendered one theme twice cannot report both as covered.
  console.log('\nselected chips carry the selected paint:');

  // Every .sortbar on screen, split into its LEAD chips and its plain chips.
  // Songs' one bar is TWO leads and nothing else (0.1.81) and Shows' is THREE
  // (0.1.82: When, Filter, View), each opening its sheet; Jams' bar is plain
  // toggles. Shows also renders its active filters as pills under the bar,
  // which are selected state made visible and are read here too.
  // .chip is also used for things that are not toggles (Home's "Change"), and
  // none of those live in a .sortbar, so scoping to the bars is what keeps this
  // check about chosen state.
  const CHIP_PROBE = `(() => {
    const probe = document.createElement('span');
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--chip-sel-fill').trim();
    document.body.appendChild(probe);
    const selFill = getComputedStyle(probe).color;
    probe.remove();
    // A lead chip's STATE is its .chip-value (0.1.81): the chip also carries a
    // label and a caret, and textContent would run them together as
    // "SortA–Z▾". A plain chip has no value span and reads whole. The
    // non-breaking space in "N on" reads as a space.
    const read = (c) => ({ text: (c.querySelector('.chip-value') || c).textContent.trim().replace(/\\u00a0/g, ' ').replace(/\\s*✕$/, ''), bg: getComputedStyle(c).backgroundColor });
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      selFill,
      bars: [...document.querySelectorAll('.sortbar')].map((bar) => {
        const leads = [...bar.querySelectorAll('.chip-lead')];
        return {
          leads: leads.map(read),
          chips: [...bar.querySelectorAll('.chip')].filter((c) => !leads.includes(c)).map(read),
        };
      }),
      pills: [...document.querySelectorAll('.screen .filter-pill')].map(read),
    };
  })()`;

  // Labels in bar N whose background is the selected fill.
  const painted = (snap, i) => ((snap.bars[i] || {}).chips || []).filter((c) => c.bg === snap.selFill).map((c) => c.text);
  const chipLabels = (snap, i) => ((snap.bars[i] || {}).chips || []).map((c) => c.text);
  const leadOf = (snap, i) => ((snap.bars[i] || {}).leads || [])[0] || null;
  const allLeads = (snap) => snap.bars.flatMap((b, i) => (b.leads || []).map((l) => ({ ...l, bar: i })));
  const leadsText = (snap, i) => ((snap.bars[i] || {}).leads || []).map((l) => l.text);
  const leadsAllPainted = (snap, i) => ((snap.bars[i] || {}).leads || []).every((l) => l.bg === snap.selFill);

  const selFills = {};
  for (const theme of ['dark', 'light']) {
    await evaluate(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)});`);
    await evaluate(`location.hash = '#/home';`);
    await sleep(600);
    await evaluate(`location.hash = '#/shows';`);
    await sleep(1400);
    await setShowsQuery('');
    await setShowsView('compact');

    // 1. At rest: three leads, every one painted, reading All / Off / Compact;
    //    no plain chips beside them and no pills.
    let snap = await evaluate(CHIP_PROBE);
    selFills[theme] = snap.selFill;
    if (snap.theme !== theme) {
      fail(`chip paint (${theme}): data-theme reads ${JSON.stringify(snap.theme)} — the theme never applied`);
      continue;
    }
    if (snap.bars.length !== 1) { fail(`chip paint (${theme}): ${snap.bars.length} .sortbar(s) on Shows, expected one`); continue; }
    if (leadsText(snap, 0).join('|') !== 'All|Off|Compact') {
      fail(`chip paint (${theme}): the Shows leads read ${JSON.stringify(leadsText(snap, 0))}, expected All / Off / Compact`);
    } else if (!leadsAllPainted(snap, 0)) {
      fail(`chip paint (${theme}): a Shows lead is not in the selected fill ${snap.selFill}: ${JSON.stringify(snap.bars[0].leads)}`);
    } else if (chipLabels(snap, 0).length || snap.pills.length) {
      fail(`chip paint (${theme}): Shows at rest has plain chips ${JSON.stringify(chipLabels(snap, 0))} / pills ${JSON.stringify(snap.pills)}`);
    } else pass(`${theme}: Shows at rest — All / Off / Compact, all three in the selected fill (${snap.selFill})`);

    // 2. A year through the When sheet: the When lead carries it and stays
    //    painted. It is the only thing on screen saying which year you are
    //    in, so an unpainted lead is the 0.1.63 defect (correct filtering,
    //    invisible control) in its 0.1.82 location.
    const Y1 = 2019;
    if ((await setShowsWhen(Y1)) !== 'year') { fail(`chip paint (${theme}): could not pick ${Y1}`); continue; }
    snap = await evaluate(CHIP_PROBE);
    if (leadsText(snap, 0)[0] !== String(Y1)) fail(`chip paint (${theme}): the When lead reads ${JSON.stringify(leadsText(snap, 0)[0])}, expected "${Y1}"`);
    else if (!leadsAllPainted(snap, 0)) fail(`chip paint (${theme}): inside ${Y1} a lead lost the selected fill: ${JSON.stringify(snap.bars[0].leads)}`);
    else pass(`${theme}: ${Y1} carried by the When lead, selected`);

    // 3. A filter: the lead reads "1 on" and a pill wearing the selected fill
    //    names the group's choice. Then the pill clears it: "Off", no pills.
    if (!(await setShowsFilter({ sets: '2' }))) { fail(`chip paint (${theme}): could not apply Sets = 2`); continue; }
    snap = await evaluate(CHIP_PROBE);
    if (leadsText(snap, 0)[1] !== '1 on') fail(`chip paint (${theme}): the Filter lead reads ${JSON.stringify(leadsText(snap, 0)[1])}, expected "1 on"`);
    else if (snap.pills.map((p) => p.text).join('|') !== '2 sets') fail(`chip paint (${theme}): pills read ${JSON.stringify(snap.pills.map((p) => p.text))}, expected ["2 sets"]`);
    else if (snap.pills.some((p) => p.bg !== snap.selFill)) fail(`chip paint (${theme}): a pill is ${snap.pills[0].bg}, not the selected fill ${snap.selFill}`);
    else pass(`${theme}: Sets = 2 — lead "1 on", pill "2 sets" in the selected fill`);
    await evaluate(`(() => { const p = document.querySelector('.screen .filter-pill'); if (p) p.click(); })()`);
    await sleep(900);
    snap = await evaluate(CHIP_PROBE);
    if (leadsText(snap, 0)[1] !== 'Off' || snap.pills.length) fail(`chip paint (${theme}): after removing the pill the lead reads ${JSON.stringify(leadsText(snap, 0)[1])} with ${snap.pills.length} pill(s)`);
    else pass(`${theme}: the pill clears its filter — lead "Off", no pills`);
    await setShowsWhen(null);

    // 6. The same property swept across every OTHER chip bar in the app.
    //    Songs carries two (sort + filter) and Jams one, and each has a
    //    default, so exactly one chip per bar is painted at rest. This is what
    //    makes the check about the CLASS of bug rather than this one bar.
    //
    //    A bar that is LEAD CHIPS ALONE (Songs' one bar since 0.1.81: the sort
    //    lead and the filter lead side by side) is asserted on each lead:
    //    painted, and reading the default EXACTLY -- "A–Z" for the sort, "All"
    //    for the filter, in that order. "Exactly one chip painted" would be
    //    satisfied there by a lead being miscounted as a chip, which is the
    //    proxy shape this file keeps finding. Jams has no lead and must not
    //    grow one. Exact, not startsWith: the value span IS the state, and a
    //    prefix match would pass "A–Z" against a chip reading "A–Zebra".
    for (const [where, hash, wantBars, wantLeads] of [['Songs', '#/songs', 1, ['A–Z', 'All']], ['Jams', '#/jams', 1, []]]) {
      await evaluate(`location.hash = ${JSON.stringify(hash)};`);
      await sleep(1400);
      const s2 = await evaluate(CHIP_PROBE);
      if (s2.bars.length < wantBars) {
        fail(`chip paint (${theme}): ${where} rendered ${s2.bars.length} chip bar(s), expected ${wantBars}`);
        continue;
      }
      const leads = allLeads(s2);
      if (leads.length !== wantLeads.length) {
        fail(`chip paint (${theme}): ${where} has ${leads.length} lead chip(s) (${JSON.stringify(leads.map((l) => l.text))}), expected ${wantLeads.length} (${wantLeads.join(', ') || 'none -- no sheet to lead to'})`);
        continue;
      }
      const bad = s2.bars
        .map((_, i) => [i, painted(s2, i)])
        .filter(([i, p]) => (leadOf(s2, i) ? p.length !== 0 : p.length !== 1));
      const leadBad = leads.filter((l, k) => l.bg !== s2.selFill || l.text !== wantLeads[k]);
      if (bad.length) {
        fail(`chip paint (${theme}): ${where} ${bad.map(([i, p]) => `bar #${i} paints ${JSON.stringify(p)}`).join(', ')} — expected exactly one selected chip (none beside a lead)`);
      } else if (leadBad.length) {
        fail(`chip paint (${theme}): ${where} lead chip is ${JSON.stringify(leadBad[0])}, expected "${wantLeads[leads.indexOf(leadBad[0])]}" in the selected fill ${s2.selFill}`);
      } else {
        pass(`${theme}: ${where} — ${s2.bars.map((_, i) => JSON.stringify(leadOf(s2, i) ? s2.bars[i].leads.map((l) => l.text).join(' / ') : painted(s2, i)[0])).join(' + ')} selected`);
      }
    }
  }

  // The two themes must not have rendered the same paint. If they did, one of
  // them never applied and half of this section verified nothing -- the exact
  // way a light-only regression stays invisible.
  if (!selFills.dark || !selFills.light) {
    fail(`chip paint: only ${Object.keys(selFills).join(', ') || 'no'} theme(s) produced a fill`);
  } else if (selFills.dark === selFills.light) {
    fail(`chip paint: dark and light both resolve --chip-sel-fill to ${selFills.dark} — one theme did not apply`);
  } else pass(`selected fill differs by theme (dark ${selFills.dark}, light ${selFills.light})`);

  // Leave the screen as this section found it: no forced theme, no query.
  await evaluate(`document.documentElement.removeAttribute('data-theme');`);
  await evaluate(`location.hash = '#/shows';`);
  await sleep(1200);
  await setShowsQuery('');

  // --- One figure per row, and it follows the ACTIVE SORT -------------------
  //
  // Asserted as a CORRESPONDENCE, never as "a figure is present". A fixed
  // column would satisfy the weaker check while being exactly the bug -- the
  // whole point is that the column says what the chip above it says.
  //
  //   A–Z          -> times played        meta: Last {date}
  //   Coldest      -> shows since played  meta: Last {date}
  //   Hottest      -> shows since played  meta: Last {date}
  //   Most played  -> times played        meta: Last {date}
  //   Least played -> times played (top row: 1 time)   meta: Last {date}
  //   Longest gap  -> longest gap         meta: {date} → {date}, or {date} → still open
  //
  // The sort is picked through the LEAD CHIP AND THE SHEET (0.1.76), the same
  // two taps a thumb makes. The state is read from the lead chip's .chip-value
  // (0.1.81), because the row that was tapped is gone with the sheet. The
  // sheet lists options as .sheet-option rows -- a name and a description --
  // so an option is found by its .sheet-option-name, never by the row's whole
  // text, which would include the description.
  //
  // "SHOWS" became "SINCE PLAYED" in 0.1.73 for a reason the top row of
  // "Hottest first" demonstrates on its own: the hottest song has a gap of 0,
  // and "0 SHOWS" reads as never played -- the opposite of the truth. So that
  // row is asserted to read exactly 0, not merely to exist. A never-played
  // song renders an em dash there, so this cannot pass by the sort collapsing.
  //
  // The meta line is checked NEGATIVELY (no "124×", no "gap 10") and
  // POSITIVELY (it still leads with the date, or under "Longest gap" is the
  // span) in the same pass. Without the positive half a row that rendered no
  // meta at all would satisfy the negative one -- an empty string contains
  // neither. The span regex requires BOTH ends -- a date, or the words "still
  // open" -- so a row that printed only the from-date would fail it.
  console.log('\nsort drives the one figure in the row:');
  await evaluate(`location.hash = '#/songs';`);
  await sleep(1500);
  const yolk = await evaluate(`(() => {
    const probe = document.createElement('span');
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--yolk').trim();
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color; probe.remove(); return c;
  })()`);

  // Page-side helpers, spliced into each evaluate: the lead chip is found by
  // its own label -- "Sort" or "Filter" -- not by position in the bar, so
  // swapping the two chips would not swap the checks; its state is the
  // .chip-value span.
  const LEAD_JS = `
    const leadByLabel = (which) => [...document.querySelectorAll('.screen .sortbar .chip-lead')]
      .find((c) => ((c.querySelector('.chip-label') || {}).textContent || '') === which) || null;
    const leadValue = (which) => { const c = leadByLabel(which); const v = c && c.querySelector('.chip-value'); return v ? v.textContent.trim() : null; };`;

  // Open the named lead's sheet, tap the option whose NAME matches, and report
  // whether both existed. A missing sheet closes nothing; a missing option
  // closes the sheet it opened so the next step does not run under a backdrop.
  const clickOption = async (which, label) =>
    evaluate(`(() => {${LEAD_JS}
      const lead = leadByLabel(${JSON.stringify(which)});
      if (!lead) return false;
      lead.click();
      const c = [...document.querySelectorAll('.sheet .sheet-option')].find((x) => ((x.querySelector('.sheet-option-name') || {}).textContent || '').trim() === ${JSON.stringify(label)});
      if (!c) { const b = document.querySelector('.sheet-backdrop'); if (b) b.click(); return false; }
      c.click();
      return true;
    })()`);
  const clickSort = (label) => clickOption('Sort', label);
  const clickFilter = (label) => clickOption('Filter', label);

  const DATE = '[A-Z][a-z]{2} \\d{1,2}, \\d{4}';
  const META_LAST = new RegExp(`^Last ${DATE}`);
  const META_SPAN = new RegExp(`^${DATE} → (${DATE}|still open)`);
  for (const [label, wantUnit, wantTopNum, wantMeta] of [
    ['A–Z', 'times', null, META_LAST],
    ['Coldest first', 'since played', null, META_LAST],
    ['Hottest first', 'since played', '0', META_LAST],
    ['Most played', 'times', null, META_LAST],
    // The top row under Least played is a one-play song, so its unit is the
    // SINGULAR and its figure is 1 -- both asserted, because a sort that put a
    // many-play song first would read 'times' and a larger number.
    ['Least played', 'time', '1', META_LAST],
    ['Longest gap', 'longest gap', null, META_SPAN],
  ]) {
    if (!(await clickSort(label))) { fail(`sort: no "${label}" in the sort sheet`); continue; }
    await sleep(900);
    const r = await evaluate(`(() => {${LEAD_JS}
      const sheetOpen = !!document.querySelector('.sheet');
      const li = document.querySelector('.rows li');
      const num = li && li.querySelector('.gap-num');
      const unit = li && li.querySelector('.gap-unit');
      const meta = li && li.querySelector('.row-meta');
      return {
        // The value span is the state; the label and caret beside it are not.
        activeChip: leadValue('Sort'),
        sheetOpen,
        figures: li ? li.querySelectorAll('.gap-figure').length : null,
        num: num ? num.textContent.trim() : null,
        unit: unit ? unit.textContent.trim().toLowerCase() : null,
        colour: num ? getComputedStyle(num).color : null,
        meta: meta ? meta.textContent.trim() : null,
      };
    })()`);

    if (r.activeChip !== label) fail(`sort: picked "${label}" but the lead chip reads ${JSON.stringify(r.activeChip)}`);
    else if (r.sheetOpen) fail(`sort: picking "${label}" left the sort sheet open`);
    else if (r.figures !== 1) fail(`sort "${label}": the row carries ${r.figures} figure column(s), expected exactly 1`);
    else if (r.unit !== wantUnit) {
      fail(`sort "${label}": figure column reads ${JSON.stringify(r.unit)}, expected ${JSON.stringify(wantUnit)}`);
    } else if (r.colour !== yolk) {
      fail(`sort "${label}": the figure is ${r.colour}, not the yolk accent ${yolk}`);
    } else if (wantTopNum !== null && r.num !== wantTopNum) {
      fail(`sort "${label}": top row reads ${JSON.stringify(r.num)}, expected ${JSON.stringify(wantTopNum)} — the top row belongs to the song with the smallest figure`);
    } else if (!wantMeta.test(r.meta || '')) {
      fail(`sort "${label}": meta line is ${JSON.stringify(r.meta)}, expected ${wantMeta}`);
    } else if (/×|\bgap \d/.test(r.meta)) {
      fail(`sort "${label}": meta line repeats the figure — ${JSON.stringify(r.meta)}`);
    } else {
      pass(`"${label}" -> one ${r.unit} figure (${r.num}, ${r.colour}), meta ${JSON.stringify(r.meta)}`);
    }
  }

  // --- "Longest gap": one flat list, non-increasing, every row a dated span
  //
  // (0.1.81) The figure is the longest gap each song has been through, closed
  // or still open -- the larger of the longest closed gap and the current one
  // (docs/plan.md, "0.1.81 design", (a)) -- so every listed song has a number
  // and the list is one ul.rows like every other sort. Read from the screen,
  // never from the index:
  //   (a) no .section renders on the screen and exactly one ul.rows does --
  //       the 0.1.77 sections are gone, not merely emptied; a lone header
  //       would still be a .section;
  //   (b) every figure is <= the one before it, and every figure is a number:
  //       a dash means a listed song was given neither figure, which under
  //       this rule is a defect, not a tail;
  //   (c) every row's meta is a span with BOTH ends -- "{date} → {date}" for
  //       a closed gap, "{date} → still open" for an open one -- and BOTH
  //       kinds occur, so neither branch of the rule went untested;
  //   (d) no row carries a cover credit: the span took the whole line
  //       (docs/plan.md, (d)), and the cover note is asserted PRESENT on a
  //       cover row under A–Z further down, so this is not "no credits
  //       anywhere";
  //   (e) the row count equals the count line, and the count line says what
  //       the figure is (the locked wording for Longest gap + All).
  // Red proofs (0.1.81): tie rule flipped to closed -- (c) still passes, the
  // unit tests catch it; cover credit left in -- (d) names the first row;
  // comparator sign flipped -- (b) "climbs at row 2".
  console.log('\n"Longest gap" is one flat list, non-increasing, every row a dated span:');
  const readFlat = () => evaluate(`(() => {
    const t = (n) => ((n || {}).textContent || '').trim();
    const count = [...document.querySelectorAll('.screen .note')].map(t).find((x) => /^\\d+ songs?\\b/.test(x)) || '';
    return {
      countLine: count ? Number(count.match(/^(\\d+)/)[1]) : null,
      countText: count,
      sections: document.querySelectorAll('.screen .section').length,
      lists: document.querySelectorAll('.screen ul.rows').length,
      rows: [...document.querySelectorAll('.screen .rows li')].map((li) => ({
        title: t(li.querySelector('.row-title')),
        num: t(li.querySelector('.gap-num')),
        meta: t(li.querySelector('.row-meta')),
        cover: !!li.querySelector('.cover-note'),
      })),
    };
  })()`);

  if (!(await clickSort('Longest gap'))) fail('longest gap: no "Longest gap" in the sort sheet');
  else {
    await sleep(900);
    const flat = await readFlat();
    const problems = [];
    const nums = flat.rows.map((r) => r.num);
    const values = nums.map(Number);
    const OPEN_SPAN = new RegExp(`^${DATE} → still open`);
    const CLOSED_SPAN = new RegExp(`^${DATE} → ${DATE}`);
    if (flat.sections !== 0) problems.push(`(a) ${flat.sections} .section element(s) render under the sort -- the sections are back`);
    if (flat.lists !== 1) problems.push(`(a) ${flat.lists} ul.rows render, expected one flat list`);
    if (!values.length) problems.push('(b) no rows at all -- nothing was ordered');
    const dash = nums.indexOf('—');
    if (dash !== -1) problems.push(`(b) row ${dash + 1} "${flat.rows[dash].title}" reads a dash -- every listed song has an open gap, so a dash is a song given neither figure`);
    if (values.some((n) => !Number.isFinite(n))) problems.push('(b) a non-numeric figure');
    for (let i = 1; i < values.length; i++) if (values[i] > values[i - 1]) { problems.push(`(b) climbs at row ${i + 1}: ${values[i]} after ${values[i - 1]}`); break; }
    const open = flat.rows.filter((r) => OPEN_SPAN.test(r.meta)).length;
    const closed = flat.rows.filter((r) => CLOSED_SPAN.test(r.meta)).length;
    const badMeta = flat.rows.findIndex((r) => !OPEN_SPAN.test(r.meta) && !CLOSED_SPAN.test(r.meta));
    if (badMeta !== -1) problems.push(`(c) row ${badMeta + 1} is neither a two-date span nor "→ still open": ${JSON.stringify(flat.rows[badMeta])}`);
    if (!open) problems.push('(c) no row reads "still open" -- the open branch of the rule went untested');
    if (!closed) problems.push('(c) no row carries a two-date span -- the closed branch went untested');
    const covered = flat.rows.findIndex((r) => r.cover);
    if (covered !== -1) problems.push(`(d) row ${covered + 1} "${flat.rows[covered].title}" carries a cover credit under the span`);
    if (flat.countLine !== flat.rows.length) problems.push(`(e) the count line says ${flat.countLine}, the list holds ${flat.rows.length}`);
    if (!/the longest gap each song has been through, open or closed/.test(flat.countText)) problems.push(`(e) the count line reads ${JSON.stringify(flat.countText)}`);
    if (!flat.rows.length) fail('longest gap: no rows rendered under the sort');
    else if (problems.length) for (const p of problems) fail(`longest gap: ${p}`);
    else pass(`${flat.rows.length} rows in one list = count line, non-increasing: ${open} still open, ${closed} closed; no dashes, no cover credits`);
  }

  // --- A–Z, "Most played" and "Least played" show the SAME FACT, so they must
  // --- RENDER the same
  //
  // All three put times played in the figure column (0.1.73; "Least played"
  // joined in 0.1.81); they differ in row ORDER and in nothing else. Compared
  // on ONE song, isolated with the
  // search box, because the two sorts put different songs at the top -- a
  // first-row comparison would be comparing two different songs and would pass
  // or fail for reasons that have nothing to do with the treatment.
  //
  // Guarded against the empty case in both directions: exactly one row must
  // match, it must be the song asked for, and its figure markup must be
  // non-empty. Two missing figures also compare equal, and that is the failure
  // this repo keeps rediscovering.
  console.log('\nA–Z, Most played and Least played render the same figure:');
  const PROBE_SONG = 'Agatha';
  const setSongQuery = async (v) => {
    await evaluate(`(() => { const s = document.querySelector('.search'); if (!s) return false;
      s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await sleep(600);
  };
  await setSongQuery(PROBE_SONG);
  const shots = {};
  for (const label of ['A–Z', 'Most played', 'Least played']) {
    if (!(await clickSort(label))) { fail(`figure parity: no "${label}" in the sort sheet`); continue; }
    await sleep(700);
    shots[label] = await evaluate(`(() => {
      const lis = [...document.querySelectorAll('.rows li')];
      const f = lis.length === 1 ? lis[0].querySelector('.gap-figure') : null;
      return {
        rows: lis.length,
        title: lis.length === 1 ? lis[0].querySelector('.row-title').textContent.trim() : null,
        html: f ? f.outerHTML : null,
        colour: f ? getComputedStyle(f.querySelector('.gap-num')).color : null,
        width: f ? Math.round(f.getBoundingClientRect().width) : null,
      };
    })()`);
  }
  const azFig = shots['A–Z'];
  const others = ['Most played', 'Least played'].map((l) => [l, shots[l]]);
  if (!azFig || others.some(([, f]) => !f)) fail('figure parity: one of the three sorts never reported');
  else if (azFig.rows !== 1 || others.some(([, f]) => f.rows !== 1)) {
    fail(`figure parity: query "${PROBE_SONG}" matched ${[azFig, ...others.map(([, f]) => f)].map((f) => f.rows).join('/')} rows, expected exactly 1 each`);
  } else if (azFig.title !== PROBE_SONG || others.some(([, f]) => f.title !== PROBE_SONG)) {
    fail(`figure parity: the isolated row is ${JSON.stringify([azFig, ...others.map(([, f]) => f)].map((f) => f.title))}, not ${JSON.stringify(PROBE_SONG)}`);
  } else if (!azFig.html || others.some(([, f]) => !f.html)) {
    fail('figure parity: a row rendered no figure column at all');
  } else {
    const diff = others.find(([, f]) => f.html !== azFig.html);
    const paint = others.find(([, f]) => f.colour !== azFig.colour || f.width !== azFig.width);
    if (diff) fail(`figure parity: A–Z renders ${azFig.html} but ${diff[0]} renders ${diff[1].html}`);
    else if (paint) fail(`figure parity: same markup, different paint — A–Z ${azFig.colour}/${azFig.width}px vs ${paint[0]} ${paint[1].colour}/${paint[1].width}px`);
    else pass(`"${PROBE_SONG}" renders identically under all three: ${azFig.html}`);
  }
  await setSongQuery('');
  await clickSort('A–Z');
  await sleep(600);

  // --- Jams tab: the COUNT is green, the title is not -----------------------
  //
  // Compared against the jam colour as RENDERED on another screen, never a hex
  // -- the same discipline as every other jam check, so a retune moves both
  // together or fails.
  //
  // The negative half matters as much: green means "this was a jam chart
  // entry", a per-performance fact. The song TITLE must stay plain here, and
  // the Songs list must stay plain entirely. Asserting only "the count is
  // green" would pass just as happily with green leaking across the app.
  console.log('\njams tab, green on the count:');
  for (const theme of ['dark', 'light']) {
    await evaluate(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)});`);

    // The reference: a highlighted title in a real setlist.
    await evaluate(`location.hash = '#/show/1779890028';`);
    await sleep(1200);
    const ref = await evaluate(
      `(() => { const n = document.querySelector('.setlist-song[data-jam="true"]'); return n ? getComputedStyle(n).color : null; })()`,
    );

    await evaluate(`location.hash = '#/jams';`);
    await sleep(1400);
    const jams = await evaluate(`(() => {
      const count = document.querySelector('.jam-count');
      const row = count ? count.closest('.row-shell') : null;
      const title = row ? row.querySelector('.row-title') : null;
      const plainTitle = document.querySelector('.row-title');
      return {
        count: count ? getComputedStyle(count).color : null,
        countWeight: getComputedStyle(count).fontWeight,
        countSize: getComputedStyle(count).fontSize,
        title: title ? getComputedStyle(title).color : null,
        plainTitle: plainTitle ? getComputedStyle(plainTitle).color : null,
        unit: (() => { const u = row && row.querySelector('.gap-unit'); return u ? getComputedStyle(u).color : null; })(),
      };
    })()`);

    if (!ref) fail(`jams (${theme}): no highlighted setlist title to compare against`);
    else if (!jams.count) fail(`jams (${theme}): no .jam-count rendered`);
    else if (jams.count !== ref) fail(`jams (${theme}): count is ${jams.count}, jam colour elsewhere is ${ref}`);
    else pass(`${theme}: count ${jams.count} matches the rendered jam colour`);

    if (jams.title && jams.title === jams.count) {
      fail(`jams (${theme}): the song TITLE is green too — green marks the count, not the song`);
    } else pass(`${theme}: title stays plain (${jams.title})`);

    // Songs list must be untouched -- an explicit boundary, not an oversight.
    await evaluate(`location.hash = '#/songs';`);
    await sleep(1400);
    const songs = await evaluate(`(() => {
      const green = [...document.querySelectorAll('#main *')].filter((n) => {
        const c = getComputedStyle(n).color;
        return c === ${JSON.stringify(ref)};
      }).length;
      return { greenNodes: green, counts: document.querySelectorAll('.jam-count').length };
    })()`);
    if (songs.counts) fail(`jams (${theme}): .jam-count leaked onto the Songs list`);
    else if (songs.greenNodes) fail(`jams (${theme}): ${songs.greenNodes} element(s) on Songs render the jam colour`);
    else pass(`${theme}: Songs list carries no jam green`);
  }
  await evaluate(`document.documentElement.removeAttribute('data-theme');`);

  // --- Weight is a LIGHT-ONLY second channel --------------------------------
  //
  // Light uses weight because colour alone cannot carry the separation there:
  // clearing 4.5:1 on white forces a dark green, and sRGB has no vivid green
  // that dark. Dark needs no help and keeps colour alone. See docs/design.md.
  //
  // Compared against the NON-JAM setlist text in the same card, never against
  // a literal weight. A hardcoded 600 would keep passing if the body text were
  // ever bolded to match, which is precisely the state this must detect.
  console.log('\njam weight, light only:');
  await evaluate(`location.hash = '#/show/1779890028';`);
  await sleep(1300);
  const weights = {};
  for (const theme of ['dark', 'light']) {
    await evaluate(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)});`);
    await sleep(500);
    weights[theme] = await evaluate(`(() => {
      const songs = [...document.querySelectorAll('.setlist-song')];
      const jam = songs.find((s) => s.dataset.jam === 'true');
      const plain = songs.find((s) => s.dataset.jam !== 'true');
      if (!jam || !plain) return null;
      const w = (n) => Number(getComputedStyle(n).fontWeight);
      // Height of the line box: if weight reflowed anything, the card grows.
      const card = jam.closest('.card');
      return { jam: w(jam), plain: w(plain), cardH: Math.round(card.getBoundingClientRect().height) };
    })()`);
  }
  await evaluate(`document.documentElement.removeAttribute('data-theme');`);

  if (!weights.dark || !weights.light) fail('jam weight: could not find both a jam and a non-jam song');
  else {
    if (weights.dark.jam !== weights.dark.plain) {
      fail(`jam weight (dark): jam is ${weights.dark.jam}, surrounding text ${weights.dark.plain} — dark must stay colour-only`);
    } else pass(`dark: jam matches the setlist text (${weights.dark.jam}) — colour alone`);

    if (weights.light.jam <= weights.light.plain) {
      fail(`jam weight (light): jam is ${weights.light.jam}, not heavier than the ${weights.light.plain} around it`);
    } else pass(`light: jam ${weights.light.jam} against surrounding ${weights.light.plain}`);

    // The two themes must genuinely differ, or the token collapsed to one value.
    if (weights.dark.jam === weights.light.jam) {
      fail(`jam weight: both themes render ${weights.dark.jam} — the per-theme token is not applying`);
    } else pass('the two themes use different weights, as intended');
  }

  // --- Show notes live INSIDE the setlist card ------------------------------
  //
  // 2026-08-06 has show notes AND 7 jam entries, so one visit covers both the
  // placement and the fact that the jam section is unaffected by it.
  //
  // The assertion is on ANCESTRY -- `.card .setlist-shownotes` -- not on the
  // notes merely existing. "Show notes are on the page" was true of the old
  // layout too, so it would pass without the change having happened, which is
  // the whole failure mode this project keeps re-learning. Ordering within the
  // card is checked the same way: against the rendered DOM, not assumed.
  console.log('\nshow notes placement:');
  await evaluate(`location.hash = '#/show/1779890028';`);
  await sleep(1200);
  const notes = await evaluate(`(() => {
    const card = document.querySelector('.section .card');
    const inCard = card ? card.querySelector('.setlist-shownotes') : null;
    const anywhere = document.querySelector('.setlist-shownotes');
    const fn = card ? card.querySelector('.fn-list') : null;
    // Ordering inside the card, read off the DOM.
    let order = null;
    if (inCard && fn) {
      order = fn.compareDocumentPosition(inCard) & Node.DOCUMENT_POSITION_FOLLOWING
        ? 'notes after footnotes' : 'notes BEFORE footnotes';
    }
    const label = inCard ? inCard.querySelector('.setlist-note-label') : null;
    const setLabelEl = card ? card.querySelector('.setlist-label') : null;
    const same = label && setLabelEl
      ? ['fontSize','fontWeight','letterSpacing','textTransform','color']
          .every(k => getComputedStyle(label)[k] === getComputedStyle(setLabelEl)[k])
      : false;
    return {
      anywhere: !!anywhere,
      inCard: !!inCard,
      order,
      labelText: label ? label.textContent : null,
      matchesSetLabel: same,
      jamCards: document.querySelectorAll('.jam-card-song').length,
      // The old layout put notes in a section of their own. Nothing may sit
      // between the setlist card's section and the jam section any more.
      strayNoteSection: [...document.querySelectorAll('.section-title')]
        .some(t => t.textContent.trim().toLowerCase() === 'show notes'),
    };
  })()`);

  if (!notes.anywhere) fail('show notes: not rendered at all on a show that has them');
  else if (!notes.inCard) fail('show notes: rendered OUTSIDE the setlist card');
  else pass('show notes render inside the setlist card');

  if (notes.order !== 'notes after footnotes') fail(`show notes: ${notes.order}`);
  else pass('order inside the card is setlist -> footnotes -> show notes');

  if (notes.labelText !== 'Show notes') fail(`show notes: header reads ${JSON.stringify(notes.labelText)}`);
  else if (!notes.matchesSetLabel) fail('show notes: header does not match the set labels in that card');
  else pass('header matches the set labels (size, weight, tracking, case, colour)');

  if (notes.strayNoteSection) fail('show notes: a separate "Show notes" section is still rendering');
  else pass('no separate show-notes section below the card');

  if (notes.jamCards !== 7) fail(`show notes: expected 7 jam cards on this show, found ${notes.jamCards}`);
  else pass('jam section unaffected — 7 entries still below the card');

  // A show WITHOUT notes renders no header and no empty block. Long setlist on
  // purpose, so "nothing rendered" cannot be satisfied by a failed render.
  await evaluate(`location.hash = '#/show/1627919708';`);
  await sleep(1100);
  const noNotes = await evaluate(`(() => ({
    songs: document.querySelectorAll('.setlist-song').length,
    block: document.querySelectorAll('.setlist-shownotes').length,
    label: document.querySelectorAll('.setlist-note-label').length,
  }))()`);
  if (noNotes.songs !== 28) fail(`show notes: the no-notes show did not render (${noNotes.songs} songs, expected 28)`);
  else if (noNotes.block || noNotes.label) fail('show notes: empty notes block rendered on a show with none');
  else pass('a show with 28 songs and no notes renders no block and no header');

  // --- Home's venue block: no doubled header, one action row ----------------
  //
  // The block opened with a section header carrying the venue name, two lines
  // under a venue line that already said it, and the Carton link stood alone
  // on its own row -- .carton-link has min-height: var(--tap), so that was a
  // 44px box around 10px of text with nothing beside it to share the height.
  // Together they were most of the dead space above the set structure.
  //
  // THE LINK MOVED WITHOUT BEING PROMOTED, and that is asserted by COMPARISON
  // against a Carton link on another screen rather than against literals: if
  // the .carton-link treatment is ever retuned both move together, and a
  // literal here would be the copy that drifted.
  console.log('\nHome venue block:');
  for (const theme of ['dark', 'light']) {
    await evaluate(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)});`);
    await evaluate(`location.hash = '#/home';`);
    await sleep(1500);

    const home = await evaluate(`(() => {
      const venueLine = document.querySelector('.screen .venue-line');
      const venueName = venueLine ? venueLine.textContent.split('·')[0].trim() : null;
      const titles = [...document.querySelectorAll('.section-title')].map((n) => n.textContent.trim());
      const btn = [...document.querySelectorAll('.btn-small')].find((b) => b.textContent.trim() === 'Venue history');
      const link = btn ? btn.parentElement.querySelector('.carton-link') : null;
      const grid = document.querySelector('.stat-grid');
      const cs = link ? getComputedStyle(link) : null;
      const box = (n) => { const r = n.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, mid: r.top + r.height / 2 }; };
      return {
        venueName,
        // A header repeating the venue name, compared case-insensitively:
        // .section-title is text-transform uppercase and innerText reports
        // RENDERED casing.
        echoes: titles.filter((t) => venueName && t.toLowerCase() === venueName.toLowerCase()),
        sameRow: !!(btn && link),
        btnMid: btn ? box(btn).mid : null,
        linkMid: link ? box(link).mid : null,
        gridTop: grid ? box(grid).top : null,
        venueBottom: venueLine ? box(venueLine).bottom : null,
        style: cs ? { size: cs.fontSize, weight: cs.fontWeight, color: cs.color, border: cs.borderTopWidth } : null,
      };
    })()`);

    if (!home.venueName) { fail(`Home (${theme}): no venue line found`); continue; }
    if (home.echoes.length) {
      fail(`Home (${theme}): a section header still repeats the venue line — ${JSON.stringify(home.echoes)}`);
    } else pass(`${theme}: no header repeats "${home.venueName}"`);

    if (!home.sameRow) {
      fail(`Home (${theme}): the Carton link is not in the Venue history action row`);
    } else if (Math.abs(home.btnMid - home.linkMid) > 1) {
      fail(`Home (${theme}): link is not centred against the button (${Math.round(home.linkMid - home.btnMid)}px off)`);
    } else pass(`${theme}: Carton link sits beside Venue history, centred to within 1px`);

    // The stats sit under the venue line, not under a header that is gone.
    if (home.gridTop === null) fail(`Home (${theme}): no stat grid`);
    else {
      const gap = Math.round(home.gridTop - home.venueBottom);
      pass(`${theme}: stats start ${gap}px below the venue line`);
    }
  }

  // Not promoted: same rendering as a Carton link on another screen.
  await evaluate(`location.hash = '#/home';`);
  await sleep(1400);
  const homeLink = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('.btn-small')].find((b) => b.textContent.trim() === 'Venue history');
    const l = btn && btn.parentElement.querySelector('.carton-link');
    if (!l) return null;
    const c = getComputedStyle(l);
    return { size: c.fontSize, weight: c.fontWeight, color: c.color, border: c.borderTopWidth, display: c.display };
  })()`);
  await evaluate(`location.hash = '#/venue/73';`);
  await sleep(1400);
  const otherLink = await evaluate(`(() => {
    const l = document.querySelector('.carton-link');
    if (!l) return null;
    const c = getComputedStyle(l);
    return { size: c.fontSize, weight: c.fontWeight, color: c.color, border: c.borderTopWidth };
  })()`);

  if (!homeLink || !otherLink) fail('Carton link: could not compare Home against another screen');
  else {
    const differs = ['size', 'weight', 'color', 'border'].filter((k) => homeLink[k] !== otherLink[k]);
    if (differs.length) {
      fail(`Carton link: Home's differs from the venue screen's on ${differs.join(', ')} — ${JSON.stringify(homeLink)} vs ${JSON.stringify(otherLink)}`);
    } else pass(`moved, not promoted: ${homeLink.size}/${homeLink.weight}, border ${homeLink.border}, same as elsewhere`);
  }
  await evaluate(`document.documentElement.removeAttribute('data-theme');`);

  // --- Home's hierarchy: one hero object, then reference (0.1.74) -----------
  //
  // The page read as a flat stack of same-weight sections. Two things fixed it
  // and both are asserted, because either one alone would leave the complaint
  // standing:
  //
  //  1. The upcoming show is ONE element. Not "a .hero exists" -- that would
  //     pass on an empty div. The h1, the venue line, the stat grid and the
  //     action row must all be INSIDE it, which is the claim that makes the
  //     stats unambiguously part of the show rather than of the section below.
  //  2. The countdown kicker must render SMALLER than the section titles under
  //     it. It used to BE a .section-title, so "IN 81 DAYS" and "ON THIS DATE"
  //     were the same element at the same size and the page had three headings
  //     of equal rank. Measured as a comparison, never against 11px: a type
  //     scale retune must move both together or fail here.
  //
  // And the order: the hero first, "On this date" last. Asserted by position in
  // the rendered document, not by reading the source.
  console.log('\nHome hierarchy:');
  for (const theme of ['dark', 'light']) {
    await evaluate(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)});`);
    await evaluate(`location.hash = '#/home';`);
    await sleep(1500);
    const h = await evaluate(`(() => {
      const screen = document.querySelector('.screen');
      const hero = screen && screen.querySelector('.hero');
      const kicker = hero && hero.querySelector('.hero-kicker');
      const titles = [...screen.querySelectorAll('.section-title')];
      const sections = [...screen.querySelectorAll(':scope > .section')];
      const last = sections[sections.length - 1];
      return {
        heroes: screen ? screen.querySelectorAll('.hero').length : null,
        holds: hero ? {
          h1: !!hero.querySelector('.screen-title'),
          venue: !!hero.querySelector('.venue-line'),
          stats: !!hero.querySelector('.stat-grid'),
          actions: !!hero.querySelector('.card-actions'),
        } : null,
        heroIsFirst: hero ? screen.firstElementChild === hero : null,
        kickerIsSectionTitle: kicker ? kicker.classList.contains('section-title') : null,
        kickerSize: kicker ? parseFloat(getComputedStyle(kicker).fontSize) : null,
        titleSizes: titles.map((t) => parseFloat(getComputedStyle(t).fontSize)),
        lastSectionTitle: last ? (last.querySelector('.section-title') || {}).textContent : null,
      };
    })()`);

    if (h.heroes !== 1) fail(`Home (${theme}): ${h.heroes} .hero element(s), expected exactly 1`);
    else {
      const missing = Object.entries(h.holds || {}).filter(([, v]) => !v).map(([k]) => k);
      if (missing.length) {
        fail(`Home (${theme}): the hero card does not contain ${missing.join(', ')} — the show's parts are still loose on the page`);
      } else if (!h.heroIsFirst) {
        fail(`Home (${theme}): something renders above the upcoming show`);
      } else pass(`${theme}: one hero holding the date, venue, stats and actions, first on the screen`);
    }

    const minTitle = Math.min(...(h.titleSizes.length ? h.titleSizes : [0]));
    if (h.kickerIsSectionTitle) {
      fail(`Home (${theme}): the countdown is still a .section-title — it ranks equal with the page's headings`);
    } else if (!h.kickerSize || !minTitle) {
      fail(`Home (${theme}): could not measure the kicker (${h.kickerSize}) against the section titles (${JSON.stringify(h.titleSizes)})`);
    } else if (h.kickerSize >= minTitle) {
      fail(`Home (${theme}): the countdown is ${h.kickerSize}px against section titles at ${minTitle}px — it must be smaller`);
    } else pass(`${theme}: countdown ${h.kickerSize}px under section titles at ${minTitle}px`);

    if (!/^on this date/i.test(String(h.lastSectionTitle || '').trim())) {
      fail(`Home (${theme}): the last section is ${JSON.stringify(h.lastSectionTitle)}, expected "On this date"`);
    } else pass(`${theme}: "On this date" is the last section on the page`);
  }
  await evaluate(`document.documentElement.removeAttribute('data-theme');`);

  // --- The merged "Previous shows" card says each show ONCE (0.1.74) --------
  //
  // "Previous set structures" and "Last time at {venue}" were two sections over
  // the same history, and the structure list's top row WAS the show in the card
  // below it: Toad's Place printed "Nov 26, 2025  S1+S2+E" and then, 250px
  // lower, "Wed, Nov 26, 2025" with SET 1 / SET 2 / ENCORE spelled out.
  //
  // WHAT THIS CHECK IS FOR: the merged card on a venue WITH a prior visit --
  // the most recent visit expanded as a setlist, the visits before it as
  // one-liners in the same card's foot, each show printed once.
  //
  // THIS NEEDS A SHOW THAT ACTUALLY HAS VENUE HISTORY. The default selection is
  // whichever upcoming show is next, and that is often a venue with none: Home
  // then renders the run-only card ("Earlier in this run" over one-liners) or
  // the empty state, and there is no visit to expand. The first version of this
  // walk broke on "the section has one-liners", which run rows also satisfy, and
  // then asserted a setlist body -- so on 2026-10-18, with the next show at a
  // never-played venue inside a three-show run, it reported the app broken when
  // the app was right. Same shape as every other failure in CLAUDE.md: a
  // condition wider than the thing asserted.
  //
  // WHETHER THE VENUE HAS HISTORY IS READ FROM THE VENUE SCREEN, not from the
  // card being tested and not from the hero's "shows played here" count. The
  // card is the thing under test, so it cannot be its own witness; the hero
  // count includes visits WITHOUT a setlist (Toad's Place: 12 played, 3 with
  // setlists), and the card expands the newest visit WITH one. The venue screen
  // puts .badge-set on exactly the rows that have setlist rows, so its count is
  // the same universe. The walk hops there via the hero's "Venue history" button
  // and back; the picked show survives the hop in localStorage.
  //
  // Three outcomes per picked show, and the first two are asserted:
  //   venue has setlist shows, card has no setlist body  -> FAIL (the bug)
  //   venue has none, section has run one-liners         -> run-only shape
  //   venue has setlist shows, body AND one-liners        -> the merge, below
  // If no upcoming show reaches the merge, that reports SKIP, not a green tick.
  console.log('\nHome merges the venue history into one card:');
  await evaluate(`location.hash = '#/home';`);
  await sleep(1400);
  const pickerCount = await evaluate(`(() => {
    const c = [...document.querySelectorAll('.screen .chip')].find((x) => x.textContent.trim() === 'Change');
    if (!c) return 0;
    c.click();
    const n = document.querySelectorAll('.sheet .sheet-item').length;
    const back = document.querySelector('.sheet-backdrop');
    if (back) back.click();
    return n;
  })()`);

  let merged = null;
  let runOnly = null;
  let notExpanded = null;
  for (let i = 0; i < pickerCount; i++) {
    await evaluate(`(() => {
      const c = [...document.querySelectorAll('.screen .chip')].find((x) => x.textContent.trim() === 'Change');
      if (c) c.click();
      const items = document.querySelectorAll('.sheet .sheet-item');
      if (items[${i}]) items[${i}].click();
    })()`);
    await sleep(1400);
    const probe = await evaluate(`(() => {
      const heads = [...document.querySelectorAll('.screen .section-head')];
      const prev = heads.find((n) => /previous/i.test(n.textContent));
      const card = prev && prev.parentElement.querySelector('.card');
      if (!card) return null;
      const headDate = (card.firstElementChild || {}).textContent || '';
      const foot = card.querySelector('.card-foot');
      return {
        sections: [...document.querySelectorAll('.screen .section-title')].map((n) => n.textContent.trim()),
        headDate: headDate.trim(),
        hasSetlist: !!card.querySelector('.setlist-card-body'),
        // EVERY visit one-liner in the section, and separately the ones sitting
        // in the foot. Selecting only the foot would make a build that renders
        // no foot at all look like a show with no older visits -- the walk would
        // run out and report SKIP, which is how the pre-merge layout would have
        // slipped past the check written to describe the merge.
        //
        // .visit-list, NOT .fn-list. The merged card holds two fn-lists -- these
        // rows and the setlist's own footnotes -- so the broader selector
        // counted footnotes as visits, and this check passed its first green run
        // only because the show it walked to had a setlist with none. Exactly
        // the house failure: a real number about a wider universe than the
        // output implies.
        listRows: [...prev.parentElement.querySelectorAll('.visit-list li')].map((li) => li.textContent.trim()),
        footRows: foot ? [...foot.querySelectorAll('.visit-list li')].map((li) => li.textContent.trim()) : [],
        cards: prev.parentElement.querySelectorAll('.card').length,
        hasFoot: !!foot,
        runTitle: [...prev.parentElement.querySelectorAll('.section-title')].some((n) => /earlier in this run/i.test(n.textContent)),
        actionsBeforeFoot: !!(foot && card.querySelector('.card-actions') &&
          card.querySelector('.card-actions').compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING),
      };
    })()`);
    if (!probe) continue; // no Previous shows card at all -- nothing to say about this show

    // Independent witness: how many shows WITH a setlist the venue screen lists.
    const hopped = await evaluate(`(() => {
      const b = [...document.querySelectorAll('.hero .card-actions .btn-small')].find((x) => x.textContent.trim() === 'Venue history');
      if (!b) return false; b.click(); return true;
    })()`);
    if (!hopped) { fail(`Home: picker item ${i} renders no "Venue history" button on the hero`); break; }
    await sleep(1000);
    const venue = await evaluate(`(() => {
      const head = [...document.querySelectorAll('.screen .section-head')].find((n) => /every show/i.test(n.textContent));
      if (!head) return null;
      return { hash: location.hash, setlistShows: head.parentElement.querySelectorAll('.badge-set').length };
    })()`);
    await evaluate(`location.hash = '#/home';`);
    await sleep(1400);
    if (!venue || !String(venue.hash).startsWith('#/venue/')) {
      fail(`Home: picker item ${i}: "Venue history" did not land on a venue screen (${venue ? venue.hash : 'no Every show section'})`);
      break;
    }

    if (venue.setlistShows > 0 && !probe.hasSetlist) {
      notExpanded = { i, venue, probe };
      break;
    }
    if (venue.setlistShows === 0 && probe.listRows.length && !runOnly) runOnly = { i, probe };
    if (venue.setlistShows > 0 && probe.hasSetlist && probe.listRows.length) { merged = probe; break; }
  }

  if (runOnly) {
    const p = runOnly.probe;
    const wrong = [
      p.hasSetlist ? 'a setlist body' : null,
      p.hasFoot ? 'a .card-foot' : null,
      !p.runTitle ? 'no "Earlier in this run" title' : null,
      p.cards !== 1 ? `${p.cards} cards` : null,
    ].filter(Boolean);
    if (wrong.length) fail(`Home: a venue with no prior visit renders ${wrong.join(', ')} -- expected one run-only card`);
    else pass(`run-only shape: one card, "Earlier in this run" over ${p.listRows.length} one-liner(s), no setlist, no foot (picker item ${runOnly.i})`);
  }

  if (notExpanded) {
    fail(`Home: the venue screen lists ${notExpanded.venue.setlistShows} show(s) with a setlist, but the Previous shows card renders no setlist -- the most recent visit is not expanded (picker item ${notExpanded.i})`);
  } else if (!merged) {
    skip(`no upcoming show has a prior visit with a setlist AND older one-liners (walked ${pickerCount} show(s)) -- the merge could not be exercised`);
  } else if (merged.footRows.length !== merged.listRows.length) {
    fail(`Home: ${merged.listRows.length - merged.footRows.length} one-liner(s) sit outside the expanded card's foot — the two sections are still two objects`);
  } else {
    // The date heading the expanded card, reduced to "Mon D, YYYY" so it can be
    // compared against the short form the one-liners use.
    const shortHead = merged.headDate.replace(/^[A-Za-z]{3},\s*/, '');
    const dupes = merged.footRows.filter((r) => r.includes(shortHead));
    if (dupes.length) {
      fail(`Home: ${JSON.stringify(shortHead)} is both the expanded card and a one-liner below it — ${JSON.stringify(dupes)}`);
    } else pass(`the expanded visit ${JSON.stringify(shortHead)} appears once; ${merged.footRows.length} older visit(s) below it`);

    if (merged.cards !== 1) {
      fail(`Home: the Previous shows section holds ${merged.cards} cards, expected 1 — the two sections are still two objects`);
    } else pass(`one card: setlist + ${merged.footRows.length} one-liner(s)`);

    if (!merged.actionsBeforeFoot) {
      fail('Home: the older visits do not follow the action row — "Show detail" would read as applying to the whole list');
    } else pass('older visits sit below the action row, behind a rule');

    const stale = merged.sections.filter((t) => /last time at|previous set structures/i.test(t));
    if (stale.length) fail(`Home: a pre-merge header is still rendering — ${JSON.stringify(stale)}`);
    else pass(`headers: ${JSON.stringify(merged.sections)}`);
  }
  await evaluate(`localStorage.removeItem('dozen.selectedShow.v1');`);
  await evaluate(`location.hash = '#/home';`);
  await sleep(1200);

  // --- Venue text is one size everywhere it is not in a row -----------------
  //
  // Reported twice: "venue names are too small again", both times about the On
  // This Date cards on Home. They were NOT bypassing venueLine() -- they were
  // calling it with { small: true }, a flag 0.1.24 shipped in the same commit
  // as the helper meant to stop exactly this. Seven of eleven call sites
  // passed it.
  //
  // WHAT THIS MEASURES IS THE RENDERED PIXEL SIZE, not a class name and not a
  // call site. tests/hygiene.test.mjs already asserts the flag is gone from
  // the source; a source check cannot tell you that the CSS which replaced it
  // actually lands on the element. Two different claims, both needed.
  //
  // The expected value is DERIVED, from the venue line on the Home hero --
  // .venue-line with no modifier, the one placement nobody has ever called too
  // small. A literal 15px here would be a second copy of --t-md and would go
  // red on a deliberate retune of the type scale rather than on this bug.
  console.log('\nvenue text size:');
  for (const theme of ['dark', 'light']) {
    await evaluate("document.documentElement.setAttribute('data-theme', " + JSON.stringify(theme) + ");");
    await evaluate("location.hash = '#/home';");
    await sleep(1500);

    const vsize = await evaluate(`(() => {
      const px = (n) => Math.round(parseFloat(getComputedStyle(n).fontSize) * 100) / 100;
      const all = [...document.querySelectorAll('.screen .venue-line')];
      if (!all.length) return null;
      // The hero line is the only .venue-line on Home outside a card.
      const hero = all.find((n) => !n.closest('.card'));
      const inCards = all.filter((n) => n.closest('.card') && !n.closest('.row-main'));
      return {
        hero: hero ? px(hero) : null,
        // Reported as the DISTINCT sizes found, so "they all agree" and "there
        // was only one of them" are distinguishable in the output.
        cardSizes: [...new Set(inCards.map(px))],
        cards: inCards.length,
        // The place half must not be quietly smaller than the name half.
        placeSizes: [...new Set(all.flatMap((n) => [...n.querySelectorAll('.place')].map(px)))],
      };
    })()`);

    if (!vsize) { fail("venue size (" + theme + "): no .venue-line on Home"); continue; }
    if (vsize.hero === null) { fail("venue size (" + theme + "): no un-nested venue line to derive the size from"); continue; }
    // Both sides rendering nothing is the failure this repo keeps hitting:
    // zero cards would make the comparison below vacuously true.
    if (!vsize.cards) { fail("venue size (" + theme + "): no card venue lines rendered - nothing was compared"); continue; }

    if (vsize.cardSizes.some((n) => n < vsize.hero)) {
      fail("venue size (" + theme + "): card venue lines render at " + JSON.stringify(vsize.cardSizes) + "px, hero is " + vsize.hero + "px");
    } else pass(theme + ": " + vsize.cards + " card venue lines at " + JSON.stringify(vsize.cardSizes) + "px, matching the hero's " + vsize.hero + "px");

    const smallPlace = vsize.placeSizes.filter((n) => n < vsize.hero);
    if (smallPlace.length) {
      fail("venue size (" + theme + "): the place half renders at " + JSON.stringify(smallPlace) + "px against " + vsize.hero + "px");
    } else pass(theme + ": city/state renders at the same size as the venue name");
  }

  // The step-down that IS intended: inside a dense row, where the line shares
  // a fixed-height row with a badge. Asserted as truncating too, so "the row
  // rule stopped applying" reads as a failure rather than as an improvement.
  //
  // COMPACT VIEW, SET EXPLICITLY. The rows are the compact Shows rows (every
  // show, as of 0.1.82); under Detail there are cards and no .row-main, and the
  // first version of this check navigated to the then-card landing and reported
  // "no row venue lines" -- the right failure for the wrong reason, since it
  // would have said the same thing if the rule had been deleted.
  await setShowsView('compact');
  await evaluate("location.hash = '#/shows';");
  await sleep(1500);
  await evaluate(`(() => { const s = document.querySelector('.search');
    if (!s) return false; s.value = '2019';
    s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(1200);
  const rowSize = await evaluate(`(() => {
    const px = (n) => Math.round(parseFloat(getComputedStyle(n).fontSize) * 100) / 100;
    const rows = [...document.querySelectorAll('.row-main > .venue-line')];
    if (!rows.length) return null;
    return {
      n: rows.length,
      sizes: [...new Set(rows.map(px))],
      clipped: rows.filter((n) => getComputedStyle(n).textOverflow === 'ellipsis').length,
    };
  })()`);
  if (!rowSize) fail('venue size: no row venue lines on #/shows');
  else if (rowSize.sizes.length !== 1) fail("venue size: rows disagree - " + JSON.stringify(rowSize.sizes) + "px");
  else if (rowSize.clipped !== rowSize.n) fail("venue size: " + (rowSize.n - rowSize.clipped) + " of " + rowSize.n + " row lines are sized down without truncating");
  else pass("dense rows: " + rowSize.n + " lines at " + rowSize.sizes[0] + "px, all truncating");
  await evaluate("document.documentElement.removeAttribute('data-theme');");

  // --- "On this date" names its month ---------------------------------------
  //
  // The header rendered "10/15" while the card directly beneath it rendered
  // "Wed Oct 15, 2025". Compared against THE CARDS, not against a literal
  // month name: the assertion is that the two agree, which is what was wrong,
  // and it cannot be satisfied by a header that merely looks date-shaped.
  console.log('\n"On this date" header:');
  await evaluate("location.hash = '#/home';");
  await sleep(1500);
  const otd = await evaluate(`(() => {
    const h = [...document.querySelectorAll('.section-title')].find((n) => /on this date/i.test(n.textContent));
    if (!h) return { found: false };
    const section = h.closest('.section');
    // RAW TEXT OUT, MATCHING DONE IN NODE. A backslash-d inside this template
    // literal is not an escape -- it collapses to a literal "d" before the
    // page ever sees it, so a date regex written here matches nothing and the
    // caller reads that as "no dates on screen" and reports SKIPPED. Which is
    // exactly what the first version of this did: it read as a legitimate
    // quiet run and was a broken probe. No backslashes go inside this string.
    const hero = document.querySelector('.screen .screen-title');
    return {
      found: true,
      text: h.textContent.trim(),
      heroText: hero ? hero.textContent.trim() : null,
      cardTexts: section ? [...section.querySelectorAll('.card')].map((c) => c.textContent) : [],
    };
  })()`);

  // "Fri, Sep 4, 2026" -- the weekday carries a comma. Written without one the
  // first time, which matched nothing and read as "no dates on screen".
  const DATE_RE = /[A-Z][a-z]{2},? [A-Z][a-z]{2} \d{1,2}, \d{4}/;
  otd.heroDate = otd.heroText ? (otd.heroText.match(DATE_RE) || [])[0] || null : null;
  otd.cardDates = (otd.cardTexts || []).map((t) => (t.match(DATE_RE) || [])[0]).filter(Boolean);

  // TWO SEPARATE CLAIMS, REPORTED SEPARATELY. The format assertion holds every
  // run; the agreement cross-check needs another date on screen to compare
  // against, and there is not always one. Folding them together let a real
  // pass disappear into a SKIPPED line on the first run of this check.
  let mday = null;
  if (!otd.found) fail('"On this date": header not found on Home');
  else if (/\d+\s*\/\s*\d+/.test(otd.text)) fail('"On this date": still numeric - ' + JSON.stringify(otd.text));
  else {
    mday = otd.text.match(/\(([A-Z][a-z]{2}) (\d{1,2})\)/);
    if (!mday) fail('"On this date": header does not name a month and day - ' + JSON.stringify(otd.text));
    else pass('header names its month: ' + JSON.stringify(otd.text));
  }

  if (mday) {
    // Prefer the HERO date. The section anchors off the upcoming show, whose
    // date is the h1 at the top of the same screen, so that comparison is
    // available on every run -- unlike the anniversary cards, which only exist
    // when the archive happens to hold a show on this calendar day. Both are
    // the same claim: the header and the dates around it name one day.
    const against = otd.heroDate ? [otd.heroDate] : otd.cardDates;
    const source = otd.heroDate ? 'the show it anchors on' : otd.cardDates.length + ' cards beneath it';
    if (!against.length && (otd.cardTexts || []).length) {
      // Cards on screen and not one parseable date in them is a BROKEN PROBE,
      // not a quiet run, and the two must not report the same way. This is how
      // the missing comma in DATE_RE was found: it skipped, looking exactly
      // like a legitimate "no anniversaries today".
      fail(
        '"On this date": ' + otd.cardTexts.length + ' card(s) on screen and no date parsed out of any of them' +
        ' — hero read ' + JSON.stringify(otd.heroText),
      );
    } else if (!against.length) {
      // No cards and a hero with no date in it ("Nothing on the books") is a
      // real state and proves nothing about agreement. Says what it saw, so a
      // future probe failure cannot hide here either.
      console.log(
        '  SKIPPED  nothing to compare ' + JSON.stringify(otd.text) + ' against — hero read ' +
        JSON.stringify(otd.heroText) + ', 0 cards',
      );
    } else {
      const disagree = against.filter((d) => !d.includes(mday[1] + ' ' + mday[2] + ','));
      if (disagree.length) fail('"On this date": header ' + JSON.stringify(otd.text) + ' disagrees with ' + JSON.stringify(disagree));
      else pass(JSON.stringify(otd.text) + ' agrees with ' + source + ' (' + against.join(', ') + ')');
    }
  }

  // --- The venues with a blank field render a sane place line --------------
  //
  // 0.1.67 stripped ", USA" from venue text and shipped with
  // "Washington, D.C., USA" still on screen, because the filter tested "are
  // all three fields populated" and venue 443 keeps its state INSIDE the city
  // string. tests/venueline.test.mjs pins the pure function; this pins what
  // the venue screen actually renders, which is the thing that was reported.
  //
  // THE ROW LIST IS DERIVED, NOT CURATED. It is computed from the venues table
  // at run time, so a fourth odd row appearing in Carton is picked up here
  // instead of sailing past a hardcoded list of three ids -- the exact failure
  // CLAUDE.md records for ROUTES, PAIRS and KNOWN_GAPS. Three ids in this file
  // would have been the same mistake one layer down.
  console.log('\nvenues with a blank city/state/country:');
  let oddVenues = null;
  try {
    const res = await fetch('https://thecarton.net/api/v2/venues.json?limit=20000');
    const body = await res.json();
    if (Array.isArray(body.data)) {
      oddVenues = body.data.filter((v) => !v.city || !v.state || !v.country);
    }
  } catch {
    oddVenues = null;
  }

  if (!oddVenues) {
    // An unreachable third party is not a defect in this repo.
    console.log('  SKIPPED  could not reach the venues endpoint; nothing was checked');
  } else if (!oddVenues.length) {
    // Not health. If Carton cleans these rows up the check has nothing to say,
    // and saying so is better than reporting a pass it did not earn.
    console.log('  SKIPPED  no venue has a blank city/state/country any more');
  } else {
    for (const v of oddVenues) {
      await evaluate("location.hash = '#/venue/" + v.venue_id + "';");
      await sleep(1300);
      const got = await evaluate(`(() => {
        const line = document.querySelector('.screen .venue-line');
        const title = document.querySelector('.screen .screen-title');
        return {
          place: line ? line.textContent.trim() : null,
          title: title ? title.textContent.trim() : null,
        };
      })()`);

      const label = v.venue_id + ' ' + JSON.stringify(v.venuename);

      if (got.title === 'Venue not found') { fail('venue ' + label + ': screen says "Venue not found"'); continue; }
      if (got.place === null) { fail('venue ' + label + ': no .venue-line rendered'); continue; }

      // What is actually being asserted, in order of how wrong it would be:
      //
      //  1. No trailing or doubled comma. This is the shape Carton's own
      //     `location` has on the cruise rows ("Atlantic Ocean, ") and the
      //     reason the UI stopped reading that field.
      //  2. "USA" appears ONLY when it is the whole line. Venue 192 has no
      //     city and no state, so "USA" is all there is and stripping it would
      //     leave the screen with no place at all -- that row is why the guard
      //     exists. Anywhere else the country is redundant, which is what
      //     443 was getting wrong.
      const problems = [];
      if (/,\s*$/.test(got.place)) problems.push('trailing comma');
      if (/,\s*,/.test(got.place)) problems.push('doubled comma');
      if (/\bUSA\b/.test(got.place) && got.place !== 'USA') problems.push('redundant country');

      if (problems.length) fail('venue ' + label + ': ' + JSON.stringify(got.place) + ' — ' + problems.join(', '));
      else pass(label + ' renders ' + JSON.stringify(got.place));
    }

    // The sibling-row comparison, which is what made 443 look wrong rather
    // than merely thin: 283 "Atlantis" and 443 "The Atlantis" are the same
    // Washington room in two rows, and they read "Washington, DC" and
    // "Washington, D.C., USA". Carton's punctuation still differs and that is
    // its business; whether one of them carries a country is ours.
    //
    // Both ids are looked up by NAME, so a renumbering fails loudly here
    // instead of silently checking two unrelated venues.
    const atlantis = oddVenues.length
      ? await (async () => {
          const res = await fetch('https://thecarton.net/api/v2/venues.json?limit=20000');
          const all = (await res.json()).data || [];
          return all.filter((v) => /^(the )?atlantis$/i.test(String(v.venuename).trim()));
        })()
      : [];

    if (atlantis.length < 2) {
      console.log('  SKIPPED  fewer than two Atlantis rows; the sibling comparison had nothing to compare');
    } else {
      const places = [];
      let anyCarriesCountry = false;
      for (const v of atlantis) {
        await evaluate("location.hash = '#/venue/" + v.venue_id + "';");
        await sleep(1300);
        const p = await evaluate("(() => { const l = document.querySelector('.screen .venue-line'); return l ? l.textContent.trim() : null; })()");
        places.push(v.venue_id + ':' + JSON.stringify(p));
        if (p !== null && /\bUSA\b/.test(p)) {
          anyCarriesCountry = true;
          fail('Atlantis ' + v.venue_id + ' still carries a country: ' + JSON.stringify(p));
        }
      }
      // GUARDED. The first version printed this pass unconditionally, so a run
      // that had just failed on 443 still reported "both Atlantis rows drop the
      // country" one line below the failure. A pass that can print while the
      // thing it claims is false is worse than no line at all -- it is the
      // proxy failure in miniature, and it was caught by proving this check
      // red rather than by reading it.
      if (!anyCarriesCountry) pass('both Atlantis rows drop the country — ' + places.join('  '));
    }
  }

  // --- No screen names the same venue in two headers -----------------------
  //
  // Reported twice. 0.1.66 removed sectionHead(venuename) from the Home venue
  // block, and the sweep that followed it declared Home clean while leaving
  // "Previously at {venue}" in the set-structure card -- judged then as "a
  // label doing real work at a distance". That judgement was wrong, and the
  // reason it was wrong is that the criterion was too tight: it only looked at
  // the line IMMEDIATELY ABOVE a header. The rule is broader. A header naming
  // a venue that the screen already names anywhere is the same problem.
  //
  // Two derived rules, no list of strings to maintain:
  //
  //  1. No section title may contain the screen title verbatim. Needs no venue
  //     knowledge at all, and catches the venue screen growing an "Every show
  //     at {venuename}" header under its own h1.
  //  2. Headers naming a venue that is also rendered in a venue line on the
  //     same screen are COUNTED, and the count is asserted per route.
  //
  // Rule 2's expectation is a reviewed number rather than a flat zero, and as
  // of 0.1.74 that number is ZERO. The one deliberate instance was Home's
  // "Last time at {venue}", justified in 0.1.69 by DISTANCE: it sat a full
  // set-structure block below the hero venue line and labelled a setlist card
  // that was otherwise just a date. The merge removed the distance -- that
  // section now follows the hero card directly, with the stat beside it already
  // reading "MOST RECENT - {the same date}" -- so the header went generic and
  // the exception went with it. Anything NEW has to change this number back,
  // which is the point: the exception is reviewable instead of invisible.
  //
  // RAW TEXT OUT, MATCHING IN NODE. No backslash goes inside the evaluate
  // string: a backslash-s in a template literal collapses to a literal "s"
  // before the page sees it, which is how the "On this date" probe silently
  // matched nothing in 0.1.67.
  console.log('\nvenue named in more than one header:');
  // Section titles that may contain the screen title, per route, normalised and
  // with any trailing count stripped -- the same reviewed-exception shape Rule 2
  // uses, and for the same reason: an invisible exception is how the last one
  // survived a sweep.
  //
  // EMPTY SINCE 0.1.82, AND IT HAD ONE ENTRY THAT WAS FOUND BY A CHANGE
  // ELSEWHERE. Shows' 0.1.75 landing header was "Recent shows (15 of 786)"
  // under an h1 reading "Shows" -- a count header with a qualifier, not the
  // defect Rule 1 is for -- and it had never fired because the sweep had never
  // seen the landing state: earlier sections left a query behind, so the
  // sweep always arrived at "Shows (63)". 0.1.75 made the tab reset on
  // re-entry and the allowance was added. 0.1.82 removed the header: the
  // compact list has no section title and the count line says what the list
  // is. The map stays so the next reviewed exception has somewhere to go, and
  // so this history does.
  const SECTION_TITLE_ECHOES_ALLOWED = {};

  const HEADERS_NAMING_A_VENUE = {
    // route -> how many headers may name an on-screen venue.
    // Empty on purpose: no route has a reviewed exception any more.
  };

  for (const r of ROUTES) {
    await evaluate("location.hash = " + JSON.stringify(r.hash) + ";");
    await sleep(1400);
    const dom = await evaluate(`(() => {
      const txt = (n) => n.textContent;
      const screen = document.querySelector('.screen');
      if (!screen) return null;
      return {
        screenTitles: [...screen.querySelectorAll('.screen-title')].map(txt),
        sectionTitles: [...screen.querySelectorAll('.section-title')].map(txt),
        rowTitles: [...screen.querySelectorAll('.row-title')].map(txt),
        // The NAME half of every venue line: everything before the middot.
        venueNames: [...screen.querySelectorAll('.venue-line')]
          .map((v) => v.textContent.split('·')[0])
          .filter(Boolean),
      };
    })()`);

    if (!dom) { fail('header sweep (' + r.hash + '): no .screen rendered'); continue; }

    const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
    const titles = dom.screenTitles.map(norm).filter((t) => t.length >= 3);
    const sections = dom.sectionTitles.map(norm);
    const rows = dom.rowTitles.map(norm);
    const names = [...new Set(dom.venueNames.map(norm))].filter((n) => n.length >= 3);

    // Rule 1 — a section title echoing the screen title.
    //
    // A COUNT HEADER IS NOT AN ECHO. Shows renders an h1 "Shows" over a
    // section head "Shows (63)", and Songs and the venue screen do the same
    // thing: the section title IS the screen title plus a count, which is a
    // deliberate pattern and says something the h1 does not. The defect this
    // rule is for is the screen title EMBEDDED IN A LONGER PHRASE -- "Every
    // show at Toad's Place" under an h1 already reading "Toad's Place".
    //
    // So the parenthetical is stripped first, and an exact match after that is
    // allowed. Anything still containing the title with other words around it
    // is the echo. Found by the check going red on #/shows, which is the right
    // way round: narrowed, not switched off.
    const stripCount = (s) => s.replace(/\s*\([^)]*\)\s*$/, '').trim();
    const allowed = SECTION_TITLE_ECHOES_ALLOWED[r.hash] || [];
    const echoes = [];
    for (const t of titles) {
      for (const s of sections) {
        const bare = stripCount(s);
        if (bare !== t && bare.includes(t) && !allowed.includes(bare)) echoes.push({ t, s });
      }
    }
    if (echoes.length) {
      fail('header sweep (' + r.hash + '): section title repeats the screen title — ' +
        echoes.map((e) => JSON.stringify(e.s) + ' contains ' + JSON.stringify(e.t)).join('; '));
    }

    // Rule 2 — headers naming a venue the screen names elsewhere.
    // Row titles count: on the Shows venue results a row title IS a venue name,
    // and a second mention beside it would be the same defect one level down.
    const naming = [];
    for (const h of [...sections, ...titles, ...rows]) {
      for (const n of names) if (h.includes(n)) { naming.push({ h, n }); break; }
    }
    const expected = HEADERS_NAMING_A_VENUE[r.hash] || 0;
    if (naming.length !== expected) {
      fail('header sweep (' + r.hash + '): ' + naming.length + ' header(s) name an on-screen venue, expected ' +
        expected + ' — ' + JSON.stringify(naming.map((x) => x.h)));
    } else if (expected) {
      pass(r.hash + ': ' + expected + ' deliberate venue header — ' + JSON.stringify(naming[0].h));
    } else if (!echoes.length) {
      pass(r.hash + ': no header repeats a venue or the screen title (' +
        sections.length + ' section titles, ' + names.length + ' venue lines)');
    }
  }

  // --- Free-text setlist entries are not songs ------------------------------
  //
  // Three rows in the archive carry slug "_custom_" -- banter and
  // announcements -- and all three share song_id 1, which is absent from the
  // songs table. Keyed on song_id they collapsed into one browsable song
  // called "Why Should I Worry" claiming three performances, and made the
  // catalogue read 367 against an endpoint reporting 366.
  //
  // THE COUNT IS COMPARED AGAINST A NUMBER DERIVED FROM THE ENDPOINTS, NOT
  // AGAINST A LITERAL. A literal would go stale the day Carton adds a song and
  // would then be failing for a reason that has nothing to do with this.
  //
  // Since 0.1.79 the list is the songs with at least one Eggy performance --
  // what Carton's own song list shows (docs/plan.md, 2026-10-24) -- so the
  // invariant is: rendered count == songs endpoint rows MINUS the rows with
  // no such performance. "Such performance" is derived HERE, from the raw
  // setlists pull: a row that is not `_custom_` and whose artist_id is 1 or
  // absent. Not read from the app, whose own filter is the thing under test.
  // Equality with that derived number is the check. "Fewer than the
  // endpoint" would be satisfied by any bug that dropped songs, and "equal
  // to the endpoint" was the 0.1.78 invariant that the ruling replaced. If it
  // drifts, either an orphan song_id is back in the catalogue or the filter
  // is wrong -- the message says which side is bigger.
  console.log('\nthe catalogue is the endpoint minus the songs with no Eggy performance:');
  await evaluate(`location.hash = '#/songs';`);
  await sleep(1500);
  const shown = await evaluate(`(() => {
    const sub = document.querySelector('.screen-sub');
    const m = sub && sub.textContent.match(/([\\d,]+)\\s+songs played live/);
    return m ? Number(m[1].replace(/,/g, '')) : null;
  })()`);

  let endpointSongs = null;
  let hiddenSongs = null;
  try {
    const [songsRes, setlistsRes] = await Promise.all([
      fetch('https://thecarton.net/api/v2/songs.json?limit=20000'),
      fetch('https://thecarton.net/api/v2/setlists.json?limit=20000'),
    ]);
    const songsBody = await songsRes.json();
    const setlistsBody = await setlistsRes.json();
    if (Array.isArray(songsBody.data) && Array.isArray(setlistsBody.data)) {
      endpointSongs = songsBody.data.length;
      const playedByEggy = new Set();
      for (const r of setlistsBody.data) {
        if (String(r.slug) === '_custom_') continue;
        if (r.artist_id != null && Number(r.artist_id) !== 1) continue;
        playedByEggy.add(Number(r.song_id));
      }
      hiddenSongs = songsBody.data.filter((s) => !playedByEggy.has(Number(s.id)));
    }
  } catch {
    /* handled below as a SKIP -- an unreachable third party is not a defect here */
  }

  if (shown === null) fail('songs: could not read the count from the Songs sub-line');
  else if (endpointSongs === null || hiddenSongs === null) {
    skip(`catalogue count not cross-checked (Carton unreachable); the app shows ${shown}`);
  } else if (shown !== endpointSongs - hiddenSongs.length) {
    fail(`songs: the app lists ${shown}, but the endpoint has ${endpointSongs} songs of which ${hiddenSongs.length} have no Eggy performance — expected ${endpointSongs - hiddenSongs.length}`);
  } else {
    pass(`catalogue is ${shown}: the endpoint's ${endpointSongs} minus ${hiddenSongs.length} with no Eggy performance (${hiddenSongs.slice(0, 3).map((s) => s.name.trim()).join(', ')}${hiddenSongs.length > 3 ? ', …' : ''})`);
  }

  // Every listed song has been played: under A–Z the figure is times played,
  // and a 0 there -- or a "Never played" date line -- is unique to a song with
  // no Eggy performance, which the list no longer holds. Read after the sort
  // is explicitly A–Z, because the module state carries the last sort picked.
  //
  // MEMBERSHIP, NOT JUST COUNT. The parity check above compares two numbers,
  // and equal numbers are satisfied by the app hiding N wrong songs while
  // listing N the derivation says are unplayed. The zero-plays filter closes
  // one direction (nothing listed reads 0); the id check closes the other:
  // none of the songs the derivation found unplayed may appear in the list.
  // BY ID, NOT NAME: the endpoint holds two "When I Paint My Masterpiece"
  // rows, one played and one stray, and a name match failed on the played
  // one the first time this ran. The row carries its id as data-song-id.
  if (!(await clickSort('A–Z'))) fail('songs: no "A–Z" in the sort sheet, so the zero-plays check could not set its sort');
  await sleep(700);
  const listedIds = await evaluate(`[...document.querySelectorAll('.screen .rows li .row-shell')].map((s) => s.dataset.songId || '')`);
  const unplayedRows = await evaluate(`[...document.querySelectorAll('.screen .rows li')]
    .filter((li) => ((li.querySelector('.gap-num') || {}).textContent || '').trim() === '0'
      || /Never played/.test((li.querySelector('.row-meta') || {}).textContent || ''))
    .map((li) => ((li.querySelector('.row-title') || {}).textContent || '').trim())`);
  const hiddenListed = hiddenSongs ? hiddenSongs.filter((s) => listedIds.includes(String(s.id))) : [];
  if (!listedIds.length) fail('songs: no rows rendered under A–Z, so the zero-plays check saw nothing');
  else if (listedIds.some((id) => !/^\d+$/.test(id))) fail('songs: a row carries no data-song-id, so membership could not be checked by id');
  else if (unplayedRows.length) fail(`songs: ${unplayedRows.length} listed song(s) read 0 times or "Never played" — ${unplayedRows.slice(0, 5).join(', ')}`);
  else if (hiddenListed.length) fail(`songs: ${hiddenListed.length} song(s) the setlists say have no Eggy performance are listed — ${hiddenListed.slice(0, 5).map((s) => `${s.name.trim()} (id ${s.id})`).join(', ')}`);
  else pass(`${listedIds.length} rows under A–Z, none reading 0 times or "Never played"${hiddenSongs ? `, none of the ${hiddenSongs.length} derived-unplayed ids among them` : ''}`);

  // --- The two gap filters: strict, disjoint, read from the screen -------------
  //
  // (0.1.81) "Passed longest gap" keeps the songs whose current gap is longer
  // than their longest closed gap; "Closed gaps only" keeps the songs whose
  // longest closed gap is longer than their current gap. Under "Longest gap"
  // the figure is the LARGER of those two, so each filter has a signature the
  // screen can show without any derived number being rendered:
  //   Passed  -> the Longest-gap figure EQUALS the Coldest-first figure (the
  //              current gap won), and every date line reads "→ still open";
  //   Closed  -> the Longest-gap figure is STRICTLY GREATER than the
  //              Coldest-first figure (the closed gap won), and no date line
  //              reads "still open".
  // Both are read by song name from two sorts under the same filter:
  //   (a) under each filter the two sorts list the same names, and every row
  //       carries the figure its sort is about;
  //   (b) every Passed row has current === longest; every Closed row has
  //       longest > current. STRICT in both: a tied song shows equal figures
  //       with a closed span under Closed, or equal figures under Passed with
  //       "still open" where Closed should have had it -- either way one of
  //       the two lists names it;
  //   (c) the two filters are DISJOINT, and together they are smaller than
  //       the unfiltered list by at least the songs with no closed gap;
  //   (d) three Passed rows' detail screens show the same two numbers the
  //       lists showed, so what was compared is what a reader sees on tap;
  //   (e) each count line states its comparison in the locked words and
  //       equals its rows, and the filter lead reads the filter.
  // Red proof (0.1.81): isClosedGapLongest loosened to >= -- the tied songs
  // appear under Closed with equal figures and "still open" lines, and (b)
  // names them. The MIRROR fault, isPastLongestGap loosened to >=, is NOT
  // visible here: a tied song's figure reads open, so under a loosened Passed
  // filter it shows equal figures and "→ still open" -- exactly the Passed
  // signature -- and stays disjoint from Closed. Only tests/gap.test.mjs
  // catches that one, which is why its tie case is pinned there.
  console.log('\nthe two gap filters are strict and disjoint, read off the screen:');
  const readFigures = () =>
    evaluate(`(() => {${LEAD_JS}
      const t = (n) => ((n || {}).textContent || '').trim();
      const count = [...document.querySelectorAll('.screen .note')].map(t).find((x) => /^\\d+ songs?\\b/.test(x)) || '';
      return {
        filterChip: leadValue('Filter'),
        sortChip: leadValue('Sort'),
        sheetOpen: !!document.querySelector('.sheet'),
        countLine: count ? Number(count.match(/^(\\d+)/)[1]) : null,
        countText: count,
        rows: [...document.querySelectorAll('.screen .rows li')].map((li) => ({
          title: t(li.querySelector('.row-title')),
          num: t(li.querySelector('.gap-num')),
          unit: t(li.querySelector('.gap-unit')).toLowerCase(),
          meta: t(li.querySelector('.row-meta')),
        })),
      };
    })()`);
  const filterProblems = [];
  const shotsFor = async (filterLabel) => {
    if (!(await clickFilter(filterLabel))) { filterProblems.push(`no "${filterLabel}" in the filter sheet`); return null; }
    if (!(await clickSort('Coldest first'))) { filterProblems.push('no "Coldest first" in the sort sheet'); return null; }
    await sleep(900);
    const cold = await readFigures();
    if (!(await clickSort('Longest gap'))) { filterProblems.push('no "Longest gap" in the sort sheet'); return null; }
    await sleep(900);
    const long = await readFigures();
    return { cold, long };
  };
  const allShot = await (async () => { if (!(await clickSort('Longest gap'))) return null; await sleep(900); return readFigures(); })();
  const passedShots = await shotsFor('Passed longest gap');
  const closedShots = await shotsFor('Closed gaps only');

  // --- The one chip bar fits at its widest pair, at 390px AND 360px ------------
  //
  // Right now the sort reads "Longest gap" and the filter "Closed gaps only";
  // the widest pair is "Longest gap" + "Passed longest gap", so the filter is
  // set back to that before measuring. Content wider than its bar is overflow
  // behind a hidden scrollbar -- the 0.1.75 defect -- and a bar holding two
  // chips and nothing else has no business needing it. Each chip's VALUE span
  // is held to the same rule against its own box: a chip that fit by clipping
  // or ellipsizing its value would be a chip that fits by lying. The pair fits
  // at 390px; at 360px, the width of many Android phones, it does not, and
  // the rule is that the value WRAPS inside a taller chip (app.css,
  // .sortbar-leads) -- so the measurement is taken at BOTH widths, through
  // Emulation.setDeviceMetricsOverride, and the bar is put back to 390
  // afterwards. The sheets' option names are measured the same way, once.
  // clientWidth INCLUDES the bar's 16px padding each side. Red proofs: the
  // five filter chips rendered inline beside the lead chip (0.1.79) -- "609px
  // of content in 390px"; a 60px max-width on .chip-value with overflow
  // hidden (0.1.81) -- "value clipped"; white-space: nowrap on the value
  // (0.1.81) -- at 360px "366px of content in 360px".
  if (closedShots && (await clickFilter('Passed longest gap'))) {
    await sleep(600);
    const MEASURE_BAR = `(() => {${LEAD_JS}
      const t = (n) => ((n || {}).textContent || '').trim();
      const lines = (n) => n ? Math.max(1, Math.round(n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight))) : null;
      return {
        viewport: window.innerWidth,
        // The document's own overflow. Under mobile emulation a page wider
        // than the device WIDENS the layout viewport rather than scrolling,
        // so innerWidth stops reading the override -- which is a symptom of
        // the overflow, not a failed override, and is reported as such.
        docClient: document.documentElement.clientWidth,
        docScroll: document.documentElement.scrollWidth,
        bars: [...document.querySelectorAll('.screen .sortbar')].map((b) => ({
          text: [...b.querySelectorAll('.chip-lead')].map((c) => t(c.querySelector('.chip-label')) + ' ' + t(c.querySelector('.chip-value'))).join(' | '),
          client: b.clientWidth, scroll: b.scrollWidth, height: Math.round(b.getBoundingClientRect().height),
          chips: [...b.querySelectorAll('.chip-lead')].map((c) => {
            const v = c.querySelector('.chip-value');
            return { text: t(v), chipWidth: Math.round(c.getBoundingClientRect().width), chipHeight: Math.round(c.getBoundingClientRect().height), valueLines: lines(v), valueClient: v ? v.clientWidth : null, valueScroll: v ? v.scrollWidth : null, chipClient: c.clientWidth, chipScroll: c.scrollWidth, nowrap: v ? getComputedStyle(v).whiteSpace === 'nowrap' : null };
          }),
        })),
      };
    })()`;
    const widths = {};
    for (const w of [390, 360]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: 844, deviceScaleFactor: 2, mobile: true });
      await sleep(400);
      widths[w] = await evaluate(MEASURE_BAR);
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await sleep(400);
    const sheets = await evaluate(`(() => {${LEAD_JS}
      const t = (n) => ((n || {}).textContent || '').trim();
      const openAndMeasure = (which) => {
        const lead = leadByLabel(which); if (!lead) return null;
        lead.click();
        const list = document.querySelector('.sheet .sheet-options');
        const rows = list ? [...list.querySelectorAll('.sheet-option')].map((r) => {
          const n = r.querySelector('.sheet-option-name'); const d = r.querySelector('.sheet-option-desc');
          return { name: t(n), nameClient: n ? n.clientWidth : null, nameScroll: n ? n.scrollWidth : null, desc: t(d), descLines: d ? Math.round(d.getBoundingClientRect().height / parseFloat(getComputedStyle(d).lineHeight)) : null, pressed: r.getAttribute('aria-pressed') };
        }) : [];
        const out = { client: list ? list.clientWidth : null, scroll: list ? list.scrollWidth : null, rows };
        const bd = document.querySelector('.sheet-backdrop'); if (bd) bd.click();
        return out;
      };
      return { sortSheet: openAndMeasure('Sort'), filterSheet: openAndMeasure('Filter') };
    })()`);

    const barProblems = [];
    const summary = [];
    for (const w of [390, 360]) {
      const m = widths[w];
      const bar = m.bars[0];
      // A viewport wider than asked is NOT skipped: the first version did, and
      // reported a page the nowrap fault had pushed to 366px as "the override
      // did not take" -- a layout failure dressed as a harness one. The bar is
      // measured regardless, so the real figures print beside the symptom.
      if (m.viewport !== w) barProblems.push(`at ${w}px: the layout viewport reads ${m.viewport}px and the document is ${m.docScroll}px wide in ${m.docClient}px -- the page overflows horizontally (or the override did not take)`);
      if (m.bars.length !== 1) { barProblems.push(`at ${w}px: ${m.bars.length} bar(s) on Songs, expected one bar holding both leads`); continue; }
      if (bar.chips.length !== 2) { barProblems.push(`at ${w}px: ${bar.chips.length} lead chip(s), expected the sort lead and the filter lead`); continue; }
      if (bar.chips[0].text !== 'Longest gap' || bar.chips[1].text !== 'Passed longest gap') { barProblems.push(`at ${w}px: measured "${bar.text}", not the widest pair`); continue; }
      if (bar.scroll > bar.client + 1) barProblems.push(`at ${w}px: "${bar.text}" is ${bar.scroll}px of content in ${bar.client}px — wider than the bar, so something is off-screen`);
      const clipped = bar.chips.filter((c) => c.valueScroll > c.valueClient + 1 || c.chipScroll > c.chipClient + 1);
      if (clipped.length) barProblems.push(`at ${w}px: ${clipped.map((c) => `"${c.text}" value ${c.valueScroll}px in ${c.valueClient}px, chip ${c.chipScroll}px in ${c.chipClient}px`).join(', ')} — a value clipped inside its chip`);
      if (bar.chips.some((c) => c.nowrap)) barProblems.push(`at ${w}px: a value is white-space: nowrap -- it cannot wrap, so a pair that does not fit can only overflow or clip`);
      summary.push(`${w}px: bar ${bar.scroll}/${bar.client}px, ${bar.height}px tall; ${bar.chips.map((c) => `"${c.text}" ${c.chipWidth}×${c.chipHeight}px, ${c.valueLines} line${c.valueLines === 1 ? '' : 's'}`).join(' + ')}`);
    }
    // At 360 the pair does not fit on one line by design, so the WRAP must be
    // what happened -- a one-line filter value at 360 would mean the bar grew
    // or a label shrank, both of which are the thing this check forbids.
    const f360 = ((widths[360] || {}).bars || [])[0];
    if (f360 && f360.chips.length === 2 && f360.chips[1].valueLines < 2) barProblems.push(`at 360px: the filter value is on ${f360.chips[1].valueLines} line -- the pair fits at 360 only if something was shortened`);
    const f390 = ((widths[390] || {}).bars || [])[0];
    if (f390 && f390.chips.length === 2 && f390.chips.some((c) => c.valueLines !== 1)) barProblems.push(`at 390px: a value wrapped (${f390.chips.map((c) => c.valueLines).join('/')} lines) -- the pair fits at 390 and should not need to`);

    // The 6s are the spec, typed: SORTS and FILTERS live inside the view and
    // are not exported, and the only other source of "how many options" is
    // the sheet being measured, which would be checking the list against
    // itself. docs/plan.md ("0.1.81 design", (e)) lists six of each.
    const sheetProblems = [];
    for (const [name, sheet, want] of [['sort sheet', sheets.sortSheet, 6], ['filter sheet', sheets.filterSheet, 6]]) {
      if (!sheet) { sheetProblems.push(`${name}: did not open`); continue; }
      if (sheet.rows.length !== want) sheetProblems.push(`${name}: ${sheet.rows.length} option(s), expected ${want}`);
      if (sheet.scroll > sheet.client + 1) sheetProblems.push(`${name}: the list is ${sheet.scroll}px in ${sheet.client}px`);
      for (const r of sheet.rows) {
        if (r.nameScroll > r.nameClient + 1) sheetProblems.push(`${name}: "${r.name}" name ${r.nameScroll}px in ${r.nameClient}px -- clipped`);
        if (!r.desc) sheetProblems.push(`${name}: "${r.name}" has no description`);
      }
      if (sheet.rows.filter((r) => r.pressed === 'true').length !== 1) sheetProblems.push(`${name}: ${sheet.rows.filter((r) => r.pressed === 'true').length} option(s) pressed, expected exactly one`);
    }
    if (barProblems.length) for (const p of barProblems) fail(`chip bar ${p}`);
    else if (sheetProblems.length) for (const p of sheetProblems) fail(p);
    else pass(`widest pair fits, no value clipped — ${summary.join('; ')}; sort sheet 6 rows, filter sheet 6 rows, every name unclipped, every row described (desc lines: ${[...sheets.sortSheet.rows, ...sheets.filterSheet.rows].map((r) => r.descLines).join(',')})`);
    await clickFilter('Closed gaps only');
    await sleep(300);
  } else {
    // Never silent: this block carries the 390/360 overflow check, and a
    // skipped measurement that printed nothing would read as a pass.
    fail('chip bar: not measured -- the filter sheet or the "Passed longest gap" option was missing, so the 390/360 check did not run');
  }

  const DATE_SPAN_OPEN = new RegExp(`^${DATE} → still open`);
  const DATE_SPAN_CLOSED = new RegExp(`^${DATE} → ${DATE}`);
  const byName = (rows) => new Map(rows.map((r) => [r.title, r]));
  const checkPair = (tag, shots, wantChip, wantCount, predicate, wantSpan, spanWord) => {
    if (!shots) return null;
    const { cold, long } = shots;
    if (cold.filterChip !== wantChip || long.filterChip !== wantChip) filterProblems.push(`${tag} (e) the filter lead reads ${JSON.stringify(cold.filterChip)} / ${JSON.stringify(long.filterChip)}`);
    if (cold.sortChip !== 'Coldest first' || long.sortChip !== 'Longest gap') filterProblems.push(`${tag} (a) the sort lead reads ${JSON.stringify(cold.sortChip)} / ${JSON.stringify(long.sortChip)}`);
    if (cold.sheetOpen || long.sheetOpen) filterProblems.push(`${tag} picking a filter or sort left the sheet open`);
    if (!wantCount.test(cold.countText) || !wantCount.test(long.countText)) filterProblems.push(`${tag} (e) the count line reads ${JSON.stringify(cold.countText)}`);
    if (cold.countLine !== cold.rows.length) filterProblems.push(`${tag} (e) the count line says ${cold.countLine}, the list holds ${cold.rows.length}`);
    if (!cold.rows.length) filterProblems.push(`${tag} (a) the filter kept nothing, so nothing was compared`);
    if (cold.rows.some((r) => r.unit !== 'since played')) filterProblems.push(`${tag} (a) a Coldest-first row does not carry a since-played figure`);
    if (long.rows.some((r) => r.unit !== 'longest gap')) filterProblems.push(`${tag} (a) a Longest-gap row does not carry a longest-gap figure`);
    const coldNames = cold.rows.map((r) => r.title).sort();
    const longNames = long.rows.map((r) => r.title).sort();
    if (JSON.stringify(coldNames) !== JSON.stringify(longNames)) {
      filterProblems.push(`${tag} (a) the two sorts list different songs: ${coldNames.length} under Coldest first, ${longNames.length} under Longest gap`);
      return null;
    }
    const current = byName(cold.rows);
    const longest = byName(long.rows);
    const bad = [...current].filter(([name, r]) => { const l = longest.get(name); return !(Number.isFinite(Number(r.num)) && l && Number.isFinite(Number(l.num)) && predicate(Number(r.num), Number(l.num))); });
    if (bad.length) filterProblems.push(`${tag} (b) ${bad.length} kept song(s) fail the comparison: ${bad.slice(0, 4).map(([n, r]) => `${n} current ${r.num} vs longest ${(longest.get(n) || {}).num}`).join('; ')}`);
    const badSpan = long.rows.filter((r) => !wantSpan.test(r.meta));
    if (badSpan.length) filterProblems.push(`${tag} (b) ${badSpan.length} row(s) whose date line is not "${spanWord}": ${badSpan.slice(0, 3).map((r) => `${r.title}: ${r.meta}`).join('; ')}`);
    return { names: new Set(longNames), current, longest };
  };
  const passed = checkPair('passed:', passedShots, 'Passed longest gap', /whose current gap is longer than any gap they have closed before/, (cur, lng) => cur === lng, DATE_SPAN_OPEN, '→ still open');
  const closed = checkPair('closed:', closedShots, 'Closed gaps only', /whose longest gap has ended/, (cur, lng) => lng > cur, DATE_SPAN_CLOSED, '{date} → {date}');
  if (passed && closed && allShot) {
    const both = [...passed.names].filter((n) => closed.names.has(n));
    if (both.length) filterProblems.push(`(c) ${both.length} song(s) in BOTH filters: ${both.slice(0, 4).join(', ')}`);
    const union = passed.names.size + closed.names.size - both.length;
    if (!(union < allShot.rows.length)) filterProblems.push(`(c) the two filters together hold ${union} songs against ${allShot.rows.length} unfiltered -- the songs with no closed gap are in one of them`);
    if (allShot.countLine !== allShot.rows.length) filterProblems.push(`(c) unfiltered count line ${allShot.countLine} against ${allShot.rows.length} rows`);
    // (d) first, middle and last rows of the Passed list on screen (Longest
    // gap), opened by their row button, read on detail, compared by name.
    if (!filterProblems.length && (await clickFilter('Passed longest gap')) && (await clickSort('Longest gap'))) {
      await sleep(900);
      const n = passed.names.size;
      const picks = [...new Set([0, Math.floor(n / 2), n - 1])];
      const checked = [];
      for (const i of picks) {
        const opened = await evaluate(`(() => {
          const li = document.querySelectorAll('.screen .rows li')[${i}];
          const b = li && li.querySelector('button.row');
          if (!b) return null;
          const t = li.querySelector('.row-title').textContent.trim();
          b.click();
          return t;
        })()`);
        await sleep(900);
        const detail = await evaluate(`(() => {
          const read = (labelStart) => {
            const stat = [...document.querySelectorAll('.stat')].find((s) => { const l = s.querySelector('.stat-label'); return l && l.textContent.trim().startsWith(labelStart); });
            const v = stat && stat.querySelector('.stat-value');
            const l = stat && stat.querySelector('.stat-label');
            return { value: v ? v.textContent.trim() : null, label: l ? l.textContent.trim() : null };
          };
          const h1 = document.querySelector('.screen h1');
          return { hash: location.hash, title: h1 ? h1.textContent.trim() : null, current: read('shows since last'), longest: read('longest observed gap') };
        })()`);
        const cur = passed.current.get(opened);
        const lng = passed.longest.get(opened);
        if (!opened || !/^#\/song\//.test(detail.hash)) filterProblems.push(`(d) row ${i + 1} did not open a song detail (${detail.hash})`);
        else if (!detail.title || !detail.title.startsWith(opened)) filterProblems.push(`(d) row ${i + 1} "${opened}" opened ${JSON.stringify(detail.title)}`);
        else if (Number(detail.current.value) !== Number(cur.num) || Number(detail.longest.value) !== Number(lng.num)) {
          filterProblems.push(`(d) "${opened}": the lists showed current ${cur.num} / longest ${lng.num}, detail shows ${detail.current.value} / ${detail.longest.value}`);
        } else if (!/still open$/.test(detail.longest.label || '')) {
          filterProblems.push(`(d) "${opened}": detail's longest-gap label does not end "still open": ${JSON.stringify(detail.longest.label)}`);
        } else checked.push(`${opened} ${detail.current.value}=${detail.longest.value}`);
        await evaluate(`location.hash = '#/songs';`);
        await sleep(900);
      }
      if (!filterProblems.length) pass(`passed ${passed.names.size} (current = longest, every span open) + closed ${closed.names.size} (longest > current, every span dated) < ${allShot.rows.length} unfiltered, disjoint; details agree: ${checked.join(', ')}`);
    }
  }
  for (const p of filterProblems) fail(`gap filters: ${p}`);
  // Leave the screen as the later sections expect it: no filter, A–Z. Asserted,
  // because a filter left on would fail every later Songs section for a
  // reason that has nothing to do with what it checks.
  if (!(await clickFilter('All'))) fail('gap filters: could not reset the filter to "All" -- later Songs checks would run filtered');
  await sleep(300);
  if (!(await clickSort('A–Z'))) fail('gap filters: could not reset the sort to "A–Z"');
  await sleep(600);

  // --- A cover row carries its credit under A–Z ---------------------------------
  //
  // The flat-list check above asserts NO cover credit under "Longest gap". On
  // its own that would pass if the credit had vanished everywhere, so the
  // other half is asserted here: under A–Z, with a known cover isolated by the
  // search box, the row's meta carries a .cover-note. Red proof: the
  // `figure !== 'longest'` guard in songRow widened to every figure.
  console.log('\ncover credit stays on the date line under A–Z:');
  const COVER_SONG = 'Sussudio';
  await setSongQuery(COVER_SONG);
  // The search is a substring match and can return neighbours, so the row is
  // picked by EXACT title from the results, and there must be exactly one.
  const coverRow = await evaluate(`(() => {
    const lis = [...document.querySelectorAll('.rows li')].filter((li) => (li.querySelector('.row-title') || {}).textContent?.trim() === ${JSON.stringify(COVER_SONG)});
    const li = lis.length === 1 ? lis[0] : null;
    const n = li && li.querySelector('.cover-note');
    return { rows: lis.length, title: li ? li.querySelector('.row-title').textContent.trim() : null, cover: n ? n.textContent.trim() : null };
  })()`);
  if (coverRow.rows !== 1) fail(`cover credit: ${coverRow.rows} row(s) titled exactly "${COVER_SONG}", expected one`);
  else if (!coverRow.cover || !/cover$/i.test(coverRow.cover)) fail(`cover credit: "${COVER_SONG}" under A–Z carries no cover credit (read ${JSON.stringify(coverRow.cover)})`);
  else pass(`"${COVER_SONG}" under A–Z reads "${coverRow.cover}"`);
  await setSongQuery('');
  await sleep(400);

  // Gap parity with The Carton, one song, end to end -- the figures the song
  // detail screen RENDERS against the Show Gap column on that song's Carton
  // page. Feel Like A Stranger (song 219): three plays, and the longest gap
  // spans 114 shows with no setlist rows plus the one second-artist show, so
  // the figure reads 723 only under Carton's own rule -- 610 under the
  // withdrawn counted-shows rule, 724 with the second artist counted. The
  // full oracle is scripts/gap-oracle.mjs; this is the one-song canary on the
  // push gate. SKIP, not pass, when the page cannot be fetched.
  console.log('\ngap matches the Show Gap column on Carton:');
  await evaluate(`location.hash = '#/song/219';`);
  await sleep(1500);
  const renderedGap = await evaluate(`(() => {
    const read = (labelStart) => {
      const stat = [...document.querySelectorAll('.stat')].find((s) => {
        const l = s.querySelector('.stat-label');
        return l && l.textContent.trim().startsWith(labelStart);
      });
      const v = stat && stat.querySelector('.stat-value');
      return v ? Number(v.textContent.trim()) : null;
    };
    return { current: read('shows since last'), longest: read('longest observed gap') };
  })()`);
  let cartonSongPage = null;
  try {
    const res = await fetch('https://thecarton.net/song/feel-like-a-stranger');
    if (res.ok) cartonSongPage = parseSongPage(await res.text());
  } catch {
    /* handled below as a SKIP -- an unreachable third party is not a defect here */
  }
  if (renderedGap.current === null || renderedGap.longest === null) {
    fail(`gap parity: song detail did not render both stats (read ${JSON.stringify(renderedGap)})`);
  } else if (!cartonSongPage || cartonSongPage.current === null || cartonSongPage.rows.length < 2) {
    skip(`gap parity not cross-checked (Carton page unreachable); the app shows current ${renderedGap.current}, longest ${renderedGap.longest}`);
  } else {
    // Longest = max over the closed gaps (every row but the debut) and the
    // current gap -- the debut row's number is a position, not a gap. This is
    // the app's own rule as of 0.1.81 (longestGap()); under the 0.1.79
    // closed-only figure it passed only because this song's closed gap is
    // the larger, which is the kind of agreement this file calls a proxy.
    const closedGaps = cartonSongPage.rows.slice(1).map((r) => r.gap);
    const wantLongest = Math.max(...closedGaps, cartonSongPage.current);
    if (renderedGap.current !== cartonSongPage.current) {
      fail(`gap parity: app current gap ${renderedGap.current}, Carton says ${cartonSongPage.current} show(s) ago`);
    } else if (renderedGap.longest !== wantLongest) {
      fail(`gap parity: app longest gap ${renderedGap.longest}, Carton's Show Gap column gives ${wantLongest}`);
    } else {
      pass(`Feel Like A Stranger: current ${renderedGap.current}, longest ${renderedGap.longest}, both as on Carton`);
    }
  }

  // The rows themselves must still be on screen, and must not be controls.
  // Show 1667710116 is the 2022-11-05 Foundry show carrying "NYE Announcement".
  await evaluate(`location.hash = '#/show/1667710116';`);
  await sleep(1400);
  const custom = await evaluate(`(() => {
    const songs = [...document.querySelectorAll('.setlist-song')];
    const el = songs.find((s) => s.textContent.trim() === 'NYE Announcement');
    if (!el) return { found: false, count: songs.length, names: songs.slice(0, 4).map((s) => s.textContent.trim()) };
    return {
      found: true,
      role: el.getAttribute('role'),
      tabindex: el.getAttribute('tabindex'),
      custom: el.getAttribute('data-custom'),
      // A real song beside it must still BE a control, or this passes because
      // the setlist stopped being tappable altogether.
      siblingRole: songs.find((s) => s !== el)?.getAttribute('role') ?? null,
    };
  })()`);

  if (!custom.found) {
    fail(`free-text entry: "NYE Announcement" is not on the 2022-11-05 setlist (${custom.count} songs: ${JSON.stringify(custom.names)})`);
  } else if (custom.role || custom.tabindex) {
    fail(`free-text entry: still a control (role=${custom.role}, tabindex=${custom.tabindex}) — it has no song page to open`);
  } else if (custom.siblingRole !== 'button') {
    fail(`free-text entry: the real songs beside it are not controls either (role=${custom.siblingRole}) — the setlist stopped being tappable`);
  } else pass('the entry still renders in the setlist, as text, beside songs that are still tappable');

  // --- The set-structure badge is compact, and the row is one control -------
  //
  // "Set 1 + Set 2 + Encore" was pushing venue names into ellipsis on the
  // Shows rows, and the venue is what the row is scanned for. Measured on the
  // rendered page rather than trusted from the mapping: what matters is the
  // width the badge actually takes and whether the venue beside it still fits.
  //
  // Asserted in BOTH themes because the light theme renders jam titles at
  // weight 600, which makes glyphs wider -- a width claim verified only in
  // dark is a width claim about half the app.
  console.log('\nset-structure badge:');
  // The CARD badge (Detail view, and Home): the mono short form, "S1+S2+E",
  // never the long "Set 1 + Set 2 + Encore" (0.1.28), and the one-set form is
  // a word with no digit. Both themes, both because the fonts differ in weight
  // between them and because a claim about dark is a claim about half the app.
  //
  // THE TRUNCATION MEASUREMENT THIS CHECK USED TO MAKE IS GONE WITH ITS ROW.
  // It rendered the long form back into the Shows SEARCH rows and counted how
  // many venue lines stopped ellipsising with the short one. Those rows were
  // replaced in 0.1.82 by compact rows whose badge is words ("2 sets + E",
  // .badge-sets, checked in the Shows section above), and the card head the
  // short form still sits in does not truncate its venue line, so there is
  // nothing to remeasure. The claim that survives is the form itself.
  await setShowsView('detail');
  for (const theme of ['dark', 'light']) {
    await evaluate(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)});`);
    await evaluate(`location.hash = '#/shows';`);
    await sleep(1400);
    const badge = await evaluate(`(() => {
      const cards = [...document.querySelectorAll('.screen .card')];
      const out = { cards: cards.length, badges: [], widest: 0, plain: 0 };
      for (const c of cards) {
        const b = c.querySelector('.badge-set');
        if (b) {
          const t = b.textContent.trim();
          if (!out.badges.includes(t)) out.badges.push(t);
          out.widest = Math.max(out.widest, Math.round(b.getBoundingClientRect().width));
        } else if ([...c.querySelectorAll('.badge')].some((x) => x.textContent.trim() === 'No setlist recorded')) out.plain++;
      }
      return out;
    })()`);
    if (!badge.cards) { fail(`badge (${theme}): no cards rendered under Detail`); continue; }
    if (!badge.badges.length) { fail(`badge (${theme}): no .badge-set on any card`); continue; }
    const longForm = badge.badges.filter((t) => / \+ |Set \d|Encore/.test(t));
    if (longForm.length) fail(`badge (${theme}): still rendering the long form ${JSON.stringify(longForm)}`);
    else pass(`${theme}: ${badge.cards} cards, badges ${JSON.stringify(badge.badges)}, widest ${badge.widest}px${badge.plain ? `, ${badge.plain} "No setlist recorded"` : ''}`);
    // "One set" must be on screen as a word, not a digit form. Matched on the
    // one-set token itself, not on "contains 'set' and does not start with
    // S<digit>" -- that earlier form also matched "Set 1 + Encore".
    for (const t of badge.badges.filter((x) => /one set/i.test(x))) {
      if (/\d/.test(t)) fail(`badge (${theme}): one-set badge ${JSON.stringify(t)} carries a digit`);
    }
  }
  await evaluate(`document.documentElement.removeAttribute('data-theme');`);
  await setShowsView('compact');
  await setShowsQuery('');

  // --- Footnote markers are actually hittable -------------------------------
  //
  // docs/design.md and the CSS comment both said "footnotes are tappable, not
  // tooltips" while the marker's hit region was 9.6 x 0. It is a <button> with
  // line-height: 0, which gives an inline-block a zero-height line box -- the
  // digit paints through overflow, so it looks completely normal and there is
  // nothing to press. Markup can be tappable while the screen is not.
  //
  // MEASURED BY HIT-TESTING, NOT BY RECT ARITHMETIC. document.elementFromPoint
  // is the browser's own answer to "what does a thumb here actually hit",
  // which is the question. Comparing rectangles would re-implement hit testing
  // and could agree with itself while disagreeing with the browser.
  //
  // Both directions are asserted, because this control cannot have both: the
  // marker must be hittable across its region, AND the song titles around it
  // must still hit themselves. A 44px region would pass the first and fail the
  // second -- it would cover most of the lines above and below, which is why
  // --fn-tap is deliberately below the 44px floor. The floor is compared
  // against the TOKEN read from the page, so retuning --fn-tap moves the check
  // with it instead of leaving a stale literal here.
  console.log('\nfootnote markers:');
  await evaluate(`location.hash = '#/show/1728657865';`);
  await sleep(1400);
  const fn = await evaluate(`(() => {
    const btn = document.querySelector('button.fn-marker');
    if (!btn) return { found: false };
    const r = btn.getBoundingClientRect();
    const token = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fn-tap')) || 0;
    const hitH = parseFloat(getComputedStyle(btn, '::after').height) || 0;
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const idOf = (n) => (n ? (n.tagName.toLowerCase() + '.' + (n.className || '')).trim() : 'nothing');
    // Probe just inside the region the TOKEN claims, never the region that was
    // measured. Derived from hitH these three points collapse onto one when
    // the region is missing, and all three then "hit the marker" -- verified:
    // with the ::after deleted that version still passed while the control had
    // nothing to press. The token is the claim; this tests the claim.
    const edge = Math.max(0, token / 2 - 1);
    const hits = {
      middle: idOf(document.elementFromPoint(cx, cy)),
      top: idOf(document.elementFromPoint(cx, cy - edge)),
      bottom: idOf(document.elementFromPoint(cx, cy + edge)),
    };
    // How far the region reaches INTO other tappable things.
    //
    // Hit-testing song-title CENTRES is not enough and was measured to prove
    // it: at --fn-tap 44px no centre was stolen, because the line rhythm is
    // 25.5px and a centre sits 25.5px away while the region reaches 22px. The
    // region still covered a third of the neighbouring lines. Centres would
    // have reported that as clean and licensed a 44px claim the geometry does
    // not support. Overlap is measured as area, per marker, against every
    // song title's real rect.
    let worstDepth = 0;
    const overlapped = [];
    for (const m of document.querySelectorAll('button.fn-marker')) {
      const mr = m.getBoundingClientRect();
      const region = {
        top: mr.y + mr.height / 2 - hitH / 2,
        bottom: mr.y + mr.height / 2 + hitH / 2,
        left: mr.x,
        right: mr.x + mr.width,
      };
      for (const s of document.querySelectorAll('.setlist-song')) {
        // getClientRects(), NOT getBoundingClientRect(). These are inline
        // elements in wrapping text: a song title broken across two lines has
        // a BOUNDING box spanning both lines at full column width, covering
        // large areas the element does not occupy. Measured against that, a
        // 24px region "overlapped" six titles including one it is nowhere
        // near. Per-line boxes are where the text actually is.
        for (const b of s.getClientRects()) {
          if (b.width < 4 || b.height < 4) continue;
          const dy = Math.min(region.bottom, b.y + b.height) - Math.max(region.top, b.y);
          const dx = Math.min(region.right, b.x + b.width) - Math.max(region.left, b.x);
          if (dy > 0.5 && dx > 0.5) {
            // DEPTH, not area. Area confounds "reaches 1px into a wide title"
            // with "reaches 11px into a narrow one", and it is the depth that
            // decides whether a thumb aimed at that title lands on it.
            const depth = Math.round(dy * 10) / 10;
            if (depth > worstDepth) worstDepth = depth;
            // Concatenation, not a nested template: this whole block is itself
            // a template literal being sent to the browser, and a backtick
            // inside it would end the string early.
            overlapped.push(s.textContent.trim().slice(0, 18) + ' (' + depth + 'px)');
          }
        }
      }
    }
    return {
      found: true,
      boxH: Math.round(r.height * 10) / 10,
      boxW: Math.round(r.width * 10) / 10,
      hitH, token, hits, worstDepth, overlapped: [...new Set(overlapped)],
      markers: document.querySelectorAll('button.fn-marker').length,
    };
  })()`);

  if (!fn.found) fail('footnotes: no button.fn-marker on the show — nothing measured, so nothing proved');
  else {
    if (!fn.token) fail('footnotes: --fn-tap is not defined, so the floor is unknown');
    else if (fn.hitH < fn.token) {
      fail(`footnotes: hit region is ${fn.hitH}px, below the --fn-tap floor of ${fn.token}px`);
    } else pass(`hit region ${fn.hitH}px meets --fn-tap (${fn.token}px), from a ${fn.boxW} x ${fn.boxH}px box`);

    // The box itself is zero-height by design; if the region were not doing
    // the work this would read as a pass on a control with nothing to press.
    if (fn.hitH <= fn.boxH) {
      fail(`footnotes: the ::after region (${fn.hitH}px) adds nothing over the box (${fn.boxH}px)`);
    } else pass(`the region is what makes it hittable (box ${fn.boxH}px -> ${fn.hitH}px)`);

    const wrong = Object.entries(fn.hits).filter(([, v]) => !v.includes('fn-marker'));
    if (wrong.length) {
      fail(`footnotes: pressing the marker hits ${wrong.map(([k, v]) => `${k}=${v}`).join(', ')}`);
    } else pass(`all three probe points hit the marker (${fn.markers} markers on screen)`);

    // EDGE CONTACT IS UNAVOIDABLE; ENCROACHMENT IS NOT. The marker sits inside
    // the line, so its region always touches the line box of the title beside
    // it by a pixel or so. What must not happen is reaching far enough into a
    // title that a thumb aimed there lands on the footnote instead.
    //
    // Both ends measured on this show, so the ceiling is not a guess:
    //   --fn-tap 24px  ->  1.5px deep   (edge contact)
    //   --fn-tap 44px  -> 11.5px deep   (over half a line's text height)
    // 3px is set between them, nearer the floor: it leaves room for rounding
    // and the marker's 1px padding while failing any real encroachment.
    const FN_MAX_DEPTH = 3;
    if (fn.worstDepth > FN_MAX_DEPTH) {
      fail(`footnotes: the region reaches ${fn.worstDepth}px into a song title (max ${FN_MAX_DEPTH}px) — ${fn.overlapped.slice(0, 3).join(', ')}`);
    } else {
      pass(`reaches at most ${fn.worstDepth}px into a neighbouring title (max ${FN_MAX_DEPTH}px)`);
    }
  }

  // --- Show detail action row: one set, not two visual weights --------------
  //
  // Venue info was a link floating above this row and is now a third control
  // in it. The assertion is that it is INDISTINGUISHABLE from the buttons it
  // joined -- compared against them, not against expected literals, so it
  // stays matched if the button treatment is ever retuned again.
  //
  // Also asserts the row stays on ONE LINE. It lost a control in 0.1.36 for
  // exactly this reason: the Carton link wrapped on a narrow phone and read as
  // a stranded third action.
  console.log('\nshow detail action row:');
  await evaluate(`location.hash = '#/show/1779890028';`);
  await sleep(1400);
  const row = await evaluate(`(() => {
    const r = document.querySelector('.card-actions');
    if (!r) return null;
    const kids = [...r.children];
    const style = (n) => {
      const s = getComputedStyle(n);
      const b = n.getBoundingClientRect();
      return {
        text: n.textContent.trim(), tag: n.tagName,
        h: Math.round(b.height), top: Math.round(b.top),
        font: s.fontSize, weight: s.fontWeight,
        border: s.borderTopWidth + ' ' + s.borderTopColor,
        radius: s.borderTopLeftRadius, deco: s.textDecorationLine,
        hit: getComputedStyle(n, '::after').height,
      };
    };
    return {
      count: kids.length,
      items: kids.map(style),
      lines: new Set(kids.map(k => Math.round(k.getBoundingClientRect().top))).size,
      // Nothing may sit outside the row claiming to be the same control.
      strayInfoLink: !!document.querySelector('.info-link'),
    };
  })()`);

  if (!row) fail('action row: no .card-actions on show detail');
  else {
    // startsWith, not equals: the label carries a trailing offsite arrow, and
    // an exact match would break the moment that arrow is right.
    const info = row.items.find((i) => i.text.startsWith('Venue info'));
    const others = row.items.filter((i) => !i.text.startsWith('Venue info'));
    if (!info) fail(`action row: no Venue info control (found ${JSON.stringify(row.items.map((i) => i.text))})`);
    else if (!others.length) fail('action row: nothing for Venue info to be compared against');
    else {
      pass(`row: ${row.items.map((i) => i.text).join(' · ')}`);

      // Compared field by field against a control it joined.
      const ref = others[0];
      const mismatched = ['h', 'font', 'weight', 'border', 'radius', 'deco', 'hit']
        .filter((k) => info[k] !== ref[k]);
      if (mismatched.length) {
        fail(`action row: Venue info differs from ${JSON.stringify(ref.text)} on ${mismatched.join(', ')}\n` +
             `      info: ${JSON.stringify(mismatched.map((k) => info[k]))}\n` +
             `      ref : ${JSON.stringify(mismatched.map((k) => ref[k]))}`);
      } else pass(`matches ${JSON.stringify(ref.text)} exactly (${info.h}px box, ${info.hit} hit, ${info.font}/${info.weight}, border ${info.border})`);

      // Still a real link, so open-in-new-tab and middle-click work.
      if (info.tag !== 'A') fail(`action row: Venue info is <${info.tag}>, expected <A> so it can open in a new tab`);
      else pass('Venue info is still an anchor, not a button');

      // THE OFFSITE ARROW. It is the only thing marking this control as
      // leaving the app, next to two that navigate within it, and it was lost
      // once already when this became a button in 0.1.53. Pinned so a future
      // tidy-up cannot quietly drop it again -- the same reason .carton-link's
      // arrow is called out in the CSS.
      const arrow = await evaluate(`(() => {
        const a = [...document.querySelectorAll('.card-actions a')].find(n => n.textContent.includes('Venue info'));
        const s = a && a.querySelector('.btn-arrow');
        return { present: !!s, glyph: s ? s.textContent.trim() : null,
                 hidden: s ? s.getAttribute('aria-hidden') : null };
      })()`);
      if (!arrow.present) fail('action row: Venue info has no offsite arrow');
      else if (arrow.glyph !== '↗') fail(`action row: offsite glyph is ${JSON.stringify(arrow.glyph)}, expected ↗`);
      else if (arrow.hidden !== 'true') fail('action row: the arrow is decorative and must be aria-hidden');
      else pass('offsite arrow present, matching the Carton-link convention');
    }

    if (row.lines !== 1) fail(`action row: wrapped onto ${row.lines} lines at 390px`);
    else pass('one line at 390px');

    if (row.strayInfoLink) fail('action row: an old .info-link is still rendering on show detail');
    else pass('no leftover .info-link on the screen');
  }

  // --- Section labels are brighter than the deliberately-quiet things -------
  //
  // Section and stat labels moved to their own --ink-label so they could be
  // raised without dragging up .carton-link, .creator-credit and .attrib,
  // which share --ink-faint and are quiet on purpose.
  //
  // Asserted as a RELATIONSHIP on rendered colour: labels brighter than the
  // Carton link, and the quiet three still identical to each other. A future
  // global bump of --ink-faint would keep the first half true and break the
  // second, which is exactly the mistake this token split exists to prevent.
  console.log('\nlabel vs quiet-text hierarchy:');
  // Detail view for the cards' Carton links, and a venue query for the Venues
  // section title: the compact landing has neither (0.1.82).
  await setShowsView('detail');
  await setShowsQuery('Toad');
  const lum = `(hex) => { const m = hex.match(/\\d+/g).map(Number);
    const f = (v) => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
    return 0.2126*f(m[0]) + 0.7152*f(m[1]) + 0.0722*f(m[2]); }`;
  const hier = await evaluate(`(() => {
    const lum = ${lum};
    const col = (s) => { const n = document.querySelector(s); return n ? getComputedStyle(n).color : null; };
    const label = col('.section-title');
    const carton = col('.carton-link');
    const attrib = col('.attrib');
    return { label, carton, attrib,
             labelBrighter: label && carton ? lum(label) > lum(carton) : null,
             cartonMatchesAttrib: carton === attrib };
  })()`);

  if (!hier.label || !hier.carton) fail(`hierarchy: need a .section-title and a .carton-link on Shows (${hier.label} / ${hier.carton})`);
  else if (!hier.labelBrighter) fail(`hierarchy: section labels ${hier.label} are not brighter than Carton links ${hier.carton}`);
  else pass(`section labels ${hier.label} brighter than Carton links ${hier.carton}`);
  if (!hier.attrib) fail('hierarchy: no .attrib to compare');
  else if (!hier.cartonMatchesAttrib) fail(`hierarchy: .carton-link ${hier.carton} and .attrib ${hier.attrib} no longer share a colour — one of them moved`);
  else pass(`Carton link and attribution still share ${hier.attrib}`);
  await setShowsQuery('');
  await setShowsView('compact');

  // --- Chips carry the same border as buttons -------------------------------
  //
  // 0.1.46 raised the button border to --btn-line and stopped at the gap chart
  // and show detail buttons, so chips stayed on --line at 1.28:1 and started
  // disappearing once everything around them read properly. This pins them
  // together.
  //
  // Compared against a rendered .btn rather than an expected colour: if
  // --btn-line is ever retuned, both move and this stays true. A literal would
  // need updating in lockstep and would eventually be the thing that drifted.
  //
  // Size is deliberately NOT compared. A chip is 34px and a small button 36px;
  // that difference is established and this check is not the place to enforce
  // it away.
  console.log('\nchip borders:');
  await evaluate(`location.hash = '#/home';`);
  await sleep(1400);
  const chipBorder = await evaluate(`(() => {
    const chip = document.querySelector('.chip');
    const btn = document.querySelector('.btn');
    if (!chip || !btn) return { found: false, chip: !!chip, btn: !!btn };
    const cs = getComputedStyle(chip), bs = getComputedStyle(btn);
    return {
      found: true,
      chipText: chip.textContent.trim(),
      chipColor: cs.borderTopColor, chipWidth: cs.borderTopWidth,
      btnText: btn.textContent.trim(),
      btnColor: bs.borderTopColor, btnWidth: bs.borderTopWidth,
      chipH: Math.round(chip.getBoundingClientRect().height),
      btnH: Math.round(btn.getBoundingClientRect().height),
    };
  })()`);

  // Every bordered control carries the SAME edge. One token, six selectors --
  // .btn, .chip, .status-chip, .icon-btn-bordered, .search, .segmented -- and
  // 0.1.46 shipped having done only two of them. Compared against a rendered
  // .btn rather than a literal, so a future retune moves all of them together.
  // SWEPT ACROSS SCREENS, and every selector must be seen SOMEWHERE.
  //
  // The first version of this checked one screen and skipped anything absent
  // from it -- so `.search`, which only exists on Songs and Shows, reported
  // "not on this screen" and passed. A check that passes because the element
  // is missing is the exact trap this repo keeps re-learning; it was caught by
  // re-introducing the 0.1.46 bug on `.search` and watching it stay green.
  // `.segmented` needs the settings sheet opened, so that is done too.
  const BORDERED = ['.chip', '.status-chip', '.icon-btn-bordered', '.search', '.segmented'];
  const seen = new Map();
  let wantBorder = null;
  for (const [where, hash, openSheet] of [
    ['Home', '#/home', false],
    ['Songs', '#/songs', false],
    ['settings sheet', '#/home', true],
  ]) {
    await evaluate(`location.hash = ${JSON.stringify(hash)};`);
    await sleep(1300);
    if (openSheet) {
      await evaluate(`(() => { const b = document.querySelector('.header-status .icon-btn-bordered'); if (b) b.click(); })()`);
      await sleep(800);
    }
    const r = await evaluate(`(() => {
      const btn = document.querySelector('.btn');
      const want = btn ? getComputedStyle(btn).borderTopColor : null;
      const out = {};
      for (const sel of ${JSON.stringify(BORDERED)}) {
        const n = document.querySelector(sel);
        if (!n) continue;
        const s = getComputedStyle(n);
        out[sel] = { color: s.borderTopColor, width: s.borderTopWidth };
      }
      return { want, out };
    })()`);
    if (r.want) wantBorder = r.want;
    for (const [sel, v] of Object.entries(r.out)) if (!seen.has(sel)) seen.set(sel, { ...v, where });
    if (openSheet) {
      await evaluate(`(() => { const s = document.querySelector('.scrim'); if (s) s.click(); })()`);
      await sleep(400);
    }
  }

  const never = BORDERED.filter((s) => !seen.has(s));
  if (!wantBorder) fail('controls: never found a .btn to compare borders against');
  else if (never.length) {
    fail(`controls: ${never.join(', ')} never appeared on any swept screen — unverified, not passing`);
  } else {
    const wrong = [...seen.entries()].filter(([, v]) => v.color !== wantBorder);
    if (wrong.length) {
      fail(`controls: ${wrong.map(([s, v]) => `${s} is ${v.color} (on ${v.where})`).join(', ')} — expected ${wantBorder}`);
    } else pass(`all ${seen.size} bordered controls share the button edge (${wantBorder})`);
  }

  // Chip TAP TARGET, measured from the rendered ::after rather than the CSS.
  // 34px box, 44px hit region -- the floor for one-handed use in a venue.
  const chipHit = await evaluate(`(() => {
    const chips = [...document.querySelectorAll('.chip')];
    if (!chips.length) return null;
    return chips.map((c) => {
      const b = c.getBoundingClientRect();
      const a = getComputedStyle(c, '::after');
      const ah = parseFloat(a.height) || 0;
      return { text: c.textContent.trim(), box: Math.round(b.height), hit: Math.round(Math.max(b.height, ah)) };
    });
  })()`);
  if (!chipHit) fail('chips: none found to measure');
  else {
    const short = chipHit.filter((c) => c.hit < 44);
    if (short.length) fail(`chips: ${short.map((c) => `${JSON.stringify(c.text)} ${c.hit}px`).join(', ')} under the 44px floor`);
    else pass(`${chipHit.length} chip(s): ${chipHit[0].box}px box, ${chipHit[0].hit}px tap target`);
  }

  if (!chipBorder.found) fail(`chips: need both a .chip and a .btn on Home (chip=${chipBorder.chip} btn=${chipBorder.btn})`);
  else if (chipBorder.chipColor !== chipBorder.btnColor) {
    fail(`chips: ${JSON.stringify(chipBorder.chipText)} border ${chipBorder.chipColor} != ${JSON.stringify(chipBorder.btnText)} ${chipBorder.btnColor}`);
  } else if (chipBorder.chipWidth !== chipBorder.btnWidth) {
    fail(`chips: border width ${chipBorder.chipWidth} != ${chipBorder.btnWidth}`);
  } else {
    pass(`${JSON.stringify(chipBorder.chipText)} border matches ${JSON.stringify(chipBorder.btnText)} (${chipBorder.chipWidth} ${chipBorder.chipColor})`);
    // Recorded, not enforced: the size difference is intentional.
    pass(`sizes left alone: chip ${chipBorder.chipH}px, button ${chipBorder.btnH}px`);
  }

  // --- Tab bar: display order, and active state by IDENTITY not position ----
  //
  // The order is pinned because it is a decision (a show contains songs, so
  // Shows precedes Songs) and because layout-diff cannot see it: that tool
  // compares geometry, and five equal-width cells have identical boxes
  // whatever labels sit in them. A reorder is invisible to it by design.
  //
  // The second half is the one that matters more. Active state and the picks
  // badge match on `href`, not on index, and this asserts that by navigating
  // to a route and requiring THAT tab to be current -- not "the second tab".
  // If anything ever starts keying off position, a reorder breaks it here.
  console.log('\ntab bar:');
  await evaluate(`location.hash = '#/home';`);
  await sleep(1200);
  const tabs = await evaluate(`(() => {
    const t = [...document.querySelectorAll('#tabbar .tab')];
    return t.map(x => ({
      label: x.querySelector('span:not(.tab-count)').textContent.trim(),
      href: x.getAttribute('href'),
    }));
  })()`);

  const EXPECTED_TABS = [
    ['Home', '#/home'],
    ['Shows', '#/shows'],
    ['Songs', '#/songs'],
    ['Jams', '#/jams'],
    ['Picks', '#/picks'],
  ];
  const gotOrder = tabs.map((t) => `${t.label}:${t.href}`).join(' ');
  const wantOrder = EXPECTED_TABS.map(([l, h]) => `${l}:${h}`).join(' ');
  if (gotOrder !== wantOrder) fail(`tabs: order is\n      ${gotOrder}\n      expected\n      ${wantOrder}`);
  else pass(`order: ${tabs.map((t) => t.label).join(' · ')}`);

  // Each tab's label must match its own href -- a swap that moved labels but
  // not hrefs would still pass a bare order check on labels alone.
  for (const [label, href] of EXPECTED_TABS) {
    const found = tabs.find((t) => t.href === href);
    if (!found) { fail(`tabs: no tab with href ${href}`); continue; }
    if (found.label !== label) fail(`tabs: ${href} is labelled ${JSON.stringify(found.label)}, expected ${JSON.stringify(label)}`);
  }

  // Active state follows identity. Checked on the two that were swapped.
  for (const hash of ['#/shows', '#/songs', '#/jams']) {
    await evaluate(`location.hash = ${JSON.stringify(hash)};`);
    await sleep(700);
    const current = await evaluate(
      `(() => { const a = document.querySelector('#tabbar .tab[aria-current="page"]'); return a ? a.getAttribute('href') : null; })()`,
    );
    if (current !== hash) fail(`tabs: at ${hash} the current tab is ${current}`);
    else pass(`${hash} marks its own tab current`);
  }

  // --- Creator credit, and the hierarchy it must not break ------------------
  //
  // The assertion that matters is not "the credit exists" -- it is that it
  // stays QUIETER than the Carton attribution. That hierarchy is a deliberate
  // decision (they supply the data, this is the reader on top of it) and it is
  // the kind of thing a later type change would invert without anyone noticing.
  //
  // Both are measured from computed style on the rendered page, not read from
  // the stylesheet, so a specificity accident counts as a failure too.
  console.log('\ncreator credit:');
  await evaluate(`location.hash = '#/home';`);
  await sleep(1400);
  const credit = await evaluate(`(() => {
    const attrib = document.querySelector('.attrib');
    const attribStyle = attrib ? getComputedStyle(attrib) : null;
    const opened = (() => {
      const b = document.querySelector('.header-status .icon-btn-bordered');
      if (!b) return false; b.click(); return true;
    })();
    return { opened, attribSize: attribStyle ? parseFloat(attribStyle.fontSize) : null,
             attribColor: attribStyle ? attribStyle.color : null };
  })()`);
  await sleep(900);
  const c = await evaluate(`(() => {
    const sheet = document.querySelector('.sheet');
    if (!sheet) return { sheet: false };
    const n = sheet.querySelector('.creator-credit');
    if (!n) return { sheet: true, present: false };
    const s = getComputedStyle(n);
    const kids = [...sheet.children].filter(x => x.nodeType === 1);
    // The sheet wraps its content in a grid div; find the credit's real parent
    // and check it is that container's last element.
    const parent = n.parentElement;
    return {
      sheet: true,
      present: true,
      text: n.textContent.trim(),
      size: parseFloat(s.fontSize),
      color: s.color,
      isLast: parent.lastElementChild === n,
    };
  })()`);

  if (!credit.opened || !c.sheet) fail('credit: could not open the Settings & data sheet');
  else if (!c.present) fail('credit: no .creator-credit in the sheet');
  else {
    pass(`renders in the sheet: ${JSON.stringify(c.text)}`);
    if (!c.isLast) fail('credit: not the last element in the sheet');
    else pass('sits last, below the data section');

    // THE HIERARCHY CHECK.
    if (credit.attribSize === null) fail('credit: no .attrib on the page to compare against');
    else if (c.size >= credit.attribSize) {
      fail(`credit: ${c.size}px is not quieter than the Carton attribution's ${credit.attribSize}px`);
    } else pass(`quieter than the Carton attribution (${c.size}px vs ${credit.attribSize}px)`);
  }
  await evaluate(`(() => { const b = document.querySelector('.sheet-close, .scrim'); if (b) b.click(); })()`);
  await sleep(500);

  // --- The ?nosw guard ------------------------------------------------------
  //
  // Checked by REGISTERING A WORKER FIRST and then confirming ?nosw tears it
  // down. Loading ?nosw on a clean profile would pass trivially -- there was
  // never a worker to disable -- and would say nothing about the case the flag
  // exists for, which is a machine that already has one serving a stale shell.
  //
  // This is also why the assertion is on getRegistrations(), not on whether
  // register() was called: skipping registration is not the behaviour under
  // test, removing an existing worker is.
  console.log('\n?nosw guard:');
  await send('Page.navigate', { url: `http://localhost:${PORT}/#/home` });

  // Wait on navigator.serviceWorker.ready -- the primitive that means "a worker
  // is active for this page" -- rather than polling getRegistrations().
  //
  // Polling was flaky roughly one run in three: registration is hung off
  // window.load and can settle later than any sleep worth writing, so the
  // baseline failed for timing reasons that had nothing to do with the guard.
  // A check that goes red without a real defect is exactly as useless as one
  // that goes green without health, so this waits on the real signal with a
  // generous ceiling instead of guessing a duration.
  //
  // Measured before changing it: register() itself resolves fine (scope
  // returned, no rejection) -- the fault was the wait, not the app. The
  // registration code was therefore left alone.
  const registered = await evaluateAsync(`(async () => {
    try {
      await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 25000)),
      ]);
      return (await navigator.serviceWorker.getRegistrations()).length;
    } catch { return 0; }
  })()`);
  if (!registered) {
    fail('?nosw: baseline failed — no worker registered without the flag, so the teardown proves nothing');
  } else {
    pass(`baseline: ${registered} worker registered without the flag`);

    await send('Page.navigate', { url: `http://localhost:${PORT}/?nosw#/home` });
    await sleep(3000);
    const after = await evaluateAsync(`(async () => ({
      regs: (await navigator.serviceWorker.getRegistrations()).length,
      caches: (await caches.keys()).length,
      controller: !!navigator.serviceWorker.controller,
      chip: !!document.querySelector('.sw-off-chip'),
      booted: !!document.querySelector('#main .screen'),
    }))()`);

    if (after.regs !== 0) fail(`?nosw: ${after.regs} worker(s) still registered`);
    else if (after.controller) fail('?nosw: a worker is still controlling the page');
    else if (after.caches !== 0) fail(`?nosw: ${after.caches} cache(s) left behind`);
    else pass('worker unregistered, caches dropped, page uncontrolled');

    // The flag has to be VISIBLE -- there are no dev tools in this loop, and an
    // invisible dev state is one you can be wrong about in both directions.
    if (!after.chip) fail('?nosw: no .sw-off-chip rendered — the flag is invisible');
    else pass('NO SW chip is on screen');

    // And it must not have broken the app on the way through.
    if (!after.booted) fail('?nosw: the app did not finish booting with the flag set');
    else pass('app still boots with the flag set');
  }

  // Back to a clean URL so nothing downstream inherits the flag.
  await send('Page.navigate', { url: `http://localhost:${PORT}/#/home` });
  await sleep(1500);

  console.log('\nruntime errors:');
  if (runtimeErrors.length) {
    for (const e of [...new Set(runtimeErrors)]) fail(e);
  } else pass('none');

  // Skips are carried into the summary line. A run that could not check
  // something must not read as a run that checked everything, even when it is
  // otherwise clean.
  const skipNote = skips ? ` (${skips} check${skips === 1 ? '' : 's'} SKIPPED, not verified)` : '';
  console.log(
    '\n' +
      (failures
        ? `SMOKE FAILED — ${failures} problem(s)${skipNote}`
        : `SMOKE PASSED — all routes rendered${skipNote}`),
  );
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
