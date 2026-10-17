"""The cast sheet in words — who the three children are, for the prompt and for the finder.

Loads `db/cast.json` (the real one, gitignored) and falls back to `db/cast.example.json`
(committed, synthetic) so a fresh checkout still draws three plausible children. Both
gen-scene.py and scene-regions.py read the SAME description through this module, which is the
point: the generator asks for a child and the finder looks for the child it asked for, and the
two can no longer drift apart by an adjective (they had — the finder still described "two
pigtails" after the prompt moved to "two braids").

WHAT IDENTITY IS, decided 2026-09-12 after the FLUX verdict was scored wrong ("the boy
vanished" — he had changed his jacket): identity is the COUNT, the HEIGHT ORDER and the HAIR.
Clothes, faces, expressions and poses are meant to vary from picture to picture, and eye colour
is dropped from the contract altogether — at scene scale (a child is a quarter of the frame at
most) an eye is two pixels on the glass, so it cannot help a child find herself and only gives a
verifier something irrelevant to fail on.

HEIGHT IS A RATIO, NOT A NUMBER. An image model has no idea what 109cm looks like beside 122cm,
but it knows what "comes up to her chin" looks like. `landmark()` turns the ratio between two
heights into the body landmark the shorter child's head reaches on the taller one, from the
standard proportions of a standing child (eyes ~93% of stature, chin ~87%, shoulder ~82%,
chest ~72%, elbow ~63%, waist ~58%). Ages are also stated outright: they are the strongest
single cue these models have for body proportion.

DISCLOSURE. Ages and hair colour are permitted in a prompt under prompt_guard's
POLICY = "described"; names never appear here and no photograph is ever attached. The real
file is gitignored because ages ARE household data (build-plan §3.1), not because the prompt
must not carry them.
"""
import json
import os
import pathlib

REPO = pathlib.Path(__file__).resolve().parent.parent
CAST_REAL = REPO / "db" / "cast.json"
CAST_EXAMPLE = REPO / "db" / "cast.example.json"

# (fraction of the taller child's stature, phrase) — descending, so the first entry whose
# fraction is at or below the ratio is the landmark the shorter head reaches.
_LANDMARKS = (
    (0.97, "almost the top of {tall}'s head"),
    (0.93, "{tall}'s eyes"),
    (0.87, "{tall}'s chin"),
    (0.82, "{tall}'s shoulder"),
    (0.72, "{tall}'s chest"),
    (0.63, "{tall}'s elbow"),
    (0.58, "{tall}'s waist"),
    (0.00, "{tall}'s hip"),
)

# THE CAST IS N CHILDREN, 1 TO MAX_CAST (2026-10-12). Every sentence below was written for three,
# and every one of them still renders BYTE-FOR-BYTE what it did when n == 3: the prompt is a
# paid input, and `gen-scene --reuse-if-same` keys the cached picture on its exact text, so a
# changed comma at n == 3 is a redraw the household pays for next Sunday.
# `test/fixtures/prompt-v2.example.txt` is the frozen copy; `test/unit-g.tools.test.ts` diffs it.
MAX_CAST = 5

_COUNT = ("one", "two", "three", "four", "five")
_NTH = ("second", "third", "fourth")


def count_words(n: int) -> str:
    """`three` for 3. Lower case; a caller that starts a sentence capitalises it."""
    if not 1 <= n <= MAX_CAST:
        raise ValueError(f"a cast has 1 to {MAX_CAST} children, not {n}")
    return _COUNT[n - 1]


def ordinal_words(n: int) -> list[str]:
    """What each child is called by age, eldest first: three is eldest / middle one / youngest."""
    if n == 1:
        return ["the child"]
    if n == 2:
        return ["elder", "younger"]
    if n == 3:
        return ["eldest", "middle one", "youngest"]
    if 4 <= n <= MAX_CAST:
        return ["eldest", *_NTH[: n - 2], "youngest"]
    raise ValueError(f"a cast has 1 to {MAX_CAST} children, not {n}")


def the_children(n: int) -> str:
    """The noun phrase the taste tables' `{the_children}` token becomes: `the three children`."""
    return "the child" if n == 1 else f"the {count_words(n)} children"


