# H3 — Pre-mortem findings

```yaml
date: 2026-08-24
program: build-plan.md §3.2 H3
panel: openai/gpt-5.5 · x-ai/grok-build-0.1 · moonshotai/kimi-k2.5 · deepseek/deepseek-v4-pro · mistralai/mistral-medium-3-5
input: redacted design brief (build-plan.md §3.1) — no names, no real schedule content
status: findings triaged; contract changes pending Phase 0
```

> Prompt: *"It is 6:00 AM on a school day, six months after launch. The wall is blank, frozen,
> or showing something wrong. Work backwards."* Five independent panelists, no shared context.
> Ranked below by **cross-panel convergence** — how many panelists found it independently.
> Convergence is the signal; a finding only one model saw is a hypothesis, not a result.

## The headline: three pre-committed decisions were wrong

The point of running this *before* writing contracts was to catch decisions already baked into
[build-plan.md §2](../build-plan.md). It caught three.

### 1. Lazy routine materialization races — **5/5 panelists**

The decision to materialize routine runs lazily on read (instead of from cron) is **correct** and
survives — but it was specified without a uniqueness constraint, and every panelist independently
found the same race.

Two children tap at 06:00. Both `SELECT ... WHERE routine_id=? AND date=?`, both see zero rows,
both `INSERT`. Now there are two runs for one day. Step completions attach to run A; the next read
returns run B. The wall shows an untouched routine that a child just finished — the most
demoralising possible failure for a 3-year-old, and it happens *only* at first-use each morning.

Worse, the naive guard makes it silent: if the second `INSERT` throws a constraint violation that
gets caught and ignored, the caller proceeds with no run id and renders an empty routine.

**Contract change:** `UNIQUE(routine_id, local_date)`, materialize with
`INSERT ... ON CONFLICT DO NOTHING` inside a transaction, then **re-`SELECT` the canonical row**.
Never proceed on the insert's return value.

### 2. The append-only ledger is what makes double-approval invisible — **3/5**

I specified append-only as a *safety* property. The panel points out it is precisely what hides
the most likely corruption: an adult double-taps "approve" (or the browser retries a slow
request), two `ledger_entry` rows are appended, and the child's balance is silently doubled.
Because balance is `SUM(delta)` there is no mutable value to disagree with itself — nothing to
reconcile against, and no error. It surfaces weeks later as "why does she have $40?".

Append-only stays. It needs the transition to be the guard, not the ledger.

**Contract change:** in one transaction,
`UPDATE chore_assignment SET state='approved' WHERE id=? AND state='claimed' RETURNING id` —
insert the ledger row **only if a row was returned**. Plus `UNIQUE(ref_type, ref_id)` on approval
entries as a backstop.

### 3. Trusting the wall by network address is wrong — **3/5**

Specified in [PRD §4](../PRD.md) and carried into the build plan. The panel rejects it on two
grounds, and the second is a security finding rather than an availability one:

- The router renews leases overnight, the Pi's address changes, and every read 403s. The kiosk
  falls back to the last-known-good screenshot, so the wall *looks* fine while being frozen —
  and there is no server log, because the request never reaches a handler.
- The old address gets reassigned to **a guest phone, which is now trusted.**

This repo already learned the sharper half of this lesson with HA's `trusted_networks`, where a
LAN-range rule would have auto-logged-in guest devices and the fix was a single `/32`. I carried
the weaker version forward into the new design.

**Contract change:** issue the kiosk a per-device token at boot (or mTLS). IP may be an allowlist
hint; it may not be the authenticator.

## Convergent findings that were simply missing

### 4. The SPA never rolls over at local midnight — **2/5, and the closest to the literal failure**

Only two panelists found it, but both ranked it **#1**, and it describes the exact scenario in the
prompt. The kiosk is designed never to reload. SSE carries mutations only. Nothing emits an event
at local midnight. So the React app boots on Monday evening holding `today = Monday`, and at
06:00 Tuesday it is still rendering Monday's routine and chores — alive, structurally valid,
throwing no error, and completely wrong.

Nothing in the design addressed this at all.

