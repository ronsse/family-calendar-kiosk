# H10 panel — Duties versus paid extras, on a pre-reader's board

**Run 2026-08-27.** Status: **UNANIMOUS** — decision **D**.  Cost $0.0249.

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

A wall-mounted, kid-facing family calendar. 960x540 logical pixels, 225 nits behind
anti-glare etched glass. Three children use it: **Child A (7, reads fluently), Child B
(5, emergent reader), Child C (3, pre-reader)**. One state, three renderings, chosen by
a reading band — the pre-reader's screen carries no words at all.

Chores today are one flat list per child. Each is a tile with an icon, a short label, a
point value, and a tap that claims it. State machine is
`pending -> claimed -> approved | rejected`, points move on approval only.

The household is now splitting chores in two, and this is a rule about the home, not a
feature request:

- **Duties** — required, part of belonging to the household. Make your bed. They pay
  nothing. `base_points = 0` already models this.
- **Paid extras** — optional, chosen, and they earn money. The list is meant to be
  adjustable by a parent over time.

Measured constraints on the child's own screen: the content area is ~420px tall after
chrome. A chore board of four tiles is ~260px. Tap targets are 96/80/64px by reading
band with a mandatory 16px inert gutter, and that floor is not negotiable — it is motor
skill, not eyesight.

## The decision

How should a child's chore board distinguish a required duty from an optional paid
extra, such that the 3-year-old pre-reader — who gets no text — can tell them apart?

## Options

**A. Two separate sections on the same board, in fixed order.** Duties first under one
heading/icon, paid extras second under another. Always the same order regardless of
count. Costs vertical space for a second section header (~40-70px measured on the
comparable switcher) out of ~420px, and either section may be empty on a given day.

**B. One list, with a coin/star mark on the paid ones only.** A single ordered list;
each paid extra carries an additional earning glyph in a fixed corner of its tile.
Duties carry nothing extra. Costs no vertical space. Absence-of-mark is the signal for
duties.

**C. One list, with the point value itself as the only distinction.** Paid extras
already display a number; duties display nothing where the number would be. No new mark
at all — the existing points readout does the work. Costs no space and adds no
vocabulary, but the distinction is carried by an empty region.

**D. Two separate destinations, reached from the section switcher.** The board already
has a ringed-circle switcher (one circle per routine, plus Jobs). Add a second Jobs
circle so duties and paid extras are separate screens, each with a progress ring. Costs
one switcher circle (~76px wide, no extra height) and one extra tap to reach either.

## Constraints that should drive the choice

1. **The pre-reader gets no text, ever.** Whatever distinguishes them must survive with
   zero words. A heading that says "Extra jobs" is invisible to Child C.
2. **Colour alone may never carry a fact.** Standing rule in this design system: 225
   nits behind etched glass, colours that separate on a laptop collapse on the wall.
   Every fact needs a second channel — shape, position, or a mark.
3. **Absence is a weak signal on this panel.** "The ones without the badge" is a
   comparison, and it requires both kinds to be on screen at once to be readable. On a
   day with only duties, or only extras, an absence-based scheme says nothing.
4. **Vertical space is the binding constraint.** ~420px for the child's whole day.
   An earlier version of this board spent ~150px on two labelled pills to say "Morning"
   twice and had to be rebuilt; the fourth routine step was falling off the bottom.
5. **The paid list is adjustable and will change.** Whatever this is must not assume a
   stable count, and must read correctly when one of the two kinds is empty.
6. **The wall's purpose is four jobs**: run routines, do chores, earn money, know what
   is upcoming. "Earn money" is a first-class job, not a decoration on the chore job.
```

---

## Verdicts, verbatim

### openai/gpt-5.5 → **D**  (confidence 0.78)

**Reason.** It avoids absence-based signaling and vertical-space cost while making earning money a first-class destination that can work even when one category is empty.

**Top risk.** The brief does not specify whether the two switcher circles can carry distinct non-text icons understandable to a pre-reader.

**What would change my mind.** A prototype test where Child C reliably distinguishes A’s two icon sections but not D’s two switcher icons.

### moonshotai/kimi-k3 → **D**  (confidence 0.7)

**Reason.** Only D satisfies all six constraints: earning becomes a first-class icon destination, costs zero vertical space, uses a positive presence-based signal rather than absence, needs no text, and stays correct when either list is empty.

**Top risk.** Child C must learn two switcher destinations plus an extra tap; if the added ~76px circle or its icon fails for a 3-year-old, paid extras become invisible rather than merely undistinguished.

**What would change my mind.** A hallway test showing Child C cannot navigate or distinguish the two circles, or a measurement showing A's two sections plus real tile counts fit 420px including empty days.

---

## What was done with it

*(filled in as the work lands)*

