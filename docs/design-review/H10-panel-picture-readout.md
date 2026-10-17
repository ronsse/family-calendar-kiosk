# H10 panel — Does the picture need an at-a-glance readout?

**Run 2026-08-27.** Status: **SPLIT** — no decision; escalated.  Cost $0.0251.

Two independent reviewers from different labs, neither Anthropic — an Anthropic panelist
correlates with the agent that wrote the brief and buys agreement rather than evidence.
Reproduce with `python3 ~/.claude/skills/decision-panel/panel.py --brief <brief> --reversible`.

> **Tooling note.** The first run of the night reported a SPLIT on a brief where both
> panelists had chosen the same option, because agreement was decided by exact string
> equality on a free-text field and one model answered `"B"` while the other answered
> `"B. <full option title>"`. Fixed in `my-claude-skills@856d290` before any of these ran.
> Any panel record dated before 2026-08-27 may carry that artifact.

---

## The brief, as sent

```markdown
## Context

A wall-mounted family calendar in a living room, 960x540 logical pixels, read by three
children (**A, 7, fluent; B, 5, emergent; C, 3, pre-reader**) and by two adults.

The wall has two idle appearances and a gate chooses between them:

- **The information board** — today's events, each child's progress, what is next. Shown
  whenever the clock cannot be proven correct, inside the two routine windows
  (05:45-08:30, 18:45-20:45), or when something is waiting for an adult. The gate fails
  closed: an unproven clock always yields the board. This is the screen the prime
  invariant is about ("never blank or wrong at 6:00 AM on a school day").
- **A full-bleed search-and-find illustration** — a busy colouring-book scene in which
  each child can find themselves and tap themselves to open their own day. Shown the
  rest of the time, roughly 18 hours a day.

An adversarial panel previously required the illustration to carry a permanent 56px
"next up" ribbon along its top so that it is never information-free. That shipped. The
operator then removed it, having seen it on the actual panel: the picture had a 56px
header AND a 56px ribbon above it, was letterboxed into ~370px of a 540px screen, and
framed in background colour on all four sides. His reasoning was that today's events are
what the calendar view is *for*, and the calendar is one tap away behind a permanent
button.

The picture is now genuinely full-bleed. Its only chrome is two floating round buttons
in a corner — calendar, and an adult surface — plus a stale-data label that appears only
when the data is not current.

## The decision

During the ~18 hours the illustration is up, does the wall need to carry any
at-a-glance information for an adult crossing the room — or is "one tap to the calendar"
sufficient?

## Options

**A. Nothing. The picture stays as it is.** Information lives one tap away. The wall is
a beautiful object most of the day and an information board when information matters,
and the gate already decides which is which.

**B. Bring back a persistent ribbon.** A 56px opaque bar carrying the next event.
Costs 56px of a 540px illustration permanently, and reintroduces exactly what the
operator removed.

**C. A minimal floating readout, in the illustration's own idiom.** One small chip in a
corner — same white-fill/black-outline treatment as the two existing buttons — carrying
only the next event's time and title, and only when there IS one. Nothing on a day with
nothing left. Costs no permanent horizontal band and disappears when it has nothing to
say.

**D. Widen the gate instead of adding chrome.** Leave the picture completely clean, and
make the board appear more often — for example, for a few minutes before any event
starts. Information arrives by the screen changing rather than by the picture carrying a
bar.

## Constraints that should drive the choice

1. **The prime invariant is untouched by this decision.** The gate already shows the
   board at 6:00 AM, inside both routine windows, whenever the clock is unproven, and
   whenever something is waiting for an adult. Whatever is chosen here applies only to
   hours in which the household has already been judged not to need the board.
2. **The operator has already removed the ribbon once, having seen it.** Option B is
   available but must overcome a decision made from the actual panel, not from a mockup.
3. **The illustration's job is to be a door.** Children find themselves in it and tap
   themselves. Chrome that occludes the scene degrades the one interaction it exists for.
4. **225 nits behind anti-glare etched glass.** Anything drawn over the art needs an
   opaque fill and a heavy outline; translucency and scrims do not survive this panel.
5. **A wall that permanently displays nothing-to-report is a wall that nags.** Existing
   rule in this system — the adult badge is absent at zero rather than showing "0".
6. **Adults in this household carry phones**, and every event on this wall also exists in
   a Google Calendar they already have.
```

---

## Verdicts, verbatim

### openai/gpt-5.5 → **A**  (confidence 0.68)

**Reason.** The gate already covers times when information matters, adults have phones, and extra chrome degrades the illustration’s primary door/beauty role. One tap is sufficient outside judged-need windows.

**Top risk.** The brief lacks observed behavior: adults may rely on passive room-glance reminders despite phones and calendar button.

**What would change my mind.** A field log showing frequent missed/late events during illustration hours without opening the calendar.

### moonshotai/kimi-k3 → **C**  (confidence 0.55)

**Reason.** Chip appears only when a next event exists, honoring absence-at-zero; uses the proven opaque-fill/heavy-outline idiom that survives the etched glass; gives adults passive glance value without a permanent band, letterboxing, or gate churn.

**Top risk.** C partly second-guesses the operator's reasoning that information belongs one tap away; on event-heavy days the chip hovers all afternoon as a de facto ribbon and adds a stateful element over the children's tappable scene.

**What would change my mind.** A tap log from the shipped unit: frequent adult taps of the calendar button during illustration hours confirms C's need; near-zero taps over two weeks supports A.

---

## What was done with it

*(filled in as the work lands)*

