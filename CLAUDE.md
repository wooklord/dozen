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

This is a standalone project. **Never read from or write to the sibling `fantasytour` or
`ambassadortracker` repositories, under any circumstances** — they sit beside this one in the same
projects directory. If something appears to be needed from either, stop and ask.

> Written without the absolute paths on purpose. They spelled out a home directory, and therefore
> an OS username, in the file whose own rule forbids location identifiers and which deliberately
> declines to spell the owner's name two sections below. The repo names are what the rule is
> actually about; the drive letter never added anything to it.

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
| `albums` | not measured | not measured | — |
| **Cold pull (6 requests)** | **0.60 MB** | **6.39 MB** | 10.7× |
| Verification pass (14 requests) | 0.40 MB | 5.22 MB | — |
| **Total cold start** | **1.00 MB** | 11.61 MB | — |

**`albums` shipped after this measurement and the totals were never re-taken.** It is a tiny table
(13 track rows across 5 albums) so the 0.60 MB figure is still the right order of magnitude, but
the row says "not measured" rather than carrying a guess — the point of this table is that its
numbers were measured, and one invented entry would make the whole thing untrustworthy. The
request COUNT is corrected because that one is verifiable from the code, and is now exported as
`COLD_PULL_STEPS` from `src/data/source.js` so it cannot drift again.

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

- **Cache aggressively** with an explicit TTL. One value governs the whole archive — it is stored
  as a single blob under a single key, so per-type expiry is not merely unimplemented but
  structurally impossible without splitting the payload. See `ARCHIVE_TTL` in `src/data/cache.js`.
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

## Personal identifiers: the rule, and the three deliberate exceptions

**This repository is public.** The standing rule is **no personal identifiers in
tracked files** — no real names, no email addresses, no handles, no locations.

**There are exactly three exceptions, all deliberate, all made knowingly by the
repo owner. Do not "fix" them.**

| Where | What | Why |
|---|---|---|
| `LICENSE`, the copyright line | the owner's name, after `Copyright (c) 2026` | A copyright notice without a holder asserts nothing. The name IS the legal function of the line |
| Settings & data sheet, last line | the owner's name, after `Built by` | Creator credit, rendered by `.creator-credit` in `src/app.js` |
| The deployment domain, wherever it appears | the owner's handle, as part of `dozen.wooklord.net` | **Functionally required.** `CNAME` IS the domain, and Pages reads it from the repo. `scripts/verify-deploy.mjs` must request the real host or it verifies nothing. Docs describing the DNS setup have to name the record being created |

**This file does not spell the name**, on purpose: recording an exception is not
a reason to add a third instance of the thing being excepted. Read the first two
places above if you need the exact string. The domain is different — it is a
public DNS record and is written out in full wherever it is needed.

> **The third row was added in 0.1.62 to describe what was already true.** The
> handle appears in `CNAME`, `README.md`, this file, `docs/plan.md` and
> `scripts/verify-deploy.mjs`, and it has to: a site cannot be deployed to a
> domain the repo declines to name. The rule said "two exceptions" and "no
> handles" while five tracked files carried one. Scrubbing them would have
> broken the deploy; the honest fix is the rule matching the repo. Recorded
> under the same principle as everywhere else here — a stale record reads with
> the same authority as a current one, and this one would have sent someone
> deleting a `CNAME`.

**The exceptions stay narrow.** Those three and no others. Specifically NOT:

- no email address anywhere, in any of them or any other
- no name in commit messages, commit-adjacent docs, README, or code comments
- no location, no file path containing a home directory or an OS username, no
  other identifier
- no handle **except** as part of the deployment domain — the bare handle on its
  own is not covered by the third row
- no name in `package.json`, `manifest.webmanifest`, or any metadata file
- no expansion to other screens — the credit is two taps into a sheet, and that
  is the whole of its presence in the UI

If you are about to add an identifier somewhere a fourth row would be needed
for, that is out of scope: ask first.

