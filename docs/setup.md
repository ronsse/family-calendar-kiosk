# Setup

This guide takes you from a fresh clone to a wall running the example household, then to your
own household on a server and a Raspberry Pi. For repairs, see [runbook.md](runbook.md).

## 1. Prerequisites

- **Node 22 or newer.** `package.json` pins `>=22`. The server runs TypeScript directly with
  `node --experimental-strip-types`, so there is no compile step for the server.
- **Python 3.12 with Pillow** (`python3 -m pip install -r tools/requirements.txt`), for the
  scene tools in `tools/` and for `npm test`, which runs them. The wall itself does not need
  Python.
- **For a deployment:** a Linux host with Docker, and a Raspberry Pi 5 running Raspberry Pi OS
  Lite with a touch panel. Any browser works for development.
- **Optional:** the 1Password CLI (`op`). The deploy reads secrets from `op://` references, so
  no secret is ever written into a file.

## 2. Quick start (local, no Docker)

Run these from the root of your clone, in this order:

```bash
npm ci
npm run build                                                  # the server serves web/dist
npm run provision -- --household db/household.example.sql    # three synthetic children
npm run provision -- --settings db/household.example.json     # zone, features, the dog
npm run provision -- --pin 1111                                # the grown-up PIN
npm run provision -- --device "dev browser"                    # prints a device token, once
npm start                                                      # listens on :8124
```

Then open `http://localhost:8124/#dt=<token>`, using the token that `--device` printed.

Provisioning can run before the first start. Every `provision` run migrates the database and
registers the bundled art first, so `--household` finds the avatars it references. With no
`--db`, both `provision` and `npm start` use `./dev.db`. The server also reads these variables:

| Variable | Default | What it sets |
|---|---|---|
| `WALL_DB` | `./dev.db` | the SQLite file |
| `WALL_PORT` | `8124` | the port |
| `WALL_BIND` | `0.0.0.0` | the address to listen on |
| `WALL_ASSET_ROOT` | `assets/` beside the database | where pictures and icons are seeded |

The token goes into the URL fragment (`#dt=`), not the query string. The fragment never
reaches the server's access log. The page stores the token in `localStorage` and removes it
from the address bar. Reload the page after any later `provision` run.

The log line `calendar sync NOT running: homeassistant: HA_BASE_URL is not set` is expected
here. The example household has no calendar source configured.

## 3. What you should see

![The idle wall: a picture of three children and a dog](images/wall-picture.png)

The idle wall shows the committed baseline picture: three children and the dog, Biscuit. A
child taps herself in the picture to open her own screen. Inside the board windows (05:45 to
08:30 and 18:45 to 20:45 in the example) the wall shows the information board instead.

## 4. Your own household

Four files describe a household. Each has a committed synthetic twin. The real copies are
gitignored.

```bash
cp db/household.example.sql  db/household.sql    # children, routines, countdowns
cp db/household.example.json db/household.json   # timezone, features, board windows, pets, scenes
cp db/chores.example.json    db/chores.json      # the chore catalog and rosters
cp db/calendars.example.sql  db/calendars.sql    # which calendars render on the wall
```

Edit them, then apply them:

```bash
npm run provision -- --household db/household.sql
npm run provision -- --settings db/household.json
npm run provision -- --chores db/chores.json
```

Editing a file changes nothing until you apply it. `--household` resets what it owns: it
replaces the children, and their ledger goes with them. Run it once, before the household
starts earning. Every key in `household.json` is described in
[household-config.md](household-config.md). To check that file without a database, run
`npm run verify:config`.

Each child has a reading band (`picture`, `emergent` or `fluent`) and a ledger switch. Both are
set on the child row in `household.sql`. To change them in place, use
`npm run provision -- --band child-a=fluent --ledger child-c=on`.

Other shapes are supported: `db/household.solo.example.sql` has one child, and
`db/household.nokids.example.sql` has none.

## 5. Calendars

The wall never reads a calendar while it renders. A worker syncs each calendar into SQLite
every 15 minutes. Two sources exist, and `WALL_CALENDAR_SOURCE` picks one:

