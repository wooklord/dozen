// Shared UI pieces used across screens.

import { el, icon, ICONS, append, openSheet } from './dom.js';
import { parseFootnotes, setLabel } from '../data/index.js';
import { formatShowDateShort } from '../util/dates.js';
import { isPicked, togglePick } from '../scratchpad.js';

import { CARTON_BASE as CARTON, SONGFISH_URL, MAPS_SEARCH_BASE } from '../config.js';

/** Deep link back to the corresponding Carton page. Required, not optional. */
export function cartonLink(href, label = 'View on The Carton') {
  return el('a.carton-link', {
    href: href.startsWith('http') ? href : `${CARTON}/${href.replace(/^\//, '')}`,
    target: '_blank',
    rel: 'noopener noreferrer',
    text: label,
  });
}

// Carton's real URL shapes, verified against its sitemap and by request.
// The `permalink` field is a bare filename -- it needs a section prefix, and
// the WRONG prefix returns a 404 rather than redirecting:
//   /setlists/{permalink}   200
//   /{permalink}            404   <- what this used to build
//   /venues/{slug}          200
//   /venue/{slug}           404
//   /song/{slug}            200   (singular here, plural for venues)
export function showPermalink(show) {
  return show?.permalink ? `${CARTON}/setlists/${show.permalink}` : CARTON;
}

export function songPermalink(song) {
  return song?.slug ? `${CARTON}/song/${song.slug}` : CARTON;
}

export function venuePermalink(venue) {
  return venue?.slug ? `${CARTON}/venues/${venue.slug}` : CARTON;
}

/**
 * Carton's own per-show gap chart. Same permalink filename as the setlist
 * page, different section.
 *
 * NOTE: /gap-chart/ is robots-disallowed, so we link to it but never fetch it.
 */
export function gapChartPermalink(show) {
  return show?.permalink ? `${CARTON}/gap-chart/${show.permalink}` : CARTON;
}

/** Names that carry no information and must never become a Maps search. */
const PLACEHOLDER_VENUE = /^(unknown|unknown venue|tbd|tba|n\/?a|none|null|test|-+|\?+)$/i;

/**
 * An outbound Google Maps deep link for a venue, or null.
 *
 * OUTBOUND ONLY. Nothing is fetched, embedded or rendered from Google — see
 * the scope note in CLAUDE.md. This builds a URL out of Carton's own fields
 * and hands it to the user's browser.
 *
 * Name-based search on purpose: `venues` carries NO coordinates (8 fields, no
 * lat/lng anywhere), and the name resolves to the venue's actual Maps place
 * page, which is the point. `zip` and `capacity` exist but are dead in this
 * dataset -- blank on 440 of 441 and 0 on all 441 -- so neither is used.
 *
 * Returns null rather than a junk query when the name is missing or is an
 * obvious placeholder. A link that searches for nothing is worse than no link.
 *
 * @param {{venuename?: string, city?: string, state?: string}} venue
 * @returns {string|null}
 */
export function venueMapsUrl(venue) {
  const name = String(venue?.venuename ?? '').trim();
  if (!name || PLACEHOLDER_VENUE.test(name)) return null;

  // City/state are frequently thin (3 venues have no state, 1 has no city),
  // so anything blank simply drops out rather than leaving a dangling comma.
  const query = [name, String(venue?.city ?? '').trim(), String(venue?.state ?? '').trim()]
    .filter(Boolean)
    .join(', ');

  return MAPS_SEARCH_BASE + encodeURIComponent(query);
}

/**
 * "Venue info" link, or null when there is no usable query.
 *
 * The louder of the two wherever it appears beside cartonLink (see .info-link
 * in app.css). Attribution still rides on attribution(), not on this row.
 */
export function venueInfoLink(venue, label = 'Venue info') {
  const href = venueMapsUrl(venue);
  if (!href) return null;
  return el('a.info-link', {
    href,
    target: '_blank',
    rel: 'noopener noreferrer',
    text: label,
  });
}

