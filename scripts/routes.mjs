// The app's routes and the marker each one must render.
//
// ONE LIST, shared by scripts/smoke.mjs, scripts/verify-deploy.mjs and
// scripts/layout-diff.mjs. Three copies would drift, and the copy that drifted
// would be the one checking production.
//
// Each `expect` must be text unique to ITS OWN route. A marker that also
// appears on the previous screen lets a failed render pass, because the old
// screen is still on display -- that is how a broken gap chart shipped in three
// consecutive releases. Before adding a route here, check its marker does not
// appear on any other screen.
//
// Matching is case-insensitive: several markers live in .section-title, which
// is `text-transform: uppercase`, and innerText reports RENDERED casing.
export const ROUTES = [
  { hash: '#/home', expect: 'On this date' },
  { hash: '#/songs', expect: 'songs in the archive' },
  { hash: '#/shows', expect: 'shows in the archive' },
  { hash: '#/jams', expect: 'Jam charts' },
  { hash: '#/picks', expect: 'Your picks' },
  { hash: '#/song/49', expect: 'Where it has landed' },
  { hash: '#/venue/73', expect: 'Every show' },
];

// Redirects must land somewhere real, not merely change the hash.
export const REDIRECTS = [
  { from: '#/gap', to: '#/songs' },
  { from: '#/recent', to: '#/shows' },
  { from: '#/', to: '#/home' },
];
