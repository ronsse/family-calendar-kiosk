# CLAUDE.md

Guidance for Claude Code working in this repo.

## Purpose

Wall-mounted **kid-facing family calendar** for the living room. It has exactly four jobs:
help the children run their **routines**, do their **chores**, **earn money/stars**, and know
**what is upcoming**. A Raspberry Pi 5 drives an Elo **2270L** touch panel as a **dumb kiosk**;
all logic and state live on the home server (`homeserver` in these docs).

**This is a custom app, not a Home Assistant dashboard.**
[ADR-0004](docs/decisions/0004-build-the-app.md) (2026-08-24) supersedes ADR-0001: HA is
demoted to a *calendar source behind an adapter*, kept only because its Google Calendar OAuth
is finished and in production. Lovelace is gone. Anything below that reads as "HA is the
architecture" is the old plan.

Status: the Pi is on the tailnet, resolves `homeserver` via MagicDNS, and the kiosk stack is
installed and verified (labwc + Chromium under a systemd user unit, autostarting on boot).
HA is onboarded with 7 `calendar.*` entities. The app is built and on the wall (M1 done).
The panel is connected and touch works with no driver.

## Commands

```bash
# Home Assistant stack — CALENDAR SOURCE ONLY (ADR-0004). Not the architecture.
cd stacks/homeassistant && docker compose up -d
cd stacks/homeassistant && docker compose logs -f
cd stacks/homeassistant && docker compose down          # keeps config/
cd stacks/homeassistant && docker compose down && rm -rf config/.storage   # nukes onboarding + auth

# Reach it
curl -sf http://homeserver:8123/manifest.json               # liveness
# UI: http://homeserver:8123  (LAN + tailnet only; ufw gates 8123)
# The ONLY thing we consume from HA is calendar state, via the CalendarSource adapter:
curl -sf -H "Authorization: Bearer $TOKEN" http://homeserver:8123/api/calendars

# Pi kiosk — run from the server; pushes pi/ to the box and runs setup.sh there
pi/scripts/deploy.sh wall-pi   # host argument required (or KIOSK_HOST)
ssh wall-pi 'systemctl --user status kiosk.service'     # is the browser up?
ssh wall-pi 'systemctl --user restart kiosk.service'    # reload the dashboard
ssh wall-pi 'cat /run/user/1000/labwc.log'              # compositor log (tty1 session)
```

The kiosk's one knob is `DASHBOARD_URL` in `<pi>/.config/kiosk.env` (seeded from this repo's
`pi/config/kiosk.env`). `deploy.sh` never overwrites it once it exists.

## Architecture

- **The app** (to be built, M1) — Node 22 + TypeScript, one container on the server: SQLite store,
  Fastify + REST with SSE for live updates, React/Vite frontend served by the same process.
  Owns chores, the points ledger, routines, and all three per-child renderings.
- `stacks/homeassistant/` — HA container. **A calendar source, nothing more.** It sits behind a
  `CalendarSource` interface with two implementations — `HomeAssistantCalendar` (now) and
  `GoogleCalendar` (direct API, later). **Nothing outside that adapter may know HA exists**;
  that is what keeps the swap a config change.
- `pi/` — everything that runs on the Pi. Kiosk config + setup script. Substrate-agnostic — it
  points Chromium at a URL — so it survived the ADR-0004 pivot untouched. Must stay
  reproducible from scratch; the Pi is disposable.
- `docs/` — PRD, ROADMAP, ADRs, calendar structure.
- **Render from local state, always.** Calendars sync *into* SQLite on a schedule; the wall
  never blocks on Google, on HA, or on the network. This is how "never blank at 6:00 AM" is
  satisfied structurally rather than by fallback.

## Gotchas

- **An ssh alias pointed at the Pi's ethernet lease is dead — use one that reaches `wlan0`, or
  the tailnet name (`wall-pi` in these docs).** `eth0` is down; `wlan0` carries the box, and an
  alias still pointing at the old ethernet lease times out. Re-confirmed 2026-08-24.
- **DNS is solved — do not "fix" it again.** The Pi resolves `homeserver` through Tailscale MagicDNS
  (`nameserver 100.100.100.100`, search `example.ts.net`); `getent hosts homeserver` →
  100.64.0.2 and HA answers **200 in 11ms** by bare name. No IP is pinned anywhere and
  `DASHBOARD_URL` needed no change. If this ever regresses, fix it by *name* — never by pinning
  an IP. (CLAUDE.md and PRD §3 both claimed this was an open blocker until 2026-08-24; it had
  been fixed the day before.)
- **The Pi's Wi-Fi dropped overnight and NOTHING retried (2026-10-04).** Off the LAN and the
  tailnet from ~01:45 for eight hours; the panel honestly showed last-known-good under
  "reconnecting" and a power cycle fixed it. The cause is unknown because Pi OS keeps the
  journal in RAM (`Storage=volatile`) and the reboot erased it. `setup.sh` now turns Wi-Fi power
  save off (NetworkManager conf.d, so it survives cloud-init's netplan), persists the journal
  (64M cap), and installs root's `net-watchdog.timer`: radio bounce at 3 failed minutes,
  NetworkManager restart at 8, reboot at 15 only if the boot is over an hour old. "Down" needs
  BOTH the gateway ping and the wall app to fail. **Next time, read `sudo journalctl -b -1 |
  grep net-watchdog` before anything else.** And do not hunt for the Pi by MAC prefix: its
  wlan0 OUI is not a Raspberry Pi OUI, so a sweep that "found no Pi" proves nothing.
- **The Pi's `/etc/hosts` is cloud-init-managed** (`manage_etc_hosts: True`). Hand edits are
  reverted on rebuild — put host mappings somewhere that survives, or use a real name.
- **Debian 13 renamed the browser package to `chromium`.** `chromium-browser` still resolves,
  to a stale deb12 build. `pi/config/bin/kiosk-run.sh` resolves the binary at runtime rather
  than hardcoding either name; don't "fix" it back to a literal path.
- **Pi OS Lite has no display manager**, so nothing starts a compositor for you. Autologin on
  tty1 (`getty@tty1.service.d/autologin.conf`) drops a login shell, and `<pi>/.bash_profile`
  execs labwc from it. That chain is the boot sequence — breaking any link blanks the wall.
- **Never gate the setup script on `XDG_SESSION_TYPE`.** An earlier version refused to run
  unless Wayland was already up, which over SSH on a Lite box is never true: the script that
  installs the compositor would not run until the compositor was running.
- **`kiosk.service` sets `StartLimitIntervalSec=0` on purpose.** systemd's default (5 starts
  in 10s, then `failed` forever) would permanently dark the display over a transient fault.

- **The no-cloud rule is two tests, not a blanket ban** (ADR-0002): *disclosure* (does the
  payload contain household data?) and *availability* (does 6:00 AM depend on the call?).
  Routine icons pass both and may be generated in the cloud as build-time assets. Flyer OCR
  fails disclosure and is NOT covered — do not let "images are fine" creep into it.
- **Never point a conversation agent at a LiteLLM tier** (relevant again only if the iceboxed
  assistant returns). `aux` falls back to `bulk`, which hits NVIDIA first — that ships the
  household schedule to a hosted provider. Pin a local model, or point straight at Ollama on
  the server.
- **`docker compose up -d --build` on the wall stack is WRONG and fails silently.** The real
  command is `op run --env-file=op.env -- docker compose up -d --build` (see the runbook).
  Without it `HA_BASE_URL`/`HA_TOKEN` are empty, the calendar adapter is not configured, and
  the boot log says `calendar sync NOT running`. Nothing appears to break: the wall keeps
  rendering the last-synced events out of SQLite and honestly labels itself *"Showing older
  information"* — which is the render-from-local-state design working exactly as intended, and
  is also why three deploys in a row went unnoticed on 2026-08-27. **After every deploy check
  `docker logs family-calendar-wall | grep 'calendar sync'`**; it must say `scheduled`, not
  `NOT running`.
