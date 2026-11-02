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

`GET /api/v2/setlists.json` returns **exactly 4000 rows and reports no error.** When this was
measured, on 2026-08-17, the real archive was **6361 rows** and the default response silently
stopped at `2024-10-10`. **Those are dated figures, kept as the illustration — not the expected
count.** The archive grows after every show, so any number written here is stale by the next one;
the expected count comes from the per-year recount described below, never from this file.

This is the most dangerous behavior in the API, because the truncated response is well-formed and
plausible. Every gap, times-played, and last-played number computed from it would be **wrong for
every song**, and nothing would look broken.

```
# measured 2026-08-17 — the "complete" row grows with every show
/setlists.json              -> 4000 rows, 2013-02-23 .. 2024-10-10   (SILENTLY TRUNCATED)
/setlists.json?limit=5000   -> 5000 rows, 2013-02-23 .. 2025-06-30   (still truncated)
/setlists.json?limit=20000  -> 6361 rows, 2013-02-23 .. 2026-08-14   (complete)
```

**Rules:** always pass an explicit oversized `limit` on full-table pulls, and always assert the
result count and max `showdate` against an independent source (the per-year sum via
`/setlists/showyear/YYYY.json`, which agreed with the full pull on the day it was measured). A
full-table pull whose row count is a suspiciously round number must be treated as truncated until
proven otherwise.

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
| Jam charts index | `/jams/` | `/jamcharts`, `/jam-charts`, `/jamcharts.php` |

The Jams tab linked to `/jamcharts` until 0.1.86, a page that has never answered 200 in any
measurement here (2026-10-30). The smoke test now fetches the link the tab actually renders.

`jamcharts.permalink` is the same bare filename as `shows.permalink` and needs `/setlists/` too.
Song and venue slugs from the API match the live URLs exactly (verified against the sitemap on
2026-08-17: every song and every venue the API returned that day had a live page — 366 songs,
441 venues at the time). **Both tables have moved since** — `venues` returns 440 after a merge and
`songs` has grown — and the sweep has not been re-run against the sitemap, so those two counts
describe that day, not the current tables.

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
  `country`, `zip`, `capacity`, `slug` — identical across all **440** rows. Nothing matching
  `lat|lon|lng|geo|coord` exists, so anything location-shaped must be built from the name and
  place strings.
- **`zip` and `capacity` are dead fields. Do not build against either.** `zip` is blank on
  **439 of 440** rows; `capacity` is `0` on **all 440**. They are present in the schema and carry
  no information in this dataset.
- **Venue names are NOT unique — always key on `venue_id`.** 15 names sit on more than one
  `venue_id`: **8** of them in genuinely different places — `Brooklyn Bowl` is in Brooklyn NY, Las
  Vegas NV *and* Philadelphia PA — and **7** are duplicate rows for the same city and state.
  Grouping venues by name silently merges distinct venues.
- **Three venues, and only three, have a blank `city`, `state` or `country`.** They are the rows
  that break any rule written against "all three fields are filled in", and each breaks it
  differently:

  | id | `venuename` | `city` | `state` | `country` |
  |---|---|---|---|---|
  | 443 | `The Atlantis` | `Washington, D.C.` | *(blank)* | `USA` |
  | 192 | `Jamburg` | *(blank)* | *(blank)* | `USA` |
  | 282 | `MSC Divina` | `Atlantic Ocean` | *(blank)* | *(blank)* |

  **443 keeps the state inside the `city` string**, which is what makes it dangerous: the row
  looks two-field and is semantically three. It shipped reading `Washington, D.C., USA` in 0.1.67
  because the country-stripping filter tested `parts.length > 2` and therefore assumed the state
  always arrives in `state`. See `placeOf` in `src/ui/components.js`.

  > **This bullet used to say `9:30 Club` appears twice, spelled `Washington, D.C.` and
  > `Washington, DC`, "two `venue_id`s for what is likely one room". That is no longer true and
  > it cost a wrong hypothesis.** `9:30 Club` is now a single row (385, `Washington` / `DC`).
  > Carton appears to have merged it — which is also why the count moved 441 → 440 and the
  > multi-city figure 9 → 8. The duplicate-room case in Washington is now `Atlantis` (283,
  > `Washington` / `DC`) and `The Atlantis` (443, above). The old note was accurate when written,
  > survived the merge, and then pointed an investigation at the one DC venue that was fine.
  > Re-measured 2026-08-27 against the live API.
- **Match `state` exactly, never as a substring.** A substring match on `ma` hits 18 venue names,
  which buries a real state query.

---

## BUILD marker rule

A visible `BUILD` version marker renders in the **Settings & data sheet** — the header's cache
button, then the `BUILD` entry, two taps in. It was a header chip until 0.1.33; the header now
shows cache age (`.status-chip`), and reading that for a BUILD number is the trap recorded under
*The recurring failure* below. **Bump it on every change that touches anything shipped to the
browser.** The marker is how deploys get confirmed — dev tools are not used. A change without a
bump is an incomplete change.

Format: `BUILD 0.1.7` — a single incrementing patch integer, defined in exactly one place
(`src/version.js`) and rendered from there.

**What counts as a change that ships — ruled 2026-10-18.** The marker exists to confirm a deploy
from the UI, so the test is observability from the UI. Anything that changes rendered behaviour or
visible bytes bumps. A comment-only edit to a served file, and tests- or docs-only commits, are not
observable from the UI and do **not** bump. Ruled for the commits that followed 0.1.75: a comment
correction in `src/version.js` and a `scripts/smoke.mjs` change both shipped under 0.1.75.

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

### HTML entity encoding varies by venue, not by table

`venuename` carries HTML entities on some venues and not on others, in the same table:

| Table | Rows with an encoded name | Rows with a literal `'` or `&` |
|---|---|---|
| `setlists` | 314 (`Garcia&#039;s Chicago`, `3rd &amp; Lindsley`) | 255 (`Toad's Place`, `Garcia's`) |
| `shows` | 31 (`Annabel&#039;s`) | 59 (`Toad's Place`) |

Measured against the live API on 2026-10-31. No venue is spelled both ways within `setlists` (0 of
the 34 names holding a `'` or `&`). `city`, `state`, `country` and `songname` carry none in `setlists`.

**Correction, 2026-10-31.** This section used to say `shows` encodes and `setlists` does not, with
`Annabel&#039;s` and `Toad's Place` as the proof. That was wrong: those two examples differ because
they are different venues. **The app was never affected**, because every ingest path decodes
(`cleanDisplayText` on `venuename` in `src/data/index.js`), so the claim stood unchallenged. It came
out while planning 0.1.87, when a check held to a raw `setlists` row read `Garcia&#039;s Chicago`.
`docs/carton_schema.md`, `docs/plan.md` and `README.md` carried the same claim and are corrected
with it. `latest` was not re-measured.

Decode entities once, at the data-source boundary, so nothing downstream ever sees `&#039;`. **A
check holding the app to a raw row has to decode that row too,** whichever table it came from.

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
- **Scratch files and downloads go to the scratchpad, by absolute path, and `git status --short`
  follows any command that fetched or wrote outside a planned edit.** Three slips in one week — a
  stray `eol=lf` file, a file written into Program Files, and the repo's `index.html` overwritten
  by a download whose `cd` ran in a different subshell — were each caught after the fact, not
  prevented. The status check is what turns "caught later" into "caught now".

  **A path built from a variable fails closed (ruled 2026-11-01).** The rule above described the
  habit that would have avoided the Program Files slip and prevented nothing. That slip, read back
  from the transcript of 2026-10-21 23:06 UTC: the line opened with `cat > "$SCRATCH/edit-index.mjs"
  2>/dev/null || true`, to clear the file, and assigned `SCRATCH` on the same line *after* it. The
  path was absolute, in a variable that was still empty, so the redirect wrote an empty file at
  `/edit-index.mjs`, which in Git Bash is `C:\Program Files\Git\edit-index.mjs`, and the
  `2>/dev/null || true` silenced the only sign. `git status` cannot see a write outside the repo, so
  the status check is blind to this whole class. **So a directory variable in a path is written
  `"${SCRATCH:?}/name"` in Bash and `Join-Path (Resolve-Path $dir) name` in PowerShell.** Proved in a
  throwaway shell, writing nothing: with `X` unset, `cat > "${X:?}/probe" 2>/dev/null || true`
  prints `X: parameter null or not set` (the expansion fails before the command, so its stderr
  redirect does not hide it), creates no file at `/probe` or anywhere, and the line continues past
  the `|| true`; the guard stops the write, not the line. `Join-Path (Resolve-Path $d) 'probe'` with
  `$d` empty throws `Cannot bind argument to parameter 'Path' because it is an empty string`, and
  with `$d` null the same for null, where `"$d\probe"` reads `\probe`, the drive root.

- **A removal is a command of its own, with a literal target, and never on a line that also names a
  protected path (ruled 2026-11-01).** `rm`, `Remove-Item`, `del`, `rmdir`, anything that deletes.
  On 2026-11-01 04:13 UTC one PowerShell line did four things: stop a leftover headless Chrome,
  count the rest, `Remove-Item` the `dozen-smoke-*` profiles under `$env:TEMP`, and read Chrome's
  version from `C:\Program Files\Google\Chrome\Application\chrome.exe`. The built-in safety check is
  static: it paired the `Remove-Item` with the `C:\Program` token of that quoted, read-only path
  later on the same line, splitting at the space in its own tokenizer, and refused the whole line,
  `Stop-Process` included. A false positive against a safe command. Bundling a removal with
  unrelated operations is what made the line ambiguous, to the check and to anyone reading it; a
  removal alone on its line, naming its target literally, can be read by both. The retry that ran
  a minute later had the removal taken out and deleted nothing, which is also the record of what
  that line was worth: the Chrome was the point, the removal was a passenger.

  **Both guardrails fired on the harmless half.** November blocked a safe command. October blocked
  the cleanup, `rm -f /edit-index.mjs`, refused as a root-path removal, while the actual mistake,
  the write that put the file there, had gone through two minutes earlier with its error silenced.
  The guardrails stay, and they are not the fix: a check that stops the second half of a mistake
  cannot stop the first. That is why these two rules are about how a command is written, not about
  the check.

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
| `fetch` `/song/thorns` and count the rows (2026-10-24) | that **Carton's Thorns page** lists N performances | the **all-songs index**, reached by a 302 — a page with a table and 360 rows that looked like a song page and wasn't. The count was cited as evidence for a ruling before anyone noticed. Caught when `scripts/gap-oracle.mjs` started identifying songs by the page's `data-song-id` instead of the URL it asked for. The struck figure is in `docs/plan.md`, decision 2 under "Decisions settled 2026-10-24"; the slug behaviour is in `docs/carton_schema.md`, "A song's slug is not always its name" |
| Read `window.innerWidth` after `Emulation.setDeviceMetricsOverride` to 360 (2026-10-24, 0.1.81) | that the **emulated viewport** was 360px before measuring the chip bar | the **page overflowing horizontally**: under mobile emulation an over-wide document widens the layout viewport, so a nowrap fault that pushed the bar to 366px made the check report "the override did not take" and skip the overflow measurement it existed for. A layout fault, reported as a harness fault, by a check that was going red for the wrong reason. It reports the viewport and the bar's figures together now |
| Poll the live `version.js` for the string `0.1.82` after a push (2026-10-25, 0.1.82) | that **the Pages build had landed** | **nothing** — the inverse case. `src/version.js` stores `BUILD = 82`, a bare integer, and never contains the label, so the loop ran its full four minutes against a host that had already flipped and reported "still not 0.1.82". A check that cannot pass is as useless as one that cannot fail, and it reads the same from outside: a red run, a plausible cause, and a deploy wrongly presumed stalled. It is `scripts/wait-deploy.mjs` now, reading the integer with the same regex `verify-deploy.mjs` uses, proved green against the live host (exit 0 in under a second) and red against a build it does not serve (timeout, exit 1) |
| `scrollWidth > clientWidth` on the gap-history strip (2026-10-26, 0.1.83) | that **the strip's bars fit inside it** | **the overflowing strip itself**. A flex strip's bars carry `min-width: 0`, and given more bars than pixels they shrank past the edge: in a scratch page with the app's CSS, 300 bars at 360 with a fixed 1px gap ran the last bar to 332 against the strip's 327, and `scrollWidth` reported no overflow. The check compares the **last bar's right edge** with the strip's now, and a synthetic 300-bar strip in the real card reads `runs to 332, past its edge at 327` with the gap fixed |
| "The bright strip bar is the tallest" (2026-10-26, 0.1.83) | that **the strip's heights follow the gaps** | **every bar at the same 2px**. The bars' `--h` went through `el()`'s `style` prop, which is `Object.assign` and drops custom properties without an error, so every bar sat at the floor -- and when every bar is 2px, each one is the tallest. Green on its first run; caught by the same run printing a 0px bar gap. Each bar is now held to its own row's figure, and the spacing to the fluid gap's formula. The same `el()` path kept every `.gap-bar`'s `--heat` off the page from 0.1.16 until `el()` was fixed in 0.1.84 (`docs/design.md`, under "Color") |
| "0 Chromes left" after a run, with a kill added to `close()` (2026-11-01, after 0.1.88) | that **the kill fixed the leak** | **the leak having stopped by itself**. It was called fixed on that count. Removing the kill to prove it left the run clean, and so was the old `close()`, 2 of 2. The cause was never established. The bullet on `close()` below has the account |
| Open the When sheet and read its year grid, month grid, option rows and group titles (0.1.82 to 0.1.90, caught 2026-11-01) | that **the sheet renders right** | **the parts it named**, each right, with the text "nullnull" sitting under them in a text node no selector reached -- two `null` children handed to `replaceChildren`, which prints them. And it opened the sheet only from Aug 2019, the one state whose null branches are not taken. Nine builds, every run green. The smoke test watches the whole document's text now, in every state it walks, and must see its own control first |
| `setShowsWhen(2019)` returning `'year'` (0.1.82 to 0.1.90, caught 2026-11-01) | that **a year is reachable the way a thumb reaches it** | **the driver dismissing the sheet through its backdrop** after the year -- the exit no user finds -- and then reporting the year reached. The driver had encoded the workaround as the procedure, so every check downstream walked a state by a path the UI did not offer, and "a year is a step toward a month" shipped as designed. The driver reports a pick that leaves the sheet open now, and the `nav-states` section fails on it; with the old driver put back under that fault the section is green, which is the measure of what it was worth |
| `--only` failing a run of "zero checks" (0.1.91 to 0.1.92, caught 2026-11-02) | that **a scoped run executed its section** | **the boot's two literal-watch lines**, added in 0.1.91 and counted among the checks, so the guard read 2 whatever ran. And Carton's rate limit answers with a well-formed envelope and no rows, so the gate above every section closed without a throw and without a line. A proof with a fault staged read `SMOKE PASSED — SCOPED, not a full run: home, 2 checks`, exit 0. It was caught by the run taking 8s, not by its verdict, and a runner reading only the exit code would have recorded the fault as uncaught. The guard counts from the sections' start now, and the gate prints a SKIP |
| A plain `.chip` in the border sweep, answered by the first one the sweep met (0.1.46 to 0.1.93, caught 2026-11-02) | that **every plain chip carries the button's edge** | **Home's "Change" chip**, for as long as Home had one. Between tours the first `.chip` is the Sort chip on Songs, whose amber edge is on purpose: red on a correct app, because the check had only ever been shown one chip, and the same mistake in the other direction would pass an unstyled chip. It names the chip it wants now, on a song page that always has one |
| Whether Home has a hero, read off the screen, to decide what Home should show (0.1.93, caught 2026-11-02) | that **Home rendered the branch the archive calls for** | **a Home that lost its hero**, which reads exactly like between tours. Staged: the hero forced off on a day with shows, the branch read off the screen, `SMOKE PASSED` with 4 checks and 3 SKIPs. With the branch read from the raw rows the same fault fails 17 lines. `homeBranch()` is the only thing that decides now |

