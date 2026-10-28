# Phone admin: build plan

**Written 2026-10-24.** This plan covers the grown-up screens, reached from a paired phone. It
is cut into packages that a Sonnet-level agent can build without making a design decision. Read
[`work-packages.md`](work-packages.md) §1 first: the five rules there apply to every package
below and are not repeated.

The plan has five parts:

- §1: what was decided, and what must not be reopened.
- §2: what the code does today, with file and line references.
- §3: the design.
- §4: the packages.
- §5: the gates, the threat model and the answered questions.

An agent handed a package reads §1, §2, §3 and its own package. It does not need the others.

---

## 1. Decided, and not to be reopened

These were settled with the operator in October 2026 (ROADMAP "Phone admin"). A package that
seems to need one changed stops and says so. It does not work around the decision.

1. **A paired phone has no PIN.** Pairing is the authorisation. The PIN stays on the wall,
   where children and guests are.
2. **Pairing uses a 6-digit code shown on the wall.** You type it on the phone. A QR code comes
   later and is not in this plan.
3. **The app is served at `/admin` on the wall's own port (8124).** It is one process and one
   origin, with no second container.
4. **It is LAN and tailnet only, never the public internet.** Port 8124 is reachable from the
   LAN and `100.64.0.0/10`, and Docker-published ports bypass ufw. So every access check for
   `/admin` lives in the app, never in the firewall.
5. **No cloud is in the path, with one measured exception.** No analytics, CDN or webfont
   host. This is the no-cloud invariant (PRD §4). The exception is the daily approve reminder
   (§3.7, decided 2026-10-24): a phone notification can only reach a phone through the
   platform's push service (Apple's or Google's), so the reminder's payload is encrypted
   end to end and carries a count and nothing else. That passes both ADR-0002 tests: the
   push service learns nothing about the household, and 6:00 AM does not depend on it.
6. **Nothing is deleted from a phone.** That covers chores (they retire), ledger entries (they
   are adjusted) and calendar events (the wall never writes them). The same rule binds the wall
   today.

---

## 2. What exists (verified 2026-10-24)

**Server.** The server is plain `node:http`, not Fastify (`src/http/server.ts`,
`src/http/router.ts`).

- A route is a `RouteSpec { method, surface: 'wall'|'admin'|'public', pattern, handler }`
  (`src/http/context.ts:41-48`). `createWallServer` concatenates the route arrays
  (`server.ts:98-101`).
- **Auth runs per surface** (`server.ts:166-173`):
  - Any non-public route calls `authenticateDevice(db, Authorization)`.
  - An `admin` route then also calls `requireParentPin(db, X-Parent-Pin)`, on every request.
- **Device tokens** (`src/http/auth.ts:46-139`):
  - A token is 32 random bytes, sent as `Authorization: Device <token>`.
  - It is stored as a SHA-256 hash in `device_token`: `id, label, token_hash, issued_at_utc,
    last_seen_utc, revoked_at_utc` (`db/schema.sql:104-111`).
  - A missing, unknown or revoked token all give the same `403 device_revoked`.
  - `issueDeviceToken(db, label)` (`auth.ts:57`), `revokeDevice` (:70) and `listDevices` (:79)
    exist. No route lists devices.
  - `POST /api/admin/v1/devices` and `DELETE /api/admin/v1/devices/:id` exist
    (`routes.admin.ts:268-295`).
- **The PIN** is checked with scrypt and `timingSafeEqual` and fails closed when unset
  (`auth.ts:146-228`). There is deliberately no lockout (`auth.ts:199-201`).
- **Errors** go on the wire flat, as `{ error: '<code>', message }` (`router.ts:145-147`).
  - The contract codes in `src/http/protocol.ts:25-33` are frozen: "Nothing may be added to
    this union."
  - Admin-only refusals reuse the operational codes `bad_request`, `not_found` and
    `unavailable` (`protocol.ts:37`).
  - **This plan adds no error code.**
- **SSE:**
  - `GET /api/wall/v1/stream` is on the wall surface (`routes.wall.ts:112-119`).
  - It carries only `invalidate {scope}` and `heartbeat` (`src/http/stream.ts`).
  - `InvalidateScope` is a closed union (`stream.ts:37`).
