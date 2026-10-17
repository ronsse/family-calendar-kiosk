# Scene imagery on fal.ai — what holds the three children, and the plan around it

**2026-09-12.** Asked: *"How should we be designing this AI system? What can fal or FLUX do?
What are the best image models and what can they do? Do I need to provide more sample pictures,
or describe the children better? How can we make ultra-realistic images of all three kids doing
something, switch between that and anime and children's-book styles, and keep a consistent theme
of all three showing up, tied to what is coming up?"*

The short answer, measured rather than argued: **the pipeline already built is the right
design; only the provider was wrong.** Three 256px cartoon avatars are enough to hold all three
children across cartoon, anime and photographic renderings on four different models. Nothing
more needs to be uploaded, nothing more needs to be described, and no training is needed.

---

## 1. What was measured today

One prompt — `autumn-forest`, `eye-level`, the real `gen-scene.py` `build_prompt` with the real
`CHILDREN` block and the three committed avatars attached — sent to eight fal.ai models in three
styles. Two of the styles (`photoreal`, `anime`) do not exist in the table yet and were written
for the test. Every image, the contact sheets and the probe script are kept in a scratch directory
outside the repo. Spend: about **$2.30** of the $25.

The only score that matters is the one FLUX failed on 2026-09-11: *did it draw THESE three
children* — each avatar's hair, in that height order?

| fal model | house | photoreal | anime | output | $/image | verdict |
|---|---|---|---|---|---|---|
| `fal-ai/nano-banana-pro/edit` (Gemini 3 Pro Image) | ✓ | ✓ | ✓ | 2752×1536 | 0.15 | holds everything; the same model Nous sold at $0.14 |
| `fal-ai/nano-banana-2/edit` (Gemini 3.1 Flash Image) | ✓ * | ✓ | — | 2752×1536 | 0.12 | holds identity; *once put the eldest at the back, smaller than the other two |
| `openai/gpt-image-2/edit` | ✓ | ✓ | — | 1920×1072 | 0.053 (medium) | holds identity, best height order, native 1080p, **cheapest that works** |
| `fal-ai/gpt-image-1.5/edit` | ✓ | ✓ | ✓ | 1536×1024 | 0.034 | holds identity but 3:2 only — superseded by gpt-image-2 |
| `fal-ai/flux-2-pro/edit` | ✓ | cast held, but cartoon kids on a painted background — not a photograph | ✓ | 1920×1072 | ~0.045 | holds identity; cannot leave the reference style. *Corrected 2026-09-12: first scored "boy missing"; he was there in a different jacket* |
| `fal-ai/nano-banana/edit` (Gemini 2.5 Flash) | ✓ | stayed cartoon | weak | 1344×768 | 0.039 | holds identity, cannot leave the avatars' style |
| `fal-ai/bytedance/seedream/v4/edit` | ✓ | cartoon kids pasted on a photo | **✗ four kids** | 2048×1152 | 0.03 | no |
| `fal-ai/flux-pro/kontext/max/multi` | pasted | **✗ wrong kids** | **✗ two kids** | 1392×752 | 0.08 | no |

Two seeds were run for the top six on `house` and `photoreal`; the scores held. **No model
refused a photoreal rendering of children from cartoon references** — the content-policy risk
the research flagged (Google's `personGeneration` allowlist, OpenAI's extra safeguards for minors)
did not fire on fal for this material. That is one observation on one day, not a guarantee.

What the sheets show that the table cannot: `gpt-image-2`'s `house` picture is the best layout of
the whole set (three children front and centre in order, dog, deer, picnickers, bridge — a real
search-and-find); `nano-banana-2`'s photoreal picture is genuinely photographic and every child is
right; `nano-banana-pro`'s anime is the most painterly. Any of the three is a wall picture.

## 2. What the models can and cannot do

**Gemini image (nano-banana family) and OpenAI image (gpt-image-2)** are the two families that
treat attached images as *who* and the prompt as *how*. Both re-drew the children in the
requested technique — photograph, cel-shaded anime, thick-outline cartoon — while keeping hair,
eyes and age order from three small cartoons. That is exactly the split `docs/scene-pipeline.md`
§1 hoped a style sheet would buy, and it comes for free with these models. Google states it
holds "up to 5 people" per image; OpenAI states nothing and does it anyway. Both are closed,
both are cloud-only, both sit behind fal with one key.

**FLUX** is a different animal. FLUX.1 (NVIDIA, free) is text-only and cannot hold a cast at
all — measured on five scenes on 2026-09-11. FLUX.2-pro/edit takes references and held the cast in
all three styles — its failure is STYLE, not identity: asked for a photograph it paints a cartoon
cast onto a photographic background. Kontext got one of three. FLUX's real strength
is *places* and *icons* — anything where nobody in particular is in the picture. It stays the
free path for icons (`gen-icon.py --provider nvidia`) and is not a scene generator.