**The credit must stay quieter than the Carton attribution.** `.attrib` credits
The Carton and Songfish on every screen at 13px; `.creator-credit` is 11px, one
line, two taps in. They supply the data; this is the reader built on it. If the
two are ever retuned, the credit moves DOWN, never up.

> `.bak` is in `.gitignore`, which means `git status` will not show a stray
> `*.bak` and neither will a casual `ls | grep`. Run `git check-ignore -v <path>`
> before concluding a file is absent — an ignore rule added for good reasons hid
> `LICENSE.BAK` from exactly the search that was looking for it.

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
| Read the rendered jam colour from a local page | that the new token shipped | the **service worker's cached shell**, still serving the previous build's stylesheet. `getComputedStyle` returned a real colour, from the wrong stylesheet |
| `fetch` the live `version.js` after a push | that **the deploy landed for users** | a **fresh CDN edge**, while the edge serving the browser was still nine builds behind. Both numbers were real; only one was what a visitor got |
| `layout-diff` reporting "identical" | that **a change moved nothing else** | the tool rendering the **wrong theme** — it never set one, so a light-only change was "verified" by a dark-mode run |
| Waiting for `!document.querySelector('.loader')` | that **the app had finished booting** | the document **not having parsed yet**. `Page.navigate` resolves early, so the first poll saw no loader and declared success on a blank page |
| `layout-diff` reporting "identical" (again) | that **a change moved nothing else** | both builds served from **one origin at the same urls**: the second boot fetched the new CSS and rendered the OLD parsed stylesheet |

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

### The service worker will serve you a stale shell (dev-loop hazard)

**Symptom: you change a token, reload the local page, and read back the OLD
value — as a real, plausible number.** This cost time twice in one session while
tuning the jam colour. `getComputedStyle` returned `rgb(127, 206, 127)` when the
committed token said `#7ecfa6`. Nothing looked broken; the wrong colour was
simply the *previous build's* stylesheet, served out of the service worker cache.

This is the **same shape as every other verification failure here** — see the
table above. The check read a genuine value from the **wrong artifact**. A stale
shell is indistinguishable from a fresh one by inspection, which is exactly what
makes it expensive: you start debugging the change instead of the cache.

**The fix, both halves — one is not enough:**

```js
// In the page console, before trusting anything you read back:
for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
for (const k of await caches.keys()) await caches.delete(k);
location.reload();
```

plus a cache-busting query on the URL (`?cb=<build>`). Unregistering alone can
still leave the HTTP cache holding the old CSS; the query alone leaves the
service worker answering from `caches`. Bumping `CACHE_VERSION` does **not** help
in the moment — the already-installed worker keeps serving until it is replaced.

**Confirm the value, do not assume the reload worked.** Read the colour (or
whatever changed) back and compare it against the committed token before drawing
any conclusion from what is on screen.

#### Why `scripts/smoke.mjs` never hits this

Two accidents of its design make it immune, and both are worth preserving:

- it serves on a **random port** each run (`8123 + rand(400)`), and service
  worker scope is per-origin *including port*, so there is never a worker
  registered for that origin;
- it launches Chrome with a **throwaway `--user-data-dir`**, so there is no
  profile carrying one over.

So the automated check is clean and the manual loop is not, which is precisely
why this went unnoticed for two rounds. **Do not "simplify" the smoke test onto
a fixed port or a persistent profile** — those two lines are load-bearing.

#### `?nosw` turns the worker off (BUILD 0.1.41)

Append `?nosw` to any local URL and the app tears the worker down instead of
registering one:

```
http://localhost:8080/?nosw#/show/1728657865
```

A **NO SW** chip renders in the header while it is active, because there are no
dev tools in this loop and an invisible dev flag fools you in *both* directions
— you can believe the worker is off when the param got dropped from a copied
URL, or that it is on when it is not.

