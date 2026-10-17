# H2 — Approach tournament

```yaml
date: 2026-08-24
program: build-plan.md §3.2 H2
proposers: anthropic/claude-sonnet-5 · deepseek/deepseek-v4-pro · x-ai/grok-build-0.1 · moonshotai/kimi-k2.5 · qwen/qwen3.7-plus · mistralai/mistral-medium-3-5
judges: openai/gpt-5.5 · google/gemini-3.1-pro-preview · sakana/fugu-ultra
input: redacted design brief + the settled H3 constraints
status: winners adopted; grafts and gaps pending Phase 0
```

## Method

Three open design questions. For each, **six models proposed independently** — none saw another's
answer, which is the entire diversity mechanism. Proposals were then relabelled **A–F in a
randomised order with author identity stripped**, and scored by judges drawn from a **disjoint
model set**, so nothing scored its own design. Judges scored 0–5 on five criteria: 6:00 AM
correctness, fitness across the three literacy bands, simplicity/testability, respect for the
settled H3 constraints, and intellectual honesty about the design's own cost.

18 proposals, zero failures. q2 and q3 got three judges; **q1 got two** — `sakana/fugu-ultra`
spent over ten minutes on q1's 47KB bundle and was dropped from that question to unblock the
queue. Blind key: `scratchpad/blind_key.json`.

## Results

| Question | Winner | Judge scores | Runner-up |
|---|---|---|---|
| Q1 — routine model | **deepseek-v4-pro** | 23, 23 (2/2 judges) | claude-sonnet-5 (20, 19) |
| Q2 — ledger & redemption | **deepseek-v4-pro** | 25, 23, 24 — **unanimous** | claude-sonnet-5 (18, 22, 21) |
| Q3 — renderer architecture | **deepseek-v4-pro** | 24, 24, 22 (2/3) | claude-sonnet-5 (22, 21, 23) |

**One model swept all three.** Treat that with some suspicion rather than as a verdict on model
quality: deepseek also produced the longest and most schema-explicit answers (10–11KB vs 3–4KB
for the shortest), and judges plausibly reward concrete DDL. The designs below were read directly
and are adopted on their merits, not on the scoreboard.

## Q1 — Routine model *(adopted)*

Both judges named the same winning property: **read-path materialization that is idempotent
*and self-repairing*.**

- `routine_run` carries `UNIQUE(routine_id, local_date)`; `routine_run_step` **snapshots**
  `title`, `icon`, `position` per child at materialization.
- **Snapshot isolation answers the mid-day edit question.** A parent reordering a routine at
  14:00 cannot corrupt today's in-flight run, because today's run no longer reads the definition.
- **Self-repair:** if the run row exists but its step snapshot is missing — the crash-between-writes
  case — the next read inserts the snapshot rather than returning an empty routine.
- **Un-completion is a soft `revoked_at`** with a partial unique index
  (`WHERE revoked_at IS NULL`), never a delete. A 3-year-old's mis-tap is recoverable and history
  stays intact.
- All writes run in a dedicated SQLite worker, honouring the H3 event-loop constraint.

**Grafts adopted from non-winners:**

- Explicit per-band display columns on the step definition — `icon_ref`, `label_short`,
  `label_full` — rather than hoping one text string renders three ways.
- A 2-second client-side undo toast, which intercepts a mis-tap locally before it ever needs a
  server-side revoke.
- An admin banner: *"changes take effect tomorrow"* — makes snapshot isolation legible to adults
  instead of surprising.

**Fatal flaws found in rejected proposals** (all verified against the design, not taken on faith):

- **`SELECT ... FOR UPDATE` does not exist in SQLite.** One proposal's entire concurrent
  materialization strategy is unimplementable. Both judges caught it independently.
- **Server-side time-box evaluation breaks the prime invariant.** A routine whose `locked | open |
  closed` state is computed server-side and shipped in a snapshot generated at 00:00 will never
  visually open at 06:00, because the wall only refetches on SSE open and at the date boundary.
  **Time-box state must be computed client-side from the clock.** This falls directly out of the
  H3 SSE contract — the tournament compounding on the pre-mortem rather than repeating it.
- **Hiding a routine before its window opens** renders a blank wall at 05:30. Explicitly forbidden.
- **PIN-gating un-complete** bricks the routine until an adult intervenes. With capacitive touch
  and a 3-year-old, mis-taps are certain, so this guarantees a morning failure.

## Q2 — Ledger and redemption *(adopted, with one tension recorded)*

Unanimous. The winning property, in the judges' words: **it refuses to model the physical cash
handover as system truth.** The ledger records only computer-observable facts — adult approval,
and the destruction of points. There is no `paid`/`unpaid` state to desynchronise from reality.

- Unit is an integer **point**. Money exists only at redemption, via a **single household-wide**
  `cents_per_point`. Explicitly **not per-child**: differing rates make the same balance mean
  different things to siblings and create arbitrage on shared chores.
- `child.ledger_enabled = false` for the pre-reader. Her chores still run the full state machine;
  **no ledger row is ever written**. Shared-chore point splits are computed only over
  ledger-enabled assignees, with divisibility enforced at configuration time.
