# Carton API v2 — observed schema

**Discovered by pulling live data on 2026-08-17**, not copied from the published docs. Everything
here is an *observed* field name and type. Anything the code reads must appear in this file.

Base: `https://thecarton.net/api/v2` — no auth, no key, no token. GET only. Use `.json`.

## Envelope

Every response has three nodes:

```json
{ "error": false, "error_message": "", "data": [ ... ] }
```

> **Correction to the published docs:** `error` is a JSON **boolean** (`false` / presumably `true`),
> **not** the integer `0` / `1` the docs describe. Test it as `if (body.error)`, never `=== 0`.

### How failures actually present (tested 2026-08-17 — corrects the published docs)

The published docs say typos produce empty `data`. **They do not.** Observed behavior:

| Request | Response |
|---|---|
| Valid method, valid column | `application/json`, `error: false`, rows |
| **Unknown method** (`/v2/zzzz.json`) | **`text/html`** — no JSON envelope at all |
| **Unknown column** (`/v2/songs/notacolumn/5.json`) | **`text/html`** — no JSON envelope at all |
| Wrong *case* column (`/v2/songs/SLUG/yuck.json`) | works fine — **column names are case-insensitive** |
| Valid method, genuinely no rows | `application/json`, `error: false`, `data: []` |

Three consequences for the client:

1. **`await res.json()` throws on a bad method or column** — the body is an HTML error page served
   with `http=200`. Report the offending URL; a bare `res.json()` surfaces as a confusing
   `SyntaxError`.
2. **`error: false` + empty `data` genuinely means "no rows"**, not "you typo'd something." That
   makes empty data a weaker signal than the docs imply — but still worth logging with the exact
   URL, because it's how an unpopulated method (see `metadata`) looks.
3. **Content-type cannot be used as the test** — see the `list` method trap below.

Note this makes HTTP status useless as a health check: **everything returns 200**, including error
pages.

### The `list` method serves JSON as `text/html`

`/v2/list/year.json` returns **valid JSON** with `Content-Type: text/html; charset=UTF-8`:

```
/v2/list/year.json        -> text/html   {"error":0,...,"data":[{"field":2013},...]}
/v2/songs.json?limit=1    -> application/json
```

So `text/html` means *either* "this is the `list` method working correctly" *or* "you used a bad
method/column name." **Rejecting on content-type alone breaks `list` entirely.**

**Parse first, then classify:** attempt `JSON.parse` on the body; if it fails, check whether the
text starts with `<!doctype` / `<html` to distinguish a genuine error page from anything else.

`list` also disagrees about the error field: it returns the **integer `0`** where the regular
methods return the **boolean `false`**. Test truthiness (`if (body.error)`), never `=== false` or
`=== 0`.

## Query parameters

| Param | Values | Notes |
|---|---|---|
| `order_by` | any column name | |
| `direction` | `asc` \| `desc` | |
| `limit` | integer | **Required on full-table pulls.** See truncation below. |
| `show_tag` | tag slug | **No show in this dataset has any tag.** See `shows.show_tags`. |

### Row-limit truncation (critical)

`/setlists.json` has a **default limit of 4000** and reports no error when it truncates.

| URL | Rows | Date span |
|---|---|---|
| `/setlists.json` | 4000 | 2013-02-23 .. 2024-10-10 ← **silently truncated** |
| `/setlists.json?limit=5000` | 5000 | 2013-02-23 .. 2025-06-30 ← still truncated |
| `/setlists.json?limit=20000` | **6361** | 2013-02-23 .. 2026-08-14 ← complete |

An explicit `limit` above the row count is honored and returns everything. Verified independently:
summing `/setlists/showyear/YYYY.json` across all 14 years also totals **6361**.

## Data volume (cold-start budget)

| Method | Rows | Approx JSON |
|---|---|---|
| `setlists` (complete) | 6361 | ~5.2 MB |
| `songs` | 366 | ~64 KB |
| `shows` | 804 | — |
| `venues` | 441 | — |
| `jamcharts` | 765 | — |

`setlists` is the only large payload. Everything else is trivial.

---

# Methods

## `setlists` — 41 fields

The core table. One row per song performance. `/v2/setlists/showyear/2013.json?order_by=showdate`

