#!/usr/bin/env python3
"""The weekly scene run: generate one picture, find its children, offer it as a candidate.

    OP_SERVICE_ACCOUNT_TOKEN="$(cat ~/.config/op-service-token)" \
    op run --env-file=tools/op.env -- python3 tools/scene-week.py   # this week
    python3 tools/scene-week.py --dry-run       # what it WOULD do, for free
    python3 tools/scene-week.py --week 2026-W40 # a specific run, for testing (2026-W40b: Wednesday's)
    python3 tools/scene-week.py --dry-run --ask-director   # what the director would choose (~$0.002)

WHY THIS EXISTS. Everything needed for a weekly picture has been in the repo since 2026-09-02
— a generator, a style table, an activity table, a region finder that refuses rather than
guesses — and no new picture ever appeared, because there was no step that RAN them and no
place a result could land. The operator found it as "the image generation hasn't updated". Capability
without a scheduler is not a feature; it is four scripts and a good intention.

WHAT IT DOES NOT DO, AND THAT IS THE POINT. It never changes the picture on the wall. The
scene is registered as a CANDIDATE, and a candidate is not eligible for display at any price:
somebody has to look at it on the panel and approve it. Three children navigate BY this
picture — they find themselves in it and tap themselves — so an unreviewed image going up
unattended is the one automation this feature must not have. The failure mode of the whole
script is therefore "the wall keeps last week's picture", which is a completely acceptable
Sunday night.

TWO RUNS A WEEK, AND A DIRECTOR CHOOSES (2026-10-18). The timer fires on Sunday and on
Wednesday; each is a RUN (`2026-W43`, `2026-W43b`) with its own half of the week — Sun..Tue,
Wed..Sat, the days its picture is actually up — its own brief, its own ids and its own pair of candidates. What each run draws is
chosen by tools/scene_director.py: a text model reads the run's calendar, weather, holidays,
`scene:` notes and visiting family, and picks a setting from the household's catalog (or
describes a new one), a style, a camera and a premise. A book fair on the calendar is a book
fair on the wall without anybody typing `--setting`; a quiet week is offered a shortlist drawn
at random, so it is not the same place every time. `scenes.director: "rotation"` or
`--no-director` puts back the old arithmetic, and it is also the fallback whenever the director
is unreachable or refused twice.

WHAT STAYS DETERMINISTIC is everything AFTER the choice. The decision is frozen to
db/scene-director/<run>.json and a retry reads it; the seed is the run and the scene; the
prompt digest decides whether an image is reused. So "try again" never becomes "try something
else" — the property the old week-number rotation existed for — while the choosing itself is
free to vary. The rotation below is unchanged and still decides a week the director does not.

VISITING FAMILY (db/guests.json, gitignored; the synthetic twin is db/guests.example.json).
When a calendar event in the run's window names a guest AND says they are visiting ("Sam and
Alex visiting", "Robin staying with us" — a birthday alone is not a visit), they are drawn into
the picture as a group apart from the children, described by age, hair and height and never by
name, and the finder is told they are not the portraits (tools/scene_guests.py).

TWO CANDIDATES A WEEK, FROM TWO MODELS — since 2026-09-12. A single picture a week gave the
household one thing to say yes or no to, and a "no" was a week with nothing new. Two pictures
from two different models (tools/fal_api.py) cost about the same as the one Nous picture used
to, are more different from each other than two seeds of one model would be, and turn the
Sunday review into a CHOICE rather than a verdict. Each goes through the region finder on its
own; whatever passes is offered. `--candidates 1` is the old behaviour.

COST: about $0.05 (gpt-image-2) + $0.12 (nano-banana-2) for the pictures plus a cent or two
for the vision passes — roughly $0.20 a week, $10 a year. The free NVIDIA path is NOT usable
here: FLUX.1-dev cannot hold the cast (CLAUDE.md, measured 2026-09-11). `--provider nvidia`
is still wired for anything where identity does not matter, and `--provider nous` still works
when that account has credit.
"""
import argparse
import datetime as dt
import json
import os
import pathlib
import shutil
import subprocess
import random
import re
import zlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent
STYLES = json.loads((HERE / "scene-styles.json").read_text())["styles"]
SETTINGS = json.loads((HERE / "scene-settings.json").read_text())["settings"]
ALL_SETTINGS = list(SETTINGS)
COMPOSITIONS = json.loads((HERE / "scene-compositions.json").read_text())["compositions"]
ALL_COMPOSITIONS = list(COMPOSITIONS)
PREMISES = json.loads((HERE / "scene-premises.json").read_text())["premises"]
PREMISE_BY_ID = {p["id"]: p for p in PREMISES}

sys.path.insert(0, str(HERE))
import scene_context
import scene_activities  # noqa: E402  (what the children may be doing, and where)
import scene_activity_writer  # noqa: E402  (or what a text model writes for them, guardrailed)
import scene_memory  # noqa: E402  (which styles the wall has shown lately)
import scene_story  # noqa: E402  (a sibling module: THIS WEEK's weather, props and notes)
import scene_director  # noqa: E402  (a text model chooses the run's picture; rotation is its fallback)
import scene_guests  # noqa: E402  (visiting family, from db/guests.json and the calendar)
import scene_dog  # noqa: E402  (what the dog is up to: hiding, or busy with his own fun)
import household_config  # noqa: E402  (db/household.json: the household's scene preferences)
from scene_cast import cast_fits, fill_children, load_cast  # noqa: E402

# The API keys each provider needs, from the ENVIRONMENT only. They used to be read here with
# `op read` and a hardcoded vault path; the timer now wraps this script in
# `op run --env-file=tools/op.env`, so a second household brings its own references and this
# file names no vault. NVIDIA draws but the finder runs on fal, hence both.
NEEDED_KEYS = {
    "fal": ("FAL_KEY",),
    "nous": ("NOUS_API_KEY",),
    "nvidia": ("NVIDIA_API_KEY", "FAL_KEY"),
}

# What a prompt-reaching table field may no longer say: a child count written as a word. Those
# became tokens (`{the_children}`, `{count}`, `{all_of_them}` — scene_cast.fill_children) on
# 2026-10-12 so a cast of one, two, four or five reads correctly. Narrow on purpose: "three-
# quarter view", "THREE CLEAR DEPTHS" and "three people after them" are not about the cast.
# An entry that carries `"cast": [3]` was written for exactly three and is exempt.
CHILD_THREE = re.compile(
    r"\b(?:the three|all three|of the three|three children|only three|three different)\b",
    re.IGNORECASE)

# The region finder's exit code for a deliberate refusal, as opposed to a crash. Imported by
# value rather than by import: scene-regions.py is a script with a hyphen in its name.
REFUSED = 3

# Where the wall reads its pictures from. A generated scene lands in the VOLUME and is not
# committed: it is the household's, not the repo's, and the committed set is deliberately the
# floor rather than the whole library (src/domain/scenes/library.ts).
CONTAINER = os.environ.get("WALL_CONTAINER", "family-calendar-wall")
VOLUME_SCENES = os.environ.get("WALL_VOLUME_SCENES", "/data/assets/scenes")


