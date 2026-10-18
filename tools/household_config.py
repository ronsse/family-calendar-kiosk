#!/usr/bin/env python3
"""The household's settings, for the host-side tools (2026-10-12).

The Python twin of `src/config/household.ts`. The wall reads its settings from rows that
`provision.ts --settings` wrote; the scene tools run on the host, outside the container, and
read the same authored file directly: `db/household.json` (gitignored), or whatever
`HOUSEHOLD_CONFIG` names. `db/household.example.json` is the committed, synthetic twin.

THE CONTRACT. Both loaders take the same file to the same normalized dict: the schema is the
contract, and `test/unit-g.config.test.ts` runs `--dump` over the example and deep-compares it
with the TypeScript loader's output. A change to the schema is a change to both files and that
test, or it is a drift.

ONE ASYMMETRY, on purpose. `locale` and `currency` are checked here only as non-empty strings.
The TypeScript loader checks them against the runtime's Intl (`supportedLocalesOf`, a currency
formatter) because the wall FORMATS with them; nothing in Python formats with either, and the
standard library has no equivalent check. `provision.ts --settings` is the gate that matters:
a file it refuses never reaches the wall.

`load(path)` raises `ValueError` carrying every error, one per line, as `<path>: <why>` — the
same strings the TypeScript loader prints. `load_or_defaults()` is for callers that must run
in a household that has written no file: it returns the defaults when there is none.

    python3 tools/household_config.py --dump db/household.example.json
"""
from __future__ import annotations

import copy
import json
import os
import re
import sys
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

REPO = Path(__file__).resolve().parent.parent
DEFAULT_PATH = REPO / "db" / "household.json"

VERSION = 1
SCENE_MODES = ("off", "static", "generated")
SCENE_PROVIDERS = ("fal", "nvidia", "nous")
# Where the children's activities come from (2026-10-12): `written` by tools/scene_activity_writer.py
# under code guardrails, frozen per scene, the table as its fallback; or `table` only.
SCENE_ACTIVITY_SOURCES = ("written", "table")
# Who chooses each run's picture (2026-10-18): `ai`, tools/scene_director.py reading the run's
# calendar, weather and visitors (rotation as its fallback); or `rotation`, the week-number
# arithmetic only. `shareTitles` lets the director and the brief read one-off event TITLES and
# visitors' descriptions; off, they see counts by category, as before.
SCENE_DIRECTORS = ("ai", "rotation")
PET_KINDS = ("dog",)
MAX_PETS = 1
PET_NAME_MAX = 24
PET_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,23}$")
# Same expression as `TIME_RE` in src/time.ts.
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
PETS_LIMIT = "v0.1 supports at most one pet, of kind dog"

DEFAULTS: dict[str, Any] = {
    "version": 1,
    "timezone": "America/Denver",
    "locale": "en-US",
    "currency": "USD",
    "features": {"chores": True, "money": True, "routines": True, "countdowns": True},
    "boardWindows": [
        {"opensAtLocal": "05:45", "closesAtLocal": "08:30"},
        {"opensAtLocal": "18:45", "closesAtLocal": "20:45"},
    ],
    "pets": [],
    "scenes": {
        "mode": "generated",
        "provider": "fal",
        "styles": None,
        "settings": None,
        "premises": ["plain"],
        "weeklyBudgetUsd": None,
        "activities": "written",
        "director": "ai",
        "shareTitles": False,
    },
}

TOP_KEYS = tuple(DEFAULTS.keys())
FEATURE_KEYS = tuple(DEFAULTS["features"].keys())
SCENE_KEYS = tuple(DEFAULTS["scenes"].keys())


def _unknown(obj: dict, known: tuple, path: str) -> list[str]:
    """Keys starting with `_` are comments and are ignored."""
    return [
        f"{path}{'.' if path else ''}{k}: unknown key"
        for k in obj
        if not k.startswith("_") and k not in known
    ]


def _is_id_list(v: Any) -> bool:
    return isinstance(v, list) and all(isinstance(x, str) and x for x in v)


def _timezone(v: Any, errors: list[str]) -> str | None:
    if not isinstance(v, str) or not v:
        errors.append("timezone: must be an IANA zone name")
        return None
    try:
        ZoneInfo(v)
    except Exception:  # ZoneInfoNotFoundError, ValueError on a malformed key
        errors.append(f'timezone: "{v}" is not a time zone this runtime knows')
        return None
    return v


def _features(v: Any, errors: list[str]) -> dict | None:
    if not isinstance(v, dict):
        errors.append("features: must be an object")
        return None
    errs = _unknown(v, FEATURE_KEYS, "features")
    out = dict(DEFAULTS["features"])
    for k in FEATURE_KEYS:
        if k in v:
            if not isinstance(v[k], bool):
                errs.append(f"features.{k}: must be true or false")
            else:
                out[k] = v[k]
    errors.extend(errs)
    return None if errs else out


def _board_windows(v: Any, errors: list[str]) -> list | None:
    if not isinstance(v, list):
        errors.append("boardWindows: must be a list")
        return None
    errs: list[str] = []
    out = []
    for i, w in enumerate(v):
        path = f"boardWindows[{i}]"
        if not isinstance(w, dict):
            errs.append(f"{path}: must be an object")
            continue
        errs.extend(_unknown(w, ("opensAtLocal", "closesAtLocal"), path))
        opens, closes = w.get("opensAtLocal"), w.get("closesAtLocal")
        opens_ok = isinstance(opens, str) and bool(TIME_RE.match(opens))
        closes_ok = isinstance(closes, str) and bool(TIME_RE.match(closes))
        if not opens_ok:
            errs.append(f"{path}.opensAtLocal: must be HH:MM")
        if not closes_ok:
            errs.append(f"{path}.closesAtLocal: must be HH:MM")
        if opens_ok and closes_ok:
            if opens >= closes:
                errs.append(f"{path}: opensAtLocal must be before closesAtLocal")
            else:
                out.append({"opensAtLocal": opens, "closesAtLocal": closes})
    errors.extend(errs)
    return None if errs else out


