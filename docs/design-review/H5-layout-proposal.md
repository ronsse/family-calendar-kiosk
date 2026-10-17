# H5 — the layout proposal

**2026-08-25.** Written after connecting the real calendar, and after looking at what the
closed products actually put on a wall. Supersedes the two "for you" items in
[H4](H4-layout-tournament.md) by absorbing them.

The household said, of the current board: *"much of the board is not very usable, and it
looks bad."* That is the brief. This document is what I propose to do about it and why, with
the evidence for each move.

---

## 0. Decisions taken, recorded here so they stop being open

| Decision | Consequence for this proposal |
|---|---|
| **Required chores rotate between the children and pay nothing.** | They are `base_points = 0`. The domain already handles this — a zero-point approval is "approved, nothing owed". |
| **A separate list of extra tasks earns money.** | Two lists, one board. Grouping is a §5 item, deliberately deferred to land with everything else. |
| **No PIN. The wall is freely accessible to anybody.** | See §6 — this is the one decision with a consequence I want on the record before I build to it. |
| **Groupings and information architecture are handled all at once, later.** | So this proposal is about DENSITY, LEGIBILITY and REACHABILITY, not about re-organising what exists. |
| **The youngest advancing a routine unaided is the M1 acceptance we work toward.** | Every proposal below is checked against "does this work with no words at all". |

---

## 1. What we are actually up against

The panel is 1920x1080 at `--force-device-scale-factor=2.0`, so the design surface is
**960x540 logical pixels, landscape**. That is the whole constraint, and it is worth stating
next to what the competition designs for:

| Product | Surface | Consequence |
|---|---|---|
| Skylight Calendar Max | 27", **portrait**, ~1080x1920 | Four child columns side by side, each with its own switcher, all visible at once |
| Hearth Display | 27", **portrait** | A scrolling dashboard: summary, avatar row, events, routines, meals, lists |
| **This wall** | 21.5", **landscape**, 960x540 logical | Half the vertical room of either, and it is the vertical axis both of them spend |

So we cannot copy either layout. We can copy their **components**, and this is what the rest of
this document does — every proposal below is a thing one of them does, restated for a short
wide screen.

Today the shell spends **305 of 540 px on chrome** — a 96px header, padding, gutters — and
leaves a child's entire day 235. That number is the root cause of every compromise in H4.

---

## 2. What the references actually show

Screenshots pulled 2026-08-25. Not committed: they are third-party marketing images and this
repo may go public. Sources are linked; the observations are what matter.

### Skylight, per-child routine column
<https://myskylight.com/calendar-max> (`routines-chores.webp`, `cal_max_desktop.webp`)

- Child header: **big circular avatar + name**, a `1/10` progress pill, a `⭐10` points pill.
  All four things on one line. No separate points panel anywhere.
- Switcher: **four circular icon buttons** — Morning ☀️ / Afternoon 🌤 / Evening 🌙 / Chores 🧹 —
  each with a **progress ring drawn around the circle**. Selected is full opacity with a dark
  label; unselected is faded. A pre-reader can use this: the icons carry it, the words are
  decoration.
- Steps: **one full-width column**, one card per step. The icon is **large and sits above the
  label inside the card**, not beside it. Points as a small star pill inside the card.
  Completion is a circle on the right — empty, or filled with a check.
- Card fill is **solid tint in the child's colour**. Done is a deeper fill. Nothing is an
  outline on white.
- Chores are simply another section further down the same column. Same card, different heading.

### Hearth, household dashboard
<https://hearthdisplay.com/products/hearth-display> (`family_dashboard.png`)

- **Avatar row**: four circular photos, identical size, a points coin under each, name below.
  That is the whole household summary and it reads instantly.
- **Events are solid full-width colour bars.** Title bold, time small underneath, a stack of
  tiny avatars on the right for who is involved. No white cards, no thin borders.
- Routines appear as cards with a **progress bar** and the assignee's avatar, grouped
  "Coming up" / "Later today".
- Time is very large, top right. Weather top left.

### Skylight, event cards
(`all-in-one.webp`)

- Filled tinted rounded rectangle. **Title bold on line one, time muted on line two, an avatar
  chip on the right** — `+3` when it is a household event with several people.
- The owner is carried by the **chip and the tint**, never by a hairline border.

---

## 3. The eight moves

Ordered by value, and by what unblocks what.

### 3.1 Header: 96px → 56px, and the date stops being a sentence

H4's recommendation, and both references agree on the shape: a **large time** with a **small
date beside it**, not a spelled-out sentence occupying the widest element on the wall.
"Tuesday, August 25" is meaningless to the youngest and redundant to the eldest, who can read a clock.

**Buys 40px on the scarce axis, and every move below depends on it.**

### 3.2a The rail is permanent, at one of two widths — **the operator's steer, built 2026-08-25**

*"I think we should have a sidebar on the left — it can be smaller to make navigation easier."*

