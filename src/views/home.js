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
  setlistCard,
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
  formatMonthDay,
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

  // THE CARTON LINK IS NOT APPENDED HERE ANY MORE. It stood alone on its own
  // line directly under the venue line, and .carton-link carries
  // `min-height: var(--tap)` -- a 44px box around 10px text, with nothing
  // beside it to share the height. That was most of the dead space above the
  // set structure block. It now sits in the action row below, next to Venue
  // history, where the same 44px is height the row needed anyway.
  const allVenueShows = (index.showsByVenue.get(Number(show.venue_id)) || []).filter(
    (s) => s.showdate <= today,
  );
  const playedAtVenue = allVenueShows.filter((s) => index.setlistByShow.has(Number(s.show_id)));

  // --- The venue's history at a glance --------------------------------------
  //
  // NO SECTION HEADER. This block used to open with sectionHead(venuename),
  // which repeated the venue name already rendered two lines above it in
  // "Buffalo Iron Works · Buffalo, NY, USA". Saying it twice inside two inches
  // is what made the area read as empty: a heading that carries no information
  // the reader does not already have is spacing with words in it.
  //
  // The stat grid is the first thing in the block now, so it sits directly
  // under the venue line, which is what it is about.
  append(
    screen,
    el('div.section', null, [
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
        // DELIBERATELY UNCHANGED, only moved. Still .carton-link: --t-2xs at
        // weight 400 in --ink-faint, no border, no button treatment. It sits
        // BESIDE a control without becoming one -- .card-actions is
        // `align-items: center`, so it centres against the 36px button without
        // any rule of its own. Promoting it here would undo the 0.1.45
        // decision recorded above .carton-link in app.css: attribution must be
        // present and findable, not prominent.
        cartonLink(showPermalink(show)),
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
      setlistCard({
        index,
        rows: index.setlistByShow.get(Number(lastAtVenue.show_id)) || [],
        onSong: (id) => navigate(`#/song/${id}`),
        head: el('div', {
          style: { fontWeight: '600' },
          text: formatShowDate(lastAtVenue.showdate),
        }),
        showId: lastAtVenue.show_id,
        navigate,
      }),
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
      setlistCard({
        index,
        rows: index.setlistByShow.get(Number(latest.show_id)) || [],
        onSong: (id) => navigate(`#/song/${id}`),
        head: el('div', null, [
          el('div', { style: { fontWeight: '650' }, text: formatShowDate(latest.showdate) }),
          venueLine(latest),
        ]),
        showId: latest.show_id,
        navigate,
      }),
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
  append(section, sectionHead(`On this date (${formatMonthDay(md)})`));

  if (!anniversaries.length) {
    append(section, emptyState('No shows played on this calendar date in past years.'));
    append(screen, section);
    return;
  }

  for (const s of anniversaries.slice().reverse()) {
    append(
      section,
      setlistCard({
        style: { marginBottom: '10px' },
        index,
        rows: index.setlistByShow.get(Number(s.show_id)) || [],
        onSong: (id) => navigate(`#/song/${id}`),
        head: el('div', null, [
          el('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px' } }, [
            el('div', { style: { fontWeight: '600' }, text: formatShowDate(s.showdate) }),
            cartonLink(showPermalink(s), 'Carton'),
          ]),
          venueLine(s),
        ]),
        showId: s.show_id,
        navigate,
      }),
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
            venueLine(s),
          ],
        ),
      );
    }
    return list;
  });
}
