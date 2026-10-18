# The scene pipeline — stable children, rotating style, informed by the week

> **Provider update 2026-09-12:** the design below stands unchanged; the provider moved to
> fal.ai, where the same three avatars hold the cast on three models across cartoon, anime and
> photoreal. Measurements, the likeness line and the remaining work: `docs/scene-imagery-plan.md`.
>
> **Prompt update, same day:** the prompt was rewritten (v2) around identity as the household
> defines it — count, height order and hair, with clothes and faces the model's to invent —
> and the roster moved out of prose into `db/cast.json`, read by both the generator and the
> finder. §4's "hand-measured regions" and the Nous prices below are historical; the finder
> runs on fal at $0.003 a pass and fits tap targets rather than refusing over padding. What
> was measured and why: `docs/scene-prompting-review.md`.

**Plan, 2026-09-02.** Requested: backgrounds that keep the same three children across every
picture, vary the *artistic* style between pictures, rotate weekly, and let the coming weekend's
events and weather inform what is drawn and what the children are wearing. Designed to be run by
sub-agents, in the shape `docs/build-plan.md` established: contracts first, disjoint file
ownership, and an explicit list of what an agent may not decide.

---

## 0. The finding that changes the shape of this

**We already have a character bible. It is `assets/avatars/{a,b,c}.jpg`,** and it is better than
anything a written description would produce:

| Slot | Child | Avatar |
|---|---|---|
| 1 | A · fluent | brown hair in bunches, hazel eyes, magenta |
| 2 | B · emergent | **blonde, high ponytail**, blue eyes, amber |
| 0 | C · picture | blonde, blue-and-red bike helmet, hazel eyes, blue |

Checked against the live wall: **the avatars are already right.** B's avatar *is* the blonde one
with the ponytail. So the reported defect — *"the picture shows B as a brunette at a table"* — is
not a missing description. It is that **the scene figures were never tied to the avatars at
all.** A's scene figure happens to match (brown hair, magenta). C's half-matches (helmet, wrong
top colour). B's matches on nothing: a small brunette in purple where the avatar is a blonde in
amber, and drawn at background scale so she is also the hardest figure to find and the smallest
tap target in the set.

**So the bible does not need writing. It needs wiring.** Three consequences, and they are what
make the rest of this plan cheap:

1. **No new household data leaves the house.** The avatars are committed house art. Verified:
   `prompt_guard.enforce_references(('assets/avatars/a.jpg', …))` **passes today** — the guard
   was built to allow exactly this and to refuse a photograph from outside `assets/`. The
   disclosure posture of this whole feature is therefore *unchanged*, and no hair colour, age or
   interest has to be typed into a prompt at all. That is a strictly better answer than writing
   the details down, and it is available now.
2. **The mechanism is already proven here.** `tools/gen-icon.py` passes approved images as
   references — lever 4 in `tools/backgrounds.md`, the thing that made the eleven-icon set come
   back coherent first time after wording alone had failed three times. Scenes get the same
   treatment with different attachments.
3. **It closes an open backlog question (private notes) in the affirmative.** That item asked whether this project should
   generate pictures of children at all. Investing in stable, recognisable child figures is the
   opposite answer, deliberately given. It should be recorded there as decided, not left open.

## 1. Consistency vs. style variation — measured, and it is smaller than it looked

The worry was that character consistency comes from conditioning on a reference image, and a
reference carries its **style** as well as its characters — so attaching the avatars would pin
every scene to the house colouring-book look, which is the thing that is supposed to vary. The
planned answer was a **style sheet**: the three children redrawn once per style, approved by
hand, and used as the reference thereafter.

**Tested 2026-09-02 on the hardest case, and the style sheet turned out not to be a
prerequisite.** `pencil-spot` — a graphite world with selective spot colour, about as far from
flat colouring-book cartoon as this list goes — was generated with only the three avatars
attached and the style paragraph swapped. The style transferred completely: graphite mountains,
paper texture, pencil-shaded clouds, and the spot colour landing on exactly the three children.
The characters transferred too — brown bunches in magenta, blonde ponytail and blue eyes in
amber, blonde in the blue-and-red helmet.

**What the test also showed, which is the useful half.** The world went pencil; *the children did
not*. They are still drawn with the avatars' thick outlines and flat fill, sitting in a graphite
landscape. In `pencil-spot` that is arguably the point — spot colour and "find yourself" are the
same idea, and it makes the three children the most findable they have ever been. In
`cozy-painted` or `dreamlike` the same effect would read as three cartoon children pasted onto a
painting.