def iso_week(when: dt.date) -> str:
    year, week, _ = when.isocalendar()
    return f"{year}-W{week:02d}"


def parse_week(text: str) -> dt.date:
    """The Monday of an ISO week like `2026-W37`."""
    year, _, week = text.partition("-W")
    return dt.date.fromisocalendar(int(year), int(week), 1)


def choose(monday: dt.date, forced: str | None = None,
           forced_style: str | None = None,
           forced_camera: str | None = None, avoid: list[str] = (),
           exclude: list[str] = ()) -> tuple[dict, dict, dict]:
    """Style, setting and CAMERA for a week — a pure function of the date, deliberately.

    A re-run after a failed generation must produce the SAME brief, or "try it again" would
    silently become "try something else" and a week that failed twice would be untraceable.

    THE SETTING ADVANCES BY ONE, and that is not laziness. An earlier draft used `week * 3`,
    which in winter — when exactly three settings are in season — lands on index 0 every single
    week forever: the stride divided the list length. That is the same trap
    `src/domain/chores/rotation.ts` records for a weekly chore with seven members, found here by
    printing a year of output instead of reasoning about it. A stride of 1 is coprime with every
    length there will ever be, so it cannot recur however the table is edited.

    The STYLE is then offset by the setting's index rather than taken from the week alone. Both
    advancing by one would lock them in step and give only `lcm(6, n)` distinct pairs — six of
    them in a three-setting month. The offset breaks the lock and is why fourteen settings and
    six styles make a year that does not visibly repeat.

    THE CAMERA is offset differently again — by the STYLE's index — for exactly the same reason
    and against exactly the same trap. Offsetting it by the setting's index like the style would
    put camera and style in permanent lockstep, and the whole point of adding a third axis is
    that it moves independently of the other two. Added 2026-09-10 on the observation that every
    scene looked like the same photograph of a different place.

    THE WALL (2026-10-28): `avoid` is the settings it showed last, and the rotation steps past
    them unless that would leave nothing in season; `exclude` is never chosen (the run's other
    picture). Still a pure function of its arguments, so a retry is the same brief as long as
    the caller leaves the run's own pictures out of `avoid`.
    """
    _, week, _ = monday.isocalendar()
    pin_style = next((x for x in STYLES if x["id"] == forced_style), None)
    pin_cam = next((x for x in ALL_COMPOSITIONS if x["id"] == forced_camera), None)
    if forced is not None:
        # Season is deliberately ignored: a person naming a setting has already decided it fits,
        # and a snowy castle in September is a picture somebody asked for rather than a bug.
        # Style and camera still rotate off the week, so two forced runs are not the same image.
        chosen = next(x for x in SETTINGS if x["id"] == forced)
        style_at = (week + SETTINGS.index(chosen)) % len(STYLES)
        return (pin_style or STYLES[style_at], chosen,
                pin_cam or COMPOSITIONS[(week + style_at) % len(COMPOSITIONS)])
    eligible = [s for s in SETTINGS if monday.month in s["season"]]
    if not eligible:
        # Cannot happen while scene-settings.json covers all twelve months, which is checked
        # below — but a silent fallback to "whatever is first" would put a snowy hill in July
        # and look like a model failure rather than a data one.
        raise SystemExit(f"no setting is in season for month {monday.month}; fix scene-settings.json")
    eligible = [s for s in eligible if s["id"] not in exclude] or eligible
    eligible = [s for s in eligible if s["id"] not in avoid] or eligible
    eligible.sort(key=lambda s: s["id"])
    at = week % len(eligible)
    style_at = (week + at) % len(STYLES)
    return (
        pin_style or STYLES[style_at],
        eligible[at],
        pin_cam or COMPOSITIONS[(week + style_at) % len(COMPOSITIONS)],
    )


def prompt_fields() -> list[tuple[str, dict, str]]:
    """(file, entry, text) for every table field that reaches a prompt."""
    acts = scene_activities.load()
    out = []
    for e in COMPOSITIONS:
        out.append(("scene-compositions.json", e, e.get("camera", "")))
    for e in STYLES:
        out += [("scene-styles.json", e, e.get(k, "")) for k in ("style", "palette")]
    for e in PREMISES:
        out += [("scene-premises.json", e, e.get(k) or "")
                for k in ("brief", "layout", "crowd", "nearest", "rules")]
        out += [("scene-premises.json", e, a.get("do", "")) for a in e.get("activities") or []]
    for kind in ("solo", "shared"):
        out += [("scene-activities.json", e, e.get("do", "")) for e in acts[kind]]
    for e in SETTINGS:
        out += [("scene-settings.json", e, e.get(k) or "") for k in ("setting", "crowd", "wardrobe")]
        out += [("scene-settings.json", e, m.get("do", ""))
                for m in (e.get("story") or {}).get("moments") or []]
    return out


