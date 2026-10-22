#!/usr/bin/env bash
# verify-clean.sh — the release gate. Fails closed.
#
#   tools/release/verify-clean.sh --full   [--terms PATH] [--blobs PATH]
#   tools/release/verify-clean.sh --public
#
# It checks the git repository this script lives in (so a copy inside a built
# public tree checks that tree), and it NEVER prints matched text: a finding is
# reported as path:line, or as a path alone.
#
# --full (local, before publishing; needs the gitignored household term list)
#   (a) term grep: every tracked file except docs/local/ and local/, against a
#       literal term list (grep -I -i -w -F -f semantics, one term per line)
#   (b) every tracked .jpg/.jpeg/.png has its sha256 in tools/release/public-assets.sha256
#   (c) no tracked file's blob sha is listed in the forbidden-blobs file
#       (format: "<blob sha> <path>", one per line)
#   (d) none of the gitignored household paths is tracked
#   The term list defaults to local/sensitive-terms.txt and the blob list to
#   local/forbidden-blobs.txt, looked up in this checkout and then in the main
#   checkout of the same repository (so a git worktree finds them). A term list
#   that is missing or shorter than 45 lines exits 2.
#
# --public (CI; committed inputs only)
#   (b), (d), and the generic secret/environment shapes in
#   tools/release/public-patterns.txt (EREs; see that file for its format).
#
# (b) and (c) are meant for the PUBLIC tree that build-public.sh assembles (it runs
# this script's copy inside that tree). The household repository legitimately
# tracks its real art, so in it (b) and (c) are expected to fail.
#
# Exit: 0 clean, 1 at least one check failed, 2 usage error or missing term list.

set -uo pipefail

MIN_TERMS=45
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git -C "$SELF_DIR" rev-parse --show-toplevel 2>/dev/null)" || {
  echo "verify-clean: not inside a git repository" >&2; exit 2; }
cd "$ROOT" || exit 2

usage() { sed -n '2,6p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2; exit 2; }

MODE=""; TERMS=""; BLOBS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --full) MODE=full ;;
    --public) MODE=public ;;
    --terms) [ $# -ge 2 ] || usage; TERMS="$2"; shift ;;
    --blobs) [ $# -ge 2 ] || usage; BLOBS="$2"; shift ;;
    -h|--help) usage ;;
    *) echo "verify-clean: unknown argument: $1" >&2; usage ;;
  esac
  shift
done
[ -n "$MODE" ] || usage

TMP="$(mktemp -d)" || exit 2
trap 'rm -rf "$TMP"' EXIT

FAILED=0
# Checks buffer their per-path details in $TMP/detail; the status line prints first.
flush() { if [ -s "$TMP/detail" ]; then cat "$TMP/detail"; fi; : > "$TMP/detail"; }
pass() { printf 'PASS  %s\n' "$1"; flush; }
fail() { printf 'FAIL  %s\n' "$1"; FAILED=1; flush; }

# A local-only input: this checkout first, then the main checkout of the repo.
local_file() {
  local rel="$1" common main
  if [ -f "$ROOT/$rel" ]; then printf '%s\n' "$ROOT/$rel"; return; fi
  common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return
  main="$(dirname "$common")"
  if [ -f "$main/$rel" ]; then printf '%s\n' "$main/$rel"; fi
}

# Tracked files, NUL-separated.
git ls-files -z > "$TMP/files" || { echo "verify-clean: git ls-files failed" >&2; exit 2; }

# Turn "path\0line:text" grep -Z -n output into "path:line" without the text.
strip_text() { tr '\0' '\t' | awk -F'\t' '{ n = $2; sub(/:.*/, "", n); print $1 ":" n }'; }