def cast_fits(entry: dict, n: int) -> bool:
    """Does a table entry (activity, composition, premise) fit a cast of `n`? No `cast` key
    means any headcount, so at n == 3 every existing entry fits and nothing is filtered."""
    allowed = entry.get("cast")
    return allowed is None or n in allowed


def together(n: int) -> str:
    """How a shared activity or a story moment is introduced: `The three of them together`."""
    return "What the child is doing" if n == 1 else f"The {count_words(n)} of them together"


def fill_children(text: str, n: int) -> str:
    """The taste tables' child tokens, for a cast of `n`. At n == 3 every token becomes exactly
    the words the tables carried before they were tokenized (2026-10-12), so the prompt — and
    the draw digest that decides whether a cached picture is reused — does not move by a byte.

        {the_children}  the three children   /  the child           (n == 1)
        {The_children}  The three children   /  The child
        {count}         three                /  one
        {Count}         Three                /  One
        {all_of_them}   all three            /  both (n == 2)  /  the child (n == 1)
        {All_of_them}   All three            /  Both           /  The child
        {are}           are                  /  is                          (verb agreement)
        {s}             (nothing)            /  s     — `stand{s}` reads `stands` for one child

    A table entry that only makes sense for some headcounts says so with `cast` (a list of the
    counts it was written for, e.g. `[3]` for "two of them ... while the third"); `cast_fits`
    is the one test of it.
    """
    if "{" not in text:
        return text
    words = count_words(n)
    all_of = "the child" if n == 1 else "both" if n == 2 else f"all {words}"
    phrase = the_children(n)
    # Plain replacement, not str.format: the same strings carry `{crowd}` and `{building}`
    # slots that are filled elsewhere, and must pass through untouched.
    for token, value in (
        ("{the_children}", phrase), ("{The_children}", phrase[0].upper() + phrase[1:]),
        ("{count}", words), ("{Count}", words[0].upper() + words[1:]),
        ("{all_of_them}", all_of), ("{All_of_them}", all_of[0].upper() + all_of[1:]),
        ("{are}", "is" if n == 1 else "are"), ("{s}", "s" if n == 1 else ""),
    ):
        text = text.replace(token, value)
    return text


def avatars(cast: dict) -> tuple[str, ...]:
    """Each child's committed portrait, in slot order — what the edit model is handed and what
    the finder matches crops against. Replaces the two hardcoded `AVATARS` triples."""
    return tuple(c["avatar"] for c in cast["children"])


def slots(cast: dict) -> tuple[int, ...]:
    """The WALL slot each portrait's tap region is written under, in portrait order.

    Not the cast's own `slot` numbers: the wall joins a child to a region through
    `slotForChild(sortOrder, childCount) = sortOrder % childCount` (web/src/views/logic/
    sceneFace.ts), so portrait p is wall slot p % n. For three that is (1, 2, 0) — exactly the
    `SLOTS` constant scene-regions.py carried — and matching on the bare number is the trap that
    silently dropped the third child (CLAUDE.md)."""
    n = len(cast["children"])
    return tuple(c["slot"] % n for c in cast["children"])


def cast_path() -> pathlib.Path:
    """`SCENE_CAST` (a path) wins over the real file, which wins over the example. The override
    is how a test or a second household points the scene tools at a cast without touching the
    gitignored `db/cast.json`."""
    override = os.environ.get("SCENE_CAST", "").strip()
    if override:
        path = pathlib.Path(override)
        return path if path.is_absolute() else (REPO / path)
    return CAST_REAL if CAST_REAL.exists() else CAST_EXAMPLE


def load_cast() -> dict:
    path = cast_path()
    with open(path, encoding="utf-8") as fh:
        cast = json.load(fh)
    try:
        cast["source"] = str(path.resolve().relative_to(REPO))
    except ValueError:
        cast["source"] = str(path)
    children = cast.get("children") or []
    if not children:
        raise SystemExit(
            f"{path}: scenes need at least one child in the cast; set scenes.mode to static or off")
    if len(children) > MAX_CAST:
        raise SystemExit(f"{path}: the cast has {len(children)} children; scenes draw at most {MAX_CAST}")
    cast["children"] = sorted(children, key=lambda c: c["slot"])
    if [c["slot"] for c in cast["children"]] != list(range(1, len(children) + 1)):
        raise SystemExit(f"{path}: child slots must be 1..{len(children)}, eldest first")
    for c in cast["children"]:
        missing = [k for k in ("avatar", "sex", "age", "height_cm", "hair") if k not in c]
        if missing:
            raise SystemExit(f"{path}: child {c['slot']} is missing {', '.join(missing)}")
    return cast


