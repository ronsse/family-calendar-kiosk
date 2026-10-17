# Architecture

This page explains how the wall works: what runs where, what holds state, and why each part is
built the way it is. For the wire contract see [api.md](api.md). For the places built to be
extended, see [extension-points.md](extension-points.md). For the household settings, see
[household-config.md](household-config.md).

## 1. One process, one database

The app is one Node 22 process (`stacks/wall/entry/main.ts`). It runs Fastify for the HTTP API
and serves the React bundle that Vite builds into `web/dist`, on the same port. All state is in
one SQLite file. Nothing else holds state: not the browser, not the Pi, and not a cache. A
backup of that file is a backup of the wall.

The guiding rule is **render from local state**. Calendars are synced into SQLite on a
schedule, and the wall reads only SQLite. It never waits on Google, on Home Assistant or on
the network to draw a screen. The wall must never be blank at 6:00 AM, and this rule meets that
requirement by design, not through a fallback.

## 2. Boot sequence

`main.ts` starts in this order:

1. Open the database (`WALL_DB`) and run the migrations. The migrations check the database's
   integrity first.
2. Read the household rows and set the process time zone from them.
3. Register the bundled art. This copies the committed icons, avatars and pictures into the
   asset root (`WALL_ASSET_ROOT`, or `assets/` beside the database), registers them, and
   registers the committed baseline pictures.
4. Log a warning if no device token or no parent PIN exists yet.
5. Build the HTTP server and choose a calendar source from the environment. If the source is
   configured, start the sync scheduler. If not, log `calendar sync NOT running: <reason>`
   and serve anyway.
6. Listen. On `SIGTERM`, close the event streams, stop the sync scheduler, then close the
   database.

`provision.ts` runs steps 1 and 3 itself. That is why it can set up a database before the
server has ever started.

## 3. Snapshot, stream and device token

The wall asks for one **snapshot**: `GET /api/wall/v1/snapshot?localDate=YYYY-MM-DD`. The
snapshot holds everything the panel draws: children, routines, chores, events, countdowns,
balances, the current picture and the household settings. The wall sends the date it believes
it is. If the server disagrees, the server answers `409 date_mismatch` rather than serve the
wrong day.

The **stream** (`/api/wall/v1/stream`, Server-Sent Events) carries no data. It sends only
"invalidate" and a heartbeat. When the wall hears "invalidate", it fetches a new snapshot. There
is therefore one way to learn the state, and a missed event costs one refetch, not a wrong
screen.

Every wall request carries `Authorization: Device <token>`. `provision.ts --device` mints the
token, prints it once and stores only a hash. On the Pi, the token lives in
`~/.config/kiosk.env`. The kiosk gate passes it to the page as a URL fragment (`#dt=<token>`).
A fragment is never sent to a server, so the token reaches no access log. The page reads the
token, keeps it in `localStorage` and removes it from the address bar.

The server never stamps the token into the HTML it serves. If it did, any phone on the LAN
could fetch `/` and read the token. A revoked token answers `403 device_revoked`, and a wrong
PIN answers `401 bad_pin`. They are different codes so that one is never mistaken for the other.

## 4. Calendar sync

Calendar sources sit behind one interface, `CalendarSource` (`src/calendar/CalendarSource.ts`).
There are two implementations: Home Assistant (`src/calendar/homeassistant/`) and iCal secret
addresses (`src/calendar/ics/`). No code outside an adapter knows which one is in use.
`WALL_CALENDAR_SOURCE` chooses the adapter.

A worker syncs every source every 15 minutes, in **generations** (`src/calendar/sync.ts`):

1. It opens a `sync_run` row in state `running` and commits it at once, so a crash still
   leaves a record.
2. It fetches outside any transaction.
3. It stages the events, then in one transaction marks the run `complete` and then `promoted`,
   and points the source at the new run.
4. On any failure, it marks the run `failed` and leaves the promoted generation where it was.

Readers join through the source's current-run pointer. They see the old generation or the new
one, never a mix. Nothing is deleted to make room, so an upstream error halfway through cannot
empty the wall. When the last good sync is old, the wall labels itself "Showing older
information" instead of showing nothing.

![The week view, drawn from synced events](images/week.png)

## 5. Picture or board

![The information board](images/wall-board.png)