# ---- (a) term grep ---------------------------------------------------------
check_terms() {
  local lines rc nfiles
  lines=$(grep -c . "$TERMS")
  # Term files are literal strings, one per line. Blank lines would match everything.
  grep -v '^[[:space:]]*$' "$TERMS" > "$TMP/terms"
  tr '\0' '\n' < "$TMP/files" | grep -v -E '^(docs/local|local)/' | tr '\n' '\0' > "$TMP/files-a"
  if [ ! -s "$TMP/files-a" ]; then fail "(a) term grep: no files to check"; return; fi
  xargs -0 grep -I -i -w -F -n -Z -H -f "$TMP/terms" -- < "$TMP/files-a" > "$TMP/hits-a" 2> "$TMP/err-a"
  rc=$?
  # xargs: 0 all matched, 123 some grep exited 1-125 (1 = no match). Distinguish via stderr.
  if [ -s "$TMP/err-a" ]; then
    fail "(a) term grep: grep reported errors:"; sed 's/^/      /' "$TMP/err-a"; return
  fi
  if [ "$rc" -ne 0 ] && [ "$rc" -ne 123 ]; then fail "(a) term grep: xargs exited $rc"; return; fi
  if [ -s "$TMP/hits-a" ]; then
    strip_text < "$TMP/hits-a" > "$TMP/loc-a"
    nfiles=$(cut -d: -f1 "$TMP/loc-a" | sort -u | wc -l)
    fail "(a) term grep: $(wc -l < "$TMP/loc-a") line(s) in $nfiles file(s) [terms file: $lines lines]"
    sed 's/^/      /' "$TMP/loc-a"
    echo "      FILE COUNT (a): $nfiles"
  else
    pass "(a) term grep: 0 files [terms file: $lines lines]"
    echo "      FILE COUNT (a): 0"
  fi
}

# ---- (b) image allowlist ---------------------------------------------------
check_assets() {
  local list="$ROOT/tools/release/public-assets.sha256" bad=0 total=0 mode sha stage path sum
  if [ ! -f "$list" ]; then
    fail "(b) image allowlist: public-assets.sha256 missing; lane 1F writes it"; return
  fi
  awk '{ print tolower($1) }' "$list" | grep -E '^[0-9a-f]{64}$' | sort -u > "$TMP/allowed"
  git ls-files -s -z > "$TMP/staged"
  while IFS= read -r -d '' rec; do
    path="${rec#*$'\t'}"
    case "${path,,}" in *.jpg|*.jpeg|*.png) ;; *) continue ;; esac
    read -r mode sha stage <<< "${rec%%$'\t'*}"
    total=$((total + 1))
    sum="$(git cat-file blob "$sha" | sha256sum | cut -d' ' -f1)"
    if ! grep -q -x -F "$sum" "$TMP/allowed"; then
      [ "$bad" -eq 0 ] && echo "      not in public-assets.sha256:" >> "$TMP/detail"
      echo "      $path" >> "$TMP/detail"; bad=$((bad + 1))
    fi
  done < "$TMP/staged"
  if [ "$bad" -eq 0 ]; then pass "(b) image allowlist: $total image(s), all listed"
  else fail "(b) image allowlist: $bad of $total image(s) not listed"; fi
}

# ---- (c) forbidden blobs ---------------------------------------------------
check_blobs() {
  local bad=0 mode sha stage path
  if [ -z "$BLOBS" ] || [ ! -f "$BLOBS" ]; then
    fail "(c) forbidden blobs: list missing (local/forbidden-blobs.txt, or pass --blobs)"; return
  fi
  awk '{ print tolower($1) }' "$BLOBS" | grep -E '^[0-9a-f]{40,64}$' | sort -u > "$TMP/forbidden"
  if [ ! -s "$TMP/forbidden" ]; then fail "(c) forbidden blobs: list has no blob shas"; return; fi
  git ls-files -s -z > "$TMP/staged"
  while IFS= read -r -d '' rec; do
    path="${rec#*$'\t'}"
    read -r mode sha stage <<< "${rec%%$'\t'*}"
    if grep -q -x -F "$sha" "$TMP/forbidden"; then
      echo "      $path" >> "$TMP/detail"; bad=$((bad + 1))
    fi
  done < "$TMP/staged"
  if [ "$bad" -eq 0 ]; then pass "(c) forbidden blobs: none of $(wc -l < "$TMP/forbidden") tracked"
  else fail "(c) forbidden blobs: $bad tracked file(s) are forbidden blobs"; fi
}

# ---- (d) household paths ---------------------------------------------------
HOUSEHOLD_PATHS=(
  db/household.sql db/household.json db/cast.json db/calendars.sql db/chores.json
  db/scene-place.json db/fal-ledger.jsonl stacks/wall/op.env tools/op.env CLAUDE.local.md
  db/countdowns.json db/routine-steps.json
  db/scene-context/ db/scene-activities/ local/ docs/local/
)
check_paths() {
  local bad=0 p f
  tr '\0' '\n' < "$TMP/files" > "$TMP/files-nl"
  for p in "${HOUSEHOLD_PATHS[@]}"; do
    if [ "${p%/}" != "$p" ]; then
      while IFS= read -r f; do echo "      $f" >> "$TMP/detail"; bad=$((bad + 1)); done < <(grep -F -- "$p" "$TMP/files-nl" | awk -v p="$p" 'index($0, p) == 1')
    elif grep -q -x -F -- "$p" "$TMP/files-nl"; then
      echo "      $p" >> "$TMP/detail"; bad=$((bad + 1))
    fi
  done
  if [ "$bad" -eq 0 ]; then pass "(d) household paths: none of ${#HOUSEHOLD_PATHS[@]} tracked"
  else fail "(d) household paths: $bad tracked"; fi
}

