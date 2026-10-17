# ADR-0004 — Build the kid-facing app; Home Assistant demoted to a calendar source

```yaml
status: accepted
date: 2026-08-24
deciders: the operator
supersedes: ADR-0001 (Lovelace as the frontend; HA as the integration layer)
```

## Context

ADR-0001 framed this as "which frontend over which integration layer" and answered HA +
Lovelace. Restating the purpose in the owner's words on 2026-08-24 broke that framing:

> "The purpose of this is not a home assistant dashboard, it is a calendar to help the kids
> with routines, chores, earn money/stars, and know what is upcoming."

Four requirements. Not a household operations board, not a smart home, not an assistant.
Re-scoring the landscape against *those four* — rather than against the feature matrix of the
closed products — is what produced this decision.

### What the landscape actually covers

| | ChoreOps (HA) | Donetick | DinkyDash | Family-dashboard OSS |
|---|---|---|---|---|
| Routines — ordered, daily reset, pre-reader | ✗ | ~ subtasks w/ smart reset | ✗ | ✗ |
| Chores per kid | ✓ 4 assignment models | ✓ rotation | ✗ modulo display, no check-off | partial |
| Stars / points | ✓ configurable currency | ✓ points | ✗ | rare |
| Real money / allowance | ✗ | ✗ | ✗ | ✗ |
| Parent approval | ✓ chores *and* redemptions | ✗ | ✗ | ✗ |
| What's upcoming | ✓ via HA Google Calendar | ✗ none | ✓ iCal + countdowns | ✓ |
| Credibility | 394★ GPL-3.0 | 2.5k★ AGPLv3 | 93★ MIT | 0–43★ |

**Nothing covers more than one of the four well, and nothing does money at all.** The two
strongest projects each miss a requirement the other has, and neither touches routines —
independently confirming the [feature-landscape](../feature-landscape.md) finding that
routines have no off-the-shelf answer anywhere.

### Why not fork DinkyDash

Evaluated properly on 2026-08-24 by cloning it, because "it calls Anthropic at 6:00 AM" is an
argument against *adopting* it, not against forking it. The fork case fails on different
grounds: **it is a read-only renderer and this is a stateful interactive app.**

Of 11,266 lines, ~8,000 are the marketing site for dinkydash.co. The application is
`app.py` (50 lines), `generate.py` (613), and one 284-line template. `generate.py` runs daily
from cron — YAML + iCal → prompt → Claude → `dashboard_data.json` — and `app.py` renders that
JSON. Grepping the app for `POST`, `methods=`, `sqlite`, `database`, `points`, `reward`,
`allowance`, `balance`, `complete` returns exactly one hit: the string `"the moon and stars"`
in a list of fun-fact themes.

No write paths. No database. No completion. No ledger. Chores are day-of-year modulo over a
YAML list. The Claude call cannot simply be removed either — it *is* the product; what remains
without it is an iCal parse and a countdown. The layout also targets 800×480; the panel here is
1920×1080.

### Why not keep Lovelace

ADR-0001's own Level 1 case for HA has partly dissolved. Its **first and strongest** argument
was interactive Todoist — [dropped 2026-08-23](../PRD.md). Of the rest, the assistant
guardrail is conditional on a milestone now cut, and mmWave presence belongs to a milestone
now cut. What remained was Google Calendar and ChoreOps — and ChoreOps was never installed, so
there is no sunk cost there to protect.

Meanwhile the two hard requirements point away from Lovelace independently:

- **Per-child rendering is an invariant, not polish.** Pictures only (the youngest, 3), icons + short
  words (the middle child, 5), text + points + streaks (the eldest, 7). Three presentations of the same state.
- **The routine runner is the highest-value feature and has to be built regardless of
  substrate.** ROADMAP M4 already predicted it would be "the first consumer of the ADR-0001
  custom-frontend escape hatch."

Building the flagship feature as a custom view over HA, while fighting Lovelace for the other
three, is worse than building one coherent app.

## Decision

**Build the application.** This repo's product is a custom, stateful, touch-first kid-facing
app — its own data model, its own UI, its own chore / reward / routine engine.

**Home Assistant is demoted to a calendar source behind an adapter, and is not the
architecture.** It stays for exactly one reason: its Google Calendar OAuth is finished and in
production (7 `calendar.*` entities, consent screen live, credentials in 1Password
`Google-Calendar-HA`). Throwing that away on day one buys nothing. It sits behind a
`CalendarSource` interface with two implementations — `HomeAssistantCalendar` (v0, works
today) and `GoogleCalendar` (v1, direct API) — and swapping them is a config change. Nothing
else in the app may know HA exists.

