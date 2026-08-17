# The Dozen — build plan

Status: **Task 0 complete. Awaiting approval before feature code.**

Task 0 findings live in [`CLAUDE.md`](../CLAUDE.md) (CORS + traps) and
[`carton_schema.md`](carton_schema.md) (fields). Phase 2 is settled in
[`phase2_feasibility.md`](phase2_feasibility.md): infeasible, local-first alternative proposed.

## What Task 0 changed about the plan

Three findings move real weight:

1. **CORS passes** → no `scripts/sync.mjs`, no committed snapshot, no build step. Pure static
   client-side app. `src/data/source.js` still isolates every fetch so the strategy stays swappable.
2. **No play stats exist in the API.** `songs` has 7 fields and none of them are counts. Gap, times
   played, and first/last played are all **computed** from the complete `setlists` pull. This makes
   the derived-index layer (§2) the core of the app rather than a convenience.
3. **Upcoming shows carry no setlist and no format**, and `show_tags` is empty across all 804
   shows. The landing screen therefore **cannot** state an upcoming show's set structure. It shows
   venue history and recent-run history instead, clearly labeled as history. Stating a predicted
   format would violate the scope rule.

## Architecture

Static files, no build. Native ES modules, plain CSS, plain HTML.

```
index.html            single page, hash routing
CNAME                 placeholder for dozen.wooklord.net
manifest.webmanifest
sw.js                 service worker (app shell + cached API payloads)
src/
  version.js          BUILD marker — single source of truth
  app.js              router + view mounting
  data/
    source.js         ← THE ONLY MODULE THAT TOUCHES THE NETWORK
    cache.js          IndexedDB store + per-type TTL + cache age
    index.js          derived indexes (gap, counts, positions) built once per load
    normalize.js      song-name normalizer + HTML entity decode
  views/              upcoming, gap, recent, song, venue, jamcharts, scratchpad
  ui/                 shared components (song row, setlist renderer, footnote sheet, sort bar)
  scratchpad.js       localStorage shortlist
tests/
  normalize.test.mjs  unit tests, run with `node --test`
docs/
```

### Data layer rules

- **One batched cold pull**, 5 requests total, all with explicit oversized `limit`:
  `setlists?limit=20000`, `songs`, `shows`, `venues`, `jamcharts`. ~5.4 MB, dominated by setlists.
- **Truncation assertion**: after pulling setlists, assert row count and max `showdate`; if the
  count looks like a round default (4000/5000) the pull is treated as failed, logged with its URL,
  and the cached copy is kept. This guard is non-negotiable — see CLAUDE.md.
- **TTLs**: setlists/shows 6 h (changes after each show) · songs 24 h · jamcharts 24 h ·
  venues 7 d (effectively never changes). Cache age is visible in the UI with a manual refresh.
- **Simple requests only.** `fetch(url)` with no `headers` option, ever.
- Entity-decode and normalize at this boundary so no view ever sees `&#039;`.

### Derived index (built once per load, cached in memory)

From the complete setlists pull, keyed by `song_id`:
`timesPlayed`, `firstPlayed`, `lastPlayed`, `showsSinceLastPlayed`, `positionCounts`
(set 1 opener / set 1 closer / set 2 opener / set 2 closer / encore / mid-set), `isJamChart`,
`isOriginal`, `originalArtist`, and the full performance history.

Gap = number of shows in the canonical show ordering (`showdate`, then `showorder`) between the
song's last appearance and the most recent completed show. Counting only.

## Build order

Each step ends with a BUILD bump and a commit.

| # | Step | Notes |
|---|---|---|
| 0 | Scaffold: `index.html`, version marker, router, design tokens | BUILD visible immediately |
| 1 | `normalize.js` + unit tests | **Tests first** — real hazard values from CLAUDE.md |
| 2 | `source.js` + `cache.js` + truncation guard | cache age + manual refresh in header |
| 3 | `index.js` derived indexes | the gap/count engine |
| 4 | **Upcoming show** (priority 1) | date, venue, city; last time at venue; On This Date; venue play count |
| 5 | **Gap / rotation heat** (priority 2) | the core view; one toggle flips cold ⇄ hot |
| 6 | **Recent setlists** (priority 3) | last 10–15 shows; `>` vs `->` preserved; tappable footnotes |
| 7 | **Song detail** (priority 5) | gap, counts, positions, jam entries, cover/original, full history |
| 8 | **Position tendencies** (priority 4) | raw counts only, never percentages-as-forecast |
| 9 | **Jam charts** (priority 6) | browsable list + badge on song rows |
| 10 | **Pick scratchpad** (priority 7) | localStorage, drag reorder, copy as plain text |
| 11 | PWA: manifest, service worker, offline | scope `/`, own subdomain |
| 12 | Attribution pass + deep links | every show/song/venue links home to Carton |

Priority 4 lands after 5 because position tendencies reuse the song-detail breakdown.

## Design direction

Full treatment goes in `docs/design.md` at step 0. Committed direction:

- **Dark-first.** Deep warm shell, not blue-black. Venue-legible.
- **Palette**: shell near-black warm brown-grey; a single **yolk** accent (warm saturated amber)
  used *only* for the data that matters — gap magnitude, the active sort, the scratchpad. Shell
  white for text. No second accent competing with yolk.
- **Type**: one family, high-legibility grotesque, tight scale. **Tabular figures everywhere**
  numbers align in a column — this app is a table-reading app and misaligned digits are the fastest
  way to make it feel cheap. Song titles at a comfortable reading size; metadata one step down.
- **Egg/carton language, restrained**: the carton grid as a layout motif (dozen = 12-cell grid on
  the landing screen), rounded-oval cell shapes, yolk accent. **No egg illustrations, no puns in
  UI chrome.** Charm lives in the shell; the data stays plain.
- **Touch**: bottom tab bar within thumb reach, 44 px minimum targets, sort/filter as bottom
  sheets rather than dropdowns, no hover-dependent affordances.
- **Density**: the gap list is the workhorse — it must show ~8 songs per screen with song, gap,
  last played, and times played all readable at a glance.

## Open questions for the user

1. **Which show is "the" upcoming show?** Default: the next future-dated show by `showdate`
   (currently 2026-09-04, Adirondack Independence Music Festival). Alternative: a picker across all
   18 future shows. Planning to build the picker, defaulting to the nearest.
2. **Gap unit.** "Shows since last played" counted against *all* shows in the archive. Carton's own
   footnotes phrase it as "(111 show gap)", so this matches.

## Out of scope — parked

Anything crossing the scope rule goes to [`phase3_ideas.md`](phase3_ideas.md), not into the app.
