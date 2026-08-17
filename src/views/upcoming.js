// THE UPCOMING SHOW — the landing screen.
//
// Carton has no format data for future shows (show_tags is empty on all 804
// shows, and future shows have zero setlist rows), so this screen NEVER
// asserts a set structure. It shows observed history, labeled as history:
// what the same run has looked like so far, and what this venue has done
// before. Anything more would be a prediction.

import { el, append, openSheet, icon, ICONS } from '../ui/dom.js';
import {
  sectionHead,
  emptyState,
  setlistBlock,
  cartonLink,
  showPermalink,
  attribution,
} from '../ui/components.js';
import { showStructure, onThisDate, consecutiveRun } from '../data/index.js';
import { formatShowDate, formatShowDateShort, monthDayKey, localToday, daysBetween } from '../util/dates.js';

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

export function renderUpcoming(ctx) {
  const { index, navigate } = ctx;
  const screen = el('div.screen');

  const show = getSelectedShow(index);
  if (!show) {
    append(screen, el('h1.screen-title', { text: 'No upcoming shows' }));
    append(
      screen,
      el('p.screen-sub', {
        text: 'The Carton has no future-dated shows in the archive right now.',
      }),
    );
    append(screen, attribution());
    return screen;
  }

  const today = localToday();
  const daysAway = daysBetween(today, show.showdate);

  // --- Header: date, venue, city -------------------------------------------
  append(
    screen,
    el('div', { style: { display: 'flex', alignItems: 'flex-start', gap: '12px' } }, [
      el('div', { style: { flex: '1', minWidth: '0' } }, [
        el('div.section-title', {
          text: daysAway === 0 ? 'Tonight' : daysAway === 1 ? 'Tomorrow' : `In ${daysAway} days`,
        }),
        el('h1.screen-title', { text: formatShowDate(show.showdate) }),
        el('p.screen-sub', { text: `${show.venuename} · ${show.location}` }),
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

  // --- Format: explicitly NOT asserted -------------------------------------
  const venueShows = (index.showsByVenue.get(Number(show.venue_id)) || []).filter(
    (s) => s.showdate < show.showdate && index.setlistByShow.has(Number(s.show_id)),
  );

  const runShows = consecutiveRun(index, show.showdate).filter(
    (s) => s.showdate < show.showdate && index.setlistByShow.has(Number(s.show_id)),
  );

  const fmtSection = el('div.section');
  append(fmtSection, sectionHead('Set structure'));
  append(
    fmtSection,
    el('div.card', null, [
      el('p', {
        style: { margin: '0 0 10px', fontSize: 'var(--t-sm)', color: 'var(--ink-dim)' },
        text: 'The Carton does not record a format for upcoming shows. Below is what has actually been played, not what is expected.',
      }),
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
  );
  append(screen, fmtSection);

  // --- Venue play count -----------------------------------------------------
  const allVenueShows = (index.showsByVenue.get(Number(show.venue_id)) || []).filter(
    (s) => s.showdate <= today,
  );
  append(
    screen,
    el('div.section', null, [
      sectionHead('This venue'),
      el('div.stat-grid', null, [
        el('div.stat', null, [
          el('div.stat-value.accent.num', { text: String(allVenueShows.length) }),
          el('div.stat-label', { text: allVenueShows.length === 1 ? 'show played' : 'shows played' }),
        ]),
        el('div.stat', null, [
          el('div.stat-value.num', {
            text: allVenueShows.length ? formatShowDateShort(allVenueShows[allVenueShows.length - 1].showdate) : '—',
          }),
          el('div.stat-label', { text: 'most recent' }),
        ]),
      ]),
    ]),
  );

  // --- Last time at this venue ---------------------------------------------
  const lastAtVenue = allVenueShows.filter((s) => index.setlistByShow.has(Number(s.show_id))).pop();
  const venueSection = el('div.section');
  append(
    venueSection,
    sectionHead(
      'Last time here',
      lastAtVenue ? cartonLink(showPermalink(lastAtVenue), 'Carton') : null,
    ),
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

  // --- On this date ---------------------------------------------------------
  const md = monthDayKey(show.showdate);
  const anniversaries = onThisDate(index, md, show.show_id).filter((s) =>
    index.setlistByShow.has(Number(s.show_id)),
  );
  const otdSection = el('div.section');
  append(otdSection, sectionHead(`On this date (${md.replace('-', '/')})`));
  if (anniversaries.length) {
    for (const s of anniversaries.slice().reverse()) {
      append(
        otdSection,
        el('div.card', { style: { marginBottom: '10px' } }, [
          el('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px' } }, [
            el('div', { style: { fontWeight: '600' }, text: formatShowDate(s.showdate) }),
            cartonLink(showPermalink(s), 'Carton'),
          ]),
          el('div.note', { style: { marginBottom: '8px' }, text: `${s.venuename} · ${s.location}` }),
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
  } else {
    append(otdSection, emptyState('No shows played on this calendar date in past years.'));
  }
  append(screen, otdSection);

  append(screen, attribution());
  return screen;
}

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
              navigate('#/', true);
            },
          },
          [
            el('div', { style: { fontWeight: '600' }, text: formatShowDate(s.showdate) }),
            el('div.note', { text: `${s.venuename} · ${s.location}` }),
          ],
        ),
      );
    }
    return list;
  });
}
