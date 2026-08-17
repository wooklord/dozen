// GAP / ROTATION HEAT — the workhorse view.
//
// Every song with: shows since last played, last played, total times played,
// first played. One toggle flips between coldest-first and hottest-first.
//
// This is sorting and counting. The list is never labeled with what is likely
// to happen -- column headers describe what HAS happened. See the language
// test in CLAUDE.md.

import { el, append, debounce } from '../ui/dom.js';
import { songRow, attribution, emptyState, gapExplainerLink } from '../ui/components.js';
import { normalizeQuery } from '../data/normalize.js';

const state = {
  direction: 'cold', // 'cold' = longest gap first, 'hot' = shortest gap first
  filter: 'all', // all | originals | covers | jam
  query: '',
};

export function renderGap(ctx) {
  const { index, navigate } = ctx;
  const screen = el('div.screen');

  append(screen, el('h1.screen-title', { text: 'Rotation' }));
  append(
    screen,
    el('p.screen-sub', null, [
      `Shows since each song was last played, counted across the ${index.counts.countedShows} shows that have setlist data. `,
      gapExplainerLink(index, 'How this is counted'),
    ]),
  );

  const listWrap = el('ul.rows');

  // --- Controls -------------------------------------------------------------
  const sortChip = el(
    'button.chip',
    {
      type: 'button',
      'aria-pressed': 'true',
      onclick: () => {
        state.direction = state.direction === 'cold' ? 'hot' : 'cold';
        sortChip.textContent = sortLabel();
        paint();
      },
    },
    sortLabel(),
  );

  const filters = [
    ['all', 'All'],
    ['originals', 'Originals'],
    ['covers', 'Covers'],
    ['jam', 'Jam charts'],
  ];

  const chips = filters.map(([key, label]) =>
    el(
      'button.chip',
      {
        type: 'button',
        'aria-pressed': String(state.filter === key),
        onclick: () => {
          state.filter = key;
          for (const c of chips) c.setAttribute('aria-pressed', String(c.dataset.key === key));
          paint();
        },
        'data-key': key,
      },
      label,
    ),
  );

  append(screen, el('div.sortbar', null, [sortChip, ...chips]));

  const search = el('input.search', {
    type: 'search',
    placeholder: 'Find a song…',
    value: state.query,
    // Searching runs against cached data in memory. Nothing here ever hits
    // the network -- no per-keystroke requests, ever.
    oninput: debounce((e) => {
      state.query = e.target.value;
      paint();
    }, 140),
  });
  append(screen, el('div', { style: { marginBottom: '12px' } }, search));

  const countLine = el('p.note', { style: { marginBottom: '8px' } });
  append(screen, countLine);
  append(screen, listWrap);
  append(screen, attribution());

  function sortLabel() {
    return state.direction === 'cold' ? 'Coldest first ↓' : 'Hottest first ↑';
  }

  function paint() {
    let songs = index.songs.filter((s) => s.timesPlayed > 0);

    if (state.filter === 'originals') songs = songs.filter((s) => s.isOriginal);
    else if (state.filter === 'covers') songs = songs.filter((s) => !s.isOriginal);
    else if (state.filter === 'jam') songs = songs.filter((s) => s.isJamChart);

    const q = normalizeQuery(state.query);
    if (q) songs = songs.filter((s) => s.songkey.includes(q));

    songs = songs.slice().sort((a, b) => {
      const av = a.showsSinceLastPlayed ?? -1;
      const bv = b.showsSinceLastPlayed ?? -1;
      if (av !== bv) return state.direction === 'cold' ? bv - av : av - bv;
      return a.name.localeCompare(b.name);
    });

    const maxGap = songs.reduce((m, s) => Math.max(m, s.showsSinceLastPlayed ?? 0), 1);

    countLine.textContent =
      `${songs.length} song${songs.length === 1 ? '' : 's'}` +
      (state.query ? ` matching “${state.query}”` : '');

    listWrap.replaceChildren();
    if (!songs.length) {
      append(listWrap, el('li', null, emptyState('No songs match.')));
      return;
    }
    for (const s of songs) {
      append(
        listWrap,
        songRow(s, {
          figure: 'gap',
          maxGap,
          index,
          onOpen: (song) => navigate(`#/song/${song.song_id}`),
        }),
      );
    }
  }

  paint();
  return screen;
}
