"""What the children may be DOING in a setting, and the check that refuses a table that would
put the wrong thing there.

## Why this file exists (2026-10-04)

The activity filter used to fail OPEN in both directions, on purpose: an activity with no
`settings` fitted anywhere, and a setting with no `tags` admitted every activity. The reasoning
was that a strict filter's failure is a scene that cannot be generated at all. The permissive
filter's failure turned out to be worse, because it is silent and it is paid for: the Halloween
book fair came back with a child riding a deer and another up a tree, INSIDE a school library.
Seven settings had empty tags, including both libraries, and every one of them could have drawn
a moose indoors. Nothing anywhere said so; the picture was the first signal.

So the default is now that NOTHING fits until somebody says where it fits:

  - `places` in scene-activities.json is the whole vocabulary. There is no "anywhere".
  - Every activity names at least one place, and every setting carries at least one tag.
  - Every name on either side is in the vocabulary — `water` was a setting tag that no activity
    used, so dragon-shore and alpine-lake matched only the untagged rows and nobody noticed.
  - Every setting can fill three different KINDS of activity in every season it is drawn in.

`check()` asserts all four and runs in `scene-week.check_tables()`, before anything is paid
for. The old failure mode — a setting that genuinely has too little to do — is now a loud
refusal at that point instead of a quiet borrowing from somewhere else.

`snow` is the one place that changes the weather: a snowy setting counts as WINTER whatever the
week says, because an ice palace drawn in November is still made of ice, and the calendar's
"autumn" would otherwise offer it puddles.
"""
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
ACTIVITIES_PATH = HERE / "scene-activities.json"
SETTINGS_PATH = HERE / "scene-settings.json"

SEASON_OF_MONTH = {12: "winter", 1: "winter", 2: "winter", 3: "spring", 4: "spring",
                   5: "spring", 6: "summer", 7: "summer", 8: "summer", 9: "autumn",
                   10: "autumn", 11: "autumn"}
ALL_SEASONS = ("winter", "spring", "summer", "autumn")
# The same constant pick_activities enforces: one KIND of thing per child. The default; a cast of
# another size passes its own count (scene-week reads it from the cast).
CHILDREN = 3


def load(path: "pathlib.Path | str" = ACTIVITIES_PATH) -> dict:
    return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))


def effective_season(tags: list[str], season: str) -> str:
    """A snowy place is winter whatever the calendar says."""
    return "winter" if "snow" in tags else season


def fits(entry: dict, tags: list[str], season: str) -> bool:
    """Strict: an entry fits only a setting that shares a place with it.

    No place on either side means NO fit — never "fits anywhere". `check()` makes sure that
    case cannot reach here from the real tables; this is the second line.
    """
    places = entry.get("settings") or []
    if not places or not tags or not set(places) & set(tags):
        return False
    seasons = entry.get("seasons") or []
    season = effective_season(tags, season)
    return not seasons or not season or season in seasons


def eligible(table: dict, tags: list[str], season: str) -> tuple[list[dict], list[dict]]:
    """(solo, shared) entries this setting may draw this season."""
    return ([e for e in table["solo"] if fits(e, tags, season)],
            [e for e in table["shared"] if fits(e, tags, season)])


def coin(rng, shared: list[dict], solo_only: bool, n: int) -> bool:
    """Is this picture ONE thing done together? The coin pick_activities has always tossed, in
    one place so the activity writer (tools/scene_activity_writer.py) tosses the same one.

    The short-circuit order is load-bearing: `rng.random()` is consumed only when there is a
    shared entry to draw, the premise allows it and there is more than one child, exactly as
    before — so the draw that follows, and the three-child prompt, do not move by a byte."""
    return bool(shared) and not solo_only and n > 1 and rng.random() < 0.34


def families(entries: list[dict]) -> set[str]:
    return {e.get("family") or e["do"] for e in entries}


def seasons_of(setting: dict) -> list[str]:
    """Every season a setting can be drawn in. `season: []` is forced-only, so ANY week."""
    months = setting.get("season") or []
    return sorted({SEASON_OF_MONTH[m] for m in months}) if months else list(ALL_SEASONS)


def problems(table: dict, settings: list[dict], children: int = CHILDREN) -> list[str]:
    """Every way these two tables can put the wrong activity in a picture, as sentences."""
    return structural_problems(table, settings) + kind_problems(table, settings, children)


