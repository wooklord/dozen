// VENUE — every show at one venue.
//
// Identity is venue_id, never the name: 9 venue names in this archive exist in
// more than one city (Brooklyn Bowl is in three), so grouping by name would
// merge distinct venues.
//
// Counting and ordering only. Format is shown where setlist data establishes
// it, and never asserted for an upcoming show.

import { el, append, icon, ICONS } from '../ui/dom.js';
import {
  attribution,
  cartonLink,
  venuePermalink,
  venueInfoLink,
  showPermalink,
  sectionHead,
  emptyState,
  statTile,
  statValue,
  venueLine,
} from '../ui/components.js';
import { showStructure } from '../data/index.js';
import { formatShowDate, formatShowDateShort } from '../util/dates.js';

export function renderVenue(ctx, venueId) {
  const { index, navigate } = ctx;
  const screen = el('div.screen');
  const venue = index.venuesById.get(Number(venueId));

  append(
    screen,
    el('button.chip', { type: 'button', onclick: () => history.back(), style: { marginBottom: '12px' } }, [
      icon(ICONS.back, 16),
      'Back',
    ]),
  );

  if (!venue) {
    append(screen, el('h1.screen-title', { text: 'Venue not found' }));
    append(screen, attribution());
    return screen;
  }

  append(screen, el('h1.screen-title', { text: venue.venuename }));
  append(
    screen,
    el('div.venue-line', null, [
      el('span.place', {
        text: [venue.city, venue.state, venue.country].filter(Boolean).join(', '),
      }),
    ]),
  );
  // "Venue info" leads: it is the outbound Maps deep link, built from Carton's
  // own fields and rendered only when there is a usable query, and on a venue
  // screen it answers the more immediate question. The Carton link follows,
  // quieter and smaller. Credit is not carried by this row -- attribution()
  // names The Carton and Songfish at the foot of every screen.
  append(
    screen,
    el('div.link-row', null, [
      venueInfoLink(venue),
      cartonLink(venuePermalink(venue), 'View on The Carton'),
    ]),
  );

  const all = (index.showsByVenue.get(Number(venue.venue_id)) || []).slice();
  const played = all.filter((s) => s.showdate <= index.today);
  const upcoming = all.filter((s) => s.showdate > index.today);
  const withSetlist = played.filter((s) => index.setlistByShow.has(Number(s.show_id)));

  // --- Counts ---------------------------------------------------------------
  append(
    screen,
    el('div.section', null, [
      el('div.stat-grid', null, [
        el('div.stat', null, [
          statValue(played.length, { accent: true }),
          el('div.stat-label', { text: played.length === 1 ? 'show played' : 'shows played' }),
        ]),
        statTile(played.length ? formatShowDateShort(played[0].showdate) : '—', 'first show'),
        statTile(
          played.length ? formatShowDateShort(played[played.length - 1].showdate) : '—',
          'most recent',
        ),
        statTile(upcoming.length, 'upcoming'),
      ]),
      // The counts and the list must not appear to disagree, so the gap
      // between "played" and "has a setlist" is stated rather than implied.
      played.length !== withSetlist.length
        ? el('p.note', {
            style: { marginTop: '8px' },
            text:
              `${withSetlist.length} of these ${played.length} shows ${withSetlist.length === 1 ? 'has' : 'have'} ` +
              `a setlist recorded on The Carton; the rest are listed below marked as such.`,
          })
        : null,
    ]),
  );

  // --- Every show, newest first --------------------------------------------
  const listSection = el('div.section');
  append(listSection, sectionHead(`Every show (${all.length})`));

  if (!all.length) {
    append(listSection, emptyState('No shows recorded at this venue.'));
  } else {
    const list = el('ul.rows');
    for (const show of all.slice().reverse()) {
      const hasSetlist = index.setlistByShow.has(Number(show.show_id));
      const isUpcoming = show.showdate > index.today;
      append(
        list,
        el('li', null, [
          el('div.row-shell', null, [
            el(
              'button.row',
              { type: 'button', onclick: () => navigate(`#/show/${show.show_id}`) },
              [
                el('div.row-main', null, [
                  el('div.row-title', { text: formatShowDate(show.showdate) }),
                  el('div.row-meta', null, [
                    show.showtitle ? el('span', { text: show.showtitle }) : null,
                    el('span', { text: show.tourname && show.tourname !== 'Not Part of a Tour' ? show.tourname : '' }),
                  ]),
                ]),
                hasSetlist
                  ? el('span.badge.badge-set', { text: showStructure(index, show.show_id) || '' })
                  : el('span.badge', { text: isUpcoming ? 'Upcoming' : 'No setlist recorded' }),
              ],
            ),
            hasSetlist
              ? el(
                  'button.row-action',
                  {
                    type: 'button',
                    'aria-label': `Gap chart for ${show.showdate}`,
                    onclick: () => navigate(`#/gapchart/${show.show_id}`),
                  },
                  icon(ICONS.gap, 18),
                )
              : null,
          ]),
        ]),
      );
    }
    append(listSection, list);
  }
  append(screen, listSection);

  append(screen, attribution());
  return screen;
}
