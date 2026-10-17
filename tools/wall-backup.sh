#!/usr/bin/env bash
# Copy the wall's whole state out of its Docker volume, once a day.
#
# The volume (wall_wall-data) is the ONLY copy of three things: the points ledger and every
# approval in wall.db, and the generated picture library under assets/scenes — a generated
# scene exists nowhere else (CLAUDE.md, the picture-library gotcha). The server's nightly
# backups covered the code checkout and the data root's backups directory, and a Docker volume
# lives in /var/lib/docker, which is neither. Found uncovered 2026-10-06.
#
# The database is copied with SQLite's ONLINE backup API inside the running container, not
# with cp: wall.db runs in WAL mode, and a file copy of a live WAL database can be missing
# its last commits or be torn. The copy is checked (integrity_check, and a row count) before
# it is kept, so a backup that would not restore is a failure today, not a surprise later.
#
# Output: $DEST/wall-<stamp>.tar.gz holding wall.db and assets/. Keeps the newest $KEEP.
# Restore: docs/runbook.md, "Restoring the wall from a backup".
set -euo pipefail

CONTAINER="${WALL_CONTAINER:-family-calendar-wall}"
DEST="${WALL_BACKUP_DEST:-${WALL_DATA_ROOT:-/srv/family-calendar}/backups/family-wall}"
KEEP="${WALL_BACKUP_KEEP:-30}"
stamp="$(date +%Y%m%d-%H%M)"
work="$(mktemp -d)"
inner="/tmp/wall-backup-$stamp.db"
trap 'rm -rf "$work"; docker exec "$CONTAINER" rm -f "$inner" >/dev/null 2>&1 || true' EXIT

docker exec -i "$CONTAINER" node --no-warnings - "$inner" <<'JS'
const { DatabaseSync, backup } = require('node:sqlite');
const src = new DatabaseSync('/data/wall.db', { readOnly: true });
backup(src, process.argv[2]).then((pages) => {
  console.log(`wall-backup: copied ${pages} pages`);
}).catch((err) => { console.error(`wall-backup: ${err.message}`); process.exit(2); });
JS

mkdir -p "$work/wall"
docker cp -q "$CONTAINER:$inner" "$work/wall/wall.db"
docker cp -q "$CONTAINER:/data/assets" "$work/wall/assets"

python3 - "$work/wall/wall.db" <<'PY'
import sqlite3, sys
db = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
ok = db.execute("pragma integrity_check").fetchone()[0]
if ok != "ok":
    sys.exit(f"wall-backup: integrity_check says {ok!r} — not keeping this copy")
scenes = db.execute("select count(*) from scene").fetchone()[0]
children = db.execute("select count(*) from child").fetchone()[0]
if not children:
    sys.exit("wall-backup: the copy has no children — not keeping a backup of an empty wall")
print(f"wall-backup: integrity ok, {children} children, {scenes} scenes")
PY

install -d -m 0700 "$DEST"
out="$DEST/wall-$stamp.tar.gz"
tar -czf "$out.partial" -C "$work" wall
chmod 0600 "$out.partial"
mv "$out.partial" "$out"
echo "wall-backup: $out ($(du -h "$out" | cut -f1), $(find "$work/wall/assets/scenes" -type f | wc -l) scene files)"

ls -1t "$DEST"/wall-*.tar.gz | tail -n +"$((KEEP + 1))" | xargs -r rm -f
