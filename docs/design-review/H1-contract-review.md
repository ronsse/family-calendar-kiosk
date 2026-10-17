# H1 — Adversarial contract review

```yaml
date: 2026-08-24
program: build-plan.md §3.2 H1
lenses: data model (openai/gpt-5.5) · state machines (anthropic/claude-opus-4.8) · time & DST (google/gemini-3.1-pro-preview) · 6:00 AM operations (sakana/fugu-ultra) · the children (anthropic/claude-sonnet-5)
input: the real committed Phase 0 contracts, unredacted — they contain no household data by design
status: 16 findings fixed and locked; all five lenses in; contracts ready to freeze
```

## Method

Five lenses, one model each, run independently against the **actual committed files** rather
than a brief. Every prompt listed the eight already-fixed H3/H2 findings explicitly, so credit
accrued only for something new.

**Every claim was verified against the file before it changed anything.** That is the standing
rule for delegated output, and it earned its keep in both directions: all 16 claims
reproduced exactly as described, and one of *my own* independent findings was refuted by the
same test.

## What was confirmed and fixed

### Blank-wall class

**1. The `calendar_event` CHECK only constrained the START columns.** Found independently by
two lenses. A timed event with a NULL `ends_at_utc`, an all-day event with a NULL end date, and
a reversed interval were all accepted — and none can be represented by `EventWhen` in
`types.ts`, so the snapshot mapper would throw while building the wall's *only* read. On a cold
start with no last-good snapshot, that is a blank wall. Replaced with the full discriminated
union including both end columns and an ordering check.

**2. The asset fallback chain did not actually terminate anywhere renderable.**
`REFERENCES asset(id)` proves the row exists, not that its file was ever validated, and nothing
guaranteed the `_default` row existed at all — it lived only in the dev seed. A fallback
pointing at an unvalidated asset resolves to an empty URL, which for the pre-reader is a blank
screen: precisely the failure the chain was introduced to prevent. Now four triggers: fallbacks
must reference a validated asset on insert and on update, `_default` cannot be deleted, and an
asset a fallback depends on cannot be un-validated.

**3. `/api/health` proved the wrong thing.** A "trivial write" succeeds on a 95%-full disk while
the real 06:00 materialization — a `routine_run`, its step snapshots, a `chore_day` and its
assignments — hits `SQLITE_FULL`. The probe reports green and the kiosk gate keeps a doomed tab
up. Health must now exercise a write of the same allocation class as first-materialization, so
liveness means "today's snapshot can be produced", not "the process is listening".

**4. Client/server clock skew at local midnight.** The client refetches at *its* date boundary;
the server computed "today" from *its own* clock. One second of skew and the server returns
yesterday — and since nothing else fires until the next boundary, the wall stays a day behind
through 6:00 AM. `localDate` is now a required parameter: the client asserts its view of today,
the response echoes it, and a mismatch triggers a refetch rather than a render.

### Wrong-data class

**5. A calendar source could promote another source's generation, or a half-staged one.** The
single-column FK tied `current_sync_run_id` to nothing but `sync_run(id)`. One child's calendar
could be promoted as the household's. Now a composite FK on `(source_id, id)` plus a trigger
requiring `state = 'promoted'`.

**6. A step from one routine could be assigned to another.** Found independently by **three**
lenses. Two independent FKs meant `('rt-morning', 'st-pj')` was accepted even though `st-pj`
belongs to bedtime — so the pre-reader's 06:00 routine could open with "put on pyjamas", with an
authoritative icon and no text she could read to contradict it. Now a composite FK through
`routine_step(routine_id, id)`.

**7. Duplicate events within one generation.** A retried fetch page staged the same
`external_uid` twice and the wall rendered soccer practice twice, with no schema-level way to
tell a duplicate from two real events. Now `UNIQUE(sync_run_id, external_uid)`.

**8. `chore_assignment.state = 'rejected'` had no producer and contradicted the API.** The
schema and `ChoreState` both offered `rejected`, while `api.md` documented reject → `pending`.
Two parallel agents would have implemented two different machines, and the `→ rejected` branch
had no transition back — the card would sit un-redoable for the rest of the day. This is exactly
the class of ambiguity Phase 0 exists to eliminate before fan-out. `rejected` is removed from the
schema and the type; rejection returns the chore to `pending`.