- **`homeassistant`** (the default). Home Assistant's Google Calendar integration. Each row in
  `db/calendars.sql` names a Home Assistant entity in `external_ref` (for example
  `calendar.family`). Set `HA_BASE_URL` and `HA_TOKEN`.
- **`ics`**. Each Google calendar's secret address in iCal format. Set one `ICS_URL_<REF>`
  variable per calendar, named from its `external_ref`: `calendar.school` becomes
  `ICS_URL_CALENDAR_SCHOOL`. This source has no OAuth token that can expire.

Apply the calendar rows with `npm run provision -- --calendars db/calendars.sql`. That file is
additive: it upserts by `id` and never deletes. Set `included` to `0` to hide a calendar.

The iCal addresses are bearer credentials. Put them in `stacks/wall/op.env` as `op://`
references, never as values. When an address fails, the error names the variable, never the URL.

## 6. Docker

The deployment is one container, defined in `stacks/wall/docker-compose.yml`.

```bash
cd stacks/wall
cp op.env.example op.env          # op:// references only; gitignored
op run --env-file=op.env -- docker compose up -d --build
docker logs family-calendar-wall | grep 'calendar sync'    # must say "scheduled"
```

Always deploy through `op run`. Plain `docker compose up -d --build` starts the wall with no
calendar credentials. The wall keeps rendering its last-synced events and labels itself
"Showing older information", so the mistake is easy to miss. Check the `calendar sync` line
after every deploy.

The container uses host networking on purpose. Docker's published ports bypass ufw, so the
compose file has no `ports:` block and ufw gates port 8124:

```bash
sudo ufw allow proto tcp from <lan-cidr> to any port 8124 comment 'wall app: LAN'
sudo ufw allow proto tcp from 100.64.0.0/10 to any port 8124 comment 'wall app: tailnet'
```

The database lives in the `wall-data` volume at `/data/wall.db`. Run `provision` inside the
container with `--db /data/wall.db`. [runbook.md](runbook.md) §1 shows each command. Set
the container's zone with `WALL_TZ`. A zone change also needs a container restart.

## 7. The Pi

The Pi is a kiosk: Chromium under labwc, pointed at one URL. From the server, run:

```bash
pi/scripts/deploy.sh wall-pi      # the ssh host is required (or set KIOSK_HOST)
```

`deploy.sh` exits with status 2 if you give it no host. It copies `pi/` to the Pi and runs
`setup.sh` there. `setup.sh` installs labwc, Chromium, the emoji font and the systemd units.
It is safe to run again.

The kiosk's settings are in `~/.config/kiosk.env` on the Pi. The first deploy seeds the file
from `pi/config/kiosk.env`, and later deploys never overwrite it.

| Key | Example | Meaning |
|---|---|---|
| `DASHBOARD_URL` | `http://homeserver:8124/` | the app. Use a hostname, never an IP |
| `WALL_DEVICE_TOKEN` | (from `--device`) | the device token for this panel |
| `KIOSK_SCALE` | `2.0` | browser scale. The UI is designed at 960×540 logical pixels |
| `SCREEN_ON_AT` / `SCREEN_OFF_AT` | `06:00` / `21:00` | when the panel is lit |

The screen is dark from 21:00 to 06:00 on purpose. A touch wakes it, and it goes dark again
after five idle minutes. Restart the browser with
`ssh wall-pi 'systemctl --user restart kiosk.service'`.

## 8. Pictures

The idle picture works with no setup: the committed baseline is registered on first boot.
A household can switch pictures off, put up its own photo for free, or have two new pictures
of its children drawn every week by a paid image model, for a grown-up to choose from.
[scenes.md](scenes.md) explains all three, what they cost, and the guardrails.

## 9. Troubleshooting

[runbook.md](runbook.md) is the repair guide, written to be followed at 6:05 AM by someone who
did not build the wall. Start with its §3 ("Does it actually work") and §4 ("When it is wrong").