**Skipping `register()` is not enough, and a guard that only did that would be
worse than none.** A worker installed by an earlier visit keeps controlling the
origin whether or not the page asks for one, so `?nosw` actively unregisters,
drops the caches, and reloads once. That reload is guarded on `regs.length` so
it cannot loop: after it there is nothing left to unregister.

Deliberately **not** gated on hostname. The offline path is a shipped feature
used in venues on bad signal, and a worker that only ever runs where nobody can
watch it is a worker whose next bug ships. Local testing exercises it by
default; you opt out per-URL when you need to.

`scripts/smoke.mjs` tests this by **registering a worker first** and then
confirming `?nosw` removes it. Loading `?nosw` on a clean profile would pass
trivially — there was never a worker to disable — and would say nothing about
the case the flag exists for. Proved red both ways: the naive skip-only guard
leaves the worker registered, and renaming the chip class fails the visibility
check.

> **Waiting for a worker: use `navigator.serviceWorker.ready`, not a poll.**
> The first version polled `getRegistrations()` and failed about one run in
> three. `register()` was measured and is fine — it resolves with a scope and
> never rejects — so the fault was the wait, not the app, and the app was left
> alone. A check that goes red without a real defect is exactly as useless as
> one that goes green without health.

Two other bypasses were considered and rejected:

- **Rotate the dev port.** Zero code, and it works because worker scope is
  per-origin including port. But `localStorage` (theme, picks) and the
  IndexedDB archive are per-origin too, so every run starts cold and re-pulls
  the whole archive.
- **Skip registration on localhost entirely.** Same objection as gating on
  hostname above: it would mean the offline path is never exercised outside
  production.

### A contract written over NAMES is not a contract over the thing

**If a check's inputs are a hand-maintained list, what it verifies is the list.**

`scripts/contrast.mjs` measured 33 pairs of TOKEN NAMES and `docs/design.md`
said it covered "every foreground/background pair in use". Nothing tied a pair
to the rule that renders it — the `where` field was prose. A rule could switch
which token it painted with and all 33 stayed green, because no hex had moved.
Proved by changing `.chip[aria-pressed="true"]` to paint `--ink-faint` on
`--chip-sel-fill`: the hand-listed check stayed green while the label sat at
**3.79:1**.

The fix is not a longer list. It is deriving what can be derived and being
explicit about what cannot:

- **Any rule that sets both a foreground and a background is a complete pair**,
  with no DOM involved. Fifteen of them are parsed out of `app.css` and
  measured as written.
- **Every token a rule paints with must appear in some measured pair** — listed,
  derived, or recorded in `KNOWN_GAPS`. This is the check that closes the hole,
  and it immediately found three tokens nobody had ever measured: `--ink-venue`
  (in no pair at all), `--yolk-ink` on `--yolk-deep`, and text on a picked row
  against `--yolk-wash`, which is still failing at 4.00:1 dark and is now
  recorded as a gap rather than being invisible.
- **What genuinely needs the DOM stays a list**, and says so. Text on an
  ancestor's background — quiet text inside a pressed row — cannot be derived
  from CSS. Three parts, and only the first two are proofs.

**An honest partial beats a claim the list cannot support.** The doc now states
which of the three parts covers what, and names the weakest.

**A measured miss is not automatically a defect, and the record must say which
kind it is.** `KNOWN_GAPS` entries carry a `status`: `accepted` means someone
looked at it *on the device this app is used on* and decided the shortfall is
not worth what fixing it costs; `deferred` means nobody has decided anything.
Those two produce identical silence on screen, so a list that cannot tell them
apart invites the settled one to be re-argued every audit and lets the open one
pass as closed. An `accepted` entry has to record who assessed it and how, or
the word is just a nicer spelling of undecided — `tests/contrast.test.mjs`
enforces both halves. The picked-row 4.00:1 is the worked example: measured,
looked at on a phone in dark mode, both fixes costed and rejected, closed.

