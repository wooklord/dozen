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
  setlistCard,
  cartonLink,
  showPermalink,
  venueLine,
  statValue,
  attribution,
} from '../ui/components.js';
import { showStructure, onThisDate, previousSetStructures } from '../data/index.js';
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

  const allVenueShows = (index.showsByVenue.get(Number(show.venue_id)) || []).filter(
    (s) => s.showdate <= today,
  );

  // --- The upcoming show, as ONE OBJECT (0.1.74) ----------------------------
  //
  // Everything in this card belongs to the show: the countdown, the date, the
  // venue, how often this venue has been played, and the two ways out of here.
  // It used to be a bare stack -- kicker, h1, venue line, then a .section
  // holding the stat grid -- and the stat grid ended up equidistant between the
  // venue line it describes (25px above) and the reference section below it
  // (23px). The reader had nothing to tell them which side it belonged to.
  //
  // A CARD RATHER THAN A RULE OR MORE SPACING. The page's problem was that its
  // headline and its reference material rendered as peers; spacing makes that
  // a judgement about gaps, an edge makes it a fact. Everything below this card
  // is reference, and the card boundary is what says so.
  //
  // THE KICKER IS NOT A .section-title ANY MORE, and that was half the flatness
  // on its own: "IN 81 DAYS", "PREVIOUS SHOWS" and "ON THIS DATE" were the same
  // element at the same weight, so the page had three headings of equal rank
  // and no way to say which one was the point. .hero-kicker is a label ON the
  // date beneath it, so it takes the 11px fine-print size that .section-title
  // deliberately moved off in 0.1.45 -- it is not a heading and must not read
  // as one.
  const hero = el('div.hero', null, [
    el('div.hero-head', null, [
      el('div', { style: { flex: '1', minWidth: '0' } }, [
        el('div.hero-kicker', {
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
    // NO SECTION HEADER, and the reason is unchanged from 0.1.69: a header here
    // would repeat the venue name rendered two lines above it. The stat grid is
    // the first thing after the venue line because it is about that venue.
    //
    // It bleeds to the card's edges rather than sitting inset -- see .hero
    // .stat-grid in app.css. A bordered tile inside a bordered card reads as a
    // second object; a full-width band with hairlines reads as part of this one.
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
  ]);
  append(screen, hero);

  // --- Previous shows: ONE section, was two (0.1.74) -------------------------
  //
  // "Previous set structures" and "Last time at {venue}" were two headers over
  // the same history, and the top row of the structure list WAS the show in the
  // card below it -- `venueRows[0]` and the old `lastAtVenue` resolve to the
  // same show by construction, both being the newest show at this venue with a
  // recorded setlist. Toad's Place rendered "Nov 26, 2025  S1+S2+E" and then,
  // 250px lower, "Wed, Nov 26, 2025" with SET 1 / SET 2 / ENCORE spelled out.
  // The same fact, twice, in two typographic registers.
  //
  // So it is one card: the most recent visit in full, then a rule, then the
  // visits before it as one-liners. The expanded visit is the one you read; the
  // rest are the index you scan.
  //
  // THE EXPANDED ROW DROPS ITS STRUCTURE SUMMARY. "S1+S2+E" is a stand-in for a
  // setlist you cannot see, and this row is the setlist -- printing the summary
  // above SET 1 / SET 2 / ENCORE would reintroduce, one level down, the exact
  // duplication this merge exists to remove.
  //
  // ONE SOURCE FOR THE LIST. `lastAtVenue` used to be computed here from its own
  // filter of showsByVenue while the list came from previousSetStructures(); two
  // derivations of one fact that agreed only because nobody had changed either.
  // The card reads venueRows[0] now, so they cannot drift apart.
  const { venueRows, runRows } = previousSetStructures(index, show);
  const lastVisit = venueRows[0] || null;
  const earlierVisits = venueRows.slice(1);

  // .visit-list, not a bare .fn-list (0.1.74). The merged card contains TWO
  // fn-lists -- these visit one-liners and the setlist's own footnotes -- and
  // with nothing to tell them apart, anything reading "the rows in this card"
  // silently counted footnotes as visits. The smoke check for the merge was
  // written that way and passed only because the show it happened to walk to
  // had a setlist with no footnotes. Its own class, so the two are different
  // things in the DOM as well as in the head.
  //
  // The date's colour and weight moved into that class at the same time. They
  // were an inline style, which is the one place a palette change cannot reach.
  const structureList = (rows) =>
    el(
      'ul.fn-list.visit-list',
      null,
      rows.map((s) =>
        el('li', null, [
          el('span.visit-date', { text: formatShowDateShort(s.showdate) }),
          el('span', { text: showStructure(index, s.show_id) || '—' }),
        ]),
      ),
    );

  // "Earlier in this run" KEEPS ITS LABEL. It is the named subset -- a different
  // criterion from the list above, at other venues -- and nothing else on the
  // screen says so.
  //
  // It is also why this header does NOT name the venue. 0.1.69 gave "Last time
  // at {venue}" the name because it sat a whole block below the hero venue line
  // and labelled a card that was otherwise just a date; the merge removed that
  // distance -- this section now follows the hero card directly, and the stat
  // beside it already reads "MOST RECENT · Nov 26, 2025", which is the date
  // heading the card. Naming the venue here would also be wrong for the run
  // rows, which are at OTHER venues. So the header stays generic, the venue
  // list stays unlabelled under it (0.1.72's reasoning, unchanged), and the run
  // list keeps the label that marks it as the exception.
  const runBlock = runRows.length
    ? el('div', { style: { marginTop: earlierVisits.length || lastVisit ? '12px' : '0' } }, [
        el('div.section-title', { text: 'Earlier in this run' }),
        structureList(runRows),
      ])
    : null;

  const previous = el('div.section');
  append(previous, sectionHead('Previous shows'));

  if (lastVisit) {
    const foot =
      earlierVisits.length || runBlock
        ? el('div.card-foot', null, [
            earlierVisits.length ? structureList(earlierVisits) : null,
            runBlock,
          ])
        : null;
    append(
      previous,
      setlistCard({
        index,
        rows: index.setlistByShow.get(Number(lastVisit.show_id)) || [],
        onSong: (id) => navigate(`#/song/${id}`),
        head: el('div', {
          style: { fontWeight: '600' },
          text: formatShowDate(lastVisit.showdate),
        }),
        showId: lastVisit.show_id,
        navigate,
        // The Carton link used to sit in the "Last time at {venue}" section
        // head. That head is gone, and the link belongs to this show rather
        // than to the section, so it goes where every other per-show Carton
        // link goes: beside Show detail in the card's own action row.
        extraActions: [cartonLink(showPermalink(lastVisit), 'Carton')],
        foot,
      }),
    );
  } else if (runBlock) {
    append(previous, el('div.card', null, [runBlock]));
  } else {
    // ONE empty state, not two. A venue with no recorded history used to
    // produce "No played shows at this venue or earlier in this run." and then
    // "No previous setlist recorded at this venue." -- 154px of two sentences
    // saying nothing, twice. Five of the seventeen upcoming shows are at a
    // venue with no prior visit, so this is the common case, not the edge.
    append(
      previous,
      el('div.card', null, [
        el('p.note', {
          style: { margin: '0' },
          text: 'No played shows at this venue or earlier in this run.',
        }),
      ]),
    );
  }
  append(screen, previous);
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