The shape is always a **proxy**: the check tests a side effect rather than the
thing itself, and the side effect has more than one cause. The row that polls for
`0.1.82` is the mirror image — a check whose condition has **no** cause — and the rule covers
it too: ask what could satisfy this, and if the answer is "nothing", the check
is not a check.

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
that has never failed on the bug it exists for has demonstrated nothing. The
checks were verified this way:

- `scripts/smoke.mjs` — with the `venueLine` import removed: 7 failures, exit 1.
  Restored: 0 failures, exit 0.
- `tests/build.test.mjs` — with `version.js` bumped alone: 2 failures. In step:
  85 passing.
- `scripts/gap-oracle.mjs` and the smoke test's one-song gap parity check
  (0.1.78) — with the withdrawn setlist-rows filter put back on the gap
  universe: the oracle reports 117 mismatches across 1119 checks, all 20 pages
  FAIL (none SKIP), exit 1; the smoke test fails the parity line (609 against
  Carton's 723), exit 1; 11 unit tests fail. Restored, by checksum the same
  file: 1119 of 1119, smoke green, 208 passing.
- The 0.1.79 checks, four faults applied one at a time and each file restored
  from a byte copy before the next:
  - `compareByLongestGap` with its sign flipped: 2 unit failures; the smoke
    flat-list check reads "climbs at numbered row 3: 3 after 1", exit 1.
  - the zero-performance filter removed from `buildIndex`: 2 unit failures;
    3 smoke failures — the catalogue check reads 370 against the derived 360,
    the A–Z check names the 10 songs reading 0 times, and the longest-gap list
    finds a "Never played" row.
  - `isPastLongestGap` loosened to `>=`: 1 unit failure, the tie case; the
    smoke filter check names the two tied songs, "Sussudio 51 vs 51; Silver
    Steed (My Blue) 6 vs 6".
  - the five filter chips rendered inline beside the lead chip: 0 unit
    failures — unit tests cannot see layout — and the smoke bar check reads
    "609px of content in 390px".
  Restored: 208 passing, smoke green with 0 skips.
- The 0.1.81 checks, seven faults applied one at a time, each file restored
  from a byte copy and confirmed by sha256 before the next:
  - `longestGap` tie reading closed (`>` to `>=`): 1 unit failure, "an exact tie
    reads OPEN". Smoke cannot see this one -- the two tied songs are in neither
    filter -- which is why the unit test exists.
  - `isClosedGapLongest` loosened to `>=`: 2 unit failures; smoke names them,
    "Sussudio current 51 vs longest 51; Silver Steed (My Blue) current 6 vs
    longest 6", and their "→ still open" lines under Closed gaps only.
  - `compareByTimesAsc` with its sign flipped: 1 unit failure; smoke reads
    `figure column reads "times", expected "time"` on the Least played top row.
  - the cover credit left on the date line under the longest figure: 0 unit
    failures -- unit tests cannot see a row -- and smoke reads `row 4 "Feel Like
    A Stranger" carries a cover credit under the span`.
  - `.chip-value` renamed: 1 unit failure (an emitted class no rule mentions);
    13 smoke failures, the lead reading `"SortA–Z▾"` and then `null`.
  - `white-space: nowrap` on the value: smoke at 360px, "366px of content in
    360px", the document widened to 366px, the filter value on 1 line where 2
    are required. The first run of this proof is the table row above.
  - a 60px `max-width` with `overflow: hidden` and nowrap: "73px in 60px, 113px
    in 60px" at both widths.
  Restored, by hash the same files: 214 passing, smoke 195 ok with 0 skips,
  gap oracle 1119 of 1119.
- The 0.1.82 checks, eight faults applied one at a time, each file restored
  from a byte copy and confirmed by sha256:
  - `matchesSets` reading `3+` as `> 3`: 1 unit failure (the three-set show
    leaves 3+).
  - `matchesEncore` with its branches swapped: 2 unit failures; smoke names the
    rows, `row 1 (Wed, Oct 21, 2026): detail has an encore set` and two more,
    plus `badge "2 sets + E": badge shows an encore` -- the row-to-detail tie.
  - `matchesState` as a substring: 1 unit failure, "a prefix is not a match".
  - `setSummary` counting encores as sets: 4 unit failures.
  - `compareByShortestGap` with its sign flipped: 1 unit failure; smoke reads
    `(b) drops at row 2: 781 after 792` and the mirror check `ascending runs
    792..2, descending 792..2`.
  - `white-space: nowrap` on `.chip-value`: 9 smoke failures across both bars
    -- Shows at 360 "the layout viewport reads 361px", the When value on 1 line
    where 2 are required; Songs at 360 "366px of content in 360px".
  - And two the smoke test found in the build itself, before any proof was
    staged: the wheel snapping option 0 to the wrong edge (13 failures, "Any"
    applied as `in AR`) and the opening-position frame undoing an ArrowDown
    (`ArrowDown left option 0 selected`). Both are recorded in `docs/design.md`.
  Restored, by hash the same files: 222 passing, smoke 190 ok with 0 skips,
  gap oracle 1119 of 1119, layout-diff `#/shows` changed and 8 routes identical.
- `scripts/wait-deploy.mjs` and its regex-parity test in `tests/hygiene.test.mjs`
  (2026-10-25, after 0.1.82). The script itself: green against the live host,
  exit 0 in under a second; red told to expect build 83 with a 15s timeout,
  "TIMEOUT after 15s: served BUILD is 82, expected 83", exit 1. The test, two
  faults staged one at a time and the file restored from a byte copy, sha256
  confirmed: the comparison rewritten against the `0.1.N` label fails "compares
  the two integers"; the regex loosened to `/BUILD = (\d+)/` fails "must read
  BUILD with the same regex". Restored: 223 passing.
- The 0.1.83 checks (gap history), six faults applied one at a time with the
  Edit tool. Each staged file's sha256 was confirmed DIFFERENT from its byte
  copy before any suite ran, and each was restored from the byte copy with the
  hash confirmed:
  - the fold disabled, one entry per performance: 5 unit failures; smoke 8,
    `Shadow: 28 show(s) listed more than once -- the list is one entry per show
    (169 rows)` and `no row carries ×N`; gap oracle 11 mismatches, `history:
    169 entries against 141 shows on Carton` -- every page with a repeat red,
    the nine without one correctly green.
  - the debut carrying Carton's position instead of the badge: 5 unit
    failures; smoke 36, `0 Debut row(s)`, and Shadow's longest read off the
    rows as 219 -- the position; gap oracle all 20 pages FAIL, `the first show
    is not a debut with no number (isDebut false, gap 219)`.
  - the closed maximum tagged while the open gap is the longest: 2 unit
    failures; smoke 4, `song 250: "Longest" on order(s) 2,3, expected 3`, and
    the same on Silver Steed's open tie.
  - `compareHistoryLargest` with its sign flipped: 1 unit failure; smoke
    `Largest gap: rises at row 20: 2 (order 131) after 1 (order 3)`.
  - the strip gap fixed at `1px`: 0 unit failures -- unit tests cannot see
    layout -- and smoke at 360, `a 300-bar strip runs to 332, past its edge at
    327`. At 390 it PASSED, with 0.078px bars, because the synthetic check
    asked only for bars wider than 0; it now also holds them to 1px wherever
    the strip has a pixel per bar, and re-run with the fault still staged (hash
    re-read) it reads `a 300-bar strip 324px wide has bars 0.078px wide`.
  - the strip's custom properties put back through `Object.assign(node.style,
    ...)`: 0 unit failures; smoke 9, `141 strip bar(s) not at their row's
    height, e.g. order 1: 2px ... wants 11.2px` and `bars spaced 0–0px, the
    fluid gap gives 1px`. That is the state the first version of the height
    check called green.
  - Two more went red on a real defect before their fix, not staged: the
    contrast coverage test, once `tokensUsedByRules()` kept every selector
    instead of the first, on `--line` grounding `.segmented-item:active`; and
    the new precache test in `tests/hygiene.test.mjs`, on `src/config.js`,
    absent from `sw.js` since 0.1.34.
  Then a cold review of the full diff found four checks that could pass for
  the wrong reason, and each was narrowed and proved the same way:
  - the back link's "opened from the song" put back in module memory, the
    version the review faulted: smoke 1, `opened from the song and reloaded,
    the back link did not step back: forward() reached #/song/54` -- green
    without the reload, which is why the check reloads.
  - the back link always stepping back: smoke 1, `from a deep link, the back
    link went to #/home, not the song`.
  - the back link pushing the song instead of replacing: smoke 1, `back()
    from the song reached #/song/54/gaps, not #/home -- the link pushed the
    song instead of replacing the history`. Before the review, all three
    landed on `#/song/54` and passed.
  - the screen's Carton link removed: smoke 1, `the history's Carton link is
    null, song detail's https://thecarton.net/song/shadow`.
  - only the first of a song's tied shows tagged: 1 unit failure; smoke 2,
    `song 277: "Longest" on order(s) 76, expected 76,77,87`. The tie song was
    chosen by its tags before, so this fault skipped every candidate and
    reported that the data had moved; it is chosen by its figures now.
  - an entry commented out of `SHELL`: the precache test fails naming
    `src/config.js`. It matched the whole file before, comments included.
  Restored, by hash the same files: 239 passing, smoke 203 ok with 0 skips,
  gap oracle 2080 of 2080.
