# Build plan — the app, and how a swarm builds it

```yaml
status: active
owner: the operator
last-review: 2026-08-24
implements: ADR-0004
```

> Companion to [ROADMAP.md](ROADMAP.md) M1. The roadmap says *what* ships; this says *how it is
> decomposed*, who may touch which files, and where delegated model spend goes.

## 0. Stack — confirmed 2026-08-24

Node 22 + TypeScript · SQLite (`better-sqlite3`) · Fastify + REST, SSE for push · React + Vite
served by the same process · one container in `stacks/<app>/` on the home server. Closes PRD §8 Q1.

## 1. The principle: contracts first, then fan out

A swarm on a greenfield app fails in exactly two ways: **agents collide on shared files**, and
**they build on a data model that turns out to be wrong.** The second is far more expensive —
re-cutting the schema after eight agents have built on it costs more than the entire design
phase. So:

1. One agent, working alone, writes the contracts.
2. Those contracts get **adversarially reviewed before any implementation** (§3).
3. Only then does the swarm fan out, with **disjoint file ownership** enforced by assignment.

Nothing in Phase 1+ may edit a Phase 0 file. A contract change mid-swarm is a stop-the-world
event: halt, amend, re-brief.

## 2. Phase 0 — the contracts (serial, single agent)

**Written 2026-08-24. Pending H1 review, then frozen.**

| Artifact | Contents | State |
|---|---|---|
| [`db/schema.sql`](../db/schema.sql) | 22 tables, constraints, partial indices. The single source of truth for shape. | applies clean, `integrity_check` ok |
| [`db/verify-schema.py`](../db/verify-schema.py) | Executable proof the schema enforces its promises. Unit A ports these into the Node suite. | 10/10 guarantees hold |
| [`src/types.ts`](../src/types.ts) | Every domain type, plus the wall-snapshot and renderer contracts. | `tsc --strict` clean |
| [`src/calendar/CalendarSource.ts`](../src/calendar/CalendarSource.ts) | The interface only — no implementation. | `tsc --strict` clean |
| [`docs/api.md`](api.md) | Route table: method, path, body, response, error codes. | — |
| [`db/seed.dev.sql`](../db/seed.dev.sql) | Synthetic fixtures — **never real household data** (§3.1). | applies clean, FK clean |

Branded `Utc` / `LocalDate` / `LocalTime` string types make the H3 time discipline a
*compile* error rather than a code-review habit: a `LocalDate` cannot be passed where an
instant is expected, so "step the date by 24h of UTC" does not typecheck.

**Resolved while writing the schema — the open question H2 left.** Shared and
first-complete chores are modelled as *both* layers, not one or the other: `chore_day`
is materialized once per `(chore, local_date)` and carries the uniqueness that makes the
lazy read idempotent, with per-child `chore_assignment` rows beneath it. First-complete
losers take a terminal, non-paying `superseded` state. A rotation's assignee is a pure
function of `(chore, local_date)` fixed at materialization, so refreshing cannot re-roll it.

### Design decisions the swarm must NOT make independently

These are pre-decided because they are the ones a distributed swarm gets subtly inconsistent.
**Amended 2026-08-24 by [H3](design-review/H3-premortem.md), which invalidated three of them.**

- **The ledger is append-only.** Balance is `SUM(delta)` over `ledger_entry`, never a mutable
  `balance` column. Every entry carries `reason`, `ref_type`, `ref_id`.
  **H3 correction:** append-only was specified as a safety property; it is also what makes a
  double-approval *invisible*, since there is no mutable balance to disagree with itself. The
  state transition is therefore the idempotency guard, not the ledger — in one transaction,
  `UPDATE chore_assignment SET state='approved' WHERE id=? AND state='claimed' RETURNING id`,
  and insert the ledger row **only if a row was returned**. Plus `UNIQUE(ref_type, ref_id)` on
  approval entries as a backstop.
- **Points move on approval, never on claim.** The chore state machine is
  `pending → claimed → approved | rejected`, and only the `approved` transition writes a ledger
  entry. Rejection is not a dead end — it returns to `pending`.
- **Routine runs materialize lazily on read, not from a cron job.** A 5:55 AM cron that fails
  leaves a blank wall at 6:00, which is the one failure PRD §4 forbids.
  **H3 correction (found independently by 5/5 panelists):** lazy creation races. Two children tap
  at 06:00, both see no row, both insert, and completions attach to one run while reads return the
  other. Requires `UNIQUE(routine_id, local_date)` and `INSERT ... ON CONFLICT DO NOTHING` inside a
  transaction, then **re-`SELECT` the canonical row** — never proceed on the insert's return value,
  and never swallow the constraint violation.
