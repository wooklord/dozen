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
`showorder` ascending. This ordering is the denominator for every gap number.

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

## Gap convention — settled by measurement

> **Withdrawn 2026-10-24.** This section describes the convention that shipped 0.1.x through 0.1.77.
> It is reversed by the ruling *Gap convention — REVERSED* under *Scope rulings* below, and the
> code follows in BUILD 0.1.78. Kept so the original reasoning is readable where it was made.

**Definition shipped:** *shows since last played* = the number of shows in the canonical ordering
between a song's most recent performance and the newest show, **counting only shows that have
setlist data.** 0 means it was played at the most recent show.

Two things were measured before settling this.

**1. Carton's own footnote gaps are not reproducible, and we should stop trying.** 58 footnotes
state an explicit `(N show gap)`. No single convention reproduces them:

| Rule | Matches |
|---|---|
| all shows, difference | 9 / 58 |
| all shows, difference − 1 | 29 / 58 |
| shows-with-setlists, difference | 9 / 58 |
| shows-with-setlists, difference − 1 | 28 / 58 |

Footnotes days apart use different conventions (2026-08-06 matches one rule, 2026-08-08 the other),
which means they are **static text written at different times against a growing archive** — not
output of a live formula. Retroactive show additions have since shifted the counts.

**Consequence:** we compute our own number under one documented convention and **always render
Carton's footnote text verbatim beside it**, never overwriting it or trying to make the two agree.
Both are true; they describe different moments.

**2. The denominator excludes shows with no setlist data.** 194 of 804 shows have zero setlist rows
(mostly 2013–2015). A show with no recorded setlist cannot establish that a song went unplayed —
we simply don't know — so counting it would inflate every gap spanning it. This also drops one
corrupt row in the `shows` table dated **`0015-08-28`**.

The counted universe is **610 shows**. For modern songs both denominators converge, since nearly
every recent show has a setlist; the choice only moves ancient bustout numbers (the coldest song
reads 608 rather than 783).

The UI states the convention and shows the counted-show total, so the number is never a bare
figure the user has to take on faith.

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
   performance counts only.** That is what Carton's Eggy song pages do: the Thorns page lists 360
   rows and omits 2026-02-10 although the setlists table carries a Thorns row for it. The show
   stays visible in Shows and Venues as a show that happened. **Excluding it more broadly is a
   separate ruling, open and not made here.**
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
