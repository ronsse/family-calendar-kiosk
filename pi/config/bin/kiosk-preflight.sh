#!/usr/bin/env bash
# ExecStartPre for kiosk.service — runs before every Chromium launch.
#
# A power cut is always an unclean exit, and Chromium answers an unclean exit with a
# "Restore pages?" bubble. On a wall display that bubble IS the product failure: the
# family gets a dialog instead of the calendar and nobody has a keyboard. Scrub the
# crash flags out of the profile every time, before Chromium reads them.
set -uo pipefail

PROFILE_DIR="${KIOSK_PROFILE_DIR:-$HOME/.config/chromium-kiosk}"
PREFS="$PROFILE_DIR/Default/Preferences"

if [ -f "$PREFS" ]; then
  # Chromium's JsonPrefStore currently serializes compact ("exit_type":"Crashed") and
  # the tight pattern does match this build — verified on the Pi. But the scrub is
  # coupled to a formatting choice upstream can change silently, and a silent no-op
  # here means a "Restore pages?" dialog on the wall. Tolerate optional whitespace so
  # a future pretty-printer does not break it.
  if ! sed -i \
      -e 's/"exit_type"[[:space:]]*:[[:space:]]*"[^"]*"/"exit_type":"Normal"/' \
      -e 's/"exited_cleanly"[[:space:]]*:[[:space:]]*false/"exited_cleanly":true/' \
      "$PREFS"; then
    # Deliberately do NOT abort: a dirty crash flag costs a dialog, but refusing to
    # start costs a dark wall, and the dark wall is the worse failure. Do make it
    # loud, though — this used to fail identically to succeeding, so a full or
    # read-only SD card would silently reintroduce the "Restore pages?" bubble.
    echo "kiosk-preflight: WARNING - could not scrub crash flags in $PREFS" >&2
    echo "kiosk-preflight: disk full, read-only rootfs, or damaged profile?" >&2
    df -h "$PROFILE_DIR" 2>&1 | tail -1 >&2
  fi
fi

# A hard kill (power cut, pkill, OOM) can leave the profile singleton behind, and
# Chromium then refuses to start with "profile appears to be in use". systemd has
# already reaped the previous process before ExecStartPre runs, so nothing legitimate
# owns these by the time we get here.
rm -f "$PROFILE_DIR/SingletonLock" "$PROFILE_DIR/SingletonSocket" "$PROFILE_DIR/SingletonCookie" 2>/dev/null

# Never fail the unit: a missing or unparseable profile is not a reason to keep the
# wall dark. Chromium will recreate it.
exit 0
