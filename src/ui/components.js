// Shared UI pieces used across screens.

import { el, icon, ICONS, append, openSheet } from './dom.js';
import { parseFootnotes, setLabel } from '../data/index.js';
import { formatShowDateShort } from '../util/dates.js';
import { isPicked, togglePick } from '../scratchpad.js';

const CARTON = 'https://thecarton.net';

/** Deep link back to the corresponding Carton page. Required, not optional. */
export function cartonLink(href, label = 'View on The Carton') {
  return el('a.carton-link', {
    href: href.startsWith('http') ? href : `${CARTON}/${href.replace(/^\//, '')}`,
    target: '_blank',
    rel: 'noopener noreferrer',
    text: label,
  });
}

export function showPermalink(show) {
  return show?.permalink ? `${CARTON}/${show.permalink}` : CARTON;
}

export function songPermalink(song) {
  return song?.slug ? `${CARTON}/song/${song.slug}` : CARTON;
}

export function venuePermalink(venue) {
  return venue?.slug ? `${CARTON}/venue/${venue.slug}` : CARTON;
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
export function songRow(song, { figure = 'gap', maxGap = 1, onOpen } = {}) {
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

  const meta = el('div.row-meta');
  if (song.lastPlayed) {
    append(meta, el('span', { text: `Last ${formatShowDateShort(song.lastPlayed)}` }));
    append(meta, el('span.sep', { text: '·' }));
    append(meta, el('span', { text: `${song.timesPlayed}×` }));
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
  if (song.isJamChart) append(meta, el('span.badge.badge-jam', { text: 'Jam' }));

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
        row.dataset.picked = String(now);
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
    [
      el('span.gap-bar', {
        style: { '--heat': String(heatFor(value, maxGap)) },
      }),
      el('div.row-main', null, [
        el('div.row-title', { text: song.name }),
        meta,
      ]),
      el('div.gap-figure', null, [
        el('div.gap-num.num', { text: value === null ? '—' : String(value) }),
        el('div.gap-unit', { text: unit }),
      ]),
    ],
  );

  return el('li', null, [el('div.row-shell', null, [row, pickBtn])]);
}

/**
 * Render a setlist faithfully.
 *
 * Carton's notation is quoted, not rewritten: "->" and ">" are DIFFERENT marks
 * and both survive to the screen. Footnotes become tappable markers rather than
 * inline clutter -- hover does not exist on a phone.
 */
export function setlistBlock(rows, { onSong } = {}) {
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
      const song = el('span.setlist-song', {
        role: 'button',
        tabindex: '0',
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
              onclick: () =>
                openSheet('Footnote', () => el('p', { text: n, style: { margin: 0 } })),
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

  if (footnotes.length) {
    const list = el('ul.fn-list');
    footnotes.forEach((n, i) => {
      append(list, el('li', null, [el('span.fn-marker', { text: String(i + 1) }), el('span', { text: n })]));
    });
    append(wrap, list);
  }

  return wrap;
}

export function statTile(value, label, accent = false) {
  return el('div.stat', null, [
    el(`div.stat-value${accent ? '.accent' : ''}.num`, { text: String(value) }),
    el('div.stat-label', { text: label }),
  ]);
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
        href: 'https://www.songfish.net',
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