- **SSE is an invalidation channel, never the source of truth.** The client fetches a full
  authoritative snapshot on SSE `open` **and at every local date boundary**. Added by H3: the
  kiosk runs for months without reloading and nothing emits an event at local midnight, so a
  design without this renders yesterday at 6:00 AM — alive, structurally valid, and wrong.
- **The wall authenticates with a per-device token issued at boot, never by IP address.**
  **H3 correction** to the original "trusted by network address": a DHCP renewal 403s every read
  while the kiosk's screenshot fallback makes the wall *look* fine, and the released address can
  be reassigned to a guest phone, which is then trusted. IP may be an allowlist hint, never the
  authenticator. This repo already learned the sharper half with HA's `trusted_networks` `/32`.
- **All-day events are stored as date-only floating ranges, never UTC instants**, and all
  recurrence is expanded in local-date space. Compute "today" with
  `Intl.DateTimeFormat('en-CA', {timeZone})` on both server and client, never
  `toISOString().slice(0,10)`.
- **Calendar sync writes to a staging generation and promotes atomically.** Never delete the
  currently-rendered rows before their replacement is complete and validated.
- **Long synchronous SQLite work never runs in the Fastify process.** `better-sqlite3` is
  synchronous; a large sync loop blocks the event loop and freezes the wall while the process
  still passes its health checks. Sync and recurrence expansion run in a worker thread.
- **Per-child rendering is presentation, not three data models.** One state, three renderers.
  A second `chore` table per age band is the wrong answer.
- **All timestamps stored UTC, rendered America/Denver.** Day boundaries and all-day events are
  computed in local time. Note the `Family` Google calendar is *itself* set to UTC — a live bug
  tracked in ROADMAP M1, and the adapter must not paper over it.
- **The `CalendarSource` boundary is absolute.** No HA entity id may appear outside
  `src/calendar/homeassistant/`. That is what keeps the Google-direct swap a config change.

## 3. Design hardening on Nous — before any code

Nous credits expire soon, which is a real constraint and it points somewhere specific: **spend
them on work that does not require the code to exist yet.** Post-hoc code review cannot absorb
an expiring budget when there is no code. Design review, approach tournaments, pre-mortems and
test generation all can, and they are worth more per token at this moment than at any later one.

### 3.1 The redaction rule — non-negotiable

PRD §3 and ROADMAP name the three children and their ages. Nous is third-party traffic. Sending
those documents raw fails the **disclosure test** in PRD §4, and neither the model's provider nor
the fact that we are "only discussing design" changes that.

Every prompt sent to Nous uses a **redacted design brief**, built once and reused:

- `Child A (7, reads fluently)` · `Child B (5, emergent reader)` · `Child C (3, pre-reader)`
- No names, no birthdays, no school, no address, no calendar contents, no real event titles.
- Age bands stay, because they *are* the design requirement. Identities are not.

The brief lives in the scratchpad, not the repo, and is regenerated rather than kept in sync.
**Fixtures follow the same rule** — `seed.dev.sql` is synthetic, so any agent, local or remote,
can hold it safely.

### 3.2 The program

Run against the Phase 0 contracts. Tiered so it scales to whatever the balance actually is —
check the Nous portal, since there is no local spend meter.

| # | Work | Bucket | Why this bucket |
|---|---|---|---|
| H1 | **Adversarial contract review**, one agent per lens, run independently: data model · state-machine reachability · time/DST/all-day · 6 AM failure modes · kid-UX at 225 nits | `frontier` | Find-the-bug is the documented frontier case; a cheap model returns one real finding wrapped in confident fabrications and verifying those costs more than it saved |
| H2 | **Approach tournament** on the three genuinely open questions — routine reset & recovery, redemption/allowance model, renderer architecture. N independent proposals per question, then judges, then synthesize from the winner while grafting runners-up | `frontier` proposals, `workhorse` judging | Wide solution space; independent attempts beat one attempt iterated |
| H3 | **Pre-mortem.** "It is 6:00 AM on a school day, six months from now. The wall is blank or wrong. What happened?" Multiple independent runs, deduped | `frontier` | Aimed squarely at the prime invariant; cheap and historically the highest-yield format here |
| H4 | **Edge-case and test generation** from the frozen state machines — chore transitions, ledger arithmetic, routine reset across DST, calendar sync conflicts | `workhorse`/`bulk`, chunked | Generation over a known spec, not enumeration of an unknown codebase |
| H5 | **Post-wave code review**, once code exists | `frontier` | Only reachable after the swarm runs; do not hold budget for it if credits expire first |

