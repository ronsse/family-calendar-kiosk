# ADR-0002 — Generated imagery for routine steps; the no-cloud invariant, restated

```yaml
status: accepted
date: 2026-08-22
deciders: the operator
supersedes-part-of: ADR-0001 (PRD §4 "no cloud inference, ever")
```

## Context

The routine runner (roadmap M4) shows picture-led steps a pre-reader can follow — *get
dressed → brush teeth → shoes → bag*. Those pictures have to come from somewhere, and a
consistent set of ~15–30 of them is not something you draw by hand.

PRD §4 said "**No cloud inference, ever.**" Taken literally that forbids generating the
icons in the cloud. Taken as intended, it never meant that — it was written to stop the
household's schedule being shipped to a hosted provider.

## The distinction that actually matters

Not *where* the model runs. **What leaves the house, and when.**

|  | Household data in the payload? | Runtime or build-time? | Cloud permitted? |
|---|---|---|---|
| Conversation agent ("what's on today?") | **Yes** — calendar, tasks, names | Runtime | **No** |
| Routine icon generation ("flat icon of a toothbrush") | **No** — generic noun, no household reference | Build-time | **Yes** |
| Photo→event OCR of a school flyer | **Yes** — school, dates, often the child's name | Batch, but still household data | **Not covered by this ADR** |

Two independent tests, both of which must pass for a cloud call to be allowed:

1. **Disclosure.** Does the outbound payload contain anything about this household? A prompt
   reading `flat vector icon of a toothbrush, bold shapes, friendly children's style`
   discloses nothing. A school flyer discloses a great deal.
2. **Availability.** Is the display's correctness at 6:00 AM dependent on that call
   succeeding? Icon generation is **build-time** — the wall reads PNGs off local disk and
   never calls an image API. If the provider vanishes, the icons already exist.

## Decision

**Restate PRD §4** from "no cloud inference, ever" to:

> **No cloud inference on household data, and no cloud dependency at display time.** Any
> outbound call must pass both the disclosure test and the availability test above. Runtime
> conversation stays local and pinned by model name.

**Generate routine imagery as build-time assets**, committed to this repo, by either path:

- **Cloud, first pass (recommended).** Imagen 4 Fast (~$0.02/image) or Nano Banana 2 (batch
  ~$0.023–0.075/image). A full set of ~30 icons costs **roughly one dollar, once.** That is a
  one-off spend, not a subscription — the thing PRD §4 rules out is recurring paid services
  and runtime dependencies, and this is neither.
- **Local on the desktop GPU, if iterating heavily or going strictly offline.** RTX 4070 12GB runs
  **SDXL** (~7GB FP16, ~12–20s/image) with the deepest LoRA + ControlNet ecosystem, which is
  what actually buys *style consistency across a set*. FLUX.1 dev FP8 (~11GB, ~25s/image on a
  4070) has better prompt adherence but leaves little headroom and a thinner LoRA ecosystem.
  Cost: standing up ComfyUI on the desktop — a real service to own for a job that runs a few times a
  year. Nightly/weekly batch, triggered through the home server's power-control API; the desktop's ~2 min wake is
  irrelevant for a batch job.

Start cloud. Move to the desktop only if the iteration count justifies owning ComfyUI.

## Constraints on the images themselves

- **Style consistency across the set** is the hard requirement, not per-image quality. One
  seed + one style LoRA (local) or one reference image (Nano Banana Pro maintains character
  consistency by design) beats thirty individually good, mutually inconsistent icons.
- **Bold shapes, high contrast, no fine detail.** The panel is 225 nits behind anti-glare
  etched glass and is read by children from 3–10 ft. Illustration detail that looks charming
  on a laptop turns to mud on the wall.
- **The icon palette must not collide with the per-person calendar colours.** If a routine
  icon is the same blue as a person, the colour-coding stops meaning anything.

## Alternatives considered

- **Material Design Icons** (already shipped with HA). Free, instant, perfectly consistent by
  construction, and maximally legible on a dim panel. This is the **baseline the generated
  set has to beat** — if generated illustrations don't read better on the actual wall, fall
  back to MDI without regret.
- **Photographs of the household's actual objects** — the real backpack, the real hook. Most
  concrete thing possible for a toddler, zero generation, zero disclosure. Manual to produce.
  Worth a try for the handful of steps where "yours specifically" matters.

## Consequences

- The display gains **no new runtime dependency**. Images are files.
- Generated assets are committed, so the Pi stays reproducible from the repo.
- **Photo→event OCR remains undecided** (PRD §8). It fails the disclosure test and is *not*
  authorised by this ADR. Its options are unchanged: drop it, host a VLM on the desktop, or carve a
  separate documented exception. Do not treat "images are fine" as covering it.
