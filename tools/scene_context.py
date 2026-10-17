#!/usr/bin/env python3
"""THIS WEEK — what the coming week is allowed to tell the picture.

    python3 tools/scene_context.py                    # this week's brief, fetched or reused
    python3 tools/scene_context.py --week 2026-W40    # a particular week
    python3 tools/scene_context.py --refresh          # fetch again even if frozen
    python3 tools/scene_context.py --print            # the three lines gen-scene will see
    python3 tools/scene_context.py --selftest         # the freeze rule, asserted offline

Three sources, each optional, each degrading to nothing rather than to a guess:

  weather   Open-Meteo's daily forecast for the week at a coarse grid point (db/scene-place.json,
            gitignored; tenth-of-a-degree, no key, nothing sent but a lat/lon that covers a
            few miles of suburb). Becomes ONE sentence about the sky and what people wear.
  calendar  Category COUNTS from the wall's own SQLite, read the way the wall reads it — the
            latest promoted sync per source. Never a title, never a name, never a time: "two
            dance things and a sport thing this week" becomes props in the crowd ("ballet
            slippers", "a ball and cones"). The only titles that leave the house are the
            ones a person wrote to be sent, by starting an all-day event with `scene:`.
  holidays  A table by date. A holiday is a prop, not a premise: costumes go OVER ordinary
            clothes with the hair showing, because hair is how the children are found.

The result is FROZEN to db/scene-context/<week>.json the first time it is computed, and every
later run of that week reads the file. scene-week.py chooses style, setting and camera as a
pure function of the week so a re-run reproduces itself; a forecast that moved between Sunday
and Tuesday would silently break that, and so would a calendar edit.

ONLY A COMPLETE BRIEF IS FROZEN. One missing a source that could have answered — weather when a
place is configured, or the calendar — is PROVISIONAL and is fetched again on the next run.
Until 2026-09-27 every brief froze on first write, and W40's was first written on 2026-09-12 by
a test run sixteen days early: no forecast existed yet, so the week's picture would have been
briefed with no weather and calendar counts eighteen days old, and an outage on the day (DNS
failed at 02:54 that Sunday) would have frozen the same hole. Freezing exists so a complete
brief cannot MOVE between Sunday and Tuesday; a provisional one has nothing yet worth keeping.

Everything here ends up in a prompt sent to a hosted model. The redaction rule is
docs/build-plan.md §3.1 and the guard is tools/prompt_guard.enforce, which gen-scene.py runs
over the WHOLE assembled prompt, this text included.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import pathlib
import subprocess
import sys
import urllib.parse
import urllib.request

from scene_cast import load_cast, the_children

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
PLACE_PATH = ROOT / "db" / "scene-place.json"
CONTEXT_DIR = ROOT / "db" / "scene-context"
CONTAINER = os.environ.get("WALL_CONTAINER", "family-calendar-wall")

# What each calendar category may put in the picture. Objects only, never events: "a soccer
# ball and a few orange cones lying in the grass" is a thing the crowd can own; "a soccer
# match" would restage the week's appointment. Categories not listed here (medical, hygiene,
# dressing, routine, calendar, avatar, _default) say nothing on purpose — a week with a dentist
# in it is not a week with a dentist in the picture.
PROPS = {
    "sport":       "a ball and a few orange cones",
    "dance":       "a pair of ballet slippers and a tutu on a hook or a bench",
    "school":      "a school bus in the distance and a backpack",
    "celebration": "a bunch of balloons and a cake with candles",
    "travel":      "a suitcase and an unfolded map",
    "outing":      "a picnic basket on a rug",
    "music":       "an instrument case",
    "kitchen":     "a mixing bowl and an apron",
}

# The week's holiday, if any, by (month, day) of any day in Mon..Sun. Easter is computed.
HOLIDAYS = [
    ((10, 31), "Halloween: carved pumpkins on steps, and any costume is worn OVER ordinary clothes "
               "with no mask and the hair fully showing"),
    ((12, 24), "Christmas week: lights along the eaves, a decorated tree seen through a window, "
               "wrapped parcels"),
    ((12, 25), "Christmas week: lights along the eaves, a decorated tree seen through a window, "
               "wrapped parcels"),
    ((12, 31), "New Year: paper streamers, a few balloons, and someone carrying a clock"),
    ((1, 1),   "New Year: paper streamers, a few balloons, and someone carrying a clock"),
    ((2, 14),  "Valentine's: paper hearts in windows and a bunch of red flowers"),
    ((3, 17),  "St Patrick's: shamrocks and a lot of green worn by the crowd"),
    ((7, 4),   "the Fourth of July: bunting, small flags, and a parade forming up in the distance"),
]


def easter(year: int) -> dt.date:
    a, b, c = year % 19, year // 100, year % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    m = (32 + 2 * e + 2 * i - h - k) % 7
    n = (h + m - 7 * ((a + 11 * h + 22 * m) // 451) + 114)
    return dt.date(year, n // 31, n % 31 + 1)


def thanksgiving(year: int) -> dt.date:
    first = dt.date(year, 11, 1)
    return first + dt.timedelta(days=(3 - first.weekday()) % 7 + 21)


def iso_week(when: dt.date) -> str:
    year, week, _ = when.isocalendar()
    return f"{year}-W{week:02d}"


def week_of(text: str) -> dt.date:
    year, _, week = text.partition("-W")
    return dt.date.fromisocalendar(int(year), int(week), 1)


def week_for_today(today: dt.date | None = None) -> dt.date:
    """The Monday of the week the picture is FOR.

    Sunday is the day the timer runs and the day the picture is approved for the week ahead;
    in ISO terms it is the last day of the week behind. So a Sunday belongs to the coming
    week here, and every other day to its own — the same rule scene-week.py uses, because the
    two must agree on the week's name or the context is for one week and the seed for another.
    """
    today = today or dt.date.today()
    monday = today - dt.timedelta(days=today.weekday())
    return monday + dt.timedelta(days=7) if today.weekday() == 6 else monday


def holidays_in(monday: dt.date) -> list[str]:
    days = [monday + dt.timedelta(days=i) for i in range(7)]
    found: list[str] = []
    for day in days:
        for (m, d), text in HOLIDAYS:
            if (day.month, day.day) == (m, d) and text not in found:
                found.append(text)
    for day in days:
        if day == easter(day.year):
            found.append("Easter: painted eggs half hidden in the grass and a basket or two")
        if day == thanksgiving(day.year):
            found.append("Thanksgiving: a long table being laid outdoors or seen through a window, "
                         "and a pile of pumpkins")
    return found


# ---------------------------------------------------------------------------------------------
# weather

def load_place() -> dict | None:
    if not PLACE_PATH.exists():
        return None
    with open(PLACE_PATH, encoding="utf-8") as fh:
        place = json.load(fh)
    # A tenth of a degree is a few miles; anything finer names a street, and there is no
    # forecast that fine anyway. Rounded here so the file cannot be more precise than the call.
    return {"lat": round(float(place["lat"]), 1), "lon": round(float(place["lon"]), 1),
            "timezone": place.get("timezone", "auto")}


def fetch_forecast(place: dict, monday: dt.date) -> dict:
    q = urllib.parse.urlencode({
        "latitude": place["lat"], "longitude": place["lon"], "timezone": place["timezone"],
        "start_date": monday.isoformat(), "end_date": (monday + dt.timedelta(days=6)).isoformat(),
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,weather_code",
        "temperature_unit": "fahrenheit", "precipitation_unit": "inch",
    })
    req = urllib.request.Request("https://api.open-meteo.com/v1/forecast?" + q,
                                 headers={"User-Agent": "family-calendar scene_context"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.load(resp)["daily"]


def summarise_weather(daily: dict) -> dict:
    """Bands, not numbers. The prompt says 'a cold, snowy week', never '31°F'."""
    highs = [t for t in daily["temperature_2m_max"] if t is not None]
    codes = [c for c in daily["weather_code"] if c is not None]
    rain = sum(p or 0 for p in daily["precipitation_sum"])
    snow = sum(s or 0 for s in daily["snowfall_sum"])
    if not highs:
        raise ValueError("forecast has no temperatures")
    high = sum(highs) / len(highs)
    temp = ("cold" if high < 38 else "cool" if high < 56 else "mild" if high < 72
            else "warm" if high < 88 else "hot")
    if snow >= 1.0:
        precip = "snow"
    elif rain >= 0.5:
        precip = "rain"
    elif rain >= 0.1:
        precip = "showers"
    else:
        precip = "dry"
    clear = sum(1 for c in codes if c <= 1)
    dull = sum(1 for c in codes if c == 3 or c >= 45)
    sky = "sunny" if clear >= 4 else "overcast" if dull >= 4 else "mixed"
    return {"temp": temp, "precip": precip, "sky": sky,
            "high_f": round(high), "rain_in": round(rain, 2), "snow_in": round(snow, 1)}


def weather_line(w: dict) -> str:
    sky = {
        "sunny": "bright sun and a clear sky",
        "mixed": "sun and clouds taking turns",
        "overcast": "a soft overcast sky",
    }[w["sky"]]
    ground = {
        "snow": "fresh snow lying on the ground, and everyone dressed for it",
        "rain": "wet ground, puddles, and a few umbrellas about",
        "showers": "the ground still damp from a shower",
        "dry": "dry ground",
    }[w["precip"]]
    wear = {
        "cold": "everyone in warm coats, scarves and mittens",
        "cool": "everyone in jackets and long sleeves",
        "mild": "everyone in light layers",
        "warm": "everyone in short sleeves",
        "hot": "everyone in short sleeves and sun hats pushed back, and shade wherever there is any",
    }[w["temp"]]
    return f"The weather: a {w['temp']} week with {sky}, {ground}; {wear}."


# ---------------------------------------------------------------------------------------------
# calendar

COUNTS_JS = r"""
const {DatabaseSync} = require("node:sqlite");
const db = new DatabaseSync("/data/wall.db", {readOnly: true});
const [from, to] = process.argv.slice(2);
const latest = `select max(id) from sync_run r2 where r2.source_id = e.source_id and r2.state = 'promoted'`;
const day = `coalesce(e.all_day_start_date, substr(e.starts_at_utc, 1, 10))`;
const counts = db.prepare(`
  select a.category, count(*) n from calendar_event e join asset a on a.id = e.icon_asset_id
  where e.sync_run_id = (${latest}) and ${day} between ? and ? group by 1`).all(from, to);
