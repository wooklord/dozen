# The Dozen — build plan

Status: **Task 0 complete. Plan approved with amendments 2026-08-17. Building.**

Task 0 findings live in [`CLAUDE.md`](../CLAUDE.md) (CORS + traps) and
[`carton_schema.md`](carton_schema.md) (fields).

## Phase 2 — conclusion

**Phase 2 as specified is infeasible.** There is no authenticated API, and the API's wildcard
`Access-Control-Allow-Origin: *` is by specification incompatible with credentialed requests — a
browser will not attach credentials to a wildcard-ACAO response, so an authenticated browser client
cannot exist regardless of what endpoints do.

**The substitute, which is what gets built if/when we get there:** local attendance tracking keyed
on Carton's own `show_id`, stored on-device, with JSON export and import. Keying on `show_id` means
any future sync reconciles exactly, with no fuzzy matching.

Detailed findings are in untracked local notes at `docs/local_notes/phase2_feasibility.md`
(gitignored, deliberately not part of this repo).

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

> **Pre-build sketch, superseded by the repo.** The tree below is what was planned on 2026-08-17.
> Views and tests have since been renamed, split and multiplied, and this file is not kept in step
> with them: `src/` and `tests/` are canonical, and this block is kept only as the record of what
> was intended. Do not treat a name here as the name of a file.

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
    cache.js          IndexedDB store + one archive TTL + cache age
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

- **One batched cold pull**, 6 requests total, all with explicit oversized `limit`:
  `setlists?limit=20000`, `songs`, `shows`, `venues`, `jamcharts`, `albums`. ~0.6 MB over the wire,
  dominated by setlists (5.4 MB is the parsed size, not the download). The count is exported as
  `COLD_PULL_STEPS` from `src/data/source.js` — the loader splits its twelve cells by it.
- **Simple requests only.** `fetch(url)` with no `headers` option, ever.
- **Check `content-type` before parsing.** A bad method or column returns an HTML error page with
  HTTP 200, so a bare `res.json()` throws a confusing `SyntaxError`. Report the offending URL.
- Entity-decode and normalize at this boundary (see *Decode once* below).

### Integrity check — the real invariant, not a heuristic

A round-number row count only catches the failure mode we happened to trip over. The actual
invariant is an **independent recount**, which is the check that found the bug in the first place:

1. `GET /list/year.json` → the authoritative year list (2013–2026).
2. For each year, `GET /setlists/showyear/YYYY.json` → per-year row counts.
3. **Assert** the full pull's row count equals the sum of per-year counts, **and** that its max
   `showdate` equals the max across per-year pulls.

**On mismatch: hard fail.** Refuse to write the cache, keep the previously cached data rather than
replacing it with something subtly wrong, surface it in the UI, and log the exact URL alongside
both counts (expected vs received).

The cheap tripwire stays as a first line — an exactly-round row count (4000/5000) fails immediately
without spending 14 requests. It is the fast path, **not** the only check.

A second tripwire was planned here and is **not** in the code: failing when the newest setlist row
is older than the newest show in `shows`. `shows` carries upcoming shows with no setlist, so it
failed on healthy data. `CLAUDE.md`, *Dead code is not always safe to simply switch on*, records
the removal and why no tolerance fixes it.

Cost control: the per-year recount is 14 extra requests, so it runs on **full rebuilds only**, not
on the incremental fast path. That's the trade — the expensive pull is the one that gets verified.

### Refresh strategy

6361 rows over festival wifi is this app's main performance risk. Three paths:

| Path | When | Cost |
|---|---|---|
| **Cold / full** | first run, or manual rebuild | 6 requests + 14 verification requests, ~1.0 MB wire / 11.6 MB parsed |
| **Fast** | TTL expiry, or pull-to-refresh | current year only (`setlists/showyear/2026` ≈ 948 rows, ~800 KB) merged into the stored index |
| **Manual full rebuild** | user-initiated, **behind a confirm dialog** | same as cold |

The full pull lands in IndexedDB once. Afterward the fast path re-pulls the **current year only**
and merges by `uniqueid` into the stored index — that covers new shows and same-year edits.

**Carton editors amend old setlists retroactively**, which the fast path cannot see. So the manual
full rebuild is a permanent, visible feature — surfaced in the UI with a confirm dialog explaining
it re-downloads everything, not hidden behind a gesture.

**Always visible in the UI**: cache age, total row count, and the archive's newest `showdate`. A
stale or truncated index has to be diagnosable without dev tools.

- **TTL**: ONE value, `ARCHIVE_TTL`, 6 h — the setlists table is what moves, and it moves after
  each show. This was documented as five per-type TTLs (setlists/shows 6 h · songs 24 h ·
  jamcharts 24 h · venues 7 d) and four of them could never fire: the whole archive is written as
  a single blob under a single key with a single `fetchedAt`, so there is no per-type timestamp to
  expire against. Splitting the payload per type would make per-type TTLs possible and is a real
  change with a real benefit (venues genuinely never move); it has not been made.

