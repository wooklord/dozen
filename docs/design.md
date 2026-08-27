# The Dozen — design direction

One deliberate direction, documented, rather than defaulting to generic component styling.
**Legible dense data first, charm second.**

## The governing idea

This is a table-reading app used one-handed, in the dark, in a loud room, possibly on bad wifi,
by someone deciding between songs in the next few minutes. Every design decision answers to that.

The egg/carton language earns its place in the **shell** — the frame, the loading state, the
empty states. It never touches the data itself. **No egg illustrations, no puns in UI chrome.**
A song row is a song row.

## Color

**Dark by default**, because the app gets used in venues. Not blue-black — a **warm** near-black,
closer to cardboard in shadow than to a terminal. The warmth is the whole carton reference; it does
the work that an illustration would otherwise do.

```
--shell        #14110E   page ground, warm near-black
--surface      #1C1815   cards, rows
--surface-up   #262019   raised / pressed
--line         #332C25   hairlines
--ink          #F5EFE6   primary text, warm white
--ink-dim      #bcb2a3   secondary text
--ink-faint    #918779   tertiary, timestamps
--yolk         #F5A623   THE accent
--yolk-deep    #C77F14   pressed
--yolk-wash    rgba(245,166,35,.12)   selected row fill
```

`src/styles/tokens.css` is the source of truth and this block is a copy of it, so
`tests/design-doc.test.mjs` fails if the two disagree. It caught this block quoting `--ink-dim`
as `#A99F92` and `--ink-faint` as `#6E655B` long after the tokens moved: the documented
`--ink-faint` measured **3.29:1**, below the 4.5:1 floor that *this same document* declares that
token is sitting on. A stale palette reads exactly like a current one.

**One accent, and it is load-bearing.** Yolk marks only:

1. gap magnitude on the heat scale,
2. the active sort or filter,
3. scratchpad membership.

Nothing else is yolk. No yolk buttons for ordinary actions, no yolk headings. The moment a second
accent appears, the first stops meaning anything — the reason a scanned column works is that the
eye has exactly one thing to find.

Gap magnitude uses **opacity of a single hue**, not a rainbow scale. A multi-hue heatmap would
imply thresholds the data doesn't have, and thresholds edge toward prediction.

The heat bar's minimum opacity is a **per-theme token** (`--heat-floor`), not a constant. The dark
accent is far lighter than its ground, so a low opacity still registers; the same value on white
disappears. A decoration present in one theme and absent in the other is an inconsistency the user
feels without being able to name it. A genuinely absent value still renders no bar at all — the
floor must not invent one.

### The jam highlight is a second colour, and not a second accent (0.1.40)

Jam chart entries render green inside the setlist. This is the one place a colour other than yolk
carries meaning, so the reasoning is on the record.

**It is Carton's signal, not a new one.** Their own stylesheet marks these entries green:

```css
.setlist-songbox .jamchart { color: #75eb00; padding: 2px }
```

Carrying that across keeps the two sites saying the same thing about the same fact. Their neon
`#75eb00` was not reused directly: it measures 11.45:1 on our card but **1.54:1 on white**, so like
yolk the two themes take different hexes.

```
--dk-jam   #8ACE98     9.54:1 surface / 10.18:1 shell / 8.72:1 pressed
--lt-jam   #376841     6.52:1 surface /  6.06:1 shell / 5.55:1 pressed
```

Setlist text is 15px regular, so the **4.5:1 normal-text threshold** applies and both clear it on
every ground they can land on. Both sit just above yolk (8.70 / 5.69) rather than below it: this
recolours body text that gets *read*, not a small accent glyph, so it needs at least yolk's
legibility — and no more, or it would out-shout the accent.

#### Four hues were rendered in place before choosing

Not swatched — put into a real setlist, in both themes, and compared on screen.