const hints = db.prepare(`
  select e.title from calendar_event e
  where e.sync_run_id = (${latest}) and ${day} between ? and ?
    and e.all_day_start_date is not null and lower(e.title) like 'scene:%'`).all(from, to);
console.log(JSON.stringify({
  counts: Object.fromEntries(counts.map(r => [r.category, r.n])),
  hints: hints.map(r => r.title.slice(6).trim()).filter(Boolean),
}));
"""


def fetch_calendar(monday: dt.date) -> dict:
    """Counts by category and opt-in `scene:` notes, read in the container over stdin.

    The DB is a docker volume, so the query runs inside the container with node:sqlite rather
    than copying the file out. Titles never leave this function except the ones after a
    `scene:` marker — that is the one channel a person composes for the picture.
    """
    sunday = monday + dt.timedelta(days=6)
    got = subprocess.run(
        ["docker", "exec", "-i", CONTAINER, "node", "--no-warnings", "-",
         monday.isoformat(), sunday.isoformat()],
        input=COUNTS_JS, capture_output=True, text=True, timeout=30, check=False,
    )
    if got.returncode != 0:
        raise RuntimeError((got.stderr or got.stdout).strip().splitlines()[-1:] or ["exit "
                           + str(got.returncode)])
    return json.loads(got.stdout.strip().splitlines()[-1])


def props_line(counts: dict, holidays: list[str], children: int = 3) -> str:
    props = [PROPS[c] for c in PROPS if counts.get(c)]
    parts = []
    if props:
        parts.append(f"Somewhere in the scene, owned by the crowd and not by {the_children(children)}: "
                     + "; ".join(props) + ".")
    for h in holidays:
        parts.append(f"It is {h}.")
    return " ".join(parts)


# ---------------------------------------------------------------------------------------------

def compute(monday: dt.date) -> dict:
    """Everything, with each source's failure written down instead of raised."""
    ctx: dict = {
        "week": iso_week(monday), "monday": monday.isoformat(),
        "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "weather": None, "weather_line": "", "calendar": None, "props_line": "",
        "hints": [], "holidays": holidays_in(monday), "notes": [],
    }
    place = load_place()
    # Open-Meteo forecasts 16 days ahead. Further out it answers 400, which reads as a broken
    # call; it is a week that has no forecast yet, and the picture does without.
    horizon = dt.date.today() + dt.timedelta(days=15)
    if place is not None and monday + dt.timedelta(days=6) > horizon:
        ctx["notes"].append("weather: none (no forecast yet — Open-Meteo reaches 16 days ahead)")
    elif place is None:
        ctx["notes"].append(f"weather: none ({PLACE_PATH.relative_to(ROOT)} missing; "
                            "copy db/scene-place.example.json)")
    else:
        try:
            ctx["weather"] = summarise_weather(fetch_forecast(place, monday))
            ctx["weather_line"] = weather_line(ctx["weather"])
        except Exception as exc:  # noqa: BLE001 — a missing line is the designed outcome
            ctx["notes"].append(f"weather: none ({type(exc).__name__}: {exc})")
    try:
        cal = fetch_calendar(monday)
        ctx["calendar"] = cal["counts"]
        ctx["hints"] = cal["hints"]
    except Exception as exc:  # noqa: BLE001
        ctx["notes"].append(f"calendar: none ({type(exc).__name__}: {exc})")
    # The headcount comes from the same cast file the prompt is built from (db/cast.json).
    ctx["props_line"] = props_line(ctx["calendar"] or {}, ctx["holidays"],
                                   len(load_cast()["children"]))
    return ctx


