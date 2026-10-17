# tap-targets

## The question

A wall-mounted 21.5" touchscreen in a family living room. Design surface is 960x540 LOGICAL pixels
(1920x1080 physical at devicePixelRatio 2). The panel is ~225 nits behind anti-glare etched glass.

Three children use it, each with their own screen:
  Child A — 7, reads fluently
  Child B — 5, emergent reader
  Child C — 3, pre-reader

We recently established that VIEWING DISTANCE differs by screen: the idle/household screen is
glanced at from ~3m (a parent in the kitchen), but a CHILD'S OWN screen is used at ~40-60cm — the
child walks up and puts a finger on the glass. We have just dropped the type scale one step for the
close-up screens. Type is no longer the binding constraint.

The binding constraint is now the minimum TAP TARGET height, which we set per band and have not
revisited since everything was sized for 3m:

  pre-reader (C):     132 logical px  = 66 mm on this panel
  emergent (B):       104 logical px  = 52 mm
  fluent (A):          64 logical px  = 32 mm   (this is our declared floor)

For reference, Apple HIG says 44pt (~9mm), Google Material says 48dp (~9mm), and published
research on children's touch accuracy (Anthony et al.; Hourcade) suggests children aged 3-6 need
substantially larger targets than adults but the figures quoted are typically 20-30mm, not 50-66mm.

CONSEQUENCE OF THE CURRENT VALUES: on a child's screen the content now overflows the 420px content
pane and degrades to a scroll — Child A's by 146px, Child B's by 16px. A wall display that must be
usable by a 3-year-old should not require scrolling; content below the fold is content she will not
find. Reducing the floors is the obvious lever. Reducing them too far means missed taps, which for a
3-year-old means frustration and abandoning the routine.

Constraints that are NOT negotiable:
  - 64 logical px (32mm) is our declared absolute floor and will not go lower for anyone.
  - Targets must not GROW with literacy: pre-reader >= emergent >= fluent.
  - Between two adjacent targets there is a mandatory 16px dead gap, so a miss lands on nothing.
  - Taps are optimistic with a ~5s local undo window, so a mis-tap is recoverable without a server
    round trip, and every action is reversible by tapping again.

THE QUESTION: what should the three minimum tap-target heights be? Give specific numbers and the
evidence or reasoning for each. Argue against the position you find most tempting. If you think the
current values are right and the overflow should be solved another way, say so and say how.


---

## anthropic/claude-opus-4.8

# The short answer

**Child C (pre-reader): 96 px (48 mm)**
**Child B (emergent): 80 px (40 mm)**
**Child A (fluent): 64 px (32 mm)** — unchanged, this is your floor

Let me show the reasoning, then argue against myself, then check the arithmetic against your overflow.

---

## Why these numbers

### The old values were sized for the wrong distance, and you already know it
The 132/104/64 ladder was set at 3m. At 3m a target has to be big to subtend enough visual angle *and* to be hittable by an adult reaching across furniture. But you've established the operative fact: **a child uses their own screen at 40–60cm with a walk-up finger-plant.** The 3m rationale simply doesn't apply to the close-up screen. These numbers are stale inputs, not a considered position — so the burden of proof is on keeping them, not on lowering them.

### Anchor to the actual evidence, then add margin
Anthony et al. and Hourcade converge on **20–30mm** for children 3–6. That's the empirical target-acquisition floor. Your instinct that 50–66mm is "substantially larger" is right in spirit but overshoots: 66mm isn't "extra safe," it's roughly **2.2× the top of the researched range**, and the marginal accuracy return above ~30mm is nearly flat. You are paying a large layout cost for reliability you already have.

So the design move is: **start at the top of the evidence band and add margin, rather than start at your 3m guess and shave it down.**

- **Child C: 48mm (96px).** 30mm is the research ceiling for the youngest cohort; +18mm margin (~60%) accounts for the *un*-researched parts of your situation — a standing child, a vertical glass surface (finger drag/smear under gravity), etched anti-glare glass that slightly diffuses the visual edge of the target, and a 3-year-old's genuinely worse motor control than a 6-year-old's. 48mm is defensibly generous without being decorative.
- **Child B: 40mm (80px).** A 5-year-old sits comfortably inside the research band; 40mm is above the 30mm ceiling with modest margin. Emergent readers also get some target confirmation from beginning to recognize the label.
- **Child A: 32mm (64px).** Your declared floor, and a 7-year-old who "reads fluently" has close-to-adult motor accuracy. 32mm is already ~3.5× Apple/Google's 9mm. No change needed or wanted.

