#!/usr/bin/env bash
# Restart the kiosk when Chromium is alive as a process but dead as a browser.
#
# WHY: kiosk.service Restart=always only sees process death. A GPU-wedged or
# event-loop-stuck Chromium keeps systemd happy while the wall is blank — the
# 6:00 AM failure with a healthy-looking unit. kiosk-watchdog.sh only asks
# whether the SERVER answers; this asks whether the CLIENT still does.
#
# Signal we trust:
#   GET http://127.0.0.1:$port/json/version
#   That HTTP server lives in the browser process. A 200 means that process's
#   event loop accepted TCP and wrote a response — a genuine liveness signal
#   for that loop. A timeout while MainPID is still running is a genuine hang
#   of that loop. $port is DevToolsActivePort if Chromium wrote one, else
#   KIOSK_DEVTOOLS_PORT (default 9222).
#
# Signals we considered and rejected (they correlate, they do not indicate):
#   - Unchanging grim screenshot: a calendar that does not change for hours
#     is the normal night-time state, not a hang.
#   - MainPID CPU time not increasing: an idle vsynced compositor looks the
#     same.
#   - Renderer/GPU child in D-state: a wedged GPU looks like this, but so
#     does an SD-card stall, and restarting Chromium then flashes the wall
#     without fixing the disk.
#   - /json/version itself does NOT detect a frozen renderer. A white page
#     whose browser process is still serving DevTools returns 200. Detecting
#     that needs CDP Runtime.evaluate over a WebSocket, which we are not
#     shipping untested (no websocket client on the Pi we have actually run).
#     That case is an accepted miss of this probe.
#
# --remote-debugging-port tradeoff:
#   The port is the only cheap genuine signal. It is acceptable here because
#   the DevTools server binds loopback — VERIFIED empirically on this Pi's
#   Chromium 151: `ss -ltn` showed 127.0.0.1:9223, never *:9223.
#   CAVEAT, corrected 2026-08-23: kiosk-run.sh also passes
#   --remote-debugging-address=127.0.0.1, but that switch does NOT appear in
#   this build's strings (--remote-debugging-port and --remote-allow-origins
#   do), so it is most likely being ignored and the loopback bind is simply
#   Chromium's default. The flag is harmless and kept as documentation of
#   intent, but do NOT rely on it as a guarantee against a future default
#   change — re-run the ss check after a Chromium major upgrade. A
#   LAN host cannot connect. A child at the glass has no URL bar. A process
#   already on the Pi can take over the session via DevTools — but that
#   process can already read the profile cookie or ptrace Chromium, so the
#   new exposure is not a new privilege class. What this is NOT: a bind on
#   0.0.0.0, which would let anyone on the LAN execute JS in the wall session.
#   After deploy, `ss -ltn sport = :9222` must show 127.0.0.1, never *:9222.
#
# Composition with kiosk-watchdog:
#   Watchdog restarts only on server down→up. We restart only when the
#   server is currently "up" AND this probe has succeeded at least once for
#   the current MainPID AND then failed N times in a row. We stay out of
#   the way while the app is down (restarting into the same error page is the
#   other script's anti-pattern). A kiosk that has never opened DevTools
#   is not restarted — a missing flag must not become a flash storm.
set -uo pipefail

PROFILE_DIR="${KIOSK_PROFILE_DIR:-$HOME/.config/chromium-kiosk}"
PORT="${KIOSK_DEVTOOLS_PORT:-9222}"
STATE_DIR="${XDG_RUNTIME_DIR:-/tmp}"
ARMED="${STATE_DIR}/kiosk-liveness.armed"
FAILS="${STATE_DIR}/kiosk-liveness.fails"
WARNED="${STATE_DIR}/kiosk-liveness.warned"
WATCHDOG_STATE="${STATE_DIR}/kiosk-watchdog.state"
NEEDLE="${KIOSK_LIVENESS_FAILURES:-3}"
GRACE="${KIOSK_LIVENESS_GRACE_SEC:-90}"

# Chromium writes this as soon as the DevTools HTTP server is up. Trust it
# over the configured default so a remapped port is not a false hang.
if [ -f "$PROFILE_DIR/DevToolsActivePort" ]; then
  IFS= read -r file_port < "$PROFILE_DIR/DevToolsActivePort" || true
  case "$file_port" in
    ''|*[!0-9]*) ;;
    *) PORT="$file_port" ;;
  esac
fi

# No kiosk, nothing to heal. Drop per-pid state so a later start is a fresh arm.
if ! systemctl --user is-active --quiet kiosk.service; then
  rm -f "$ARMED" "$FAILS" "$WARNED"
  exit 0
fi

# The other watchdog owns "server is down / came back". A dead client while
# the app is unreachable is expected (error page, mid-navigation) and a restart
# now would fight it.
server="$(cat "$WATCHDOG_STATE" 2>/dev/null || echo unknown)"
if [ "$server" != up ]; then
  exit 0
fi

mainpid="$(systemctl --user show -p MainPID --value kiosk.service 2>/dev/null || echo 0)"
if [ -z "$mainpid" ] || [ "$mainpid" = 0 ]; then
  exit 0
fi

# Armed state is per-MainPID: a restart (ours or the other watchdog's) must
# not inherit a success from the previous process, or a slow first-paint
# after a watchdog reload looks like a hang.
if [ -f "$ARMED" ]; then
  armed_pid="$(cat "$ARMED" 2>/dev/null || true)"
  if [ "$armed_pid" != "$mainpid" ]; then
    rm -f "$ARMED" "$FAILS" "$WARNED"
  fi
fi

age="$(ps -o etimes= -p "$mainpid" 2>/dev/null | tr -d ' ' || true)"
case "$age" in
  ''|*[!0-9]*) age="$GRACE" ;;
esac
if [ "$age" -lt "$GRACE" ]; then
  exit 0
fi

# -f: any non-200 is a miss. --max-time covers the wedged-accept case
# (handshake starts, body never arrives) as well as a silent drop.
if curl -sf --max-time 5 -o /dev/null "http://127.0.0.1:${PORT}/json/version"; then
  printf '%s' "$mainpid" > "$ARMED"
  rm -f "$FAILS" "$WARNED"
  exit 0
fi

# Miss. If this MainPID has never answered, do not restart: the usual cause
# is "flag not actually on the command line" or "port bound elsewhere", and
# Restart=always would then flash the wall every N minutes forever.
if [ ! -f "$ARMED" ]; then
  if [ ! -f "$WARNED" ] && [ "$age" -ge 180 ]; then
    echo "kiosk-liveness: DevTools never answered on 127.0.0.1:${PORT} after ${age}s — not restarting"
    echo "kiosk-liveness: check --remote-debugging-port on the Chromium command line, and ss -ltn for a loopback bind" >&2
    : > "$WARNED"
  fi
  exit 0
fi

n="$(cat "$FAILS" 2>/dev/null || echo 0)"
case "$n" in
  ''|*[!0-9]*) n=0 ;;
esac
n=$((n + 1))
printf '%s' "$n" > "$FAILS"

if [ "$n" -lt "$NEEDLE" ]; then
  echo "kiosk-liveness: DevTools miss $n/$NEEDLE (pid $mainpid still running, server up)"
  exit 0
fi

echo "kiosk-liveness: DevTools dead for $n polls — restarting kiosk (pid $mainpid hung-but-alive)"
rm -f "$ARMED" "$FAILS" "$WARNED"
systemctl --user restart kiosk.service