| Field | Type | Example / notes |
|---|---|---|
| `uniqueid` | string | `"2550"` — string, not number |
| `show_id` | number | `1633187309` — join key to `shows`, `links`, `uploads` |
| `showdate` | string | `"2013-02-23"` — ISO, sortable lexically |
| `showtime` | null | always null in observed data |
| `showtitle` | string | usually `""` |
| `artist` | string | `"Eggy"` |
| `song_id` | number | `71` — join key to `songs.id` |
| `songname` | string | `"Yuck!"` |
| `artist_id` | number | `1` |
| `permalink` | string | `"eggy-february-23-2013-toads-place-new-haven-ct-usa.html"` — deep-link back to Carton |
| `settype` | string | **`"Set"` or `"One Set"`** — only two values |
| `setnumber` | string | **`"1"`, `"2"`, `"3"`, `"e"`, `"e2"`** — string, not number; `e` = encore |
| `position` | number | 1-based position **within the set** |
| `tracktime` | string \| null | often `""` |
| `transition_id` | number | 1–6, see transitions below |
| `transition` | string | the literal separator text |
| `footnote` | string | single legacy footnote, always present, `""` when none |
| `footnotes` | string \| null | **a JSON-encoded string**, e.g. `"[\"Debut, no lyrics\"]"`, or `null` |
| `isjamchart` | number | 0 \| 1 |
| `jamchart_notes` | string \| null | |
| `venue_id` | number | join key to `venues` |
| `shownotes` | string | show-level note, repeated on every row of the show |
| `showyear` | number | |
| `showorder` | number | ordering **within a date** (multiple shows per day) |
| `opener` | string | usually `""` |
| `tour_id` / `tourname` | number / string | `"Not Part of a Tour"` is the common value |
| `soundcheck` | string | |
| `isverified` | number | 0 \| 1 |
| `slug` | string | song slug, e.g. `"yuck"` — **or the sentinel `"_custom_"`, see below** |
| `isoriginal` | number | **1 = Eggy original, 0 = cover** |
| `original_artist` | string | `""` when `isoriginal = 1`; the covered artist when `0` |
| `venuename` | string | **raw here** (`"Toad's Place"`), entity-encoded in `shows` |
| `city` / `state` / `country` | string | |
| `timezone` | null | |
| `isreprise` | number | 0 \| 1 |
| `isjam` | number | 0 \| 1 |
| `css_class` | null | |
| `isrecommended` | null | |

### Set membership and position

Set structure is `settype` + `setnumber` + `position`:

- `settype` is only ever `"Set"` or `"One Set"`.
- `setnumber` is a **string**: `"1"`, `"2"`, `"3"`, `"e"` (encore), `"e2"` (second encore).
  Never sort it numerically.
- `position` restarts at 1 in each set.

Observed `settype` × `setnumber` combinations across all 6361 rows:

```
One Set / 1     1486      Set / 1     3031
One Set / 2        7      Set / 2     1300
One Set / e      136      Set / 3       25
                          Set / e      375
                          Set / e2       1
```

Show structures across the archive — **nine distinct shapes across all 610
shows with setlists**, measured 2026-08-27. Listed as the app renders them,
which splits the one-set shows that have an encore from the ones that do not;
an earlier version of this table lumped both into a single `ONESET 174` row.

```
Set 1                             192 shows   (single numbered set recorded)
Set 1 + Set 2 + Encore            174 shows   (the standard two-set-plus-encore show)
One Set                           100 shows
One Set + Encore                   74 shows
Set 1 + Encore                     47 shows
Set 1 + Set 2                      17 shows   (two sets, no encore)
Set 1 + Set 2 + Set 3               4 shows
Set 1 + Encore + Encore 2           1 show
Set 1 + Set 2 + Set 3 + Encore      1 show
```

**Set 3 and Encore 2 both exist**, in 25 rows and 1 row respectively. Anything
mapping set structures has to handle them, and the four shapes below the fold
here are the ones easily missed by reasoning from the common cases.

### `slug == "_custom_"` marks a row that is NOT a song

Three rows in the archive carry `slug = "_custom_"` — how The Carton records
banter, announcements and other free-text setlist items:

| showdate | `songname` | venue |
|---|---|---|
| 2022-03-17 | `Why Should I Worry` | Mercury Lounge |
| 2022-11-05 | `NYE Announcement` | The Foundry |
| 2023-12-07 | `Hanukkah Banter` | Rockefellers |