### Architecture

| | Choice | Why |
|---|---|---|
| Runtime | One container on the home server, Node 22 + TypeScript | The hard part is a touch frontend with three renderings — that is TS regardless. One language, one build, one container. |
| Store | SQLite (`better-sqlite3`) | Single household, single writer. Backup is copying one file into the server's existing chain. Postgres earns nothing here. |
| Backend | Fastify + REST, SSE for live updates | A kid taps a chore; the parent view updates. One-way server→client is enough. |
| Frontend | React + Vite, served by the same process | SPA on the kiosk. |
| Calendar | `CalendarSource` adapter — HA now, Google direct later | Preserves finished OAuth without cementing HA. |
| Auth | Wall trusted by IP, no login; parents PIN-gated for approvals | Kids tap their own avatar — they are not accounts. Far simpler than HA's model and correct for a wall. |
| Deploy | compose stack under `stacks/`, beside HA | Same pattern as today. |

**Render from local state, always.** Calendars sync *into* SQLite on a schedule; the wall
never blocks on Google, on HA, or on the network. This satisfies "never blank at 6:00 AM"
structurally rather than by fallback, and is strictly stronger than the current arrangement.

### What we harvest, and how

Studying these is the point; copying from two of them is not permitted.

- **DinkyDash (MIT — safe to lift).** The design language: emoji-forward, big type,
  pre-reader-legible. `templates/index.html` is 284 lines and worth reading closely. Take the
  **countdown primitive** ("3 sleeps until Christmas") — an excellent *upcoming* surface for a
  3- and 5-year-old that neither HA nor ChoreOps offers — and the daily-delight idea.
- **ChoreOps (GPL-3.0 — study the model, do not copy code).** The domain model is the asset:
  individual / shared / first-complete / rotation assignment, the claim→approve state machine,
  configurable currency naming, and gamification as a per-child toggle.
- **Donetick (AGPLv3 — study the model, do not copy code).** Subtasks-with-smart-reset as a
  routine primitive, and assignee rotation.

**Licence discipline:** GPL-3.0 and AGPLv3 are viral. Reading them to understand a data model
is fine; pasting their code into this app would bind it to those terms. Only DinkyDash's MIT
code may be copied.

### Money

Nothing in the landscape tracks real allowance. ChoreOps' answer — a currency whose name and
icon are configurable — is the right one: call it dollars, 1 point = $1, and the payout is a
human handing over cash, which it was always going to be. Build the ledger; do not build a bank.

## Consequences

- **PRD §5, ROADMAP M1–M4, and CLAUDE.md all currently describe the superseded architecture**
  and must be re-cut against this. CLAUDE.md's HA gotchas are the highest-risk staleness: they
  will actively mislead until revised.
- **M2 (mmWave presence) and M3 (local assistant) are cut to the icebox.** Neither serves any
  of the four requirements; together they are what turned this into a smart-home project.
- **The routine runner moves to M1.** It is the point, not a phase-4 extra.
- **Work that survives the pivot, unchanged:** the entire Pi kiosk (labwc, `kiosk.service`,
  autologin chain, `setup.sh`, `deploy.sh`) is substrate-agnostic — it points Chromium at a
  URL. The graceful-degradation gate (`kiosk-gate.py`) survives too; only its probe target
  changes from HA's `/api/` to the new app's health endpoint.
- **Work that is discarded:** `stacks/homeassistant/config/wall.yaml`, `www/wall-kiosk.js`,
  and the Calendar Card Pro plan. Small, and always scaffolding.
- **`trusted_networks` becomes unnecessary** — hard-won, and now moot. Its lesson survives as
  a requirement: the wall must authenticate without a human, and the browser profile must stay
  disposable.
- **We own it.** No HACS, no upstream to track, and no one else's release cadence under a
  family-critical display — but also no one else fixing bugs. This is the trade ADR-0001
  declined to make and this decision accepts deliberately.
- **The no-cloud invariant is unaffected** and gets easier: with no HA Assist and no LLM in the
  render path, there is no runtime inference to keep local. [ADR-0002](0002-image-generation.md)
  still governs build-time routine imagery.
