# Runbook — bringing the wall up, and fixing it when it isn't

First install? Follow [setup.md](setup.md) first; this runbook is for running and repairing the wall.

```yaml
status: active
last-review: 2026-08-25
audience: whoever is standing in front of a wall that is wrong
```

> Written to be followed at 6:05 AM by someone who did not build this. Commands are literal.
> If a step's check fails, stop there — the later steps assume the earlier ones passed.

## What you are bringing up

A Node app on **the home server** (`homeserver`) (port 8124) holding all state in one SQLite file, and a **Raspberry Pi**
running Chromium fullscreen against it. The Pi is disposable and holds no state. Home Assistant
stays running as a **calendar source only** — it is not the wall.

The one rule everything else defers to: **the wall must never be blank or wrong at 6:00 AM.**
Stale and labelled is acceptable. Blank, or confidently wrong, is a product failure.

---

## 0. Name resolution — closed, and how to tell

**The Pi resolves `homeserver` through Tailscale MagicDNS** (→ the server's tailnet address, e.g. `100.64.0.2`), verified 2026-08-25.
ROADMAP M0 and earlier drafts of this runbook called this an open blocker; it was fixed on
2026-08-24. Check rather than assume:

```bash
ssh wall-pi 'getent hosts homeserver || echo NXDOMAIN'
```

If it ever regresses, fix it **by name**, never by pinning an IP — the server's address has already
drifted once, and `/etc/hosts` on the Pi is cloud-init-managed so hand edits do
not survive a rebuild. Either the tailnet (MagicDNS serves the bare name) or a router-served
DHCP reservation.

---

## 1. homeserver — bring up the app

### 1.1 Secrets

```bash
cd ~/projects/family-calendar/stacks/wall
cp op.env.example op.env          # already gitignored
$EDITOR op.env                    # op:// REFERENCES only — never a token value
```

`op.env` and not `.env`: compose **auto-loads** `./.env`, so a forgotten `op run` would silently
interpolate the literal string `op://…` as the token. The failure mode is a calendar that never
syncs and says nothing useful about why.

Both `HA_BASE_URL` and `HA_TOKEN` may be omitted. The app then runs chores and routines with no
upstream calendar and **logs that it declined to schedule a sync** — the honest presentation of
"no calendar configured", rather than an empty week that looks like a quiet one.

### 1.2 Firewall

Host networking is deliberate: Docker's published ports **bypass ufw's chains**, a host-bound
socket does not. Do not add a `ports:` block.

```bash
sudo ufw allow proto tcp from <lan-cidr> to any port 8124 comment 'wall app: LAN'
sudo ufw allow proto tcp from 100.64.0.0/10 to any port 8124 comment 'wall app: tailnet'
```

### 1.3 Start it

```bash
op run --env-file=op.env -- docker compose up -d --build
docker compose logs -f            # ctrl-C once you see "listening on"
```

**Check:**

```bash
curl -s http://homeserver:8124/api/health
```

Expect `{"ok":true,"dbWritable":true,...}`. `dbWritable` runs a real write of the same size as a
morning's materialization and rolls it back — a trivial one-row probe still succeeds on a full
disk while the actual 06:00 write fails, so this endpoint deliberately does the expensive thing.

### 1.4 Provision — once

```bash
docker compose exec wall node --experimental-strip-types \
  stacks/wall/entry/provision.ts --device "living room wall"
```

**Copy the token it prints. It is shown once and nothing recovers it** — re-running `--device`
mints a new one and invalidates nothing, so you would then have two.

It also prints the database it wrote to. **Confirm that line says `/data/wall.db`.** Run outside
the container, `provision.ts` falls back to `./dev.db` — it succeeds, prints a perfectly good
token, and writes the hash somewhere the wall never opens. The wall then 401s and looks like a
revoked token.

```bash
docker compose exec wall node --experimental-strip-types \
  stacks/wall/entry/provision.ts --pin 1111          # choose your own
```

Until a PIN is set, **nothing can be approved.** The app fails closed and says so on boot.

### 1.5 Author the household — once, and whenever it changes

A migrated database has schema and no household: no children, no routines, no chores. The wall
comes up correct, authenticated, healthy and **completely empty**. M1 shipped no way to create
any of this — the admin API only approves, rejects and adjusts rows that already exist — so
until parent-facing authoring is built, a household is a SQL file.

```bash
cd ~/projects/family-calendar
cp db/household.example.sql db/household.sql     # household.sql is gitignored
$EDITOR db/household.sql                          # real names live here, never in the repo
```

Apply it into the running wall:

```bash
cd ~/projects/family-calendar/stacks/wall
docker compose cp ../../db/household.sql wall:/tmp/household.sql
docker compose exec wall node --experimental-strip-types \
  stacks/wall/entry/provision.ts --household /tmp/household.sql
```

It runs in one transaction and prints the row counts it produced — a half-applied household is
worse than an empty one. Asset ids come from `assets/manifest.json` and are registered at boot;
referencing one that does not exist is a foreign key error at apply time, which is the loud
failure you want.

**The wall will not notice on its own.** Writing SQL straight into the database bypasses the
app's SSE invalidation, so the panel keeps showing the snapshot it already had until the next
date boundary. Force it:

```bash
ssh wall-pi 'systemctl --user restart kiosk.service'
```

### 1.6 Changing the household's settings

The zone, locale, currency, switched-off surfaces, board windows, pet and scene preferences are
**a file**: `db/household.json`. The file is gitignored; `db/household.example.json` is the
template. Every key is documented in [`household-config.md`](household-config.md). The app
never reads this file. It reads rows, and only the command below writes them. **Editing the
file changes nothing on the wall until you apply it.**

1. **Edit** `db/household.json`. If it does not exist yet, copy it from
   `db/household.example.json` first.
2. **Apply** the file. The command reads it from stdin, so nothing needs copying into the
   container:

   ```bash
   docker exec -i family-calendar-wall node --experimental-strip-types \
     stacks/wall/entry/provision.ts --db /data/wall.db --settings - < db/household.json
   ```

   - **Success.** It prints `settings applied: timezone, locale, currency, features,
     board_windows, pets, scenes` and exits 0.
   - **Refused.** On any error it prints every problem as `<path>: <why>`, then `settings NOT
     applied: N error(s). Nothing was written.`, and exits 1. Fix the file and run it again;
     the rows are exactly as they were.
   - **Cannot be combined.** `--settings` will not run in the same command as `--household`.
3. **Make the wall see the change.** The apply sends no live update, so the panel picks the
   change up on its next snapshot fetch, which can take up to about 15 minutes. Restart the
   kiosk to make it immediate:

   ```bash
   ssh wall-pi 'systemctl --user restart kiosk.service'
   ```

   **If `timezone` changed, restart the container first.** The server reads the zone only at
   boot. Then check:

   ```bash
   docker logs family-calendar-wall 2>&1 | grep 'household timezone'
   ```
4. **Verify.**
   - The pet's sheet opens from the picture, if you have a pet.
   - A surface you switched off is gone from the children's screens.
   - Run `python3 tools/scene-week.py --dry-run`; its `budget  :` line shows the weekly cap.

**On an upgrade, apply the settings in the same deploy.** A wall upgraded from before this file
has no `pets` row. Until `--settings` is applied, the snapshot carries `dog: null` and the dog
door disappears.

#### The Sunday timer and its keys

Scene preferences (the `scenes` block) are read from the **file** by the scene tools on the
host, at their next run. You do not need to apply anything for them. The timer is wired like
this:

- **Keys.** `tools/op.env` is gitignored and holds `op://` references only, never a key. Copy
  it from `tools/op.env.example` and fill in your own vault and items.
- **What the unit runs.** `scene-week.service` runs `tools/scene-week-timer.sh`, which reads
  the service-account token from `~/.config/op-service-token` and runs `scene-week.py` under
  `op run`.

The exit codes:

| Exit | Means | Retried? |
|---|---|---|
| 0 | Ran. Also `scenes.mode` is `off` or `static`: nothing to draw | n/a |
| 1 | The finder refused both pictures. A verdict, and a retry would pay for the same one | no |
| 2 | Something errored. This includes `op run` failing: 1Password unreachable, a missing token, a missing `tools/op.env`, or a bad reference | yes, every 30 min |
| 3 | Over `scenes.weeklyBudgetUsd` for this week | no |

The unit says `RestartPreventExitStatus=1 3`. After editing anything in
`stacks/wall/systemd/`, reinstall with:

```bash
bash stacks/wall/systemd/install.sh
```

§6 below is the rest of the weekly-picture story.

### 1.7 Adding a birthday or other countdown

Countdowns beyond the ones `household.sql` creates go in **a file**, `db/countdowns.json`
(gitignored; the template is `db/countdowns.example.json`). Applying the file adds and updates
countdowns. It never deletes one and never touches the ledger, so unlike `--household` it is
safe at any time.

```bash
docker exec -i family-calendar-wall node --experimental-strip-types \
  stacks/wall/entry/provision.ts --db /data/wall.db --countdowns - < db/countdowns.json
```

- **Success.** It prints `countdowns: N added, N updated, N unchanged` and exits 0.
  Re-applying an unchanged file prints `0 added, 0 updated`.
- **Refused.** One bad entry refuses the whole file. Each problem is printed, then `Nothing
  was written.`, and it exits 2.
- **Removing one.** Set `"active": false`. The row stays.
- **After `--household`, apply this file again.** `household.sql` begins with
  `DELETE FROM countdown`, so a household re-apply removes every countdown that came from here.

Each entry is either a yearly date (`"annual": "MM-DD"`) or a one-off date (`"date":
"YYYY-MM-DD"`). `horizonDays` decides how close the date must be before the countdown appears:
leave it out for the wall's default of 60 days, or set `14` for a birthday that should appear
only in the last two weeks. As with `--settings`, restart `kiosk.service` to see the change at
once.

---

## 2. The Pi

```bash
pi/scripts/deploy.sh wall-pi      # from the server; the argument is the Pi's ssh host
```

`deploy.sh` **never overwrites `kiosk.env`** once it exists on the box — that file holds the
dashboard URL and the device token, and clobbering it on every deploy is exactly the footgun the
rule exists to prevent. So two values must be set by hand, once:

```bash
ssh wall-pi "sed -i 's|^DASHBOARD_URL=.*|DASHBOARD_URL=http://homeserver:8124/|' ~/.config/kiosk.env"
ssh wall-pi "sed -i 's|^WALL_DEVICE_TOKEN=.*|WALL_DEVICE_TOKEN=<paste-token>|' ~/.config/kiosk.env"
ssh wall-pi 'systemctl --user restart kiosk-gate.service kiosk.service'
```

`setup.sh` detects a leftover `:8123` and prints these exact lines, and its closing report shows
`device token: MISSING` when the token is unset.

**How the token reaches the browser:** the gate appends it to its 302 as a URL **fragment**
(`#dt=…`), the bundle lifts it out and scrubs the URL with `history.replaceState`. A fragment is
never sent on the wire and never lands in an access log. The token is *not* served in the HTML —
doing that would hand a wall credential to any device on the LAN that can `GET /`.

**Check:**

```bash
ssh wall-pi 'systemctl --user is-active kiosk.service kiosk-gate.service'
ssh wall-pi 'curl -s -o /dev/null -w "%{http_code}\n" http://homeserver:8124/api/health'
```

---

## 3. Does it actually work

The full acceptance walk is `docs/build-plan.md` §5. Steps 1–4 are automated:

```bash
cd ~/projects/family-calendar && npm test
```

Expect **0 failures**, 2 skipped, 3 todo. The 2 skips are the two steps that need the panel and
cannot be honestly faked — do those by hand:

**Profile wipe** — the wall must come back with zero human input:

```bash
ssh wall-pi 'rm -rf ~/.config/chromium-kiosk && systemctl --user restart kiosk.service'
```

**Pull the plug** — cut power at the wall, restore it, and touch nothing. The dashboard must be on
screen and touch-responsive. This is the one test that matters most and the one no CI can run.

**Backend down** — `docker compose stop` on homeserver. The wall must show the last-known-good
screenshot with a clock, **not** a browser error. `start` again and it returns on its own.

---

## 4. When it is wrong

Work down the ladder. Each rung tells you which rung below it to check.

| What you see | Check | Likely cause |
|---|---|---|
| Fallback page with a saved screenshot | `ssh wall-pi 'getent hosts homeserver'` | §0 — name does not resolve |
| Fallback page, name resolves | `curl http://homeserver:8124/api/health` | app down; `docker compose logs` |
| "Offline card" in the app's own UI | `ssh wall-pi 'grep WALL_DEVICE_TOKEN ~/.config/kiosk.env'` | token missing or revoked (§1.4, §2) |
| Token is set, and still rejected | `ls -l ~/projects/family-calendar/dev.db` | provisioned outside the container — the hash went to `dev.db`, not the volume (§1.4) |
| Renders, but nothing can be approved | `docker compose logs \| grep -i pin` | no parent PIN set (§1.4) |
| Renders, but the week is empty | `docker compose logs \| grep -i sync` | no calendar configured, or `HA_TOKEN` is the literal `op://…` string (§1.1) |
| "Showing older information" | `curl -s http://homeserver:8124/api/health` | sync failing; the wall is *correctly* labelling itself stale |
| `calendar sync: 0 ok, N failed` | `python3 tools/ha-google-token-probe.py` | `ALIVE` means the token is fine and HA merely stopped retrying — reload it, §4.1. Anything else is a real credential problem, also §4.1 |
| Grey placeholder icons everywhere | `docker compose logs \| grep -i asset` | asset volume not seeded — see below |
| The picture never changes, or old art after a deploy | `docker logs family-calendar-wall \| grep -E 'seeded\|refreshed\|locally-modified'` | a hand-placed file is winning over the shipped one — see **Art that will not update** |
| No new picture this week | `systemctl --user list-timers scene-week.timer` | the weekly run — §6 |
| Wall stuck on yesterday | reload the kiosk | date-boundary refetch; capture the console before restarting, this should not happen |
| **Picture looks perfect, nothing responds to touch** | `ssh wall-pi 'lsusb \| grep -i elo'` | the touch cable, **not** the software — see **Touch is dead and everything says healthy** |

**Icons.** `assets/` ships a baseline set with a manifest, installed into the volume **and**
registered in the database on every boot. If icons are missing, the volume is not mounted where
the app expects.

**Art that will not update.** Until 2026-09-08 the seeder was *copy-if-absent*, so a committed
picture that CHANGED could never reach the wall again — a file was already at its path, and the
seeder skipped it silently. Six files were stale for two weeks, including two of the three
avatars, and the only symptom was that the art never changed. It now refreshes anything it
recognises as its own and says what it did on every boot:

```
docker logs family-calendar-wall | grep -E 'seeded|refreshed|locally-modified'
```

`kept N locally-modified asset(s)` names files somebody replaced by hand (`docker cp`). Those
win over the shipped copy on purpose and are reported **every boot**, because an override that
is invisible after the deploy that made it is how the wall ends up serving art nobody remembers
placing. To give a path back to the baseline, delete it from the volume and restart.

**Touch is dead and everything says healthy.** The 2270L carries video and touch on **separate
cables**, so the wall can render a flawless, live, up-to-date screen that ignores every finger.
Every check in this runbook passes, because every one of them is about the half that still
works. Seen 2026-09-08: the panel and the USB hub in front of it disconnected in the same
millisecond, and the display never flickered.

```bash
ssh wall-pi 'lsusb | grep -i elo'                      # nothing = touch is gone
ssh wall-pi 'dmesg -T | grep -iE "usb 3-2|elo" | tail' # when, and whether it was clean
ssh wall-pi 'vcgencmd get_throttled'                   # 0x0 = not a power-supply brownout
```

A **clean** `USB disconnect` with no over-current, no `xhci` errors and `throttled=0x0` is a
physical disconnection, and nothing on the Pi can fix it. Read *which* device dropped:

- **`3-2.4` alone** — the panel's own USB lead.
- **`3-2` and `3-2.4` together** — the hub itself vanished, so it is the hub's upstream lead
  into the Pi, or the hub's power. **Check this one first**; it is what happened.

Worth one attempt before walking to the wall, because it is free and cannot blank the display
(video is HDMI, and the Pi boots from the SD card, so no USB storage is at risk — **verify that
with `findmnt -n -o SOURCE /` before running it**, since a Pi booting from a USB SSD would lose
its root filesystem):

```bash
ssh wall-pi 'sudo sh -c "echo xhci-hcd.1 > /sys/bus/platform/drivers/xhci-hcd/unbind"; sleep 3; \
             sudo sh -c "echo xhci-hcd.1 > /sys/bus/platform/drivers/xhci-hcd/bind"; sleep 5; lsusb'
```

If the root hubs come back and the Elo does not, the cable is out. Go and reseat it.

**Do not diagnose touch with CDP.** `Input.dispatchMouseEvent` injects into Chromium *below*
the input stack, so a dead touchscreen still passes every scripted tap — which is how this one
initially read as "the app responds fine". Only `lsusb` and `libinput list-devices` answer the
question actually being asked.

**Never pin the server's IP** to work around a DNS problem, however tempting at 6:05 AM. It has
drifted before and it will drift again, and the pinned copy will be somewhere nobody remembers.

---

## 5. Deliberately manual, and why

These look like gaps. They are decisions.

- **`kiosk.env` is never overwritten by deploy.** It holds the one credential the Pi has.
- **The device token is shown once.** Nothing stores the plaintext; the database keeps a hash.
- **No lockout on repeated wrong PINs.** A child mashing the pad must not be able to lock a parent
  out of approvals — the threat model here is a seven-year-old, not an attacker.
- **The backend being down shows a screenshot, not an error.** Accepted limit: it is pixels, not a
  live UI, so a chore cannot be ticked off the fallback.
## 5b. Starting the board over

For a testing run — you want your own taps to be the only signal, and fifteen days of
half-used history is noise you cannot tell apart from real use afterwards.

```bash
cd stacks/wall && docker compose exec wall node --experimental-strip-types \
  stacks/wall/entry/provision.ts --db /data/wall.db --reset-activity
ssh wall-pi 'systemctl --user restart kiosk.service'
```

**Setup survives, use does not.** Chores, routines, children, countdowns and calendar sources
are untouched — they are the thing being tested. What goes is every record of the wall being
used: materialized days and their claims, routine runs, redemption requests, and the door-tap
counters. Today's board rebuilds on the next snapshot, because materialization is a pure
function of the definitions and the date, so this is safe to run as often as you like.

**It refuses when the ledger has rows**, and that refusal is the only thing holding the line:
`ledger_entry.ref_id` is TEXT with no foreign key — deliberately, so the append-only record of
real money outlives the chore it refers to — which means nothing in the database stops a wipe
from orphaning it. `--force` is the deliberate way past, and it deletes the ledger too rather
than leaving it pointing at nothing.

Take a copy first if the wall has been in real use:

```bash
docker exec family-calendar-wall node -e \
  'new (require("better-sqlite3"))("/data/wall.db",{readonly:true}).backup("/data/wall.db.bak")'
```

---

## 6. The weekly picture

Two new search-and-find scenes are generated **Sunday 02:30** by `scene-week.timer`, a
systemd *user* unit (`stacks/wall/systemd/`, installed by `install.sh`) — one from each of two
fal.ai models, so the Sunday review is a choice rather than a verdict. It costs about
**$0.20** — the two images plus the vision passes that find the three children in each.
`python3 tools/fal_api.py` prints what has been spent so far (fal has no balance page).

**It never changes what is on the wall.** The scene is registered as a `candidate`, and a
candidate is not eligible for display at any price: somebody has to look at it and approve it.
So the worst outcome of a failed Sunday is that the wall keeps last week's picture, which is why
this is safe to run unattended at all.

```bash
systemctl --user list-timers scene-week.timer      # when does it next run
journalctl --user -u scene-week.service -n 60      # what happened last time
python3 tools/scene-week.py --dry-run              # the brief for this week, free
python3 tools/scene-week.py --write-activities     # write + freeze the activities, draw nothing (~$0.002, needs FAL_KEY)
docker exec family-calendar-wall node --experimental-strip-types \
  stacks/wall/entry/provision.ts --db /data/wall.db --scenes   # the catalog, and which is up
```

**To put a picture up:** the picture door in the wall's header (third icon, a framed
landscape) → tap the one you want → **Put this up** → PIN. Approving is also choosing, so
approving a scene from three weeks ago is how you go back to it. **Retire** takes one out of
service; the row stays, because the catalog is a history.

