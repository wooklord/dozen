// The app's routes and the marker each one must render.
//
// ONE LIST, shared by scripts/smoke.mjs, scripts/verify-deploy.mjs and
// scripts/layout-diff.mjs. Three copies would drift, and the copy that drifted
// would be the one checking production.
//
// Each `expect` must be text unique to ITS OWN route. A marker that also
// appears on the previous screen lets a failed render pass, because the old
// screen is still on display -- that is how a broken gap chart shipped in three
// consecutive releases.
//
// "Unique" IS NOW CHECKED, NOT ASSERTED. Two markers in this file were not:
// 'shows in the archive' also renders on song detail and in the gap explainer
// sheet, and 'Jam charts' also renders as a filter chip on Songs. Both passed
// only because of the order of this array -- reorder it and they pass for the
// wrong reason, in the file whose entire job is to prevent exactly that.
// smoke.mjs now captures every route's rendered text and cross-checks each
// marker against all the others, so this comment cannot go quietly false again.
//
// Matching is case-insensitive: several markers live in .section-title, which
// is `text-transform: uppercase`, and innerText reports RENDERED casing.
//
// `selector` is optional and is checked IN ADDITION to the text, by all three
// consumers -- so what has to be unique is the CONJUNCTION, not the text alone.
// Show detail has no text of its own that no other screen renders: its date
// heading also appears on cards, 'Setlist' appears on the gap chart's Carton
// link, 'Venue history' is also a Home button, 'Jam chart entries' is also a
// song-detail section, and 'Gap chart' is the gap chart's own heading.
// Contriving a string for it would be worse than saying plainly that its
// unique marker is structural: `.setlist-source` is emitted in exactly one
// place in the app.
export const ROUTES = [
  { hash: '#/home', expect: 'On this date' },
  { hash: '#/songs', expect: 'songs in the archive' },
  { hash: '#/shows', expect: 'Search a venue, city, state or date' },
  { hash: '#/jams', expect: 'as listed by The Carton' },
  { hash: '#/picks', expect: 'Your picks' },
  { hash: '#/song/49', expect: 'Where it has landed' },
  { hash: '#/venue/73', expect: 'Every show' },

  // THE TWO ROUTES THAT HAVE ACTUALLY BROKEN IN PRODUCTION, and which this
  // list did not cover until 0.1.62.
  //
  // Show detail is the route that served a stale views/show.js in 0.1.44 while
  // version.js read fresh. The gap chart is the route that rendered nothing for
  // three consecutive releases because views/gapchart.js called venueLine()
  // without importing it -- the failure this whole apparatus was built for.
  // smoke.mjs covered both locally the entire time; the deploy gate and the
  // layout diff walked neither, so the live check was blind to precisely the
  // two screens with a track record.
  { hash: '#/show/1728657865', expect: 'Gap chart', selector: '.setlist-source' },
  { hash: '#/gapchart/1728657865', expect: 'had passed since each song was last played' },
];

// Redirects must land somewhere real, not merely change the hash.
export const REDIRECTS = [
  { from: '#/gap', to: '#/songs' },
  { from: '#/recent', to: '#/shows' },
  { from: '#/', to: '#/home' },
];