/**
 * How gap is counted, reachable from any gap figure in the app.
 *
 * Two things a reader needs and cannot infer from the number itself:
 * what the denominator is, and why our figure can disagree with the gap
 * quoted in one of Carton's own footnotes. Both are statements of method --
 * this does not argue that our number is better.
 *
 * @param {object} index  live index, so counts are never hardcoded
 * @param {boolean} withFootnoteNote  include the static-footnote explanation
 */
export function openGapExplainer(index, { withFootnoteNote = true, atShow = false } = {}) {
  const c = index.counts;
  return openSheet('How gap is counted', () =>
    el('div', { style: { display: 'grid', gap: '12px' } }, [
      el('p', { style: { margin: 0, fontSize: 'var(--t-sm)' } }, [
        'Gap is the number of shows since a song was last played, counted across the ',
        el('strong', { text: `${c.countedShows} shows` }),
        ' in the archive that have a setlist recorded. 0 means it was played at the most recent show.',
      ]),
      atShow
        ? el('p', {
            style: { margin: 0, fontSize: 'var(--t-sm)', color: 'var(--ink-dim)' },
            text:
              'On a show’s gap chart the same counting is applied as of that show’s date rather ' +
              'than today, so those figures are gaps at the time and will differ from a song’s ' +
              'current gap.',
          })
        : null,
      el('div.card', null, [
        el('div.section-title', { style: { marginBottom: '6px' }, text: 'The denominator' }),
        el(
          'ul.fn-list',
          { style: { margin: 0 } },
          [
            [`${c.shows}`, 'shows in the archive'],
            [`${c.countedShows}`, 'have a setlist recorded — these are counted'],
            [`${c.excludedNoSetlist}`, 'were played but have no setlist recorded — not counted'],
            [`${c.excludedFuture}`, 'are upcoming — not counted'],
          ].map(([n, label]) =>
            el('li', null, [
              el('span.num', { style: { color: 'var(--yolk)', fontWeight: '700', minWidth: '38px' }, text: n }),
              el('span', { text: label }),
            ]),
          ),
        ),
        el('p.note', {
          style: { marginTop: '8px', marginBottom: 0 },
          text:
            'A show with no recorded setlist cannot establish that a song went unplayed, so counting ' +
            'it would inflate every gap spanning it. This makes gap figures here smaller than a ' +
            'count that included every show.',
        }),
        c.excludedBadDate
          ? el('p.note', {
              style: { marginTop: '6px', marginBottom: 0 },
              text: `${c.excludedBadDate} of the uncounted shows has a corrupt date in the source data and has no setlist either.`,
            })
          : null,
      ]),
      withFootnoteNote
        ? el('div.card', null, [
            el('div.section-title', { style: { marginBottom: '6px' }, text: "The Carton's own gap notes" }),
            el('p', {
              style: { margin: 0, fontSize: 'var(--t-sm)', color: 'var(--ink-dim)' },
              text:
                'Setlist footnotes on The Carton sometimes quote a gap, like “LTP 3/7/2021 (111 show gap)”. ' +
                'Those are written at publication time against the archive as it stood then, and shows have ' +
                'been added since. That is why a footnote and the figure here can differ and both be right — ' +
                'they describe different moments. Footnote text is shown exactly as The Carton wrote it.',
            }),
          ])
        : null,
    ]),
  );
}

/** A gap figure that opens the explainer when tapped. */
export function gapFigure(value, unit, index, { accent = true } = {}) {
  return el(
    'button.gap-figure',
    {
      type: 'button',
      'aria-label': `${value === null ? 'no' : value} ${unit}. How gap is counted`,
      onclick: (e) => {
        e.stopPropagation();
        openGapExplainer(index);
      },
    },
    [
      el(`div.gap-num${accent ? '' : '.plain'}.num`, { text: value === null ? '—' : String(value) }),
      el('div.gap-unit', { text: unit }),
    ],
  );
}

