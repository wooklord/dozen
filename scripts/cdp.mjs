// One headless Chrome, driven over the DevTools protocol, for the three
// scripts that need a real browser: smoke.mjs, layout-diff.mjs and
// verify-deploy.mjs. Each carried its own copy of this until 2026-10-28, and
// the copies had drifted: verify-deploy timed its calls out after its first
// live route walk hung, and the other two never did.
//
// THREE THINGS THIS FILE EXISTS TO GET RIGHT (2026-10-28; the third 2026-11-01):
//
// 1. CLOSE THE BROWSER OVER CDP. On Windows the chrome.exe that spawn() starts
//    hands off to a separate browser process and exits at once, so
//    proc.kill() kills a process that is already gone -- measured with a
//    scratch probe, not inferred. Every run left one or two headless Chromes
//    behind (90 were found), each still holding its throwaway profile, so the
//    rmSync after it failed silently too: 465 profiles, 20 GB, back to
//    2026-09-02. Browser.close reaches the real browser. close() sends it on
//    the browser's own endpoint, then confirms the DevTools port has stopped
//    answering, and says so when it has not.
//
//    Browser.close is not always enough (2026-11-01). For about half an hour that
//    night every scoped smoke run past about 45s left Chrome up after it replied
//    to Browser.close, with every target gone and its port open, while a 12s run
//    closed clean. Half an hour later the same code closed clean at 52s, so the
//    cause was not established. close() reads the real pids first, the browser's
//    and its helpers', and if the port still answers it kills them and says so,
//    so the next time this happens it is on the record. The helpers too, because
//    they outlast the browser and hold the profile.
//
// 2. EVERY CALL TIMES OUT, LOUDLY. A lost reply used to leave its promise
//    pending forever, and the smoke test once sat mid-check for three hours
//    with no result and no failure. A call now rejects after CDP_TIMEOUT,
//    naming its method, and a dropped connection rejects every call waiting
//    on it at once. A check that hangs is worse than one that fails, because
//    it reports nothing at all.
//
// 3. SWEEP WHAT EARLIER RUNS LEFT (2026-11-01, the dev's call). That close()
//    warns and the verdict stands was Code's default on 2026-10-28, offered as
//    the dev's call and left open until 2026-11-01, when it was decided with
//    its other half: a verdict never depends on cleanup, and leftovers never
//    accumulate. So before openChrome() spawns, sweepLeftovers() kills every
//    Chrome whose command line carries a --user-data-dir under the temp
//    directory with one of SWEPT_PREFIXES, removes every such directory, and
//    prints "swept N browsers, M profiles", N the distinct profiles among the
//    processes killed. Runs are sequential -- Carton's 60/minute limit already
//    makes them so -- and the sweep assumes it: a run started beside another
//    would sweep that run's Chrome, and the other run would fail loudly on its
//    next CDP call, never silently.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The longest deliberate wait inside one call is smoke.mjs's 25s ceiling on
// navigator.serviceWorker.ready; this is more than twice that. The smoke test
// prints each run's slowest call beside it, so the margin is on screen.
export const CDP_TIMEOUT = 60000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The throwaway profiles the three scripts create, and the only ones the sweep
// will ever kill a Chrome for or remove. tests/hygiene.test.mjs holds each
// script's profile literal to this list, so a renamed or fourth prefix fails
// there instead of escaping the sweep for good.
export const SWEPT_PREFIXES = ['dozen-smoke-', 'dozen-layout-', 'dozen-verify-'];
const TMP = path.resolve(os.tmpdir());
const WIN = process.platform === 'win32';
// Windows paths compare case-insensitively (the dev's call, 2026-11-01).
const samePath = (a, b) => (WIN ? a.toLowerCase() === b.toLowerCase() : a === b);
// The profiles this process launched itself, which the sweep leaves alone.
const launched = new Set();

