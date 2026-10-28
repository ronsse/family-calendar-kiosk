#!/usr/bin/env python3
"""THIS WEEK — what the coming week is allowed to tell the picture.

    python3 tools/scene_context.py                    # this week's brief, fetched or reused
    python3 tools/scene_context.py --week 2026-W40    # a particular week (the Sunday run)
    python3 tools/scene_context.py --week 2026-W40b   # its Wednesday run (Wed..Sat)
    python3 tools/scene_context.py --refresh          # fetch again even if frozen
    python3 tools/scene_context.py --print            # the three lines gen-scene will see
    python3 tools/scene_context.py --selftest         # the freeze rule, asserted offline

Three sources, each optional, each degrading to nothing rather than to a guess:

  weather   Open-Meteo's daily forecast for the week at a coarse grid point (db/scene-place.json,
            gitignored; tenth-of-a-degree, no key, nothing sent but a lat/lon that covers a
            few miles of suburb). Becomes ONE sentence about the sky and what people wear.
  calendar  Category COUNTS from the wall's own SQLite, read the way the wall reads it — the
            latest promoted sync per source: "two dance things and a sport thing this week"
            becomes props in the crowd ("ballet slippers", "a ball and cones"). By default
            the only titles that leave the house are the ones a person wrote to be sent, by
            starting an all-day event with `scene:`. A household that sets
            `scenes.shareTitles` also hands the scene director (tools/scene_director.py) the
            run's ONE-OFF event titles — a book fair, a ski trip, a birthday — so it can
            theme the picture without anyone asking. VISITORS (db/guests.json) are matched
            by name inside the container and come out as ids whichever way that is set.
  holidays  A table by date. A holiday is a prop, not a premise: costumes go OVER ordinary
            clothes with the hair showing, because hair is how the children are found.

There are TWO runs a week (2026-10-18), and they SPLIT it: Sunday's covers Sun..Tue and is
named for the ISO week it opens (`2026-W43`), Wednesday's covers Wed..Sat and carries a `b`
(`2026-W43b`). Each brief is the days its picture is actually on the wall, so the two never
describe the same day (until 2026-10-18 they were two overlapping seven-day windows). The result
is FROZEN to db/scene-context/<run>.json the first time it is computed, and every retry of that
run reads the file, so a forecast that moved between 02:30 and the 04:00 retry cannot change
the brief the director already chose from.

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

# The run's holiday, if any: (first day, last day, words). A run whose window touches any day of
# the span gets it. Until 2026-10-28 every holiday was ONE day, so of Halloween's two runs only
# the one holding the 31st heard of it — the Sunday-to-Tuesday before it was "an ordinary autumn
# week" to the director. The big three now run the week up to the day (docs/scene-variety-plan.md
# D); Easter and Thanksgiving are computed in holidays_in().
HOLIDAYS = [
    ((10, 24), (10, 31), "Halloween week: carved pumpkins on steps, and any costume is worn OVER "
                         "ordinary clothes with no mask and the hair fully showing"),
    ((12, 18), (12, 25), "Christmas week: lights along the eaves, a decorated tree seen through a "
                         "window, wrapped parcels"),
    ((12, 31), (1, 1),   "New Year: paper streamers, a few balloons, and someone carrying a clock"),
    ((2, 14), (2, 14),   "Valentine's: paper hearts in windows and a bunch of red flowers"),
    ((3, 17), (3, 17),   "St Patrick's: shamrocks and a lot of green worn by the crowd"),
    ((7, 4), (7, 4),     "the Fourth of July: bunting, small flags, and a parade forming up in the "
                         "distance"),
]


def _in_span(day: dt.date, first: tuple[int, int], last: tuple[int, int]) -> bool:
    key = (day.month, day.day)
    return first <= key <= last if first <= last else (key >= first or key <= last)


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


def local_today() -> dt.date:
    """Today in the HOUSEHOLD's zone, not the server's. The host runs UTC, so a Saturday 20:00
    retry in Denver would otherwise be named as Sunday's run."""
    try:
        from zoneinfo import ZoneInfo
        import household_config
        zone = household_config.load_or_defaults()["timezone"]
        return dt.datetime.now(ZoneInfo(zone)).date()
    except Exception:  # noqa: BLE001 — a broken config is reported where it is applied
        return dt.date.today()


