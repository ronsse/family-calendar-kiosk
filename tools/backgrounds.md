# Regenerating the wall backgrounds

The illustrated horizon bands in `assets/backgrounds/` are **build-time assets** (ADR-0002).
The wall reads them off local disk and never calls an image API, so the availability test is
satisfied structurally: if the provider vanishes, the art already exists.

## The two rules that are not negotiable

**Disclosure.** Prompts carry scene nouns only — mountains, a tent, a bicycle, pine trees.
No name, no age, no hair colour, no pet, no "my family", no household reference of any kind.
The activities this household enjoys are fine as *themes*; bound to identities they are
household data and must not leave the house (build-plan.md §3.1, ADR-0002). This is no longer
a rule you have to remember while typing: `tools/prompt_guard.py` refuses a prompt that carries
a roster name, an age or kin binding, possessive household framing, or a likeness request, and
`gen-icon.py` runs it before it opens a socket. `npm run verify:prompts` is its self-test.

**No likeness of a real child — anywhere.** Not from a photograph, not from a description, not
"the one who looks like this". An archetype describes nobody in particular; a likeness describes
somebody, and the second one is what this repo will not produce.

*Generic* cartoon figures are a different question, and the two surfaces want opposite answers —
which is why "no people" was the wrong summary of this rule and is not the rule:

- **Scenes** (`assets/scenes/*.jpg`) REQUIRE figures. They are search-and-find pictures whose
  entire mechanic is that each child spots themselves in the crowd and taps themselves to open
  their own day; a scene with nobody in it is not a scene. Nothing binds a figure to a person by
  name — `campsite.json` maps each region to a `slot`, the same accent position the rail and the
  backdrop already use, so no asset file knows whose figure is whose.
- **The band** (`assets/backgrounds/household.jpg`) takes NO figures. Not a silhouette, not one
  in the distance. It is the one strip of the wall that cards are guaranteed to sit on top of,
  and measured there a figure came out with its head behind the points card and its feet off the
  bottom edge. Decoration that is half-covered reads as a bug, not as decoration.

## The model

`google/gemini-3-pro-image` (Nano Banana Pro) through the Nous inference proxy, which is
billed to Nous credits and needs no Google key:

```bash
op read "op://<vault>/<item>/<field>"
```

`POST https://inference-api.nousresearch.com/v1/chat/completions` with
`modalities: ["image","text"]`. Images come back as `choices[0].message.images[].image_url.url`,
base64 data URIs. The proxy occasionally answers with an HTML error page instead — retry.

**Aspect ratio is not controllable.** The same prompt returns 2064x512 or 1408x768 at random,
so the composition rule below does the work instead, and CSS finishes the job with
`background-position: bottom`.

## The style, since 2026-08-26

**Children's colouring-book cartoon.** Very thick uniform black outlines on every shape, flat
solid fills, no shading, no gradients, no texture. Ground is the page's own sand `#E7DCC9`,
never white — white competes with the cards, which are white.

This is the rare style that is both the more playful choice and the more legible one: a heavy
black line is the one mark that does not collapse at 225 nits behind anti-glare etched glass.
The earlier national-park-poster bands were replaced because they read as muddy and adult on
the panel.

## THREE kinds of image, and they are not interchangeable

**Avatars** (`assets/avatars/*.jpg`) — a square head-and-shoulders portrait per child, on a
flat circle of that child's accent. 256px, which is four times the 64 they render at. These
are what a picture of a child is FOR: always visible, never occluded, and the thing a
pre-reader navigates by.

**Scenes** (`assets/scenes/*.jpg` + a `.json` beside each) — a full-bleed search-and-find home
screen, and the ONLY kind that is supposed to be crowded with figures: the mechanic is that
each child finds herself in it and taps. Generic cartoon people are required here, and the
tappable rectangles are AUTHORED in the JSON in fractional coordinates. A region below the
64px tap floor, or one boxing the wrong figure, is a dead end that looks like a working
screen. Nothing to do with the band below, despite both being large JPEGs of outdoor places.

