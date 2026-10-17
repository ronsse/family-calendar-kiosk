#!/usr/bin/env bash
# Screen power, as a RECONCILER: every run works out what the panel should be and fixes it
# only if it is wrong. Two one-shot jobs ("off at 21:00", "on at 06:00") would leave the wall
# dark all day if the 06:00 one ever missed — a reboot at 05:59, a crashed session, a monitor
# power-cycled by hand. A reconciler that runs every minute has no missable moment.
#
#   on   between SCREEN_ON_AT and SCREEN_OFF_AT (kiosk.env; default 06:00-21:00)
#   on   at night while someone is touching it (the wake stamp, written by swayidle's resume)
#   off  otherwise
#
# Usage: screen-power.sh            reconcile (the timer, and swayidle's idle timeout)
#        screen-power.sh --wake     a touch at night: hold the screen on until idle again
#        screen-power.sh --idle     idle again: drop the hold, then reconcile
#
# Screen power on Wayland is wlopm. xset/DPMS are X11-era and silently do nothing here.
set -uo pipefail

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"
ON_AT="${SCREEN_ON_AT:-06:00}"
OFF_AT="${SCREEN_OFF_AT:-21:00}"
WAKE="$XDG_RUNTIME_DIR/screen-power.wake"
NOW="${SCREEN_POWER_NOW:-$(date +%H:%M)}"   # injectable for the test

valid() { [[ "$1" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]]; }
if ! valid "$ON_AT" || ! valid "$OFF_AT"; then
  # A typo in kiosk.env must never dark the wall: fail ON, and say why.
  echo "screen-power: bad SCREEN_ON_AT/SCREEN_OFF_AT ('$ON_AT'/'$OFF_AT') — keeping the screen on"
  ON_AT=00:00; OFF_AT=24:00
fi

case "${1:-}" in
  --wake) : > "$WAKE" ;;
  --idle) rm -f "$WAKE" ;;
  "") ;;
  *) echo "screen-power: unknown argument '$1'" >&2; exit 2 ;;
esac

# Zero-padded HH:MM compares correctly as a string. ON_AT < OFF_AT is the daytime window;
# the reverse (e.g. on 18:00, off 02:00) wraps midnight.
if [[ "$ON_AT" < "$OFF_AT" ]]; then
  [[ ! "$NOW" < "$ON_AT" && "$NOW" < "$OFF_AT" ]] && want=on || want=off
else
  [[ ! "$NOW" < "$ON_AT" || "$NOW" < "$OFF_AT" ]] && want=on || want=off
fi
# The hold expires on its own after 30 minutes, so a swayidle that died mid-hold cannot keep
# the wall lit all night. swayidle's 5-minute idle timeout normally drops it long before.
[ -e "$WAKE" ] && [ -n "$(find "$WAKE" -mmin +30 2>/dev/null)" ] && rm -f "$WAKE"
[[ "$want" = off && -e "$WAKE" ]] && want=on

# No compositor yet (early boot) is not an error; the next run will find one.
[ -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ] || exit 0

state="$(wlopm 2>/dev/null)" || { echo "screen-power: wlopm failed to read output state"; exit 1; }
# Every output that is not in the wanted state; usually zero lines, so usually nothing happens.
wrong="$(awk -v w="$want" '$2 != w { print $1 }' <<<"$state")"
[ -z "$wrong" ] && exit 0

for out in $wrong; do
  wlopm "--$want" "$out" && echo "screen-power: $out -> $want at $NOW (window $ON_AT-$OFF_AT$([ -e "$WAKE" ] && echo ', touch-wake'))"
done