The same shape appears wherever a check reads a curated list: `ROUTES` markers
(0.1.62), `PAIRS` here, `KNOWN_GAPS`. Ask what reads the list, and what would
happen if the thing it describes moved without the list moving.

### Dead code is not always safe to simply switch on

**A parameter that has never been used has never been tested**, and "wire it up
to the obvious value" is a change, not a cleanup.

`quickTruncationCheck` took a third argument, `newestKnownShowdate`, and was
called with `null` from its only call site — so the branch comparing the newest
setlist row against the shows table had never executed once. The value it
plainly wanted was sitting three lines above the call. Passing it **hard-failed
the app on completely healthy data**: every cold start rendered "Could not load
the archive", because `shows` contains upcoming shows that by definition have no
setlist. Measured 2026-08-27 — `shows` ran to `2026-12-05`, setlists correctly
ended at `2026-08-14`.

Comparing against the newest *played* show is not sound either: a show played
before The Carton posts its setlist produces the same shape, and the app already
counts those (`counts.excludedNoSetlist`). Any version of this needs a
tolerance, and every tolerance available is a number invented to make the check
pass — which is the thing this file spends most of its length warning about.

It was removed rather than left dead or "enabled" into a false alarm, because
the sound version of the assertion already exists: `verifyArchive()` pulls the
archive a year at a time and asserts both row count and max showdate against the
full pull — same table, no cross-table inference, no threshold.

**The rule.** When you find dead code, the question is not "why isn't this
wired up" but **"what happens when it runs?"** Run it before deciding. If it
was dead because it never worked, deleting it is the fix and the reasoning is
what gets kept. `tests/coldpull.test.mjs` now asserts the healthy case — a
setlists pull ending before the newest show is not, on its own, evidence of
anything.

### A stale record is worse than a missing one

**When a change makes an existing doc entry or code comment false, correcting it is part of that
change.** Not cleanup, not a follow-up, not something a later audit will catch. If the edit is not
in the same commit as the thing that invalidated the record, it does not happen.

Writing things down is working here. *Reconciling* them is not, and the gap is measurable: one
audit pass found a design document quoting two palette hexes the stylesheet had moved off (the
documented `--ink-faint` measured **3.29:1**, below the 4.5:1 floor the same document declares that
token is sitting on), a README describing a BUILD marker that left the header at 0.1.33, this file
arguing against the very `<meta>` check `verify-deploy.mjs` is built on, and `app.css` carrying
three stacked comment blocks above `.jam-key` where only the third described the rule.

**A stale entry reads with exactly the same authority as a current one.** That is the whole
problem — nothing about it looks wrong, and it is trusted precisely because someone bothered to
write it down. It is the documentation form of the proxy failure described above: the reader
checks the record instead of the thing, and the record has more than one possible cause.

`.chip-quiet` is the case that settles it. A dead CSS rule produced a false line in `design.md`
("`.chip-quiet`'s 500 made the jump larger on the filter row than the sort row"), and that line was
then cited as measured evidence in a **real design decision** — rejecting a weight treatment for
selected chips. The comparison was between two rows rendering at the same weight. A record that
never got reconciled did not just sit there being wrong; it changed the product.

Concretely:

- **Delete superseded comment blocks. Never stack a new one above them.** Two comments that
  disagree do not average out to the truth; the reader believes whichever one they read first. If
  the old block still holds something true, move that sentence into the new one and delete the
  rest.
- **Record a withdrawal as a withdrawal**, not as a quiet rewording. If a stated measurement turns
  out to be wrong, say it was wrong and say what still stands without it. Silently editing it to
  something true destroys the evidence that the reasoning was ever unsound.
- **Where a doc copies a value from code, make a test compare them.** `tests/design-doc.test.mjs`
  now pins `design.md`'s palette block to `tokens.css`, and `tests/coldpull.test.mjs` pins every
  "N requests" claim in the docs to `COLD_PULL_STEPS`. A copy nothing checks will drift, and the
  copy that drifts is the one being quoted.