def kind_problems(table: dict, settings: list[dict], children: int = CHILDREN) -> list[str]:
    """The settings that cannot fill one KIND of activity per child in some season.

    Separate from the structural problems because it is the one that depends on WHERE the
    activities come from. With `scenes.activities: "table"` it refuses, as it always has. With
    `"written"` (2026-10-12) the table is only the fallback, so a thin setting is a warning:
    the writer fills it, and only a writer that fails twice would reach the thin table."""
    out = []
    if not set(table.get("places") or {}):
        return out
    for st in settings:
        tags = st.get("tags") or []
        if not tags:
            continue
        for season in seasons_of(st):
            solo, _ = eligible(table, tags, season)
            kinds = families(solo)
            if len(kinds) < children:
                out.append(f"setting {st['id']!r} in {season}: only {len(kinds)} kind(s) of "
                           f"activity ({', '.join(sorted(kinds)) or 'none'}); it needs "
                           f"{children}, one per child")
    return out


def structural_problems(table: dict, settings: list[dict]) -> list[str]:
    """Untagged, unknown or place-less rows: wrong in either activity mode."""
    out = []
    vocab = set(table.get("places") or {})
    if not vocab:
        return ["scene-activities.json has no `places` vocabulary"]
    for kind in ("solo", "shared"):
        for e in table[kind]:
            places = e.get("settings") or []
            if not places:
                out.append(f"activity {e['do']!r} names no place; there is no 'anywhere'")
            for p in sorted(set(places) - vocab):
                out.append(f"activity {e['do']!r} names {p!r}, which is not a place")
            for s in e.get("seasons") or []:
                if s not in ALL_SEASONS:
                    out.append(f"activity {e['do']!r} names season {s!r}")
    for st in settings:
        tags = st.get("tags") or []
        if not tags:
            out.append(f"setting {st['id']!r} has no tags, so it could draw nothing — or, before "
                       "2026-10-04, everything")
            continue
        for t in sorted(set(tags) - vocab):
            out.append(f"setting {st['id']!r} is tagged {t!r}, which is not a place")
    return out


def check(settings: list[dict] | None = None, table: dict | None = None,
          children: int = CHILDREN, written: bool = False) -> list[str]:
    """Refuse to spend anything on a table that can put the wrong thing in a picture.

    `written` (scenes.activities == "written") demotes the too-few-KINDS problem to a warning,
    returned for the caller to print; everything structural still refuses."""
    table = table if table is not None else load()
    if settings is None:
        settings = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))["settings"]
    found = structural_problems(table, settings)
    kinds = kind_problems(table, settings, children)
    if not written:
        found += kinds
    if found:
        raise SystemExit("the activity tables would draw the wrong thing:\n  - "
                         + "\n  - ".join(found))
    return kinds if written else []


def selftest() -> None:
    """The real tables pass, and each way of failing open is caught. `npm run verify:activities`."""
    table = load()
    check(table=table)
    fails = []

    def expect(label: str, tbl: dict, sets: list[dict], needle: str) -> None:
        got = problems(tbl, sets)
        if not any(needle in g for g in got):
            fails.append(f"{label}: expected a problem containing {needle!r}, got {got}")

    good = {"id": "t", "season": [10], "tags": ["indoor"]}
    expect("untagged setting", table, [{**good, "tags": []}], "has no tags")
    expect("unknown tag", table, [{**good, "tags": ["water"]}], "not a place")
    untagged = json.loads(json.dumps(table))
    untagged["solo"][0]["settings"] = []
    expect("untagged activity", untagged, [good], "names no place")
    thin = {**table, "solo": [e for e in table["solo"] if e.get("family") == "books"]}
    expect("too few kinds", thin, [good], "needs 3")
    # Written mode (2026-10-12): the same thin table is a WARNING, and structure still refuses.
    try:
        warned = check([good], thin, written=True)
        if not any("needs 3" in w for w in warned):
            fails.append(f"written mode did not warn about too few kinds: {warned}")
    except SystemExit as err:
        fails.append(f"written mode refused a thin table: {err}")
    try:
        check([{**good, "tags": []}], table, written=True)
        fails.append("written mode let an untagged setting through")
    except SystemExit:
        pass

    # The bug itself: nothing outdoor may reach an indoor setting.
    solo, shared = eligible(table, ["indoor"], "autumn")
    outdoor = [e["do"] for e in solo + shared if "indoor" not in e["settings"]]
    if outdoor:
        fails.append(f"indoor setting would draw outdoor activities: {outdoor}")
    # And snow makes it winter.
    solo, _ = eligible(table, ["snow"], "autumn")
    if any("puddle" in e["do"] for e in solo) or not any("snowman" in e["do"] for e in solo):
        fails.append("a snow setting in an autumn week did not draw as winter")
    if fails:
        raise SystemExit("selftest FAILED:\n  " + "\n  ".join(fails))
    print("scene_activities selftest: ok")


if __name__ == "__main__":
    if sys.argv[1:] == ["--selftest"]:
        selftest()
    else:
        check()
        print("activity tables: ok")