**Sizing, honestly:** H1–H3 is on the order of 250k output tokens ≈ **$5** at frontier rates.
That will not absorb a meaningful balance. If there is real credit to burn before expiry, the
ways to actually spend it, in order of value:

1. **Widen H2** — 8 proposals per question instead of 3, 3 judges each. Diversity is the whole
   mechanism; more of it is strictly better here.
2. **Loop H1/H3 until dry** — keep spawning reviewers until two consecutive rounds surface
   nothing new, rather than stopping at a fixed count.
3. **Competing prototypes of the routine runner** — the hardest and least-precedented component.
   Have two or three models build it independently against the frozen contracts, then judge.
   This is the one place where paying for redundant *implementation* is defensible.
4. **Generate the full test suite** (H4) rather than a sample.

### 3.3 Which router — there are three, and they are not interchangeable

Verified 2026-08-24. Picking wrong here either fails the invariant or silently degrades the work.

| Path | Reaches | Use it for |
|---|---|---|
| **`hermesx`** → `inference-api.nousresearch.com` directly (**bypasses LiteLLM**) | All ~361 catalogued models via `-m`, frontier included | **H1–H3.** The only path that reaches frontier. |
| **LiteLLM** `:4000` (container, tailnet + loopback) | 14 fixed deployments — tiers `bulk`, `deep`, `code`, `aux`, `vision` plus handles `kimi-k3{,-free}`, `kimi-k2.7-code`, `bulk-paid`, `vision-{30b,paid}`, `local-{8b,coder,fast}` | H4 bulk generation, on synthetic input only. |
| **`ollama run`** → local Ollama | 4 local models | Anything private. Zero marginal cost, never leaves the box. |

```bash
hermesx chat -m anthropic/claude-opus-5 -q "..." --yolo      # frontier, billed to Nous credits
hermesx chat -m qwen/qwen3.7-plus -q "..." --yolo            # workhorse, ~$1/Mtok, 1M ctx
curl -s http://localhost:4000/v1/models \
  -H "Authorization: Bearer $(op read 'op://<vault>/<item>/<field>')"   # what LiteLLM serves
```

> **Stale as of 2026-09-10 — the routing conclusion below still holds, but not for the
> reasons given.** Three of its premises have changed. (1) Nous retired the entire Hermes 4
> family, so `hermes-70b`/`hermes-405b` no longer exist anywhere. (2) LiteLLM's strongest
> tier is now `deep` = Moonshot kimi-k3 at 1M context, which is a genuine reasoning model,
> not "very cheap and correspondingly limited". (3) LiteLLM now requires a key on every
> `/v1/*` call. The `hermesx`-for-frontier choice survives all three — LiteLLM still has no
> `anthropic/*` deployment — but re-derive H1–H3 against current tiers before relying on the
> cost/quality argument. Note also that the Nous balance is $0 as of the same date, so the
> `hermesx` path in this table is itself unfunded until someone tops it up.

**LiteLLM cannot run the hardening program.** It has no `anthropic/*` or `openai/*` deployment
at all; its strongest reasoning tier is `hermes-405b`, which the routing skill documents as
"very cheap and correspondingly limited" — and its measured finding is that cheap models on
find-the-bug return one real finding wrapped in confident fabrications, where verifying the
fabrications costs more than the model saved. Adversarial review is precisely the wrong job for
that tier.

**The LiteLLM fallback chains cross trust boundaries**, which is why this repo already forbids
pointing a conversation agent at a tier. Confirmed in `stacks/litellm/config.yaml`:
`aux → local-8b → bulk`, and `bulk → NVIDIA first`. So the tier documented as "local-only
quality is fine" can land on a hosted provider two hops down, with nothing in the call site
saying so. Request a **deployment name** (`local-8b`), never a tier, if LiteLLM is used at all.

**`hermesx` degrades silently when credits run out.** Its configured fallback is
`hermes3:8b-64k` on local Ollama. That is safe for disclosure and catastrophic for quality — an
exhausted balance turns a frontier design review into an 8B one without an error. **Check which
model actually served before believing any deliverable**, especially as expiry approaches.

### 3.3.1 Verification

- **Harness before model.** `~/.hermes/config.yaml` is `131072 × 0.85 ≈ 111k` usable. If a run
  log shows `Compacting context`, the deliverable is degraded — kill it, fix the budget, re-run.
  Never let a delegated agent read a large file whole; instruct `sed -n 'A,Bp'` ranges.