| | Hue | b\* dark / light | Verdict |
|---|---|---|---|
| Chartreuse (Carton's own) | 90 | 47.9 / 42.0 | **Rejected.** In light it resolves to an olive that reads as a second *warm* accent beside the yolk set labels — the one thing this must not do. |
| Leaf green | 120 | 31.8 / 27.0 | **Rejected.** Legible, cleared every check, simply not liked. |
| Sage | 150 | 12.7 / 12.2 | **Rejected.** Measurably the coolest thing on screen, and picked up a mint cast in dark. |
| **Warm sage** | **132** | **20.2 / 17.0** | **Chosen.** Sage pulled back toward yolk far enough to lose the mint cast, without approaching the chartreuse's olive failure. |

**Why this does not break the one-accent rule.** Yolk answers "there is more to read here" — set
labels, footnote markers, gap magnitude. Green answers "The Carton charted this jam". Different
questions, different hue family, so the two share a block without either getting louder. What
*would* break the rule is a warm second colour, which is exactly what the chartreuse turned out
to be.

#### The light theme uses WEIGHT as a second channel, and why the numbers could not decide it (0.1.56)

Jam titles render at weight 600 in the **light** theme only. Dark is unchanged:
colour alone, weight inherited from the surrounding setlist text.

**The reason is a gamut limit, not a tuning failure.** In light mode the green
must clear 4.5:1 against white, which forces it dark — the ceiling is L\* ≈ 50
at exactly 4.5:1. sRGB has no vivid green that is also that dark. The most
chromatic candidate that clears the threshold reached **C\* 48.7, the gamut
ceiling at that lightness**, and still read as tinted black beside the body
text. Rendered in a real setlist, not swatched. Colour-only has a ceiling and
that candidate was standing on it.

**THE NEGATIVE RESULT, recorded so it is not re-derived.** The obvious
diagnosis — "the light green sits too close in lightness to the near-black body
text" — is measurably **wrong**:

```
                      dark            light
ΔL* vs body text      17.5            30.6     light has MORE
Δchroma               33.2            26.0     dark has more
ΔE76 vs body text     40.3            42.7     light "better"
ΔE00 vs body text     25.27           31.36    light "better"
```

Light mode has the **larger** lightness separation. CIEDE2000 was implemented
and validated against Sharma, Wu & Dalal (2005) specifically to test whether
CIE76 was overstating the difference between two dark colours — the one
mechanism that would have flipped the ordering. **It did not.** ΔE00 agrees with
ΔE76 that light separates more.

So no standard colour-difference metric reproduces what the screen shows. The
only number that moves the right way is chroma, and the working hypothesis —
offered as hypothesis — is adaptation: against a bright neutral both colours
read as "dark marks", while against near-black the green is among the brightest
things present and its chroma reads fully.

**The consequence for method: b\* could arbitrate the warmth question, and
nothing could arbitrate this one.** The renders decided it, with the numbers as
guardrails. Do not go looking for a metric to justify a different answer; that
search has already been done and came back empty.

**The accepted cost.** Bold glyphs are wider, so light-mode setlists reflow
slightly. Measured at 390px against 0.1.55: 7 boxes on Home, 81 on Shows, all of
them `.setlist-song`, **width only** — heights unchanged, y positions holding,
no non-setlist screen touched. Songs, Jams, Picks, song detail and venue detail
are byte-identical.

**One caveat, real and accepted: with enough jam entries on a line, a wrap point
can move.** The sampled boxes showed no vertical change, but a long enough run
of highlighted titles will re-wrap. That is inherent to any weight-based
option — there is no version of "use weight" that does not change glyph widths —
and it is the accepted cost of the separation.

#### Warmth is a measured axis here, not a vibe

On the Lab **b\*** axis (yellow positive, blue negative) every token in this palette is warm:

```
shell  1.9    ink  5.0    yolk  71.9        (dark)
shell  3.8    ink  4.9    yolk  50.3        (light)
```

That is the number the last two rounds of this decision turned on. Sage at b\* 12.7 was the least
warm thing on screen against a palette where everything leans yellow; the chartreuse at 47.9 was
warm enough to compete with yolk outright. **Hold b\* inside roughly 15–24 if this is ever
retuned** — that band is what keeps the colour reading as a green rather than as a second yellow.

Hue alone is not sufficient to state the constraint: the chartreuse failed at hue 90 *with
saturation 71*, while the chosen value is hue 132 at saturation 41. Both hue and chroma move b\*.

**Candidates must be contrast-matched before comparing.** The chosen dark value was fitted to
sage's exact contrast triple (9.54 / 10.18 / 8.72) so the two could be judged on hue alone.
Changing warmth and loudness together makes a side-by-side unjudgeable, and that is how a colour
gets picked for the wrong reason.

**Colour only, and only on the song title.** Same text, same size, same weight, same place. Inside
flowing setlist text any box, weight or size change reflows the line and breaks the setlist's
rhythm. The one accompanying change is the press underline, which follows `currentColor` on jam
entries so a green word does not flash an orange underline.

**The redundancy for colour-blind readers is structural, not typographic.** Every jam-highlighted
song on a show page has a matching card in the "Jam chart entries" section directly below, in the
same order, so the fact is never carried by hue alone.

### The selected chip: a FILL is a channel that inline text does not have (0.1.59)

Light mode failed the yolk accent on sort/filter chips the same way it failed the jam green. That
made it structural rather than incidental, so it was measured rather than diagnosed by eye.

**The obvious diagnosis was wrong again, in exactly the same way.** "A dark warm brown sits close
in lightness to near-black body text" is measurably false:

```
                      dark            light
ΔL*  yolk vs --ink    20.6            34.3     light has MORE
ΔC*                   69.4            48.7     dark has more
ΔE00                  28.49           33.04    light "better"
```

Light mode has **1.7× the lightness separation** and the larger ΔE00. This is the second time that
prediction has come back inverted — see the jam-green section above — and the second time **chroma
is the only axis that moves the way the screen does**. Do not go looking for a metric that says
otherwise; that search has now been run twice and come back empty both times.

**What IS structurally different: the fill changed sign between themes.** One shared `--yolk-wash`
alpha, opposite meanings:

```
                                     dark    light
unselected fill, signed ΔL* vs bar   +3.4    +3.0
SELECTED fill,   signed ΔL* vs bar   +9.4    -5.3
selected vs unselected, signed ΔL*   +6.1    -8.3
```

In dark the selected chip is the brightest thing in the sortbar. In light the identical token sent
it *toward* the bar ground while the unselected white chip lifted away from it — so the selected
state read as **less** of a control than its unselected neighbour. That is the "monotone" reading,
and it is a fill problem, not a text-colour problem.

**The lever chips have and inline text does not.** A fill clears no text threshold, so it is not
bound by `--lt-yolk`'s 5.69:1 requirement and can use the *vivid* `#f5a623` pigment. Dark ink on a
light saturated amber measures **13.71:1 at C\* 22.2**, and still 12.5:1 at C\* 32.8. The sRGB
gamut ceiling that trapped the green — vivid *and* dark enough, pick one — simply does not apply
when the colour is allowed to be light. **This is the general lesson: before accepting a gamut
limit, check whether the element has a channel the failing one lacked.**

**What the fill cannot do is carry the boundary.** Selected-vs-unselected fill tops out at 1.48:1
even at α .50, because both are light. So the border had to go opaque — which is also the fix for
the `.chip[aria-pressed="true"]` entry that sat in `KNOWN_GAPS` at 2.14:1 dark / 1.53:1 light. Same
region, same root cause, one change. Fixing either alone would have moved the problem.

**Shipped:** opaque fill (`#3d2c12` dark, `#f9e1ba` light), opaque `--yolk-deep` border, label
`--yolk` in dark and `--ink` in light. Three dedicated `--*-chip-sel-*` tokens rather than reusing
`--yolk-wash` / `--yolk-line`, which are also worn by `.row-shell[data-picked]` and `.badge-jam`.

**The fill is opaque on purpose.** `.sortbar` is sticky with `backdrop-filter: blur(12px)`, so a
translucent fill composites whatever is scrolling underneath and any audited figure would be true
only at scroll position zero. The unselected chip has always been opaque, so this is also the
symmetric choice.

**Light diverges in structure, not just in hex.** Yolk on the new light fill measures **4.47:1** —
it fails 4.5 by 0.03, at the ceiling, not by mistuning. Dark is at 6.61:1 and keeps its yolk label.
This is the same per-theme divergence the jam weight token established.

**WEIGHT was rendered and rejected here**, unlike for the green. It widened the tapped chip by up
to 6.2px inside a horizontally-scrolling bar — the reflow happens *under the thumb, in response to
the tap*. A solid-fill variant was also rendered and rejected as too loud: `#945906` at full
strength reads chocolate rather than yolk and outweighs the content below it.

> **One half of that reason has been withdrawn (0.1.61).** This passage used to continue "and
> `.chip-quiet`'s 500 made the jump larger on the filter row than the sort row." That never
> happened. `.chip-quiet` was a dead rule — `.chip` re-declared `font-weight` later at equal
> specificity — so both rows were rendering at 600 and the comparison was between two identical
> weights. It is recorded as withdrawn rather than silently reworded, because it was offered as
> measurement. The 6.2px widening was real and the decision stands on it alone.
>
> This is the clearest case in the repo for why a stale record is worse than a missing one: a
> false line in a design document produced a real design decision, and read with exactly the same
> authority as the true line beside it.

**Now asserted, not merely measured.** Four pairs entered `PAIRS` (label on fill, border vs fill,
border vs bar ground, border vs neighbouring chip fill) and the `KNOWN_GAPS` entry was deleted. The
old design failed on exactly the pair nobody had asserted while every asserted pair stayed green —
so the fix is worth nothing unless the pair that failed is the one now checked. All four were
proved red before being trusted green, including the 4.47:1 near-miss.

`readPalette()` now resolves `var(--dk-*)` aliases, so a token declared as `var(--dk-yolk-deep)`
stays auditable instead of silently reporting MISSING and dropping out of the audit.

**Found in passing, not fixed:** `.badge-jam` uses the same `--yolk-line` against `--surface` and
measures **2.17:1 dark / 1.60:1 light**. It has been failing unrecorded and is now a `KNOWN_GAPS`
entry. `.row-shell[data-picked="true"]` has the same disappearing-wash weakness (1.15:1 light), but
its state is also carried by the `--yolk` pick button, so it is not a threshold failure. Both were
left alone deliberately: `--yolk-line` and `--yolk-wash` are shared, and moving them would have
changed the picked row along with the badge.

### Themes: Auto / Light / Dark

Dark is the default and the design target. Light is a **supported theme**, not a courtesy — it was
audited and corrected, and there is an explicit three-state control in the Data panel.

Auto (following the OS) is the default because it handles the common case unprompted. It is not
sufficient on its own: a phone that switches at sunset changes the app underneath the user with no
way to decline, which is precisely what the Light and Dark options are for.

Both palettes are declared once in `tokens.css` as `--dk-*` / `--lt-*` raw values, then *mapped*
onto the active tokens by three selectors (default, OS-light, forced-light). The mapping blocks
contain no colour literals, so a colour is only ever edited in one place — duplicating hex values
across theme blocks is how palettes drift apart.

### Contrast is measured, not eyeballed

Pairs are checked against WCAG AA: **4.5:1 for normal text, 3:1 for large/bold and for non-text
boundaries**. This is not decoration — the yolk accent carries meaning on gap figures, so failing
contrast is a legibility bug, not a taste one.

**What that actually covers, stated precisely, because this section used to claim "every
foreground/background pair in use" and that was not true.** `PAIRS` in `scripts/contrast.mjs`
pairs *token names*; its `where` field is prose. Nothing connected a pair to the rule that renders
it, so a rule could switch which token it painted with and every listed pair stayed green — the
palette had not moved. What was checked was the palette; what was claimed was the app. Three real
holes were sitting in it: `--ink-venue` was in no pair at all, `--yolk-ink` on `--yolk-deep` was
in no pair, and text on a picked row had never been measured against `--yolk-wash`.

Coverage now comes in three parts, and only the first two are proofs:

1. **Derived from the stylesheet.** Any rule setting *both* a foreground and a background is a
   complete pair with no DOM involved — `.btn-accent`, `.chip[aria-pressed="true"]`,
   `.segmented-item[aria-pressed="true"]` and twelve others. These are parsed out of `app.css` and
   measured exactly as written, so switching a rule's token is caught.
2. **Every token a rule paints with must appear in some measured pair**, listed or derived, or be
   recorded in `KNOWN_GAPS`. This is what found all three holes above.
3. **Hand-listed pairs** for text on an *ancestor's* background — `.cover-note` inside `.row`,
   quiet text on a pressed row. Those need the DOM and cannot be derived from CSS, so this part
   remains a list someone maintains. It is the weakest part and it is not pretending otherwise.

Six rules are deliberately excluded from (1) and each says why in the source: a border painted in
its own fill colour is not a boundary (`.btn-accent`, `.stat-grid`), and container hairlines use
`--line`, which is documented as *meant* to be barely there — control edges use `--btn-line`, and
`scripts/smoke.mjs` independently requires every control to render that exact border.

The light palette originally **failed four checks**, the worst being the yolk accent at 3.85:1 on
white as small text (tab labels, badges, set labels). Corrected values:

| Token | Was | Now | Why |
|---|---|---|---|
| `--lt-yolk` | `#b8720a` | `#945906` | 3.85:1 → 5.69:1 on white; also clears the pressed surface |
| `--lt-ink-faint` | `#7d7263` | `#6f6657` | 4.37:1 → 5.25:1 on the shell |
| `--lt-danger` | `#c2410c` | `#b03a06` | headroom |

**The two themes deliberately do not share the same yolk hex.** They have to be equally *readable*,
which is not the same as being identical — a colour that works on near-black does not automatically
work on white. Re-run `node scripts/contrast.mjs` after any palette change — and `tests/contrast.test.mjs`
asserts every documented pair on every `node --test`, so a regression fails the suite rather
than waiting for someone to remember.

## Type

**System stack**, no downloaded fonts. The PWA must render instantly offline and a font request is
a render-blocking dependency on a bad connection. On Android this resolves to Roboto, which is a
genuinely good dense-data face.

```
--font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif
```

**`font-variant-numeric: tabular-nums` on every number in the app.** This is not a detail. The gap
column, times-played, dates and counts are read by scanning vertically, and proportional digits
make a column of numbers ragged — the single fastest way to make a data app feel cheap.

Scale is tight and mostly two sizes: song titles at a comfortable reading size, metadata one step
down. Weight carries hierarchy more than size does, because size costs rows-per-screen.

```
--t-xs  11px   labels, set tags
--t-sm  13px   metadata, dates
--t-md  15px   song titles, body
--t-lg  19px   screen titles
--t-xl  26px   the one big number (gap on song detail)
```

## Layout and touch

- **Bottom tab bar.** Primary navigation sits within thumb reach; nothing critical lives in the top
  corners. The header is for identity and status only (name, cache age; BUILD moved into the
  Settings & data sheet in 0.1.33).
- **44 px minimum touch targets**, enforced on rows and controls.

  **One documented exception: the footnote marker, at 24px** (`--fn-tap`). It is a control inside
  flowing text on a 25.5px line rhythm, so a region tall enough to meet the floor reaches into the
  song titles beside it and starts opening footnotes when someone meant to tap a song. Measured as
  the deepest reach into any title's line box: **24px reaches 1.5px** (edge contact, unavoidable
  for a marker that sits inside the line) and **44px reaches 11.5px**, over half a line's text
  height. Horizontal expansion is unavailable because its immediate neighbours are song buttons
  with no gap. The smoke test measures this on every run rather than trusting the numbers here —
  and the first version of that measurement was wrong in a way worth recording: it used
  `getBoundingClientRect()` on inline elements, and a song title wrapped across two lines has a
  bounding box spanning both at full column width, so it reported 24px as overlapping six titles
  it was nowhere near. Per-line `getClientRects()` is where the text actually is. Recorded as a
  **known limit, not a passed check** — until 0.1.61 this control had a hit region of 9.6 × **0**
  px, because `line-height: 0` gives an inline-block button a zero-height line box while the digit
  still paints through overflow. "Footnotes are tappable" was true of the markup and false of the
  screen for three releases.