- **HA's calendar endpoint answers 200 from a FROZEN copy when its Google login dies.** Google
  refused HA's refresh token on 2026-09-15 (also 08-31 and 09-06: `400` from
  `oauth2.googleapis.com/token`), every `calendar.*` entity went `unavailable`, and
  `/api/calendars/<entity>` kept serving the 09-15 snapshot. The wall logged `4 ok, 0 failed`
  for seventeen days and a child's music club, added 09-23, never arrived. Seventh instance of
  the signature bug. The adapter now reads `/api/states/<entity>` after every fetch and fails
  the sync on `unavailable`, so the log says `N failed` and the wall goes stale honestly. The
  FIX is a re-auth in HA's UI (Settings → Devices & services → Google Calendar). A refresh
  token dying about weekly is the signature of a Google Cloud OAuth app left in **Testing**
  publishing status (7-day refresh tokens). Publishing it to production stops it.
- **There is a second calendar adapter, and it has no OAuth to die: `src/calendar/ics/`**
  (2026-10-04). It reads each Google calendar's *secret address in iCal format* directly and
  expands it with ical.js (MPL-2.0). `WALL_CALENDAR_SOURCE=ics` selects it; one
  `ICS_URL_<EXTERNAL_REF>` per calendar, so the `calendar_source` rows do not change and a
  rollback is one line. Three things in it are load-bearing: **(1)** the addresses are bearer
  credentials — op.env only, and every thrown message names the VARIABLE, never the URL, with
  a test that greps for the secret; **(2)** ical.js leaves `DTSTART;TZID=…` FLOATING (the
  TZID is just a parameter), so `zone.ts` anchors it through Intl — trusting ical.js's
  `toUnixTime()` there puts every event 6-7 hours off; **(3)** overrides are matched by hand,
  not `relateException`, because the iterator only walks as far as the window and an
  occurrence moved INTO the window from a later week would never be visited. Google's
  contact *Birthdays* calendar may have no iCal address at all; if not, exclude `cs-birthdays`
  rather than let it fail every sync.
- **`op` needs `OP_SERVICE_ACCOUNT_TOKEN` exported by hand in an agent shell.** The operator's
  global notes say it is auto-loaded in `.bashrc`; that holds for an interactive login and NOT for the
  shell these tool calls run in, where `op run` fails with "no account found". Prefix with
  `OP_SERVICE_ACCOUNT_TOKEN="$(cat ~/.config/op-service-token)"`.
- **Verify an exit code directly, never through a pipe.** `cmd | tail; echo $?` reports
  *tail's* status, not the command's. This misread a refused `--chores` run and a split
  decision panel as successes within an hour of each other on 2026-08-27. Redirect to a file,
  or read `${PIPESTATUS[0]}`.
- **A `web/src/views/logic/*.ts` module may never import from a `.tsx`.** The test runner is
  `node --experimental-strip-types`, which strips `.ts` and NOT `.tsx`, so a logic module that
  imports even a *type* from a component file cannot be unit-tested at all — the whole test file
  fails to load with `ERR_UNKNOWN_FILE_EXTENSION`, and `tsc` and `vite build` both stay green,
  so nothing warns you. The dependency runs the other way: shared types and parsers live in the
  `.ts` module and the component imports them. `parseSceneManifest` moved out of `SceneView.tsx`
  for exactly this reason on 2026-08-27.
- **`seedAssets` used to be copy-if-absent, and that hid two weeks of work.** A committed
  picture that CHANGED could never reach the wall again: a file already sat at its path, so the
  seeder skipped it forever. Six files were stale on 2026-09-08 including two avatars, and the
  only symptom was that the art never updated. It now refreshes what it recognises as its own
  and keeps anything a human placed by hand, tracked in `.seeded.json`. **After a deploy that
  changes art, check `docker logs family-calendar-wall | grep -E 'refreshed|locally-modified'`.**
- **A generated scene is a CANDIDATE and never goes up on its own.** `scene-week.timer` runs
  Sunday 02:30 and offers a picture; a human approves it on the panel behind the PIN. Three
  children navigate BY that picture — they find themselves in it and tap themselves — so
  unattended promotion is the one automation this feature must not have. Approving is also
  SELECTING: the wall shows the most recently approved scene, which is why there is no separate
  pin and why re-approving an old one is how you go back.
- **`provision.ts` refuses unknown flags, and that is load-bearing.** It used to ignore them,
  so `--add-scene` against a container built before that flag existed printed a device list and
  exited 0 while registering nothing. If you add a flag, add it to `KNOWN_FLAGS` — a test
  derives the list from the source, so forgetting is a test failure, not a silent no-op.
- **A dry Nous account says 402, and CHEAP CALLS STILL RETURN 200.** There is no balance API
  (below), so this is the only signal there is, and it is a confusing one: on 2026-09-10 a batch
  of six scenes generated ONE image and then every call — including the $0.007 vision pass —
  came back `HTTP 402 Payment Required`, while a two-token text completion to the *same models*
  answered 200 with a `cost` field. The key was live; the balance was simply under the price of
  the next call. **Probe with a two-token completion before concluding the key or the endpoint
  is broken**, and read a 402 as "top up", never as "misconfigured".
- **Scenes go to fal.ai now, and the three avatars are enough — measured 2026-09-12.** Eight fal
  models, three styles (cartoon, anime, photoreal), the real prompt and the real avatars:
  `nano-banana-2/edit` ($0.12, 2K), `nano-banana-pro/edit` ($0.15) and `openai/gpt-image-2/edit`
  ($0.053, native 1080p) ALL held the three children in every style; FLUX.2-pro held the cast
  too but cannot leave cartoon for photoreal, Seedream drew four, Kontext drew the wrong ones.
  (The first write-up said FLUX "dropped the boy" — it had changed his jacket. Identity is
  COUNT, HEIGHT ORDER and HAIR, never clothes or faces; those are meant to vary, and the prompt
  says so.) No more references, no better descriptions and no LoRA training are needed. The
  plan, evidence and the likeness line are in `docs/scene-imagery-plan.md`; the pictures are in
  a scratch directory outside the repo. Scenes must NOT go through the LiteLLM `image` tier — it is
  text-to-image and cannot take the avatars, and a fallback leg would hand back the wrong
  children silently. **`tools/fal_api.py` is the only door**: its `MODELS` allowlist is the
  guardrail (a model that draws four children produces a picture that LOOKS like a scene and
  is not one), and it appends every paid call to `db/fal-ledger.jsonl` because fal has no
  balance API and no cost in its responses — `python3 tools/fal_api.py` prints the total.
- **The cast is a FILE, and the generator and the finder read the same one.** `db/cast.json`
  (gitignored; `db/cast.example.json` is the committed synthetic twin) carries each child's
  age, sex, hair and height, and `tools/scene_cast.py` turns it into the prompt's roster,
  height-as-body-landmark lines ("comes up to child 1's chin") and the finder's description.
  Before 2026-09-12 the two scripts each had their own wording and had drifted (the finder
  still described an old hairstyle). Eye colour is NOT in the contract: at scene scale an eye is two
  pixels on the glass. Heights were MEASURED 2026-09-16
  and `height_source` says so; the estimates they replaced were each 8–9 cm low and yet
  proportionally RIGHT — every ratio stayed inside its landmark band, so the prompt's sentence
  did not move. Heights only ever reach the prompt as ratios, so re-measure when they grow and
  not because a number looks stale. The prompt itself is version 2 (`gen-scene.py --prompt-version 1` is the control;
  `--print-prompt` shows either for free); its design review is `docs/scene-prompting-review.md`.
  What the household can supply to improve all of this is `docs/scene-inputs.md`.
- **Identity has TWO channels and the AVATAR is the stronger one.** The roster text is *read*;
  the three portraits are *attached* to the edit model, which copies them — so when the two
  disagree the picture wins, and fixing only the words changes nothing. Measured 2026-09-16
  against photographs the household supplied: `db/cast.json` and `assets/avatars/a.jpg` each
  described the eldest's hair differently, and the photographs agreed with neither. Both
  halves are fixed now (`hair` rewritten on all three, plus a generator-only `looks` build
  clause; three `edit-avatar.py` runs, $0.16). **A haircut is a prompt change AND an avatar
  change** — `docs/scene-inputs.md` row 3. Scenes approved before the repaint still show the
  old hair; the first pictures drawn from the corrected bible are the timer's next Sunday pair.
- **The photographs live outside the repo (under `$WALL_DATA_ROOT`), and nothing will ever move
  them into the repo.** `prompt_guard.enforce_references` refuses any attachment that is not *both*
  inside `assets/` *and* tracked by git — that pair of tests, not a promise or a habit, is what
  makes it impossible to send a photograph of a child to an image model. So the photos staying
  outside `~/projects` is load-bearing, and it is also what makes a real-photo rail avatar safe
  if it is ever wanted: it would go straight into the container volume, where the seeder reads
  a foreign digest, logs `locally-modified` and leaves it alone, and git never sees it.
