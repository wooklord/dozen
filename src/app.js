// The Dozen — app shell, boot sequence and router.

import { BUILD_LABEL } from './version.js';
import { el, append, clear, icon, ICONS, openSheet } from './ui/dom.js';
import { fetchFullArchive, fetchCurrentYear, DataSourceError } from './data/source.js';
import { readArchive, writeArchive, isStale, cacheAge, mergeYear } from './data/cache.js';
import { buildIndex } from './data/index.js';
import { formatAge, localYear } from './util/dates.js';
import { count as pickCount } from './scratchpad.js';
import { openGapExplainer, statValue } from './ui/components.js';
import {
  THEMES,
  THEME_LABELS,
  getTheme,
  setTheme,
  applyTheme,
  resolvedTheme,
  onSystemThemeChange,
} from './theme.js';

import { renderHome } from './views/home.js';
import { renderSongs } from './views/songs.js';
import { renderShows } from './views/shows.js';
import { renderSong } from './views/song.js';
import { renderShow } from './views/show.js';
import { renderVenue } from './views/venue.js';
import { renderGapChart } from './views/gapchart.js';
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

  // Kept tappable as a second way in -- a path already learned should not be
  // taken away -- but it is no longer the only one. "just now" reads as a
  // status readout, and nothing about a readout suggests a door.
  if (app.index) {
    const age = cacheAge(app.archive);
    append(
      statusSlot,
      // Class is `status-chip`, not `build-marker`: it shows cache age, and a
      // misleading name here is how a deploy check ends up reading the wrong
      // element and passing for the wrong reason.
      el('button.status-chip', {
        type: 'button',
        text: formatAge(age),
        'aria-label': 'Settings and data',
        onclick: openSettingsSheet,
      }),
    );
  }

  append(
    statusSlot,
    el(
      'button.icon-btn',
      {
        type: 'button',
        'data-busy': String(app.busy),
        'aria-label': 'Refresh data',
        onclick: () => refresh({ mode: 'fast' }),
      },
      icon(ICONS.refresh, 18),
    ),
  );

  // The visible way in. An icon button reads as a control; the cache badge
  // reads as a number.
  append(
    statusSlot,
    el(
      'button.icon-btn.icon-btn-bordered',
      {
        type: 'button',
        'aria-label': 'Settings and data',
        onclick: openSettingsSheet,
      },
      icon(ICONS.settings, 18),
    ),
  );
}

/**
 * Three-state Auto / Light / Dark.
 *
 * Auto is the default, so nothing changes for anyone who never touches it.
 * The other two exist because a phone that switches at sunset otherwise
 * changes the app underneath you with no way to decline.
 *
 * Built for one hand in a dark room: three full-height targets across the
 * sheet width, no precise aiming, no submenu.
 */
function themeControl() {
  const wrap = el('div');

  function paint() {
    const current = getTheme();
    const resolved = resolvedTheme(current);
    wrap.replaceChildren(
      el('div.section-title', { style: { marginBottom: '6px' }, text: 'Appearance' }),
      el(
        'div.segmented',
        { role: 'group', 'aria-label': 'Appearance' },
        THEMES.map((t) =>
          el(
            'button.segmented-item',
            {
              type: 'button',
              'aria-pressed': String(current === t),
              onclick: () => {
                setTheme(t);
                paint();
              },
            },
            THEME_LABELS[t],
          ),
        ),
      ),
      el('p.note', {
        style: { marginTop: '6px' },
        text:
          current === 'auto'
            ? `Following your device, which is ${resolved} right now.`
            : `Always ${resolved}, whatever your device does.`,
      }),
    );
  }

  paint();
  return wrap;
}

/**
 * Cache age, row count and newest showdate, all visible without dev tools --
 * a stale or truncated index has to be diagnosable from the UI alone.
 */
