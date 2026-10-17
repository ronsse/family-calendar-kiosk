# ADR-0005 — What a streak counts, and what it shows a child

**Date:** 2026-08-29
**Status:** Accepted
**Context:** `WallSnapshot` carried `streakDays` from the day the contract froze and it was
hardcoded `null`. Wiring it up is one query; deciding what it *means* is the work.

---

## The thing that makes this different from the rest of the wall

A streak is **the only number on this wall that can go down**, on screens three children can
walk over and read. Everything else here is additive: points accumulate, chores complete,
sleeps count down. A streak introduces loss, and it introduces it on a display a child cannot
argue with and did not choose to be shown.

So the governing question was never "how do we compute a streak". It was **which failures is
this number allowed to blame a child for.**

---

## 1. What it counts — five rules

| # | Rule | Why the other choice is wrong |
|---|---|---|
| 1 | **Duties only, never extras** | Extras are optional and pay points. Breaking a streak because a child declined something the product calls optional is the system contradicting itself on her own screen. |
| 2 | **`claimed` counts — approval is NOT required** | Approval is an adult tapping a button. See below; this is the load-bearing one. |
| 3 | **A day with no duties is neutral** | Chores recur on schedules. A Sunday with nothing assigned is not a failure, and it must not be counted as a success either. |
| 4 | **`superseded` leaves the day entirely** | Losing a first-complete claim race is not a failure and is not work. Counting it done awards a streak day for losing; counting it missed punishes a child for being second. |
| 5 | **An unfinished *today* never breaks it** | At 06:30 nothing has been done by anyone. A number that reads 0 every morning and recovers by lunch punishes a child for the time of day. |

### Rule 2 is the one that matters, and it has a precedent here

A streak that requires `approved` breaks when a **parent** forgets to tap. The child did
everything asked; the number on her wall says she did not.

This project already refused to build one number with that shape. The ledger has **no `paid`
state**, because the physical handover of cash is unobservable and "a state that depends on an
adult remembering to tap it will drift and then lie to a child" (H2 Q2, unanimous). It accepted
a real cost — nothing tracks who is still owed cash — rather than ship a number that could
silently become false.

Same argument, same answer. Approval still gates the **points**. It does not gate the streak.

### The consequence of rule 3, stated rather than buried

The streak counts **qualifying days, not calendar days**, so it can span a gap of any width.
"7 day streak" can mean seven school days across two weeks. The claim it makes is *"every day
I was asked, I did it"* — which is the claim worth making, and the one a child can act on.
`unit-c.streaks.test.ts` asserts this directly rather than leaving it as an accident.

---

## 2. What it shows — decided by panel, unanimous

**Question:** what does a child see when the streak is 0, or 1, or has just broken?

Options put to the panel: **(A)** always show the number including zero; **(B)** show nothing
below a threshold; **(C)** show personal best when the current streak breaks; **(D)** do not
build streaks at all.

**Verdict: B, unanimous** — `openai/gpt-5.5` (0.86) and `x-ai/grok-4.5` (0.78). Both picked
the same threshold, **three days**, unprompted and on the same argument: under three days
there is no pattern yet, so the line is noise that appears and vanishes. gpt-5.5: *"null aligns
with the wall rule to say nothing rather than discourage."* grok-4.5: *"Shared wall + unchosen
breaks make zero discouraging."*

`STREAK_DISPLAY_MIN = 3`. The threshold is theirs, not taste.

### The residual risk, which both named and which is NOT solved

**A streak vanishing after a long run is itself a visible signal.** grok-4.5: *"Disappearing
after a long run is still a visible break signal siblings can notice, just softer than an
explicit zero."* gpt-5.5 named the same thing plus a second: a fluent child who noticed the
line may be confused when it goes.

Option B softens the failure display; it does not remove it. That is the honest description of
what shipped, and it should not be written up as if the problem were closed.

### What would change the decision

Both reviewers named the same falsifier, and neither this agent nor the panel can run it:
**a trial with the actual children.** If displaying 0 or 1 causes no teasing and improves
completion, A is better. If hide-on-break causes more distress or confusion than a stable
non-zero personal-best line, C is better. That is the operator's to observe, not ours to reason about.

### A process note on how this verdict was reached

The **first panel came back DEGRADED**, not split: `moonshotai/kimi-k3` failed with an HTTP
524 and `openai/gpt-5.5` answered B alone. One surviving voice cannot disagree with itself, so
"unanimous" would have been an artifact of the outage. Re-run with `x-ai/grok-4.5` as the
second lab, and the agreement is real. Taking the degraded single answer would have produced
the same threshold and none of the evidence.

---

## 3. Where the field lives

**A separate `WallSnapshot.streaks` array, NOT a field on `Balance`.**

`Balance` has two producers — Unit A's `listBalances` and the ledger domain's `balanceFor` —
and `balance.ts` states outright that they apply identical rules "so the two reads can never
disagree". A streak needs a `LocalDate` that neither takes. Adding it there would force the
date into both, and the first one that forgot would reintroduce exactly the divergence that
comment exists to prevent.

A streak is also **not money**. It is the one number the pre-reader could meaningfully have,
and she has no balance by design (`ledger_enabled = 0` — she has a completion history, not a
balance). Nothing renders a streak for her today, and this ADR does not propose one: that
would need a pictogram, not a numeral, and nobody has asked.

The wire carries the **display** value rather than the raw count, so the three band renderers
cannot drift apart on when a streak is worth drawing. The raw number stays available
server-side via `choreStreakDays` and is tested separately from the threshold — re-tuning what
is *shown* must never change what was *counted*.

---

## 4. Nothing is stored

A stored streak is a second copy of a truth the assignments already hold, and it would need a
nightly job to stay true — a job whose failure mode is a wrong number on the wall at 6:00 AM
with nothing reporting it. Same reasoning as `overdue`, which the schema derives rather than
persists for exactly this reason. It is a read.