def landmark(short_cm: float, tall_cm: float, tall: str) -> str:
    """The point on the taller child that the shorter one's head reaches."""
    ratio = short_cm / tall_cm
    for frac, phrase in _LANDMARKS:
        if ratio >= frac:
            return phrase.format(tall=tall)
    raise AssertionError("unreachable")


def pronoun(child: dict) -> tuple[str, str]:
    return ("she", "her") if child["sex"] == "girl" else ("he", "his")


def roster_lines(cast: dict, with_portraits: bool) -> str:
    """One numbered line per child: age, sex, hair, and the optional `looks` build clause. The
    numbers are PORTRAIT numbers when the avatars are attached and plain child numbers when they
    are not, and either way they are the slot numbers the tap regions are written against.

    `looks` stops here. `finder_lines` does not take it, on the eye-colour reasoning: the finder
    is scored against what survives a change of clothes AND a change of style, and "sturdy" is
    not that at a quarter of the frame. Giving a verifier a weak signal does not make it stricter,
    it gives it something irrelevant to refuse a good picture over."""
    out = []
    words = ordinal_words(len(cast["children"]))
    for c in cast["children"]:
        who = f"portrait {c['slot']}" if with_portraits else f"child {c['slot']}"
        # "The eldest", and for a single child "The child" rather than "The the child".
        word = words[c["slot"] - 1]
        name = word[0].upper() + word[1:] if word.startswith("the ") else f"The {word}"
        # `looks` is optional and recent: a cast file written before 2026-09-16 has no such
        # key, and a KeyError here would take out every generator at once.
        build = c.get("looks", "").strip()
        out.append(
            f"  {c['slot']}. {name} ({who}): a {c['sex']} of {c['age']} "
            f"with {c['hair']}."
            + (f" {build[0].upper()}{build[1:]}." if build else "")
        )
    return "\n".join(out)


def height_lines(cast: dict) -> str:
    """The height order, as landmarks rather than centimetres. Empty for a single child: there
    is no order to keep, and the caller drops the empty line.

    Every child between the first and the last is measured against the tallest; the last is
    measured against the tallest AND the one just above, which for three is exactly the
    sentence this function always wrote."""
    kids = cast["children"]
    if len(kids) == 1:
        return ""
    first, last = kids[0], kids[-1]
    tall = f"child {first['slot']}"
    parts = [
        "Their ages show in their size and the difference is plain at a glance.",
        f"Child {first['slot']} is the {'taller' if len(kids) == 2 else 'tallest'}.",
    ]
    for i, x in enumerate(kids[1:-1]):
        _, her = pronoun(x)
        parts.append(
            f"Child {x['slot']} is shorter{' again' if i else ''}: the top of {her} head comes up "
            f"to {landmark(x['height_cm'], first['height_cm'], tall)}."
        )
    _, her = pronoun(last)
    if len(kids) == 2:
        parts.append(
            f"Child {last['slot']} is shorter: the top of {her} head comes up to "
            f"{landmark(last['height_cm'], first['height_cm'], tall)}."
        )
    else:
        above = kids[-2]
        parts.append(
            f"Child {last['slot']} is much the smallest: the top of {her} head comes up to "
            f"{landmark(last['height_cm'], first['height_cm'], tall)}, and to "
            f"{landmark(last['height_cm'], above['height_cm'], f'child {above['slot']}')}."
        )
    parts.append("Keep that order however they are posed — standing, sitting, crouching or mid-air.")
    return " ".join(parts)