### A check written in scratch is written once and trusted forever

**If a check is worth writing twice, it is worth committing.**

Scratch scripts get written fast, trusted once, and never maintained. That is
the exact condition under which a wrong check survives: nothing re-reads it,
nothing runs it in CI, and the next session either rebuilds it from memory or
trusts last session's output. Three of them cost time in a single session:

| The scratch check | What went wrong |
|---|---|
| Live feature check | hardcoded `0.1.40` as the expected build. Went stale one build later and failed for a reason that had nothing to do with the deploy |
| Layout diff | reported a route "identical" when **both** sides rendered nothing — two empty arrays compare equal. It read as proof a screen was untouched and was proof of nothing |
| Live text assertion | grabbed a row's `textContent` and swallowed a decorative bullet, so `"jam chart entry"` came back as `"●jam chart entry"` |

The worst of these is the second, because it **passed**. The other two went red
and cost a few minutes; that one reported health it had never established.

The strongest evidence is older. `docs/design.md` told people to
"re-run `scratchpad/contrast.mjs` after any palette change" for **twenty-two
builds**. That file was never committed, so the instruction was unfollowable —
and the palette audit only ever ran when someone rebuilt the script by hand.
It is now `scripts/contrast.mjs` plus `tests/contrast.test.mjs`, and it runs on
every `node --test`.

**The rule.** Scratch is for a question asked once. The moment you find
yourself writing the same check a second time — or referring to one from a doc
— it moves to `scripts/` or `tests/` and gets the same discipline as everything
else there: no hardcoded expected value where a derived one exists, assert
content unique to the target rather than that an artefact was produced, and
**prove it red before trusting it green**.

Deliberately still in scratch: one-off investigations (why a flake happens,
where 4px went) and screenshot capture for eyeballing. A screenshot script
asserts nothing and cannot go red, so committing it buys maintenance cost and
no safety. A repo of half-trusted checks is worse than a few good ones.

### layout-diff's older verdicts are weaker than they read

`scripts/layout-diff.mjs` has been the arbiter of "nothing else moved" since
0.1.49. For most of that time it had two flaws that its output gave no hint of:

1. **It never set a theme**, rendering whatever the headless browser defaulted
   to. A theme-specific change could be declared safe by a run that never
   rendered it. It was about to arbitrate exactly such a decision — the
   light-only weight change in 0.1.56 — when this was found.
2. **It compared boxes index-by-index**, so one added or removed element
   renamed every later one and a change touching nothing could report the whole
   route as changed. It now compares multisets.

A tool that renders the wrong theme still reports real numbers. They are just
real numbers about the wrong thing, which is worse than an obvious failure
because nothing about the output looks wrong.

**Treat its verdicts before 0.1.56 as weaker evidence than they appeared at the
time.** They are not worthless — most changes were not theme-specific, and a
genuine reflow in the rendered theme would still have shown. They are simply not
the proof of "nothing moved" they were quoted as. No re-run is planned; this
note exists so those results are not cited as stronger than they were.

Three further faults were found in the same session and are fixed: it reported
"identical" when **both** sides rendered nothing (now a failure, with box
counts); it declared boot complete on an unparsed document (now waits for
`#main .screen`); and it served both builds from one origin, where the browser
reused the first build's parsed stylesheet (now two origins, with a self-check
that fingerprints the stylesheets each side actually received and fails if git
reports CSS changes but the fingerprints match).

Two more were found in 0.1.60, both of the same shape — a check that reads
real numbers about a smaller universe than its output implies:

- **It could not see chip bars at all.** `.sortbar` and `.chip` were missing
  from its selector list. A chip bar is fixed-height and scrolls horizontally,
  so adding or resizing a chip moves nothing else it probed, and the route came
  back "identical". Adding "All shows" to the Shows year bar reported
  **0 routes changed** until the selectors were added; with them, `#/shows`
  reports 15 changed boxes and nothing else moves. The `.chip` comment in
  `app.css` had cited "layout-diff reports every route byte-identical" as
  evidence the tap-target change was inert — a claim from a tool that had never
  measured a chip. It was true and it was not evidence.
