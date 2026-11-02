// SHOW DETAIL — one show's full setlist, its gap chart and its jam chart
// entries, reached from a song's history, a card, a row, or a venue.

import { el, append, icon, ICONS } from '../ui/dom.js';
import {
  setlistBlock,
  attribution,
  cartonRow,
  showPermalink,
  gapChartPermalink,
  sectionHead,
  emptyState,
  venueLine,
  venueInfoButton,
  titleChip,
  openGapExplainer,
  heatFor,
} from '../ui/components.js';
import { showStructure, tourName, gapChartForShow } from '../data/index.js';
import { openGapHistory } from './gaphistory.js';
import { formatShowDate, formatShowDateShort } from '../util/dates.js';

export function renderShow(ctx, showId) {
  const { index, navigate } = ctx;
  const screen = el('div.screen');
  const show = index.showsById.get(Number(showId));

  const backChip = () =>
    el('button.chip', { type: 'button', onclick: () => history.back(), style: { marginBottom: '12px' } }, [
      icon(ICONS.back, 16),
      'Back',
    ]);

  if (!show) {
    append(screen, backChip());
    append(screen, el('h1.screen-title', { text: 'Show not found' }));
    return screen;
  }

  // --- Header, and the chip that stands in for it (0.1.90) -------------------
  //
  // The song pages' pattern: a 0px sticky bar first, laid over the content, and
  // titleChip() shows the chip once the title has gone under the header, so
  // showing it moves nothing. The title here is two lines, the date heading
  // and the venue line, and the chip watches the SECOND: it appears once the
  // whole block is gone, not while the venue is still on screen under it.
  // Focus still goes to the date heading, the screen's h1. The chip is the
  // compact form, the short date and the venue name, picked over the two-line
  // block for its cost at 360x640 (docs/plan.md, "Show detail layout", item
  // 4); like the song chip it wraps on a long name and never truncates. The
  // tour line is left out of it, as it was left out of the sheet's show line.
  const title = el('h1.screen-title', { text: formatShowDate(show.showdate) });
  const venue = venueLine(show);
  const titleBar = el('div.title-bar-inner');
  append(
    titleBar,
    titleChip(ctx, `${formatShowDateShort(show.showdate)} · ${show.venuename}`, title, { bar: titleBar, watch: venue }),
  );
  append(screen, el('div.title-bar', null, titleBar));

  append(screen, backChip());
  append(screen, title);
  append(screen, venue);
  // The tour, named as Carton names it, and nothing for tour_id 1 -- see
  // tourName(). "Part of" because three of the eleven names do not say
  // "tour" (Winter 2020, Quarantine Streams, Winter 2022), and a bare
  // "Winter 2020" under a venue reads as a date. Plain text: the filter that
  // would make it a control is parked (docs/plan.md, Tours).
  const tour = tourName(show);
  if (tour) append(screen, el('p.show-tour', { text: `Part of ${tour}` }));
  const rows = index.setlistByShow.get(Number(show.show_id)) || [];

  // The links to this show's setlist and gap chart on The Carton are one row at
  // the foot of the screen (0.1.92, cartonRow below). Until then the setlist's
  // hung under its card at 2px and the chart's under its rows, each in a 44px
  // box of its own.

  // The jam key and the "Jam chart entries" section are NOT built here.
  // setlistBlock returns the section beside the setlist, built by the same
  // function that paints the green and builds the cards' Jam notes button, so
  // this screen cannot offer both forms or neither (0.1.90, docs/plan.md,
  // "Show detail layout", item 1). It is placed below, after the gap chart.
  //
  // Show notes belong INSIDE the setlist card, last: setlist -> footnotes ->
  // notes. They annotate this setlist, so a card of their own below put a
  // border between a note and the thing it is a note about.
  //
  // No separate guard needed for the no-setlist branch: `shownotes` is a field
  // on setlist ROWS (repeated on every row of a show), so with no rows there is
  // nothing to read it from. Notes cannot exist without a card to sit in.
  const showNotes = () => {
    const text = rows[0]?.shownotes;
    if (!text) return null;
    return el('div.setlist-shownotes', null, [
      el('div.setlist-note-label', { text: 'Show notes' }),
      el('p.setlist-note-text', { text }),
    ]);
  };

  let entries = null;
  if (rows.length) {
    const block = setlistBlock(rows, { index, onSong: (id) => navigate(`#/song/${id}`) });
    entries = block.entries;
    append(
      screen,
      el('div.section', null, [
        sectionHead('Setlist', el('span.badge.badge-set', { text: showStructure(index, show.show_id) || '' })),
        el('div.card', null, [block.setlist, showNotes()]),
      ]),
    );
  } else {
    append(
      screen,
      el('div.section', null, [
        sectionHead('Setlist'),
        emptyState('The Carton has no setlist recorded for this show.'),
      ]),
    );
  }

  // --- The gap chart, inline (0.1.90) ----------------------------------------
  //
  // Every song in this night's setlist with its gap AS OF this show, through
  // gapChartForShow() and gapAtShow(), the one function every gap in the app
  // comes from. This is NOT archive-wide rotation: a song played the show
  // before reads 1 here even if it has since gone cold, which is what the note
  // under the heading says. It was its own route until 0.1.90; the chart is
  // this show's, so it sits with the show, between the setlist it reads
  // against and the entries, grouped by set in played order. A row opens that
  // song's gap history, stamped as opened from this show so the history's back
  // link returns here; the figure keeps its own target and explains how it was
  // counted. Carton's own chart for the night is linked under the rows, ours
  // labelled, theirs verbatim at the source, both true.
  //
  // One entry per song, not per performance, is gapChartForShow()'s rule: a
  // repeat carries "N× tonight" rather than the same figure twice.
  const chart = rows.length ? gapChartForShow(index, show.show_id) : [];
  if (chart.length) {
    const maxGap = chart.reduce((m, e) => Math.max(m, e.gap ?? 0), 1);
    const groups = [];
    for (const e of chart) {
      let g = groups[groups.length - 1];
      if (!g || g.label !== e.setLabel) {
        g = { label: e.setLabel, entries: [] };
        groups.push(g);
      }
      g.entries.push(e);
    }
    const section = el('div.section.gap-chart', null, [
      sectionHead(
        'Gap chart',
        el('button.inline-link', {
          type: 'button',
          text: 'How gap is counted',
          onclick: () => openGapExplainer(index, { atShow: true }),
        }),
      ),
      el('p.note.gap-chart-intro', {
        text:
          'How many shows had passed since each song was last played, counted as of this ' +
          'date. A song’s gap today is a different number — it keeps growing until the song ' +
          'is played again.',
      }),
    ]);
    for (const g of groups) {
      const list = el('ul.rows');
      for (const e of g.entries) {
        append(
          list,
          el('li', null, [
            // data-song-id: the row's identity, as on the Songs rows, so a check
            // can hold where the row goes to what the row is.
            el('div.row-shell', { 'data-song-id': String(e.song_id) }, [
              el('span.gap-bar', {
                style: { '--heat': String(heatFor(e.gap, maxGap)) },
                'data-heat': e.gap === null ? 'none' : null,
              }),
              el(
                'button.row',
                { type: 'button', onclick: () => openGapHistory(navigate, e.song_id, { fromShow: show.show_id }) },
                [
                  el('div.row-main', null, [
                    el('div.row-title', { text: e.songname }),
                    el('div.row-meta', null, [
                      e.isDebut
                        ? el('span', { text: 'First time played' })
                        : el('span', {
                            text: e.previous ? `Previously ${formatShowDateShort(e.previous.showdate)}` : '',
                          }),
                      // Played more than once this night -- shown as a count so
                      // the gap figure is not repeated as if it were two facts.
                      e.occurrences > 1 ? el('span.badge', { text: `${e.occurrences}× tonight` }) : null,
                    ]),
                  ]),
                ],
              ),
              // Debut is not a gap: gap 1 means "played at the show before",
              // gap 0 "a second performance on the same date". Carton prints the
              // debut date's position on a debut row; here it is a badge
              // (ruling 2026-10-24, decision 1), the plain badge since 0.1.85:
              // green means jam chart only.
              e.isDebut
                ? el('div.gap-figure', null, [el('span.badge', { text: 'Debut' })])
                : el(
                    'button.gap-figure',
                    {
                      type: 'button',
                      'aria-label': `${e.gap} shows since previously played. How gap is counted`,
                      onclick: (ev) => {
                        ev.stopPropagation();
                        openGapExplainer(index, { atShow: true });
                      },
                    },
                    [el('div.gap-num.num', { text: String(e.gap) }), el('div.gap-unit', { text: 'shows' })],
                  ),
            ]),
          ]),
        );
      }
      // Its own class, styled by the set labels' rule: .setlist-label means a
      // set in the setlist, and a check that counts a show's sets reads it.
      append(section, el('div.gap-chart-set', null, [el('div.gap-chart-label', { text: g.label }), list]));
    }
    append(screen, section);
  }

  // --- Jam chart entries for THIS show, in setlist order ---------------------
  //
  // After the chart and under the setlist, so a green title above has its note
  // below, in the sequence it was played. Built by setlistBlock; see above.
  if (entries) append(screen, entries);

  // --- Actions, BELOW the content ------------------------------------------
  //
  // Full venue history and Venue info. These sat between the venue line and the
  // SETLIST heading until 0.1.72, which put controls in front of the one thing
  // this screen exists to show. Same reasoning as the Home cards: the setlist
  // is what the screen is opened to read. Gap chart was the third control here
  // until 0.1.90, when the chart became a section of this screen.
  //
  // BELOW THE JAM SECTION, NOT DIRECTLY UNDER THE SETLIST CARD: the gap chart
  // and the jam chart entries read AGAINST the setlist, in played order, and a
  // button row between them would break the correspondence those sections are
  // built on. (Until 0.1.92 the setlist's Carton link also hung under the card,
  // which was the first reason given here.)
  //
  // So the row goes after all of it, before the Carton row and the attribution:
  // every control on this screen follows every piece of content on it.
  //
  // Venue info wears the small-button treatment (0.1.36) so the row reads as
  // one set, and drops out entirely when the venue has no usable Maps query --
  // no empty control, no disabled one.
  append(
    screen,
    el('div.card-actions.screen-actions', null, [
      el(
        'button.btn.btn-small',
        { type: 'button', onclick: () => navigate(`#/venue/${show.venue_id}`) },
        'Full venue history',
      ),
      venueInfoButton(show),
    ]),
  );

  append(screen, cartonRow([['Setlist', showPermalink(show)], ['Gap chart', gapChartPermalink(show)]]));
  append(screen, attribution());
  return screen;
}