def check_tables(children: int = 3, written: bool = False) -> None:
    """Cheap structural checks on the data tables, run before anything is paid for.

    Not a test suite — there is no Python test runner in this repo — but these are the three
    ways an edit to a JSON file can produce a bill and nothing else: a duplicate id (so one row
    is unreachable forever), an empty camera clause (so the axis silently does nothing), and a
    table with no crowd-carrying vantage at all (so no scene can ever be a search-and-find,
    which is the only kind of picture this wall wants).
    """
    for name, table, field in (
        ("scene-compositions.json", COMPOSITIONS, "camera"),
        ("scene-styles.json", STYLES, "style"),
        ("scene-settings.json", SETTINGS, "setting"),
        ("scene-premises.json", PREMISES, "families"),
    ):
        ids = [e["id"] for e in table]
        dupes = sorted({i for i in ids if ids.count(i) > 1})
        if dupes:
            raise SystemExit(f"{name} has duplicate ids {dupes}; one of each pair is unreachable")
        empty = [e["id"] for e in table if not str(e.get(field, "")).strip()]
        if empty:
            raise SystemExit(f"{name}: {empty} have an empty {field!r} and would draw nothing")
    # Every setting can only draw activities that belong in it (2026-10-04: a deer ride inside a
    # library, because untagged meant "anywhere"). Refuses before the first paid call.
    # In `written` mode (scenes.activities, 2026-10-12) a setting too thin to deal one KIND per
    # child is a warning: the writer fills it, and only a writer refused twice reaches the table.
    # Everything structural (untagged, unknown place) still refuses in both modes.
    for warning in scene_activities.check(SETTINGS, children=children, written=written):
        print(f"warning: {warning} (the activity writer fills it; the table is only its "
              "fallback)", file=sys.stderr)
    # The dog's moods use the same closed `places` vocabulary; an unknown place would make a
    # mood silently undrawable, which is the signature bug in a table.
    dog_problems = scene_dog.problems(scene_dog.load(), scene_dog.places_known())
    if dog_problems:
        raise SystemExit("scene-dog.json:\n  - " + "\n  - ".join(dog_problems))
    # A COUNT WRITTEN AS A WORD is a cast of three hardcoded into a prompt. Refused here rather
    # than found in a picture of two children described as three.
    counted = sorted({f"{name}: {e.get('id') or e.get('do', '')[:40]!r} says {m.group(0)!r}"
                      for name, e, text in prompt_fields()
                      if e.get("cast") != [3]
                      for m in [CHILD_THREE.search(text)] if m})
    if counted:
        raise SystemExit("these table fields write the child count as a word; use the tokens in "
                         "scene_cast.fill_children ({the_children}, {count}, {all_of_them}) or "
                         "mark the entry \"cast\": [3]:\n  - " + "\n  - ".join(counted))
    for name, table in (("scene-compositions.json", COMPOSITIONS),
                        ("scene-premises.json", PREMISES)):
        bad = sorted(e["id"] for e in table
                     if "cast" in e and not (isinstance(e["cast"], list) and e["cast"]
                                             and all(isinstance(c, int) for c in e["cast"])))
        if bad:
            raise SystemExit(f"{name}: {bad} have a `cast` that is not a list of headcounts")
    # SWIMWEAR IS ALWAYS AN ADULT'S CHOICE (BACKLOG 4.11, 2026-10-12). A `swimwear: true` setting
    # relaxes what the clothing clause and the finder accept, so it may only be drawn when a
    # person forces it with --setting. A season on it would let the Sunday timer pick it alone.
    timer_swim = sorted(st["id"] for st in SETTINGS if st.get("swimwear") and st.get("season"))
    if timer_swim:
        raise SystemExit(f"{timer_swim} carry swimwear AND a season, so the timer could draw them "
                         "unasked. A swimwear setting is forced-only: give it \"season\": [].")
    bad_swim = sorted(st["id"] for st in SETTINGS if "swimwear" in st and st["swimwear"] is not True)
    if bad_swim:
        raise SystemExit(f"{bad_swim}: swimwear is `true` or absent, nothing else")
    # A `manual` setting (2026-10-28) is drawn only by --setting: this year's costumes, a one-off.
    # The director never sees it; a season on it would hand it to the rotation instead.
    timer_manual = sorted(st["id"] for st in SETTINGS if st.get("manual") and st.get("season"))
    if timer_manual:
        raise SystemExit(f"{timer_manual} are `manual` AND carry a season, so the timer could draw "
                         "them unasked. A manual setting is forced-only: give it \"season\": [].")
    bad_manual = sorted(st["id"] for st in SETTINGS if "manual" in st and st["manual"] is not True)
    if bad_manual:
        raise SystemExit(f"{bad_manual}: manual is `true` or absent, nothing else")
    if not any(c.get("crowd") for c in COMPOSITIONS):
        raise SystemExit("no composition can carry a crowd; every scene would be a portrait")
    # NO PHOTOREAL. Decided 2026-09-18 after a week of it: the children came out as near-misses
    # of themselves, which is worse than a drawing that never pretended — the uncanny valley,
    # arriving exactly where the household's own row 10 warned it might. The style and the
    # premise that required it are deleted, so this can only fire if somebody adds one back;
    # it exists because the failure of a re-added photoreal style is a bill and a picture of
    # three children who are almost right, and nothing else would say so.
    back = sorted(e["id"] for t in (STYLES, PREMISES)
                  for e in t
                  if "photoreal" in ([e.get("family")] + list(e.get("families", []))))
    if back:
        raise SystemExit(
            f"photoreal is off for this household and {back} bring it back. "
            "If that is deliberate, the decision is docs/scene-inputs.md row 10 — change it "
            "there first, and delete this check with it."
        )


def check_settings_cover_the_year() -> None:
    months = set()
    for s in SETTINGS:
        months |= set(s["season"])
    missing = sorted(set(range(1, 13)) - months)
    if missing:
        raise SystemExit(f"scene-settings.json leaves months {missing} with nothing to draw")


def apply_preferences(cfg: dict, forced: dict) -> str | None:
    """Narrow the module's tables to the household's allowlists (`scenes.styles`,
    `scenes.settings`, `scenes.premises` in db/household.json). `None` means the whole table, so
    a household that never wrote one draws exactly what it always drew.

    A hand-forced id (`--style`, `--setting`, `--premise`) is never second-guessed: it is kept,
    appended after the allowed ones so the rotation over the allowed ones does not move.
    Returns an error sentence for an unknown id, or None."""
    global STYLES, SETTINGS, PREMISES
    path = household_config.config_path()
    for key, table_name, table in (("styles", "scene-styles.json", STYLES),
                                   ("settings", "scene-settings.json", SETTINGS),
                                   ("premises", "scene-premises.json", PREMISES)):
        allow = cfg.get(key)
        if allow is None:
            continue
        ids = {e["id"] for e in table}
        unknown = [i for i in allow if i not in ids]
        if unknown:
            return (f"{path}: scenes.{key} names {unknown[0]!r}, which is not an id in "
                    f"tools/{table_name}")
        kept = [e for e in table if e["id"] in allow]
        pin = forced.get(key)
        if pin is not None and pin not in allow:
            kept.append(next(e for e in table if e["id"] == pin))
        if key == "styles":
            STYLES = kept
        elif key == "settings":
            SETTINGS = kept
        else:
            PREMISES = kept
    return None


def budget(cfg: dict, provider: str, models: list[str | None],
           text_calls: int = 0, director_calls: int = 0) -> tuple[str, bool]:
    """The `budget :` line, and whether this run is over the household's weekly cap.

    fal has no balance API, so the cap is enforced against the ledger every fal call already
    writes (`fal_api.spent_since`), over the last seven days. The projection is the plan's
    conservative one: each candidate's picture twice (a re-run after a changed prompt buys it
    again) and two vision passes per candidate (locate, then verify), plus one text call per scene
    whose written activities are not yet frozen (`text_calls`: the writer runs once per BASE id,
    and both candidates of the pair draw the set it froze), plus the director's one call when it
    is still to come (`director_calls`)."""
    cap = cfg.get("weeklyBudgetUsd")
    if cap is None:
        return "uncapped", False
    if provider != "fal":
        return (f"capped at ${cap:.2f} but {provider} keeps no ledger, so the cap cannot be "
                "enforced; use provider fal or set weeklyBudgetUsd to null"), True
    import fal_api  # noqa: E402  (a sibling module; no key is read)
    since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=7)
    spent = fal_api.spent_since(since)
    pictures = 2 * sum(fal_api.MODELS[m]["price"] for m in models if m in fal_api.MODELS)
    finder = 2 * len(models) * fal_api.VISION_PRICE
    text_price = fal_api.TEXT_MODELS[fal_api.TEXT_MODEL]["price"]
    writer = text_calls * text_price
    director = director_calls * text_price
    projected = pictures + finder + writer + director
    over = spent + projected > cap
    line = (f"spent ${spent:.2f} of ${cap:.2f} this week, this run ${projected:.3f} "
            f"(pictures ${pictures:.3f}, finder ${finder:.3f}, writer ${writer:.3f}"
            + (f", director ${director:.3f}" if director_calls else "") + ")")
    return (line + ("  — OVER BUDGET" if over else "")), over


