// The Dozen — app shell, boot sequence and router.

import { BUILD_LABEL } from './version.js';
import { el, append, clear, icon, ICONS, openSheet } from './ui/dom.js';
import { fetchFullArchive, fetchCurrentYear, DataSourceError } from './data/source.js';
import { readArchive, writeArchive, isStale, cacheAge, mergeYear } from './data/cache.js';
import { buildIndex } from './data/index.js';
import { formatAge, localYear } from './util/dates.js';
import { count as pickCount } from './scratchpad.js';

import { renderUpcoming } from './views/upcoming.js';
import { renderGap } from './views/gap.js';
import { renderRecent } from './views/recent.js';
import { renderSong } from './views/song.js';
import { renderShow } from './views/show.js';
import { renderJams } from './views/jams.js';
import { renderPicks } from './views/picks.js';

const app = {
  index: null,
  archive: null,
  error: null,
  busy: false,
};

const main = document.getElementById('main');
const statusSlot = document.getElementById('header-status');

// --------------------------------------------------------------------- boot --

/** The 12-cell carton, filling as the pulls complete. */
function loadingScreen() {
  const cells = [];
  const grid = el('div.carton');
  for (let i = 0; i < 12; i++) {
    const c = el('div.carton-cell', { 'data-filled': 'false' });
    cells.push(c);
    append(grid, c);
  }
  const label = el('div.loader-label', { text: 'Loading the archive…' });
  const sub = el('div.loader-sub', { text: 'One batched download, then it works offline.' });
  const node = el('div.loader', null, [grid, el('div', null, [label, sub])]);

  return {
    node,
    fill(n, text, subtext) {
      const target = Math.max(0, Math.min(12, Math.round(n)));
      cells.forEach((c, i) => c.setAttribute('data-filled', String(i < target)));
      if (text) label.textContent = text;
      if (subtext !== undefined) sub.textContent = subtext;
    },
  };
}

async function boot() {
  renderHeaderStatus();

  const cached = await readArchive();
  if (cached) {
    app.archive = cached;
    app.index = buildIndex(cached);
    route();
    // Refresh in the background only if the TTL has expired. No polling loop.
    if (isStale(cached)) refresh({ mode: 'fast', silent: true });
    return;
  }

  await coldStart();
}

async function coldStart() {
  const loader = loadingScreen();
  clear(main);
  append(main, loader.node);

  try {
    let filled = 0;
    const archive = await fetchFullArchive({
      onProgress: (p) => {
        if (p.phase === 'fetch') {
          filled += 1;
          loader.fill(filled, `Loading ${p.label}…`);
        } else if (p.phase === 'verify') {
          // Verification occupies the last 7 cells.
          const frac = p.total ? p.done / p.total : 0;
          loader.fill(5 + frac * 7, 'Verifying the archive…', `${p.done ?? 0} of ${p.total ?? 14} years checked`);
        }
      },
    });

    loader.fill(12, 'Ready', '');
    app.archive = archive;
    app.index = buildIndex(archive);
    app.error = null;
    await writeArchive({ ...archive, fullFetchedAt: archive.fetchedAt });
    renderHeaderStatus();
    route();
  } catch (err) {
    app.error = err;
    renderError(err);
  }
}

/**
 * Refresh.
 *   mode 'fast'  — current year only, merged into the cached index.
 *   mode 'full'  — everything, with verification. User-confirmed.
 *
 * On failure the previously cached data is kept rather than replaced with
 * something subtly wrong.
 */
async function refresh({ mode = 'fast', silent = false } = {}) {
  if (app.busy) return;
  app.busy = true;
  renderHeaderStatus();

  try {
    if (mode === 'full' || !app.archive) {
      await coldStart();
    } else {
      const year = localYear();
      const fresh = await fetchCurrentYear(year);
      const merged = mergeYear(app.archive, fresh);
      if (merged.mergeRejected) {
        throw new DataSourceError(
          `Refresh for ${year} returned fewer rows than the cache already held. Keeping cached data.`,
          { url: fresh.url },
        );
      }
      app.archive = merged;
      app.index = buildIndex(merged);
      app.error = null;
      await writeArchive(merged);
      if (!silent) route();
    }
  } catch (err) {
    app.error = err;
    console.error('[dozen] refresh failed', err);
    if (!silent) renderError(err, { keepData: Boolean(app.index) });
  } finally {
    app.busy = false;
    renderHeaderStatus();
  }
}

// ------------------------------------------------------------------- header --

function renderHeaderStatus() {
  clear(statusSlot);

  if (app.index) {
    const age = cacheAge(app.archive);
    append(
      statusSlot,
      el('button.build-marker', {
        type: 'button',
        text: formatAge(age),
        'aria-label': 'Cache details and refresh options',
        onclick: openCacheSheet,
      }),
    );
  }

  append(statusSlot, el('span.build-marker', { text: BUILD_LABEL }));

  append(
    statusSlot,
    el(
      'button.refresh-btn',
      {
        type: 'button',
        'data-busy': String(app.busy),
        'aria-label': 'Refresh data',
        onclick: () => refresh({ mode: 'fast' }),
      },
      icon(ICONS.refresh, 18),
    ),
  );
}

/**
 * Cache age, row count and newest showdate, all visible without dev tools --
 * a stale or truncated index has to be diagnosable from the UI alone.
 */