### Decode once, at the boundary

`venuename` is entity-encoded in `shows` (`Annabel&#039;s`) and raw in `setlists` (`Toad's Place`).
Every row is passed through a single ingest step **as it enters the index** — not at render — so
two views can never disagree about a venue's name. The same step applies apostrophe folding for
name matching. No view or component ever calls a decode function.

### Derived index (built once per load, cached in memory)

From the complete setlists pull, keyed by `song_id`:
`timesPlayed`, `firstPlayed`, `lastPlayed`, `showsSinceLastPlayed`, `positionCounts`, `isJamChart`,
`isOriginal`, `originalArtist`, and the full performance history.

Gap = number of shows in the canonical show ordering (`showdate`, then `showorder`) between the
song's last appearance and the most recent completed show. Counting only.

### Set membership and position — exact field derivation

Positional tendencies depend entirely on these, so the derivation is specified rather than assumed.
**Fields used, and only these:** `show_id`, `showdate`, `showorder`, `settype`, `setnumber`,
`position`, `song_id`, `transition_id`.

**Canonical show ordering** — `showdate` ascending (ISO strings sort lexically), tie-broken by
`showorder` ascending. Gap positions are counted by **date** over this ordering, so two shows
on one date share a position — see *Gap convention* below.

**Set identity** — the tuple `(show_id, settype, setnumber)`. `setnumber` is a **string**
(`"1"`, `"2"`, `"3"`, `"e"`, `"e2"`) and is never sorted or compared numerically. Sets are ordered
within a show by an explicit rank map, not by string sort (`"e"` must land after `"3"`, and plain
string sort would put it before):

```
"1" -> 1    "2" -> 2    "3" -> 3    "e" -> 90    "e2" -> 91
```

**Slot classification** — computed per set, from `position` relative to that set's own rows:

| Slot | Condition |
|---|---|
| `set1-opener` | `settype="Set"`, `setnumber="1"`, `position` = min in set |
| `set1-closer` | `settype="Set"`, `setnumber="1"`, `position` = max in set |
| `set2-opener` / `set2-closer` | same, `setnumber="2"` |
| `set3-*` | same, `setnumber="3"` |
| `oneset-opener` / `oneset-closer` | `settype="One Set"`, min/max `position` |
| `encore` | `setnumber` is `"e"` or `"e2"` (every encore song counts, not just first) |
| `mid-set` | anything else |

Notes that matter:

- **`settype="One Set"` is tracked separately from `settype="Set"`, never merged.** 1486 rows are
  `One Set / 1` and 3031 are `Set / 1`; collapsing them would silently claim a festival one-set
  opener is the same slot as a two-set show's set 1 opener. They're different picks.
- **Opener and closer are positional, derived from min/max `position` within the set** — *not* from
  `transition_id`. Ids 4/5/6 render as end-of-set markers, but `transition_id: 1` also appears
  last-in-set 21 times, so transition id is not a reliable end-of-set signal.
- A single-song set makes that song **both** opener and closer; it is counted in both buckets, and
  the UI shows raw counts so this is visible rather than hidden.
- `transition_id` is carried through **only for rendering** segues (`>` vs `->`), never for
  classification.

All of this is counting Carton's own `position` field. **Raw counts are displayed, never
percentages** — a percentage of past placements reads as a forecast of the next one.

## Review gate

Amended 2026-08-17, deliberately loosening the original plan-before-edit default:

- **Steps 0 through the first screens are pre-approved as a batch.** Build them without stopping.
- **Bring a plan only when** a change touches something already shipped, or deviates from this
  document.
- **Commit often** — the session may end without warning and must be resumable from a phone.

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

## Upcoming show — settled

- **Picker across all future shows**, defaulting to the nearest.
- **The selection persists** (`localStorage`). During a run the user is looking at tomorrow's show;
  it must not snap forward to the next one on reload. The stored selection is cleared only when
  that show's date has passed.
- **"Future" is defined by LOCAL date, not UTC.** Comparison is done against a locally-formatted
  `YYYY-MM-DD` string, never `toISOString()`, which would roll the date over at 8pm EDT — exactly
  when someone is standing in a venue looking at this screen.
- **No format is asserted.** Carton has no format data for future shows. Instead the screen shows,
  clearly labeled as history:
  - observed set structures of already-played shows in the **same consecutive-date run**,
  - observed set structures of **prior shows at that venue**,
  - what was played last time at that venue, "On This Date", and the venue's play count.

## Gap convention — Carton's Show Gap column, exactly

**Definition shipped (BUILD 0.1.78):** *gap* means what the **Show Gap** column on a
`thecarton.net/song/{slug}` page means, and the current gap means that page's "which was N
show(s) ago". The rule, measured against 19 song pages on 2026-10-24 — **1069 of 1069 per-play
rows and 19 of 19 current gaps** — and the reasoning for adopting it, are in the ruling *Gap
convention — REVERSED* under *Scope rulings* below, which also quotes the withdrawn convention's
rationale verbatim. In brief:

