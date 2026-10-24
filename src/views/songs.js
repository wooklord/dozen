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
import { compareSongsByName, compareByLongestGap, isPastLongestGap } from '../data/index.js';

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

// [key, label, figure]
//
// The figure column carries the fact the sort is ABOUT, and only that. A–Z
// orders by name, so neither number ranks the list; it shows times played
// because that is the one fact about a song that does not depend on where the
// archive currently ends, which is what you want when you have looked a song
// up rather than scanned a ranking.
//
// A–Z and "Most played" therefore render the SAME figure in the SAME way --
// same value, same unit, same yolk. They differ in row order and nothing else,
// which is exactly what the chips say they do. There is no longer an "is this
// the sorted column" treatment to get wrong; see songRow in ui/components.js.
//
// "Longest gap" (0.1.76) is the fifth: the longest OBSERVED gap, the longest
// span between two of the song's performances. The figure IS that gap, and
// the row's date line becomes the two dates that bound it -- see songRow. It
// is a max over the per-show gaps the gap charts already render; ruled in
// scope in docs/plan.md. Closed gaps only, as of 0.1.79: the 0.1.76 rule that
// folded the current gap in, and the 0.1.77 sections that followed from it,
// were withdrawn because the "Still open" section was the Coldest-first order
// under a header (docs/plan.md, withdrawal of 2026-10-24). One flat list, as
// under every other sort; songs with no closed gap read a dash at the tail.
const SORTS = [
  ['alpha', 'A–Z', 'times'],
  ['gap-desc', 'Coldest first', 'gap'],
  ['gap-asc', 'Hottest first', 'gap'],
  ['times', 'Most played', 'times'],
  ['longest', 'Longest gap', 'longest'],
];

// [key, label]. Single-select, like the sort: one filter at a time, and each
// composes with every sort.
//
// "Passed longest gap" (0.1.79) keeps the songs whose current gap is longer than
// their longest observed gap -- a true/false test on two figures Carton prints
// on the song's page, which is filtering. Strict: equal is not longer. A song
// with no closed gap has nothing to compare and is not kept. No number
// derived from the two is rendered anywhere; the chip, the count line and the
// sheet note state the comparison and nothing about what comes next. Ruled in
// scope in docs/plan.md, 2026-10-24; predicate in data/index.js, unit-tested.
const FILTERS = [
  ['all', 'All'],
  ['originals', 'Originals'],
  ['covers', 'Covers'],
  ['jam', 'Jam charts'],
  ['past', 'Passed longest gap'],
];

// Stated once, next to the chip that applies it, in the ruling's own words.
const PAST_LONGEST_NOTE =
  'Passed longest gap keeps the songs whose current gap is longer than the longest gap ' +
  'between any two of their performances, both counted as on The Carton. Equal is not ' +
  'longer. A song played at only one show has no gap between two performances and is ' +
  'left out.';

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

  // --- Sort: one lead chip, and a sheet ------------------------------------
  //
  // The five sorts do not fit as chips at phone width. Measured headless at
  // 390px: the four-chip bar already overflowed by 7px (397px of chips, with
  // the scrollbar hidden, so "Most played" was clipped and nothing said so),
  // and a fifth took it to 504px -- a chip entirely off-screen with no
  // affordance, which is the 0.1.75 Shows defect. Same fix: the bar holds ONE
  // chip that reads the active sort and opens a sheet with all of them.
  //
  // The lead chip wears the selected paint from its class (.chip-lead), not
  // from aria-pressed: that attribute means a toggle's state and would be a
  // lie on a button that opens a sheet. Same reasoning as .chip-back on Shows.
  const labelOf = (key) => (SORTS.find(([k]) => k === key) || SORTS[0])[1];
  const sortLead = el('button.chip.chip-lead', {
    type: 'button',
    onclick: () => openSortSheet(),
  });
  function paintLead() {
    sortLead.textContent = `${labelOf(state.sort)} ▾`;
    sortLead.setAttribute('aria-label', `Sorted by ${labelOf(state.sort)}. Change sort`);
  }
  paintLead();

  function openSortSheet() {
    openSheet('Sort by', (close) =>
      el(
        'div.chip-grid',
        null,
        SORTS.map(([key, label]) =>
          el(
            'button.chip',
            {
              type: 'button',
              'aria-pressed': String(state.sort === key),
              onclick: () => {
                state.sort = key;
                close();
                paintLead();
                paint();
              },
            },
            label,
          ),
        ),
      ),
    );
  }

  // --- Filter: one lead chip, and a sheet (0.1.79) --------------------------
  //
  // Five filter chips do not fit either. Measured headless at 390px with the
  // bar's own 16px padding, so 358px visible: the four chips were 299px of
  // content, and a fifth chip (measured as "Past longest gap", 124px; the
  // 0.1.80 label "Passed longest gap" is wider still) took the row to 430px -- 72px of overflow
  // behind a hidden scrollbar, the chip cut mid-word at the edge. Same fix as
  // the sort row, for the same reason: one chip reading the active filter, a
  // sheet with all five, nothing off-screen. The lead keeps .chip-quiet so the
  // filter row still reads a step below the sort row, as it did as a chip row.
  // scripts/smoke.mjs asserts both bars' content fits their visible width.
  const filterLabelOf = (key) => (FILTERS.find(([k]) => k === key) || FILTERS[0])[1];
  const filterLead = el('button.chip.chip-lead.chip-quiet', {
    type: 'button',
    onclick: () => openFilterSheet(),
  });
  function paintFilterLead() {
    filterLead.textContent = `${filterLabelOf(state.filter)} ▾`;
    filterLead.setAttribute('aria-label', `Filter: ${filterLabelOf(state.filter)}. Change filter`);
  }
  paintFilterLead();

  function openFilterSheet() {
    openSheet('Filter', (close) =>
      el('div', { style: { display: 'grid', gap: '12px' } }, [
        el(
          'div.chip-grid',
          null,
          FILTERS.map(([key, label]) =>
            el(
              'button.chip',
              {
                type: 'button',
                'aria-pressed': String(state.filter === key),
                onclick: () => {
                  state.filter = key;
                  close();
                  paintFilterLead();
                  paint();
                },
              },
              label,
            ),
          ),
        ),
        el('p.note', { style: { margin: 0 }, text: PAST_LONGEST_NOTE }),
      ]),
    );
  }

  append(screen, el('div.sortbar.sortbar-lead', null, [sortLead]));
  append(screen, el('div.sortbar.sortbar-secondary', null, [filterLead]));

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

    const active = SORTS.find(([k]) => k === state.sort);
    const figure = active?.[2] || 'gap';
    const maxGap = songs.reduce((m, s) => Math.max(m, s.showsSinceLastPlayed ?? 0), 1);
    const maxTimes = songs.reduce((m, s) => Math.max(m, s.timesPlayed), 1);
    const maxLongest = songs.reduce((m, s) => Math.max(m, s.longestObservedGap ? s.longestObservedGap.gap : 0), 1);
    const heatMax = figure === 'times' ? maxTimes : figure === 'longest' ? maxLongest : maxGap;

    // The count line says what the list IS. Under "Passed longest gap" that is
    // the comparison, stated literally; the other filters' chips already name
    // their subset.
    const n = songs.length;
    countLine.textContent =
      `${n} song${n === 1 ? '' : 's'}` +
      (state.filter === 'past' ? ' whose current gap is longer than their longest observed gap' : '') +
      (state.query ? ` matching “${state.query.trim()}”` : '');

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
