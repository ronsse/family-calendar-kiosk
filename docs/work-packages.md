# Work packages — what a sub-agent can be handed, and what it must never decide

**Opened 2026-08-29.** [`build-plan.md`](build-plan.md) decomposed M1, the build. This file is
the same idea for what is left: the ordered queue in the backlog (private notes; the public summary is [`BACKLOG.md`](BACKLOG.md)), cut into
packages with disjoint file ownership so several agents can run at once without colliding.

It exists because "let's parallelise this" is the point at which a codebase with a lot of
hard-won reasoning starts losing it. Every rule below is here because breaking it has a
specific cost, named.

---

## 1. The five rules, and what each one prevents

**1. FILE OWNERSHIP IS EXCLUSIVE.** A package names the files it may write. Two agents editing
one file produce a merge neither of them reasoned about — and in a repo where the comments
carry the design, a lost comment is a lost decision. If two packages want the same file, they
are one package.

**2. FROZEN CONTRACTS ARE AMENDED, NEVER EDITED IN PASSING.** `docs/api.md`,
`src/types.ts` and `src/calendar/CalendarSource.ts` are frozen. A package that needs a field
says so, amends deliberately, and explains the compatibility story in the same commit — as
`streaks` did on 2026-08-29. **A brief that says "add a route in `src/http/routes/<name>.ts`"
is already wrong**: no such directory exists, routes live in `routes.wall.ts` and
`routes.admin.ts`, and two agents were given that instruction on 2026-08-27.

**3. THE REDACTION RULE, RESTATED** ([build-plan §3.1](build-plan.md)). Anything leaving this
box carries `Child A (7, reads fluently) / B (5, emergent) / C (3, pre-reader)` and never a
real name, an age-name pairing, a pet name, or a household detail. That includes prompts to
image models, briefs to panels, and **the reports agents write back**. As of 2026-08-29 the
image half is enforced by a program rather than by an agent remembering — see §3.

**4. LICENCE DISCIPLINE.** DinkyDash is MIT and may be lifted. ChoreOps (GPL-3.0) and Donetick
(AGPLv3) are viral: read them to understand the domain, never paste them here.

**5. AN AGENT REPORTS WHAT IT RAN.** `npx tsc --noEmit`, `npm test`, and the real output. A
package is not done because it looks done. Three separate times this session a change passed
`tsc` and every unit test and was still wrong on the glass — which is what
`npm run audit:panel` now exists for.

---

## 2. What is NOT delegable, and why

| | Why |
|---|---|
| **§5.1** — does the picture need a readout | Panel split. Needs two weeks of the door counter, then the operator |
| **§5.2** — scene cadence | Panel split. `dailyRotation` is written and tested; adopting it is the operator's one-line call |
| **The chore list** | Which chores earn and what they pay is a household decision. `db/chores.example.json` is the template |
| **Whether to generate child imagery at all** | Raised 2026-08-29 (private notes). An agent may not answer this by deleting avatars — the pre-reader navigates by face |
| **Spending** | Image generation costs Nous credits. An agent may write prompts; a human runs the generation |
| **The power-cut test, RSSI at the final mount** | Physical access |
| **Anything irreversible** | Publishing, deleting production data, credential ops, history rewrites — no amount of model consensus makes those recoverable |

A genuine judgement call that is none of the above goes to
a `decision-panel` skill (a cross-lab panel of reasoning models), not to the operator and not
to a coin flip. **A split escalates.** So does a degraded panel: on 2026-08-29 one panelist
returned HTTP 524 and the survivor answered alone, which is not consensus — it was re-run
against a different second lab.

---

## 3. In flight, 2026-08-29

| Package | Owns | Done means |
|---|---|---|
| **A — the disclosure guard** | `tools/prompt_guard.py`, `tools/gen-icon.py`, `tools/backgrounds.md` | A prompt containing a household name is REFUSED before any network call, with a self-test wired to npm |
| **B — the prompt library** | `docs/image-prompts.md` | Researched scaffolds plus ready scene and band prompts, sourced, with the failure modes collected |
| **C — scene selection** | `web/src/app/WallApp.tsx`, `web/src/views/domain/SceneView.tsx`, `web/src/views/logic/scenes.ts`, `test/unit-h.scenes.test.ts` | The wall picks its scene through `pickScene` with `firstAvailable`; behaviour today is unchanged and a second scene becomes possible |

**A is the one that matters most.** ADR-0002's disclosure test has been enforced entirely by
agents remembering it, which is precisely what CLAUDE.md forbids: *guardrails are
architectural, never a prompt instruction.* The guard reads the gitignored roster and refuses
any prompt containing a name in it — and never prints, logs or transmits what it found.

---

## 4. The queue, in order

Each is sized for one agent and names its files. None of them requires a decision from §2.

### 4.1 The sibling-tap trap — **DONE 2026-09-08.** Panel split, operator chose the stricter option