**Review it on the panel, not on a laptop.** This wall is 225 nits behind anti-glare etched
glass and colours that separate on a laptop collapse on it. That is the whole reason this
screen exists rather than a file browser.

Three failure modes worth knowing:

| Message | Means | Do |
|---|---|---|
| `REFUSED by the region finder` | The gate worked. A child was under the tap floor, too small, inside the gutter, facing wrong, or matched to the wrong portrait | Nothing, if the other candidate was offered. The image is kept in `/tmp/scene-week/`; delete it and re-run to buy another, or wait for next week |
| `ERRORED — not judged` | It never got an answer — an upstream 5xx, not a judgement | Re-run. Generated images are reused, so this costs only the vision passes |
| `fal submit 402` / `403` | The fal balance is out, or the key is wrong | Top up at fal.ai; the key is the `op://` reference in `tools/op.env` |
| `registration reported success but … is NOT in the catalog` | The container is older than the script | `cd stacks/wall && op run --env-file=op.env -- docker compose up -d --build` |

`op` needs `OP_SERVICE_ACCOUNT_TOKEN` in the environment. The unit reads it from
`~/.config/op-service-token`; if you run the script by hand, export it first.

**Lingering must be on** (`loginctl show-user $USER --property=Linger`), or the timer is
installed, enabled, and never fires on a headless box — which looks exactly like the bug this
whole thing was built to fix.

