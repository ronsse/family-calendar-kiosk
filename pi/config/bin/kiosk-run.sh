#!/usr/bin/env bash
# ExecStart for kiosk.service. exec's Chromium so systemd supervises the browser
# itself — Restart=always then makes a crash invisible from the living room.
set -uo pipefail

# Chromium loads the GATE, not the app directly. The gate 302s to the dashboard
# while the app answers and serves last-known-good while it does not, so the browser
# never has the chance to paint a network error (ADR-0003). DASHBOARD_URL is
# still the single knob — the gate reads it — it is just not what we navigate to.
GATE_PORT="${KIOSK_GATE_PORT:-18765}"
START_URL="http://127.0.0.1:${GATE_PORT}/"
PROFILE_DIR="${KIOSK_PROFILE_DIR:-$HOME/.config/chromium-kiosk}"
DEVTOOLS_PORT="${KIOSK_DEVTOOLS_PORT:-9222}"

# Debian 13 (trixie) ships /usr/bin/chromium. Bookworm shipped /usr/bin/chromium-browser
# and most kiosk guides online still say so — on trixie that name resolves to a stale
# deb12 package. Resolve at runtime rather than hardcoding either.
CHROMIUM="$(command -v chromium || command -v chromium-browser || true)"
if [ -z "$CHROMIUM" ]; then
  echo "kiosk: no chromium binary on PATH" >&2
  exit 1
fi

# --remote-debugging-port is the liveness probe's only genuine signal (see
# kiosk-liveness.sh). The bind is loopback — VERIFIED on this Pi's Chromium 151
# (`ss -ltn` showed 127.0.0.1, never *). --remote-debugging-address is passed as
# a statement of intent, but it does NOT appear in this build's strings, so it is
# probably ignored and loopback is just the default; do not treat it as a
# guarantee. Re-check `ss -ltn sport = :9222` after a Chromium major upgrade —
# a default of 0.0.0.0 would let anyone on the LAN drive the wall session — including
# reading the device token out of the page.
exec "$CHROMIUM" \
  --ozone-platform=wayland \
  --user-data-dir="$PROFILE_DIR" \
  --kiosk \
  --start-fullscreen \
  --no-first-run \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-features=Translate,TranslateUI,AutofillServerCommunication \
  --hide-scrollbars \
  --force-device-scale-factor="${KIOSK_SCALE:-2.0}" \
  --lang=en-US \
  --accept-lang=en-US \
  --disable-pinch \
  --disable-dev-shm-usage \
  --disk-cache-dir=/tmp/chromium-cache \
  --disk-cache-size=104857600 \
  --overscroll-history-navigation=0 \
  --touch-events=enabled \
  --autoplay-policy=no-user-gesture-required \
  --check-for-update-interval=31536000 \
  --disable-component-update \
  --password-store=basic \
  --remote-debugging-port="$DEVTOOLS_PORT" \
  --remote-debugging-address=127.0.0.1 \
  "$START_URL"
