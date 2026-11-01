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
// sheet, and 'Jam charts' also rendered as a filter chip on Songs (it has been
// a row in the Songs filter sheet since 0.1.79, and the sheet mounts on
// document.body only while open, so it is not in #main at rest). Both passed
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
// heading also appears on cards, 'Venue history' is also a Home button, 'Jam
// chart entries' is also a song-detail section, and 'Gap chart' is its own
// section's title since 0.1.90, when the chart's route was retired; until then
// it was that route's heading and this screen's button. Contriving a string
// for it would be worse than saying plainly that its unique marker is
// structural: `.setlist-source` is emitted in exactly one place in the app
// (the chart's Carton link under it is `.gap-chart-source`, on purpose).
export const ROUTES = [
  { hash: '#/home', expect: 'On this date' },
  { hash: '#/songs', expect: 'songs played live' },
  // "shows played ·", WITH the separator (0.1.82, third commit). The sub-line
  // reads "795 shows played · 9 upcoming", and bare 'shows played' also renders
  // on Songs ("shows played so far"), song detail, Venue's stat label and
  // Home's venue card -- the uniqueness check would catch it, so the marker
  // carries the one character the other four do not.
  { hash: '#/shows', expect: 'shows played ·' },
  { hash: '#/jams', expect: 'as listed by The Carton' },
  { hash: '#/picks', expect: 'Your picks' },
  { hash: '#/song/49', expect: 'Where it has landed' },
  // The gap history (0.1.83), on Shadow: the song with the most shows, so the
  // strip's worst case is what every consumer of this list walks. The marker
  // is the strip's caption; "Gap history" alone would also match song
  // detail's "Gap history ›" tile.
  { hash: '#/song/54/gaps', expect: 'Every gap, oldest to newest' },
  { hash: '#/venue/73', expect: 'Every show' },

  // THE SCREEN THAT HAS ACTUALLY BROKEN IN PRODUCTION, and which this list did
  // not cover until 0.1.62.
  //
  // Show detail is the route that served a stale views/show.js in 0.1.44 while
  // version.js read fresh. The gap chart was the route that rendered nothing
  // for three consecutive releases because views/gapchart.js called
  // venueLine() without importing it -- the failure this whole apparatus was
  // built for. smoke.mjs covered both locally the entire time; the deploy gate
  // and the layout diff walked neither, so the live check was blind to
  // precisely the two screens with a track record. Since 0.1.90 the chart is a
  // section of show detail, so this one entry walks both, and the chart's old
  // hash is a redirect below.
  { hash: '#/show/1728657865', expect: 'Gap chart', selector: '.setlist-source' },
];

// Redirects must land somewhere real, not merely change the hash.
export const REDIRECTS = [
  { from: '#/gap', to: '#/songs' },
  { from: '#/recent', to: '#/shows' },
  { from: '#/', to: '#/home' },
  // The per-show gap chart's own route, retired in 0.1.90 (docs/plan.md,
  // "Show detail layout", item 5). An unknown hash falls through to Home, so
  // without this every bookmark and every link in an installed shell's cached
  // pages would land there in silence.
  { from: '#/gapchart/1728657865', to: '#/show/1728657865' },
];