def week_for_today(today: dt.date | None = None) -> dt.date:
    """The Monday of the week the picture is FOR.

    Sunday is the day the timer runs and the day the picture is approved for the week ahead;
    in ISO terms it is the last day of the week behind. So a Sunday belongs to the coming
    week here, and every other day to its own — the same rule scene-week.py uses, because the
    two must agree on the week's name or the context is for one week and the seed for another.
    """
    today = today or local_today()
    monday = today - dt.timedelta(days=today.weekday())
    return monday + dt.timedelta(days=7) if today.weekday() == 6 else monday


def run_name(monday: dt.date, part: str = "") -> str:
    """`2026-W43` for the Sunday run, `2026-W43b` for the Wednesday one."""
    return iso_week(monday) + part


def parse_run(text: str) -> tuple[dt.date, str]:
    """`2026-W43` or `2026-W43b` → (Monday, part)."""
    part = "b" if text.endswith("b") else ""
    return week_of(text[:-1] if part else text), part


def window(monday: dt.date, part: str = "") -> tuple[dt.date, dt.date]:
    """The days a run's picture is up for: Sun..Tue (the Sunday before `monday` through Tuesday),
    or Wed..Sat. Together they are one Sunday-to-Saturday week, split at Wednesday."""
    if part == "b":
        return monday + dt.timedelta(days=2), monday + dt.timedelta(days=5)
    return monday - dt.timedelta(days=1), monday + dt.timedelta(days=1)


def run_for_today(today: dt.date | None = None) -> tuple[dt.date, str]:
    """The run a timer firing today belongs to.

    Sunday is the first run of the week AHEAD (week_for_today); a Monday or Tuesday retry is
    still that run. Wednesday starts the `b` run, and a retry up to Saturday is still it.
    """
    today = today or local_today()
    monday = week_for_today(today)
    return monday, ("b" if 2 <= today.weekday() <= 5 else "")


def holidays_in(start: dt.date, end: dt.date) -> list[str]:
    days = [start + dt.timedelta(days=i) for i in range((end - start).days + 1)]
    found: list[str] = []
    for first, last, text in HOLIDAYS:
        if any(_in_span(day, first, last) for day in days):
            found.append(text)
    for day in days:
        if day == easter(day.year):
            found.append("Easter: painted eggs half hidden in the grass and a basket or two")
    thanks = thanksgiving(start.year)
    if any(thanks - dt.timedelta(days=6) <= day <= thanks for day in days):
        found.append("Thanksgiving week: a long table being laid outdoors or seen through a "
                     "window, and a pile of pumpkins")
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


