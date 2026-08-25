// JAM CHARTS — which songs are the jam vehicles.
//
// Carton's own jamcharts method, surfaced as a browsable list. Songs are
// ranked by how many jam chart entries they have, which is counting.

import { el, append } from '../ui/dom.js';
import { attribution, emptyState, cartonLink, gapExplainerLink } from '../ui/components.js';
import { compareSongsByName } from '../data/index.js';

// A-Z by default: the entry count is the useful fact on each row, but ranking
// by it buries anything you are actually trying to look up.
const state = { sort: 'alpha' };

const JAM_SORTS = [
  ['alpha', 'A–Z'],
  ['entries', 'Most charted'],
];
import { formatShowDateShort } from '../util/dates.js';

/**
 * The coverage boundary, and only the boundary.
 *
 * The year is read from the index every load, never typed: The Carton keeps
 * adding entries, and a year written into this sentence would go stale with
 * nothing looking wrong. Same reasoning as the gap explainer reading its
 * counts from the live index.
 *
 * DELIBERATELY NOT followed by a clause explaining what to infer from it.
 * That was tried and cut: a sentence whose job is to interpret another
 * sentence is exactly the kind of density this screen does not need. The fact
 * is stated; the reader can do the rest.
 *
 * Returns a bare string so it drops into the sub-line beside the gap link, and
 * nothing at all when there are no entries, rather than a sentence with a
 * blank where a year should be.
 */
function coverageNote(index) {
  const from = index.counts.jamchartsFrom;
  return from ? `Entries begin in ${from.slice(0, 4)}. ` : '';
}

export function renderJams(ctx) {
  const { index, navigate } = ctx;
  const screen = el('div.screen');

  append(screen, el('h1.screen-title', { text: 'Jam charts' }));
  append(
    screen,
    el('p.screen-sub', null, [
      `${index.counts.jamcharts} entries across ${index.songs.filter((s) => s.isJamChart).length} songs, as listed by The Carton. `,
      // Coverage window, read from the data every load. The Carton keeps adding
      // entries, so a year typed into this sentence would go stale without
      // anything looking wrong -- the same reason the gap explainer reads its
      // counts from the live index instead of quoting them.
      //
      // Worth stating because the two windows are eleven years apart: jam chart
      // coverage begins in 2024 while the archive starts in 2013, so a song
      // with no entries may simply predate the charts. That is a statement
      // about coverage, not about the song.
      coverageNote(index),
      gapExplainerLink(index, 'How gap is counted'),
    ]),
  );

  const jamSongs = index.songs.filter((s) => s.isJamChart);

  if (!jamSongs.length) {
    append(screen, emptyState('No jam chart entries.'));
    append(screen, attribution());
    return screen;
  }

  // Entry count stays on every row -- it is the useful thing about this view.
  // It just is not the ordering by default.
  const max = jamSongs.reduce((m, s) => Math.max(m, s.jamcharts.length), 1);

  const list = el('ul.rows');

  const sortChips = JAM_SORTS.map(([key, label]) =>
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
  append(screen, el('div.sortbar', null, sortChips));
  append(screen, list);
  append(
    screen,
    el('div', { style: { marginTop: '12px' } }, cartonLink('/jamcharts', 'Jam charts on The Carton')),
  );
  append(screen, attribution());

  function paint() {
    // Both branches resolve ties through the ONE shared comparator.
    const songs = jamSongs.slice().sort((a, b) => {
      if (state.sort === 'entries') {
        return b.jamcharts.length - a.jamcharts.length || compareSongsByName(a, b);
      }
      return compareSongsByName(a, b);
    });

    list.replaceChildren();
    renderRows(songs);
  }

  function renderRows(songs) {
  for (const s of songs) {
    const latest = s.jamcharts
      .slice()
      .sort((a, b) => b.showdate.localeCompare(a.showdate))[0];
    // Same shape as every other list: `.row-shell` is the flex container, the
    // button is a flex item and the figure is its SIBLING. Nesting the figure
    // inside the button left the button shrink-to-fit -- a form control's
    // `width: auto` does not stretch, and `flex: 1 1 0` does nothing outside a
    // flex parent -- so the figure's right edge tracked each row's content and
    // "entry" rows stopped short of "entries" rows.
    append(
      list,
      el('li', null, [
        el('div.row-shell', null, [
          el('span.gap-bar', {
            style: { '--heat': String(Math.max(0.12, s.jamcharts.length / max)) },
          }),
          el(
            'button.row',
            { type: 'button', onclick: () => navigate(`#/song/${s.song_id}`) },
            [
              el('div.row-main', null, [
                el('div.row-title', { text: s.name }),
                el('div.row-meta', null, [
                  el('span', { text: `Latest ${formatShowDateShort(latest.showdate)}` }),
                  el('span.sep', { text: '·' }),
                  el('span', { text: `${s.timesPlayed}× played` }),
                  s.showsSinceLastPlayed !== null
                    ? el('span.badge', { text: `gap ${s.showsSinceLastPlayed}` })
                    : null,
                ]),
              ]),
            ],
          ),
          el('div.gap-figure', null, [
            // The COUNT carries the green, not the title. Green means "this
            // was a jam chart entry", a per-performance fact -- and on this
            // row the count IS that fact, so the colour lands on the thing it
            // describes. Colouring the title would claim "this song is green",
            // a weaker and different claim than the one green makes in a
            // setlist. The title stays plain.
            el('div.gap-num.num.jam-count', { text: String(s.jamcharts.length) }),
            el('div.gap-unit', { text: s.jamcharts.length === 1 ? 'entry' : 'entries' }),
          ]),
        ]),
      ]),
    );
    }
  }

  paint();
  return screen;
}
