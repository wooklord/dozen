// Theme: Auto / Light / Dark.
//
// Auto is the default and follows the OS, which is the right behaviour for a
// phone that switches at sunset. But following the OS is not a sufficient
// answer on its own: without an override the app changes underneath you and
// you have no way to say no. That is what the explicit choices are for.
//
// Mechanism: `data-theme` on <html>. See tokens.css --
//   (nothing)            -> :root defaults (dark), OS-light media block applies
//   data-theme="light"   -> forced light, wins over the OS
//   data-theme="dark"    -> forced dark, excluded from the OS-light block

const KEY = 'dozen.theme.v1';
export const THEMES = ['auto', 'light', 'dark'];

/** Browser-chrome colour per theme, kept in step with tokens.css. */
const THEME_COLOR = { dark: '#14110e', light: '#faf6ef' };

export function getTheme() {
  try {
    const v = localStorage.getItem(KEY);
    return THEMES.includes(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

/** What the user will actually see right now, resolving auto against the OS. */
export function resolvedTheme(theme = getTheme()) {
  if (theme === 'auto') {
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return theme;
}

export function setTheme(theme) {
  const next = THEMES.includes(theme) ? theme : 'auto';
  try {
    if (next === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    /* non-fatal: the choice still applies for this session */
  }
  applyTheme(next);
  return next;
}

/**
 * Stamp the root element and sync the browser-chrome colour.
 *
 * In auto mode the attribute is REMOVED rather than set to "auto", so the
 * media query in tokens.css is the only thing deciding -- no attribute means
 * no override.
 */
export function applyTheme(theme = getTheme()) {
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);

  // The two media-scoped <meta theme-color> tags handle auto on their own.
  // An explicit choice needs a single un-scoped tag that outranks them.
  const explicit = document.getElementById('theme-color-explicit');
  if (theme === 'auto') {
    explicit?.remove();
  } else {
    const tag = explicit || Object.assign(document.createElement('meta'), {
      id: 'theme-color-explicit',
      name: 'theme-color',
    });
    tag.setAttribute('content', THEME_COLOR[theme]);
    if (!explicit) document.head.appendChild(tag);
  }
  return theme;
}

/** Re-render on OS changes while in auto mode, so the UI label stays honest. */
export function onSystemThemeChange(fn) {
  const mq = window.matchMedia?.('(prefers-color-scheme: light)');
  if (!mq) return () => {};
  const handler = () => {
    if (getTheme() === 'auto') fn(resolvedTheme());
  };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}

export const THEME_LABELS = { auto: 'Auto', light: 'Light', dark: 'Dark' };