- **Sort and filter open as bottom sheets**, not dropdowns — reachable, and they don't require
  precise aiming.
- **No hover-dependent affordances.** Anything discoverable only on hover does not exist on a
  phone. Footnotes are tappable, not tooltips.
- **Density target: ~8 song rows per screen** on a mid-size Android phone, with song name, gap,
  last-played and times-played all legible without zooming.
- Safe-area insets respected top and bottom so the tab bar clears the gesture bar.
- **The fixed bars are full-bleed; their contents sit in the 720px column.** `.app-header` and
  `.tabbar` span the window so their blurred background reaches the edges, but both pad their
  contents in by `max(0px, (100% - 720px) / 2)` so the brand lines up with body text and the five
  tabs span exactly the column `.app-main` occupies. Below 720px the `max()` collapses to zero and
  the mobile layout is byte-for-byte unchanged — verified at 390px by diffing every box against the
  previous stylesheet, not by inspection. This is alignment only: **desktop remains a courtesy**,
  and nothing here is a large-screen design pass.

## The carton motif, used once

The dozen is twelve. The **cold-start loading state is a 12-cell carton grid that fills** as the
six pulls and the verification pass complete — six cells each, split from `COLD_PULL_STEPS` rather
than a literal, because a hardcoded five against six pulls made the sixth cell fill and then
un-fill on every cold start. It is the only literal carton reference in the app, it appears exactly
when the user has nothing to do but wait, and it doubles as real progress feedback for a ~1 MB
download (the archive is 11.6 MB parsed; it arrives compressed).

