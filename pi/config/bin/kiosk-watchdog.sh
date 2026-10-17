#!/usr/bin/env bash
# Reload the kiosk whenever dashboard reachability CHANGES, in either direction.
#
# Chromium never retries a failed navigation on its own, and it is a healthy
# process the whole time, so `Restart=always` never fires. Both transitions need us:
#
#   down -> up : Chromium is parked on the local fallback page. Restarting makes
#                it re-request the gate, which now 302s to the live dashboard.
#                (The fallback's 30s meta-refresh usually beats us to it; this is
#                the backstop for when Chromium was showing something else.)
#   up -> down : Chromium is on the app origin and has just painted a network
#                error. Nothing would ever refresh that. Restarting sends it back
#                to the gate, which serves last-known-good instead.
#
# Steady state in either direction does nothing — we never interrupt a good screen.
set -uo pipefail

STATE="${XDG_RUNTIME_DIR:-/tmp}/kiosk-watchdog.state"
prev="$(cat "$STATE" 2>/dev/null || echo unknown)"

if "$HOME/.local/bin/kiosk-probe.sh"; then now=up; else now=down; fi
printf '%s' "$now" > "$STATE"

[ "$now" = "$prev" ] && exit 0

# First observation after boot is not a transition. Restarting here would bounce
# the kiosk ~45s into every boot for no reason.
if [ "$prev" = unknown ]; then
  echo "kiosk-watchdog: first observation — dashboard is $now"
  exit 0
fi

echo "kiosk-watchdog: dashboard $prev -> $now — reloading kiosk"
systemctl --user restart kiosk.service