So the rule is sharper than "we need style sheets":

> **The avatars pin the characters *and* how they are rendered. A style sheet is needed exactly
> where the style should change how the CHILDREN are drawn, not only the world.**

WP-A therefore drops from a blocking prerequisite to a **per-style decision**, taken when that
style is first tried and recorded in `tools/scene-styles.json`. Two of the six may never need
one. That is the single biggest simplification in this plan and it came from one image.

### The style table

`tools/scene-styles.json` holds six styles, five of them extracted from the household's own
example prompts with the *subject* stripped out — a boy in an oak tree, a whale in the sky, a
rainy window seat — because the setting comes from the week and the style is what rotates. Each
entry carries a `wall` field recording what was changed from the household's wording and why.

| id | What it is | Status |
|---|---|---|
| `house` | Flat colouring-book cartoon | The incumbent and the benchmark |
| `pencil-spot` | Graphite with **fine crosshatching** and spot colour | Household wording, whole. Spot colour bound to the three children |
| `dreamlike` | Luminous fantasy, **soft dreamlike quality** | Household wording, whole |
| `cozy-painted` | Warm painterly | Household wording. Children sit inside the lit pool |
| `naive-crayon` | A child's own drawing | Household wording. See the identity note below |
| `lantern-night` | Luminous night | Household wording. Untested; the lit-pool clause is kept as cheap insurance |

### I softened two of these and I was wrong to — measured 2026-09-02

The first pass stripped *"fine crosshatching"* out of `pencil-spot` and *"soft, slightly blurred
… as if viewed through enchanted glass"* out of `dreamlike`, citing the repo's no-hairline-strokes
rule. Both were generated A/B and both softenings are reverted.

**The rule was mis-scoped.** "No sub-14px type, no hairline strokes" is a **UI** rule — type, card
borders, chrome — where a stroke either resolves or the element is broken. An illustration's
texture has no such duty. Crosshatching that softens into tone at ten feet is crosshatching
*working*; that is what crosshatching is for.

