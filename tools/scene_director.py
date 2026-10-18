#!/usr/bin/env python3
"""THE SCENE DIRECTOR — a text model reads the coming week and chooses the picture.

    python3 tools/scene_director.py --selftest      # the guardrails, driven offline

Until 2026-10-18 the week chose its picture by arithmetic: setting = week mod the in-season
list, style and camera offset from it. That repeats itself on purpose and it cannot see
anything. A book fair on the calendar drew a forest unless a person typed `--setting`; a
headline table (tools/scene-headlines.json, now deleted) matched "ski" and "birthday" to fixed
settings, and the household's verdict on it was that a list of keywords is not judgement: a
ski trip need not be a snowy hill, and those were only ever examples.

So scene-week asks a text model ONCE per run (~$0.002) with the run's brief — weather,
holidays, calendar, `scene:` notes, who is visiting — and the household's allowed catalog,
and it answers with a setting (or a new one it describes), a style, a camera and a premise.

WHAT IS RANDOM AND WHAT IS NOT. The CHOICE is meant to vary: a quiet week gets a shortlist
drawn with `random.SystemRandom`, so two quiet weeks do not land on the same place. The
PICTURE, once chosen, is not: the decision is frozen to db/scene-director/<run>.json, and a
retry at 03:00 or on Monday reads the file, so "try again" never becomes "try something else".
The seed, the prompt digest and `--reuse-if-same` downstream are unchanged.

WHAT IT MAY NOT DO, and every one of these is code, not a sentence in the request:
  - choose an id the household did not allow, a swimwear setting (an adult's choice only,
    CLAUDE.md), or a style the wall showed in its last three pictures;
  - describe a new setting containing a person's name, a quote, written words of any kind
    (signs, banners, lettering — a scene rule describes what SHOULD be there, and every noun
    may get drawn), a photograph, or a place tag outside the closed vocabulary;
  - send its request at all when prompt_guard finds a likeness, or a roster name while the
    household has not set `scenes.shareTitles` (titles are opt-in; counts are the default).
An answer that breaks a rule is refused with the reasons quoted back, once. A second refusal,
or a model that cannot be reached, falls back to the rotation, which is what ran before this
existed — the fallback is a worse picture, never no picture.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import pathlib
import random
import re
import sys
from typing import Callable

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

import prompt_guard  # noqa: E402

PROMPT_VERSION = 1
MODEL = "google/gemini-2.5-flash"
RECENT_SETTINGS = 6
SHORTLIST = 3
ID_RE = re.compile(r"^[a-z][a-z0-9-]{2,32}$")

SYSTEM = ("You are the art director for a picture that hangs on a family's kitchen wall for a "
          "few days. Three young children find themselves in it and tap themselves, so it must "
          "be a clear, happy scene. You answer with one JSON object and nothing else.")

# Never in a setting the director writes. Lettering because a model draws it badly and a child
# cannot read it; a photograph because the household removed photoreal (CLAUDE.md, 2026-09-18);
# swimwear because it is forced-only. Whole words, case-insensitive.
FORBIDDEN = re.compile(
    r"\b(?:signs?|signage|banners?|labels?|lettering|letters|words?|writing|written|text|"
    r"posters?|captions?|logos?|brand(?:ed|s)?|titles?|happy birthday|named?|"
    r"photo(?:graph)?s?|photoreal(?:istic)?|realistic|"
    r"swim(?:ming|suits?|wear)?|bikinis?|trunks)\b", re.IGNORECASE)


def directory() -> pathlib.Path:
    # SCENE_DIRECTOR_DIR lets a test keep the household's frozen decisions out of its run.
    env = os.environ.get("SCENE_DIRECTOR_DIR")
    return pathlib.Path(env) if env else ROOT / "db" / "scene-director"


def path_for(run: str, where: pathlib.Path | None = None) -> pathlib.Path:
    return (where or directory()) / f"{run}.json"


def load_frozen(path: pathlib.Path) -> dict | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _freeze(path: pathlib.Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)


def recent_settings(rows: list[dict], known: list[str], limit: int = RECENT_SETTINGS) -> list[str]:
    """The settings of the wall's most recent pictures, newest first, from their ids
    (`2026w43b-big-library-gpt` → big-library). Longest catalog id that the remainder starts
    with; an invented setting is whatever is left after the model suffix."""
    out: list[str] = []
    for row in rows:
        rest = re.sub(r"^\d{4}w\d{2}b?-", "", row.get("id", ""))
        hit = max((k for k in known if rest == k or rest.startswith(k + "-")), key=len, default=None)
        name = hit or re.sub(r"-(?:gpt|nb2|nbpro|flux)$", "", rest)
        if name and name not in out:
            out.append(name)
        if len(out) == limit:
            break
    return out


def _day(iso: str) -> str:
    d = dt.date.fromisoformat(iso)
    return d.strftime("%a %d %b").replace(" 0", " ")


def brief_lines(ctx: dict | None, guests: list[dict], cast: dict | None,
                share_titles: bool) -> list[str]:
    """The week as the director reads it. Titles and visitor descriptions only when shared."""
    if not ctx:
        return ["Nothing is known about this week (no calendar, no weather)."]
    lines = [f"The picture is up from {_day(ctx['from'])} to {_day(ctx['to'])}."
             if ctx.get("from") else f"The week of {ctx.get('monday')}."]
    if ctx.get("weather_line"):
        lines.append("Weather: " + ctx["weather_line"])
    for h in ctx.get("holidays") or []:
        lines.append("Holiday: " + h)
    if share_titles and ctx.get("titles"):
        evs = ctx.get("events") or []
        if evs:
            lines.append("On the family calendar (one-off events; weekly lessons and clubs are left out):")
            for e in evs:
                when = _day(e["from"]) + (f" to {_day(e['to'])}" if e["to"] != e["from"] else "")
                lines.append(f"  - {when}{' (all day)' if e.get('all_day') else ''}: {e['title']}")
        else:
            lines.append("Nothing out of the ordinary is on the family calendar.")
    elif ctx.get("calendar"):
        counts = ", ".join(f"{n} {k}" for k, n in sorted(ctx["calendar"].items()))
        lines.append(f"The calendar has (by kind, titles not shared): {counts}.")
    for h in ctx.get("hints") or []:
        lines.append(f"The family asked for: {h}")
    if guests:
        if share_titles and cast:
            import scene_guests
            lines.append("Visiting family who will be in the picture with the children:")
            lines += [scene_guests.guest_line(g, cast) for g in guests]
        else:
            adults = sum(g["sex"] in ("man", "woman") for g in guests)
            lines.append(f"Visiting family will be in the picture: {adults} grown-up(s) and "
                         f"{len(guests) - adults} child(ren).")
    return lines


def build_request(*, brief: list[str], settings: list[dict], styles: list[dict],
                  compositions: list[dict], premises: list[dict], places: dict,
                  recent_settings_: list[str], recent_styles: list[str], shortlist: list[str],
                  month: int, reasons: list[str]) -> str:
    def short(text: str, n: int = 150) -> str:
        text = " ".join(text.split())
        return text if len(text) <= n else text[:n - 1].rsplit(" ", 1)[0] + "…"
    rows = []
    for s in settings:
        when = ("in season" if month in s.get("season", []) else
                "for an occasion" if not s.get("season") else "out of season")
        rows.append(f"  {s['id']} ({when}): {short(s['setting'])}")
    parts = [
        "Choose this week's picture.",
        "",
        "THE WEEK",
        *brief,
        "",
        "SETTINGS YOU MAY CHOOSE (id, then a short description):",
        *rows,
        "",
        f"Recently on the wall, newest first — do not repeat these: {', '.join(recent_settings_) or 'none'}.",
        f"If nothing in the week calls for a particular place, choose one of these (drawn at random): {', '.join(shortlist)}.",
        "",
        "STYLES: " + "; ".join(f"{s['id']} ({s.get('label', s['id'])})" for s in styles
                                if s["id"] not in recent_styles),
        "CAMERAS: " + "; ".join(f"{c['id']} ({c.get('label', c['id'])})" for c in compositions),
        "PREMISES: " + "; ".join(f"{p['id']} ({p.get('label', p['id'])})" for p in premises),
        "",
        "HOW TO CHOOSE",
        "- A notable event this week (a fair, a trip, a party, a holiday, visiting family) should "
        "shape the picture. Theme it on the event's KIND of place or activity, not on the literal "
        "event: a ski trip can be a ski mountain, a birthday is a party.",
        "- Prefer a listed setting. Only if none can hold this week's theme, describe a NEW one in "
        "`new_setting`.",
        "- A new setting describes a real-looking place a child would love, in plain words: what is "
        "there, the light, the time of day. No person's name, no film, book, brand or character "
        "name, and no written words of any kind — no signs, banners, labels, posters or lettering. "
        "Not a swimming scene. `setting` 15 to 60 words; `crowd` 10 to 40 words listing the OTHER "
        "people, animals and objects around; `tags` 1 to 3 of: " + ", ".join(
            k for k in places if k != "pool") + "; `wardrobe` optional, clothes only, under 25 words, "
        "every face fully visible (no hoods, masks or helmets).",
        "- Pick a style that suits the place and the season, a camera that suits the style, and "
        "premise `plain` unless another clearly fits.",
        "",
        "Answer exactly this JSON:",
        '{"setting": "<listed id, or null>", "new_setting": null or {"id": "<short-kebab-id>", '
        '"setting": "...", "crowd": "...", "tags": ["..."], "wardrobe": "... or omit"}, '
        '"style": "<id>", "camera": "<id>", "premise": "<id>", "why": "<one sentence>"}',
    ]
    if reasons:
        parts += ["", "Your previous answer was refused because:", *[f"- {r}" for r in reasons],
                  "Answer again, fixing exactly those."]
    return "\n".join(parts)


def parse_answer(raw: str):
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", (raw or "").strip())
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        got = json.loads(text[start:end + 1])
    except ValueError:
        return None
    return got if isinstance(got, dict) else None


def text_problems(label: str, text, *, lo: int, hi: int, names: list[str]) -> list[str]:
    if not isinstance(text, str) or not text.strip():
        return [f"new_setting.{label} is missing"]
    out = []
    words = len(text.split())
    if not lo <= words <= hi:
        out.append(f"new_setting.{label} is {words} words; it must be {lo} to {hi}")
    if any(q in text for q in '"“”'):
        out.append(f"new_setting.{label} contains a quotation; nothing in the picture may be written")
    bad = sorted({m.group(0).lower() for m in FORBIDDEN.finditer(text)})
    if bad:
        out.append(f"new_setting.{label} says {', '.join(repr(b) for b in bad)}; no written words, "
                   "photographs or swimming")
    for n in names:
        if re.search(rf"\b{re.escape(n)}\b", text, re.IGNORECASE):
            out.append(f"new_setting.{label} contains a person's name ({n!r})")
    guard = prompt_guard.check(text)
    out += [f"new_setting.{label}: {why}" for _, why in list(guard.findings) + list(guard.advisories)]
    return out


def problems(answer, *, settings: list[dict], styles: list[dict], compositions: list[dict],
             premises: list[dict], places: dict, recent_styles: list[str],
             names: list[str]) -> list[str]:
    if not isinstance(answer, dict):
        return ["the answer was not a JSON object"]
    out: list[str] = []
    ids = {s["id"] for s in settings}
    sid, new = answer.get("setting"), answer.get("new_setting")
    if bool(sid) == bool(new):
        out.append("give exactly one of `setting` (a listed id) or `new_setting`")
    elif sid:
        if sid not in ids:
            out.append(f"setting {sid!r} is not one of the listed ids")
    else:
        if not isinstance(new, dict):
            return out + ["new_setting must be an object"]
        nid = new.get("id")
        if not isinstance(nid, str) or not ID_RE.match(nid):
            out.append("new_setting.id must be 3 to 33 lowercase letters, digits and dashes")
        elif nid in ids:
            out.append(f"new_setting.id {nid!r} is already a listed setting; use `setting` instead")
        out += text_problems("setting", new.get("setting"), lo=15, hi=60, names=names)
        out += text_problems("crowd", new.get("crowd"), lo=10, hi=40, names=names)
        if new.get("wardrobe"):
            out += text_problems("wardrobe", new.get("wardrobe"), lo=3, hi=25, names=names)
            if re.search(r"\b(?:hoods?|masks?|helmets?|visors?|balaclavas?)\b", new["wardrobe"], re.I):
                out.append("new_setting.wardrobe covers a face; every face must be fully visible")
        tags = new.get("tags")
        allowed = set(places) - {"pool"}
        if (not isinstance(tags, list) or not 1 <= len(tags) <= 3
                or not all(isinstance(t, str) and t in allowed for t in tags)):
            out.append("new_setting.tags must be 1 to 3 of: " + ", ".join(sorted(allowed)))
    style_ids = {s["id"]: s for s in styles}
    st = answer.get("style")
    if st not in style_ids:
        out.append(f"style {st!r} is not one of the listed styles")
    elif st in recent_styles and len(recent_styles) < len(style_ids):
        out.append(f"style {st!r} was on the wall recently; choose another")
    if answer.get("camera") not in {c["id"] for c in compositions}:
        out.append(f"camera {answer.get('camera')!r} is not one of the listed cameras")
    prem = next((p for p in premises if p["id"] == answer.get("premise")), None)
    if prem is None:
        out.append(f"premise {answer.get('premise')!r} is not one of the listed premises")
    elif st in style_ids and style_ids[st].get("family", "illustration") not in prem["families"]:
        out.append(f"premise {prem['id']!r} cannot be drawn in style {st!r}")
    why = answer.get("why")
    if not isinstance(why, str) or not why.strip() or len(why) > 400:
        out.append("why must be one sentence")
    return out


def to_setting(answer: dict, settings: list[dict]) -> dict:
    """The setting entry the rest of the pipeline draws: a catalog row, or the invented one in
    the same shape (no season — it was chosen for this run — and marked as the director's)."""
    if answer.get("setting"):
        return next(s for s in settings if s["id"] == answer["setting"])
    new = answer["new_setting"]
    out = {"id": new["id"], "season": [], "setting": " ".join(new["setting"].split()),
           "crowd": " ".join(new["crowd"].split()), "tags": list(new["tags"]), "invented": True}
    if new.get("wardrobe"):
        out["wardrobe"] = " ".join(new["wardrobe"].split())
    return out


def fal_director(prompt: str, purpose: str) -> str:
    import fal_api  # noqa: E402  (imported here so the selftest and dry runs need no key)
    return fal_api.text(prompt, purpose, model=MODEL, system_prompt=SYSTEM)


def decide(run: str, *, ctx: dict | None, settings: list[dict], styles: list[dict],
           compositions: list[dict], premises: list[dict], places: dict, wall_rows: list[dict],
           recent_styles: list[str], guests: list[dict], cast: dict | None, share_titles: bool,
           month: int, names: list[str], ask: Callable[[str, str], str] | None = None,
           where: pathlib.Path | None = None, rng: random.Random | None = None,
           freeze: bool = True, extra_check: Callable[[dict], list[str]] | None = None,
           log=sys.stderr) -> dict | None:
    """The run's decision: {setting (a full entry), style, camera, premise, why, ...}, frozen on
    first success. None means "use the rotation" — the reason has been printed to `log`.

    `extra_check(setting)` is the caller's own refusal of a chosen setting (scene-week: an
    invented place the activity table cannot fill, when the table is what deals activities)."""
    path = path_for(run, where)
    frozen = load_frozen(path)
    if frozen is not None:
        return frozen
    # Swimwear stays an adult's `--setting`; nothing the director reads can choose it.
    pool = [s for s in settings if not s.get("swimwear")]
    if not pool:
        print("director: no setting it may choose; using the rotation", file=log)
        return None
    rng = rng or random.SystemRandom()
    recent = recent_settings(wall_rows, [s["id"] for s in settings])
    fresh_in_season = [s["id"] for s in pool if month in s.get("season", []) and s["id"] not in recent]
    candidates_ = fresh_in_season or [s["id"] for s in pool if s["id"] not in recent] or [s["id"] for s in pool]
    shortlist = rng.sample(candidates_, min(SHORTLIST, len(candidates_)))
    brief = brief_lines(ctx, guests, cast, share_titles)
    ask = ask or fal_director
    reasons: list[str] = []
    attempts = 0
    for attempt in range(2):
        request = build_request(brief=brief, settings=pool, styles=styles, compositions=compositions,
                                premises=premises, places=places, recent_settings_=recent,
                                recent_styles=recent_styles, shortlist=shortlist, month=month,
                                reasons=reasons)
        guard = prompt_guard.check(request)
        if guard.findings or (guard.advisories and not share_titles):
            why = "; ".join(w for _, w in list(guard.findings) + list(guard.advisories))
            print(f"director: the request failed prompt_guard ({why}); not sent — using the "
                  "rotation", file=log)
            return None
        attempts += 1
        try:
            raw = ask(request, f"scene director {run} (try {attempt + 1})")
        except (SystemExit, OSError, ValueError, KeyError) as err:
            print(f"director: could not be reached ({err}); using the rotation this run, and "
                  "asking again next run", file=log)
            return None
        answer = parse_answer(raw)
        reasons = (["the answer was not JSON"] if answer is None else
                   problems(answer, settings=pool, styles=styles, compositions=compositions,
                            premises=premises, places=places, recent_styles=recent_styles,
                            names=names))
        if not reasons and extra_check is not None:
            reasons = extra_check(to_setting(answer, pool))
        if not reasons:
            out = {"run": run, "source": "director", "setting": to_setting(answer, pool),
                   "style": answer["style"], "camera": answer["camera"],
                   "premise": answer["premise"], "why": " ".join(answer["why"].split()),
                   "shortlist": shortlist, "recent": recent, "shared_titles": share_titles,
                   "guests": [g["id"] for g in guests], "model": MODEL,
                   "prompt_version": PROMPT_VERSION, "attempts": attempts,
                   "decided_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}
            if freeze:
                _freeze(path, out)
            return out
        print(f"director: answer {attempt + 1} refused:\n  - " + "\n  - ".join(reasons), file=log)
    print("director: refused twice; using the rotation", file=log)
    return None


# ---------------------------------------------------------------------------------------------

def selftest() -> None:
    import io
    import tempfile
    settings = [
        {"id": "autumn-forest", "season": [9, 10, 11], "setting": "a forest in autumn", "crowd": "a fox", "tags": ["forest"]},
        {"id": "book-fair", "season": [10, 3], "setting": "a school hall full of book stalls", "crowd": "parents", "tags": ["indoor"]},
        {"id": "birthday-party", "season": [], "setting": "a garden party", "crowd": "balloons", "tags": ["party"]},
        {"id": "swim-pool", "season": [], "swimwear": True, "setting": "a pool", "crowd": "lifeguard", "tags": ["pool"]},
        {"id": "snowy-hill", "season": [12, 1, 2], "setting": "a snowy hill", "crowd": "sledges", "tags": ["snow"]},
    ]
    styles = [{"id": s, "label": s, "family": "render" if s == "claymation" else "illustration"}
              for s in ("house", "anime", "claymation", "cozy-painted")]
    cams = [{"id": "eye-level", "label": "eye level"}, {"id": "high-angle", "label": "from above"}]
    prems = [{"id": "plain", "label": "plain", "families": ["illustration", "render", "anime"]},
             {"id": "cutaway", "label": "cutaway", "families": ["illustration"]}]
    places = {"forest": "", "indoor": "", "party": "", "pool": "", "snow": "", "mountain": "", "town": ""}
    ctx = {"from": "2026-10-21", "to": "2026-10-27", "weather_line": "a crisp, sunny autumn week",
           "holidays": [], "calendar": {"celebration": 1}, "titles": True,
           "events": [{"title": "Ski trip", "from": "2026-10-24", "to": "2026-10-25", "all_day": True}],
           "hints": []}
    good = {"setting": "book-fair", "new_setting": None, "style": "anime", "camera": "eye-level",
            "premise": "plain", "why": "There is a book fair at school this week."}
    invented = {"setting": None, "new_setting": {
        "id": "ski-mountain", "setting": "a sunny ski mountain with groomed runs between tall dark "
        "pines, a chairlift climbing behind, a wooden lodge with a smoking chimney at the bottom",
        "crowd": "skiers and snowboarders, a ski instructor leading small children in a line, a "
        "dog in the snow", "tags": ["mountain", "snow"], "wardrobe": "bright puffy ski jackets "
        "and snow trousers, a different colour each"},
        "style": "cozy-painted", "camera": "high-angle", "premise": "plain", "why": "A ski trip."}
    failures: list[str] = []

    def common(**kw):
        base = dict(ctx=ctx, settings=settings, styles=styles, compositions=cams, premises=prems,
                    places=places, wall_rows=[{"id": "2026w42-autumn-forest-gpt"}],
                    recent_styles=["house"], guests=[], cast=None, share_titles=True, month=10,
                    names=["Robin", "Sam"], rng=random.Random(1), log=io.StringIO())
        base.update(kw)
        return base

    def answers(*seq):
        calls: list[str] = []
        it = iter(seq)

        def ask(prompt, purpose):
            calls.append(prompt)
            got = next(it)
            if isinstance(got, BaseException):
                raise got
            return got if isinstance(got, str) else json.dumps(got)
        return ask, calls

    def check(label, cond):
        if not cond:
            failures.append(label)

    with tempfile.TemporaryDirectory() as tmp:
        where = pathlib.Path(tmp)
        ask, calls = answers(good)
        got = decide("2026-W43b", ask=ask, where=where, **common())
        check("a listed setting is taken", got and got["setting"]["id"] == "book-fair" and len(calls) == 1)
        check("and frozen", path_for("2026-W43b", where).exists())
        check("the brief reached the model", "Ski trip" in calls[0])
        check("swimwear is never offered", "swim-pool" not in calls[0])
        check("a recent style is not offered", "house (" not in calls[0].split("STYLES:")[1].split("\n")[0])
        check("a recent setting is named", "do not repeat these: autumn-forest" in calls[0])
        ask, calls = answers(Exception("must not be called"))
        again = decide("2026-W43b", ask=ask, where=where, **common())
        check("a frozen decision is reused without a call", again == got and not calls)

        ask, calls = answers(invented)
        got = decide("2026-W44", ask=ask, where=where, **common())
        check("an invented setting is drawn in the catalog's shape",
              got and got["setting"].get("invented") and got["setting"]["tags"] == ["mountain", "snow"])

        bad = json.loads(json.dumps(invented))
        bad["new_setting"]["setting"] = ("a ski mountain where Robin waves under a big banner "
                                         "that says \"welcome\", pines and a lodge and a chairlift "
                                         "behind them in the sun")
        bad["new_setting"]["tags"] = ["pool"]
        bad["style"] = "house"
        ask, calls = answers(bad, invented)
        log = io.StringIO()
        got = decide("2026-W45", ask=ask, where=where, **common(log=log))
        text = log.getvalue()
        for needle in ("'Robin'", "'banner'", "quotation", "tags must", "'house' was on the wall"):
            check(f"refusal names {needle}", needle in text)
        check("the retry quotes the reasons", len(calls) == 2 and "previous answer was refused" in calls[1])
        check("and the retry is taken", got and got["setting"]["id"] == "ski-mountain")

        ask, calls = answers("not json", {**good, "setting": "swim-pool"})
        got = decide("2026-W46", ask=ask, where=where, **common())
        check("refused twice falls back and freezes nothing",
              got is None and not path_for("2026-W46", where).exists())

        ask, calls = answers(SystemExit("FAL_KEY is not set"))
        check("unreachable falls back", decide("2026-W47", ask=ask, where=where, **common()) is None)

        wrong_family = {**good, "style": "claymation", "premise": "cutaway"}
        ask, calls = answers(wrong_family, wrong_family)
        check("a premise outside the style's family is refused",
              decide("2026-W48", ask=ask, where=where, **common()) is None)

        ask, calls = answers(good)
        got = decide("2026-W49", ask=ask, where=where, freeze=False, **common())
        check("freeze=False (a dry run) writes nothing", got and not path_for("2026-W49", where).exists())

        quiet = {**ctx, "titles": False, "events": []}
        ask, calls = answers(good)
        decide("2026-W50", ask=ask, where=where, **common(ctx=quiet, share_titles=False))
        check("titles off: no title is sent", "Ski trip" not in calls[0] and "by kind" in calls[0])

    picks = {tuple(random.Random(i).sample(["a", "b", "c", "d", "e", "f"], 3)) for i in range(20)}
    check("the shortlist varies", len(picks) > 5)
    check("recent settings parse ids", recent_settings(
        [{"id": "2026w43b-book-fair-cozy-painted-gpt"}, {"id": "2026w43-ski-mountain-nb2"},
         {"id": "2026w42-book-fair-gpt"}], ["book-fair", "big-library"]) == ["book-fair", "ski-mountain"])
    if failures:
        for f in failures:
            print("  FAIL " + f)
        raise SystemExit(1)
    print("scene director OK (21 checks)")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    else:
        print(__doc__)