1. **The universe is every Eggy show** (`artist_id` 1) with a valid date, dated on or before
   today, **including shows with no setlist rows.** Upcoming shows are excluded, and so is the one
   `artist_id` 2 show. "Through today" is recorded as unproven in the ruling.
2. **Position is by date.** A date's position is the number of universe shows dated on or before
   it; two shows on one date share a position.
3. **Gap at a performance = position(this) − position(previous performance).** Consecutive dates
   give 1; a second performance on one date gives 0.
4. **Current gap = position(newest played date) − position(last performance).** Played at the
   newest show reads 0.
5. **A debut is a badge, not a gap.** Carton prints the debut date's position there; the app does
   not count it as a closed gap, so the longest gap is a max over gaps between performances only.

`scripts/gap-oracle.mjs` re-proves the rule against the live site, through the app's own
`buildIndex()` and `gapAtShow()`, and SKIPs rather than passes when Carton is unreachable.

**Carton's own footnote gaps are not reproducible, and we do not try.** Measured before the first
convention was settled: 58 footnotes stated an explicit `(N show gap)` and no single rule
reproduced them —

| Rule | Matches |
|---|---|
| all shows, difference | 9 / 58 |
| all shows, difference − 1 | 29 / 58 |
| shows-with-setlists, difference | 9 / 58 |
| shows-with-setlists, difference − 1 | 28 / 58 |

Footnotes days apart use different conventions, which means they are **static text written at
different times against a growing archive** — not output of a live formula. That finding stands.
What it never measured was the Show Gap *column*, which is computed live and is the thing this
app now matches. The footnote text is still rendered verbatim beside our figure, never reconciled.

The UI states the convention and the counted-show total, so the number is never a bare figure the
user has to take on faith — and the "How gap is counted" sheet says, in one line, that it is
Carton's figure.

## Scope rulings

Decisions on where a specific feature sits against the hard scope rule in `CLAUDE.md`, dated,
so they are not re-argued.

### "Longest observed gap" per song — IN scope (2026-10-21)

It is the **maximum of the per-show historical gaps the app already renders** through
`gapAtShow()`: every gap chart lists, for every song in a show, how many counted shows had passed
since that song was last played. Taking the largest of those figures for one song is a max over
displayed, Carton-derived numbers — sorting and counting, not a statistic The Carton never shows.

**The word "observed" is deliberate and stays.** It describes what has happened. Not "record gap",
not "bustout", no language that implies what will happen.

Design decisions recorded with the ruling:

> **Decisions 2 and 6 below were withdrawn on 2026-10-24, and 3's open-span clause and 5 fall
> with them.** They are left in place, as decided, so the reasoning that produced 0.1.76–0.1.78
> stays visible. The withdrawal, with its reason, and the two rulings made in the same session
> are recorded after decision 6.
>
> **Later the same day, the withdrawal of decision 2 was itself withdrawn in part** — the figure
> under the "Longest gap" sort is again max(closed, open), with 3's open-end marker and 5's
> "still open" wording back in service. Decision 6 stays withdrawn: one flat list, no sections.
> See "0.1.81 design" below, after the "Passed longest gap" ruling.

1. **A sort mode, not a threshold filter.** "Longest gap" joins the Songs sort modes,
   descending. No cut-off that would need a number invented to set it.
2. **Longest = max(closed gaps, current open gap)**, and the figure is flagged when the open gap —
   shows since the last performance, still growing — is the longest. A one-play song has only
   its open gap. An exact tie between the open and a closed gap reads as open: the open one is
   the same length and still counting.
3. **The row shows the number plus the two bounding show dates**, from and to; when the span is
   open the "to" end is an open marker rather than a date.

   **As originally decided (2026-10-21): a chip on every song row, under every sort.** That was
   made in chat without the 0.1.73 one-figure-per-row rule in view (`design.md`, 0.1.73: each
   Songs row carries exactly one figure column and the meta line is the date), and it would have
   reversed that rule unknowingly — a second number on every row under every sort.

   **Amended the same day:** the longest gap is the row **figure** under the "Longest gap" sort
   only, with the span (`from → to`) replacing the date line on that sort. The other four sorts
   render exactly what they did. Song detail carries the longest span under every sort, for every
   played song including one-play songs, so a figure seen in the list never vanishes on tap.
4. **Sort selector: the 0.1.75 lead-chip + bottom-sheet pattern**, not a fifth chip. Measured
   headless at 390px: five chips need 504px of content width against 390px visible, and the
   four-chip bar already overflowed by 7px (397px) with the scrollbar hidden. The lead chip reads
   the active sort and opens the sheet with the five modes.
5. **Open-span marker text is "still open"** — it describes the present state (not played again
   as of the newest counted show) in the ruling's own word.
6. **The list is sectioned by whether the longest gap is still open (2026-10-21).** Under the
   "Longest gap" sort the rows are grouped: **Still open** first, then **Closed**, then **Never
   played**, each under a header carrying that section's count, each sorted descending within
   itself. Asked for after seeing 0.1.76 on the phone: an interleaved list made it hard to tell
   which gaps were still running and which had ended. Grouping by a Carton-derived flag is grouping,
   which the scope rule allows, and the header words are this ruling's own.

