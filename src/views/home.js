// HOME — the landing screen.
//
// Leads with the next show when there is one, but it is not only a next-show
// screen: venue history and On This Date are first-class here, and they are
// why Home is never empty. When the archive has no future-dated show, the
// screen still has plenty to say.
//
// Carton records no format for upcoming shows (show_tags is empty on all 804
// shows, and future shows have zero setlist rows), so NOTHING here asserts a
// set structure for a show that has not happened. What is shown is observed
// history.

import { el, append, openSheet } from '../ui/dom.js';
import {
  sectionHead,
  emptyState,
  setlistBlock,
  cartonLink,
  showPermalink,
  venueLine,
  statValue,
  attribution,
} from '../ui/components.js';
import { showStructure, onThisDate, consecutiveRun } from '../data/index.js';
import {
  formatShowDate,
  formatShowDateShort,
  monthDayKey,
  localToday,
  daysBetween,
} from '../util/dates.js';

const SELECTED_KEY = 'dozen.selectedShow.v1';

/**
 * The user's chosen show persists across reloads: during a run they are
 * looking at tomorrow's show and it must not snap forward. The stored choice
 * is dropped only once that show's date has passed.
 */
function getSelectedShow(index) {
  const future = index.futureShows;
  if (!future.length) return null;
  try {
    const stored = localStorage.getItem(SELECTED_KEY);
    if (stored) {
      const match = future.find((s) => String(s.show_id) === stored);
      if (match) return match;
      localStorage.removeItem(SELECTED_KEY); // its date has passed
    }
  } catch {
    /* storage unavailable; fall through to the nearest show */
  }
  return future[0];
}

function setSelectedShow(showId) {
  try {
    localStorage.setItem(SELECTED_KEY, String(showId));
  } catch {
    /* non-fatal */
  }
}

export function renderHome(ctx) {
  const { index, navigate } = ctx;
  const screen = el('div.screen');
  const today = localToday();
  const show = getSelectedShow(index);

  // "On this date" keys off the upcoming show when there is one, and off today
  // otherwise -- so this section always has something to show.
  const anchorDate = show ? show.showdate : today;

  if (show) {
    renderNextShow(screen, ctx, show, today);
  } else {
    renderNoUpcoming(screen, ctx, today);
  }

  renderOnThisDate(screen, ctx, anchorDate, show?.show_id);

  append(screen, attribution());
  return screen;
}

// ------------------------------------------------------------ next show ----

function renderNextShow(screen, { index, navigate }, show, today) {
  const daysAway = daysBetween(today, show.showdate);

  append(
    screen,
    el('div', { style: { display: 'flex', alignItems: 'flex-start', gap: '12px' } }, [
      el('div', { style: { flex: '1', minWidth: '0' } }, [
        el('div.section-title', {
          text: daysAway === 0 ? 'Tonight' : daysAway === 1 ? 'Tomorrow' : `In ${daysAway} days`,
        }),
        el('h1.screen-title', { text: formatShowDate(show.showdate) }),
        venueLine(show),
      ]),
      index.futureShows.length > 1
        ? el(
            'button.chip',
            {
              type: 'button',
              onclick: () => openShowPicker(index, navigate),
              'aria-label': 'Choose a different upcoming show',
            },
            'Change',
          )
        : null,
    ]),
  );

  append(screen, cartonLink(showPermalink(show)));

  const allVenueShows = (index.showsByVenue.get(Number(show.venue_id)) || []).filter(
    (s) => s.showdate <= today,
  );
  const playedAtVenue = allVenueShows.filter((s) => index.setlistByShow.has(Number(s.show_id)));

  // --- The venue itself, named ----------------------------------------------
  append(
    screen,
    el('div.section', null, [
      sectionHead(show.venuename),
      el('div.stat-grid', null, [
        el('div.stat', null, [
          statValue(allVenueShows.length, { accent: true }),
          el('div.stat-label', {
            text: allVenueShows.length === 1 ? 'show played here' : 'shows played here',
          }),
        ]),
        el('div.stat', null, [
          statValue(
            allVenueShows.length
              ? formatShowDateShort(allVenueShows[allVenueShows.length - 1].showdate)
              : '—',
          ),
          el('div.stat-label', { text: 'most recent' }),
        ]),
      ]),
      el('div.card-actions', null, [
        el(
          'button.btn.btn-small',
          { type: 'button', onclick: () => navigate(`#/venue/${show.venue_id}`) },
          'Venue history',
        ),
      ]),
    ]),
  );

  // --- Set structure: observed history only ---------------------------------
  const venueShows = (index.showsByVenue.get(Number(show.venue_id)) || []).filter(
    (s) => s.showdate < show.showdate && index.setlistByShow.has(Number(s.show_id)),
  );
  const runShows = consecutiveRun(index, show.showdate).filter(
    (s) => s.showdate < show.showdate && index.setlistByShow.has(Number(s.show_id)),
  );

  append(
    screen,
    el('div.section', null, [
      sectionHead('Set structure'),
      el('div.card', null, [
        runShows.length
          ? el('div', null, [
              el('div.section-title', { text: 'Earlier in this run' }),
              el(
                'ul.fn-list',
                null,
                runShows.map((s) =>
                  el('li', null, [
                    el('span', {
                      style: { color: 'var(--yolk)', fontWeight: '700' },
                      text: formatShowDateShort(s.showdate),
                    }),
                    el('span', { text: showStructure(index, s.show_id) || '—' }),
                  ]),
                ),
              ),
            ])
          : null,
        venueShows.length
          ? el('div', { style: { marginTop: runShows.length ? '12px' : '0' } }, [
              el('div.section-title', { text: `Previously at ${show.venuename}` }),
              el(
                'ul.fn-list',
                null,
                venueShows
                  .slice(-5)
                  .reverse()
                  .map((s) =>
                    el('li', null, [
                      el('span', {
                        style: { color: 'var(--yolk)', fontWeight: '700' },
                        text: formatShowDateShort(s.showdate),
                      }),
                      el('span', { text: showStructure(index, s.show_id) || '—' }),
                    ]),
                  ),
              ),
            ])
          : null,
        !runShows.length && !venueShows.length
          ? el('p.note', { text: 'No played shows at this venue or earlier in this run.' })
          : null,
      ]),
    ]),
  );

  // --- Last time at this venue ----------------------------------------------
  const lastAtVenue = playedAtVenue[playedAtVenue.length - 1];
  const venueSection = el('div.section');
  append(
    venueSection,
    sectionHead('Last time here', lastAtVenue ? cartonLink(showPermalink(lastAtVenue), 'Carton') : null),
  );
  if (lastAtVenue) {
    append(
      venueSection,
      el('div.card', null, [
        el('div', {
          style: { marginBottom: '10px', fontWeight: '600' },
          text: formatShowDate(lastAtVenue.showdate),
        }),
        el('div.card-actions', { style: { marginBottom: '10px' } }, [
          el(
            'button.btn.btn-small',
            { type: 'button', onclick: () => navigate(`#/gapchart/${lastAtVenue.show_id}`) },
            'Gap chart',
          ),
        ]),
        setlistBlock(index.setlistByShow.get(Number(lastAtVenue.show_id)) || [], {
          index,
          onSong: (id) => navigate(`#/song/${id}`),
        }),
      ]),
    );
  } else {
    append(venueSection, emptyState('No previous setlist recorded at this venue.'));
  }
  append(screen, venueSection);
}