def fetch_forecast(place: dict, start: dt.date, end: dt.date) -> dict:
    q = urllib.parse.urlencode({
        "latitude": place["lat"], "longitude": place["lon"], "timezone": place["timezone"],
        "start_date": start.isoformat(), "end_date": end.isoformat(),
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
    return f"The weather: a {w['temp']} few days with {sky}, {ground}; {wear}."


# ---------------------------------------------------------------------------------------------
# calendar

CALENDAR_JS = HERE / "scene-calendar.cjs"


def calendar_options() -> dict:
    """What the calendar read may return beyond counts: titles if the household shares them,
    and the visitors to look for. Either source failing to load means "no", never a guess."""
    opts: dict = {"titles": False, "guests": []}
    try:
        import household_config
        opts["titles"] = bool(household_config.load_or_defaults()["scenes"].get("shareTitles"))
    except (SystemExit, OSError, ValueError, KeyError):
        pass
    try:
        import scene_guests
        opts["guests"] = scene_guests.matchers(scene_guests.load())
    except (SystemExit, OSError, ValueError, KeyError):
        pass
    return opts


def fetch_calendar(start: dt.date, end: dt.date, opts: dict | None = None) -> dict:
    """Counts by category, `scene:` notes, and — as `opts` allow — one-off titles and visitors.

    The DB is a docker volume, so tools/scene-calendar.cjs runs inside the container with
    node:sqlite rather than copying the file out. Visitors are matched there and come back as
    ids; titles come back only with `opts["titles"]`.
    """
    got = subprocess.run(
        ["docker", "exec", "-i", CONTAINER, "node", "--no-warnings", "-",
         start.isoformat(), end.isoformat(), json.dumps(opts or {})],
        input=CALENDAR_JS.read_text(encoding="utf-8"), capture_output=True, text=True, timeout=30, check=False,
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

def compute(monday: dt.date, part: str = "", opts: dict | None = None) -> dict:
    """Everything, with each source's failure written down instead of raised."""
    start, end = window(monday, part)
    opts = calendar_options() if opts is None else opts
    ctx: dict = {
        "week": iso_week(monday), "run": run_name(monday, part), "monday": monday.isoformat(),
        "from": start.isoformat(), "to": end.isoformat(),
        "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "weather": None, "weather_line": "", "calendar": None, "props_line": "",
        "hints": [], "holidays": holidays_in(start, end), "titles": bool(opts.get("titles")),
        "events": [], "routine": 0, "visitors": [], "notes": [],
    }
    place = load_place()
    # Open-Meteo forecasts 16 days ahead. Further out it answers 400, which reads as a broken
    # call; it is a week that has no forecast yet, and the picture does without.
    horizon = dt.date.today() + dt.timedelta(days=15)
    if place is not None and end > horizon:
        ctx["notes"].append("weather: none (no forecast yet — Open-Meteo reaches 16 days ahead)")
    elif place is None:
        ctx["notes"].append(f"weather: none ({PLACE_PATH.relative_to(ROOT)} missing; "
                            "copy db/scene-place.example.json)")
    else:
        try:
            ctx["weather"] = summarise_weather(fetch_forecast(place, start, end))
            ctx["weather_line"] = weather_line(ctx["weather"])
        except Exception as exc:  # noqa: BLE001 — a missing line is the designed outcome
            ctx["notes"].append(f"weather: none ({type(exc).__name__}: {exc})")
    try:
        cal = fetch_calendar(start, end, opts)
        ctx["calendar"] = cal["counts"]
        ctx["hints"] = cal["hints"]
        ctx["events"] = cal.get("events", [])
        ctx["routine"] = cal.get("routine", 0)
        ctx["visitors"] = cal.get("visitors", [])
        if ctx["visitors"]:
            ctx["notes"].append("visitors: " + ", ".join(
                f"{v['id']} {v['from']}..{v['to']}" for v in ctx["visitors"]))
        if ctx["titles"]:
            ctx["notes"].append(f"events: {len(ctx['events'])} one-off, {ctx['routine']} routine")
    except Exception as exc:  # noqa: BLE001
        ctx["notes"].append(f"calendar: none ({type(exc).__name__}: {exc})")
    # The headcount comes from the same cast file the prompt is built from (db/cast.json).
    ctx["props_line"] = props_line(ctx["calendar"] or {}, ctx["holidays"],
                                   len(load_cast()["children"]))
    return ctx


def provisional(ctx: dict, place_configured: bool, titles: bool = False) -> list[str]:
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
    elif titles and not ctx.get("titles"):
        # Written before the household turned shareTitles on: the director would be choosing
        # without the one thing it was switched on to read.
        missing.append("event titles")
    return missing


def context_for(monday: dt.date, refresh: bool = False, part: str = "",
                opts: dict | None = None) -> tuple[dict, pathlib.Path]:
    path = CONTEXT_DIR / f"{run_name(monday, part)}.json"
    opts = calendar_options() if opts is None else opts
    if path.exists() and not refresh:
        with open(path, encoding="utf-8") as fh:
            stored = json.load(fh)
        missing = provisional(stored, PLACE_PATH.exists(), bool(opts.get("titles")))
        # A brief frozen for another window (written before the 2026-10-18 split, when every run
        # was seven days) describes days this picture will not be up for.
        start, end = window(monday, part)
        if (stored.get("from"), stored.get("to")) != (start.isoformat(), end.isoformat()):
            missing.append(f"brief for the {start}..{end} window")
        if not missing:
            return stored, path
        print(f"context : {path.name} was provisional (no {', '.join(missing)}; fetched "
              f"{stored.get('fetched_at')}) — fetching again", file=sys.stderr)
    ctx = compute(monday, part, opts)
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
            "calendar": {"dance": 1}, "notes": [], "from": "2026-09-27", "to": "2026-09-29"}
    failures = []

    def case(name: str, stored: dict | None, place: bool, expect_fetch: bool,
             titles: bool = False) -> None:
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
        ctx, _ = context_for(monday, opts={"titles": titles})
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
        compute = lambda m, part="", opts=None: (fetches.append(m), dict(full))[1]  # noqa: E731
        try:
            case("no file", None, place=True, expect_fetch=True)
            case("complete brief is frozen", dict(full), place=True, expect_fetch=False)
            case("written too early (no weather)", {**full, "fetched_at": "early", "weather": None},
                 place=True, expect_fetch=True)
            case("calendar was down", {**full, "fetched_at": "early", "calendar": None},
                 place=True, expect_fetch=True)
            case("no place configured: no weather is final",
                 {**full, "weather": None}, place=False, expect_fetch=False)
            case("shareTitles turned on after the freeze", dict(full), place=True,
                 expect_fetch=True, titles=True)
            case("titles already in it", {**full, "titles": True}, place=True,
                 expect_fetch=False, titles=True)
            case("frozen for the old seven-day window", {**full, "from": "2026-09-28",
                 "to": "2026-10-04"}, place=True, expect_fetch=True)
        finally:
            CONTEXT_DIR, PLACE_PATH, compute = saved
    if failures:
        for f in failures:
            print("  FAIL " + f)
        raise SystemExit(1)
    # The two runs: names, windows, and which one a timer firing on each weekday belongs to.
    m43 = dt.date(2026, 10, 19)
    expect = {dt.date(2026, 10, 18): (m43, ""), dt.date(2026, 10, 19): (m43, ""),
              dt.date(2026, 10, 20): (m43, ""), dt.date(2026, 10, 21): (m43, "b"),
              dt.date(2026, 10, 24): (m43, "b"), dt.date(2026, 10, 25): (m43 + dt.timedelta(7), "")}
    for day, want in expect.items():
        if run_for_today(day) != want:
            failures.append(f"run_for_today({day}) = {run_for_today(day)}, expected {want}")
    if window(m43) != (dt.date(2026, 10, 18), dt.date(2026, 10, 20)):
        failures.append(f"the Sunday window is {window(m43)}")
    if window(m43, "b") != (dt.date(2026, 10, 21), dt.date(2026, 10, 24)):
        failures.append(f"the b window is {window(m43, 'b')}")
    # The two halves tile the week: next Sunday's window starts the day after this b one ends.
    if window(m43 + dt.timedelta(7))[0] != window(m43, "b")[1] + dt.timedelta(1):
        failures.append("the windows leave a gap or overlap between runs")
    if parse_run("2026-W43b") != (m43, "b") or run_name(*parse_run("2026-W43")) != "2026-W43":
        failures.append("run names do not round-trip")
    if failures:
        for f in failures:
            print("  FAIL " + f)
        raise SystemExit(1)
    print("context freeze rule and runs OK (8 cases, 9 dates)")


def main(argv: list[str]) -> int:
    if "--selftest" in argv:
        selftest()
        return 0
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--week", help="run, e.g. 2026-W40 (Sunday) or 2026-W40b (Wednesday). "
                    "Default: the run a timer firing today belongs to.")
    ap.add_argument("--refresh", action="store_true", help="fetch again even if frozen")
    ap.add_argument("--print", action="store_true", help="print the lines the prompt will carry")
    args = ap.parse_args(argv)
    monday, part = parse_run(args.week) if args.week else run_for_today()
    ctx, path = context_for(monday, refresh=args.refresh, part=part)
    print(f"context : {path.relative_to(ROOT)}  ({ctx.get('run', ctx['week'])}, "
          f"{ctx.get('from', ctx['monday'])}..{ctx.get('to', '')}, fetched {ctx['fetched_at']})")
    for note in ctx["notes"]:
        print(f"  {note}")
    if args.print:
        print(f"weather : {ctx['weather_line'] or '(none)'}")
        print(f"props   : {ctx['props_line'] or '(none)'}")
        print(f"hints   : {'; '.join(ctx['hints']) or '(none)'}")
        print(f"counts  : {json.dumps(ctx['calendar'])}")
        print(f"visitors: {', '.join(v['id'] for v in ctx.get('visitors', [])) or '(none)'}")
        if ctx.get("titles"):
            print(f"events  : {len(ctx.get('events', []))} one-off (shareTitles on; "
                  "titles are in the file, not printed)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
