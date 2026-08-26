// SHOWS — the shows view, with search.
//
// Replaces the old Recent screen rather than sitting beside it. The empty-query
// landing state is exactly what Recent did: the most recent shows, newest
// first. Search and "load older" are the two ways past that.
//
// Everything here is filtering, grouping, counting and ordering.

import { el, append, debounce, icon, ICONS } from '../ui/dom.js';
import {
  setlistBlock,
  setlistCard,
  cartonLink,
  showPermalink,
  attribution,
  sectionHead,
  emptyState,
  venueLine,
} from '../ui/components.js';
import { showStructure, compareVenuesByName } from '../data/index.js';
import { formatShowDate, formatShowDateShort } from '../util/dates.js';
import { parseDateQuery, matchShowsByDate, matchVenues, matchReasonLabel } from '../util/search.js';

const PAGE = 15;

// Full month names, matching what parseDateQuery accepts. The query built from
// these has to be a string the search grammar already parses -- that is the
// whole point of routing the drill-down through it.
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Module-level so the screen keeps its place across navigation.
const state = {
  query: '',
  limit: PAGE,
};

export function renderShows(ctx) {
  const { index, navigate } = ctx;
  const screen = el('div.screen');

  append(screen, el('h1.screen-title', { text: 'Shows' }));
  append(
    screen,
    el('p.screen-sub', {
      text: `${index.counts.shows} shows in the archive. Search a venue, city, state or date.`,
    }),
  );

  const search = el('input.search', {
    type: 'search',
    placeholder: 'Venue, city, or date (8/7/26, august 2026, 2019)…',
    value: state.query,
    autocomplete: 'off',
    autocorrect: 'off',
    autocapitalize: 'none',
    spellcheck: 'false',
    oninput: debounce((e) => {
      state.query = e.target.value;
      state.limit = PAGE; // a new query starts from the top
      paint();
    }, 140),
  });
  append(screen, el('div', { style: { marginBottom: '12px' } }, search));

  const results = el('div');
  append(screen, results);
  append(screen, attribution());

  // ---------------------------------------------------------------- helpers --

  /** Section header carrying its own count, so a capped list is never silent. */
  function countedHead(title, shown, total) {
    const label = shown < total ? `${title} (${shown} of ${total})` : `${title} (${total})`;
    return el('h2.section-title', { text: label });
  }

  function showRow(show, { showVenue = true } = {}) {
    const hasSetlist = index.setlistByShow.has(Number(show.show_id));
    const structure = hasSetlist ? showStructure(index, show.show_id) : null;
    const upcoming = show.showdate > index.today;

    return el('li', null, [
      el('div.row-shell', null, [
        el(
          'button.row',
          { type: 'button', onclick: () => navigate(`#/show/${show.show_id}`) },
          [
            el('div.row-main', null, [
              el('div.row-title', { text: formatShowDate(show.showdate) }),
              showVenue ? venueLine(show, { small: true }) : null,
            ]),
            // Format is shown only where setlist data establishes it. Upcoming
            // shows assert nothing; played shows with no setlist say so.
            structure
              ? el('span.badge.badge-set', { text: structure })
              : el('span.badge', {
                  text: upcoming ? 'Upcoming' : 'No setlist recorded',
                }),
          ],
        ),
        hasSetlist
          ? el(
              'button.row-action',
              {
                type: 'button',
                'aria-label': `Gap chart for ${show.showdate}`,
                onclick: () => navigate(`#/gapchart/${show.show_id}`),
              },
              icon(ICONS.gap, 18),
            )
          : null,
      ]),
    ]);
  }

  // ------------------------------------------------------------------ paint --

  /**
   * Browse by period, ROUTED THROUGH THE SEARCH PATH.
   *
   * A year chip sets the query to a bare year and repaints; a month chip sets
   * it to "August 2019". Both are shapes `parseDateQuery` already understands
   * (kind 'year' and kind 'month'), so this adds an affordance, not a second
   * implementation of "which shows are in 2019". If date matching changes,
   * this changes with it, because it IS that code.
   *
   * The input is kept in sync so the screen never shows chips and a search box
   * that disagree, and so clearing the box is an obvious way back.
   */
  function browseTo(query) {
    state.query = query;
    state.limit = PAGE;
    search.value = query;
    paint();
    results.scrollIntoView({ block: 'start' });
  }

  /** Years that actually have shows, newest first. Derived, never hardcoded. */
  function archiveYears() {
    return [...new Set(index.shows.map((s) => Number(String(s.showdate).slice(0, 4))))]
      .filter((y) => y >= 1900 && y <= 2999)
      .sort((a, b) => b - a);
  }

  function yearBar(activeYear = null) {
    let activeChip = null;
    const bar = el('div.sortbar.sortbar-secondary', null, [
      // Backs out of a drill-down without clearing the field by hand, AND
      // carries the unfiltered state. It used to render only during a
      // drill-down, so the landing bar had no pressed chip at all and the
      // control said nothing about what it was showing. Rendering it always,
      // pressed when no year is active, gives this bar the same property every
      // other chip bar in the app has: the current state is visible in the bar.
      el(
        'button.chip',
        {
          type: 'button',
          'aria-pressed': String(!activeYear),
          onclick: () => browseTo(''),
        },
        'All shows',
      ),
      ...archiveYears().map((y) => {
        const chip = el(
          'button.chip',
          {
            type: 'button',
            'aria-pressed': String(activeYear === y),
            onclick: () => browseTo(String(y)),
          },
          String(y),
        );
        if (activeYear === y) activeChip = chip;
        return chip;
      }),
    ]);

    // The bar scrolls horizontally and holds fourteen years, so the selected
    // one is usually off-screen after a repaint -- you tap 2019 and the bar
    // still reads 2026, 2025, 2024. Bring it into view so the control shows
    // its own state. `block: 'nearest'` so this never scrolls the page.
    if (activeChip) {
      queueMicrotask(() => activeChip.scrollIntoView({ inline: 'center', block: 'nearest' }));
    }
    return bar;
  }

  /**
   * Months that have shows in this year, in calendar order.
   *
   * `aria-pressed` is what DRAWS the selection -- `.chip[aria-pressed="true"]`
   * in app.css is the only rule that paints a chip as chosen. This bar shipped
   * without the attribute: the filter applied correctly and the chip that
   * applied it looked untouched, so the control disagreed with the screen it
   * had just changed. Every other chip bar in the app -- Songs sort, Songs
   * filter, Jams sort, the year bar above -- sets it; this one was the only
   * omission, which is why nothing else looked wrong.
   */
  function monthBar(year, activeMonth = null) {
    const months = [...new Set(
      index.shows
        .filter((s) => Number(String(s.showdate).slice(0, 4)) === year)
        .map((s) => Number(String(s.showdate).slice(5, 7))),
    )].sort((a, b) => a - b);
    if (!months.length) return null;

    let activeChip = null;
    const bar = el('div.sortbar.sortbar-secondary', null, months.map((m) => {
      const chip = el(
        'button.chip',
        {
          type: 'button',
          'aria-pressed': String(activeMonth === m),
          onclick: () => browseTo(`${MONTH_NAMES[m - 1]} ${year}`),
        },
        MONTH_NAMES[m - 1].slice(0, 3),
      );
      if (activeMonth === m) activeChip = chip;
      return chip;
    }));

    // Twelve chips overflow a 390px bar, so the selected month can repaint
    // off-screen exactly as the selected year could. Same treatment, same
    // reason -- see yearBar.
    if (activeChip) {
      queueMicrotask(() => activeChip.scrollIntoView({ inline: 'center', block: 'nearest' }));
    }
    return bar;
  }

  function paint() {
    results.replaceChildren();
    const q = state.query.trim();

    if (!q) {
      append(results, el('h2.section-title', { text: 'Browse by year' }));
      append(results, yearBar());
      paintRecent();
      return;
    }

    const parsed = parseDateQuery(q);

    // Drilling in: a year shows its months, a month keeps the year bar so you
    // can step sideways without going back to the top.
    if (parsed?.kind === 'year' || parsed?.kind === 'month') {
      append(results, el('h2.section-title', { text: 'Browse by year' }));
      append(results, yearBar(parsed.year));
      const months = monthBar(parsed.year, parsed.kind === 'month' ? parsed.month : null);
      if (months) append(results, months);
    }
    const dateHits = parsed ? matchShowsByDate(index.shows, parsed, index.today) : [];
    const venueHits = matchVenues(index.venues, q).sort((a, b) =>
      compareVenuesByName(a.venue, b.venue),
    );

    if (!dateHits.length && !venueHits.length) {
      append(
        results,
        emptyState(
          parsed
            ? `No shows on ${parsed.label}.`
            : `Nothing matching “${q}”. Try a venue, city, state, or a date like 8/7/26.`,
        ),
      );
      return;
    }

    // Both matchers always run, and each reports its own count, so a query
    // that hits both (like "Portland") can never silently prefer one.
    if (dateHits.length) {
      const section = el('div.section');
      append(section, countedHead('Shows', dateHits.length, dateHits.length));
      if (parsed.kind === 'monthday' && dateHits.length > 1) {
        append(
          section,
          el('p.note', {
            style: { margin: '0 0 8px' },
            text: `${parsed.label} matches ${dateHits.length} shows across different years, nearest first.`,
          }),
        );
      }
      const list = el('ul.rows');
      for (const s of dateHits) append(list, showRow(s));
      append(section, list);
      append(results, section);
    }

    if (venueHits.length) {
      const section = el('div.section');
      append(section, countedHead('Venues', venueHits.length, venueHits.length));
      const list = el('ul.rows');
      for (const { venue, reasons } of venueHits) {
        const shows = (index.showsByVenue.get(Number(venue.venue_id)) || []);
        const played = shows.filter((s) => s.showdate <= index.today);
        const reason = matchReasonLabel(reasons);
        append(
          list,
          el('li', null, [
            el('div.row-shell', null, [
              el(
                'button.row',
                { type: 'button', onclick: () => navigate(`#/venue/${venue.venue_id}`) },
                [
                  el('div.row-main', null, [
                    el('div.row-title', { text: venue.venuename }),
                    el('div.venue-line.venue-line-sm', null, [
                      el('span.place', { text: [venue.city, venue.state].filter(Boolean).join(', ') }),
                      reason ? el('span.badge', { style: { marginLeft: '6px' }, text: reason }) : null,
                    ]),
                  ]),
                  el('div.gap-figure', null, [
                    el('div.gap-num.num', { text: String(played.length) }),
                    el('div.gap-unit', { text: played.length === 1 ? 'show' : 'shows' }),
                  ]),
                ],
              ),
            ]),
          ]),
        );
      }
      append(section, list);
      append(results, section);
    }
  }

  /**
   * Empty-query landing: the full recent-setlists view, unchanged.
   *
   * These are rendered as full cards WITH their setlists, not as compact rows.
   * Seeing what has been burned recently without tapping through is the whole
   * point of this screen -- collapsing it to a list would be a regression.
   */
  function paintRecent() {
    // Newest first, upcoming shows excluded.
    const played = index.shows.filter((s) => s.showdate <= index.today);
    const ordered = played.slice().reverse();
    const shown = ordered.slice(0, state.limit);

    const section = el('div.section');
    append(section, countedHead('Recent shows', shown.length, ordered.length));

    for (const show of shown) {
      const rows = index.setlistByShow.get(Number(show.show_id)) || [];
      append(
        section,
        setlistCard({
          style: { marginBottom: '12px' },
          index,
          rows,
          onSong: (id) => navigate(`#/song/${id}`),
          head: el(
            'div',
            { style: { display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'baseline' } },
            [
              el('div', { style: { minWidth: '0' } }, [
                el('div', { style: { fontWeight: '650' }, text: formatShowDate(show.showdate) }),
                venueLine(show, { small: true }),
              ]),
              rows.length
                ? el('span.badge.badge-set', { text: showStructure(index, show.show_id) || '' })
                : el('span.badge', { text: 'No setlist recorded' }),
            ],
          ),
          showId: show.show_id,
          navigate,
          // The Carton link is genuinely specific to this screen -- Home puts
          // its own in the section head instead.
          extraActions: [cartonLink(showPermalink(show), 'Carton')],
        }),
      );
    }

    if (shown.length < ordered.length) {
      const remaining = ordered.length - shown.length;
      append(
        section,
        el(
          'button.btn.btn-block',
          {
            type: 'button',
            style: { marginTop: '12px' },
            onclick: () => {
              state.limit += PAGE;
              paint();
            },
          },
          `Load ${Math.min(PAGE, remaining)} older`,
        ),
      );
    }
    append(results, section);
  }

  paint();
  return screen;
}
