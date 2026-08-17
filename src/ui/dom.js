// Tiny DOM helpers. No framework, no bundler -- just enough to build elements
// without string concatenation, so nothing user-facing goes through innerHTML.

/**
 * el('div.row', { onclick }, [children])
 * Tag syntax supports `tag.class.class` and `tag#id`.
 */
export function el(spec, props = null, children = null) {
  const [tagAndId, ...classes] = String(spec).split('.');
  const [tag, id] = tagAndId.split('#');
  const node = document.createElement(tag || 'div');
  if (id) node.id = id;
  if (classes.length) node.className = classes.join(' ');

  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = [node.className, v].filter(Boolean).join(' ');
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k === 'html') node.innerHTML = v; // only ever used with our own markup
      else if (k.startsWith('on') && typeof v === 'function') {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === 'text') node.textContent = String(v);
      else node.setAttribute(k, v === true ? '' : String(v));
    }
  }

  append(node, children);
  return node;
}

export function append(node, children) {
  if (children === null || children === undefined || children === false) return node;
  if (Array.isArray(children)) {
    for (const c of children) append(node, c);
    return node;
  }
  node.appendChild(children instanceof Node ? children : document.createTextNode(String(children)));
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Inline SVG icon. Paths are ours, so innerHTML is safe here. */
export function icon(paths, size = 21) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = paths;
  return svg;
}

export const ICONS = {
  calendar:
    '<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  gap: '<path d="M4 19V9M9.5 19V5M15 19v-7M20.5 19v-3"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  jam: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  picks: '<path d="M5 3.5h14v17l-7-4.5-7 4.5z"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.6"/><path d="M20 4.5V11h-6.5"/>',
  back: '<path d="M15 19l-7-7 7-7"/>',
  check: '<path d="M4 12.5l5 5L20 6.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  grip: '<path d="M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
};

/** Debounce, used for search input so nothing fires per keystroke at the API. */
export function debounce(fn, ms = 180) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Bottom sheet. Reachable, and it doesn't require precise aiming. */
export function openSheet(title, buildBody) {
  const backdrop = el('div.sheet-backdrop', { onclick: close });
  const sheet = el('div.sheet', { role: 'dialog', 'aria-modal': 'true' }, [
    el('div.sheet-grip'),
    el('h2', { text: title }),
  ]);
  append(sheet, buildBody(close));
  document.body.append(backdrop, sheet);

  function close() {
    backdrop.remove();
    sheet.remove();
  }
  return close;
}