function openSettingsSheet() {
  // "Settings & data", because it is honestly both: a preference you change,
  // and provenance you read. Calling it "Settings" alone would misdescribe the
  // gap denominator; calling it "Data" hid the theme control, which is how it
  // went unfound. Splitting it into two sheets would be worse on a phone than
  // one panel with an accurate name.
  openSheet('Settings & data', (close) => {
    const a = app.archive;
    const i = app.index;
    return el('div', { style: { display: 'grid', gap: '10px' } }, [
      // Appearance is FIRST, deliberately: it is the only thing in here that
      // gets changed repeatedly. Everything below is read once and understood.
      // Ordering by interaction frequency, not by importance.
      themeControl(),

      el('div.section-title', { style: { marginTop: '6px' }, text: 'Data' }),
      el('div.stat-grid', null, [
        el('div.stat', null, [
          statValue(i?.counts.setlistRows ?? 0),
          el('div.stat-label', { text: 'setlist rows' }),
        ]),
        el('div.stat', null, [
          statValue(i?.counts.countedShows ?? 0),
          el('div.stat-label', { text: 'shows counted' }),
        ]),
        el('div.stat', null, [
          statValue(i?.newestShowdate ?? '—'),
          el('div.stat-label', { text: 'newest show' }),
        ]),
        el('div.stat', null, [
          statValue(formatAge(cacheAge(a))),
          el('div.stat-label', { text: 'last updated' }),
        ]),
      ]),

      // The BUILD marker. Moved out of the header, but still two taps away and
      // still the thing that confirms a deploy landed.
      el('div.stat.stat-wide', null, [
        statValue(BUILD_LABEL.replace('BUILD ', '')),
        el('div.stat-label', { text: 'build' }),
      ]),
      el('p.note', {
        text:
          'The quick refresh pulls only the current year. The Carton sometimes edits older ' +
          'setlists after the fact — a full rebuild is the only way to pick those up.',
      }),

      // Actions sit directly under the status they act on, above the
      // reference material -- otherwise they end up below a wall of prose.
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

      // How gap is counted: provenance, read once. Last, because it is
      // reference rather than something to act on.
      el('div.card', { style: { marginTop: '6px' } }, [
        el('div.section-title', { style: { marginBottom: '6px' }, text: 'How gap is counted' }),
        el('p', {
          style: { margin: '0 0 8px', fontSize: 'var(--t-sm)' },
          text:
            `Gap is counted across the ${i?.counts.countedShows ?? 0} shows that have setlist data. ` +
            `${i?.counts.excludedNoSetlist ?? 0} shows in the archive were played but have no setlist ` +
            `recorded and are not counted; ${i?.counts.excludedFuture ?? 0} upcoming shows are not counted either.`,
        }),
        i?.counts.excludedBadDate
          ? el('p.note', {
              style: { margin: '0 0 8px' },
              text: `${i.counts.excludedBadDate} of the uncounted shows also has a corrupt date in The Carton's data.`,
            })
          : null,
        el(
          'button.btn.btn-block',
          { type: 'button', onclick: () => { close(); openGapExplainer(app.index); } },
          'More on gap',
        ),
      ]),
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

/**
 * What a broken screen looks like.
 *
 * Deliberately shows the real error text and the top stack frame rather than a
 * friendly non-message: this app has no dev tools in its loop, so the screen
 * IS the error report. Everything here is copyable so it can be pasted back
 * verbatim. Navigation stays intact so a broken route never traps the app.
 */
function renderViewError(err, hash) {
  const frame = String(err?.stack || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('at '))[0];

  return el('div.screen', null, [
    el('div.banner', null, [
      el('strong', { text: 'This screen failed to load' }),
      el('div', { text: `${err?.name || 'Error'}: ${err?.message || String(err)}` }),
      el('code', { text: hash }),
      frame ? el('code', { text: frame }) : null,
      el('code', { text: BUILD_LABEL }),
    ]),
    el('p.note', {
      style: { marginBottom: '12px' },
      text:
        'The rest of the app still works — use the tabs below. If this keeps happening, ' +
        'the lines above are what to report.',
    }),
    el('div', { style: { display: 'grid', gap: '8px' } }, [
      el(
        'button.btn.btn-accent.btn-block',
        { type: 'button', onclick: () => navigate('#/home') },
        'Go to Home',
      ),
      el(
        'button.btn.btn-block',
        { type: 'button', onclick: () => location.reload() },
        'Reload the app',
      ),
    ]),
  ]);
}

// ------------------------------------------------------------------- router --

// Five tabs, deliberately. Songs absorbed the old Rotation screen -- Rotation
// was already "all songs sorted by gap", so it is a sort mode here rather than
// a sixth tab.
// "Home" rather than "Show": it sat next to "Shows" and read as a near
// duplicate, and the screen is more than the next show -- venue history and
// On This Date live here too.
const TABS = [
  ['#/home', 'Home', ICONS.house],
  ['#/songs', 'Songs', ICONS.gap],
  ['#/shows', 'Shows', ICONS.list],
  ['#/jams', 'Jams', ICONS.jam],
  ['#/picks', 'Picks', ICONS.picks],
];

function renderTabs() {
  const bar = document.getElementById('tabbar');
  clear(bar);
  const hash = location.hash || '#/';
  const picks = pickCount();

  for (const [href, label, path] of TABS) {
    // Every tab now has a named route, so no special case for the root. The
    // '#/song/' vs '#/songs' and '#/show/' vs '#/shows' pairs do not collide
    // because the trailing slash makes the prefixes disjoint.
    const active = hash.startsWith(href);
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

  // #/gap was the old Rotation route. It is kept as a redirect so bookmarks
  // and the service-worker-cached shell on an already-installed phone keep
  // working after Songs absorbed it.
  if (hash === '#/gap' || hash.startsWith('#/gap?')) {
    history.replaceState(null, '', '#/songs');
    return route();
  }
  // #/recent was the old Shows route, kept for bookmarks and an already
  // installed service worker.
  if (hash === '#/recent' || hash.startsWith('#/recent?')) {
    history.replaceState(null, '', '#/shows');
    return route();
  }
  // The landing screen moved from '#/' to a named route, so the bare root and
  // the old bookmark both resolve to it.
  if (hash === '' || hash === '#' || hash === '#/' || hash.startsWith('#/upcoming')) {
    history.replaceState(null, '', '#/home');
    return route();
  }

  // Order matters: '#/show/' and '#/shows' share a prefix, and '#/songs' /
  // '#/song/' likewise, so the more specific pattern is tested first.
  //
  // ERROR BOUNDARY. Without this a view that throws leaves the screen exactly
  // as it was -- the hash changes, nothing else does, and the tap looks like a
  // dead button. That is invisible without dev tools, which is how a broken
  // gap chart survived three releases. A view that throws must SAY so.
  let view;
  try {
    if (hash.startsWith('#/song/')) view = renderSong(ctx, hash.slice('#/song/'.length));
    else if (hash.startsWith('#/songs')) view = renderSongs(ctx);
    else if (hash.startsWith('#/gapchart/')) view = renderGapChart(ctx, hash.slice('#/gapchart/'.length));
    else if (hash.startsWith('#/show/')) view = renderShow(ctx, hash.slice('#/show/'.length));
    else if (hash.startsWith('#/shows')) view = renderShows(ctx);
    else if (hash.startsWith('#/venue/')) view = renderVenue(ctx, hash.slice('#/venue/'.length));
    else if (hash.startsWith('#/jams')) view = renderJams(ctx);
    else if (hash.startsWith('#/picks')) view = renderPicks(ctx);
    else view = renderHome(ctx);
  } catch (err) {
    console.error(`[dozen] view failed to render for ${hash}`, err);
    view = renderViewError(err, hash);
  }

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

// Re-apply on load (the inline head script already stamped it pre-paint; this
// keeps the meta tag and any later state in step) and follow the OS while in
// auto mode.
applyTheme();
onSystemThemeChange(() => renderHeaderStatus());

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
