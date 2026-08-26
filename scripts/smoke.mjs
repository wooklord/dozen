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
    if (await evaluate(`!!document.querySelector('#main .screen')`)) { booted = true; break; }
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

  // --- Shows: browse by year and month, layered on the existing list --------
  //
  // The drill-down routes through the SAME date-search path a typed "2019"
  // uses. So the check is that a year chip produces the same result set as
  // typing that year -- not merely that chips exist. If the two ever diverge,
  // the affordance has grown its own implementation, which is the thing it was
  // built to avoid.
  console.log('\nShows: browse by year and month:');
  await evaluate(`location.hash = '#/shows';`);
  await sleep(1600);
  // Reset any query a previous section left behind.
  await evaluate(`(() => { const s = document.querySelector('.search'); if (s) { s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
  await sleep(1100);

  const landing = await evaluate(`(() => ({
    cards: [...document.querySelectorAll('.card')].filter((c) => c.querySelector('.setlist-song')).length,
    years: [...document.querySelectorAll('.sortbar .chip')].map((c) => c.textContent.trim()),
    loadOlder: !!([...document.querySelectorAll('button')].find((b) => /older/i.test(b.textContent))),
  }))()`);
  if (!landing.cards) fail('Shows: the recent-first card list is gone from the landing state');
  else if (!landing.loadOlder) fail('Shows: "Load older" is gone from the landing state');
  else if (landing.years.length < 5) fail(`Shows: only ${landing.years.length} year chip(s)`);
  else pass(`landing keeps ${landing.cards} cards + Load older, plus ${landing.years.length} year chips`);

  // Type a year, record the result, then reach the same year by chip.
  const YEAR = '2019';
  await evaluate(`(() => { const s = document.querySelector('.search'); s.value = ${JSON.stringify(YEAR)}; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(1100);
  const typed = await evaluate(`(() => {
    const h = [...document.querySelectorAll('.section-title')].map((n) => n.textContent.trim());
    return { head: h.find((t) => /^Shows \\(/.test(t)) || null, rows: document.querySelectorAll('.rows li').length };
  })()`);

  await evaluate(`(() => { const s = document.querySelector('.search'); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(1100);
  const viaChip = await evaluate(`(() => {
    const c = [...document.querySelectorAll('.sortbar .chip')].find((x) => x.textContent.trim() === ${JSON.stringify(YEAR)});
    if (!c) return null; c.click(); return true;
  })()`);
  await sleep(1100);
  const chipped = await evaluate(`(() => {
    const h = [...document.querySelectorAll('.section-title')].map((n) => n.textContent.trim());
    return {
      head: h.find((t) => /^Shows \\(/.test(t)) || null,
      rows: document.querySelectorAll('.rows li').length,
      searchValue: document.querySelector('.search').value,
      months: [...document.querySelectorAll('.sortbar')].length,
    };
  })()`);

  if (!viaChip) fail(`Shows: no ${YEAR} year chip to click`);
  else if (chipped.head !== typed.head || chipped.rows !== typed.rows) {
    fail(`Shows: chip gives ${JSON.stringify(chipped.head)}/${chipped.rows} rows, typing "${YEAR}" gives ${JSON.stringify(typed.head)}/${typed.rows} — the drill-down is not routing through the search path`);
  } else pass(`year chip matches typing "${YEAR}" exactly (${chipped.head}, ${chipped.rows} rows)`);

  if (chipped.searchValue !== YEAR) fail(`Shows: chip left the search box showing ${JSON.stringify(chipped.searchValue)}`);
  else pass('the search box reflects the drill-down');
  if (chipped.months < 2) fail('Shows: no month bar inside a year');
  else pass('a year exposes its months');

  // A month chip must narrow further, still through the same path.
  const monthed = await evaluate(`(() => {
    const bars = [...document.querySelectorAll('.sortbar')];
    const monthBar = bars[bars.length - 1];
    const c = monthBar && monthBar.querySelector('.chip');
    if (!c) return null;
    const label = c.textContent.trim();
    c.click();
    return label;
  })()`);
  await sleep(1100);
  const after = await evaluate(`(() => ({
    rows: document.querySelectorAll('.rows li').length,
    searchValue: document.querySelector('.search').value,
  }))()`);
  if (!monthed) fail('Shows: no month chip to click');
  else if (after.rows === 0) fail(`Shows: month "${monthed}" produced no rows`);
  else if (after.rows > chipped.rows) fail(`Shows: month "${monthed}" widened the result (${after.rows} > ${chipped.rows})`);
  else pass(`month "${monthed}" narrows ${chipped.rows} -> ${after.rows} (query ${JSON.stringify(after.searchValue)})`);

  // Back to the default landing state.
  await evaluate(`(() => { const s = document.querySelector('.search'); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(1000);

  // --- A selected chip must LOOK selected, in both themes -------------------
  //
  // The check above proves a month chip returns the same rows as typing its
  // query. It passed for several builds while the month chip rendered with no
  // selected state at all: monthBar never set aria-pressed, which is the only
  // thing .chip[aria-pressed="true"] in app.css keys off. Correct filtering,
  // invisible control -- the results were right and the bar that produced them
  // said nothing about having produced them.
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

  // Every .sortbar on screen, its chips, and the resolved selected fill.
  // .chip is also used for things that are not toggles -- the Back chips, and
  // Home's "Change" -- and none of those live in a .sortbar, so scoping to the
  // bars is what keeps this check about chosen state.
  const CHIP_PROBE = `(() => {
    const probe = document.createElement('span');
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--chip-sel-fill').trim();
    document.body.appendChild(probe);
    const selFill = getComputedStyle(probe).color;
    probe.remove();
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      selFill,
      bars: [...document.querySelectorAll('.sortbar')].map((bar) =>
        [...bar.querySelectorAll('.chip')].map((c) => ({
          text: c.textContent.trim(),
          bg: getComputedStyle(c).backgroundColor,
        })),
      ),
    };
  })()`;

  // Labels in bar N whose background is the selected fill.
  const painted = (snap, i) => (snap.bars[i] || []).filter((c) => c.bg === snap.selFill).map((c) => c.text);
  const chipLabels = (snap, i) => (snap.bars[i] || []).map((c) => c.text);
  const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

  const setShowsQuery = async (v) => {
    await evaluate(`(() => { const s = document.querySelector('.search'); if (!s) return false;
      s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await sleep(1100);
  };
  // Click a chip by EXACT LABEL inside bar N, so nothing here depends on chip
  // order, and an absent chip is reported rather than silently skipped.
  const clickChipIn = async (bar, label) => {
    const ok = await evaluate(`(() => {
      const b = [...document.querySelectorAll('.sortbar')][${bar}];
      if (!b) return false;
      const c = [...b.querySelectorAll('.chip')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
      if (!c) return false;
      c.click();
      return true;
    })()`);
    await sleep(1100);
    return ok;
  };

  const selFills = {};
  for (const theme of ['dark', 'light']) {
    await evaluate(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)});`);
    await evaluate(`location.hash = '#/shows';`);
    await sleep(1400);
    await setShowsQuery('');

    // 1. Landing: nothing is filtered, and the bar says so.
    let snap = await evaluate(CHIP_PROBE);
    selFills[theme] = snap.selFill;
    if (snap.theme !== theme) {
      fail(`chip paint (${theme}): data-theme reads ${JSON.stringify(snap.theme)} — the theme never applied`);
      continue;
    }
    if (!snap.bars.length) { fail(`chip paint (${theme}): no .sortbar on Shows`); continue; }
    let got = painted(snap, 0);
    if (!sameList(got, ['All shows'])) {
      fail(`chip paint (${theme}): landing year bar paints ${JSON.stringify(got)}, expected ["All shows"] (chips: ${JSON.stringify(chipLabels(snap, 0))})`);
    } else pass(`${theme}: landing shows "All shows" selected (${snap.selFill})`);

    // 2. A year: that year lit, "All shows" released, no month claimed.
    const Y1 = '2019';
    if (!(await clickChipIn(0, Y1))) { fail(`chip paint (${theme}): no ${Y1} chip`); continue; }
    snap = await evaluate(CHIP_PROBE);
    got = painted(snap, 0);
    if (!sameList(got, [Y1])) {
      fail(`chip paint (${theme}): year bar paints ${JSON.stringify(got)}, expected ["${Y1}"]`);
    } else pass(`${theme}: ${Y1} selected, "All shows" released`);
    if (snap.bars.length < 2) { fail(`chip paint (${theme}): ${Y1} exposed no month bar`); continue; }
    got = painted(snap, 1);
    if (got.length) {
      fail(`chip paint (${theme}): a whole year is selected but the month bar paints ${JSON.stringify(got)}`);
    } else pass(`${theme}: a year selects no single month`);

    // 3. A month: THE BUG. The month lights, and its year stays lit.
    const M1 = chipLabels(snap, 1)[1] || chipLabels(snap, 1)[0];
    if (!(await clickChipIn(1, M1))) { fail(`chip paint (${theme}): no ${M1} chip`); continue; }
    snap = await evaluate(CHIP_PROBE);
    got = painted(snap, 1);
    if (!sameList(got, [M1])) {
      fail(`chip paint (${theme}): "${M1}" is the applied filter but the month bar paints ${JSON.stringify(got)} (chips: ${JSON.stringify(chipLabels(snap, 1))})`);
    } else pass(`${theme}: month "${M1}" selected`);
    got = painted(snap, 0);
    if (!sameList(got, [Y1])) {
      fail(`chip paint (${theme}): inside "${M1}" the year bar paints ${JSON.stringify(got)}, expected ["${Y1}"]`);
    } else pass(`${theme}: the year stays selected inside a month`);

    // 4. Step sideways to another year WHILE a month is applied. The months
    //    are rebuilt for the new year, and nothing in the new bar may stay
    //    lit -- the filter is now the whole of that year, and a chip left on
    //    would describe a filter that is not applied.
    const Y2 = '2018';
    if (!(await clickChipIn(0, Y2))) { fail(`chip paint (${theme}): no ${Y2} chip`); continue; }
    snap = await evaluate(CHIP_PROBE);
    got = painted(snap, 0);
    if (!sameList(got, [Y2])) {
      fail(`chip paint (${theme}): after switching years the year bar paints ${JSON.stringify(got)}, expected ["${Y2}"]`);
    } else pass(`${theme}: switching years moves the selection to ${Y2}`);
    got = painted(snap, 1);
    if (got.length) {
      fail(`chip paint (${theme}): the ${Y2} month bar still paints ${JSON.stringify(got)} — a month survived the year switch`);
    } else pass(`${theme}: no month survives a year switch`);

    // 5. A month inside the NEW year still lights -- so step 4 cannot be
    //    satisfied by selection being broken altogether.
    const M2 = chipLabels(snap, 1)[0];
    if (M2) {
      if (!(await clickChipIn(1, M2))) fail(`chip paint (${theme}): no "${M2}" chip in ${Y2}`);
      else {
        snap = await evaluate(CHIP_PROBE);
        got = painted(snap, 1);
        if (!sameList(got, [M2])) {
          fail(`chip paint (${theme}): "${M2}" in ${Y2} paints ${JSON.stringify(got)}`);
        } else pass(`${theme}: months still select after a year switch ("${M2}" in ${Y2})`);
      }
    }

    // 6. The same property swept across every OTHER chip bar in the app.
    //    Songs carries two (sort + filter) and Jams one, and each has a
    //    default, so exactly one chip per bar is painted at rest. This is what
    //    makes the check about the CLASS of bug rather than this one bar.
    for (const [where, hash, wantBars] of [['Songs', '#/songs', 2], ['Jams', '#/jams', 1]]) {
      await evaluate(`location.hash = ${JSON.stringify(hash)};`);
      await sleep(1400);
      const s2 = await evaluate(CHIP_PROBE);
      if (s2.bars.length < wantBars) {
        fail(`chip paint (${theme}): ${where} rendered ${s2.bars.length} chip bar(s), expected ${wantBars}`);
        continue;
      }
      const bad = s2.bars.map((_, i) => [i, painted(s2, i)]).filter(([, p]) => p.length !== 1);
      if (bad.length) {
        fail(`chip paint (${theme}): ${where} ${bad.map(([i, p]) => `bar #${i} paints ${JSON.stringify(p)}`).join(', ')} — expected exactly one selected chip`);
      } else {
        pass(`${theme}: ${where} — ${s2.bars.map((_, i) => JSON.stringify(painted(s2, i)[0])).join(' + ')} selected`);
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

  // --- The accented figure follows the ACTIVE SORT --------------------------
  //
  // Asserted as a correspondence, never as "some figure is yolk". A fixed
  // column rendering yolk regardless of sort would satisfy the weaker check
  // while being exactly the bug -- the whole point is that the focal point
  // MOVES. So each sort is clicked and the figure's unit is read back: sort by
  // gap and the figure must be the gap one, sort by plays and it must be plays.
  //
  // A–Z is included deliberately: it orders by name, so NOTHING may be
  // accented. That is the case a "some figure is yolk" check would fail on.
  console.log('\nsort drives the accented figure:');
  await evaluate(`location.hash = '#/songs';`);
  await sleep(1500);
  const yolk = await evaluate(`(() => {
    const probe = document.createElement('span');
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--yolk').trim();
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color; probe.remove(); return c;
  })()`);

  for (const [label, wantUnit, wantAccent] of [
    ['A–Z', 'shows', false],
    ['Coldest first', 'shows', true],
    ['Most played', 'times', true],
  ]) {
    const clicked = await evaluate(`(() => {
      const c = [...document.querySelectorAll('.sortbar .chip')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
      if (!c) return false; c.click(); return true;
    })()`);
    if (!clicked) { fail(`sort: no "${label}" chip`); continue; }
    await sleep(900);
    const r = await evaluate(`(() => {
      const active = [...document.querySelectorAll('.sortbar .chip')].find((x) => x.getAttribute('aria-pressed') === 'true');
      const num = document.querySelector('.rows .gap-num');
      const unit = document.querySelector('.rows .gap-unit');
      return {
        activeChip: active ? active.textContent.trim() : null,
        unit: unit ? unit.textContent.trim().toLowerCase() : null,
        colour: num ? getComputedStyle(num).color : null,
        plainClass: num ? num.classList.contains('plain') : null,
      };
    })()`);

    if (r.activeChip !== label) fail(`sort: clicked "${label}" but the pressed chip is ${JSON.stringify(r.activeChip)}`);
    else if (!r.unit || !r.unit.includes(wantUnit)) {
      fail(`sort "${label}": figure column shows ${JSON.stringify(r.unit)}, expected ${JSON.stringify(wantUnit)}`);
    } else if (wantAccent && r.colour !== yolk) {
      fail(`sort "${label}": the sorted figure is ${r.colour}, not the yolk accent ${yolk}`);
    } else if (!wantAccent && r.colour === yolk) {
      fail(`sort "${label}": orders by NAME, so no figure may be accented — but it is ${r.colour}`);
    } else {
      pass(`"${label}" -> ${r.unit} figure ${wantAccent ? `accented ${r.colour}` : `plain ${r.colour}`}`);
    }
  }

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
  await evaluate(`location.hash = '#/shows';`);
  await sleep(1500);
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
