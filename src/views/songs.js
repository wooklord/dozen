// SONGS — one place where any song can be found.
//
// This absorbs the old Rotation screen rather than sitting beside it: Rotation
// was already "all songs sorted by gap", so gap descending is simply the
// default sort here. Two tabs rendering the same list from the same index
// would have drifted.
//
// Everything here is sorting, filtering and counting. The list is never
// labelled with what is likely to happen next.

import { el, append, debounce, openSheet } from '../ui/dom.js';
import { songRow, attribution, emptyState, gapExplainerLink } from '../ui/components.js';
import { normalizeQuery, matchesQuery } from '../data/normalize.js';
import {
  compareSongsByName,
  compareByLongestGap,
  compareByTimesAsc,
  isPastLongestGap,
  isClosedGapLongest,
  longestGap,
} from '../data/index.js';

// Module-level so the screen remembers its state across navigation.
//
// Default is A-Z, not gap: Songs is the look-anything-up tab, and a pick
// session starts from the upcoming-show view. The cold-song list is still one
// tap away under "Coldest first".
const state = {
  sort: 'alpha',
  filter: 'all',
  query: '',
};

// [key, label, figure, description]
//
// The figure column carries the fact the sort is ABOUT, and only that. A–Z
// orders by name, so neither number ranks the list; it shows times played
// because that is the one fact about a song that does not depend on where the
// archive currently ends, which is what you want when you have looked a song
// up rather than scanned a ranking.
//
// A–Z, "Most played" and "Least played" therefore render the SAME figure in
// the SAME way -- same value, same unit, same yolk. They differ in row order
// and nothing else, which is exactly what the sheet says they do. There is no
// longer an "is this the sorted column" treatment to get wrong; see songRow in
// ui/components.js.
//
// "Longest gap" (0.1.76) is the longest gap each song has been through, closed
// or still open: the larger of the longest span between two performances and
// the current gap -- longestGap() in data/index.js. The figure IS that gap,
// and the row's date line becomes the two dates that bound it, or "still
// open". It is a max over the per-show gaps the gap charts already render;
// ruled in scope in docs/plan.md. The 0.1.77 sections were withdrawn (the
// "Still open" section was the Coldest-first order under a header); the
// 0.1.79 closed-only figure was withdrawn in turn, because it dropped 103
// songs to dashes and hid every gap still running (docs/plan.md, 0.1.81
// design). One flat list; separating open from closed is the FILTER's job.
//
// The descriptions are the sheet's second line, locked verbatim in
// docs/plan.md ("0.1.81 design", (e)). The language test applies to each.
const SORTS = [
  ['alpha', 'A–Z', 'times', 'Alphabetical. The number is times played.'],
  ['gap-desc', 'Coldest first', 'gap', 'Most shows since last played, first. The number is shows since played.'],
  ['gap-asc', 'Hottest first', 'gap', 'Fewest shows since last played, first. The number is shows since played.'],
  ['times', 'Most played', 'times', 'Times played, highest first.'],
  ['times-asc', 'Least played', 'times', 'Times played, lowest first.'],
  [
    'longest',
    'Longest gap',
    'longest',
    'The longest gap each song has been through, biggest first — closed or still open. ' +
      'The number is that gap; the date line shows the two shows that bound it, or “still open”.',
  ],
];

// [key, label, description]. Single-select, like the sort: one filter at a
// time, and each composes with every sort.
//
// "Closed gaps only" (0.1.81) and "Passed longest gap" (0.1.79) are the two
// strict inequalities between the same two figures Carton prints on the
// song's page -- the longest gap between two performances, and the current
// gap -- so the two partition the songs that have both a closed gap and a
// current gap, and a song whose two figures tie is in neither (a tie reads
// open, and open is not closed). Both are true/false tests on displayed figures, which is filtering.
// A song with no closed gap has nothing to compare and is in neither. No
// number derived from the two is rendered anywhere; the row descriptions and
// the count lines state the comparison and nothing about what comes next.
// Ruled in scope in docs/plan.md, 2026-10-24; predicates in data/index.js,
// unit-tested.
const FILTERS = [
  ['all', 'All', 'Every song played live, as listed by The Carton.'],
  ['originals', 'Originals', 'Eggy originals only.'],
  ['covers', 'Covers', 'Covers only.'],
  ['jam', 'Jam charts', 'Songs with at least one jam chart entry.'],
  [
    'closed',
    'Closed gaps only',
    'Songs whose longest gap has ended — a gap between two performances, longer than the one ' +
      'running now. A song played at only one show is left out.',
  ],
  [
    'past',
    'Passed longest gap',
    'Songs whose current gap is longer than any gap they have closed before. A song played at ' +
      'only one show is left out.',
  ],
];