#### Withdrawal of decisions 2 and 6 (2026-10-24)

> **Partly reversed later on 2026-10-24, after a day on 0.1.80.** The withdrawal of decision 2
> (max of closed and open, ties read open) is itself withdrawn; the withdrawal of decision 6
> (sections) stands. The paragraph below headed "What 'longest observed gap' means now: CLOSED
> gaps only" describes 0.1.79 and 0.1.80 and no later build. It is left as written, because it
> was the reasoning that shipped, and the reversal with its own reason is recorded under
> "0.1.81 design" below.

**Withdrawn: decision 2** (longest = max(closed gaps, current open gap), ties read open) **and
decision 6** (Still open / Closed / Never played sections). Decision 5's "still open" marker and
decision 3's open-end marker exist only to serve 2 and 6 and go with them.

**Reason.** The Still open section is, by construction, the set of songs whose current gap is
their longest, sorted by that current gap — which is a strict subset of the "Coldest first" sort
in the same order. Two sorts on the Songs tab were repeating each other, one of them under a
header. Noticed on the phone after 0.1.78.

**What "longest observed gap" means now: CLOSED gaps only** — the largest span between two
performances, which is what `longestObservedGap()` computed before 0.1.76. No sections, no open
marker, no tie rule, because there is no open figure to tie with. A one-play song has no closed
gap and reads as having no observed gap; it is not an open span of its own. **Decision 1 (debuts
excluded) stands**, and the IN-scope reasoning at the top of this ruling is unchanged: a max over
per-show figures Carton renders.

The implementation of 2 and 6 — the `longestGap()` wrapper, the sections, the "still open"
marker, the open-span date line, and the tests and smoke checks that pinned them — was removed
in 0.1.79. This record landed first, in its own commit, so the two could not disagree without one
of them saying so.

#### Songs with zero Eggy performances are hidden from the Songs tab (2026-10-24)

**Ruling.** The Songs tab lists the songs Carton's own song list lists: `thecarton.net/song/`,
headed as every song played live, with the artist filter on Eggy. The `songs` endpoint carries
entries that list never shows, and the app had been rendering them as a catalogue of 370 with a
"Never played" tail. Hiding them is filtering on a Carton-derived count, and it matches the
page the app is a reader for.

**Reconciled 2026-10-24, measured, not assumed.** Carton's Eggy index has **360** rows, not 361.
The 361 is the page's own `<meta name="description">` ("Complete list of 361 Eggy songs"), and
the page overcounts itself: its table has 360 rows. The description is also the figure a search
result or link preview shows, which is how it gets quoted. Fetched at its real URL and at `/song/by/eggy`, the URL the page's own artist
filter builds (identical lists, 200, no redirect, no `data-song-id` — an index, not a song
page). The endpoint has 370. Every one of the 360 is in the endpoint, and on every one of them
Carton's "Times Played Live" equals the app's Eggy-only count — 360 agree, 0 disagree. The ten
in the endpoint and not in the index:

| id | name | original artist | Eggy plays | other-artist plays | in Dani Battat index |
|---|---|---|---|---|---|
| 36 | B7 | Eggy | 0 | 0 | no |
| 45 | Mountain On The Horizon | Eggy | 0 | 0 | no |
| 60 | Spinning Wheels | Eggy | 0 | 0 | no |
| 67 | Waiting | Eggy | 0 | 0 | no |
| 329 | barr | Eggy | 0 | 0 | no |
| 354 | Candy Mountain Run | Bruce Hornsby | 0 | 0 | no |
| 358 | You Can Close Your Eyes | James Taylor | 0 | 1 | yes, times 1 |
| 359 | Freeway Flowers | Eggy | 0 | 1 | yes, times 1 |
| 360 | Windblown Eyes | Jack Johnson | 0 | 1 | yes, times 1 |
| 366 | When I Paint My Masterpiece | Bob Dylan | 0 | 0 | no |

**The set is exactly the app's "Never played" group of ten** — same ten ids, nothing on either
side of the equality unaccounted for. Seven have no setlist row by any artist. Three were played
once, at the 2026-02-10 Dani Battat show (`artist_id` 2), and Carton files them under that artist
only: its Dani Battat index (`/song/by/dani-battat`) has five rows, those three plus Thorns and
Boom or Bust, which sit in the Eggy index too because Eggy has played them. So the rule that
reproduces Carton's membership is the one the app already applies to counts: **at least one
performance where `artist_id` is 1 or absent, on a row that is not `_custom_`.**

**The endpoint carries nothing that marks them.** Seven fields, the same on every row (`id`,
`name`, `slug`, `isoriginal`, `original_artist`, `created_at`, `updated_at`): no soundcheck flag,
no times-played, no played-live marker, and the timestamps do not separate the ten from the rest.
Membership is derivable from `setlists` only. Two oddities seen and not acted on: 366 is a second
row named "When I Paint My Masterpiece " — same name, trailing space included, as 365, which is
the one that has been played — so song names are not unique in the catalogue and a check that
matched the hidden set by name failed on the played row the first time it ran (0.1.79; the smoke
test keys on `data-song-id` now). And 329 is "barr" with slug `barra`, no performance anywhere.

