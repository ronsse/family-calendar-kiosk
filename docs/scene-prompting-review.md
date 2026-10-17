# Scene prompting review — the prompt, the cast, and the mechanism around them

**2026-09-12.** Asked: *"elaborate the prompts, improve the prompting system, and look at the
overall design and see if there's ways for improving that mechanism."* With the household's
correction of the day before standing over it: identity is **relative size and hair**; clothes,
faces and poses *should* vary; small errors like eye colour do not matter; the avatar on the
dashboard only needs to be *"kinda like me"*; and a doubt about whether the verification step is
the right path at all.

Everything below was measured on fal.ai with the real cast file and the real avatars, twelve
scenes and about a dollar. The pictures are in the session scratchpad (`ab/`), not in the repo.

---

## 0. The short version

1. **The prompt was rewritten (v2) around what identity actually is.** Count, height order and
   hair are stated once each as facts about three particular children; ages are given; heights
   are given as *body landmarks* ("the top of her head comes up to child 1's chin") computed
   from a cast file; clothes, expressions and poses are explicitly the model's to invent. Eye
   colour is gone. 746 words against v1's 911, in eight labelled sections instead of one run-on
   paragraph. v1 survives as `--prompt-version 1` until the measurement has been repeated once.
2. **The cast is a file now** — `db/cast.json` (real, gitignored) with `db/cast.example.json`
   (synthetic, committed) — and the generator and the finder read the *same* one. Before this
   the roster lived as prose in two scripts and the finder's idea of the children was a
   description of the *avatars*, eye colour included.
3. **Both prompt versions hold the cast on both models, twelve for twelve.** That question is
   closed. What v2 measurably improves is height order — v1 drew three same-sized children
   once in four and made the middle child the eldest's height once more; v2's four were all
   right by eye — and, less measurably, the thing the household asked for: every one of the
   twelve wardrobes is different.
4. **Two defects found by measurement, both fixed in code, neither about identity:**
   - **nano-banana-2 draws what the rules name.** The old top-strip rule said *"small labels
     float there"* and it painted labels: a flat beige band, a white pill, two blank white
     signs — three of its four pictures. gpt-image-2 ignored the same words. The rule now
     describes the sky and mentions nothing that will be laid over it. Four nb2 scenes on the
     new wording: no band, no labels.
   - **The finder refused the two best pictures of the morning over padding.** Three children
     walking abreast — the grouping every photograph of three children has — measured a 1px
     and a 5px gap between two targets the finder had itself just grown to 96px. The children
     were not touching; the padding was. `fit_gutters` now trims a target sideways, never
     under the 64px absolute floor and never by more than 32px a pair, and refuses exactly as
     before when that is not enough. Both pictures pass; a figure drawn across a figure still
     does not.
5. **The verification step is the right path, and the doubt was aimed at the wrong thing.**
   §4 is the argument. In one line: the finder is the *tap-region locator* — without it the
   wall does not know where the children are — and its identity check costs $0.003; the
   awkwardness that prompted the doubt came from a text-only model that could not hold the
   cast, which the fal models do. What the finder must not be is a taste gate, and the change
   above is it giving back a job it had taken.

---

## 1. What the prompt is for

The wall's home screen is a search-and-find picture. A child finds *herself* in it and taps
herself to open her own screen. That sets the contract for the prompt, and it is narrower than
"a consistent character":

| the picture must | because |
|---|---|
| show exactly three children, in front, and larger than anyone else | a fourth child is a wrong tap; a background child is an invisible one |
| keep the **height order** — eldest tallest, youngest smallest, plainly | the pre-reader tells himself apart from his sister by *smaller* before anything else |
| keep the **hair** — brown in braids, long blonde, short blonde | the one channel that survives every style, including crayon and photoreal |
| give each a **visible face**, clothed, mostly whole | the tap target is a person, not a hat |
| leave the top quiet | the wall floats its chrome there |

And the contract deliberately does **not** cover clothes, expressions, poses, exact faces, eye
colour or build. Those varying week to week is the household's stated wish and is also what
keeps the mechanic honest: *"by day two they'll know who they are in the image"* is a skill the
children are learning, and it is learned on hair and size, not on a red hoodie.

The avatars fix the *reference* the children match against — they are on the rail beside the
picture — and the prompt fixes the *facts*. Both models take the avatars as image inputs, so
the prompt does not need to describe the avatars; it needs to say what they leave out. Avatars
are head-and-shoulders: they carry hair and age and nothing about **size**. Size is the whole
job of the text.

## 2. What was wrong with v1

`tools/gen-scene.py`'s v1 prompt (911 words) had grown by accretion since 2026-09-02 and every
clause in it was there for a reason that was true at the time. Read against the contract above:

- **It described the avatars back to the model.** Hair *and eye colour* ("hazel", "blue") from
  the avatar table, when the model has the avatars in front of it and the wall does not care
  about eyes. Eye colour also fed the finder's identity check, where a wrong-coloured eye at
  40px on the glass was a reason to refuse a picture.
- **Height order was one clause among forty**, phrased as a relation ("tallest ... smallest")
  with no *magnitude*. Nothing told the model how much smaller. Measured: nano-banana-2 drew
  three same-sized children under v1 once in four.
- **Rules were restated and negated.** "NO text, NO letters, NO numbers, NO frame, NO border
  box" then "every sign, flag, banner, board and box in the picture is a blank unlettered
  shape" — which names five things to draw. The top-strip rule explained *why* ("small white
  labels float over that corner") and nano-banana-2 drew the labels.
- **Crowd strings said "children".** Several settings' `crowd` lists include "children with
  balloons" or "children on sledges", and the count rule ("exactly three children") fought
  them. The pictures mostly won that fight on gpt-image-2 and it was still a fight.
- **It named the children by portrait inside the activities** ("the child from portrait 2
  ..."), which is a dangling reference on the text-only path.
- **Ages lived in prose in two scripts** — not in a file, not shared with the finder, and
  prompt_guard (which had allowed ages since 2026-09-03) was checking nothing about them
  because nothing structured carried them.

None of this was wrong when written. It was the shape of a prompt that had been *patched*
against failures rather than *written* against the contract.

## 3. v2 — what changed and why

### 3.1 The cast file

`db/cast.json` (real, gitignored) / `db/cast.example.json` (synthetic, committed):

```json
{ "slot": 1, "avatar": "assets/avatars/a.jpg", "sex": "girl", "age": 7, "height_cm": 122,
  "hair": "mid-brown hair, usually in two braids", "eyes": "light green" }
```

`tools/scene_cast.py` renders it three ways, and **both the generator and the finder call the
same three functions**, so the model that draws and the model that locates are told the same
children in the same words:

- `roster_lines` — *"1. The eldest (portrait 1): a girl of 7 with mid-brown hair, usually in
  two braids."*
- `height_lines` — the relative sizes as body landmarks, from the height ratios:
  *"Child 2 is shorter: the top of her head comes up to child 1's chin. Child 3 is much the
  smallest: the top of his head comes up to child 1's chest, and to child 2's chin. Keep that
  order however they are posed — standing, sitting, crouching or mid-air."*
- `finder_lines` — the same facts in the finder's voice: *"the eldest and tallest of the
  three, a girl with mid-brown hair, usually in two braids"*.

Why landmarks and not centimetres or percentages: an image model has no ruler and the pictures
have no scale, but "comes up to her chin" is a thing a painter can *draw*. The landmark table
(0.93 → eyes, 0.87 → chin, 0.82 → shoulder, 0.72 → chest, 0.63 → elbow, 0.58 → waist) is the
only piece of the prompt that is arithmetic, and it is the piece the household can improve
with a tape measure: the real heights are **estimated from age** today
(`height_source: "estimated from age (CDC 50th percentile)"`) and the file says so.

`eyes` is in the file because it is true, and in **no** prompt and **no** check, because the
household said it does not matter and the measurement agreed.

### 3.2 The prompt

Eight labelled sections, each rule once, positive phrasing, and the model told what is its own:

```
SCENE          <frame noun for the style family> <the setting>
CAMERA         <composition>
THE THREE CHILDREN
               Three particular children are the subject of this picture:
                 1. The eldest (portrait 1): ...
                 2. The middle one (portrait 2): ...
                 3. The youngest (portrait 3): ...
               Their ages show in their size and the difference is plain at a glance. ...
               Their hair is exactly as described and as the portraits show ...
               Their clothes, their expressions and what they are doing with their hands
               are yours to invent for this picture ...
               The portraits show who they are, not what they wear ...
               They are the three nearest and largest children in the picture ...
WHAT THEY ARE DOING
               <activities>
LAYOUT         about a quarter of the frame's height each, faces toward the viewer, a
               clear gap of at least a tenth of the picture's width between any two
EVERYONE ELSE  <crowd> ... everyone fully clothed ... <the dog, hiding>
STYLE          <style> <palette>
RULES          the top of the picture is the quietest part of it ... no writing anywhere
```

`--print-prompt` prints it, with word count, version, provider and model on stderr, and runs
prompt_guard on it first — so the prompt can be read and refused without spending anything.

Three wording decisions worth recording:

- **"The three nearest and largest children"** rather than "exactly three children" — the
  crowd strings mention other children and the count rule used to contradict them. The
  wall's rule is really *these three are the ones in front*; that is now what it says.
- **"Yours to invent."** The household's variety request as an instruction, not an absence.
  v1 never said clothes could vary; it just did not fix them, and the models drifted toward
  the avatars' colours (magenta, amber, blue). v2's twelve wardrobes: no two alike.
- **The sky, not the strip.** *"The top of the picture, right across its width, is the quietest
  part of it: open sky or a plain ceiling in one smooth wash of colour, with at most a bird, a
  star or a distant hill in it."* Describes what should be there. Names nothing that should
  not. (Indoor settings exist — the workshop, the library — hence "or a plain ceiling".)

## 4. The mechanism — is the verification step the wrong path?

The household's doubt, quoted: *"the verification step ... was introduced by one picture that
had the kids looking backwards ... maybe a correct image generation mechanism wouldn't
introduce that kind of awkwardness."*

Two things are being called "verification" and they deserve different answers.

**The finder (`scene-regions.py`) is not optional and is not a quality gate.** The wall needs
four numbers per child — where to put the tap target — and the picture does not come with
them. Regions were hand-measured for the first committed scenes; with weekly generation and
dynamic activities they cannot be. So a vision model looks at the picture and the avatars and
says where each child is. That is the finder's job and there is no version of this feature
without it. Its identity pass (crop each box, *"is this the blonde one?"*) exists because a
box on the wrong child is the one failure a child cannot recover from — she taps herself and
gets her brother's screen — and it costs $0.003.

**The awkward picture came from the model, not from the check.** The backs-turned scene was
NVIDIA FLUX.1, text-only, which could not hold the cast at all (four children, two children,
all blonde — measured 2026-09-11). The finder refusing it was the finder working. The models
in the allowlist now — nano-banana-2 and gpt-image-2 with the avatars attached — held three
faces-to-camera children in twelve of twelve today. So the household's instinct is right in
substance: **a model that holds the cast removes most of what the check used to catch.** The
check stays because what remains is exactly the failure that is invisible until a child taps.

**Where the finder had overreached, and now does not.** Reading the morning's eight verdicts:
every refusal was a *geometry* refusal, none an identity one, and both refusals were the two
best pictures. The finder was measuring padding against padding and calling it a collision.
That is a quality gate it had grown by accident, and `fit_gutters` gives that job back to the
person holding the PIN: the finder locates, fits the targets to the wall's rules, and refuses
only what genuinely cannot be tapped. Taste — *is this a good picture of my children* — was
always the approver's, and two candidates a week is what makes that a choice instead of a
yes/no.

**What I would not do:** add a "looks awkward" check. Every heuristic of that kind this project
has tried (eye colour, clothing match, and the gutter as it stood) refused good pictures and
would not have caught the FLUX one — the FLUX one failed on *count*, which the finder already
checks. The right defence against awkwardness is the allowlist: only models measured holding
the cast may draw scenes, and `fal_api.MODELS` is that list.

### 4.1 Design changes made

| change | where | why |
|---|---|---|
| cast file + renderer shared by generator and finder | `db/cast*.json`, `tools/scene_cast.py` | one source of truth for who the children are; heights become data |
| prompt v2, sectioned, single-statement rules | `gen-scene.py build_prompt_v2` | §2, §3 |
| sky rule names nothing to draw | `gen-scene.py RULES_V2` | nb2 drew the "labels" and "strip" it was told about |
| finder matches on hair + apparent age/size; clothing and eyes ignored | `scene-regions.py verify_identity` | the household's definition of identity |
| `fit_gutters`: targets trimmed sideways to open a gutter, ≥64px, ≤32px a pair | `scene-regions.py` | padding is not a collision; the child is what you look for, the target is what you touch |
| box order pinned to Gemini's `[ymin,xmin,ymax,xmax]`; `sane_box` refuses transposed boxes | `scene-regions.py` | Qwen returns the other order and every box lands on grass |
| `fal_api.py` is the one door to fal: allowlist, price table, ledger | `tools/fal_api.py` | no balance API; the ledger is the balance; an unmeasured model cannot draw a scene |
| two candidates a week from two models, ids `-gpt` / `-nb2` | `scene-week.py` | approval becomes a pick |

### 4.2 Design changes proposed, not made

1. **Let the approvals choose the default model.** Scene ids carry the model. Once a few weeks
   of approvals exist, the pick rate per model is a query, and the household's own taste —
   not my probe — decides which is the default and whether the second candidate is still
   worth $0.12. Cheap to add when there is data; nothing to add before.
2. **Measure the children.** The single biggest improvement left to the prompt costs a tape
   measure: `height_cm` from measured heights, `height_source: "measured 2026-…"`. The
   landmark sentences recompute themselves.
3. **Photographs → text, once.** Full-length photos, outside the repo, looked at once to
   refine the `hair` lines and build (the one thing avatars and prose both leave out).
   Photographs never go to a model; that line is in code and stays.
4. **A cast sheet as a fourth reference** — the three full-length, side by side, in the house
   style, generated once and committed — if height order slips again. Designed in the imagery
   plan §3.1; today's v2 results say it is not needed yet. Measure before keeping.
5. **A better height instrument.** The finder reports bounding boxes and a box confounds size
   with depth and pose (a boy running toward the camera has the tallest box in the picture).
   Asking the finder for head-top and feet per child, or simply "is the height order correct
   at the depth they stand", would make the height claim measurable instead of eyeballed.
6. **Keep the prompt beside the picture.** A rejected candidate cannot be diagnosed without
   the prompt that made it. A `.prompt.txt` next to the jpg, in the generated-scenes directory
   (household data, so not under `assets/`).
7. **Delete v1** after the A/B has been run once more on a different setting. Two versions
   is a measurement, not a feature.

## 5. Measurements

Setting `autumn-forest`, composition `eye-level`, seed 7, the real cast, the three avatars.
Heights are the finder's bounding boxes in logical px (960×540); "by eye" is the height
*order* as a person sees it, which the boxes do not reliably capture (§4.2.5).

### 5.1 Round 1 — v1 vs v2, two models, two styles

| scene | eldest | middle | youngest | cast held | order by eye | finder | top of picture |
|---|---|---|---|---|---|---|---|
| house · gpt · v1 | 319 | 252 | 247 | ✓ | ✓ | offered | clean |
| house · gpt · v2 | 313 | 239 | 249 | ✓ | ✓ (boy forward) | offered | clean |
| house · nb2 · v1 | 235 | 222 | 230 | ✓ | **✗ three of a size** | offered | **white pill** |
| house · nb2 · v2 | 221 | 194 | 175 | ✓ | ✓ clean stairs | offered | **beige band** |
| photoreal · gpt · v1 | 336 | 327 | 299 | ✓ | **✗ middle = eldest** | offered | clean |
| photoreal · gpt · v2 | 314 | 345 | 323 | ✓ | ✓ (boy running to camera) | refused 5px gutter → **now offered** | clean |
| photoreal · nb2 · v1 | 335 | 274 | 248 | ✓ | ✓ | offered | **two blank white signs** |
| photoreal · nb2 · v2 | 329 | 264 | 233 | ✓ | ✓ clean stairs | refused −2px gutter → **now offered** | clean |

Real ratios from the cast file: middle/eldest 0.89, youngest/eldest 0.78. The two v2 nb2
scenes measure 0.88/0.79 and 0.80/0.71 — the closest of the eight to the real figures.

Findings: cast held 8/8 on both versions; height order wrong by eye 2/4 under v1, 0/4 under
v2 (small sample, one setting, one seed — repeat before believing the zero); nb2 drew the
named top-strip artefact 3/4 under either version; both refusals were geometry, both on good
pictures, both now pass with trimmed targets (147px and 79px wide on 323px- and 233px-tall
children).

### 5.2 Round 2 — the rewritten RULES block

Same setting, seed and cast; the sky rule as it now stands; nano-banana-2 three times because
it is the model that drew the artefact, and gpt-image-2 once so both have an anime sample.

| scene | eldest | middle | youngest | cast held | order by eye | finder | top of picture |
|---|---|---|---|---|---|---|---|
| house · nb2 | 255 | 242 | 195 | ✓ | ✓ | offered | clean |
| photoreal · nb2 | 332 | 285 | 201 | ✓ | ✓ clean stairs | offered (one target trimmed) | clean |
| anime · nb2 | 260 | 218 | 195 | ✓ | ✓ clean stairs | offered (two trimmed) | clean |
| anime · gpt | 362 | 320 | 247 | ✓ | ✓ | offered | clean |

Four of four clean at the top on the model that had drawn the artefact three times in four;
cast held 12/12 across both rounds; height order right by eye 8/8 under v2. Three of the four
were offered only because `fit_gutters` opened a gutter — under the morning's rule this round
would have refused three good pictures out of four. The anime rows are the first measurement
of that style on either model with the real cast: both hold it, and `anime` is now a real
row in the rotation rather than a probe.

## 6. Cost

Twelve generations and the finder's passes on each: **$1.20 at list price** (`python3
tools/fal_api.py`). Weekly running cost with two candidates: ~$0.20.

## 7. What the household can do that I cannot

- Measure the three children and put the numbers in `db/cast.json`.
- Say whether `photoreal` belongs on the wall at all (imagery plan §8.2). It works; whether
  a photograph of invented children who match the cartoons is what a family wall should show
  is taste, not engineering.
- Approve for a few weeks and then let the picks set the default model (§4.2.1).
