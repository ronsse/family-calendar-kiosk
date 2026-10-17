#!/usr/bin/env bash
# Reproduce the wall kiosk from a fresh Raspberry Pi OS Lite flash.
#
#   From homeserver:  pi/scripts/deploy.sh [ssh-host]     <- the normal path
#   On the Pi:    ~/kiosk/scripts/setup.sh
#
# Idempotent — safe to re-run. Run as the kiosk user, NOT root: most of what this
# installs is per-user state (systemd --user units, labwc config, the Chromium
# profile) and root's copy of it would never be read.
#
# Targets Raspberry Pi OS Lite on a Pi 5. Three things about that platform break the
# kiosk recipes you will find online:
#   - The compositor is labwc (wlroots/Wayland). xset, unclutter, DPMS and .xinitrc
#     are X11-era and silently do nothing. `cage` would stack a second compositor on
#     top of one that is already minimal.
#   - Debian 13 (trixie) renamed the browser package to `chromium`. The old name
#     `chromium-browser` still resolves — to a stale deb12 build.
#   - Lite has no display manager and no desktop session, so nothing starts a
#     compositor for you. Autologin on tty1 is what boots the display (see below).
#
# INPUT REQUIREMENTS (not provisioned here — they come from the base image):
#   - the kiosk user exists and has PASSWORDLESS sudo. deploy.sh runs this
#     non-interactively over SSH, so a sudo password prompt kills the run. On this
#     box that comes from cloud-init writing /etc/sudoers.d/010-<user>-nopasswd.
#   - SSH key auth is already working for that user.
# Until those are generated from this repo too, "reproducible from a fresh flash"
# means "fresh flash of an image provisioned that way", not "any Pi OS Lite image".
set -euo pipefail

PI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_DIR="$PI_ROOT/config"
KIOSK_USER="$(id -un)"