export function renderSongs(ctx) {
  const { index, navigate } = ctx;
  const screen = el('div.screen');

  append(screen, el('h1.screen-title', { text: 'Songs' }));
  // "Played live", because that is the list: every song with at least one
  // Eggy performance, as The Carton's own song list shows it. The catalogue
  // entries it omits are omitted here too, and counted in the Settings sheet.
  // Kept to the old line's length: a longer first sentence wrapped the
  // sub-line and moved every row down 19px (layout-diff, 0.1.79).
  append(
    screen,
    el('p.screen-sub', null, [
      `${index.counts.songs} songs played live. Gap is counted across the ${index.counts.countedShows} shows played so far, as on The Carton. `,
      gapExplainerLink(index, 'How this is counted'),
    ]),
  );

  // --- Search --------------------------------------------------------------
  // Runs against cached data in memory. Nothing here touches the network --
  // no per-keystroke requests, ever.
  const search = el('input.search', {
    type: 'search',
    placeholder: 'Search songs…',
    value: state.query,
    autocomplete: 'off',
    autocorrect: 'off',
    autocapitalize: 'none',
    spellcheck: 'false',
    oninput: debounce((e) => {
      state.query = e.target.value;
      paint();
    }, 120),
  });
  append(screen, el('div', { style: { marginBottom: '10px' } }, search));

  // --- Sort and filter: two lead chips on ONE row, each opening a sheet ------
  //
  // Neither set of options fits as chips at phone width. Measured headless at
  // 390px: the four-chip sort bar already overflowed by 7px (397px of chips,
  // with the scrollbar hidden, so "Most played" was clipped and nothing said
  // so), a fifth took it to 504px, and the five filter chips to 430px -- a
  // chip entirely off-screen with no affordance, which is the 0.1.75 Shows
  // defect. Same fix as Shows: ONE chip reads the active value and opens a
  // sheet with all of them.
  //
  // From 0.1.81 the two leads share one row instead of stacking as a sort bar
  // over a filter bar. Each chip carries its own small uppercase label
  // ("SORT", "FILTER") so a chip reading "All" beside one reading "A–Z" says
  // which control it is; the label is muted (--ink-label, measured against the
  // lead fill in scripts/contrast.mjs) and the value wears the lead ink. The
  // chips never ellipsize: a chip that fits by truncating its own value is
  // the defect the smoke bar-fit check exists to catch. When the pair does not
  // fit -- it does at 390px, not at 360px -- the value WRAPS inside a taller
  // chip (app.css, .sortbar-leads, which is why the bar is a grid).
  // scripts/smoke.mjs measures the widest pair ("Longest gap" + "Passed
  // longest gap") at both widths: the bar never overflows and no value is
  // clipped inside its chip.
  //
  // The lead chips wear the selected paint from their class (.chip-lead), not
  // from aria-pressed: that attribute means a toggle's state and would be a
  // lie on a button that opens a sheet. Same reasoning as .chip-back on Shows.
  const sortOf = (key) => SORTS.find(([k]) => k === key) || SORTS[0];
  const filterOf = (key) => FILTERS.find(([k]) => k === key) || FILTERS[0];

  function leadChip(label, onclick) {
    const value = el('span.chip-value');
    const chip = el('button.chip.chip-lead', { type: 'button', onclick }, [
      el('span.chip-label', { text: label }),
      value,
      el('span.chip-caret', { text: '▾', 'aria-hidden': 'true' }),
    ]);
    return { chip, value };
  }
  const sortLead = leadChip('Sort', () => openSortSheet());
  const filterLead = leadChip('Filter', () => openFilterSheet());

  // The accessible name starts with the visible text ("Sort A–Z", "Filter
  // All") so a voice user can say what they see, then says what a tap does.
  function paintLeads() {
    const sortLabel = sortOf(state.sort)[1];
    const filterLabel = filterOf(state.filter)[1];
    sortLead.value.textContent = sortLabel;
    sortLead.chip.setAttribute('aria-label', `Sort ${sortLabel}. Change sort`);
    filterLead.value.textContent = filterLabel;
    filterLead.chip.setAttribute('aria-label', `Filter ${filterLabel}. Change filter`);
  }
  paintLeads();

  // One full-width row per option: the name, then its one-line description.
  // A description inside a 34px chip has nowhere to go, and a grid of bare
  // names was what left "Passed longest gap" needing a note under the grid.
  // `describe` reads the description by its POSITION in that list's row shape
  // -- SORTS rows are [key, label, figure, description], FILTERS rows
  // [key, label, description] -- rather than taking "the last element", which
  // would quietly render a figure key as the description if a row lost its
  // text.
  function optionList(options, selectedKey, describe, groupName, onPick) {
    return el(
      'div.sheet-options',
      { role: 'group', 'aria-label': groupName },
      options.map((row) => {
        const [key, label] = row;
        const description = describe(row);
        return el(
          'button.sheet-item.sheet-option',
          {
            type: 'button',
            'aria-pressed': String(selectedKey === key),
            onclick: () => onPick(key),
          },
          [el('div.sheet-option-name', { text: label }), el('div.sheet-option-desc', { text: description })],
        );
      }),
    );
  }

  function openSortSheet() {
    openSheet('Sort by', (close) =>
      optionList(SORTS, state.sort, (row) => row[3], 'Sort options', (key) => {
        state.sort = key;
        close();
        paintLeads();
        paint();
      }),
    );
  }

  function openFilterSheet() {
    openSheet('Filter', (close) =>
      optionList(FILTERS, state.filter, (row) => row[2], 'Filter options', (key) => {
        state.filter = key;
        close();
        paintLeads();
        paint();
      }),
    );
  }

  append(screen, el('div.sortbar.sortbar-lead.sortbar-leads', null, [sortLead.chip, filterLead.chip]));

  const countLine = el('p.note', { style: { margin: '4px 0 8px' } });
  append(screen, countLine);

  // A plain container holding one ul.rows under every sort. Rebuilt on every
  // paint.
  const listWrap = el('div');
  append(screen, listWrap);
  append(screen, attribution());

  function paint() {
    let songs = index.songs;

    if (state.filter === 'originals') songs = songs.filter((s) => s.isOriginal);
    else if (state.filter === 'covers') songs = songs.filter((s) => !s.isOriginal);
    else if (state.filter === 'jam') songs = songs.filter((s) => s.isJamChart);
    else if (state.filter === 'closed') songs = songs.filter(isClosedGapLongest);
    else if (state.filter === 'past') songs = songs.filter(isPastLongestGap);

    const q = normalizeQuery(state.query);
    if (q) songs = songs.filter((s) => matchesQuery(s.songkey, q));

    // Every listed song has been played, so the gap sorts' null branch is
    // reached only by a song whose last performance is not in the counted
    // universe; it sorts last rather than pretending to be at either extreme.
    // Every branch falls back to the ONE shared comparator, so equal-valued
    // songs are ordered identically here and on Jams.
    const gapOf = (s) => s.showsSinceLastPlayed;
    songs = songs.slice().sort((a, b) => {
      switch (state.sort) {
        case 'gap-asc': {
          const av = gapOf(a);
          const bv = gapOf(b);
          if (av === null && bv === null) return compareSongsByName(a, b);
          if (av === null) return 1;
          if (bv === null) return -1;
          return av - bv || compareSongsByName(a, b);
        }
        case 'times':
          return b.timesPlayed - a.timesPlayed || compareSongsByName(a, b);
        case 'times-asc':
          return compareByTimesAsc(a, b);
        case 'gap-desc': {
          const av = gapOf(a);
          const bv = gapOf(b);
          if (av === null && bv === null) return compareSongsByName(a, b);
          if (av === null) return 1;
          if (bv === null) return -1;
          return bv - av || compareSongsByName(a, b);
        }
        case 'longest':
          return compareByLongestGap(a, b);
        case 'alpha':
        default:
          return compareSongsByName(a, b);
      }
    });

    const figure = sortOf(state.sort)[2];
    const maxGap = songs.reduce((m, s) => Math.max(m, s.showsSinceLastPlayed ?? 0), 1);
    const maxTimes = songs.reduce((m, s) => Math.max(m, s.timesPlayed), 1);
    const maxLongest = songs.reduce((m, s) => Math.max(m, (longestGap(s) || { gap: 0 }).gap), 1);
    const heatMax = figure === 'times' ? maxTimes : figure === 'longest' ? maxLongest : maxGap;

    // The count line says what the list IS. Under the two gap filters that is
    // the comparison, stated literally; under "Longest gap" with no filter it
    // says what the figure is, because the row shows a number and a span and
    // the two could be read as either gap. The other filters' names already
    // say their subset. Wording locked in docs/plan.md ("0.1.81 design").
    const n = songs.length;
    let suffix = '';
    if (state.filter === 'past') suffix = ' whose current gap is longer than any gap they have closed before';
    else if (state.filter === 'closed') suffix = ' whose longest gap has ended';
    else if (state.sort === 'longest' && state.filter === 'all') {
      suffix = ' · the longest gap each song has been through, open or closed';
    }
    countLine.textContent =
      `${n} song${n === 1 ? '' : 's'}` + suffix + (state.query ? ` matching “${state.query.trim()}”` : '');

    listWrap.replaceChildren();
    if (!songs.length) {
      append(listWrap, el('ul.rows', null, el('li', null, emptyState('No songs match that search.'))));
      return;
    }

    append(
      listWrap,
      el(
        'ul.rows',
        null,
        songs.map((s) =>
          songRow(s, {
            figure,
            maxGap: heatMax,
            index,
            onOpen: (song) => navigate(`#/song/${song.song_id}`),
          }),
        ),
      ),
    );
  }

  paint();
  return screen;
}