- **The stylesheet self-check could never fire on Windows.** It compares the
  byte length of the CSS each side received and fails when git reports a CSS
  change but the lengths MATCH. `git worktree add` honours `core.autocrlf`
  (true here), so the ref side is served CRLF and the working tree LF: the
  lengths differed by exactly one byte per line — 1502 for `app.css`, 344 for
  `tokens.css` — on every run, forever. A guard that fires on equality, given
  inputs that can never be equal, is a guard that cannot report the false
  negative it exists for. CR is stripped before measuring now; the two sides
  fingerprint equal on unchanged CSS and still diverge on a one-line edit.

And the self-check itself could not detect the failure it was written for, which
was found in 0.1.63 and is the third fault in a row in this one guard:

- **It fingerprinted with `fetch(url, { cache: 'no-store' })`.** The failure it
  guards against is "the browser fetched the new CSS while still APPLYING the
  old parsed sheet" — and a fresh fetch bypasses the CSSOM entirely and
  re-downloads from that side's own port, so it reported the correct file no
  matter what the document was rendering with. It was measuring the server, not
  the page. Demonstrated by mutating `document.styleSheets` in a live page: the
  fetch probe returned an identical value, the CSSOM probe changed. It reads
  `document.styleSheets` now and hashes the serialised rules.
- **Byte length was never a fingerprint.** Any length-preserving edit — a hex
  swap, `600` to `500` — leaves the lengths equal while the rules differ,
  firing SELF-CHECK FAILED on exactly the palette retunes this tool exists to
  arbitrate. The CRLF version of this same mistake was the 0.1.60 fix; hashing
  is what actually fixes it.

Fixing the first created a third problem worth recording, because it is the
house pattern again: **the CSSOM drops comments**, so a comment-only CSS edit
produces identical fingerprints while `git diff --name-only` reports a change —
and the guard would have announced that the run "cannot detect anything" on a
run where there was correctly nothing to detect. Two causes, one condition. The
comparison is now against the stylesheets with comments and punctuation spacing
normalised away, so "the rules differ" has one cause.

`.btn-small` was also removed from the probe list: every small button is
`el('button.btn.btn-small')`, so listing both counted each one twice.

**It also makes two full archive pulls per run** — roughly 38 API requests.
Running it repeatedly trips The Carton's documented 60/minute limit, which
surfaces as an error boundary and reads like a harness bug. Wait a minute
between runs.

### The checks, and when to run each

| Command | Speed | Network | Run it |
|---|---|---|---|
| `node --test` | instant | none | always, before anything else |
| `node scripts/smoke.mjs` | ~1 min | Carton (cold pull) | **before every push** |
| `node scripts/contrast.mjs` | instant | none | when eyeballing a colour; the assertions already run in `node --test` |
|  `node scripts/layout-diff.mjs [ref] [width] [theme]` | ~3 min | Carton (two cold boots) | after a deliberate layout change, to see what else moved |
| `node scripts/verify-deploy.mjs` | ~1 min | live host | **after every push** |

`scripts/routes.mjs` holds the route list and its markers, shared by the smoke
test, the deploy check and the layout diff. Three copies would drift, and the
copy that drifted would be the one checking production.

**Only the smoke test and `node --test` gate a push.** The layout diff goes red
on any *intended* layout change, which is most commits — as a gate it would
train you to ignore it.

**Network-dependent assertions SKIP, they do not fail.** The smoke test
cross-checks the jam coverage note against The Carton; if Carton is
unreachable, that reports `SKIPPED` rather than red. An unreachable third party
is not a defect in this repo, and a suite that cries wolf gets ignored. It does
not claim health either — it says plainly that the claim went unchecked.

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