log()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m !!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m !!\033[0m %s\n' "$*" >&2; exit 1; }

# --- preflight ---------------------------------------------------------------------
# Note there is deliberately NO "is Wayland running?" check here. The previous version
# of this script refused to run unless XDG_SESSION_TYPE=wayland, which over SSH on a
# Lite box is never true — the script that installs the compositor would not run until
# the compositor was already running. Bringing the session up is this script's job.
[[ $EUID -eq 0 ]] && die "run as the kiosk user, not root"
[[ -d "$CONFIG_DIR" ]] || die "config tree not found at $CONFIG_DIR"
sudo -n true 2>/dev/null || die "passwordless sudo is required (see /etc/sudoers.d/)"

log "user=${KIOSK_USER} config=${CONFIG_DIR}"

# --- packages ----------------------------------------------------------------------
log "installing packages"
sudo apt-get update -qq
sudo apt-get install -y -qq labwc wlr-randr wlopm libinput-tools
# swayidle wakes the scheduled-dark screen on a touch (screen-idle.service).
sudo apt-get install -y -qq swayidle
# A COLOUR EMOJI FONT, and it is not cosmetic. The wall draws an emoji beside every calendar
# event it can classify — that is the only channel the two children who cannot read a title
# have on that screen. Pi OS Lite ships no emoji font at all, and the failure is silent: the
# glyph falls through to DejaVu Sans and renders as a tofu box, which looks like a rendering
# bug rather than a missing package. Verified with:  fc-match ":charset=1F483"
sudo apt-get install -y -qq fonts-noto-color-emoji

if ! sudo apt-get install -y -qq chromium 2>/dev/null; then
  warn "no 'chromium' package; falling back to 'chromium-browser'"
  sudo apt-get install -y -qq chromium-browser
fi

# --- linger: keep the user manager alive independent of any login session -----------
# Without this the systemd --user manager is torn down when the last session ends,
# taking the kiosk unit with it.
log "enabling linger for ${KIOSK_USER}"
sudo loginctl enable-linger "${KIOSK_USER}"

# --- timezone ------------------------------------------------------------------------
# The app renders in HOUSEHOLD_TZ regardless of this, via Intl with an explicit timeZone --
# so a wrong zone here does NOT put a wrong date on the wall. It puts a wrong timestamp in
# every log, which is worse than it sounds: the one time anybody reads these logs is while
# standing in front of a wall that is wrong at 6:05 AM, correlating them against a clock on
# the kitchen wall. Found shipped as America/New_York on 2026-08-25.
WALL_TZ="${WALL_TZ:-America/Denver}"
if [[ "$(timedatectl show -p Timezone --value 2>/dev/null)" != "$WALL_TZ" ]]; then
  log "setting timezone -> ${WALL_TZ}"
  sudo timedatectl set-timezone "$WALL_TZ"
fi

# --- kiosk scripts -------------------------------------------------------------------
log "installing kiosk scripts -> ~/.local/bin"
install -d "$HOME/.local/bin"
install -m 0755 "$CONFIG_DIR/bin/kiosk-preflight.sh" "$HOME/.local/bin/kiosk-preflight.sh"
install -m 0755 "$CONFIG_DIR/bin/kiosk-run.sh"       "$HOME/.local/bin/kiosk-run.sh"
install -m 0755 "$CONFIG_DIR/bin/kiosk-watchdog.sh"  "$HOME/.local/bin/kiosk-watchdog.sh"
install -m 0755 "$CONFIG_DIR/bin/screen-power.sh"    "$HOME/.local/bin/screen-power.sh"
install -m 0755 "$CONFIG_DIR/bin/kiosk-liveness.sh"  "$HOME/.local/bin/kiosk-liveness.sh"
install -m 0755 "$CONFIG_DIR/bin/kiosk-probe.sh"     "$HOME/.local/bin/kiosk-probe.sh"
install -m 0755 "$CONFIG_DIR/bin/kiosk-snapshot.sh"  "$HOME/.local/bin/kiosk-snapshot.sh"
install -m 0755 "$CONFIG_DIR/bin/kiosk-gate.py"      "$HOME/.local/bin/kiosk-gate.py"

# --- offline fallback page -------------------------------------------------------------
# Served by the gate when the wall app is unreachable. Lives under ~/.local/share (NOT tmpfs):
# the snapshot beside it must survive the power cut that makes it necessary.
log "installing offline fallback -> ~/.local/share/kiosk"
install -d "$HOME/.local/share/kiosk/fallback"
install -m 0644 "$CONFIG_DIR/fallback/index.html" "$HOME/.local/share/kiosk/fallback/index.html"

# --- labwc config ---------------------------------------------------------------------
log "installing labwc config -> ~/.config/labwc"
install -d "$HOME/.config/labwc"
install -m 0644 "$CONFIG_DIR/labwc/rc.xml"       "$HOME/.config/labwc/rc.xml"
install -m 0644 "$CONFIG_DIR/labwc/environment"  "$HOME/.config/labwc/environment"
install -m 0755 "$CONFIG_DIR/labwc/autostart"    "$HOME/.config/labwc/autostart"

# --- kiosk.env -------------------------------------------------------------------------
# Never clobber a local edit: this file holds the dashboard URL and the device token, and
# both are things someone edits on the box during bring-up. New KEYS are appended so an
# existing box picks them up; existing VALUES are never touched.
STALE_DASHBOARD=0
if [[ -f "$HOME/.config/kiosk.env" ]]; then
  log "~/.config/kiosk.env exists — leaving existing keys alone"
  # A box provisioned before WP2 will not have KIOSK_DEVTOOLS_PORT. The
  # scripts default to 9222, but write the key so the next person who reads
  # the file on the Pi can see the port is a real knob, not a magic number.
  if ! grep -q '^KIOSK_DEVTOOLS_PORT=' "$HOME/.config/kiosk.env"; then
    printf '\n# Loopback DevTools port for kiosk-liveness.sh. Do not change the bind.\nKIOSK_DEVTOOLS_PORT=9222\n' >> "$HOME/.config/kiosk.env"
    log "appended KIOSK_DEVTOOLS_PORT=9222 to existing kiosk.env"
  fi
  # A box provisioned before the app existed has no device token key at all. Append it
  # EMPTY: an empty token is a supported, visible state (the wall renders the offline
  # card), whereas a token invented here would be a token the server has never heard of.
  if ! grep -q '^WALL_DEVICE_TOKEN=' "$HOME/.config/kiosk.env"; then
    printf '\n# Device token for /api/wall/*. Issue on homeserver:\n#   npm run provision -- --device "living room wall"\nWALL_DEVICE_TOKEN=\n' >> "$HOME/.config/kiosk.env"
    log "appended an empty WALL_DEVICE_TOKEN to existing kiosk.env"
  fi
  # The one thing this script must NOT silently fix, and must not silently ignore either.
  # Rewriting DASHBOARD_URL would clobber exactly the local edit the rule above protects;
  # staying quiet would leave the wall pointed at Home Assistant, where the new probe now
  # correctly reports "down" and the family gets the fallback page forever.
  if grep -q '^DASHBOARD_URL=.*:8123' "$HOME/.config/kiosk.env"; then
    STALE_DASHBOARD=1
  fi
else
  log "installing kiosk.env -> ~/.config/kiosk.env"
  install -m 0644 "$CONFIG_DIR/kiosk.env" "$HOME/.config/kiosk.env"
fi

# --- the kiosk unit ----------------------------------------------------------------------
log "installing kiosk.service -> ~/.config/systemd/user"
install -d "$HOME/.config/systemd/user"
install -m 0644 "$CONFIG_DIR/systemd/kiosk.service"           "$HOME/.config/systemd/user/kiosk.service"
install -m 0644 "$CONFIG_DIR/systemd/kiosk-watchdog.service"  "$HOME/.config/systemd/user/kiosk-watchdog.service"
install -m 0644 "$CONFIG_DIR/systemd/kiosk-watchdog.timer"    "$HOME/.config/systemd/user/kiosk-watchdog.timer"
install -m 0644 "$CONFIG_DIR/systemd/kiosk-liveness.service"  "$HOME/.config/systemd/user/kiosk-liveness.service"
install -m 0644 "$CONFIG_DIR/systemd/kiosk-liveness.timer"    "$HOME/.config/systemd/user/kiosk-liveness.timer"
install -m 0644 "$CONFIG_DIR/systemd/kiosk-gate.service"      "$HOME/.config/systemd/user/kiosk-gate.service"
install -m 0644 "$CONFIG_DIR/systemd/kiosk-snapshot.service"  "$HOME/.config/systemd/user/kiosk-snapshot.service"
install -m 0644 "$CONFIG_DIR/systemd/kiosk-snapshot.timer"    "$HOME/.config/systemd/user/kiosk-snapshot.timer"
install -m 0644 "$CONFIG_DIR/systemd/screen-power.service"    "$HOME/.config/systemd/user/screen-power.service"
install -m 0644 "$CONFIG_DIR/systemd/screen-power.timer"      "$HOME/.config/systemd/user/screen-power.timer"
install -m 0644 "$CONFIG_DIR/systemd/screen-idle.service"     "$HOME/.config/systemd/user/screen-idle.service"
systemctl --user daemon-reload

# The watchdog is what un-strands a kiosk that painted an error page before the
# network was ready. Without it, Chromium sits on that page indefinitely: the
# process is healthy, so Restart=always never fires.
log "enabling kiosk-watchdog.timer"
systemctl --user enable --now kiosk-watchdog.timer

# Sibling of the watchdog: the watchdog tests the SERVER, this tests the CLIENT.
# A missing DevTools answer never restarts until the probe has succeeded once
# for the current MainPID, so enabling it on a box that has not yet picked up
# the new Chromium flags is a log line, not a flash storm.
log "enabling kiosk-liveness.timer"
systemctl --user enable --now kiosk-liveness.timer

# The gate must be up BEFORE Chromium, or the first paint is a refused connection
# to 127.0.0.1 and we have merely moved the error page.
log "enabling kiosk-gate.service"
systemctl --user enable --now kiosk-gate.service
log "enabling kiosk-snapshot.timer"
systemctl --user enable --now kiosk-snapshot.timer

# Screen power is a RECONCILER on a one-minute timer, not two one-shots at the edges: a
# missed 06:00 would otherwise dark the wall all day. Hours are SCREEN_ON_AT / SCREEN_OFF_AT
# in kiosk.env. screen-idle (swayidle) is started by labwc's autostart, which is the only
# place that has WAYLAND_DISPLAY; restart it here only if a session is already up.
log "enabling screen-power.timer"
systemctl --user enable --now screen-power.timer
if [ -S "/run/user/$(id -u)/wayland-0" ]; then
  systemctl --user restart screen-idle.service || warn "screen-idle did not start; touch will not wake the dark screen"
fi

# --- autologin on tty1 ---------------------------------------------------------------------
# The wall has no keyboard, so tty1 has to reach a shell with no human present: that
# login shell is what execs labwc.
log "enabling console autologin on tty1"
sudo install -d /etc/systemd/system/getty@tty1.service.d
sudo tee /etc/systemd/system/getty@tty1.service.d/autologin.conf >/dev/null <<EOF
[Unit]
# getty@ ships Restart=always under systemd's default rate limit (5 starts / 10s).
# tty1's login shell execs labwc; if labwc fails fast — a transient DRM error, panel
# not ready at boot — the shell exits and getty respawns. Five of those inside ten
# seconds latch getty@tty1 into 'failed' PERMANENTLY, and the wall sits on a text
# console until a human SSHs in. Same reasoning as kiosk.service.
StartLimitIntervalSec=0

[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin ${KIOSK_USER} --noclear %I \$TERM
EOF
sudo systemctl daemon-reload

# --- launch labwc from the tty1 login --------------------------------------------------------
PROFILE="$HOME/.bash_profile"
MARKER='# >>> family-calendar kiosk >>>'

if [[ ! -f "$PROFILE" ]]; then
  # bash reads .bash_profile in preference to .profile, so creating one shadows the
  # Debian default. Source it explicitly instead of silently dropping distro PATH setup.
  log "creating ~/.bash_profile (sourcing ~/.profile)"
  printf '%s\n' '[ -f "$HOME/.profile" ] && . "$HOME/.profile"' > "$PROFILE"
fi

if grep -qF "$MARKER" "$PROFILE"; then
  log "~/.bash_profile already starts labwc"
else
  log "adding labwc launcher to ~/.bash_profile"
  cat >> "$PROFILE" <<'PROFILE_BLOCK'

# >>> family-calendar kiosk >>>
# Autologin drops a login shell on tty1; that shell is what starts the compositor.
# Guarded on tty1 so an SSH session never tries to take over the display.
if [ -z "${WAYLAND_DISPLAY:-}" ] && [ "$(tty)" = "/dev/tty1" ]; then
  exec labwc > "${XDG_RUNTIME_DIR:-/tmp}/labwc.log" 2>&1
fi
# <<< family-calendar kiosk <<<
PROFILE_BLOCK
fi

# --- staying on the network --------------------------------------------------------------------
# 2026-10-04: the Wi-Fi dropped at ~01:45 and the wall said "reconnecting" for eight hours,
# until a power cycle. Three changes, one per thing that went wrong:
#   - the radio's power save is the likeliest cause, so it is off;
#   - nothing on the box ever retried, so net-watchdog escalates (radio bounce, restart
#     NetworkManager, at most one reboot an hour) — see the script's header;
#   - the journal was in RAM, so the reboot erased why. It persists now, capped at 64M.
log "network: wifi power save off, net-watchdog, persistent journal"
sudo install -d /etc/NetworkManager/conf.d /etc/systemd/journald.conf.d
sudo install -m 0644 "$CONFIG_DIR/system/wifi-powersave-off.conf" /etc/NetworkManager/conf.d/50-wifi-powersave-off.conf
sudo install -m 0644 "$CONFIG_DIR/system/journald-persistent.conf" /etc/systemd/journald.conf.d/50-persistent.conf
sudo install -m 0755 "$CONFIG_DIR/bin/net-watchdog.sh" /usr/local/sbin/net-watchdog.sh
sudo install -m 0644 "$CONFIG_DIR/system/net-watchdog.service" /etc/systemd/system/net-watchdog.service
sudo install -m 0644 "$CONFIG_DIR/system/net-watchdog.timer"   /etc/systemd/system/net-watchdog.timer
printf 'KIOSK_ENV=%s\n' "$HOME/.config/kiosk.env" | sudo tee /etc/default/net-watchdog >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now net-watchdog.timer
# Live, without a reboot: journald picks up the new storage and moves the RAM log to disk;
# NetworkManager re-reads conf.d, and the radio is told directly because a reload does not
# re-apply power save to a connection that is already up. Never `restart NetworkManager`
# here — deploy.sh is often running over this very Wi-Fi.
sudo systemctl restart systemd-journald
sudo journalctl --flush
sudo nmcli general reload conf
sudo iw dev wlan0 set power_save off 2>/dev/null || warn "could not switch power save off live; it applies at next boot"

# --- console blanking ------------------------------------------------------------------------
# Separate from compositor-level blanking: this is the text console, which is what shows
# during the seconds before labwc takes over (and any time it fails).
if grep -q 'consoleblank=0' /boot/firmware/cmdline.txt 2>/dev/null; then
  log "console blanking already disabled"
else
  log "disabling console blanking (takes effect next boot)"
  sudo sed -i '1 s/$/ consoleblank=0/' /boot/firmware/cmdline.txt
fi

# --- pick up the new scripts -----------------------------------------------------------------
# deploy.sh pushes fresh files, but a running Chromium keeps executing whatever it
# started with. Restart only if it is already up, so a first-run install does not try
# to start a kiosk before there is a compositor to host it.
if systemctl --user is-active --quiet kiosk.service; then
  log "kiosk.service is running — restarting it onto the updated scripts"
  systemctl --user restart kiosk.service
fi

# --- report ------------------------------------------------------------------------------------
echo
log "installed. State:"
printf '    chromium        : %s\n' "$(command -v chromium || command -v chromium-browser || echo MISSING)"
# Named in the summary because a missing emoji font is invisible until somebody notices the
# calendar is drawing boxes at a child who cannot read the words next to them.
printf '    emoji font      : %s\n' "$(fc-list 2>/dev/null | grep -ci emoji | grep -qv '^0$' && echo present || echo MISSING)"
printf '    labwc           : %s\n' "$(command -v labwc || echo MISSING)"
DASHBOARD_NOW="$(grep -h '^DASHBOARD_URL=' "$HOME/.config/kiosk.env" | cut -d= -f2-)"
printf '    dashboard URL   : %s\n' "$DASHBOARD_NOW"
if grep -q '^WALL_DEVICE_TOKEN=.\+' "$HOME/.config/kiosk.env"; then
  printf '    device token    : present\n'
else
  printf '    device token    : MISSING — the wall will show the offline card\n'
fi
printf '    app reachable   : %s\n' "$(DASHBOARD_URL="$DASHBOARD_NOW" "$HOME/.local/bin/kiosk-probe.sh" && echo yes || echo 'NO — gate will serve last-known-good')"
for c in /sys/class/drm/card*-HDMI-A-*/status; do
  [ -e "$c" ] || continue
  printf '    %-16s: %s\n' "$(basename "$(dirname "$c")" | sed 's/^card[0-9]*-//')" "$(cat "$c")"
done
printf '    wifi power save : %s\n' "$(/usr/sbin/iw dev wlan0 get power_save 2>/dev/null | awk '{print $3}')"
printf '    net-watchdog    : %s\n' "$(systemctl is-active net-watchdog.timer)"
printf '    screen schedule : %s, on %s off %s, touch-wake %s\n' "$(systemctl --user is-active screen-power.timer)" \
  "$(grep -h '^SCREEN_ON_AT=' "$HOME/.config/kiosk.env" | cut -d= -f2- || true)" \
  "$(grep -h '^SCREEN_OFF_AT=' "$HOME/.config/kiosk.env" | cut -d= -f2- || true)" \
  "$(systemctl --user is-active screen-idle.service)"
# Asks the disk, not `journalctl | grep -q`: under pipefail grep -q's early exit SIGPIPEs
# journalctl and the pipeline "fails", so that check printed VOLATILE on a persistent journal.
printf '    journal         : %s\n' "$([ -n "$(sudo find /var/log/journal -name '*.journal' -print -quit 2>/dev/null)" ] && echo persistent || echo 'VOLATILE — lost at every reboot')"
printf '    touch devices   : %s\n' "$(grep -ci -e touch -e elo /proc/bus/input/devices 2>/dev/null || true)"

# Loud, and last, so it is the thing still on screen when the deploy finishes.
if [[ "$STALE_DASHBOARD" == "1" ]]; then
  echo
  warn "DASHBOARD_URL still points at port 8123 — that is Home Assistant, not the wall app."
  warn "This script will not rewrite it (it is a local edit). Do it by hand:"
  warn "  sed -i 's|^DASHBOARD_URL=.*|DASHBOARD_URL=http://homeserver:8124/|' ~/.config/kiosk.env"
  warn "  systemctl --user restart kiosk-gate.service kiosk.service"
fi

cat <<'NEXT'

Remaining steps that this script cannot do for you:

  1. (DONE 2026-08-25) The panel is connected -- HDMI-A-1 reports ELO ET2270L and two
     touch devices enumerate. The report above re-checks this every run; trust it, not
     this list.
  2. (DONE 2026-08-24) `homeserver` resolves here via Tailscale MagicDNS -> 100.64.0.2.
     If that ever regresses, fix it by NAME -- MagicDNS or a router-served lease --
     never by pinning homeserver's IP, which has already drifted once.
  3. PUT THE DEVICE TOKEN IN ~/.config/kiosk.env. Issue it on homeserver, once, INSIDE THE
     CONTAINER -- provision.ts falls back to ./dev.db when WALL_DB is unset, so running
     it on the host mints a token into a database the wall never opens:
       cd ~/projects/family-calendar/stacks/wall
       docker compose exec wall node --experimental-strip-types \
         stacks/wall/entry/provision.ts --device "living room wall"
     It prints the database path it used; confirm it says /data/wall.db. Then set
     WALL_DEVICE_TOKEN= to the printed value here. It is not recoverable
     afterwards; re-running provision mints a new one. There is no login to perform on
     the wall itself, and there never will be — a login form on a wall nobody is
     standing at is the wrong answer to every failure it could appear for.
  4. Reboot:  sudo reboot
  5. Verify the acceptance checks (build-plan §5):
       pkill chromium                      -> the wall returns within seconds
       stop the wall stack on homeserver       -> last-known-good + clock, not a browser error
       start it again                      -> live, with zero input here
       pull power, restore                 -> the wall is up, touch works, zero input
NEXT
