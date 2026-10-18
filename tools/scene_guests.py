#!/usr/bin/env python3
"""VISITING FAMILY — people who come to stay, drawn into the picture beside the children.

    python3 tools/scene_guests.py --selftest      # no network, no household data

The household's words (2026-10-18): "the family calendar will show people coming into town ...
I can provide guidelines for cousins that are visiting ahead of time." So the guests are a FILE,
written ahead of time like the cast: `db/guests.json` (gitignored; `db/guests.example.json` is
the committed synthetic twin). Each guest has the names a calendar title would use for them and
the few things a picture needs — sex, age, height, hair. A visit is any calendar event in the
run's window whose title carries one of those names as a whole word; a `group` name ("the
Smiths") brings every member at once. Matching happens INSIDE the wall container
(tools/scene-calendar.cjs), so it works whether or not titles are shared with the director.

A GUEST IS NEVER A TAP TARGET, AND THAT IS THE WHOLE DIFFICULTY. The picture is the navigation:
a child finds herself and taps herself. A visiting cousin of the same age and hair is the one
figure most likely to be mistaken for her — by the artist (who may draw the portrait's face on
the wrong body) and by the finder (who may box the cousin). So three things change, and only
when a guest is present, so every picture without one is the same prompt byte for byte:

  1. The generator is told who the visitors are, in WORDS only — never a photograph, never a
     name — and that they stand together as one group APART from the children, in clothes no
     child is wearing. `prompt_section()`.
  2. "the nearest and largest children" stops being true (a visiting eight-year-old is bigger
     than all three), so that sentence is swapped for one that is. `nearest_clause()`.
  3. The finder is told who the visitors are and that none of them is any portrait: a named
     decoy is far easier to refuse than an unnamed look-alike. `finder_decoys()`.
"""
from __future__ import annotations

import json
import os
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))

from scene_cast import count_words, landmark  # noqa: E402

GUESTS_REAL = REPO / "db" / "guests.json"
GUESTS_EXAMPLE = REPO / "db" / "guests.example.json"
SEXES = ("man", "woman", "boy", "girl")
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
MAX_GUESTS = 6
# A name is matched as a whole word in a calendar title, so it must be a word: letters, an
# apostrophe or a hyphen. A name like "Al" is allowed and will match "Al's party" — that is the
# household's call when they write the file.
NAME_RE = re.compile(r"^[^\W\d_][\w'’ -]{0,39}$", re.UNICODE)


def guests_path() -> pathlib.Path | None:
    """db/guests.json, or $SCENE_GUESTS. NO fallback to the example: a household with no file
    has no visitors, and an example cousin turning up in a real picture would be a stranger."""
    env = os.environ.get("SCENE_GUESTS")
    if env:
        return pathlib.Path(env)
    return GUESTS_REAL if GUESTS_REAL.exists() else None


def validate(data: dict) -> list[str]:
    errs = []
    if not isinstance(data, dict) or not isinstance(data.get("guests"), list):
        return ["guests: the file must be an object with a `guests` list"]
    ids = set()
    for i, g in enumerate(data["guests"]):
        where = f"guests[{i}]"
        if not isinstance(g, dict):
            errs.append(f"{where}: must be an object")
            continue
        gid = g.get("id")
        if not isinstance(gid, str) or not ID_RE.match(gid):
            errs.append(f"{where}.id: a short lowercase id like 'aunt' or 'cousin-1'")
        elif gid in ids:
            errs.append(f"{where}.id: {gid!r} is used twice")
        ids.add(gid)
        if g.get("sex") not in SEXES:
            errs.append(f"{where}.sex: one of {', '.join(SEXES)}")
        age = g.get("age")
        if g.get("sex") in ("boy", "girl") and not (isinstance(age, int) and 0 < age < 18):
            errs.append(f"{where}.age: a child's age in years")
        h = g.get("height_cm")
        if h is not None and not (isinstance(h, (int, float)) and 50 <= h <= 230):
            errs.append(f"{where}.height_cm: centimetres, or null")
        if not isinstance(g.get("hair"), str) or not g["hair"].strip():
            errs.append(f"{where}.hair: say what their hair looks like")
        names = g.get("names")
        if not isinstance(names, list) or not names or not all(
                isinstance(n, str) and NAME_RE.match(n.strip()) for n in names):
            errs.append(f"{where}.names: the words a calendar title would use for them")
    for i, grp in enumerate(data.get("groups") or []):
        where = f"groups[{i}]"
        if not isinstance(grp, dict):
            errs.append(f"{where}: must be an object")
            continue
        names = grp.get("names")
        if not isinstance(names, list) or not names or not all(
                isinstance(n, str) and NAME_RE.match(n.strip()) for n in names):
            errs.append(f"{where}.names: the words a calendar title would use for the group")
        members = grp.get("members")
        if not isinstance(members, list) or not members or any(m not in ids for m in members):
            errs.append(f"{where}.members: ids from `guests`")
    return errs