- **`edit-avatar.py` goes to fal now, and `--changing` is not optional for a hair edit.** Its
  PRESERVE clause used to be one sentence that included "the same hairstyle and hair colour",
  so the most useful edit there is asked the model to change the hair and keep the hair; what
  comes back is neither, and it reads as the model being bad at edits. The clauses are keyed
  now and `--changing hair` drops the matching one — a call with no flag is byte-identical to
  every call made before 2026-09-16. Default provider is fal ($0.053 on `gpt-image-2/edit`,
  ledgered) rather than Nous ($0.15, no ledger, and a dry account 402s only on the real call).
- **`scene-week.py` offers TWO candidates, from two models, and a refusal of one is not a
  failed week.** Each goes through the finder on its own; ids are `{week}-{setting}-gpt` and
  `-nb2`. Exit 1 means neither was offered; exit 2 means something ERRORED (not judged) and a
  re-run reuses the images. The finder runs on fal too (`any-llm/vision`, Gemini 2.5 Flash) —
  the box order is pinned to Gemini's `[ymin,xmin,ymax,xmax]` and a model change is a
  coordinate-order change; Qwen answered `[xmin,ymin,...]` the same day.
- **A scene has FIVE axes now, and the fifth is opt-in.** Setting (where), style (how drawn),
  camera (where you stand), activities (what they do) and PREMISE (what KIND of picture —
  `tools/scene-premises.json`: `busy-town` seek-and-find, `impossible-photo`, `cutaway`,
  `giants`, `tiny`). The timer always draws `plain`, which is byte-identical to every earlier
  scene; a person picks a premise for a week with `scene-week.py --premise X`. Measured
  2026-09-13 (`docs/scene-ideas.md`): `impossible-photo` on gpt-image-2 held the cast and the
  described superhero suit was NOT refused — describe, never name, is the rule; `busy-town`
  drew a real busy-picture and **the finder tapped a look-alike** (a second braided figure), so
  at crowd scale the finder needs an ambiguity check before that premise can rotate. A true
  Waldo (child a tenth of the frame) is under the 77px height floor and is not on the table.
- **THIS WEEK is frozen per week, and a missing source is a sentence, not a failure.**
  `tools/scene_context.py` turns the forecast (Open-Meteo, 0.1° grid in gitignored
  `db/scene-place.json`), the wall's calendar CATEGORY COUNTS (never a title — read in the
  container over `docker exec -i … node -` with `node:sqlite`) and a holiday table into three
  lines, written once to `db/scene-context/<week>.json`; scene-week re-reads the file so a
  Tuesday re-run repeats Sunday's brief. The one channel that carries a person's words is an
  all-day event titled `scene: …`. A Sunday belongs to the week AHEAD (`week_for_today`) — the
  timer runs Sunday 02:30 and ISO would otherwise name, seed and season the week just ended.
  **Only a COMPLETE brief freezes** (2026-10-01): one missing weather (with a place configured)
  or the calendar is provisional and is fetched again next run. W40's had been frozen sixteen
  days early by a test run, with no forecast and stale counts. `npm run verify:context`.
- **A DIRECTOR chooses each run's picture, and there are TWO runs a week** (2026-10-18). The
  timer fires Sun and Wed 02:30 HOUSEHOLD time (install.sh appends `timezone`; the host is UTC):
  `2026-W43` covers Sun..Tue, `2026-W43b` Wed..Sat — the days each picture is up — and ids
  carry the run (`2026w43b-…`). `tools/scene_director.py` (one ~$0.002 text call) reads the
  frozen brief and picks a catalog or INVENTED setting, style, camera and premise from the
  household's own tables, validated like the activity writer; a valid answer freezes in
  `db/scene-director/<run>.json`, two refusals fall back to the rotation and freeze NOTHING.
  A dry run does not ask unless `--ask-director`. It sees titles and visitor descriptions only
  with `scenes.shareTitles: true` (opt-in; counts otherwise), and the image prompt never
  carries a name either way. The keyword headline table it replaced is deleted.
  **A visit needs a guest's name AND a visit word** ("visiting", "in town", "staying"…) in one
  event — `tools/scene_guests.py`, `db/guests.json`. A guest-free prompt is byte-identical.
- **The scene timer retries an ERROR, never a refusal.** On 2026-09-27 DNS failed at 02:54,
  `op read` could not reach 1Password, scene-week exited 2 — and nothing ran for a week, the
  wall silently kept the old picture. `scene-week.service` now restarts on failure every 30 min,
  four times at most, and runs `tools/scene-week-timer.sh` (2026-10-12), which wraps scene-week
  in `op run` (its gitignored env file is a copy of `tools/op.env.example`) and turns any
  failure of `op` ITSELF into exit 2 — bare,
  `op run` exits 1 when 1Password is unreachable, which would read as a refusal. Exit 3 is over
  `scenes.weeklyBudgetUsd`. `RestartPreventExitStatus=1 3`: a refusal or a spent budget would
  only pay again. Edit the unit in `stacks/wall/systemd/`, then re-run its `install.sh`.
- **The household is a FILE now, and the app reads ROWS** (2026-10-12). Zone, locale, features,
  board windows, the pet and scene preferences live in gitignored `db/household.json`;
  `provision.ts --settings -` (stdin, inside the container) writes them into `household_config`
  and the wall reads only those rows. **Editing the file changes nothing until it is applied** —
  the scene tools are the one exception, they read the file. A zone change also needs a
  container restart. `docs/household-config.md`.
- **`dog` is null for a household with no pet, and `pets` defaults to `[]`.** The live wall has
  no `pets` row until `--settings` writes one, so a deploy of the generalized image WITHOUT the
  apply in the same step makes the dog door vanish — snapshot `dog: null`, no sheet, deeds
  refused — and nothing invalidates: the panel only sees the row on its next refetch (up to
  ~15 min; restart `kiosk.service`).
- **The three-child prompt is frozen by a fixture, because a byte is a bill.**
  `test/fixtures/prompt-v2.example.txt` plus the digest in `prompt-v2.example.digest` pin
  what generalizing the cast was not allowed to change. A byte change to the prompt changes the
  draw digest, so `--reuse-if-same` stops reusing every cached picture and next Sunday is a paid
  redraw. Update the fixture and the digest only on purpose. The digest hashes the AVATAR
  bytes too, so the public build ships its own copy under `tools/release/public-assets/`.
- **`--season` and `--tags` existed in gen-scene for weeks and nothing passed them.** So the
  activity filter was dead and a sledge turned up on green hills (2026-09-13). scene-week passes
  both now and settings carry `tags`. Fifth instance of the signature bug: an input with no
  caller looks exactly like a working filter.
  **The filter was also FAIL-OPEN, and that put a deer ride in a library (2026-10-04).** An
  activity with no `settings` fit everywhere and a setting with no `tags` admitted every
  activity, so `halloween-book-fair` (untagged) drew deer riding, tree climbing and ball
  throwing indoors. It is strict now (`tools/scene_activities.py`): a closed `places`
  vocabulary in `scene-activities.json` (forest, meadow, park, mountain, lake, river, beach,
  town, indoor, snow), every activity names its places, every setting names its tags, and
  nothing means "anywhere". `scene-week.check_tables()` refuses to run, before any spend, if
  a setting is untagged, a tag is unknown, or a setting cannot fill three different KINDS of
  activity in every season it is drawn in. **A new setting therefore needs tags, and a new
  KIND of place needs its own activities first** — that refusal is the framework working.
  `npm run verify:activities`. **Since 2026-10-12 the table is the FALLBACK:** a text model
  writes each scene's activities (`scenes.activities: "written"`) and its guardrails are code in
  `tools/scene_activity_writer.py`, so in written mode the KINDS refusal is a warning.
- **Swimwear is a SETTING's opt-in, and the clothed check did not get looser** (2026-10-12).
  `swimwear: true` (only `swim-pool` today) makes scene-week pass `--swimwear` to the generator
  AND the finder; both still mean a covered top and covered bottoms, the top may just be a swim
  shirt. `check_tables` refuses a swimwear setting with a season — it is forced-only, always an
  adult's choice. To add a lake or beach day, copy the pattern; do not touch `CLOTHED_V2`.
