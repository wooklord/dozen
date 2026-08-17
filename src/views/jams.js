// JAM CHARTS — which songs are the jam vehicles.
//
// Carton's own jamcharts method, surfaced as a browsable list. Songs are
// ranked by how many jam chart entries they have, which is counting.

import { el, append } from '../ui/dom.js';
import { attribution, emptyState, cartonLink } from '../ui/components.js';
import { formatShowDateShort } from '../util/dates.js';

export function renderJams(ctx) {
  const { index, navigate } = ctx;
  const screen = el('div.screen');

  append(screen, el('h1.screen-title', { text: 'Jam charts' }));
  append(
    screen,
    el('p.screen-sub', {
      text: `${index.counts.jamcharts} entries across ${index.songs.filter((s) => s.isJamChart).length} songs, as listed by The Carton.`,
    }),
  );

  const songs = index.songs
    .filter((s) => s.isJamChart)
    .slice()
    .sort((a, b) => b.jamcharts.length - a.jamcharts.length || a.name.localeCompare(b.name));

  if (!songs.length) {
    append(screen, emptyState('No jam chart entries.'));
    append(screen, attribution());
    return screen;
  }

  const max = songs[0].jamcharts.length;
  const list = el('ul.rows');
  for (const s of songs) {
    const latest = s.jamcharts
      .slice()
      .sort((a, b) => b.showdate.localeCompare(a.showdate))[0];
    append(
      list,
      el('li', null, [
        el(
          'button.row',
          { type: 'button', onclick: () => navigate(`#/song/${s.song_id}`) },
          [
            el('span.gap-bar', { style: { '--heat': String(Math.max(0.12, s.jamcharts.length / max)) } }),
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
            el('div.gap-figure', null, [
              el('div.gap-num.num', { text: String(s.jamcharts.length) }),
              el('div.gap-unit', { text: s.jamcharts.length === 1 ? 'entry' : 'entries' }),
            ]),
          ],
        ),
      ]),
    );
  }
  append(screen, list);
  append(
    screen,
    el('div', { style: { marginTop: '12px' } }, cartonLink('/jamcharts', 'Jam charts on The Carton')),
  );
  append(screen, attribution());
  return screen;
}