/** Small inline affordance for screens that describe gap in prose. */
export function gapExplainerLink(index, label = 'How gap is counted') {
  return el('button.inline-link', {
    type: 'button',
    text: label,
    onclick: () => openGapExplainer(index),
  });
}

/**
 * Heat: opacity of one hue, scaled against the largest gap on screen.
 * Deliberately NOT a multi-hue scale -- that would imply thresholds the data
 * does not have, and thresholds edge toward prediction.
 */
function heatFor(gap, maxGap) {
  if (gap === null || !maxGap) return 0;
  return Math.max(0.08, Math.min(1, gap / maxGap));
}

/**
 * A song row. `figure` chooses which number sits on the right.
 * Every label describes what HAS happened -- never what will.
 */
/**
 * @param {object} opts
 * @param {boolean} [opts.jamBadge=false]  Show a "Jam" badge on the meta line.
 *   OFF by default. On the Songs list it crowded the second line -- which is
 *   where gap and cover credit are scanned -- and it duplicated the "Jam
 *   charts" filter chip sitting directly above the list. The fact stays
 *   reachable through that filter, through the Jams tab, and through the jam
 *   chart entries on song detail, where it does real work rather than acting
 *   as a label. Parameterized rather than deleted so a future caller can ask
 *   for it explicitly instead of the option vanishing from the shared row.
 */
export function songRow(
  song,
  { figure = 'gap', maxGap = 1, onOpen, index, jamBadge = false } = {},
) {
  const picked = isPicked(song.song_id);

  let value;
  let unit;
  if (figure === 'times') {
    value = song.timesPlayed;
    unit = song.timesPlayed === 1 ? 'time' : 'times';
  } else {
    value = song.showsSinceLastPlayed;
    unit = 'shows';
  }

  // Every row carries name, gap and times played, whichever number is in the
  // figure column, so a row can be judged without tapping through.
  const meta = el('div.row-meta');
  if (song.lastPlayed) {
    append(meta, el('span', { text: `Last ${formatShowDateShort(song.lastPlayed)}` }));
    append(meta, el('span.sep', { text: '·' }));
    append(
      meta,
      el('span', {
        text:
          figure === 'times'
            ? song.showsSinceLastPlayed === null
              ? `${song.timesPlayed}×`
              : `gap ${song.showsSinceLastPlayed}`
            : `${song.timesPlayed}×`,
      }),
    );
  } else {
    append(meta, el('span', { text: 'Never played' }));
  }
  // Cover attribution is plain text, not a bordered badge: a badge wraps onto
  // its own line and costs a row of density on the app's busiest list.
  if (!song.isOriginal) {
    append(meta, el('span.sep', { text: '·' }));
    append(
      meta,
      el('span.cover-note', {
        text: song.originalArtist ? `${song.originalArtist} cover` : 'Cover',
      }),
    );
  }
  if (jamBadge && song.isJamChart) append(meta, el('span.badge.badge-jam', { text: 'Jam' }));

  const pickBtn = el(
    'button.pick-btn',
    {
      type: 'button',
      'aria-pressed': String(picked),
      'aria-label': picked ? `Remove ${song.name} from picks` : `Add ${song.name} to picks`,
      onclick: (e) => {
        e.stopPropagation();
        togglePick(song);
        const now = isPicked(song.song_id);
        pickBtn.setAttribute('aria-pressed', String(now));
        shell.dataset.picked = String(now);
        window.dispatchEvent(new CustomEvent('dozen:picks-changed'));
      },
    },
    icon(picked ? ICONS.check : ICONS.plus, 20),
  );

  const row = el(
    'button.row',
    {
      type: 'button',
      'data-picked': String(picked),
      onclick: () => onOpen?.(song),
    },
    [el('div.row-main', null, [el('div.row-title', { text: song.name }), meta])],
  );

  // The gap figure is a SIBLING of the row button, not a child: a button
  // cannot legally nest inside another button, and the figure needs its own
  // tap target so it can explain how the number was counted.
  const figureNode = index
    ? gapFigure(value, unit, index)
    : el('div.gap-figure', null, [
        el('div.gap-num.num', { text: value === null ? '—' : String(value) }),
        el('div.gap-unit', { text: unit }),
      ]);

  const heat = heatFor(value, maxGap);
  const shell = el('div.row-shell', { 'data-picked': String(picked) }, [
    el('span.gap-bar', {
      style: { '--heat': String(heat) },
      'data-heat': heat === 0 ? 'none' : null,
    }),
    row,
    figureNode,
    pickBtn,
  ]);

  return el('li', null, [shell]);
}