- **Verify before acting.** Every `path:line` claim gets checked against the file; every named
  flag or symbol against the real source. Mark findings CONFIRMED / REFUTED / UNVERIFIABLE and
  act only on CONFIRMED. This applies to frontier models too.
- **Never delegate enumeration, delegate judgement.** Ground truth comes from the schema, the
  route table, `--help`. Model tokens go to per-item reasoning over a known list.

### 3.4 What Nous does not get

- **No runtime path, ever.** Nothing the wall renders may depend on an inference call. PRD §4.
- **No implementation of the app's multi-file structure.** The Hermes harness is weak at
  multi-file editing for the context reasons above; the build swarm is Claude Code agents in a
  session, which have the file tools and no compaction cliff. Nous is the adversary and the
  critic, not the author. (Exception: §3.2 item 3, isolated single-component prototypes.)
- **No secrets, no 1Password material, no HA tokens.**

## 4. The swarm — work units and file ownership

Each unit owns its paths exclusively. **No agent edits a path it does not own.** Cross-unit needs
go through Phase 0 contracts, never by reaching into a sibling's files.

| Unit | Owns | Depends on | Done when |
|---|---|---|---|
| **A · persistence** | `db/`, `src/db/` | Phase 0 | Migrations run on an empty volume; repository functions round-trip every type |
| **B · calendar adapter** | `src/calendar/` | Phase 0, **A** | HA impl syncs 7 entities into local tables; contract tests pass against a recorded fixture, no live HA |
| **C · chores** | `src/domain/chores/` | A | State machine is total — every transition tested, including reject→pending and expiry |
| **D · ledger** | `src/domain/ledger/` | A | Balance equals sum-of-entries after approve, redeem, and manual adjustment; no path mutates a balance |
| **E · routines** | `src/domain/routines/` | A | Lazy daily materialization verified across a DST boundary; a partially-completed run resumes correctly |
| **F · http + sse** | `src/http/` | C, D, E | Every route in `docs/api.md` implemented; SSE pushes a chore claim to a second client |
| **G · design system** | `web/src/design/` | Phase 0 | Tokens, type scale, tap targets ≥64px, nothing below 14px; harvested from DinkyDash's MIT template |
| **H · renderers** | `web/src/views/` | G, Phase 0 types | Same state renders three ways; each verified against its age band's constraints |
| **I · kiosk integration** | `pi/`, `stacks/<app>/` | F | `DASHBOARD_URL` repointed; `kiosk-gate.py` probes the app's health endpoint; stop the stack → last-known-good, not a browser error |
| **J · e2e** | `test/e2e/` | F, H | The §6 acceptance walk passes headless |

**Wave schedule** — barriers only where a real dependency exists:

- **Wave 1** (parallel): A · B · G
- **Wave 2** (parallel, on A): C · D · E
- **Wave 3** (parallel): F (on C/D/E) · H (on G)
- **Wave 4**: I · J

G starts immediately alongside A because it touches no data at all. **B was originally listed
as independent of A; that turned out to be false** — `src/calendar/sync.ts` needs A's
`inTransaction` and `resolveAsset`, because staging a generation is a transaction and every
event's icon must be resolved through the fallback chain at sync time. Corrected 2026-08-24
when the unit was built.

## 5. Acceptance — the walk that means it works

Lifted from PRD §7, in order. This is what J automates and what a human repeats on the panel:

1. Cut the server's WAN. Today's schedule, chores and routines still render from local state.
2. Child A taps a chore. It enters the approval queue. Her balance does **not** move.
3. A parent approves with the PIN. The balance moves by exactly the chore's value, once.
4. Child C advances a picture-led routine to completion with no adult help and no text on screen.
5. Wipe the Chromium profile and restart. The wall is usable with zero input — and still cannot
   approve anything.
6. `docker compose stop` the app. The wall shows last-known-good with a clock, not a browser
   error. `start` → live again, no human input.

## 6. Guardrails

- **Contracts are frozen after H1–H3 land.** Changing one mid-swarm halts the swarm.
- **No agent commits to `main`.** One branch per unit; integration is a deliberate act.
- **Fixtures are synthetic.** No real names, events, or schedules in the repo or in any prompt.
- **Every delegated finding is verified before it changes code** (§3.3).
- **The wall keeps working throughout.** HA and the existing Lovelace dashboard stay running
  until unit I cuts over. There is no window where the family has no display.