**The panel, measured rather than assumed** (Elo 2270L, 21.5", 1920×1080):

| | |
|---|---|
| Pixel density | 102.5 PPI, 0.248 mm pitch |
| Finest resolvable feature at ~10 ft (idle wall) | **3.58 device px** |
| Finest resolvable feature at ~18 in (a child at the glass) | **0.54 device px** — individual pixels resolve |

So there are two audiences on one screen, which is exactly H8's point: the picture is glanced at
from the kitchen *and* walked up to and touched. Sub-4px detail is invisible from the sofa and
crisp at arm's length. That makes it a **reward for walking over**, which H8 explicitly calls an
asset on a child's screen — not a defect.

**What the A/B actually showed.** Simulating the 10-foot acuity limit and adding the repo's 0.10
flare:

| | RMS contrast, near | at 10 ft | retained |
|---|---|---|---|
| Softened (my wording) | 50.7 | 41.8 | 82% |
| **Fine crosshatch (household wording)** | **58.7** | **46.9** | 80% |

The same proportion survives, and the household's version starts with materially more contrast —
so it is the *better* image on this panel, not the riskier one. Per-child figures track: 78–83%
retained either way. And the fine version is visibly richer: an aspen grove with individual
leaves, crosshatched peaks, a real crowd — none of which cost the three children anything.

**The blur worry was unfounded for a different reason.** The model reads *"soft dreamlike
quality"* as **atmosphere** — palette, glow, distance haze — not as a blur over the subjects. The
three children came back crisp and fully saturated against it. The clause was never doing the
thing I removed it for.

**What survives from the caution, honestly:**

- `lantern-night` is **untested**, and its concern is different in kind — overall *luminance*, not
  fine detail. A contrast measurement cannot settle "is a dark picture too dark in a bright room".
  The lit-pool clause stays until somebody looks at it on the glass; it costs nothing and it is
  good composition anyway.
- The `naive-crayon` note stands, because it was never a display claim: round-headed stick
  proportions strip out nearly every way to tell one child from another, so identity there rests
  almost entirely on hair and garment colour.
- The top-strip restatement stands and was a real improvement — **low in detail and even in
  tone**, not "light". `lantern-night`'s indigo sky serves the white chrome pills *better*.

**The limit of what I can test.** A CDP screenshot is the framebuffer, not the glass — it cannot
show nits, etched-glass diffusion or room light, so the simulation above is optics only. The
225-nit figure the repo quotes is also flagged in CLAUDE.md as **unverified**, taken from the
2470L datasheet for a panel that turned out to be a 2270L. The final call on any style is eyes on
the wall, and the images are there to be looked at.

**On the Waldo treatment.** `crowd` is per style. Three findable children is mandatory
everywhere — the rail is hidden on this screen — but a dense searchable crowd behind them is
optional, and forcing one into `dreamlike` or `lantern-night` produces clutter rather than a
search. Clutter behind a child is exactly what makes her unfindable.

## 2. Context: what the week is allowed to tell the picture

> **Built 2026-09-13** as `tools/scene_context.py`, on by default in `scene-week.py`, frozen
> per week to `db/scene-context/<week>.json`. §2.1–2.3 below are the design as written; the
> one addition is a holiday table (props, never a setting). See `docs/scene-ideas.md` §4 for
> what each source becomes in the prompt and `docs/scene-inputs.md` for what the household
> can still supply.

Two inputs, and the interesting engineering is in what is **not** passed.

### 2.1 Events — categories only, never titles

`src/calendar/classify.ts` already maps an event title to one of ten categories
(`school`, `celebration`, `sport`, `dance`, `medical`, `hygiene`, `travel`, `outing`, `music`,
`kitchen`), locally, with no network. That classifier was built for icons and it is exactly the
redaction this needs.

**The rule: the scene prompt may receive the category and the day, and never the title.** This is
not a hypothetical risk — `docs/design-review/H5-layout-proposal.md` already recorded that a
"short visual description" step will happily emit *"[child]'s dance recital"*. A category cannot.
So the weekend that produced `trailer-camp` reaches the model as **`outing, Saturday–Sunday`** and
nothing else: no place, no companions, no name.

The classifier is high-precision and low-recall by design, so most events classify to nothing.
That is the correct failure: no category means the scene is chosen on season and weather alone,
which is a good picture rather than a wrong one.

### 2.2 Weather — coarse, and never on the critical path

A forecast is not household data, but the **location** implied by asking for one is. Round the
grid point to 0.1° (≈11 km) before it leaves the house, and store the rounded value — not a
street, not a postcode. Open-Meteo needs no key and no account.

The household's town, given 2026-09-02, rounds to one 0.1° cell (the example file uses
**41.9, −87.6**). That cell is about 11 km across and covers a large part of a metro area,
which is the point: it is enough
to know it is going to snow and not enough to know where anybody lives. It goes in
`household_config`, not in a source file, so it is changed without a deploy.

Availability is unaffected because **generation is not on the wall's critical path at all**. The
wall renders committed and promoted files from local disk. If the forecast call fails, the
generator falls back to season, and if the whole run fails the wall keeps last week's picture.

What weather is *for*, in priority order: **what the children are wearing** (coats, wellies, sun
hats), then the ground (snow, puddles, dry grass), then the activity. The household asked for the
clothing specifically and it is the part that reads at ten feet.

### 2.3 The deliberate channel: a calendar note

The household asked to be able to pass specific detail for a specific week — *"I can prompt you,
or you can add a calendar note in my calendar to pass that detail."* The second is the better
mechanism and it does not weaken §2.1, because it is a different kind of thing.

**§2.1 forbids sending a title the household wrote for its own purposes.** A note written *in
order to be sent* is not that. It is an author choosing their words knowing where they go, which
is the same posture as every prompt in `docs/image-prompts.md`.

So: an all-day event whose title begins with a marker — `scene:` — is read as a scene hint, and
**only the text after the marker is passed**. `scene: everyone in ski gear, lots of snow` reaches
the model verbatim; nothing else on the calendar does. Three properties make this safe rather
than a hole in the rule:

- **Opt-in per event.** No marker, no transmission. The default stays "category only".
- **The marker is the consent.** It cannot be typed by accident, and it is visible in the
  household's own calendar UI, so what is being sent is legible where it is written.
- **It still passes the guard.** `prompt_guard.enforce` runs on the assembled prompt, so a note
  containing a name is refused at the wire like anything else. The channel is deliberate; it is
  not unchecked.

### 2.3a Two runs a week, and a director chooses the picture (2026-10-18)