**LoRA training** (`flux-2-trainer` ~$8/run, `flux-lora-fast-training` $2, `qwen-image-trainer`
$2) is how people held characters before multi-reference editing existed. It wants 10–20 varied
images per subject; we have one 256px head-and-shoulders per child, which is under every
trainer's floor, and stacking three character LoRAs in one call (`flux-2/lora/edit`, max 3) is
the fragile way to get what nano-banana-2 does in one request with no training. **Not
recommended.** It would only become interesting if the household wanted a *likeness*, and that
is a separate decision (§3.3).

**Seedream, Kontext, Ideogram Character (single character only), Imagen (no references),
OmniGen** — measured or documented out.

## 3. Constraints on the pictures

### 3.1 More sample pictures? No — one cast sheet, maybe

Three portraits held identity on every model that can hold identity at all. More reference
photos would not improve that, and photographs are refused by `check_references` by design.

What the avatars do NOT carry is **bodies**. They are head-and-shoulders, so height order and
build are the least stable thing in the set: `nano-banana-2` once put the eldest at the back and
`kontext` drew the boy tallest. `CHILDREN` says the order in words and the models mostly obey.

The cheap fix, if the order keeps slipping: **one cast sheet** — the three children full-length,
side by side, tallest to shortest, in the house style, on a plain ground. Generated once from the
three avatars (nano-banana-pro, ~$0.15), approved by a human, committed under `assets/avatars/`,
and attached as a fourth reference. It passes `check_references` because it *is* committed house
art derived from house art, and it discloses nothing the avatars do not. Measure with and without
on five scenes before keeping it; do not add it on faith.

### 3.2 Describe the children better? No

The written description is the thing that failed. `CHILDREN_AS_TEXT` is what FLUX gets, and FLUX
drew four children, two children, and three blondes. The attached-portrait path is what
succeeded, with the `CHILDREN` block as it stands. Policy since 2026-09-03 *allows* names, ages
and hair in a prompt; the measurement says they do not help. Leave the block alone.

### 3.3 "Ultra-realistic images of all three kids" — what that does and does not mean

It works today: `nano-banana-2` and `gpt-image-2` both produced photographic children with the
avatars' hair, eyes and ages. Those are **invented children who match the cartoons** — not
the real children's faces. A viewer who knows the avatars finds them instantly; a
viewer who knows the children would say "that's not them".

