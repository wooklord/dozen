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
  openGapExplainer,
  gapExplainerLink,
} from '../ui/components.js';
import { SLOT_LABELS, SLOTS, setLabel } from '../data/index.js';
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

  // --- Headline stats -------------------------------------------------------
  append(
    screen,
    el('div.section', null, [
      el('div.stat-grid', null, [
        // Tappable: the headline gap figure explains its own denominator.
        el(
          'button.stat.stat-tappable',
          {
            type: 'button',
            'aria-label': 'How gap is counted',
            onclick: () => openGapExplainer(index),
          },
          [
            el('div.stat-value.accent.num', { text: String(song.showsSinceLastPlayed ?? '—') }),
            el('div.stat-label', { text: 'shows since last' }),
          ],
        ),
        statTile(song.timesPlayed, song.timesPlayed === 1 ? 'time played' : 'times played'),
        statTile(song.lastPlayed ? formatShowDateShort(song.lastPlayed) : '—', 'last played'),
        statTile(song.firstPlayed ? formatShowDateShort(song.firstPlayed) : '—', 'first played'),
      ]),
      el('p.note', { style: { marginTop: '8px' } }, [
        `Gap counted across the ${index.counts.countedShows} shows in the archive that have setlist data. `,
        gapExplainerLink(index),
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
            el('span.gap-bar', { style: { '--heat': String(Math.max(0.15, n / max)) } }),
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
          el('div.note', { text: `${j.venuename} · ${j.city}, ${j.state}` }),
          j.jamchartnote
            ? el('p', { style: { margin: '8px 0 0', fontSize: 'var(--t-sm)' }, text: j.jamchartnote })
            : null,
          j.permalink ? cartonLink(j.permalink, 'Carton') : null,
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
      const show = index.showsById.get(Number(p.show_id));
      append(
        list,
        el('li', null, [
          el(
            'button.row',
            { type: 'button', onclick: () => navigate(`#/show/${p.show_id}`) },
            [
              el('div.row-main', null, [
                el('div.row-title', { text: formatShowDate(p.showdate) }),
                el('div.row-meta', null, [
                  el('span', { text: `${p.venuename}${p.city ? ` · ${p.city}, ${p.state}` : ''}` }),
                ]),
              ]),
              el('span.badge.badge-set', { text: setLabel(p.settype, p.setnumber) }),
            ],
          ),
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