def find_lines(cast: dict, rng) -> str:
    """How hard each child is to find, drawn fresh for this picture inside her own limits.

    The household asked for this on 2026-09-23 and asked for it as LIMITS: the eldest should
    have to search, the youngest should spot himself at once — *"but it doesn't have to be
    consistent."* So each child carries a band in `db/cast.json` and the picture picks a point
    in it, seeded like everything else, rather than being told one size forever. A child drawn
    the same size every week is a puzzle solved once.

    Said as DEPTH, not as a measurement. A model has no idea what 1.2 inches on a 21-inch panel
    means, and `height_lines` already learned that lesson for relative height: it knows what
    "well back among the crowd" looks like. The numbers are the finder's business, not the
    artist's.

    The HEIGHT ORDER still holds and is stated again here, because these bands overlap on
    purpose — the eldest's ceiling is below the youngest's — and an artist handed "child 1 is
    far away, child 3 is close" could reasonably draw the three-year-old taller on the glass
    than his sister. He may be nearer; he is never bigger.
    """
    words = []
    for c in cast["children"]:
        band = c.get("find") or {}
        lo, hi = band.get("min_in", 1.5), band.get("max_in", 1.5)
        # Where in her own band this picture sits: the same seeded rng the rest of the brief
        # uses, so a re-run repeats and next week does not.
        at = lo + (hi - lo) * rng.random()
        # The WORDS come from the absolute size, not from where the draw sits inside the band.
        # Deriving them per-band looked right and was not: the bands overlap on purpose, so a
        # low draw for the youngest read as "more hidden" than a high draw for the eldest and
        # the whole gradient inverted. One scale for all three, and the bands then decide how
        # often each child can reach each rung.
        where = (
            "well back in the scene among other people and things, genuinely hidden — the "
            "reward for looking" if at < 1.3
            else "in the middle distance, partly behind or among other things" if at < 2.2
            else "near the front and easy to pick out at a glance"
        )
        words.append(f"  Child {c['slot']} is {where}.")
    n = len(cast["children"])
    if n == 1:
        # One child: the band still decides how hidden she is, and there is no order to keep.
        return (
            "HOW FAR AWAY THE CHILD IS. This is the picture's game — the child may be meant to "
            "take a moment to find.\n" + "\n".join(words)
        )
    most, least = ("taller", "smaller") if n == 2 else ("tallest", "smallest")
    return (
        "HOW FAR AWAY EACH ONE IS. They are not all at the same distance, and this is the "
        "picture's game — one of them is meant to take a moment to find.\n"
        + "\n".join(words)
        + f"\nWhatever their distance, the HEIGHT ORDER above still reads: child 1 is the "
        f"{most} child and child {n} the {least}, so a nearer young child is never drawn "
        "taller on the page than an older one further back."
    )


def finder_lines(cast: dict) -> str:
    """The same children as the FINDER needs them: the features that survive a change of
    clothes and a change of style, and nothing else."""
    kids = cast["children"]
    n = len(kids)
    if n == 1:
        x = kids[0]
        return f"  - Child {x['slot']}: the only one, a {x['sex']} with {x['hair']}."
    if n == 2:
        rank = ["elder and taller", "younger and smaller"]
    else:
        rank = (["eldest and tallest"]
                + (["middle one in age and size"] if n == 3
                   else [f"{w} in age and size" for w in ordinal_words(n)[1:-1]])
                + ["youngest and smallest"])
    return "\n".join(
        f"  - Child {x['slot']}: the {rank[i]} of the {count_words(n)}, a {x['sex']} with {x['hair']}."
        for i, x in enumerate(kids)
    )


