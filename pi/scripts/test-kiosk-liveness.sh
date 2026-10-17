#!/usr/bin/env bash
# State-machine tests for kiosk-liveness.sh. Stubs systemctl/curl/ps.
# Run from anywhere: bash pi/scripts/test-kiosk-liveness.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/pi/config/bin/kiosk-liveness.sh"
[[ -f "$SCRIPT" ]] || { echo "missing $SCRIPT" >&2; exit 1; }

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/kiosk-liveness-test.XXXXXX")"
trap 'rm -rf "$WORKDIR"' EXIT
STUBS="$WORKDIR/stubs"
STATE="$WORKDIR/run"
mkdir -p "$STUBS" "$STATE/profile" "$STATE/bin"

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
cat > "$STUBS/systemctl" <<'EOF'
#!/usr/bin/env bash
# Usage of the real script:
#   systemctl --user is-active --quiet kiosk.service
#   systemctl --user show -p MainPID --value kiosk.service
#   systemctl --user restart kiosk.service
cmd=""
for a in "$@"; do
  case "$a" in
    is-active|show|restart) cmd="$a" ;;
  esac
done
case "$cmd" in
  is-active)
    [[ "${KIOSK_ACTIVE:-1}" = 1 ]]
    ;;
  show)
    printf '%s\n' "${KIOSK_PID:-0}"
    ;;
  restart)
    echo restarted >> "${KIOSK_RESTART_LOG}"
    ;;
  *)
    echo "stub systemctl: unexpected: $*" >&2
    exit 99
    ;;
esac
EOF
chmod +x "$STUBS/systemctl"

cat > "$STUBS/curl" <<'EOF'
#!/usr/bin/env bash
if [[ "${CURL_SLEEP:-0}" != 0 ]]; then
  sleep "$CURL_SLEEP"
fi
if [[ "${CURL_OK:-0}" = 1 ]]; then
  exit 0
fi
exit 22
EOF
chmod +x "$STUBS/curl"

cat > "$STUBS/ps" <<'EOF'
#!/usr/bin/env bash
if [[ "${PS_FAIL:-0}" = 1 ]]; then
  exit 1
fi
printf ' %s\n' "${KIOSK_AGE:-200}"
EOF
chmod +x "$STUBS/ps"

export PATH="$STUBS:$PATH"
export XDG_RUNTIME_DIR="$STATE"
export KIOSK_PROFILE_DIR="$STATE/profile"
export KIOSK_DEVTOOLS_PORT=9222
export KIOSK_LIVENESS_FAILURES=3
export KIOSK_LIVENESS_GRACE_SEC=90
export KIOSK_RESTART_LOG="$STATE/restarts"
: > "$KIOSK_RESTART_LOG"

run() {
  bash "$SCRIPT"
}

reset_state() {
  rm -f "$STATE"/kiosk-liveness.* "$STATE"/kiosk-watchdog.state
  : > "$KIOSK_RESTART_LOG"
  export KIOSK_ACTIVE=1 KIOSK_PID=4242 KIOSK_AGE=200 CURL_OK=0 CURL_SLEEP=0 PS_FAIL=0
}

restarts() { wc -l < "$KIOSK_RESTART_LOG" | tr -d ' '; }

# --- cases ------------------------------------------------------------------------
echo "== kiosk-liveness state machine"

reset_state
run
assert "inactive-server (no watchdog state) does not restart" "[ \"$(restarts)\" = 0 ]"
assert "inactive-server does not arm" "[ ! -f \"$STATE/kiosk-liveness.armed\" ]"

reset_state
printf 'down' > "$STATE/kiosk-watchdog.state"
CURL_OK=1 run
assert "server-down does not arm even if DevTools answers" "[ ! -f \"$STATE/kiosk-liveness.armed\" ]"
assert "server-down does not restart" "[ \"$(restarts)\" = 0 ]"

reset_state
printf 'up' > "$STATE/kiosk-watchdog.state"
KIOSK_ACTIVE=0 run
assert "kiosk-inactive clears and exits" "[ \"$(restarts)\" = 0 ]"