**All three carry `song_id = 1`, which does not exist in `songs`.** They are the
only rows in the 6361-row archive whose `song_id` is absent from the songs
table. Anything joining on `song_id` merges all three into one entity — which
is where a catalogue count of 367 comes from against a `songs` endpoint that
returns 366.

**Filter on the slug, not the id.** The slug is the field that says what the row
is; the id is only where those rows happen to point. Verified against live data
that the two predicates select exactly the same three rows, so the semantic one
is the one that survives Carton renumbering anything. See `isCustomEntry()` in
`src/data/index.js`.

### Transitions — preserve these exactly

`>` and `->` are **different** and must never be normalized together.

| `transition_id` | `transition` | Meaning |
|---|---|---|
| 1 | `", "` | plain separator |
| 2 | `" > "` | segue |
| 3 | `"->"` | segue (tighter) |
| 4, 5, 6 | `"  "` | **end-of-set markers** |

Confirmed by position: ids 4/5/6 appear *only* as the last song of a set (209 / 324 / 556 times),
and never mid-set. Ids 1/2/3 appear mid-set (2891 / 1362 / 998). `transition_id: 1` also appears
last-in-set 21 times, a data quirk — treat "is last in set" as positional, not as a transition id.

### Footnotes

- `footnote` — plain string, `""` when absent. Always present.
- `footnotes` — a **JSON-encoded string** that must be `JSON.parse`d, or `null`. In `setlists` it
  appears as `"[\"Debut, no lyrics\"]"`; in `latest` it can be `null`.
- **No row in the entire archive has more than one footnote.** Handle the array shape anyway.

Footnote text carries LTP/gap facts as prose, matching Carton's own display:

```
2022-12-11 Illuminate: "LTP 3/7/2021 (111 show gap)"
2023-05-07 Elmira:     "Dedicated to Jake, LTP 2/6/22"
2023-05-07 No Rain:    "Blind Melon cover, with Rasta Waldo jam, LTP 11/09/21"
```

Date formats inside footnotes are inconsistent (`3/7/2021`, `2/6/22`, `11/09/21`). Render footnote
text as-is; do not parse dates out of it.

## `latest` — 36 fields

Same shape as `setlists` minus `showtime`, `tracktime`, `timezone`, `css_class`, `isrecommended`.
Returns the most recent show. `/v2/latest.json?order_by=position&direction=asc`

## `shows` — 25 fields

One row per show, including **future shows**. `/v2/shows.json?order_by=showdate&direction=desc`

| Field | Type | Notes |
|---|---|---|
| `show_id` | number | |
| `showdate` | string | `"2026-12-05"` |
| `showtime` | null | |
| `permalink` | string | Carton deep link |
| `artist_id` / `artist` | number / string | |
| `showtitle` | string | |
| `venue_id` | number | |
| `venuename` | string | **HTML-entity-encoded here**: `"Annabel&#039;s"` |
| `location` | string | `"Toronto, ON, Canada"` — also entity-encoded. **`shows` ONLY, and the UI does not use it** — see below |
| `city` / `state` / `country` | string | |
| `timezone` | null | |
| `tour_id` / `tourname` | number / string | |
| `showorder` | number | |
| `show_year` | number | **`show_year`**, not `showyear` as in `setlists` |
| `show_day` | number | day of month |
| `show_dayname` | string | `"Saturday"` |
| `show_month` | number | |
| `show_monthname` | string | `"December"` |
| `updated_at` / `created_at` | string | `"2026-08-10 15:02:19"` |
| `show_tags` | array | **`[]` on all 804 shows** |

> **`show_year` vs `showyear`** — `shows` uses `show_year`; `setlists` uses `showyear`. A typo here
> returns empty data rather than an error.

### `location` is a `shows`-only field, and the UI ignores it (measured 2026-08-27)

`location` appears on `shows` and on **none** of `setlists`, `jamcharts` or `venues`, all of which
carry `city` / `state` / `country` instead. Verified by request against each endpoint.

That asymmetry is a trap for anything rendering a venue, because the same venue then reads
differently depending on which table the row came from. `venueLine()` preferred `location` and
rendered `Syracuse, NY, USA` on Home while rendering `Syracuse, NY` on song detail.

