// GAP HISTORY (0.1.83) — every gap one song has been through, one entry per
// show, and the gap running now. Reached from song detail's longest-gap tile.
//
// Every number here is the Show Gap Carton prints on the song's page, read
// through gapHistory() in data/index.js, which calls gapAtShow() at each show.
// That is repackaging: the screen lays out figures Carton already shows.
// Ruled in docs/plan.md, "Gap history (2026-10-26)", which also records what
// is deliberately absent -- no average line, no days between performances, no
// trend line. A reference line across a gap chart reads as "due" whatever it
// is labelled, so there is none.

import { el, append, icon, ICONS, openSheet } from '../ui/dom.js';
import {
  attribution,
  cartonLink,
  songPermalink,
  emptyState,
  statTile,
  currentGapTile,
  gapExplainerLink,
  venueLine,
  heatFor,
  titleChip,
} from '../ui/components.js';
import {
  gapHistory,
  compareHistoryNewest,
  compareHistoryOldest,
  compareHistoryLargest,
} from '../data/index.js';
import { formatShowDate, formatShowDateShort } from '../util/dates.js';

// Module-level, like Songs' sort: kept across navigation in the session, not
// persisted. One sort serves every song's history.
const state = { sort: 'newest' };

// [key, label, description, count-line phrase, comparator]. The descriptions
// are the sheet's second line and the count line follows the active sort, both
// locked in docs/plan.md.
const SORTS = [
  ['newest', 'Newest first', 'Most recent show first.', 'newest first', compareHistoryNewest],
  ['oldest', 'Oldest first', 'The debut first.', 'oldest first', compareHistoryOldest],
  ['largest', 'Largest gap', 'Biggest gap first; ties newest first.', 'largest gap first', compareHistoryLargest],
];
const sortOf = (key) => SORTS.find(([k]) => k === key) || SORTS[0];

// Where the back link goes. Opened from the song, it steps back, so the
// browser's own stack stays song -> history; anything else -- a deep link, a
// pasted URL -- has no song beneath it and replaces itself with the song.
//
// Which of the two is recorded ON THE HISTORY ENTRY, in history.state, by
// openGapHistory() below. It was module memory, set by comparing the previous
// route, and that was lost or wrong three ways: a reload or a discarded tab
// reset it, the refresh button re-rendered with the previous route equal to
// this one, and a second song's history opened in between left the flag
// naming the second song. Each entry carrying its own fact survives all
// three. (Cold review, 0.1.83.)
const FROM_SONG = 'gapHistoryFromSong';

/** Open a song's gap history from that song, so its back link steps back. */
export function openGapHistory(navigate, songId) {
  navigate(`#/song/${songId}/gaps`);
  // location.hash has already pushed the new entry; this stamps that entry,
  // not the song's. The hashchange that renders it fires after.
  history.replaceState({ [FROM_SONG]: Number(songId) }, '');
}

const FLASH_MS = 1200;

