# The Dozen

A mobile-first web app that is a better-looking, faster, more digestible frontend for
[The Carton](https://thecarton.net), the Songfish-powered Eggy setlist archive.

Its audience is people playing a fantasy setlist game where you predict which songs get played
at a specific upcoming show. The Carton has all the data needed to play well, but it's spread
across pages and formatted for desktop browsing. This app's job is to put the decision-relevant
data one thumb-tap away.

**Phase 1 is read-only and anonymous: no accounts, no logins, no database, no server-side state.**

---

## Hard scope rule (verbatim)

> Carton data only, repackaged. The line, precisely:
>
> - ALLOWED: fetching, caching, joining, sorting, filtering, counting, and grouping Carton's data.
>   If The Carton displays a fact on one of its own pages, you may compute and display it too —
>   gap charts, times played, first/last played, "most commonly played song", debut-by-year
>   distribution, jam chart membership, LTP footnotes, "on this date", set position.
> - NOT ALLOWED: any statistic The Carton never shows. No probability models, no "likelihood this
>   gets played", no recommendations, no scoring, no predictions, no machine learning, no external
>   data sources. Ranking a list by gap descending is sorting and is fine. Labeling that list
>   "most likely bustouts" is a prediction and is not.

If you find yourself wanting to cross that line, write the idea into `docs/phase3_ideas.md` and
move on.

**Language test for any label you're about to render:** if it describes what *has happened*, it
ships. If it implies what *will happen*, it does not. "Longest gap" ships. "Due" does not.
"Played 3 of the last 5 shows" ships. "Hot pick" does not.

### Outbound deep links are in scope. Third-party data is not.

Decided 2026-08-18, adding the "Venue info" Maps link.

**In scope:** building an **outbound deep link** out of Carton's own fields — taking `venuename`,
`city` and `state` and constructing a URL the user can tap. The app sends them somewhere; it learns
nothing.

**Not in scope:** fetching, embedding, or rendering third-party place data. No Maps API, no
embedded map, no iframe, no scraped place details, no geocoding, nothing displayed inside the app
that did not come from The Carton. `thecarton.net` remains the only host this app requests data
from.

The line is the same one the scope rule draws elsewhere: **a link is navigation, a fetch is a data
source.** If a change would put third-party content on screen, it is out.

---

## Repo isolation rule

This is a standalone project. **Never read from or write to
`C:\Users\kylem\projects\fantasytour` or `C:\Users\kylem\projects\ambassadortracker`, under any
circumstances.** If something appears to be needed from either, stop and ask.

---

## CORS finding (settled — tested, not assumed)

Tested from a real page context: a local page served over `http://localhost:8123` performing actual
browser `fetch()` calls against the API in headless Chrome.

**The API is directly fetchable from the browser. Build client-side. No proxy, no snapshot, no
build step.**

| Probe | Result |
|---|---|
| Simple cross-origin GET `/v2/latest.json` | **PASS** — `http=200`, `response.type === "cors"`, real rows |
| Path-query GET `/v2/venues/city/New+Haven.json` | **PASS** — 200, 7 rows |
| GET with a custom request header (`X-Dozen-Probe`) | **FAIL** — `TypeError: Failed to fetch` |
| `/api/embed/{date}.html?headless=1` | **FAIL** — no `Access-Control-Allow-Origin` |
| Readable response headers from JS | only CORS-safelisted: `cache-control`, `content-length`, `content-type`, `expires`, `pragma` |

The API sends `Access-Control-Allow-Origin: *` on `/api/v2/*`. Consequences that constrain the code:

- **Send only "simple" requests.** Any custom request header triggers a preflight, and the server
  does not answer `OPTIONS`. No custom headers, ever. Plain `fetch(url)` with no `headers` option.
- **`ETag` is not readable** from page JS (no `Access-Control-Expose-Headers`), so conditional
  revalidation must be driven by our own TTLs, not by ETag bookkeeping.
- **The embed endpoint is not fetchable cross-origin.** It remains usable as a
  "view as Carton renders it" escape hatch only via an `<iframe>` or a plain link-out — never
  `fetch()`. Prefer structured data regardless; this is a fallback, not a data source.

### Transfer size: wire vs parsed (measured 2026-08-17)

**The archive is not 5 MB on the wire. It is about 400 KB.** The API serves compressed, and JSON
of this shape compresses ~13x. Both numbers are recorded because they are different costs: the
wire number is what a phone downloads, the parsed number is what has to fit in memory and
IndexedDB.

| Pull | Wire (gzip) | Parsed | Ratio |
|---|---|---|---|
| `setlists?limit=20000` | **403 KB** | 5343 KB | 13.3× |
| `jamcharts` | 131 KB | 628 KB | 4.8× |
| `shows` | 52 KB | 445 KB | 8.6× |
| `venues` | 13 KB | 70 KB | 5.2× |
| `songs` | 13 KB | 62 KB | 4.8× |
| **Cold pull (5 requests)** | **0.60 MB** | **6.39 MB** | 10.7× |
| Verification pass (14 requests) | 0.40 MB | 5.22 MB | — |
| **Total cold start** | **1.00 MB** | 11.61 MB | — |

Brotli is available and better: `Accept-Encoding: br` alone returns **319 KB** for setlists vs
403 KB for gzip. With a browser-typical `gzip, deflate, br` the server chose gzip, so 403 KB is
the realistic figure. Uncompressed (`identity`) is 5343 KB — that is the number to quote only when
talking about memory, never about download.

**The verification pass nearly doubles cold-start wire cost** (0.60 MB → 1.00 MB) because it
re-pulls the whole archive a year at a time. That is the price of the integrity guarantee and it
is accepted on full rebuilds only.

**Do not design around a bandwidth problem until it is measured on a real phone.** ~1 MB over
venue wifi is a different proposition from 5.4 MB, and progressive loading would add real
complexity to solve something that may not exist.

### Politeness rules (non-negotiable)

`https://thecarton.net/robots.txt` disallows `/api/` for crawlers (it allows only `/api/docs`).
It also disallows `/actions/`, `/ajax/`, `/auth/`, `/admin/`, `/stats/`, and `/gap-chart/`.
We are a user-initiated app, not a crawler, but we behave accordingly:

- **Cache aggressively** with explicit per-type TTLs.
- **Never poll in a loop.** No background timers that refetch.
- **Never fire per-keystroke requests.** Search and filtering run against cached data in memory.
- **Cold start is one batched pull**, not dozens of requests.
- Refresh happens on explicit user action or TTL expiry, nothing else.

---

## The 4000-row trap (read this before touching the data layer)

`GET /api/v2/setlists.json` returns **exactly 4000 rows and reports no error.** The real archive is
**6361 rows**. The default response silently stops at `2024-10-10`.

This is the most dangerous behavior in the API, because the truncated response is well-formed and
plausible. Every gap, times-played, and last-played number computed from it would be **wrong for
every song**, and nothing would look broken.

```
/setlists.json              -> 4000 rows, 2013-02-23 .. 2024-10-10   (SILENTLY TRUNCATED)
/setlists.json?limit=5000   -> 5000 rows, 2013-02-23 .. 2025-06-30   (still truncated)
/setlists.json?limit=20000  -> 6361 rows, 2013-02-23 .. 2026-08-14   (complete)
```

**Rules:** always pass an explicit oversized `limit` on full-table pulls, and always assert the
result count and max `showdate` against an independent source (the per-year sum via
`/setlists/showyear/YYYY.json`, which totals 6361 and agrees). A full-table pull whose row count is
a suspiciously round number must be treated as truncated until proven otherwise.

More generally: **empty or short data is suspicious, never benign.** Typos in column names or wrong
case produce empty `data` rather than an HTTP error. Every fetch logs the exact URL that produced a
short or empty result.

---

## `.nojekyll` — DO NOT DELETE

The zero-byte `.nojekyll` file in the repo root is **load-bearing**. It has no visible purpose and
will look like cruft; it is not.

**Symptom without it:** the first GitHub Pages build fails and the site serves **404 at both
`dozen.wooklord.net` and the `github.io` URL**. Jekyll runs by default on Pages and chokes on
something in this tree even though there are no underscore-prefixed paths, which is the usual
explanation. `.nojekyll` disables Jekyll processing entirely and the build succeeds.

If a future cleanup removes it, the whole site 404s. Leave it.

## Carton URL shapes (verified — the wrong prefix 404s)

`permalink` from the API is a **bare filename**, not a path. It needs a section prefix, and the
wrong prefix returns 404 rather than redirecting. These were shipped broken in 0.1.19 and fixed in
0.1.20.

| What | Correct | Wrong (404) |
|---|---|---|
| Show / setlist | `/setlists/{permalink}` | `/{permalink}` |
| Per-show gap chart | `/gap-chart/{permalink}` | — |
| Song | `/song/{slug}` (**singular**) | — |
| Venue | `/venues/{slug}` (**plural**) | `/venue/{slug}` |

`jamcharts.permalink` is the same bare filename as `shows.permalink` and needs `/setlists/` too.
Song and venue slugs from the API match the live URLs exactly (verified against the sitemap: 366/366
songs, 441/441 venues).

**`/gap-chart/` is robots-disallowed — link to it, never fetch it.** The same applies to `/stats/`.
URL shapes are discoverable from `sitemap-shows.xml`, `sitemap-songs.xml`, `sitemap-venues.xml` and
`sitemap-pages.xml`, all of which are allowed.

## Field names

**Do not guess field names anywhere in the code.** Every field the app reads must appear in
[`docs/carton_schema.md`](docs/carton_schema.md), which records the *actual* observed field names
and types. Notable corrections to the published docs already captured there:

- `error` is a JSON **boolean** (`false`), not `0` as documented.
- `songs` carries **no** play counts — no `times_played`, no first/last played, no gap.
  Those are computed from `setlists` + show ordering.
- There is **no `gap` field anywhere.** Gap is computed.
- `show_tags` exists on `shows` but is **empty on all 804 shows**. There are no show tags.
- `metadata` is a real method with **zero rows** in this instance (confirmed by control test, not
  assumed — an unknown method returns HTML, `metadata` returns a valid JSON envelope). Nothing to
  build on; nothing being missed.
- **A bad method or column name returns `text/html`, not empty JSON** — so `await res.json()`
  throws. Check `content-type` before parsing. Column names are case-insensitive. Everything
  returns HTTP 200, including error pages, so status is useless as a health check.
- **`venues` has exactly 8 fields and NO coordinates.** `venue_id`, `venuename`, `city`, `state`,
  `country`, `zip`, `capacity`, `slug` — identical across all 441 rows. Nothing matching
  `lat|lon|lng|geo|coord` exists, so anything location-shaped must be built from the name and
  place strings.
- **`zip` and `capacity` are dead fields. Do not build against either.** `zip` is blank on
  **440 of 441** rows; `capacity` is `0` on **all 441**. They are present in the schema and carry
  no information in this dataset.
- **Venue names are NOT unique — always key on `venue_id`.** 9 names exist in more than one city;
  `Brooklyn Bowl` is in Brooklyn NY, Las Vegas NV *and* Philadelphia PA. Grouping venues by name
  silently merges distinct venues. (`9:30 Club` also appears twice with the city spelled
  `Washington, D.C.` and `Washington, DC` — two `venue_id`s for what is likely one room.)
- **Match `state` exactly, never as a substring.** A substring match on `ma` hits 18 venue names,
  which buries a real state query.

---

## BUILD marker rule

A visible `BUILD` version marker renders in the page header. **Bump it on every change that
touches anything shipped to the browser.** The marker is how deploys get confirmed — dev tools are
not used. A change without a bump is an incomplete change.

Format: `BUILD 0.1.7` — a single incrementing patch integer, defined in exactly one place
(`src/version.js`) and rendered from there.

---

## Song name normalization

**One normalizer, used everywhere, unit-tested.** Case-folding alone is not enough — that mistake
has already caused a live bug in another app.

Real values from the live data that will bite you:

| Hazard | Real examples |
|---|---|
| Curly apostrophe **U+2019** | `A Moment’s Notice`, `I’ll Take A Melody`, `Ain’t No Bread In The Breadbox`, `The Shape I’m In`, `Feelin’ Alright`, `Jumpin’ Jack Flash`, `I’m Coming Out`, `Reelin’ In The Years` |
| Straight apostrophe **U+0027**, in the same dataset | `Hux (Wit' It)`, `I Was Born (No I Wasn't)`, `Saturday Night's Alright (For Fighting)` |
| Trailing punctuation | `Yuck!` |
| Parentheticals that are part of the name | `Silver Steed (My Blue)`, `All The Way Down (Shadow Pt. 2)`, `Pigs (Three Different Ones)`, `Brooklyn (Owes The Charmer Under Me)`, `Man Smart (Woman Smarter)` |
| Numbered variants — **must stay distinct** | `Burritos El Chavo 2` |
| Short/alphanumeric names | `B7`, `12 Pounds of Pain` |

Both apostrophe forms occur in the same field in the same dataset, so U+2019 and U+0027 must fold
together. Numbered variants must **not** collapse into their base name.

**Prefer `song_id` / `slug` for identity wherever available.** The normalizer is for matching
user-typed input and for joining across the rare places where only a name is present — it is not
the primary key.

### HTML entity encoding is inconsistent across methods

`venuename` is entity-encoded in some methods and raw in others, in the same dataset:

- `shows` → `Annabel&#039;s`, `Telluride Blues &amp; Brews Festival`
- `setlists` / `latest` → `Toad's Place` (raw)

Decode entities once, at the data-source boundary, so nothing downstream ever sees `&#039;`.

---

## Stack constraints

- **No framework, no bundler, no TypeScript.** Native ES modules, plain CSS, plain HTML. This is a
  deliberate constraint — the other apps deploy without breaking because of it.
- **Mobile-first and touch-first.** Thumb-reachable navigation, no hover-dependent affordances,
  works one-handed on an Android phone. Desktop is a courtesy, not the target.
- **Dark mode is the default** — this gets used in venues.
- **PWA**: manifest + service worker, offline-capable for cached data. Scope and `start_url` assume
  its own subdomain of `wooklord.net`, **not** a `github.io` path.
- **All network access goes through one module**, `src/data/source.js`, so the fetch strategy is
  swappable in one file.

## Attribution is required, not optional

Credit The Carton and Songfish visibly, and deep-link back to the corresponding `thecarton.net`
page from every show, song, and venue view. This is a fan app riding on someone else's work and it
should send traffic home.

## Non-goals

No accounts in phase 1. No analytics. No ads. No external APIs beyond `thecarton.net`. No invented
statistics. No writes to any database. No contact with the other two repos.

## Working protocol

- For feature code: **show the change plan and get approval before editing.** Standing default,
  loosened where a batch has been pre-approved.
- Docs land in the repo the moment they're decided, not at the end of a session.

### The recurring failure: "what else could satisfy this?"

**Every verification failure in this project has been the same failure.** Not
three incidents — one pattern, three times. A check asserts something the
intended condition *would* produce, but which **other things also produce**. It
then passes for the wrong reason, and reports health it never established.

| The check | What it was meant to prove | What else satisfied it |
|---|---|---|
| Screenshot the gap chart route | that route renders | the **previous screen**, still displayed because the render threw. A PNG was written, the run was green, and the route had been broken for three releases |
| `grep venueLine` in the file | that the symbol is **imported** | the **call site**, added moments earlier. The bug and its false confirmation came from one mistake |
| Read `.build-marker` in the header | that BUILD is displayed | the **cache-age chip**, which used the same class. It would have read "just now" and reported a successful deploy |

The shape is always a **proxy**: the check tests a side effect rather than the
thing itself, and the side effect has more than one cause.

**The rule.** When adding or changing any verification, ask *what else could
satisfy this?* The answer has to be **nothing**. If something else can, the
check is not specific enough — narrow it until only the real condition passes.

Concretely, that means:

- Assert **content unique to the target**, not that an artefact was produced.
  Every route in `scripts/smoke.mjs` must render a marker unique to *itself*.
- Match the **actual construct**, not a string that appears near it. An import
  check must match the import statement, not any mention of the name.
- Name things for **what they are**. A class called `build-marker` on a chip
  showing cache age is a trap set for a future check. It is `status-chip` now.
- Search **the whole document**, not a fixed position. `verify-deploy.mjs`
  finds `<meta name="dozen-build">` anywhere, in any attribute order, and
  cross-checks it against `src/version.js` and against what the UI shows — a
  value has to agree in three independent places.

**Standing practice: prove a check goes RED before trusting it GREEN.** A test
that has never failed on the bug it exists for has demonstrated nothing. Both
current checks were verified this way:

- `scripts/smoke.mjs` — with the `venueLine` import removed: 7 failures, exit 1.
  Restored: 0 failures, exit 0.
- `tests/build.test.mjs` — with `version.js` bumped alone: 2 failures. In step:
  85 passing.

Do this for every new check. It costs one minute and it is the only thing that
separates a real check from a comforting one.

### Run the route smoke test before pushing

```sh
node scripts/smoke.mjs     # exits non-zero on failure
```

**`node --test` cannot catch the most common failure in this app.** The unit
tests cover pure functions; they never render a view. A view that throws — a
missing import, a renamed export — passes every unit test and then does nothing
at all when tapped.

That exact bug shipped in **three consecutive releases**: `views/gapchart.js`
called `venueLine()` without importing it, so `route()` threw, `clear(main)`
never ran, and the screen stayed on whatever was there before. A dead-looking
button and no error.

Two things let it through, and the smoke test exists because of both:

1. **The ad-hoc checks did not visit every route.** The gap chart was not in
   the sweep after the regression landed.
2. **Screenshotting a broken route still "succeeded"**, because the previous
   screen was still on display. The run was green and proved nothing.

So the smoke test visits **every** route, and each must render a marker unique
to *itself* — never just "a screenshot happened". Uncaught exceptions,
`console.error`, and the error boundary appearing anywhere are all failures.

**A smoke test is only worth its runtime if it fails on the real bug.** After
writing it, re-introduce the fault and confirm it goes red. This one was
verified that way: with the import removed it reports 7 failures and exits 1;
with it restored, 0 and exits 0.

### Views must never fail silently

`route()` wraps view construction in a try/catch and renders `renderViewError`.
A thrown view shows the error text, the route, the top stack frame and the BUILD
number, and leaves the tab bar working.

This is not decoration. **There are no dev tools in this project's loop** — the
screen is the only error report there is, so a silent failure is invisible until
someone happens to tap the right button. Never "handle" a render error by
swallowing it.

### Checking imports specifically

An instance of the pattern above, called out because it bites often: **an
automated edit that skips files "already containing" a name will skip the file
that only *calls* it** — which is exactly the file that needs the import.

Match the import statement itself, or compare imported names against called
names across the module. Best: run the smoke test, which executes the code and
cannot be fooled by a string.

### Commit, push, and verify the deploy — all three, every time

**Committing and pushing is part of finishing a change, not something to hand over.** Never leave
commits sitting ahead of `origin`, and never hand over git commands to run.

Pages builds on push, so **pushing is deploying**. That is acceptable here: the app is read-only
with no accounts and no database, so a bad deploy costs a reload.

**A push is not finished until the deploy is verified.** After pushing, confirm the live site is
serving the build that was just committed, and **report the number actually read back from the
live host — never the number that was set locally.** Those are different claims, and only the
first one is evidence.

#### How to read the live BUILD number

**The marker is not in the served HTML.** `index.html` ships an empty `<div id="header-status">`
and `src/app.js` injects the marker at runtime. Fetching the page and grepping for "BUILD" finds
nothing *even on a perfectly good deploy*, so that check would be worse than useless — it would
report failure forever.

Two checks that do work, in order:

1. **Fetch `https://dozen.wooklord.net/src/version.js`** and read `BUILD = n`. This is the
   deployed source of truth and needs no browser.
2. **Render `https://dozen.wooklord.net` in a clean browser profile** and read the text of
   `.build-marker`. This is what the user actually sees, and it additionally catches
   service-worker and caching problems that a raw file fetch would miss. Use a fresh profile so no
   previously-registered service worker serves a stale shell.

Cache-bust the fetch (`?t=<timestamp>`) so a CDN copy is not mistaken for the new build.

#### When it does not match

Pages builds **can fail with a perfectly clean local tree** — the first build on this repo 404'd
at both URLs until `.nojekyll` was added. So a clean `git status` proves nothing about the deploy.

If the number does not match after a reasonable wait, or the fetch 404s: **check the Actions run
and report what it says.** `gh run list` / `gh run view --log-failed`. Do not leave a failed
deploy unreported — the live BUILD marker is the only deploy signal the user has; they do not
watch the Actions tab and do not use dev tools.

### What stays the user's

Anything outside the repo: **GitHub settings, DNS, and testing on the phone.**