**Preferring it buys nothing.** Across all 804 shows, `location` is byte-identical to
`[city, state, country].join(', ')` on **798**. On the remaining **6** — the Atlantic Ocean cruise
shows, which have a city and no state or country — it is strictly worse: `"Atlantic Ocean, "`, with
a trailing comma and nothing after it.

So `src/ui/components.js` builds the place string from `city` / `state` / `country` for every
record type and never reads `location`. It is still decoded at ingest in `src/data/index.js`, which
costs nothing and keeps the row shape honest.

### Show tags do not exist in this dataset

All 804 shows have `show_tags: []`. The documented `?show_tag=` filter has nothing to filter on.
**Festival and one-set shows cannot be identified by tag.**

### Upcoming shows carry no setlist and no format

As of 2026-08-17 there are **18 future-dated shows**, and **0 setlist rows exist for any future
date**. `show_tags` is empty and `tourname` is `"Not Part of a Tour"`.

**Carton does not know the format of an upcoming show.** Set structure must not be presented as
known for a future show — it can only be shown as history (what this venue has done before, what
the recent run has looked like). Anything else would be a prediction.

## `songs` — 7 fields

`/v2/songs.json` — 366 rows.

| Field | Type | Example |
|---|---|---|
| `id` | number | `2` (joins to `setlists.song_id`) |
| `name` | string | `"12 Pounds of Pain"` |
| `slug` | string | `"12-pounds-of-pain"` |
| `isoriginal` | number | 1 = original, 0 = cover |
| `original_artist` | string | `"Eggy"` for originals |
| `created_at` / `updated_at` | string | |

> **`songs` carries no play statistics at all.** No `times_played`, no `first_played`, no
> `last_played`, no `gap`. Nothing matching `/gap|count|played|times|last|first/` exists on any
> `setlists` field either.
>
> **Gap, times played, and first/last played must be computed** by grouping the complete `setlists`
> pull against show ordering (`showdate`, then `showorder`). This is counting and grouping — inside
> the scope rule, and the same facts Carton shows on its own gap charts.

Note `isoriginal` disagrees between methods for some songs: `songs` reports `"Eggy"` as
`original_artist` for originals, while `setlists` uses `""`. Trust `isoriginal`, not the string.

## `venues` — 8 fields

| Field | Type | Example |
|---|---|---|
| `venue_id` | number | `1` |
| `venuename` | string | `"The Peach Music Festival"` |
| `city` / `state` / `country` | string | |
| `zip` | string | often `""` |
| `capacity` | number | often `0` — mostly unpopulated, do not rely on it |
| `slug` | string | `"the-peach-music-festival-scranton-pa-usa"` |

## `jamcharts` — 21 fields

765 rows. `uniqueid`, `setnumber`, `position`, `footnote`, `tracktime`, **`jamchartnote`**,
`song_id`, `isrecommended`, **`showid`** (no underscore), `songname`, `song_slug`, `showdate`,
`artist_id`, `artist`, `artist_slug`, `venuename`, `venue_slug`, `city`, `state`, `country`,
`permalink`.

> Two naming traps: the note field is **`jamchartnote`** (one word) here, but `jamchart_notes` in
> `setlists`. The show key is **`showid`**, not `show_id`.

### Joining `jamcharts` to `setlists` (measured 2026-08-21)

`setlists.isjamchart` and the `jamcharts` table are **two views of the same fact and they agree
exactly.** Verified in both directions, so neither is treated as authoritative over the other:

| Check | Result |
|---|---|
| Unique `(show, song)` pairs with `setlists.isjamchart = 1` | **779** |
| Unique `(show, song)` pairs in `jamcharts` | **779** |
| Flagged in `setlists` but **no** `jamcharts` row | **0** |
| In `jamcharts` but **not** flagged in `setlists` | **0** |

**The join key is `showid` + `song_id` + `setnumber` + `position`.** All 792 jamcharts rows match a
setlist row on it, with zero misses.

- **`position` is required, not optional.** 792 rows cover only 779 unique `(show, song)` pairs
  because **13 songs are jam-charted twice in the same night**. Keying on song alone silently
  collapses those pairs into one entry.