def provisional(ctx: dict, place_configured: bool) -> list[str]:
    """What a stored brief is missing that a later fetch could supply. Empty means frozen.

    Weather counts only when a place is configured: without `db/scene-place.json` it can never
    arrive, and treating that as provisional would re-read the calendar on every run — which is
    the moving brief freezing exists to prevent.
    """
    missing = []
    if ctx.get("weather") is None and place_configured:
        missing.append("weather")
    if ctx.get("calendar") is None:
        missing.append("calendar")
    return missing


def context_for(monday: dt.date, refresh: bool = False) -> tuple[dict, pathlib.Path]:
    path = CONTEXT_DIR / f"{iso_week(monday)}.json"
    if path.exists() and not refresh:
        with open(path, encoding="utf-8") as fh:
            stored = json.load(fh)
        missing = provisional(stored, PLACE_PATH.exists())
        if not missing:
            return stored, path
        print(f"context : {path.name} was provisional (no {', '.join(missing)}; fetched "
              f"{stored.get('fetched_at')}) — fetching again", file=sys.stderr)
    ctx = compute(monday)
    CONTEXT_DIR.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(ctx, fh, indent=2)
        fh.write("\n")
    return ctx, path


def selftest() -> None:
    """The freeze rule, driven rather than read. Offline: compute() and the place are stubbed.

    The failure this guards is silence — a brief frozen with a hole in it looks exactly like a
    brief, and the only symptom is a picture with no weather in it — so the test runs
    context_for() against real files in a scratch directory and counts the fetches.
    """
    import tempfile
    global CONTEXT_DIR, PLACE_PATH, compute
    saved = (CONTEXT_DIR, PLACE_PATH, compute)
    fetches: list[dt.date] = []
    monday = dt.date(2026, 9, 28)
    full = {"week": "2026-W40", "fetched_at": "full", "weather": {"temp": "warm"},
            "calendar": {"dance": 1}, "notes": []}
    failures = []

    def case(name: str, stored: dict | None, place: bool, expect_fetch: bool) -> None:
        fetches.clear()
        path = CONTEXT_DIR / "2026-W40.json"
        if path.exists():
            path.unlink()
        if stored is not None:
            path.write_text(json.dumps(stored))
        if place:
            PLACE_PATH.write_text("{}")
        elif PLACE_PATH.exists():
            PLACE_PATH.unlink()
        ctx, _ = context_for(monday)
        if bool(fetches) != expect_fetch:
            failures.append(f"{name}: fetched={bool(fetches)}, expected {expect_fetch}")
        if expect_fetch and json.loads(path.read_text())["fetched_at"] != "full":
            failures.append(f"{name}: the fresh brief was not written back")
        if not expect_fetch and ctx != stored:
            failures.append(f"{name}: a frozen brief came back changed")

    with tempfile.TemporaryDirectory() as tmp:
        CONTEXT_DIR = pathlib.Path(tmp) / "ctx"
        CONTEXT_DIR.mkdir()
        PLACE_PATH = pathlib.Path(tmp) / "place.json"
        compute = lambda m: (fetches.append(m), dict(full))[1]  # noqa: E731
        try:
            case("no file", None, place=True, expect_fetch=True)
            case("complete brief is frozen", dict(full), place=True, expect_fetch=False)
            case("written too early (no weather)", {**full, "fetched_at": "early", "weather": None},
                 place=True, expect_fetch=True)
            case("calendar was down", {**full, "fetched_at": "early", "calendar": None},
                 place=True, expect_fetch=True)
            case("no place configured: no weather is final",
                 {**full, "weather": None}, place=False, expect_fetch=False)
        finally:
            CONTEXT_DIR, PLACE_PATH, compute = saved
    if failures:
        for f in failures:
            print("  FAIL " + f)
        raise SystemExit(1)
    print("context freeze rule OK (5 cases)")


def main(argv: list[str]) -> int:
    if "--selftest" in argv:
        selftest()
        return 0
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--week", help="ISO week, e.g. 2026-W40. Default: the week the picture is for.")
    ap.add_argument("--refresh", action="store_true", help="fetch again even if frozen")
    ap.add_argument("--print", action="store_true", help="print the lines the prompt will carry")
    args = ap.parse_args(argv)
    if args.week:
        monday = week_of(args.week)
    else:
        monday = week_for_today()
    ctx, path = context_for(monday, refresh=args.refresh)
    print(f"context : {path.relative_to(ROOT)}  ({ctx['week']}, fetched {ctx['fetched_at']})")
    for note in ctx["notes"]:
        print(f"  {note}")
    if args.print:
        print(f"weather : {ctx['weather_line'] or '(none)'}")
        print(f"props   : {ctx['props_line'] or '(none)'}")
        print(f"hints   : {'; '.join(ctx['hints']) or '(none)'}")
        print(f"counts  : {json.dumps(ctx['calendar'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