---

### 4.1 `calendar sync: 0 ok, N failed` — and why the obvious answer was wrong

**Symptom:** the wall shows *"Showing older information"*, and
`docker logs family-calendar-wall | grep 'calendar sync'` says `0 ok, 3 failed, 0 events`.
The wall's own HA token is fine — `/api/` answers 200 — but `/api/calendars` returns **404**,
because Home Assistant has no calendar entities. The HA log is full of:

    google integration could not authenticate: 400 Bad Request
      https://oauth2.googleapis.com/token

**DO NOT GO TO GOOGLE FIRST.** That reads like an expired token and on 2026-09-08 it was not
one. The refresh token was alive the whole time; HA had marked the config entry failed, stopped
retrying, and kept logging the original error. A single integration reload fixed everything.
Publishing an OAuth app or re-running a consent flow would have "fixed" it too — and taught the
wrong lesson permanently.

**Step 1 — ask Google whether the token is actually dead.** One command, no browser:

    python3 tools/ha-google-token-probe.py

| It prints | Meaning | Go to |
|---|---|---|
| `ALIVE` | Credentials are fine; HA just stopped retrying | **Step 2** |
| `invalid_grant` | The refresh token really is dead | **Step 3** |
| `invalid_client` | The OAuth client was deleted or its secret rotated | **Step 3b** |

