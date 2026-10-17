# Prompts for scenes and bands

`tools/backgrounds.md` is the operational half of image generation here: the model, the
endpoint, the consistency levers, the post-processing, and the two rules that are not
negotiable. **This file is the wording half.** It extends that document and contradicts it
nowhere except where the code has moved on underneath it, which is called out by name in
§9.

Read `tools/backgrounds.md` first. Everything below assumes it.

---

## 1. Two kinds of picture, and the prompt for one will ruin the other

**A scene** (`assets/scenes/`) is a full-bleed search-and-find home screen. `SceneView` draws it
with `backgroundSize: 'cover'` against the whole 960x540 wall, so it is 16:9 and it is
**deliberately busy**. It contains many generic cartoon figures, three of which are drawn big
in the foreground so a child can find themselves and tap. Busy is the point: the picture is the
navigation, and a child walks up to it at arm's length.

**A band** (`assets/backgrounds/`) is a 208px strip along the bottom of the IDLE information
board, and nowhere else. It is **deliberately sparse**. Cards sit on top of it, and a
half-covered object reads as a bug rather than as decoration. Sparse is the point.

The two have opposite failure modes. A scene that comes back sparse is boring; a band that
comes back busy is broken. Do not carry wording between them, and in particular do not carry
the band's scale clause into a scene — it will flatten the crowd that makes the scene work.

**On people: the rule is scoped to bands, not to the house.** `tools/backgrounds.md` says "No
people. Not a silhouette, not a figure in the distance." That was written on 2026-08-26 when
the band was the only illustrated asset in the repo, and its reasoning is entirely about
occlusion — *"a figure needs to be whole to read, and there is nowhere on this wall that
reliably leaves a figure whole."* Scenes shipped the next day and are **required** to contain
figures; the whole interaction is finding yourself among them. Nothing occludes a scene except
two floating doors in one corner. So: **no figures in a band, ever. Many figures in a scene,
always.** ADR-0002's disclosure test is unchanged and applies identically to both — an
archetype is fine, this household is not.

---

## 2. What actually makes these prompts work

Six things, researched. Where the repo already knew something I say so; where I could not
verify a claim I say that too (§2.7).

### 2.1 Prohibition is the weakest instruction in the prompt, and our scaffold ends with four of them