/**
 * A footnote, quoted exactly as The Carton wrote it.
 *
 * When the footnote quotes a gap or an LTP date, it sits right next to our own
 * gap figures, so the explanation for why the two can differ has to be
 * reachable from here rather than only from the gap column.
 */
export function openFootnote(text, index) {
  const quotesGap = /LTP|show gap/i.test(text);
  return openSheet('Footnote', () =>
    el('div', { style: { display: 'grid', gap: '12px' } }, [
      el('p', { text, style: { margin: 0 } }),
      el('p.note', { style: { margin: 0 }, text: 'Shown exactly as written on The Carton.' }),
      quotesGap && index
        ? el('div', null, [
            el('p.note', {
              style: { marginBottom: '6px' },
              text:
                'This note quotes a gap recorded when the setlist was published. Shows have been ' +
                'added to the archive since, so it can differ from the figure shown elsewhere in ' +
                'this app — both are right about different moments.',
            }),
            gapExplainerLink(index),
          ])
        : null,
    ]),
  );
}

/**
 * Render a setlist faithfully.
 *
 * Carton's notation is quoted, not rewritten: "->" and ">" are DIFFERENT marks
 * and both survive to the screen. Footnotes become tappable markers rather than
 * inline clutter -- hover does not exist on a phone.
 */
/**
 * THE JAM KEY IS BUILT HERE, not by callers.
 *
 * The rule is "the key follows the colour": anywhere a setlist renders with
 * jam-charted songs in it, the key naming that colour renders too. This
 * function is where the green is applied, so this is the only place that can
 * enforce it. It was briefly a caller's job and appeared on show detail alone,
 * which left the green unexplained on the Home and Shows cards.
 *
 * The condition is the rows' own `isjamchart`, which is exactly what drives the
 * highlight three lines further down -- one decision, not two that can
 * disagree. It is also the same flag `index.jamByShow` is built by filtering
 * on, so the key and show detail's entries section stay in step.
 */
