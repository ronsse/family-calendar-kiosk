# PRD — family-calendar

```yaml
status: active
owner: the operator
last-review: 2026-08-24
```

> Rules: ≤ 2 pages. §3 contains only verifiable facts — every claim cites a path or command.
> Agents load §3–§5 before working here; write for them. Bump `last-review` whenever touched.

## 1. Problem

A household coordinates on phones, which means the schedule is only ever
visible to whoever is holding one. A wall-mounted, always-on display in the living room
makes the day legible to everyone in it, including children too young for accounts.
Every closed consumer product (Skylight, Hearth, Cozyla) was rejected for two reasons:
the UI cannot be customized, and the assistant is cloud-hosted behind a subscription.

The product is a **kid-facing household calendar**, and it has exactly four jobs: help the
children run their **routines**, do their **chores**, **earn money/stars** for doing them, and
know **what is upcoming**. Stated in those words by the owner on 2026-08-24, and that framing
is load-bearing — it is what [ADR-0004](decisions/0004-build-the-app.md) re-scored the whole
landscape against, and what cut the smart-home scope this project had drifted into. Adjacent
household-operations features (meal planning, presence, an assistant) are **not** jobs of this
product; see [`feature-landscape.md`](feature-landscape.md) for what the closed products ship
and §6 for what we deliberately do not.

## 2. Users & jobs

- As a **parent**, I glance at the wall and see today across every family member, so I
  know who has to be where without unlocking anything.
- As a **child**, I tap a chore off the list, so the board reflects reality.
- As a **household member**, I ask the display a question in plain language, so I do not
  have to learn a query syntax.
- As **Claude Code / Hermes** (agent consumers, first-class), I read and write household
  calendar + task state through one governed API rather than four vendor SDKs.

## 3. Current state (verified 2026-08-24)

**Hardware — the panel is an Elo 2270L, not the 2470L recorded until 2026-08-23.** Corrected
from the hardware itself once connected: EDID reports `ELO ET2270L` and USB reports
`04e7:0d22 Elo TouchSystems 2270L pCAP HID`. EDID physical size is 480x270 mm — a **21.7"
diagonal**, i.e. the 21.5" 2270L, not the 23.8" 2470L. Resolution is 1920x1080 @ 60 Hz
(`wlr-randr`, preferred mode). **The 225-nit / anti-glare / dual-2W-speaker / VESA-100 figures
in this doc were taken from the 2470L datasheet and have NOT been re-verified against the
2270L** — re-check before relying on them for legibility or mounting. The smaller diagonal
also tightens the "legible at 10 ft" target in §7. Raspberry Pi 5 8GB on microSD,
micro-HDMI (HDMI0) → monitor, monitor USB-B → Pi USB-A.

**The Pi is provisioned and reachable** (re-probed from the server 2026-08-23). Hostname `wall-pi`, user `<user>`,
**Raspberry Pi OS Lite** — Debian 13 trixie, aarch64, kernel 6.18.34+rpt-rpi-2712, imaged with
Imager 2.0.8 via **cloud-init** (`user-data`/`meta-data`/`network-config` on the boot
partition + `ds=nocloud` in `cmdline.txt`) — *not* the old `custom.toml`/`firstrun.sh` path.
128GB card, rootfs 115G. SSH is key-only (`ssh_pwauth: false`) with passwordless sudo via
`/etc/sudoers.d/010-<user>-nopasswd`. **`eth0` is now down** — an ssh alias pointed at the
ethernet lease is dead and the alias for the Pi's wlan0 lease is the working one, which is the
failover case the handoff listed as untested arriving early and unplanned.
`wall-pi.local` does **not** resolve from the server — no nss-mdns, consistent with
avahi being inactive here.

**Architecture status: this project pivoted on 2026-08-24.** [ADR-0004](decisions/0004-build-the-app.md)
supersedes ADR-0001 — the product is a custom app, and Home Assistant is demoted to a calendar
source behind an adapter. Everything below is verified state; §5 records the new disposition.

**Both previously-recorded blockers are closed** — re-verified from the server 2026-08-24, and this
supersedes the "two blockers" paragraph committed in e73a505, which was written from an
out-of-date parallel session and contradicted the ROADMAP:

