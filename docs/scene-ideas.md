# Scene ideas — what KIND of picture the wall can draw

**Status: 2026-09-13.** The fifth axis is built (`tools/scene-premises.json`, `gen-scene.py
--premise`, `scene-week.py --premise`, opt-in) and five probes have been measured for $0.47.
The week tie-in is built too (`tools/scene_context.py`, frozen per week, on by default). What
the household needs to supply to make either better is in [`scene-inputs.md`](scene-inputs.md).

The question this answers: *"a Where's Waldo scene… a photorealistic image but of an
unrealistic thing… riding unicorns or Pegasus… driving a monster truck… a Spiderman suit
swinging from a building… come up with some cool ideas, and think about how this ties in with
the weather and what we're doing next week."*

## 1. The one rule every idea must pass

The picture is the navigation. Three children find themselves in it and tap themselves, so a
scene is not "a nice picture of them" — it is three tap targets that happen to be a picture.
That gives five limits that decide which ideas survive, and they are physics, not taste:

| # | Limit | Where it comes from | What it kills |
|---|---|---|---|
| 1 | Each child ≥ 1.5 in tall on the glass (14.2 % of frame height, 77 logical px) | `scene-regions.py` height floor; the 64 px absolute tap floor | A true Waldo, where the child is 1/10 of the frame (54 px). **Not possible on this wall.** |
| 2 | Hair uncovered | Identity = count + height order + hair (`docs/scene-imagery-plan.md`) | Masks, helmets, hoods. Spider-suit → *no mask*; astronaut → *helmet under the arm*. |
| 3 | Face to the viewer, head and body the same way | The finder's facing check | Upside-down poses: the handstand was **refused** ("head reads as on backwards") on 2026-09-13. Cartwheels carry the same risk. |
| 4 | Clear ground between the three (≥ 1/10 width; 16 px inert gutter) | `fit_overlaps` (at most 25% overlap, split) | Three on one dragon; two carrying one basket in a crowd picture. |
| 5 | Riding or driving → ON it, in the open | A child inside a cab is a windscreen, not a tap target | Driving a monster truck → *standing on its roof holding a rail*. Cockpits, submarines. |

Two more come from the models rather than the mechanic:

- **Describe, never name.** In an August 2026 study, GPT Image 2 refused named characters
  91.7 % of the time and Nano Banana 2 41.7 %.[^tm] "A bright red-and-blue superhero suit with a
  flowing cape and no mask" got the whole idea through gpt-image-2 first time, unrefused.
- **Every noun may get drawn.** "Small labels float there" drew a beige banner across three
  pictures in four (CLAUDE.md). A premise is read as a list of nouns before it goes in.

[^tm]: dreampixelforge.com, *AI image generators and copyrighted characters*, Aug 2026 — 12
attempts per model, refusal counts for named characters.

## 2. The premises that exist

`tools/scene-premises.json`. A premise sits *on top of* setting × style × camera × activity: it
adds a PREMISE section, and may replace LAYOUT, the crowd sentence, the activity pool, pin the
camera, restrict the style families and forbid shared activities. `plain` overrides nothing and
is byte-identical to every scene before the axis existed.

| id | Families | Camera | What it is | Measured |
|---|---|---|---|---|
| `plain` | all | — | The picture the wall has drawn since September. | 40+ scenes |
| `busy-town` | illustration, anime | high-angle (pinned) | Seek-and-find in the *Wimmelbuch* tradition:[^wim] forty-plus figures at ONE scale, the children a fifth of the height, one per third of width, and no other child with their hair. | 2 probes, below |
| `impossible-photo` | photoreal only | — | A photograph of something that could not happen, with full photographic conviction. Its own pool of 19 activities: unicorn, winged horse, dinosaur, polar bear, giant snail, monster-truck roof, tiny open racer, hot-air balloon, superhero rope-swing (no mask), jetpack, balloons lift, spacesuit helmet-under-arm, snorkel-on-a-whale, tyrannosaur on a leash, giraffe handshake, parade elephant, standing on a rainbow, umbrella raining sweets, juggling planets. | 2 probes, below |
| `cutaway` | illustration, anime | eye-level (pinned) | A dollhouse cutaway of one building (crooked house, lighthouse, treehouse, sailing ship, castle tower, hollow tree, red barn), the three children in three DIFFERENT rooms. | 1 probe, below |
| `giants` | all | — | The three children are giants, taller than the houses; the crowd at their feet. | untested |
| `tiny` | all | low-angle (pinned) | Mouse-sized, the setting from ankle height; its own pool of 11 (beetle pony, bumblebee, leaf boat, dandelion, mushroom, grass slide, marble, raindrop, spider-thread swing, strawberry-with-a-mouse). | untested |