**9. `redemption_request.cancelled` had no producer, and the child could lock themselves out.**
The balance is only checked at approval, so a mis-tapped request for more points than they hold
is accepted, occupies the one-pending slot, and cannot be cleared by the child — contradicting
the same "a mis-tap must be recoverable by the child" principle that put step-revoke on the wall
surface. Added `POST /wall/v1/redemptions/:id/cancel`, plus an up-front balance check so the slot
is never taken by an impossible ask.

**10. A manual ledger adjustment had no natural idempotency key.** For approvals `ref_id` is the
assignment or request id, so the UNIQUE de-dupes retries for free. For `('manual','adjustment')`
the route body carried nothing, and both obvious implementations are wrong: a constant makes the
*second* bonus a constraint violation that silently drops points, while a fresh id per call lets
a double-tap pay twice. `requestId` is now mandatory on the route and stored verbatim.

### The one that would have made every other fix decorative

**11. `PRAGMA foreign_keys = ON` is per-connection and is NOT persisted by running the schema
file.** Every foreign key in the contract — including the composite ones added above — is
silently unenforced unless the application sets the pragma on each connection it opens. Now
carries a warning at the top of the schema and an assertion in the verifier.

### Lens 5 — the children

Landed last and found two more, both confirmed.

**12. Every wall mutation trusted a client-supplied `childId` with no ownership check.** The
body's `childId` is the *selected* child; the URL's id identifies a row that already carries its
own `child_id`. Three children's cards sit on one panel at child height with adjacent 64px
targets, so a tap a centimetre off lands on a sibling's card while the body still names the
selected child. Nothing in the contract required the two to agree. Once a parent approves the
result it is a permanent append-only ledger fact — a chore paid to the wrong child, and a
confidently-wrong entry in her history. Every transition now carries `AND child_id = :childId`,
and a mismatch is `403 wrong_child` handled as a **silent no-op**, because a visible error reads
to a child as "the button is broken" rather than "that is not your card".

**13. `balances` vanished for any child with no ledger history — which is every child on day
one.** `SUM(delta) ... GROUP BY child_id` over `ledger_entry` returns *zero rows*, not a zero
value, for a child before their first approval. Verified: on the seeded database the naive
aggregate returns `[]`. A renderer calling `balances.find(...)` gets `undefined` and either
crashes a kiosk that does not reload for months, or renders an empty badge a five-year-old
cannot distinguish from zero. `balances` is now contracted to contain exactly one entry per
active child, built as a `LEFT JOIN` from `child`. This is the failure most likely to have
shipped: it is guaranteed on the first morning, which is precisely when nobody is watching for
it.

Its third finding — that no contract covers a full kiosk process restart, only an already-open
page — is real but is Unit I's territory rather than a Phase 0 change, and is left to that unit.

## Rejected on verification

**My own finding, refuted by my own test.** I flagged that `ledger_entry.ref_id` is TEXT while
`chore_assignment.id` is INTEGER, and predicted the double-pay guard would silently stop matching
when one path wrote `5` and another `'5'`. It does not: STRICT coerces the integer to TEXT and the
UNIQUE catches the duplicate exactly as intended. Recorded because the verification discipline is
only credible if it is applied symmetrically.

## Regressions

All sixteen findings are now permanent assertions in
[`db/verify-schema.py`](../../db/verify-schema.py), each having been confirmed as *accepted* by
the pre-fix schema before being fixed. 22/22 pass. The suite also asserts the `foreign_keys`
pragma, since without it the rest is decoration.

```bash
python3 db/verify-schema.py
```


## Outstanding
- **Retention is unresolved.** Nothing prunes superseded `sync_run` generations. `calendar_event`
  cascades on delete, but no code path deletes, so every sync appends a full generation forever
  on a disk whose filling is finding #3's failure mode. This needs an owner in Unit B, not a
  schema change.
