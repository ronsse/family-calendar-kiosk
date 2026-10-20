# Scene inputs — what the household can supply to make the pictures better

**This is the list you asked to keep.** Each row is a thing only the household knows, where it
goes when you have it, and what it changes. Nothing on it is needed for the wall to work; every
row makes a specific thing better. Tick them off in whatever order is easy.

Ground rule that does not move: **no photograph of a child ever reaches an image model.**
It is not a promise, it is a mechanism: `prompt_guard.enforce_references` refuses any attachment
that is not *both* inside `assets/` *and* tracked by git, so a photograph cannot be substituted
for an avatar even by a caller who wants to. **This is why the photos live outside `~/projects`
and why nothing will ever move them in.**
Photos are looked at once, by a person or by Claude in this repo, to write *text*; the text
goes in `db/cast.json` (gitignored) and the photos stay outside the repo. Reversing that is an
ADR, not a flag ([ADR-0002](decisions/0002-image-generation.md)).

## The children

| # | Input | Where it goes | What it changes | Status |
|---|---|---|---|---|
| 1 | **Measured heights**, in inches, each child, with the date | `db/cast.json` → `height_cm` per child (inches × 2.54), and set the top-level `height_source: "measured YYYY-MM-DD"` | The prompt's body-landmark lines ("comes up to child 1's chin") are estimated from age today. Measured, they stop drifting as the children grow, and the 5-year-old stops being drawn as tall as the 7-year-old. | ☑ **2026-09-16** — measured. Every estimate was 8–9 cm low (CDC 50th percentile; these three are consistently above it), but **proportionally** right: all three ratios moved less than a landmark band, so the prompt's sentence is unchanged. The value is that it stops drifting now. |
| 2 | **Three to five full-length photos per child**, recent, plain background, kept OUTSIDE the repo (e.g. `$WALL_DATA_ROOT/cast-photos/`) | Viewed once → words in `db/cast.json`: hair colour and length *as it is now*, usual style (braids / ponytail / loose), build, anything distinctive (glasses, a fringe) | The roster line the model reads. The hair phrase is doing the identity work; if the hair changed (a cut, a new colour) the prompt is describing a child who is no longer there. | ☑ **2026-09-16** — two each (front + side profile), now at `$WALL_DATA_ROOT/cast-photos/`. `hair` rewritten on all three and a `looks` build clause added. Still open: **full-length** frames, which is what build and proportion actually need; these are head-and-shoulders. |
| 3 | **A hair update whenever it changes** — a cut, a new usual style | `db/cast.json` `hair` **and the matching avatar** | Same as 2. Hair is the identity channel; a haircut is a prompt change — and the avatar is the *stronger* half of that channel, because it is attached to the model as a reference where the text is only read. | ☐ recurring |
| 4 | **What each child is into right now** — the three things they would want to be doing in a picture | `tools/scene-activities.json` `solo` (with a `family`), or a new pool in `tools/scene-premises.json` for the impossible things | The activity pool was written by the household once (2026-09-02). Refreshing it is what keeps the pictures theirs. Anything upside-down (handstand, cartwheel) gets refused by the finder — say what they like, and it gets phrased upright. | ☐ recurring |
| 5 | **Things that must never appear** | `tools/prompt_guard.py` POLICY, or the `_comment` of the table concerned | Fears, foods, anything a particular child would hate to be drawn with. The guard refuses; the tables never offer. | ☐ |

## The place and the week

