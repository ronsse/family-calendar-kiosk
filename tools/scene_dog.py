#!/usr/bin/env python3
"""What the dog is up to in a scene: hiding, or busy with something of his own.

    python3 tools/scene_dog.py --selftest      # npm run verify:dog

The table is tools/scene-dog.json. `hiding` is the original clause and is the ONLY mood that
leaves gen-scene's prompt byte-identical, which is why it is spelled as an id and never as text:
scene-week passes `--dog-doing` only for the others. Two ways a scene gets a mood, in order:

  1. the run's director chose one (validated here against the setting's places), or
  2. a seeded draw, weighted, from the moods that fit the setting's places and the season.
     `seasons` is optional and narrows a mood that only makes sense part of the year (a leaf
     pile in autumn, a snowdrift in winter); a mood without it fits every season.

A director decision frozen BEFORE this table existed carries no `dog` key and means `hiding`:
that run was drawn and paid for with him hiding, and a re-run must reuse those pictures.
"""
from __future__ import annotations

import json
import pathlib
import random
import sys

HERE = pathlib.Path(__file__).resolve().parent
TABLE = HERE / "scene-dog.json"
HIDING = "hiding"
SEASONS = {"spring", "summer", "autumn", "winter"}


def load(path: pathlib.Path = TABLE) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))["moods"]


def places_known() -> set[str]:
    return set(json.loads((HERE / "scene-activities.json").read_text(encoding="utf-8"))["places"])


def problems(moods: list[dict], places: set[str]) -> list[str]:
    out, seen = [], set()
    for m in moods:
        mid = m.get("id")
        if not isinstance(mid, str) or mid in seen:
            out.append(f"mood id {mid!r} is missing or repeated")
        seen.add(mid)
        if not isinstance(m.get("do"), str) or not m["do"].strip():
            out.append(f"{mid}: `do` is missing")
        if not isinstance(m.get("weight"), (int, float)) or m["weight"] <= 0:
            out.append(f"{mid}: `weight` must be a positive number")
        ps = m.get("places")
        if not isinstance(ps, list) or not ps:
            out.append(f"{mid}: `places` must name at least one place; nothing means anywhere")
        else:
            out += [f"{mid}: unknown place {p!r}" for p in ps if p not in places]
        ss = m.get("seasons")
        if ss is not None and (not isinstance(ss, list) or not ss
                               or any(x not in SEASONS for x in ss)):
            out.append(f"{mid}: `seasons` must be a non-empty list of {sorted(SEASONS)}")
    if HIDING not in seen:
        out.append("the `hiding` mood is the original clause and must stay in the table")
    return out


def fitting(moods: list[dict], tags: list[str], season: str | None = None) -> list[dict]:
    """Moods that may be drawn in a setting with these tags, this season. `hiding` always fits."""
    return [m for m in moods if m["id"] == HIDING
            or (set(m["places"]) & set(tags)
                and (season is None or season in m.get("seasons", SEASONS)))]


def draw(moods: list[dict], tags: list[str], rng: random.Random, season: str | None = None) -> dict:
    pool = fitting(moods, tags, season)
    return rng.choices(pool, weights=[m["weight"] for m in pool], k=1)[0]


def by_id(moods: list[dict], mid: str | None) -> dict | None:
    return next((m for m in moods if m["id"] == mid), None)


def doing(mood: dict) -> str:
    """The `--dog-doing` text for gen-scene and the finder, or "" for hiding (no flag at all)."""
    return "" if mood["id"] == HIDING else " ".join(mood["do"].split())


def selftest() -> None:
    moods = load()
    bad = problems(moods, places_known())
    if bad:
        raise SystemExit("scene-dog.json:\n  - " + "\n  - ".join(bad))

    def check(label, cond):
        if not cond:
            raise SystemExit(f"FAIL: {label}")

    fake = [{"id": "hiding", "weight": 1, "do": "hiding", "places": ["forest"]},
            {"id": "wet", "weight": 1, "do": "splashing", "places": ["lake"]}]
    check("hiding fits a place it does not list", [m["id"] for m in fitting(fake, ["indoor"])] == ["hiding"])
    check("a water mood fits a lake", "wet" in [m["id"] for m in fitting(fake, ["lake"])])
    leaves = {"id": "leaves", "weight": 1, "do": "in leaves", "places": ["forest"], "seasons": ["autumn"]}
    check("a seasonal mood fits its season", "leaves" in [m["id"] for m in fitting([leaves], ["forest"], "autumn")])
    check("and not another", fitting([leaves], ["forest"], "summer") == [])
    check("an unknown season is refused", problems([fake[0], {**leaves, "seasons": ["fall"]}], {"forest"}))
    check("hiding is no flag at all", doing(fake[0]) == "")
    check("the draw is seeded", draw(moods, ["forest"], random.Random(7))["id"]
          == draw(moods, ["forest"], random.Random(7))["id"])
    check("every setting place can draw something other than hiding",
          all(any(m["id"] != HIDING for m in fitting(moods, [p])) for p in places_known() - {"pool"}))
    check("a missing hiding mood is refused", problems(fake[1:], {"lake"}))
    check("an unknown place is refused", problems([{**fake[0], "places": ["moon"]}], {"forest"}))
    print(f"dog moods OK ({len(moods)} moods)")


if __name__ == "__main__":
    if sys.argv[1:] == ["--selftest"]:
        selftest()
    else:
        raise SystemExit(__doc__)