Until 2026-10-18 the setting, style and camera were arithmetic on the week number, and a table
of keywords (`scene-headlines.json`, now deleted) swapped in a setting when an event matched
"ski" or "birthday". The household's verdict was that a keyword list is not judgement: a ski
trip need not be a snowy hill, and the examples were only examples. So the choice is a model's
now, and everything after the choice stays deterministic.

**Two runs, splitting the week.** The timer fires Sunday and Wednesday at 02:30 in the
household's zone (`install.sh` writes `timezone` from `household.json` into the installed
timer; the server itself runs UTC). The Sunday run is `2026-W43` and looks at Sunday..Tuesday;
the Wednesday run is `2026-W43b` and looks at Wednesday..Saturday. Each brief is the days its
picture is actually on the wall, so the two never describe the same day. Each offers two candidates (one per model), so a week has four to choose from, and the
ids carry the run (`2026w43b-…`). Each run freezes its own brief in `db/scene-context/`.

**The director** (`tools/scene_director.py`, one Gemini 2.5 Flash call through
`fal_api.text`, about $0.002) reads the run's brief and answers JSON: a catalog setting or an
invented one (a place description, a crowd, optional wardrobe, one to three place tags), a
style, a camera, a premise and a one-line why. It sees the catalog flagged in-season,
occasion-only (`"season": []`: `birthday-party`, `setting-off`) or out-of-season, the settings
the wall showed most recently, a random shortlist of three fresh in-season settings to lean
toward when nothing stands out, and the styles not recently on the wall. Everything it may pick
is an id from the household's own tables, and the answer is validated like the activity
writer's (§2.5): word counts, no quotes, no signs or lettering, no names, the prompt guard,
wardrobe that keeps every face visible, tags from the closed place vocabulary. A refusal is
retried once with the reasons quoted back; a second refusal, or no answer at all, falls back
to the rotation, and nothing is frozen, so the next run asks again. A valid decision is frozen
in `db/scene-director/<run>.json`, so a retry of the same run draws the same picture.
`scenes.director: "rotation"` turns it off; `--setting` and `--no-director` bypass it per run.
A dry run does not ask unless `--ask-director` is passed.

**What it is told.** By default only what §2.1 already allows: category counts, weather, the
holiday, the `scene:` note, and "N grown-ups and M children visiting". `scenes.shareTitles:
true` also sends the window's one-off event titles and the visitors' descriptions. It is opt-in
because a title is household data leaving the house. Either way the image prompt carries no
title and no name; the director's words are checked for names before they are used.

