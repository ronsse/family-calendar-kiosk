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
import scene_memory  # noqa: E402

PROMPT_VERSION = 4   # 4 (2026-10-28): invent at least every other run; TWO different pictures
                     # 3 (2026-10-28): manual settings leave the list; a recent setting is refused
                     # 2 (2026-10-18): the dog's mood is the director's to choose too
MODEL = "google/gemini-2.5-flash"
RECENT_SETTINGS = scene_memory.RECENT_SETTINGS
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


# The wall's recent settings. It lived here until the rotation needed it too (2026-10-28).
recent_settings = scene_memory.recent_settings


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
    # A holiday or the first snow is the week to INVENT for, not to reach for the nearest row
    # (docs/scene-variety-plan.md D): the catalog's own Halloween pictures are `manual` now.
    if ctx.get("holidays"):
        lines.append("Invent a place for the holiday rather than reusing a listed setting.")
    month = int((ctx.get("from") or ctx.get("monday") or "2000-01")[5:7])
    if (ctx.get("weather") or {}).get("precip") == "snow" and month in (9, 10, 11):
        lines.append("Snow is forecast, likely the first of the year: invent a place for it.")
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
                  month: int, reasons: list[str], dog_moods: list[dict] | None = None,
                  pictures: int = 1) -> str:
    def short(text: str, n: int = 150) -> str:
        text = " ".join(text.split())
        return text if len(text) <= n else text[:n - 1].rsplit(" ", 1)[0] + "…"
    rows = []
    for s in settings:
        when = ("in season" if month in s.get("season", []) else
                "for an occasion" if not s.get("season") else "out of season")
        rows.append(f"  {s['id']} ({when}): {short(s['setting'])}")
    one = ('{"setting": "<listed id, or null>", "new_setting": null or {"id": "<short-kebab-id>", '
           '"setting": "...", "crowd": "...", "tags": ["..."], "wardrobe": "... or omit"}, '
           '"style": "<id>", "camera": "<id>", "premise": "<id>", '
           + ('"dog": "<mood id>", ' if dog_moods else "") + '"why": "<one sentence>"}')
    parts = [
        "Choose this week's picture." if pictures == 1 else
        "Choose this run's TWO pictures. They hang side by side and the family picks one, so they "
        "must be two different ideas: the first answers the week, the second is something else "
        "entirely — a different place and a different style.",
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
        "- Invent a NEW place (`new_setting`) at least every other picture. Use a listed setting when "
        "one already fits this week's event exactly; otherwise surprise the children with "
        "somewhere they have not been."
        + (" At least one of the two pictures is a new place." if pictures == 2 else ""),
        "- A new setting describes a real-looking place a child would love, in plain words: what is "
        "there, the light, the time of day. No person's name, no film, book, brand or character "
        "name, and no written words of any kind — no signs, banners, labels, posters or lettering. "
        "Not a swimming scene. `setting` 15 to 60 words; `crowd` 10 to 40 words listing the OTHER "
        "people, animals and objects around; `tags` 1 to 3 of: " + ", ".join(
            k for k in places if k != "pool") + "; `wardrobe` optional, clothes only, under 25 words, "
        "every face fully visible (no hoods, masks or helmets).",
        "- Pick a style that suits the place and the season, and a camera that suits the style."
        + (" Use premise `plain` for no more than two pictures running; the others are built to "
           "be drawn." if len(premises) > 1 else ""),
        *(["- The family dog is in every picture, on his own and never with the children. Choose "
           "what he is up to (`dog`) from this list, one that fits your setting's places; "
           "`hiding` is a fine choice for a seek-and-find picture, and something funny suits most "
           "weeks: " + "; ".join(f"{m['id']} ({' '.join(m['do'].split())}; places: "
                                 f"{', '.join(m['places'])})" for m in dog_moods)]
           if dog_moods else []),
        "",
        "Answer exactly this JSON:",
        one if pictures == 1 else '{"pictures": [' + one + ", " + one + "]}",
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
    # Single quotes too (2026-10-28: "a 'ring-the-pumpkin' game"), but not an apostrophe.
    if any(q in text for q in '"“”‘’') or re.search(r"(?<!\w)'[^']+'(?!\w)", text):
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
             names: list[str], recent_settings_: list[str] = ()) -> list[str]:
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
        elif sid in recent_settings_ and ids - set(recent_settings_):
            out.append(f"setting {sid!r} was on the wall recently; choose another")
    else:
        if not isinstance(new, dict):
            return out + ["new_setting must be an object"]
        nid = new.get("id")
        if not isinstance(nid, str) or not ID_RE.match(nid):
            out.append("new_setting.id must be 3 to 33 lowercase letters, digits and dashes")
        elif nid in ids:
            out.append(f"new_setting.id {nid!r} is already a listed setting; use `setting` instead")
        elif nid in recent_settings_:
            out.append(f"new_setting.id {nid!r} was on the wall recently; invent a different place")
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