| # | Input | Where it goes | What it changes | Status |
|---|---|---|---|---|
| 6 | **Confirm the weather grid point** — `db/scene-place.json` is seeded with a 0.1° grid point and a timezone | `db/scene-place.json` (gitignored; `db/scene-place.example.json` is the template) | One decimal is a few miles; if that is the wrong few miles the "cold and snowy" sentence is someone else's week. | ☐ verify |
| 7 | **The `scene:` note convention** — an all-day event whose title starts `scene:` on any calendar the wall syncs, e.g. `scene: grandparents visiting, a big yellow dog` | Nothing to install; write it on the calendar for the week | The one channel where a person tells the picture something. Everything after the marker goes in verbatim (guarded), so write it for the painter: nouns, not plans. | ☐ try once |
| 8 | **Which calendar categories may become props, and what** | `tools/scene_context.py` `PROPS` | Today: sport, dance, school, celebration, travel, outing, music, kitchen; medical and hygiene deliberately silent. Change the words, add or strike a row. | ☐ review |
| 9 | **The holiday list** — which ones matter here and what they look like at your house | `tools/scene_context.py` `HOLIDAYS` | Halloween, Christmas, New Year, Valentine's, St Patrick's, 4th July, Easter, Thanksgiving are in. A birthday is NOT — that is a `celebration` count (row 8) and never a name. | ☐ review |

## What kind of pictures are allowed

| # | Input | Where it goes | What it changes | Status |
|---|---|---|---|---|
| 10 | **Is photoreal allowed on the wall?** `impossible-photo` is the strongest probe of the day and it is photoreal by definition. | A yes/no; then `scene-week.py --premise impossible-photo` for a week, and if it stays, a rotation rule | It is a different picture of the children than a cartoon is — a realistic 7-year-old in a superhero suit on the living-room wall is a decision, not a default. | ☒ **NO — reversed 2026-09-18, after a week of it.** The children came back as near-misses of themselves: right hair, right height order, a face that is almost but not theirs. That is worse than a drawing, which never pretended — the uncanny valley landing exactly where this row warned it might. **The style and the `impossible-photo` premise are deleted**, and `scene-week.check_tables` refuses to run if either comes back, so re-enabling it means changing this row first. The cartoon avatars stay; identity was always count, height order and hair. 
| 11 | **Which premises may rotate unattended** | `scene-week.py` (today every premise is opt-in by flag; the timer draws `plain`) | The finder has a look-alike check (2026-10-20); `busy-town` can join after one probe against the current avatars; `giants` and `tiny` after one probe each ($0.12). | ☐ later |
| 13 | **A `wardrobe` for a setting** — what the children would wear in that place | `tools/scene-settings.json`, `wardrobe` on the row | Added 2026-09-16: five settings dress the children for the theme. The clause forces a DIFFERENT outfit each and an unobscured face; the verify pass refuses a hidden face. A setting with no `wardrobe` keeps weather-appropriate clothes. | ☐ ongoing |
| 12 | **Styles you want tried** — claymation, paper cut-out, felt, chalk, watercolour, comic | `tools/scene-styles.json` (one row, `family` set) and one $0.12 probe | Each is a week's look. Dark grounds (chalk) must be judged on the panel, not a laptop. | ☐ optional |

## How to hand any of this over

Text and numbers: edit the file named in the row, or tell Claude the values and say which row.
Photos (row 2): put them in a folder outside `~/projects`, say where, and say "derive the cast
text". They are read once and never copied in.

## What the 2026-09-16 photos changed

The text was wrong in the place the design says matters most, and the **avatars were wronger**.
Hair is the identity contract (2026-09-12), and of the three portraits every scene is
conditioned on, two describe a child who is not there:

Slot 1 had the wrong style (pigtails against hair worn loose), and slots 2 and 3 had the wrong
shade (pale blonde against a darker, warmer colour). The real descriptions live only in the
gitignored `db/cast.json`.

The text half is fixed. The avatar half is three `tools/edit-avatar.py` runs and is the higher
-leverage half: the portraits are *attached* to the edit models, which copy them, where the
roster line is only read. Fixing the words without fixing the pictures leaves the two channels
disagreeing, and the attached one wins.

*Written 2026-09-13 with [`scene-ideas.md`](scene-ideas.md). Rows 1–3 came from the 2026-09-12
identity correction: relative size and hair are the contract; clothes, faces and eye colour are
meant to vary.*
