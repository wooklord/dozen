// SHOWS — every show played, newest first, under three controls (0.1.82).
//
// WHEN, FILTER and VIEW are three lead chips on one row, the Songs-tab pattern
// (docs/plan.md, "0.1.82 design"). When is all shows, a year, or a month -- the
// 0.1.75 year-then-month drill-down, relocated into one sheet. Filter is three
// groups that AND: how many sets, whether there was an encore, and the venue's
// state. View is Compact (one row per show) or Detail (the full setlist card),
// and the view sticks in localStorage; When and Filter are session state, like
// Songs' sort. The search box narrows whatever When has picked.
//
// Everything here is filtering, grouping, counting and ordering. Set count,
// encore presence and state are Carton fields or counts over Carton rows;
// nothing is inferred, and no row is labelled with what will happen next.

import { el, append, debounce, openSheet } from '../ui/dom.js';
import {
  setlistCard,
  cartonLink,
  showPermalink,
  attribution,
  emptyState,
  venueLine,
  venuePlace,
} from '../ui/components.js';
import {
  showStructure,
  compareVenuesByName,
  setSummary,
  setBadgeText,
  filterShows,
  venueStates,
  SETS_OPTIONS,
  ENCORE_OPTIONS,
} from '../data/index.js';
import { formatShowDate } from '../util/dates.js';
import { parseDateQuery, matchShowsByDate, matchVenues, matchReasonLabel } from '../util/search.js';

// Detail view pages its cards; compact rows render all at once -- a row is a
// date, a venue line and a badge, and 795 of them are cheaper than one cold
// pull.
const PAGE = 15;

const VIEW_KEY = 'dozen.showsView.v1';
const VIEWS = {
  compact: {
    label: 'Compact',
    description: 'One row per show: date, venue, and how many sets. Tap a row for the setlist.',
  },
  detail: {
    label: 'Detail',
    description: 'The full setlist card for every show, with Carton’s notation and footnotes.',
  },
};

function readView() {
  try {
    return localStorage.getItem(VIEW_KEY) === 'detail' ? 'detail' : 'compact';
  } catch {
    return 'compact';
  }
}
function writeView(view) {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    /* a view that does not stick is still a view */
  }
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));

// The Filter sheet's words, used in three places that must agree: the group
// chips, the pills under the bar, and the count line (docs/plan.md, (g)).
const SETS_WORDS = { 1: '1 set', 2: '2 sets', '3+': '3+ sets' };
const ENCORE_WORDS = { with: 'with encore', without: 'without encore' };
const EMPTY_FILTERS = () => ({ sets: null, encore: null, state: null });

// Module-level so the screen keeps its place across navigation. `view` is the
// one piece that also survives a reload.
const state = {
  when: null, // null | { year } | { year, month }
  filters: EMPTY_FILTERS(),
  view: readView(),
  query: '',
  limit: PAGE,
};

// Routes you can only reach FROM Shows, and therefore come back from rather
// than arrive at. Returning from one of these keeps When, Filter and the
// query; anything else -- the tab bar, Home, a reload -- is a fresh entry and
// resets to the landing (0.1.75: the tab opens on its landing state). The
// view is not reset: it is a preference, not a place.
const RETURNS_FROM = /^#\/(show|venue)\//;

