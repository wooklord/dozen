// Every external host and site-level constant, in one place.
//
// This module exists because the rule "site name and API base live in one
// config module, no hardcoded strings elsewhere" was stated from Task 0 and
// was never actually true: there were two base-URL declarations in two files
// (src/data/source.js and src/ui/components.js) and no site-name constant at
// all. A rule the codebase does not follow is worse than no rule, because it
// gets cited as though it were a guarantee.
//
// `tests/config.test.mjs` now fails if a `thecarton.net` or `google.com`
// literal appears anywhere in src/ outside this file, so the claim cannot
// quietly stop being true again.

export const SITE_NAME = 'The Dozen';

/** The Carton, the only host this app ever REQUESTS data from. */
export const CARTON_BASE = 'https://thecarton.net';
export const CARTON_API_BASE = `${CARTON_BASE}/api/v2`;

/** Songfish, credited in the attribution footer. Linked, never fetched. */
export const SONGFISH_URL = 'https://www.songfish.net';

/**
 * Google Maps search, used ONLY to build outbound deep links from Carton's own
 * venue fields. Nothing is fetched from, embedded from, or rendered from
 * Google — see the scope note in CLAUDE.md. The `api=1` form is the documented,
 * key-less search URL.
 */
export const MAPS_SEARCH_BASE = 'https://www.google.com/maps/search/?api=1&query=';
