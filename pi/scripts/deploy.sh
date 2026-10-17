#!/usr/bin/env bash
# Push this repo's pi/ tree to the Pi and run setup.sh there. Run from homeserver.
#
#   pi/scripts/deploy.sh wall-pi    # host argument required: any ssh alias for the Pi
#   KIOSK_HOST=wall-pi pi/scripts/deploy.sh
#
# The Pi is disposable (PRD §4): everything it needs lives here and is pushed, never
# hand-edited on the box.
set -euo pipefail

HOST="${1:-${KIOSK_HOST:-}}"
if [[ -z "${HOST}" ]]; then
  echo "usage: pi/scripts/deploy.sh <ssh-host>   (or set KIOSK_HOST)" >&2
  exit 2
fi
PI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> syncing ${PI_ROOT}/ -> ${HOST}:~/kiosk/"
# scripts/ goes across too, and must: the next line runs setup.sh from the copied tree.
# --delete keeps the Pi reproducible; kiosk.env lives in ~/.config, not here, so it survives.
rsync -a --delete "${PI_ROOT}/" "${HOST}:kiosk/"

echo "==> running setup.sh on ${HOST}"
ssh "${HOST}" 'bash ~/kiosk/scripts/setup.sh'
