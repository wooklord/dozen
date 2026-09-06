// SHOWS — the shows view, with search.
//
// Replaces the old Recent screen rather than sitting beside it. The empty-query
// landing state is exactly what Recent did: the most recent shows, newest
// first. Search and "load older" are the two ways past that.
//
// Everything here is filtering, grouping, counting and ordering.

// `icon` and `ICONS` were dropped when the row's gap chart action went: this
// file no longer renders a glyph. An unused import is not free -- it is the
// kind of leftover that makes the next reader look for a control that is not
// there.
import { el, append, debounce, openSheet } from '../ui/dom.js';
import {
  setlistBlock,
  setlistCard,
  cartonLink,
  showPermalink,
  attribution,
  sectionHead,
  emptyState,
  venueLine,
  venuePlace,
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

// Routes you can only reach FROM Shows, and therefore come back from rather
// than arrive at. Returning from one of these keeps the query; anything else --
// the tab bar, Home, a reload -- is a fresh entry and resets to the landing.
const RETURNS_FROM = /^#\/(show|venue)\//;

export function renderShows(ctx) {
  const { index, navigate, previousHash } = ctx;

  // THE TAB OPENS ON ITS LANDING STATE (0.1.75).
  //
  // `state` is module-level so the screen keeps its place, and that was doing
  // two different jobs with one variable. Keeping your place while you tap into
  // a show and step back is right. Keeping a year filter from twenty minutes
  // ago, so that opening the Shows tab lands you inside "2026" with the search
  // box pre-filled and a month bar you did not ask for, is not -- and it is why
  // the two-bar state read as the default state of this screen rather than as
  // a drill-down. Reaching for Shows means "show me shows".
  //
  // Split by WHERE YOU CAME FROM rather than by a timer or a flag the view sets
  // on the way out: the router knows the previous route, and "did I step back
  // out of a result" is exactly what it answers.
  if (!RETURNS_FROM.test(previousHash || '')) {
    state.query = '';
    state.limit = PAGE;
  }

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
              showVenue ? venueLine(show) : null,
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
        // NO GAP CHART ACTION HERE. A search result row is an entry point to a
        // show, and the gap chart lives on show detail one tap further in --
        // the same reasoning that took the gap chart button off the Home and
        // Shows cards. A second control on a row makes the row itself read as
        // two decisions when there is only one.
        //
        // Four entry points remain and all of them are places you have already
        // committed to a show: show detail, the Shows search rows, the song
        // performance rows, and the venue show rows. scripts/smoke.mjs walks
        // every one.
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

  /**
   * The LANDING bar: every year in the archive. Drilling into one replaces this
   * bar rather than stacking a second one under it -- see periodBar.
   *
   * SHOWS HAS HAD FOUR ARRANGEMENTS AND THIS IS THE FOURTH. Before 0.1.62 both
   * bars were sticky at the same 52px offset and overlapped on scroll, because
   * .sortbar-secondary was a dead rule. Making it apply left both bars
   * secondary, so NEITHER pinned and the year switcher scrolled away inside a
   * long year. 0.1.64 pinned the year bar and left the month bar secondary --
   * coherent, and still two horizontal scrollers stacked under a sticky header,
   * styled identically, with one label between them and different scroll
   * behaviour that only showed itself 330px down. As of 0.1.75 there is exactly
   * ONE bar in every state, so none of that can be true again.
   */
  function yearBar(activeYear = null) {
    let activeChip = null;
    const bar = el('div.sortbar', null, [
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
   * Every year in the archive at once, in a sheet.
   *
   * A 15-chip horizontal scroller shows FIVE of them in 390px and gives no hint
   * that the other ten exist -- measured, not estimated: 993px of chips in a
   * 390px bar. That is the part of the old design that read as broken. A grid
   * has no hidden state: every year is on screen, and the one you are in is
   * painted with the same selected treatment every other chip bar uses.
   *
   * "All shows" leads, so the way out of a drill-down is the first thing here
   * and not something you have to know to clear the search box for.
   */
  function openYearSheet(activeYear = null) {
    openSheet('Browse by year', (close) => {
      const grid = el('div.year-grid', null, [
        el(
          'button.chip.year-all',
          {
            type: 'button',
            'aria-pressed': String(!activeYear),
            onclick: () => { close(); browseTo(''); },
          },
          'All shows',
        ),
        ...archiveYears().map((y) =>
          el(
            'button.chip',
            {
              type: 'button',
              'aria-pressed': String(activeYear === y),
              onclick: () => { close(); browseTo(String(y)); },
            },
            String(y),
          ),
        ),
      ]);
      return grid;
    });
  }

  /**
   * Inside a year: the SAME single bar, now holding that year's months.
   *
   * `aria-pressed` is what DRAWS the selection -- `.chip[aria-pressed="true"]`
   * in app.css is the only rule that paints a chip as chosen. This bar shipped
   * without the attribute: the filter applied correctly and the chip that
   * applied it looked untouched, so the control disagreed with the screen it
   * had just changed.
   *
   * THE BACK CHIP IS ALWAYS RENDERED, INCLUDING WHEN THERE ARE NO MONTHS. A
   * year with no shows still parses as kind 'year', and a bar built only from
   * months would be empty -- leaving the reader inside a filter with no control
   * on screen to leave it by. The way out cannot be conditional on there being
   * anything to browse.
   *
   * It carries the year rather than the word "Back", so the bar still states
   * its own state, which is the property every other chip bar in this app has.
   * The chevron is what makes it a way OUT and not merely a label; tapping it
   * opens the year sheet, whose first row is "All shows".
   *
   * IT SITS OUTSIDE THE SCROLLER. The bar is ~764px wide in a 390px viewport,
   * so a back chip inside it scrolls away and the way out goes with it. The
   * first attempt made it `position: sticky` and that half-worked: it stayed
   * put, but the months then slid UNDER it and rendered as clipped half-pills
   * against its edge, which reads as a rendering fault rather than as scrolling.
   * Splitting the bar -- fixed chip, scrolling months beside it -- makes the
   * overlap impossible instead of tidying it up.
   */
  function periodBar(year, activeMonth = null) {
    const months = [...new Set(
      index.shows
        .filter((s) => Number(String(s.showdate).slice(0, 4)) === year)
        .map((s) => Number(String(s.showdate).slice(5, 7))),
    )].sort((a, b) => a - b);

    let activeChip = null;
    const back = el(
      'button.chip.chip-back',
      {
        type: 'button',
        'aria-label': `Browsing ${year}. Choose a different year, or all shows`,
        onclick: () => openYearSheet(year),
      },
      `\u2039 ${year}`,
    );

    const bar = el('div.sortbar.sortbar-lead', null, [
      back,
      el(
        'div.sortbar-scroll',
        null,
        months.map((m) => {
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
        }),
      ),
    ]);

    // Twelve months overflow the 312px left beside the back chip, so the
    // selected month can repaint off-screen exactly as the selected year could.
    // Same treatment, same reason -- see yearBar. This scrolls .sortbar-scroll
    // rather than the bar itself now, which is what `inline: 'nearest'` acts on.
    if (activeChip) {
      queueMicrotask(() => activeChip.scrollIntoView({ inline: 'nearest', block: 'nearest' }));
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

    // Drilling in REPLACES the bar, it does not stack a second one under it.
    // The label changes with it, so the heading always names what the row below
    // it contains -- "Browse by year" over years, "Browse by month" over months.
    if (parsed?.kind === 'year' || parsed?.kind === 'month') {
      append(results, el('h2.section-title', { text: 'Browse by month' }));
      append(results, periodBar(parsed.year, parsed.kind === 'month' ? parsed.month : null));
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

        // venuePlace(), not hand-built .venue-line markup: the name is already
        // the row title, so only the place goes on this line, but it is still
        // venue text and has to move with the helper. The match-reason badge
        // is appended here rather than built into the helper -- it is this
        // screen's concern, not the venue line's.
        const placeLine = venuePlace(venue);
        if (reason) {
          append(placeLine, el('span.badge', { style: { marginLeft: '6px' }, text: reason }));
        }

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
                    placeLine,
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
                venueLine(show),
              ]),
              rows.length
                ? el('span.badge.badge-set', { text: showStructure(index, show.show_id) || '' })
                : el('span.badge', { text: 'No setlist recorded' }),
            ],
          ),
          showId: show.show_id,
          navigate,
          // Home used to put its own in the section head; as of 0.1.74 that
          // head is generic ("Previous shows") and the link, which belongs to
          // one show rather than to the section, sits here too. So this is now
          // the convention rather than the exception it was written as.
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