The idle wall has two appearances: a full-screen **picture** of the children, and the
information **board** (today's routines, chores and events). The choice has exactly two inputs:

- **Is the clock trusted?** The Pi has no hardware clock. After a power cut it can boot with
  a wrong time until NTP corrects it. `web/src/views/logic/timeTrust.ts` treats any doubt
  about the clock as untrusted. An untrusted clock always shows the board.
- **Is now inside a board window?** The defaults are 05:45 to 08:30 and 18:45 to 20:45
  (`boardWindows` in `household.json`; an empty list means never).

So a wrong clock can only cost the picture, never the board at 6:00 AM. Nothing else decides
the choice. An overdue chore is not an input, on purpose (see `test/unit-h.timetrust.test.ts`).

When a child opens a screen and walks away, the wall returns to whatever the gate says after
90 seconds without a touch (`web/src/views/logic/idle.ts`).

## 6. Reading bands

Each child's screen is drawn in one of three **bands**:

- `picture`: icons and pictures only, for a pre-reader.
- `emergent`: icons and short words.
- `fluent`: full text, points and streaks.

![An emergent reader's screen](images/child-emergent.png)

![A fluent reader's screen](images/child-fluent.png)

An adult sets the band per child, in `db/household.sql` or with `provision.ts --band`. The wall
never infers it from age, because a band describes how a child reads, not how old she is. The
band changes only the drawing; the data model is the same for every child.

## 7. Chores, the PIN and the ledger

A chore assignment moves through `pending`, `claimed` and `approved`. A child claims a chore on
the wall. A grown-up approves it, or rejects it back to `pending`. A chore can follow one of
four models:

- `individual`: one row per assigned child, each child's own chore.
- `shared`: one row per child, and each child who does it earns the full points.
- `first_complete`: the first claim wins, and the other rows become `superseded`.
- `rotation`: one turn a day, dealt to one child.

**The PIN.** Grown-up screens and admin routes need the device token AND the parent PIN, sent
with every request as `X-Parent-Pin`. The wall holds no admin session. Approvals, the ledger
and destructive actions are therefore impossible from the wall without the PIN; it does not
merely discourage them. The PIN is stored hashed (scrypt). If no PIN is set, nothing can be
approved.

![The grown-ups' home screen](images/grownups-home.png)

![Claims waiting for a grown-up](images/grownups-waiting.png)

**The ledger.** An approved chore writes a ledger entry for points, and for money if the
household uses money. The approval is idempotent, so a double tap cannot pay twice. A child
whose `ledgerEnabled` is off, typically a pre-reader, runs the same state machine and is paid
nothing. Her screen shows a stamp taken from the chore's state, not a balance she cannot read.

The grown-up navigation and Home tiles hide the screens of a feature the household has
switched off (`features` in `household.json`).

## 8. The scene library

A **scene** is a picture plus a manifest: one tap target per child, an optional head box for
each, and an optional box for the dog. Scenes are rows with three states: `candidate`,
`approved` and `retired`. The wall shows the most recently approved scene, so **approving a
picture also selects it**. To go back to an older picture, approve it again. Approving is on
the wall surface and needs no PIN, because every outcome is just another picture. Retiring a
picture needs the PIN.

![The Pictures catalog](images/pictures-catalog.png)

There is always a floor:

- `backdrop`: a picture with no figures and no tap targets. It fits any household.
- The committed **baseline** scene, which was drawn for a fixed number of children. It is
  approved only on a database whose household has exactly that many active children.
  Otherwise it waits as a candidate. A household that adds its children later can approve it
  from the Pictures screen.

Baselines are stamped at a fixed old time, so any picture an adult approves outranks them.
`scenes.mode` in `household.json` decides whether a picture shows at all: `off` shows only the
board, while `static` and `generated` both show the newest approved scene. The two differ only
in whether the Sunday generator runs. [scene-pipeline.md](scene-pipeline.md) §3 has the full
reasoning.

## 9. The scene tools

The weekly picture is made outside the app, by Python tools in `tools/`, and then registered
into the app as a candidate:

1. `scene-week.py` plans the week: a setting, a style, a camera and the activities.
   `--dry-run` prints the plan and the projected cost for free.
2. `gen-scene.py` draws the picture. The only references it attaches are the three committed
   avatars. All calls to the image service go through `tools/fal_api.py`, which allows only
   models that were measured to keep the children recognisable, and which writes every paid
   call to a local ledger (`db/fal-ledger.jsonl`).
3. `scene-regions.py`, the **finder**, asks a vision model where each child is, checks that
   each is whole, clothed and big enough to tap, and writes the manifest. If the finder cannot
   find all the children, the picture is refused.
4. Pictures that pass are registered as candidates. Two are offered each week, from two
   models. A grown-up chooses one on the panel.

`scene-week.timer` runs this every Sunday at 02:30 (`stacks/wall/systemd/`). An error is
retried every 30 minutes, at most four times. A refusal (exit 1) and a week over
`scenes.weeklyBudgetUsd` (exit 3) are not retried, because a retry would only pay again.
[scenes.md](scenes.md) covers models, costs and guardrails.

## 10. The Pi kiosk

The Pi is disposable. Everything it needs is in `pi/` and is pushed by `pi/scripts/deploy.sh`.
Chromium runs under labwc as a systemd user unit and loads exactly one URL: a loopback **gate**
(`pi/config/bin/kiosk-gate.py`).

- **The gate.** While the app answers, the gate redirects to it (302) and appends the device
  token as a fragment. While the app is down, the gate serves a local page: a live clock over
  the last-known-good screenshot. So the panel never shows a browser error page.
- **The probe** (`kiosk-probe.sh`) decides whether the app is up, from `/api/health`.
- **The watchdogs.** `kiosk-watchdog.sh` restarts Chromium when the app's reachability
  changes in either direction, because Chromium never retries a failed page by itself.
  `kiosk-liveness.sh` restarts a browser that is alive as a process but no longer responds.
  `kiosk-snapshot.sh` keeps the last-known-good screenshot fresh.
- **The network watchdog** (`net-watchdog.timer`) bounces the radio, then restarts
  NetworkManager, then reboots, if both the gateway and the app stay unreachable.
- **Screen power.** `screen-power.timer` sets the panel on or off every minute, from
  `SCREEN_ON_AT` and `SCREEN_OFF_AT`.

Scale is set in the browser (`KIOSK_SCALE=2.0`), so every screen is designed at 960×540
logical pixels.
