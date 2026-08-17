// SHOWS — the shows view, with search.
//
// Replaces the old Recent screen rather than sitting beside it. The empty-query
// landing state is exactly what Recent did: the most recent shows, newest
// first. Search and "load older" are the two ways past that.
//
// Everything here is filtering, grouping, counting and ordering.

import { el, append, debounce, icon, ICONS } from '../ui/dom.js';
import {
  setlistBlock,
  cartonLink,
  showPermalink,
  attribution,
  sectionHead,
  emptyState,
} from '../ui/components.js';
import { showStructure, compareVenuesByName } from '../data/index.js';
import { formatShowDate, formatShowDateShort } from '../util/dates.js';
import { parseDateQuery, matchShowsByDate, matchVenues, matchReasonLabel } from '../util/search.js';

const PAGE = 15;

// Module-level so the screen keeps its place across navigation.
const state = {
  query: '',
  limit: PAGE,
};

export function renderShows(ctx) {
  const { index, navigate } = ctx;
  const screen = el('div.screen');

  append(screen, el('h1.screen-title', { text: 'Shows' }));
  append(
    screen,
    el('p.screen-sub', {
      text: `${index.counts.shows} shows in the archive. Search a venue, city, state or date.`,
    }),
  );

  const search = el('input.search', {
    type: 'search',
    placeholder: 'Venue, city, or date (8/7/26, august 2026, 2019)…',
    value: state.query,
    autocomplete: 'off',
    autocorrect: 'off',
    autocapitalize: 'none',
    spellcheck: 'false',
    oninput: debounce((e) => {
      state.query = e.target.value;
      state.limit = PAGE; // a new query starts from the top
      paint();
    }, 140),
  });
  append(screen, el('div', { style: { marginBottom: '12px' } }, search));

  const results = el('div');
  append(screen, results);
  append(screen, attribution());

  // ---------------------------------------------------------------- helpers --

  /** Section header carrying its own count, so a capped list is never silent. */
  function countedHead(title, shown, total) {
    const label = shown < total ? `${title} (${shown} of ${total})` : `${title} (${total})`;
    return el('h2.section-title', { text: label });
  }

  function showRow(show, { showVenue = true } = {}) {
    const hasSetlist = index.setlistByShow.has(Number(show.show_id));
    const structure = hasSetlist ? showStructure(index, show.show_id) : null;
    const upcoming = show.showdate > index.today;

    const meta = el('div.row-meta');
    if (showVenue) {
      append(meta, el('span', { text: `${show.venuename} · ${show.location}` }));
    }

    return el('li', null, [
      el('div.row-shell', null, [
        el(
          'button.row',
          { type: 'button', onclick: () => navigate(`#/show/${show.show_id}`) },
          [
            el('div.row-main', null, [
              el('div.row-title', { text: formatShowDate(show.showdate) }),
              meta,
            ]),
            // Format is shown only where setlist data establishes it. Upcoming
            // shows assert nothing; played shows with no setlist say so.
            structure
              ? el('span.badge.badge-set', { text: structure })
              : el('span.badge', {
                  text: upcoming ? 'Upcoming' : 'No setlist recorded',
                }),
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
    ]);
  }

  // ------------------------------------------------------------------ paint --

  function paint() {
    results.replaceChildren();
    const q = state.query.trim();

    if (!q) {
      paintRecent();
      return;
    }

    const parsed = parseDateQuery(q);
    const dateHits = parsed ? matchShowsByDate(index.shows, parsed, index.today) : [];
    const venueHits = matchVenues(index.venues, q).sort((a, b) =>
      compareVenuesByName(a.venue, b.venue),
    );

    if (!dateHits.length && !venueHits.length) {
      append(
        results,
        emptyState(
          parsed
            ? `No shows on ${parsed.label}.`
            : `Nothing matching “${q}”. Try a venue, city, state, or a date like 8/7/26.`,
        ),
      );
      return;
    }

    // Both matchers always run, and each reports its own count, so a query
    // that hits both (like "Portland") can never silently prefer one.
    if (dateHits.length) {
      const section = el('div.section');
      append(section, countedHead('Shows', dateHits.length, dateHits.length));
      if (parsed.kind === 'monthday' && dateHits.length > 1) {
        append(
          section,
          el('p.note', {
            style: { margin: '0 0 8px' },
            text: `${parsed.label} matches ${dateHits.length} shows across different years, nearest first.`,
          }),
        );
      }
      const list = el('ul.rows');
      for (const s of dateHits) append(list, showRow(s));
      append(section, list);
      append(results, section);
    }

    if (venueHits.length) {
      const section = el('div.section');
      append(section, countedHead('Venues', venueHits.length, venueHits.length));
      const list = el('ul.rows');
      for (const { venue, reasons } of venueHits) {
        const shows = (index.showsByVenue.get(Number(venue.venue_id)) || []);
        const played = shows.filter((s) => s.showdate <= index.today);
        const reason = matchReasonLabel(reasons);
        append(
          list,
          el('li', null, [
            el('div.row-shell', null, [
              el(
                'button.row',
                { type: 'button', onclick: () => navigate(`#/venue/${venue.venue_id}`) },
                [
                  el('div.row-main', null, [
                    el('div.row-title', { text: venue.venuename }),
                    el('div.row-meta', null, [
                      el('span', { text: `${venue.city}, ${venue.state}` }),
                      reason ? el('span.badge', { text: reason }) : null,
                    ]),
                  ]),
                  el('div.gap-figure', null, [
                    el('div.gap-num.num', { text: String(played.length) }),
                    el('div.gap-unit', { text: played.length === 1 ? 'show' : 'shows' }),
                  ]),
                ],
              ),
            ]),
          ]),
        );
      }
      append(section, list);
      append(results, section);
    }
  }

  /**
   * Empty-query landing: the full recent-setlists view, unchanged.
   *
   * These are rendered as full cards WITH their setlists, not as compact rows.
   * Seeing what has been burned recently without tapping through is the whole
   * point of this screen -- collapsing it to a list would be a regression.
   */
  function paintRecent() {
    // Newest first, upcoming shows excluded.
    const played = index.shows.filter((s) => s.showdate <= index.today);
    const ordered = played.slice().reverse();
    const shown = ordered.slice(0, state.limit);

    const section = el('div.section');
    append(section, countedHead('Recent shows', shown.length, ordered.length));

    for (const show of shown) {
      const rows = index.setlistByShow.get(Number(show.show_id)) || [];
      append(
        section,
        el('div.card', { style: { marginBottom: '12px' } }, [
          el(
            'div',
            { style: { display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'baseline' } },
            [
              el('div', { style: { minWidth: '0' } }, [
                el('div', { style: { fontWeight: '650' }, text: formatShowDate(show.showdate) }),
                el('div.note', { text: `${show.venuename} · ${show.location}` }),
              ]),
              rows.length
                ? el('span.badge.badge-set', { text: showStructure(index, show.show_id) || '' })
                : el('span.badge', { text: 'No setlist recorded' }),
            ],
          ),
          rows.length
            ? el('div', { style: { marginTop: '12px' } }, setlistBlock(rows, {
                index,
                onSong: (id) => navigate(`#/song/${id}`),
              }))
            : null,
          el('div.card-actions', null, [
            el(
              'button.btn.btn-small',
              { type: 'button', onclick: () => navigate(`#/show/${show.show_id}`) },
              'Show detail',
            ),
            rows.length
              ? el(
                  'button.btn.btn-small',
                  { type: 'button', onclick: () => navigate(`#/gapchart/${show.show_id}`) },
                  'Gap chart',
                )
              : null,
            cartonLink(showPermalink(show), 'Carton'),
          ]),
        ]),
      );
    }

    if (shown.length < ordered.length) {
      const remaining = ordered.length - shown.length;
      append(
        section,
        el(
          'button.btn.btn-block',
          {
            type: 'button',
            style: { marginTop: '12px' },
            onclick: () => {
              state.limit += PAGE;
              paint();
            },
          },
          `Load ${Math.min(PAGE, remaining)} older`,
        ),
      );
    }
    append(results, section);
  }

  paint();
  return screen;
}