Nine more premises were written on 2026-10-29 and none has been drawn: §6 has the brainstorm
they came out of, what was kept and what was rejected on which rule. (`impossible-photo` in the
table above was removed on 2026-09-18 with the photoreal family; the row is kept as history.)

[^wim]: *Wimmelbilderbuch* — Ali Mitgutsch's "teeming picture books", the genre Waldo grew out
of; the modern seek-and-find lists (imaginationsoup.net "20 best seek-and-find books") are the
same shape. fal's Nano Banana Pro prompting guide confirms it holds 30–50 figures in a crowd.

### 2.1 What the five probes showed ($0.47, 2026-09-13, kept in a scratch directory outside the repo)

| Probe | Model | Cast held? | Finder | What happened |
|---|---|---|---|---|
| `impossible-18` — superhero rope-swing + unicorn + open racer, castle village | gpt-image-2 | **Yes.** Braids, long blonde, short blonde; right height order; dog hiding bottom-left | **offered** (289 / 255 / 146 px) | The whole brief in one frame. Nothing refused. This is the premise to run first. |
| `impossible-19` — tyrannosaur on a leash + hot-air balloon + unicorn, spring meadow | gpt-image-2 | Yes | refused: rider "cut off by her own box" | The balloon lifts a child up and away (she came out 96 × 96 — the floor). The rider's legs straddle the animal and the box was judged not-whole. **Riders and lifted children are finder-hard**, not model-hard. |
| `busy-town` (first wording) — harvest market | nano-banana-2 | Yes | offered (273 / 271 / 189 px) | Not a seek-and-find: nb2 drew the three as the foreground, half the frame tall, and the shared "carrying a basket" activity huddled two of them. Same-scale was ignored. |
| `busy-town-2` (restated: "there is no foreground group… exactly the same size as the other children") | nano-banana-2 | Yes — ~50 figures, children at crowd scale, one per third | offered (141 / 96 / 130 px) | **A real busy-picture, and the finder tapped the wrong braids.** nb2 drew a second braided figure in a red coat (a young woman with a cider glass, bottom-left) and the finder chose her over the kite-flying girl above. |
| `cutaway` — castle village, treehouse | nano-banana-2 | Yes — three rooms, three children | refused: handstand "head reads as on backwards" | Beautiful cutaway. The refusal was the everyday activity table (upside-down pose), not the premise; and a sledge on a plank of snow in green hills was the season filter that no caller ever fed (fixed: `scene-week` now passes `--season` and `--tags`). |

The one finding that changes the design: **at crowd scale the finder needs an ambiguity
check.** It locates *a* match per slot and never asks whether there is a second plausible one.
For `plain` scenes the three are the biggest children in the picture and there is no second;
in a `busy-town` the prompt's "no other child has their hair" is advisory and nb2 broke it on
the first try. Until the finder can say "two figures match slot 1 — refused", `busy-town` is a
picture to admire, not to navigate by. That is a `scene-regions.py` change (one more vision
question: *how many figures in this picture match this description?*), not a prompt change.

**Built 2026-10-20** as `check_lookalikes`: one call nominates unframed children, code drops
the far-back and counted-out ladders, and each survivor is matched against the portraits on
its own. A pasted twin refuses at 92% and 64% of the child's height and passes at 30%. No
`busy-town` has been drawn against the current avatars, so its look-alike rate is still
unmeasured; one paid probe would settle whether it can rotate.

### 2.2 Verdict per idea the household raised

| Asked for | Answer |
|---|---|
| Where's Waldo | `busy-town`. Works as a picture (probe 2). The finder refuses look-alikes since 2026-10-20 (§2.1); rotation waits on one probe against the current avatars. Never at true Waldo scale — limit 1. |
| Photoreal but impossible | `impossible-photo`. Works, first time, on gpt-image-2. **Recommended first premise to put on the wall.** |
| Riding unicorns / Pegasus | In the pool ("white unicorn at a canter", "winged horse just leaving the ground"). Unicorn held twice. |
| Driving a monster truck | Standing on its roof holding a rail — limit 5. In the pool, untested. |
| Spider-suit swinging from a building | "Red-and-blue superhero suit, flowing cape, no mask, hair flying" — held and unrefused on gpt-image-2. Never the name. |

