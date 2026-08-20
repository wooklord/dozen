// SHOW DETAIL — one show's full setlist, reached from a song's history.

import { el, append, icon, ICONS } from '../ui/dom.js';
import {
  setlistBlock,
  attribution,
  cartonLink,
  showPermalink,
  sectionHead,
  emptyState,
  venueLine,
  venueInfoLink,
} from '../ui/components.js';
import { showStructure } from '../data/index.js';
import { formatShowDate } from '../util/dates.js';

export function renderShow(ctx, showId) {
  const { index, navigate } = ctx;
  const screen = el('div.screen');
  const show = index.showsById.get(Number(showId));

  append(
    screen,
    el('button.chip', { type: 'button', onclick: () => history.back(), style: { marginBottom: '12px' } }, [
      icon(ICONS.back, 16),
      'Back',
    ]),
  );

  if (!show) {
    append(screen, el('h1.screen-title', { text: 'Show not found' }));
    return screen;
  }

  append(screen, el('h1.screen-title', { text: formatShowDate(show.showdate) }));
  append(screen, venueLine(show));
  // Beside the venue line, not inside venueLine() -- that helper is shared with
  // the Shows search rows, which stay dense and get no link.
  const mapsLink = venueInfoLink(show);
  if (mapsLink) append(screen, el('div.link-row', null, [mapsLink]));
  // Two buttons only. The Carton link used to be a third child here and wrapped
  // onto its own line on a narrow phone, which read as a stranded third action
  // rather than a footnote. It now sits under the setlist -- see below.
  append(
    screen,
    el('div.card-actions', null, [
      index.setlistByShow.has(Number(show.show_id))
        ? el(
            'button.btn.btn-small',
            { type: 'button', onclick: () => navigate(`#/gapchart/${show.show_id}`) },
            'Gap chart',
          )
        : null,
      el(
        'button.btn.btn-small',
        { type: 'button', onclick: () => navigate(`#/venue/${show.venue_id}`) },
        'Venue history',
      ),
    ]),
  );

  const rows = index.setlistByShow.get(Number(show.show_id)) || [];

  // Directly under the setlist, inside the same section, in both branches: the
  // link is a pointer to the source of THIS setlist, so it belongs against the
  // setlist rather than up in the action row. When no setlist was recorded it
  // matters more, not less -- it is where the reader goes to check.
  const sourceLink = () => el('div.link-row.setlist-source', null, [cartonLink(showPermalink(show))]);

  if (rows.length) {
    append(
      screen,
      el('div.section', null, [
        sectionHead('Setlist', el('span.badge.badge-set', { text: showStructure(index, show.show_id) || '' })),
        el('div.card', null, setlistBlock(rows, { index, onSong: (id) => navigate(`#/song/${id}`) })),
        sourceLink(),
      ]),
    );
  } else {
    append(
      screen,
      el('div.section', null, [
        sectionHead('Setlist'),
        emptyState('The Carton has no setlist recorded for this show.'),
        sourceLink(),
      ]),
    );
  }

  if (rows[0]?.shownotes) {
    append(
      screen,
      el('div.section', null, [
        sectionHead('Show notes'),
        el('div.card', null, el('p', { style: { margin: 0, fontSize: 'var(--t-sm)' }, text: rows[0].shownotes })),
      ]),
    );
  }

  append(screen, attribution());
  return screen;
}
