// PICK SCRATCHPAD — local-only shortlist, reorderable, copyable as plain text.
//
// No account, no server, no integration with any other app. The list lives in
// localStorage and leaves this device only when the user copies it themselves.

import { el, append, icon, ICONS, openSheet } from '../ui/dom.js';
import { attribution, emptyState, sectionHead, openGapExplainer } from '../ui/components.js';
import { getPicks, removePick, reorder, clearPicks, asPlainText, copyToClipboard } from '../scratchpad.js';
import { formatShowDateShort } from '../util/dates.js';

export function renderPicks(ctx) {
  const { index, navigate } = ctx;
  const screen = el('div.screen');

  append(screen, el('h1.screen-title', { text: 'Your picks' }));
  append(
    screen,
    el('p.screen-sub', {
      text: 'Saved on this device only. Drag to reorder, then copy the list.',
    }),
  );

  const listWrap = el('ul.rows');
  append(screen, listWrap);

  const actions = el('div', { style: { display: 'grid', gap: '8px', marginTop: '16px' } });
  append(screen, actions);
  append(screen, attribution());

  function paint() {
    const picks = getPicks();
    listWrap.replaceChildren();
    actions.replaceChildren();

    if (!picks.length) {
      append(listWrap, el('li', null, emptyState('No picks yet. Tap + on any song to shortlist it.')));
      append(
        actions,
        el('button.btn.btn-block', { type: 'button', onclick: () => navigate('#/gap') }, 'Browse rotation'),
      );
      return;
    }

    picks.forEach((p, i) => {
      const song = index.songsById.get(Number(p.song_id));
      const item = el('li', { draggable: 'true', 'data-index': String(i) }, [
        el('div.pick-item', null, [
          el('span.pick-ordinal.num', { text: String(i + 1) }),
          el('div.row-main', null, [
            el('div.row-title', { text: p.name }),
            song
              ? el('div.row-meta', null, [
                  el('button.inline-link', {
                    type: 'button',
                    'aria-label': 'How gap is counted',
                    text:
                      song.showsSinceLastPlayed === null
                        ? 'Never played'
                        : `${song.showsSinceLastPlayed} shows since last`,
                    onclick: () => openGapExplainer(index),
                  }),
                  song.lastPlayed
                    ? el('span', { text: `· ${formatShowDateShort(song.lastPlayed)}` })
                    : null,
                ])
              : null,
          ]),
          el(
            'button.pick-btn',
            {
              type: 'button',
              'aria-label': `Remove ${p.name}`,
              onclick: () => {
                removePick(p.song_id);
                window.dispatchEvent(new CustomEvent('dozen:picks-changed'));
                paint();
              },
            },
            icon(ICONS.x, 18),
          ),
          el('span.drag-handle', { 'aria-hidden': 'true' }, icon(ICONS.grip, 18)),
        ]),
      ]);

      // Drag reordering. Pointer events cover touch and mouse alike.
      const handle = item.querySelector('.drag-handle');
      handle.addEventListener('pointerdown', (e) => startDrag(e, i));

      append(listWrap, item);
    });

    append(
      actions,
      el(
        'button.btn.btn-accent.btn-block',
        {
          type: 'button',
          onclick: async (e) => {
            const ok = await copyToClipboard(asPlainText());
            const btn = e.currentTarget;
            const original = btn.textContent;
            btn.textContent = ok ? 'Copied' : 'Copy failed — select manually';
            setTimeout(() => (btn.textContent = original), 1600);
          },
        },
        'Copy list as text',
      ),
    );
    append(
      actions,
      el(
        'button.btn.btn-block',
        {
          type: 'button',
          onclick: () =>
            openSheet('Clear all picks?', (close) =>
              el('div', { style: { display: 'grid', gap: '8px' } }, [
                el('p.note', { text: 'This removes every song from your shortlist. It cannot be undone.' }),
                el(
                  'button.btn.btn-block',
                  {
                    type: 'button',
                    onclick: () => {
                      clearPicks();
                      window.dispatchEvent(new CustomEvent('dozen:picks-changed'));
                      close();
                      paint();
                    },
                  },
                  'Clear all',
                ),
                el('button.btn.btn-block', { type: 'button', onclick: close }, 'Cancel'),
              ]),
            ),
        },
        'Clear all',
      ),
    );
  }

  /** Simple pointer-driven reorder: track which row the finger is over. */
  function startDrag(e, fromIndex) {
    e.preventDefault();
    const items = [...listWrap.children];
    const dragged = items[fromIndex];
    dragged.dataset.dragging = 'true';
    dragged.querySelector('.pick-item').dataset.dragging = 'true';

    function onMove(ev) {
      const y = ev.clientY;
      for (const [idx, node] of items.entries()) {
        const r = node.getBoundingClientRect();
        if (y >= r.top && y <= r.bottom && idx !== fromIndex) {
          reorder(fromIndex, idx);
          cleanup();
          paint();
          return;
        }
      }
    }
    function cleanup() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
      dragged.removeAttribute('data-dragging');
      const inner = dragged.querySelector('.pick-item');
      if (inner) inner.removeAttribute('data-dragging');
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
  }

  paint();
  return screen;
}
