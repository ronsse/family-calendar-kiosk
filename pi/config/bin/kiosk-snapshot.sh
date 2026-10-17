#!/usr/bin/env bash
# Capture last-known-good: what the wall looked like while it was working.
#
# This PNG is what the family sees at 6:00 AM when homeserver is down — today's
# calendar as it last rendered, instead of a browser error. Pixels, not a live
# UI: you cannot tick a chore off it. That is the accepted M1 tradeoff (ADR-0003).
#
# The hard requirement is NEVER capturing something worse than nothing. A
# screenshot of an error page, a login form, or of the fallback page itself
# (a screenshot of a screenshot) would poison the only thing we have to show.
# So we capture only when we can prove Chromium is currently displaying the
# real dashboard, which we read from its DevTools target list.
set -uo pipefail

SHARE_DIR="${KIOSK_SHARE_DIR:-$HOME/.local/share/kiosk}"
OUT="${SHARE_DIR}/last-good.png"
DEVTOOLS_PORT="${KIOSK_DEVTOOLS_PORT:-9222}"
URL="${DASHBOARD_URL:-http://homeserver:8124/}"

proto="${URL%%://*}"; rest="${URL#*://}"; origin="${proto}://${rest%%/*}"

command -v grim >/dev/null 2>&1 || { echo "kiosk-snapshot: grim not on PATH — skipping" >&2; exit 0; }
"$HOME/.local/bin/kiosk-probe.sh" || exit 0

# A systemd --user timer can fire before labwc imported the session env. Fall back
# to the first wayland socket rather than skipping every tick until a human acts.
if [ -z "${WAYLAND_DISPLAY:-}" ] && [ -n "${XDG_RUNTIME_DIR:-}" ]; then
  for sock in "$XDG_RUNTIME_DIR"/wayland-*; do
    [ -S "$sock" ] || continue
    WAYLAND_DISPLAY="$(basename "$sock")"; export WAYLAND_DISPLAY; break
  done
fi
[ -n "${WAYLAND_DISPLAY:-}" ] || { echo "kiosk-snapshot: no WAYLAND_DISPLAY — skipping" >&2; exit 0; }

# Ask the browser what it is actually showing. Requires the DevTools port that
# kiosk-liveness.sh already depends on; if it is absent we decline to guess.
targets="$(curl -sf --max-time 4 "http://127.0.0.1:${DEVTOOLS_PORT}/json" 2>/dev/null || true)"
[ -n "$targets" ] || { echo "kiosk-snapshot: no DevTools answer — skipping" >&2; exit 0; }

showing_dashboard="$(printf '%s' "$targets" | python3 -c '
import json, sys
try:
    targets = json.load(sys.stdin)
except Exception:
    print("no"); raise SystemExit
origin = sys.argv[1]
for t in targets:
    if t.get("type") != "page":
        continue
    url = t.get("url", "")
    # On the app origin, which by construction excludes the gate (127.0.0.1) and so
    # excludes the fallback page — a screenshot of a screenshot is worse than nothing.
    # The /auth/ exclusion is inherited from the Home Assistant era: our app has no auth
    # path (the device token rides a URL fragment), so it never matches today. It stays
    # because the rule it encodes -- never capture a credential prompt -- is the reason
    # this check exists at all, and the day something does add one, silence would be the
    # expensive answer.
    if url.startswith(origin) and "/auth/" not in url:
        print("yes"); raise SystemExit
print("no")
' "$origin" 2>/dev/null || echo no)"

if [ "$showing_dashboard" != yes ]; then
  echo "kiosk-snapshot: browser is not on the dashboard — skipping" >&2
  exit 0
fi

mkdir -p "$SHARE_DIR"
tmp="${OUT}.tmp.$$"
if grim "$tmp" 2>/dev/null && [ -s "$tmp" ]; then
  # Atomic replace: a torn PNG is exactly the 6:00 AM surface we are avoiding.
  mv -f "$tmp" "$OUT"
else
  rm -f "$tmp"
  echo "kiosk-snapshot: grim produced nothing — keeping previous snapshot" >&2
fi
exit 0
