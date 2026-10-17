#!/usr/bin/env bash
# build-public.sh <dest-dir> — build the public repository as ONE commit.
#
# The household repository keeps its history and is never pushed. The public
# repository is a separate directory made from this repo's committed HEAD tree
# (git archive HEAD), with a fresh git history of exactly one commit and no
# remote. This script never pushes; publishing is a human step.
#
# The household repository keeps its real art tracked; the public tree swaps it.
# Two inputs, both committed at HEAD (they travel inside the archive):
#   tools/release/private-only.txt   one repo-relative path per line ('#' comments
#                                    and blanks ignored): never in the public tree
#   tools/release/public-assets/     a mirror tree overlaid onto the public root:
#                                    public-assets/assets/avatars/a.jpg replaces
#                                    assets/avatars/a.jpg
# tools/release/public-assets.sha256 lists every public jpg/png at its PUBLIC path.
#
# Steps, each fatal:
#   1. refuse if <dest-dir> exists and is not empty, or if tracked files have
#      uncommitted changes (the archive is HEAD)
#   2. git archive HEAD | tar -x -C <dest-dir>
#   3. delete every private-only.txt path (one already absent is fine; a missing
#      private-only.txt or public-assets/ is not), overlay public-assets/ onto
#      the root, then delete both inputs from <dest-dir>
#   4. git init -b main; git add -A; then, on the INDEX of <dest-dir> and before
#      any commit: verify-clean.sh --public, and verify-clean.sh --full with this
#      checkout's term and blob lists. The asset allowlist and forbidden-blob
#      checks therefore judge the swapped public tree, never the private repo,
#      which legitimately tracks the real art.
#   5. one commit; assert exactly one commit and no remote
#
# The commit identity is NOT in this file (the author's name is a household term,
# so writing it here would fail the term grep this script runs). Supply it as
#   RELEASE_AUTHOR="Full Name <id+user@users.noreply.github.com>"
# or as the single line of the gitignored local/release-author.txt. Only a GitHub
# noreply address is accepted, so a personal address cannot reach the public log.
#
# TEST ONLY: RELEASE_SKIP_VERIFY=1 skips the verify-clean runs in step 4 so the mechanics can be
# exercised on a tree that is not clean yet. Its output must never be published.

set -euo pipefail

MESSAGE="family-calendar-kiosk v0.1.0 — initial public release"

die() { echo "build-public: $*" >&2; exit 1; }

[ $# -eq 1 ] || { echo "usage: tools/release/build-public.sh <dest-dir>" >&2; exit 2; }
DEST="$1"

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(git -C "$SELF_DIR" rev-parse --show-toplevel)"
COMMON="$(git -C "$SRC" rev-parse --path-format=absolute --git-common-dir)"
MAIN="$(dirname "$COMMON")"

# Local-only inputs: this checkout first, then the main checkout (for worktrees).
local_file() {
  if [ -f "$SRC/$1" ]; then echo "$SRC/$1"; elif [ -f "$MAIN/$1" ]; then echo "$MAIN/$1"; fi
}
# RELEASE_TERMS / RELEASE_BLOBS point at the lists explicitly (e.g. from a clone).
TERMS="${RELEASE_TERMS:-$(local_file local/sensitive-terms.txt)}"
BLOBS="${RELEASE_BLOBS:-$(local_file local/forbidden-blobs.txt)}"

AUTHOR="${RELEASE_AUTHOR:-}"
if [ -z "$AUTHOR" ]; then
  AF="$(local_file local/release-author.txt)"
  [ -n "$AF" ] && AUTHOR="$(head -n 1 "$AF")"
fi
[ -n "$AUTHOR" ] || die "no commit identity: set RELEASE_AUTHOR=\"Name <email>\" or write local/release-author.txt"
AUTHOR_RE='^([^<>]+[^<>[:space:]])[[:space:]]+<([^<>[:space:]]+@users[.]noreply[.]github[.]com)>$'
[[ "$AUTHOR" =~ $AUTHOR_RE ]] \
  || die "RELEASE_AUTHOR must be \"Name <...@users.noreply.github.com>\""
AUTHOR_NAME="${BASH_REMATCH[1]}"
AUTHOR_EMAIL="${BASH_REMATCH[2]}"

SKIP="${RELEASE_SKIP_VERIFY:-0}"
if [ "$SKIP" = 1 ]; then
  cat >&2 <<'EOF'
################################################################################
##  WARNING: RELEASE_SKIP_VERIFY=1 -- THE RELEASE GATE IS SKIPPED.            ##
##  This build is for testing build-public.sh only. DO NOT PUBLISH IT.        ##
##  Delete the destination directory when the test is done.                   ##
################################################################################
EOF
fi

# 1. Preconditions.
if [ -e "$DEST" ]; then
  [ -d "$DEST" ] || die "$DEST exists and is not a directory"
  [ -z "$(ls -A "$DEST")" ] || die "$DEST exists and is not empty; refusing"
fi
git -C "$SRC" diff --quiet HEAD -- || die "tracked files have uncommitted changes; commit first (the archive is HEAD)"

# 2. Archive.
DEST="$(realpath -m -- "$DEST")"
case "$DEST/" in "$SRC/"*|"$MAIN/"*) die "destination must be outside the repository: $DEST" ;; esac
mkdir -p "$DEST"
# From here on the destination is ours (it was absent or empty), and until the swap
# it holds the private art, so any failure removes it rather than leave it lying around.
trap 'rc=$?; if [ "$rc" -ne 0 ]; then rm -rf -- "${DEST:?}"; echo "build-public: removed the partial build at $DEST" >&2; fi' EXIT
echo "== archive HEAD ($(git -C "$SRC" rev-parse --short HEAD)) -> $DEST"
git -C "$SRC" archive --format=tar HEAD | tar -x -C "$DEST"

