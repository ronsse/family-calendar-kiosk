#!/usr/bin/env bash
# Installs the weekly scene timer and the daily wall backup as USER units for whoever runs this.
#
# A user unit, not a system one, because the whole pipeline runs as this user: it reads the
# 1Password service token from ~/.config, and it talks to Docker through the user's group
# membership. A system unit would need both of those copied to root, which is two more copies
# of a secret for no gain.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dest="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$dest"
install -m644 "$here/scene-week.service" "$here/scene-week.timer" \
  "$here/wall-backup.service" "$here/wall-backup.timer" "$dest/"

# The units name the checkout as %h/projects/family-calendar. Anywhere else, they would run
# scripts that are not there, so say so rather than install a timer that fails at 04:45.
repo="$(cd "$here/../../.." && pwd)"
if [ "$repo" != "$HOME/projects/family-calendar" ]; then
  echo "WARNING: this checkout is $repo, but the units expect $HOME/projects/family-calendar."
  echo "  fix:  move or symlink the checkout there, or edit the installed units in $dest"
fi

# Per-install settings for the units, kept OUT of the repo: the backup unit reads this file
# through EnvironmentFile=- (the dash makes it optional). Seeded once, never overwritten, so a
# re-run of this script cannot reset where an existing install's backups land.
units_env="$HOME/.config/family-calendar/units.env"
if [ ! -e "$units_env" ]; then
  install -d -m700 "$(dirname "$units_env")"
  cat >"$units_env" <<'EOF'
# family-calendar: settings for the user units (stacks/wall/systemd/install.sh seeded this).
# Not tracked by git. Plain KEY=value lines, read by systemd's EnvironmentFile=; no quoting
# or $-expansion. Edit, then: systemctl --user daemon-reload
#
# WALL_DATA_ROOT  where bulk household data lives. Backups go to
#                 $WALL_DATA_ROOT/backups/family-wall (default root /srv/family-calendar).
# WALL_BACKUP_DEST  the backup directory itself, if it does not follow that layout.
#                   Wins over WALL_DATA_ROOT.
# WALL_BACKUP_KEEP  how many daily tarballs to keep (default 30).
#
#WALL_DATA_ROOT=/srv/family-calendar
#WALL_BACKUP_DEST=/srv/family-calendar/backups/family-wall
EOF
  chmod 600 "$units_env"
  echo "seeded $units_env (all defaults; edit it to move the backups)"
fi
# The timer's 02:30 means the HOUSEHOLD's 02:30. systemd reads a zone at the end of
# OnCalendar=, so the installed copy gets the household's `timezone` (the same value the wall
# uses; its default when db/household.json is absent). The server's own clock is usually UTC.
zone="$(cd "$repo" && python3 -c 'import sys; sys.path.insert(0, "tools"); import household_config as h; print(h.load_or_defaults()["timezone"])' 2>/dev/null || true)"
if [ -n "$zone" ] && systemd-analyze calendar "Sun *-*-* 02:30:00 $zone" >/dev/null 2>&1; then
  sed -i "s|^OnCalendar=\(.*\)\$|OnCalendar=\1 $zone|" "$dest/scene-week.timer"
  echo "scene-week.timer: 02:30 in $zone"
else
  echo "WARNING: could not read the household timezone; scene-week.timer runs on the server's clock."
fi
systemctl --user daemon-reload
systemctl --user enable --now scene-week.timer wall-backup.timer

# User units stop when the last session ends unless lingering is on. Without it the timer is
# installed, enabled, and never fires on a headless box — which looks exactly like the bug this
# whole feature exists to fix, so it is checked rather than assumed.
if ! loginctl show-user "$USER" --property=Linger 2>/dev/null | grep -q 'Linger=yes'; then
  echo "WARNING: lingering is OFF for $USER, so this timer will not fire when you are logged out."
  echo "  fix:  sudo loginctl enable-linger $USER"
fi
systemctl --user list-timers scene-week.timer wall-backup.timer --no-pager
