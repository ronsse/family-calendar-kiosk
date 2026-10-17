# H11 — the routine list does not fit its pane

**2026-08-27.** Two panels, because the first one was answering the wrong question.

The defect, measured on the panel: a child's morning routine hid its own steps in all three
renderings. Fluent lost 16px of step 4; emergent lost 90px of step 3 and **all** of step 4;
the pre-reader lost over half of step 2. The pane scrolls, so nothing was unreachable — but
nothing said anything was below the fold, and the two children least able to discover a drag
gesture were the ones losing the most.

## Why there were two panels

The first brief described the problem accurately and **omitted the one fact that mattered**:
the project had already shipped an auto-fit grid, and an adversarial review had rejected it
because a grid puts a sequence into a shape the eye reads two ways. The patch at that time was
the position numeral; the numeral was later removed when the layout went back to a column.

The first panel chose a grid unanimously — and both reviewers independently named
reading-order ambiguity as the top risk of their own recommendation, without knowing the
project had already hit it and retreated from it.

A panel deciding without the decisive prior art is not deciding the same question. So the
brief was rewritten with the tournament's reasoning quoted verbatim, narrowed to the two bands
that actually needed a decision (the fluent band turned out to be a plain bug — one 48px glyph
where everything else in the row was 32px — and was fixed separately in `4f115ee`), and re-run.

## Panel 1 — before the history was known

```
panel: UNANIMOUS  (2/2 responded, $0.0266)

  • openai/gpt-5.5  →  A  (confidence 0.78)
      reason: It fixes the default-hidden content by using wasted horizontal space while
        preserving target sizes and close-up readability; overflow is worse than grid-order
        ambiguity because children cannot act on invisible steps.
      risk: Grid order for the 3-year-old may be genuinely confusing unless the rendering adds
        clear sequence cues, especially if cards form a 2x2 layout.
      would change mind: A usability test showing pre-readers reliably choose wrong next step in
        the grid despite order cues.

  • moonshotai/kimi-k3  →  A  (confidence 0.78)
      reason: Two columns reclaim the wasted 60% horizontal space, eliminate all overflow with
        no scrolling, and let every band's cards reach the 96px preferred target. Large numerals
        plus done/next states carry order; C's two steps form one unambiguous row, so no per-
        band divergence is needed.
      risk: A 2x2 grid weakens the implicit first-then sequence for the emergent reader; if
        numeral and done/next cues fail, B does steps out of order, and that mitigation is
        asserted, not observed with real children.
      would change mind: A hallway test where 5-year-olds tap a numbered 2x2 grid out of order
        materially more than a vertical list, or a measured pane width too narrow for two
        compliant columns.

  → PROCEED with: A
    Verify any file path, API, or measurement the panel asserted before acting.
```

## Panel 2 — with the tournament's objection in the brief

```
panel: UNANIMOUS  (2/2 responded, $0.0283)

  • openai/gpt-5.5  →  A  (confidence 0.78)
      reason: One-column is impossible; hiding steps is worse. The grid objection still stands
        for B’s 2x2, but restored numerals plus isNext/done explicitly carry order. C’s single
        row is unambiguous.
      risk: The numeral may not be usable enough for the 3-year-old, and B may still misread 2x2
        order despite numerals/highlight.
      would change mind: Panel test shows B children choose wrong next step from 2x2 layout more
        often than with scroll/focus.

  • moonshotai/kimi-k3  →  A  (confidence 0.75)
      reason: One column is arithmetically impossible; only A keeps every step visible at legal
        pictogram sizes. Tournament objection is neutralized: C's single row is inherently
        unambiguous, B's 2x2 gets numerals plus existing isNext/done states as redundant order
        carriers.
      risk: Per-band divergence (column/grid/row) erodes 'one state, three renderings,' and if
        isNext is colour-only it violates constraint 2, leaving numerals—which a young child may
        not reliably read—as the sole non-colour order carrier.
      would change mind: A hallway test showing child B cannot point to the next step in a
        numbered 2x2 mock, or finding isNext/done are colour-only carriers in the source.

  → PROCEED with: A
    Verify any file path, API, or measurement the panel asserted before acting.
```

## What was done, and the falsifier that was checked

**Two columns for the pictogram bands, one for the fluent reader** (`dc0ba9e`).

Both reviewers explained why the old objection does not carry: the pre-reader's case is a
single **row** of two, which has no ordering ambiguity at all, and the emergent 2x2 gets the
numeral back. The numeral is therefore *derived from the layout* rather than declared per
band — shown only when the grid actually wraps.

kimi-k3 handed over a concrete falsifier: it would change its mind on finding `isNext`/`done`
were **colour-only** carriers, since that would leave a numeral a young child cannot reliably
read as the sole non-colour carrier of order on a 225-nit panel. That was checked in the
source before anything was built. It does not fire — `isNext` is a stroke width in emergent
and an icon-size jump in picture, and `done` swaps the glyph. The recommendation survived its
own test, and the numeral is a third carrier rather than the only one.

## What would overturn this

Both reviewers named the same thing, and neither the panel nor this repo has it: **a hallway
test.** If a five-year-old picks the wrong next step from a numbered 2x2 more often than from
a scrolling column, option A is wrong and focus-mode (C) is the answer. Nobody has run that,
and it is the honest limit of this decision.