def pair_problems(pair: list[dict], settings: list[dict], styles: list[dict],
                  recent_styles: list[str]) -> list[str]:
    """What makes two individually good answers a bad PAIR. The household's report (2026-10-28):
    two pictures a run, and they were the same picture twice."""
    out = []
    a, b = (to_setting(p, settings) for p in pair)
    if a["id"] == b["id"]:
        out.append("the two pictures are the same place; make the second somewhere else")
    fresh = [s["id"] for s in styles if s["id"] not in recent_styles]
    if pair[0]["style"] == pair[1]["style"] and len(fresh) >= 2:
        out.append("the two pictures use the same style; give the second a different one")
    if not (a.get("invented") or b.get("invented")):
        out.append("neither picture is a new place; invent one of them (`new_setting`)")
    return out


def decisions(frozen: dict) -> list[dict]:
    """The decision(s) a frozen file holds: two since 2026-10-28, one before."""
    return list(frozen.get("decisions") or [frozen])


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


def dog_choice(answer: dict, setting: dict, dog_moods: list[dict], month: int,
               log=sys.stderr) -> str | None:
    """The dog mood the director chose, if it fits the chosen setting and the season; else None,
    which scene-week reads as "draw one". A misfit dog is not worth refusing a whole decision
    over — the picture is still the director's, only his pastime is drawn."""
    import scene_activities  # noqa: E402
    import scene_dog  # noqa: E402
    mid = answer.get("dog")
    season = scene_activities.SEASON_OF_MONTH[month]
    fits = {m["id"] for m in scene_dog.fitting(dog_moods, setting.get("tags", []), season)}
    if mid in fits:
        return mid
    print(f"director: dog {mid!r} does not fit {setting['id']} this season; it will be drawn",
          file=log)
    return None


def fal_director(prompt: str, purpose: str) -> str:
    import fal_api  # noqa: E402  (imported here so the selftest and dry runs need no key)
    return fal_api.text(prompt, purpose, model=MODEL, system_prompt=SYSTEM)