export function setlistBlock(rows, { onSong, index } = {}) {
  // A real <li> in the footnote list rather than a block under it: as a sibling
  // it left-aligned past the footnote numbers and read as a separate note. As a
  // member it inherits the list's flex row, so the bullet lands in the marker
  // column and the words in the text column. Colour comes from --jam in CSS.
  const hasJam = rows.some((r) => Number(r.isjamchart) === 1);
  const jamKey = () =>
    el('li.jam-key', null, [
      el('span.jam-key-bullet', { 'aria-hidden': 'true', text: '●' }),
      el('span', { text: 'jam chart entry' }),
    ]);
  const wrap = el('div');
  const footnotes = [];

  // Group into sets, preserving the order the index already sorted them into.
  const sets = [];
  for (const r of rows) {
    const label = setLabel(r.settype, r.setnumber);
    let group = sets[sets.length - 1];
    if (!group || group.label !== label) {
      group = { label, rows: [] };
      sets.push(group);
    }
    group.rows.push(r);
  }

  for (const group of sets) {
    const flow = el('div.setlist-flow');
    group.rows.forEach((r, i) => {
      // Carton's own flag, not a lookup: `setlists.isjamchart` and the
      // `jamcharts` table agree exactly in live data -- 779 unique
      // (show, song) pairs from each, zero rows flagged without an entry and
      // zero entries without a flag. The row already carries it, so the
      // highlight costs no join. `data-jam` is what the smoke test asserts,
      // because a class is also what a stylesheet could set by accident.
      const isJam = Number(r.isjamchart) === 1;
      const song = el(`span.setlist-song${isJam ? '.jam' : ''}`, {
        role: 'button',
        tabindex: '0',
        'data-jam': isJam ? 'true' : null,
        text: r.songname,
        onclick: () => onSong?.(Number(r.song_id)),
        onkeydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSong?.(Number(r.song_id));
          }
        },
      });
      append(flow, song);

      const notes = parseFootnotes(r);
      if (notes.length) {
        for (const n of notes) {
          if (!footnotes.includes(n)) footnotes.push(n);
          const idx = footnotes.indexOf(n) + 1;
          append(
            flow,
            el('button.fn-marker', {
              type: 'button',
              text: String(idx),
              'aria-label': `Footnote ${idx}`,
              onclick: () => openFootnote(n, index),
            }),
          );
        }
      }

      // Only render a separator between songs, never trailing.
      if (i < group.rows.length - 1) {
        const id = Number(r.transition_id);
        if (id === 2) append(flow, el('span.segue', { text: '>' }));
        else if (id === 3) append(flow, el('span.segue', { text: '->' }));
        else append(flow, el('span.comma', { text: ', ' }));
      }
    });

    append(wrap, el('div.setlist-set', null, [el('div.setlist-label', { text: group.label }), flow]));
  }

  // The list renders when there are footnotes OR a key to put in it. A setlist
  // with jam entries and no footnotes -- which happens, three shows in the
  // archive and any number of Home cards -- gets a one-item list holding just
  // the key. That is still the footnote column, so the key is still aligned.
  if (footnotes.length || hasJam) {
    const list = el('ul.fn-list');
    footnotes.forEach((n, i) => {
      append(list, el('li', null, [el('span.fn-marker', { text: String(i + 1) }), el('span', { text: n })]));
    });
    // Last item in the list, after the real footnotes.
    if (hasJam) append(list, jamKey());
    append(wrap, list);
  }

  return wrap;
}

/**
 * A card showing one show's setlist, with its own actions underneath.
 *
 * THIS EXISTS TO OWN THE ORDER: head, then setlist, then actions. Nothing
 * else about it is clever, and the order is the whole point.
 *
 * Before this, four cards across two screens each assembled their own. The
 * Shows tab (0.1.23) put its actions under the setlist; Home (0.1.24) put them
 * above it, one build later, and all three Home cards stayed that way for
 * twenty-one builds. Adding a button to a Home card in 0.1.45 inherited the
 * wrong position without anyone touching layout. A card layout that each
 * screen re-implements drifts exactly like that, so callers now supply the
 * CONTENT and this supplies the STRUCTURE.
 *
 * Actions sit at the bottom because they are about the thing you just read.
 * Above the setlist they interrupt the card's subject to offer navigation
 * away from it.
 *
 * @param {object} opts
 * @param {Node|null} opts.head      title block -- date, venue, badges
 * @param {Array} opts.rows          setlist rows; empty renders `empty`
 * @param {object} opts.index        live index, passed through to setlistBlock
 * @param {Function} opts.onSong     song tap handler
 * @param {Array} opts.actions       buttons/links; falsy entries drop out
 * @param {Node|null} opts.empty     shown instead of a setlist when rows is empty
 * @param {object|null} opts.style   card style overrides (spacing between cards)
 */
