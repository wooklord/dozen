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
work on white. Re-run `scratchpad/contrast.mjs` after any palette change.

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
