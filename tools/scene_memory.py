#!/usr/bin/env python3
"""What the wall has already shown, so the week's style does not repeat it.

THE BUG (2026-10-04). The style was a pure function of the week number and the setting's place
in the list. That rotates nicely through a year of timer runs and knows nothing about the wall:
week 40's harvest market and week 41's Halloween book fair, both chosen by a person, landed on
the same index and both came out CLAYMATION, back to back. The wall had recorded the style of
every picture it was ever offered (`scene.style_id`, written by `provision.ts --add-scene
--style`) and nothing read it. The signature bug once more: the information existed, and an
input with no reader looks exactly like an input that does not matter.

THE RULE. The rotation still proposes; this module disposes. A style used by any of the
RECENT_STYLES most recent pictures — approved, or still a candidate waiting on the panel — is
stepped past, in the rotation's own order, until one is free. If every allowed style is recent
(a premise that permits only two families can get there) the rotation's choice stands and the
caller says so.

THE EXCEPTION. A scene that is ALREADY in the catalog keeps its style. The timer retries an
error, and a Tuesday re-run must not buy a different picture from Sunday's because Sunday's own
candidate is now one of the "recent" ones. So the scene's own rows are excluded from what it
avoids, and their style is reused outright.

`python3 tools/scene_memory.py` prints what the wall would make the next scene avoid.
`--selftest` checks the rule against hand-built rows (no wall needed).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys

CONTAINER = os.environ.get("WALL_CONTAINER", "family-calendar-wall")
# Three distinct styles is "the last few weeks" on a wall that offers two candidates a week, and
# leaves eight of eleven styles free — enough that a premise restricted to one family still has
# somewhere to go.
RECENT_STYLES = 3

SCENES_JS = r"""
const {DatabaseSync} = require("node:sqlite");
const db = new DatabaseSync("/data/wall.db", {readOnly: true});
console.log(JSON.stringify(db.prepare(`
  select id, state, style_id, coalesce(decided_at_utc, created_at_utc) as at
  from scene where state != 'retired' and style_id is not null
  order by at desc`).all()));
"""


def wall_scenes() -> list[dict]:
    """Every non-retired scene with a known style, most recent first. Read-only, in the
    container, over stdin — the same route `scene_context` uses for calendar counts."""
    got = subprocess.run(
        ["docker", "exec", "-i", CONTAINER, "node", "--no-warnings", "-"],
        input=SCENES_JS, capture_output=True, text=True, timeout=30, check=False,
    )
    if got.returncode != 0:
        tail = (got.stderr or got.stdout).strip().splitlines()[-1:] or [f"exit {got.returncode}"]
        raise RuntimeError(tail[0])
    return json.loads(got.stdout.strip().splitlines()[-1])


def belongs(scene_id: str, base_id: str, suffixes: set[str]) -> bool:
    """Is `scene_id` this scene, or one of its candidates (`<base>-gpt`, `<base>-nb2` …)?
    Exact suffixes, never a bare prefix: `2026w41-halloween-book-fair` is a prefix of
    `2026w41-halloween-book-fair-eye-level-gpt`, which is a different picture."""
    if scene_id == base_id:
        return True
    head, _, tail = scene_id.rpartition("-")
    return head == base_id and tail in suffixes


def recent_styles(rows: list[dict], base_id: str, suffixes: set[str],
                  limit: int = RECENT_STYLES) -> list[str]:
    seen: list[str] = []
    for row in rows:
        if belongs(row["id"], base_id, suffixes) or row["style_id"] in seen:
            continue
        seen.append(row["style_id"])
        if len(seen) == limit:
            break
    return seen


def own_style(rows: list[dict], base_id: str, suffixes: set[str]) -> str | None:
    return next((r["style_id"] for r in rows if belongs(r["id"], base_id, suffixes)), None)


def settle(proposed: dict, pool: list[dict], rows: list[dict], base_id: str,
           suffixes: set[str]) -> tuple[dict, str]:
    """(style, one line saying why). `pool` is the styles allowed here, in rotation order."""
    by_id = {s["id"]: s for s in pool}
    mine = own_style(rows, base_id, suffixes)
    if mine in by_id:
        return by_id[mine], f"already drawn in {mine} — kept, so a re-run is the same picture"
    avoid = recent_styles(rows, base_id, suffixes)
    start = next((i for i, s in enumerate(pool) if s["id"] == proposed["id"]), 0)
    for step in range(len(pool)):
        cand = pool[(start + step) % len(pool)]
        if cand["id"] not in avoid:
            if step == 0:
                return cand, f"rotation's pick; recent on the wall: {', '.join(avoid) or 'none'}"
            return cand, (f"rotation said {proposed['id']}, recently on the wall "
                          f"({', '.join(avoid)}) — stepped to {cand['id']}")
    return proposed, f"EVERY allowed style is recent ({', '.join(avoid)}); kept the rotation's pick"


def selftest() -> None:
    pool = [{"id": x} for x in ("house", "anime", "soft-3d", "claymation", "paper-diorama", "low-poly")]
    sfx = {"gpt", "nb2"}

    def row(i, s):
        return {"id": i, "style_id": s, "state": "approved", "at": ""}

    # The 2026-10-04 case: the wall's last picture is claymation and the rotation says claymation.
    rows = [row("2026w40-harvest-market-nb2", "claymation"), row("2026w40-harvest-market-gpt", "claymation"),
            row("2026w39-alpine-lake-anime-layered-depth", "anime")]
    got, why = settle({"id": "claymation"}, pool, rows, "2026w41-halloween-book-fair", sfx)
    assert got["id"] == "paper-diorama", (got, why)
    # Steps past every recent style, in rotation order, wrapping round.
    rows2 = rows + [row("x-gpt", "low-poly"), row("y", "house")]
    got, _ = settle({"id": "low-poly"}, pool, [row("a", "low-poly"), row("b", "house"), row("c", "anime")],
                    "z", sfx)
    assert got["id"] == "soft-3d", got
    # A scene already in the catalog keeps its style, even though that style is now "recent".
    mine = [row("2026w41-book-fair-gpt", "soft-3d")] + rows
    got, why = settle({"id": "soft-3d"}, pool, mine, "2026w41-book-fair", sfx)
    assert got["id"] == "soft-3d" and "kept" in why, (got, why)
    # ...but a DIFFERENT scene sharing its prefix does not count as it.
    got, _ = settle({"id": "soft-3d"}, pool, [row("2026w41-book-fair-eye-level-gpt", "soft-3d")],
                    "2026w41-book-fair", sfx)
    assert got["id"] == "claymation", got
    # Only RECENT_STYLES distinct styles are avoided, not the whole history.
    assert recent_styles(rows2, "q", sfx) == ["claymation", "anime", "low-poly"]
    # A pool that is entirely recent keeps the rotation's pick rather than failing the week.
    got, why = settle({"id": "anime"}, [{"id": "anime"}], rows, "q", sfx)
    assert got["id"] == "anime" and "EVERY" in why, why
    print("scene_memory selftest: ok")


if __name__ == "__main__":
    if sys.argv[1:] == ["--selftest"]:
        selftest()
    else:
        rows = wall_scenes()
        print("recent on the wall:", ", ".join(recent_styles(rows, "", set())) or "none")
