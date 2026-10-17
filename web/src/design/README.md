# Design system (unit G)

Two files, one truth. `tokens.css` is what the browser reads; `tokens.ts` is the same
values typed for renderers. `test/unit-g.tokens.test.ts` asserts they are identical, so
drift is a test failure rather than a wall that renders one thing and tests another.
There are three themes, and that test checks all three (below).

## The one thing to know

Everything here is a consequence of the panel:

> Elo 2270L. 21.5", 1920×1080, wall-mounted at child height, capacitive touch.
> Chromium at `--force-device-scale-factor=2.0`, so **you design against 960×540 logical
> px** and 1 logical px = 2 physical px ≈ 0.50 mm.
> **~225 nits behind anti-glare etched glass**, in a daylit living room.

The etch diffuses ambient light back across the whole surface, so contrast on the wall is
worse than contrast on your laptop by a roughly uniform veil. WCAG's formula already models
about 5% of peak white as flare (the `+0.05` terms). This panel is dimmer and hazier than
WCAG's reference display, so every contrast figure in this system is computed with a **10%
flare term** instead:

```
panelContrast(a, b) = (max(Ya,Yb) + 0.10) / (min(Ya,Yb) + 0.10)
```

That is strictly harsher than WCAG. `test/unit-g.contrast.test.ts` recomputes relative
luminance from the hex values on every run and checks every rule in `CONTRAST_RULES`.
Nothing in the palette is eyeballed.

## Three themes

The household picks one in the grown-up Settings (`snapshot.theme`): **felt** (the default),
**gallery** and **storybook**, from the October 2026 design review.

- **Felt is `:root`.** Gallery and storybook are `:root[data-wall-theme="…"]` blocks that
  override only what they change. `themeOverrides` in `tokens.ts` mirrors those blocks
  exactly, and a test fails on an override that names an undeclared token or repeats felt's value.
- **A theme changes palette, faces, corners, the card's edge and shadow, and the ground's
  texture.** It never changes a size, a tap floor, a type step, or the form a state is drawn
  in. Every floor and every `CONTRAST_RULES` entry is checked in every theme, with no
  per-theme thresholds.
- **Renderers hold `var(--x, <felt>)` strings, never a theme's hex.** `colour`, `radius`,
  `font`, `cardEdge`, `cardShadow`, `ground` and the treatments are built with `cssVar()`, so
  switching the attribute is the whole switch: the browser re-resolves and nothing re-renders.
  The fallback is felt, fully resolved, for a page whose stylesheet did not arrive.
- **The hex of a theme is for tests and the Settings swatches**: `themeTokens(theme)`,
  `childAccentsFor(theme)`, `stateTreatmentsFor(theme)`, `freshnessColourFor(theme)`. Do not
  do arithmetic on a `colour.*` string. It is a `var()`, not a colour.
- **The attribute goes on `<html>`** (`applyWallTheme` in `views/logic/theme.ts`), because
  derived tokens such as `--edge-card: var(--c-border-strong)` resolve where they are
  declared. On any lower element the colours would switch and the card edges would keep felt's.

## Token groups

| Group | Prefix | For |
|---|---|---|
| Ground and ink | `--c-bg`, `--c-surface*`, `--c-border*`, `--c-ink*` | The light, near-neutral page; white cards; the borders that do the work shadows can't |
| Identity | `--c-id-N`, `-tint`, `-on` | One accent per child slot. Also `childAccents` in TS, which carries the non-colour channels |
| State | `--c-state-*`, `--o-state-void` | Chore / routine-step progress. Also `stateTreatments`, keyed by `ChoreState` |
| Feedback | `--c-danger`, `--c-focus` | Adult surfaces and keyboard focus. Nothing a child can reach is red |
| Type | `--fs-*`, `--fw-*`, `--lh-*`, `--ls-*`, `--font-*` | Nine sizes, floor 14. Three weights, floor 600. Three face roles (`family`, `numeric`, `display`) that each theme fills |
| Icons | `--icon-*` | 24 → 160. For the picture band these *are* the interface |
| Tap | `--tap-*`, `--sp-tap-gap` | Four target sizes, floor 64, plus mandatory dead space between them |
| Space / shape | `--sp-*`, `--r-*`, `--stroke-*`, `--shadow-*` | 4-based spacing, five radii, stroke floor 2 |
| Card language | `--edge-card`, `--stroke-card`, `--shadow-card`, `--shadow-control`, `--ground-texture*` | What a card and a pressable key look like in each theme; `card()` in `primitives/style.ts` reads them |
| Layout | `--wall-*` | The fixed 960×540 viewport. There is no second breakpoint |
| Time | `--dur-*` | Including `--dur-undo` (2 s) and `--dur-idle-decay` (90 s), both adopted decisions from H2 |

## What came from DinkyDash, and what didn't

DinkyDash (`templates/index.html`, MIT) is 284 lines of pre-reader-legible dashboard. Taken:

- **Its scale *relationships*.** Headline ≈ 2× body, metadata ≈ 0.95× body — a wider spread
  than a document scale, which is what makes a layout read from across a room. The ratios
  transfer; the absolute sizes don't (it targets 800×480 and its smallest step lands near
  10 px, well under our floor).
- **Icon-leading density.** Every row starts with a picture, and the whole screen holds
  five or six information blocks, not twenty. That is why `--icon-*` runs so large.
- **Warm neutrals over cold grey.** Its `#fffaf5` / `#2d2319` pairing is friendlier than a
  grey UI and, on etched glass, an off-white ground halates less than pure white. (Superseded
  for the GROUND by the themes, 2026-10-11: the warm sand read as brown on the glass. The
  off-white-over-white reasoning still holds, which is why no ground is white.)
- **The `.no-data` screen.** A branded waiting state instead of a blank page — the same
  instinct as our prime invariant.

Deliberately *not* taken:

- **Its fluid root** (`html { font-size: clamp(13px, 3.2vmin, 24px) }` with everything in
  `rem`). Elegant, but it makes the 14 px floor a function of the viewport, i.e. not a
  floor. Our type scale is fixed px.
- **Its webfont `<link>`** to Google's font CDN. That would put a third party in the 6:00 AM
  display path, which PRD §4 forbids on the availability test alone. Every face is a
  self-hosted, latin-subset `woff2` in `fonts/` with its OFL beside it: Nunito, Fredoka,
  Fraunces, and "Wall Reader", which is Andika renamed because a subset may not carry its
  Reserved Font Name. A test scans `tokens.css` for remote fonts and checks that every face a
  theme names first has an `@font-face` and a file.
- **Its tinted pills with darkened accent text** (`rgba(accent, 0.1)` fill, accent-coloured
  label). At 225 nits behind etch, a 10%-alpha fill is invisible and coloured type is the
  first thing to collapse. We use opaque tints and neutral ink.

## Rules a renderer author must not break

1. **Nothing below 14 px logical.** There is no caption token because there is no legitimate
   use for one on a wall. Don't add one.
2. **Nothing tappable below 64 px logical**, and always `--sp-tap-gap` between adjacent
   targets. A three-year-old, standing, reaching up, on capacitive glass — a fat-finger miss
   must land on nothing, not on the neighbouring chore.
3. **No stroke below `--stroke-min` (2 px logical).** 1 px logical is 2 px physical and the
   etch smears it into the background. Same reason weights start at 600 and shadows are a
   hard offset ledge (`--shadow-card`), never a blur.
4. **Never colour alone.** Every meaning carries at least one non-colour channel:
   - *Identity* = accent **+ shape + fixed column + the child's own avatar asset.*
     `childAccents` hands you `shape` and `column`; use them.
   - *State* = edge colour **+ a distinct glyph + a distinct fill treatment** (outline →
     tint → solid+check → faded). `stateTreatments[state].requiresIcon` is `true` for every
     state, on purpose.
   Green is reserved for "done" and never means "this is Child B". Amber and green — the two
   states a child most needs to separate — are exactly the deuteranope trap, which is why
   "done" is a solid fill with a check rather than a tint.
5. **No text in the picture band.** `bandTypography.picture.showsText` is `false` and every
   text size on it is `null` rather than `0` — a size invites someone to render at it. If a
   pre-reader sees a word, the design has failed her, including numerals: quantity in that
   band is `pips`, not "7".
6. **Read `-on` / `onSolid`, never assume white ink.** The three accents ladder in lightness
   so they separate in greyscale, which means the lightest one needs dark text. Type on any
   accent solid must be `--fs-400` (24 px) or larger — those fills grade at ~4:1, not 7:1.
7. **Only `--c-ink`, `--c-ink-muted` and `--c-ink-inverse` are text colours.** Hue lives in
   fills and edges.
8. **Tints are decorative and legal only on `--c-surface`.** On `--c-bg` they land near
   1.05:1 — invisible. They never carry identity by themselves.
9. **No new raw colours, sizes or weights in a renderer.** Add a token, add its
   `CONTRAST_RULES` entry, and let the test grade it. `unit-g.contrast.test.ts` fails if any
   `--c-*` token has no rule at all.
10. **No media queries.** The viewport is fixed and known. A breakpoint is a smell.

## Extending

A fourth child needs a fourth rung on the lightness ladder, derived the same way — pick a
luminance ≥ 1.6× the previous rung's on the panel metric, choose a hue that isn't green, set
its `-on` ink by contrast, give it a fourth `shape` and column, and add its rules.
`childAccentForSlot()` wraps rather than returning nothing (a blank card is the failure this
project exists to prevent), so a fourth child silently collides until the ladder is extended.
`MAX_DISTINCT_CHILDREN` is exported so the admin surface can warn about it.