- **`settype` is correctly absent from the key.** `jamcharts` has no such field and does not need
  one: the four-part tuple is unique across all 6361 setlist rows (zero collisions), and **no show
  mixes `"One Set"` with `"Set"`**, so settype carries no disambiguating information here.
- `setnumber` is a string on both sides and is case-folded before comparison, so `"E"` and `"e"`
  cannot split an encore in two.

Because the flag lives on the setlist row itself, **highlighting a jam entry inside a setlist needs
no join at all** — only the per-show entry list does.

## `albums` — 16 fields

One row per **track**, not per album. `album_title`, `album_displayname`, `artist`, `artist_id`,
`album_url`, `releasedate`, `album_notes`, `song_name`, `song_url`, `original_artist`, `position`,
`islive`, `tracktime`, `disc_number`, `track_updated_at`, `album_updated_at`.

Note `song_name` here vs `songname` in `setlists` vs `name` in `songs`. Three spellings.

## `links` — 5 fields

`link_id`, `show_id`, `description` (`"Listen Now"`), `url`, `updated_at`.

## `uploads` — 8 fields

`id`, `show_id` (**string** here, number elsewhere), `showdate`, **`URL`** (uppercase),
`img_name`, `upload_type` (`"poster-art"`), `attribution`, `created_at`.

## `appearances` — 9 fields

`show_id`, `showdate`, `artist_id`, `artist_name`, `person_id`, `personname`, `slug`,
`appearance_type` (`"Guitar"`), `notes`. Guest sit-ins.

## `metadata` — real method, zero rows in this instance

`/api/docs` describes it as *"display setlist metadata."* It is a genuine, correctly-routed method
that this Carton instance does not populate. **This was confirmed by control test, not assumed.**

```
/v2/metadata.json                     -> application/json  error:false  0 rows
/v2/metadata.json?limit=20000         -> application/json  error:false  0 rows
/v2/metadata/1.json                   -> application/json  error:false  0 rows
/v2/metadata/show_id/1633187309.json  -> application/json  error:false  0 rows
/v2/metadata/showdate/2013-02-23.json -> application/json  error:false  0 rows
/v2/metadata/song_id/71.json          -> application/json  error:false  0 rows
```

The discriminator: an unknown method returns **`text/html`** with no JSON envelope
(`/v2/metadatas.json`, `/v2/zzzz.json` both do). `metadata` returns a proper JSON envelope, so the
router recognizes it — the table behind it is simply empty. A misspelling would not have produced
`error: false` and a `data` array.

**Verdict: not a wrong column name. Nothing to build on, and nothing being missed.** The index does
not depend on it. If it ever gets populated, it would appear as a non-empty `data` array with no
code change needed to detect it.

## `list` — enumeration helper

`/v2/list/[city|state|country|venue|day|month|year].json`, optional `?artist=1&showyear=YYYY`.

Returns a flat array of `{ "field": value }` — the key is literally `field`.

```json
[ { "field": 2013 }, { "field": 2014 } ]
```

`list/year` returns 2013–2026. Useful for building filter UI without pulling whole tables, and for
driving the per-year setlist pull that verifies the full-archive row count.

---

## Cross-method naming inconsistencies (collected)

| Concept | `setlists` | `shows` | `songs` | `jamcharts` | `albums` |
|---|---|---|---|---|---|
| song name | `songname` | — | `name` | `songname` | `song_name` |
| show key | `show_id` | `show_id` | — | **`showid`** | — |
| year | `showyear` | **`show_year`** | — | — | — |
| jam note | `jamchart_notes` | — | — | **`jamchartnote`** | — |
| song key | `song_id` | — | **`id`** | `song_id` | — |

`uploads.show_id` is a **string** while `setlists.show_id` is a **number** — coerce before
comparing.

## HTML entity encoding

Inconsistent by method. `shows` encodes (`Annabel&#039;s`, `Telluride Blues &amp; Brews Festival`);
`setlists` and `latest` do not (`Toad's Place`). Decode once at the data-source boundary.

## Non-JSON endpoints

`https://thecarton.net/api/embed/{show_id|YYYYmmdd|YYYY-mm-dd}.html?headless=1` returns rendered
setlist HTML. **Not fetchable cross-origin** (no ACAO). Usable only via `<iframe>` or a link-out.
Do not build on it.