- **Distance is not age, and the finder learned it two weeks late.** The find-difficulty bands
  (2026-09-24) put children at different depths; the locator still matched on "relative size",
  so a far-back eldest got swapped with her sister and the verifier refused the picture. Fixed
  in `locate()` on 2026-10-12. A run of `box holds portrait 2, expected 1` refusals is the
  locator, not the art — look at the picture before believing it.
- **Upside-down poses are refused.** The finder's facing check read a handstand as "head on
  backwards" (2026-09-13). The handstand is gone from the table; "doing a cartwheel" is still in
  it and carries the same risk.
- **A scene rule must describe what SHOULD be in a space, never what will be laid over it.**
  "Small labels float there" and "every banner and board is a blank shape" told nano-banana-2
  to draw a beige band, a white pill and two blank signs across the top of three pictures in
  four on 2026-09-12; gpt-image-2 ignored the same words. `RULES_V2` now describes the sky.
  Before adding any rule to the prompt, read it as a list of nouns: each one may get drawn.
- **The finder locates and FITS tap targets; it is not a taste gate.** The morning's only two
  refusals were a 1px and a 5px gutter between targets it had itself grown to 96px, on the two
  best pictures of the day. `fit_gutters` trims (never under the absolute floor, never more
  than `MAX_TRIM_PX` a pair) and refuses beyond that; three of the next four good scenes
  needed it. Taste is the approver's, choosing between two candidates behind the PIN.
  **It trims VERTICALLY too since 2026-10-18**: a small child far back stands ABOVE a near
  one, and sideways-only refused `2026w43-autumn-forest-nb2` for an 8px stacked gap. The upper
  box's feet go first, never under 48px tall. `npm run verify:finder`.
- **Free image generation is not an option, and as of 2026-09-11 exactly ONE of the two reasons
  survives — the one that matters.** The whole provider picture was re-probed that day:
  - **NVIDIA `black-forest-labs/flux.1-dev` is FREE and WORKING** — 200 in ~5s, five scenes in a
    minute. The "returned 500 or hung" note from 2026-09-08 is **dead**; do not repeat it.
  - **It still cannot hold the cast, and that is the reason that counts.** Five scenes measured:
    one drew FOUR children, one drew two, one made all three blonde with no brunette, and one
    drew all three from behind with no faces. Identity IS the mechanic — a child finds herself
    and taps herself — so a beautiful picture of the wrong children is not a degraded scene, it
    is not one. FLUX is excellent for anything where identity does not matter (icons already
    have a `--provider nvidia` path).
  - **`flux.1-kontext-dev` — the reference-conditioned FLUX that would fix identity — is still
    broken in exactly the documented way.** NVCF asset upload succeeds (200); the only form its
    validator accepts is `data:image/jpeg;<accepted-token>,<assetId>` and that returns **500**.
    Every other spelling 422s with the accepted one named in the message. Shape right, backend
    wrong, unchanged since 2026-09-08.
  - **Moonshot/Kimi has $48 of credit and NO image models** — four ids, all text
    (`kimi-k3`, `kimi-k2.6`, `kimi-k2.7-code`, `kimi-k2.7-code-highspeed`). It has a real balance
    endpoint: `GET https://api.moonshot.ai/v1/users/me/balance` (`.ai`, never `.cn`).
  - **Nous serves 397 models and exactly ONE generates images**, `google/gemini-3-pro-image`,
    paid, $0.15 — the same model fal sells as `nano-banana-pro/edit`. It was the only thing
    that held the three children until fal was probed on 2026-09-12 (gotcha above); it is a
    second door to the same model now, not the only one.
  - **The LiteLLM router's `image` / `image-fast` tiers (added 2026-09-11) are TEXT-TO-IMAGE.**
    They cannot take the avatars, so they are for icons and drafts, never scenes. Scene
    generation calls fal, NVIDIA or Nous directly from `tools/gen-scene.py`.
- **Pi OS Lite ships NO emoji font, and the failure is silent.** The wall draws an emoji
  beside classified calendar events — the only channel the two non-readers have on that screen
  — and without `fonts-noto-color-emoji` every one is a tofu box that reads as a rendering bug.
  `pi/scripts/setup.sh` installs it and reports it; check with `fc-match ":charset=1F483"`.
- **On a card, the chore's NAME must never lose space to anything beside it.** In a flex row
  where only the title carries `minWidth: 0`, the title is the ONLY thing that can shrink, so
  it absorbs whatever the status word and glyphs want — and on 2026-09-09 that left the name
  116px of a 392px card and broke it mid-word. The name gets its own row; the status carries
  the `minWidth: 0` and the ellipsis, so the status truncates and the name never does.
