// PER-SHOW GAP CHART — every song in one night's setlist with its gap at that
// moment.
//
// This is NOT archive-wide rotation. Gap here is counted as of this show's
// date, so a song played last night reads 0 here even if it has since gone
// cold. Both numbers come from the same gapAtShow() function under the same
// exclude-shows-without-setlists convention -- if they were computed
// separately they would drift by a few and both would look broken.

import { el, append, icon, ICONS } from '../ui/dom.js';
import {
  attribution,
  cartonLink,
  showPermalink,
  gapChartPermalink,
  emptyState,
  sectionHead,
  openGapExplainer,
} from '../ui/components.js';
import { gapChartForShow, showStructure } from '../data/index.js';
import { formatShowDate, formatShowDateShort } from '../util/dates.js';

export function renderGapChart(ctx, showId) {
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

  append(screen, el('h1.screen-title', { text: 'Gap chart' }));
  append(
    screen,
    el('p.screen-sub', { text: `${formatShowDate(show.showdate)} · ${show.venuename}` }),
  );

  const entries = gapChartForShow(index, show.show_id);

  if (!entries.length) {
    append(screen, emptyState('The Carton has no setlist recorded for this show.'));
    append(screen, attribution());
    return screen;
  }

  // The distinction that keeps this view honest.
  append(
    screen,
    el('div.card', { style: { marginBottom: '16px' } }, [
      el('p', {
        style: { margin: '0 0 8px', fontSize: 'var(--t-sm)' },
        text:
          'Each song’s gap as of this show — how many shows had passed since it was last ' +
          'played, counted at that date. These are not current gaps.',
      }),
      el('div', null, [openGapExplainerLink(index)]),
    ]),
  );

  const maxGap = entries.reduce((m, e) => Math.max(m, e.gap ?? 0), 1);

  // Grouped by set, in the order they were played.
  const groups = [];
  for (const e of entries) {
    let g = groups[groups.length - 1];
    if (!g || g.label !== e.setLabel) {
      g = { label: e.setLabel, entries: [] };
      groups.push(g);
    }
    g.entries.push(e);
  }

  for (const g of groups) {
    const list = el('ul.rows');
    for (const e of g.entries) {
      append(
        list,
        el('li', null, [
          el('div.row-shell', null, [
            el('span.gap-bar', {
              style: { '--heat': String(e.gap === null ? 0 : Math.max(0.08, e.gap / maxGap)) },
            }),
            el(
              'button.row',
              { type: 'button', onclick: () => navigate(`#/song/${e.song_id}`) },
              [
                el('div.row-main', null, [
                  el('div.row-title', { text: e.songname }),
                  el('div.row-meta', null, [
                    e.isDebut
                      ? el('span', { text: 'First time played' })
                      : el('span', {
                          text: e.previous
                            ? `Previously ${formatShowDateShort(e.previous.showdate)}`
                            : '',
                        }),
                    // Played more than once this night -- shown as a count so
                    // the gap figure is not repeated as if it were two facts.
                    e.occurrences > 1
                      ? el('span.badge', { text: `${e.occurrences}× tonight` })
                      : null,
                  ]),
                ]),
              ],
            ),
            // Debut is not gap 0 -- gap 0 means "played at the immediately
            // preceding counted show". Different facts, shown differently.
            e.isDebut
              ? el('div.gap-figure', null, [el('span.badge.badge-jam', { text: 'Debut' })])
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
                  [
                    el('div.gap-num.num', { text: String(e.gap) }),
                    el('div.gap-unit', { text: 'shows' }),
                  ],
                ),
          ]),
        ]),
      );
    }
    append(
      screen,
      el('div.section', null, [sectionHead(g.label), list]),
    );
  }

  // Carton's own gap chart for this show, alongside ours. Same treatment as
  // the footnote case: theirs verbatim at the source, ours labelled, both true.
  append(
    screen,
    el('div.section', null, [
      sectionHead('On The Carton'),
      el('div.card', null, [
        el('p.note', {
          style: { margin: '0 0 8px' },
          text:
            'The Carton publishes its own gap chart for this show. Figures may differ from ours ' +
            'where its counting convention differs — both describe the same night.',
        }),
        el('div', null, [cartonLink(gapChartPermalink(show), 'Gap chart on The Carton')]),
        el('div', null, [cartonLink(showPermalink(show), 'Setlist on The Carton')]),
      ]),
    ]),
  );

  append(screen, attribution());
  return screen;
}

function openGapExplainerLink(index) {
  return el('button.inline-link', {
    type: 'button',
    text: 'How gap is counted',
    onclick: () => openGapExplainer(index, { atShow: true }),
  });
}