def dog_lines(cast: dict) -> tuple[str, str]:
    """(what he looks like, how big he is) — and the second half is the picture's SCALE ANCHOR.

    Both halves used to be hardcoded, twice: `DOG_V2` in gen-scene.py told the artist and
    `DOG_DESCRIPTION` in scene-regions.py told the finder, and `db/cast.json` carried a "dog"
    string that NOTHING READ. Three copies of one fact, one of them decorative.

    THE SIZE LINE IS THE POINT OF THIS FUNCTION. Both copies said he was "about a tenth of the
    picture's height", which is a fact about the FRAME and not about the world: it tells a model
    how many pixels to spend and nothing at all about how big a dog is, so nothing in the
    picture has a known size and everything is free to be any size. Asked for 2026-09-16 in
    exactly those terms — *"if there's like a dog or a small tree or a banana as a reference
    point, would it scale based on their heights? Because there could be a giant banana."*

    So he is measured against the CHILDREN, who are measured, using the same landmark table the
    height lines use. He is the one object in every scene whose real size is known, which makes
    him the anchor everything else in the picture is drawn against.
    """
    dog = cast.get("dog")
    if dog is None:
        # No dog in this household: no hidden dog in the picture, and no scale anchor. Both
        # callers drop the clause when they get empty strings.
        return "", ""
    if not isinstance(dog, dict):
        raise SystemExit("cast: `dog` must be an object with breed, height_cm and length_cm")
    youngest = cast["children"][-1]
    slot = youngest["slot"]
    tall_cm = youngest["height_cm"]
    how_tall = landmark(dog["height_cm"], tall_cm, f"child {slot}")
    ratio = dog["length_cm"] / tall_cm
    if ratio >= 1.1:
        how_long = f"a good deal longer than child {slot} is tall"
    elif ratio >= 0.9:
        how_long = f"almost exactly as long as child {slot} is tall"
    else:
        how_long = f"about {round(ratio * 100)}% as long as child {slot} is tall"
    size = (
        f"He is a REAL dog of a known size, and he is the thing everything else in the picture "
        f"is scaled against: standing on all fours his shoulders come up to {how_tall}, and "
        f"nose to tail he is {how_long}. Every other object in the picture — a tree, a chair, a "
        f"piece of fruit — is the size it would really be beside a dog that size."
    )
    return dog["breed"], size


def selftest() -> None:
    """`npm run verify:cast`: the counting words for every size, and the example cast through
    every line builder at every size it can be cut to. Free; reads no secret."""
    import random

    want = {
        1: ["the child"], 2: ["elder", "younger"], 3: ["eldest", "middle one", "youngest"],
        4: ["eldest", "second", "third", "youngest"],
        5: ["eldest", "second", "third", "fourth", "youngest"],
    }
    for n, words in want.items():
        assert ordinal_words(n) == words, (n, ordinal_words(n))
        assert count_words(n) == _COUNT[n - 1]
    for bad in (0, MAX_CAST + 1):
        for fn in (ordinal_words, count_words):
            try:
                fn(bad)
            except ValueError:
                pass
            else:
                raise AssertionError(f"{fn.__name__}({bad}) did not refuse")
    with open(CAST_EXAMPLE, encoding="utf-8") as fh:
        example = json.load(fh)
    for n in range(1, len(example["children"]) + 1):
        cast = dict(example, children=example["children"][:n])
        for with_dog in (True, False):
            c = dict(cast) if with_dog else {k: v for k, v in cast.items() if k != "dog"}
            roster = roster_lines(c, with_portraits=True)
            assert roster.count("\n") == n - 1, roster
            assert "The the" not in roster
            heights = height_lines(c)
            assert (heights == "") == (n == 1), heights
            assert "Child" in find_lines(c, random.Random(1))
            assert finder_lines(c).count("\n") == n - 1
            breed, size = dog_lines(c)
            assert bool(breed) == with_dog and bool(size) == with_dog
            assert len(avatars(c)) == n and len(slots(c)) == n
    three = dict(example)
    assert slots(three) == (1, 2, 0), slots(three)
    # The taste-table tokens: at three they are the words the tables carried before.
    probe = "{The_children} {are} here; {all_of_them} stand{s}; {count} of {crowd}"
    assert fill_children(probe, 3) == "The three children are here; all three stand; three of {crowd}"
    assert fill_children(probe, 2) == "The two children are here; both stand; two of {crowd}"
    assert fill_children(probe, 1) == "The child is here; the child stands; one of {crowd}"
    assert cast_fits({}, 1) and cast_fits({"cast": [3]}, 3) and not cast_fits({"cast": [3]}, 2)
    print(f"scene_cast selftest: ok (ordinal and count words for 1..{MAX_CAST}, "
          f"example cast cut to 1..{len(example['children'])} through every line builder)")


if __name__ == "__main__":
    import sys

    if sys.argv[1:] == ["--selftest"]:
        selftest()
        raise SystemExit(0)
    cast = load_cast()
    print(f"cast: {cast['source']}  (heights: {cast.get('height_source', '?')})\n")
    print(roster_lines(cast, with_portraits=True))
    print()
    print(height_lines(cast))
    print()
    print(finder_lines(cast))
    print()
    breed, size = dog_lines(cast)
    print(f"  dog: {breed}\n  {size}" if breed else "  dog: none")