1. **The Pi resolves `homeserver`.** Tailscale MagicDNS owns `/etc/resolv.conf` on the Pi
   (`nameserver 100.100.100.100`, search `example.ts.net`); `getent hosts homeserver` returns
   `100.64.0.2` and `http://homeserver:8123/` returns **200 in 11ms** from the Pi. No IP is
   pinned anywhere. `kiosk.service` is `active` with
   `DASHBOARD_URL=http://homeserver:8123/wall-display/today`.
2. **Home Assistant is onboarded.** `/` returns 200 and `config/.storage/` holds `onboarding`,
   `auth`, `auth_provider.homeassistant`, and `core.config`. Container healthy.

**The panel is connected and touch works; `eth0` is still down.** `card1-HDMI-A-1` reads
`connected` and labwc hotplugged it without a restart (1920x1080@60, `Enabled: yes`). The
touchscreen needs **no driver**: `libinput list-devices` shows `/dev/input/event5` with
`Capabilities: touch` and an **identity calibration matrix**, which is correct for a
single-output system — touch maps 1:1 to the display with nothing to calibrate. A second node
`/dev/input/event6` presents as `pointer` (mouse emulation) and can be ignored. `grim` confirms
Chromium is genuinely fullscreen on the panel with no browser chrome. Separately `eth0` is DOWN
and `wlan0` alone carries the box, so the ethernet alias does not reach a live host; the wlan0 alias
is the working one.

**`/etc/hosts` on the Pi is cloud-init-managed** (`manage_etc_hosts: True`), so hand-edited host
mappings do not survive a rebuild — and pinning the server's IP is forbidden anyway (it has already
drifted once). Naming is solved by the tailnet, permanently.

**The kiosk stack is installed and verified end to end.** `labwc` 0.9.7 + `chromium` 151 +
`wlr-randr` + `wlopm` + `libinput-tools`, driven by a systemd **user** unit, with autologin on
tty1 execing labwc (Lite has no display manager, so nothing else would start a compositor).
Proven on the wlroots **headless** backend, which exercises the real boot chain without the
panel attached: labwc → `~/.config/labwc/autostart` → `systemctl --user import-environment` →
`kiosk.service` **active** → Chromium on `--ozone-platform=wayland` with GPU rasterisation via
`/dev/dri/renderD128`. Fonts are present (24 faces, DejaVu + Liberation). Reproduced from the
repo by `pi/scripts/deploy.sh`; `cage` stays rejected — it would stack a second compositor.

**Both hardware risks have cleared.** `vcgencmd get_throttled` now reads `0x0` (was `0x50000`
— under-voltage and throttling both latched) after the supply swap; temp 48.8 °C. And Wi-Fi
failover is no longer untested: eth0 is down and the Pi has served SSH, apt and Chromium over
`wlan0` alone. Neither is re-verified *at the mount point*, which is still what M0 asks for.

**Inference (the server, always on).** RTX 2080 **8GB** — `hermes3:8b`, `qwen2.5-coder:7b`,
`llama3.2:3b`, `nomic-embed-text` (`curl localhost:11434/api/tags`). Ollama holds one model
in VRAM at a time by default and swaps on demand — shared with Trellis embeddings, Hermes
fallback, and Open WebUI.

**`desktop-pc` cannot serve this display.** RTX 4070 with `qwen2.5:14b`, but powered off by default
and ~2 min to wake via the operator's hub API. Unusable for interactive family queries.

**LiteLLM tiers are cloud-capable.** The operator's LiteLLM router config:
`bulk` hits NVIDIA first; `aux` falls back to `bulk`. Only `local-8b`, `local-fast`, and
`local-coder` have no fallback entry and are therefore local-only.

**Networking.** Tailscale MagicDNS enabled tailnet-wide, suffix `example.ts.net`
(`tailscale dns status`). avahi is **inactive** on the server, so `.local` mDNS will not resolve
from the server. The server is itself on WiFi (`wlp2s0`) and its LAN address has already
drifted once.