export function renderGapHistory(ctx, songId) {
  const { index, navigate } = ctx;
  const screen = el('div.screen');
  const data = gapHistory(index, songId);

  if (!data) {
    append(screen, el('h1.screen-title', { text: 'Song not found' }));
    append(screen, el('button.btn', { type: 'button', onclick: () => navigate('#/songs') }, 'Back to songs'));
    return screen;
  }

  const { song, entries, current, max, longest } = data;
  const songHash = `#/song/${song.song_id}`;

  // --- Header ---------------------------------------------------------------
  append(
    screen,
    el(
      'button.chip',
      {
        type: 'button',
        'aria-label': `Back to ${song.name}`,
        onclick: () => {
          if (history.state && history.state[FROM_SONG] === song.song_id) history.back();
          else navigate(songHash, true);
        },
        style: { marginBottom: '12px' },
      },
      [icon(ICONS.back, 16), song.name],
    ),
  );
  const title = el('h1.screen-title', { text: 'Gap history' });
  append(screen, title);
  append(
    screen,
    el('p.screen-sub', null, [
      'Every gap this song has been through, counted the way The Carton’s Show Gap column counts it. ',
      gapExplainerLink(index),
    ]),
  );
  // Every figure here is the Show Gap column of this song's page on The
  // Carton, so that page is where the screen links home (CLAUDE.md,
  // "Attribution is required").
  append(screen, el('div', { style: { marginTop: '4px' } }, cartonLink(songPermalink(song), 'Song page on The Carton')));

  // --- Headline stats -------------------------------------------------------
  // The same three figures song detail carries, so nothing read there changes
  // here: the current gap, the longest gap (open or closed, longestGap()), and
  // times played, which counts performances -- a song played twice at one
  // show is two -- while the list below has one row per show. The longest
  // reads a dash exactly when song detail's does: when longestGap() has no
  // answer, which a song played only outside the counted shows can reach.
  append(
    screen,
    el('div.section', null, [
      el('div.stat-grid.stat-grid-3', null, [
        currentGapTile(index, current ? current.gap : '—'),
        statTile(longest ? longest.gap : '—', 'longest gap'),
        statTile(song.timesPlayed, song.timesPlayed === 1 ? 'time played' : 'times played'),
      ]),
    ]),
  );

  if (!entries.length) {
    append(screen, emptyState('This song is in the catalog but has never been played.'));
    append(screen, attribution());
    return screen;
  }

  // --- The strip: every show, oldest to newest -------------------------------
  //
  // gapStrip() below, the same component song detail's longest-gap tile
  // carries. Here it is ONE image to assistive tech (role="img", a summary
  // label); its bars are not focusable, and the list below is the accessible
  // path to every figure on it. A tap picks the bar nearest the tap's x
  // position -- at Shadow's 141 shows a bar is ~1.3px wide and no thumb can
  // aim at one -- and scrolls that show's row into view.
  const rowsByOrder = new Map();
  const strip = gapStrip(data, {
    role: 'img',
    'aria-label': stripSummary(entries, current, max),
    onclick: (ev) => {
      const order = nearestBar(strip, ev.clientX);
      if (order !== null) jumpTo(order);
    },
  });
  append(
    screen,
    el('div.card', null, [
      strip,
      el('p.note.gap-strip-caption', {
        text:
          'Every gap, oldest to newest' +
          (current ? '; the dashed bar at the end is the gap still open' : '') +
          '. Tap the strip to find that show in the list.',
      }),
    ]),
  );

  // --- Sort, count line, list ------------------------------------------------
  // The 0.1.81 lead-chip pattern: one chip reads the active sort and opens a
  // sheet of described options. The song's title chip (0.1.85) takes the
  // row's right end, so this screen has one sticky bar, never two stacked; it
  // shows once the heading above has gone under the header, even while this
  // row is still mid-screen.
  const leadValue = el('span.chip-value');
  const lead = el('button.chip.chip-lead', { type: 'button', onclick: () => openSortSheet() }, [
    el('span.chip-label', { text: 'Sort' }),
    leadValue,
    el('span.chip-caret', { text: '▾', 'aria-hidden': 'true' }),
  ]);
  append(screen, el('div.sortbar.sortbar-lead.sortbar-titled', null, [lead, titleChip(ctx, song.name, title)]));

  function openSortSheet() {
    openSheet('Sort by', (close) =>
      el(
        'div.sheet-options',
        { role: 'group', 'aria-label': 'Sort options' },
        SORTS.map(([key, label, description]) =>
          el(
            'button.sheet-item.sheet-option',
            {
              type: 'button',
              'aria-pressed': String(state.sort === key),
              onclick: () => {
                state.sort = key;
                close();
                paint();
              },
            },
            [el('div.sheet-option-name', { text: label }), el('div.sheet-option-desc', { text: description })],
          ),
        ),
      ),
    );
  }

  // "141 shows", not a performance count: the rows are shows, and times played
  // above counts performances, so the two can differ.
  const countLine = el('p.note', { style: { margin: '4px 0 8px' } });
  append(screen, countLine);
  const listWrap = el('div');
  append(screen, listWrap);
  append(screen, attribution());

  function paint() {
    const [, label, , phrase, compare] = sortOf(state.sort);
    leadValue.textContent = label;
    lead.setAttribute('aria-label', `Sort ${label}. Change sort`);
    countLine.textContent = `${entries.length} show${entries.length === 1 ? '' : 's'} · ${phrase}`;

    const items = [...entries.map((e) => ({ kind: 'show', ...e })), ...(current ? [{ kind: 'now', ...current }] : [])];
    items.sort(compare);

    rowsByOrder.clear();
    const list = el('ul.rows');
    for (const item of items) {
      const shell = item.kind === 'now' ? nowRow(item, max) : showRow(item, max, navigate);
      rowsByOrder.set(item.order, shell);
      append(list, el('li', null, [shell]));
    }
    listWrap.replaceChildren(list);
  }

  // Instant, not smooth: a smooth programmatic scroll never advanced in
  // headless Chrome when the State wheel used one (docs/design.md, 0.1.82),
  // and the flash, not the motion, is what says which row it was.
  let flashTimer = null;
  function jumpTo(order) {
    const row = rowsByOrder.get(order);
    if (!row) return;
    for (const r of rowsByOrder.values()) r.removeAttribute('data-flash');
    row.scrollIntoView({ block: 'center' });
    row.setAttribute('data-flash', 'true');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => row.removeAttribute('data-flash'), FLASH_MS);
  }

  paint();
  return screen;
}