def ask_director(run_id: str, ctx: dict | None, guests: list[dict], cfg: dict, monday: dt.date,
                 wall_rows: list[dict], written_mode: bool, n_children: int,
                 freeze: bool = True, pictures: int = 1) -> dict | None:
    """The director's decision for this run, or None for the rotation. Everything it may choose
    from is the household's allowlisted tables; everything it is told comes from the frozen brief."""
    table = scene_activities.load()

    def fillable(setting: dict) -> list[str]:
        # An INVENTED place must be drawable by whatever deals the activities. In written mode
        # the writer fills it; in table mode the table must hold three kinds for its tags.
        if not setting.get("invented") or written_mode:
            return []
        season = {**setting, "season": [monday.month]}
        return scene_activities.kind_problems(table, [season], n_children)

    try:
        names = [n for m in scene_guests.matchers(scene_guests.load()) for n in m["names"]]
    except SystemExit:
        names = []
    recent = scene_memory.recent_styles(wall_rows, "", set(SHORT.values()))
    return scene_director.decide(
        run_id, ctx=ctx, settings=SETTINGS, styles=STYLES, compositions=COMPOSITIONS,
        premises=PREMISES, places=table.get("places") or {}, wall_rows=wall_rows,
        recent_styles=recent, guests=guests, cast=load_cast(),
        share_titles=bool(cfg.get("shareTitles")), month=monday.month, names=names,
        freeze=freeze, extra_check=fillable, dog_moods=scene_dog.load(), pictures=pictures)


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    """Run a step, and report its OWN exit status.

    Never through a pipe: `cmd | tail; echo $?` reports tail's status, and that misread a
    refused run as a success twice in one hour on 2026-08-27 (CLAUDE.md).
    """
    print("+ " + " ".join(cmd), file=sys.stderr)
    return subprocess.run(cmd, check=False, **kw)