// The profile a sweep may act on, or null: a directory straight under the temp
// directory whose name starts with one of SWEPT_PREFIXES and which this process
// did not launch.
function sweptProfile(p, keep) {
  if (!p) return null;
  const dir = path.resolve(p);
  if (!samePath(path.dirname(dir), TMP)) return null;
  const name = path.basename(dir);
  if (!SWEPT_PREFIXES.some((pre) => name.startsWith(pre))) return null;
  for (const k of keep) if (samePath(path.resolve(k), dir)) return null;
  return dir;
}

// The value of --user-data-dir on a command line, quoted or not, or null.
function profileOf(cmd) {
  const key = '--user-data-dir=';
  const i = cmd.toLowerCase().indexOf(key);
  if (i < 0) return null;
  let from = i + key.length;
  const quoted = cmd[i - 1] === '"' || cmd[from] === '"';
  if (cmd[from] === '"') from++;
  const rest = cmd.slice(from);
  const n = quoted ? rest.indexOf('"') : rest.search(/\s/);
  return n < 0 ? rest : rest.slice(0, n);
}

// Every Chrome process with its command line: Win32_Process on Windows, ps
// elsewhere. A listing that fails says so, because a sweep that cannot see
// processes would otherwise read "swept 0 browsers" on every run, for good.
const PS_LIST = 'Get-CimInstance Win32_Process -Filter "Name=\'chrome.exe\'" | ForEach-Object { "$($_.ProcessId)`t$($_.CommandLine)" }';
function listChromes() {
  let out = '';
  try {
    out = WIN
      ? execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(PS_LIST, 'utf16le').toString('base64')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      : execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (err) {
    console.log(`  WARN  the sweep could not list Chrome processes (${String(err.message).split('\n')[0]})`);
    return [];
  }
  return out.split(/\r?\n/).map((line) => {
    const m = line.match(/^\s*(\d+)[\t ]+(.*)$/);
    return m ? { pid: Number(m[1]), cmd: m[2] } : null;
  }).filter((p) => p && /chrome/i.test(p.cmd));
}

async function removeDir(dir, tries) {
  let failed = null;
  for (let i = 0; i < tries; i++) {
    failed = null;
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); return null; }
    catch (err) { failed = err; await sleep(500); }
  }
  return failed;
}