### The constraints all still hold
- Monotonic: 96 ≥ 80 ≥ 64. ✓ (Targets shrink with literacy, never grow.)
- Absolute floor: nobody below 64. ✓
- The 16px dead gap between targets is doing real work — **this is the single most important safety feature and it lets you be less conservative on size.** A miss lands on nothing rather than on the wrong action.

### The recoverability argument is the one that unlocks the reduction
You have optimistic taps with a **5s local undo, every action reversible by re-tapping.** This changes the cost function. The classic reason to oversize children's targets is that a mis-tap is a *dead end* — wrong screen, lost, frustrated. But in your system a mis-tap is a 5-second, tap-to-fix event with no server round trip. The cost of a miss is low and the recovery is *itself* a large forgiving target (the undo). That's precisely the condition under which you can safely sit at "evidence + margin" instead of "evidence × 2."

---

## The position I find most tempting, and why I'm arguing against it

**Tempting position: "She's 3. On a wall. Standing. Just keep C at 66mm and solve overflow another way — bigger physical panel, fewer items, pagination."**

This is seductive because it's the *safe-sounding* choice and nobody gets blamed for a target being too big. But it's wrong here for three reasons:

1. **66mm is not evidence-based; it's a distance artifact.** Defending it requires believing a 3-year-old at 50cm needs a target 2.2× larger than the literature's ceiling. There's no data for that. "It feels safer" is not a reason when it forces the failure you're trying to avoid.

2. **The alternative fixes are worse than the disease.** Pagination/scroll below the fold is *exactly* the "content she'll never find" failure you named. A bigger panel is a hardware change to fix a spec you set on a stale assumption. Fewer items may be right independently — but you shouldn't *force* that decision via an oversized target; decide item count on its own merits.

3. **It ignores your own safety system.** You built the 16px gap and the 5s undo specifically so that size doesn't have to carry all the reliability load. Refusing to lower the target is refusing to spend the safety margin you already paid for.

The honest counter-argument to *my* number: I can't cite a study for "48mm for a standing 3-year-old at 50cm on vertical etched glass," because it doesn't exist. My 48mm is 30mm-evidence + judgment-margin, not measured. **So instrument it:** log mis-tap and undo rates per band on the real panel and be prepared to move C between 80 and 96px. If undo rate on C is low, drop toward 80. If it's high, you've learned the margin was right.

---

## Does it actually fix the overflow? (checking the arithmetic)

Content pane = 420px. Old A overflowed by 146px, old B by 16px.

The overflow scales with target height plus gaps. Going from your old floors to the new ones:

- **Child A: 64 → 64.** No change to A's target. But A's overflow was 146px — the *worst* case — and A's targets aren't shrinking. **So target reduction alone does NOT fix Child A.**
- **Child B: 104 → 80.** Removes ~24px per target; B was only 16px over, so **B now fits comfortably.** ✓
- **Child C: 132 → 96.** Removes ~36px per target, which relieves C substantially.

**This is the important caveat: my numbers fix B and C but not A**, because A is at the floor and can't go lower — yet A had the largest overflow (146px).