function openCacheSheet() {
  openSheet('Data', (close) => {
    const a = app.archive;
    const i = app.index;
    return el('div', { style: { display: 'grid', gap: '10px' } }, [
      el('div.stat-grid', null, [
        el('div.stat', null, [
          el('div.stat-value.num', { text: String(i?.counts.setlistRows ?? 0) }),
          el('div.stat-label', { text: 'setlist rows' }),
        ]),
        el('div.stat', null, [
          el('div.stat-value.num', { text: String(i?.counts.countedShows ?? 0) }),
          el('div.stat-label', { text: 'shows counted' }),
        ]),
        el('div.stat', null, [
          el('div.stat-value.num', { text: i?.newestShowdate ?? '—' }),
          el('div.stat-label', { text: 'newest show' }),
        ]),
        el('div.stat', null, [
          el('div.stat-value.num', { text: formatAge(cacheAge(a)) }),
          el('div.stat-label', { text: 'last updated' }),
        ]),
      ]),
      el('p.note', {
        text:
          'The quick refresh pulls only the current year. The Carton sometimes edits older ' +
          'setlists after the fact — a full rebuild is the only way to pick those up.',
      }),
      el(
        'button.btn.btn-block',
        {
          type: 'button',
          onclick: () => {
            close();
            refresh({ mode: 'fast' });
          },
        },
        'Quick refresh (this year)',
      ),
      el(
        'button.btn.btn-block',
        {
          type: 'button',
          onclick: () => {
            close();
            confirmFullRebuild();
          },
        },
        'Full rebuild…',
      ),
    ]);
  });
}

/** Full rebuild sits behind a confirm dialog rather than being hidden. */
function confirmFullRebuild() {
  openSheet('Rebuild everything?', (close) =>
    el('div', { style: { display: 'grid', gap: '10px' } }, [
      el('p.note', {
        text:
          'This re-downloads the entire archive (about 5 MB) and re-verifies it year by year. ' +
          'Worth doing on wifi. Your picks are not affected.',
      }),
      el(
        'button.btn.btn-accent.btn-block',
        {
          type: 'button',
          onclick: () => {
            close();
            refresh({ mode: 'full' });
          },
        },
        'Rebuild now',
      ),
      el('button.btn.btn-block', { type: 'button', onclick: close }, 'Cancel'),
    ]),
  );
}

function renderError(err, { keepData = false } = {}) {
  const banner = el('div.banner', null, [
    el('strong', { text: keepData ? 'Refresh failed — showing cached data' : 'Could not load the archive' }),
    el('div', { text: err?.message || String(err) }),
    err?.url ? el('code', { text: err.url }) : null,
  ]);

  if (keepData && app.index) {
    // Keep the app usable; just surface the problem at the top.
    route();
    main.prepend(banner);
    return;
  }

  clear(main);
  append(
    main,
    el('div.screen', null, [
      banner,
      el(
        'button.btn.btn-accent.btn-block',
        { type: 'button', onclick: () => coldStart() },
        'Try again',
      ),
      el('p.note', {
        style: { marginTop: '12px' },
        text: 'The Carton may be temporarily unreachable. Nothing was cached, so your picks are untouched.',
      }),
    ]),
  );
}

// ------------------------------------------------------------------- router --

const TABS = [
  ['#/', 'Show', ICONS.calendar],
  ['#/gap', 'Rotation', ICONS.gap],
  ['#/recent', 'Recent', ICONS.list],
  ['#/jams', 'Jams', ICONS.jam],
  ['#/picks', 'Picks', ICONS.picks],
];

function renderTabs() {
  const bar = document.getElementById('tabbar');
  clear(bar);
  const hash = location.hash || '#/';
  const picks = pickCount();

  for (const [href, label, path] of TABS) {
    const active =
      href === '#/'
        ? hash === '#/' || hash === '' || hash === '#'
        : hash.startsWith(href);
    const tab = el('a.tab', { href, 'aria-current': active ? 'page' : null }, [
      icon(path, 21),
      el('span', { text: label }),
    ]);
    if (href === '#/picks' && picks > 0) {
      append(tab, el('span.tab-count.num', { text: String(picks) }));
    }
    append(bar, tab);
  }
}

function navigate(hash, replace = false) {
  if (replace) {
    history.replaceState(null, '', hash);
    route();
  } else {
    location.hash = hash;
  }
}

function route() {
  if (!app.index) return;
  const ctx = { index: app.index, navigate };
  const hash = location.hash || '#/';

  let view;
  if (hash.startsWith('#/song/')) view = renderSong(ctx, hash.slice('#/song/'.length));
  else if (hash.startsWith('#/show/')) view = renderShow(ctx, hash.slice('#/show/'.length));
  else if (hash.startsWith('#/gap')) view = renderGap(ctx);
  else if (hash.startsWith('#/recent')) view = renderRecent(ctx);
  else if (hash.startsWith('#/jams')) view = renderJams(ctx);
  else if (hash.startsWith('#/picks')) view = renderPicks(ctx);
  else view = renderUpcoming(ctx);

  clear(main);
  append(main, view);
  renderTabs();
  // Re-rendered on every navigation so the cache age stays truthful as time
  // passes -- otherwise it would read "just now" until a full reload.
  renderHeaderStatus();
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
window.addEventListener('dozen:picks-changed', renderTabs);

renderTabs();
boot();

// Service worker: app shell offline. Registered late so it never blocks boot.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('[dozen] service worker registration failed', err);
    });
  });
}