**Run `node scripts/verify-deploy.mjs`.** It checks the number in three independent places and a
deploy is verified only when all three agree with `src/version.js`:

1. **`<meta name="dozen-build">` in the served HTML**, matched anywhere in the document in any
   attribute order. This is a plain `fetch` and needs no browser.
2. **`https://dozen.wooklord.net/src/version.js`**, read for `BUILD = n`. The deployed source of
   truth the app itself imports.
3. **The Settings & data sheet, in a real browser on a clean profile** — the header's cache
   button, then the `BUILD` entry. This is what a person actually gets, and it is the only one of
   the three that exercises the service worker and the CDN in the combination a real load uses.

Cache-bust every request (`?t=<timestamp>`), navigation included, so a CDN copy is not mistaken
for the new build.

> **This section used to say the opposite, and was wrong for eighteen builds.** It argued that
> "the marker is not in the served HTML… grepping for BUILD would be worse than useless — it would
> report failure forever," and told you to read a `.build-marker` element in the header. Both
> statements described a version of this app that no longer exists. `index.html` has carried the
> `<meta>` tag since 0.1.42, `tests/build.test.mjs` pins it to `src/version.js`, and
> `verify-deploy.mjs` is *built on the check this paragraph told you not to write*. The
> `.build-marker` class was deliberately renamed to `.status-chip` — it is the cache-age chip, and
> reading it for a BUILD number is the exact trap recorded in the table above. The marker itself
> moved into the Settings & data sheet in 0.1.33.
>
> Nothing here failed because of it: the tooling was correct and only the instructions rotted. But
> anyone following the written procedure would have hand-rolled a check against a class that does
> not exist, got `undefined`, and had no way to tell that from a failed deploy.

#### The browser path and the fetch path can disagree (seen 2026-08-21)

Pushing 0.1.42, `scripts/verify-deploy.mjs` reported:

```
  ok    served HTML meta = 0.1.42
  ok    served version.js = 0.1.42
  FAIL  sheet shows 0.1.33, expected 0.1.42
```

**That was the check working, not flaking.** GitHub Pages is CDN-fronted and
edges do not flip together. The two file checks sent cache-busted `fetch`es and
got fresh copies; the browser navigated to a plain URL and was served a
**nine-build-stale module** from a different edge. Both numbers were real. Only
one described what a person loading the site would actually get — and it was the
browser one.

**So the browser path is the authoritative one.** It is the only check that
exercises what a visitor exercises: HTML, modules, the service worker and the
CDN, in the combination a real load uses. A green `fetch` of `version.js` proves
a file is reachable at some edge; it does not prove the app is that build.

`Page.navigate` now carries the same `?t=` bust the fetches do, so the check can
tell a stale edge apart from a bad deploy instead of conflating them.

**When the browser check disagrees with the file checks, re-run it before
concluding — but do not dismiss it.** Propagation skew resolves in a minute or
two, and a second run agreeing is the evidence that it was skew. What it is
never evidence of is "nothing happened": for the length of that window, visitors
were served the old app. If it persists past a few minutes, it is a real deploy
failure — go read the Actions run.

Deliberately NOT `?nosw` on this navigation. A real visitor has a service
worker; suppressing it here would make the check less like the thing it is
meant to verify, not more.

#### When it does not match

Pages builds **can fail with a perfectly clean local tree** — the first build on this repo 404'd
at both URLs until `.nojekyll` was added. So a clean `git status` proves nothing about the deploy.

If the number does not match after a reasonable wait, or the fetch 404s: **check the Actions run
and report what it says.** `gh run list` / `gh run view --log-failed`. Do not leave a failed
deploy unreported — the live BUILD marker is the only deploy signal the user has; they do not
watch the Actions tab and do not use dev tools.

### What stays the user's

Anything outside the repo: **GitHub settings, DNS, and testing on the phone.**