The list above is a measurement from one day. The catalogue parity check in `scripts/smoke.mjs`
must assert equality with the endpoint **minus the songs with zero Eggy performances**, derived
on the day it runs — not against this table, and not loosened to "fewer than the endpoint".

#### "Passed longest gap" filter — IN scope (2026-10-24)

**Ruling.** A Songs filter that keeps the songs whose **current gap exceeds their longest
observed (closed) gap** is in scope. It is a true/false test on two figures Carton prints — the
current gap from the song page's Show Gap column, the longest closed gap as a max over the same
column — and a true/false test on displayed figures is filtering, which the scope rule allows.

> **Amended 2026-10-24, same day, BUILD 0.1.80: the chip reads "Passed longest gap", not "Past
> longest gap".** "Past" also reads as the adjective "previous", so the chip could be taken as
> naming a historical longest gap — the sort beside it — rather than the comparison. "Passed" is
> only the verb. "Past" was the chat's suggestion; the rename is the user's. The count line, the
> predicate `isPastLongestGap` and the filter key are unchanged; 0.1.79 shipped and was verified
> live under the old label, so this is a bump, not a second commit under it.

The lines it stays behind:

- **No derived number is ever rendered.** Not the difference, not the ratio, not "by N shows".
  The row shows the figures it already shows under the active sort.
- **The chip and its explainer state the comparison literally** — the current gap is longer than
  the longest closed gap — with no "due", "watch", "bustout", "overdue" or any word about what
  will happen. The language test in `CLAUDE.md` applies to every string.
- **The comparison is strict.** A song whose current gap equals its longest observed gap is not
  kept: equal is not longer, and the chip says longer. Measured 2026-10-24: 2 songs tie, 67
  exceed.
- **Songs with no closed gap are excluded.** A song played at only one show — once, or several
  times on one date — has no gap between two performances, so there is nothing to compare; the
  filter does not treat "no closed gap" as zero. 103 songs today, 97 of them single plays.
- **It composes with every sort**, as the other filters do. It does not imply an order of its
  own.

#### 0.1.81 design — locked 2026-10-24, after a day on 0.1.80

Five decisions, made in chat and recorded before any code. The language test in `CLAUDE.md`
was applied to every string below.