Making them *actually* look like the children means uploading photographs, and that is the one
line this project draws hard, in code (`prompt_guard.check_references` refuses any attachment
that is not committed house art) and in the 2026-09-03 policy note (*"a photograph is a
different class of thing from a description — it is the one disclosure that cannot be walked
back, and it was never what the household was talking about"*). It is also the case Google gates behind an
allowlist and OpenAI wraps in extra safeguards, and the material would sit in fal's storage and
two providers' logs. **Recommendation: keep the line.** The wall's mechanic — find yourself and
tap yourself — is satisfied by the avatar match, which is what the rail shows anyway. If the
household ever wants real likeness, that is an ADR, not a flag: it reverses a documented
decision and the photos do not come back.

The guard already enforces the spirit of this: my first photoreal prompt said *"rendered as
REAL children"* and was refused as a likeness request before it left the house. Reworded to
*"full photographic realism"* it passed. That is the guard working.

### 3.4 The wall's physics still apply

Photoreal on a 225-nit anti-glare panel is the hardest style for the screen's one job: three
findable children at ten feet. The test pictures put the children at roughly a third of frame
height, front and centre, which is fine; a photoreal *wide* landscape would not be. `PLACEMENT`
and `scene-regions.py`'s size floor are what protect that, and they apply unchanged. Whether a
photograph of invented children *belongs* on a family wall — it reads as a family photo of
someone else's family — is a taste question for the household, not a technical one. Anime and
storybook have no such problem.

## 4. The design — what stays, what changes

**Everything upstream of the provider stays.** The avatars as the bible; `scene-settings`,
`scene-styles`, `scene-compositions`, `scene-activities` as four independent axes;
`scene-week.py` picking one of each from the week's season and event *categories*;
`prompt_guard` on every outbound prompt and every attachment; `scene-regions.py` finding the
three children and refusing pictures where it cannot; a generated scene as a **candidate** that
a human approves behind the PIN. All of that was designed for exactly this and none of it
knows which provider it is talking to.

**What changes:**

1. **`gen-scene.py --provider fal --model <id>`.** Direct calls to `queue.fal.run`, avatars as
   `data:` URIs (three 256px JPEGs; no storage upload), `Authorization: Key`. The model id is an
   **allowlist of three** — `nano-banana-2/edit`, `nano-banana-pro/edit`, `gpt-image-2/edit` —
   because a model that has not been measured holding the cast is not a scene generator. Default
   `nano-banana-2/edit` at 2K 16:9; `gpt-image-2/edit` at 1920×1080 medium is the cheap second
   opinion. Keep `--provider nous` as the code path it is (same model, different door) and
   `--provider nvidia` for icons.

2. **Scenes do NOT go through the LiteLLM router.** The `image` / `image-fast` tiers added
   2026-09-11 are text-to-image (`fal-ai/nano-banana`, `flux/schnell`) and cannot take
   references at all — and a router's whole point is fallback, which here means a picture of
   the wrong children arriving silently from the fallback leg. That is the project's signature
   failure. Scenes call one named model and fail loudly.

3. **A price table and a ledger.** fal returns no `usage.cost` (Nous did), so the tool carries
   the per-image price for each allowlisted model and appends a line per call to a local ledger.
   fal has no balance endpoint I could find; the ledger is the balance.

4. **Two candidates a week, not one.** At $0.12–0.17 a pair, `scene-week.timer` can offer the
   approver a choice — two seeds, or one from each family — which is what turns approval from
   a yes/no into a pick. $0.24/week is $12.50/year.

5. **The vision pass moves too.** `scene-regions.py` calls Nous for the $0.007 identity check
   and Nous is dead. fal serves vision LLMs (`fal-ai/any-llm/vision`, unverified) and NVIDIA
   serves free ones; either way we now have a **labelled test set** — the 2026-09-11 FLUX
   failures (four kids, two kids, all blonde, backs turned) and today's passes — to score a
   candidate checker against before trusting it.

## 5. Switching styles with a constant cast

Styles are already a data table with weekly rotation, so "switch between realistic and anime
and children's-book" is **two new rows in `scene-styles.json`**, not a feature:

- `photoreal` — `crowd: false`, needs the household's yes (§3.4). The wording that passed the
  guard and produced the test pictures is in the probe script, kept outside the repo.
- `anime` — `crowd: false`. Tested on five models; the Ghibli-manner wording produced painted
  skies and cel-shaded children on all of them.

Then the existing five (`house`, `pencil-spot`, `dreamlike`, `cozy-painted`, `naive-crayon`,
`lantern-night`) get re-measured on the chosen model — one image each, ~$0.70 — and their `wall`
notes updated, because everything in those notes was measured on Gemini-via-Nous and
`gpt-image-2` may draw them differently. The `naive-crayon` identity worry (two blondes, no
clothing channel) is the one to watch.

The cast stays constant because the *references* stay constant. The **theme** — what they are
doing and where — already follows the calendar: `scene-week.py` reads the coming weekend's event
categories and the season and picks setting and activities from them. Nothing new is needed
there; it was blocked on a provider, not on design.

## 6. What would not work

- **FLUX text-only for scenes.** Measured twice. Places yes, cast no.
- **FLUX.2 or Kontext with references.** Better, and still loses a child.
- **Training LoRAs from three avatars.** Under the data floor, $8–25 a run, and the stacked
  three-LoRA call is the fragile version of what a $0.12 request does.
- **Routing scenes through a fallback chain.** The fallback is a different model with different
  identity behaviour; the failure is silent by construction.
- **Uploading photographs to fix likeness.** Refused in code, reverses a documented decision,
  and cannot be walked back. An ADR if ever; never a flag.
- **Trusting the content-policy result.** It passed today on cartoon references. Google
  documents gating for realistic minors; a future model revision may refuse. Keep `anime` and
  the five illustration styles as the rotation's backbone so a refusal on `photoreal` costs a
  week's variety, not a week's picture.

## 7. Work, in order, with cost

| # | what | cost | status |
|---|---|---|---|
| WP-1 | `--provider fal`, allowlist, price table, ledger, `--model` | $0 to build | **done** — `tools/fal_api.py` |
| WP-2 | `photoreal` + `anime` rows; re-measure the five existing styles on the fal models | ~$1.00 | rows **done**; `house`, `photoreal`, `anime` measured on both models (review §5); the other four styles still unmeasured on fal |
| WP-3 | `scene-week.py` → fal, two candidates, `close-front` composition finally verified | ~$0.30 | two candidates **done**; `close-front` still unverified |
| WP-4 | vision pass off Nous; score candidates against the labelled set | ~$0.10 | **done** on `fal-ai/any-llm/vision` (Gemini 2.5 Flash); 12/12 located and verified, no scoring against the FLUX set yet |
| WP-5 | cast sheet — only if height order slips | $0.15 | **not needed on the evidence**: prompt v2 with landmark heights held the order 8/8 (`docs/scene-prompting-review.md`) |
| WP-6 | backlog item (private notes), second half — approved scenes into the picture catalog | $0 | open |

Running cost after that: **$6–13/year weekly**, $44–88/year daily. $25 of credit is ~200
`nano-banana-2` scenes or ~470 `gpt-image-2` scenes.

## 8. Decisions that are the household's, not mine

1. **Likeness stays out** (recommended, §3.3) — or an ADR to reverse it.
2. **Is `photoreal` in the rotation at all?** Works; may not belong on the wall. Sharper
   since 2026-09-13: the `impossible-photo` premise (a photograph of the children on a
   unicorn, on a rope in a superhero suit) is the best probe of that day and is photoreal by
   definition — `docs/scene-ideas.md` §2.1, `docs/scene-inputs.md` row 10.
3. **Default model:** `nano-banana-2` (best photoreal, 2K, $0.12) or `gpt-image-2` (best
   cartoon layout, 1080p, $0.053). Both hold the cast; I would run both and let the approval
   screen pick.
4. **Cadence:** weekly (the timer as built) or daily.