**Visiting family** (`tools/scene_guests.py`, `db/guests.json`, synthetic twin
`db/guests.example.json`). Each guest has names to match, an age band, hair and a height. A
visit is detected only when an event in the window names a guest **and** carries a visit word
("visiting", "in town", "staying", "arrive"…), so a birthday on a contacts calendar is not a
visit. Present guests join the picture by description (a grown-up, an older child, hair, height
against the children's landmarks), never by name, and the finder is told about them as decoys
so it does not tap a cousin. A run with no guests produces a prompt byte-identical to before.

### 2.3b What the dog is up to, and children further back (2026-10-18)

**The dog has moods.** He used to be hiding in every picture. The household's ask: *"not just
hiding in every picture, which is funny for some pictures... have him playing on his own, if
anything, or doing something funny."* `tools/scene-dog.json` lists what he may be doing:
chasing his tail, a stick too big for him, flat on his back in a leaf pile, shaking off after
a swim, sneaking a sandwich, asleep in the sun, sitting in a suitcase, and more. Each mood
names its `places` (the same closed vocabulary as the activities) and may name `seasons`.
`hiding` is still one of them and stays the most likely. He is always **on his own** and
never posed with the children; that was asked for, and his tap target is dropped near a
child's anyway.

The director chooses the mood with the rest of the picture. A choice that does not fit the
place or season is dropped and drawn instead; the decision is not refused over it. Without a
director, a seeded weighted draw picks one, salted apart from the activity seed. The dry run
prints `dog     :`. `hiding` sends no `--dog-doing` flag at all, so its prompt is byte-identical
to every earlier picture and cached pictures are reused. A director decision frozen before
this existed has no `dog` key and means hiding, for the same reason. The finder is told what
he is doing so it looks for a dog doing that, not a hidden one. `npm run verify:dog`.

**Stacked children are fitted, not refused.** `fit_gutters` used to open the gap between two
tap targets only sideways, which assumes the children stand in a row. A small child further
back stands *above* a near one instead. That is a composition the household likes (*"I like
the option of having kids smaller and in the background"*), and `2026w43-autumn-forest-nb2`
was refused for an 8px vertical gap that no sideways trim could open. Now the pair opens
along whichever axis is closer. A stacked pair loses the bottom of the upper box first (feet,
never the head), then the top of the lower one, and neither box drops under the 48px height
floor. The same `MAX_TRIM_PX` cap applies: one child drawn across another is still refused.
`npm run verify:finder` runs the measured nb2 geometry as a case.

## 2.4 Where the activities come from — proposed, and my recommendation

> **Reversed 2026-10-12 — see §2.5.** The household asked for written activities, and the
> runtime call this section argued against is now the default. The table below is kept as
> the fallback, and the reasoning is kept because §2.5 answers it point by point.

Asked 2026-09-04: *"maybe there's a method to randomize what the kids are doing... or maybe we
have a local AI model generate activities to do while camping... Or do we just leave that up to
the AI?"*

**Short answer: no, do not leave it to the image model, and yes to a local model — but as an
AUTHORING tool, not a runtime dependency.**

### Why not the image model

Three reasons, all of them things that already happened rather than worries:

1. **It does not know the downstream constraints.** The region finder needs the three children
   separated by a tap gutter, faces visible, each ≥1.5in tall. "All three sitting in a row on a
   log" satisfied the prompt beautifully and came back 1px and 4px apart — refused. Unconstrained
   invention optimises for a nice picture, not a navigable one.
2. **A refusal costs $0.14 and a re-roll; a constraint costs nothing.**
3. **"Surprise me" converges.** An image model asked to pick returns its favourite few ideas,
   which is the original complaint — *"not always on the same animals or scooters or bears."*
   Sampling from an explicit list is what makes the tail actually get drawn.

### What is already fixed, today

`tools/scene-activities.json` was already a sampled list rather than fixed poses, but two things
were wrong and are now right:

- **One activity per FAMILY.** Three of the twenty-one solo entries are animal-riding, so an
  unconstrained sample of three put one child on a bear and another on an elk in the same
  picture — which reads as the generator having one idea, not as three children having three.
  Each entry now carries a `family` and at most one per family is drawn.
- **Breadth beats depth.** The refusal message says so out loud: a pool that cannot fill three
  distinct families *"needs more KINDS of thing, not more entries of a kind it already has."*

### The recommendation: local model as an author, not a runtime

**Do not put an LLM call inside the weekly scheduled generation.** It buys variety and it costs
a new way for the 6:00 AM path's upstream job to fail, for something the committed list already
does deterministically. `SCENE_IDS` is a floor for exactly this reason; the activity pool should
be one too.

Instead, run the local model **once, offline, to grow the list**, and commit the result:

```
ollama run hermes3:8b "20 things a child does at a lakeside campsite, five words each, no names" \
  | tools/vet-activities.py --setting lake --season summer >> tools/scene-activities.json
```

Three properties that makes it the right shape here:

- **It is free, private and offline.** Ollama on the home server, no household data in the prompt, no
  hosted provider — it passes both ADR-0002 tests without an argument.
- **A human sees the list.** What the children are depicted doing is worth one glance from an
  adult, once. Not never, which is what runtime generation means.
- **It cannot fail at 3 AM.** A committed list has no failure mode.

`tools/vet-activities.py` is the piece to build, and its job is refusal, exactly like
`scene-regions.py`. It should drop anything that:

| Refuse | Because |
|---|---|
| implies swimming, bathing or undress | the clothing refusal exists because a model drew a child bare-chested |
| seats or huddles them together | the tap gutter; "in a row on a log" already fails |
| implies a back view or being carried | the facing rule — a child must be findable by her face |
| names a person, brand or real place | keeps the pool safe to send anywhere later |
| duplicates a `family` already present | the bear-and-elk problem |
| does not slot into "The child from portrait 1 is ___" | it is a fragment, not an activity |

### The one case a list cannot cover, and it is already designed

A specific weekend — *the* camping trip, a birthday, a first day of school — is not a themed
sample, it is a fact about that week. That is the **`scene:` calendar note** in §2.3: an all-day
event titled `scene: everyone in ski gear, lots of snow` passes its text through verbatim. That
channel already exists, it is opt-in per event, and it is the right place for "this week is
special" precisely because it is authored rather than inferred.

So: **the list for the ordinary week, the note for the particular one, and a local model to
grow the list when it starts feeling small.** The scheduler picks by season and setting from
what is committed, which is the part that must never need a network.

## 2.5 Written activities — the reversal of §2.4 (2026-10-12)

Asked 2026-10-12: *"kids activities can be ai generated and creative. it does not have to drive
from a list."* So `scenes.activities` (in `db/household.json`, default `"written"`) now has a
text model write each scene's activities, and the table is what it falls back to. Set it to
`"table"` to get §2.4 back exactly; the prompt fixture is pinned in table mode.

**What runs.** `tools/scene_activity_writer.py` makes ONE call through `fal_api.text()`
(fal `any-llm`, `google/gemini-2.5-flash`, allowlisted and ledgered, about $0.002). It receives the
setting's text, tags and indoor flag, the season, THIS WEEK's lines, the crowd, wardrobe and
swimwear flag, the number of children, whether this picture is shared or solo (the same seeded
coin `pick_activities` tosses, so the choice does not move), and the last three written sets as
"do not repeat". No names, ages, heights or household rows. It answers
`{"lines":[{"do","kind"}]}`.

**§2.4's three objections, answered:**

1. *It does not know the downstream constraints.* It is told them, and code checks them. Every
   line must start with a lowercase -ing verb, be one sentence of at most 140 characters, and be
   a distinct KIND. It must not be upside down, cover a face, carry a child, mention swimwear
   (unless the setting opts in), be dangerous, be outdoor-only in an indoor setting, carry a
   capital letter, single out one child or relative, or guess a child's sex. It must also pass
   `prompt_guard`. A refused answer is retried once with the reasons quoted. A second refusal
   falls back to the table and says so on stderr.
2. *A refusal costs a re-roll.* The writer refuses in text, at $0.002, before any image is
   bought; the image refusals §2.4 describes still belong to the region finder.
3. *"Surprise me" converges.* The recent sets go in as "do not repeat", and the guard refuses
   a word-for-word repeat.

**It cannot fail at 3 AM in a way that matters.** If the writer cannot be reached, the table
deals the activities exactly as before, and nothing is frozen, so next run tries again. A
human still sees every picture before it goes up; that was always the gate.

**Frozen per scene.** The answer is written to `db/scene-activities/<base scene id>.json`
(gitignored) with the model, prompt version and an inputs digest. Both candidates of a pair read
the same file, and a re-run never calls the model again, so `--reuse-if-same` keeps working.
A changed input after freezing is noted on stderr, not re-written; delete the file to buy a new
set. A story moment or a premise's own list still wins, and then no call is made.

**Tools.** `scene-week.py --dry-run` spends nothing and prints `activities: written at draw
time` or the frozen set. `scene-week.py --write-activities` writes and prints the set and draws
nothing. `gen-scene.py --activities-file <set.json>` re-validates a set and phrases it the way
`pick_activities` does. `check_tables`' "not enough KINDS" refusal is a warning in written mode,
which is what lets a five-child household run; it is still a refusal in table mode.

**Measured on the tuning calls (19 text calls, $0.038).** Gemini 2.5 Flash opened lines with
"gently" or "carefully" in about half its answers and repeated it on a retry with the reason
quoted, so one leading `-ly` word directly before the verb is trimmed rather than refused.
It also gave children "her" and "his" when a setting's wardrobe named them, which is why a
gendered pronoun is a refusal.

## 3. Promotion: the committed set is a floor, generated scenes are additive

`web/src/views/logic/sceneCatalog.ts` argues at length that the scene list is **committed** so
that `test/unit-h.scenes.test.ts` can prove every id resolves to a picture and a manifest with at
least one authored region *before it ships* — and that a runtime index puts the whole feature
behind one file whose loss is invisible, because an empty pool degrades to the information board,
which looks completely fine.

A weekly generated picture arrives between deploys and cannot be checked that way. **Do not
resolve this by replacing the committed list.** Resolve it the way this codebase already resolves
exactly this problem twice — `asset_fallback._default` is mandatory and undeletable, and
`sync_run` stages a generation and promotes it with a single atomic `UPDATE`:

- `SCENE_IDS` stays, unchanged, as the **guaranteed floor**. If every generated scene is broken
  or absent, the wall shows `trailer-camp` or `campsite` and nothing is lost.
- Generated scenes are an **addition** to that pool, and a generated scene is only ever selected
  after it has been **staged, validated and promoted**. Validation failing is normal and costs
  one week's novelty, never the picture.
- Promotion is one atomic write, and the previous promoted scene is never deleted before its
  replacement exists.

### 3.1 Off, static, generated, and the backdrop under the floor (2026-10-12)

`household.json`'s `scenes.mode` decides whether there is a picture at all. `off` is the
information board and no picture: `activeScene` returns `null` before reading the library, and
nothing is retired, so switching back restores the library exactly as it was. `static` and
`generated` both show the newest approved scene; they differ only in whether the Sunday
generator runs.

A **backdrop** is a scene with no tap targets. Its manifest says `"static": true` and
`regions: []`, and that flag is the only thing that lets an empty region list count as usable.
Without it, `[]` is still a scene the finder failed on, and `readSceneManifest` still returns
`null`. On a backdrop the rail's avatars do the navigating, so "the children navigate by the
picture", and every rule built on it, does not apply. A backdrop needs no finder, no review and
no PIN to go up. A household adds its own with
`provision.ts --add-backdrop <photo.jpg|png> [--id <slug>]`. That command copies the file into
the volume, writes the static manifest and approves it, and it refuses anything over 4 MB.

The committed floor is two pictures, least preferred first: `backdrop`, then the committed
baseline scene. A static manifest always ranks below a scene with tap targets, so no list of
ids decides it. `backdrop` reuses the idle band's figure-free picture
(`backgrounds/household.jpg`), so it fits any household: any number of children, or none. A
committed picture WITH tap targets drew a fixed number of children. It is approved only on a
database whose household has exactly that many active children. Anywhere else it is registered
as a `candidate`, and the boot log says
`baseline scene <id> needs <n> children, household has <m>: registered, not approved`. The
check runs once, when the row is first inserted, and a row already in the database is never
changed. So a household that adds its children after the first boot approves the waiting
picture from the Pictures screen, like anything else.

Baselines are stamped backwards from the fixed epoch. The newest-ranked one sits exactly on
it, and anything ranked below it is strictly older. A floor added underneath can therefore
never tie with, or outrank, a picture a live wall already shows. `test/unit-g.backdrop.test.ts`
proves this against a database that already has an approved generated scene.

## 4. The unsolved piece, and it is the one that can put a dead screen on the wall

**Tap regions.** Every scene needs three rectangles in fractional coordinates saying where each
child is, and `scenes.ts` is blunt about the stakes: the rail is hidden on the scene screen
because *the picture is the navigation*, so a scene with a wrong region **is not a degraded screen,
it is a dead end that looks exactly like a working one.** A child taps herself, nothing happens,
and there is no visible way onward.

Today those rectangles are hand-measured. Weekly generation cannot be.

The approach, in order of how much it is trusted:

1. **Constrain the composition so position is nearly known.** The scaffold already fixes each
   slot's place — bottom left, centre, bottom right — and both committed scenes deliberately keep
   the same activity per slot so the pre-reader is not made to hunt again. Keep that; it makes the
   search a verification rather than a detection.
2. **Locate each child with a vision model, and take its box.** A VLM is asked, per slot, for the
   bounding box of "the large child in the foreground at the left picking flowers".
3. **Validate, and refuse rather than guess.** A scene is promoted only if all three boxes are
   found, each is ≥ the 96px tap floor at 960×540 logical, none overlaps another, each is ≥16px
   from its neighbours, and — the check that catches the real failure — **each box actually
   contains the right child**, verified by asking the VLM to match the crop against that child's
   avatar. That last check is what would have caught B being drawn as a brunette.

**How small may a child be drawn?** `MIN_CHILD_HEIGHT_IN = 1.5`, and it is expressed in
**inches on the glass** because that is the only unit the question has a real answer in. A
fraction of frame height means nothing without the panel: the first version was `0.18`, which
sounds modest and is **1.9 inches** — a big figure, and it was quietly forcing every scene back
into three near-foreground poses, which is the opposite of what was asked for. On this panel
(21.5", 16:9 → 10.54" tall) 1.5 inches is 14.2% of frame height, 77 logical px, 154 device px.

At ten feet that subtends about 43 arcmin, so the figure is a clear shape and hair and shirt
colour read easily while facial detail does not — which is the right split, because colour is
the identity channel on this wall and detail is the reward for walking up (H8).

It is judged on the child **as drawn**, before the tap-floor padding, so padding cannot launder
a child who is genuinely too far back.

**Anything that fails is not promoted.** There is no partial credit and no human is asked to
review a picture at 6 AM.

## 5. Work packages

Contracts first. **WP-0 must land before anything else starts**, because five agents write
against it.

| # | Package | Owns | Depends on | Done means |
|---|---|---|---|---|
| **0** | **Contracts** — style table, manifest v2 (`style`, `generatedAtUtc`, `validation`), staging layout, the context record passed to the generator | `docs/scene-pipeline-contracts.md`, `src/types.ts` additions | — | Types compile; every field has a stated failure behaviour; frozen |
| **A** | **Style sheets** — `gen-character-sheet.py`; conditions on the three avatars; one PNG per style | `tools/gen-character-sheet.py`, `assets/characters/*` | 0 | House style sheet reproduces the avatars recognisably; one second style generated and reviewed |
| **B** | **Scene generator** — conditions on a style sheet + setting + context; the scene scaffold from `docs/image-prompts.md` §4 | `tools/gen-scene.py` | 0, A | Two scenes in two styles, same three children recognisable in both |
| **C** | **Regions + validation** — VLM boxes, the five checks in §4, emits the manifest or refuses | `tools/scene-regions.py` | 0 | Correctly refuses a scene with a deliberately mis-drawn child; passes both committed scenes |
| **D** | **Context providers** — weekend event *category* via `classify.ts`, weather via Open-Meteo at 0.1° | `src/context/*.ts` | 0 | A unit test proves no event title can reach the output record |
| **E** | **Schedule + promotion** — weekly run, stage → validate → promote, floor preserved | `src/scenes/*.ts`, scheduler wiring | 0, C | Killing the generator mid-run leaves the previous scene promoted and intact |
| **F** | **Wall side** — cadence, and the manifest v2 read | `web/src/views/logic/scenes.ts`, `sceneCatalog.ts` | 0, E | Committed floor still selected when the generated pool is empty |

A, B, C and D are independent of each other once WP-0 lands, which is where the parallelism is.

**What a sub-agent may not decide.** Add to the list in `docs/work-packages.md`:

- Whether a scene is promoted — the validation thresholds in §4 are the contract, not a
  suggestion, and no agent may lower one to get its own output to pass.
- What may go in a prompt. `prompt_guard.enforce` runs inside every generate function and must
  stay there; a second backend is exactly how a disclosure rule quietly becomes a property of one
  code path.
- The style list, and whether a style sheet is approved.
- The cadence. That backlog question (private notes) is still the household's and this plan does not pre-empt it — it
  makes weekly *possible*, and the switch stays one line in `WallApp`.
- Anything that would delete or overwrite a committed scene, avatar or style sheet.

## 6. Sequencing

Nothing here needs to land at once, and the first step is worth doing on its own:

1. **Regenerate `trailer-camp` with the avatars attached as character references.** No new
   tooling, no schedule, no context — one prompt change and one file. It fixes the reported defect
   and it proves or disproves the entire premise of §1 for the price of one image.
2. WP-0, then A and D in parallel.
3. B, then C. C is the long pole and the one to give the most careful agent.
4. E and F, which are small once C is trustworthy.

## 7. Open, and the household's to answer

1. ~~**The style list.**~~ **Answered 2026-09-02** — five example prompts supplied, extracted
   into `tools/scene-styles.json` (§1). Show names never had to be used: the household's own
   prompts were already written as attribute descriptions, which is why they transfer cleanly.
2. ~~**Weather location.**~~ **Answered** — rounded to one 0.1° cell, kept in the gitignored `db/scene-place.json` (§2.2).
3. ~~**What "informed by the weekend" should feel like.**~~ **Answered** — weather, plus events
   at the end of the week, plus the opt-in `scene:` calendar note for a specific week (§2.3).
   The note is what makes the ambitious reading safe: the *setting* can follow the weekend when
   the household has said what the weekend is, and falls back to weather and season when it has
   not — which is most weeks, and is a good picture rather than a wrong one.

**Still open, and genuinely:**

4. **Which styles get a character sheet.** Per §1 this is now decided per style, on sight, the
   first time each is generated. `pencil-spot` demonstrably does not need one.
5. **Cadence** — a backlog question (private notes), unchanged and still the household's. This plan makes weekly
   possible; adopting it stays one line in `WallApp`.