def _pets(v: Any, errors: list[str]) -> list | None:
    if not isinstance(v, list):
        errors.append("pets: must be a list")
        return None
    if len(v) > MAX_PETS:
        errors.append(f"pets: {PETS_LIMIT}")
        return None
    errs: list[str] = []
    out = []
    for i, p in enumerate(v):
        path = f"pets[{i}]"
        if not isinstance(p, dict):
            errs.append(f"{path}: must be an object")
            continue
        errs.extend(_unknown(p, ("id", "kind", "name"), path))
        before = len(errs)
        pid, kind, name = p.get("id"), p.get("kind"), p.get("name")
        if not isinstance(pid, str) or not PET_ID_RE.match(pid):
            errs.append(f"{path}.id: must match {PET_ID_RE.pattern}")
        if kind not in PET_KINDS:
            errs.append(f"{path}.kind: {PETS_LIMIT}")
        if not isinstance(name, str) or not name.strip() or len(name) > PET_NAME_MAX:
            errs.append(f"{path}.name: must be 1-{PET_NAME_MAX} characters")
        if len(errs) == before:
            out.append({"id": pid, "kind": kind, "name": name})
    errors.extend(errs)
    return None if errs else out


def _scenes(v: Any, errors: list[str]) -> dict | None:
    if not isinstance(v, dict):
        errors.append("scenes: must be an object")
        return None
    errs = _unknown(v, SCENE_KEYS, "scenes")
    out = copy.deepcopy(DEFAULTS["scenes"])
    out.update({k: v[k] for k in SCENE_KEYS if k in v})
    if out["mode"] not in SCENE_MODES:
        errs.append(f"scenes.mode: must be one of {', '.join(SCENE_MODES)}")
    if out["provider"] not in SCENE_PROVIDERS:
        errs.append(f"scenes.provider: must be one of {', '.join(SCENE_PROVIDERS)}")
    if out["styles"] is not None and not _is_id_list(out["styles"]):
        errs.append("scenes.styles: must be null or a list of ids")
    if out["settings"] is not None and not _is_id_list(out["settings"]):
        errs.append("scenes.settings: must be null or a list of ids")
    if not _is_id_list(out["premises"]):
        errs.append("scenes.premises: must be a list of ids")
    b = out["weeklyBudgetUsd"]
    if b is not None and (
        isinstance(b, bool) or not isinstance(b, (int, float)) or b != b or b in (float("inf"), float("-inf")) or b < 0
    ):
        errs.append("scenes.weeklyBudgetUsd: must be null or a number >= 0")
    if not isinstance(out["activities"], str) or out["activities"] not in SCENE_ACTIVITY_SOURCES:
        errs.append(f"scenes.activities: must be one of {', '.join(SCENE_ACTIVITY_SOURCES)}")
    if not isinstance(out["director"], str) or out["director"] not in SCENE_DIRECTORS:
        errs.append(f"scenes.director: must be one of {', '.join(SCENE_DIRECTORS)}")
    if not isinstance(out["shareTitles"], bool):
        errs.append("scenes.shareTitles: must be true or false")
    errors.extend(errs)
    return None if errs else out


def parse(data: Any) -> dict:
    """Validates and normalizes one settings document. Raises ValueError with every error."""
    if not isinstance(data, dict):
        raise ValueError("(root): must be a JSON object")
    errors = _unknown(data, TOP_KEYS, "")
    if data.get("version") != VERSION or isinstance(data.get("version"), bool):
        errors.append(f"version: must be {VERSION}")
    out = copy.deepcopy(DEFAULTS)

    def take(key: str, fn) -> None:
        if key in data:
            value = fn(data[key], errors)
            if value is not None:
                out[key] = value

    take("timezone", _timezone)
    for key, what in (("locale", "a BCP-47 tag"), ("currency", "an ISO-4217 code")):
        if key in data:
            if isinstance(data[key], str) and data[key]:
                out[key] = data[key]
            else:
                errors.append(f"{key}: must be {what}")
    take("features", _features)
    take("boardWindows", _board_windows)
    take("pets", _pets)
    take("scenes", _scenes)
    if errors:
        raise ValueError("\n".join(errors))
    return out


def config_path(path: str | os.PathLike | None = None) -> Path:
    """An explicit path, else `HOUSEHOLD_CONFIG`, else db/household.json."""
    if path is not None:
        return Path(path)
    env = os.environ.get("HOUSEHOLD_CONFIG")
    return Path(env) if env else DEFAULT_PATH


def load(path: str | os.PathLike | None = None) -> dict:
    """The settings file, merged over the defaults. Raises ValueError on any invalid field."""
    p = config_path(path)
    with open(p, encoding="utf-8") as fh:
        return parse(json.load(fh))


def load_or_defaults(path: str | os.PathLike | None = None) -> dict:
    """As `load`, but a household with no file at all gets the defaults."""
    p = config_path(path)
    if not p.exists():
        return copy.deepcopy(DEFAULTS)
    return load(p)


def main(argv: list[str]) -> int:
    if len(argv) == 2 and argv[0] == "--dump":
        try:
            config = load(argv[1])
        except (OSError, json.JSONDecodeError) as err:
            print(f"{argv[1]}: {err}", file=sys.stderr)
            return 1
        except ValueError as err:
            print(str(err), file=sys.stderr)
            return 1
        print(json.dumps(config, sort_keys=True, indent=2))
        return 0
    print("usage: household_config.py --dump <path>", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