The style paragraph closes with *"Absolutely NO text, NO letters, NO numbers, NO frame, NO
border box."* That construction is the one the literature is most consistently negative about.
The mechanism is in the text encoder: it was trained to associate tokens with visual concepts,
not to represent the absence of one, so `no X` and `X` land close together and the model
frequently renders the thing you forbade — [research on negation-aware CLIP
training](https://arxiv.org/pdf/2505.18434) and [work on negative prompts in one-step diffusion
models](https://arxiv.org/pdf/2412.02687) both start from that failure. Ideogram's own
documentation states it plainly and gives the fix: replace the negation with *"the positive
visual opposite of the thing you want to exclude"* — `no people in the room` becomes `an empty
room with chairs neatly arranged`
([Ideogram, Handling Negatives](https://docs.ideogram.ai/using-ideogram/getting-started/prompting-guide/4-handling-negatives)).
Google says the same thing about its own model in one line: *"Use positive framing: Describe
what you want, not what you don't want (e.g. 'empty street' instead of 'no cars')."*
([Ultimate prompting guide for Nano Banana](https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana)),
and the DeepMind prompt guide is built entirely on affirmative description
([How to create effective image prompts with Nano Banana](https://deepmind.google/models/gemini-image/prompt-guide/)).

**So do we delete the NO clause? No — pair it.** Two reasons to keep it. First, the eleven-icon
set and both committed illustrations came back clean with it in place, so on this model it is at
worst harmless. Second, `google/gemini-3-pro-image` is not a bare CLIP-conditioned diffusion
model; it is an instruction-following multimodal model, and instruction following is exactly
where the negation research does not straightforwardly transfer. The honest position is that we
do not know how much of the clean output is the negation and how much is the reference images.

**The rule this file adds: never let a prohibition stand alone.** Every `NO x` gets a sentence
saying what occupies that space instead. Concretely, for text:

> Absolutely NO text, NO letters, NO numbers, NO frame, NO border box. **Every sign, flag,
> banner, board and box in the picture is a blank unlettered shape.**

That second sentence is the one doing the work, and it matters more now than it used to.
Nano Banana Pro's headline improvement over its predecessor is text rendering — it is being
sold on being good at putting legible words in pictures. A model that is eager to letter things
is a model that will letter your treehouse flag unless you tell it the flag is plain.

### 2.2 Aspect ratio is controllable. It is our plumbing that drops it

`tools/backgrounds.md` says *"Aspect ratio is not controllable. The same prompt returns
2064x512 or 1408x768 at random."* The observation is real; **the diagnosis is wrong, and the
consequence is that we have been post-processing around a fixable problem.**

Gemini 3 Pro Image takes an explicit `aspectRatio` inside `generationConfig.imageConfig`,
alongside `imageSize` for 1K/2K/4K, and supports 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9
and 21:9 ([Google Cloud](https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana);
OpenRouter documents the same control as an `image_config`
[API parameter](https://openrouter.ai/google/gemini-3-pro-image) and is explicit that it is a
parameter rather than prompt text). What we use is an **OpenAI-shaped `/v1/chat/completions`
endpoint**, and that shim is precisely where the field goes missing: LiteLLM has an open bug in
which *"the `imageConfig` object is ignored or stripped out"*, confirmed by token accounting —
a 4K request billed as 1K output ([BerriAI/litellm#18656](https://github.com/BerriAI/litellm/issues/18656)).
Random-looking dimensions out of a chat-completions proxy are the signature of a dropped
config, not of a model that cannot aim.

**What to do about it, in order.** First, spend one call testing whether the Nous proxy passes
`image_config` / `imageConfig` through — that is cheap and it either removes a whole class of
post-processing or confirms the existing note. Second, whatever the answer, say the frame in
the prompt as well: the DeepMind guide recommends prompting the ratio directly and describing
the format — *"a widescreen backdrop"*. Third — and this is the part that is not optional —
**post-process to exact pixels anyway**, for the reason in §2.3.

### 2.3 A scene must be cut to exactly 16:9 before its regions are authored

This is a code fact and it is load-bearing. `SceneView` draws the picture with
`backgroundSize: 'cover'` and `backgroundPosition: 'center'`, and it positions each tap region
as a **percentage of the container**, not of the image:

```
left: `${region.x * 100}%`   // 960px wide box
```

`assets/scenes/campsite.json` claims the fractional coordinates *"survive any rescaling of the
image"*. They survive rescaling. They do **not** survive cropping. If the source is 21:9 and
the box is 16:9, `cover` throws away 24% of the width — 12% off each side — and every authored
rectangle slides by up to a tenth of the screen. On a 134px-wide hit box around a small child,
that is the difference between tapping her and tapping the grass.

`campsite.jpg` is 1920x1072 (1.791), which is 0.7% off and gets away with it. **Cut every new
scene to 1920x1080 before you open the JSON.** Then the percentages mean what they say.

The band has no equivalent hazard — it has no hit regions, and `WallBackdrop` deliberately uses
`backgroundSize: '100% auto'` with `background-position: bottom` so an over-tall band loses its
empty sky rather than its treeline.

### 2.4 Counts and density are the least reliable thing you can ask for

Do not write "twelve children" or "four objects". Object count is a documented, measured
weakness: accuracy falls off a cliff past five instances, with strong models dropping from
around 50% to 20–25% between the 1–5 and 6–10 bands
([Evaluating Numerical Reasoning in Text-to-Image Models](https://arxiv.org/html/2406.14774v3)),
and the underlying difficulty — keeping a separate identity for every instance while doing a
global count implicitly — is what a whole line of work exists to patch
([Make It Count](https://arxiv.org/pdf/2406.10210)).

Ask for **density by naming activity clusters** instead, which is a thing the model can
actually render: *"around them the campsite is busy — someone kneeling at a tent, two people at
a barbecue, a group on the path with backpacks, a fisherman at the water"*. You get a busy
picture and you stop caring how many people are in it, because nothing downstream counts them.
The DeepMind guide's own lever for density is shot type — *"extreme close-up, a wide shot, a
low angle shot"* — which is why every scene prompt below opens with "a wide shot".

For the band, the same logic runs the other way and `tools/backgrounds.md` already found the
answer empirically: describe the **emptiness** as the subject rather than the objects as a
count. Its three-way scale clause is exactly the positive reframing §2.1 argues for, arrived at
by trial and error a year before I looked up why it works.

### 2.5 "Bottom left" is a hint, not a coordinate

The VISOR benchmark exists because models place things where they like: across 25,280 spatial
prompts, models generated the correct spatial relationship in **under 40% of cases**, and under
the strict all-images metric the best model managed 7.49%
([Benchmarking Spatial Relationships in Text-to-Image Generation, Microsoft Research](https://www.microsoft.com/en-us/research/wp-content/uploads/2023/08/Benchmarking_Spatial_Relationships_Text_To_Image_Generation.pdf)).

Two consequences, both practical.

**Author regions from the returned image, never from the prompt.** The `find` strings in
`campsite.json` — "picking flowers, bottom left" — read like a plan and are a **record**. Write
the prompt with placements, take what comes back, look at it, and then write down where the
three children actually ended up. Every "where the three would be" line in §5 is a starting
guess for the prompt and a thing to verify with your eyes, in that order.

**Make the three findable children impossible to confuse with the crowd.** Position words are
unreliable; scale and foregrounding are not. Ask for the three to be *large foreground figures
standing on the bottom edge of the picture, two or three times the size of everyone else*. That
survives the model rearranging them, it gives the picture depth for free, and it is what makes
a 64px-minimum tap target achievable at all.

### 2.6 Reference-image conditioning is still the strongest lever, and it now has room for the whole set

`tools/backgrounds.md` lever 4 already calls this the real fix, and `tools/gen-icon.py`
implements it with two reference icons. What is worth adding is the ceiling: **up to 14
reference images in one request**
([Google Cloud](https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana),
[OpenRouter](https://openrouter.ai/google/gemini-3-pro-image)). Two is a floor, not a limit.

So for anything new: pass `assets/scenes/campsite.jpg` when generating a scene, and
`assets/backgrounds/household.jpg` when generating a band, with the same framing
`gen-icon.py` uses — *"Here are images from an existing set. Draw ONE NEW picture that belongs
to exactly this set: the same line weight, the same flat cartoon construction, the same kind of
simple bright palette."* The DeepMind guide adds one refinement worth taking: **name** the
things you want held constant so the model can refer to them.

### 2.7 What I could not verify

Said plainly, because a prompt library that pretends to certainty is worse than none.

- **Whether the Nous proxy passes `image_config` through.** Testing it means generating an
  image, which this task did not authorise. Treat §2.2 as a diagnosis to confirm, not a fixed
  bug.
- **Whether the `NO text` clause is doing anything on this model.** Its output is clean, but so
  is the output of the reference images and the palette paragraph. Only an ablation answers it,
  and the cost of leaving it in is one line.
- **"Wimmelbild" / hidden-object prompt craft.** I went looking for real guidance on prompting
  search-and-find compositions and found nothing better than generic advice. The activity-cluster
  approach in §2.4 is derived from the counting literature plus what `campsite.jpg` actually
  did, not from a source about this genre.
- **The 225-nit figure.** `CLAUDE.md` flags it as read off the 2470L datasheet and never
  verified for the 2270L. Every legibility argument here inherits that caveat. The direction is
  certainly right — the panel is dim and etched — but the number is not evidence.
- **Visible watermarks.** Reports of a visible Gemini watermark concern the consumer Gemini app,
  not API output; neither committed asset carries one, which I checked by looking. SynthID is
  invisible and is not our problem.

---

## 3. The band scaffold

`tools/backgrounds.md` §"The prompt shape" is the authority. Its three parts stand:
**scene sentence**, **palette**, **composition and style verbatim**. What follows is that shape
written out whole, with the two hard-won clauses it records kept intact and the additions this
file argues for folded in.

Two things from that file to internalise before you write a band, because they are the
failures that actually happened:

- **Scale must be said three different ways or the model ignores it.** "Small" alone is not
  enough. The wording that finally worked is *"no object taller than one quarter of the image
  height"* **and** *"a lot of empty space between them"* **and** *"the top three quarters is
  completely EMPTY flat sand"* — together. The first two attempts came back with a bicycle a
  fifth of the frame wide and a solid orange mountain filling the lower left.
- **Large blocks of accent take over the ground.** Say *"the accent is used on just one or two
  small shapes — no large blocks of colour anywhere"*, or the accent becomes the sky.

### The template

```
A wide, very short horizontal strip. <SCENE SENTENCE: at most four kinds of object, each
placed explicitly, sitting on a single horizon line near the bottom.>

Everything sits low on a single thin horizon line. No object is taller than one quarter of
the image height. There is a lot of empty space between the objects. The top three quarters
of the picture is completely EMPTY flat sand, with nothing in it at all.

Colours: the ground and the sky are both flat sand #E7DCC9, with deep sand #E0D3BC and tan
#B9A888 for anything that needs a second earth tone, dark brown #7D6B57, cream #FFFDF9 for
snow or paper-white shapes, and near-black #171310 for the outlines only. ONE accent colour,
<ACCENT>, is used on just one or two small shapes — no large blocks of colour anywhere.
Every shape is BRIGHTLY and FLATLY coloured; do not draw this in greyscale or in black and
white even if the real objects usually are.

Style: children's colouring-book cartoon. VERY THICK uniform black outlines on every shape,
flat solid fills, no shading, no gradients, no texture. Absolutely NO text, NO letters, NO
numbers, NO frame, NO border box. Every sign, board and banner in the picture is a blank
unlettered shape. Generous empty negative space across the whole upper area, with nothing
drawn in it. There are no people anywhere in the picture — this is objects and landscape
only.
```

Four notes on the template.

**The ground is never white.** White competes with the cards, which are white. That is
`tools/backgrounds.md`'s rule and it holds. Note that the existing `household.jpg` fills its
*trees* white while keeping the *ground* sand — which is legal and is why snow-adjacent bands
work at all, but it is close to the line. Prefer cream `#FFFDF9` over pure white for a fill,
because it is the token the wall already uses for light ink on solids and it will not read as a
hole punched in the picture.

**"Generous empty negative space" is a fourth way of saying scale**, and it is the phrasing the
stock-image world uses for exactly this job — leaving a clean area for content to sit over
([negative space in AI prompts](https://www.getpromptatlas.com/keywords/negative-space-techniques),
[banner prompts with copy space](https://designwiz.com/blog/best-ai-banner-prompts/)). Add it;
do not remove any of the other three.

**The greyscale clause is not optional and not a scene-specific quirk.** `gen-icon.py` records
why: the first soccer ball came back a beautiful monochrome, because a soccer ball *is* black
and white, and would have been the only greyscale thing on a wall of flat colour. Any band
whose subject is achromatic in life — snow, rocks, a city in winter — hits the same trap.

**Which accent, now that there is only one band.** `tools/backgrounds.md` says the accent
"must be that child's slot accent (`--c-id-1/2/3`) so the band and their cards agree". That was
true when the design had a band per child. It is not true of the code today: `WallApp` renders
`<WallBackdrop />` only when `activeChild === null && !showingScene`, so there is exactly one
shared band and it is never on a child's screen. **A shared band must not wear a slot accent** —
`--c-id-2` under a board that belongs to nobody in particular quietly claims the board for
Child B. Use red `#A8221B` or dark brown `#7D6B57`, which is what `household.jpg` already does
with its one rust-coloured tree. And keep green `#128239` out of bands entirely: on that screen
green means *done*, and a green field under a chore board is a sentence nobody meant to write.

---

## 4. The scene scaffold

New in this file; there was no written scaffold for scenes. It is six parts. Parts 1, 5 and 6
never change.

1. **Frame.** `A wide 16:9 landscape illustration, edge to edge, filling the whole frame.`
2. **Setting.** One sentence: place, season, and the ground the whole thing stands on.
3. **The three findable children.** Three sentences, one each. Every one names an age band, an
   activity, a rough position, a distinguishing garment colour, and the foreground scale
   clause. These are the only figures that matter downstream.
4. **The crowd.** One sentence of activity clusters (§2.4) plus one of animals and props. Never
   a count.
5. **Palette.** Hexes, verbatim.
6. **Style.** Verbatim, plus the blank-surface sentence and the top-strip clause.

### The template

```
A wide 16:9 landscape illustration, edge to edge, filling the whole frame.

<SETTING SENTENCE.>

Three children are drawn LARGE in the foreground, standing on the bottom edge of the
picture, two or three times the size of everyone else, each clearly doing something
different:
  - <CHILD 1: age band, activity, position, garment colour.>
  - <CHILD 2: age band, activity, position, garment colour.>
  - <CHILD 3: age band, activity, position, garment colour.>

Behind them the place is busy and full of life: <THREE OR FOUR ACTIVITY CLUSTERS, each a
small group of much smaller background figures doing one named thing>. <ANIMALS AND PROPS.>

Colours: flat solid fills from this palette — sand #E7DCC9, deep sand #E0D3BC, tan #B9A888,
brown #7D6B57, cream #FFFDF9, blue #0D3399, magenta #D02076, amber #FFAE14, green #128239,
red #A8221B, and near-black #171310 for the outlines only. The sky is plain flat sand
#E7DCC9. Every shape is BRIGHTLY and FLATLY coloured; do not draw this in greyscale or in
black and white even if the real objects usually are.

Style: children's colouring-book cartoon. VERY THICK uniform black outlines on every shape,
flat solid fills, no shading, no gradients, no texture. Absolutely NO text, NO letters, NO
numbers, NO frame, NO border box. Every sign, flag, banner, board and box in the picture is
a blank unlettered shape. The top strip of the picture, all the way across, is calm and
light — open sky with at most a bird or a distant hill in it. The faces are generic, simple
cartoon faces.
```

### Why the top strip has to stay calm

Two floating doors — calendar, grown-ups — sit at `top: md; right: md` over the scene, and the
stale-data chip grows leftward from them along the same row. Those are white pills with heavy
black outlines, and the outline colour was changed to ink precisely because a warm brown border
*"sank into the sky"* over illustration. Chrome that floats over art needs the art beneath it to
be quiet. `campsite.jpg` gets this right by accident — pale sand sky, a couple of birds, distant
peaks. Ask for it on purpose.

### Sand sky, green grass — and why that is not a contradiction

The band forbids large blocks of colour. The scene does not, and `campsite.jpg` is two-thirds
green field. The difference is what sits on top: a band is background for opaque cards and must
recede, while a scene has nothing over it but two small buttons. **Colour freely in a scene.**
Keep the sky sand, because that is the house's ground colour and it is what the floating chrome
was measured against.

### Authoring the regions

After post-processing to 1920x1080, open the image and write `assets/scenes/<id>.json` in the
shape `campsite.json` uses. Only `id`, `image` and `regions` are read — `parseSceneManifest`
ignores `aspect` and `_comment`, which are documentation. Each region is `slot` plus fractional
`x/y/w/h`, and a malformed region is dropped individually rather than killing the scene.

Two things to get right:

- **Big enough to hit.** Tap targets are ≥64px everywhere, motor skill not eyesight. The
  campsite regions are `w: 0.13–0.175`, `h: 0.30–0.40` — 125–168 x 162–216 logical px. Aim
  there. A region smaller than about `0.07 x 0.12` is not a target.
- **Vary which slot stands where, across the set.** `slot` is `sortOrder % childCount`, so it
  is fixed per child; the *position* it maps to is your free choice per scene, and
  `campsite.json` already scrambles it (slot 1 left, slot 2 centre, slot 0 right). Keep
  scrambling it. If Child C is always bottom-left, there is nothing left to find, and finding
  yourself is the entire interaction.

**Then add the id to the catalogue.** The scenes the wall may consider are a committed list —
`SCENE_IDS` in `web/src/views/logic/sceneCatalog.ts` — rather than an index read at runtime,
specifically so `test/unit-h.scenes.test.ts` can assert *before* deploy that every id resolves
to a picture and to a manifest with at least one usable region. Two consequences for anything
generated from this file: adding a scene is a file drop **plus** a one-line edit, and the
picture has to be **committed** rather than dropped into the volume, because an id whose art
exists only in the volume cannot be checked by that test. (This landed while this document was
being written; confirm the file before relying on the name.)

---

## 5. Ten scenes, ready to paste

Each is a complete prompt. The "where the three would be" line is a **starting guess to verify
against the returned picture** (§2.5), given as approximate `x/y/w/h` to speed up the JSON.

Season spread: winter, high summer, spring, autumn, and four weather-independent options for
the days when the season is wrong for everything else.

### 5.1 Snow day on the sledding hill · winter

Three activities that could not be confused with each other at a glance: kneeling, sliding,
throwing.

*Where the three would be:* rolling a snowball, bottom left `0.06 / 0.58 / 0.16 / 0.42` · on a
sled, centre `0.40 / 0.46 / 0.15 / 0.34` · throwing a snowball, bottom right
`0.72 / 0.56 / 0.14 / 0.44`.

```
A wide 16:9 landscape illustration, edge to edge, filling the whole frame.

A snowy park on a bright winter morning: a long sledding hill sloping down from the right,
a frozen pond at the back, bare branching trees and dark green pines along the top of the
hill, and deep cream #FFFDF9 snow covering the ground.

Three children are drawn LARGE in the foreground, standing on the bottom edge of the
picture, two or three times the size of everyone else, each clearly doing something
different:
  - At the bottom left, a cheerful cartoon girl of about seven in a magenta coat, kneeling
    and rolling a big snowball for a snowman, with two finished snowballs stacked beside her.
  - In the centre, a cartoon child of about five in a blue coat sitting on a red sled,
    halfway down the slope, arms up and laughing.
  - At the bottom right, a small cartoon child of about three in an amber coat and a woolly
    hat, standing and holding a snowball in both mittens, ready to throw.

Behind them the park is busy and full of life: a group of much smaller figures skating on
the frozen pond, two building a snow fort with a low wall, someone shovelling a path, and a
cluster of small figures walking up the hill dragging sleds. A dog bounding through the
snow, birds on a bare branch, a red scarf caught on a fence post, footprints across the
snow.

Colours: flat solid fills from this palette — sand #E7DCC9, deep sand #E0D3BC, tan #B9A888,
brown #7D6B57, cream #FFFDF9, blue #0D3399, magenta #D02076, amber #FFAE14, green #128239,
red #A8221B, and near-black #171310 for the outlines only. The sky is plain flat sand
#E7DCC9. Every shape is BRIGHTLY and FLATLY coloured; do not draw this in greyscale or in
black and white even if the real objects usually are — the snow is cream #FFFDF9 with thick
black outlines, not grey.

Style: children's colouring-book cartoon. VERY THICK uniform black outlines on every shape,
flat solid fills, no shading, no gradients, no texture. Absolutely NO text, NO letters, NO
numbers, NO frame, NO border box. Every sign, flag, banner, board and box in the picture is
a blank unlettered shape. The top strip of the picture, all the way across, is calm and
light — open sky with at most a bird or a distant hill in it. The faces are generic, simple
cartoon faces.
```

The greyscale clause earns its place here more than anywhere else in the set: snow is the
achromatic subject, and this is the prompt most likely to come back as a beautiful monochrome.

### 5.2 The beach · high summer

*Where the three would be:* digging, bottom left `0.05 / 0.60 / 0.17 / 0.40` · jumping a wave,
centre `0.42 / 0.48 / 0.13 / 0.36` · flying a kite, bottom right `0.70 / 0.52 / 0.15 / 0.48`.

```
A wide 16:9 landscape illustration, edge to edge, filling the whole frame.

A wide sandy beach on a hot summer day: flat tan #B9A888 sand across the lower half, a
calm blue sea with small rolling waves behind it, a low dune with grass tufts on the left,
and a wooden lifeguard chair on the right.

Three children are drawn LARGE in the foreground, standing on the bottom edge of the
picture, two or three times the size of everyone else, each clearly doing something
different:
  - At the bottom left, a cheerful cartoon girl of about seven in a magenta swimsuit,
    kneeling and digging a sandcastle with a bucket and a spade, a moat around it.
  - In the centre, a cartoon child of about five in blue swim shorts, jumping over a small
    breaking wave at the water's edge with both feet off the ground and a big splash.
  - At the bottom right, a small cartoon child of about three in an amber sun hat, standing
    and holding the string of a red kite that flies up and to the right.

Behind them the beach is busy and full of life: a group of much smaller figures under
striped umbrellas with a picnic, two paddling in the shallows with rubber rings, a pair
carrying a surfboard down to the water, and a small crowd around a half-built sandcastle
competition. Seagulls, a crab, a beach ball, a line of footprints, a small sailing boat far
out on the water.

Colours: flat solid fills from this palette — sand #E7DCC9, deep sand #E0D3BC, tan #B9A888,
brown #7D6B57, cream #FFFDF9, blue #0D3399, magenta #D02076, amber #FFAE14, green #128239,
red #A8221B, and near-black #171310 for the outlines only. The sky is plain flat sand
#E7DCC9. Every shape is BRIGHTLY and FLATLY coloured; do not draw this in greyscale or in
black and white even if the real objects usually are.

Style: children's colouring-book cartoon. VERY THICK uniform black outlines on every shape,
flat solid fills, no shading, no gradients, no texture. Absolutely NO text, NO letters, NO
numbers, NO frame, NO border box. Every sign, flag, banner, board and box in the picture is
a blank unlettered shape. The top strip of the picture, all the way across, is calm and
light — open sky with at most a bird or a distant hill in it. The faces are generic, simple
cartoon faces.
```

### 5.3 The farm · late summer

*Where the three would be:* feeding hens, bottom left `0.06 / 0.56 / 0.16 / 0.44` · on the hay
bales, centre `0.44 / 0.44 / 0.13 / 0.32` · with the pony, bottom right
`0.68 / 0.54 / 0.18 / 0.46`.

```
A wide 16:9 landscape illustration, edge to edge, filling the whole frame.

A small working farm on a warm afternoon: a red barn with a wide open door on the left
middle distance, a green field with a low wooden fence running across the middle, a duck
pond on the right, and rolling hills behind.

Three children are drawn LARGE in the foreground, standing on the bottom edge of the
picture, two or three times the size of everyone else, each clearly doing something
different:
  - At the bottom left, a cheerful cartoon girl of about seven in a magenta shirt, bending
    down and scattering feed from a bowl for a group of hens around her feet.
  - In the centre, a cartoon child of about five in a blue shirt, climbing on top of a
    stack of round hay bales with one arm raised.
  - At the bottom right, a small cartoon child of about three in amber dungarees, standing
    and holding out a carrot to a brown pony that is leaning over the fence.

Behind them the farm is busy and full of life: a group of much smaller figures loading
crates onto a tractor trailer, two at a fruit stall with baskets, a farmer leading a cow
along the track, and a cluster of visitors watching sheep in a pen. Ducks on the pond, a
scarecrow in the field, a cat asleep on a fence post, swallows over the barn, a wheelbarrow
tipped on its side.

Colours: flat solid fills from this palette — sand #E7DCC9, deep sand #E0D3BC, tan #B9A888,
brown #7D6B57, cream #FFFDF9, blue #0D3399, magenta #D02076, amber #FFAE14, green #128239,
red #A8221B, and near-black #171310 for the outlines only. The sky is plain flat sand
#E7DCC9. Every shape is BRIGHTLY and FLATLY coloured; do not draw this in greyscale or in
black and white even if the real objects usually are.

Style: children's colouring-book cartoon. VERY THICK uniform black outlines on every shape,
flat solid fills, no shading, no gradients, no texture. Absolutely NO text, NO letters, NO
numbers, NO frame, NO border box. Every sign, flag, banner, board and box in the picture is
a blank unlettered shape. The top strip of the picture, all the way across, is calm and
light — open sky with at most a bird or a distant hill in it. The faces are generic, simple
cartoon faces.
```

### 5.4 The city park · spring

*Where the three would be:* feeding ducks, bottom left `0.05 / 0.58 / 0.16 / 0.42` · top of the
slide, centre `0.42 / 0.40 / 0.13 / 0.34` · on a bicycle, bottom right
`0.70 / 0.56 / 0.17 / 0.44`.

```
A wide 16:9 landscape illustration, edge to edge, filling the whole frame.

A city park in spring: a curving path across the middle, a round pond on the left, a
playground with a slide and swings in the centre, a bandstand and a row of blossoming trees
behind, and the flat rooflines of the city along the far distance.

Three children are drawn LARGE in the foreground, standing on the bottom edge of the
picture, two or three times the size of everyone else, each clearly doing something
different:
  - At the bottom left, a cheerful cartoon girl of about seven in a magenta jacket,
    crouching at the edge of the pond throwing crumbs to a duck and her ducklings.
  - In the centre, a cartoon child of about five in a blue jumper, sitting at the top of the
    playground slide about to push off, both hands on the rails.
  - At the bottom right, a small cartoon child of about three in an amber top and a helmet,
    riding a small red bicycle with training wheels along the path.

Behind them the park is busy and full of life: a group of much smaller figures listening to
a brass band in the bandstand, two playing chess at a stone table, a cluster around an ice
cream cart, and joggers and dog walkers along the far path. Pigeons, a fountain, a kite in
the air, a dog chasing a ball, balloons tied to a bench.

Colours: flat solid fills from this palette — sand #E7DCC9, deep sand #E0D3BC, tan #B9A888,
brown #7D6B57, cream #FFFDF9, blue #0D3399, magenta #D02076, amber #FFAE14, green #128239,
red #A8221B, and near-black #171310 for the outlines only. The sky is plain flat sand
#E7DCC9. Every shape is BRIGHTLY and FLATLY coloured; do not draw this in greyscale or in
black and white even if the real objects usually are.

Style: children's colouring-book cartoon. VERY THICK uniform black outlines on every shape,
flat solid fills, no shading, no gradients, no texture. Absolutely NO text, NO letters, NO
numbers, NO frame, NO border box. Every sign, flag, banner, board and box in the picture is
a blank unlettered shape. The top strip of the picture, all the way across, is calm and
light — open sky with at most a bird or a distant hill in it. The faces are generic, simple
cartoon faces.
```

A city scene is where the blank-surface clause earns its keep: shopfronts, the bandstand and
the ice cream cart are all places a text-eager model wants to letter.

### 5.5 The treehouse and the back garden · summer

The one scene with real vertical layering — good for the search, because the middle child is
found by looking *up*.

*Where the three would be:* at the rope ladder, bottom left `0.07 / 0.52 / 0.15 / 0.48` · in the
treehouse window, centre-high `0.44 / 0.16 / 0.13 / 0.24` · on the tyre swing, bottom right
`0.70 / 0.48 / 0.16 / 0.44`.

```
A wide 16:9 landscape illustration, edge to edge, filling the whole frame.

A big back garden in summer with a wooden treehouse built into a large oak in the centre: a
rope ladder down one side, a rope-and-bucket pulley, a plain unlettered triangular flag on
the roof, a vegetable patch on the left, a hedge and a shed on the right, and a paddling
pool on the grass.

Three children are drawn LARGE in the foreground, two or three times the size of everyone
else, each clearly doing something different:
  - At the bottom left, standing on the grass, a cheerful cartoon girl of about seven in a
    magenta t-shirt, hauling on the pulley rope to lift a bucket up to the treehouse.
  - In the centre, high up, a cartoon child of about five in a blue t-shirt leaning out of
    the treehouse window and waving down with one arm.
  - At the bottom right, a small cartoon child of about three in an amber t-shirt, sitting
    inside a tyre swing hanging from a branch, feet off the ground.

Behind them the garden is busy and full of life: a group of much smaller figures around a
picnic blanket with a cake, two watering the vegetable patch with a hose, someone hanging
washing on a line, and a cluster playing a ball game near the hedge. A cat on the fence, a
bird table with sparrows, a wheelbarrow, butterflies, a football in the flowerbed.

Colours: flat solid fills from this palette — sand #E7DCC9, deep sand #E0D3BC, tan #B9A888,
brown #7D6B57, cream #FFFDF9, blue #0D3399, magenta #D02076, amber #FFAE14, green #128239,
red #A8221B, and near-black #171310 for the outlines only. The sky is plain flat sand
#E7DCC9. Every shape is BRIGHTLY and FLATLY coloured; do not draw this in greyscale or in
black and white even if the real objects usually are.

Style: children's colouring-book cartoon. VERY THICK uniform black outlines on every shape,
flat solid fills, no shading, no gradients, no texture. Absolutely NO text, NO letters, NO
numbers, NO frame, NO border box. Every sign, flag, banner, board and box in the picture is
a blank unlettered shape. The top strip of the picture, all the way across, is calm and
light — open sky with at most a bird or a distant hill in it. The faces are generic, simple
cartoon faces.
```

Note that this one breaks the "standing on the bottom edge" clause for the middle child on
purpose, so the phrase is dropped from part 3 and each child gets its own placement instead.
The scale clause stays.

### 5.6 A rainy day in the indoor play hall · any season

The scene that exists so the wall has something for the fortnight when everything outdoors
looks wrong. Indoors is the hardest brief for the house ground rule — say what the walls and
floor are, or the model will pick white.

*Where the three would be:* painting, bottom left `0.06 / 0.54 / 0.17 / 0.46` · on the climbing
frame, centre `0.42 / 0.34 / 0.14 / 0.38` · building blocks, bottom right
`0.70 / 0.60 / 0.16 / 0.40`.

```
A wide 16:9 landscape illustration, edge to edge, filling the whole frame.

The inside of a big bright indoor play hall on a rainy day: plain flat sand #E7DCC9 walls
and a deep sand #E0D3BC floor, a tall soft climbing frame with a slide in the centre, a ball
pit on the right, a reading corner with beanbags on the left, and a huge window across the
back with rain running down it and grey clouds outside.

Three children are drawn LARGE in the foreground, two or three times the size of everyone
else, each clearly doing something different:
  - At the bottom left, a cheerful cartoon girl of about seven in a magenta apron, standing
    at a low table painting a picture on a big sheet of blank paper.
  - In the centre, a cartoon child of about five in a blue top, halfway up the soft climbing
    frame, one hand reaching for the next hold.
  - At the bottom right, a small cartoon child of about three in an amber top, sitting on
    the floor stacking a tall tower of coloured blocks.

Behind them the hall is busy and full of life: a group of much smaller figures throwing
themselves into the ball pit, two reading together in the beanbag corner, a cluster around a
puppet theatre, and a queue at a snack counter. Coats and wellington boots on a row of
hooks, a hoop rolling across the floor, a paper aeroplane in the air, a toy train on the
carpet.

Colours: flat solid fills from this palette — sand #E7DCC9, deep sand #E0D3BC, tan #B9A888,
brown #7D6B57, cream #FFFDF9, blue #0D3399, magenta #D02076, amber #FFAE14, green #128239,
red #A8221B, and near-black #171310 for the outlines only. Every shape is BRIGHTLY and
FLATLY coloured; do not draw this in greyscale or in black and white even if the real
objects usually are — this is a bright cheerful room, not a dark one.

Style: children's colouring-book cartoon. VERY THICK uniform black outlines on every shape,
flat solid fills, no shading, no gradients, no texture. Absolutely NO text, NO letters, NO
numbers, NO frame, NO border box. Every sign, poster, board and box in the picture is a
blank unlettered shape. The top strip of the picture, all the way across, is calm and light
— plain wall and the top of the window, with nothing busy in it. The faces are generic,
simple cartoon faces.
```

Watch this one for two things: a play hall is full of surfaces that want signage, and an
"indoor, rainy" brief pulls the whole palette toward grey. Both clauses above are aimed at
exactly that, and this is the prompt most likely to need a second attempt.

### 5.7 The lake and the dock · late summer

*Where the three would be:* fishing off the dock, bottom left `0.06 / 0.56 / 0.16 / 0.44` · in
the canoe, centre `0.42 / 0.50 / 0.17 / 0.30` · skipping stones, bottom right
`0.72 / 0.56 / 0.14 / 0.44`.

```
A wide 16:9 landscape illustration, edge to edge, filling the whole frame.

A calm lake on a late summer afternoon: a wooden dock running out from the bottom left, flat
blue water across the middle, a pebble shore on the right, tall reeds along the near bank, a
small boathouse on the far shore, and wooded hills behind.

Three children are drawn LARGE in the foreground, two or three times the size of everyone
else, each clearly doing something different:
  - At the bottom left, a cheerful cartoon girl of about seven in a magenta t-shirt, sitting
    on the end of the dock with her legs over the edge, holding a small fishing rod with the
    line in the water.
  - In the centre, a cartoon child of about five in a blue life jacket, kneeling in a wooden
    canoe just off the dock with the paddle raised.
  - At the bottom right, a small cartoon child of about three in an amber t-shirt, standing
    on the pebble shore leaning back to throw a flat stone across the water.

Behind them the lake is busy and full of life: a group of much smaller figures swimming with
rubber rings near a raft, two rowing a small boat across the middle, a cluster on the far
bank around a rope swing, and someone paddling a kayak past the boathouse. A duck with
ducklings in a line, a heron standing in the reeds, dragonflies, ripples spreading from a
splash, a bucket and net on the dock.

Colours: flat solid fills from this palette — sand #E7DCC9, deep sand #E0D3BC, tan #B9A888,
brown #7D6B57, cream #FFFDF9, blue #0D3399, magenta #D02076, amber #FFAE14, green #128239,
red #A8221B, and near-black #171310 for the outlines only. The sky is plain flat sand
#E7DCC9. Every shape is BRIGHTLY and FLATLY coloured; do not draw this in greyscale or in
black and white even if the real objects usually are.

Style: children's colouring-book cartoon. VERY THICK uniform black outlines on every shape,
flat solid fills, no shading, no gradients, no texture. Absolutely NO text, NO letters, NO
numbers, NO frame, NO border box. Every sign, flag, banner, board and box in the picture is
a blank unlettered shape. The top strip of the picture, all the way across, is calm and
light — open sky with at most a bird or a distant hill in it. The faces are generic, simple
cartoon faces.
```

### 5.8 The orchard in autumn · autumn

*Where the three would be:* the leaf pile, bottom left `0.05 / 0.52 / 0.18 / 0.48` · up the
ladder, centre `0.42 / 0.32 / 0.13 / 0.40` · pulling the cart, bottom right
`0.68 / 0.58 / 0.18 / 0.42`.

```
A wide 16:9 landscape illustration, edge to edge, filling the whole frame.

An apple orchard on a crisp autumn day: rows of trees with red and amber leaves stretching
back, a big pile of fallen leaves on the left, a field of pumpkins on the right, a low stone
wall along the middle, and bare hills behind.

Three children are drawn LARGE in the foreground, two or three times the size of everyone
else, each clearly doing something different:
  - At the bottom left, a cheerful cartoon girl of about seven in a magenta coat, caught
    mid-jump above a big pile of leaves with leaves flying up around her.
  - In the centre, a cartoon child of about five in a blue coat, standing on the third rung
    of a short wooden ladder against an apple tree, reaching up with a basket on one arm.
  - At the bottom right, a small cartoon child of about three in an amber hat, pulling a
    small wooden cart loaded with three round pumpkins.

Behind them the orchard is busy and full of life: a group of much smaller figures riding a
trailer of straw bales behind a tractor, two turning a press at a cider stall, a cluster
picking apples into crates, and a small crowd wandering a maze of straw bales. A scarecrow
in the pumpkin field, squirrels with acorns, a skein of geese in the sky, a wheelbarrow of
apples, a dog in the leaves.

Colours: flat solid fills from this palette — sand #E7DCC9, deep sand #E0D3BC, tan #B9A888,
brown #7D6B57, cream #FFFDF9, blue #0D3399, magenta #D02076, amber #FFAE14, green #128239,
red #A8221B, and near-black #171310 for the outlines only. The sky is plain flat sand
#E7DCC9. Every shape is BRIGHTLY and FLATLY coloured; do not draw this in greyscale or in
black and white even if the real objects usually are.

Style: children's colouring-book cartoon. VERY THICK uniform black outlines on every shape,
flat solid fills, no shading, no gradients, no texture. Absolutely NO text, NO letters, NO
numbers, NO frame, NO border box. Every sign, flag, banner, board and box in the picture is
a blank unlettered shape. The top strip of the picture, all the way across, is calm and
light — open sky with at most a bird or a distant hill in it. The faces are generic, simple
cartoon faces.
```

Autumn is the one scene where the amber accent is also the season, so watch that the
amber-coated child at bottom right does not vanish into the leaves. If she does, move that
child to the blue coat and give the centre child amber — the garment colours in part 3 are
free, the *distinguishability* is not.

### 5.9 The dinosaur hall · any season

The other weather-independent option, and the one with the strongest single landmark — useful
because a child who cannot yet read navigates by silhouette.

*Where the three would be:* at the low drawer, bottom left `0.06 / 0.56 / 0.16 / 0.44` · under
the skeleton, centre `0.44 / 0.50 / 0.13 / 0.40` · at the model, bottom right
`0.70 / 0.54 / 0.17 / 0.46`.

```
A wide 16:9 landscape illustration, edge to edge, filling the whole frame.

The inside of a big bright natural history hall: plain flat sand #E7DCC9 walls, a deep sand
#E0D3BC floor, a huge cream dinosaur skeleton mounted in the centre of the hall, tall arched
windows along the back, a balcony running around the upper level, and glass cases along
both sides.

Three children are drawn LARGE in the foreground, two or three times the size of everyone
else, each clearly doing something different:
  - At the bottom left, a cheerful cartoon girl of about seven in a magenta jumper,
    crouching to pull open a low wooden specimen drawer full of fossils.
  - In the centre, a cartoon child of about five in a blue jumper, standing directly under
    the skeleton's ribcage looking straight up with both hands on their head.
  - At the bottom right, a small cartoon child of about three in an amber jumper, standing
    on tiptoe at a low table with a model volcano and small dinosaur figures on it.

Behind them the hall is busy and full of life: a group of much smaller figures following a
guide with a raised umbrella, two sketching the skeleton on clipboards, a cluster around a
glass case of shells, and a queue at a doorway on the left. A stuffed bird on a stand, a
giant ammonite on the wall, a mammoth tusk, a bench with coats piled on it.

Colours: flat solid fills from this palette — sand #E7DCC9, deep sand #E0D3BC, tan #B9A888,
brown #7D6B57, cream #FFFDF9, blue #0D3399, magenta #D02076, amber #FFAE14, green #128239,
red #A8221B, and near-black #171310 for the outlines only. Every shape is BRIGHTLY and
FLATLY coloured; do not draw this in greyscale or in black and white even if the real
objects usually are — the bones are cream #FFFDF9 with thick black outlines, not grey, and
the hall is bright and warm.

Style: children's colouring-book cartoon. VERY THICK uniform black outlines on every shape,
flat solid fills, no shading, no gradients, no texture. Absolutely NO text, NO letters, NO
numbers, NO frame, NO border box. Every sign, label, plaque, board and box in the picture is
a blank unlettered shape. The top strip of the picture, all the way across, is calm and
light — plain wall, the tops of the windows and the balcony rail, with nothing busy in it.
The faces are generic, simple cartoon faces.
```

A museum is the highest-risk scene in the set for unwanted text — every exhibit in the real
world has a label — which is why the blank-surface sentence here names plaques and labels
specifically. Expect to regenerate this one.

### 5.10 The community garden · spring

*Where the three would be:* watering, bottom left `0.06 / 0.54 / 0.16 / 0.46` · in the
wheelbarrow, centre `0.42 / 0.56 / 0.17 / 0.34` · at the potting bench, bottom right
`0.70 / 0.52 / 0.17 / 0.48`.

```
A wide 16:9 landscape illustration, edge to edge, filling the whole frame.

A community garden in spring: neat rows of seedlings across the lower half, tall bean poles
tied in wigwams in the middle, a small greenhouse on the right, a wooden shed with a water
butt on the left, a low picket fence along the back, and hills beyond.

Three children are drawn LARGE in the foreground, standing on the bottom edge of the
picture, two or three times the size of everyone else, each clearly doing something
different:
  - At the bottom left, a cheerful cartoon girl of about seven in a magenta t-shirt,
    tipping a red watering can over a row of small seedlings.
  - In the centre, a cartoon child of about five in a blue t-shirt, sitting up in a
    wheelbarrow full of straw with both arms out.
  - At the bottom right, a small cartoon child of about three in amber dungarees, standing
    at a low potting bench pressing soil into a row of little plant pots.

Behind them the garden is busy and full of life: a group of much smaller figures digging a
new bed with forks, two tying bean poles together, a cluster around a compost heap with
barrows, and someone carrying trays of plants out of the greenhouse. Hens pecking along a
path, bees over the flowers, a robin on a fork handle, a scarecrow, a cat asleep on the shed
roof.

Colours: flat solid fills from this palette — sand #E7DCC9, deep sand #E0D3BC, tan #B9A888,
brown #7D6B57, cream #FFFDF9, blue #0D3399, magenta #D02076, amber #FFAE14, green #128239,
red #A8221B, and near-black #171310 for the outlines only. The sky is plain flat sand
#E7DCC9. Every shape is BRIGHTLY and FLATLY coloured; do not draw this in greyscale or in
black and white even if the real objects usually are.

Style: children's colouring-book cartoon. VERY THICK uniform black outlines on every shape,
flat solid fills, no shading, no gradients, no texture. Absolutely NO text, NO letters, NO
numbers, NO frame, NO border box. Every sign, flag, banner, board and box in the picture is
a blank unlettered shape. The top strip of the picture, all the way across, is calm and
light — open sky with at most a bird or a distant hill in it. The faces are generic, simple
cartoon faces.
```

---

## 6. Eight bands, ready to paste

Replace `<ACCENT>` with **one** hex. For the shared idle band that means red `#A8221B` or dark
brown `#7D6B57` — see §3 on why a slot accent is the wrong choice for a board that belongs to
nobody. Keep green out.

All eight use the same closing three paragraphs as §3. They are repeated in full so each block
is genuinely copy-pasteable; only the first paragraph differs.

### 6.1 The beach horizon · summer

```
A wide, very short horizontal strip. Two small low dunes with a few grass tufts on the left,
a small bucket and spade standing upright in the middle, a small beach ball in <ACCENT> just
to the right of them, and a tiny sailing boat at the far right sitting on a single thin
horizontal line that is the sea. Two small shells on the ground.

Everything sits low on a single thin horizon line. No object is taller than one quarter of
the image height. There is a lot of empty space between the objects. The top three quarters
of the picture is completely EMPTY flat sand, with nothing in it at all.

Colours: the ground and the sky are both flat sand #E7DCC9, with deep sand #E0D3BC and tan
#B9A888 for anything that needs a second earth tone, dark brown #7D6B57, cream #FFFDF9 for
paper-white shapes, and near-black #171310 for the outlines only. ONE accent colour,
<ACCENT>, is used on just one or two small shapes — no large blocks of colour anywhere.
Every shape is BRIGHTLY and FLATLY coloured; do not draw this in greyscale or in black and
white even if the real objects usually are.

Style: children's colouring-book cartoon. VERY THICK uniform black outlines on every shape,
flat solid fills, no shading, no gradients, no texture. Absolutely NO text, NO letters, NO
numbers, NO frame, NO border box. Every sign, board and banner in the picture is a blank
unlettered shape. Generous empty negative space across the whole upper area, with nothing
drawn in it. There are no people anywhere in the picture — this is objects and landscape
only.
```

The sea is the trap here: a filled blue sea is a large block of colour and will eat the
ground. Naming it as "a single thin horizontal line" is what stops it, and that phrasing
generalises to any band with water in it.

### 6.2 The farm fence · late summer

```
A wide, very short horizontal strip. A low post-and-rail fence with wide gaps in it running
along the left third, two small round hay bales standing apart in the middle, a very small
barn in <ACCENT> at the right, and one hen on the ground between them.

Everything sits low on a single thin horizon line. No object is taller than one quarter of
the image height. There is a lot of empty space between the objects. The top three quarters
of the picture is completely EMPTY flat sand, with nothing in it at all.

Colours: the ground and the sky are both flat sand #E7DCC9, with deep sand #E0D3BC and tan
#B9A888 for anything that needs a second earth tone, dark brown #7D6B57, cream #FFFDF9 for
paper-white shapes, and near-black #171310 for the outlines only. ONE accent colour,
<ACCENT>, is used on just one or two small shapes — no large blocks of colour anywhere.
Every shape is BRIGHTLY and FLATLY coloured; do not draw this in greyscale or in black and
white even if the real objects usually are.

Style: children's colouring-book cartoon. VERY THICK uniform black outlines on every shape,
flat solid fills, no shading, no gradients, no texture. Absolutely NO text, NO letters, NO
numbers, NO frame, NO border box. Every sign, board and banner in the picture is a blank
unlettered shape. Generous empty negative space across the whole upper area, with nothing
drawn in it. There are no people anywhere in the picture — this is objects and landscape
only.
```

### 6.3 The city rooftops · any season

```
A wide, very short horizontal strip. Five small flat-topped buildings of slightly different
heights, spaced far apart along the ground line, each drawn as a plain outlined block with
at most two square windows. A small water tower on legs on top of one of them. One single
window in <ACCENT>. One small round tree between two of the buildings.

Everything sits low on a single thin horizon line. No object is taller than one quarter of
the image height. There is a lot of empty space between the objects. The top three quarters
of the picture is completely EMPTY flat sand, with nothing in it at all.

Colours: the ground and the sky are both flat sand #E7DCC9, with deep sand #E0D3BC and tan
#B9A888 for anything that needs a second earth tone, dark brown #7D6B57, cream #FFFDF9 for
paper-white shapes, and near-black #171310 for the outlines only. ONE accent colour,
<ACCENT>, is used on just one or two small shapes — no large blocks of colour anywhere.
Every shape is BRIGHTLY and FLATLY coloured; do not draw this in greyscale or in black and
white even if the real objects usually are.

Style: children's colouring-book cartoon. VERY THICK uniform black outlines on every shape,
flat solid fills, no shading, no gradients, no texture. Absolutely NO text, NO letters, NO
numbers, NO frame, NO border box. Every sign, board and banner in the picture is a blank
unlettered shape. Generous empty negative space across the whole upper area, with nothing
drawn in it. There are no people anywhere in the picture — this is objects and landscape
only.
```

"At most two square windows" is doing real work. A building drawn with a full grid of windows
becomes texture, and texture at 225 nits behind etched glass is the mud the whole style exists
to avoid. The same instinct applies to brickwork, roof tiles and paving anywhere in a band.

### 6.4 The rainy day · any season

```
A wide, very short horizontal strip. Three shallow puddles drawn as flat outlined ellipses
lying on the ground line, spaced far apart. One small closed umbrella leaning beside the
left puddle, and one small open umbrella in <ACCENT> standing beside the right one. A few
short raindrop strokes in the air just above the puddles and nowhere else. One pair of small
boots on the ground.

Everything sits low on a single thin horizon line. No object is taller than one quarter of
the image height. There is a lot of empty space between the objects. The top three quarters
of the picture is completely EMPTY flat sand, with nothing in it at all.

Colours: the ground and the sky are both flat sand #E7DCC9, with deep sand #E0D3BC and tan
#B9A888 for anything that needs a second earth tone, dark brown #7D6B57, cream #FFFDF9 for
paper-white shapes, and near-black #171310 for the outlines only. ONE accent colour,
<ACCENT>, is used on just one or two small shapes — no large blocks of colour anywhere.
Every shape is BRIGHTLY and FLATLY coloured; do not draw this in greyscale or in black and
white even if the real objects usually are.

Style: children's colouring-book cartoon. VERY THICK uniform black outlines on every shape,
flat solid fills, no shading, no gradients, no texture. Absolutely NO text, NO letters, NO
numbers, NO frame, NO border box. Every sign, board and banner in the picture is a blank
unlettered shape. Generous empty negative space across the whole upper area, with nothing
drawn in it. There are no people anywhere in the picture — this is objects and landscape
only.
```

Rain wants to fill the sky, and the sky is the part of a band that must stay empty. Hence
"just above the puddles **and nowhere else**". If this comes back with rain across the whole
strip, the fix is to cut the raindrops entirely rather than to argue with it — puddles alone
read as rain.

### 6.5 The lake and the dock · summer

```
A wide, very short horizontal strip. A very short wooden dock of five planks on two posts at
the left, a small canoe in <ACCENT> beached on the ground beside it, three tall thin reeds
standing alone in the middle, and one duck on the ground at the right. The water is a single
thin horizontal line, not a filled area.

Everything sits low on a single thin horizon line. No object is taller than one quarter of
the image height. There is a lot of empty space between the objects. The top three quarters
of the picture is completely EMPTY flat sand, with nothing in it at all.

Colours: the ground and the sky are both flat sand #E7DCC9, with deep sand #E0D3BC and tan
#B9A888 for anything that needs a second earth tone, dark brown #7D6B57, cream #FFFDF9 for
paper-white shapes, and near-black #171310 for the outlines only. ONE accent colour,
<ACCENT>, is used on just one or two small shapes — no large blocks of colour anywhere.
Every shape is BRIGHTLY and FLATLY coloured; do not draw this in greyscale or in black and
white even if the real objects usually are.

Style: children's colouring-book cartoon. VERY THICK uniform black outlines on every shape,
flat solid fills, no shading, no gradients, no texture. Absolutely NO text, NO letters, NO
numbers, NO frame, NO border box. Every sign, board and banner in the picture is a blank
unlettered shape. Generous empty negative space across the whole upper area, with nothing
drawn in it. There are no people anywhere in the picture — this is objects and landscape
only.
```

### 6.6 Autumn branches · autumn

```
A wide, very short horizontal strip. Three small bare branching trees standing far apart
along the ground line, a low pile of fallen leaves beneath the middle one, three separate
fallen leaves lying on the ground between them, and one single leaf in <ACCENT>.

Everything sits low on a single thin horizon line. No object is taller than one quarter of
the image height. There is a lot of empty space between the objects. The top three quarters
of the picture is completely EMPTY flat sand, with nothing in it at all.

Colours: the ground and the sky are both flat sand #E7DCC9, with deep sand #E0D3BC and tan
#B9A888 for anything that needs a second earth tone, dark brown #7D6B57, cream #FFFDF9 for
paper-white shapes, and near-black #171310 for the outlines only. ONE accent colour,
<ACCENT>, is used on just one or two small shapes — no large blocks of colour anywhere.
Every shape is BRIGHTLY and FLATLY coloured; do not draw this in greyscale or in black and
white even if the real objects usually are.

Style: children's colouring-book cartoon. VERY THICK uniform black outlines on every shape,
flat solid fills, no shading, no gradients, no texture. Absolutely NO text, NO letters, NO
numbers, NO frame, NO border box. Every sign, board and banner in the picture is a blank
unlettered shape. Generous empty negative space across the whole upper area, with nothing
drawn in it. There are no people anywhere in the picture — this is objects and landscape
only.
```

Bare branches are the one subject where the thick-outline style is at risk from the opposite
direction: a fine twiggy canopy is hairline strokes, which is exactly what
`CLAUDE.md` forbids at this brightness. Ask for **branching**, not for a tree's real branch
structure, and if what comes back has more than about five limbs per tree, regenerate rather
than shipping it.

### 6.7 The seedling row · spring

```
A wide, very short horizontal strip. Six very small seedlings in a widely spaced row along
the ground line, one small watering can in <ACCENT> standing at the left end, two thin
plant stakes leaning in the middle, and one short section of low picket fence at the far
right.

Everything sits low on a single thin horizon line. No object is taller than one quarter of
the image height. There is a lot of empty space between the objects. The top three quarters
of the picture is completely EMPTY flat sand, with nothing in it at all.

Colours: the ground and the sky are both flat sand #E7DCC9, with deep sand #E0D3BC and tan
#B9A888 for anything that needs a second earth tone, dark brown #7D6B57, cream #FFFDF9 for
paper-white shapes, and near-black #171310 for the outlines only. ONE accent colour,
<ACCENT>, is used on just one or two small shapes — no large blocks of colour anywhere.
Every shape is BRIGHTLY and FLATLY coloured; do not draw this in greyscale or in black and
white even if the real objects usually are.

Style: children's colouring-book cartoon. VERY THICK uniform black outlines on every shape,
flat solid fills, no shading, no gradients, no texture. Absolutely NO text, NO letters, NO
numbers, NO frame, NO border box. Every sign, board and banner in the picture is a blank
unlettered shape. Generous empty negative space across the whole upper area, with nothing
drawn in it. There are no people anywhere in the picture — this is objects and landscape
only.
```

Six seedlings is the one place this file names a count, and it does so knowing §2.4 — a row of
"about six" small identical shapes is a pattern rather than a set of countable instances, and
nothing downstream cares if it comes back as five or eight. Never write a count where the
number matters.

### 6.8 The winter treeline, re-cut · winter

This is what `assets/backgrounds/household.jpg` already is, written down so it can be
reproduced rather than only admired. Three deliberate changes from what is on the wall: cream
rather than pure white fills, an explicit ban on the third repetition of the treeline that
makes the current one read as wallpaper, and the accent on a whole small object rather than on
one tree in a row of identical trees.

```
A wide, very short horizontal strip. A pair of pine trees at the left, a single low rounded
hill with a cream snow cap in the middle with one small pine beside it, and a pair of pines
at the right. One small sledge in <ACCENT> lying on the ground between the middle and the
right group. Each group is different from the others; do not repeat the same arrangement
across the strip.

Everything sits low on a single thin horizon line. No object is taller than one quarter of
the image height. There is a lot of empty space between the objects. The top three quarters
of the picture is completely EMPTY flat sand, with nothing in it at all.

Colours: the ground and the sky are both flat sand #E7DCC9, with deep sand #E0D3BC and tan
#B9A888 for anything that needs a second earth tone, dark brown #7D6B57, cream #FFFDF9 for
the snow, and near-black #171310 for the outlines only. ONE accent colour, <ACCENT>, is used
on just one or two small shapes — no large blocks of colour anywhere. Every shape is
BRIGHTLY and FLATLY coloured; do not draw this in greyscale or in black and white even if
the real objects usually are.

Style: children's colouring-book cartoon. VERY THICK uniform black outlines on every shape,
flat solid fills, no shading, no gradients, no texture. Absolutely NO text, NO letters, NO
numbers, NO frame, NO border box. Every sign, board and banner in the picture is a blank
unlettered shape. Generous empty negative space across the whole upper area, with nothing
drawn in it. There are no people anywhere in the picture — this is objects and landscape
only.
```

---

## 7. What went wrong

Every row is a failure that actually happened, either recorded in `tools/backgrounds.md` and
`tools/gen-icon.py` or found in the research above. The wording column is the fix, not a
paraphrase of it.

| What you get | Why | The wording that fixes it |
|---|---|---|
| **Random dimensions** — 2064x512 one call, 1408x768 the next | Not the model. `aspectRatio` lives in `generationConfig.imageConfig` and the OpenAI-shaped chat-completions path strips it (§2.2) | Pass `image_config` if the proxy honours it; say the frame in the prompt too — `A wide 16:9 landscape illustration, edge to edge` — and post-process to exact pixels regardless |
| **A beautiful monochrome** — the first soccer ball, and any snow or bone or city subject | The subject is achromatic in life, so the model draws it that way, and it becomes the only greyscale thing on a wall of flat colour | `Every shape is BRIGHTLY and FLATLY coloured; do not draw this in greyscale or in black and white even if the real objects usually are — substitute a colour from the palette instead.` |
| **A bicycle a fifth of the frame wide** in a band | "Small" is one instruction and the model needs three | All three, together: `no object taller than one quarter of the image height` + `a lot of empty space between them` + `the top three quarters is completely EMPTY flat sand` |
| **A solid orange mountain filling the lower left** — the accent becomes the ground | Nothing bounded how much of the picture the accent was allowed to cover | `ONE accent colour, <ACCENT>, is used on just one or two small shapes — no large blocks of colour anywhere.` |
| **A filled blue sea or a filled sky** in a band, same failure, different noun | Water and sky are areas by default | `The water is a single thin horizontal line, not a filled area.` |
| **Lettered signs, plaques and flags** despite four `NO` clauses | Prohibition is the weakest instruction in the prompt (§2.1), and this model is *good* at text, so it is inclined to add some | Keep the `NO` clause and pair it: `Every sign, flag, banner, board and box in the picture is a blank unlettered shape.` |
| **Uncoloured line art** — a real colouring-book page | "Colouring book" is a term of art meaning black-and-white outlines with no fills; that is what purpose-built [coloring-page generators](https://colorbliss.com/) and [Firefly's coloring-page feature](https://www.adobe.com/products/firefly/features/ai-drawing-generator/coloring-page.html) are built to produce | Never shorten the prompt by dropping the palette paragraph. The named hexes plus `flat solid fills` are the only thing separating our style from the genre the phrase names |
| **The wrong number of anything** | Counting is a measured weakness; accuracy collapses past about five instances ([Make It Count](https://arxiv.org/pdf/2406.10210), [numerical reasoning eval](https://arxiv.org/html/2406.14774v3)) | Do not ask for a count. Name activity clusters for a scene; name the emptiness for a band |
| **Everything in the wrong place** | Spatial words land under 40% of the time ([VISOR](https://www.microsoft.com/en-us/research/wp-content/uploads/2023/08/Benchmarking_Spatial_Relationships_Text_To_Image_Generation.pdf)) | Prompt the placement anyway, then **author the regions from what came back**. Distinguish the three by SCALE — `two or three times the size of everyone else` — which the model does honour |
| **Tap regions that miss the child** | The source was not 16:9, `cover` centre-cropped it, and regions are percentages of the container not the image (§2.3) | Cut to exactly 1920x1080 before opening the JSON |
| **A figure with its head behind the points card** | A band was treated as if it could hold a figure | No figures in a band, ever. Figures go in scenes and avatars |
| **A ground that competes with the cards** | White ground; the cards are white | Ground is sand `#E7DCC9`. Where a subject needs to read as white, use cream `#FFFDF9` and let the outline do the work |
| **Chrome that sinks into the art** | The floating doors and the stale chip sit top-right over whatever the illustration put there | `The top strip of the picture, all the way across, is calm and light` |
| **A treeline that reads as wallpaper** | The same group repeated across the strip | `Each group is different from the others; do not repeat the same arrangement across the strip.` |
| **A 403 that looks exactly like an auth failure** | The endpoint rejects Python's default `urllib` User-Agent | Send `User-Agent: family-calendar-icons/1.0`. Already in `tools/gen-icon.py`; do not remove it |
| **An HTML error page, or prose, instead of an image** | The Nous proxy does this occasionally | Retry. `gen-icon.py` raises on `no image in response` rather than writing a broken file — keep that behaviour in anything new |
| **A set that does not match** | Wording alone was never sufficient; it failed three times on the icons | Reference-image conditioning, up to 14 images (§2.6). It is the lever that worked first time |
| **A scene where the same child is always bottom-left** | Slot-to-position mapping copied between scenes | Scramble it per scene. If there is nothing to find, the screen is a picture with a button on it |

---

## 8. Before you paste: the disclosure check

Every prompt in this file contains **scene nouns and archetypes only**, and that is a property
to preserve, not a claim to trust. Before any prompt leaves the house, read it once for:

- **No names.** Not a child's, not a pet's, not a school's, not a street's.
- **No "my", "our", "the family".** An archetype describes nobody; a possessive describes this
  household.
- **No hair colour, no photograph, no likeness.** `a cheerful cartoon girl of about seven in a
  magenta t-shirt` is an archetype. Anything that would let you pick a real child out of a
  line-up is not, and generated depictions of real children are the one thing this repo will not
  produce.
- **No real dates, events or locations.** The activities this household enjoys are fine as
  *themes*; bound to identities they are household data.

The ages in §5 are age *bands* and they are the design requirement, which is the same reason
the redaction convention keeps them: **Child A (7, reads fluently) / B (5, emergent) / C (3,
pre-reader)**. That convention is for prose about the household, never for a prompt. No prompt
in this file refers to a child of this house at all, and none ever should.

Both tests from ADR-0002 still have to pass, not just the first: these are **build-time
assets**, committed to the repo, read off local disk. The wall never calls an image API. If the
provider vanishes tomorrow, the pictures already exist.

---

## 9. Where `tools/backgrounds.md` has gone stale

Not wrong when written. Wrong now, because the code moved. Fix these there, or at least do not
be misled by them here.

1. **"No people. Not a silhouette, not a figure in the distance."** Scoped to bands as of the
   day scenes shipped. `assets/scenes/campsite.jpg` contains roughly two dozen figures and is
   correct. See §1.
2. **"Aspect ratio is not controllable."** True of what we observe, wrong about why, and the
   diagnosis matters because it points at a fixable proxy problem rather than a model
   limitation. See §2.2.
3. **"Adding a scene: drop the JPEG in `assets/backgrounds/`, then add its basename to `SCENES`
   in `web/src/app/WallBackdrop.tsx`."** There is no `SCENES` constant in `WallBackdrop.tsx`;
   it hardcodes `/backgrounds/household.jpg`. The section is also using "scene" to mean *band*,
   which now collides head-on with `assets/scenes/` and `SceneView` — two different things under
   one word in one repo. The collision is no longer hypothetical: there **is** a scene
   catalogue, `SCENE_IDS` in `web/src/views/logic/sceneCatalog.ts`, and it has nothing to do
   with bands. Following that section as written would put a band's basename into a list that
   the scene renderer will try to read a manifest for.
4. **"The four bands together come to ~176 KB."** There is one band, and it is 50 KB.
5. **"[the accent] must be that child's slot accent (`--c-id-1/2/3`) so the band and their cards
   agree."** True of a per-child band. `WallApp` renders `WallBackdrop` only when
   `activeChild === null && !showingScene`, so the band is shared and never appears on a child's
   screen. A slot accent on a shared band claims the shared board for one child. See §3.
6. **The two-kinds section lists avatars and the band**, and predates the third kind entirely.
   Scenes are neither, and the differences are not cosmetic — they are 16:9, they are cropped
   by `cover`, they carry authored hit regions, and they are the only asset a child touches.

One thing in that file that is **not** stale and should be read before anything else here: the
consistency ladder, and specifically that lever 3 (normalise in post) *"is the one that cannot
fail"* while lever 1 (one prompt scaffold) *"is necessary and nowhere near sufficient"*. This
file is a very long lever 1. Do not mistake it for a guarantee.