## 3. More ideas, sorted by whether they are a premise, a setting or a style

The axes are separate on purpose. A new idea goes in the smallest table that can hold it.

**Premises (what kind of picture):** `giants` and `tiny` are written and untested. Candidates
for later, each already checked against the five limits — *shadow puppets* (fails 2 and 3:
silhouettes have no hair colour and no face), *underwater* (passes if hair floats free and no
mask — snorkel pushed up), *on the moon* (helmet under the arm, as the astronaut activity),
*storybook page* (a plain scene inside a painted border — the border is a noun; test once),
*night with lanterns* (already a setting; not a premise), *parade float* (a shared vehicle —
fights limit 4 unless each child has her own float). *Underwater* and the parade were written
on 2026-10-29 as `flooded` and `parade` (§6); the moon, shadow puppets and the storybook border
were rejected there, each on a limit.

**Settings (where):** underwater reef, the moon's surface, a treetop village, a rooftop at
night, inside a giant pumpkin, a snow-globe town, a dragon's back seen as terrain — see the
fantasy rows already in `scene-settings.json` for the tone. A holiday is **never** a setting
(it is a prop from `scene_context`), because the rotation is a pure function of the week and a
holiday setting would be in season for one week a year.

**Styles (how it is drawn):** the eight in `scene-styles.json` cover cartoon, anime, photoreal.
Worth a $0.12 probe each when wanted: claymation, paper cut-out, felt and stitched cloth, pixel
art (fails limit 1 fast — hair is four pixels), chalk on a blackboard (dark ground on a 225-nit
panel — test on the wall, not a laptop), watercolour, comic-book halftone. `family` decides
which premises can use them: `impossible-photo` is photoreal-only by definition.

## 4. The week tie-in — what "this week" is allowed to say

`tools/scene_context.py`, on by default in `scene-week.py`, `--no-context` to silence it.
Three sources, each optional, each degrading to *nothing* rather than to a guess, all frozen to
`db/scene-context/<week>.json` on first use so a Tuesday re-run repeats Sunday's brief exactly
(the seed already makes the rest of the prompt repeat; the context has to as well).

| Source | Becomes | Leaves the house? |
|---|---|---|
| Open-Meteo daily forecast at a 0.1° grid point (`db/scene-place.json`, gitignored) | One sentence: *"a cool week with bright sun and a clear sky, dry ground; everyone in jackets"*. Bands (cold/cool/mild/warm/hot × dry/showers/rain/snow × sunny/mixed/overcast), never a number. | A lat/lon that covers a few miles of suburb. No key. |
| The wall's own SQLite, latest promoted sync, **category counts** for Mon–Sun | Props owned by the crowd: sport → a ball and cones; dance → ballet slippers and a tutu on a hook; school → a bus in the distance and a backpack; celebration → balloons and a cake; travel → suitcase and map; outing → picnic basket; music → instrument case; kitchen → mixing bowl and apron. Medical, hygiene, routine say nothing on purpose. | Only the props sentence. Never a title, a name or a time. |
| A holiday table by date (Easter and Thanksgiving computed) | Props: pumpkins on steps, lights along the eaves, painted eggs in the grass. Costumes go **over** ordinary clothes with hair showing — limit 2. | Nothing. |
| An all-day event whose title starts `scene:` | Its own section, THIS WEEK'S NOTE, verbatim after the marker. | **Yes — that is the point.** It is the one channel a person composes for the picture. Opt-in by writing the marker; still guarded by `prompt_guard.enforce` over the whole prompt. |

Where each lands in the prompt: the weather sits in SCENE (it is part of the place), the props
in EVERYONE ELSE (they are things the crowd owns), the note in its own section, and the guard
reads all of it. A week with no forecast yet (Open-Meteo reaches 16 days) or no container
reachable says so on the run's first line and draws without.

## 5. What was measured and what still is not

- Refusal: 0 of 2 gpt-image-2 calls with the described superhero suit. (Study baseline for the
  *named* character: 11 of 12.)
