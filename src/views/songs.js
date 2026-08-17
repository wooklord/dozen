// SONGS — one place where any song can be found.
//
// This absorbs the old Rotation screen rather than sitting beside it: Rotation
// was already "all songs sorted by gap", so gap descending is simply the
// default sort here. Two tabs rendering the same list from the same index
// would have drifted.
//
// Everything here is sorting, filtering and counting. The list is never
// labelled with what is likely to happen next.

import { el, append, debounce } from '../ui/dom.js';
import { songRow, attribution, emptyState, gapExplainerLink } from '../ui/components.js';
import { normalizeQuery, matchesQuery } from '../data/normalize.js';

// Module-level so the screen remembers its state across navigation.
const state = {
  sort: 'gap-desc',
  filter: 'all',
  query: '',
};

const SORTS = [
  ['gap-desc', 'Coldest first', 'gap'],
  ['gap-asc', 'Hottest first', 'gap'],
  ['times', 'Most played', 'times'],
  ['alpha', 'A–Z', 'gap'],
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

  // --- Sort + filter chips -------------------------------------------------
  const sortChips = SORTS.map(([key, label]) =>
    el(
      'button.chip',
      {
        type: 'button',
        'data-key': key,
        'aria-pressed': String(state.sort === key),
        onclick: () => {
          state.sort = key;
          for (const c of sortChips) c.setAttribute('aria-pressed', String(c.dataset.key === key));
          paint();
        },
      },
      label,
    ),
  );

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

  append(screen, el('div.sortbar', null, sortChips));
  append(screen, el('div.sortbar.sortbar-secondary', null, filterChips));

  const countLine = el('p.note', { style: { margin: '4px 0 8px' } });
  append(screen, countLine);

  const listWrap = el('ul.rows');
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
    const gapOf = (s) => s.showsSinceLastPlayed;
    songs = songs.slice().sort((a, b) => {
      switch (state.sort) {
        case 'gap-asc': {
          const av = gapOf(a);
          const bv = gapOf(b);
          if (av === null && bv === null) return a.name.localeCompare(b.name);
          if (av === null) return 1;
          if (bv === null) return -1;
          return av - bv || a.name.localeCompare(b.name);
        }
        case 'times':
          return b.timesPlayed - a.timesPlayed || a.name.localeCompare(b.name);
        case 'alpha':
          return a.name.localeCompare(b.name);
        case 'gap-desc':
        default: {
          const av = gapOf(a);
          const bv = gapOf(b);
          if (av === null && bv === null) return a.name.localeCompare(b.name);
          if (av === null) return 1;
          if (bv === null) return -1;
          return bv - av || a.name.localeCompare(b.name);
        }
      }
    });

    const figure = SORTS.find(([k]) => k === state.sort)?.[2] || 'gap';
    const maxGap = songs.reduce((m, s) => Math.max(m, s.showsSinceLastPlayed ?? 0), 1);
    const maxTimes = songs.reduce((m, s) => Math.max(m, s.timesPlayed), 1);

    countLine.textContent =
      `${songs.length} song${songs.length === 1 ? '' : 's'}` +
      (state.query ? ` matching “${state.query.trim()}”` : '');

    listWrap.replaceChildren();
    if (!songs.length) {
      append(listWrap, el('li', null, emptyState('No songs match that search.')));
      return;
    }

    for (const s of songs) {
      append(
        listWrap,
        songRow(s, {
          figure,
          maxGap: figure === 'times' ? maxTimes : maxGap,
          index,
          onOpen: (song) => navigate(`#/song/${song.song_id}`),
        }),
      );
    }
  }

  paint();
  return screen;
}