**Contract change:** the client fetches a **full authoritative snapshot** on SSE `open` and at
every local date boundary. **SSE is an invalidation channel, never the source of truth.** This
also fixes the reconnect-desync case (#7) for free.

### 5. All-day events land on the wrong local day — **3/5**

The known-misconfigured UTC calendar emits all-day events as UTC midnight→midnight. Stored as
instants, `2026-02-10T00:00:00Z` renders as `2026-02-09 17:00` in Denver, so the event bucket
spans two local days. It is already visible on the current wall.

**Contract change:** store all-day events as **date-only floating `LocalDate` ranges**, never
UTC instants. Drop the time component at ingest. All three panelists converged on this exact fix.

### 6. Recurrence stepped by 24h UTC breaks at DST — **3/5**

Adding `24*60*60*1000` per day works until Denver's local midnight shifts by an hour, at which
point a school-day chore is skipped, duplicated, or assigned to the adjacent day. Twice a year,
silent, months after launch.

**Contract change:** expand all recurrence in **local-date space**, convert to instants only at
the render edge. Compute every "today" via `Intl.DateTimeFormat('en-CA', {timeZone})` on **both**
server and client, never `toISOString().slice(0,10)`.

### 7. Sync deletes live rows, then fails — **2/5**

`DELETE FROM calendar_event WHERE source_id=?` followed by inserts, and Google 429s halfway. The
table is now empty or partial. Rendering has no cloud dependency, so it faithfully displays the
poisoned local state as "no events today" — never an error.

**Contract change:** sync into a staging generation keyed by `sync_run_id`, validate, then
atomically promote. Never delete the currently-rendered generation until its replacement is
complete.

### 8. `better-sqlite3` is synchronous and will block the wall — **1/5, but stack-specific and correct**

Only gpt-5.5 raised it, and it is the sharpest finding about the chosen stack. `better-sqlite3` is
synchronous by design. A 05:58 sync doing thousands of writes in one loop inside the Fastify
process means the event loop cannot answer `/api/today` or SSE heartbeats at 06:00. The process
is not crashed — it is busy — so every health check outside the window passes.

**Contract change:** sync and recurrence expansion run in a **worker thread or separate process**
with their own connection. The Fastify process never runs long synchronous SQLite loops.

### 9. Stale bundle vs. new API after months of uptime — **2/5**

The kiosk holds one JS bundle in memory for weeks. Deploy a renamed field, the backend restarts,
SSE reconnects, the old client parses new-shape JSON and throws inside a render. Blank.

**Contract change:** version the wall API (`/api/wall/v1`) and keep it backward-compatible, plus a
`minClientBuild` in the heartbeat that forces a hard reload before parsing. A nightly 03:00
reload was also proposed and is worth taking — it independently mitigates browser drift.

### 10. Silent sync staleness — **2/5**

A failed sync leaves yesterday's data, which looks exactly like today's data. No panelist found a
mechanism in the design that would ever tell anyone.

**Contract change:** record `synced_at` per source; the wall renders a visible staleness
indicator past a threshold. Stale-but-labelled satisfies the invariant; stale-and-confident does
not.

## Rejected / low confidence

Recorded so they are not re-derived. These did **not** survive review:

- **"WebGL texture leaks from icon rendering"** (kimi) — speculative; nothing here is
  WebGL-heavy. The underlying point (long-uptime browser degradation, scheduled reload) is sound
  and is folded into #9.
- **"WAL corruption on power blip also loses the routine *definition* row"** (mistral) — the
  causal chain is wrong; a rollback cannot remove a long-committed definition. `PRAGMA
  integrity_check` on startup is cheap and worth doing anyway.
- **NTP clock skew on the Pi** (mistral) — the Pi runs NTP; low priority. But its proposed fix —
  *never trust the client's clock for date boundaries* — is right and is already covered by #4/#6.

## Status

`anthropic/claude-opus-5` was still generating when this was written; its findings will be folded
in and convergence counts updated. Nothing above depends on it.

**Next:** these changes go into Phase 0 contracts before H1 reviews them. Items 1, 2 and 3 amend
[build-plan.md §2](../build-plan.md) directly; item 3 also amends [PRD §4](../PRD.md).
