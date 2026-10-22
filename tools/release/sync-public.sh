#!/usr/bin/env bash
# sync-public.sh — carry this repository's committed HEAD into the public repository as ONE
# ordinary commit on top of its history.
#
#   tools/release/sync-public.sh --dry-run
#   tools/release/sync-public.sh [--no-test] [--push] "<commit message>"
#
# build-public.sh makes the public tree (private paths removed, art swapped, the full release
# gate run on it); this script makes the public checkout's tree EXACTLY that tree, so a file
# changed, added, deleted or made executable here arrives there with nothing copied by hand.
# Untracked and ignored files in the public checkout (node_modules, caches) are never touched.
#
# Steps, each fatal, nothing committed until all pass:
#   1. the public checkout is on main, clean, and not behind its remote
#   2. build-public.sh into a temporary directory (it refuses uncommitted changes here,
#      because the archive is HEAD, and runs verify-clean --public and --full)
#   3. show what changes (A/M/D per file); --dry-run stops here and has written nothing
#   4. move the public checkout's index and working tree onto the built tree
#   5. verify-clean --public, then (unless --no-test) npm ci if the lockfile changed,
#      npx tsc --noEmit and npm test; a failure puts the checkout back where it was
#   6. commit as the release author; with --push, push and watch the CI run
#
# Without --push nothing leaves this machine: publishing stays a separate decision. A later
# --push with nothing new to sync still pushes commits that are waiting.
#
# Inputs (local, gitignored; the same lookup build-public.sh uses):
#   PUBLIC_REPO   or the first line of local/public-repo.txt — the public checkout's path
#   RELEASE_AUTHOR or local/release-author.txt — "Name <...@users.noreply.github.com>"

set -euo pipefail

die() { echo "sync-public: $*" >&2; exit 1; }
usage() {
  echo 'usage: tools/release/sync-public.sh --dry-run' >&2
  echo '       tools/release/sync-public.sh [--no-test] [--push] "<commit message>"' >&2
  exit 2
}

DRY=0; PUSH=0; TEST=1; MSG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --push) PUSH=1 ;;
    --no-test) TEST=0 ;;
    -h|--help) usage ;;
    -*) echo "sync-public: unknown flag $1" >&2; usage ;;
    *) [ -z "$MSG" ] || usage; MSG="$1" ;;
  esac
  shift
done
if [ "$DRY" = 1 ]; then
  [ "$PUSH" = 0 ] && [ -z "$MSG" ] || die "--dry-run takes no message and no --push"
else
  [ -n "$MSG" ] || usage
fi

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(git -C "$SELF_DIR" rev-parse --show-toplevel)"
COMMON="$(git -C "$SRC" rev-parse --path-format=absolute --git-common-dir)"
MAIN="$(dirname "$COMMON")"
local_file() {
  if [ -f "$SRC/$1" ]; then echo "$SRC/$1"; elif [ -f "$MAIN/$1" ]; then echo "$MAIN/$1"; fi
}

PUB="${PUBLIC_REPO:-}"
if [ -z "$PUB" ]; then
  PF="$(local_file local/public-repo.txt)"
  [ -n "$PF" ] && PUB="$(head -n 1 "$PF")"
fi
[ -n "$PUB" ] || die "no public checkout: set PUBLIC_REPO or write its path to local/public-repo.txt"
PUB="$(realpath -- "$PUB")"
[ -d "$PUB/.git" ] || die "$PUB is not a git checkout"
case "$PUB/" in "$SRC/"*|"$MAIN/"*) die "the public checkout must be outside this repository" ;; esac

AUTHOR="${RELEASE_AUTHOR:-}"
if [ -z "$AUTHOR" ]; then
  AF="$(local_file local/release-author.txt)"
  [ -n "$AF" ] && AUTHOR="$(head -n 1 "$AF")"
fi
AUTHOR_RE='^([^<>]+[^<>[:space:]])[[:space:]]+<([^<>[:space:]]+@users[.]noreply[.]github[.]com)>$'
[[ "$AUTHOR" =~ $AUTHOR_RE ]] \
  || die "no commit identity: set RELEASE_AUTHOR or local/release-author.txt to \"Name <...@users.noreply.github.com>\""
AUTHOR_NAME="${BASH_REMATCH[1]}"
AUTHOR_EMAIL="${BASH_REMATCH[2]}"

pg() { git -C "$PUB" -c core.hooksPath=/dev/null -c commit.gpgsign=false \
         -c user.name="$AUTHOR_NAME" -c user.email="$AUTHOR_EMAIL" "$@"; }
remote() { pg -c credential.helper='!gh auth git-credential' "$@"; }