def decide(run: str, *, ctx: dict | None, settings: list[dict], styles: list[dict],
           compositions: list[dict], premises: list[dict], places: dict, wall_rows: list[dict],
           recent_styles: list[str], guests: list[dict], cast: dict | None, share_titles: bool,
           month: int, names: list[str], ask: Callable[[str, str], str] | None = None,
           where: pathlib.Path | None = None, rng: random.Random | None = None,
           freeze: bool = True, extra_check: Callable[[dict], list[str]] | None = None,
           dog_moods: list[dict] | None = None, pictures: int = 1,
           log=sys.stderr) -> dict | None:
    """The run's decision: {setting (a full entry), style, camera, premise, why, ...}, frozen on
    first success. None means "use the rotation" — the reason has been printed to `log`.

    With `pictures=2` (2026-10-28) it is two decisions, `{"decisions": [first, second], ...}`,
    for the two candidates hung side by side: different places, different styles where the wall
    leaves two to choose from, and at least one place invented. `decisions()` reads either shape.

    `extra_check(setting)` is the caller's own refusal of a chosen setting (scene-week: an
    invented place the activity table cannot fill, when the table is what deals activities).

    With `dog_moods` the director also chooses the dog's mood. The frozen decision then carries
    a `dog` key: a mood id, or null for "draw one". A decision with NO `dog` key predates the
    choice and means hiding, which is what its pictures were drawn with."""
    path = path_for(run, where)
    frozen = load_frozen(path)
    if frozen is not None:
        return frozen
    # Swimwear stays an adult's `--setting`; nothing the director reads can choose it. Nor can it
    # choose a `manual` setting (this year's costumes, a one-off): until 2026-10-28 those shared
    # `season: []` with the true occasions and were offered as "for an occasion", so anything
    # festive on the calendar drew the same hand-authored Halloween picture again.
    pool = [s for s in settings if not s.get("swimwear") and not s.get("manual")]
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
                                reasons=reasons, dog_moods=dog_moods, pictures=pictures)
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
        def check(one, prefix: str = "") -> list[str]:
            got = problems(one, settings=pool, styles=styles, compositions=compositions,
                           premises=premises, places=places, recent_styles=recent_styles,
                           names=names, recent_settings_=recent)
            if not got and extra_check is not None:
                got = extra_check(to_setting(one, pool))
            return [prefix + r for r in got]

        answer = parse_answer(raw)
        if answer is None:
            reasons = ["the answer was not JSON"]
        elif pictures == 1:
            picked = [answer]
            reasons = check(answer)
        else:
            picked = answer.get("pictures")
            if not (isinstance(picked, list) and len(picked) == 2):
                reasons = ["give `pictures` as a list of exactly two objects"]
            else:
                reasons = check(picked[0], "picture 1: ") + check(picked[1], "picture 2: ")
                if not reasons:
                    reasons = pair_problems(picked, pool, styles, recent_styles)
        if not reasons:
            chosen = []
            for one in picked:
                d = {"setting": to_setting(one, pool), "style": one["style"],
                     "camera": one["camera"], "premise": one["premise"],
                     "why": " ".join(one["why"].split())}
                if dog_moods:
                    d["dog"] = dog_choice(one, d["setting"], dog_moods, month, log=log)
                chosen.append(d)
            meta = {"shortlist": shortlist, "recent": recent, "shared_titles": share_titles,
                    "guests": [g["id"] for g in guests], "model": MODEL,
                    "prompt_version": PROMPT_VERSION, "attempts": attempts,
                    "decided_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}
            out = ({"run": run, "source": "director", **chosen[0], **meta} if pictures == 1 else
                   {"run": run, "source": "director", "decisions": chosen,
                    "why": chosen[0]["why"], **meta})
            if freeze:
                _freeze(path, out)
            return out
        print(f"director: answer {attempt + 1} refused:\n  - " + "\n  - ".join(reasons), file=log)
    print("director: refused twice; using the rotation", file=log)
    return None


# ---------------------------------------------------------------------------------------------

CHECKS = 0


def selftest() -> None:
    import io
    import tempfile
    settings = [
        {"id": "autumn-forest", "season": [9, 10, 11], "setting": "a forest in autumn", "crowd": "a fox", "tags": ["forest"]},
        {"id": "book-fair", "season": [10, 3], "setting": "a school hall full of book stalls", "crowd": "parents", "tags": ["indoor"]},
        {"id": "birthday-party", "season": [], "setting": "a garden party", "crowd": "balloons", "tags": ["party"]},
        {"id": "swim-pool", "season": [], "swimwear": True, "setting": "a pool", "crowd": "lifeguard", "tags": ["pool"]},
        {"id": "costume-fair", "season": [], "manual": True, "setting": "this year's costume fair", "crowd": "costumes", "tags": ["indoor"]},
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
        global CHECKS
        CHECKS += 1
        if not cond:
            failures.append(label)

    with tempfile.TemporaryDirectory() as tmp:
        where = pathlib.Path(tmp)
        ask, calls = answers(good)
        got = decide("2026-W43b", ask=ask, where=where, **common())
        check("a listed setting is taken", got and got["setting"]["id"] == "book-fair" and len(calls) == 1)
        check("and frozen", path_for("2026-W43b", where).exists())
        check("the brief reached the model", "Ski trip" in calls[0])
        check("no holiday, no invent-for-it line", "Invent a place for the holiday" not in calls[0])
        check("a holiday asks for an invented place", "Invent a place for the holiday" in "\n".join(
            brief_lines({**ctx, "holidays": ["Halloween week: pumpkins"]}, [], None, True)))
        check("an autumn first snow asks for one too", "first of the year" in "\n".join(
            brief_lines({**ctx, "weather": {"precip": "snow"}}, [], None, True)))
        check("swimwear is never offered", "swim-pool" not in calls[0])
        check("a manual setting is never offered", "costume-fair" not in calls[0])
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
        check("a single-quoted name is a quotation, an apostrophe is not",
              text_problems("setting", "a carnival with a 'ring-the-pumpkin' game and stalls of "
                            "toffee apples under warm lights in the town square at dusk",
                            lo=1, hi=60, names=[])
              and not text_problems("setting", "the children's carnival with stalls of toffee "
                                    "apples under warm lights in the town square at dusk",
                                    lo=1, hi=60, names=[]))
        check("the retry quotes the reasons", len(calls) == 2 and "previous answer was refused" in calls[1])
        check("and the retry is taken", got and got["setting"]["id"] == "ski-mountain")

        ask, calls = answers("not json", {**good, "setting": "swim-pool"})
        got = decide("2026-W46", ask=ask, where=where, **common())
        check("refused twice falls back and freezes nothing",
              got is None and not path_for("2026-W46", where).exists())

        ask, calls = answers(SystemExit("FAL_KEY is not set"))
        check("unreachable falls back", decide("2026-W47", ask=ask, where=where, **common()) is None)

        ask, calls = answers({**good, "setting": "autumn-forest"}, good)
        log = io.StringIO()
        got = decide("2026-W40", ask=ask, where=where, **common(log=log))
        check("a recent setting is refused, not just named",
              "'autumn-forest' was on the wall recently" in log.getvalue()
              and got and got["setting"]["id"] == "book-fair")
        recent_new = {**invented, "new_setting": {**invented["new_setting"], "id": "ski-mountain"}}
        ask, calls = answers(recent_new, good)
        log = io.StringIO()
        decide("2026-W41", ask=ask, where=where,
               **common(log=log, wall_rows=[{"id": "2026w44-ski-mountain-gpt"}]))
        check("a recent invented place is refused", "'ski-mountain' was on the wall recently"
              in log.getvalue())
        ask, calls = answers({**good, "setting": "autumn-forest"})
        got = decide("2026-W39", ask=ask, where=where, **common(wall_rows=[
            {"id": f"2026w3{i}-{s}-gpt"} for i, s in enumerate(
                ("autumn-forest", "book-fair", "birthday-party", "snowy-hill"))]))
        check("when every setting is recent, recency gives way",
              got and got["setting"]["id"] == "autumn-forest")

        wrong_family = {**good, "style": "claymation", "premise": "cutaway"}
        ask, calls = answers(wrong_family, wrong_family)
        check("a premise outside the style's family is refused",
              decide("2026-W48", ask=ask, where=where, **common()) is None)

        ask, calls = answers(good)
        got = decide("2026-W49", ask=ask, where=where, freeze=False, **common())
        check("freeze=False (a dry run) writes nothing", got and not path_for("2026-W49", where).exists())

        moods = [{"id": "hiding", "weight": 3, "do": "hiding", "places": ["forest", "indoor"]},
                 {"id": "leaf-pile", "weight": 1, "do": "in a pile of leaves", "places": ["forest"],
                  "seasons": ["autumn"]},
                 {"id": "snow-nose", "weight": 1, "do": "nose in the snow", "places": ["snow"]}]
        ask, calls = answers({**good, "setting": "autumn-forest", "dog": "leaf-pile"})
        got = decide("2026-W51", ask=ask, where=where, dog_moods=moods,
                     **common(wall_rows=[]))
        check("the dog's moods are offered", "leaf-pile (in a pile of leaves" in calls[0]
              and '"dog": "<mood id>"' in calls[0])
        check("a fitting dog mood is kept", got and got.get("dog") == "leaf-pile")
        ask, calls = answers({**good, "dog": "snow-nose"})
        got = decide("2026-W52", ask=ask, where=where, dog_moods=moods, **common())
        check("a dog mood that does not fit the place is drawn, not refused",
              got and "dog" in got and got["dog"] is None and len(calls) == 1)
        ask, calls = answers(good)
        got = decide("2026-W53", ask=ask, where=where, **common())
        check("without moods there is no dog key and no dog line", got and "dog" not in got
              and '"dog"' not in calls[0])

        ask, calls = answers({"pictures": [good, invented]})
        got = decide("2026-W44b", ask=ask, where=where, pictures=2, **common())
        check("two pictures are asked for", calls and '"pictures": [' in calls[0]
              and "TWO pictures" in calls[0])
        check("two different pictures are taken and frozen",
              got and [d["setting"]["id"] for d in decisions(got)] == ["book-fair", "ski-mountain"]
              and decisions(load_frozen(path_for("2026-W44b", where)))[1]["style"] == "cozy-painted")
        check("a single decision reads as one", decisions({"setting": {"id": "x"}}) == [{"setting": {"id": "x"}}])
        same = {**good, "style": "cozy-painted"}
        ask, calls = answers({"pictures": [good, same]}, {"pictures": [good, invented]})
        log = io.StringIO()
        got = decide("2026-W45b", ask=ask, where=where, pictures=2, **common(log=log))
        for needle in ("same place", "neither picture is a new place"):
            check(f"a pair refusal names {needle!r}", needle in log.getvalue())
        check("and the retry is taken", got and len(decisions(got)) == 2)
        twin = {**invented, "style": "anime", "new_setting": {**invented["new_setting"], "id": "ski-hill"}}
        ask, calls = answers({"pictures": [good, twin]}, {"pictures": [good, twin]})
        log = io.StringIO()
        got = decide("2026-W46b", ask=ask, where=where, pictures=2, **common(log=log))
        check("a pair in one style is refused", got is None and "same style" in log.getvalue())
        ask, calls = answers({"pictures": [{**good, "setting": "nowhere"}, invented]}, "nope")
        log = io.StringIO()
        decide("2026-W47b", ask=ask, where=where, pictures=2, **common(log=log))
        check("a bad picture is named by its place in the pair",
              "picture 1: setting 'nowhere'" in log.getvalue())

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
    print(f"scene director OK ({CHECKS} checks)")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    else:
        print(__doc__)