// ------------------------------------------------------- no upcoming show ---

/**
 * There is no future-dated show in the archive. Home still leads with
 * something real -- the most recent show played -- rather than a bare
 * "nothing here".
 */
function renderNoUpcoming(screen, { index, navigate }, today) {
  const latest = index.countedShows[index.countedShows.length - 1];

  append(screen, el('div.section-title', { text: 'No upcoming shows' }));
  append(screen, el('h1.screen-title', { text: 'Nothing on the books' }));
  append(
    screen,
    el('p.screen-sub', {
      text: 'The Carton has no future-dated shows in the archive right now.',
    }),
  );

  if (!latest) return;

  append(
    screen,
    el('div.section', null, [
      sectionHead('Most recent show', cartonLink(showPermalink(latest), 'Carton')),
      el('div.card', null, [
        el('div', { style: { fontWeight: '650' }, text: formatShowDate(latest.showdate) }),
        venueLine(latest, { small: true }),
        el('div.card-actions', null, [
          el(
            'button.btn.btn-small',
            { type: 'button', onclick: () => navigate(`#/show/${latest.show_id}`) },
            'Show detail',
          ),
          el(
            'button.btn.btn-small',
            { type: 'button', onclick: () => navigate(`#/gapchart/${latest.show_id}`) },
            'Gap chart',
          ),
        ]),
        el('div', { style: { marginTop: '12px' } }, setlistBlock(
          index.setlistByShow.get(Number(latest.show_id)) || [],
          { index, onSong: (id) => navigate(`#/song/${id}`) },
        )),
      ]),
    ]),
  );
}

// ----------------------------------------------------------- on this date ---

function renderOnThisDate(screen, { index, navigate }, anchorDate, excludeShowId) {
  const md = monthDayKey(anchorDate);
  const anniversaries = onThisDate(index, md, excludeShowId).filter((s) =>
    index.setlistByShow.has(Number(s.show_id)),
  );

  const section = el('div.section');
  append(section, sectionHead(`On this date (${md.replace('-', '/')})`));

  if (!anniversaries.length) {
    append(section, emptyState('No shows played on this calendar date in past years.'));
    append(screen, section);
    return;
  }

  for (const s of anniversaries.slice().reverse()) {
    append(
      section,
      el('div.card', { style: { marginBottom: '10px' } }, [
        el('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px' } }, [
          el('div', { style: { fontWeight: '600' }, text: formatShowDate(s.showdate) }),
          cartonLink(showPermalink(s), 'Carton'),
        ]),
        venueLine(s, { small: true }),
        el('div.card-actions', { style: { marginBottom: '8px' } }, [
          el(
            'button.btn.btn-small',
            { type: 'button', onclick: () => navigate(`#/gapchart/${s.show_id}`) },
            'Gap chart',
          ),
        ]),
        setlistBlock(index.setlistByShow.get(Number(s.show_id)) || [], {
          index,
          onSong: (id) => navigate(`#/song/${id}`),
        }),
      ]),
    );
  }
  append(screen, section);
}

// ---------------------------------------------------------------- picker ---

function openShowPicker(index, navigate) {
  openSheet('Upcoming shows', (close) => {
    const list = el('div');
    for (const s of index.futureShows) {
      append(
        list,
        el(
          'button.sheet-item',
          {
            type: 'button',
            onclick: () => {
              setSelectedShow(s.show_id);
              close();
              navigate('#/home', true);
            },
          },
          [
            el('div', { style: { fontWeight: '600' }, text: formatShowDate(s.showdate) }),
            venueLine(s, { small: true }),
          ],
        ),
      );
    }
    return list;
  });
}
