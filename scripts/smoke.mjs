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
  // The Shows tab's compact rows only exist for SEARCH results -- the empty
  // query lands on full cards, which have no row-action. So this one types a
  // query first; without that it reports "no control found" and would look
  // like a missing entry point rather than the wrong screen state.
  { name: 'Shows search row', at: '#/shows',
    setup: `(() => {
      const s = document.querySelector('.search');
      if (!s) return false;
      s.value = '2019';
      s.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`,
    click: `document.querySelector('.row-action')` },
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

  if (skipped) pass(`SKIPPED — coverage note not cross-checked: ${skipped}`);
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
      booted: !document.querySelector('.loader'),
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