def load(path: pathlib.Path | None = None) -> dict:
    """The guest file, validated. An absent file is no guests, not an error."""
    path = path or guests_path()
    if path is None or not path.exists():
        return {"guests": [], "groups": [], "source": None}
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    errs = validate(data)
    if errs:
        raise SystemExit(f"{path}:\n  - " + "\n  - ".join(errs))
    return {"guests": data["guests"], "groups": data.get("groups") or [], "source": str(path)}


def matchers(data: dict) -> list[dict]:
    """What tools/scene-calendar.cjs needs to recognise a visit: each guest id with every name
    that brings it (its own names, plus the names of any group it belongs to)."""
    out = {g["id"]: {"id": g["id"], "names": [n.strip() for n in g["names"]]} for g in data["guests"]}
    for grp in data.get("groups") or []:
        for m in grp["members"]:
            out[m]["names"] += [n.strip() for n in grp["names"] if n.strip() not in out[m]["names"]]
    return list(out.values())


def present(data: dict, seen: list[dict] | None) -> list[dict]:
    """The guest entries the calendar says are here this run, in file order, capped."""
    ids = {s["id"] for s in seen or [] if isinstance(s, dict)}
    return [g for g in data["guests"] if g["id"] in ids][:MAX_GUESTS]


# ---------------------------------------------------------------------------------------------
# words

def _who(g: dict) -> str:
    if g["sex"] in ("boy", "girl"):
        return f"a {g['sex']} of about {count_words(g['age']) if g['age'] <= 5 else g['age']}"
    return {"man": "a grown man", "woman": "a grown woman"}[g["sex"]]


def _size(g: dict, cast: dict) -> str:
    """Height against the children, in the same landmark words the cast lines use."""
    h = g.get("height_cm")
    kids = cast["children"]
    if not h:
        return ""
    first = kids[0]
    tall = f"child {first['slot']}"
    if h >= first["height_cm"] * 1.04:
        mine = "his" if g["sex"] in ("man", "boy") else "her"
        return (f"taller than child {first['slot']}: the top of child {first['slot']}'s head "
                f"comes up to {landmark(first['height_cm'], h, '@').replace('@' + chr(39) + 's', mine)}")
    if h >= first["height_cm"] * 0.97:
        return f"about as tall as child {first['slot']}"
    return f"shorter than child {first['slot']}, coming up to {landmark(h, first['height_cm'], tall)}"


def guest_line(g: dict, cast: dict) -> str:
    size = _size(g, cast)
    return f"  - {_who(g)} with {g['hair'].strip().rstrip('.')}" + (f", {size}" if size else "") + "."


def prompt_section(guests: list[dict], cast: dict) -> str:
    """The VISITING FAMILY section of the image prompt. Empty when nobody is visiting."""
    if not guests:
        return ""
    n = len(cast["children"])
    kids = "child" if n == 1 else f"{count_words(n)} children"
    many = len(guests) > 1
    return "\n".join([
        f"Family {'are' if many else 'is'} visiting this week, and {'they are' if many else 'is'} in "
        f"the picture too, {'together as one small group' if many else 'standing'} a little apart "
        f"from the {kids} — never between them, never in front of them, never touching or "
        "overlapping any of them:",
        *(guest_line(g, cast) for g in guests),
        "The visitors are drawn at the same distance and in the same style as the children, each "
        "in clothes of a colour none of the children is wearing. Any visiting child is NOT one of "
        "the children in the portraits and looks clearly different from every one of them.",
    ])


