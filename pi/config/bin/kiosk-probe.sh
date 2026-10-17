#!/usr/bin/env bash
# Can the wall actually be rendered right now? exit 0 = yes, exit 1 = no.
#
# Shared by kiosk-gate.py and kiosk-watchdog.sh so they can never disagree about
# what "up" means and fight each other over the screen.
#
# We probe `/api/health`, and docs/api.md says why in one line: "Liveness must mean
# today's snapshot can be produced, not the process is listening." The endpoint needs
# no auth, is loopback+tailnet only, and answers:
#
#   {"ok":true,"dbWritable":true,"generatedAtUtc":"..."}
#
#   ok         -- the database ANSWERS A READ. This is the one we gate on. A wall can
#                 render an already-materialized day from a read-only database, stale
#                 and labelled, and that satisfies the prime invariant. It cannot
#                 render from a database it cannot read at all.
#   dbWritable -- a write of the same allocation class as 06:00 materialization
#                 succeeds. Deliberately NOT part of this decision: a full disk means
#                 today may not be able to materialize, but if it already has, the wall
#                 is fine. Parking the family on a screenshot because the disk is 95%
#                 full would be strictly worse than showing them the day.
#
# Not `/` and not `/api/`: `/` serves the SPA shell, which is a 200 with an empty
# database behind it, and `/api/` is not a route at all (404). Both would report a
# healthy wall while the wall could not be built.
#
# Unreachable (NXDOMAIN / refused / timeout) -> curl reports http_code 000 -> down,
# which is the case the gate exists for.
set -uo pipefail

URL="${DASHBOARD_URL:-http://homeserver:8124/}"

# Reduce the URL to scheme://host[:port]. DASHBOARD_URL may carry a path or a
# fragment; /api/health only exists at the origin.
proto="${URL%%://*}"
rest="${URL#*://}"
origin="${proto}://${rest%%/*}"

response="$(curl -s --max-time 5 -w '\n%{http_code}' "${origin}/api/health" 2>/dev/null || printf '\n000')"
code="${response##*$'\n'}"
body="${response%$'\n'*}"

[ "$code" = "200" ] || exit 1

# Whitespace-tolerant substring match rather than a JSON parser: the Pi has python3,
# but this script runs on every gate request and every watchdog tick, and a fork to an
# interpreter to read one boolean is not worth the seconds. The server emits compact
# JSON.stringify output; stripping spaces covers a future pretty-printer.
case "${body//[[:space:]]/}" in
  *'"ok":true'*) exit 0 ;;
  *)             exit 1 ;;
esac