**The band** (`assets/backgrounds/household.jpg`) — a sparse decorative strip along the bottom
of the IDLE wall only. Not on a child's screen: measured there, a figure in the corner came
out with its head behind the points card and its feet off the bottom edge, because a child's
day fills the wall. Decoration that is half-covered reads as a bug.

If you change one, do not assume the other wants the same treatment.

## Consistency across a set

**The hard requirement is that the set matches, not that any one image is good** (ADR-0002).
Four levers, weakest to strongest:

1. **One prompt scaffold.** Vary only the subject clause; keep the style and composition
   paragraphs byte-identical. This is necessary and nowhere near sufficient — the first avatar
   set came back with three different head sizes and three different circle sizes from
   identical scaffolding.
2. **Generate the set in one batch.** Cheap, and it helps a little.
3. **Normalise in post.** The avatars are cropped to their OWN accent circle's bounding box,
   so the framing becomes identical by construction whatever the model did with it. This is
   the lever that actually fixed the set, and it is the one that cannot fail.
4. **Reference-image conditioning — the real fix, and now the default for icons.**
   `google/gemini-3-pro-image` is `text+image->text+image`: you can pass an approved image in
   the message and ask for the next one "in exactly this style". That is what the model is
   built for and it beats any amount of prompt wording. It is what made the eleven-icon set
   come back coherent first time, after wording alone had failed three times, and it is what
   let the five event icons be added two days later without the set drifting.

   **Use `tools/gen-icon.py`.** That script is levers 1, 3 and 4 in one command, and it exists
   because this document described the approach and shipped no code — so the first attempt to
   extend the set had to rediscover the mandatory `User-Agent` header (the endpoint 403s
   Python's default, and it looks exactly like an auth failure) and the fact that a subject
   whose real-world colours are achromatic comes back greyscale unless the prompt forbids it
   outright. A monochrome soccer ball is a beautiful image and would have been the only
   greyscale thing on a wall of flat colour.

**What DinkyDash does about this: nothing, because it never generates.** Its config gives each
recurring task an `emoji` and each person an optional `image`, so the art is pre-drawn and
uniform by construction — one font family, rendered by the OS. That is a real option for the
routine icons too, and worth weighing: emoji are free, perfectly consistent, instantly
recognisable to a child, and they cost the house style. See <https://github.com/caspii/dinkydash>.

## Replacing an avatar

`main.ts` reconciles `rel_path` for every id the manifest declares, so changing the path in
`assets/manifest.json` is enough — the boot log says `relocated N`. Ids the manifest does NOT
declare are never touched, which is how household-authored imagery survives.

## The prompt shape

Three parts, concatenated. The scene sentence changes; the other two never do.

1. **Scene** — one sentence, at most four objects, each placed explicitly ("at the bottom
   left", "at the far right").
2. **Palette** — name the hexes from `tokens.css` literally: sand `#E7DCC9`, deep sand
   `#E0D3BC`, tan `#B9A888`, dark brown `#7D6B57`, near-black `#171310`, plus **one** accent,
   which must be that child's slot accent (`--c-id-1/2/3`) so the band and their cards agree.
3. **Composition and style** — verbatim:

   > Style: children's colouring-book cartoon. VERY THICK uniform black outlines on every
   > shape, flat solid fills, no shading, no gradients, no texture. Absolutely NO text, NO
   > letters, NO numbers, NO frame, NO border box.

**Scale is the instruction that keeps failing**, and it needs saying three ways or the model
ignores it. "Small" is not enough; "no object taller than one quarter of the image height",
"a lot of empty space between them" and "the top three quarters is completely EMPTY flat sand"
together are what finally worked. The first two attempts came back with a bicycle a fifth of
the frame wide and a solid orange mountain filling the lower left — both of which fight a
chore board rather than sit behind it.

The other repeated failure is **large blocks of colour**. Say "the accent is used on just one
or two small shapes — no large blocks of colour anywhere", or the accent becomes the ground.

**No people in the band.** A figure needs to be whole to read, and there is nowhere on this
wall that reliably leaves a figure whole. People go in avatars.

## What may and may not go in a prompt

An **archetype** is fine: an age, a gender, an activity, a style. `a cheerful cartoon
seven-year-old girl sitting at an upright piano` describes nobody in particular and returns a
cartoon child rather than a portrait of one.

**Superseded 2026-09-03 — read this first.** The household settled the whole question: *"there
is no personal information that we passed. It's just clothing, settings, hair, eye color, age,
names. Those things do not matter. They're not PII."* Description is no longer refused.
`tools/prompt_guard.py` carries `POLICY = "described"`; names, ages, kin relations, hair, eyes,
clothing and settings all pass, are reported as advisories so the receipt still says what went
out, and `POLICY = "redacted"` restores the old behaviour in one word.

**Two things that decision did not cover, and they stay hard.** A *likeness* — a photograph, or
"draw her like this picture" — is a different class from a description and is the one
disclosure that cannot be walked back; `check_references` still refuses any attachment that is
not committed house art. And *other people*: `docs/scene-pipeline.md` §2.1 passes calendar event
CATEGORIES and never raw titles, because those titles carry other families' names and other
people's children. A parent can decide what leaves the house about their own children; they
cannot decide it for the friends in the calendar.

The rest of this section is the pre-2026-09-03 reasoning, kept because it is why the guard is
shaped the way it is.

An earlier pass made this stricter — no numeric age, on the reasoning that three prompts
carrying 7, 5 and 3 in one afternoon are the roster arriving one field at a time — and the
operator overruled it on 2026-08-29. Ages go out. `tools/prompt_guard.py` does not check for
them, and there is a note there saying not to re-add it.

The concern he raised instead is upstream of any wording, and no filter addresses it:
**whether this project should be generating pictures of children at all.** That is tracked in
BACKLOG as "Retire the generated child imagery". Policing how a child is described is a
distraction from deciding whether to draw one.

A **description of this household** is not. No names, no hair colour, no pet, no "our family",
no photograph, no location tied to the family. That is the disclosure test, and the difference
between the two is not the intent behind the prompt but the bytes that leave the house.

## Post-processing

Crop to the bottom 58% (keeps the horizon, drops spare sky), resize to 1920 wide — one device
pixel per source pixel on a 1920px panel at `KIOSK_SCALE=2.0` — and save JPEG q82 progressive.
The one band is ~50 KB. Anything much larger is a boot cost for decoration.

## Adding a BAND

(This section is about `assets/backgrounds/`, the decorative strip — NOT about
`assets/scenes/`, the search-and-find screens. Both are large JPEGs of outdoor places and the
two are easy to confuse; read the path.)

**Corrected 2026-08-29, after this section sent an agent looking for code that does not
exist.** It used to say "add its basename to `SCENES` in `WallBackdrop.tsx`, and slot order
must match accent order or a child gets someone else's colour". There is no `SCENES` constant:
`WallBackdrop.tsx` hardcodes `url("/backgrounds/household.jpg")`, there is exactly ONE band
rather than four, and it is not per-child at all — `WallApp` renders the backdrop only when no
child is selected, so it is a shared board decoration and a slot accent would claim it for one
child. The paragraph about accent order was describing a design that was replaced.

So: drop the JPEG in `assets/backgrounds/` and point `WallBackdrop.tsx` at it. `main.ts` seeds
`assets/**` into the volume on
boot and skips files that already exist — so **replacing** an existing background needs the
old file deleted from the volume first:

```bash
docker compose exec wall rm /data/assets/backgrounds/camp.jpg
docker compose restart wall
```