reset_state
printf 'up' > "$STATE/kiosk-watchdog.state"
KIOSK_PID=0 run
assert "MainPID 0 is a no-op" "[ \"$(restarts)\" = 0 ]"

reset_state
printf 'up' > "$STATE/kiosk-watchdog.state"
KIOSK_AGE=10 CURL_OK=0 run
assert "inside grace, no probe side effects" "[ \"$(restarts)\" = 0 ]"
assert "inside grace, not armed" "[ ! -f \"$STATE/kiosk-liveness.armed\" ]"

reset_state
printf 'up' > "$STATE/kiosk-watchdog.state"
CURL_OK=1 run
assert "first success arms with MainPID" "[ \"$(cat "$STATE/kiosk-liveness.armed")\" = 4242 ]"
assert "first success does not restart" "[ \"$(restarts)\" = 0 ]"

reset_state
printf 'up' > "$STATE/kiosk-watchdog.state"
printf '4242' > "$STATE/kiosk-liveness.armed"
CURL_OK=0
run
assert "first miss after arm increments fails to 1" "[ \"$(cat "$STATE/kiosk-liveness.fails")\" = 1 ]"
assert "first miss does not restart" "[ \"$(restarts)\" = 0 ]"
run
assert "second miss increments fails to 2" "[ \"$(cat "$STATE/kiosk-liveness.fails")\" = 2 ]"
assert "second miss does not restart" "[ \"$(restarts)\" = 0 ]"
run
assert "third miss restarts" "[ \"$(restarts)\" = 1 ]"
assert "third miss clears armed" "[ ! -f \"$STATE/kiosk-liveness.armed\" ]"
assert "third miss clears fails" "[ ! -f \"$STATE/kiosk-liveness.fails\" ]"

reset_state
printf 'up' > "$STATE/kiosk-watchdog.state"
printf '1111' > "$STATE/kiosk-liveness.armed"
printf '2' > "$STATE/kiosk-liveness.fails"
KIOSK_PID=4242
CURL_OK=0
run
assert "stale armed pid is not inherited as a hang" "[ \"$(restarts)\" = 0 ]"
assert "stale armed pid is dropped" "[ ! -f \"$STATE/kiosk-liveness.armed\" ]"

reset_state
printf 'up' > "$STATE/kiosk-watchdog.state"
KIOSK_AGE=200 CURL_OK=0
run
assert "never-armed miss does not restart" "[ \"$(restarts)\" = 0 ]"
assert "never-armed miss does not write fails" "[ ! -f \"$STATE/kiosk-liveness.fails\" ]"
assert "never-armed miss after 180s warns once" "[ -f \"$STATE/kiosk-liveness.warned\" ]"
run
assert "second never-armed miss still does not restart" "[ \"$(restarts)\" = 0 ]"

reset_state
printf 'up' > "$STATE/kiosk-watchdog.state"
printf '9223\n/devtools/browser/abc\n' > "$STATE/profile/DevToolsActivePort"
CURL_OK=1
run
assert "DevToolsActivePort success still arms" "[ \"$(cat "$STATE/kiosk-liveness.armed")\" = 4242 ]"

reset_state
printf 'up' > "$STATE/kiosk-watchdog.state"
printf '4242' > "$STATE/kiosk-liveness.armed"
printf '1' > "$STATE/kiosk-liveness.fails"
CURL_OK=1
run
assert "success after a miss re-arms" "[ \"$(cat "$STATE/kiosk-liveness.armed")\" = 4242 ]"
assert "success after a miss clears fails" "[ ! -f \"$STATE/kiosk-liveness.fails\" ]"
assert "success after a miss does not restart" "[ \"$(restarts)\" = 0 ]"

echo
if [[ "$FAIL" -ne 0 ]]; then
  echo "FAILED: $FAIL  passed: $PASS"
  exit 1
fi
echo "PASSED: $PASS"
