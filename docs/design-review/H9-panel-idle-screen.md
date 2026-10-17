# idle-screen

## The question

A wall-mounted 21.5" touchscreen family calendar in a living room, 960x540 logical px, landscape.
Used by three children — 7 (reads), 5 (emergent), 3 (pre-reader) — and by two adults.

Its four jobs: help the children run their morning/bedtime ROUTINES, do their CHORES, EARN money,
and know WHAT IS UPCOMING.

THE PRIME INVARIANT: the wall must never be blank or wrong at 6:00 AM on a school day. At 6:00 AM
the reader is a parent making lunches, glancing from ~3m away in the kitchen. That reader needs
today's schedule legible at distance.

We have two candidate designs for the IDLE screen — what the wall shows when nobody has touched it,
which is ~22 hours a day:

(A) INFORMATION BOARD (what exists today). A left rail of three child avatars, a four-day agenda
    with an aligned time column, and a countdown column. Legible from 3m. Functional, and the
    children find it boring — nobody walks over to it.

(B) SEARCH-AND-FIND SCENE. A full-bleed illustrated "Where's Wally" style picture — a campsite with
    ~15 small cartoon figures, animals, tents, a lake — in which each of the three children can find
    THEMSELVES. Tapping your own character opens your chores. The picture rotates (a new one
    periodically), giving a child a reason to walk up and look closely. It is delightful at 50cm and
    completely illegible at 3m. It carries no schedule information at all.

A third option we have proposed but not built:

(C) TIME-BOXED. Inside the routine windows (06:00-08:00, 19:00-20:30) and any time something is
    overdue, the wall is (A). Outside those windows — most of the day — it is (B). The existing
    `timeBoxState` machinery already computes whether a routine window is open, so this is cheap.

Concerns already raised internally, which you may accept or refute:
  - (C) means the wall has two different appearances and a child may not learn where things are.
  - (C) makes the 6:00 AM guarantee conditional on a clock, and the device is a Raspberry Pi with NO
    hardware RTC — it gets its time from NTP over the network. If the clock is wrong at boot, the
    wall could show the picture at 6:00 AM.
  - (B) as the permanent home means an adult has to tap through to see the day, which is worse for
    the person who most needs the wall at 6:00 AM.
  - (A) as the permanent home means the delight budget is zero and the children ignore the wall,
    which is a product failure even if every requirement is met.

THE QUESTION: which should be the idle screen, and under exactly what rule? If (C), give the precise
condition and say what happens when the clock is unavailable or wrong. If you would split the screen
rather than time-box it, give the specific proportions on a 960x540 landscape surface and say what
gets cut. Argue against your own answer before you give it.


---

## anthropic/claude-opus-4.8

# The answer: (C), time-boxed — but with the clock fixed, not trusted.

Let me argue against this before I commit to it.

## The case against (C)

The strongest objection is the RTC one, and it's not a footnote — it's the whole ballgame. The Prime Invariant says the wall must never be *wrong* at 6:00 AM. Option (C) makes correctness a function of `now()`, and `now()` on this device is a lie until NTP resolves. A Pi that loses power overnight boots believing it's some epoch-ish default or its last-known time. If it boots at 05:55 thinking it's 14:00, the routine window is closed, and the wall shows a campsite to a parent making lunches. **(C) can fail the exact invariant it's built to serve, at the exact moment that matters, and it fails silently** — a pretty picture looks healthy.

The "two appearances" objection I mostly reject. A 3-year-old doesn't reason about screen *layouts*; they learn *the tap*. If tapping your character always opens your chores in mode B, and the child avatars in mode A are also tappable to the same place, the interaction is invariant even when the wallpaper isn't. Learnability lives in the gesture, not the pixels. So I drop that concern.

But the clock concern survives, and it's fatal to naive (C).

## Why not just split the screen (fixed A+B, no clock)?

Tempting: no time dependence, no failure mode, both jobs always on screen. Let me actually lay it out on 960×540 and see what dies.

- Schedule legible at 3m needs ~28–32px type for the day's rows. Three-to-four rows of "time — event," plus a header. That's a solid **380px-wide column minimum** to not wrap, realistically 400.
- That leaves **560×540** for the scene. A "Where's Wally" with 15 figures where a child finds *themselves* needs the figures to be ~40–60px to be findable-but-not-trivial. 560px wide crops the campsite to a keyhole. You can fit maybe 6 figures. The lake and half the tents are gone.

