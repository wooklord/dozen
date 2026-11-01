// The Shows tab's When control: its states, in one place a check can read.
//
// Shows narrows by When, by Filter and by the search box; the view is a
// preference, not a narrowing. When has exactly three states -- every show,
// one year, one month of one year -- and each has to be reachable from the
// landing and escapable back to it FROM THE SCREEN, not only from inside the
// sheet. scripts/smoke.mjs imports WHEN_STATES and walks it: a state added
// here without a driver there fails the run, and a driver there for a state
// not listed here fails it too.
//
// 0.1.82 built the three states and the checks drove them, and nothing
// enumerated them. The year-only state was reached by dismissing the sheet
// through its backdrop -- which is what the smoke test's driver did, and what
// no thumb discovers -- and left only through the sheet's first row. Nothing
// asked what the screen itself offered (docs/plan.md, "Shows nav", 2026-11-01).

export const WHEN_STATES = ['all', 'year', 'month'];

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));

/** Which state a When value is in: null is 'all', { year } is 'year', { year, month } is 'month'. */
export function whenKind(when) {
  if (!when) return 'all';
  return when.month ? 'month' : 'year';
}

/** The lead chip's and the pill's text for a When value: "All", "2019", "Aug 2019". */
export function whenLabel(when) {
  const kind = whenKind(when);
  if (kind === 'all') return 'All';
  if (kind === 'year') return String(when.year);
  return `${MONTH_SHORT[when.month - 1]} ${when.year}`;
}