**Step 2 — reload the integration.** No browser, no consent:

    EID=$(python3 -c "import json,pathlib;d=json.loads(pathlib.Path('stacks/homeassistant/config/.storage/core.config_entries').read_text());print(next(x for x in d['data']['entries'] if x.get('domain')=='google')['entry_id'])")
    curl -s -X POST -H "Authorization: Bearer $HA_TOKEN" \
      "http://homeserver:8123/api/config/config_entries/entry/$EID/reload"
    docker restart family-calendar-wall
    docker logs family-calendar-wall | grep 'calendar sync' | tail -1   # wants: N ok, 0 failed

**Step 3 — only when the token is genuinely dead.** Re-authorise: <http://homeserver:8123> →
**Settings → Devices & Services** → the Google Calendar entry offers *Reconfigure* or a
**Repair**. If it then dies again about a week later, the consent screen is in **Testing**
status, which expires refresh tokens after 7 days. Publishing status now lives at
<https://console.cloud.google.com/auth/audience> — Google folded "OAuth consent screen" into
**Google Auth Platform** in 2024 (Overview / Branding / **Audience** / Clients / Data Access),
so it is not on the page of the old name. Press **PUBLISH APP**. External with a personal Gmail
is fine; verification is only required for sensitive scopes on apps with users outside your own
account, and the "unverified app" interstitial at sign-in is expected — *Advanced → Go to (app)*.