def main() -> int:
    global COMPOSITIONS
    ap = argparse.ArgumentParser()
    ap.add_argument("--week", help="the run: 2026-W40 (Sunday's, Sun..Tue) or 2026-W40b "
                                   "(Wednesday's, Wed..Sat). Default: the run today belongs to.")
    ap.add_argument("--no-director", action="store_true",
                    help="choose by the week-number rotation instead of asking the director "
                         "(the same as scenes.director: rotation)")
    ap.add_argument("--ask-director", action="store_true",
                    help="with --dry-run: ask the director now (one text call, ~$0.002, needs "
                         "FAL_KEY) and print its choice without freezing it")
    ap.add_argument("--style", choices=[x["id"] for x in STYLES],
                    help="force a style instead of the one the week is due. With --setting, "
                         "this is how a person builds a deliberate pair: the same place drawn "
                         "two ways. The timer never passes it.")
    ap.add_argument("--camera", choices=[x["id"] for x in COMPOSITIONS],
                    help="force the vantage. The third pinnable axis beside --setting and "
                         "--style, and the one that decides how much LANDSCAPE a picture gets "
                         "to be: close-front spends the frame on faces, layered-depth spends it "
                         "on distance. The timer never passes it.")
    ap.add_argument("--moment",
                    help="say what the three of them are DOING, in place of the activity table "
                         "(and in place of a story moment, if the setting has one). For a "
                         "person asking for a particular picture. The timer never passes it.")
    ap.add_argument("--setting", choices=[x["id"] for x in SETTINGS],
                    help="force a setting instead of the one the week is due, ignoring its "
                         "season. For building up a bank of pictures on purpose — a person "
                         "asking for a particular place, the way --premise is a person asking "
                         "for a particular KIND of picture. The timer never passes it.")
    ap.add_argument("--dry-run", action="store_true", help="print the brief and stop. Free.")
    ap.add_argument("--provider", default=None, choices=("fal", "nous", "nvidia"),
                    help="default: scenes.provider in db/household.json (fal)")
    ap.add_argument("--candidates", type=int, default=2,
                    help="how many pictures to generate, each on a different fal model")
    ap.add_argument("--keep-going", action="store_true",
                    help="exit 0 even when every candidate was refused (for testing the pipeline)")
    ap.add_argument("--premise", default=None, choices=[p["id"] for p in PREMISES],
                    help="what KIND of picture (tools/scene-premises.json). Default: the first "
                         "of scenes.premises in db/household.json (`plain`); a premise chosen "
                         "by a person for a week is never second-guessed.")
    ap.add_argument("--no-context", action="store_true",
                    help="say nothing about this week's weather, calendar or holidays")
    ap.add_argument("--write-activities", action="store_true",
                    help="write and freeze this scene's activities (db/scene-activities/), "
                         "print them and draw nothing. One text call, ~$0.002; needs FAL_KEY.")
    args = ap.parse_args()

    # THE HOUSEHOLD'S PREFERENCES, before anything else: a household that switched scenes off
    # is not a failing timer, it is a timer with nothing to do.
    try:
        cfg = household_config.load_or_defaults()["scenes"]
    except (ValueError, OSError) as err:
        print(f"{household_config.config_path()}: {err}", file=sys.stderr)
        return 2
    if cfg["mode"] != "generated":
        print(f"scenes.mode is {cfg['mode']}: nothing to draw")
        return 0
    try:
        n_children = len(load_cast()["children"])
    except SystemExit as err:
        print(err, file=sys.stderr)
        return 2
    args.provider = args.provider or cfg["provider"]
    written_mode = cfg.get("activities", "written") == "written"
    premise_forced = args.premise is not None
    if args.premise is None:
        args.premise = cfg["premises"][0]
    problem = apply_preferences(cfg, {"styles": args.style, "settings": args.setting,
                                      "premises": args.premise})
    if problem:
        print(problem, file=sys.stderr)
        return 2
    # Compositions written for one headcount (`cast`) leave the rotation for any other. At three
    # every composition fits, so the rotation is the one it always was.
    COMPOSITIONS = [c for c in COMPOSITIONS if cast_fits(c, n_children)]

    # The tables are checked AFTER the household's allowlists are applied, so the invariants
    # protect the subset this household actually draws from. A refusal here is a configuration
    # error, never a verdict on a picture: exit 2 (errored), not 1 (the finder refused).
    try:
        check_tables(children=n_children, written=written_mode)
        check_settings_cover_the_year()
    except SystemExit as err:
        print(err, file=sys.stderr)
        limited = [k for k in ("styles", "settings", "premises") if cfg.get(k) is not None]
        if limited:
            print(f"(checked against the household's allowlists: scenes.{', scenes.'.join(limited)} "
                  f"in {household_config.config_path()})", file=sys.stderr)
        return 2
    # A RUN, not just a week (2026-10-18): Sunday's is `2026-W43`, Wednesday's `2026-W43b`. The
    # Monday is still the seed's date, so a retry inside a run never buys a different picture,
    # and a Sunday belongs to the week AHEAD (scene_context.run_for_today).
    try:
        monday, part = (scene_context.parse_run(args.week) if args.week
                        else scene_context.run_for_today())
    except ValueError:
        print(f"--week {args.week!r}: expected e.g. 2026-W43 or 2026-W43b", file=sys.stderr)
        return 2
    week = iso_week(monday)
    run_id = scene_context.run_name(monday, part)
    # THIS RUN'S WEEK. Frozen on first use so a re-run says the same words (the seed already makes
    # the rest of the prompt repeat). Each source that failed says so and the picture does
    # without it; none of them is a reason to have no picture. Read BEFORE the setting is
    # chosen, because the director reads it.
    ctx, context_path = None, None
    if not args.no_context:
        ctx, context_path = scene_context.context_for(monday, part=part)
    try:
        guests = scene_guests.present(scene_guests.load(), ctx.get("visitors") if ctx else None)
    except SystemExit as err:
        print(err, file=sys.stderr)
        return 2
    # THE WALL, before anything is chosen: the rotation steps past the settings it showed last
    # (docs/scene-variety-plan.md F), the director is told them, and the style settle reads it.
    # This run's OWN pictures are left out of "recent", or a retry would step past itself.
    try:
        wall_rows = scene_memory.wall_scenes()
    except (RuntimeError, OSError, subprocess.TimeoutExpired, ValueError) as err:
        wall_rows = None
        wall_error = err
    run_prefix = run_id.lower().replace("-", "") + "-"
    prior_rows = [r for r in wall_rows or [] if not r["id"].startswith(run_prefix)]
    recent = scene_memory.recent_settings(prior_rows, [s["id"] for s in SETTINGS])

    # TWO DIFFERENT PICTURES A RUN (2026-10-28). The pair used to be one brief drawn by two
    # models — a comparison, settled 2026-09-12 — and the household reported "the same picture
    # twice". Now each candidate is its own brief: its own place, style, seed, activities and
    # dog, and ONE model each. Only on fal with the default two candidates; a person's
    # --setting is still a deliberate comparison pair, and a run frozen with one decision
    # before this keeps the shape it was drawn in.
    pair = args.provider == "fal" and args.candidates == 2 and args.setting is None

    def rotation(first: dict | None = None) -> tuple[dict, dict, dict] | None:
        """The week-number rotation, stepping past the wall's recent settings and, for the
        second picture, the first one's. None when there is no second setting in season."""
        if first is None:
            return choose(monday, args.setting, args.style, args.camera, avoid=recent)
        if not [s for s in SETTINGS if monday.month in s["season"] and s["id"] != first["id"]]:
            return None
        got = choose(monday, None, args.style, args.camera, avoid=recent, exclude=[first["id"]])
        return got

    # Each brief: (style, setting, camera, the director's decision or None, a note).
    briefs: list[tuple[dict, dict, dict, dict | None, str]] = []
    style, setting, composition = rotation()
    setting_note = "forced by --setting" if args.setting else ""

    # THE DIRECTOR. A person's --setting is a choice already made; otherwise a text model reads
    # the run and chooses, unless the household asked for the rotation. Its answer is frozen per
    # run, so a retry is the same picture. A forced --style, --camera or --premise still wins.
    director, director_called = None, False
    use_director = (args.setting is None and not args.no_director
                    and cfg.get("director", "ai") == "ai")
    if use_director:
        director = scene_director.load_frozen(scene_director.path_for(run_id))
        if director is not None:
            pass
        elif args.dry_run and not args.ask_director:
            setting_note = "rotation's pick for now; the director chooses at run time (--ask-director)"
        else:
            director_called = True
            director = ask_director(run_id, ctx, guests, cfg, monday, prior_rows,
                                    written_mode, n_children, freeze=not args.dry_run,
                                    pictures=2 if pair else 1)
            if director is None:
                setting_note = "rotation (the director gave no usable answer)"
    if director is not None:
        decided = scene_director.decisions(director)
        pair = pair and len(decided) == 2
        for d in decided[:2 if pair else 1]:
            st = (style if args.style is not None else
                  next((x for x in STYLES if x["id"] == d["style"]), style))
            cam = (composition if args.camera is not None else
                   next((c for c in COMPOSITIONS if c["id"] == d["camera"]), composition))
            briefs.append((st, d["setting"], cam, d, "director: " + d["why"]))
    else:
        briefs.append((style, setting, composition, None, setting_note))
        second = rotation(setting) if pair else None
        if second is None:
            pair = False
        else:
            st2, set2, cam2 = second
            if args.camera is None and cam2["id"] == composition["id"] and len(COMPOSITIONS) > 1:
                cam2 = COMPOSITIONS[(COMPOSITIONS.index(cam2) + 1) % len(COMPOSITIONS)]
            briefs.append((st2, set2, cam2, None, "rotation's second picture: the next "
                           "setting in season, not the first and not recently on the wall"))

    dog_moods = scene_dog.load()
    season = scene_activities.SEASON_OF_MONTH[monday.month]
    week_lines = [ln for ln in ((ctx["weather_line"], ctx["props_line"], *ctx["hints"])
                                if context_path else ()) if ln]

    def plan(i: int, style: dict, setting: dict, composition: dict, decision: dict | None,
             setting_note: str, other_style: str | None) -> dict | int:
        """Everything one picture needs, printed as it is decided. An int is an exit code."""
        premise_id = args.premise
        if decision is not None and not premise_forced and any(
                p["id"] == decision["premise"] for p in PREMISES):
            premise_id = decision["premise"]
        premise = next(p for p in PREMISES if p["id"] == premise_id)
        # A premise that names its camera or is not drawn in this week's style family is settled
        # here, in the plan, rather than as a refusal after the key has been read.
        if premise.get("camera"):
            composition = next(c for c in ALL_COMPOSITIONS if c["id"] == premise["camera"])
        for kind, entry in (("premise", premise), ("camera", composition)):
            if not cast_fits(entry, n_children):
                print(f"{kind} {entry['id']!r} is written for a cast of {entry['cast']}, and this "
                      f"cast has {n_children}", file=sys.stderr)
                return 2
        if style.get("family", "illustration") not in premise["families"]:
            allowed = [s for s in STYLES if s.get("family", "illustration") in premise["families"]]
            _, wk, _ = monday.isocalendar()
            at = (SETTINGS.index(setting) if setting in SETTINGS
                  else zlib.crc32(setting["id"].encode()))
            style = allowed[(wk + at) % len(allowed)]
        scene_id = f"{run_id.lower().replace('-', '')}-{setting['id']}"
        if premise_id != "plain":
            scene_id += f"-{premise_id}"
        # A FORCED STYLE IS PART OF THE NAME. Without this, drawing the same place twice in one
        # week — the whole reason --style exists beside --setting — builds the same id twice and
        # the second run silently overwrites the first candidate's files in the volume. The id
        # carries every axis a person pinned by hand; the ones the WEEK chose stay out of it,
        # because the week already varies them.
        if args.style is not None:
            scene_id += f"-{args.style}"
        if args.camera is not None:
            scene_id += f"-{args.camera}"

        # NOT THE STYLE THE WALL JUST SHOWED. The rotation above is arithmetic on the week number
        # and cannot see the wall, so two pictures in a row came out claymation (2026-10-04). The
        # wall has always recorded every picture's style; scene_memory reads it and steps past the
        # recent ones — and past the style this run already gave its other picture. A person's
        # --style is never second-guessed.
        style_note = "forced by --style"
        if args.style is None:
            pool = [s for s in STYLES if s.get("family", "illustration") in premise["families"]]
            if wall_rows is None:
                style_note = f"COULD NOT READ THE WALL ({wall_error}) — rotation's pick, may repeat"
            else:
                mine = [r for r in wall_rows if not r["id"].startswith(run_prefix)
                        or scene_memory.belongs(r["id"], scene_id, set(SHORT.values()))]
                style, style_note = scene_memory.settle(
                    style, pool, mine, scene_id, set(SHORT.values()),
                    extra_avoid=[other_style] if other_style else ())
                if decision is not None:
                    style_note = "director's choice; " + style_note

        # Decided here, in the plan, rather than down in the generate path: `--dry-run` exists to
        # show for free exactly what a paid run would draw, and the one thing on this page most
        # worth reading before spending is which book moment it is about to put on the wall.
        seed = monday.toordinal() ^ zlib.crc32(scene_id.encode())
        # An explicitly requested moment wins over the story table: a person who typed what
        # they want has already made the choice the table exists to make.
        moment = args.moment or scene_story.pick(setting, random.Random(seed))
        # WHAT THE DOG IS UP TO (2026-10-18): "not just hiding in every picture... playing on his
        # own, or doing something funny." The director's choice wins; a decision frozen before
        # the director could choose has no `dog` key and means hiding, so a retry of an earlier
        # run draws the prompt it already paid for. Otherwise a seeded draw from the moods that
        # fit the setting's places — salted, so the dog's draw does not move the moment's.
        if decision is not None and "dog" not in decision:
            dog_mood = scene_dog.by_id(dog_moods, scene_dog.HIDING)    # frozen before the choice
        elif decision is not None and scene_dog.by_id(dog_moods, decision["dog"]):
            dog_mood = scene_dog.by_id(dog_moods, decision["dog"])
        else:
            dog_mood = scene_dog.draw(dog_moods, setting.get("tags", []),
                                      random.Random(seed ^ zlib.crc32(b"dog")), season)
        dog_doing = scene_dog.doing(dog_mood)

        if len(briefs) > 1:
            print(f"\npicture : {i + 1} of {len(briefs)}")
        print(f"id      : {scene_id}")
        print(f"style   : {style['id']}  ({style_note})")
        print(f"setting : {setting['id']}"
              + ("  (invented by the director)" if setting.get("invented") else ""))
        if setting_note:
            print(f"          {setting_note}")
        print(f"camera  : {composition['id']}")
        print(f"premise : {premise_id}")
        if moment:
            story = setting.get("story")
            print(f"moment  : {moment}")
            if story and not args.moment:
                print(f"          (read_through {story['read_through']}; "
                      f"{len(scene_story.eligible(setting))} of {len(story['moments'])} in range)")
        print(f"dog     : {dog_mood['id']}" + (f"  ({dog_doing})" if dog_doing else ""))

        # WHAT THEY ARE DOING. A story moment and a premise's own list win, as they do in
        # gen-scene; otherwise `scenes.activities` says whether a text model writes a set for this
        # scene or the table deals one. A written set is frozen under the BASE id, so a re-run
        # never calls the writer again (and a comparison pair draws the same activities).
        activities_path = scene_activity_writer.path_for(scene_id)
        uses_writer = written_mode and not moment and not premise.get("activities")
        frozen = scene_activity_writer.load_frozen(activities_path) if uses_writer else None
        if moment:
            activities_from = "none: the story moment is what they are doing"
        elif premise.get("activities"):
            activities_from = "the premise's own list"
        elif not written_mode:
            activities_from = "table (picked at draw time; scenes.activities is table)"
        elif frozen is None:
            activities_from = "written at draw time"
        elif frozen.get("source") == "written":
            activities_from = f"written, frozen in {activities_path}"
        else:
            activities_from = f"table (the writer was refused twice; frozen in {activities_path})"
        print(f"activities: {activities_from}")
        if frozen and frozen.get("source") == "written":
            for line in scene_activity_writer.phrase(frozen, n_children).splitlines():
                print(f"          {line.strip()}")
        return {"id": scene_id, "style": style, "setting": setting, "composition": composition,
                "premise": premise, "premise_id": premise_id, "seed": seed, "moment": moment,
                "dog_doing": dog_doing, "uses_writer": uses_writer, "frozen": frozen,
                "activities_path": activities_path, "activities_from": activities_from}

    print(f"run     : {run_id}  ({ctx['from']}..{ctx['to']})" if ctx and ctx.get("from")
          else f"run     : {run_id}")
    print(f"context : {context_path.relative_to(HERE.parent) if context_path else 'none'}")
    if context_path:
        for note in ctx["notes"]:
            print(f"          {note}")
    print("guests  : " + (", ".join(g["id"] for g in guests) if guests else "none"))
    plans: list[dict] = []
    for i, (st, se, cam, dec, note) in enumerate(briefs):
        got = plan(i, st, se, cam, dec, note, plans[0]["style"]["id"] if plans else None)
        if isinstance(got, int):
            return got
        plans.append(got)

    print()
    if len(plans) == 2:
        # ONE MODEL EACH: each picture's family default, and when both families want the same
        # model the run's parity says which picture keeps it, so neither model always draws
        # "the week's answer".
        models = pair_models([p["style"] for p in plans], parity=1 if part == "b" else 0)
        planned = [(f"{p['id']}-{SHORT.get(m, m.split('/')[-2])}", m, p)
                   for p, m in zip(plans, models)]
    else:
        planned = [(cid, m, plans[0]) for cid, m in
                   candidates(plans[0]["id"], plans[0]["style"], args.provider, args.candidates)]
    for cid, model, _ in planned:
        print(f"candidate: {cid}" + (f"  ({model})" if model else ""))
    # The writer is paid only when it will actually run: written mode, no story moment or premise
    # list, and nothing frozen yet under the base id (a refused-twice table fallback is frozen too).
    text_calls = sum(1 for p in plans if p["uses_writer"] and p["frozen"] is None)
    # The director's call, when it is still to come (a dry run that did not ask). A call already
    # made this run is in the ledger, so the budget line counts it as spent, not as projected.
    director_calls = 1 if use_director and director is None and not director_called else 0
    budget_line, over_budget = budget(cfg, args.provider, [m for _, m, _ in planned], text_calls,
                                      director_calls)
    print(f"budget  : {budget_line}")
    if over_budget:
        print("over the weekly budget (scenes.weeklyBudgetUsd): nothing generated. The wall "
              "keeps the picture it has.", file=sys.stderr)
        return 3
    if args.dry_run:
        for p in plans:
            if len(plans) > 1:
                print(f"\n=== {p['id']}")
            print("\n--- setting ---\n" + p["setting"]["setting"])
            print("\n--- camera ---\n" + fill_children(p["composition"]["camera"], n_children))
            print("\n--- crowd ---\n" + p["setting"]["crowd"])
            if p["premise"].get("brief"):
                print("\n--- premise ---\n" + fill_children(p["premise"]["brief"], n_children))
        if guests:
            print("\n--- visiting family ---\n" + scene_guests.prompt_section(guests, load_cast()))
        if context_path:
            print("\n--- this week ---")
            for line in (ctx["weather_line"], ctx["props_line"], *ctx["hints"]):
                if line:
                    print(line)
        print("\ndry run: nothing generated, nothing registered, nothing spent.")
        return 0
    if args.write_activities:
        if not written_mode:
            print("scenes.activities is table: there is nothing to write", file=sys.stderr)
            return 2
        if not os.environ.get("FAL_KEY"):
            print("FAL_KEY is not set (tools/op.env.example shows the 1Password form)",
                  file=sys.stderr)
            return 2
        worst = 0
        for p in plans:
            if not p["uses_writer"]:
                print(f"{p['id']}: activities come from {p['activities_from']}; nothing to write")
                continue
            got = scene_activity_writer.written_set(
                p["id"], setting=p["setting"], season=season, week_lines=week_lines,
                n=n_children, seed=p["seed"], premise=p["premise"], camera=p["composition"])
            print(json.dumps(got, indent=2, ensure_ascii=False))
            if got.get("source") == "written":
                print("\n" + scene_activity_writer.phrase(got, n_children))
            else:
                # Refused twice is a verdict (frozen, exit 1); unreachable is an error (exit 2).
                worst = max(worst, 1 if p["activities_path"].exists() else 2)
        return worst

    # The API keys, from the environment. Checked here rather than in each child process so a
    # missing one fails before anything is generated, instead of after the image has been paid
    # for. The timer supplies them with `op run --env-file=tools/op.env`.
    env = dict(os.environ)
    for var in NEEDED_KEYS[args.provider]:
        if not env.get(var):
            print(f"{var} is not set (tools/op.env.example shows the 1Password form)",
                  file=sys.stderr)
            return 2

    out = pathlib.Path(os.environ.get("SCENE_OUT_DIR", "/tmp")) / "scene-week"
    out.mkdir(parents=True, exist_ok=True)
    for p in plans:
        # Who is visiting, for gen-scene and the finder. Written every run (it is a function of
        # the frozen brief), and absent when nobody is, so the prompt is byte-identical to before.
        p["guests_file"] = None
        if guests:
            p["guests_file"] = out / f"{p['id']}.guests.json"
            p["guests_file"].write_text(json.dumps(guests, indent=2) + "\n", encoding="utf-8")
        # Written once per brief, before its candidate(s). A writer that could not be reached, or
        # was refused twice, means the table deals the activities, as it always did.
        p["activities_file"] = None
        if p["uses_writer"]:
            got = scene_activity_writer.written_set(
                p["id"], setting=p["setting"], season=season, week_lines=week_lines,
                n=n_children, seed=p["seed"], premise=p["premise"], camera=p["composition"])
            if got.get("source") == "written":
                p["activities_file"] = p["activities_path"]

    offered, refused, errored = [], [], []
    # THE SEED IS THE RUN AND THE SCENE, not the week alone. (Computed in the plan above, so
    # --dry-run reports the same draw a paid run would make.)
    #
    # It was `monday.toordinal()` for the idempotence the weekly timer needs: a Tuesday re-run
    # must not buy a different picture from Monday's. True, and it quietly assumed there is only
    # ever ONE picture a week. The moment `--setting` let a person draw several, every one of
    # them seeded the same RNG and drew the same activity out of it — reported 2026-09-16 as
    # "they're carrying a basket in every image", and they were: two settings got the basket and
    # the third got the ball, from three runs on one seed.
    #
    # Mixing the BASE id in keeps both properties. Same week and same scene still means the same
    # seed and so the same picture on a re-run; a different setting, style or premise is a
    # different scene and gets its own draw. crc32 rather than hash(): `hash()` on a str is
    # salted per process, so the "idempotent" half would have been random across runs.
    #
    # Two candidates of ONE brief (a person's --setting, or a run frozen before 2026-10-28) still
    # share the seed and the activities: two models drawing the same brief is a comparison. The
    # household chose variety over comparison for the timer's pair, which is why it has two
    # briefs and therefore two seeds.
    for scene_id, model, p in planned:
        verdict = offer(scene_id, model, p["style"], p["setting"], p["composition"], monday, out,
                        env, args, premise_id=p["premise_id"], context_path=context_path,
                        seed=p["seed"], moment=p["moment"] or "",
                        activities_file=p["activities_file"], guests_file=p["guests_file"],
                        dog_doing=p["dog_doing"])
        {"offered": offered, "refused": refused, "errored": errored}[verdict].append(scene_id)

    print()
    if offered:
        print(
            f"{', '.join(offered)}: waiting as CANDIDATE{'S' if len(offered) > 1 else ''}.\n"
            "Not on the wall, and will not go up on their own. Open the grown-up screen on the\n"
            "panel, look at them there — a background cannot honestly be judged anywhere else —\n"
            "and approve the one you want up."
        )
    if refused:
        print(
            f"{', '.join(refused)}: REFUSED by the region finder, so not offered. That is the\n"
            "gate working — on the scene screen the picture IS the navigation. The images are\n"
            f"kept in {out}; delete one and re-run to buy another.",
            file=sys.stderr,
        )
    if errored:
        print(
            f"{', '.join(errored)}: ERRORED — not judged, never got an answer. Re-running costs\n"
            "nothing but the vision pass; the images are kept.",
            file=sys.stderr,
        )
    if not offered:
        print("The wall keeps the picture it has.", file=sys.stderr)
    if errored:
        return 2
    if offered or args.keep_going:
        return 0
    return 1