export function setlistCard({
  head = null,
  rows = [],
  index,
  onSong,
  showId = null,
  navigate = null,
  extraActions = [],
  empty = null,
  style = null,
} = {}) {
  // THE ACTION SET IS OWNED HERE, not passed in. A setlist card gets ONE
  // button -- Show detail -- and this builds it. Callers each used to supply
  // their own array, which made "what buttons does a setlist card have" a
  // question with four answers across two files; removing one from all of them
  // was four edits that could each be forgotten. It is now one.
  //
  // These cards are an ENTRY POINT, not a control panel. Gap chart used to sit
  // here and does not any more: it duplicated the button on show detail, which
  // is where you are heading anyway. That makes a gap chart two taps from Home
  // rather than one, deliberately.
  //
  // `extraActions` is for things genuinely specific to one screen -- the Shows
  // tab's Carton link -- not for re-adding navigation removed on purpose.
  const acts = [
    showId != null && navigate
      ? el(
          'button.btn.btn-small',
          { type: 'button', onclick: () => navigate(`#/show/${showId}`) },
          'Show detail',
        )
      : null,
    ...extraActions,
  ].filter(Boolean);

  return el('div.card', style ? { style } : null, [
    head,
    rows.length ? el('div.setlist-card-body', null, setlistBlock(rows, { index, onSong })) : empty,
    acts.length ? el('div.card-actions', null, acts) : null,
  ]);
}

/**
 * Venue name + place, rendered at primary weight everywhere it appears.
 *
 * One helper so no screen can quietly drop this back into `.note` or another
 * de-emphasized style. Venue and city/state are primary information: three
 * different venues share the name "Brooklyn Bowl", so the place is part of
 * knowing what you are looking at.
 *
 * @param {object} showOrVenue  anything with venuename plus location or city/state
 * @param {{small?: boolean}} [opts]
 */
export function venueLine(showOrVenue, { small = false } = {}) {
  const name = showOrVenue.venuename || '';
  const place =
    showOrVenue.location ||
    [showOrVenue.city, showOrVenue.state, showOrVenue.country]
      .filter(Boolean)
      .filter((p, i, arr) => !(p === 'USA' && arr.length > 2))
      .join(', ');

  return el(`div.venue-line${small ? '.venue-line-sm' : ''}`, null, [
    el('span', { text: name }),
    place ? el('span.place', { text: ` · ${place}` }) : null,
  ]);
}

/**
 * A stat value at the right size for its content.
 *
 * Long values ("May 14, 2021", "2026-08-14") wrapped at the display size and
 * made their tile taller than its neighbours, breaking the grid. They step
 * down a size and never wrap instead, so every tile in a row stays level.
 * Used by every stat everywhere -- inline copies are how the bug returns.
 */
export function statValue(value, { accent = false } = {}) {
  const text = String(value);
  const long = text.length > 9;
  return el(
    `div.stat-value${accent ? '.accent' : ''}${long ? '.stat-value-sm' : ''}.num`,
    { text },
  );
}

export function statTile(value, label, accent = false) {
  return el('div.stat', null, [statValue(value, { accent }), el('div.stat-label', { text: label })]);
}

export function sectionHead(title, right = null) {
  return el('div.section-head', null, [el('h2.section-title', { text: title }), right]);
}

export function emptyState(text) {
  return el('div.empty', { text });
}

/** Persistent credit. This app rides on someone else's work. */
export function attribution() {
  return el('footer.attrib', null, [
    el('div', null, [
      'All setlist data from ',
      el('a', { href: CARTON, target: '_blank', rel: 'noopener noreferrer', text: 'The Carton' }),
      ', powered by ',
      el('a', {
        href: SONGFISH_URL,
        target: '_blank',
        rel: 'noopener noreferrer',
        text: 'Songfish',
      }),
      '.',
    ]),
    el('div', { style: { marginTop: '6px' } }, [
      'The Dozen is an unofficial fan-made reader. Please visit The Carton for the source of truth.',
    ]),
  ]);
}