- Identity: 5 of 5 probes held count, height order and hair across both models.
- Finder: 3 offered, 2 refused, both refusals correct and both explained above.
- Not measured: `giants`, `tiny`, the monster-truck roof, the winged horse, any context line in
  a generated picture (the wording was verified in `--print-prompt` and `--dry-run` only; the
  first live one is next Sunday's timer run), and the finder's look-alike rate on `busy-town`.

## 6. Nine more premises, written 2026-10-29 — each drawn once the same day (§6.5)

Brainstormed for the three (3, 5 and 7) and judged on three things: does a child point at it
from the sofa, does it read on a 21.5" panel from a few feet, and can the hard rules of §1 be
satisfied by construction rather than by hoping. Every entry below is in
`tools/scene-premises.json` with its own activity pool; the five that were there are
byte-identical (the pinned prompt fixture still passes, `npm run verify:*` all exit 0, and
`scene-week.py --dry-run --no-context --premise <id> --week 2026-W45` exits 0 for each).
Each was then drawn once by both models; the verdicts are in §6.5.

Two things to know before using one. The timer's director only offers premises listed in
`db/household.json` → `scenes.premises` (the example file lists `plain` alone), so a new one
reaches the wall by `scene-week.py --premise <id>` until the household adds it there. And every
premise except `parade` keeps the find-difficulty bands, exactly as `giants`, `tiny` and
`cutaway` do; `parade` sets `flat_scale` like `busy-town`, because a band that puts child 1
"well back, genuinely hidden" cannot lead a parade.

### 6.1 The brainstorm, one line each

1. **Toy-box world** — the place rebuilt out of toys at the children's size; peg dolls for people. *Kept.*
2. **Land made of food** — loaf hills, honey river, gingerbread people. *Kept.*
3. **Giant board game** — a path of coloured squares across the place, a shed-sized die, pawns for other players. *Kept.*
4. **Leading the parade** — the children at the head of a parade coming at the viewer. *Kept.*
5. **Underwater day** — the place flooded with clear sea, everyone carrying on. *Kept.*
6. **The stars come down** — constellation animals, made of joined points of light, playing on the ground. *Kept.*
7. **Painting the picture in** — the picture half-painted, the children holding the brushes. *Kept.*
8. **Every season at once** — the place in four side-by-side seasons, each child in a different one. *Kept.*
9. **A day with the dinosaurs** — every other person is a gentle dinosaur. *Kept.*
10. Sky-sea — fish and whales swimming through the sky overhead. *Rejected.*
11. Gravity-optional — everyone floating, the place drifting apart. *Rejected.*
12. Inside a snow globe — the place under glass on a base. *Rejected.*
13. A magic shop window — the children looking in through a lit window at the place. *Rejected.*
14. Knitted / chalkboard / glowing-at-night world. *Rejected (styles).*
15. Inside a giant object — a teapot, a pumpkin, a shoe. *Rejected (setting; near `tiny`).*
16. Storybook page — the scene inside a painted border. *Rejected.*
17. Puppet theatre / on stage — the place as a set with footlights and a curtain. *Rejected.*
18. Riding in bubbles — each child in a floating soap bubble. *Rejected.*
19. Hall of mirrors / kaleidoscope. *Rejected.*
20. Pop-up book — the place rising off an open page. *Rejected.*
21. Cloud kingdom / on the moon / dinosaur land. *Rejected (settings).*
22. Balloon world — everything inflated. *Rejected (a third "made of", one too many).*
23. Robot town — every other person a friendly robot. *Held back; same shape as dino-day.*
24. Shadow puppets. *Rejected.*
25. Totem / stacked / piggyback. *Rejected.*
26. One shared parade float. *Rejected.*

### 6.2 What was kept, and why

| id | Label | Families | Camera | The one risk to look at first |
|---|---|---|---|---|
| `toy-world` | A toy-box world | all | — | A peg doll painted with hair in a child's colour; the dog drawn as a plush toy. |
| `food-land` | A land made of food | all | — | "At the children's scale" read as "the children are tiny", which would make it `tiny`. |
| `board-game` | A giant board game | all | high-angle (pinned) | Print — a board game's props carry numbers in real life; the brief says plain squares, round dots, coloured wedges, and the rules say it again. |
| `parade` | Leading the parade | all | close-front (pinned) | A child given a band hat, or three drawn shoulder to shoulder in one rank. |
| `flooded` | An underwater day | all | — | Orientation: a model's "underwater" is a horizontal swimmer, and the finder refuses anything not upright. The layout says UPRIGHT twice and no activity floats. |
| `star-visitors` | The stars come down | all | — | A dark picture losing a brunette; a child drawn in the creatures' line-and-point style. The creatures are the light source on purpose. |
| `painting-it` | Painting the picture in | illustration, anime | — | A child standing in the unpainted part is pale lines on white; the layout keeps every child in the finished part. |
| `all-seasons` | Every season at once | all | — | The week's weather line arguing with three of the four slices (pair with `--no-context`); seams drawn as posts. Cast 2–4: there are four seasons. |
| `dino-day` | A day with the dinosaurs | all | — | A house-high dinosaur standing in front of a child; teeth and a roar. The brief says kind eyes and gentle smiles, and the layout says around and behind. |

Why these nine, in the terms of §1:

- **Identity made structural, four ways.** `toy-world`, `food-land` and `board-game` make every
  other person something with no hair at all (a peg doll, a gingerbread figure, a pawn);
  `dino-day` makes them dinosaurs; `parade` reuses the busy-town move and covers every other
  head. In each, the only hair in the frame belongs to the children by construction, not by
  instruction. `flooded`, `star-visitors`, `painting-it` and `all-seasons` keep the default
  "nearest and largest" rule and change the picture around the children instead.
- **Cells for the finder.** `board-game` (one child per square, empty squares between),
  `all-seasons` (one child per slice) and `parade` (a loose line across the front) each give
  the finder three targets that cannot overlap, the way the cutaway's rooms do.
- **The activity dealer does the work.** In `all-seasons` the activity pool's `family` IS the
  season, so "at most one activity per family" deals each child a different season for free
  and the layout says a child stands in the season her activity belongs to.
- **The 225-nit panel.** `star-visitors` is the only night premise, and its creatures glow
  "as if by a full moon" so that hair colour — the identity — survives the dark.
- **Three "made of" premises would be two too many** — toy, food and balloon all swap the
  material of the place. Toy and food stayed because they are the two a three-year-old names
  unprompted; balloon went.
- **Describe, never name**, throughout: no dinosaur species, no board game, no film. The
  dinosaurs are "long-necked", "three-horned", "spiky-backed", "small feathered"; the game is
  squares, a die, a spinner and pawns.

### 6.3 What was rejected, and the rule each broke

| Idea | Rule |
|---|---|
| Sky-sea (fish overhead) | `RULES_V2` owns the top strip of every picture — open sky with at most a bird, a star or a hill. A premise that fills the sky contradicts the rule block that follows it. |
| Gravity-optional / floating | Orientation. Floating bodies tilt and turn, and the finder reads any non-upright pose as a head on backwards (§1 limit 3, the handstand). |
| Snow globe | Glass between the viewer and the children, lettering on the base in every reference image, and a round picture in a 16:9 frame; what is left is `tiny`. |
| Magic shop window | Lettering on the glass and the fascia; glass over the faces. |
| Knitted / chalkboard / glowing night | Styles, not premises — they change how it is drawn, not what kind of picture it is. Chalk also fails the panel (dark ground). |
| Inside a giant object | A setting (and a `tiny` variant); goes in `scene-settings.json` if wanted. |
| Storybook border | "The border is a noun" (§3). A rule describing a border draws a border, and the border carries lettering. |
| Puppet theatre / stage | A marquee is lettering; a stage is a cutaway with a curtain; footlights put faces in shadow from below. |
| Riding in bubbles | Behind glass, and a bubble turns — orientation again. |
| Mirrors / kaleidoscope | Reflections are look-alikes by definition, and the finder refuses a look-alike. |
| Pop-up book | The open page carries lettering, and the picture is seen at an angle. |
| Cloud kingdom, the moon, dinosaur land | Settings, not premises; the moon needs a helmet. |
| Shadow puppets | Silhouettes have no hair colour and no face — fails limits 2 and 3. |
| Totem / piggyback | No child carrying another. |
| One shared float | A shared vehicle fights limit 4; `parade` gives each child their own thing to do instead. |
| Robot town | Held back, not rejected: it is `dino-day` with a different crowd and the two should not land in the same week. Write it if dino-day draws well. |

### 6.4 What has NOT been measured

Before the first draws (§6.5), everything. Those draws answered most of it, once each: peg dolls
and gingerbread people came back without hair; `flooded` came back upright on both models;
`all-seasons` drew four clean slices on both; `star-visitors` held hair colour in the dark on
both; and the finder boxed a child on the board-game squares and in a season slice. What one
draw per model cannot say is how often any of that holds, and nothing yet says whether a CHILD
finds herself in these pictures. That second question is the one that counts.

### 6.5 First draws, 2026-10-29

One forced `scene-week.py --no-context --premise <id> --setting <s>` run each (both models,
one brief), $1.80 in all. Eleven of eighteen pictures passed the finder and went to the panel as
candidates; at least one picture of every premise passed, and `star-visitors` and
`painting-it` passed on both models. Each of the seven refusals was looked at by eye, and the
three that looked wrong to refuse had the finder alone re-run on them (cents): all three were
refused again, for the same reasons.

| Premise | Setting (style) | gpt-image-2 | nano-banana-2 |
|---|---|---|---|
| `toy-world` | big-library | candidate | refused: slots 1/2 swapped (eldest drawn far back and small) |
| `food-land` | castle-village (claymation) | candidate | refused, rightly: the claymation children are not ours |
| `board-game` | autumn-forest | candidate | refused, rightly: middle child tiny at the top of a slide |
| `parade` | lantern-night-market | refused: look-alike answer unreadable, twice | candidate |
| `flooded` | dragon-shore (dreamlike) | candidate | refused: middle child cut off by her box (on a seahorse), twice |
| `star-visitors` | lamppost-wood | candidate | candidate |
| `painting-it` | harvest-market | candidate | candidate |
| `all-seasons` | alpine-lake | refused, rightly: the boy drawn TWICE | candidate |
| `dino-day` | rainy-market-street (house) | refused: locator failure, twice | candidate |

What the draws taught:

- **`all-seasons` had a hole and gpt-image-2 found it.** Four slices, three children: it filled
  the spare season by drawing the youngest a second time, and the look-alike check refused the
  copy (142% of his height, a boy in a blue jacket by a snowman). nano-banana-2 left the fourth
  season to two small strangers far off, which is the right answer. The layout now says each
  child is in the picture exactly once and that a season without one holds only the place
  and a few small strangers far off. Not yet redrawn.
- **`parade` on gpt-image-2 is the 2026-10-27 Halloween-party failure again.** The picture is
  clean (three children at the front, hatted bandsmen behind), but the look-alike nomination
  is asked to list every other child, and a parade crowd ran past `LOOKALIKE_MAX_TOKENS` on
  both attempts. A premise built on a crowd will meet this cap every time. Raising it again,
  or reading a cut-off list, is a decision about the finder rather than about this premise,
  and has not been taken.
- **`dino-day` on gpt-image-2 refused on geometry that the eye does not see**: all three faces
  are plainly visible, yet the locator reported two of them hidden and one in the wrong portrait.
  The likeliest cause is the child-sized dinosaurs, which wear clothes and stand beside each
  child. The same refusal came back on a second run, so this is the locator's reading of this
  picture rather than noise.
- `toy-world`'s peg dolls and `dino-day`'s dinosaurs did their job: no look-alike refusal
  in either, which is the structural identity move working as designed.

**Prompt fixes, 2026-10-30, not yet redrawn.** Each refusal above got a change in the
premise's own words, described as what should be there rather than as what must not be:
`toy-world` keeps every child upright or sitting up straight (the crouched, far-back eldest
was the slot swap) and its top-spinning activity no longer bends a child double; `food-land`
says the children are drawn as their portraits show them and are the only things in the land
not made of food; `board-game` puts all three on the near half of the board and lands the
slide child at its foot rather than high on it; `parade` says every marcher and onlooker is a
grown-up, so the look-alike nomination has no crowd of children to list; `flooded` gives each
child a whole body in clear water with nothing in front of it, and every ride became walking
or standing beside the creature; `dino-day` stands each dinosaur beside its child, dresses
every dinosaur only in its own scaly skin, and turned the ride into leading one by a rope.
The locator swap and the band-driven depth are made less likely by these, not ruled out.
The first `food-land` rewording said "real children" and `prompt_guard` refused it as a
likeness request before any spend; the committed wording does not.