# ---- (p) public patterns ---------------------------------------------------
# Paths excluded from the pattern grep, each for a stated reason.
PUBLIC_ALLOW_PATHS=(
  # The pattern file is made of the shapes it looks for.
  tools/release/public-patterns.txt
  # Carries a FAKE iCal secret address on purpose: the test
  # proves no thrown message ever contains the secret. Found by the 2026-10-17 dry run.
  test/unit-b.ics.test.ts
)
check_patterns() {
  local pf="$ROOT/tools/release/public-patterns.txt" rc nfiles allow_re
  if [ ! -f "$pf" ]; then fail "(p) public patterns: tools/release/public-patterns.txt missing"; return; fi
  grep -v -E '^(#|allow-re |[[:space:]]*$)' "$pf" > "$TMP/pats"
  if [ ! -s "$TMP/pats" ]; then fail "(p) public patterns: no patterns"; return; fi
  # Allowed placeholders (escaped EREs) become one alternation, removed only where no
  # further digit follows, so a placeholder never hides a longer real address.
  allow_re="$(sed -n 's/^allow-re //p' "$pf" | paste -s -d '|')"
  tr '\0' '\n' < "$TMP/files" | grep -v -x -F -f <(printf '%s\n' "${PUBLIC_ALLOW_PATHS[@]}") \
    | tr '\n' '\0' > "$TMP/files-p"
  xargs -0 grep -I -n -Z -H -E -f "$TMP/pats" -- < "$TMP/files-p" > "$TMP/hits-p" 2> "$TMP/err-p"
  rc=$?
  if [ -s "$TMP/err-p" ]; then
    fail "(p) public patterns: grep reported errors:"; sed 's/^/      /' "$TMP/err-p"; return
  fi
  if [ "$rc" -ne 0 ] && [ "$rc" -ne 123 ]; then fail "(p) public patterns: xargs exited $rc"; return; fi
  # Second pass: drop allowed placeholders from the TEXT and keep the line only if it still matches.
  : > "$TMP/loc-p"
  while IFS= read -r -d '' path && IFS= read -r rest; do
    local n="${rest%%:*}" text="${rest#*:}"
    if [ -n "$allow_re" ]; then
      text="$(printf '%s\n' "$text" | sed -E "s/($allow_re)([^0-9]|\$)/\\2/g")"
    fi
    if printf '%s\n' "$text" | grep -q -E -f "$TMP/pats"; then
      printf '%s:%s\n' "$path" "$n" >> "$TMP/loc-p"
    fi
  done < "$TMP/hits-p"
  if [ -s "$TMP/loc-p" ]; then
    nfiles=$(cut -d: -f1 "$TMP/loc-p" | sort -u | wc -l)
    fail "(p) public patterns: $(wc -l < "$TMP/loc-p") line(s) in $nfiles file(s)"
    sed 's/^/      /' "$TMP/loc-p"
  else
    pass "(p) public patterns: 0 lines"
  fi
}

echo "verify-clean --$MODE in $ROOT"
if [ "$MODE" = full ]; then
  [ -n "$TERMS" ] || TERMS="$(local_file local/sensitive-terms.txt)"
  [ -n "$BLOBS" ] || BLOBS="$(local_file local/forbidden-blobs.txt)"
  if [ -z "$TERMS" ] || [ ! -f "$TERMS" ]; then
    echo "verify-clean: terms file missing (local/sensitive-terms.txt, or pass --terms)" >&2; exit 2
  fi
  if [ "$(grep -c . "$TERMS")" -lt "$MIN_TERMS" ]; then
    echo "verify-clean: terms file short: under $MIN_TERMS lines" >&2; exit 2
  fi
  check_terms
  check_assets
  check_blobs
  check_paths
else
  check_assets
  check_paths
  check_patterns
fi

if [ "$FAILED" -eq 0 ]; then echo "verify-clean: CLEAN"; exit 0; fi
echo "verify-clean: NOT CLEAN"; exit 1
