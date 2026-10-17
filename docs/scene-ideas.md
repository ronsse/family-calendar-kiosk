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
| 4 | Clear ground between the three (≥ 1/10 width; 16 px inert gutter) | `fit_gutters`, the tap gutter | Three on one dragon; two carrying one basket in a crowd picture. |
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

### 2.2 Verdict per idea the household raised

| Asked for | Answer |
|---|---|
| Where's Waldo | `busy-town`. Works as a picture (probe 2). Blocked as navigation until the finder refuses look-alikes (§2.1). Never at true Waldo scale — limit 1. |
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
fights limit 4 unless each child has her own float).

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