**(a) Decision 2 is reinstated; decision 6 stays withdrawn.** Under the "Longest gap" sort the
figure is again **max(closed gaps, current open gap)**. When the open gap is the longest, the date
line reads **"still open"** at its open end (decision 5's words). An exact tie between the open
gap and a closed gap **reads open** — the open one is the same length and still counting. There
are **no sections**: one flat list, descending.

This is a reversal of a reversal, and both are kept with their dates and reasons:

- **2026-10-24, morning — withdrawn** (above): the Still open section duplicated the "Coldest
  first" sort under a header, so the open figure went and the sort read closed gaps only.
- **2026-10-24, evening — reinstated in part**, the user's call after using 0.1.80 on the
  phone: with closed gaps only, **103 songs dropped to a dash** (the songs with no closed gap, 97
  of them single plays) and the list **hid every gap that is still running**. The duplication the morning
  withdrawal found was the *section*, not the figure. The sort should show every song's longest
  gap; **separating open from closed is the filter's job**, not the sort's. So the figure comes
  back and the sections do not.

**(b) New filter: "Closed gaps only."** Keeps the songs whose longest gap is a closed one — a
closed gap exists **and is strictly longer than the current gap**. One-play songs are out (no
closed gap). A tie is out: it reads open, per (a). With "Passed longest gap" (current gap strictly
longer than the longest closed gap) the two filters **partition the songs that have both a closed
gap and a current gap**; the tied songs appear only under All. Measured 2026-10-24: 2 tie.

Two readings were offered and this is reading (1). Reading (2), a *figure mode* that would show
the closed gap for every song, was rejected: it changes the number rather than the rows, and does
nothing under the other five sorts, so it is not a filter.

**(c) New sort: "Least played."** Times played ascending, then name A–Z. Ties at one play put
roughly a hundred songs alphabetically at the top of the list. That is correct and is noted here
so it is not read as a bug.

**(d) Under the "Longest gap" sort the cover credit leaves the date line.** The span
(`from → to`) truncated it on every cover row at 390px. The other sorts keep the credit exactly
as they render it now.

**(e) Controls: sort and filter are two lead chips on one row.** Each chip carries its own
small uppercase label inside it, muted, with the value in the lead paint: "SORT Longest gap ▾"
and "FILTER All ▾". The chips do **not** ellipsize: a chip that fits by truncating its own value
is the thing the bar-fit assertion exists to catch. **The widest pair fits at 390px and does not
fit at 360px**, the width of many Android phones — added at approval, 2026-10-24 — so the fallback
is implemented, not noted: the value wraps to a second line inside a taller chip, the bar follows,
never ellipsis, never a shorter label. The smoke test measures the widest pair at both widths; the
numbers are in `design.md` (0.1.81). Each chip opens its bottom sheet, which lists every option as a full-width row:
the name, then a one-line description beneath it. Descriptions locked verbatim, filters in this
order:

| Sheet | Option | Description |
|---|---|---|
| Sort | A–Z | Alphabetical. The number is times played. |
| Sort | Coldest first | Most shows since last played, first. The number is shows since played. |
| Sort | Hottest first | Fewest shows since last played, first. The number is shows since played. |
| Sort | Most played | Times played, highest first. |
| Sort | Least played | Times played, lowest first. |
| Sort | Longest gap | The longest gap each song has been through, biggest first — closed or still open. The number is that gap; the date line shows the two shows that bound it, or "still open". |
| Sort | Shortest gap | The longest gap each song has been through, smallest first — closed or still open. The number is that gap; the date line shows the two shows that bound it, or "still open". **Added 2026-10-25, for parity** (Coldest/Hottest, Most/Least played, Longest/Shortest gap): the same `longestGap()` figure ascending, ties by current gap ascending, then name. Same figure column, same span date line, same no-cover-credit rule as Longest gap. Ships in 0.1.82, its own commit. |
| Filter | All | Every song played live, as listed by The Carton. |
| Filter | Originals | Eggy originals only. |
| Filter | Covers | Covers only. |
| Filter | Jam charts | Songs with at least one jam chart entry. |
| Filter | Closed gaps only | Songs whose longest gap has ended — a gap between two performances, longer than the one running now. A song played at only one show is left out. |
| Filter | Passed longest gap | Songs whose current gap is longer than any gap they have closed before. A song played at only one show is left out. |

Count lines, locked with them:

| State | Count line |
|---|---|
| Longest gap sort, All | `N songs · the longest gap each song has been through, open or closed` |
| Closed gaps only, any sort | `N songs whose longest gap has ended` |
| Passed longest gap, any sort | `N songs whose current gap is longer than any gap they have closed before` — the filter description's own words. **The lock of 2026-10-24 said "unchanged", and is withdrawn as an oversight:** it was written before the max figure came back into song detail's "longest observed gap" label, where for every Passed song that figure equals the current gap, so the 0.1.79 wording would have told the reader one of two equal numbers was longer than the other. Ruled 2026-10-24 on the cold review's finding, second commit under 0.1.81 |

> The handoff that carried this design into the build session was cut off after the first two
> sort descriptions; the rest arrived with the approval of the change plan, which also ruled
> that **song detail shows the same max figure as the list, with "still open" when open** —
> decision 3 requires it, and the handoff had not said so.

#### 0.1.82 design — the Shows tab gets the Songs-tab control pattern (locked 2026-10-25)

Seven decisions, made in chat and recorded before any code. The language test in `CLAUDE.md`
was applied to every string below. Everything here is scope-clean: set count, encore presence and
state are Carton fields or counts over Carton rows, and nothing is inferred.

**(a) Three lead chips on ONE row:** "WHEN All ▾", "FILTER Off ▾", "VIEW Compact ▾" — the 0.1.81
labelled-chip pattern exactly (inner uppercase label, value in lead ink, no ellipsis, wrap
fallback, grid bar with `auto` tracks). The values are deliberately short. When reads "All", a year
("2026") or a month ("Oct 2026"); Filter reads "Off" or "N on"; View reads "Compact" or "Detail".

> **Amended 2026-10-25, at approval of the change plan, after measuring.** Three labelled chips
> do not fit. Measured headless with the app's own CSS, a grid bar with three `auto` tracks, the
> widest trio ("Oct 2026" / "3 on" / "Compact"); the bar has 358px between its paddings at 390 and
> 328px at 360:
>
> | Trio | 390px | 360px |
> |---|---|---|
> | WHEN Oct 2026 · FILTER 3 on · VIEW Compact | fits only by wrapping two values, "Oct / 2026" and "3 / on", bar 56px | **overflows, 365px of content in 360px** |
> | Oct 2026 (no label) · FILTER 3 on · VIEW Compact | one line each, bar 50px, 345px of 358 | "3 / on" wraps although space was not the cause |
> | the same, "3 on" one non-breaking token | one line each, bar 50px | only "Oct / 2026" wraps, bar 56px, no overflow |
> | the same, "Oct 2026" also non-breaking | one line each | overflows by 1px |
>
> The overflow in the first row is the 0.1.75 defect and is not allowed, so: **the When chip
> carries no inner label** — a year or a month is self-labelling — **and the Filter value "N on" is
> one token**, joined with a non-breaking space (U+00A0) so it never splits into "3" over "on". The
> 0.1.81 wrap rules still govern: no ellipsis, no CSS `nowrap`, the value wraps inside a taller
> chip. **The When value wraps at 360** ("Oct" over "2026") and sits on one line at 390; the Filter
> and View values sit on one line at both. The smoke test asserts all of that at both widths.

**(b) The DEFAULT is every played show, newest first, in COMPACT view:** one row per show — the
date, `venue · city, ST`, and a set-structure badge ("2 sets + E", "1 set", or "No setlist" when
none is recorded). Tapping a row opens show detail. "Detail" is the current setlist-card list,
unchanged, and **the view choice persists in localStorage.** When and Filter are session state,
like Songs' sort.

**(c) When sheet:** "All shows" on top (description: "Every show played, newest first."), then the
existing year grid, then the month row, which activates once a year is picked — the 0.1.75
year-then-month drill-down relocated into one sheet. The search box narrows whatever When has
picked.

**(d) Filter sheet: THREE groups, one choice per group, "Any" is the off position, and the groups
AND together.**

| Group | Options | Description |
|---|---|---|
| Sets | Any / 1 / 2 / 3+ | Sets counted from the setlist, encore not included. Shows with no setlist recorded are left out when this is set. |
| Encore | Any / With / Without | Whether the setlist has an encore set. |
| State | a scroll wheel, "Any" on top, populated from the `venues` table | Scroll the wheel. States and provinces come from the venue list; only ones Eggy has played appear. |

An apply button reads "Show N shows" with the live count; "Clear all" resets every group. Active
filters render as removable pills under the chip bar, and the chip reads "N on". A show with no
setlist rows has no set count: it is excluded whenever Sets or Encore is set, included under Any.

> **Amended 2026-10-25, third commit under 0.1.82: the apply button pluralises** — "Show 1 show",
> "Show 17 shows" — **and at zero reads "No shows match" and is disabled.** The lock above was the
> form of the button, a verb and the live count, not its grammar; "Show 1 shows" and "Show 0 shows"
> both shipped in the first commit and were raised by the cold review as a wording question.

**(e) View sheet:** Compact ("One row per show: date, venue, and how many sets. Tap a row for the
setlist.") and Detail ("The full setlist card for every show, with Carton's notation and
footnotes."). Footer line: "The view sticks until changed. Either view respects When and Filter."

**(f) A Festival / Regular filter was in the mockup and is PARKED, not ruled out.** It needs a
Carton field that marks a festival show. The diagnosis that decides whether it ever comes back is
the first step of the 0.1.82 build session: does any Carton field mark one — `show_tags` on
`shows`, a venue flag, anything on `setlists`? If nothing does, it stays parked. (The schema
already records `show_tags: []` on every show; the diagnosis re-measures against the live API
rather than trusting that line.)

**(g) Count line:** "N shows · newest first". With filters on, each active filter in its own words,
in group order: "N shows · 2 sets · in MI · newest first".

> **Amended 2026-10-25, third commit under 0.1.82: the sub-line reads "N shows played · M
> upcoming"** from the live counts (795 · 9 today), replacing "804 shows in the archive", so the
> sub-line and the count line agree instead of sitting three lines apart with different numbers for
> what reads as the same thing (the 804 counted upcoming shows). The route marker in
> `scripts/routes.mjs` moves with it, to `shows played ·` — with the separator, because bare "shows
> played" also renders on Songs, song detail, Venue and Home — and the smoke test, the deploy check
> and the layout diff all read the marker from that one file.

### Gap convention — REVERSED to match The Carton's Show Gap column (2026-10-24)

**Ruling:** the counted-shows convention is withdrawn. From BUILD 0.1.78, *gap* in this app
means exactly what the **Show Gap** column on a `thecarton.net/song/{slug}` page means, and the
current gap means what that page's "which was N show(s) ago" means. Same number, same name.

**What was being reversed, and why it was decided.** The convention shipped 2026-08-17 in the
first data-layer commit (`96f0d73`) and was surfaced in the UI the same day (`7afc90b`). Its
rationale, quoted verbatim from the *Gap convention — settled by measurement* section above:

> **2. The denominator excludes shows with no setlist data.** 194 of 804 shows have zero setlist
> rows (mostly 2013–2015). A show with no recorded setlist cannot establish that a song went
> unplayed — we simply don't know — so counting it would inflate every gap spanning it. This also
> drops one corrupt row in the `shows` table dated **`0015-08-28`**.
>
> The counted universe is **610 shows**. For modern songs both denominators converge, since nearly
> every recent show has a setlist; the choice only moves ancient bustout numbers (the coldest song
> reads 608 rather than 783).

and from the comment above the ordinal map in `src/data/index.js`:

> Only shows that HAVE setlist rows count toward a gap. [...] A show with no recorded setlist
> cannot tell us a song went unplayed -- we simply don't know -- so counting it would inflate every
> gap that spans it. [...] For modern songs the two denominators converge, since nearly every
> recent show has a setlist; the choice only moves ancient bustout numbers.

The same section also recorded that Carton's *footnote* gaps could not be reproduced by any
convention and concluded "we compute our own number under one documented convention". That
measurement was of the static footnote text, which is still true and still irrelevant: the
footnotes are prose written at the time. The **Show Gap column** is computed live, and it was
never measured against.

**Why it is reversed.** The "Longest gap" sort (0.1.76) put the convention's effect on a headline
figure for the first time, and it is not an "ancient bustout" rounding: *Feel Like A Stranger*
reads **610** here against Carton's **723**, because 114 of the shows in that span have no setlist
rows. That is a ~15% divergence on every number the Songs screen ranks by. This app repackages
Carton for a game that is **scored against Carton's figures**; a different number under the same
name is wrong even when the sheet two taps away discloses how it was counted. "We don't know
whether it was played" was a defensible counting rule in isolation, and it is not the rule the
reader is playing against.

**What Carton's column means — measured, not assumed.** Determined 2026-10-24 by reconstructing
the column from a fresh pull and comparing against 19 song pages (`feel-like-a-stranger`,
`the-harder-they-come`, `franklins-tower`, `helpless`, `shadow`, `burritos-el-chavo-2`,
`one-stop-shop`, `12-pounds-of-pain`, `wayless`, `a-moments-notice-2`, `yuck`, `tom-sawyer`,
`high-noon`, `gretchen`, `fay`, `carry-on`, `time-loves-a-hero`, `interior-people`, `birdland`).
**1069 of 1069 per-play rows and 19 of 19 current gaps match** under this rule and no other tried:

1. **The universe is every Eggy show** — `shows` rows with `artist_id` 1 and a valid date, dated
   on or before today — **including shows with no setlist rows.** Upcoming shows are excluded.
   The one `artist_id` 2 show (`Dani Battat`, 2026-02-10) is excluded; including it puts every
   2026 figure one too high.
2. **Position is counted by date, not by row.** A date's position is the number of universe shows
   dated on or before it. Two shows on one date share a position (there are 28 such dates).
3. **Gap at a performance = position(this date) − position(previous performance's date).**
   Consecutive dates give 1; a second performance on the same date gives 0.
4. **Current gap = position(newest played date) − position(last performance's date).** A song
   played at the newest show reads 0.
5. **Carton prints a number for a debut too:** the position of the debut date. It is a position,
   not a closed gap — see decision 1 below.

`Feel Like A Stranger` under this rule: 723 closed, 2015-06-20 → 2026-10-17, current gap 4 —
Carton's figures exactly.

**A diagnosis reported in chat the same day was wrong, and is withdrawn here.** It said
`gapAtShow()` and the current gap were on different footings — an "off-by-one", consecutive
shows reading 1 at a play and 0 as a current gap. Both were ordinal differences, which IS Carton's
arithmetic: played at the show before reads 1, played at the newest show reads 0 since, and two
performances on one date read 0. The residual it was trying to explain (723 against 724) was the
second-artist show, not a convention offset. The comments that say "gap 0 means played at the
immediately preceding show" are the thing that was wrong, in both the code and the tests.

**Decisions settled 2026-10-24, with the ruling:**

1. **Debuts are excluded from the longest gap, and the "Debut" badge stays.** Carton's debut-row
   number is the position of the debut date — how many Eggy shows had happened by then — not a gap
   between two performances. Counting it as a closed gap would hand every 2024 debut a "longest
   gap" near 580 that no performance ever closed.
2. **The second artist (`artist_id` ≠ 1) is excluded from the gap universe and from song
   performance counts only.** That is what Carton's Eggy song pages do: the Thorns page
   (`/song/t` — see below) is headed "Every Time Played by Eggy", lists **10** performances, omits
   2026-02-10 although the setlists table carries a Thorns row for it, and says separately that
   the song "has also been performed by Dani Battat 1 time". The show stays visible in Shows and
   Venues as a show that happened. **Excluding it more broadly is a separate ruling, open and not
   made here.**

   > **As first recorded here, this decision cited "the Thorns page lists 360 rows and omits
   > 2026-02-10". That figure was wrong.** The page fetched was `/song/thorns`, which The Carton
   > **redirects to the all-songs index** (`/song/`), and 360 was the number of songs on it. The
   > song's live slug is `t`, matching the API. The decision stands on the real page, quoted
   > above; the false figure is left here, struck, so the correction is visible.
3. **The universe runs through today, not through the newest show with a setlist.** The two give
   identical numbers on 2026-10-24 because no show falls between 2026-10-23 and today, so this is
   **recorded as unproven.** The observation that settles it: on a show day, before the setlist
   posts, does Carton's "which was N show(s) ago" count that show? If it does, *today* is right.
   If it does not, the cutoff is the newest show with a setlist. Whoever is looking at Carton on
   such a day should record the answer here.

**The convention text in this file above, the index comment, the Settings sheet, the gap
explainer, and `tests/gap.test.mjs` all describe the withdrawn rule** and are rewritten in the
0.1.78 change, not here. This ruling lands first so the two records cannot disagree without one of
them saying so.

## Out of scope — parked

Anything crossing the scope rule goes to [`phase3_ideas.md`](phase3_ideas.md), not into the app.