- `UNIQUE(child_id, ref_type, ref_id, reason)` on `ledger_entry` — the structural backstop behind
  the H3 transition-as-idempotency-guard.
- `redemption_request` snapshots the rate at request time, with a unique index permitting only one
  pending request per child.
- No expiry, no decay — partly on child-fairness grounds, partly because decay would require a
  scheduled writer whose silent failure is exactly the risk class the architecture exists to
  remove.

### The recorded tension: the runner-up's IOU list

The runner-up tracked `paid_at` separately from the ledger, giving parents an
approved-but-unpaid view — an IOU list. On reading it directly I thought it was the better idea:
it is honest about a step the software cannot observe, and it answers *"who is still owed real
cash?"*, which the winner simply does not.

**All three judges rejected it**, and their argument is strong: any state that depends on a parent
remembering to tap "paid" will drift, and a drifted IOU list actively lies to a child.

Adopting the winner, but this is **not settled** — the winner's answer to "who is owed cash" is
that nobody tracks it. Revisit once real usage shows whether that gap hurts.

## Q3 — Renderer architecture *(adopted, with grafts from a close runner-up)*

- **One capability-driven domain tree. The branch happens exactly once**, at a
  `BandRendererProvider` supplying a typed renderer registry keyed by
  `ReadingBand = 'picture' | 'emergent' | 'fluent'`.
- Domain components own data, derived state and actions; they call `useBandRenderer()` only to
  obtain a presentational leaf. All stateful logic — SSE wiring, action dispatch, tap debounce —
  exists once.
- **An ESLint rule forbids `if (band ===` or `switch (band)` anywhere outside the provider.**
  Divergence prevention is enforced mechanically, not by convention. This is what answers "how do
  the three renderings avoid silently drifting apart".
- A `RendererErrorBoundary` **falls back to the picture-band component**, so a localised render
  crash degrades to something a pre-reader can still use rather than leaving a hole in the wall.

**Grafts adopted from the runner-up** (which won one judge's vote and is genuinely close):

- **Mandatory `icon_id`, `label_short`, `label_full` enforced at write time**, not render time.
  Nothing can be authored without them, so the blank-card failure moves to authoring — where it
  fails loudly to an adult — instead of to 06:00, where nobody is present.
- Exhaustive TypeScript switches with a `never` check, so adding a fourth band is a compile error
  until every primitive handles it.
- **`activeChild` and `band` live in memory only** — never `localStorage`, never the server — with
  a 90-second idle timeout decaying to an ambient view. This is the direct fix for the H3 finding
  that a persisted selected-child leaves the wrong child's screen up all night.

## What every proposal missed

The judges' "what did all six miss" answers were the highest-value output of the round.

1. **No deterministic asset fallback.** Every design leans on icons for the pre-reader; none
   specifies behaviour when an icon is missing, renamed, corrupt, or fails to load in Chromium.
   **For Child C, a missing picture is a blank screen.** The run snapshot must carry resolved local
   asset ids with a guaranteed built-in fallback per step category, validated before activation.
2. **Child B — the emergent reader — has no money UI.** Every proposal designed for the fluent
   reader and the pre-reader and left the middle band to fall out by accident. She needs an
   icon-led balance, limited words, and redemption affordances legible without fluent reading.
   This is the literacy-band invariant failing in the one place it is least obvious.
3. **Freshness is not in the shared contract.** No proposal made wrongness *visible*. The snapshot
   should carry `snapshotLocalDate`, `generatedAtUtc`, `calendarSyncAgeSeconds`, and
   `routineMaterializationStatus`, so the wall can render staleness rather than presenting stale
   data with full confidence. This is H3 finding #10 arriving independently from a different angle.

## Judge output rejected on review

Delegated findings are verified before they change anything, and one did not survive:

**gemini scored four Q2 proposals `0` on constraint-respect** for violating *"`chore_assignment`
is per child per date"* — treating a descriptive line from the brief's *rough data model* section
as a settled constraint. It was never one. gpt-5.5 scored the same proposal 22/25 and sakana 21.
The zeros are rejected, and **how to model shared / first-complete chores remains genuinely
open** — a single row with an atomic claim race, versus one row per child, is a real design
question that this tournament did not settle.

## Contract changes for Phase 0

1. `routine_run` + `routine_run_step` snapshot model, with self-repairing materialization.
2. Soft `revoked_at` completions with a partial unique index.
3. **Time-box state computed client-side**, never shipped in a server-generated snapshot.
4. Single household-wide `cents_per_point`; `child.ledger_enabled`; `UNIQUE(child_id, ref_type,
   ref_id, reason)` on `ledger_entry`; `redemption_request` with a snapshotted rate.
5. `BandRendererProvider` + typed renderer registry; ESLint ban on band branching outside it;
   `RendererErrorBoundary` falling back to the picture band.
6. `icon_id` / `label_short` / `label_full` mandatory at write time.
7. `activeChild` in memory only, 90s idle decay to ambient.
8. Asset fallback chain resolved and validated at snapshot time.
9. Freshness fields in the wall snapshot contract.
10. **Open:** the shared/first-complete chore assignment model, and whether the absence of an IOU
    list hurts in practice.
