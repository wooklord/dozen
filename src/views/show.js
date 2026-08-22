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
import { showStructure, setLabel } from '../data/index.js';
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

  // ONE condition for both jam-related things on this screen: the key inside
  // the setlist card and the entries section below it. Hoisted above both so
  // there is a single decision rather than two that can disagree -- a key
  // explaining a colour that is not on screen, or green titles with nothing
  // saying what they are, are both possible if these drift apart.
  const jams = index.jamByShow.get(Number(show.show_id));
  const hasJams = Boolean(jams?.length);

  // Directly under the setlist, inside the same section, in both branches: the
  // link is a pointer to the source of THIS setlist, so it belongs against the
  // setlist rather than up in the action row. When no setlist was recorded it
  // matters more, not less -- it is where the reader goes to check.
  const sourceLink = () => el('div.link-row.setlist-source', null, [cartonLink(showPermalink(show))]);

  // Three words in the highlight colour, sitting with the footnotes.
  //
  // The footnote list is already where this setlist's marks get explained, so
  // a colour key belongs there rather than at the top of the card competing
  // with the setlist for attention. The words ARE the sample -- no swatch, no
  // label, no sentence.
  //
  // Colour comes from --jam in CSS, never a literal here. A hardcoded hex
  // would be a second copy of a value already retuned four times, and it fails
  // silently: a key confidently naming a colour the setlist no longer uses.
  // The jam key is NOT built here. setlistBlock renders it wherever a setlist
  // has jam-charted songs, so it appears on the Home and Shows cards too --
  // the key follows the colour. `hasJams` below gates only the entries section.
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

  if (rows.length) {
    append(
      screen,
      el('div.section', null, [
        sectionHead('Setlist', el('span.badge.badge-set', { text: showStructure(index, show.show_id) || '' })),
        el('div.card', null, [
          setlistBlock(rows, { index, onSong: (id) => navigate(`#/song/${id}`) }),
          showNotes(),
        ]),
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

  // --- Jam chart entries for THIS show, in setlist order ---------------------
  //
  // Directly under the setlist and in the same order it was played, so the two
  // read together: a green title above has its note right here, in the
  // sequence you heard it. Not alphabetical and not grouped by chart -- either
  // would break the correspondence that makes this worth showing at all.
  //
  // Order comes from index.jamByShow, which is built by walking the show's
  // sorted setlist rows, so it cannot drift from the block above.
  //
  // Absent rather than empty when a show has none, same rule as album
  // membership on song detail: jamByShow only holds shows that have entries.
  // `hasJams` is computed once, above the setlist, and gates the key too.
  if (hasJams) {
    const jamSection = el('div.section');
    append(
      jamSection,
      sectionHead(
        'Jam chart entries',
        el('span.badge.badge-jam', { text: String(jams.length) }),
      ),
    );
    for (const j of jams) {
      append(
        jamSection,
        el('div.card.jam-card', { style: { marginBottom: '8px' } }, [
          el('div.jam-card-head', null, [
            // Tappable to the same place the setlist title above goes, and in
            // the same green, so the two are visibly the same entry.
            el('button.jam-card-song', {
              type: 'button',
              text: j.songname,
              onclick: () => navigate(`#/song/${j.song_id}`),
            }),
            el('span.badge.badge-set', { text: setLabel(j.settype, j.setnumber) }),
          ]),
          j.note ? el('p.jam-card-note', { text: j.note }) : null,
        ]),
      );
    }
    append(screen, jamSection);
  }

  append(screen, attribution());
  return screen;
}