/**
 * THE STRIP: one bar per show, oldest to newest, then the gap still open.
 * Heights are the gap over this song's own longest, with a 2px floor so every
 * show is visible -- a debut has no gap and is the floor, a flat tick. The
 * gap still open is a dashed bar of its own at the right end. The longest is
 * --yolk, the rest --yolk-muted; colour is never the only signal, because the
 * longest bar is also the tallest.
 *
 * ONE COMPONENT, rendered in two places (0.1.84): this screen, and song
 * detail's longest-gap tile, which is the way in. A copy in the tile would be
 * a second scale, a second floor and a second gap rule free to drift from
 * this one. Its height comes from where it sits (app.css), never from an
 * option here, and `attrs` is what the placement adds: a role, a label and a
 * tap on this screen, aria-hidden in the tile.
 *
 * --n and --h go through el()'s style prop. They went through a setProperty
 * helper of their own in 0.1.83, because el() dropped custom properties then;
 * the smoke test holds every bar's height to its row, so a regression in
 * el() fails here as well as on the gap bars' heat.
 *
 * @param {{entries: object[], current: object|null, max: number}} data  gapHistory()
 */
export function gapStrip({ entries, current, max }, attrs = null) {
  const bars = el('div.gap-strip-bars', { style: { '--n': String(entries.length) } });
  for (const e of entries) {
    append(
      bars,
      el('span.gap-strip-bar', {
        style: { '--h': String(e.isDebut ? 0 : heatFor(e.gap, max)) },
        'data-order': String(e.order),
        'data-debut': e.isDebut ? 'true' : null,
        'data-longest': e.isLongest ? 'true' : null,
      }),
    );
  }
  const openBar = current
    ? el('span.gap-strip-open', {
        style: { '--h': String(heatFor(current.gap, max)) },
        'data-order': String(current.order),
        'data-longest': current.isLongest ? 'true' : null,
      })
    : null;
  return el('div.gap-strip', attrs, [bars, openBar]);
}

/** The bar whose centre is nearest a tap's x position, as its order. */
function nearestBar(strip, x) {
  let best = null;
  let bestDist = Infinity;
  for (const b of strip.querySelectorAll('[data-order]')) {
    const r = b.getBoundingClientRect();
    const d = Math.abs(r.left + r.width / 2 - x);
    if (d < bestDist) {
      bestDist = d;
      best = Number(b.dataset.order);
    }
  }
  return best;
}

/** The strip's accessible name: what it shows, in words. */
function stripSummary(entries, current, max) {
  const n = entries.length;
  const parts = [
    `Gap history, oldest to newest: ${n} show${n === 1 ? '' : 's'}, ${formatShowDateShort(entries[0].showdate)} to ${formatShowDateShort(entries[n - 1].showdate)}.`,
  ];
  const longestShows = entries.filter((e) => e.isLongest).map((e) => formatShowDateShort(e.showdate));
  const shows = (k) => `${k} show${k === 1 ? '' : 's'}`;
  if (current && current.isLongest) parts.push(`Longest gap ${shows(max)}, the gap still open.`);
  else if (longestShows.length) parts.push(`Longest gap ${shows(max)}, at ${listJoin(longestShows)}.`);
  if (current) parts.push(`Still open: ${shows(current.gap)} since ${formatShowDateShort(current.sinceDate)}.`);
  return parts.join(' ');
}