- The 0.1.84 checks (the tour line, the tile as the history's entry), six
  faults applied one at a time with the Edit tool, each staged hash confirmed
  different from the byte copy before any suite ran, each file restored from
  the copy with the hash confirmed:
  - `tourName()` ignoring `tour_id`: 1 unit failure, "tour_id 1 names nothing";
    smoke 2, the newest played and the soonest upcoming `tour_id` 1 shows
    reading `["Part of Not Part of a Tour"]`.
  - `tourName()` keyed on the string "Not Part of a Tour" instead of the id: 2
    unit failures, one of them "the id decides, not the string". Smoke cannot
    see this one -- on the live data the id and the string are one-to-one --
    which is why the unit test exists.
  - the history's shows-since tile left a plain `statTile`: smoke 1, `"shows
    since last" is a DIV, ::after none, and opened null`.
  - the tile's strip fed one entry per performance: smoke 1, `the tile's strip
    has 169 bars, the history's 141 (141 show rows)`.
  - the tile's strip on its own scale (`max * 2`), with the bar count right:
    smoke 1, `122 tile bar(s) not at their row's height, e.g. order 1: 3px,
    the history row's 4 of 20 in 30px wants 6px`. A check on the count alone
    would have passed this copy.
  - the tile not navigating: smoke 4, led by `tapping the tile landed on
    #/song/54`.
  Restored, by hash the same files: 243 passing, smoke 206 ok with 0 skips.
- The 0.1.84 heat checks (the second commit, `el()` passing custom properties
  through `setProperty`), three faults staged the same way:
  - `el()` reverted to `Object.assign(node.style, v)`: 0 unit failures -- unit
    tests have no DOM -- and smoke 28. All three heat lists in both themes,
    `354 of 354 bar(s) not at their row's heat, e.g. Miles to Go: --heat "",
    its 792 of 792 gives 1` and `1 distinct --heat value(s)`, and every strip
    height and spacing check from 0.1.83 and the tile's, the strip having lost
    its own setProperty helper in the same commit.
  - the `.gap-bar` opacity rule composing the heat wrong (`* 0.5` for
    `* (1 - floor)`): smoke 6, `287 bar(s) not at floor + heat x (1 - floor),
    e.g. Miles to Go: opacity 0.6, floor 0.1, --heat "1"`. The value check
    alone would have passed this.
  - the `data-heat="none"` rule unmatched: smoke 4, `6 row(s) with no heat
    still draw a bar, e.g. Find The Cost of Freedom at opacity 0.1`, and
    Shadow's debut row the same.
  Restored, by hash the same files: 243 passing, smoke 209 ok with 0 skips.
- The BUILD label at three and four digits (`tests/build.test.mjs`,
  2026-10-27), which evaluates `src/version.js`'s own source with the integer
  swapped. Two faults staged in that file, restored by hash:
  - the label cut to its last two digits: `'BUILD 0.1.00'` against
    `'BUILD 0.1.100'`.
  - a decoy comment, `export const BUILD = 12`, above the declaration: the
    swap lands on the comment and the test fails `the swapped module reads
    BUILD 84, not 100` instead of passing on today's label. The same decoy
    also failed the two older build tests, whose regex took the first match in
    the file -- as did `verify-deploy.mjs` and `wait-deploy.mjs` on the served
    copy.
  Restored: 244 passing.
- Every reader of `src/version.js` anchored to the declaration line (0.1.85):
  both build tests, `verify-deploy.mjs` (working tree and served copy) and
  `wait-deploy.mjs` read `/^export const BUILD\s*=\s*(\d+);?\s*$/m`, and the
  regex-parity test in `tests/hygiene.test.mjs` pins that literal in both
  scripts and fails on any unanchored `.match(/BUILD\s` left beside it. The
  decoy above is now the proof that the anchor holds, so it goes GREEN: with it
  staged (hash re-read, different), 244 passing, `wait-deploy` derived 84 from
  the tree and found it live, and `verify-deploy` reported `DEPLOY VERIFIED --
  live BUILD is 0.1.84`. And the anchored readers still go red on a real
  mismatch: `version.js` bumped to 85 alone, 2 unit failures and `wait-deploy`
  `TIMEOUT after 15s: served BUILD is 84, expected 85`, exit 1; `wait-deploy`'s
  regex put back unanchored, the parity test fails `must read BUILD with the
  same regex`. Restored by hash: 244 passing. **The anchor is a line shape,
  not a parser:** a line that begins `export const BUILD = n` inside a block
  comment would still match. Nothing writes one today.
- The 0.1.85 checks (jam chart marking, the title chip, 4px bars), faults
  applied one at a time with the Edit tool, each staged hash confirmed
  different from the byte copy before any suite ran, each file restored from
  the copy with the hash confirmed. Against the build as first written:
  - song detail's `isJam` forced false: 0 unit failures -- unit tests have no
    DOM -- and smoke 3, `song 54 (Shadow): 14 show(s) marked unlike the
    jamcharts table, e.g. show 1708050183: 0 row(s) marked, 1 entr(ies)`, the
    same on Buying Time, and `only 0 jam edge(s) to measure`.
  - Gap history's tag taken from the song instead of the show: 1 unit
    failure, "isJam is per show"; smoke 2, `"Jam" on 141 show(s), the table
    charts 14`.
  - Debut back in `.badge-jam` on the gap chart: 0 unit failures; smoke 16,
    both themes, `Debut is class "badge badge-jam" in rgb(138, 206, 152), not
    the plain badge in --ink-dim`. Its first run hung for three hours; see
    the hang below.
  - the jam edge's `content: ""` removed: smoke 2, `14 row(s) whose badge,
    line and edge disagree ... edge none`.
  - the chip never hidden: smoke 6, `at the top the chip is rendered, hidden
    false, inert false, focusable true`.
  - hidden without `inert`: smoke 2, `hidden true, inert false, focusable
    false`. A hidden chip is unfocusable either way, so the attribute is the
    check's evidence for inert, by design.
  - the tap smooth under reduced motion: smoke 4, `the tap left scrollY at
    1500 -- it must jump`.
  Then a cold review of the diff found a defect no check measured -- a title
  that wraps, appearing in Gap history's sort row, pushed the list down, 33px
  for Rocket Man -- and checks that could pass for the wrong reason. Fixed
  and narrowed (`docs/design.md`, 0.1.85), green first (smoke 212 ok, 0
  skips), then each proved against the fixed build:
  - the hidden chip's held box removed: smoke 1, `Rocket Man ... the chip
    moved the list 33px`. Shadow's one-line chip stayed green, which is why
    the check also runs on the widest title.
  - the observer not rebuilt on resize: smoke 1, `with the header 28px taller,
    the heading 4px under it ... the chip is not shown -- it kept the old edge`.
  - no focus hand-back as the chip hides: smoke 2, `the focus went to body,
    not the heading`.
  - the jam flags reversed among a night's performances, every per-show count
    still right: smoke 2, on the new lines alone, `6 charted and not marked
    ... 6 marked and not charted` on Shadow, 4 and 4 on Buying Time. The
    per-show check passed it.
  - a count in a `.badge-jam` on the gap chart: smoke 2, `.badge-jam reads
    "2", not a jam label here`. The label set allowed a bare number on every
    screen; nothing else in the run caught it.
  - a second, unanchored BUILD constant in `wait-deploy.mjs`, read before the
    anchored one: 1 unit failure naming the line. The guard it replaces looked
    only for an inline `.match(/BUILD\s`, which that file does not contain.
  - the chip in a bar of its own on Gap history: smoke 3, `sticky bars
    ["title-bar","sortbar sortbar-lead sortbar-titled"] ... one bar`.
  - the observer's edge doubled: smoke 3, `shown at scrollY 85, with the
    heading's bottom 5px below the header's edge`.
  - `.gap-bar` back to 3px: smoke 5, one per list, `not 4px wide, e.g. 3px`.
  - the chip never hidden, again, against the check's new reading of "shown"
    (a box AND visible, since Gap history's hidden chip keeps its box): smoke
    9.
  Restored, by hash the same files: 245 passing.

  **The hang, and a leak it uncovered (2026-10-28).** The Debut proof's first
  smoke run stopped mid-check and sat for three hours: the smoke test's CDP
  calls have no timeout, so one lost response waits forever. Cleaning up after
  it found **90 headless Chromes** left from earlier runs, back to
  2026-10-26. On this machine the `chrome.exe` that `spawn()` starts hands off
  to a separate browser process and exits at once, so `proc.kill()` kills a
  process that is already gone -- measured with a scratch probe, not inferred.
  Every run of `smoke.mjs`, `verify-deploy.mjs` and `layout-diff.mjs` leaves
  one or two behind. `Browser.close` over CDP reaches the real browser. Fixed
  the same day, in the bullet below.
- The Chrome leak and the CDP timeout, fixed in `scripts/cdp.mjs`
  (2026-10-28, scripts only, no bump). One helper launches, drives and closes
  Chrome for the smoke test, layout-diff and verify-deploy. `close()` sends
  `Browser.close` on the browser's own endpoint, confirms the DevTools port
  has stopped answering, and prints a `WARN` when it has not or when the
  throwaway profile could not be removed. Every call rejects after 60s,
  naming its method, and a dropped connection rejects every waiting call at
  once. The smoke test and layout-diff close the browser on a run that throws
  as well as one that finishes; before, a throw in the smoke test escaped as
  an unhandled rejection, with a stack trace, no verdict and the browser
  left running. Headless `chrome.exe` processes and `dozen-*` profiles in
  the temp directory were counted with a scratch probe before and after each
  run, each fault staged with the Edit tool, its hash confirmed different
  from the byte copy, and the file restored from the copy by hash:
  - smoke, green: 0 processes and 0 profiles before, 0 and 0 after, 212 ok,
    no `WARN`. With `Browser.close` skipped: 0 → 2 processes (one browser
    and its helper) and 1 profile left, with both `WARN` lines, `still
    answers after Browser.close` and `the throwaway profile was not removed
    (EPERM)`. The verdict stayed `SMOKE PASSED`. That the cleanup warns and the
    verdict stands was Code's default that day, offered as the dev's call and
    left open until 2026-11-01, when it was decided with its other half, that
    leftovers never accumulate: the sweep, the bullet headed "The sweep".
  - a call Chrome never answers -- `Runtime.evaluate` awaiting `new
    Promise(() => {})` -- staged in each script in turn. Smoke: `FAIL  the
    run stopped: CDP Runtime.evaluate timed out after 60s with no reply from
    Chrome` and `SMOKE FAILED`, exit 1 at 63s. layout-diff: `layout-diff
    failed:` with the same message, exit 1 at 63s, its worktree removed.
    verify-deploy: `FAIL  rendered UI check threw:` with it, `DEPLOY NOT
    VERIFIED`, exit 1 at 63s. Chrome 0 → 0 each time. With the timeout's
    `reject` removed, the smoke run printed nothing and was still waiting
    when the outer limit killed it at 150s (exit 124) -- and the leak was
    back, 0 → 2 and a profile, because a hung run never reaches its cleanup.
    That is the second reason the timeout matters.
  - the hygiene guard, `only scripts/cdp.mjs launches Chrome`:
    verify-deploy put back to its committed copy, 1 unit failure naming it;
    layout-diff's `openChrome` import removed, 1 failure naming it.
    Restored: 246 passing.
  - the smoke test's runtime-error check, whose events now arrive through
    `onEvent` -- a check that never received one would read `none` on every
    run. A `console.error` and an uncaught throw staged in the page after
    boot: `SMOKE FAILED -- 2 problem(s)`, `console.error: STAGED console
    error` and `uncaught: Error: STAGED uncaught`, Chrome 0 → 0.
  - the final files, green: smoke 212 ok with 0 skips, layout-diff `HEAD 390
    dark` 10 identical (both sides booted, stylesheets fingerprinting equal),
    verify-deploy `DEPLOY VERIFIED -- live BUILD is 0.1.85` with 10 routes
    rendering live -- each 0 processes and 0 profiles
    before and after, no `WARN`.

  The same cleanup found **465 throwaway profiles, 20 GB**, in the temp
  directory, back to 2026-09-02: every run's `rmSync` had failed silently
  against a browser still holding its profile. They were deleted. The smoke
  test now prints its slowest call beside the timeout -- 30ms of 717 on the
  final run, 990ms on another, so it moves from run to run; the figure was
  checked against a scratch call the page held for 1500ms, which read
  1514ms. The longest deliberate wait inside one call is
  the smoke test's own 25s ceiling on `navigator.serviceWorker.ready`.
- The 0.1.86 checks (jam chart notes, `openSheet`, the jamcharts table on the
  fast refresh, the `/jams/` link), 25 faults applied one at a time. **Staged
  from a scratch Node script by exact string, not with the Edit tool,** because
  the run was unattended: each string had to occur exactly once, the staged
  hash was confirmed different and the new text read back before any suite ran,
  and each file was restored from a byte copy with the hash and `git status
  --short` confirmed. The data and the note:
  - `jamEntryCard` setting the note with `innerHTML`: 1 unit failure, the
    innerHTML hygiene test; smoke 5, `4 real <img> in the DOM from a note` and
    `the onerror handler ran (window.__jamXss = 1)`.
  - a CSP blocking inline handlers, so that sentinel could not fire: smoke 1,
    `the positive control did not fire (before undefined, after undefined), so
    the sentinel proves nothing`. Without the control the XSS check would pass
    on a page where nothing could ever run.
  - the second clean put back on the fallback path: 1 unit failure; smoke 3,
    `"<img src=x onerror=1>", expected "&lt;img src=x onerror=1&gt;"`, on the
    sheet, the cards and the titles.
  - the sheet printing the first entry's note on every entry: 0 unit failures;
    smoke 6. On Home and Shows the line first printed two identical name lists
    as its evidence, the fault moving notes and not names. It was the right
    red with useless evidence, and it prints the entry that differs now.
  - " (Recommended)" on every entry: 1 unit failure; smoke 13. On none: 1 unit
    failure; smoke 14. Each names the title, the card and the sheet.
  - song detail printing the note without `jamNoteText`: 0 unit failures; smoke
    1, on song 49's entries.
  - `mergeYear` dropping the table: 2 unit failures. `fetchCurrentYear` not
    returning it: 1. Smoke 1 for each, the same line, a real boot and refresh
    from a table cut short: `stale table: 832 rows before the refresh, 832
    after, The Carton has 852`.
  - the Jams link back to `/jamcharts`: smoke 1, `the Carton link
    https://thecarton.net/jamcharts answers 404`.
  - two with no smoke run, unit tests only, reasoned rather than measured: a
    stale row needs a table that has moved past it and a guard against a short
    table needs a table that shrinks, and the live data offers neither on
    demand. The flag read from the setlist row instead of the table: 2 unit
    failures. The never-shrink guard off: 1.

  The key line and the titles:
  - the key a span, not a button: smoke 16, among them `the key line is not a
    real button opening a dialog`.
  - the target centred on the row, as first designed: smoke 2, Home only,
    `columns 40 / 45 / 45px` at 360 and `43 / 45 / 45px` at 390. A separate
    hit-test walk (scratch, the override as a page stylesheet) put the worst
    card at 39 and showed the Show detail button taking the difference.
  - the 44px in the flow, on the button: smoke 4, `the key row itself is 52px,
    in the flow rather than an overlay`.
  - the overlay at 36px: smoke 4, `declared 36px, columns 37 / 37 / 37px`.
    Sampling reads a 44px region as 45, which is why the check wants the
    declared height AND the sampled one.
  - a `title` on every setlist title: smoke 5, `5 title(s) not on the jam chart
    carry a title`, and the two recommended non-jam songs marked as entries.
  - a green title finding its entry by song, not by row: 0 unit failures; smoke
    2, only on a song charted twice in one night. The show was chosen for that.
  - every key opening the first card's entries: smoke 6, `Home: 2 of 2 card(s)
    open entries that are not their own, e.g. 7 entries, expected 3`.

  `openSheet`, 0 unit failures on all of them, since unit tests have no DOM:
  - `aria-labelledby` removed: smoke 2, `not named by its own heading`.
  - the sheet not taking focus: smoke 2. Focus not handed back: smoke 5.
  - the Escape listener removed: smoke 7, led by `Escape left 1 sheet(s) and 1
    backdrop(s)`. Escape closing every sheet instead of the top one: smoke 1,
    `the first Escape on a stack left {"headings":[],"focus":false}`.
  - the hashchange listener removed: smoke 19, among them `Back left 1 sheet(s)
    open over #/jams` and `tapping the last entry's title reached
    #/show/1763660681 with 4 sheet part(s) left`.

  Restored, by hash the same files: 261 passing, smoke 254 ok with 0 skips and
  no `WARN` in any of the 23 smoke runs. `layout-diff 2251273`: 390 dark and
  light, `#/song/49` changed and 9 routes identical; 360, 10 identical
  (`docs/design.md`, 0.1.86, reads what moved).
- The scoped smoke run, `--only` (2026-10-31, scripts only, no bump). The jam
  notes block became one function and the verdict another, so a full run executes
  the same code in the same order, and `git diff -w` shows only the wrappers, the
  gates, and two helpers moved above them. **Only `jam-button` (since 0.1.88),
  `jam-notes`, `sheet`, `markup`, `stale-table`, `nav-states`, `show-detail`, `song-detail`,
  `home` and `section-heads` can be scoped.** About
  fifty names cross the sections before them, so wrapping those would change the full
  run to save time on it; a section joins when a proof needs it and it can stand alone
  (`show-detail` joined in 0.1.90, `nav-states` in 0.1.91, `home` in 0.1.93). Green, against 380s for a full run: `stale-table` 12s, `markup` 11s,
  `sheet` 18s, `jam-notes` 34s.
  The three ways a scoped run could report health it never established:
  - an unknown name: `--only nope`, a bare `--only`, `--only ""`, `--onyl
    jam-notes`, `--only jam-notes,nope` and `--only=jam-notes` each print
    `SMOKE FAILED`, naming the sections, and exit 2 with no Chrome started.
  - zero checks: a gate staged as `if (false && want('stale-table'))` reads `FAIL
    --only stale-table executed zero checks, so this run proved nothing` and
    `SMOKE FAILED ... stale-table, 0 checks`, exit 1. A SKIP does not count as a
    check, and the runtime-error line, which passes on any run, is left out.
    **That stopped being true in 0.1.91, when the boot's two literal-watch lines
    were counted, and this guard could not fire until 0.1.93** (the table above).
  - the verdict: `SMOKE PASSED — SCOPED, not a full run: stale-table, 2 checks`,
    never "all routes rendered". `sheet,stale-table` names both and reads 15, the
    13 and 2 of their own runs, and every count equals the run's `ok` lines less
    the runtime-error one. Since 0.1.93, less the three literal-watch lines too, so
    figures recorded for 0.1.91 and 0.1.92 read two higher than this count would.
  And a fourth, added because the first three cannot see it: a gate mistyped as
  `want('stale-tables')` stops the run, `a gate names "stale-tables", which is not
  in SECTIONS`, exit 1, on a full run as well as a scoped one.
- The 0.1.87 checks (the show line in the jam notes sheet), the first run under
  the ruling below. Each is `--only jam-notes`, staged from a scratch Node script
  by exact string, the staged hash confirmed different and the new text read back
  before the run, and the file restored from a byte copy by hash with `git status
  --short` confirmed. Green: 39 checks, 34s. The four named in the plan:
  - the first card's show on every sheet, the header alone, with the entries and
    the Carton link left right: smoke 30, the date and the venue each on a line of
    their own, `date reads "Sun, Oct 18, 2026", the raw row gives "Thu, Oct 15,
    2026"` and `venue reads "High Noon Saloon · Madison, WI", the raw row gives
    "Buffalo Iron Works · Buffalo, NY"`.
  - the header missing: smoke 17, `the sheet has no show line` on every sheet,
    show detail's and the cards' alike.
  - `ingestShowRow` not decoding the venue: smoke 3, and only on encoded venues,
    `venue reads "Garcia&#039;s Chicago · Chicago, IL", the raw row gives "Garcia's
    Chicago · Chicago, IL"`. A check held to the index would have agreed with the
    fault.
  - a rule changing sheet card padding: smoke 2, `a sheet card is not the size of
    its twin on the page, entry 1: {"w":328,"h":202.34}, expected
    {"w":328,"h":253.19}`, at 360 and 390.

  Added to the plan's list. **The header below the cards was on the list to drop
  and was run instead,** because it leaves every word right, so neither text
  comparison can see it: smoke 17, each `the show line is not the first thing
  under the heading`, and no date or venue line. The other four are the check's
  own branches, each of which would pass silently on a mistake:
  - the card lookup returning nothing: smoke 10, `its 13 titles match no show in
    the raw table, so its show line went unchecked`.
  - a card matching two shows: **exit 0 by design,** 10 `SKIP` lines naming the
    ids, and the verdict `jam-notes, 29 checks (10 checks SKIPPED, not verified)`.
    It does not pick one. Two pairs of the 620 setlisted shows share a title
    sequence and neither is charted, so no card reaches this today.
  - `&#039;` taken out of the check's decoder: smoke 2, `the raw row's venue holds
    &#039;, an entity this check cannot decode`, reported as the check's gap and
    not as the app's fault.
  - the twin check with no cards on the page: smoke 2, `the page has no jam cards,
    so the sheet's had nothing to match`. Two empty lists compare equal, so
    without this line it passes.

  **Dropped, each a duplicate of a comparison shown above:**
  - `formatShowDateShort`: the same exact match on the date, which the first fault
    shows firing on its own line.
  - the venue without the place: the same exact match on the venue line, which
    the first and third faults show firing.
  - show detail skipping the header: the same `no show line` on the same
    `checkShow` path as the header missing.

  Restored, by hash the same files: 261 passing, smoke 273 ok with 0 skips and no
  `WARN`, against 254 on 0.1.86, with 0 lines lost and 19 gained when the two runs
  are compared line by line, so the `--only` wrappers cost the full run nothing.
  `layout-diff 1860451`: 390 dark, 390 light and 360 each 10 identical, stylesheets
  241 rules against 243. **A closed sheet is not on any route, so that says the
  pages did not move and nothing about the sheet.** The nine faults and the green
  took 353s of smoke across ten runs, 9m35s with a 25s gap between them for
  Carton's limit, against 386s for one full run.
- The 0.1.88 checks (the Jam notes button, the legend, the sheet's title), the second
  run under the ruling. Each is `--only jam-button` unless marked, staged from a
  scratch Node script by exact string, the staged hash confirmed different and the
  new text read back before the run, and restored from a byte copy by hash. Green,
  `jam-button` is 109 checks in 36–47s. The button's count and presence:
  - N counted from every title in the setlist: smoke 6, `"●Jam notes · 13" on a show
    with 3 raw row(s)`.
  - N counted from distinct songs: smoke 2, only where a song is charted twice, `"●Jam
    notes · 4" on a show with 5 raw row(s)`.
  - every button opening the first show's sheet, its count left right (`--only
    jam-notes`): smoke 38, the entries, date, venue and Carton link, led by `the sheet,
    7 entries, expected 5`.
  - `setlistCard` leaving it off: smoke 10, with 4 target lines SKIP on Home and Shows
    by design, a card's missing button being red already.
  - `setlistBlock` leaving it off: smoke 22, among them `show detail at 360: no Jam
    notes button, so its target went unmeasured`. That line was a skip until this build.
  - the `hasJam` gate gone: smoke 7, `a button reading "●Jam notes · 0"`.

  The legend, which leaves the button right in all four:
  - the key turned back into a button: smoke 33, among them `2 key(s) hold a control,
    not plain text`.
  - a click handler on the key row, its markup left plain: smoke 6, and only `a real
    press on the key opened a sheet`. Nothing that reads the markup can see this one.
  - the key gone, as first proposed: smoke 36, led by `jam key: not rendered inside the
    setlist card`.
  - a footnote row lost from the list: smoke 5, `1 card(s) list 6 footnote(s) under
    markers up to 7`. One function builds the list and the button.

  The button's markup, place and paint:
  - `aria-haspopup` removed: smoke 6. "1 entries" in the name: smoke 1, the one-entry
    show alone.
  - below the footnotes on show detail: smoke 4. In a card's body, not its row: smoke 2.
  - a green fill: smoke 12, `filled rgb(138, 206, 152), a plain button's fill is rgb(28,
    24, 21)`. The jam colour rule gone: smoke 12, `off the card's green`.
  - its `::after` cancelled: smoke 6, `declared 44px, columns 30 / 37 / 28px`. The
    declared height still reads 44, so the columns, sampled 2px in from each edge and
    the middle, are the evidence.
  - its `::after` 20px wider on the left: smoke 4, `the button's target takes taps meant
    for "Show detail"`.

  The two addenda, `--only jam-notes`, 45 checks in 33–36s:
  - the "as written" line put back: smoke 3, `a line taken out in 0.1.88`. No proof that
    had run depended on the line: none had run when it came out.
  - the label styling removed, the dev's one proof: smoke 6, size, colour and case in
    both themes, `15px against the date's 15px, not smaller`.
  - the hairline removed: smoke 2. Beyond the one the dev asked for, because the new
    check still has to be seen red.
  - the label on every sheet's title: smoke 2, `a footnote's title (dark) took the
    label`. It guards the scope, and the jam notes sheet stays right under it.

  **The one full run found what no scoped run could reach.** The old `cards carry one
  button` check sits before the sections and cannot be scoped, and the plan's list of
  checks to adjust had missed it. It failed twice on correct cards, `expected exactly
  ['Show detail'] per card`. It now holds the whole row, in order, against what the
  card's own green titles call for, and its proof cost a full run, 408s. A plain extra
  button staged in every row: smoke 2, those two lines and no others, `card 1 carries
  ["Show detail","●Jam notes · 3","Staged"], expected ["Show detail","●Jam notes · 3"]`.
  Nothing in `jam-button` sees a third button, so the old check earned its keep.

  **Dropped, each with its reason:**
  - the old key left in the list: dropped by the dev when the key stayed.
  - the count read from the first card, and the wrong word ("Jam chart"): the same exact
    label comparison the first fault shows firing.
  - the key reworded: the same exact text comparison, shown firing with the key turned
    into a button.
  - the twin check and the sheet's focus, Escape and Back: only their opener's selector
    changed, they were proved in 0.1.86, and a wrong selector throws.
  - the Carton link and accessible name checks: unchanged, as the addenda said.
  - repeats per width, theme and screen: the same comparison.
  - the legend's alignment and colour lines: moved verbatim, not new.

  Restored, by hash the same files: 261 passing, smoke 367 ok with 0 skips and no `WARN`
  in 407s, against 273 on 0.1.87. `layout-diff 7226efc`: 390 dark, 390 light and 360 each
  2 changed and 8 identical (`docs/design.md`, 0.1.88, reads what moved). The first 24
  runs took 942s of smoke, 26 minutes with the gaps for Carton's limit.
- `close()` and a Chrome that stays up (2026-11-01, scripts only, no bump). For about
  half an hour that night, scoped runs left Chrome up and its profile behind,
  `still answers after Browser.close` and `EPERM`. It followed the length of the run and
  not the checks: `stale-table` held idle closed clean at 12s and did not at 48s, 62s,
  123s or 222s. A scratch probe at 63s got `{}` back from `Browser.close`, with no
  targets left and the port still open; a second close did nothing and `process.kill`
  ended it. So `close()` reads the real pids first, and if the port still answers kills
  them, the helpers too, and says so. It also retries removing the profile.
  **That was called fixed, and it was not shown to be.** Run with the kill removed, it
  was meant to go red and did not: clean at 52s. The old `close()` was clean at 52s too,
  2 of 2. The fault had stopped by itself and its cause was never established, so the
  kill is a response to a condition that may recur. It is proved by staging the condition
  instead of waiting for it, `Browser.close` swapped for `Browser.getVersion`, with the
  verdict `SMOKE PASSED` both ways, on the 2026-10-28 default that was still the dev's
  open call (made on 2026-11-01: the sweep, the bullet headed "The sweep"). With the
  kill: `stayed up after
  Browser.close -- its processes were killed`, 0 Chromes, the profile removed. Without:
  `still answers`, `EPERM`, 8 Chrome processes on that profile. Commit `9f3baf3`'s
  message predates this; the comment in `scripts/cdp.mjs` carries the correction.
- The 0.1.89 checks (the button reads "Jam notes", 2026-11-01), two proofs under the
  ruling, each `--only jam-button` from a scratch script by exact string, the staged
  hash confirmed different and the line read back, the file restored by hash:
  - the old "● Jam notes · N" label put back, the one the dev asked for: smoke 6, one
    per screen, `Home: 2 of 2 button(s) read "● Jam notes · 3", not exactly "Jam
    notes"`, 104 ok, 38s.
  - the old `aria-label` put back beside the new label: smoke 6, `2 button(s) carry an
    aria-label, "Jam notes, 3 entries", over a visible label that names them`, and
    nothing else, 104 ok, 38s. The second proof is beyond the dev's one, because the
    no-`aria-label` line is a comparison of its own and had to be seen red.

  **Removed:** the comparison of the button's label and accessible name against each
  show's raw jam rows (0.1.88's `read "Jam notes · N", N the show's raw rows` and
  `accessible name(s) count the same entries`). Its target, the count on the button, is
  gone. The third comparison in that block, the green titles against the raw rows,
  stays, because its target did not go; it is the only per-card check of the green on
  Home and Shows (the older highlight check reads one fixed show). The pre-section
  `cards carry Show detail` line now wants `Jam notes` beside it and was not proved
  again: its comparison is the one the 0.1.88 full-run proof showed firing.

  Green: 261 passing, smoke 367 ok with 0 skips and no `WARN` in 404s. `layout-diff`
  against 0.1.88 (`fbe9d77`), 390 dark, 390 light and 360: `#/home` 3 of 80 boxes and
  the charted show 1 of 52, every one the button or the link beside it, 8 identical
  (`docs/design.md`, 0.1.89). Against 0.1.87 the three runs read what 0.1.88's did,
  which is why the first set was re-run: "only the width" is a claim against 0.1.88.
- The 0.1.90 checks (show detail's layout, 2026-11-01): a new scoped section,
  `show-detail`, and the proofs under the ruling, each `--only show-detail` unless marked,
  staged from a scratch script by exact string, the staged hash confirmed different and
  the new text read back, the file restored by hash with `git status --short` confirmed.
  The section holds the inline chart's place and parts; every row's figure, Debut and fold
  to that song's gap history for the show, on the charted show the suite walks and on
  Shadow's debut show; a sample of rows to their histories and back through the chip; and
  the header's chip through the title-chip routine, with the venue line as its edge.
  Green, 6 checks in 69–118s with the boot.
  - the chart's figures swapped for each song's current gap: smoke 23, every row of both
    shows, `Apology: 5 on the chart, 4 on the history`.
  - every row opening the first row's song: smoke 3, `Shadow: the row landed on
    #/song/5/gaps, not #/song/54/gaps`, on the second, third and Debut rows; the first
    row's own line stayed green, which is why the sample is more than one row.
  - every row's `data-song-id` set to the first song's, the navigation left right: smoke
    25, `row "Backyard Bear" (song 5) is the history of "Apology"` on ten rows, their
    figures with them, `Shadow's row on the chart is missing` on the debut show, and two
    round trips.
  - the from-show stamp not written: smoke 4, `the back chip reads "Apology" ("Back to
    Apology"), the show is "Tue, Dec 31, 2024"`.
  - `setlistBlock` keeping the button beside the section (`--only jam-button`): smoke 6,
    `show detail: 1 of 1 card(s) with jam songs have 1 Jam notes button(s), not 0 -- on
    show detail the entries are open on the page` on the four show pages and the two
    target lines, nothing on Home or Shows.
  - show detail dropping the section (`--only jam-button`): smoke 4, `show detail: 0 "Jam
    chart entries" section(s) on the page, expected 1`.
  - the entries section moved above the chart: smoke 2, `the chart is not the section
    right after the Setlist section` and `the entries section is not the section right
    after the chart`.
  - the chip watching the date heading instead of the venue line: smoke 1, `shown at
    scrollY 109, with the watched line's bottom 5px below the header's edge`. The plan
    named "the bar never hidden"; that cannot be staged from show.js alone, since
    `titleChip()` hides its parts as it builds them and the observer hides them again,
    and it was proved in 0.1.85 on the routine itself. What is new on this screen is the
    node the observer follows, so that is what was staged.
  - the redirect removed, a full run (532s): `#/gapchart/1728657865 ->
    #/gapchart/1728657865, expected #/show/1728657865`, the one line the fault owns.
    **The same run found a defect in the build as it then stood,** three lines of `Shows
    Sets = 2: row 1 (Wed, Oct 21, 2026): 4 non-encore sets on detail, expected exactly 2`:
    the chart's group labels were emitted as `.setlist-label`, and the filter check
    counts that class on show detail as the show's sets. They are `.gap-chart-label` now,
    styled by the same rule, and `.setlist-label` keeps meaning a set in the setlist. The
    full-run proof earned its keep; no scoped run reads that count.
  - a precache entry for the deleted view: 1 unit failure, `the service worker precaches
    these files, which no longer exist`. The test is new, because the install survives a
    stale entry by design, one add failing on its own, so nothing on screen would ever say.

  **Dropped, each with its reason:**
  - the row opening the song page: the same hash comparison the second proof shows firing.
  - the entries section built on a card: the same count comparison as the fifth proof, on
    another screen.
  - the bar given a height in flow: proved in 0.1.85 on the routine this screen reuses.
  - the per-performance fold: `gapChartForShow()` is unit-tested, and the section's fold
    line is shown firing by the third proof, `Buying Time: 3× tonight on the chart, ×1 on
    the history`.

  **Changed with the layout:** the three gap-chart entry points go with the route, and the
  rows that carried the icon are held to one control each; "Show detail precedes Gap
  chart" goes, because no card has offered Gap chart since 0.1.48 and a check that cannot
  fail is not a check; the gap history's rows are held to no icon where they were held to
  one; the heat, bars, green and parity reads that visited the route read the show page's
  chart; six sheet checks open the sheet from the show's card on the Shows tab, through
  When and the detail view, the card found by its titles; the twin check compares that
  sheet with the show page; the route list loses the chart and the redirects gain it; the
  title-chip routine moved above the scoped branch and takes the node whose bottom is its
  edge.

  Green: 261 passing, smoke 347 ok with 0 skips and no `WARN` in 490s, against 367 in 404s
  on 0.1.89. **Line by line against the 0.1.89 run: 52 lines lost and 32 gained, 17 of each
  the same check reworded** (the Back lines name the screen they leave, the heat, bars and
  parity tags name the show, the show-page twins and target lines, Home's and Shows' button
  lines, the action row's reference control, "4 small buttons" now 2). **35 lines are gone:**
  the chart route's three (its walk, its marker's uniqueness, its header sweep), the three
  entry points, "Show detail precedes Gap chart", and 28 that read show detail's button, 7
  on each of 4 show pages. **15 are new:** the redirect, the chart on the show reached from a
  Shows row, three one-control row lists, four "no Jam notes button, the entries open on the
  page" lines, and the section's six. **The 86s added** are the `show-detail` section, 59 to
  108s by its scoped runs less the boot, and the sheet checks reaching each sheet through
  the Shows tab, When, the view and the card at about 3s an opening against one press on the
  show page; the walk and the 28 button lines that went gave back less. `layout-diff` against
  0.1.89 (`36b2eb8`), 390 dark, 390 light and 360, reads the same three times: the charted
  show 39 of 64 boxes; `#/song/49` 135 of 312 and `#/song/54/gaps` 141 of 298, which are
  exactly their 135 performance rows and Shadow's 141 shows, each row's venue line 42px
  and 30px wider at the same place, the icon's width given back; 6 identical; the chart's
  old route reported `REMOVED`, as it should be (`docs/design.md`, 0.1.90).

- The 0.1.91 checks (the Shows nav, 2026-11-01: the literal watch, the `nav-states`
  section, the When pill and "All shows"), under the ruling below. Each scoped proof is
  `--only nav-states`, staged from a scratch Node script by exact string, the staged hash
  confirmed different from the byte copy and the new text read back before the run, the
  file restored from the copy by hash with `git status --short` held to the tree as it
  stood before that fault. Green first: 17 checks in 48s; 266 unit tests passing.

  The literal watch and the null:
  - the old When sheet put back, `body.replaceChildren(...)` with two `null` children:
    1 unit failure, the new hygiene guard naming `src/views/shows.js:` and its line; smoke
    1, `literal "null" in the text at #/shows, in the sheet "When", div.sheet > div, not
    rendered when the watch looked (end of the task that added it), gone by the time it
    was read`. The sheet checks of 0.1.82 to 0.1.90 passed over that text nine builds
    running.
  - the watch's pattern changed to one that matches nothing: smoke 1, `the literal watch's
    control did not fire ([]), so the watch proves nothing`. Without the control, both
    drains read clean on a page where nothing could ever be recorded.

  The states, reachable:
  - a year applying but leaving the sheet open, the 0.1.82 behaviour: smoke 6, `year: not
    reached through the sheet -- the year 2019 left the sheet open`, and every state built
    on a year after it.
  - **the same fault with the OLD driver put back,** dismissing the sheet through its
    backdrop and returning `'year'`: **smoke GREEN, 17 checks.** That is the run 0.1.82 to
    0.1.90 had. The driver encoded the workaround, so a user's dead end read as a reached
    state. Recorded because a check that is green on the fault is the measure of what it
    was worth.
  - the month grid gated on a picked month instead of the year: smoke 3, `year: reopened on
    2019 the sheet reads titles ["Year","Month in 2019"], 0 month(s)`, and the month state
    unreachable after it.
  - a fourth state appended to `WHEN_STATES`: 2 unit failures, and smoke 1, `WHEN_STATES
    lists [all, decade, month, year] and this section drives [all, month, year] -- a state
    without a driver is a state nothing walks`, the section stopping at 3 checks.

  The states, escapable:
  - "All shows" left out of the pill row: smoke 12, led by `year: no "All shows" button on
    screen (null) -- a state with no way out`, the same on month and on the two compound
    states that reach it; the rest is the cascade a missing exit leaves, the section unable
    to get back to the landing between states, ending `the section did not end on the
    landing`.
  - the When pill left out: smoke 13, `year: pills [], expected one When pill reading
    "2019"`, and the same cascade.
  - "All shows" clearing When and Filter but not the search: smoke 4, `the search alone:
    "All shows" did not return to the landing: When "All", Filter "Off", search "Spirit",
    ... 5 rows, count "5 shows · matching “Spirit” · newest first"`. The lead read All; the
    rows did not.
  - the Sets pill clearing When instead of its own group: smoke 1, `one pill at a time:
    after the Sets pill, When "All", Filter "1 on", ... pills ["1 set"] ... expected When
    2019 kept, Filter Off`. Every other line passed: each state was still escapable, by
    the wrong pill.

  The paint, a full run because chip paint is not scoped (526s): "All shows" given the
  selected fill by a staged rule: smoke 2, `chip paint (dark): "All shows" is in the
  selected fill rgb(61, 44, 18) -- it is the way out, not a selection`, and light,
  `rgb(249, 225, 186)`.

  The unit tests on `src/util/when.js`: `whenKind` reading a year and a month as the year
  state, 3 failures; `whenLabel` printing the month's number, 1 failure. And one the suite
  found in the build before any proof was staged: the first build emitted `.all-shows`
  with no rule behind it, and `tests/deadcss.test.mjs` failed `EVERY EMITTED CLASS MATCHES
  A RULE` naming it. The chip is a plain `.chip` with `data-pill="all"` now.

  **Dropped, each with its reason:**
  - "All shows" clearing When and the search but not the filters: the same `atLanding`
    comparison as the search fault, a different field left true. The search one ran
    because clearing it is the least obvious of the three.
  - the When pill reading the wrong text: the same exact text comparison the no-pill fault
    shows firing.
  - "All shows" absent in the query-only state alone: the no-"All shows" fault's cascade
    reaches every state, that one included.
  - `replace()` regressing to `replaceChildren`: one line over `clear()` and `append()`,
    both older than this change, with the literal watch as the net under it.

  Restored, by hash the same files: 266 passing, smoke 368 ok with 0 skips and no `WARN`,
  against 347 on 0.1.90. `layout-diff` against 0.1.90 (`7db8bc4`), 390 dark and 390 light:
  9 routes identical, 1600 boxes on `#/shows`, stylesheets 244 rules both sides, the CSS
  change being comment-only. **A pill row renders only in a narrowed state and a sheet
  only while open, so that says the routes at rest did not move and nothing about either;**
  the pill row's figures are in `docs/design.md`, 0.1.91.
- The sweep (2026-11-01, scripts only, no bump). **The dev's decision, closing a call that
  had been open since 2026-10-28:** a verdict never depends on cleanup, and leftovers never
  accumulate. The first half was Code's default when `scripts/cdp.mjs` was written, offered
  as the dev's call and carried in this file at a ruling's weight until it was decided; the
  second half is new. So before `openChrome()` spawns, on every smoke, layout-diff and
  verify-deploy run, `sweepLeftovers()` kills every Chrome whose command line carries a
  `--user-data-dir` under the temp directory with one of `SWEPT_PREFIXES` (`dozen-smoke-`,
  `dozen-layout-`, `dozen-verify-`), removes every such directory, and prints `swept N
  browsers, M profiles` as the run's first line, N the distinct profiles among the processes
  killed. Nothing else: the user's own Chrome never carries such a path, and a file beside
  the profiles is not a profile. It keys on the path and not on `--headless` because the
  helpers that outlast a browser hold its profile and carry the path -- 11 of the 12
  processes on each staged browser below. On Windows the path compares case-insensitively.
  A listing that fails prints a `WARN`, because a sweep that cannot see processes would
  otherwise read `swept 0 browsers` on every run, for good. The end-of-run `WARN` lines stay.
  **Runs are sequential, and the sweep assumes it, with no guard (the dev's call).** Carton's
  60/minute limit already makes them so; a run started beside another would sweep that run's
  Chrome, and the other run would fail loudly on its next CDP call, never silently.
  `tests/hygiene.test.mjs` holds each script's profile prefix to the list, so a renamed or
  fourth prefix fails there instead of escaping the sweep.

  Before any of it, the temp directory was listed and cleared of what earlier scratch probes
  had left -- **79 `dozen-*` directories from 2026-09-02 to 2026-11-01, 267 MB, 75 of them
  empty** -- in one removal naming all 79 literally, directories only; the 18 `dozen-*`
  files beside them, five of them `dozen-smoke-run*.log` from 2026-10-25, stayed. None of
  the 79 carried a script's prefix, so the sweep would never have reached them.

  The proofs, each staged from a scratch Node script by exact string, the staged hash
  confirmed different from the byte copy and the new line read back, the file restored
  from the copy by hash:
  - the dev's: `dozen-smoke-1`, a directory with a file in it, and `notdozen-smoke-1` left in
    temp, then `--only stale-table`: first line `swept 0 browsers, 1 profiles`, `SMOKE
    PASSED`, 13.8s; after it `dozen-smoke-1` gone, `notdozen-smoke-1` and the 18 files
    present, 0 Chromes.
  - processes: a headless Chrome launched by hand on `dozen-verify-7` and one on
    `dozen-probe-7`, a prefix the sweep does not own, 12 processes each -- browser, GPU,
    renderers, utilities and crashpad, every one carrying the path, the launcher having
    quoted the argument -- then `--only stale-table`: `swept 1 browsers, 1 profiles`,
    `SMOKE PASSED`, 12.7s; after it 0 processes on `dozen-verify-7` and its directory gone,
    8 still on `dozen-probe-7` with its directory, and no other `chrome.exe` on the machine.
    The probe was stopped by pid and its directory removed, each on a line of its own.
  - the directory guard, by a direct call of `sweepLeftovers()`, the function `openChrome()`
    calls, with the prefix list staged to `dozen-proofx-` so nothing real was in reach: with
    the guard removed, a `dozen-proofx-1` directory and a `dozen-proofx-1.log` file both
    went, `swept 0 browsers, 2 profiles`; with the guard back, `swept 0 browsers, 1
    profiles` and the file left. That is the line between a profile and the five smoke logs.
  - the hygiene test: `dozen-smoke-` renamed `dozen-smokey-` in `smoke.mjs`, 1 failure,
    `names its profile "dozen-smokey-...", which is not in SWEPT_PREFIXES`.
  - all three scripts print the line: layout-diff `HEAD vs working tree, 390px` read `swept 0
    browsers, 0 profiles` and 9 routes identical, 80 to 1600 boxes, in 35s; verify-deploy
    read it between its two fetch checks and its browser check, `DEPLOY VERIFIED -- live
    BUILD is 0.1.91`, 19s.

  Restored, by hash the same files: 267 passing, smoke 368 ok with 0 skips and no `WARN` in
  529s, its first line `swept 0 browsers, 0 profiles`, and 0 Chromes and 0 profiles after
  it. The `ok` count is 0.1.91's: the sweep line is not a check, so a full run gains one
  line of output and no checks.
- The 0.1.92 checks (song and show page presentation, 2026-11-01): two new scoped sections,
  `song-detail` and `section-heads`, additions to `show-detail`, the badge gating widened, and
  the Home hierarchy line reading the head that now opens the screen. Each scoped proof was
  staged from a scratch Node script by exact string, the staged hash confirmed different from
  the byte copy and the new line read back, the file restored from the copy by hash with
  `git status --short` after it, 25s apart for Carton's limit. Green first: `song-detail` 7
  checks in 18–22s, `section-heads` 25 in 47–50s, `show-detail` 8 in 69s.

  `song-detail`, on Laurel (275) and One Stop Shop (49), both themes:
  - the link put back under the button: smoke 8, `the button is not followed by the stat
    section` and `1 Carton link(s) outside the row, e.g. {"text":"View on The Carton" ...
    "where":"top"}` on each song and theme.
  - a Carton link left on each card: smoke 8, `13 Carton link(s) outside the row ... "where":
    "Jam chart entries"` and `13 of 13 card(s) off the shape ... "links":1`.
  - the edge staged at 3px: smoke 4, `13 of 13 card(s) off the shape ... "edgeW":3`.
  - the head's count off by one: smoke 4, `the head's badge reads "14", 13 card(s)`.
  - the note left in `--ink`: smoke 4, `"noteColor":"rgb(245, 239, 230)","noteDim":false`.

  `section-heads`, every route in both themes, the Shows detail view with a venue query, and
  the three sheets:
  - Home's "Upcoming show" head removed (the addendum's proof): smoke 2, `#/home (dark): the
    first head reads "Previous shows", expected "Upcoming show" over the hero`. The Home
    hierarchy line in the full run reads the same head and was not staged separately: the same
    comparison, on the same node.
  - a hand-built head, `countedHead()` back to a bare `h2.section-title` (the addendum's other
    proof): smoke 4, `#/shows, detail view with a venue query (dark): 1 .section-title outside
    a .section-head: "Venues (1)" in section` and `no .section-head on the screen`.
  - the ink left `--ink-label`: smoke 22, every head on every headed route, `head "Upcoming
    show": rgb(163, 155, 143), not --ink-dim`.
  - the rule removed: smoke 20, every head but the one that opens Home, `rule 0px ... not 1px
    --line; padding-top 0px, not 12px`.
  - one route opted out, the venue page's head hand-built with its rule off: smoke 2,
    `#/venue/73 (dark): head "Every show (13)": rule 0px ...`, and nothing on any other route.

  `show-detail`:
  - the setlist's source link put back under its card: smoke 2, `1 Carton link(s) outside the
    row` and `1 .setlist-source or .gap-chart-source node(s) still on the page`.

  And two that no scoped run could reach:
  - the contrast coverage test on the card edge's `--jam` background went red on the build's
    first `node --test`, `background --jam (.jam-card::before)`, before its exemption was
    written beside the row edge's; it is the one new token-on-a-ground and the row's pair
    measures it.
  - `section-heads` as first written assumed every route carries a head and went red on five
    that render none (Songs, Shows at rest, Jams, Picks, gap history); it holds a route to
    heads or to none by name now, so a route gaining or losing its heads is named either way.
  - the route marker's selector left at `.setlist-source` in `scripts/routes.mjs`, proved
    through `layout-diff` rather than a full run, since all three consumers read the one list:
    `layout-diff failed: working tree: #/show/1728657865 never rendered its marker ("Gap
    chart")`, exit 1 in 30s. **Its first run failed for the wrong reason** -- `Could not load
    the archive Rate limit exceeded`, the two cold boots landing inside the minute after a
    screenshot run -- and was not counted; it was run again after a 70s gap.
  - the badge gating left narrow on song detail, a full run (574s): smoke 4, `jam marking: song
    54 (Shadow) detail (dark): .badge-jam reads "14", not a jam label here`, the same on Buying
    Time and in light, and nothing else.

  **Dropped, each with its reason:** the row's accessible name and the `nav` landmark, the same
  markup the row check reads; the gap history's row, the same `cartonRow()` and the existing
  `the history's Carton link` comparison, which now reads the row; the Home hierarchy line, the
  same first-head comparison as the removed-head proof; the show page's `Gap chart` link
  alone, the same two-link comparison the source-link proof shows firing.

  Restored, by hash the same files: 267 passing, smoke 396 ok with 0 skips and no `WARN` in
  578s, against 368 on 0.1.91: the three sections' 40 lines, the Home hierarchy line reworded,
  and the show-detail line gaining the row. `layout-diff ab577a0`, 390 dark, 390 light and
  360 dark, reads the same three times: `#/home` 76 of 81 boxes, `#/song/49` 303 of 312,
  `#/song/54/gaps` 291 of 298, `#/venue/73` 14 of 28, the charted show 55 of 64; Songs, Shows,
  Jams and Picks identical, having no section heads; stylesheets 244 rules against 248. **The
  dev expected every route to change; the four without a head did not, and that is the
  measure of where the head rule reaches.**
- The 0.1.93 checks (counted heads, Home's heads, the one-liners, the button, 2026-11-02): a new
  scoped section, `home`, which takes over the two Home checks that sat before the sections and
  walks every upcoming show; `section-heads` holding each counted head to its rows; a hygiene
  test; two run-overlap tests. Each proof was staged from a scratch Node script by exact string,
  the staged hash confirmed different and the new text read back before the run, the file restored
  from a byte copy by hash with `git status --short` confirmed, 25s apart. Each is `--only home`
  unless marked. Green: 5 checks in 61s.

  The dev's groupings:
  - the venue's head put back as `sectionHead('Every show (N)')` (`--only section-heads`): 1 unit
    failure, the new hygiene guard; smoke 4, both themes, `head "Every show (13)": a parenthesised
    value in its title` and `no head reading "Every show"`.
  - the badge off by one in `countedHead()` (`--only home,section-heads`): smoke 18, `the head's
    badge reads "3", 2 card(s) listed` on Home at both widths and all ten shows, `"Every
    performance"'s badge reads "136", and the section lists 135 row(s)`, the venue and the Shows
    query the same.
  - the date line fed today, the head and badge left right: smoke 12, `the line under the head
    reads "Nov 2", the anchor's month and day is "Nov 6"`.
  - the expanded-visit branch left reading "Previous shows": smoke 10 on the five shows that expand
    one, `a head that went in 0.1.93 is still rendering` and `the venue page lists 2 show(s) with a
    setlist and the section is headed "Previous shows"`.
  - the one-liners rendered again, the cap back at five: 2 unit failures; smoke 6, `a visit list
    outside a run block, 1 row(s), e.g. "Apr 8, 2022One set"` and `the card's foot opens with null`.
  - the old label on both buttons: smoke 3, `the venue button reads ["Venue history"], not exactly
    "Full venue history"`, on Home and show detail, and `no "Full venue history" button on the hero`.

  Beyond the plan's list, because each is a comparison of its own:
  - the head left "On this date" with a show anchoring it: smoke 12, `the head reads "On this date",
    and a hero on the screen wants "On the date of the show"`. The plan had dropped the head text
    under the grouping; the branch choice came with the dev's change A, after the grouping.
  - the long form, the wording changed in the view and the check together so only the line count
    can see it: smoke 12, `the head runs to 2 line(s)`.
  - the card expanding the oldest visit: 7 unit failures; smoke 3, `the card expands "Fri, Apr 8,
    2022", and the venue page's newest setlist is "Fri, Mar 22, 2024"`.
  - the run list filtered against the uncapped history (`node --test` only): 2 unit failures, among
    them "the first night of a three-night stand renders in the run list".
  - `data-section` removed, through `layout-diff`: `working tree: #/home never rendered its marker
    ("date")`, exit 1 in 28s.
  - the action row stacking, every word right: smoke 2, `the row is on more than one line at 360 ...
    centres 52px apart`, on Home and show detail. The plan had dropped this as the 390 line's
    comparison; that line is older code, and this one had never been seen red.
  - the row overrunning on one line: smoke 2, `the row overruns its box`.

  **The clock.** Today's data reaches two of Home's branches, so the rest were proved on the real
  archive with a scratch clock staged at 2022-06-09 (`Page.addScriptToEvaluateOnNewDocument`), the
  walk cut to three shows and the venue page's rows read as of the hero. It is not in the smoke test.
  The control, nothing wrong in the app: `walked 3 upcoming show(s): 0 expanded a visit, 2 a visit and
  run rows, 1 run rows alone`. Every clocked run also carries two literal "null" lines from show
  1728657865, a 2024 show the clock puts in the future. That is how a real defect was found (below).
  The last two also carry `it stopped after 3 of 435`, from the cut.
  - the run-only branch headed "Earlier at this venue": smoke 2, `no visit, run rows only, and the
    section is headed "Earlier at this venue"`.
  - the foot's head keeping its rule: smoke 2, `the foot's head draws its own 1px rule under the foot's`.
  - the run list not deduped against the expanded visit: smoke 1, `"Jun 11, 2022" is both the expanded
    card and a row beneath it, ["Jun 11, 2022S1+S2+E"]`.
  - the foot drawing no rule: smoke 2, `the foot's own rule is 0px`.

  **Three defects in the walk itself, found by reading its output, and one in the harness:**
  - the once-only line: the first rewrite dropped 0.1.74's "the expanded visit appears once", which
    the first full run could not show, since nothing tested for it. It was found comparing the old
    block with the new after that run, and is the dedupe proof above. The plan's word was "rewritten,
    not shrunk".
  - the section under the hero not a `.section`: as first written, 1 SKIP reading `no hero on Home`
    and `SMOKE PASSED`, exit 0. Fixed: `the hero is not followed by a .section`, exit 1. The old-label
    proof had printed the same untrue SKIP, which is what led here.
  - a walk stopping early read green as "walked 1". Staged after one show: `it stopped after 1 of 10
    upcoming show(s)`.
  - the zero-checks guard, the table row above. Carton staged answering with no rows: `--only home
    executed zero checks`, exit 1; the same with the guard counting the boot's lines again: `SMOKE
    PASSED ... home, 2 checks`, exit 0.

  **Dropped, each with its reason:**
  - the badge count alone under the date fault: the off-by-one above fires its comparison on Home.
  - the same two `countedHead()` faults per head: one function, one comparison, the dev's grouping.

  **Found and not fixed: show 1770761863 prints "null" on its gap chart,** today, on all five rows.
  `docs/design.md`, 0.1.93, has it. It is the literal watch's blind spot as much as the chart's: the
  watch reads what a walk opens, and no walk opens this show.

  **A run lost to a port, not counted.** `lghub_updater` holds `127.0.0.1:9180`, inside the smoke
  test's random DevTools range. One proof drew it: Chrome bound IPv6, `openChrome` read the updater's
  HTML at `/json/list`, and the run stopped on `Unexpected token '<'` with the browser left up. The
  next run read `swept 1 browsers, 1 profiles`. One draw in 400 on this machine, not fixed in 0.1.93; the ports bullet below closes it.

  A full run after the last harness change: 270 passing, smoke 395 ok with 0 skips and no `WARN` in
  613s, against 396 in 578s on 0.1.92: the old block's four lines and the month's two out, `home`'s
  five in. The old walk stopped at the first show with older visits and this one reads all ten, at
  about 4s a show, which accounts for the 35s. A comment in `src/ui/components.js` was corrected
  during that run. `layout-diff 7ca9a8a`, 390 dark, 390 light and 360 dark, reads the same
  three times, and only `scripts/smoke.mjs` and that comment changed after it: `#/home` 46 of 81
  boxes, `#/song/49` 272 of 304, `#/venue/73` 14 of 28, the charted show 2 of 64; Songs, Shows, Jams,
  Picks and gap history identical (`docs/design.md`, 0.1.93, reads what moved).
- The ports (2026-11-02, scripts only, no bump; `docs/plan.md`, "Gap chart, Home between tours,
  and ports", item 3). **The dev's pick, over the free-port probe the plan first proposed:** Chrome
  gets `--remote-debugging-port=0` and `openChrome()` reads the port back from `DevToolsActivePort`
  in its own throwaway profile, and the smoke test's and layout-diff's servers `listen(0)`. No
  script draws from a range now, so there is nothing to probe. `openChrome()` takes no port, waits
  on the file and then on `/json/list` with a 30s ceiling where a fixed 2.5s sleep was, says what
  answered when the port answers with anything but JSON, and on a failed launch kills every process
  on its profile. The comment saying a failed launch leaves nothing running was false, 10 processes
  measured, and is corrected. The smoke test's `CDP:` line prints the port. Each proof staged from a
  scratch Node script by exact string, the staged hash confirmed different and the new text read
  back before the run, the file restored from a byte copy by hash, `git status --short` confirmed:
  - a `DEVPORT` draw and `port: DEVPORT` put back in the smoke test, the dev's: 1 unit failure,
    `scripts/smoke.mjs draws a DevTools port`.
  - `--remote-debugging-port=0` changed to a fixed port in `cdp.mjs`: 1 unit failure, `must let Chrome
    pick its own DevTools port`.
  - `server.listen(8123, ...)` put back, the dev's: 1 unit failure, `scripts/smoke.mjs listens on 8123,
    not on the port the OS assigns`.
  - **The next proof as planned could not reach what it was staged for.** A fixed port, with an HTML
    server holding it on 127.0.0.1, was meant to produce the non-JSON error. On that port Chrome wrote
    no `DevToolsActivePort` at all: `CDP: Chrome wrote no DevToolsActivePort to its profile within
    30s`, exit 1 at 33s. That run is the proof of the ceiling and of the kill instead: `Chrome could
    not be closed over CDP -- its 9 process(es) on this profile were killed`, 0 Chromes after it.
  - the kill removed under that same stage, the dev's: 8 Chromes left on the profile and `the
    throwaway profile was not removed (EPERM)`, exit 1 at 52s. The next run's first line read `swept
    1 browsers, 1 profiles`, and 0 after it.
  - the non-JSON error, re-staged where it can fire: `port ??= readPort()` staged to `port = 39211`
    with the HTML server on it, Chrome on its own port: `CDP: port 39211 answered /json/list with
    text/html, not JSON, so it is not this Chrome`, exit 1 at 3s, 0 Chromes and no `WARN`. On
    0.1.93's launcher this was `Unexpected token '<'` at 27s with 10 left.
  - the real updater, the dev's, no fault staged: `127.0.0.1:9180` read `bind EADDRINUSE / connect
    ANSWERS` before and after, and `--only stale-table` between them read `CDP: 19 calls on port
    59099` and `SMOKE PASSED — SCOPED, not a full run: stale-table, 2 checks`, no `WARN`.

  **Dropped, each with its reason:** a fixed port in layout-diff's server and a draw in verify-deploy,
  the same loop over the same three files as the proofs above; `--only` runs for the two
  hygiene faults, which a unit test reads from the source.

  The other two scripts, on these files: 271 passing; `layout-diff HEAD 390 dark` 9 routes identical,
  stylesheets 248 rules both sides. **`verify-deploy` went red first:** `DEPLOY NOT VERIFIED`, 8 routes
  `did not render live` and only Picks, which reads no archive, rendering. It ran straight after
  layout-diff's two cold boots, inside Carton's minute. The output was kept, and run alone 75s later
  with no change it read `DEPLOY VERIFIED — live BUILD is 0.1.93`, 9 routes live. So layout-diff and
  a deploy check want the same minute's gap as two layout-diffs.
- The between-tours checks (2026-11-02, scripts only, no bump; `docs/plan.md`, "Gap chart, Home between
  tours, and ports", item 2). Between tours the run read 15 failures on a correct app, in 8 blocks,
  and the earliest day that could happen is 2027-01-24. `homeBranch()` decides from the cached archive's
  raw `shows` rows and never from the screen; the checks that read the hero read only on its branch,
  with a SKIP naming each one; a plain chip is named rather than found first; and the Home hierarchy
  check moved into the scoped `home`.
  **Whether the clock belongs in the smoke test: no.** The branch is walked on every run instead, in
  `home` and in `section-heads`, by `withBetweenTours()`: the cached archive staged without its
  future-dated rows, from a copy and back, a reload each way and no request to The Carton, about 4.5s
  each. A clock in the page could not reach The Carton's own answer, and it would date the app's
  `fetchedAt` forward. `--between-tours` is the third way, for the checks outside those two sections:
  Carton's shows table answered without its future-dated rows, to the page and to the script. It is
  **not a push gate**, its verdict says so whichever way it reads, and it fails if the strip did not
  take. It combines with `--only`, and every bad form of `--only` still exits 2 beside it. Each proof
  staged from a scratch Node script by exact string, the staged hash confirmed different and the new
  text read back before the run, the file restored from a byte copy by hash, `git status --short`
  confirmed, 25s apart, `--only home`:
  - the hero forced off on a day with shows: smoke 17, `Home (dark): 0 .hero element(s), expected exactly
    1` and `Home at 360: no hero on the screen, and the archive holds a future-dated show`, exit 1 at 45s.
  - **the same fault, with the branch read off the screen: `SMOKE PASSED`, exit 0 at 19s, 4 checks and 3
    SKIPs, every one `between tours, no hero to read`.** A bug read as a calendar. That is the measure
    of what a check holding "whichever branch renders" would have been worth, and why the brief's
    wording was not built as written.
  - `homeBranch()` forced to between tours on a day with shows: smoke 54, led by `a hero on the screen,
    and the archive holds no future-dated show`.
  - the stage not stripping: smoke 1, `the between-tours stage did not strip: 10 future-dated show(s)
    still in the archive`.
  - the stage's restore removed: smoke 1, `the between-tours stage was not undone: hero false, 795 show
    rows against 805`. The same `fetchedAt` on both sides, because nothing else had moved it.
  - the head reworded on the branch: smoke 2, `the first head reads "Latest show", expected "Most recent
    show"`, and the card, which is found by that head, read as missing.
  - the card reading the oldest show: smoke 1, `the card reads "Sat, Feb 23, 2013", "Toad's Place · New
    Haven, CT", and the archive's newest played show is ["2026-10-23 Spirit of the Suwannee Music Park ·
    Live Oak, FL"]`.
  - `--between-tours` with its strip disabled, `--only home`: smoke 1, `the rehearsal did not strip: 10
    future-dated show(s) reached the archive`, and the verdict `SMOKE FAILED — BETWEEN-TOURS REHEARSAL, not
    the push gate — 1 problem(s) — SCOPED, not a full run: home, 13 checks`.

  Green on the real dates, under a scratch clock on a copy of the test, `--only home,section-heads`, each
  exit 0 with 27 checks and 3 SKIPs: 2027-01-24, the first day there is no show listed, and 2027-06-01.
  Both cards read Sat, Jan 23, 2027, The Mission Ballroom · Denver, CO, with 0 raw titles: the bare card
  that `docs/plan.md` holds open. The full rehearsal on these files: `SMOKE PASSED — BETWEEN-TOURS
  REHEARSAL, not the push gate — all routes rendered`, 0 failures, 377 ok and 7 SKIPs, every one naming
  what went unread. The same run on 0.1.93's test read 15 failures, 375 ok and 2 SKIPs, which is this
  fix's red. Scoped green on the real calendar: `--only home,section-heads`, 39 checks, with the stage
  undone twice.

  **Dropped, each with its reason:** the h1 reworded, the same exact text comparison as the head;
  each hero-only block's gate on its own, one helper, and the rehearsal reads them all; a repeat per
  theme, since the walk reads no colour and `section-heads` reads both.

Do this for every new check. It is the only thing that separates a real check
from a comforting one.

#### How proofs are run, and how many (LOCKED 2026-10-31, the dev's pick)

**The core rule stands: every new check must be seen to fail for its own reason.**
What changes is how proofs are run and how many:

- **Scoped runs.** A proof re-runs only the smoke section its check lives in. The
  full smoke run still happens once, before the push.
- **Scaled to risk.** Full proofs go to checks guarding security (escaping,
  injection), data correctness (matching, decoding, caching, merges), and anything
  that would pass silently on a mistake. Presentation-only checks get one or two
  proofs covering their distinct comparisons. Faults that hit the same comparison
  are not proven twice.
- **A dropped proof is recorded as dropped, with the reason,** beside the proofs
  that ran. Silence would read as coverage.

The test for "the same comparison" is what the fault leaves true. A fault that
leaves the text right and moves the element is not a duplicate of one that changes
the text, however alike the two look on a list.

**Why:** the smoke test grew from about 1 minute to about 6½ minutes per run, so
0.1.86's 25 proofs took 2–3 hours. The proofs still earned their keep: the useless
failure message, the positive control and the tap-target measurement all came out
of that run. It is the cost that changes, not the rule. The sentence above used to
say a proof "costs one minute", which had stopped being true well before anyone
ran 25 of them.

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

- it serves on the port the OS assigns each run (`listen(0)`, since 2026-11-02;
  a draw from `8123 + rand(400)` until then), and service worker scope is
  per-origin *including port*, so there is never a worker registered for that
  origin;
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

**And it is not only checks. A shared helper with an opt-out flag is the same
hole (0.1.67).** `venueLine()` exists so no view can quietly drop venue text
into a metadata style — and 0.1.24 gave it a `small: true` parameter in the
same commit. Seven of eleven call sites passed it, five of them card heads with
a full card width to spend, and venue text was reported as too small twice.
Nothing tied the flag to the condition that justified one, so it spread by
copy-paste to whatever the previous call site did.

The fix is the same as for a curated list: **derive the condition instead of
declaring it.** The step-down belongs to a placement the DOM already states, so
it moved into `.row-main > .venue-line` and the parameter is gone. When a
helper enforces a treatment, ask what a caller can still opt out of — and if
the answer is "the part someone will get wrong", that is not an option, it is
the hole. **A helper some callers can skip is worse than no helper**, because
it is trusted.

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
counts those (`counts.countedNoSetlist`). Any version of this needs a
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

**And the CR fix had to be made a second time (0.1.65).** Moving the probe from
file lengths to the CSSOM quietly reintroduced the fault the 0.1.60 fix had
closed, in a new place. **The CSSOM preserves custom property values verbatim**
— unlike standard declarations, which it re-serialises canonically — so a
multi-line one keeps its line endings. `--font` in `tokens.css` spans two lines,
`git worktree add` honours `core.autocrlf`, and the ref side is CRLF while the
working tree is LF. Byte-identical stylesheets hashed differently on every run.

It was caught by noticing the fingerprints disagreed on a commit that **changed
no CSS at all** — the numbers looked plausible and nothing else about the output
was wrong. Worth generalising: **a fix recorded in this file is not a fix that
survives a rewrite of the thing it fixed.** When a check is reimplemented, its
past bugs are candidates again, and the place to look is the list of them that
already exists.

Fixing the first created a third problem worth recording, because it is the
house pattern again: **the CSSOM drops comments**, so a comment-only CSS edit
produces identical fingerprints while `git diff --name-only` reports a change —
and the guard would have announced that the run "cannot detect anything" on a
run where there was correctly nothing to detect. Two causes, one condition. The
comparison is now against the stylesheets with comments and punctuation spacing
normalised away, so "the rules differ" has one cause.

`.btn-small` was also removed from the probe list: every small button is
`el('button.btn.btn-small')`, so listing both counted each one twice.

**And it could not compare a build that adds a route (0.1.83).** Both sides
walked this checkout's `scripts/routes.mjs`, so the reference build was asked
for `#/song/54/gaps`, rendered "Song not found", and the run aborted on a
missing marker -- a new screen reported as a broken one, with no verdict on the
eight routes that did exist on both sides. The reference side now walks the
reference's own route list, with its own markers; a route on one side only is
reported `NEW` or `REMOVED` and never compared.

**It also makes two full archive pulls per run** — roughly 38 API requests.
Running it repeatedly trips The Carton's documented 60/minute limit, which
surfaces as an error boundary and reads like a harness bug. Wait a minute
between runs.

### The Bash tool on this machine halves backslashes (found 2026-10-25)

**A heredoc or `sed` pattern written through the Bash tool arrives with every
`\\` collapsed to `\`.** Same family as the `core.autocrlf` faults above: a
layer between the text you wrote and the file on disk rewrites bytes, and
nothing in the tool's output says so.

It cost twice in one session, in opposite directions:

- **It corrupted a regex literal.** A heredoc meant to write `/BUILD = (\d+)/`
  into a script lost the escape, so the pattern matched a literal `d` and the
  check it belonged to could never pass. The file looked right in the tool's
  echo; only reading it back showed the missing backslash.
- **It silently failed to stage a red-proof fault.** A `sed` substitution whose
  pattern carried `\(` and `\)` arrived without them, matched nothing, changed
  nothing, and exited 0. The "fault" was never applied, the suite stayed green,
  and the green was about to be recorded as proof the check could go red. The
  sha256 taken afterwards is what showed the file had not moved.

Both are the house failure again: a step that reports success for a reason
other than the one intended, here "the command ran" standing in for "the bytes
landed". The second is the worse of the two because it passes.

**The rule.**

- **Any edit that carries a regex, or any backslash at all, goes through the
  Edit tool**, which writes the string it was given byte for byte. Not a
  heredoc, not `sed -i`, not `printf` — even when the auto-mode instruction
  says to prefer Bash; "Bash cannot do the job" includes "Bash will do a
  different job and say it did this one".
- **Any heredoc that writes a backslash has its result checked before anything
  depends on it** — `grep -c` for the exact escaped sequence, or `sha256sum`
  against the expected bytes. The command's exit status is not that check.
- **A red-proof is not staged until the staged file is read back and differs
  from the byte copy.** The hash comparison the proofs above already use is the
  guard; it was taken after the fact that day and should be taken before the
  suite runs.

### The checks, and when to run each

| Command | Speed | Network | Run it |
|---|---|---|---|
| `node --test` | instant | none | always, before anything else |
| `node scripts/smoke.mjs` | ~10 min (613s at 0.1.93, 578s at 0.1.92, 526s at 0.1.91, 490s at 0.1.90, 404s at 0.1.89, 407s at 0.1.88, 386s at 0.1.87, 380s at 0.1.86, 356s at 0.1.85, so this row's old "~1 min" had gone stale well before 0.1.86) | Carton (cold pull) | **before every push** |
| `node scripts/smoke.mjs --only <section>` | 11–120s (`home` 61s at 0.1.93; `song-detail` 18–22s, `section-heads` 47–50s and `show-detail` 69s at 0.1.92; `nav-states` 29–54s at 0.1.91; `show-detail` 69–118s, `jam-button` ~80s and `jam-notes` ~70s at 0.1.90, with the boot; `jam-notes` reaches each sheet through the Shows tab now) | Carton (cold pull) | for a red proof, re-running only the section the check lives in. **Never the gate for a push:** the full run is. An unknown name or a run of zero checks fails, and the verdict says it was scoped |
| `node scripts/smoke.mjs --between-tours` | about the full run's; combines with `--only` | Carton (cold pull) | when Home or anything on it changes. Carton's shows table is answered without its future-dated rows, to the page and to the script, so every check reads the branch the calendar has not reached yet. **Never the gate for a push,** and its verdict says so. It fails if the strip did not take |
| `node scripts/gap-oracle.mjs` | ~1 min | Carton (cold pull + 20 song pages) | after any change to gap arithmetic, to the show universe in `buildIndex`, or to `gapHistory()`; it compares every Show Gap cell on 20 Carton song pages against the app's own `gapAtShow()`, and the gap history's one-entry-per-show fold (0.1.83) against the same pages grouped by show, and **SKIPs, never passes,** when Carton is unreachable. The smoke test carries a one-song spot check of the same parity |
| `node scripts/contrast.mjs` | instant | none | when eyeballing a colour; the assertions already run in `node --test` |
| `node scripts/deadcss.mjs` | instant | none | when a CSS rule looks inert; lists every declaration the cascade can never let win. The assertions already run in `node --test` (`tests/deadcss.test.mjs`) |
|  `node scripts/layout-diff.mjs [ref] [width] [theme]` | ~25s (24–26s on 2026-10-31; this row said ~3 min) | Carton (two cold boots) | after a deliberate layout change, to see what else moved |
| `node scripts/wait-deploy.mjs` | until the build lands, ~1–3 min | live host | after every push, before `verify-deploy` — polls the served `version.js` for the BUILD integer so the three-place check is not run against a build still in progress. It proves one file at one edge and nothing more |
| `node scripts/verify-deploy.mjs` | ~1 min | live host | **after every push** |

`scripts/make-run-overlap-fixture.mjs` is in that directory and is **not** a check — it regenerates
`tests/fixtures/run-overlap.json`, the real archive rows behind `tests/runoverlap.test.mjs`. Run it
only when the fixture needs rebuilding; it refuses to write one whose lists disagree with the full
archive, so a bad trim fails loudly rather than quietly narrowing what the test covers.

`scripts/routes.mjs` holds the route list and its markers, shared by the smoke
test, the deploy check and the layout diff. Three copies would drift, and the
copy that drifted would be the one checking production.

`scripts/cdp.mjs` launches, drives and closes Chrome for the same three, for
the same reason, and is not a check either. The copies it replaced (2026-10-28)
had drifted exactly that way: one timed its calls out, two never did, and none
closed the browser it started. `tests/hygiene.test.mjs` fails on a script that
launches its own. Since 2026-11-01 it also sweeps what earlier runs left before
it launches -- every Chrome on a `dozen-smoke-`, `dozen-layout-` or
`dozen-verify-` profile under the temp directory, and every such directory --
and prints `swept N browsers, M profiles` as the run's first line; the hygiene
test holds each script's profile prefix to that list. Since 2026-11-02 Chrome
picks its own DevTools port and the two local servers listen on 0, so no script
draws from a range, and the hygiene test fails on a draw or a fixed port. Both
decisions and their proofs are bullets under *The recurring failure*, "The sweep"
and "The ports".

**An archive snapshot for the smoke test was considered and dropped (2026-11-01).**
The smoke test boots the app on a cold pull from The Carton every run, and the
idea was a saved archive it could boot from instead. Two measurements settled
it: a scoped run already boots and finishes in 11–12s (`stale-table`, `markup`),
so the pull is not where the time goes; and ten checks fetch Carton directly to
hold the app to raw rows (`shows`, `setlists`, `venues`, `songs`, `jamcharts`
and one song page), with the `stale-table` section needing a real refresh, so a
snapshot would not take Carton out of a run either. What it would have bought
is runs back to back without the 25s gap for Carton's limit, and that was not
worth a second data path. The header of `src/data/source.js` claimed a snapshot
could be swapped in, with no code behind the claim, and was corrected with this.

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
concluding — but do not dismiss it.** Capture the first run's full output before
re-running, so a second run that disagrees has something to compare against;
a re-run that overwrites the first leaves only the verdict you preferred.
Propagation skew resolves in a minute or
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
and report what it says.** The GitHub CLI is installed on this machine and authenticated:

```sh
gh run list --limit 3          # the Pages build for the push: status, duration, start time
gh run view <id> --log-failed  # when the status is not "success"
```

The run is named `pages build and deployment`. A `completed / success` row whose start time is
after the push, while the three-place check still disagrees, is CDN skew — wait and re-run. No row
for the push, or a failed one, is a real deploy failure. Do not leave a failed deploy unreported —
the live BUILD marker is the only deploy signal the user has; they do not watch the Actions tab
and do not use dev tools.

> **If `gh` is "not recognized", check the PATH before concluding it is absent.** A shell started
> before the install does not see it: on 2026-10-25 it was on the machine PATH at
> `C:\Program Files\GitHub CLI\` and invisible to both shells of the running session. Call it by
> that full path, or open a new shell. "Not on this shell's PATH" and "not installed" are different
> claims, and only the second one is a reason to skip the Actions check.

### What stays the user's

Anything outside the repo: **GitHub settings, DNS, and testing on the phone.**