# 1. The public checkout.
[ "$(pg symbolic-ref --short -q HEAD || true)" = main ] || die "$PUB is not on main"
pg diff --quiet HEAD -- || die "$PUB has uncommitted changes; commit or discard them first"
[ -z "$(pg ls-files --others --exclude-standard)" ] || die "$PUB has untracked files; commit, ignore or remove them first"
HAS_REMOTE=0
if pg remote get-url origin >/dev/null 2>&1; then
  HAS_REMOTE=1
  remote fetch -q origin main || die "could not fetch origin; nothing changed"
  pg merge-base --is-ancestor origin/main HEAD \
    || die "origin/main has commits $PUB does not; pull them first (a public edit made on GitHub?)"
fi

# 2. Build.
BUILD="$(mktemp -d "${TMPDIR:-/tmp}/sync-public.XXXXXX")"
LOG="$BUILD.log"
trap 'rm -rf -- "$BUILD" "$LOG"' EXIT
echo "== building the public tree from $(git -C "$SRC" rev-parse --short HEAD)"
"$SELF_DIR/build-public.sh" "$BUILD" >"$LOG" 2>&1 || { cat "$LOG" >&2; die "the build failed; nothing changed"; }
grep -E '^(PASS|FAIL|verify-clean:)' "$LOG" | sed 's/^/   /' || true

# 3. What changes. The comparison runs in the build, so --dry-run writes nothing to $PUB.
git -C "$BUILD" fetch -q "$PUB" HEAD
CHANGES="$(git -C "$BUILD" diff --name-status FETCH_HEAD HEAD)"
if [ -z "$CHANGES" ]; then
  echo "== the public checkout already matches HEAD"
else
  echo "== changes for the public repository:"
  echo "$CHANGES" | sed 's/^/   /'
fi
if [ "$DRY" = 1 ]; then echo "== dry run: nothing written"; exit 0; fi

if [ -n "$CHANGES" ]; then
  # 4. Apply: a two-tree read-tree moves index AND working tree from the public HEAD to the
  # built tree — deletions and modes included — and refuses rather than overwrite a file.
  pg fetch -q "$BUILD" main
  BUILT="$(pg rev-parse FETCH_HEAD^{tree})"
  pg read-tree -u -m HEAD "$BUILT"
  # Every change above was made by this script on a checkout step 1 proved clean, so putting
  # it back is a hard reset; untracked and ignored files are untouched by it.
  rollback() { pg reset -q --hard HEAD; die "$1; $PUB is back where it was, nothing committed"; }

  # 5. Gate the public checkout itself.
  "$PUB/tools/release/verify-clean.sh" --public >"$LOG" 2>&1 || { cat "$LOG" >&2; rollback "verify-clean --public failed"; }
  if [ "$TEST" = 1 ]; then
    if [ ! -d "$PUB/node_modules" ] || echo "$CHANGES" | grep -qE '[[:space:]]package(-lock)?\.json$'; then
      echo "== npm ci (dependencies changed or absent)"
      (cd "$PUB" && npm ci --silent >"$LOG" 2>&1) || { cat "$LOG" >&2; rollback "npm ci failed"; }
    fi
    echo "== tsc --noEmit"
    (cd "$PUB" && npx tsc --noEmit >"$LOG" 2>&1) || { tail -30 "$LOG" >&2; rollback "the public tree does not typecheck"; }
    echo "== npm test"
    (cd "$PUB" && npm test >"$LOG" 2>&1) || { grep -E '^not ok|^# (tests|pass|fail)' "$LOG" >&2; rollback "npm test failed"; }
    grep -E '^# (tests|pass|fail)' "$LOG" | sed 's/^/   /' || true
  fi

  # 6. Commit.
  pg commit -q -m "$MSG"
  echo "== committed $(pg rev-parse --short HEAD) to $PUB"
fi

if [ "$HAS_REMOTE" = 0 ]; then echo "== no origin remote; nothing to push"; exit 0; fi
AHEAD="$(pg rev-list --count origin/main..HEAD)"
if [ "$AHEAD" = 0 ]; then echo "== origin is up to date"; exit 0; fi
if [ "$PUSH" = 0 ]; then
  echo "== $AHEAD commit(s) waiting; publish with: tools/release/sync-public.sh --push \"<message>\""
  exit 0
fi
SHA="$(pg rev-parse HEAD)"
remote push -q origin main || die "push failed; the commit is still local"
echo "== pushed $AHEAD commit(s)"
if command -v gh >/dev/null 2>&1; then
  RUN=""
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    RUN="$(cd "$PUB" && gh run list --commit "$SHA" --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)"
    [ -n "$RUN" ] && break
    sleep 3
  done
  [ -n "$RUN" ] || { echo "== no CI run found for $SHA; check GitHub Actions by hand"; exit 0; }
  echo "== watching CI run $RUN"
  (cd "$PUB" && gh run watch "$RUN" --exit-status >"$LOG" 2>&1) || { tail -20 "$LOG" >&2; die "CI failed for $SHA"; }
  echo "== CI passed"
fi