**Step 3c — get off OAuth entirely: the iCal adapter.** If the token keeps dying and the
app cannot be published (Branding wants a logo and a verified domain), stop using HA for
calendars. Each Google calendar has a **secret address in iCal format** (Google Calendar → the
calendar's ⋮ → *Settings and sharing* → *Integrate calendar*). It has no token to expire.

1. Put each secret address in 1Password, one field per calendar. The address IS a credential:
   anyone holding it reads that calendar. Never paste it into a file, a commit or a chat.
2. In `stacks/wall/op.env`, uncomment `WALL_CALENDAR_SOURCE=ics` and one `ICS_URL_*` per
   included calendar. The variable is the `calendar_source.external_ref` uppercased, with
   every non-alphanumeric character turned into `_` (`calendar.school` → `ICS_URL_CALENDAR_SCHOOL`),
   so the database does not change and neither do its include flags or keep-terms.
3. Deploy (§1.3) and check: `docker logs family-calendar-wall | grep 'calendar sync'` must say
   `scheduled (ics)` and then `N ok, 0 failed`.

An included calendar with no `ICS_URL_*` FAILS its sync (`… is not set`) and goes stale on the
wall rather than empty. **Rolling back** is `WALL_CALENDAR_SOURCE=homeassistant` and a redeploy.
A `404` in the sync error means the address was reset in Google: copy the new one into
1Password and redeploy. Errors name the variable, never the address.

**Step 3b — `invalid_client`.** The id/secret HA holds no longer resolves. Check Google Auth
Platform → **Clients**, then re-enter the pair under **Settings → Devices & Services → ⋮ →
Application Credentials**, then Step 3.

**Why it hid for six days.** HA keeps already-created calendar entities in memory, so the wall
kept reporting `3 ok, 48 events` long after the integration went unhealthy. Only the next HA
restart cleared them. **A restart does not cause this; it reveals it.** If a sync starts failing
right after you restart HA, read this section before auditing what you changed.

**Nothing is lost while it is broken.** Calendars sync *into* SQLite and the wall renders from
there, so it keeps showing the last good week and labels itself stale — which is also exactly
why this goes unnoticed. The screen looks fine.

- **The wall labels itself stale rather than hiding.** Stale-and-labelled satisfies the invariant;
  stale-and-confident does not.

---

## 7. Backups, and restoring the wall

Everything the wall knows lives in one Docker volume, `wall_wall-data`: the points ledger and
every approval in `wall.db`, and the generated picture library in `assets/scenes/`. A
generated picture exists **nowhere else**. The host's own nightly backups may not reach
`/var/lib/docker`, so the wall backs itself up: `wall-backup.timer` (a user unit, installed
with scene-week's by `stacks/wall/systemd/install.sh`) runs `tools/wall-backup.sh` at 04:45
UTC into `$WALL_DATA_ROOT/backups/family-wall/wall-<stamp>.tar.gz` (or `$WALL_BACKUP_DEST`)
and keeps 30; copy that directory off the box with whatever mirror the host already runs. The database is copied with SQLite's online backup and
integrity-checked before it is kept, so a copy that would not restore fails the night it is
taken.

```bash
systemctl --user list-timers wall-backup.timer        # when it last ran
journalctl --user -u wall-backup -n 5                 # "integrity ok, 3 children, N scenes"
ls -lt "$WALL_DATA_ROOT/backups/family-wall" | head -3
```

**Restoring** replaces the wall's state with the copy, so anything since the backup (claims,
approvals, points) is lost. The current files are kept beside it as `*.before-restore`.
Rehearsed against a throwaway volume on 2026-10-06.

```bash
cd ~/projects/family-calendar/stacks/wall
B="$WALL_DATA_ROOT/backups/family-wall/wall-<stamp>.tar.gz"   # pick one
mkdir -p /tmp/wall-restore && tar -xzf "$B" -C /tmp/wall-restore
docker compose stop wall
docker run --rm --user 0 --entrypoint sh -v wall_wall-data:/data \
  -v /tmp/wall-restore/wall:/restore:ro wall-wall -c '
    set -e; mkdir -p /data/assets
    for f in wall.db wall.db-wal wall.db-shm; do
      [ -e /data/$f ] && cp -a /data/$f /data/$f.before-restore; done
    rm -f /data/wall.db-wal /data/wall.db-shm
    cp /restore/wall.db /data/wall.db
    cp -a /restore/assets/. /data/assets/
    chown -R 1000:1000 /data'
OP_SERVICE_ACCOUNT_TOKEN="$(cat ~/.config/op-service-token)" \
  op run --env-file=op.env -- docker compose up -d
docker logs family-calendar-wall | grep 'calendar sync'   # must say scheduled
```