**Household roster (stated 2026-08-24).** Three children — the eldest (7), the middle child (5), the youngest (3) —
plus two adults. They span the whole literacy range: one reader, one emergent reader, one
pre-reader. See [`calendar-structure.md`](calendar-structure.md). DOBs are deliberately not
recorded in this repo.

**Calendars (Google, `list_calendars`).** Five: `Family` (**timezone UTC — wrong, should be
America/Denver**), one adult's personal calendar (`calendar.parent_a`), a second
shared calendar, `Holidays in United States`, and a
`Todoist` sync calendar. **No per-person calendar exists for any other household member.**

**Home Assistant is onboarded and its Google Calendar OAuth is in production** — and that
integration is the *only* reason HA survives ADR-0004. Seven `calendar.*` entities exist
(Family, `calendar.parent_a`, the second shared calendar, Birthdays, Holidays, plus Todoist and Working Location,
both excluded). The OAuth client lives in the existing GCP project with credentials in
1Password, and consent was completed via `my.home-assistant.io`, so HA
never needed public exposure. **Watch:** the consent screen must stay "In production" — in
"Testing" Google expires refresh tokens after 7 days and the wall breaks weekly.

**ChoreOps was never installed.** The chore / points / approval engine is greenfield, so the
custom build in ADR-0004 replaces nothing that exists. Headroom is not a constraint: 31GB RAM,
12 cores, 198G free on `/`.

## 4. Invariants / product principles

- **Never blank at 6:00 AM.** A dashboard that is occasionally stale is fine; one that is
  blank on a school morning is a product failure. Every design choice defers to this.
- **No cloud inference on household data, and no cloud dependency at display time.**
  Restated by [ADR-0002](decisions/0002-image-generation.md); it previously read "no cloud
  inference, ever," which forbade things it was never aimed at. Two tests, both must pass:
  *disclosure* (does the outbound payload contain anything about this household?) and
  *availability* (does 6:00 AM correctness depend on that call?). Runtime conversation stays
  local and pinned by model name — never a LiteLLM tier that can fall back to a hosted
  provider (see §3). Build-time asset generation carrying no household reference is fine.
- **No cloud dependencies, no paid services.** Self-hosted is the requirement, not a taste.
- **The Pi is disposable.** All state and logic live on the server. The Pi must be reproducible
  from a script in this repo, never from hand-edited files nobody remembers.
- **Kid-facing surfaces render per child, not once.** With a reader, an emergent reader and a
  pre-reader in the house, a single presentation is wrong for two of the three. This is a
  hard requirement, not polish.
