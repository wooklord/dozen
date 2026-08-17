// RECENT SETLISTS — what has been burned lately.
//
// Within a tour run, a song played two nights ago behaves differently from one
// that hasn't appeared. Carton's notation is preserved exactly: "->" and ">"
// are different marks and neither is normalized away.

import { el, append } from '../ui/dom.js';
import {
  setlistBlock,
  cartonLink,
  showPermalink,
  attribution,
  sectionHead,
  emptyState,
} from '../ui/components.js';
import { showStructure } from '../data/index.js';
import { formatShowDate } from '../util/dates.js';

const SHOW_COUNT = 15;

export function renderRecent(ctx) {
  const { index, navigate } = ctx;
  const screen = el('div.screen');

  append(screen, el('h1.screen-title', { text: 'Recent shows' }));
  append(
    screen,
    el('p.screen-sub', { text: `The last ${SHOW_COUNT} shows with setlist data, newest first.` }),
  );

  const shows = index.countedShows.slice(-SHOW_COUNT).reverse();

  if (!shows.length) {
    append(screen, emptyState('No setlists available.'));
    append(screen, attribution());
    return screen;
  }

  for (const show of shows) {
    const rows = index.setlistByShow.get(Number(show.show_id)) || [];
    append(
      screen,
      el('div.section', null, [
        el('div.card', null, [
          el(
            'div',
            { style: { display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'baseline' } },
            [
              el('div', { style: { minWidth: '0' } }, [
                el('div', { style: { fontWeight: '650' }, text: formatShowDate(show.showdate) }),
                el('div.note', { text: `${show.venuename} · ${show.location}` }),
              ]),
              el('span.badge.badge-set', { text: showStructure(index, show.show_id) || '—' }),
            ],
          ),
          el('div', { style: { marginTop: '12px' } }, setlistBlock(rows, {
            index,
            onSong: (id) => navigate(`#/song/${id}`),
          })),
          el('div', { style: { marginTop: '4px' } }, cartonLink(showPermalink(show), 'View on The Carton')),
        ]),
      ]),
    );
  }

  append(screen, attribution());
  return screen;
}
