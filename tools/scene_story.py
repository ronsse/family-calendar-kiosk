"""Book-themed scenes, gated on how far the household has actually read.

Asked for 2026-09-16: a story setting should not just be a place, it should be a MOMENT out of
the book — *"generating it from a notable event in the book"* — and it must not run ahead of the
children. How far they have read is household data (the committed settings carry the lowest
value the selftest needs), and a picture of anything past it is a spoiler delivered at eye
level, on the living-room wall, every time they walk past it. That is the only rule in this
file with teeth.

## How far they have read is ONE NUMBER, and it can be a fraction

`read_through` is a float. `1.0` means "finished book one". `1.5` means "part way into book
two" — a family is as often part way into a series as at the end of a book, which is the
reason this is not an int. A moment carries `through`, the point by which a reader has met it,
and it is eligible when `through <= read_through`. Later moments stay in the file, visible and
inert, so that finishing a book is a one-number edit rather than an archaeology exercise.

Fractions are deliberately coarse. There is no attempt to track a chapter: `1.5` means the
opening of book two and `2.0` means all of it, and if the household is somewhere in between,
the honest move is to leave `read_through` where it is for another week.

## Describe, never name

Same rule as every other prompt in this repo, and for the same two reasons: an image model
refuses a named property outright, and a description of a situation is what we actually want
anyway. No title, no character name and no place name appears in any moment here — they are
phrased as things THE THREE CHILDREN are doing, because the picture is of them having the
adventure, not of somebody else's characters having it.

## The moments are activity-shaped

Each one slots into the prompt exactly where `pick_activities` would have put a shared
activity, so nothing downstream needs to know a story exists.
"""
import json
import pathlib
import random

HERE = pathlib.Path(__file__).resolve().parent
SETTINGS = json.loads((HERE / "scene-settings.json").read_text(encoding="utf-8"))["settings"]


def eligible(setting: dict) -> list[dict]:
    """The moments this household has read far enough to meet. Empty for a setting with no story."""
    story = setting.get("story")
    if not story:
        return []
    read_through = story["read_through"]
    return [m for m in story["moments"] if m["through"] <= read_through]


def pick(setting: dict, rng: random.Random) -> str | None:
    """One moment, or None — in which case the caller falls back to the ordinary activity table.

    None is a real answer and not a failure: most settings are places rather than stories, and a
    story whose household has not finished book one yet has nothing to show.
    """
    moments = eligible(setting)
    return rng.choice(moments)["do"] if moments else None


def selftest() -> None:
    """The spoiler gate, asserted. `npm run verify:spoilers`.

    WHAT THIS CATCHES: the MECHANISM going wrong — a flipped comparison, an off-by-one, a float
    that stops behaving, a draw that reaches past the line on some seed. Those are silent
    failures that land on a child, and nothing downstream could notice them.

    WHAT IT CANNOT CATCH, and this was measured rather than assumed (2026-09-16): a moment
    TAGGED with the wrong book. Re-tagging the end of book two as `through: 1` makes it eligible
    and this test still passes, because the tag is the only thing that knows where a moment
    comes from. The tags are the trusted input here, and the only defence for them is that a
    person wrote them once, deliberately, from what the household said they had read. Do not
    read a green selftest as "no spoilers".
    """
    failures = []
    for setting in SETTINGS:
        story = setting.get("story")
        if not story:
            continue
        sid = setting["id"]
        read_through = story["read_through"]
        moments = story["moments"]
        if not moments:
            failures.append(f"{sid}: a story with no moments")
        allowed = eligible(setting)
        for m in moments:
            ahead = m["through"] > read_through
            if ahead and m in allowed:
                failures.append(f"{sid}: SPOILER — {m['do'][:48]!r} is through {m['through']} "
                                f"but read_through is {read_through}")
            if not ahead and m not in allowed:
                failures.append(f"{sid}: {m['do'][:48]!r} should be eligible and is not")
        if not allowed:
            failures.append(f"{sid}: nothing is eligible — every moment is ahead of "
                            f"read_through {read_through}")
        # A deterministic draw must also never reach past the line, however many times it runs.
        for seed in range(200):
            got = pick(setting, random.Random(seed))
            if got not in [m["do"] for m in allowed]:
                failures.append(f"{sid}: seed {seed} drew something not eligible")
                break
        print(f"{sid}: {len(allowed)}/{len(moments)} moments eligible at "
              f"read_through {read_through}")
    if failures:
        for f in failures:
            print("  FAIL " + f)
        raise SystemExit(1)
    print("spoiler gate OK")


if __name__ == "__main__":
    import sys
    if "--selftest" in sys.argv:
        selftest()
    else:
        for setting in SETTINGS:
            if setting.get("story"):
                print(f"\n=== {setting['id']}  (read_through "
                      f"{setting['story']['read_through']})")
                for m in setting["story"]["moments"]:
                    mark = "  " if m["through"] <= setting["story"]["read_through"] else "x "
                    print(f"  {mark}{m['through']}  {m['do']}")
