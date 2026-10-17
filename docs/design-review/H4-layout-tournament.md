# H4 — the child-view layout tournament

```yaml
date: 2026-08-25
method: 5 independent proposals + 1 blind entry (the design as built), 3 disjoint judges
endpoint: Nous inference API
redaction: synthetic brief only — Child A (7, fluent) / B (5, emergent) / C (3, pre-reader)
```

Run *after* the layout was built, not before, because the information architecture had already
been decided solo overnight and the useful question was no longer "what should we do" but
"is what we did right, and what did we miss".

**The design as built was entered anonymously**, in the same format and at a comparable length,
so the judges ranked it without knowing one entry was the incumbent.

## Result

| Judge | Ranking | Where the built design placed |
|---|---|---|
| `claude-sonnet-4.6` | E, **B**, D, A, F, C | 2nd |
| `gemini-3.5-flash` | E, **B**, C, … | 2nd |
| `deepseek-v4-flash` | E, C, D, **B**, A, F | 4th |

`E` (`claude-opus-4.8`) won **unanimously**. `B` was the design as built.

## What the winner does better

**Time-gating goes all the way, not half.** Ours uses the clock to pick which of two sections
leads. E drives the *entire screen* from four windows — morning routine, chore board, bedtime
routine, and a resting state in dead time — so there is no section switch to discover at all.

**Chrome cut to 56px, not 96.** E drops the text date entirely: meaningless to the pre-reader,
redundant for the fluent one, and it buys 40px of the scarcest axis. "When" is carried by an
analog dial, which works for all three bands.

**"Vertical = sequence, horizontal = parallel choices."** A routine is ordered — steps belong in
a column, where reading order and gravity agree. A chore board is unordered — cards belong in a
row. This is the sharpest idea in the tournament and **it caught a real defect in ours**: we had
just put routine steps into a 2-column grid *and* removed the position numeral in the same
change, on the reasoning that order is carried by position. That is true in a column and false
in a grid. The numeral is restored; the deeper fix is a single full-width column, which needs
the header cut first.

E's own stated risk is the one worth keeping: **everything hinges on the device clock.** The Pi
has no RTC and NTP can step it backwards. Time-gating moves the prime-invariant failure rather
than removing it.

## What the built design contributed

`claude-sonnet-4.6` named it as the best idea the winner should absorb:

> B's explicit rule that the clock supplies the default and the toggle is for overriding, never
> for operating. […] design so the *correct state is already showing* and the control exists
> only for the exceptional case.

## The idea two judges independently demanded — and we already had

Both `gemini-3.5-flash` and `deepseek-v4-flash` named an **idle timeout that reverts to the
time-correct view** as the single missing safety property: a child taps into chores, runs for
the bus, and the wall is stranded on the wrong screen all day.

We ship a 90-second idle decay to the ambient view (`web/src/views/logic/idle.ts`), which also
clears the section override because `ChildView` unmounts. It was absent from the entry only
because the write-up omitted it. **Now verified live for the first time:** selected a child,
overrode the section to Jobs, waited — the wall returned to ambient at ~100s with both the
selection and the override cleared.

## Carried forward

1. **Cut the header from 96px to ~56px** and drop the text date. Then routine steps can be a
   single full-width column and the sequence reads top-to-bottom, as it should.
2. **Consider four time windows rather than two sections.** It removes the switch from the
   critical path entirely.
3. **The sibling-tap trap**, raised by `gemini-3.5-flash` and not yet addressed: the pre-reader
   taps a sibling's face in the rail and lands on a text-heavy screen he can neither read nor
   escape. The 90s decay bounds it, but 90 seconds is a long time when you are three.
4. **Clock robustness.** E's risk. The Pi has no RTC; `idle.ts` already handles NTP stepping
   backwards, but nothing handles a timezone or DST flip mid-run.

## Method notes

Two traps cost real time and are the same ones H1–H3 recorded:

- The endpoint **403s the default Python User-Agent** (Cloudflare 1010). Use `curl`, or set one.
- **Reasoning models charge their trace against `max_tokens`.** Three of five proposers returned
  empty at 4000 — `glm-5.3` returned `finish_reason: "length"` for a one-word reply at 50
  tokens. Raised to 24000 and they answered. Budget for thinking *and* answer, or the answer is
  what gets truncated away.