function listJoin(items) {
  if (items.length < 3) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * One show. The figure is the gap at that show; a debut carries the badge
 * instead of a number (Carton prints a position there, not a gap). Tap opens
 * the show; the trailing action opens that night's gap chart, where this song
 * carries the same figure.
 *
 * "Jam" (0.1.85) is green and PER SHOW, like the row: it is there when any of
 * the song's performances at that show is a jam chart entry -- `isJam`, from
 * gapHistory(). The row's left edge is the heat bar, so the tag carries the
 * fact alone here, and the row has no data-jam: on song detail's list that
 * attribute draws the green edge (app.css), which here would cover the bar.
 */
function showRow(e, max, navigate) {
  const heat = e.isDebut ? 0 : heatFor(e.gap, max);
  const meta = el('div.row-meta', null, [
    el('span.history-sets', { text: e.setLabels.join(', ') }),
    e.count > 1 ? el('span.badge', { text: `×${e.count}` }) : null,
    e.isJam ? el('span.badge.badge-jam', { text: 'Jam' }) : null,
    e.isLongest ? el('span.badge.badge-accent', { text: 'Longest' }) : null,
  ]);
  return el(
    'div.row-shell.history-row',
    {
      'data-order': String(e.order),
      'data-show-id': String(e.show_id),
      'data-debut': e.isDebut ? 'true' : null,
      'data-longest': e.isLongest ? 'true' : null,
    },
    [
      el('span.gap-bar', { style: { '--heat': String(heat) }, 'data-heat': e.isDebut || e.gap === null ? 'none' : null }),
      el(
        'button.row',
        { type: 'button', onclick: () => navigate(`#/show/${e.show_id}`) },
        [
          el('div.row-main', null, [
            el('div.row-title', { text: formatShowDate(e.showdate) }),
            venueLine(e.row),
            meta,
          ]),
        ],
      ),
      // Debut in the plain badge (0.1.85): it wore the yolk .badge-jam, and
      // green -- the class's colour now -- means jam chart only.
      e.isDebut
        ? el('div.gap-figure', null, [el('span.badge', { text: 'Debut' })])
        : el('div.gap-figure', null, [
            el('div.gap-num.num', { text: e.gap === null ? '—' : String(e.gap) }),
            el('div.gap-unit', { text: 'show gap' }),
          ]),
      el(
        'button.row-action',
        {
          type: 'button',
          'aria-label': `Gap chart for ${e.showdate}`,
          onclick: () => navigate(`#/gapchart/${e.show_id}`),
        },
        icon(ICONS.gap, 18),
      ),
    ],
  );
}

/**
 * The gap running now: shows since the last performance, still open. Not a
 * show, so not a control; an empty action column keeps its figure in line with
 * the rows below it.
 */
function nowRow(c, max) {
  const heat = heatFor(c.gap, max);
  return el(
    'div.row-shell.history-row',
    { 'data-order': String(c.order), 'data-now': 'true', 'data-longest': c.isLongest ? 'true' : null },
    [
      el('span.gap-bar', { style: { '--heat': String(heat) } }),
      el('div.row', null, [
        el('div.row-main', null, [
          el('div.row-title', { text: 'Now · still open' }),
          el('div.row-meta', null, [
            el('span', { text: `Last played ${formatShowDateShort(c.sinceDate)}` }),
            c.isLongest ? el('span.badge.badge-accent', { text: 'Longest' }) : null,
          ]),
        ]),
      ]),
      el('div.gap-figure', null, [
        el('div.gap-num.num', { text: String(c.gap) }),
        el('div.gap-unit', { text: 'shows since' }),
      ]),
      el('div.row-action', { 'aria-hidden': 'true' }),
    ],
  );
}