Panelled 2026-09-07 and the panel split: grok-4.5 said undo-first alone, gpt-5.5 said the same
plus a confirming second tap on routine steps. Escalated by rule. **The operator chose the second tap.**

**What was built.** `TapPhase` gains `pending`: a first tap on a confirm-mode control shows a
heavy ink ring and applies **nothing**; a second tap inside `CONFIRM_MS` applies it, after which
the ordinary undo window runs exactly as before. An unanswered ring decays on its own timer, so
a stray brush leaves no trace at all.

**Opt-in per control, and only routine steps use it.** Chore claims deliberately do not: a false
claim already enters an approval queue an adult must PIN-approve, so a second tap would buy
nothing and cost every child two taps on every chore. A routine tick is the only unreviewed
write on the wall, which is exactly why it is the one that got the gate.

**The gesture did NOT invert, and that was the trap worth avoiding.** On an ordinary control a
second tap inside the undo window still means *cancel*, as it always has. Confirming and undoing
are separate gestures on separate phases rather than the same gesture meaning two things
depending on a mode the child cannot see. There is a test asserting the ordinary path still
cancels.

**The ring outranks the `isNext` focus ring**, because what the wall is waiting for right now
matters more than what is next, and it is drawn wordlessly — the pre-reader has no text on any
of his screens and he is the child this most exists to protect.

**The cost, stated plainly:** every child now pays a second tap on every step of her own morning
routine, every day. That was the trade the operator accepted; `CONFIRM_MS` is twice the undo
window so a three-year-old is not hurried.

Ten unit tests on the pure machine, including the two-brushes-far-apart case that must not pair
into a completion.

### 4.2 The partial cash-out picker — **DONE 2026-09-07** (panel: unanimous B)
Today cashing out requests the WHOLE balance. `PointsPanel` records that as a deliberate
simplification, not an oversight: a numeric picker is unusable by the emergent reader and
invisible to the pre-reader, who has no ledger at all. So the package is **not** "add a
picker" — it is "let a child ask for part of it in a way two of three bands can actually
operate", which is a pictorial problem. Panel it. Owns: `web/src/views/domain/PointsPanel.tsx`,
the bands' `PointsBadge`, `src/domain/ledger/redemption.ts` if the contract must move.

### 4.3 Event icons, the tail
`tools/suggest-event-words.ts` proposes categories for the titles the keyword table declines,
and stops there deliberately — nobody has read those labels, and an 8B model choosing the
picture a pre-reader sees is the confidently-wrong output this project refuses everywhere
else. **The package is the review loop, not the automation**: make it easy for a human to
accept or reject a proposal, and remember that household-specific words cannot live in
`src/calendar/classify.ts`, which is committed and must stay generic. They belong in the
database beside `db/household.sql`.

### 4.4 Remove ChoreOps from Home Assistant — **DONE 2026-09-07**
Removed. Verified idle first: 0 config entries, no `choreops` domain among the nine present,
and nothing of ours referencing it. 15MB of GPL-3.0 source gone from the config tree.

**One wrinkle worth recording:** `rm -rf` from the host fails on the `__pycache__` `.pyc`
files, which HA writes as root inside the container. Delete from inside instead —
`docker exec homeassistant rm -rf /config/custom_components/choreops` — or you are left with
a half-removed tree that still looks installed.

### 4.5 A second look at the audit's blind spots
`npm run audit:panel` checks type size, tap floors, the inert gutter, stroke weight, clipping
and sideways scroll. It does **not** check contrast, which is the rule this panel is most
likely to break — 225 nits behind anti-glare etch, and `tokens.ts` computes with flare 0.10
rather than WCAG's 0.05 for exactly that reason. Add a contrast rule that uses the project's
own metric. Owns: `tools/panel-audit.mjs`.

---

## 5. Imagery, and the two kinds that are not interchangeable

Settled while writing this, because the docs were ambiguous enough to send an agent the wrong
way — `tools/backgrounds.md` has a section headed **No people** whose body is only about the
decorative band, and a reader could easily apply it to everything.

- **Bands** (`assets/backgrounds/`) — a sparse strip along the bottom of the idle wall. No
  figures at all: cards sit on top, and a figure with its head behind a card reads as a bug.
- **Scenes** (`assets/scenes/`) — a full-bleed search-and-find home screen, deliberately busy
  and **full of generic cartoon people**, because the mechanic is each child finding herself
  in it. Regions are authored in `<id>.json` as fractions.
- **Avatars** (`assets/avatars/`) — the real children, and the only place a likeness belongs.

The rule that actually holds across all three: **no likeness of a real child is ever
generated.** Generic figures are required in a scene and forbidden in a band.

**Authoring a scene region is not a detail.** A region below the 64px tap floor, or one boxing
the wrong figure, is a dead end that looks like a working screen — a child taps herself and
nothing happens, with no visible way onward. `trailer-camp.json` records the measurement it
was checked against; do the same.
