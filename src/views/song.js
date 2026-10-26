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
  openGapExplainer,
  gapExplainerLink,
  venueLine,
  heatFor,
} from '../ui/components.js';
import { SLOT_LABELS, SLOTS, setLabel, longestGap } from '../data/index.js';
import { openGapHistory } from './gaphistory.js';
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
  append(
    screen,
    el('button.chip', { type: 'button', onclick: () => history.back(), style: { marginBottom: '12px' } }, [
      icon(ICONS.back, 16),
      'Back',
    ]),
  );

  append(screen, el('h1.screen-title', { text: song.name }));

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
        // Tappable: the headline gap figure explains its own denominator. The
        // longest-gap tile below navigates instead.
        el(
          'button.stat.stat-tappable',
          {
            type: 'button',
            'aria-label': 'How gap is counted',
            onclick: () => openGapExplainer(index),
          },
          [
            statValue(song.showsSinceLastPlayed ?? '—', { accent: true }),
            el('div.stat-label', { text: 'shows since last' }),
          ],
        ),
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
      // The tile OPENS THE GAP HISTORY (0.1.83), every gap the figure is the
      // largest of; it no longer opens the explainer, which the tile above
      // and the link under it still do. With no figure there is no history
      // to open, and the tile is a plain stat. The "Gap history ›" line sits
      // outside .stat-label so the label still reads exactly as the Songs
      // list's date line does.
      el('div', { style: { marginTop: '12px' } }, [
        el(
          longest ? 'button.stat.stat-tappable.stat-nav.stat-wide' : 'div.stat.stat-wide',
          longest
            ? {
                type: 'button',
                'aria-label': `Longest observed gap ${longest.gap}, ${formatShowDateShort(longest.fromDate)} to ${longest.open ? 'still open' : formatShowDateShort(longest.toDate)}. Gap history`,
                onclick: () => openGapHistory(navigate, song.song_id),
              }
            : null,
          [
            statValue(longest ? longest.gap : '—'),
            el('div.stat-label', {
              // Two "none" cases, kept apart: no Eggy performance at all, or
              // performances none of which is in the counted universe (a
              // setlist dated after today, or a show missing from the count)
              // -- the second is listed with its plays and must not read
              // "never played" beside "1 time played".
              text: longest
                ? `longest observed gap — ${formatShowDateShort(longest.fromDate)} → ${longest.open ? 'still open' : formatShowDateShort(longest.toDate)}`
                : song.timesPlayed === 0
                  ? 'longest observed gap — none, never played'
                  : 'longest observed gap — none, no performance in the counted shows',
            }),
            longest ? el('div.stat-link', { text: 'Gap history ›' }) : null,
          ],
        ),
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
      append(
        list,
        el('li', null, [
          el('div.row-shell', null, [
            el(
              'button.row',
              { type: 'button', onclick: () => navigate(`#/show/${p.show_id}`) },
              [
                el('div.row-main', null, [
                  el('div.row-title', { text: formatShowDate(p.showdate) }),
                  venueLine(p),
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
