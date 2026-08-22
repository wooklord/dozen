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
--ink-dim      #A99F92   secondary text
--ink-faint    #6E655B   tertiary, timestamps
--yolk         #F5A623   THE accent
--yolk-deep    #C77F14   pressed
--yolk-wash    rgba(245,166,35,.12)   selected row fill
```

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

Every foreground/background pair in use is checked against WCAG AA: **4.5:1 for normal text, 3:1
for large/bold**. This is not decoration — the yolk accent carries meaning on gap figures, so
failing contrast is a legibility bug, not a taste one.

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
  corners. The header is for identity and status only (name, BUILD, cache age).
- **44 px minimum touch targets**, enforced on rows and controls.
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
five pulls and the verification pass complete. It is the only literal carton reference in the app,
it appears exactly when the user has nothing to do but wait, and it doubles as real progress
feedback for a 5 MB download.

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