- **Migrations:** the database is at `TARGET_VERSION = 13` (`src/db/migrate.ts`; v13 is
  `chore.counts_toward_day`, 2026-10-27, so this plan's migrations are v14–v16). A new version
  takes four edits (migrate.ts:24-28): the constant, an `UPGRADES` step, `db/schema.sql`, and
  its `schema_migration` insert. `npm run verify:schema` checks the result. Two more things
  bite:
  - Every version needs a matching entry at the top of the `UNDO` list in
    `test/unit-a.persistence.test.ts`, and `test/unit-h.scene-history.test.ts` downgrades to
    v10 by hand, so its `db.exec` must drop the new column or table too.
  - A comment in `schema.sql` between the previous column and a new LAST column must contain
    no comma. SQLite drops a last column by cutting back to the nearest comma, finds one inside
    the comment, and the downgrade fails with `incomplete input`.
- **Static serving** (`stacks/wall/entry/static.ts`):
  - `/api/*` never gets HTML (:164).
  - `/` returns `index.html` with `no-store` (:166).
  - `/bundle/*` is immutable.
  - **Any extensionless path returns `index.html`** (:202), so `/admin` serves the wall bundle
    today.

**The approval queue only sees today. This is a bug the phone app has to fix.**

- `approvalQueue(snapshot)` builds the grown-ups' list (`web/src/app/adminActions.ts:714`).
- The snapshot's `chores` is the *requested date's* assignments only (`src/http/snapshot.ts:181`).
- So a claim not approved on the day it was made leaves every grown-up screen at midnight,
  still `claimed` and still owed.
- That is how dozens of claims piled up unseen on the household's wall by October 2026. Package
  C adds a queue route that reads across days, and package G points the wall at it.

**Frontend.**

- **One entry:** `web/index.html` loads `web/src/main.tsx`, which renders `<WallRoot/>`.
  - `web/vite.config.ts` has one input, `assetsDir: 'bundle'` and `target: 'es2022'`.
  - There is no router. Navigation is a reducer (`web/src/views/logic/idle.ts`).
- **The device token** arrives as the URL fragment `#dt=`:
  - `claimDeviceToken` reads it and scrubs it with `history.replaceState`
    (`web/src/data/browser.ts:66-87`).
  - It is stored in `localStorage['wall.deviceToken']` (`web/src/data/device.ts:24-25`).
- **The wall's admin client** (`adminActions.ts`):
  - It takes the PIN as an argument on every method.
  - With an empty PIN it refuses `bad_pin` locally and never touches the network (:429-436,
    :472-474).
  - It always sends `x-parent-pin`.
- **The grown-up screens are bound to the 960×540 wall:**
  - `ApprovalsView.tsx` (1205 lines), `GrownupChrome`, `PinSheet`, `NewChoreSheet` (with a
    784px on-screen keyboard) and `ScenesView` (fixed widths).
  - All of them read `useWall()` and the 960×540 geometry in `views/logic/theme.ts:293-329`.
  - **None of these `.tsx` files is reusable on a phone.**
- **What IS reusable:**
  - the pure modules in `web/src/views/logic/*.ts`: `choreDraft`, `choreAssign`, `choreDays`,
    `routineAssign`, `pinChange`, `departures`, `grownup`;
  - `adminActions.ts` (once its credential is changed);
  - `approvalQueue`;
  - `REFUSAL_WORDS`;
  - the snapshot and SSE controller in `web/src/data/`.
- **The design rules forbid responsiveness:**
  - `web/index.html:5-11` says "nothing about this page is responsive and nothing should
    become so".
  - `web/src/design/README.md:135` is rule 10, "No media queries".
  - `test/unit-h.sources.test.ts` scans `web/src/views` and `web/src/app` (:25) for raw hex,
    raw px and band literals. It also bans `localStorage` there (:397-403), so storage lives in
    `web/src/data/`.
- **The browser for checks:** `tools/release/capture-screenshots.mjs` launches Playwright's
  cached headless shell (`~/.cache/ms-playwright/chromium_headless_shell-*`) and drives it over
  CDP. Playwright is not an npm dependency, and the tool resolves the binary itself. Use that
  launch for any phone-size check, at deviceScaleFactor 1.5 or less (CLAUDE.md, "Headless-shell
  screenshots … HANG at 2x").

**The wall's own design review** (October 2026, in the household's private notes) found ten
defects in the grown-up screens. Five are now server routes that already exist and simply need
a phone screen:

- chore edit, retire and restore;
- ledger adjust;
- PIN change;
- calendar refresh;
- per-chore worth.

The rest become rules for every phone screen (§3.6):

- a failed write must say so;
- every approve can be undone;
- worth is edited next to the chore;
- routines show their times;
- calendar health is visible.

---

## 3. Design

### 3.1 A phone is a device with a role

`device_token` gains `role TEXT NOT NULL DEFAULT 'wall' CHECK (role IN ('wall','phone'))`
(migration v14). The changes that follow from it:

- **`authenticateDevice`** returns `{ id, label, role }`.
- **The dispatcher** changes to this, and that line is the whole of the auth change:
  ```ts
  if (matched.route.surface === 'admin' && ctx.device.role !== 'phone') {
    await requireParentPin(db, headerValue(req, 'x-parent-pin'));
  }
  ```
- **A phone token also works on the wall surface.** The phone needs `snapshot`, `stream` and
  `scenes`, so that is allowed. The phone's UI never offers a child's own actions.
- **The token is the wall's token:** the same 32 bytes, the same hash and the same header.
  There is no cookie. The `Authorization` header is why no CSRF protection is needed: another
  site cannot make a browser attach it. A cookie would bring CSRF back.
- **No expiry.** A phone is trusted until revoked, exactly like the wall.
- **`POST /api/admin/v1/devices` stays as it is.** It issues role `wall` and is how a panel is
  provisioned from a grown-up screen. It never issues a phone. Pairing is the only door for a
  phone.

**Why a role and not a second table:** one hash lookup authenticates everything, and the CLI's
existing `--revoke <id>` works on phones for free.

### 3.2 Pairing

**On the wall** (behind the PIN): Grown-ups → Settings → **Pair a phone**.

- This calls `POST /api/admin/v1/pairing`. It is admin-surface, so the wall's PIN is required.
- It answers `{ code: '048213', expiresAtUtc, adminUrl }`. `adminUrl` is the env var
  `WALL_ADMIN_URL` when it is set (the HTTPS address of §3.7) and otherwise
  `http://<request Host>/admin`.
- The sheet shows the code large, a countdown, and the words "On your phone, open
  `<adminUrl>`". A phone must pair on the address it will use: its token is stored per origin,
  so a phone paired over plain HTTP is not paired on the HTTPS address.
- The sheet polls `GET /api/admin/v1/pairing` every 2 s and closes itself on `paired`, showing
  the phone's name.

**On the phone:** `/admin` with no stored token shows the pairing screen. It has two fields:

- **"Name this phone"**: free text, 1–40 characters after trim, for example "Parent A's phone".
- **"Code from the wall"**: `inputmode="numeric"`, `autocomplete="one-time-code"`, 6 digits.

It sends `POST /api/pair { code, label }` on the **public** surface. Success returns
`{ deviceId, token }`, and the token goes to `web/src/data/phone.ts` storage.

**The code (`src/http/pairing.ts`, an in-memory `PairingDesk` owned by the server):**

- **One live code at a time.** Issuing a new code replaces the old one. A server restart clears
  it, which is correct: a restart mid-pairing just means "ask again".
- **Six digits** from `crypto.randomInt(0, 1_000_000)`, zero-padded. Only the code's SHA-256 is
  held, and it is compared with `timingSafeEqual`.
- **10 minutes to live, single use, and 5 wrong attempts burn it.** The attempt count is
  **global, not per IP**: never authenticate or throttle by IP (`db/schema.sql:100-103`). Five
  guesses in a million, only while an adult has the sheet open, is the entire budget.
- **Every failure gives the same answer:** `401 bad_pin` with the message "That code didn't
  match. Ask for a new one on the wall." That covers a wrong code, an expired code, a burned
  code and no code at all. It reuses a frozen code rather than adding one, and the identical
  answer means a stranger cannot learn whether a code is live.
- **The wall's status poll** returns:
  ```
  { state: 'none' | 'waiting' | 'paired' | 'expired' | 'burned', expiresAtUtc?, pairedLabel? }
  ```
  - `paired` is reported once, then the desk returns to `none`.
  - `burned` is shown on the wall as "Too many wrong tries — start again", which is the one
    place a guessing attempt becomes visible to an adult.
- The desk takes an injectable clock, so tests never sleep.

### 3.3 Seeing and removing phones

- **`GET /api/admin/v1/devices`** (new) returns
  `{ devices: { id, label, role, issuedAtUtc, lastSeenUtc, revoked }[] }`.
- **The phone's Settings → Paired phones** lists the phones, with a **Remove** button on each.
  Remove calls the existing `DELETE /devices/:id`. Removing *this* phone is "Sign out", and it
  also clears local storage.
- **A phone cannot revoke a `wall` device.** The `DELETE` handler answers `bad_request` ("The
  wall panel can only be removed from the server") when the caller's role is `phone` and the
  target's role is `wall`.
  - This is not a PIN guardrail. A revoked wall token blanks the panel at 6:00 AM, and getting
    it back needs ssh and `provision.ts`.
- **The wall's own Settings lists phones too** (package E) with **Remove**, behind the PIN.
  - This is the lost-phone path: you rarely have the phone you need to revoke.
  - `npm run provision -- --revoke <id>` remains the last resort.

### 3.4 New reads the phone needs

All of these are on the admin surface.

| Route | Answers | Why |
|---|---|---|
| `GET /api/admin/v1/approvals` | `{ items: PendingApproval[] }`: every `claimed` chore assignment on ANY date, plus every pending redemption | The today-only queue bug (§2) |
| `GET /api/admin/v1/devices` | §3.3 | Paired phones |
| `GET /api/admin/v1/children/:id/weeks?weeks=N` | `{ weeks: { isoWeek, fullDays, askedDays, good }[] }`, N ≤ 26 | ADR-0006 §8 consistency view (Phase 3) |
| `GET /api/admin/v1/pairing` | §3.2 | The wall's pairing sheet |

`PendingApproval` is defined in `src/types.ts` (Phase 0) as `ApprovalItem`'s **server-side**
fields plus the day:

```ts
export interface PendingApproval {
  kind: 'chore' | 'redemption';
  id: number;                 // assignment id | redemption id
  childId: string;
  label: string;              // chore label, or the cash-out words
  iconAssetId: string | null; // null for a redemption
  points: number;             // the SNAPSHOTTED points_each, never chore.base_points
  cashCents: number | null;
  localDate: LocalDate;       // the day the chore was for; a redemption's request date
  atUtc: Utc | null;          // claimed_at / requested_at
}
```

**The sort order is the wall's** (adminActions.ts:700-712): by child slot, redemptions first
within a child, then id. The client groups by child and shows the age ("Tuesday", "3 days ago").

### 3.5 The phone bundle: a second entry, not a responsive wall

**A second Vite input** at `web/admin.html`, which loads `web/src/admin/main.tsx`:

- `rollupOptions.input = { wall: 'index.html', admin: 'admin.html' }`.
- Both entries share `bundle/` and the self-hosted fonts.
- **Static serving:** `/admin` and any extensionless `/admin/*` serve `admin.html` with
  `no-store`. The check goes **before** the generic extensionless fallback at `static.ts:202`.
- **A strict CSP**, on `admin.html` only:
  ```
  Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'
  ```
  The token lives in `localStorage`, so script injection is the threat that matters, and a page
  that loads nothing third-party can say so.

**Design rule 10 is scoped to the wall, not abolished.** Phase 0 amends `design/README.md` rule
10 to say "the wall bundle", and the comment in `web/index.html` to match. The phone page has
its own rules, in `web/src/admin/README.md` (Phase 0):

- One column, and a 360–430px width is the design target. It must not overflow horizontally
  at 320px.
- **Tap floor 48px** (adult thumb; Apple asks for 44pt, Android for 48dp). The wall's 64px is
  for a three-year-old and does not apply here.
- **Body text 16px minimum.** iOS zooms the page into any input under 16px.
- Light and dark follow `prefers-color-scheme`. The palette comes from `tokens.css`, the
  `felt` theme only. The household's wall theme is a wall setting and does not follow the
  adults to their phones.
- Native inputs and the system keyboard. No on-screen pads.
- A bottom tab bar, safe-area insets (`env(safe-area-inset-bottom)`), and no hover-only
  affordances.

**Code layout:** `web/src/admin/` holds:

- `main.tsx`, `AdminApp.tsx`;
- `screens/*.tsx`;
- `logic/*.ts` (pure, tested, and they **never import a `.tsx`**; CLAUDE.md gotcha);
- `admin.css`.

It may import `web/src/views/logic/*.ts` and `web/src/app/adminActions.ts`. It **may not**
import any `web/src/views/**/*.tsx`. A guard test enforces both, and also bans `localStorage`
in `web/src/admin/` (storage belongs in `web/src/data/phone.ts`).

**The admin client's credential.** `createAdminActions` gains
`credential: 'pin' | 'paired'`, defaulting to `'pin'`, so the wall is byte-for-byte unchanged.

- In `'paired'` mode the empty-PIN guard is skipped and no `x-parent-pin` header is sent.
- Every method keeps its `pin` parameter, and the phone passes `''`. This is less churn than a
  second interface, and one test pins that `''` never reaches the network in `'pin'` mode.

**Live data:** the phone builds the same snapshot and SSE controller as the wall
(`web/src/data/controller.ts`), with its phone token. It also refetches `/approvals` on any
`invalidate` whose scope is `chores`, `ledger` or `all`.

### 3.6 Screens

The tab bar is **Waiting** (with a badge count) · **Chores** · **Money** · **More**. More
holds Routines, Settings, Paired phones and *Talking with the kids*. A failed write shows a
red toast with the server's words, keyed through `REFUSAL_WORDS`, and the control returns to
its prior state. **Never silence** (design review, finding 1).

| Screen | Shows | Writes (existing routes unless marked) |
|---|---|---|
| **Pair** | name, code, one button, refusal words | `POST /api/pair` (new) |
| **Waiting** | queue grouped by child; per row: icon, label, points or cash, age; per child: "Approve all (n)" | approve / reject chore, approve / reject redemption |
| **Chores** | every chore: icon, name, days, worth, roster faces; retired ones under a fold | edit (name, picture, days), worth (`settings/chores/:id`), roster add / remove / move, model, retire, restore, create |
| **Money** | rate; balance per child; ledger per child | `settings/cents-per-point`, `ledger/adjust` (with a fresh `requestId` per submit) |
| **Routines** | each routine: steps × children toggles, with the routine's time window | step assign, step move |
| **Settings** | theme, leave-by, calendar health (last sync age, `calendarConfigured`) with **Fetch now**, change PIN (the wall's), paired phones | theme, departures, `calendar/refresh`, `settings/pin`, device revoke |
| **Talking with the kids** | static text from ADR-0006 §8 | none |

**Undo on approve is a delayed send.**

- Tapping Approve hides the row and shows "Approved, Undo" for **5 s**. The request is sent
  when the toast expires.
- Undo cancels a request that never left. This needs no server change and no reversal entry
  in the ledger, the same shape as the wall's 2 s tap undo.
- Closing the tab inside the 5 s loses the approval. That is the safe direction: nothing is
  paid that was not meant to be.
- **"Approve all"** uses one toast and the same delay, and sends the requests one at a time.
  Each request is idempotent, and a failure stops the run and says how many went through.

**The why, in one line.** Every control that carries a rule from ADR-0006 shows one muted line
under it, for example "Duties are unpaid: paying for helping can switch helping off." The
lines come from `web/src/admin/logic/why.ts`, which maps a control id to a sentence. The
sentences are copied from the ADR, not written fresh. A test checks that every id used in a
screen exists in the table.

### 3.7 HTTPS, and the daily reminder (decided 2026-10-24)

The operator asked for a **daily reminder** to approve, on the phone. A real notification
needs a secure context (web push and service workers do not run on plain
`http://homeserver:8124`), so:

- **The phone uses an HTTPS address on the tailnet.** The operator runs `tailscale serve --bg
  --https=<port> http://127.0.0.1:8124` on the server, which already serves other apps this
  way, and sets `WALL_ADMIN_URL=https://homeserver.example.ts.net:<port>/admin` in the wall's
  environment. Nothing changes for the Pi, which keeps the plain LAN address.
- That HTTPS address is tailnet-only, like 8124 itself (§1.4). It also encrypts the phone's
  token in transit, which closes the "sniffing on the LAN" row of §5.2 for phones.
- Plain `http://…/admin` keeps working. It just cannot offer the reminder, and the Reminder
  screen says so ("Reminders need the secure address: <adminUrl>").
- **What the reminder does** is package J: once a day at a household time (19:30 by default)
  and only when something is waiting, one notification reading "3 waiting to approve". The
  payload is the count alone (§1.5).
- **No email, chat bot or SMS.** Each of those would carry household words to a third party
  in readable form.

**The treat log** (package K) is also in, at the operator's word. **Pictures on the phone are
out**: the picture is chosen while looking at the wall.

---

## 4. Packages

**How to run this:**

- **Phase 0** is one agent, Opus, and it lands before anything fans out.
- After that, packages in the same phase run in parallel on separate branches, one per
  package.
- Every package's brief is: this file's §1–§3, plus its own block below, plus
  `work-packages.md` §1.
- Read source in ranges (`sed -n 'A,Bp'`). Several files here are over 1000 lines.

**Every package's test harness:**

- Copy `start()` and `call()` from `test/unit-f.routes.test.ts:28-83`, or use
  `test/e2e/harness.ts`.
- Use synthetic data only: `seedDev`, `child-a/b/c`, PIN `1111`.
- Wrap every test in `try { … } finally { await h.stop(); }`. Iterate with
  `--test-timeout=10000`, because a test that throws before `stop()` hangs the file for two
  minutes.

### Phase 0: contracts

**0 Contracts and the decision record (Opus, sequential).**

- Write ADR-0007, "A paired phone is an admin device". It amends the "PIN per request, never a
  session" rule for one role, records §1 and §3.1–3.3 of this file, and names what would
  reverse it.
- Amend `docs/api.md`:
  - the auth table: a `phone` role row, and `/api/pair` as public;
  - the four new routes and their shapes;
  - the `DELETE /devices` refusal;
  - a sentence that no error code was added.
- Amend `docs/architecture.md`'s auth section.
- Add to `src/types.ts`: `DeviceRole`, `DeviceView`, `PendingApproval`, `PairingStart`,
  `PairingStatus`, `PairRequest`, `PairResponse`, `WeekConsistency`, `Treat`, `TreatDraft`,
  `PushSubscriptionDraft`, `ReminderSettings`.
- Create `src/http/routes.pairing.ts`, `src/http/routes.adminReads.ts`,
  `src/http/routes.treats.ts` and `src/http/routes.push.ts`, each exporting an empty
  `RouteSpec[]`, and wire all four into `createWallServer`. This gives later packages
  disjoint files: work-packages.md rule 2's "routes live in `routes.wall.ts` and
  `routes.admin.ts`" is amended there to name these four.
- Scope design rule 10 to the wall and write `web/src/admin/README.md`.

Owns: `docs/decisions/0007-*.md`, `docs/api.md`, `docs/architecture.md`, `src/types.ts`,
`src/http/routes.{pairing,adminReads,treats,push}.ts`, `src/http/server.ts` (route list
only), `docs/work-packages.md`, `web/src/design/README.md`, `web/index.html` (comment
only), `web/src/admin/README.md`.

**Done when:** `tsc`, the test suite and `npm run build` are all green, and every type the
packages below name exists.

### Phase 1: server (A first; B and C in parallel once A has merged)

| Package | Owns | Depends on | Done when |
|---|---|---|---|
| **A Phone credential** | `src/db/migrate.ts`, `db/schema.sql`, `src/http/auth.ts`, `src/http/server.ts` (the PIN line only), `src/http/context.ts` (if `ctx.device`'s type lives there), `test/unit-f.phone-auth.test.ts` | 0 | See the A list below |
| **B Pairing** | `src/http/pairing.ts`, `src/http/routes.pairing.ts`, `stacks/wall/entry/main.ts` (construct the desk, if needed), `test/unit-f.pairing.test.ts` | A | See the B list below |
| **C Admin reads** | `src/http/routes.adminReads.ts`, `src/domain/chores/pending.ts` (new: the cross-day query), `src/http/routes.admin.ts` (the `DELETE /devices` handler only), `test/unit-f.admin-reads.test.ts` | A | See the C list below |

**A is done when:**

- Migration v14 adds `role` on both paths, and `npm run verify:schema` passes.
- `issueDeviceToken(db, label, role = 'wall')` and `authenticateDevice` return the role.
- An admin route answers a `phone` token without `X-Parent-Pin`.
- A `wall` token without the PIN is still `401 bad_pin`.
- A revoked phone gets `403 device_revoked` on both surfaces.
- Every existing test passes unchanged.

**B is done when** the tests prove each of these, using a fake clock:

- the code is 6 digits;
- it expires at 10 min;
- the 5th wrong try burns it, and the right code afterwards still fails;
- a new code replaces the old;
- the code is single-use;
- every failure is a byte-identical `401 bad_pin` body;
- the label is trimmed and limited to 1–40 characters (otherwise `bad_request`);
- success issues a `phone` device that then passes an admin route with no PIN;
- the status poll walks `waiting → paired → none`;
- `POST /pairing` from a `phone` token works too, so a phone can pair a second phone.

**C is done when:**

- `/approvals` returns a claim from three days ago and a pending redemption, and leaves out
  approved, rejected and superseded rows.
- `points` is the snapshotted value: the test changes `base_points` after materializing and
  the old value is still reported.
- The sort matches §3.4.
- `/devices` lists the role and `last_seen`.
- A `phone` deleting a `wall` device gets `bad_request`, and that device still authenticates.
- A `phone` deleting a `phone` gives 204.
- `/children/:id/weeks` is **not** in C; it is package H.

### Phase 2: the phone bundle, and the wall's half (D first; then E, F1–F4 and G in parallel)

| Package | Owns | Depends on | Done when |
|---|---|---|---|
| **D Admin shell** | `web/vite.config.ts`, `web/admin.html`, `stacks/wall/entry/static.ts`, `web/src/data/phone.ts`, `web/src/app/adminActions.ts` (`credential` option only), `web/src/admin/{main.tsx,AdminApp.tsx,admin.css}`, `web/src/admin/screens/Pair.tsx`, `web/src/admin/logic/{pairForm,tabs}.ts`, `tools/admin-audit.mjs`, `package.json` (`audit:admin` script), `test/unit-h.admin-shell.test.ts`, `test/unit-h.admin-guard.test.ts` | B, C | See the D list below |
| **E Wall pairing** | `web/src/views/domain/PairSheet.tsx` (new), `web/src/views/domain/SettingsPanel.tsx` (one row: "Pair a phone"; one list: paired phones with Remove), `web/src/views/logic/pairing.ts`, `test/unit-h.pairing.test.ts` (it calls D's `adminActions` methods; see the note below) | B, C, D | See the E list below |
| **F1 Waiting** | `web/src/admin/screens/Waiting.tsx`, `web/src/admin/logic/{waiting,undoSend}.ts`, `test/unit-h.admin-waiting.test.ts` | D | See the F1 list below |
| **F2 Chores** | `web/src/admin/screens/{Chores,ChoreDetail,NewChore}.tsx`, `web/src/admin/logic/choreEdit.ts`, `test/unit-h.admin-chores.test.ts` | D | See the F2 list below |
| **F3 Money** | `web/src/admin/screens/Money.tsx`, `web/src/admin/logic/money.ts`, `test/unit-h.admin-money.test.ts` | D | See the F3 list below |
| **F4 Routines + Settings + Talk** | `web/src/admin/screens/{Routines,Settings,Phones,Talk}.tsx`, `web/src/admin/logic/{why,settingsForm}.ts`, `test/unit-h.admin-settings.test.ts` | D | See the F4 list below |
| **G Wall reads the cross-day queue** | `web/src/views/domain/ApprovalsView.tsx` (queue source only), `web/src/views/logic/approvalSource.ts` (new), `test/unit-h.approval-source.test.ts` | C | See the G list below |

**Note on `adminActions.ts`:** it is one file and D owns it. D adds **every** new method that
E–F4 need:

- `pairingStart`, `pairingStatus`, `pair`;
- `fetchApprovals`, `fetchDevices`, `revokeDevice`;
- `fetchWeeks` (stubbed until H).

E–F4 call them and never edit the file. If a later package finds one missing, it stops and
reports. It does not add it.

**D is done when:**

- `npm run build` emits both `index.html` and `admin.html`.
- `/admin` and `/admin/x` serve `admin.html` with the CSP. `/` still serves the wall.
- `/api/x` is still never HTML (test via `createStaticHandler`).
- With no token the phone shows Pair. A good pair stores the token and shows the tab shell. A
  `403 device_revoked` on any call clears the token and returns to Pair.
- The `credential: 'paired'` mode sends no PIN header, and `'pin'` mode is unchanged (existing
  tests green).
- The guard test fails on a `views/**/*.tsx` import or a `localStorage` reference under
  `web/src/admin/`.
- **`tools/admin-audit.mjs`** passes against a throwaway wall on port 8125:
  - It uses the capture-screenshots launch at 390×844, deviceScaleFactor 1.5.
  - It pairs through the real flow, then visits each tab.
  - It reports any tap target under 48px, any text under 16px, any horizontal overflow, and a
    console error.
  - It exits non-zero on any finding, and prints `NOT AUDITED` with the reason if it could not
    get in.

**E is done when:**

- Settings shows "Pair a phone". The sheet shows the code at a readable size, the countdown,
  the host line, and closes on `paired` with the phone's name.
- `burned` and `expired` each have their own words and a "New code" key.
- The paired-phones list shows label and last seen, with Remove. Wall-role devices are not
  listed.
- `npm run audit:panel` with `AUDIT_PIN` is clean (64px taps, 14px fonts) on all three themes.
- This is checked against the 8125 throwaway, never the household's wall.

**F1 is done when:**

- The undo-send logic is unit-tested with a fake timer: undo inside 5 s sends nothing; expiry
  sends once; two approvals in flight are independent; "Approve all" stops at the first failure
  and reports the count.
- Groups are by child in slot order, and the age reads "today", "yesterday", a weekday, or "n
  days ago".
- The badge count equals the queue length.
- An empty queue says "Nothing waiting".

**F2 is done when:**

- Every write in the table has a control.
- Worth edits inline on the chore.
- Retire with waiting claims shows the server's `not_claimable` words, not a generic failure.
- Create uses native inputs and reuses `views/logic/choreDraft.ts`.
- The roster can never be emptied from here. The control for the last child is inert, the
  same rule as the wall (CLAUDE.md, "An EMPTY chore roster means EVERYONE").

**F3 is done when:**

- Adjust requires a non-zero amount and a reason, and uses a fresh `requestId` per submit (a
  double tap is one entry).
- The ledger shows a running total.
- A negative balance is allowed to display and is never clamped.

**F4 is done when:**

- Every rule-bearing control has a `why` line, and a test fails on an unknown id.
- Calendar health shows sync age and a stale state.
- **Fetch now** reports `unavailable` in words.
- The PIN change states that it changes **the wall's** PIN.
- Talk renders ADR-0006 §8's three scripts.

**G is done when:**

- The wall's Waiting list reads `/approvals` and shows a past claim with its day.
- If `/approvals` fails, it falls back to `approvalQueue(snapshot)`, so a server too old for
  the route still shows today.
- `npm run audit:panel` is clean.

### Phase 3: the adult half of ADR-0006 §8

| Package | Owns | Depends on | Done when |
|---|---|---|---|
| **H Consistency view** | `src/domain/chores/weeks.ts` (built on `dayCounts` in `streaks.ts`, read-only), the `/children/:id/weeks` route in `routes.adminReads.ts`, `web/src/admin/screens/Weeks.tsx`, `test/unit-c.weeks.test.ts` | F4 | Good weeks per child for the last 4–26 ISO weeks, and which days were not full. It is the same rule the wall's streak uses: a test runs both over one seeded history and they agree. The screen says nothing that grades a child. |
| **K Treat log** | `src/db/migrate.ts` + `db/schema.sql` (v15), `src/domain/treats.ts`, `src/http/routes.treats.ts` (new; Phase 0 creates it empty), `web/src/admin/screens/Treats.tsx`, `web/src/admin/logic/treats.ts`, `test/unit-f.treats.test.ts`, `test/unit-h.admin-treats.test.ts` | H | See the K list below |
| **J Daily reminder** | `src/db/migrate.ts` + `db/schema.sql` (v16), `src/domain/reminder.ts`, `src/http/routes.push.ts` (new; Phase 0 creates it empty), `stacks/wall/entry/main.ts` (start the scheduler), `web/public/admin-sw.js`, `web/public/admin.webmanifest`, `web/src/data/push.ts`, `web/src/admin/screens/Reminder.tsx`, `package.json` (the `web-push` dependency), `test/unit-f.reminder.test.ts` | K | See the J list below |

**Phase 3 runs H, then K, then J, one at a time.** K and J both add a migration, and two
packages editing `migrate.ts` at once is a merge that silently renumbers a version.

**K is done when:**

- Migration v15 adds `treat (id INTEGER PRIMARY KEY, local_date TEXT NOT NULL, title TEXT NOT
  NULL CHECK (length(title) BETWEEN 1 AND 80), note TEXT CHECK (note IS NULL OR length(note) <=
  280), created_at_utc TEXT NOT NULL, created_by_device_id INTEGER REFERENCES device_token(id),
  removed_at_utc TEXT) STRICT`, on both paths, and `npm run verify:schema` passes.
- Routes, all admin-surface: `GET /api/admin/v1/treats` (newest first, removed ones left
  out), `POST /api/admin/v1/treats` (`{ localDate, title, note? }`), `POST
  /api/admin/v1/treats/:id` (edit the same fields), `POST /api/admin/v1/treats/:id/remove`
  (sets `removed_at_utc`; the row is kept, per §1.6).
- The screen lives under More → Treats. It lists what the family did, newest first, and adds
  one with the date defaulting to today.
- **While a title is being typed, the screen says when the family last did something with the
  same title** ("Last time: 3 weeks ago"). The match is case-insensitive and whitespace-trimmed,
  and it is computed client-side from the list. That line is the whole point of the log:
  ADR-0006 §8 keeps it "so treats stay varied".
- The treat log never reaches the wall or a child.

**J is done when:**

- Migration v16 adds `push_subscription (id INTEGER PRIMARY KEY, device_id INTEGER NOT NULL
  REFERENCES device_token(id), endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT
  NOT NULL, created_at_utc TEXT NOT NULL) STRICT`. Revoking a device deletes its
  subscriptions in the same transaction.
- Routes: `GET /api/admin/v1/push/key` (the VAPID public key, or `unavailable`), `POST
  /api/admin/v1/push/subscribe`, `POST /api/admin/v1/push/unsubscribe`, `POST
  /api/admin/v1/push/test` (sends one now), and the reminder time in
  `household_config.reminder` (`{ enabled, at: 'HH:MM' }`, default `{ true, '19:30' }`) through
  `POST /api/admin/v1/settings/reminder`.
- **The scheduler** runs in the wall process. Once a minute it checks the household clock. At
  the reminder time it counts the cross-day queue (C's query), and when that count is above
  zero it sends one push to every subscription.
  - It sends **at most once per household date**, recorded in `household_config.reminder_sent`
    so a restart at 19:30:30 does not send twice.
  - A `404` or `410` from the push service deletes that subscription. Any other failure is
    logged and retried at the next minute, up to 30 minutes past the time.
- **The payload is `{ n }` and nothing else.** The service worker turns it into "3 waiting to
  approve" and opens `/admin` on the Waiting tab when tapped. No child's name, chore or amount
  is ever in a payload. A test asserts the sent body's keys.
- **The VAPID keys come from 1Password**, through `op.env` as `WALL_VAPID_PUBLIC_KEY` and
  `WALL_VAPID_PRIVATE_KEY`. They are never generated into a file or the database. Without
  them the boot log says `push reminder NOT configured`, the Reminder screen says so in words,
  and nothing else changes. The operator creates the 1Password item. The package documents
  the one-line key generation (`npx web-push generate-vapid-keys`) and does not run it.
- **iOS needs the page on the home screen** (iOS 16.4+ delivers web push only to an installed
  web app). `admin.webmanifest` sets `display: standalone` and `start_url: /admin`. The
  Reminder screen detects a non-installed iOS Safari and shows the two steps to add it to the
  home screen, instead of an Enable button that would fail.
- `web-push` is MPL-2.0, which is allowed (the licence rule in CLAUDE.md bans copying GPL and
  AGPL code, not depending on MPL).
- The checks run against the 8125 throwaway with fake keys and a stub push endpoint. A real
  notification on a real phone is the operator's check after deploy.

### What no package may decide

- Anything in §1.
- Adding an error code, an `InvalidateScope`, or a field to `WallSnapshot`.
- Any change to the PIN check for `wall` tokens.
- Showing a child anything from the consistency view.
- Pairing or revoking on the household's wall. That is the operator's job, after deploy.
- Exposing 8124 beyond the LAN and tailnet, or adding a CDN or webfont.
- Anything in a push payload beyond the count.
- Running `tailscale serve`, creating the 1Password item, or generating the VAPID keys. Those
  are the operator's (§3.7).

---

## 5. Gates, threats, questions

### 5.1 Gates (per package, reported with real output)

- **Every package:** `npx tsc --noEmit`, `npm test`, `npm run build`.
- **Any `src/db` change:** `npm run verify:schema`.
- **E and G** (wall screens): `npm run audit:panel` with `AUDIT_PIN`, against the 8125
  throwaway.
- **D and F1–F4:** `npm run audit:admin` against the 8125 throwaway.
- **Before a public sync:** `npm run verify:release` and `tools/release/verify-clean.sh
  --full`. Any new image needs its sha in `tools/release/public-assets.sha256`.
- **Review:** after Phase 1, one adversarial pass over A+B+C together, at `opus-high` (it
  changes who may move money). After Phase 2, one over D and G.

**The deploy** is the operator's, or an agent's on the operator's word:

1. Run `op run --env-file=op.env -- docker compose up -d --build`.
2. Check `docker logs family-calendar-wall | grep 'calendar sync'` says `scheduled`.
3. On the wall, open Pair a phone and pair from a phone.

### 5.2 Threat model

| Threat | What stops it | What does not |
|---|---|---|
| A guest on the Wi-Fi opens `/admin` | Without a token there is only the Pair screen. A code exists only while an adult has the sheet open, for 10 minutes, with 5 global guesses; a burn is visible on the wall | No |
| A lost or stolen phone | Remove it from the wall (PIN) or with `provision.ts --revoke`. The token dies on the next request | The phone's own screen lock is the only barrier until then |
| A child picks up a parent's unlocked phone | Nothing in this app, **by decision** (§1.1) | Phone lock |
| Sniffing on the LAN | Tailnet traffic is encrypted | On plain LAN HTTP the token is readable, which is the same exposure the wall's token has had since M1. A phone on the HTTPS address of §3.7 is not exposed |
| Script injection stealing the token | No third-party code; a strict CSP on `admin.html`; React escaping | No |
| CSRF | The token goes in an `Authorization` header, never a cookie | No |
| A phone darkens the wall | `DELETE /devices` refuses a `wall` target from a phone | No |
| Authenticating or throttling by IP | Never done; the attempt budget is global | No |

### 5.3 Answered 2026-10-24

1. **The reminder:** daily, on the phone, as web push over the tailnet's HTTPS (§3.7,
   package J).
2. **The treat log:** build it (package K).
3. **HTTPS:** yes, through `tailscale serve`, for the phone only (§3.7).
4. **Pictures on the phone:** no.