# Short names for the candidate ids, so `2026w37-campsite-gpt` and `2026w37-campsite-nb2` sit
# beside each other on the review screen and in the ledger.
SHORT = {
    "openai/gpt-image-2/edit": "gpt",
    "fal-ai/nano-banana-2/edit": "nb2",
    "fal-ai/nano-banana-pro/edit": "nbpro",
    "fal-ai/flux-2-pro/edit": "flux",
}


def candidates(base_id: str, style: dict, provider: str, count: int) -> list[tuple[str, str | None]]:
    """(scene id, model) per candidate. On fal the models are the allowed ones for the style's
    family in the order gen-scene.py prefers them, the style's own default first; on the other
    providers there is one model and the id is the plain one."""
    if provider != "fal":
        return [(base_id, None)]
    sys.path.insert(0, str(HERE))
    import fal_api  # noqa: E402  (a sibling module; imported here so --dry-run needs no key)
    ordered = fal_api.allowed_for(style.get("family", "illustration"))
    if style.get("model"):
        ordered = [style["model"]] + [m for m in ordered if m != style["model"]]
    chosen = ordered[:max(1, count)]
    if count == 1:
        return [(base_id, chosen[0])]
    return [(f"{base_id}-{SHORT.get(m, m.split('/')[-2])}", m) for m in chosen]