export function renderShows(ctx) {
  const { index, navigate, previousHash } = ctx;

  if (!RETURNS_FROM.test(previousHash || '')) {
    state.when = null;
    state.filters = EMPTY_FILTERS();
    state.query = '';
    state.limit = PAGE;
  }

  const screen = el('div.screen');

  append(screen, el('h1.screen-title', { text: 'Shows' }));
  append(
    screen,
    // Played and upcoming, from the live counts, so this line and the count line
    // under the bar agree (plan.md 0.1.82 (g), amended). The "·" after "played"
    // is part of the route marker in scripts/routes.mjs: "shows played" alone
    // also renders on Songs, song detail, Venue and Home.
    el('p.screen-sub', {
      text: `${index.counts.playedShows} shows played · ${index.futureShows.length} upcoming. Search a venue, city, state or date.`,
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
  append(screen, el('div', { style: { marginBottom: '10px' } }, search));

  // --- When / Filter / View: three lead chips on ONE row ---------------------
  //
  // The 0.1.81 pattern: each chip opens a sheet; the value wears the lead ink;
  // nothing ellipsizes, and when the trio does not fit a value WRAPS inside a
  // taller chip (app.css, .sortbar-leads-3). The WHEN CHIP CARRIES NO INNER
  // LABEL, measured rather than decided (docs/plan.md, 0.1.82 (a), amended):
  // three labelled chips are 365px of content in a 360px bar, which is the
  // 0.1.75 off-screen-option defect. A year or a month is self-labelling. The
  // Filter value "N on" is one token -- a non-breaking space -- so it never
  // splits into "3" over "on" when the grid shares the shortfall out.
  //
  // `data-lead` names each chip for what it is, so a check can find the When
  // chip without a label to read.
  function leadChip(name, label, onclick) {
    const value = el('span.chip-value');
    const chip = el(
      'button.chip.chip-lead',
      { type: 'button', 'data-lead': name, onclick },
      [label ? el('span.chip-label', { text: label }) : null, value, el('span.chip-caret', { text: '▾', 'aria-hidden': 'true' })],
    );
    return { chip, value };
  }
  const whenLead = leadChip('when', null, () => openWhenSheet());
  const filterLead = leadChip('filter', 'Filter', () => openFilterSheet());
  const viewLead = leadChip('view', 'View', () => openViewSheet());

  const whenLabel = () =>
    !state.when ? 'All' : state.when.month ? `${MONTH_SHORT[state.when.month - 1]} ${state.when.year}` : String(state.when.year);
  const activeFilters = () => Object.entries(state.filters).filter(([, v]) => v !== null);
  const filterLabel = () => {
    const n = activeFilters().length;
    return n ? `${n} on` : 'Off';
  };

  // The accessible name starts with the visible text so a voice user can say
  // what they see, then says what a tap does.
  function paintLeads() {
    whenLead.value.textContent = whenLabel();
    whenLead.chip.setAttribute('aria-label', `When ${whenLabel()}. Change when`);
    filterLead.value.textContent = filterLabel();
    filterLead.chip.setAttribute('aria-label', `Filter ${filterLabel().replace(' ', ' ')}. Change filter`);
    viewLead.value.textContent = VIEWS[state.view].label;
    viewLead.chip.setAttribute('aria-label', `View ${VIEWS[state.view].label}. Change view`);
  }
  paintLeads();

  append(
    screen,
    el('div.sortbar.sortbar-lead.sortbar-leads.sortbar-leads-3', null, [whenLead.chip, filterLead.chip, viewLead.chip]),
  );

  // Active filters as removable pills under the bar. Each pill is one group's
  // choice in the group's own words, and tapping it clears that group only.
  const pills = el('div.filter-pills');
  append(screen, pills);

  const countLine = el('p.note', { style: { margin: '4px 0 8px' } });
  append(screen, countLine);

  const results = el('div');
  append(screen, results);
  append(screen, attribution());

  // ---------------------------------------------------------------- helpers --

  /** Section header carrying its own count, so a capped list is never silent. */
  function countedHead(title, shown, total) {
    const label = shown < total ? `${title} (${shown} of ${total})` : `${title} (${total})`;
    return el('h2.section-title', { text: label });
  }

  /** Years that actually have shows, newest first. Derived, never hardcoded. */
  function archiveYears() {
    return [...new Set(index.playedShows.map((s) => Number(String(s.showdate).slice(0, 4))))]
      .filter((y) => y >= 1900 && y <= 2999)
      .sort((a, b) => b - a);
  }
  /** Months of one year that have shows, ascending. */
  function monthsOf(year) {
    return [...new Set(
      index.playedShows
        .filter((s) => Number(String(s.showdate).slice(0, 4)) === year)
        .map((s) => Number(String(s.showdate).slice(5, 7))),
    )].sort((a, b) => a - b);
  }

  /** Every show played, newest first, narrowed to what When has picked. */
  function whenShows() {
    let shows = index.playedShows;
    if (state.when) {
      const prefix = state.when.month
        ? `${state.when.year}-${String(state.when.month).padStart(2, '0')}-`
        : `${state.when.year}-`;
      shows = shows.filter((s) => String(s.showdate).startsWith(prefix));
    }
    return shows.slice().reverse();
  }

  /**
   * The list the screen shows: When, then Filter, then the search box. The
   * search narrows -- a typed date through the same parser a typed "2019" has
   * always used, venue text through the venue matcher -- and never widens.
   * Returned with the venue hits so the Venues section can render beside it.
   */
  function visible(filters = state.filters) {
    let shows = filterShows(whenShows(), filters, index);
    const q = state.query.trim();
    const parsed = q ? parseDateQuery(q) : null;
    const venueHits = q
      ? matchVenues(index.venues, q).sort((a, b) => compareVenuesByName(a.venue, b.venue))
      : [];
    if (parsed) {
      shows = matchShowsByDate(shows, parsed, index.today);
    } else if (q) {
      const ids = new Set(venueHits.map((h) => Number(h.venue.venue_id)));
      shows = shows.filter((s) => ids.has(Number(s.venue_id)));
    }
    return { shows, venueHits, parsed, q };
  }

  /**
   * One compact row: the date, `venue · city, ST`, and how many sets. The
   * badge is words ("2 sets + E", "No setlist") rather than the card badge's
   * S1+S2+E, because the row has a full width to spend and the count is the
   * fact the Sets filter is about. Only played shows reach this list, so there
   * is no "Upcoming" branch to get wrong.
   */
  function compactRow(show) {
    return el('li', null, [
      el('div.row-shell', null, [
        el(
          'button.row.show-row',
          { type: 'button', onclick: () => navigate(`#/show/${show.show_id}`) },
          [
            el('div.row-main', null, [
              el('div.row-title', { text: formatShowDate(show.showdate) }),
              venueLine(show),
            ]),
            el('span.badge.badge-sets', { text: setBadgeText(setSummary(index, show.show_id)) }),
          ],
        ),
      ]),
    ]);
  }

  /** The full setlist card for one show -- the 0.1.75 landing card, unchanged. */
  function detailCard(show) {
    const rows = index.setlistByShow.get(Number(show.show_id)) || [];
    return setlistCard({
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
      // The Carton link belongs to one show rather than to the section, so it
      // sits on the card (the convention since 0.1.74).
      extraActions: [cartonLink(showPermalink(show), 'Carton')],
    });
  }

  /** The words for one active filter, shared by the pills and the count line. */
  function filterWords([key, value]) {
    if (key === 'sets') return SETS_WORDS[value];
    if (key === 'encore') return ENCORE_WORDS[value];
    return `in ${value}`;
  }

  function paintPills() {
    pills.replaceChildren();
    for (const entry of activeFilters()) {
      const [key] = entry;
      const words = filterWords(entry);
      append(
        pills,
        el(
          'button.chip.filter-pill',
          {
            type: 'button',
            'aria-label': `Remove the filter ${words}`,
            onclick: () => {
              state.filters[key] = null;
              state.limit = PAGE; // a changed filter starts Detail from the top, as apply does
              paintLeads();
              paint();
            },
          },
          [el('span', { text: words }), el('span.pill-remove', { text: '✕', 'aria-hidden': 'true' })],
        ),
      );
    }
    pills.hidden = !pills.childElementCount;
  }

  // ------------------------------------------------------------------ paint --

  function paint() {
    results.replaceChildren();
    paintPills();
    const { shows, venueHits, parsed, q } = visible();

    // The count line says what the list IS: the count, each active filter in
    // its own words in group order, the query if any, and the order. A
    // month+day search is nearest-first (util/search.js), and says so.
    const n = shows.length;
    const parts = [`${n} show${n === 1 ? '' : 's'}`, ...activeFilters().map(filterWords)];
    if (q) parts.push(`matching “${q}”`);
    parts.push(parsed && parsed.kind === 'monthday' ? 'nearest first' : 'newest first');
    countLine.textContent = parts.join(' · ');

    if (!shows.length && !venueHits.length) {
      append(
        results,
        emptyState(
          parsed
            ? `No shows on ${parsed.label}${state.when || activeFilters().length ? ' under this When and Filter' : ''}.`
            : q
              ? `Nothing matching “${q}”. Try a venue, city, state, or a date like 8/7/26.`
              : 'No shows match this When and Filter.',
        ),
      );
      return;
    }

    if (shows.length) {
      if (state.view === 'compact') {
        const list = el('ul.rows');
        for (const s of shows) append(list, compactRow(s));
        append(results, el('div.section', null, list));
      } else {
        const section = el('div.section');
        const shown = shows.slice(0, state.limit);
        for (const s of shown) append(section, detailCard(s));
        if (shown.length < shows.length) {
          const remaining = shows.length - shown.length;
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
    }

    if (venueHits.length) {
      const section = el('div.section');
      append(section, countedHead('Venues', venueHits.length, venueHits.length));
      const list = el('ul.rows');
      for (const { venue, reasons } of venueHits) {
        const played = (index.showsByVenue.get(Number(venue.venue_id)) || []).filter((s) => s.showdate <= index.today);
        const reason = matchReasonLabel(reasons);

        // venuePlace(), not hand-built .venue-line markup: the name is already
        // the row title, so only the place goes on this line, but it is still
        // venue text and has to move with the helper.
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
                  el('div.row-main', null, [el('div.row-title', { text: venue.venuename }), placeLine]),
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

  // ----------------------------------------------------------------- sheets --

  // One full-width row per option: the name, then its one-line description
  // (0.1.81). aria-pressed is honest here: one of a set, exactly one on.
  function optionRow(label, description, pressed, onclick) {
    return el(
      'button.sheet-item.sheet-option',
      { type: 'button', 'aria-pressed': String(pressed), onclick },
      [el('div.sheet-option-name', { text: label }), description ? el('div.sheet-option-desc', { text: description }) : null],
    );
  }

  /**
   * WHEN: "All shows" on top, then every year at once in a grid (the 0.1.75
   * sheet, which replaced a scroller that showed five of fifteen), then the
   * months of the picked year. Picking a year keeps the sheet open and shows
   * its months, with the list behind already narrowed; picking a month, or
   * "All shows", closes. The sheet re-renders its own body in place so the
   * month row appears the moment a year is pressed.
   */
  function openWhenSheet() {
    openSheet('When', (close) => {
      const body = el('div');
      const choose = (when, andClose) => {
        state.when = when;
        state.limit = PAGE;
        paintLeads();
        paint();
        if (andClose) close();
        else render();
      };
      const render = () => {
        const year = state.when ? state.when.year : null;
        const month = state.when ? state.when.month || null : null;
        body.replaceChildren(
          el('div.sheet-options', { role: 'group', 'aria-label': 'When options' }, [
            optionRow('All shows', 'Every show played, newest first.', !state.when, () => choose(null, true)),
          ]),
          el('h3.sheet-group-title', { text: 'Year' }),
          el(
            'div.chip-grid',
            { role: 'group', 'aria-label': 'Year' },
            archiveYears().map((y) =>
              el(
                'button.chip',
                { type: 'button', 'aria-pressed': String(year === y), onclick: () => choose({ year: y }, false) },
                String(y),
              ),
            ),
          ),
          year
            ? el('h3.sheet-group-title', { text: `Month in ${year}` })
            : null,
          year
            ? el(
                'div.chip-grid.month-grid',
                { role: 'group', 'aria-label': `Month in ${year}` },
                monthsOf(year).map((m) =>
                  el(
                    'button.chip',
                    {
                      type: 'button',
                      'aria-pressed': String(month === m),
                      onclick: () => choose({ year, month: m }, true),
                    },
                    MONTH_SHORT[m - 1],
                  ),
                ),
              )
            : null,
        );
      };
      render();
      return body;
    });
  }

  /**
   * FILTER: three groups, one choice each, "Any" is off, the groups AND. The
   * choices are a DRAFT until "Show N shows" applies them, so the count on the
   * button can be read before the list changes under the sheet; "Clear all"
   * resets every group. Descriptions locked in docs/plan.md ("0.1.82 design",
   * (d)).
   */
  function openFilterSheet() {
    openSheet('Filter', (close) => {
      const draft = { ...state.filters };
      const body = el('div');

      const chips = (name, options, selected, onPick) =>
        el(
          'div.sheet-choices',
          { role: 'group', 'aria-label': name },
          [['any', 'Any'], ...options].map(([key, label]) =>
            el(
              'button.chip',
              {
                type: 'button',
                'aria-pressed': String((selected ?? 'any') === key),
                onclick: () => onPick(key === 'any' ? null : key),
              },
              label,
            ),
          ),
        );

      const group = (title, description, control) =>
        el('div', null, [
          el('h3.sheet-group-title', { text: title }),
          el('p.sheet-group-desc', { text: description }),
          control,
        ]);

      const render = () => {
        const count = visible(draft).shows.length;
        body.replaceChildren(
          group(
            'Sets',
            'Sets counted from the setlist, encore not included. Shows with no setlist recorded are left out when this is set.',
            chips('Sets', SETS_OPTIONS.map((k) => [k, k]), draft.sets, (v) => { draft.sets = v; render(); }),
          ),
          group(
            'Encore',
            'Whether the setlist has an encore set.',
            chips('Encore', ENCORE_OPTIONS.map((k) => [k, k === 'with' ? 'With' : 'Without']), draft.encore, (v) => { draft.encore = v; render(); }),
          ),
          group(
            `State · ${draft.state || 'Any'}`,
            'Scroll the wheel. States and provinces come from the venue list; only ones Eggy has played appear.',
            wheel(['Any', ...venueStates(index)], draft.state || 'Any', (v) => {
              draft.state = v === 'Any' ? null : v;
              // Only the title and the count move; re-rendering the wheel
              // mid-scroll would fight the scroll that just happened. The
              // state group is the third title, by position in this body.
              body.querySelectorAll('.sheet-group-title')[2].textContent = `State · ${draft.state || 'Any'}`;
              paintApply(visible(draft).shows.length);
            }),
          ),
          el('div.sheet-actions', null, [
            apply,
            el(
              'button.btn',
              {
                type: 'button',
                onclick: () => {
                  draft.sets = draft.encore = draft.state = null;
                  render();
                },
              },
              'Clear all',
            ),
          ]),
        );
        paintApply(count);
      };
      // "Show N shows" pluralises, and at zero the button reads "No shows match"
      // and is disabled: the lock in plan.md (d) was the form, not the grammar
      // (amended 2026-10-25). Nothing is applied from a button that says no.
      const paintApply = (n) => {
        apply.textContent = n === 0 ? 'No shows match' : `Show ${n} show${n === 1 ? '' : 's'}`;
        apply.disabled = n === 0;
      };
      const apply = el(
        'button.btn.btn-block',
        {
          type: 'button',
          onclick: () => {
            state.filters = { ...draft };
            state.limit = PAGE;
            close();
            paintLeads();
            paint();
          },
        },
      );
      render();
      return body;
    });
  }

  /**
   * The state wheel: a scroll-snap listbox with a highlighted centre row.
   *
   * NOT a native <select>: on Android that opens a system dropdown that cannot
   * be styled and is not a wheel. Five rows are visible; the one in the band
   * is the choice. Two rows of padding at each end let the first and last
   * option reach the band. Selection is read from scroll position, so a flick,
   * a tap on a row (which scrolls it to the band) and the arrow keys all end in
   * the same place. Keyboard-reachable: the wheel is the focusable listbox,
   * Up/Down/Home/End move the choice, and aria-activedescendant names it.
   */
  function wheel(options, selected, onChange) {
    const ROW = 44; // --tap; the option height in app.css must match
    const ids = options.map((_, i) => `wheel-opt-${i}`);
    let current = Math.max(0, options.indexOf(selected));

    const items = options.map((label, i) =>
      el(
        'div.wheel-option',
        {
          role: 'option',
          id: ids[i],
          'aria-selected': String(i === current),
          onclick: () => scrollTo(i),
        },
        label,
      ),
    );
    const list = el(
      'div.wheel',
      { role: 'listbox', tabindex: '0', 'aria-label': 'State', 'aria-activedescendant': ids[current] },
      // The padding rows are not options; presentation keeps the listbox's
      // children all options for a screen reader.
      [el('div.wheel-pad', { role: 'presentation' }), ...items, el('div.wheel-pad', { role: 'presentation' })],
    );

    const select = (i) => {
      if (i === current || i < 0 || i >= options.length) return;
      items[current].setAttribute('aria-selected', 'false');
      current = i;
      items[current].setAttribute('aria-selected', 'true');
      list.setAttribute('aria-activedescendant', ids[current]);
      onChange(options[current]);
    };
    // Instant, not smooth: the snap is mandatory so the position is exact, and
    // a smooth programmatic scroll never moved in headless Chrome, which left
    // the ArrowDown check reading option 0 (first smoke runs of 0.1.82). A hop
    // of one or two 44px rows does not need an animation to be followed.
    let moved = false;
    const scrollTo = (i) => { moved = true; list.scrollTop = i * ROW; };

    let frame = 0;
    list.addEventListener('scroll', () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        // The sheet body re-renders on every chip tap, wheel included. A
        // scroll still settling when that happens would read a DETACHED
        // list's scrollTop -- always 0 -- and reset the draft to Any under a
        // new wheel showing the old choice (cold review, 0.1.82).
        if (!list.isConnected) return;
        select(Math.round(list.scrollTop / ROW));
      });
    });
    list.addEventListener('keydown', (e) => {
      const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
      if (step) scrollTo(Math.min(options.length - 1, Math.max(0, current + step)));
      else if (e.key === 'Home') scrollTo(0);
      else if (e.key === 'End') scrollTo(options.length - 1);
      else return;
      e.preventDefault();
    });
    // The sheet is not in the document until the body is returned, and a
    // detached element cannot scroll, so the opening position is set on the
    // next frame -- unless something has already moved the wheel. Without the
    // guard a key or tap inside that first frame was undone by this callback,
    // which is how the ArrowDown smoke check read option 0 (0.1.82, third run).
    requestAnimationFrame(() => { if (!moved) list.scrollTop = current * ROW; });

    return el('div.wheel-frame', null, [el('div.wheel-band', { 'aria-hidden': 'true' }), list]);
  }

  /** VIEW: Compact or Detail, with the footer line (docs/plan.md, (e)). */
  function openViewSheet() {
    openSheet('View', (close) =>
      el('div', null, [
        el(
          'div.sheet-options',
          { role: 'group', 'aria-label': 'View options' },
          Object.entries(VIEWS).map(([key, v]) =>
            optionRow(v.label, v.description, state.view === key, () => {
              state.view = key;
              writeView(key);
              state.limit = PAGE;
              close();
              paintLeads();
              paint();
            }),
          ),
        ),
        el('p.sheet-foot', { text: 'The view sticks until changed. Either view respects When and Filter.' }),
      ]),
    );
  }

  paint();
  return screen;
}