// Kills every Chrome on a swept profile, removes every swept profile, and prints
// one line. Nothing else: the user's own Chrome never carries such a path, and a
// dozen-smoke-*.log beside the profiles is a file, not a profile. It keys on the
// profile path and not on --headless because the helpers that outlast a browser
// hold its profile and carry the path. A verdict never depends on this: a
// directory it cannot remove is a WARN, and the run goes on.
export async function sweepLeftovers(keep = launched) {
  const procs = listChromes()
    .map((p) => ({ ...p, dir: sweptProfile(profileOf(p.cmd), keep) }))
    .filter((p) => p.dir);
  const browsers = new Set(procs.map((p) => (WIN ? p.dir.toLowerCase() : p.dir)));
  for (const p of procs) { try { process.kill(p.pid); } catch {} }
  if (procs.length) {
    const pids = new Set(procs.map((p) => p.pid));
    for (let i = 0; i < 20 && listChromes().some((p) => pids.has(p.pid)); i++) await sleep(250);
  }
  let profiles = 0;
  for (const e of fs.readdirSync(TMP, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const dir = sweptProfile(path.join(TMP, e.name), keep);
    if (!dir) continue;
    const failed = await removeDir(dir, 6);
    if (failed) console.log(`  WARN  the sweep could not remove ${e.name} (${failed.code || failed.message})`);
    else profiles++;
  }
  console.log(`swept ${browsers.size} browsers, ${profiles} profiles`);
  return { browsers: browsers.size, profiles, processes: procs.length };
}

// Launches Chrome on `port` with a throwaway `profile` and connects to its
// page. Resolves to { send, stats, close }; `onEvent` gets every protocol
// event. If the connection fails, the browser is closed before the error is
// thrown, so a failed launch leaves nothing running either. Before it spawns,
// it sweeps what earlier runs left (3. above).
export async function openChrome({ chrome, port, profile, width = 390, onEvent = null }) {
  launched.add(profile);
  await sweepLeftovers(launched);
  const proc = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    `--window-size=${width},844`, 'about:blank',
  ], { stdio: 'ignore' });

  let ws = null;
  let id = 0;
  const pending = new Map();
  let calls = 0;
  let slowest = { method: null, ms: 0 };

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error(`CDP ${method}: no open connection to Chrome`));
        return;
      }
      const i = ++id;
      const t0 = Date.now();
      calls++;
      const timer = setTimeout(() => {
        pending.delete(i);
        reject(new Error(`CDP ${method} timed out after ${CDP_TIMEOUT / 1000}s with no reply from Chrome`));
      }, CDP_TIMEOUT);
      pending.set(i, {
        method,
        resolve: (result) => {
          clearTimeout(timer);
          const ms = Date.now() - t0;
          if (ms > slowest.ms) slowest = { method, ms };
          resolve(result);
        },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });
      ws.send(JSON.stringify({ id: i, method, params }));
    });

  // Browser.close on the BROWSER target (/json/version), not the page's
  // connection: it has to work when the page connection is the thing that
  // failed. Chrome may drop the socket before replying; either ends the wait,
  // and what counts is the port check after it.
  let chromePids = [];
  const closeBrowser = async () => {
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(5000) })).json();
    const b = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { b.onopen = resolve; b.onerror = () => reject(new Error('no browser connection')); });
    const info = await new Promise((resolve) => {
      b.onmessage = (e) => resolve(JSON.parse(e.data));
      b.onclose = () => resolve(null);
      b.send(JSON.stringify({ id: 1, method: 'SystemInfo.getProcessInfo' }));
    });
    chromePids = (info?.result?.processInfo || []).map((p) => p.id);
    await new Promise((resolve) => {
      b.onmessage = resolve;
      b.onclose = resolve;
      b.send(JSON.stringify({ id: 2, method: 'Browser.close' }));
    });
    try { b.close(); } catch {}
  };

  const stoppedAnswering = async (tries) => {
    for (let i = 0; i < tries; i++) {
      try {
        await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
        await sleep(250);
      } catch { return true; }
    }
    return false;
  };

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await Promise.race([closeBrowser().catch(() => {}), sleep(5000)]);
    try { ws?.close(); } catch {}
    try { proc.kill(); } catch {}
    let gone = await stoppedAnswering(12);
    if (!gone && chromePids.length) {
      for (const pid of chromePids) { try { process.kill(pid); } catch {} }
      gone = await stoppedAnswering(20);
      if (gone) console.log(`  WARN  headless Chrome on port ${port} stayed up after Browser.close -- its processes were killed`);
    }
    if (!gone) console.log(`  WARN  headless Chrome on port ${port} still answers after Browser.close -- it is left running`);
    // Chrome's helper processes can hold the profile for a moment after the
    // browser exits. A cleanup failure never masks a result -- decided
    // 2026-11-01, with the sweep above as its other half -- but it is not silent
    // either, or the profiles pile up again. Retried here as well as in rmSync,
    // whose own retries gave up with EPERM on a profile free moments later.
    const failed = await removeDir(profile, 40);
    if (failed) console.log(`  WARN  the throwaway profile was not removed (${failed.code || failed.message})`);
  };

  try {
    await sleep(2500);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(CDP_TIMEOUT) })).json();
    ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        p.resolve(m.result);
      } else if (m.method && onEvent) onEvent(m);
    };
    ws.onclose = () => {
      for (const [i, p] of pending) {
        pending.delete(i);
        p.reject(new Error(`CDP ${p.method}: Chrome closed the connection before replying`));
      }
    };
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP: no connection to Chrome's page within ${CDP_TIMEOUT / 1000}s`)), CDP_TIMEOUT);
      ws.onopen = () => { clearTimeout(timer); resolve(); };
      ws.onerror = () => { clearTimeout(timer); reject(new Error(`CDP: could not connect to Chrome on port ${port}`)); };
    });
  } catch (err) {
    await close();
    throw err;
  }

  return { send, stats: () => ({ calls, slowest }), close };
}
