#!/usr/bin/env bash
# Put the Pi back on the network when its Wi-Fi drops and does not come back by itself.
#
# Runs as ROOT once a minute (net-watchdog.timer). On 2026-10-04 the wall's Wi-Fi went
# away at ~01:45 and stayed away for eight hours: the Pi was up, the panel showed its
# last-known calendar under "reconnecting", and nothing on the box ever tried again.
# A power cycle fixed it, which is the one remedy a wall nobody is standing at cannot
# apply to itself. This applies it, in escalating steps, after consecutive failed minutes:
#
#   BOUNCE_AT  : radio off, radio on      (cheap; re-runs association from scratch)
#   RESTART_AT : restart NetworkManager   (and wpa_supplicant with it)
#   REBOOT_AT  : reboot — but only if this boot is older than MIN_UPTIME_S, so a network
#                that is really gone (router dead, power cut upstairs) costs one reboot
#                an hour, not a reboot loop.
#
# "Up" is EITHER the default gateway answering a ping OR the wall app answering. Two
# tests, because either one alone can fail on a working network — a router that stops
# answering ICMP would otherwise reboot a healthy wall every hour forever, and homeserver
# being down is not a reason to touch the Pi's Wi-Fi at all.
#
# Each failed minute logs the radio's own view (link, SSID, signal) so the persistent
# journal holds the evidence the volatile one threw away. NET_WATCHDOG_DRY=1 logs every
# action without taking it.
set -uo pipefail

BOUNCE_AT="${BOUNCE_AT:-3}"
RESTART_AT="${RESTART_AT:-8}"
REBOOT_AT="${REBOOT_AT:-15}"
MIN_UPTIME_S="${MIN_UPTIME_S:-3600}"
IFACE="${IFACE:-wlan0}"
STATE="${NET_WATCHDOG_STATE:-/run/net-watchdog.fails}"
DRY="${NET_WATCHDOG_DRY:-0}"

say() { echo "net-watchdog: $*"; }
act() { say "ACTION: $*"; [ "$DRY" = 1 ] || "$@"; }

gateway="${NET_WATCHDOG_GATEWAY:-$(ip -4 route show default 2>/dev/null | awk '{print $3; exit}')}"
dashboard="${NET_WATCHDOG_DASHBOARD-}"
if [ -z "${NET_WATCHDOG_DASHBOARD+set}" ] && [ -n "${KIOSK_ENV:-}" ] && [ -r "$KIOSK_ENV" ]; then
  dashboard="$(grep -h '^DASHBOARD_URL=' "$KIOSK_ENV" | cut -d= -f2- | tail -1)"
fi

up=0
if [ -n "$gateway" ] && ping -c 2 -W 2 "$gateway" >/dev/null 2>&1; then up=1
elif [ -n "$dashboard" ] && curl -sf -o /dev/null --max-time 6 "$dashboard"; then up=1
fi

prev="$(cat "$STATE" 2>/dev/null || echo 0)"
if [ "$up" = 1 ]; then
  [ "$prev" != 0 ] && say "network back after ${prev} failed minute(s)"
  echo 0 > "$STATE"
  exit 0
fi

fails=$((prev + 1))
echo "$fails" > "$STATE"
link="$(iw dev "$IFACE" link 2>/dev/null | grep -E 'Connected|SSID|signal' | tr -s ' \t\n' ' ')"
say "down ${fails} min (gateway=${gateway:-none}) ${IFACE}: ${link:-not associated}; nm=$(nmcli -t -f STATE general 2>/dev/null)"

if [ "$fails" = "$BOUNCE_AT" ]; then
  act nmcli radio wifi off
  [ "$DRY" = 1 ] || sleep 3
  act nmcli radio wifi on
elif [ "$fails" = "$RESTART_AT" ]; then
  act systemctl restart NetworkManager
elif [ "$fails" -ge "$REBOOT_AT" ]; then
  uptime_s="$(cut -d. -f1 /proc/uptime)"
  if [ "$uptime_s" -ge "$MIN_UPTIME_S" ]; then
    act systemctl reboot
  elif [ "$fails" = "$REBOOT_AT" ]; then
    say "would reboot, but this boot is only ${uptime_s}s old — waiting for ${MIN_UPTIME_S}s"
  fi
fi
exit 0