- **The same glyph can be duplication in one band and the whole message in another.** The
  still-time clock was removed from `fluent` (she can read "Still time", and two round glyphs
  at a card's edge read as two buttons) and KEPT in `picture`, where that card carries no words
  at all. Before deleting a glyph, ask which band is looking at it.
- **A subscribed calendar is not a curated one — filter it at the SOURCE.** A school district
  ICS carries every club, class, PTA meeting and curriculum night. `calendar_source.event_filter
  = 'all_day_only'` keeps the days that change shape (breaks, no-school, assessment days,
  conferences, picture days) and drops the rest, because a district writes a cancelled day as
  ALL-DAY and a thing inside a normal school day with a time. Structural, not a keyword list.
- **An emoji that is WRONG is worse than none, and `school` is the trap.** "No School" drew a
  backpack until 2026-09-09 — the one symbol on the row said *school* on the day there is none,
  to the children who cannot read the words beside it. Day-off phrases must out-rank the bare
  word, and `eventEmoji` spans four words (not the classifier's three) so "LAST DAY OF SCHOOL"
  can be reached at all. One symbol 🏠 covers the whole day-off family on purpose: a break and
  a teacher work day are different to an adult and identical to a five-year-old.
- **A PIN-gated screen can only be verified against a THROWAWAY INSTANCE.** The household's PIN
  is scrypt-hashed and unknowable, and the door checks a PIN before drawing anything behind it,
  so the panel audit needs this instance's (`AUDIT_PIN`). To measure a screen whose CONTENT needs a
  valid PIN: run the same image on port 8125 with its own `/data` volume, `provision.ts --pin`,
  `--household db/household.example.sql` and `--device`, then point the Pi's Chromium at it. Two
  traps, both hit on 2026-09-10 — **clear `localStorage` first** (the wall remembers a device
  token per origin and hands back a stale one, which reads as `bad_pin` rather than as a wrong
  device), and **restart `kiosk.service` afterwards** or the panel is left on a dead port and the
  next audit reports twenty findings against a Chrome error page.
- **Drive React over CDP in SEPARATE evaluates.** Typing four PIN digits and then clicking the
  confirm key in one `Runtime.evaluate` does nothing at all: React has not re-rendered, the key
  is still the disabled `<div>`, and the click lands on a non-control. A probe that "fails" this
  way looks exactly like a broken feature.
- **An effect that sets state on every render must set it only on a CHANGE; an updater that
  returns `was` is not enough.** React #185 blanked the body on 2026-10-11, about one child
  switch in fifteen: a click rebases a pending resize update, `was` is a fresh replay object
  each time, and `ScrollColumn` looped to fifty commits. Latch what was last asked for, as
  `web/src/views/logic/scrollMeasure.ts` does.
- **A door that gates nothing must still DO something, and this wall keeps building ones that
  do not.** The grown-up PIN pad became a door on 2026-09-09 and its submit still called
  `decide`, which returns immediately when no decision is pending: it took four digits, cleared
  its own buffer, and left the screen exactly as it was. No throw, no log, no visual change.
  That is the fourth instance of this project's signature bug — correct-looking output hiding a
  dead path — alongside `seedAssets` copy-if-absent, `calendar sync NOT running`, and
  `provision.ts` ignoring unknown flags. **When a control's failure mode is silence, write the
  test that drives it, not the test that greps it.** Sixth instance, 2026-09-14: the New-chore
  sheet's **Next** was drawn filled and was not a button — `Pill` had one flag for "filled",
  and filled meant "the chosen one of a set, tapping it means nothing". A primary action wears
  the same fill and MUST fire, so `on` (chosen, inert) and `solid` (filled, live) are two flags
  now and `pillState()` in `logic/pill.ts` is the tested answer. tsc, the suite and a screenshot
  all passed the dead one; only pressing it found it.
- **The band-literal guard reads every string.** `unit-h.sources.test.ts` fails any `=== 'picture'`
  in web sources, and it cannot tell a band from a wizard step named `'picture'`. Do not use
  `picture`, `fluent` or `emergent` as an enum value for anything else (the icon step of the
  chore sheet was renamed for this).
- **The panel audit walks the grown-up screens behind the REAL PIN, from `AUDIT_PIN`.** Since
  2026-10-11 the door checks a PIN through the household-settings read (still no verify route)
  and bounces a wrong one, so the old four-zeros walk would stop at the pad and still look clean.
  Without `AUDIT_PIN`, or when the door refuses it, the reason is printed under `NOT AUDITED` —
  read that before trusting a zero. 27 stops in felt, 40 in gallery and storybook. Its tap rules
  hit-test with
  `elementFromPoint` rather than trusting layout, because the pad is an opaque sheet with live
  buttons underneath it; without that it reported 26 gaps no finger could ever land in.
- **Headless-shell screenshots of the idle picture HANG at 2x** (2026-10-11).
  `Page.captureScreenshot` never returns, and wedges the browser, while the scene backdrop (a
  1920×1080 progressive JPEG, `cover`) is drawn near 1:1 device pixels; 1x and 1.5x work, and so
  does any other image. Nothing in SceneView or the asset changed — it is the headless shell.
  Capture child-facing screens at 1.5x and race every capture against a timeout.

- **A BOOK-THEMED SCENE SHOWS A MOMENT THE CHILDREN HAVE ACTUALLY READ.** `tools/scene_story.py`
  plus a `story` block on a setting: `moments` each carry `through`, the point by which a reader
  has met them, and `read_through` says how far the household has got. **It is a FLOAT on
  purpose** — `1.5` means book one finished and book two just started, which
  no integer can say. Later moments stay in the file, visible and inert, so finishing a book is
  a one-number edit. Describe, never name — no title,
  character or place name is in any moment, and each is phrased as something THE THREE CHILDREN
  are doing, because the picture is of them having the adventure. A moment replaces the activity
  line; `--dry-run` prints it, so the gate is inspectable for free before spending.
  **`npm run verify:spoilers` checks the MECHANISM, not the tags** — measured 2026-09-16:
  re-tagging the end of book two as `through: 1` makes it eligible and the selftest still
  passes, because the tag is the only thing that knows where a moment came from. A green
  selftest does not mean "no spoilers"; it means the comparison works.
- **ONE SEED PER WEEK MEANT ONE ACTIVITY PER WEEK.** `scene-week` passed
  `--seed monday.toordinal()`, which gave the timer the idempotence it needs (a Tuesday re-run
  must not buy a different picture from Monday's) and quietly assumed there is only ever ONE
  picture a week. The moment `--setting` let a person draw several, every one of them seeded the
  same RNG and drew the same thing out of it: reported 2026-09-16 as *"they're carrying a basket
  in every image"*, and they were — two settings got the basket and the third got the ball, from
  three runs on one seed. The seed is `monday.toordinal() ^ zlib.crc32(base_scene_id)` now, so
  same week + same scene is still the same picture and a different setting/style/premise gets
  its own draw. **`crc32`, not `hash()`** — `hash()` on a str is salted per process, which would
  have made the idempotent half random. Both candidates of a pair still share the seed on
  purpose: two models drawing the same brief is what makes a pair a comparison.
- **Nothing is ever conditioned on a previous SCENE.** The only attachments are the three
  committed avatars (`AVATARS`), on every call, and `enforce_references` refuses anything that
  is not committed house art — so a repeated prop across pictures is always the activity table
  or the seed, never an image feeding forward. Worth stating because it is the first thing the
  repetition looks like.
- **A COSTUME IS FREE, and `scene-week` will silently ignore that you added one.** A setting
  may carry `wardrobe` in `scene-settings.json` and the children are then dressed for the place
  (robes and a different house scarf each; 1940s winter coats; seaside oilskins). It costs
  nothing against identity because identity IS count, height order and hair — clothes and faces
  were always meant to vary. Two clauses are load-bearing in `clothed_v2()`: **"a DIFFERENT
  outfit each"**, because a named costume otherwise lands on all three and three children in one
  uniform is harder to read than three different ones; and **every face fully visible, no hood,
  mask, helmet or hat brim**, which is the one thing a costume can genuinely cost. The verify
  pass enforces the second — `dragon-shore-photoreal-gpt` was refused 2026-09-16 with *"slot 1:
  face not visible — she cannot find herself."*
  **The old trap is closed (2026-10-04):** `offer()` used to reuse any existing
  `/tmp/scene-week/<id>.jpg`, so a re-run after a PROMPT change re-registered the old picture
  (six candidates came back in ordinary clothes). It now passes `--reuse-if-same`: gen-scene
  writes `<id>.draw.json` holding a digest of prompt, provider, model, seed and avatar bytes,
  and reuses the jpg ONLY when that digest matches. Anything else is renamed
  `<id>.superseded-<digest8|unstamped>.jpg` (never deleted) and drawn again. Do not delete
  cached jpgs by hand any more; a changed prompt is a new draw by construction.
- **The style rotation could not see the wall, so two claymation pictures went up in a row**
  (2026-10-04). The style is arithmetic on the week number and the setting's index; week 40's
  harvest market and week 41's Halloween fair landed on the same slot. The wall had stored every
  picture's `scene.style_id` all along and nothing read it. `tools/scene_memory.py` reads it now
  (read-only, `docker exec`, like the calendar counts) and `scene-week` steps past any style
  used by the three most recent pictures, approved or still a candidate. **A scene already in
  the catalog keeps its own style** so a retry is the same picture, which means re-drawing an
  existing id in a new style needs `--style` (a new id). `--style` is never second-guessed. The
  dry run's `style :` line says which happened. `npm run verify:styles`.
- **`--style` forces a style and BECOMES PART OF THE ID.** `--setting X --style photoreal` is
  how the same place gets drawn two ways in one week; without the id carrying it, the second run
  overwrites the first candidate's files in the volume. Every axis a person pins by hand is in
  the id; the ones the week chose stay out, because the week already varies them.
- **The `render` family (3D) is IN and its acceptance criterion is one sentence.** Added
  2026-09-20 — `soft-3d`, `claymation`, `paper-diorama`, `low-poly` — and kept on 2026-09-23:
  *"the 3d renders looked good, and they don't try to look like an actual photo."* The second
  half is the rule, not a compliment. A stylised 3D frame is a drawing made with a different
  tool; a photorealistic one is the thing removed on 2026-09-18 for near-miss faces. One
  adjective separates them, which is why `FRAME_V2['render']` says "3D-rendered scene" and
  never "photorealistic", and why every style row here specifies rounded cartoon proportions,
  bead eyes, cut paper or flat facets. Adding a render style that reaches for realism
  re-opens a decision the household already made.
  Plumbing a family touches FOUR places and three of them fail silently or at spend time:
  `FRAME_V2` (the noun), `fal_api.DEFAULT_FOR_FAMILY` (which model), `fal_api.MODELS[*].styles`
  (which models may), and every premise's `families`.
  All four drew the cast and passed the finder first time. `low-poly` is the one to watch: a
  faceted face carries no detail, so hair colour and height order do ALL the recognising —
  the identity contract stated exactly, and the first style to drop if a child cannot find
  herself in it. That needs a child's verdict, not an adult's.
- **THE TAP FLOORS WERE 2-3x WHAT THE HANDS NEEDED, and the picture paid for it.** Nobody had
  ever converted them: on this panel one logical px is **0.496 mm**, so the scene finder's
  preferred 96px floor was **47.6 mm** — nearly two inches of glass per child — and the 64px
  absolute was 31.7 mm. The household measured the real thing instead (2026-09-18): the children
  "can press and find a dime sized image", and **a dime is 17.9 mm = 36 logical px**. So
  `scene-regions.py` now uses `TAP_FLOOR_PX = 48` (a quarter), `ABS_TAP_FLOOR_PX = 36` (a dime
  exactly), `GUTTER_PX = 12` and `MIN_CHILD_HEIGHT_IN = 0.9`. The cost of the old floors was
  never comfort, it was composition: nothing smaller than two inches could pass, so every scene
  came out as three big figures near the front.
  **Two floors here are different things and must not be merged.** The tap floors are MOTOR —
  can a finger land on it — and the household measured those directly. `MIN_CHILD_HEIGHT_IN` is
  EYESIGHT — can a child recognise herself at all — and at 0.9in it is now *near* the line
  rather than clear of it (26 arcmin at ten feet: silhouette and colour read, faces do not).
  Do not lower that one further without standing at the wall, because its failure is a child
  who cannot find herself and has no way to say why.
  **The wall's own UI floors are UNCHANGED** — `tapPx.min` on chore cards, the PIN pad, the
  rail. Those were not what was measured and a mis-tap there costs a wrong claim, where a
  mis-tap on a picture costs nothing. Lower them only on the same evidence.
  Existing scenes keep the boxes they were grown to; the new floors reach the next picture.
- **The picture library was cut from 20 to 5 on 2026-09-18, on three household rules:** no
  photoreal, nothing without the dog in it, nothing drawn against the OLD avatars (before
  2026-09-16 — those show two of the children with the wrong hair, and neither is one of these
  children). That took every 2026-09-08 baseline with it, so `assets/scenes/` holds one
  drawn picture now, the committed baseline scene, promoted out of the week-38 generated set,
  over the static `backdrop`. **Something must stay committed there** or a fresh database has no
  picture at all and the "never blank at 6:00 AM" floor goes with it — the generated library
  lives only in the volume and is exactly as durable as the backup.
  That backup is `wall-backup.timer` (daily, `$WALL_DATA_ROOT/backups/family-wall/`, runbook §7);
  the host's own backups never reached the Docker volume, and until 2026-10-06 nothing did.
  **Deleted pictures are ARCHIVED, not destroyed:** `$WALL_DATA_ROOT/scene-archive/` has all
  32 files. A generated scene exists nowhere else, so shredding one on a taste call would be
  unrecoverable; "gone from the dashboard" is what was actually asked for.
- **PHOTOREAL IS OFF, and the household reversed its own 2026-09-16 decision to try it.**
  Two days of it (2026-09-18): *"they're too weird, they're not close enough to how the kids
  look."* Right hair, right height order, a face that is almost but not theirs — worse than a
  drawing, which never pretended. What was removed, so nothing quietly re-enables it: the
  `photoreal` STYLE, the `impossible-photo` PREMISE (photoreal was its only family), `photoreal`
  from the families of `giants` and `tiny`, and the whole `--faces` path including
  `prompt_guard`'s photo door. `scene-week.check_tables()` now REFUSES TO RUN if a style or
  premise brings the family back — a re-added photoreal style otherwise costs a bill and a
  picture of three children who are almost right, and nothing else would say so.
  **The `--faces` path is deleted rather than left dormant**, on purpose: a route that can send
  family photographs to a third party and has no caller is the most dangerous shape of code in
  this repo, because the next reader assumes it is supported. It is recoverable from this
  session's history only — it was never committed.
  The likeness diagnosis, if it ever matters again: the crops and the reference ORDER were both
  fine; it was pixel budget. A child's face reproduces in proportion to how many pixels it gets,
  and the youngest is the smallest figure in every picture by construction — 240px of body, ~130px
  of face, against 352px for the eldest, which is exactly the order in which the likenesses
  landed. `--composition close-front` roughly doubled his face and fixed it. Cameras, not crops.
- **THE DOG IS THE SCALE ANCHOR, and until 2026-09-16 he was measured against the FRAME.**
  Both the generator and the finder said he was "about a tenth of the picture's height", which
  tells a model how many pixels to spend and nothing about how big a dog is — so nothing in the
  picture had a known size and everything was free to be any size. Asked in exactly those
  terms: *"if there's a dog or a small tree or a banana as a reference point... there could be
  a giant banana."* He is measured against the CHILDREN now, through
  `scene_cast.dog_lines()` and the same landmark table the height lines use: the household's
  estimate of his shoulder height and length puts his shoulders at
  the youngest's waist and makes him almost exactly as long as the youngest is tall. **And
  `db/cast.json`'s `dog` key was read by NOTHING** — the real words were hardcoded in two
  places that could drift. One source now, both callers.
- **`scene-week.py --setting <id>` forces a setting and ignores its season.** For building a
  bank of pictures deliberately, the way `--premise` is a person asking for a kind of picture;
  the timer never passes it. Style and camera still rotate off the week, so two forced runs of
  the same setting are not the same image. Pair it with `--no-context` for an evergreen backup
  — otherwise THIS WEEK's weather and props are baked into a picture meant for any week.
- **Describe, never name — and it works.** A wizarding-school setting and `dragon-shore` were added
  2026-09-16 from the household's asks (a wizarding school, and the dragon from the song), and
  `lamppost-wood` was already the Narnia one and had never been drawn. Not one title,
  character or place name appears in any of the three: a castle boarding school with figures on
  broomsticks, a snowy fir wood with an iron lamp-post and a fawn with an umbrella, a huge
  gentle green dragon curled by a sea cave. All six candidates passed the finder first time and
  the dog was found in every one.
- **The rail's faces are cropped out of the picture, and the join is `slotForChild`.**
  `SceneRegion.head` is a tight head box written by the same vision call that finds the tap
  targets (`scene-regions.py --heads-only <id> <jpg> <json>` patches an approved manifest
  without re-verifying the children, exactly like `--dog-only`). The rail positions the scene
  image it already has — no new asset, no new request — so a child matches herself against the
  head she is WEARING this week instead of a cartoon. Three traps, all hit on 2026-09-16:
  **(1)** the tap box is grown to 96px and gutter-fitted, so it is a target and never a
  likeness — `head` is separate and the two must not be swapped; **(2)** a head box is in
  FRACTIONS, and fractions are not a shape on a 16:9 picture, so `squareOnScene` converts to a
  square in PIXELS or the face arrives letterboxed and loses its chin; **(3)** slots are
  `SLOTS = (1, 2, 0)` and the join is `sortOrder % childCount` — matching on the bare
  `sortOrder` silently drops the THIRD child, which looks like the finder missing him.
  `slotForChild` in `logic/sceneFace.ts` is now the only definition of that wrap; `SceneView`
  had it inline. Every failure falls back to the cartoon avatar: a wrong crop is worse than no
  crop, because the rail is how the three-year-old reaches his own screen.
- **Putting a picture up asks for nothing; taking one out still asks for the PIN.** The
  household's response to a PIN-gated Pictures screen was to give the children the PIN — which
  also handed them the approval queue, the ledger and every chore's worth. `approve` is on the
  WALL surface now (`POST /api/wall/v1/scenes/:id/approve`, `WallActions.approveScene`) because
  approving is also selecting and every outcome is another picture, each undone by choosing a
  different one. `retire` stayed on admin. **The PIN can now go back to being the adults'** —
  change it.
- **The finder cannot see the dog in `mountain-meadow` or `trailer-camp` and re-running will not
  help.** Both predate the dog being in the generation prompt, so he is not in the pictures to
  find; `--dog-only` was run on both on 2026-09-16 and honestly reported nothing. That is not a
  broken scene — `WallScene.dog` is nullable and both are approved and in rotation. Head-box
  coverage after the same sweep: campsite, autumn-forest, trailer-camp and all three generated
  scenes 3/3; **mountain-meadow 1/3**, where the validator refused two boxes for being the body
  again — which is the validator doing its job, and those two children keep their cartoons.
- **The dog is the Easter egg, and he is never a reason to refuse a scene.** The dog is in
  every generated picture, but since 2026-10-18 he is not always HIDING: `tools/scene-dog.json`
  gives him moods (tail-chase, leaf pile, snack thief…), chosen by the director or a seeded
  draw, always on his own and never posed with the children. `hiding` passes no `--dog-doing`
  and is byte-identical to the old prompt, and a frozen director decision with no `dog` key
  means hiding, so a retry of an old run reuses its pictures; `tools/scene-regions.py` looks for him AFTER the children pass and
  writes an optional top-level `dog` box into the manifest (`WallScene.dog`, null when absent
  or when his box would sit within 16px of a child's target — the children come first). Tap
  him on the wall and `DogSheet` opens, and **every word on it is his** (2026-09-15 pivot).
  Two halves, side by side: **Do this for me** — today's `pet` EXTRAS (`dogAsks` in
  `logic/dog.ts`: `category === 'pet' && kind === 'extra'`, gathered across every child's row),
  one line each with a face for every child who could still do it; tapping a face claims that
  child's row through the SAME `choreKey` gate the board uses, pays what the board pays, and
  the approval lands in the grown-up queue like any claim. Anyone may do an extra, the youngest
  included, so the asks in `db/chores.json` (`ch-fetch`, `ch-brush`, `ch-ears`; `ch-walk` and
  `ch-scoop` renamed into his voice) carry `rotation: null`. **What I did** — four deeds drawn
  for the ISO week from `DEED_POOL` (`src/domain/dog/deeds.ts`, first person past tense,
  seeded — the draw is code, only the ticks are rows in `dog_deed_done`), no child, no PIN, no
  points. `POST /dog/deeds/:deedId` refuses a stale week or a made-up deed with the child-safe
  `not_claimable`. The layout is measured, not guessed: stacked, the sheet was 625px on a 540px
  wall; the asks stand BESIDE the deeds now, the sheet is 840 wide and the labels are `body`
  size (`DOG_SHEET_WIDTH_PX`, `DOG_DEEDS_COLUMN_PX`). The pet schedule is laid out so no day
  has more than three asks (fetch daily, walk daily, scoop WE/SA, brush TH, ears MO); a fourth
  fits and a fifth scrolls. `scene-regions.py --dog-only <id> <jpg> <json>` patches an approved
  scene's manifest without re-verifying the children; a dogless scene is left byte-identical.
  Which scenes carry him: campsite, autumn-forest, harvest-market; not trailer-camp,
  mountain-meadow or either lantern market (found, but on top of a child). The sheet lives ON
  the picture only (`dogSheetAfter`) and closes itself after 60 s.
- **`"rotation": null` MEANS "LEAVE THE ROSTER ALONE", NOT "EVERYONE" — and that ate the fix
  above for eight days.** The dog's chores were edited to `rotation: null` on 2026-09-16 so all
  three children could walk him; `provision.ts` said `updated`, the model really did change to
  `shared`, and `setRotation` was never called because the caller guards on `c.rotation !== null`.
  The stored roster of two children stood, so the YOUNGEST still could not walk the dog or scoop
  the yard — the exact complaint — and nothing anywhere said so. Found 2026-09-23 by reading
  `chore_rotation_member` instead of trusting the `updated` count.
  **The file has three states now**: omitted/`null` leaves membership alone, **`[]` CLEARS it
  (everyone)**, and a list names exactly those children. `[]` used to be a validation error, so
  the format simply could not express "everyone".
  **The wall does NOT share that rule and must not.** `createChore` refuses an empty roster in
  the sheet's own words, because from the wall an empty roster is a mis-tap — the same thing
  `setChoreMember` already refuses as `roster_empty`. Two doors, two rules;
  `unit-c.chore-create.test.ts` pins the wall's half and caught it the moment the parser went
  permissive.
  A rotation MODEL with `[]` is refused outright: everyone has no meaning for a chore that
  deals one turn to one child, and it would materialize a day with no assignee, silently.
- **`first_complete` was showing through the dog's sheet as a UI bug, and it read as one.**
  Every pet extra was `first_complete` — the first claim wins and supersedes the rest — so
  tapping one face made the other two VANISH. Reported 2026-09-16 as "you can only select one
  kid" and "funny navigation flow", and it was neither a selection nor a flow: it was a race
  being lost. The pet extras are `shared` now (one row per child, each claimable
  independently, every claimant earns FULL points — not a split), `ch-walk` and `ch-scoop`
  lost their two-child rosters, and `dogAsks` returns `faces` — every eligible child, always
  drawn — instead of an `open` list and one `doneBy`. A done face carries a green tick
  (`DOG_FACE_TICK_PX`); `AccentFrame selected` alone was a few pixels of inset, which was
  survivable only while a row of one WAS the answer. **Three children claiming a 6-point walk
  is 18 points a day** — the economy was never asked about this, so watch it.
- **A model change reaches TOMORROW, so verify it on a throwaway, not by staring at the wall.**
  Re-applying `--chores` prints `updated` and the wall keeps serving today's already-
  materialized `first_complete` rows until the date boundary. A fresh 8125 instance has no
  materialized day, so it renders the new model at once — that is the only way to see the
  change the same evening. (Seeding one needs the household's ids remapped to the example's
  `child-a/b/c`, and its `retire:` list emptied, or `provision.ts` refuses the file.)
- **The undo window is no longer drawn.** All three bands swapped the state glyph for an
  hourglass while `undoPending` was true, which put the transport on a child's card and made
  every tap look like a countdown had started — reported 2026-09-16 as "a timer I don't think
  is necessary". The undo is unchanged (a second tap inside 2 s still cancels and nothing is
  sent); it is simply not announced. `undoPending` stays on the contract, deliberately
  undrawn — do not wire it back without a better reason than that it is available. Note
  `claimed` still owns an hourglass of its own, and that one is real: you said you did it, no
  grown-up has looked yet.
- **The leave-by banner is an OVERLAY judged by the wall's clock, and it is not a third gate
  input.** Rules (`household_config.departures`, one JSON row; defaults in
  `src/domain/departures`) ride in the snapshot; `logic/departures.ts` turns them plus today's
  events into `ready` (leaveAt − readyMinutes) and `go` (ten minutes after) every 15 s tick.
  School is a clock (07:35 Mon–Fri) muted by an all-day 🏠 event; dance/sport come from the
  calendar's stored `category` (migration v10) at `start − travelMinutes`, with the child's
  face. The switch and the three numbers are behind the PIN (Grown-ups → Settings → Leave-by
  alerts) — the wall holds no admin session — and there is no sound. **The header's middle is
  ~260px, and ~100px less with the calendar's pager up**: the full sentence truncated on the
  first measurement (2026-09-15), so `departureWords(alert, compact)` gives the header
  "Get ready / School · 16 min" and the picture's card the whole thing, and a FRESH status pill
  drops its words to the check while a banner is up (a stale one keeps them; that label must
  never shrink). `TIME_RE` became a real clock check the same day because the route accepted
  `25:00`. Measured on a throwaway 8125 instance (the memory note), not the household's wall.
- **A route test that fails BEFORE `h.stop()` hangs the whole file for two minutes**, because
  the live server keeps the process alive and `node --test`'s default timeout is what finally
  ends it. It reads as "the new route hangs". Iterate with `--test-timeout=10000`, and read the
  first `not ok` — on 2026-09-15 it was an assertion against `.error.code` when the wire shape
  from `sendError` is FLAT: `{ error: '<code>', message }`.
- **Re-applying `provision.ts --chores` makes the FILE win over the wall.** `upsertChore`
  reports `updated` for any field OR roster that differs from `db/chores.json`, and a roster or
  model changed from the panel is exactly such a difference — the re-apply overwrites it with
  no warning beyond the count. Four chores came back `updated` on 2026-09-15 with no file edit
  to explain it. Before re-applying, diff the catalog against the file, or accept that panel
  edits are lost.
- **The picture is HOME, and nothing but the clock decides when the board replaces it.** The
  idle gate has exactly two inputs — is the clock trusted, and is now inside a board window
  (05:45–08:30, 18:45–20:45). "Something is overdue" was a third input and it has now been
  removed TWICE: in August it was fed the approval queue and the household reported the home
  button broken; on 2026-09-13 it was fed real 17:00 duties and the household reported the wall
  "stuck on the two calendar days". Both were the same design working: the picture gone every
  evening the family was in the room. `test/unit-h.timetrust.test.ts` pins the arity. Two
  things came with the fix: the open DESTINATION is shell memory now (`idle.ts`), because as a
  `useState` beside the reducer it only decayed while a child was selected, so a calendar
  opened from the idle wall stayed up forever; and the rail's house is live on the board — it
  goes to the picture from anywhere and decays back to the gate's verdict after 90 s.
- **An EMPTY chore roster means EVERYONE, so the wall may never write one.** `chore_rotation_member`
  with no rows for a chore is "all active children" (`roster()` in `materialize.ts`), which is
  how a file-authored chore with no `children:` list works — and it means "take the last child
  off" would hand the chore to all three. `setChoreMember` refuses `roster_empty`, the route
  answers 400, and the panel draws that child's check inert (`ToggleKey inert`) rather than
  live-then-refused. The first wall write against an implicit roster spells it out as rows.
- **Roster edits reach TODAY; a model change reaches TOMORROW.** Adding a child to a chore at
  17:00 puts a `pending` row on today's already-materialized day (or `superseded` if a
  first_complete race is won); removing one deletes only a `pending` row, never a claim. A
  `rotation` day is never touched and `POST …/model` only changes the definition — re-dealing
  a turn mid-day is how somebody loses one. Routines are the opposite (a step added at 19:00
  is on tonight's card). Probe dates against the CONTAINER's clock (America/Denver), not the
  host's UTC `date`.
- **`npm test` does NOT typecheck.** `node --experimental-strip-types` strips types without
  checking them, so a duplicate object key and a bad import both passed a green suite on
  2026-09-09 and failed the image build. Run `npx tsc --noEmit` before deploying; the Dockerfile
  runs it too, which is why the wall never shipped them.
- **Do not hardcode the server's LAN IP anywhere.** It has already drifted once. The
  compose binds `0.0.0.0` and ufw gates the subnets; that is deliberate, not sloppy.
- **avahi is inactive on the reference server** — `.local` mDNS does not resolve from the server. Use
  Tailscale MagicDNS (`*.example.ts.net`) or a DHCP reservation, not `raspberrypi.local`.
- **Tailscale node keys expire (180d default).** If the Pi's data path depends on the
  tailnet, disable key expiry on that node or the display goes blank six months in.
- **The Pi runs OS _Lite_ — nothing graphical is preinstalled.** No desktop, no compositor,
  no browser; HDMI is a console login. `pi/scripts/setup.sh` installs labwc + wlr-randr +
  wlopm + chromium (with a `chromium` → `chromium-browser` fallback; trixie renamed it).
  `cage` was considered and rejected there — on a box that already runs labwc it would stack
  a second compositor. Do not "simplify" to cage without reading that reasoning first.
- **Everything is Wayland.** `xset`, `unclutter`, `.xinitrc`, DPMS and most kiosk guides
  online are X11-era and silently do nothing. Screen power is `wlopm` / `wlr-randr`.
- **The screen is dark 21:00–06:00 ON PURPOSE, and a reconciler owns it.** `screen-power.timer`
  runs every minute and sets every output to what the window says (`SCREEN_ON_AT` /
  `SCREEN_OFF_AT` in the Pi's `kiosk.env`; malformed fails ON). A black panel at night is not
  a fault — touch it, and `screen-idle.service` (swayidle, started from labwc's autostart) holds
  it on until five idle minutes. Never add `wlopm --on` to a watchdog: it would fight the
  schedule. `journalctl --user -u screen-power` logs only the changes.
- **Google Home is the device layer; this project never absorbs it** (PRD §4). Largely settled
  by ADR-0004 — with HA reduced to a calendar source there is no smart home here to confuse it
  with — but the pressure to cross the line recurs, so the test stands: *would Google Home ever
  control this?* If yes, it does not belong here. Never wire household devices into HA, and
  never reach for HA's Google Assistant integration (it needs Nabu Casa cloud, which fails the
  no-cloud invariant).
- **Wall scale is browser-side, and stays that way.** `--force-device-scale-factor`
  (`KIOSK_SCALE` in `<pi>/.config/kiosk.env`, currently 2.0) enlarges the whole UI uniformly.
  Learned from HA's markdown card sanitising inline HTML, but it is the right mechanism for the
  custom app too — design at 960x540 logical pixels, not 1920x1080.
- **Chromium defaults to en-GB here**, which renders 24h times on a US wall. `--lang=en-US` is
  pinned in the kiosk launcher; do not drop it.
- *(Dead with Lovelace: theme `app-drawer-width` sidebar hiding, `wall-kiosk.js`, and the
  `location.reload()`-during-auth-callback trap. Kept only in git history.)*
- **Todoist was dropped 2026-08-23** (PRD §5). Nothing renders a personal task list. ChoreOps
  (per-child chores) is a different surface and is still in scope.
- **The `Todoist` Google calendar still exists and must stay excluded** from the wall, along
  with `Working Location`. The double-render trap it created is gone with Todoist itself; the
  exclusion is not.
- **The panel is an Elo 2270L (21.5"), not a 2470L** — corrected from EDID/USB on 2026-08-23
  once it was plugged in. Anything sized or specced against a 23.8" panel is wrong.
- **The 225-nit figure below came from the 2470L datasheet and is unverified for the 2270L.**
  Re-check it before trusting the contrast guidance.
- **The panel is 225 nits behind anti-glare etched glass.** Colours that separate cleanly on
  a laptop can collapse into each other on the wall. No sub-14px type, no hairline strokes.
  Test on the panel.
- **VIEWING DISTANCE IS PER DESTINATION, not a property of the wall** (H8, 2026-08-26). The
  colour and stroke rules above are physics and hold everywhere. "Readable from ten feet" does
  NOT: it is true of the IDLE wall, which a parent glances at from the kitchen and which the
  6:00 AM invariant is about — and false of a child's own screen, which a child walks up to and
  touches at arm's length. Sizing every screen for ten feet is what made four routine steps
  need 354px in a pane with 300. Close-up detail is an ASSET on a child's screen and is the
  thing that makes them walk over. Tap targets are motor skill, not eyesight — and the number
  is now MEASURED rather than inherited (below).
- **Ollama holds one model in VRAM at a time** on the shared 8GB RTX 2080 — matters only for
  the iceboxed assistant, and for build-time work; `OLLAMA_MAX_LOADED_MODELS=2` is the fix.
- **Guardrails are architectural, never a prompt instruction.** Children and guests touch this
  screen. Destructive actions must be *impossible* from the wall, not discouraged: approvals are
  PIN-gated, the wall holds no admin session, and nothing on it can delete a calendar event.
- **Licence discipline when harvesting.** DinkyDash is **MIT — its CSS and templates may be
  lifted.** ChoreOps (GPL-3.0) and Donetick (AGPLv3) are viral: read them to understand the
  domain model, never paste their code into this repo.
- **The `CalendarSource` boundary is load-bearing.** Only the adapter may know Home Assistant
  exists. The moment an HA entity id leaks into a component, route, or table, swapping to the
  Google API stops being a config change.

## Pointers

- [`docs/PRD.md`](docs/PRD.md) — problem, verified current state, invariants, anti-scope.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — M0 unblock → M1 build the app → M2 make it good.
- [`docs/runbook.md`](docs/runbook.md) — **bringing the wall up, and fixing it when it is
  wrong.** Written to be followed at 6:05 AM by someone who did not build this. Start here for
  anything operational.
- [`docs/build-plan.md`](docs/build-plan.md) — how M1 is decomposed for parallel agents: the
  contracts-first rule, per-unit file ownership, and the redaction rule for anything sent to a
  third-party model. **Read before delegating any work in this repo.**
- [`docs/work-packages.md`](docs/work-packages.md) — the same decomposition for what is LEFT:
  the queue cut into packages with disjoint file ownership, what a sub-agent may never decide,
  and the three kinds of imagery and why they are not interchangeable. **Read this before
  handing anything to a sub-agent.**
- [`docs/decisions/0004-build-the-app.md`](docs/decisions/0004-build-the-app.md) — **read this
  first.** Why this is a custom app, why HA is only a calendar source, why DinkyDash was not
  forked, and what we harvest from whom. Supersedes ADR-0001.
- [`docs/decisions/0001-dashboard-stack.md`](docs/decisions/0001-dashboard-stack.md) —
  **superseded by ADR-0004.** Kept for the reasoning that still holds: why not Magic Frame /
  MagicMirror² / DAKboard, and the substrate-risk bar that still disqualifies the whole
  purpose-built OSS field.
- [`docs/decisions/0002-image-generation.md`](docs/decisions/0002-image-generation.md) —
  routine imagery, and the restated no-cloud invariant.
- [`docs/feature-landscape.md`](docs/feature-landscape.md) — what Skylight/Hearth/Cozyla ship
  and our answer for each. **Note its framing predates ADR-0004**: it argues for a household
  operations board, and the product was deliberately narrowed to the four kid-facing jobs. Its
  research still stands; its scope conclusion does not.
- [`docs/calendar-structure.md`](docs/calendar-structure.md) — per-person calendar convention.
- [`docs/household-config.md`](docs/household-config.md) — every key in `db/household.json`,
  its default and row, applying it with `--settings`, and the two-loader contract.
- [`docs/extension-points.md`](docs/extension-points.md) — the ten places to extend the wall,
  each with its interface, file, pinning test and a worked example.
