# H8 — viewing distance is a property of the destination, not of the wall

**2026-08-26.** The household said: *"I think you're running from the general assumption that you need to be
able to see it from ten feet. I don't think that's correct. Kids are gonna go up to the
dashboard. They're gonna look at the pictures. They can be small."*

That is right, and this correction is worth writing down carefully because the assumption it
replaces is load-bearing: **37 places** in the source and docs cite "across the room", "from
the kitchen", "ten feet" or "225 nits" as the reason for a decision.

---

## 1. What was wrong

One rule was applied to the whole product:

> The panel is 225 nits behind anti-glare etched glass and is read by children from 3–10 ft.
> No sub-14px type, no hairline strokes, no fine detail.

That is a good rule for **one screen**. It was applied to all of them, and it quietly set the
baseline type scale for a seven-year-old whose nose is a foot from the glass.

**It is also the direct cause of a week of overflow fights.** A child's routine step was
rendering a 30px label because 30px reads from ten feet. Four steps then wanted 354px in a pane
with 300, and the fix was a switcher rebuild, a header cut and two token changes — all to make
room for type sized for a distance nobody stands at.

## 2. What is actually true

Three different things were fused into one rule. They come apart cleanly:

| | Driven by | Scope |
|---|---|---|
| **Colour separation, stroke weight** | The panel. 225 nits behind etched glass is physics — two mid-tones collapse and a hairline vanishes at ANY distance | **Global. Unchanged.** |
| **Tap target ≥ 64px** | Motor skill. A three-year-old's finger is imprecise at six inches, not just at six feet | **Global. Unchanged.** |
| **Type size, detail density, information density** | **Viewing distance — which differs per destination** | **Per destination. This is the correction.** |

## 3. Distance, per destination

| Destination | Who is reading, from where | Consequence |
|---|---|---|
| **Household / idle** | A parent glancing from the kitchen while making lunches. **This is the 6:00 AM reader, and the prime invariant is about them.** | Distance rules stand here in full. Big type, high contrast, few blocks. |
| **A child's own screen** | A child who walked up and put a finger on the glass. ~40–60cm. | **Type can drop a full step or two.** Detail is an asset, not mud. More can fit, and what fits can be richer. Tap targets do not move. |
| **Grown-ups / approvals** | An adult standing at the wall for ninety seconds after dinner. ~50cm. | Same as a child's screen. Dense is fine; this is a list you scan, not a sign you glance at. |

**The one that must not drift**: the idle wall. Everything the prime invariant promises is
about the screen nobody has touched, read by someone who is not standing in front of it.

## 4. What this unlocks, and it is the interesting half

*"There's gonna be other exciting things to see on there, like a new picture for the day or a
new background… a Where's Waldo home screen where the kids have to find themselves, and then
they click on their person to open up the chores section."*

A child approaching the wall is not a problem to be solved with bigger type. It is **the
behaviour the product wants**, and close-up detail is what causes it. Under the old rule that
detail was banned outright.

A candidate scene is generated and it works — a mountain campsite with three findable children,
one per third, matching their avatars because it was reference-conditioned on them, plus
squirrels, a canoe, marshmallows, a trampoline and the dog. It is legible and delightful at
arm's length **and it would be mud from ten feet**, which is precisely the point.

### The tension, stated honestly

A search-and-find scene and a kitchen-legible agenda cannot both own the idle screen. One of
them has to give.

**Proposal: time-box it, with the machinery we already have.** `timeBoxState` already governs
which routine leads and when. Extend the same idea to the idle wall:

- **Inside a routine window** (06:00–08:00, 19:00–20:30) — and any time something is overdue —
  the wall is the information display it is now. Agenda, countdowns, progress, read from the
  kitchen. The invariant is satisfied precisely when it is about to be tested.
- **Outside those windows** — most of the day — the wall is the scene. Tapping your character
  opens your chores. Tapping anywhere else does nothing, or reveals a small detail.

That is not a compromise between the two; it is each one owning the hours it is actually good
for. And it makes "a new picture for the day" a feature rather than a decoration: the scene can
rotate, which gives a child a reason to walk up and look.

### What it needs

1. **Hit regions.** Tapping a character has to select that child. The scene is a generated
   raster, so the regions are authored once per scene as fractional rectangles beside the
   image — not detected. Three rectangles per scene, in a small JSON manifest, versioned with
   the art.
2. **A scene manifest**, so scenes can rotate without a deploy: image, hit regions, and which
   slot each region maps to.
3. **A fallback that cannot fail.** If a scene is missing or its manifest is malformed, the
   wall shows today's information display. Delight degrades to utility, never to blank.

## 5. What changes in the code

Nothing yet, deliberately — this is the principle, and the type scale should move once, on
purpose, rather than opportunistically.

When it does move: `bandTypography` gains the distance assumption per destination rather than
per band, and the child bands drop a step. The band scale itself is unaffected — literacy still
buys density, it just starts from a closer baseline.

The 37 citations of "across the room" in the source are not all wrong. Roughly half are on the
idle wall or about colour and stroke, where they still hold. The rest name a distance that
nobody stands at, and should be corrected as each file is next touched rather than in one
sweep — a mass edit of comments is how the reasoning behind them gets lost.
