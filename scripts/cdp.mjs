// One headless Chrome, driven over the DevTools protocol, for the three
// scripts that need a real browser: smoke.mjs, layout-diff.mjs and
// verify-deploy.mjs. Each carried its own copy of this until 2026-10-28, and
// the copies had drifted: verify-deploy timed its calls out after its first
// live route walk hung, and the other two never did.
//
// TWO THINGS THIS FILE EXISTS TO GET RIGHT (2026-10-28):
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
// 2. EVERY CALL TIMES OUT, LOUDLY. A lost reply used to leave its promise
//    pending forever, and the smoke test once sat mid-check for three hours
//    with no result and no failure. A call now rejects after CDP_TIMEOUT,
//    naming its method, and a dropped connection rejects every call waiting
//    on it at once. A check that hangs is worse than one that fails, because
//    it reports nothing at all.
import { spawn } from 'node:child_process';
import fs from 'node:fs';

// The longest deliberate wait inside one call is smoke.mjs's 25s ceiling on
// navigator.serviceWorker.ready; this is more than twice that. The smoke test
// prints each run's slowest call beside it, so the margin is on screen.
export const CDP_TIMEOUT = 60000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Launches Chrome on `port` with a throwaway `profile` and connects to its
// page. Resolves to { send, stats, close }; `onEvent` gets every protocol
// event. If the connection fails, the browser is closed before the error is
// thrown, so a failed launch leaves nothing running either.
export async function openChrome({ chrome, port, profile, width = 390, onEvent = null }) {
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
  const closeBrowser = async () => {
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(5000) })).json();
    const b = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { b.onopen = resolve; b.onerror = () => reject(new Error('no browser connection')); });
    await new Promise((resolve) => {
      b.onmessage = resolve;
      b.onclose = resolve;
      b.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    });
    try { b.close(); } catch {}
  };

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await Promise.race([closeBrowser().catch(() => {}), sleep(5000)]);
    try { ws?.close(); } catch {}
    try { proc.kill(); } catch {}
    let gone = false;
    for (let i = 0; i < 40 && !gone; i++) {
      try {
        await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
        await sleep(250);
      } catch { gone = true; }
    }
    if (!gone) console.log(`  WARN  headless Chrome on port ${port} still answers after Browser.close -- it is left running`);
    // Chrome's helper processes can hold the profile for a moment after the
    // browser exits; a cleanup failure must never mask a result, but it must
    // not be silent either, or the profiles pile up again.
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
    catch (err) { console.log(`  WARN  the throwaway profile was not removed (${err.code || err.message})`); }
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