Rounded-oval cell shapes echo through row corner radii (`--r-cell: 10px`) without ever being
drawn as eggs.

## Data display rules

These are design rules with a scope consequence, so they are not negotiable:

- **Raw counts, never percentages.** "Set 1 opener 25×" ships. "Set 1 opener 18%" reads as a
  forecast of the next show.
- **No forward-looking language anywhere in the UI**, including microcopy and empty states.
  Column headers describe what happened: "shows since last played", not "due".
- **Carton's own text renders verbatim.** Footnotes and setlist notation are quoted, not rewritten.
  `->` and `>` are different marks and both survive to the screen.
- **Every number states its universe.** The gap column says what it counts, because a bare
  number invites the reader to invent a meaning for it.

## Attribution

Not a footer afterthought. Every show, song and venue view carries a visible link home to the
corresponding `thecarton.net` page, and the shell credits The Carton and Songfish persistently.
This app rides on someone else's work and should send traffic back.

### Link weight: the credit is the footer, not the inline links (0.1.35)

Two things were doing the same job at the same volume, and one of them is on almost every screen.

`.carton-link` — "View on The Carton", plus the short `Carton` variants inside rows — appears on
home, shows, show, song, venue, jams and the gap chart. At 13px/600 it read as a call to action
every time, competing with the content it points at. It is now **11px, weight 500, `--ink-faint`**:
still obviously a link, still a 44px tap target, no longer shouting.

