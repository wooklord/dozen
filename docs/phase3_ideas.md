# Phase 3 ideas — parked, deliberately not built

Anything here crosses the hard scope rule in [`CLAUDE.md`](../CLAUDE.md). It is recorded so the
idea isn't lost and so the reasoning doesn't get re-litigated every session. **Nothing in this file
gets implemented in phase 1.**

The line, restated: *if The Carton displays the fact on one of its own pages, we may compute and
display it. Any statistic Carton never shows is out.* Sorting by gap descending is fine. Calling
that list "most likely bustouts" is not.

## Parked

### Play-likelihood scoring
Any model assigning a song a probability or score for an upcoming show. Includes the soft versions:
"due", "overdue", "hot", "cold streak", "trending", a flame icon, or a 0–100 number. **This is the
single most tempting line to cross** — the sorted gap list already gives the player what they need,
and labeling it turns repackaging into prediction.

### Tour-position or venue-conditioned rates
"At festivals, X gets played 40% of the time." "Second night of a two-night run tends toward Y."
Carton shows neither. Conditional rates are inference dressed as counting.

### Set-structure inference for upcoming shows
Guessing whether an upcoming show is one set or two from venue history or festival naming. Carton
has no format data for future shows (`show_tags` is empty on all 804 shows; future shows have zero
setlist rows). Showing venue *history* is fine and is in the plan; asserting a *format* is not.

### Rotation-velocity metrics
"Played 3 of the last 5 shows" is a count and is arguably fine. Deriving a velocity, momentum, or
acceleration figure from it is not — that's a model.

### Pick optimization
Ranking a shortlist, suggesting swaps, estimating expected points, or anything that treats the
fantasy game's scoring as an input. The scratchpad orders what the *user* chooses, and nothing else.

### External data
Setlist.fm cross-referencing, streaming/Spotify data, social media, weather, ticket sales, other
jam-band archives. Phase 1 is `thecarton.net` and nothing else.

### Community features
Shared picks, leaderboards, comments, accounts. Requires a backend and leaves the read-only,
anonymous, no-database constraint entirely.

## Possibly allowed, needs a ruling before building

These are plausibly inside the line — they're counting — but they lean predictive in *presentation*,
so they need an explicit decision first.

- **"Never played at this venue"** — a set difference over Carton's own data. Factual, but the only
  reason to look at it is prediction. Probably fine if labeled purely as history.
- **Debut-by-year distribution** — explicitly listed as allowed in the scope rule. Safe; just not a
  priority-1 view.
- **"Songs not played in the last N shows"** — identical data to the gap list, different framing.
  Fine as long as the framing stays retrospective.

The deciding test each time is the label, not the query: **describes what has happened → ships;
implies what will happen → doesn't.**