It used to appear only once a child was selected, because `AmbientView` drew the three faces
itself and a rail would have been the same row twice. That was the wrong half of the fix:
**navigation you only get after navigating is not navigation.** The faces moved out of the
ambient view and into the rail, so there is one switcher, in one place, on every screen.

- **Open, 160px** while nobody is selected — you are choosing, so each face carries its name.
- **Collapsed, 96px** the moment a child is selected — they have chosen, their day needs the
  width, and 64px of it comes back from here. Faces only: 96px cannot hold a name and does
  not need to, because by then she has already found herself.

96 is not arbitrary. A 64px avatar inside a tap target's own padding is 88, so this is the
narrowest a rail can be without shrinking the face — and the face is what a three-year-old
navigates by.

**Not a drawer, and that was the one place I did not take the steer as written.** A pull-out is
a mode, and a pre-reader who opens one cannot read her way out of it; the 90-second idle decay
resets the selected child but cannot rescue a child from a state she does not know she is in.
Tying the width to *am I choosing, or have I chosen* returns the same pixels with nothing to
get stuck in. Say the word and I will add the gesture on top of it.

**Neither width carries progress**, which is a measurement rather than a preference: the middle child's
eight marks wrap to two rows, his tile came to ~190px, and three tiles then wanted more than
the 420px the shell has. Progress belongs on the face as a **ring** — which costs no height at
all, and is what Skylight does — and that is now the first thing on the list below.

### 3.2b The rail renders in the VIEWER's band, not each child's own

A bug, found while capturing screenshots for this document. The rail asks each child's own band
to draw their avatar, so from the eldest's view the rail shows: her name (small, fluent), the middle child's name
(medium, emergent), and **an unnamed triangle** (the youngest, picture band, which draws no text). Three
different sizes and one missing name, in the one component whose whole job is "always the same
place".

Navigation is chrome. It belongs in the viewer's band. *(The operator: this is also why the rail looked
absent — it only exists once a child is selected, and on the idle wall AmbientView deliberately
draws the three faces instead. That part is working as designed; §3.7 is about making it look
like it.)*

### 3.3 Routine steps: one full-width column, icon-forward

Currently a `repeat(auto-fit, minmax(...))` grid, which put a *sequence* into a shape the eye
can read two ways — the reason H4 made me put the position numeral back. Skylight puts steps in
a single column with a big icon and no numerals at all, because in a column the order **is** the
position.

One column, icon large, label under or beside it by band, completion circle on the right. The
numeral comes back out.

### 3.4 The switcher becomes circular icons with progress rings

Morning ☀️ / Bedtime 🌙 / Jobs ⭐ — three circles, ~64px tall, replacing the two labelled pills.
This is Skylight's control almost exactly, and it solves three things at once:

- **It is legible with no words**, which the picture band needs.
- **The ring shows progress per section**, so "how much of my morning is left" is answerable
  without entering it.
- It is far more compact than two 96px pills, which buys the routine column its width back.

It also lands H4's "four time windows instead of two switchable sections" without removing the
switch from the screen — the ring makes the switch informative rather than merely navigational.

### 3.5 Cards get a solid fill instead of an outline

`--force-device-scale-factor` aside, this panel is **225 nits behind anti-glare etched glass**.
An outlined white card and a filled card are not equally legible there — and every reference
product fills. Chore cards, step cards and event cards all move to a solid tint in the owner's
accent, with "done" as a deeper fill.

This is the single change most likely to answer "it looks bad" on its own.

### 3.6 Event cards: the Hearth/Skylight pattern

Filled tinted bar. **Title wraps to two lines** — today it truncates, so
`Grandma visit and cousin's birthday` renders as `Grandma visit and cous…` and you cannot tell whose
birthday it is. Time small underneath. Owner as an avatar chip on the right when we have
per-child calendars; until then the tint is neutral and the chip is absent.

### 3.7 AmbientView becomes an avatar row

Hearth's household summary is four identical circles with a points coin under each. Ours draws
each child in their own band, so the three faces are three different sizes with three different
pip treatments, and the smallest one has no pips at all. It reads as broken rather than as
"literacy buys density".

Same fix as §3.2: the household board is chrome. One size, one treatment, name under each face.

### 3.8 Points stop being a magenta bar

The eldest's points badge is currently a full-width solid bar roughly 230px tall — for the number
zero. Both references carry points as a **small star pill**, in the child's header line and again
inside each card that pays. That is where ~200px of the child view comes back from.

---

## 4. What this adds up to

Rough vertical budget for a child's view after §3.1 and §3.4:

```
header                    56
gutter                    12
switcher (rings)          64
gutter                    12
--------------------------------
content                  ~372     (today: 235)
```

372px of single-column routine at fluent density is roughly **five steps visible with no
scrolling**, against three today — and against a routine panel that needed 466px and clipped.

---

## 5. Deliberately not in this proposal

- **Chore groupings** (duties vs paid extras). The operator's call: handle it with the rest of the
  information architecture, in one pass, later.