def pair_models(styles: list[dict], parity: int) -> list[str]:
    """One fal model for each of a run's two pictures: each style's own default. When both want
    the same model, the picture at index `parity` keeps it and the other takes its next allowed
    one, so the two candidates are still two models and neither always draws the first brief."""
    sys.path.insert(0, str(HERE))
    import fal_api  # noqa: E402  (a sibling module; imported here so --dry-run needs no key)
    orders = []
    for st in styles:
        ordered = fal_api.allowed_for(st.get("family", "illustration"))
        if st.get("model"):
            ordered = [st["model"]] + [m for m in ordered if m != st["model"]]
        orders.append(ordered)
    first = [o[0] for o in orders]
    if first[0] != first[1]:
        return first
    other = 1 - parity
    out = list(first)
    out[other] = next((m for m in orders[other] if m != first[parity]), first[parity])
    return out


def offer(scene_id: str, model: str | None, style: dict, setting: dict, composition: dict,
          monday: dt.date, out: pathlib.Path, env: dict, args, seed: int = 0, moment: str = "",
          premise_id: str = "plain", context_path: pathlib.Path | None = None,
          activities_file: pathlib.Path | None = None,
          guests_file: pathlib.Path | None = None, dog_doing: str = "") -> str:
    """Generate one candidate, find its children, copy it in and register it.
    Returns "offered", "refused" or "errored"."""
    jpg, manifest = out / f"{scene_id}.jpg", out / f"{scene_id}.json"
    print(f"\n=== {scene_id}" + (f"  ({model})" if model else ""))

    # An image already generated for this week is REUSED rather than paid for again — but only
    # when it was drawn from THIS prompt. gen-scene.py decides that (`--reuse-if-same`), from a
    # digest of the prompt, model, seed and avatar bytes stamped next to the image.
    #
    # The two halves of this pipeline fail for different reasons and at different prices. The
    # image is the expensive half and generally succeeds; the vision pass that finds the
    # children is cents and is the flaky one — it returned a 502 on the first live run. Without
    # reuse, "run it again" meant buying a second identical picture to give the cheap half
    # another go. Until 2026-10-04 the test was only "does the file exist", so a re-run after a
    # PROMPT change silently re-registered the old picture; a changed prompt now draws anew and
    # the old image is set aside beside it.

    # The activity filter's two inputs. gen-scene.py had `--season` and `--tags` from the
    # start and nothing ever passed them, so every activity fit every week: a sledge on
    # green hills, 2026-09-13. The signature bug again — an input with no caller.
    season = scene_activities.SEASON_OF_MONTH[monday.month]
    cmd = [sys.executable, str(HERE / "gen-scene.py"), "--style", style["id"],
           "--composition", composition["id"], "--season", season,
           "--tags", ",".join(setting.get("tags", [])),
           *(["--wardrobe", setting["wardrobe"]] if setting.get("wardrobe") else []),
           *(["--swimwear"] if setting.get("swimwear") else []),
           *(["--moment", moment] if moment else []),
           *(["--activities-file", str(activities_file)] if activities_file else []),
           *(["--guests-file", str(guests_file)] if guests_file else []),
           *(["--dog-doing", dog_doing] if dog_doing else []),
           "--provider", args.provider, "--seed", str(seed), "--reuse-if-same"]
    if model:
        cmd += ["--model", model]
    if premise_id != "plain":
        cmd += ["--premise", premise_id]
    if context_path:
        cmd += ["--context", str(context_path)]
    cmd += [setting["setting"], setting["crowd"], str(jpg)]
    step = run(cmd, env=env)
    if step.returncode != 0:
        print("generation failed.", file=sys.stderr)
        return "errored"

    # The gate. It refuses on a child under the tap floor, under the height floor, inside the
    # inert gutter, facing the wrong way, not fully clothed, or matched to the wrong portrait —
    # and a refusal here is a SUCCESSFUL week, because the alternative is a dead-end screen.
    finder_provider = "nous" if args.provider == "nous" else "fal"
    step = run(
        [sys.executable, str(HERE / "scene-regions.py"), "--provider", finder_provider,
         *(["--flat-scale"] if PREMISE_BY_ID.get(premise_id, {}).get("flat_scale") else []),
         *(["--swimwear"] if setting.get("swimwear") else []),
         *(["--guests-file", str(guests_file)] if guests_file else []),
         *(["--dog-doing", dog_doing] if dog_doing else []),
         scene_id, str(jpg), str(manifest)],
        env=env,
    )
    # A REFUSAL and a CRASH are different events and must not print the same sentence.
    #
    # They did, on the first live run: a 502 from the vision endpoint was announced as "the gate
    # working: the region finder refused this picture". Nothing had been judged. The two need
    # opposite responses — a refusal means this picture is wrong and next week's will differ, an
    # error means try the SAME picture again — so reporting one as the other sends you the wrong
    # way and, worse, quietly credits a broken subsystem as a working safety check.
    if step.returncode == REFUSED:
        return "refused"
    if step.returncode != 0:
        return "errored"

    # Into the volume, then registered. In that order: a row for a file that has not arrived is
    # a candidate that silently does nothing when approved, which reads as "approving is broken".
    for src in (jpg, manifest):
        step = run(["docker", "cp", str(src), f"{CONTAINER}:{VOLUME_SCENES}/{src.name}"])
        if step.returncode != 0:
            print(f"could not copy {src.name} into the wall's volume", file=sys.stderr)
            return "errored"

    step = run([
        "docker", "exec", CONTAINER,
        "node", "--experimental-strip-types", "stacks/wall/entry/provision.ts",
        "--db", "/data/wall.db", "--add-scene", scene_id, "--style", style["id"],
    ])
    if step.returncode != 0:
        print("could not register the scene", file=sys.stderr)
        return "errored"

    # ASK THE DATABASE, rather than believing the exit code.
    #
    # On the first live run this step returned 0 and registered nothing: the container was built
    # before `--add-scene` existed, provision.ts ignored the unknown flag, printed a device list
    # and exited clean. provision.ts now refuses unknown flags, which closes that particular
    # hole — but the general shape is this project's most expensive failure mode (a dead calendar
    # sync behind a wall that looked fine; a picture that could not update behind a deploy that
    # said nothing), and the general defence is to check the POST-CONDITION rather than the
    # return code. A weekly job nobody watches has to prove it did the thing.
    check = run(
        ["docker", "exec", CONTAINER, "node", "--experimental-strip-types",
         "stacks/wall/entry/provision.ts", "--db", "/data/wall.db", "--scenes"],
        capture_output=True, text=True,
    )
    if check.returncode != 0 or scene_id not in check.stdout:
        print(
            f"\nregistration reported success but {scene_id} is NOT in the catalog.\n"
            "The most likely cause is a container older than this script — rebuild it:\n"
            "  cd stacks/wall && op run --env-file=op.env -- docker compose up -d --build",
            file=sys.stderr,
        )
        if check.stdout:
            print(check.stdout, file=sys.stderr)
        return "errored"
    return "offered"


if __name__ == "__main__":
    sys.exit(main())
