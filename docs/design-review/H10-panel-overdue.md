# H10 panel — Overdue and missed, on a shared household wall

**Run 2026-08-27.** Status: **UNANIMOUS** — decision **D**.  Cost $0.0154.

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

A wall-mounted, kid-facing family calendar read by **Child A (7, reads fluently), Child
B (5, emergent), Child C (3, pre-reader)**. Chore state today is
`pending -> claimed -> approved | rejected`, four states, and the wall renders each
state with a distinct fill, border weight and glyph.

We are harvesting the domain model from a mature open-source chore system that has 17
states, and two of them name something ours cannot express at all: **`overdue`** (the
window to do it has passed, it can still be done) and **`missed`** (the window passed
and it is now closed, it cannot be done today). Widening our state union is a
stop-the-world contract change that touches all three reading bands, a state-treatment
table, 41 declared contrast rules and every renderer — so it gets done once,
deliberately, and the presentation has to be decided at the same time as the type.

The wall is mounted in a living room and is looked at by the whole household, including
guests. It is the same screen at 6:00 AM on a school day and at 5:00 PM on a Saturday.

## The decision

How should `overdue` and `missed` be presented to a 3-to-7-year-old on a shared,
household-visible wall?

## Options

**A. Render both as visually distinct states with their own treatment.** `overdue` gets
an alert-family mark and a heavier border; `missed` gets a struck-through or greyed
tile. Both stay on the board all day. Full fidelity — the child can always see the
status of everything.

**B. Render `overdue` distinctly; make `missed` simply disappear from the board.** An
overdue chore is actionable and worth showing. A missed one is not actionable today, so
it leaves the child's board entirely and appears only on the adult approvals/history
surface. The child's board only ever shows things she can still act on.

**C. Render neither distinctly on the child's board.** Carry both states in the data
model — the adult surface and the ledger need them — but the child sees an ordinary
pending tile until the day rolls over, at which point it is simply gone. No child-facing
concept of lateness at all.

**D. Render `overdue` as a positive prompt rather than a negative state.** Same
distinct treatment as A, but the mark is a "still time" / "do this next" affordance —
sorted to the top of the list, emphasised — rather than an alert. `missed` disappears as
in B.

## Constraints that should drive the choice

1. **Guardrails on this wall are architectural, not advisory.** It is touched by
   children and by guests. Nothing punitive should be possible to display to a child in
   a room with visitors in it.
2. **The pre-reader gets no text.** Whatever "overdue" means must be legible as a shape
   or a position to a 3-year-old, or it is not legible at all.
3. **Colour alone may never carry a fact** — 225 nits behind anti-glare etched glass.
   Red-means-late does not survive the panel.
4. **The wall's stated purpose is to help children run their routines, do their chores,
   earn money, and know what is upcoming.** It is not a compliance instrument and the
   household did not ask for one.
5. **Three children share one wall and can see each other's boards.** A visible failure
   state is visible to siblings.
6. **The adult surface already exists** — a PIN-gated approvals queue — and can carry
   any state the child's board does not.
7. **Data fidelity is cheap; screen space is not.** Carrying a state in the model costs
   nothing. Rendering it costs pixels out of a ~420px content area.
```

---

## Verdicts, verbatim

### openai/gpt-5.5 → **D**  (confidence 0.86)

**Reason.** It preserves actionable child-facing information without displaying a public failure state; missed is non-actionable and belongs on adult history, while overdue becomes a routine-helping prompt, not punishment.

**Top risk.** The brief does not specify the exact glyph/shape, so the positive overdue affordance could still accidentally read as warning or shame.

**What would change my mind.** A usability test showing 3-year-olds cannot distinguish the D prompt from ordinary pending without text.

### moonshotai/kimi-k3 → **D**  (confidence 0.65)

**Reason.** Missed is non-actionable, so showing it all day is pure stigma visible to siblings and guests; overdue is actionable and a positive 'still time / do next' positional cue is pre-reader-legible without colour or punitive marks, matching the wall's stated purpose.

**Top risk.** Re-sorting overdue tiles to the top shifts list positions, which can break the 3-year-old's positional navigation of the board; may need a fixed 'do next' slot instead, adding design pressure on the 420px area.

**What would change my mind.** A pilot showing Child C failing to locate her chores after reordering, or A/B evidence that an alert glyph drives overdue completion better than the positive prompt.

---

## What was done with it

*(filled in as the work lands)*