That tells you something real: **Child A's overflow is not a target-size problem at all.** A fluent 7-year-old at 32mm is already tight; the 146px overflow means A's *content* (item count / row layout) is the problem, not A's targets. For A specifically:
- reduce number of top-level items, or
- use a 2-column layout for the fluent screen (a 7-year-old can scan a grid; a 3-year-old shouldn't have to), or
- reclaim the extra step of type scale you just dropped.

So the combined recommendation: **lower B and C to 80/96 (fixes their overflow via the target lever, correctly), and fix A's overflow through layout/item-count (because the target lever is already at the floor for A).** Don't try to make one lever solve two different problems.

---

## x-ai/grok-4.5

## Recommended minimums

| Band | Age | Min tap height | Physical | vs current |
|------|-----|----------------|----------|------------|
| Pre-reader (C) | 3 | **96 lx px** | **48 mm** | was 132 / 66 mm |
| Emergent (B) | 5 | **80 lx px** | **40 mm** | was 104 / 52 mm |
| Fluent (A) | 7 | **64 lx px** | **32 mm** | unchanged (floor) |

Keep the 16 lx px dead gap and the ~5 s optimistic undo exactly as specified.

---

### Why these numbers

**The old values were sized for the wrong distance.**  
132 / 104 / 64 were set when everything was assumed to be used from ~3 m. A child-owned screen is used at 40–60 cm with a finger on etched glass. Angular size and motor demand are completely different; type already got the distance correction, targets did not. That is the whole bug.

**Published child touch data, not adult HIG, is the right anchor — and even that data sits *below* your floor.**  
Apple 44 pt and Material 48 dp (~9 mm) are adult norms and are irrelevant here except as a lower bound you have already beaten. Anthony et al. and Hourcade-type results for ages ~3–6 typically land in the **20–30 mm** usable range for discrete taps, with error rates falling as targets grow into the mid-20s mm and diminishing returns after that. Your **declared floor of 64 lx px = 32 mm already sits at or above the top of that band**. So:

- **A (7, fluent) → 64 / 32 mm.** Near-adult fine motor, can read labels, undo is cheap. Do not raise it (causes the 146 px overflow you already see). Do not lower it (policy floor). This is correct.
- **B (5, emergent) → 80 / 40 mm.** Still developing precision and confidence; one step above the floor is enough once distance is corrected. 40 mm is ~1.3× the research “comfortable” zone and leaves clear separation from A. The current 16 px overflow disappears immediately.
- **C (3, pre-reader) → 96 / 48 mm.** Coarser motor control, no label reading to confirm “what am I hitting,” highest cost of frustration. 48 mm is **~1.5–2×** the research medians and **1.5×** your floor, so it still honors `pre-reader ≥ emergent ≥ fluent` with a felt step. It is not 66 mm, because at 40–60 cm with a fat toddler finger, dead gaps, and a 5 s local undo, 66 mm is oversized chrome — not safety.

**Undo + dead gaps change the loss function.**  
Miss cost is not “wrong server action.” Miss cost is “nothing happens, or a reversible local state for 5 s.” That lets you sit nearer the accuracy knee of the research curves instead of padding another 50 % “just in case.” The 16 px (8 mm) inert gutter already catches the most common near-miss class (landing between two targets). Design for that, not for a world without undo.

**Overflow math (content pane 420).**  
You did not give item counts, but the reported overflows are diagnostic: B is only 16 px over at 104 — a small cut fixes it. C at 132 is the main scroll offender; every 36 px you remove from the min height is 36 px × N items recovered. At 96, four primary actions + three gutters + modest padding fit without a fold. A’s 146 px overflow at the floor is **not** a target-size problem; it is content-count/chrome (see “if you disagree” below). A 3-year-old must not scroll; a 7-year-old with more items can tolerate a *single* short pane or a fixed primary set above the fold — but not by shrinking below 64.

---

### Position to argue against (the tempting one)

**Temptation: keep 132 / 104 / 64 (or only trim a few px) and “solve” overflow with pagination, carousels, or a second screen.**  

That is the wrong trade. For a pre-reader, content below the fold — or behind a page dot, swipe, or “next” control she must discover — is content she will not find. A wall routine that depends on a 3-year-old paging is a failed routine. Oversized targets were a rational hedge at 3 m; they are not a rational hedge at 50 cm with undo. Shrinking C from 66 mm → 48 mm and B from 52 mm → 40 mm is not “ignoring motor skill.” It is matching motor skill to **actual viewing distance**, **recoverable errors**, and **the hard no-scroll requirement**. If something still does not fit after that cut, remove or combine actions for band C; do not invent a fold.

Secondary temptation to reject: **collapse everyone to 64.** That violates the monotonic literacy rule you set and under-serves the 3-year-old’s motor and confirmation needs. Keep the step ladder; just stop inflating it for a distance nobody uses on these screens.

---

### If you believe current values must stay

Then the overflow is not solved by target height. Do this instead, in order:

1. **Band-C information architecture:** ≤3–4 primary actions on the child screen; everything else behind a parent gate or on the household screen. Pre-readers do not need the fluent set.
2. **Collapse chrome:** labels inside targets, not above; no duplicate title stack; tighter non-target padding only (never steal the 16 px dead gap).
3. **Still no free scroll for C.** If it does not fit, it is not a layout bug — it is too many actions for that band.

Do not paginate for C. Do not drop anyone below 64. Do not let targets grow as literacy grows.

---

### Summary

**96 / 80 / 64** (48 mm / 40 mm / 32 mm), 16 px dead gaps, optimistic undo unchanged.  
Evidence: child touch literature (≈20–30 mm usable) + your own 32 mm floor already being conservative + distance correction from 3 m → 0.5 m + recoverable misses.  
The current 132 / 104 values are a holdover from household viewing distance; they are what force the fold, and the fold is worse for a 3-year-old than a 48 mm target.

---

## z-ai/glm-5.2

Based on the constraints, the geometry of the panel, and the established research, here are the proposed minimum tap-target heights, followed by the reasoning, the solution for the overflow paradox, and the counter-argument.

### The Proposed Tap-Target Heights

*   **Child A (7, fluent): 64 logical px (32 mm)** — *The absolute floor.*
*   **Child B (5, emergent): 72 logical px (36 mm)** — *12.5% larger than A.*
*   **Child C (3, pre-reader): 80 logical px (40 mm)** — *25% larger than A, 11% larger than B.*

### The Evidence and Reasoning

**1. The physical reality of the 40-60cm interaction**
The original 66mm target for Child C was likely a byproduct of designing for a 3m viewing distance, where visual angle is the dominant constraint. At 40-60cm, motor control—specifically the isolation of the index finger and the ability to hold a tap without dragging—becomes the binding constraint. Published research (Hourcade; Anthony et al.) indicates that children aged 3-6 require targets in the 20-30mm range for reliable acquisition. Our absolute floor (32mm) already sits at the top of this empirical range.

**2. The "Safety Net" reduces the need for brute-force sizing**
You have implemented two profound error-recovery mechanisms:
*   A **16px dead gap** (8mm), which ensures a missed tap lands on nothing rather than the wrong action.
*   A **5-second undo window**, which makes a mis-tap completely recoverable without server latency.

Because the system forgives errors, the target no longer needs to be sized to prevent *any* miss. It only needs to be large enough to prevent *frustrating* misses. For a 3-year-old at 40cm, a 40mm target combined with an 8mm dead gap provides a massive, easily acquirable area. If they drag their finger slightly or hit it with a flat pad, they will still hit it.

**3. The monotonicity of cognitive intent**
The constraint $C \ge B \ge A$ respects a developmental reality: motor control scales with age, but *cognitive intentionality* does too. A 3-year-old is more likely to "mash" the glass or tap with a slightly unfocused motion than a 7-year-old. Giving C a slightly larger target (40mm) accommodates this looser cognitive-to-motor mapping, while keeping it within the bounds of the physical panel's real estate.

### Solving the Overflow Paradox (Child A)

The prompt reveals a mathematical trap: **Child A overflows by 146px, but A is already at the declared absolute floor (64px).** Reducing tap targets will not fix A's overflow; A cannot be reduced any further. Therefore, A's overflow must be solved via layout, not target size.

Because B and C's targets are being drastically reduced (C drops by 52px per target), their screens will easily fall back into the 420px pane without scrolling.

For A, since the targets cannot shrink, the layout must adapt. A 7-year-old fluent reader has different cognitive capabilities than a 3-year-old:
1.  **Multi-Column Flow:** If A's screen is a vertical list, convert it to a 2-column grid. A fluent reader can scan horizontally. A 2-column layout instantly halves the vertical footprint, eliminating the 146px overflow.
2.  **Pagination/Horizonal Swiping:** If the content is linear, A can handle a horizontal swipe or a "Next" pagination model. Content below the fold is lost on a 3-year-old, but a 7-year-old can easily learn a "Page 2" interaction.
3.  **Trim Vertical Chrome:** Reduce the vertical padding/margins between non-interactive text elements to buy back the 146px.

### Argument Against the Most Tempting Position

The most tempting position is: *"Since 32mm is already at the top of the published research range, and we have a 16px dead gap plus a 5s undo window, we should just set ALL children to the 64px (32mm) floor. It maximizes content space, guarantees no overflow even for A, and treats the safety nets as sufficient."*

**I argue strongly against this.**

While the *motor accuracy* of a 3-year-old might technically be satisfied by a 32mm target, their *biomechanics* and *cognitive state* are not. Three-year-olds often do not tap with the very tip of their finger; they frequently use the flat pad of their finger, or even two fingers, spreading the contact area across 20-25mm. A 32mm target leaves very little margin for this "fat-finger" effect before the touch registers in the dead gap.

Furthermore, a 3-year-old's interaction is highly kinetic. They lean their body weight into the glass. A 40mm target (80px) gives their finger a "runway" to absorb that kinetic energy without sliding out of the target bounds. 

Finally, relying on the 5s undo window as a primary mechanism for a 3-year-old is dangerous. A 3-year-old does not understand "undo" as a discrete concept the way a 7-year-old does. If a 3-year-old mis-taps and the routine changes unexpectedly, the resulting confusion isn't easily fixed by undoing; the confusion itself is the frustration that causes them to abandon the routine. The larger target (80px) prevents the confusion from happening in the first place. The undo window is a backup, not a primary UX strategy for pre-literacy.

By keeping C at 80px and B at 72px, you respect their developing motor systems while reclaiming the massive vertical space lost to the old 3m-visibility constraints.

---

## JUDGE

## 1. The recommendation I would ship

**C = 96 px (48 mm), B = 80 px (40 mm), A = 64 px (32 mm); keep the 16 px dead gap and the 5 s undo, and fix Child A's remaining overflow with layout (fewer items / 2-column / trimmed chrome), not target size.**

## 2. Strongest argument against it, and why it loses

The strongest counter is GLM's biomechanics point: a 3-year-old taps with the flat pad or two fingers spreading 20–25 mm of contact, leans body weight into vertical glass, and does not cognitively understand "undo" — so the target should stay generous (GLM lands at 80, but the *principle* argues for staying near the old 66 mm rather than cutting to 48). This is the most substantive objection because it correctly identifies that motor/kinetic reality, not visual angle, is now the binding constraint, and that a pre-reader can't use undo as a real recovery path.

It doesn't win because it proves less than it claims. A fat-finger contact of 20–25 mm hitting a **48 mm** target plus an **8 mm inert gutter** on each side has ~11–14 mm of slack per edge before it registers on nothing — that is not a tight margin, it is a comfortable one. The "kinetic runway" argument is real but is an argument for *48 vs 32*, not *48 vs 66*: nothing in the child-touch literature (20–30 mm usable) supports 66 mm, and GLM never justifies why the runway must exceed 40 mm. And the undo point actually cuts the *other* way in the aggregate: the dead gap means the most common near-miss (landing between targets) does nothing at all — no confusing state change to recover from — so GLM's "confusion is the frustration" concern is largely handled by the gutter, not by an extra 18 mm of target.

## 3. Where a reviewer is wrong

**GLM's 72/80 arithmetic is self-defeating and the reasoning is internally inconsistent.** GLM sets C = 80 px "to prevent the confusion from happening in the first place," while *also* arguing that 32 mm "leaves very little margin for the fat-finger effect before the touch registers in the dead gap." But if fat-finger spread is the worry, 80 px (40 mm) is barely more protective than the 96 px (48 mm) both other reviewers chose — GLM picked the *smallest* pre-reader target of the three while making the *strongest* motor-safety argument. Those two positions don't cohere: either the biomechanics justify more headroom (→ 48 mm) or they don't (→ trust the floor). 40 mm is the one answer the biomechanics argument does not support.

Second, a minor factual slip shared by Claude and Grok: both frame Apple/Google's ~9 mm as merely "a lower bound you've already beaten." That's fine, but Grok's phrasing that 32 mm is "at or above the top" of the 20–30 mm band is imprecise — 32 mm is *above* the top of the band, meaning even the fluent floor is already conservative for a 7-year-old with near-adult motor control. This matters because it confirms A's overflow is genuinely a content problem, not a size problem.

## 4. Smallest concrete rules for the implementer

- **Min tap-target heights:** C = 96 px, B = 80 px, A = 64 px.
- **Dead gap:** 16 px inert gutter between every adjacent target (unchanged).
- **Undo:** 5 s local, reversible-by-retap (unchanged).
- **Invariant:** C ≥ B ≥ A; nobody below 64 px, ever.
- **Fits check (420 px pane):** n items → `n·h + (n−1)·16 + chrome ≤ 420`. At C=96 this fits 3 primary actions comfortably (3·96 + 2·16 = 320) and 4 tightly (4·96 + 3·16 = 432 → over; cap C at 3 primary actions or drop to 3-item IA).
- **Child A overflow (146 px, cannot be solved by target size):** switch A to a 2-column grid *or* cut top-level items so `n·64 + (n−1)·16 ≤ 420` (i.e. ≤ 5 items). No pagination or below-fold scroll for C or B.
- **Instrument it:** log per-band mis-tap and undo rates on the real panel; if C's undo rate stays low, C may later drop toward 80 — but ship 96 first.
