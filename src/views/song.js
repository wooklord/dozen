// SONG DETAIL — gap, times played, first/last, position breakdown, jam chart
// entries, cover vs original, and the full performance history.
//
// POSITION TENDENCIES live here too: raw counts of where the song has actually
// landed. Never a percentage -- a percentage of past placements reads as a
// forecast of the next show.

import { el, append, icon, ICONS } from '../ui/dom.js';
import {
  attribution,
  sectionHead,
  emptyState,
  cartonLink,
  songPermalink,
  showPermalink,
  statTile,
  statValue,
  currentGapTile,
  gapExplainerLink,
  venueLine,
  heatFor,
  titleChip,
} from '../ui/components.js';
import { SLOT_LABELS, SLOTS, setLabel, longestGap, gapHistory } from '../data/index.js';
import { openGapHistory, gapStrip } from './gaphistory.js';
import { formatShowDate, formatShowDateShort } from '../util/dates.js';
import { isPicked, togglePick } from '../scratchpad.js';

export function renderSong(ctx, songId) {
  const { index, navigate } = ctx;
  const screen = el('div.screen');
  const song = index.songsById.get(Number(songId));

  if (!song) {
    append(screen, el('h1.screen-title', { text: 'Song not found' }));
    append(screen, el('button.btn', { type: 'button', onclick: () => navigate('#/gap') }, 'Back to rotation'));
    return screen;
  }

  // --- Header ---------------------------------------------------------------
  // The title chip's bar comes first and is 0px tall: it is sticky under the
  // header from the top of the screen, and the bar it holds is laid over the
  // content, so showing it moves nothing (app.css, .title-bar).
  const title = el('h1.screen-title', { text: song.name });
  const titleBar = el('div.title-bar-inner');
  append(titleBar, titleChip(ctx, song.name, title, { bar: titleBar }));
  append(screen, el('div.title-bar', null, titleBar));

  append(
    screen,
    el('button.chip', { type: 'button', onclick: () => history.back(), style: { marginBottom: '12px' } }, [
      icon(ICONS.back, 16),
      'Back',
    ]),
  );

  append(screen, title);

  const subBits = [];
  if (song.isOriginal) subBits.push('Eggy original');
  else subBits.push(song.originalArtist ? `${song.originalArtist} cover` : 'Cover');
  if (song.isJamChart) subBits.push(`${song.jamcharts.length} jam chart entr${song.jamcharts.length === 1 ? 'y' : 'ies'}`);
  append(screen, el('p.screen-sub', { text: subBits.join(' · ') }));

  const picked = isPicked(song.song_id);
  const pickBtn = el(
    'button.btn.btn-block',
    {
      type: 'button',
      class: picked ? 'btn-accent' : '',
      onclick: () => {
        togglePick(song);
        const now = isPicked(song.song_id);
        pickBtn.className = `btn btn-block${now ? ' btn-accent' : ''}`;
        pickBtn.replaceChildren(
          icon(now ? ICONS.check : ICONS.plus, 18),
          document.createTextNode(now ? 'In your picks' : 'Add to picks'),
        );
        window.dispatchEvent(new CustomEvent('dozen:picks-changed'));
      },
    },
    [icon(picked ? ICONS.check : ICONS.plus, 18), picked ? 'In your picks' : 'Add to picks'],
  );
  append(screen, pickBtn);

  append(screen, el('div', { style: { marginTop: '4px' } }, cartonLink(songPermalink(song))));

  // The same figure the Songs list ranks by under "Longest gap" -- the larger
  // of the longest closed gap and the current one -- so a figure seen there
  // never changes on tap (docs/plan.md, decision 3).
  const longest = longestGap(song);

  // --- Headline stats -------------------------------------------------------
  append(
    screen,
    el('div.section', null, [
      el('div.stat-grid', null, [
        // Tappable: the headline gap figure explains its own denominator, the
        // same tile the gap history uses. The longest-gap tile below navigates
        // instead.
        currentGapTile(index, song.showsSinceLastPlayed),
        statTile(song.timesPlayed, song.timesPlayed === 1 ? 'time played' : 'times played'),
        statTile(song.lastPlayed ? formatShowDateShort(song.lastPlayed) : '—', 'last played'),
        statTile(song.firstPlayed ? formatShowDateShort(song.firstPlayed) : '—', 'first played'),
      ]),
      el('p.note', { style: { marginTop: '8px' } }, [
        `Gap counted across the ${index.counts.countedShows} Eggy shows played so far, as on The Carton. `,
        gapExplainerLink(index),
      ]),

      // Longest OBSERVED gap: the longest gap the song has been through, a max
      // over per-performance gaps each of which Carton renders on its own gap
      // charts, and the current gap when that is the longest. It describes
      // something that happened -- never a "record", never a due-status.
      // Rendered for every song this screen can show, listed or reached by
      // deep link, labelled with the two dates that bound it, or with "still
      // open" when the gap running now is the longest -- the same words the
      // Songs list uses, so what was tapped is what is read. A song with no
      // Eggy performance at all (hidden from the list, still reachable by id)
      // has neither figure and reads a dash with its reason.
      //
      // THE TILE IS THE GAP HISTORY'S ENTRY (0.1.83; this form 0.1.84, the
      // user's option B, docs/plan.md): the lead chip's fill and accent
      // border, the figure and its dated label, "Gap history ›" top right,
      // and under them the song's own strip -- gapStrip(), the history
      // screen's component, not a copy, aria-hidden here because the tile's
      // label already says what it shows. It opens the history; it no longer
      // opens the explainer, which the tile above and the link under it still
      // do. With no figure there is no history to open, and the tile is a
      // plain stat. "Gap history ›" sits outside .stat-label so the label
      // still reads exactly as the Songs list's date line does.
      el('div', { style: { marginTop: '12px' } }, [
        longest
          ? el(
              'button.stat.stat-tappable.stat-nav.stat-wide.stat-gap-entry',
              {
                type: 'button',
                'aria-label': `Gap history. Longest observed gap ${longest.gap}, ${formatShowDateShort(longest.fromDate)}${longest.open ? ', still open' : ` to ${formatShowDateShort(longest.toDate)}`}.`,
                onclick: () => openGapHistory(navigate, song.song_id),
              },
              [
                el('div.stat-gap-head', null, [
                  el('div', null, [
                    statValue(longest.gap),
                    el('div.stat-label', {
                      text: `longest observed gap — ${formatShowDateShort(longest.fromDate)} → ${longest.open ? 'still open' : formatShowDateShort(longest.toDate)}`,
                    }),
                  ]),
                  el('div.stat-link', { text: 'Gap history ›' }),
                ]),
                gapStrip(gapHistory(index, song.song_id), { 'aria-hidden': 'true' }),
              ],
            )
          : el('div.stat.stat-wide', null, [
              statValue('—'),
              el('div.stat-label', {
                // Two "none" cases, kept apart: no Eggy performance at all, or
                // performances none of which is in the counted universe (a
                // setlist dated after today, or a show missing from the count)
                // -- the second is listed with its plays and must not read
                // "never played" beside "1 time played".
                text:
                  song.timesPlayed === 0
                    ? 'longest observed gap — none, never played'
                    : 'longest observed gap — none, no performance in the counted shows',
              }),
            ]),
      ]),
    ]),
  );

  // --- Position tendencies: RAW COUNTS ONLY ---------------------------------
  const slotSection = el('div.section');
  append(slotSection, sectionHead('Where it has landed'));
  const used = SLOTS.filter((s) => song.positionCounts[s] > 0);
  if (used.length) {
    const max = Math.max(...used.map((s) => song.positionCounts[s]));
    const list = el('ul.rows');
    for (const slot of used.sort((a, b) => song.positionCounts[b] - song.positionCounts[a])) {
      const n = song.positionCounts[slot];
      append(
        list,
        el('li', null, [
          el('div.row', { style: { pointerEvents: 'none' } }, [
            el('span.gap-bar', { style: { '--heat': String(heatFor(n, max)) } }),
            el('div.row-main', null, el('div.row-title', { text: SLOT_LABELS[slot] })),
            el('div.gap-figure', null, [
              el('div.gap-num.num', { text: String(n) }),
              el('div.gap-unit', { text: n === 1 ? 'time' : 'times' }),
            ]),
          ]),
        ]),
      );
    }
    append(slotSection, list);
    append(
      slotSection,
      el('p.note', {
        style: { marginTop: '8px' },
        text: 'Counts of past placements. A set with a single song counts as both opener and closer.',
      }),
    );
  } else {
    append(slotSection, emptyState('Never played.'));
  }
  append(screen, slotSection);

  // --- Album membership -----------------------------------------------------
  // Rendered only when present. The albums table is thin -- 13 tracks across
  // 5 albums -- so a permanent section would be empty for most songs.
  if (song.albums?.length) {
    const albumSection = el('div.section');
    append(albumSection, sectionHead('Appears on'));
    const list = el('ul.rows');
    for (const a of song.albums) {
      append(
        list,
        el('li', null, [
          el('div.row', null, [
            el('div.row-main', null, [
              el('div.row-title', { text: a.title }),
              el('div.row-meta', null, [
                el('span', { text: a.releasedate ? a.releasedate.slice(0, 4) : '' }),
                a.position ? el('span', { text: `· track ${a.position}` }) : null,
                a.isLive ? el('span.badge', { text: 'Live' }) : null,
              ]),
            ]),
            a.url ? cartonLink(a.url, 'Carton') : null,
          ]),
        ]),
      );
    }
    append(albumSection, list);
    append(screen, albumSection);
  }

  // --- Jam chart entries ----------------------------------------------------
  if (song.jamcharts.length) {
    const jamSection = el('div.section');
    append(jamSection, sectionHead('Jam chart entries'));
    for (const j of song.jamcharts.slice().sort((a, b) => b.showdate.localeCompare(a.showdate))) {
      append(
        jamSection,
        el('div.card', { style: { marginBottom: '8px' } }, [
          el('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px' } }, [
            el('div', { style: { fontWeight: '600' }, text: formatShowDate(j.showdate) }),
            el('span.badge.badge-set', { text: setLabel('Set', j.setnumber) }),
          ]),
          venueLine(j),
          j.jamchartnote
            ? el('p', { style: { margin: '8px 0 0', fontSize: 'var(--t-sm)' }, text: j.jamchartnote })
            : null,
          // jamcharts.permalink is the same bare filename as shows.permalink
          // and needs the /setlists/ prefix too.
          j.permalink ? cartonLink(showPermalink({ permalink: j.permalink }), 'Carton') : null,
        ]),
      );
    }
    append(screen, jamSection);
  }

  // --- Full performance history --------------------------------------------
  const histSection = el('div.section');
  append(
    histSection,
    sectionHead(`Every performance (${song.performances.length})`),
  );
  if (song.performances.length) {
    const list = el('ul.rows');
    for (const p of song.performances.slice().reverse()) {
      // A jam chart entry (0.1.85): a green edge down the row and a "Jam chart"
      // badge on a line of its own under the venue. The flag is the setlist
      // row's own `isjamchart`, which agrees exactly with the jamcharts table
      // (docs/carton_schema.md), and it is per performance, so a song charted
      // twice in one night marks both rows. Green means jam chart and nothing
      // else in this app; the badge says it in words, so colour is never the
      // only signal. The row carries its show, set and position -- jamKey()'s
      // fields -- so a check can hold each row to its own entry in the table,
      // not just count them per show.
      const isJam = Number(p.isjamchart) === 1;
      append(
        list,
        el('li', null, [
          el('div.row-shell', {
            'data-show-id': String(p.show_id),
            'data-set': String(p.setnumber).toLowerCase(),
            'data-position': String(p.position),
            'data-jam': isJam ? 'true' : null,
          }, [
            el(
              'button.row',
              { type: 'button', onclick: () => navigate(`#/show/${p.show_id}`) },
              [
                el('div.row-main', null, [
                  el('div.row-title', { text: formatShowDate(p.showdate) }),
                  venueLine(p),
                  isJam ? el('div.row-meta', null, el('span.badge.badge-jam', { text: 'Jam chart' })) : null,
                ]),
                el('span.badge.badge-set', { text: setLabel(p.settype, p.setnumber) }),
              ],
            ),
            // Gap chart for that night, one tap from the history row.
            el(
              'button.row-action',
              {
                type: 'button',
                'aria-label': `Gap chart for ${p.showdate}`,
                onclick: () => navigate(`#/gapchart/${p.show_id}`),
              },
              icon(ICONS.gap, 18),
            ),
          ]),
        ]),
      );
    }
    append(histSection, list);
  } else {
    append(histSection, emptyState('This song is in the catalog but has never been played.'));
  }
  append(screen, histSection);

  append(screen, attribution());
  return screen;
}
