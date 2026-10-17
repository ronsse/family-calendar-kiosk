#!/usr/bin/env bash
# Tests for screen-power.sh. Stubs wlopm; the clock is SCREEN_POWER_NOW.
# Run from anywhere: bash pi/scripts/test-screen-power.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/pi/config/bin/screen-power.sh"
[[ -f "$SCRIPT" ]] || { echo "missing $SCRIPT" >&2; exit 1; }

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/screen-power-test.XXXXXX")"
trap 'rm -rf "$WORKDIR"' EXIT
STUBS="$WORKDIR/stubs"
RUN="$WORKDIR/run"
mkdir -p "$STUBS" "$RUN"
# A real socket, so the "no compositor yet" early exit is not what passes the tests.
python3 -c 'import socket,sys; socket.socket(socket.AF_UNIX).bind(sys.argv[1])' "$RUN/wayland-0"

PASS=0
FAIL=0
assert() {
  local name="$1" cond="$2"
  if eval "$cond"; then
    PASS=$((PASS + 1))
    printf '  ok  %s\n' "$name"
  else
    FAIL=$((FAIL + 1))
    printf '  FAIL %s  (%s)\n' "$name" "$cond"
  fi
}

# --- stubs ------------------------------------------------------------------------
# `wlopm` with no args prints "<output> <on|off>"; `wlopm --on|--off <out>` records the call
# and flips the state file so a second run sees the result.
cat > "$STUBS/wlopm" <<'STUB'
#!/usr/bin/env bash
if [ $# -eq 0 ]; then echo "HDMI-A-1 $(cat "$WLOPM_STATE")"; exit 0; fi
echo "$*" >> "$WLOPM_CALLS"
case "$1" in --on) echo on > "$WLOPM_STATE" ;; --off) echo off > "$WLOPM_STATE" ;; esac
STUB
chmod +x "$STUBS/wlopm"

export PATH="$STUBS:$PATH" XDG_RUNTIME_DIR="$RUN" WAYLAND_DISPLAY=wayland-0
export WLOPM_STATE="$WORKDIR/state" WLOPM_CALLS="$WORKDIR/calls"

# run <screen state before> <now> [args...] — leaves the state in $WLOPM_STATE, calls in $WLOPM_CALLS
run() {
  echo "$1" > "$WLOPM_STATE"; : > "$WLOPM_CALLS"
  local now="$2"; shift 2
  SCREEN_POWER_NOW="$now" bash "$SCRIPT" "$@" > "$WORKDIR/out" 2>&1
}
state() { cat "$WLOPM_STATE"; }
calls() { wc -l < "$WLOPM_CALLS" | tr -d ' '; }

echo "default window 06:00-21:00"
unset SCREEN_ON_AT SCREEN_OFF_AT
run on 21:00;  assert "21:00 turns it off"            '[ "$(state)" = off ]'
run off 06:00; assert "06:00 turns it on"             '[ "$(state)" = on ]'
run on 05:59;  assert "05:59 is still night"          '[ "$(state)" = off ]'
run off 20:59; assert "20:59 is still day"            '[ "$(state)" = on ]'
run off 00:00; assert "midnight is night"             '[ "$(state)" = off ] && [ "$(calls)" = 0 ]'
run on 12:00;  assert "already right: no wlopm call"  '[ "$(calls)" = 0 ] && [ ! -s "$WORKDIR/out" ]'

echo "a window that wraps midnight (on 18:00, off 02:00)"
export SCREEN_ON_AT=18:00 SCREEN_OFF_AT=02:00
run off 23:30; assert "23:30 is on"                   '[ "$(state)" = on ]'
run off 01:59; assert "01:59 is on"                   '[ "$(state)" = on ]'
run on 02:00;  assert "02:00 is off"                  '[ "$(state)" = off ]'
run on 12:00;  assert "noon is off"                   '[ "$(state)" = off ]'
unset SCREEN_ON_AT SCREEN_OFF_AT

echo "a malformed value fails ON"
export SCREEN_ON_AT=6am SCREEN_OFF_AT=21:00
run off 03:00; assert "bad SCREEN_ON_AT keeps it on"  '[ "$(state)" = on ] && grep -q "bad SCREEN_ON_AT" "$WORKDIR/out"'
export SCREEN_ON_AT=06:00 SCREEN_OFF_AT=25:00
run off 03:00; assert "bad SCREEN_OFF_AT keeps it on" '[ "$(state)" = on ]'
unset SCREEN_ON_AT SCREEN_OFF_AT

echo "a touch at night"
rm -f "$RUN/screen-power.wake"
run off 23:00 --wake;  assert "--wake lights it at night"           '[ "$(state)" = on ] && [ -e "$RUN/screen-power.wake" ]'
run on 23:01;          assert "the timer leaves a woken screen on"  '[ "$(state)" = on ] && [ "$(calls)" = 0 ]'
run on 23:05 --idle;   assert "--idle drops the hold and darks it"  '[ "$(state)" = off ] && [ ! -e "$RUN/screen-power.wake" ]'
run on 12:00 --idle;   assert "--idle in the day changes nothing"   '[ "$(state)" = on ] && [ "$(calls)" = 0 ]'
: > "$RUN/screen-power.wake"; touch -d '31 minutes ago' "$RUN/screen-power.wake"
run on 23:40;          assert "a hold older than 30 min expires"    '[ "$(state)" = off ] && [ ! -e "$RUN/screen-power.wake" ]'
: > "$RUN/screen-power.wake"; touch -d '29 minutes ago' "$RUN/screen-power.wake"
run on 23:40;          assert "a hold younger than 30 min stands"   '[ "$(state)" = on ]'
rm -f "$RUN/screen-power.wake"

echo "edges"
rm -f "$RUN/wayland-0"
run on 23:00;  assert "no compositor yet: exit 0, no call" '[ "$(calls)" = 0 ]'
SCREEN_POWER_NOW=12:00 bash "$SCRIPT" --bogus > /dev/null 2>&1 && rc=0 || rc=$?
assert "unknown argument exits 2" '[ "$rc" = 2 ]'

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