- **The wall proves it is the wall; it does not assert it.** Authentication is a per-device token
  issued to the kiosk at boot, never its network address. Established 2026-08-24 by
  [H3](design-review/H3-premortem.md): address-based trust fails open (a reassigned DHCP lease
  trusts a guest phone) *and* fails closed invisibly (a renewed lease 403s every read while the
  kiosk's last-known-good screenshot makes the wall look healthy).
- **Guardrails are architectural, not prompt-level.** Children and guests touch this screen.
  Destructive actions must be impossible from the wall rather than discouraged — approvals are
  PIN-gated, the wall holds no admin session, and nothing on it can delete a calendar event.
  (Originally written about the assistant's entity allowlist; the assistant is cut, the
  principle is not.)
- **Google Home stays the device layer; this project never takes it over.** Mostly settled by
  [ADR-0004](decisions/0004-build-the-app.md) — with HA demoted to a calendar source there is
  no smart home here to confuse it with — but the boundary is recorded because the pressure to
  cross it recurs. Decided 2026-08-23 when
  the question "am I signing up to manage two smart-home services?" was raised. The answer is
  no, and it is an invariant rather than a preference: lights, thermostats, speakers and
  anything else already on Google Home stay there permanently. Home Assistant here is a
  calendar / task / chore / routine engine that happens to render a wall — it is not a second
  smart home, and the two do not overlap in responsibility. Concretely: do **not** wire
  household devices into HA, and do **not** use HA's Google Assistant integration to bridge
  them (it wants Nabu Casa cloud, which fails the no-cloud invariant above). The one sanctioned
  exception is a device that exists *only* to serve the wall and that Google Home has no role
  for — the M2 mmWave presence sensor via ESPHome. If a second such case appears, it needs the
  same test: would Google Home ever be asked to control this? If yes, it does not belong in HA.
- **Secrets only via 1Password** (`op run --env-file`), never literals in the repo.

## 5. Component disposition

Re-cut by [ADR-0004](decisions/0004-build-the-app.md) on 2026-08-24. The through-line: **build
the stateful half, harvest the rest, and keep only what already works.**

| Component | Verdict | Rationale |
|---|---|---|
| **The application** | **build it** | Nothing in the landscape covers more than one of the four jobs in §1, and nothing does money at all. The stateful half — completion, ledger, approval, routine state — has to be written under any substrate, so it gets written once, coherently. |
| Data store | **SQLite** (`better-sqlite3`) | One household, one writer. Backup is copying a file into the host's existing backup chain. Postgres earns nothing here. |
| Backend | **Fastify + REST, SSE for live updates** | A child taps a chore; the parent view updates. One-way server→client suffices. |
| Frontend | **React + Vite**, served by the same process | Three per-child renderings of one state is app work, not card configuration. |
| Calendar source | **HA behind a `CalendarSource` adapter** | Its Google OAuth is finished and in production (§3). `HomeAssistantCalendar` now, `GoogleCalendar` direct later; swapping is a config change and nothing else in the app may know HA exists. |
| Chores / points / approval | **build** | ChoreOps was never installed, so this replaces nothing. Study its domain model — individual / shared / first-complete / rotation, claim→approve — but it is GPL-3.0: **read it, do not copy it.** |
| Routines | **build — the flagship** | Ordered, time-boxed, daily-resetting, picture-led. Confirmed twice to have no off-the-shelf answer anywhere. Moves to M1; it is the point. |
| Money / stars | **one points ledger, configurable currency** | Nothing open-source tracks real allowance. Name the currency dollars, 1 point = $1, and let the payout be a human handing over cash — it always was. Build the ledger, not a bank. |
| Auth | **wall trusted by IP; parents PIN-gated** | Kids tap an avatar; they are not accounts. Simpler than HA's model and correct for a wall. Replaces `trusted_networks`, whose lesson survives: no human may need to log the wall in, and the browser profile stays disposable. |
| Kiosk runtime | **keep — unchanged** | labwc, `kiosk.service`, autologin chain, `setup.sh`, `deploy.sh`. Substrate-agnostic: it points Chromium at a URL. Survives the pivot untouched. |
| Graceful-degradation gate | **keep — repoint the probe** | `kiosk-gate.py` + last-known-good screenshot is verified end-to-end. Only the probe target changes, HA's `/api/` → the app's health endpoint. |
| Home Assistant | **demoted to a calendar source** | Not the architecture. Kept for finished OAuth, behind an adapter, replaceable. |
| Lovelace, `wall.yaml`, `wall-kiosk.js`, Calendar Card Pro | **discarded** | Always scaffolding. Small loss, taken deliberately. |
| Personal task list (Todoist) | **dropped 2026-08-23** | A personal inbox is not household-operations content, and the wall renders shared obligations. Unchanged by ADR-0004. |
| Donetick | **rejected as substrate** | 2.5k★ and the best task app of the three, but no calendar at all and no approval flow — adopting it adds a stack without removing one. Study subtasks-with-smart-reset as a routine primitive. AGPLv3: read, do not copy. |
| DinkyDash | **rejected as a fork base; harvested** | A read-only renderer (50-line Flask app over a daily Claude call) where this is a stateful app; no writes, no store, no ledger. But **MIT**, so its design language *can* be lifted — emoji-forward, big type, pre-reader-legible — along with the countdown primitive ("3 sleeps until Christmas"), which nothing else offers. |
| Mealie, WallPanel, mmWave presence, local assistant | **cut to the icebox** | None serves any of the four jobs in §1. Together they are what turned this into a smart-home project. |
| Magic Frame, MagicMirror², DAKboard | **rejected** | ADR-0001's reasoning stands and is only reinforced: substrate risk, display-only, and cloud+subscription respectively. |

## 6. Scope: now / next / not

- **Now (M1) — the app exists and runs the morning.** Data model and SQLite store; calendar
  sync into local state; chores per child with claim→approve; the points ledger; **the routine
  runner**; three per-child renderings (pictures / icons+words / text+points+streaks); the
  kiosk repointed off HA; the degradation gate repointed.
- **Next (M2) — make it good on the wall.** Routine step imagery
  ([ADR-0002](decisions/0002-image-generation.md), build-time assets); countdowns and the
  delight layer; parental controls; screen power scheduling (done 2026-10-11).
- **Not doing** —
  - *A smart home.* Google Home keeps every device, permanently (§4). HA is a calendar source
    and nothing more.
  - *A local assistant, meal planning, presence detection, photo screensaver.* Cut 2026-08-24.
    They are adjacent household-operations features, not this product's jobs.
  - *A personal task list on the wall.* Dropped 2026-08-23 (§5).
  - *Voice input.* Speakers are reserved, not wired. Touch first.
  - *Per-child Google accounts.* Kids' calendars live inside an adult account; kids are avatars
    in this app, not identities in Google's.
  - *Exposing the app to the public internet.* LAN + tailnet only.
  - *Cloud inference on household data,* under any latency argument.

## 7. Success criteria

| Criterion | Check |
|---|---|
| Display survives a power cut unattended | Pull power, restore; dashboard on screen and touch-responsive with no input |
| Browser crash self-heals | `pkill chromium` over SSH; dashboard returns within seconds |
| Server-outage behaviour is graceful | `docker compose stop` the app stack; display shows last-known-good, not a browser error |
| The wall never blocks on the network | Cut the server's WAN; the dashboard still renders today's schedule, chores and routines from local state |
| A child can complete a chore | The eldest taps a chore on the wall; it enters the approval queue and her balance updates on approval, not before |
| A routine runs unaided | The youngest advances a picture-led routine to completion with no adult input and no text on screen |
| Each child gets their own rendering | The same state renders three ways — pictures (the youngest), icons + short words (the middle child), text + points + streaks (the eldest) |
| No cloud inference path | No LLM in the render path at all; build-time imagery only, per ADR-0002 |
| Legible at range on a dim panel | Readable at 10 ft in daylight on the mounted 225-nit anti-glare panel |
| A 3-year-old can actually use it | The youngest completes a routine step unaided — targets sized for imprecise taps, mounted within his reach |
| WiFi is adequate at the mount point | Link quality measured at final position, not at the bench. Bench reading was 94/100 @ 405Mbit/s on the household network, which proves nothing about an exterior wall behind a 10lb metal-and-glass panel |
| WiFi failover actually works | Unplug eth0; the Pi still answers on its wlan0 lease and the dashboard stays up |
| Power is clean | `vcgencmd get_throttled` reads `0x0` a full day after the supply swap |
| Reproducible Pi | Reflash + run `pi/scripts/setup.sh` reproduces the kiosk with no manual steps |

## 8. Open questions

| Question | Owner | Decision trigger |
|---|---|---|
| Second adult's name, for their calendar + colour | The operator | Before M1 calendar wiring |
| Confirmed final mount position, and measured WiFi link quality there | The operator | Before declaring the physical install done |
| ~~Tasks surface: Todoist `todo` entity vs the sync calendar~~ — **resolved 2026-08-23: neither.** Todoist is dropped entirely (§5); the `Todoist` sync calendar is excluded from the dashboard. Routines and chores become the task-shaped surface instead | The operator | Closed |
| Confirm the ADR-0004 stack — Node 22 + TypeScript / SQLite / Fastify / React, one container | The operator | Before the first line of app code |
| The exchange rate: what one star is worth, and whether it differs per child by age | The operator | Before the ledger is built |
| Whether the middle child (5) sees points at all, or only the eldest (7) | The operator | Before the ledger is built |
| When to retire the HA calendar adapter for the direct Google Calendar API | The operator | After M1 ships; no trigger before it |
| ~~Assistant brain; assistant write confirmation; mmWave sensor; photo→event VLM~~ — **closed 2026-08-24, all cut to the icebox by ADR-0004.** None served the four jobs in §1 | — | Closed |
