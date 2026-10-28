# API contract — Phase 0

```yaml
status: frozen (amended 2026-08-24 — see Amendments)
version: 1
implements: ADR-0004, build-plan.md §2
```

> FROZEN 2026-08-24. A change here is a stop-the-world event for the swarm.
> Types referenced below are the exported names in [`src/types.ts`](../src/types.ts); this
> document is the route surface, not a second copy of the shapes.

## Principles the routes encode

- **`/snapshot` is the only read the wall needs.** It returns everything for a full render.
  There is no partial-state endpoint the client must stitch together, because a client that
  stitches can hold a half-stale view.
- **SSE carries no state.** `/stream` emits `invalidate` and `heartbeat` only. The client
  refetches the snapshot on `open`, on any `invalidate`, and at every local date boundary.
  SSE is never the source of truth (H3 finding #4).
- **Two surfaces, two auth models.** `/api/wall/*` is the panel: device-token, no human login,
  and it can never approve anything. `/api/admin/*` requires a PIN per request.
- **Versioned path.** `/api/wall/v1/…`. The kiosk holds one JS bundle for months; every
  response carries `minClientBuild` so an obsolete bundle hard-reloads before it parses a
  shape it does not understand (H3 finding #9).

## Auth

| Surface | Credential | Notes |
|---|---|---|
| `/api/wall/*` | `Authorization: Device <token>` | Issued once at kiosk provisioning, stored on the Pi, hashed at rest. **Never an IP allowlist** — PRD §4, H3 finding #3. |
| `/api/admin/*` | Device token **plus** `X-Parent-Pin` | PIN verified per request; never a session. Children and guests touch this screen. |
| `/api/health` | none | Loopback + tailnet only; consumed by `kiosk-gate.py`. |

`403 device_revoked` and `401 bad_pin` are distinct so the wall can render "ask a grown-up"
rather than a generic failure.

## Routes

### Health

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/health` | `{ ok: true, dbWritable: boolean, generatedAtUtc }` |

`dbWritable` must exercise a write of the **same allocation class as first-materialization
of the day** — insert and roll back a routine_run-sized transaction, not a one-row touch. On a
95%-full disk a trivial write still succeeds while the real 06:00 materialization hits
`SQLITE_FULL`, so a trivial probe reports green and the gate keeps a doomed tab up (H1 lens 4).
Liveness must mean "today's snapshot can be produced", not "the process is listening".
`kiosk-gate.py` probes this path, **not** `/`.

### Wall (device token)

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/api/wall/v1/snapshot?localDate=YYYY-MM-DD` | — | `WallSnapshot` |
| `GET` | `/api/wall/v1/stream` | — | SSE of `WallEvent` |
| `GET` | `/api/wall/v1/redemptions?state=pending` | — | `RedemptionRequest[]` |
| `GET` | `/api/wall/v1/scenes` | — | `{ activeSceneId, scenes: SceneCatalogEntry[] }` |
| `POST` | `/api/wall/v1/chores/:assignmentId/claim` | `{ childId }` | `{ state: ChoreState }` |
| `POST` | `/api/wall/v1/routines/steps/:runStepId/complete` | `{ childId }` | `{ completedAtUtc }` |
| `POST` | `/api/wall/v1/routines/steps/:runStepId/revoke` | `{ childId }` | `{ revokedAtUtc }` |
| `POST` | `/api/wall/v1/redemptions` | `{ childId, pointsRequested }` | `RedemptionRequest` |
| `POST` | `/api/wall/v1/redemptions/:id/cancel` | `{ childId }` | `{ state: 'cancelled' }` |
| `POST` | `/api/wall/v1/telemetry/door` | `{ target, scene }` | `204` |
| `POST` | `/api/wall/v1/dog/deeds/:deedId` | `{ week, done }` | `{ ok, changed }` |

**`localDate` is REQUIRED and is the client's own view of today.** The server must not
compute "today" from its own clock: with a second of skew at local midnight the server
answers with yesterday, and because nothing refires until the next boundary the wall stays a
day behind through 6:00 AM (H1 lens 3). The response echoes `requestedLocalDate`, and a
mismatch against `freshness.snapshotLocalDate` means the client refetches rather than renders.

**`GET /snapshot` takes no `child` parameter.** It returns every child's state, and the client
selects. Selection is in-memory only, decaying to ambient after 90s idle — a persisted or
server-held selection is what leaves the wrong child's view up all night (H3 finding, H2 Q3).

**`/routines/steps/:id/revoke` is deliberately on the wall surface, not admin.** A 3-year-old
mis-tapping on a capacitive panel is certain; PIN-gating the undo would brick the routine until
an adult intervened, which H2 Q1 flagged as a fatal flaw.

**A child may cancel their own redemption request.** `ux_one_pending_redemption` permits one
open request per child, and the balance is only re-checked at approval — so a mis-tapped
request for more points than they hold would otherwise occupy the slot until an adult noticed,
with no way for the child to clear it (H1 lens 2). Cancel is on the wall surface for the same
reason step-revoke is: a mis-tap must be recoverable by the child. The request route also
rejects `pointsRequested` above the current balance up front, so the slot is never taken by an
impossible ask.

**Every wall mutation MUST verify row ownership.** The body's `childId` is the *selected*
child; the URL's id identifies a row that already carries its own `child_id`. The two can
disagree — cards for three children sit on one panel at child height with adjacent 64px
targets, so a tap 1cm off lands on a sibling's card while the body still says the selected
child. Without an ownership predicate the transition applies to the wrong sibling's row, and
once a parent approves it that is a permanent append-only ledger fact: a chore paid to a child
who did not do it, and "Child B fed the pet" as a confidently-wrong entry in her history
(H1 lens 5). Every transition therefore carries `AND child_id = :childId`:

```sql
UPDATE chore_assignment SET state='claimed', claimed_at_utc=:now
 WHERE id=:assignmentId AND child_id=:childId AND state='pending' RETURNING id;
```

and routine step transitions gate equivalently on `routine_run_step.child_id`. A mismatch is
`403 wrong_child` and **must be a silent no-op** — never a fallthrough to `not_claimable`,
which would read to a child as "the button is broken" rather than "that is not your card".

**`claim` never moves points.** It is a request. For a `first_complete` chore the claim is an
atomic race: the winner goes `claimed`, the losers go `superseded` in the same transaction, and
losers receive `409 already_claimed`.

### Admin (device token + PIN)

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/api/admin/v1/chores/:assignmentId/approve` | — | `{ state, ledgerEntryId \| null }` |
| `POST` | `/api/admin/v1/chores/:assignmentId/reject` | — | `{ state: 'pending' }` |
| `POST` | `/api/admin/v1/redemptions/:id/approve` | — | `{ state, ledgerEntryId }` |
| `POST` | `/api/admin/v1/redemptions/:id/reject` | — | `{ state: 'rejected' }` |
| `POST` | `/api/admin/v1/ledger/adjust` | `{ childId, delta, note, requestId }` | `LedgerEntry` |
| `GET` | `/api/admin/v1/children/:id/ledger` | — | `{ childId, entries: (LedgerEntry & { runningTotal })[], total }`, oldest first |
| `POST` | `/api/admin/v1/calendar/refresh` | — | `RefreshOutcome` |
| `GET` | `/api/admin/v1/settings` | — | `HouseholdSettings` |
| `POST` | `/api/admin/v1/settings/cents-per-point` | `{ centsPerPoint }` | `HouseholdSettings` |
| `POST` | `/api/admin/v1/settings/chores/:choreId` | `{ basePoints }` | `HouseholdSettings` |
| `POST` | `/api/admin/v1/settings/departures` | `{ enabled?, readyMinutes?, travelMinutes?, schoolLeaveAt? }` | `HouseholdSettings` |
| `POST` | `/api/admin/v1/settings/theme` | `{ theme: 'felt' \| 'gallery' \| 'storybook' }` | `HouseholdSettings` |
| `POST` | `/api/admin/v1/settings/pin` | `{ newPin }` (header: the CURRENT PIN) | `HouseholdSettings` |
| `GET` | `/api/admin/v1/routines` | — | `RoutineCatalog` |
| `POST` | `/api/admin/v1/routines/:routineId/steps/:stepId/assign` | `{ childId, assigned }` | `RoutineCatalog` |
| `POST` | `/api/admin/v1/routines/:routineId/steps/:stepId/move` | `{ childId, direction: 'up' \| 'down' }` | `RoutineCatalog` |
| `GET` | `/api/admin/v1/chores` | — | `ChoreCatalog` |
| `POST` | `/api/admin/v1/chores/:choreId/roster` | `{ childId, member }` | `ChoreCatalog` |
| `POST` | `/api/admin/v1/chores/:choreId/roster/move` | `{ childId, direction: 'up' \| 'down' }` | `ChoreCatalog` |
| `POST` | `/api/admin/v1/chores/:choreId/model` | `{ assignmentModel }` | `ChoreCatalog` |
| `POST` | `/api/admin/v1/chores` | `{ labelFull, iconAssetId, kind, basePoints, assignmentModel, rrule, dueByLocal?, roster }` | `ChoreCatalog` |
| `POST` | `/api/admin/v1/chores/:choreId/edit` | `{ labelFull?, iconAssetId?, rrule? }` | `ChoreCatalog` |
| `POST` | `/api/admin/v1/chores/:choreId/retire` | — | `ChoreCatalog` |
| `POST` | `/api/admin/v1/chores/:choreId/restore` | — | `ChoreCatalog` |

**`WallSnapshot.balances` contains exactly one entry per active child**, always. It must be
built as a `LEFT JOIN` from `child`, never as a bare aggregate over `ledger_entry`:

```sql
SELECT c.id, COALESCE(SUM(l.delta), 0) AS points
  FROM child c LEFT JOIN ledger_entry l ON l.child_id = c.id
 WHERE c.active = 1 GROUP BY c.id;
```

A grouped aggregate returns **zero rows** for a child with no ledger history — which is every
child on day one, and any newly added sibling before their first approval. A renderer doing
`balances.find(...)` would get `undefined` and either crash the kiosk (which does not reload for
months) or render an empty badge that a 5-year-old cannot distinguish from zero (H1 lens 5).

**`WallSnapshot.streaks` follows the same rule** — one entry per active child, always,
including the pre-reader who has no ledger. Amended 2026-08-29; `apiVersion` is unchanged
because an older client that has never heard of the field ignores it, and a newer client
reading an older snapshot gets `undefined` and draws no streak line.

`days` is the **display** value, not the raw count: `null` below three qualifying days, so
the three band renderers cannot disagree about when a streak is worth drawing. The server
computes it against `requestedLocalDate` — the date the CLIENT asserted — like everything
else in the snapshot. The rules and their reasoning are in
[ADR-0005](decisions/0005-streaks.md); the two that constrain any reimplementation are that
a streak counts `claimed` as done (it must never depend on a parent's approval tap) and that
an unfinished **today** never breaks it.

**Approval is idempotent by construction.** In one transaction:

```sql
UPDATE chore_assignment SET state='approved', decided_at_utc=?
 WHERE id=? AND state='claimed' RETURNING id;
```

and the `ledger_entry` row is written **only if a row was returned**. A double tap or a browser
retry therefore cannot double-pay; the second call returns `200` with the already-decided state,
not a second entry (H3 finding #2). `UNIQUE(child_id, ref_type, ref_id, reason)` is the
structural backstop, not the primary guard.

**`ledgerEntryId` is `null` when the child has `ledgerEnabled = false`.** The pre-reader's chores
run the full state machine and pay nothing; the wall renders a stamp sourced from
`chore_assignment.state`, never from ledger data.

**Redemption approval** re-checks the balance inside the same transaction before inserting the
negative entry, so two concurrent approvals cannot overdraw. There is **no `paid` transition** —
see [`H2-tournament.md`](design-review/H2-tournament.md) for why, and for the cost.

**`requestId` on `/ledger/adjust` is mandatory and is the idempotency key.** For approvals
`ref_id` is a natural key (the assignment or request id), so `UNIQUE(child_id, ref_type,
ref_id, reason)` de-dupes retries for free. A manual adjustment has no natural key, and both
obvious choices are wrong: a constant makes the *second* bonus a constraint violation that
silently drops points, while a fresh id per call lets a double-tap pay twice (H1 lens 2). The
client generates one uuid per user action and it is stored verbatim as `ledger_entry.ref_id`.

**`/children/:id/ledger`** returns every entry with a running total (`SUM(delta) OVER (ORDER BY
id)`), each row deep-linking to its originating chore or redemption. This is what settles
"I had forty!" — by scrolling the entries, never by trusting a cached number.

**The two settings routes are the exchange rate of the whole economy**, which is why they are
on the admin surface even though nothing they return is secret — the numbers are printed on the
children's own screens. A child who could raise her own chore from 2 points to 99 has been
handed the ledger, and guardrails are architectural: this is a route her screen cannot call,
not a control it politely does not draw.

`GET /settings` therefore costs a PIN entry to READ, which is the opposite of the trade the
scene catalog makes (its list is on the *wall* surface so that choosing a picture does not cost
two PIN entries for a list of ids). The difference is that nobody opens this screen to look.

```ts
interface HouseholdSettings {
  centsPerPoint: number;            // 0 when unset or unreadable — see below
  chores: {
    choreId: string;
    labelFull: string;
    kind: 'duty' | 'extra';
    basePoints: number;
    active: boolean;                // an inactive chore is never materialized
  }[];
}
```

**Neither change is retroactive, and that is structural rather than promised.**

- `cents_per_point` is snapshotted onto `redemption_request.cents_per_point` when a child
  **asks**, so changing the rate cannot change what a pending request pays: she is paid what she
  was shown. It *does* change every child's displayed balance at once, because a balance is
  points times today's rate — hence `invalidate('ledger')`.
- `chore.base_points` is snapshotted onto `chore_day.points_each` at **materialization**, so an
  edit cannot change what today's chores pay however the day has gone. It lands on the next day
  materialized, and this route deliberately invalidates **nothing**: pushing a refresh would tell
  every screen something had changed when nothing a child can see did.

`centsPerPoint` comes back as `0` when the row is missing or unparseable. That is deliberate and
local to this route — it is how an adult *fixes* the unset case, so it is the one caller that
must survive it. `getCentsPerPoint` elsewhere still returns `null`, which makes a redemption
refuse rather than pay out a guessed amount.

Bounds are sanity rails on a keyboardless touchscreen, not policy: `centsPerPoint` 1–500 and
`basePoints` 0–99. Every edit is a stepper on a wall, so the realistic failure is a stuck finger
rather than a typo.

### Assets

| Method | Path | Returns |
|---|---|---|
| `GET` | `/assets/:assetId` | the image bytes for a validated asset |

`AssetRef.url` in a snapshot is already resolved through the fallback chain and is safe to use
directly. This route exists for the one case a snapshot cannot cover: `Child.avatarAssetId` is a
bare id rather than an `AssetRef`. Serving an unvalidated asset is a `404`, never a placeholder —
the fallback chain is resolved server-side at snapshot time, and a client-side guess would
reintroduce exactly the blank-icon hole that chain exists to close.

### Provisioning

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/api/admin/v1/devices` | `{ label }` | `{ token }` — shown **once**, stored hashed |
| `DELETE` | `/api/admin/v1/devices/:id` | — | `204` |

## Errors

Uniform shape: `{ error: <code>, message: <human string> }`.

| Code | HTTP | Meaning |
|---|---|---|
| `bad_pin` | 401 | PIN wrong. Render "ask a grown-up". |
| `device_revoked` | 403 | Token revoked or unknown. Render the offline card, not a login. |
| `not_claimable` | 409 | Assignment not in a state that permits the transition. |
| `already_claimed` | 409 | Lost a `first_complete` race. Expected, not an error condition. |
| `insufficient_points` | 409 | Redemption exceeds the balance at approval time. |
| `pending_redemption_exists` | 409 | One open request per child. |
| `stale_client` | 426 | Client build below `minClientBuild`; the client hard-reloads. |
| `date_mismatch` | 409 | Server could not build the requested `localDate`. Client refetches. |
| `wrong_child` | 403 | Row does not belong to the acting child. Silent no-op; render nothing. |

**No 5xx is ever rendered to a child.** The client treats any unexpected failure as "show the
last good snapshot plus a staleness marker", which is the same contract the kiosk gate honours
at the process level.


## Amendments

### 2026-10-27 — a duty can be a reminder (schema v13)

`chore.counts_toward_day` (INTEGER 0/1, default 1), and `ChoreAssignmentView.countsTowardDay`
on the wire. It says whether finishing the row counts toward a full day (ADR-0006 §4). A duty
with `0` is a **reminder**: it is still on the board, still claimable and still pays what it
pays, but it leaves the day's count on both sides, done or not, the way `superseded` does.
Homework and eye exercises are the first two: not every day has homework, so leaving it
undone must not cost the day. An extra is always `false`.

Authored only through `db/chores.json` as `countsTowardDay` (optional; a duty defaults to
`true`, an extra to `false`, and `true` on an extra is refused). The wall's New-chore sheet
does not set it, so a chore made on the wall counts. Nothing on the wall draws the field yet;
it is on the wire for the celebration (ADR-0006 §6), which must use the same definition as
`dayCounts`. No error code or `InvalidateScope` is added.

### 2026-10-20 — a countdown's own horizon (schema v12)

`countdown.horizon_days` (nullable INTEGER, 0–366). A countdown is off the wire until its
sleeps are at or under this number, and `NULL` keeps the 60-day default. The wire shape is
unchanged: `CountdownView` gains no field, because the decision is made where the 60-day rule
is already made. It exists for grown-ups' birthdays, which the household wants on the wall
only in the last two weeks; a child's birthday stays at 60. Authored through
`provision.ts --countdowns` (runbook §1.7), which is additive and never deletes.

### 2026-10-12 — `WallSnapshot.household`: the household's settings

`WallSnapshot.household: HouseholdView`, after `theme`. Additive; `apiVersion` and
`minClientBuild` unchanged (a client that ignores the field renders exactly as before, and the
2026-10-11 amendments set the precedent that an added field is not a bump).

```ts
household: {
  timezone: string;   // IANA; every local date on the wall is computed in it
  locale: string;     // BCP-47; the wall's dates, times and money are formatted in it
  currency: string;   // ISO-4217
  features: { chores: boolean; money: boolean; routines: boolean; countdowns: boolean };
  boardWindows: { opensAtLocal: string; closesAtLocal: string }[];  // "HH:MM", household-local
  pets: { id: string; name: string }[];   // at most one in v0.1
}
```

All of it comes from `household_config` rows (`timezone`, `locale`, `currency`, `features`,
`board_windows`, `pets`; `scenes` is stored beside them and is NOT on the wire — only the host-side
tools read it), written by `provision.ts --settings <file|->` from a JSON file validated by
`src/config/household.ts` (schema v1; `db/household.example.json`). A missing or invalid row reads
as its default, and the defaults equal the previous behaviour: America/Denver, en-US, USD, every
feature on, the board windows 05:45–08:30 and 18:45–20:45, no pets.

The client applies `timezone`, `locale` and `currency` on receipt, before rendering, so its "today"
is the server's; a snapshot without the field (cached from an older server) leaves the defaults.
`boardWindows` feeds the idle gate. `features` is carried but not yet read by the wall.

**`WallSnapshot.dog` is now `DogWeek | null`**: `null` when `household.pets` is empty, which is
the default. With no pet the wall never mounts the dog's sheet, the dog in a picture is not a
door, and `POST /api/wall/v1/dog/deeds/:deedId` answers `409 not_claimable` before reading the
body. With one pet the week is exactly what it was, and the sheet's title takes the pet's name
from `household.pets[0].name`. `apiVersion` is unchanged: the bundle and the server ship in one
image, and the only household with an older client attached has a pet. (An older client that
met `dog: null` reconciles fine — it read `dog` through an optional chain — but a tap on a
pictured dog would fail inside the scene's error boundary.)

### 2026-10-11 — pass 2: chore edit, retire and restore; the PIN changed from the wall

Four admin routes. Additive; `apiVersion` unchanged, no type in `src/types.ts` moved.

**`POST /chores/:choreId/edit`** takes any of `labelFull`, `iconAssetId`, `rrule` and folds them
over the chore as it stands, through `createChore`'s parser, referential checks and writer. Any
other key is a `400` — worth, model and roster each already have their own route and their own
rule for when the change reaches the board, and a second door to the same field would be a
second rule. A new name re-derives `labelShort`; a new picture re-derives `category`; the id never
moves. The name and picture show on TODAY's cards (the board reads them live off `chore`); new
days start with the next day built, so today's card stands. `404` for an unknown or retired chore.

**`POST /chores/:choreId/retire`** is soft — `active = 0`, never a DELETE; every day, claim and
ledger row stays — and takes the chore off today's board as well as tomorrow's. It is REFUSED
with `409 not_claimable` while any claim on the chore is still waiting, because that claim would
otherwise vanish from the queue unpaid. Already retired is `200` with nothing changed.
**`POST /chores/:choreId/restore`** is its inverse and is idempotent. Both `404` an unknown id.

**`POST /settings/pin`** `{ newPin }` replaces the household PIN, scrypt-hashed by the same
`setParentPin` provisioning uses. The `x-parent-pin` header must carry the CURRENT PIN and is
checked by the ordinary guard, so a wrong one is `401 bad_pin` and nothing is written. `newPin` is
4–12 DIGITS: the wall's only keyboard is a digit pad, and a PIN it cannot type would lock the
household out of its own grown-up screens. Answers `HouseholdSettings` like every settings write
(nothing in it describes the PIN); the wall holds no session, so there is nothing to rotate — the
next request simply carries the new PIN.

**No route for the approval undo.** A decision in Waiting is held for five seconds on the wall
(`logic/heldDecisions.ts`) and only then sent to the ordinary approve/reject routes, so Undo is
the wall NOT sending it: no reversal row, no deleted row, and nothing on this surface changed. A
wall that reloads inside the window loses the decision and the claim simply stays waiting.

### 2026-10-11 — the grown-up screens' reads

`ChoreAssignmentView.claimedAtUtc: Utc | null` and `HouseholdSettings.calendar`. Additive;
`apiVersion` unchanged. No route moved, and the ledger row in the table above is corrected to
say what the route has always returned.

**`claimedAtUtc`** is when the child said she did it, read from the column the claim transition
has always stamped (`chore_assignment.claimed_at_utc`). It is non-null only while the card is
`claimed`: a pending, approved or superseded card reads `null` even where the column still holds
a value, so a redo never looks as old as the claim that was sent back. The grown-up queue turns
it into "18 min ago". An older wall ignores it.

**`HouseholdSettings.calendar`** is `{ sources: CalendarSourceHealth[] }`, one per INCLUDED
source, ordered by label:

```ts
{ label: string,
  last: 'ok' | 'failed' | 'running' | 'never',   // the LATEST attempt
  triedAtUtc: Utc | null,                         // when it finished (started, while running)
  goodAtUtc: Utc | null }                         // when the generation on the wall was promoted
```

Labels and times only. It never carries `calendar_source.external_ref` (the adapter's handle —
an entity id or a secret iCal address, ADR-0004), never `sync_run.error` (the upstream's own
words, which can quote a URL) and never an event title; `test/unit-b.sync.test.ts` greps the
wire for all three. It is read-only: the Settings screen's "Fetch now" is the existing
`POST /api/admin/v1/calendar/refresh`, and its outcome is shown in the screen's own words, never
the scheduler's `reason`.

### 2026-10-11 — the wall's look

`WallSnapshot.theme: WallThemeId`, `HouseholdSettings.theme`, and
`POST /api/admin/v1/settings/theme`. Additive; `apiVersion` unchanged.

Three looks were drawn for the wall (mockups in private notes): `felt` (the felt
board, the default), `gallery` and `storybook`. Which one is up is one row,
`household_config.wall_theme`, so no migration exists for it. It rides in the snapshot so a
change reaches every screen on the same refetch and a wall that boots from a cached snapshot
still wears the household's choice.

**Read defensively, written strictly.** A missing row, or one hand-edited into a word this
build does not know, reads as `felt` — a wall that refused to render over a setting about
colours would be failing the 6:00 AM invariant for the least important reason there is. The
route accepts exactly the three ids; anything else is `400 bad_request` and nothing is written.
The client resolves the field again with the same guard, because an older server sends none.

The invalidate scope is `all`, sent only when the stored look actually changed: every screen's
colours, type and furniture move together, and tapping the look that is already up is not news.
The ids are deliberately not `picture`, `fluent` or `emergent`, which are reading bands.

### 2026-09-16 — the rail's faces, and putting a picture up without the PIN

`SceneRegion.head: SceneBox | null` (additive) and **`POST /api/admin/v1/scenes/:id/approve`
moves to `POST /api/wall/v1/scenes/:id/approve`** (a surface change, not additive — the admin
path is gone). `apiVersion` unchanged: the only client is this wall.

**The rail shows each child's head cropped out of the picture that is on the wall.** A child
finds herself in the picture and taps herself, and until now the reference she matched against
was a cartoon portrait that looks nothing like a figure drawn in pencil or photoreal. `head` is
a tight box around her head IN THIS PICTURE, in the same fractions as the tap box, found by the
same vision call that locates the tap targets — so a scene costs exactly what it cost before and
no new asset exists. The wall positions the scene image it has already downloaded; there is no
second request. This is what lets a picture put a child further back and stay findable.

`head` is separate from the tap box beside it and the two are never interchangeable: the tap box
is GROWN to a 96px floor and then gutter-fitted, so it is a target and not a likeness. It is
nullable and drops independently — absent on every manifest written before this date, refused by
the finder's own validator when the answer looks like a body rather than a head, and refused
again by the client for a degenerate rectangle. Every one of those falls back to the cartoon
avatar. A wrong crop is worse than no crop, because the rail is how a three-year-old reaches her
own screen.

**Approving a scene no longer asks for the PIN.** It was behind it, and the household's answer
was to give the children the PIN — which bought them the approval queue, the points ledger and
the worth of every chore as well. A door that makes people hand out the master key is a worse
guardrail than no door. What makes it safe is that there is nothing here to guard: approving is
also SELECTING (re-approving rewrites `decided_at_utc`, which is how "put that one back up"
works), so every outcome of this route is another picture on the wall and every one of them is
undone by tapping a different picture. Nothing is deleted, paid or sent anywhere.
`POST /api/admin/v1/scenes/:id/retire` **stayed behind the PIN** — it is the one control on that
screen that removes rather than chooses.

### 2026-09-15 — leave-by alerts

`WallSnapshot.departures: DepartureRules`, `HouseholdSettings.departures`,
`CalendarEventView.category`, and `POST /api/admin/v1/settings/departures`. Additive;
`apiVersion` unchanged.

"Get ready for School — leave at 7:35." The wall shows a banner ahead of the household's
fixed departures. The rules are one JSON row (`household_config.departures`) and the wire
carries the RULES, never a verdict: `{ enabled, readyMinutes, travelMinutes, school: {
leaveAt, days, label }, eventCategories }`. The wall judges from its own clock every tick —
the phase is `ready` from `leaveAt − readyMinutes` until `leaveAt`, then `go` for ten minutes
after — because the snapshot is minutes old by design and a server that said "ready now"
would be wrong the moment the wall rendered from local state at 6:00 AM. Nothing is stored
about a live alert and nothing is acknowledged: when the clock leaves the window the banner is
gone.

**Two sources.** The school rule is a clock — `leaveAt` on `days` — suppressed on any day
whose events include an all-day 🏠 (the classifier's day-off family: breaks, no-school,
teacher work days). A timed calendar event whose `category` is in `eventCategories` (`dance`
and `sport` by default) is a departure at `start − travelMinutes`, and carries the child.
`CalendarEventView.category` is the classifier's result, stored at sync (migration v10) so
the client does not re-classify a title it may not be able to read in that band. `travelMinutes`
is not applied to the school rule: `leaveAt` is already the time the car leaves.

**The route takes a patch and checks the whole of it before writing.** Minutes are whole
numbers in `0…120`; `schoolLeaveAt` is a real clock reading (`25:00` is refused — `isLocalTime`
was shape-only until this route needed it not to be); `enabled` is a boolean. Any bad field
is `400 bad_request` and nothing changes. The answer is `HouseholdSettings`, the same shape the
other two settings routes return, so the panel renders the response. The invalidate scope is
`calendar`, because the wall's banner is derived from the same snapshot fields as its week.

Not on the wire: the ten-minute `go` linger, the sound (there is none), and the days list and
label, which the file sets and the wall does not edit. The switch is behind the PIN with the
lead times — Grown-ups → Leaving — on the principle that the wall holds no admin session.

### 2026-09-15 — the dog's week

`WallSnapshot.dog: DogWeek`, `WallScene.dog: SceneBox | null`, the invalidate scope `dog`,
and `POST /api/wall/v1/dog/deeds/:deedId`. Additive; `apiVersion` unchanged (an older client
ignores the two fields and widens the scope to `all`).

The Easter egg. Every scene hides the family dog; a manifest may now say where (`dog`, a
box in fractions, optional — a picture where the finder could not see him is still a scene),
and a tap there opens his week rather than a child's screen. `DogWeek` is four deeds drawn
from a fixed pool in code by the ISO week (`week`, `"2026-W38"`), each with `done`. The
draw is a pure function of the week, so the list turns over on Monday with no row written
anywhere; the ticks in `dog_deed_done` are the only state. The deeds are written in the
dog's voice ("Slept all day", "Ate some underwear"): the sheet is his, and he is talking.

**The sheet's other half is chores, not a second route.** `ChoreAssignmentView` now carries
`category` (the chore's free-text category from the file, `pet`, `kitchen`, `tidy`…), and
the client reads any `pet` chore of `kind: 'extra'` as one of the dog's asks — "Play fetch
with me", "Brush me" — grouped by chore across the children who have not yet claimed it. A
tap on a child's face is the ordinary `POST /chores/:assignmentId/claim` for that child, under
the same undo window as the board; a second tap unclaims. Nothing new on the wire beyond the
field, and nothing the board could not already do: the sheet is a different picker over the
same rows.

**No child, no PIN, and that is by design, not omission.** The route cannot pay, approve or
delete: a tick is a row whose presence means done, and `done: false` removes it — the same
tap is the undo. There is nothing behind it for a guardrail to guard, which is what lets it
sit behind a tap on the dog with no door. The body's `week` must be the server's current ISO
week, and the deed must be in that week's draw; anything else — a sheet left open across
Sunday midnight, a deed from another week, a made-up id — is `409 not_claimable`, and the
client refetches. `changed: false` is the quiet no-op for a repeat.

### 2026-09-14 — chore roster and model from the wall

`GET /api/admin/v1/chores` and the three writes under it, documented above. Additive;
`apiVersion` unchanged. `ChoreCatalog` is every chore (retired ones too, `active: false`) with
its **effective** roster in order — the explicit `chore_rotation_member` rows when there are
any, otherwise every active child, with `rosterExplicit` saying which — and each write
answers with the whole catalog.

The roster is never emptied from the wall. The store reads no rows as *everyone*, so taking
the last child off would hand the chore to all three; the server refuses that write with
`400 bad_request` and the panel draws that child's check inert. The first write against an
implicit roster spells it out.

**Membership reaches today; the model reaches tomorrow.** Adding or removing a child on a day
already materialized under `individual`, `shared` or `first_complete` adds a `pending` row
(`superseded` if a `first_complete` race is already won) or deletes one that is still
`pending` — a `claimed` row is work the child did and stays for approval. A `rotation` day
is never touched: its assignee was dealt at materialization and re-dealing a turn at 17:00
is how somebody loses one. `POST …/model` changes only the definition; today's `chore_day`
keeps the model it was snapshotted under. Switching to `rotation` writes the explicit roster
so tomorrow's turn has someone to land on.

`assignmentModel` outside the four is `400 bad_request`; an unknown or retired chore, or an
inactive child, is `404 not_found`. Moving past either end, or a child not on the roster, is
a `200` that changed nothing.

`ChoreCatalog.icons` is every validated `kind = 'icon'` asset (`{ assetId, url, category }`),
in id order — the picker's choices. Unvalidated rows are left out.

### 2026-09-14 — a chore made on the wall

`POST /api/admin/v1/chores`. Additive; `apiVersion` unchanged. The body is what the sheet
collected — `labelFull`, `iconAssetId`, `kind`, `basePoints`, `assignmentModel`, `rrule`,
optional `dueByLocal`, and `roster` (child ids, at least one) — and the server derives the
rest: the id is `ch-` plus a slug of the name (`-2`, `-3`… if taken, so a retired chore's id
is never reused), `labelShort` is the name if it fits 14 code points or its leading whole
words, and `category` is the icon's. The chore lands active and on tomorrow's boards (today's
if it recurs today and the day is still open, through the normal materialisation).

It goes through the SAME parser, referential checks and writer as `provision.ts --chores FILE`
(`src/domain/chores/authoring.ts`), so the wall cannot make a chore the file could not. A
refusal is one `400 bad_request` whose `message` joins every reason with `; ` — shape errors
first (the parser's), then references (an unknown icon or child) on the next attempt. The
sheet shows that message verbatim; it is the one place a client displays server prose, and
nothing branches on it. The `rrule` must be one the expander reads today (`FREQ=DAILY`, or
`FREQ=WEEKLY;BYDAY=…`); the wall offers ten presets. The chore history fingerprint is untouched.

### 2026-09-14 — routine assignment from the wall

`GET /api/admin/v1/routines` and the two writes under it, documented above. Additive;
`apiVersion` unchanged. `RoutineCatalog` is the definitions — every routine with its step
pool and every `(childId, stepId, position)` assignment — and both writes answer with the
whole catalog so the panel renders what the server holds.

Each write also reconciles **today's** run for that child and routine in the same
transaction (`src/domain/routines/assign.ts`): a step added at 19:00 is on tonight's bedtime
card, a removed one is gone from it, and a step already ticked keeps its completion because
its run row is updated in place rather than replaced. Runs for any other day are records and
are never rewritten. This is the opposite of a chore's points, which start tomorrow — a
routine is done tonight, and "tomorrow" would be the household's one ask still unanswered
until 19:00 the next day.

A step that belongs to another routine, or a child who is not active, is `404 not_found`;
a missing `childId` or a `direction` outside `up`/`down` is `400 bad_request`. Moving past
either end, or moving a step the child does not have, is a `200` that changed nothing.

### 2026-09-10 — the two settings routes

`GET /api/admin/v1/settings`, `POST /api/admin/v1/settings/cents-per-point` and
`POST /api/admin/v1/settings/chores/:choreId`, documented above. `apiVersion` is unchanged: they
are additive, nothing already on the wire moved, and a client that has never heard of them is
unaffected.

Asked for after the first real use — *"let's have an option in there or a button to say, like,
adjust points, so we can adjust how much a point is worth, and also how much chores are
worth."* Both numbers already lived in tables; what was missing was a way in that was not a
shell and a SQL statement.

Changes made after the freeze. Each is a stop-the-world event taken deliberately between
waves, never mid-wave.

### 2026-09-09 — `CountdownView.emoji`, a 60-day horizon, and a per-source event filter

- **`CountdownView.emoji`** — same channel as an event's, but AUTHORED on the row rather than
  inferred, because a countdown is written by an adult in this house who knows what it is. Every
  countdown drew a birthday cake before this: three birthdays and "Winter holiday" all resolve
  to the one `celebration` icon.

- **Countdowns further out than 60 days are off the wire entirely.** Not hidden by a renderer —
  three bands would each have to apply the rule and one of them eventually would not, the same
  reasoning `displayStreak` already encodes. A 295-sleep birthday is not information.

- **`calendar_source.event_filter`** (schema v7) — `all` or `all_day_only`, decided per source
  and applied between the fetch and the staging transaction, so filtered events never enter a
  generation. For a SUBSCRIBED calendar nobody here curates: a school district feed's all-day
  entries are its breaks, no-school days, assessment days, conferences and picture days, and
  its timed entries are clubs and meetings inside an ordinary school day. Structural, so it does
  not rot when the district renames a club.

### 2026-09-09 — `CalendarEventView.emoji`

A single emoji per event, or `null`, for the two children who cannot read a title. Resolved
from the title at SYNC time by the same matcher that picks `icon`, at the same moment, so the
two can never disagree about the same event — and stored on `calendar_event` (schema v5) rather
than derived at render, which is the rule `src/calendar/classify.ts` already sets for the icon.

It is deliberately FINER than the icon's category. The classifier's vocabulary is bound to art,
and its own note records why `sport` is drawn as one ball and not split: *"a ball is about as
close to a universal sport pictogram as an object gets."* That argument is entirely about the
cost of drawing something, and an emoji costs nothing — so dance, gymnastics and swimming each
get their own where the drawn set has one between them.

`null` is the common case and draws nothing. A guessed emoji is worse than none: the readers it
exists for are exactly the ones who cannot check it against the words beside it.

### 2026-09-08 — the wall's picture moved into the contract

Two additions, one decision. Which picture is behind the wall used to be chosen **in the
browser**: the bundle carried a committed array of scene ids, fetched `<id>.json` for each and
took the first that parsed. That put the answer to "put a new picture up" on the far side of a
redeploy, which is why the weekly generator built in early September never actually reached the
wall — it could produce a picture at 2am and had no way to make it visible.

- **`WallSnapshot.scene: WallScene | null`.** The chosen picture and its tap regions, decided
  by the server from the `scene` table. `null` is a real answer and the client must handle it:
  the wall renders the information board, which is the screen the 6:00 AM invariant is about. A
  picture with no usable regions is never sent, because on the scene screen the picture IS the
  navigation and a scene with no doors is a dead end that looks like a working one.

- **`GET /api/wall/v1/scenes`.** The whole catalog, for the grown-up review screen. On the
  **wall** surface, not the admin one, and that is the deliberate part: *the PIN gates the
  action, not the door*, exactly as the approval queue already works. A child may open the
  picture screen and look at the pictures; there is nothing on it she can change. Behind the PIN
  this would have cost an adult two PIN entries to change a background, for a payload that is
  picture ids and states and carries nothing about the household.

  Not folded into `/snapshot` for the same reason `redemptions` is its own route: the snapshot
  is TODAY, re-parsed by a months-uptime kiosk on every SSE beat, and a catalog only one screen
  ever reads does not belong in it.

- **`POST /api/admin/v1/scenes/:id/approve` and `/retire`** — device token **plus** PIN, like
  every other decision. Approving is also SELECTING: the wall shows the most recently approved
  scene, so re-approving an old one promotes it. There is deliberately no `select` verb, because
  it would be a second control doing what the first already does.

### 2026-08-24 — `{ note? }` removed from both reject routes

Units C and D independently reported that the contract promised a body neither table could
persist: `chore_assignment` and `redemption_request` have no note column, so the field was
silently dropped. Both units refused to accept a parameter they would discard, which is the
correct instinct.

Resolved by **removing the promise rather than adding the column**, on the same reasoning
that kept `paid` out of the ledger: do not model what the software cannot observe. A rejected
chore is a parent and a child standing at the wall having a conversation. Persisting a reason
would add a column, a queue to display it in, and a literacy problem for two of three children
— to record something the child has already been told out loud. The state change is the fact;
the reason is a conversation.

### 2026-08-24 — pending redemptions are now visible

Unit D reported that nothing rendered a redemption request: `WallSnapshot` had no field and
there was no route, so a child could ask to cash out and have no way to see that she had
asked, and a parent had no queue to approve from. A request that vanishes is worse than no
request — the child taps, nothing changes, and she taps again.

`WallSnapshot.redemptions` now carries the **pending** requests, and a wall route exposes
them directly. Decided ones are history and belong in the ledger view, not on the wall.

### 2026-08-24 — `CountdownView.childId` added

Unit F reported that `countdown.child_id` exists in the schema — and the dev seed scopes a
birthday to one child — but `CountdownView` had no field to carry it, so every per-child
countdown rendered household-wide. A five-year-old watching "3 sleeps" to a birthday that is
not hers is exactly the confidently-wrong output the prime invariant forbids.

### 2026-08-24 — `GET /assets/:assetId` documented

`Child.avatarAssetId` is a bare id rather than a resolved `AssetRef`, and no route documented
how to turn one into an image. Unit H had to assume `/assets/<id>`. Now specified, and
specified to 404 on an unvalidated asset rather than substituting a placeholder — the fallback
chain is resolved server-side at snapshot time, and a client-side guess would reintroduce the
blank-icon hole that chain exists to close.

### 2026-08-25 — `Freshness.calendarConfigured` added

Found on the first real deployment, not by any test. `calendarSyncAgeSeconds: null` was
carrying two situations that are not remotely alike:

- **configured and never synced** — an adult wired calendars up and nothing is arriving.
  Genuinely stale, and worth saying out loud.
- **no calendar configured at all** — nothing is owed, so nothing can be late.

`freshnessStatus()` treated both as stale, so a household with no calendar wired up displayed
*"Showing older information"* permanently, from boot, forever. That is worse than a missing
badge: a warning that is always lit is one everybody learns to ignore, and this is the badge
the prime invariant leans on. Stale-but-labelled only beats stale-and-confident while the
label still means something.

`Freshness` now carries `calendarConfigured: boolean` — true when at least one
`calendar_source` row has `included = 1`. Calendar staleness is evaluated only when it is
true. Routine materialization and the two date-mismatch checks are untouched and still report
on their own channels, so an unconfigured calendar cannot mask a real fault.

Server: `calendarIsConfigured()` in `src/calendar/sync.ts`, which owns every `calendar_source`
query. Client: the guard in `web/src/views/logic/freshness.ts`.

### 2026-08-27 — `POST /api/admin/v1/calendar/refresh` added

`syncNow()` has been on the scheduler since it was written and nothing ever called it, so the
only way to force a calendar refresh was to restart the container — which drops every SSE
client and takes the wall dark for a few seconds, to do something the worker thread is already
sitting there waiting to do.

**Admin surface, so it is PIN-gated per request like every other mutation.** Children and
guests touch this screen and the wall holds no admin session; this route inherits that check by
being where it is, rather than by adding a mechanism.

Returns a `RefreshOutcome`:

```ts
{ disposition: 'started' | 'already-running',
  reason: string | null,
  lastCompletedAtUtc: string | null,
  lastEvents: number | null,
  lastFailed: number | null }
```

`already-running` is a SUCCESS, not a refusal: a second press while a sweep is in flight
correctly does nothing, and the caller is told so. `syncNow()` is a fire-and-forget
`postMessage` with no notion of "already running", so without that guard two taps a second
apart would queue two full sweeps against the same upstream.

`503 unavailable` when this deployment has no calendar upstream at all — a supported
configuration, not an error, and `message` carries the scheduler's own words. It takes an
operational code because `ApiErrorCode` is frozen and none of its members mean "there is
nothing here to refresh"; a frozen protocol should not grow a member for one route.

**It cannot make the wall worse.** The sweep writes into a fresh generation and promotes it
atomically, so a failed refresh leaves the promoted generation exactly where it was and the
wall keeps rendering the schedule it already had.

### 2026-08-27 — `POST /api/wall/v1/telemetry/door` added

Two independent reviewers split on whether the search-and-find picture needs an at-a-glance
readout (H10, `docs/design-review/H10-panel-picture-readout.md`), and both named the same thing that would settle it: **a tap count.**
Frequent reaches for the calendar while the picture is up argue for a floating chip; near-zero
over two weeks argue for leaving the picture alone. Nobody had that number and nothing recorded
it, so the decision could not resolve however long it waited. This is the instrument, not the
answer — the readout is still the operator's call, and this only makes it answerable.

Body is `{ target: 'calendar' | 'grown-ups', scene: boolean }`. `204`, no body.

**On the wall surface, not admin,** and that is a deliberate reading of the guardrail rather
than a convenience. Destructive actions must be *impossible* from the wall; this cannot delete,
pay, or approve, and the schema's CHECK on `target` means it cannot write anything but a counter
on one of two named doors. PIN-gating it would mean asking an adult for a PIN in order to record
that an adult opened the calendar — which destroys the measurement and annoys the person being
measured. A test asserts nothing outside `door_tap` moves.

**The server stamps the date and time; the client does not send them.** The wall's own clock is
the thing this codebase refuses to trust — a Pi coming up after a power cut may not have synced,
and those are precisely the days you would most want to read correctly. It also means a
fragment-driven kiosk cannot scribble an arbitrary date onto the evidence.

`scene` defaults to **false** for anything that is not literally `true`. The direction matters:
defaulting to `true` would credit every malformed tap to the side of the argument that wants a
readout, and the instrument would drift toward its own conclusion with nobody editing a number.

Storage is aggregated — one row per (local date, door, picture) — so it cannot become a record
of who touched what at which second. That would be surveillance in a family's living room to
answer a question a daily count answers. Read it with
`npm run provision -- --taps [days]`, which reports **reaches** (distinct minutes with at least
one tap) ahead of raw taps, because a three-year-old drumming on a button forty times is one
reach and a raw count would read as overwhelming demand for exactly the feature under argument.