`.info-link` — "Venue info", the outbound Maps deep link — is now the **louder of the two**,
at 13px/600 in `--ink-dim`, and it leads the row on the venue screen. This inverts what these two
rules used to say. On a venue screen the live question is *where is this place*; *read about this
elsewhere* is not.

**Attribution is unaffected, and that is the point.** `.attrib a` is a separate rule and keeps its
`--ink-dim` and its underline. The footer naming The Carton and Songfish renders on every screen
and was not touched. The requirement is that credit is visible and traffic goes home — that is
carried by the persistent footer plus a real link on every view, not by making the inline links
the loudest thing on the page.

Contrast after the change, both themes, measured not eyeballed: `.carton-link` 5.09:1 on the dark
shell and 5.25:1 on the light shell; `.info-link` 9.07:1 and 7.09:1. 11px is normal text under
WCAG, so the 4.5:1 threshold applies to the smaller link and it clears.

#### Receded again, and the primary rule retired (0.1.45)

`.carton-link` is now **10px, weight 400**. The screen has gained jam highlights, a jam key, a jam
entries section and show notes inside the setlist card since these links were last tuned, and they
were taking more attention than attribution needs. **Attribution must be present and findable, not
prominent.**

**The "Carton stays visibly primary over Venue info" rule is retired.** It was set when Venue info
shipped and the screen was simpler. Carton links are now quieter than `.info-link` on every axis —
10px/400 against 13px/600 — and that is intended, not a regression to correct. `.info-link` was not
touched.

**Colour is at its floor.** At 10px these are normal text under WCAG, so 4.5:1 applies, and
`--ink-faint` measures 5.05:1 on the dark shell and **4.73:1 on a dark card** — roughly 0.2 of
headroom. Any further quieting must come from weight, never colour; and size cannot go below 10px
either. Past those two floors this stops being quiet and starts being **hard to find**, which is
the one thing it may not become.

The `↗` is load-bearing for findability at this size, not decoration — it is what makes these
scannable as links. It should not be dropped in a future tidy-up.
