# The Dozen

A mobile-first reader for [The Carton](https://thecarton.net), the Songfish-powered Eggy setlist
archive. It repackages Carton's data for people playing a fantasy setlist game: rotation and gap,
recent setlists, position tendencies, jam charts, and a local pick scratchpad.

**Unofficial fan project.** All data comes from The Carton. Every show, song and venue view links
back to the corresponding page there.

## What it does

| Screen | What it shows |
|---|---|
| **Show** | The next show (or any of the 18 upcoming ones), what was played last time at that venue, "On This Date", and the venue's play count |
| **Rotation** | Every song with shows-since-last-played, last played, and times played. One toggle flips coldest ⇄ hottest. Filter by original/cover/jam chart |
| **Recent** | The last 15 shows, with Carton's setlist notation preserved exactly and footnotes as tappable markers |
| **Jams** | Jam chart membership, ranked by entry count |
| **Picks** | A local shortlist you can reorder and copy as plain text |
| **Song detail** | Gap, times played, first/last, where it has landed, jam entries, and every performance |

## Scope

Carton data only, repackaged: fetching, caching, joining, sorting, filtering, counting, grouping.
**No predictions, no probability models, no scores, no recommendations, no external data.** The
test applied to every label: *if it describes what has happened, it ships; if it implies what will
happen, it doesn't.* See [`CLAUDE.md`](CLAUDE.md) for the full rule and
[`docs/phase3_ideas.md`](docs/phase3_ideas.md) for what was deliberately left out.

## Running it locally

No build step, no dependencies, no bundler — native ES modules and plain CSS. It must be served
over HTTP (ES modules and service workers do not work from `file://`):

```sh
cd dozen
python -m http.server 8080     # or: npx serve .
# open http://localhost:8080
```

Run the tests:

```sh
node --test
```

## Architecture

```
index.html            single page, hash routing
sw.js                 service worker (app shell only — never caches API responses)
src/
  version.js          BUILD marker, single source of truth
  app.js              boot, router, refresh, cache status
  data/
    source.js         the ONLY module that touches the network
    cache.js          IndexedDB + per-type TTLs
    index.js          derived indexes (gap, counts, position slots)
    normalize.js      song-name normalizer + entity decoding
  ui/                 dom helpers, shared components
  views/              one file per screen
tests/                node --test
docs/                 plan, schema, design, parked ideas
```

### Data flow

Cold start is **one batched pull** (5 requests, ~5.4 MB) into IndexedDB, then an **independent
verification**: per-year setlist counts are summed and compared against the full pull on both row
count and newest date. On mismatch it hard-fails and keeps the previously cached data rather than
replacing it with something subtly wrong.

Afterwards, refresh pulls **the current year only** and merges it. Because Carton editors amend old
setlists retroactively, a **full rebuild** is available behind a confirm dialog in the header's
cache panel.

Cache age, row count and newest show date are all visible in that panel — a stale or truncated
index is diagnosable without dev tools.

### The BUILD marker

`BUILD 0.1.x` renders in the page header at all times and is bumped on every change that ships to
the browser. It is how a deploy gets confirmed. It lives in `src/version.js`; the service worker
cache name in `sw.js` is bumped to match.

## Gotchas worth knowing

Full detail in [`docs/carton_schema.md`](docs/carton_schema.md). The ones that bite:

- **`/setlists.json` silently truncates at 4000 rows** (real total: 6361) with no error. Always
  pass an explicit oversized `limit`, and verify independently.
- **The `list` method sends no CORS header** and is unreachable from a browser, unlike every other
  method. It also serves JSON as `text/html` and reports `error` as `0` rather than `false`.
- **A bad method or column name returns an HTML page under HTTP 200**, so `res.json()` throws.
- **Field names differ across methods**: `showyear` vs `show_year`, `show_id` vs `showid`,
  `jamchart_notes` vs `jamchartnote`, `songname` vs `name` vs `song_name`.
- **`venuename` is HTML-entity-encoded in `shows` but raw in `setlists`.** Decoded once at ingest.
- **Song names use both U+2019 and U+0027 apostrophes** in the same field. Case-folding alone is
  not enough; see `tests/normalize.test.mjs`.
- `/api/` is robots-disallowed for crawlers. This app caches aggressively, never polls, and never
  fires a request per keystroke.

## Deploying to dozen.wooklord.net

The repo root is the site root. `CNAME` is already committed with `dozen.wooklord.net`, and the
manifest's `scope` and `start_url` are `/`, assuming a subdomain rather than a `github.io` path.

**GitHub Pages setup:**

1. Create the repo on GitHub and push (see the checklist at the end of the session notes).
2. Settings → Pages → Source: *Deploy from a branch*, branch `main`, folder `/ (root)`.
3. Settings → Pages → Custom domain: `dozen.wooklord.net`. This reads the committed `CNAME`.
4. Tick **Enforce HTTPS** once the certificate is issued (can take up to an hour).

**DNS at your registrar for `wooklord.net`:**

| Type | Name | Value |
|---|---|---|
| CNAME | `dozen` | `<your-github-username>.github.io.` |

That single record is all that is needed for a subdomain. Do **not** add A records — those are only
for apex domains. Propagation is usually minutes; GitHub will show "DNS check successful" on the
Pages settings screen when it is ready.

**Confirming a deploy landed:** load the site and read the `BUILD` marker in the header. If it
hasn't changed, the deploy hasn't landed (or the service worker is serving a cached shell — pull
to refresh, or use the cache panel's full rebuild).

## Credits

Setlist data from [The Carton](https://thecarton.net), powered by
[Songfish](https://www.songfish.net). This is an unofficial fan-made reader; please visit The
Carton for the source of truth.