- **Per-child upcoming events.** Needs room from somewhere and a per-child calendar upstream;
  neither exists yet.
- **Real icons.** ADR-0002 build-time imagery, judged on the mounted panel at 225 nits — not on
  a laptop, and not before the layout that frames them is settled.
- **Streaks.** Still a contract change.

---

## 6b. Event imagery — the design, before it gets built

The operator wants upcoming events to render with a picture that matches them: dancing figures for a
dance class, a campfire for a camping trip, a bike for a ride. And wants the CHOICE of which
events get one, and of what, made by a model rather than by a lookup table.

Both are right, and there is exactly one arrangement that gets them without shipping the
household's schedule to a hosted provider. **Event titles are household data** — "Child A dentist",
"Camping with friends" — and sending them to a cloud model fails ADR-0002's
disclosure test outright, however good the prompt is.

The split:

| Stage | Where | What it sees | What it emits |
|---|---|---|---|
| **Classify** | **Ollama, on the home server** | The real event title | A generic scene key: `dance`, `camp`, `cycle`, `swim`, `birthday`, `snow`, `none` |
| **Render** | Nano Banana Pro, cloud | Only the scene key | A poster-style illustration |
| **Serve** | Local disk | — | The cached PNG, or today's fallback icon |

The classifier is the only thing that ever reads a title, and it never leaves the box —
which is precisely the case CLAUDE.md reserves local models for. The cloud call carries
`two figures dancing, flat vector, national-park poster style`, which is the same class of
payload as the routine icons ADR-0002 already permits. And because the render is cached to
disk ahead of time, an event with no image yet falls back to its icon: the availability test is
satisfied by the same mechanism as everything else on this wall.

**A scene key is a small, closed vocabulary, and that is deliberate.** Free-form prompts from a
classifier would leak title fragments into the cloud call by accident — a model asked for "a
short visual description" will happily write "Child A's dance recital". Emitting one key from a
fixed list makes the leak impossible rather than unlikely, which is the CLAUDE.md rule about
guardrails being architectural.

**The figures are generic.** Not likenesses of these three children, at any fidelity. Partly
because generated depictions of real children are not something this repo produces, and partly
because it is the better design: at the size an event card renders, a poster-style silhouette of
two figures mid-turn reads instantly and an attempted portrait turns to mud at 225 nits.

Not built yet. It wants the scene vocabulary agreed, a nightly classify-and-render job, and a
cache keyed by scene rather than by event — so the same six pictures serve every dance class
this household will ever have.

## 6c. Superseded in part by H7

[H7](H7-information-architecture.md), 2026-08-26, found that the eight admin routes are
implemented and **unreachable from the wall** — there is no adult destination at all. The
layout moves in §3 stand; the framing does not. This document treats the child view as the
product, and it is half of it.

Read H7 first.

## 7. Next, in order

1. **A progress ring on each rail face.** Skylight's control, and the thing that puts the
   household readout back on the idle wall for zero vertical cost.
2. **Routine steps into one full-width column** (§3.3), which needs §3.4 first.
3. **The switcher becomes circular icons with rings** (§3.4) — and replaces the routine panel's
   own header, which is where the room for a four-step column actually comes from.
4. **Cards fill instead of outline** (§3.5).
5. **Points stop being a magenta bar** (§3.8) — ~230px of a 540px screen, for the number zero.

---

## 6. ~~The one thing I want on the record~~ — DECIDED 2026-08-25: keep the PIN before building

**"No PIN, freely accessible to anybody" and the money ledger are in tension, and I would rather
say so now than discover it in code review.**

There is no login on this wall today and never was — the PIN gates two specific acts:
*approving a chore* (which pays out) and *approving a cash-out* (which hands over real money).
With required chores paying nothing, approval on that list is ceremony and can go. But on the
paid extras list, removing the gate means **a child can approve their own payout and their own
cash-out**, which makes the balance a number they can set rather than one they earn.

Three options, and I will build whichever you say:

1. **No PIN anywhere.** Simplest, honest about a wall in a living room. The ledger becomes a
   shared tally the family keeps in good faith, not an authority.
2. **No PIN except the two money paths.** Everything a child does stays open; approving a paid
   task and cashing out stay gated. This is what exists today, minus the ceremony on duties.
3. **No PIN, but paid tasks need a second person.** A claim is marked by the child and confirmed
   by a different avatar. Social, not cryptographic — fits a wall nobody logs into.

**The operator chose to keep the PIN**, and set it. It is not written down here, or anywhere else in
this repo, by the same rule that keeps the roster out: `provision.ts --pin` is the only way it
is ever entered, and it is stored hashed.

So the money paths stay gated and everything a child does stays open — which is what exists
today. Duties paying nothing still queue for approval; whether that ceremony is worth it is a
question for the pass that separates duties from paid extras, not for this one.

Everything in §3 is independent of this and I am starting there.