So the split doesn't cut *content* — it cuts the **thing that makes B work**. B's delight is entirely a function of *density and scale* at 50cm. A cropped campsite isn't a smaller delight; it's a dead one. You'd ship a permanent half-legible schedule next to a permanently disappointing puzzle and satisfy neither reader. **The split trades two wins for two mediocrities.** I reject it.

The screen is too small to be two things at once. It has to be one thing at a time — which is exactly what time-boxing is.

## So: (C), with the clock as a hard gate

The rule is not "show A during the window." The rule is:

> **Show A whenever we cannot prove we are safely outside a routine window. Show B only when we can.**

Precise condition for **B (the scene)** to render:

```
render_B  IF AND ONLY IF:
    clock_is_trusted            == true
  AND now() is outside [06:00–08:00] and [19:00–20:30]
  AND nothing is overdue
otherwise render_A
```

Where `clock_is_trusted` means **all** of:
1. NTP has successfully synced at least once since boot (`chrony`/`timedatectl` reports synchronized), **and**
2. the synced time is sane (year ≥ 2024; not the Pi's fake-hwclock default), **and**
3. last successful sync was < 24h ago.

**A is the default and the fallback.** Every uncertainty resolves toward the schedule, never toward the picture. The invariant becomes: *the campsite is a privilege the wall earns by being certain it's daytime-and-safe; the schedule is what it shows when it isn't sure.* That inverts the failure mode — a wrong clock now shows the schedule, which at worst shows yesterday's remaining rows (stale but not blank, and A degrades honestly, see below).

This makes the internal concern ("clock wrong → picture at 6 AM") **structurally impossible**, because a wrong-or-unknown clock fails the gate and we're in A. The cost is symmetric: a *correct* clock that hasn't synced yet at boot will show A during the day when B was allowed. That's the right trade — worst case is "too much schedule," never "no schedule."

## Two cheap hardware/software fixes that make this robust

1. **Add `fake-hwclock` (already standard on Pi OS) and persist time on shutdown.** On boot, restore last-known time immediately. This means even before NTP resolves, the clock is "last night," not epoch. Combined with the gate, a normal overnight power loss boots into a plausible early-morning time, fails the "synced < 24h" freshness check *only if* NTP is also down, and shows A. Good.

2. **A $1 DS3231 RTC module** on the I²C header eliminates the entire class of problem for the price of a coffee. If you'll ship thousands of these, buy the part. I'm giving you the software answer because you asked for a rule that survives *no* RTC — but note that the honest engineering answer to "6 AM must be right and we have no RTC" is *buy an RTC*.

## What A must do to deserve being the fallback

Since A is now the safety net, it has to degrade honestly:

- If the clock is untrusted, A shows the schedule **with a quiet "syncing…" marker** and shows the *day it believes it is*. Never invent a date silently.
- If NTP has never synced and there's no fake-hwclock value, A shows a static "Can't confirm today's date — check the calendar" card. Ugly, but not *wrong*, and not blank. The invariant is "never blank or wrong," and an honest "I don't know" satisfies it; a confident wrong answer does not.

## On the delight budget

The remaining real cost of (C) is that A is what's up during the two windows plus overdue time — but those are the low-attention, high-stress windows anyway; nobody wants a puzzle at 6:05. B owns roughly 06:00-morning... wait — B owns essentially the entire afternoon and midday, the 15+ waking hours when a child *wanders past and has time to look*. That's when delight pays off. **Time-boxing doesn't ration delight; it puts delight exactly where attention is idle and schedule exactly where attention is scarce.** That's the whole product thesis, and it's correct.

---

**Summary:** Idle screen is **(C)**. B renders only when the clock is provably trusted *and* outside routine/overdue windows; every other state — including any clock uncertainty — falls back to A. Don't split the screen; 960×540 is too small to make B worth doing at half width. And put the $1 RTC on the board so the whole clause becomes moot.

---

## x-ai/grok-4.5

## Against the answer first

A clean time-box (C) is easy to love on a whiteboard and easy to regret on the wall.

- Two full-screen identities mean two spatial maps. The 3-year-old does not hold “before breakfast the chores live in a list; after breakfast they live in a treehouse.” They hold *where did I press last time*.
- Fail-closed-to-A when the clock is untrusted is correct for safety and fatal for delight if NTP is flaky: the Pi lives on home Wi‑Fi; “safe mode” can become the permanent mode.
- A hard cut at 08:00 is wrong whenever morning runs long. “Routine window” ≠ “routine done.”
- A permanent split (scene + departure board) would honor the 6:00 AM invariant with no clock dependency and would keep one layout. The reason to reject pure split as the *main* answer is physical, not ideological: on a 21.5″ 960×540 surface, a strip tall enough to carry a real morning schedule at 3 m (~150px+) destroys the search-and-find scene, and a strip short enough to save the scene (~48–80px) cannot carry the morning. You get two mediocre products at once. Full-bleed A when life is operationally hard, full-bleed B when it is not, is the higher ceiling—if and only if the fail-safe is ruthless and a thin schedule thread never fully disappears.

That is the tempered position below.

---

## Decision: (C) time-boxed, fail-closed to (A), with a permanent one-line “next up” thread

**Idle policy (precise):**

```
show A  when  ANY of:
            • time_trusted == false
            • in_routine_window
            • any_overdue == true
            • school_morning_lock (see below)
            • manual pin to board (parent hold)
show B  when  ALL of:
            • time_trusted == true
            • not in_routine_window
            • nothing overdue
            • not school_morning_lock
```

**Routine windows** (use what you already have in `timeBoxState`, do not invent a second clock):
- Morning: **05:45–08:30** (start *before* 06:00 on purpose; the parent’s glance is the requirement, not the child’s alarm)
- Bedtime: **18:45–20:45**
- Plus any weekend/holiday variants you already encode

**Overdue:** any chore/routine step past its due mark forces A until cleared or snoozed by an adult. This is what prevents the 08:31 snap-to-Wally while shoes are still on the floor.

**School-morning lock (prime-invariant belt):** on a school day, force A from 05:45 until the morning routine is *marked done* (or until 08:30, whichever first). Window alone is not enough; completion is the release. The wall may not entertain until the operational morning is over.

---

## Clock trust on a Pi with no RTC

Do not key the prime invariant off wall-clock alone. Key it off a **time_trusted** bit.

`time_trusted == true` only when **all** of:
1. OS reports NTP/chrony **synchronized** (not merely “has a date”),
2. at least one successful sync **this boot**,
3. sync age under a bound (e.g. ≤ 2–3 h),
4. time is not before last-persisted shutdown stamp (fake-hwclock skew check).

If any check fails → `time_trusted = false` → **A**.

Wrong clock at 6:00 AM therefore cannot show Wally: untrusted time *is* A. That is the refutation of the internal RTC concern—**if** you implement trust as a hard gate, not a hope.

Persist last good civil time and last good “school calendar day” so a reboot at 05:50 with dead WAN still comes up on A with *stale-but-plausible* day context rather than a blank or a fantasy scene. Stale A is allowed; blank and Wally-at-dawn are not.

When time later becomes trusted, transition B only with a slow crossfade (≥800 ms) and never mid-touch (debounce: no mode flip while a finger session is active).

---

## The permanent thread (why this is not pure C)

Even on B, keep a **single persistent schedule ribbon**—not a second UI, a lifeline:

- **Height: 56 px** (logical) top edge; scene gets **960×484**
- Content, large type (~28–32 px), one line, no chrome:  
  `Tue 12 · Bus 7:40 · Music 16:00 · Dinner 18:30`  
  plus a tiny overdue dot if relevant
- Tap ribbon → full A (adult path at distance, one reach)
- From 3 m the ribbon is “what fire is next”; from 50 cm the scene is the product

What this cuts vs full A on the idle B face:
- Four-day agenda — gone from idle B; lives in full A
- Countdown column — gone; only next 2–3 anchors
- Child avatar rail — gone as chrome; **replaced by the three findable selves in the scene**

What this cuts vs full-bleed B:
- ~10% vertical scene area; accept it. Search-and-find still works at 484 px height; a 3 m-illegible pure illustration does not satisfy the invariant.

56 px is *not* enough for morning lunch-making. That is why it is a thread, not the morning UI. Morning is full A under the rules above.

---

## Refuting the other internal concerns

| Concern | Disposition |
|---|---|
| Two appearances, kids won’t learn where things are | Same identity gateway in both: **my body**. In A, avatar rail; in B, my figure in the scene. Both open “me” (chores/routine/earn). Layout may change; *agency locus* does not. 3-year-old learns “find me,” not “find the list.” |
| 6:00 AM guarantee depends on clock | Inverted: untrusted clock **forces A**. Trusted clock + school morning **forces A**. B is earned, never default-under-doubt. |
| B permanent makes adult tap through at dawn | Rejected. Dawn is A by rule. |
| A permanent = delight budget zero | Rejected. B is the bulk of the 22 h idle day *when nothing is on fire*. |

Pure A fails the product (children never approach). Pure B fails the prime invariant (parent at 3 m). Unscoped C fails on RTC and on late mornings. **Scoped C + time trust + completion lock + 56 px ribbon** is the minimum design that keeps the invariant *and* the reason the children walk over.

---

## Optional split you should *not* lead with

If you ever abandon time-boxing, the only split that does not wreck both jobs on 960×540 is:

- **B-default:** top **56 px** ribbon / bottom **484 px** scene (same as above)
- **A-default (routine/overdue/untrusted):** top **320 px** board (today + time column + avatars) / bottom **220 px** scene strip (figures still tappable, scene becomes a dock not a Wally poster)

Proportions 320/220 during operations; 56/484 otherwise. Four-day agenda and full countdown only in the 320 px board (and in the pushed full-A view). Do not try 50/50: both sides die.

Prefer the time-boxed rule first; the proportion shift is a visual easing of the same state machine, not a different product.

---

## Rule in one sentence

**Default to the illustrated scene only when time is known-good, nothing is overdue, and the school morning is finished; otherwise the information board—never the reverse—and always keep a 56 px next-up ribbon so the wall cannot go schedule-blind even when it is allowed to be delightful.**

---

## z-ai/glm-5.2

### The Argument Against My Own Answer (The Split-Screen Temptation)

Before arriving at the correct answer, it is necessary to dismantle the most intuitive compromise: splitting the screen. 

If we try to satisfy both the 3-meter adult and the 50-centimeter child simultaneously on the 960x540 surface, we must divide the real estate. The most logical split is a vertical 70/30 partition: 672x540 for the Information Board (A) on the left, and 288x540 for the Search-and-Find Scene (B) on the right. 

This seems like a perfect diplomatic solution, but it violates the core principles of both user bases. 

1. **It breaks the 3m Prime Invariant for the adult:** The original Information Board was legible at 3 meters specifically because it utilized the full 960px width. Squeezing the time column, the four-day agenda, and the countdowns into 672px forces a font size reduction of roughly 30%. At a 3-meter viewing distance in a dimly lit kitchen at 6:00 AM, a parent making lunches will no longer be able to glance-read the schedule. The screen becomes a blur of text. 
2. **It destroys the 50cm delight for the children:** A 288x540 pixel slice is a narrow ribbon. The "Where's Wally" mechanic relies on a sprawling, full-bleed scene where 15 distinct figures and environmental interactions can be hidden. In a 288px-wide column, a 7-year-old will find their character in three seconds. The 5-year-old and 3-year-old will lose the exploratory magic entirely. Furthermore, if we cut the 4-day agenda to make the board legible at 70% width (say, reducing it to a 2-day agenda), we sever the "What is upcoming" requirement. 

A split screen fails the adult at distance and infantalizes the scene for the children. It is a compromise that satisfies nobody.

### The Answer: Option (C), Time-Boxed with a Hardware Failsafe

The idle screen must be Option (C), but with a strictly enforced hardware-aware rule. The wall cannot be purely time-boxed; it must be **state-boxed**, where the state is heavily biased toward the Prime Invariant.

**The Rule for the Idle Screen:**
The wall displays the Information Board (A) if and only if:
1. The routine window is open (06:00–08:00, 19:00–20:30).
2. Any chore or routine is currently overdue.
3. The system cannot explicitly verify that it is *outside* the 06:00–08:00 window on a school day.

Otherwise, it displays the Search-and-Find Scene (B).

**The Clock/NTP Failsafe:**
The Raspberry Pi lacks a hardware RTC, making NTP a critical point of failure. If the clock is wrong at boot, the wall could incorrectly assume it is midday and show the picture at 6:00 AM. We cannot allow this. 

Therefore, we implement a **"Fail-Safe to Information"** state:
At boot, the system assumes `timeKnown = false`. It defaults to showing (A). It attempts NTP sync. NTP is only considered successful if it returns a time within a reasonable delta of the last known time (stored persistently on the SD card at shutdown). 
- If NTP fails or the time is clearly wrong (e.g., year is 1970, or time jumped backward), `timeKnown` remains `false`. 
- While `timeKnown == false`, the UI is permanently locked to (A). 

If the network is down at 6:00 AM, the parent gets the Information Board. If the network is up but NTP is delayed, the parent gets the Information Board until the sync succeeds. Only when the system is absolutely certain of the time—and certain that the time is *not* 6:00 AM on a school day—does it yield to the Search-and-Find Scene. 

### Why this addresses the remaining concerns:

- **"The wall has two appearances and a child may not learn where things are."**
Contextual UI is actually easier for children to learn than a static dashboard. The 7, 5, and 3-year-old will quickly learn the heuristic: "When the sun is up and we aren't rushing to school, the wall is a game. When the wall looks like a list, it's time to eat, dress, or sleep." The visual shift acts as an ambient behavioral trigger, which is precisely what routines and chores require.

- **"An adult has to tap through to see the day, which is worse for the 6:00 AM parent."**
With the Time-Boxed rule, the adult *never* has to tap through at 6:00 AM. The Information Board dominates the screen precisely during the only hours the adult is heavily dependent on it. At 2:00 PM on a Saturday, when the adult wants to check the schedule, walking up to the screen and tapping it is an acceptable user friction.

- **"A as permanent means zero delight and children ignore it."**
This is solved by defaulting to (B) for the ~20 hours a day where the Prime Invariant does not apply. The children get a delightful, engaging device that draws them in to check their chores. The adults get a reliable, legible command center exactly when they need it. 

(C) is the only option that protects the Prime Invariant with 100% mathematical certainty while preserving the product's primary delight mechanism.

---

## JUDGE

## 1. What I would ship

Ship **(C) time-boxed, fail-closed to (A)**, with a hard `time_trusted` gate and a permanent 56px "next up" ribbon along the top edge of the (B) scene — Grok's version, essentially, because the ribbon is what makes this defensible rather than merely clever.

## 2. Strongest argument against it, and why it loses

The strongest objection is Claude's own RTC point: **(C) makes correctness a function of `now()`, and `now()` is a lie until NTP resolves — so (C) can fail the exact invariant it exists to serve, silently, at 6 AM.**

It does not win because all three reviewers independently converge on the same structural refutation: *invert the default.* If `time_trusted == false` forces (A), then a wrong or unknown clock produces the schedule, not the picture. The failure mode Claude fears requires the system to *confidently believe* it is midday when it is 6 AM — but a freshly-booted Pi with no sync is by definition not confident, so it fails the gate and shows (A). The objection only survives if you implement naive time-boxing (`if hour in windows`). Nobody is proposing that. Once trust is a hard precondition for (B), the invariant is *strengthened* by (C), not weakened.

## 3. Where a reviewer is wrong

**GLM is wrong on the split-screen arithmetic, and it matters.** GLM analyzes only a *vertical 70/30 split* (672×540 board + 288×540 scene), correctly kills it, and then treats that as having refuted splitting in general. But the geometry of this surface is horizontal: the schedule is a *stack of rows*, so the natural split is **horizontal** (a full-width thin ribbon over a full-width scene), which is exactly the 56/484 ribbon that GLM's own recommended answer (C) then depends on. GLM refutes a strawman split, adopts a thin-split hybrid, and never notices they're the same primitive. The narrow-column analysis is real but irrelevant.

Separately, **Claude over-claims** with "put the $1 RTC on the board so the whole clause becomes moot." A DS3231 that drifts, loses its coin cell, or was last set six months ago produces a *confident wrong time* — the worst input for a naive time-box. An RTC is nice, but it does **not** make the `time_trusted` clause moot; you still need the sanity + freshness checks regardless of clock source. The RTC reduces the *frequency* of untrusted-time boots; it does not remove the need for the gate.

## 4. Smallest concrete rules an implementer needs

**Idle state machine — show (A) if ANY:**
- `time_trusted == false`
- now ∈ [05:45–08:30] (morning) or [18:45–20:45] (bedtime)
- any chore/routine overdue
- school day AND morning routine not marked done (release on completion OR 08:30, whichever first)
- parent manually pinned

**Otherwise show (B).**

**`time_trusted == true` requires ALL:**
1. chrony/timedatectl reports **synchronized** (not merely "has a date")
2. ≥1 successful sync **this boot**
3. sync age ≤ 3h
4. now ≥ last-persisted shutdown timestamp (fake-hwclock skew check; catch backward jumps / year < 2024)

**Persistence:** write `fake-hwclock` + last-good civil day on shutdown; restore on boot so untrusted boots land on *stale-but-plausible* (A), never blank, never epoch.

**The ribbon (always present on B):**
- 56px logical height, top edge → scene gets 960×484
- one line, ~28–32px type: `Tue 12 · Bus 7:40 · Music 16:00 · Dinner 18:30` + overdue dot
- tap ribbon → full (A)

**Transitions:** crossfade ≥ 800ms; never flip mode while a touch session is active (debounce).

**Identity locus (learnability):** "find me" opens my chores in *both* modes — avatar rail in (A), my figure in the scene in (B). Layout changes; the tap target's meaning does not.