def nearest_clause(n: int) -> str:
    """Replaces scene's `nearest_v2` when guests are present: a visiting eight-year-old is
    bigger than every child in the cast, so "the nearest and largest" would ask for the wrong
    picture or, worse, push the visitors to the back where they read as more crowd."""
    who = "The child is the subject" if n == 1 else f"They are the {count_words(n)} children this picture is about"
    return (f"{who}, and with the visiting family they are the nearest people in the picture. "
            "Any other children in the crowd are far off and clearly smaller.")


def finder_decoys(guests: list[dict]) -> str:
    """For the region finder: who else is in the picture on purpose, and that none of them is a
    portrait. Hair and age, the features the finder matches on, so it knows which to refuse."""
    if not guests:
        return ""
    lines = [f"  - {_who(g)} with {g['hair'].strip().rstrip('.')}." for g in guests]
    return ("VISITORS. These people are also in the picture on purpose. They are visiting family "
            "and they are NOT any of the children above, however alike they look — never box "
            "one of them:\n" + "\n".join(lines) +
            "\nThey stand together as a group apart from the children; when two figures look "
            "alike, the one standing with the visitors is the visitor.")


def load_selected(path: str | None) -> list[dict]:
    """The guests file scene-week writes for one run (a list of entries), for gen-scene and the
    finder. Absent means nobody is visiting."""
    if not path:
        return []
    with open(path, encoding="utf-8") as fh:
        got = json.load(fh)
    errs = validate({"guests": got})
    if errs:
        raise SystemExit(f"{path}:\n  - " + "\n  - ".join(errs))
    return got


def selftest() -> None:
    fails = []
    ex = json.loads(GUESTS_EXAMPLE.read_text(encoding="utf-8"))
    if validate(ex):
        fails.append(f"the committed example does not validate: {validate(ex)}")
    data = {"guests": ex["guests"], "groups": ex.get("groups") or []}
    m = {x["id"]: x["names"] for x in matchers(data)}
    grp = (ex.get("groups") or [{}])[0]
    for member in grp.get("members", []):
        if not set(grp["names"]) <= set(m[member]):
            fails.append(f"group names do not reach {member}")
    if present(data, [{"id": "nobody"}]):
        fails.append("an unknown id was treated as present")
    cast = {"children": [{"slot": 1, "height_cm": 130, "sex": "girl"},
                         {"slot": 2, "height_cm": 117, "sex": "girl"},
                         {"slot": 3, "height_cm": 104, "sex": "boy"}]}
    sec = prompt_section(ex["guests"], cast)
    for g in ex["guests"]:
        for name in g["names"]:
            if re.search(rf"\b{re.escape(name)}\b", sec, re.I):
                fails.append(f"a guest's NAME reached the image prompt: {name!r}")
    if prompt_section([], cast) or finder_decoys([]):
        fails.append("nobody visiting must add nothing")
    tall = _size({"height_cm": 193, "sex": "man"}, cast)
    if "comes up to" not in tall:
        fails.append(f"an adult's height reads wrong: {tall!r}")
    bad = validate({"guests": [{"id": "Bad Id", "sex": "dog", "names": [], "hair": ""}]})
    if len(bad) < 4:
        fails.append(f"a bad entry was not refused enough: {bad}")
    if fails:
        for f in fails:
            print("  FAIL " + f)
        raise SystemExit(1)
    print("scene guests OK (validation, matching, no names in the prompt, decoys)")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    else:
        d = load()
        print(json.dumps({"source": d["source"], "guests": [g["id"] for g in d["guests"]]}, indent=2))
