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
import { songRow, attribution, emptyState, gapExplainerLink, sectionHead } from '../ui/components.js';
import { normalizeQuery, matchesQuery } from '../data/normalize.js';
import { compareSongsByName, compareByLongestGap } from '../data/index.js';

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
// "Longest gap" (0.1.76) is the fifth: the longest gap a song has been through,
// closed or still open. The figure IS that gap, and the row's date line becomes
// the span that bounds it -- see songRow. It is a max over the per-show gaps
// the gap charts already render; ruled in scope in docs/plan.md.
//
// Under it the list is SECTIONED (0.1.77): "Still open", then "Closed", then
// "Never played", each under a counted header, each descending within itself.
// Interleaved, a 300-show gap that ended in 2019 and a 300-show gap still
// running today sat on adjacent rows and the span text was the only thing
// telling them apart -- which on a phone it did not. Grouping by a flag the
// index already carries is grouping; see plan.md decision 6.
const SORTS = [
  ['alpha', 'A–Z', 'times'],
  ['gap-desc', 'Coldest first', 'gap'],
  ['gap-asc', 'Hottest first', 'gap'],
  ['times', 'Most played', 'times'],
  ['longest', 'Longest gap', 'longest'],
];

const FILTERS = [
  ['all', 'All'],
  ['originals', 'Originals'],
  ['covers', 'Covers'],
  ['jam', 'Jam charts'],
];

export function renderSongs(ctx) {
  const { index, navigate } = ctx;
  const screen = el('div.screen');

  append(screen, el('h1.screen-title', { text: 'Songs' }));
  append(
    screen,
    el('p.screen-sub', null, [
      `${index.counts.songs} songs in the archive. Gap is counted across the ${index.counts.countedShows} shows that have setlist data. `,
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

  const filterChips = FILTERS.map(([key, label]) =>
    el(
      'button.chip.chip-quiet',
      {
        type: 'button',
        'data-key': key,
        'aria-pressed': String(state.filter === key),
        onclick: () => {
          state.filter = key;
          for (const c of filterChips) c.setAttribute('aria-pressed', String(c.dataset.key === key));
          paint();
        },
      },
      label,
    ),
  );

  append(screen, el('div.sortbar.sortbar-lead', null, [sortLead]));
  append(screen, el('div.sortbar.sortbar-secondary', null, filterChips));

  const countLine = el('p.note', { style: { margin: '4px 0 8px' } });
  append(screen, countLine);

  // A plain container: one ul.rows under four of the sorts, three sectioned
  // lists under "Longest gap". Rebuilt on every paint.
  const listWrap = el('div');
  append(screen, listWrap);
  append(screen, attribution());

  function paint() {
    let songs = index.songs;

    if (state.filter === 'originals') songs = songs.filter((s) => s.isOriginal);
    else if (state.filter === 'covers') songs = songs.filter((s) => !s.isOriginal);
    else if (state.filter === 'jam') songs = songs.filter((s) => s.isJamChart);

    const q = normalizeQuery(state.query);
    if (q) songs = songs.filter((s) => matchesQuery(s.songkey, q));

    // Songs that have never been played have no gap; they sort last under the
    // gap sorts rather than pretending to be at either extreme.
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
    // LIST-WIDE, computed before the longest sort is split into sections, so a
    // 300-show gap paints the same bar whether it is still open or ended in
    // 2019. A per-section max would make the bars lie across the divider.
    const maxLongest = songs.reduce((m, s) => Math.max(m, s.longestGap ? s.longestGap.gap : 0), 1);
    const heatMax = figure === 'times' ? maxTimes : figure === 'longest' ? maxLongest : maxGap;

    countLine.textContent =
      `${songs.length} song${songs.length === 1 ? '' : 's'}` +
      (state.query ? ` matching “${state.query.trim()}”` : '');

    listWrap.replaceChildren();
    if (!songs.length) {
      append(listWrap, el('ul.rows', null, el('li', null, emptyState('No songs match that search.'))));
      return;
    }

    const rowsOf = (list) =>
      el(
        'ul.rows',
        null,
        list.map((s) =>
          songRow(s, {
            figure,
            maxGap: heatMax,
            index,
            onOpen: (song) => navigate(`#/song/${song.song_id}`),
          }),
        ),
      );

    if (figure !== 'longest') {
      append(listWrap, rowsOf(songs));
      return;
    }

    // Partition AFTER the one sort: a stable split of a sorted array leaves
    // each part sorted, so the comparator is used once and sections inherit
    // its order. Empty sections render nothing, header included -- a search
    // that matches only closed gaps gets one header, not three.
    const sections = [
      ['Still open', songs.filter((s) => s.longestGap && s.longestGap.isOpen)],
      ['Closed', songs.filter((s) => s.longestGap && !s.longestGap.isOpen)],
      ['Never played', songs.filter((s) => !s.longestGap)],
    ];
    for (const [title, list] of sections) {
      if (!list.length) continue;
      append(listWrap, el('div.section', null, [sectionHead(`${title} (${list.length})`), rowsOf(list)]));
    }
  }

  paint();
  return screen;
}
