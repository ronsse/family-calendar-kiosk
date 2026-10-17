#!/usr/bin/env bash
# The Sunday timer's entry point: scene-week.py with its API keys injected from 1Password.
#
#   tools/scene-week-timer.sh [scene-week.py arguments]     # run from the repo root
#
# The keys come from `op run --env-file=tools/op.env` (gitignored; tools/op.env.example is the
# template). scene-week.py reads them from the environment and names no vault.
#
# WHY A WRAPPER AND NOT `op run … -- python3 tools/scene-week.py` IN THE UNIT. `op run` exits 1
# when it cannot reach 1Password or resolve a reference (measured 2026-10-12: "no accounts
# configured" → 1, an unknown vault → 1). scene-week.py's exit 1 means the finder REFUSED both
# pictures, which the unit deliberately never retries (`RestartPreventExitStatus=1 3`). Straight
# through, a DNS blip at 02:54 — the 2026-09-27 failure the retry exists for — would read as a
# refusal and cost the week again. So the child's status is carried out offset by 100, and any
# status under 100 is op's own failure, reported as 2: errored, never judged, retry.
set -u
OFFSET=100
env_file="${SCENE_OP_ENV_FILE:-tools/op.env}"
token_file="${OP_SERVICE_ACCOUNT_TOKEN_FILE:-$HOME/.config/op-service-token}"

if [ -z "${OP_SERVICE_ACCOUNT_TOKEN:-}" ]; then
  if ! OP_SERVICE_ACCOUNT_TOKEN="$(cat "$token_file")"; then
    echo "cannot read the 1Password service token from $token_file" >&2
    exit 2
  fi
  export OP_SERVICE_ACCOUNT_TOKEN
fi
if [ ! -f "$env_file" ]; then
  echo "$env_file is missing; copy tools/op.env.example and fill in the references" >&2
  exit 2
fi

op run --env-file="$env_file" -- \
  sh -c 'python3 tools/scene-week.py "$@"; exit $(( $? + '"$OFFSET"' ))' scene-week "$@"
rc=$?
if [ "$rc" -ge "$OFFSET" ]; then
  exit $(( rc - OFFSET ))
fi
echo "op run failed (exit $rc) before scene-week started: 1Password unreachable, or a reference" \
     "in $env_file is wrong. Exiting 2 so the timer retries." >&2
exit 2