# 3. Swap the private files for public ones. Both inputs come from the archive,
# so they are exactly what HEAD commits, never a local edit.
PRIVATE_ONLY="$DEST/tools/release/private-only.txt"
OVERLAY="$DEST/tools/release/public-assets"
[ -f "$PRIVATE_ONLY" ] || die "tools/release/private-only.txt is not committed at HEAD; refusing to guess what is private"
[ -d "$OVERLAY" ] || die "tools/release/public-assets/ is not committed at HEAD; nothing to replace the private art with"
removed=0; absent=0; n=0
while IFS= read -r rel || [ -n "$rel" ]; do
  n=$((n + 1))
  rel="${rel%$'\r'}"
  case "$rel" in ''|'#'*) continue ;; esac
  case "/$rel/" in
    */../*|*/./*|//*) die "private-only.txt line $n: path must be repo-relative with no . or .. segments" ;;
  esac
  if [ -e "$DEST/$rel" ] || [ -L "$DEST/$rel" ]; then
    rm -rf -- "${DEST:?}/$rel"; removed=$((removed + 1))
  else
    absent=$((absent + 1))
  fi
done < "$PRIVATE_ONLY"
overlaid="$(find "$OVERLAY" -type f | wc -l)"
cp -a "$OVERLAY/." "$DEST/"
rm -rf -- "${OVERLAY:?}" "$PRIVATE_ONLY"
echo "== private-only: $removed removed, $absent already absent; public-assets: $overlaid files overlaid"

# 4. Stage, then gate the staged public tree before anything is committed.
g() {
  git -C "$DEST" -c core.hooksPath=/dev/null -c commit.gpgsign=false \
    -c user.name="$AUTHOR_NAME" -c user.email="$AUTHOR_EMAIL" "$@"
}
g init -q -b main
g add -A -f   # -f: the archive holds only tracked files, some force-added past .gitignore

if [ "$SKIP" != 1 ]; then
  [ -n "$TERMS" ] || die "local/sensitive-terms.txt not found in $SRC or $MAIN; nothing was committed"
  [ -n "$BLOBS" ] || die "local/forbidden-blobs.txt not found in $SRC or $MAIN; nothing was committed"
  gate=0   # run both, so one pass shows every finding
  echo "== verify-clean --public (staged public tree)"
  "$DEST/tools/release/verify-clean.sh" --public || gate=1
  echo "== verify-clean --full (staged public tree, with $SRC's term and blob lists)"
  "$DEST/tools/release/verify-clean.sh" --full --terms "$TERMS" --blobs "$BLOBS" || gate=1
  [ "$gate" = 0 ] || die "the public tree is not clean; nothing was committed"
fi

GIT_AUTHOR_NAME="$AUTHOR_NAME" GIT_AUTHOR_EMAIL="$AUTHOR_EMAIL" \
GIT_COMMITTER_NAME="$AUTHOR_NAME" GIT_COMMITTER_EMAIL="$AUTHOR_EMAIL" \
  g commit -q -m "$MESSAGE"

# 5. Shape.
COUNT="$(git -C "$DEST" rev-list --all --count)"
[ "$COUNT" = 1 ] || die "expected exactly 1 commit in $DEST, found $COUNT"
[ -z "$(git -C "$DEST" remote)" ] || die "$DEST has a remote; it must have none"

echo "== built $DEST: 1 commit ($(git -C "$DEST" rev-parse --short HEAD)), no remote, nothing pushed"
if [ "$SKIP" = 1 ]; then echo "build-public: WARNING: gate was SKIPPED (RELEASE_SKIP_VERIFY=1). DO NOT PUBLISH." >&2; fi
