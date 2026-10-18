#!/usr/bin/env python3
"""Find the children in a generated scene and write its tap-region manifest.

    OP_SERVICE_ACCOUNT_TOKEN="$(cat ~/.config/op-service-token)" \
    op run --env-file=tools/op.env -- \
    python3 tools/scene-regions.py [--provider fal|nous] <id> assets/scenes/<id>.jpg assets/scenes/<id>.json
    python3 tools/scene-regions.py --dog-only   <id> <id>.jpg <id>.json  # patch an existing manifest
    python3 tools/scene-regions.py --heads-only <id> <id>.jpg <id>.json  # ditto, the rail's faces
    --dog-doing "<text>"        what the dog was drawn doing instead of hiding (scene-week passes
                                the same words it gave gen-scene; tools/scene-dog.json)
    --guests-file <list.json>   visiting family drawn in on purpose (scene-week writes it): named
                                to the locator as people who are NOT the portraits

THIS IS THE TAP-REGION LOCATOR, NOT A QUALITY GATE BOLTED ON. The household asked on
2026-09-12 whether the verification step was "the wrong path" — it had been introduced by one
picture with a child facing backwards. The answer is that the wall cannot draw a tap target
without this script whatever the generator does: the regions are what `SceneView.tsx` renders,
and a child who cannot be boxed cannot be tapped. The identity RUBRIC was the thing that had
drifted (it scored eye colour and matched clothes), and it was cut back the same day to what
the household actually means by "that's me": the count, the height order and the hair.

MOVED TO fal.ai the same day. Nous — the previous vision endpoint — is dry, and fal's
`any-llm/vision` serves Gemini 2.5 Flash, which located all three children in the campsite
scene from the WRITTEN description alone in three seconds. The description comes from
`scene_cast.py`, the same module the generator reads, so the finder looks for exactly the
children the prompt asked for.

WP-C of docs/scene-pipeline.md, and it is the BLOCKER rather than a convenience. While each
child was welded to a fixed activity in a fixed third of the frame, regions could be measured
by hand once and reused. From 2026-09-02 they are not: activities are drawn from
scene-activities.json and placement is free from the foreground to the middle distance, which
is what the household asked for. Nothing dynamic can reach the wall until this works.

WHY IT MATTERS MORE THAN IT SOUNDS. `web/src/views/logic/scenes.ts` states the stakes: the
navigation rail is HIDDEN on the scene screen, because on that screen the picture IS the
navigation — you find yourself in it and tap yourself. So a region that misses, or boxes the
wrong child, is not a slightly degraded screen. It is a dead end that looks exactly like a
working one: a child taps herself, nothing happens, and there is no visible way onward.

THEREFORE THIS REFUSES RATHER THAN GUESSES. Five checks, all of which must pass, and a scene
that fails any of them is not written. A failed run costs one week's novelty; the committed
scenes in SCENE_IDS are the floor and the wall keeps showing one of those.

THE DOG IS THE EASTER EGG, AND HE IS NEVER A REASON TO REFUSE. Since 2026-09-15 a second,
cheap call asks where the dog is hiding, and his box goes into the manifest as a top-level
`dog` beside `regions`. A tap there opens his week (`JaxSheet`) rather than a child's screen.
He is optional at every step: not found means no `dog` key, a box that lands on a child's
target is dropped with a note, and `check` never sees him — the children are the navigation
and the dog is a joke, and a joke may not cost the household a picture. `--dog-only` runs
just that pass and patches a manifest the finder already wrote, which is how every scene
approved before the egg existed got one without being re-verified.

DISCLOSURE: the image sent is a generated house asset and the prompt names no one — the
children are addressed as "portrait 1/2/3" and by age, hair and relative size, exactly as the
generator addresses them. `enforce` and `enforce_references` run here as they do everywhere.
"""
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request

from PIL import Image

import fal_api
import scene_guests  # noqa: E402  (visiting family: the locator's decoys)
from gen_icon_shim import ENDPOINT, data_uri
from prompt_guard import enforce, enforce_references
from scene_cast import avatars, count_words, dog_lines, finder_lines, load_cast, slots

# A vision model that returns TEXT, not an image model.
#
# Overridable, because the right answer depends on what the account can afford. Nous has
# exactly ONE image-generating model and it is paid — but seven free text models, and one of
# them (`stepfun/step-3.7-flash:free`) accepts image input, which would make this whole step
# cost nothing:
#
#     SCENE_VISION_MODEL="stepfun/step-3.7-flash:free" python3 tools/scene-regions.py ...
#
# The default stays the accurate one ON PURPOSE. A wrong box is a dead end that looks like a
# working screen, so this is the last place in the pipeline to economise: a pass costs ~$0.007,
# about 5% of the $0.14 generation it is checking, and a free model that mislocates one child
# in twenty costs far more than it saves. Switch the default only after running both over the
# same scenes and comparing the boxes.
VISION_MODEL = os.environ.get("SCENE_VISION_MODEL", "google/gemini-3.8-flash")

# Which door the vision calls go through. Set once from the CLI; `ask_images` reads it.
PROVIDER = "fal"

# IDENTITY IS HAIR AND RELATIVE SIZE, NOT CLOTHING AND NOT EYES.
#
# 2026-09-05: clothing dropped. Until then each child wore their own accent colour in every
# scene and the match was made on hair plus garment. The household dropped that: real children
# do not wear one colour, and clothes should follow the weather.
#
# 2026-09-12: eye colour dropped too, and the rubric written down as the household means it —
# "maybe what it is is I want the relative size". At scene scale an eye is two pixels on the
# glass; it cannot help a child find herself and it gave the verifier something irrelevant to
# fail a good picture on. The description the matcher works from now comes from scene_cast.py,
# the same words the generator was given, so what is asked for and what is looked for cannot
# drift apart again.
#
# Portraits 2 and 3 are BOTH blonde, so they are separated by hair LENGTH (long vs short) and
# by SIZE. Relative height is the sturdiest signal there is: it survives a hat, a coat and a
# change of season, none of which hair reliably does. Oldest and tallest is portrait 1, then
# 2, then 3.
#
# The portraits and the slots come from the cast sheet (`scene_cast.avatars` / `slots`), so a
# household of one, two, four or five is found the same way. For three they are a.jpg, b.jpg,
# c.jpg and slots (1, 2, 0): portrait p is slot `p % n`, matching `slotForChild` on the wall
# (Child.sortOrder % n) and the generator's attachment order.


def portrait_list(n: int) -> str:
    """`portrait 1, portrait 2, portrait 3` — the order the reference portraits are attached."""
    return ", ".join(f"portrait {i}" for i in range(1, n + 1))


def locate_prompt(cast: dict) -> str:
    """The question `locate` asks. For three children this is, byte for byte, the text it asked
    before the cast could be any size (2026-10-12) — the finder's answers on the existing
    pictures were measured against exactly these words."""
    n = len(cast["children"])
    count = count_words(n)
    if n == 1:
        opening = ("The first image is a picture containing one particular child. The image "
                   "after it is a reference portrait of that child: portrait 1. The child is:\n")
        others, include = "this child", "Include the child."
    else:
        opening = (f"The first image is a picture containing {count} particular children. The "
                   f"{count} images after it are reference portraits of those children, in "
                   f"order: {portrait_list(n)}. The children are:\n")
        others = f"these {count}"
        include = "Include both." if n == 2 else f"Include all {count}."
    return (
        opening
        + finder_lines(cast) + "\n\n"
        "They may stand at DIFFERENT DISTANCES: one can be near the front and another further "
        "back, so a younger child near the front can look bigger on the page than an older one "
        "behind. Find each one and give a tight bounding box around that child ALONE — head to "
        "feet, including clothing, but NOT an animal they are riding, a thing they are sitting "
        "on, or another child.\n\n"
        "Match on HAIR COLOUR and HAIRSTYLE first. Judge age and size from each child's body "
        "proportions and against the things beside them, never from how big they are drawn on "
        "the page. Their clothes and faces are different in every picture and mean nothing. "
        f"Other people in the picture are not {others}; ignore them.\n\n"
        "Also give a second, much smaller box around that child's HEAD ALONE — hair and face, "
        "roughly from the top of the hair to the chin. The wall crops this one to show a child "
        "what she looks like in THIS picture, so it wants the head filling it, not the body.\n\n"
        'Answer with JSON only, no prose: {"children": [{"portrait": 1, "box_2d": [ymin, xmin, '
        'ymax, xmax], "head_2d": [ymin, xmin, ymax, xmax], '
        '"why": "<hair, then what they are wearing, in a few words>"}, ...]} with '
        f"coordinates normalised 0-1000 in the order ymin, xmin, ymax, xmax. {include} "
        'If you genuinely cannot find one, give it "box_2d": null rather than guessing. '
        'If you can find the child but not the head, give "head_2d": null.'
    )


def verify_prompt(cast: dict, n_crops: int) -> str:
    """The question `verify_identity` asks of `n_crops` crops. Byte-identical for three."""
    n = len(cast["children"])
    letters = "ABCDEFGH"[:n_crops]
    crops = ", ".join(f"crop {c}" for c in letters)
    if n_crops == 1:
        first = f"The first image is a crop taken from one picture: {crops}. "
    else:
        first = (f"The first {count_words(n_crops)} images are crops taken from one picture, in "
                 f"order: {crops}. ")
    if n == 1:
        refs = "The image after it is a reference portrait: portrait 1. The child is:\n"
        none_of = "the child"
    else:
        refs = (f"The {count_words(n)} images after them are reference portraits, in order: "
                f"{portrait_list(n)}. The children are:\n")
        none_of = "either of the two" if n == 2 else f"any of the {count_words(n)}"
    choices = "|".join(str(i) for i in range(1, n + 1))
    return (
        first + refs
        + finder_lines(cast) + "\n\n"
        "For each crop, say which portrait it shows, matching on HAIR COLOUR and HAIRSTYLE and "
        "on the child's apparent AGE and SIZE. Ignore clothing, eye colour and the exact face — "
        "the same child is drawn with different clothes and a different face in every picture. "
        "A crop should contain one child, mostly whole.\n\n"
        + CLOTHED_QUESTION[SWIMWEAR] +
        "And say whether their FACE IS VISIBLE — face on, three-quarter or in profile all "
        "count; the back of a head does not — and whether their head and body face the SAME "
        "direction. A child drawn from behind with their head twisted round over their "
        "shoulder to face the viewer has head and body facing OPPOSITE directions.\n\n"
        'Answer with JSON only: {"matches": [{"crop": "A", "portrait": <' + choices + '|null>, '
        '"mostly_whole": <true|false>, "fully_clothed": <true|false>, '
        '"face_visible": <true|false>, "head_and_body_agree": <true|false>}, ...]}. Use null '
        f"for portrait if the crop does not clearly show {none_of}."
    )

# The wall is 960x540 LOGICAL px (--force-device-scale-factor 2.0 on a 1920x1080 panel), and
# every threshold below is in those units because that is what a finger meets.
LOGICAL_W, LOGICAL_H = 960, 540
# LOWERED 2026-09-18, measured against a coin rather than reasoned about. On this panel one
# logical px is 0.496 mm, so the floors below had drifted to sizes nobody had ever converted:
# the preferred 96px was 47.6 mm — nearly two inches of glass per child — and the absolute 64px
# was 31.7 mm. The household's own measurement is that the children "can press and find a dime
# sized image", and a dime is 17.9 mm = 36 logical px. So every floor here was two to three
# times what the hands actually need, and the cost was paid by the PICTURE: three big figures
# near the front, because nothing smaller could pass.
TAP_FLOOR_PX = 48      # 23.8 mm, a quarter. The preferred floor and what every target is grown
                       # to — still comfortably larger than the coin the household measured.
ABS_TAP_FLOOR_PX = 36  # 17.9 mm, a dime exactly: the measured floor, not an inherited one. A
                       # target may be TRIMMED toward it, sideways only, to open a gutter.
GUTTER_PX = 12         # 6 mm of inert space between two targets. NOT scaled down as far as the
                       # others: this one is not about hitting a target, it is about not hitting
                       # the WRONG one, and two children standing together is the common case.
MAX_TRIM_PX = 24       # the most `fit_gutters` will shave off a pair: a gutter's worth of
                       # overlap plus the gutter itself; more than that is figure over figure.
# How small a child may be DRAWN, expressed in inches on the glass because that is the only
# unit the question has a real answer in. A fraction of the frame means nothing without the
# panel; 0.18 sounds modest and was 1.9 inches, which is a big figure and was quietly
# forcing every scene into three near-foreground poses.
#
# 0.9 inches since 2026-09-18, down from the 1.5 the household set on 2026-09-02 for the same
# reason they have now halved it again: to buy back room for expansive pictures. That is 46
# logical px, 8.5% of frame height.
#
# THIS FLOOR IS NOT THE TAP FLOOR AND THE DISTINCTION IS THE WHOLE POINT. The tap floors above
# are motor skill — can a finger land on it — and the household measured those directly. This
# one is EYESIGHT: can a child recognise herself in the figure at all. They move together here
# only because the same request drives both, and it should not be lowered further without
# someone standing at the wall, because the failure it prevents is a child who cannot find
# herself in her own picture and has no way to say why.
#
# At ten feet 0.9 inches subtends about 26 arcmin: a clear shape with hair and clothing colour
# still reading, facial detail gone. Colour and silhouette are the identity channel on this
# wall and detail is the reward for walking up (H8), so that is still the right side of the
# line — but it is now near it rather than comfortably clear of it.
#
# It is judged on the child AS DRAWN, before the tap-floor padding below, so the padding
# cannot launder a child who is genuinely too far back into a passing measurement.
PANEL_DIAGONAL_IN = 21.5
PANEL_HEIGHT_IN = PANEL_DIAGONAL_IN * 9 / math.hypot(16, 9)
MIN_CHILD_HEIGHT_IN = 0.9
MIN_HEIGHT_FRACTION = MIN_CHILD_HEIGHT_IN / PANEL_HEIGHT_IN


# Exit code for A DELIBERATE REFUSAL, as distinct from a crash.
#
# Both used to be 1 — Python's default for an uncaught exception — and on 2026-09-08 a 502 from
# the vision endpoint was therefore reported by the weekly runner as "the gate working: the
# region finder refused this picture". It had not refused anything; it never got an answer. A
# quality gate and a bad gateway must not look the same from outside, because the responses are
# opposite: one means try a different picture, the other means try the same picture again.
REFUSED = 3


def ask(messages: list, key: str, timeout: int = 180, attempts: int = 3) -> str:
    """One vision call, retried on transient upstream failures.

    Worth doing here rather than in the caller because a refusal has to MEAN something. Each
    call is about $0.002, and a single 5xx used to throw away a $0.14 image that was already
    generated and probably fine — the expensive half of the pipeline discarded by the cheap
    half having a bad second.

    Only 5xx and timeouts are retried. A 4xx is our own request being wrong and will be wrong
    again in four seconds; retrying it would just spend three times as long arriving at the
    same error with the original one buried.
    """
    body = json.dumps({"model": VISION_MODEL, "messages": messages}).encode()
    last: Exception | None = None
    for attempt in range(attempts):
        req = urllib.request.Request(
            ENDPOINT, data=body,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json",
                     "User-Agent": "family-calendar-regions/1.0"},
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                payload = json.load(resp)
            break
        except urllib.error.HTTPError as exc:
            if exc.code < 500:
                raise
            last = exc
        except (urllib.error.URLError, TimeoutError) as exc:
            last = exc
        if attempt + 1 < attempts:
            wait = 4 * (attempt + 1)
            print(f"  vision call failed ({last}); retrying in {wait}s", file=sys.stderr)
            time.sleep(wait)
    else:
        raise SystemExit(f"the vision endpoint failed {attempts} times: {last}")
    usage = payload.get("usage") or {}
    if usage.get("cost") is not None:
        print(f"  vision cost ${usage['cost']:.5f}", file=sys.stderr)
    return payload["choices"][0]["message"]["content"]


def ask_images(prompt: str, images: list[str], key: str, purpose: str) -> str:
    """One question about a list of images, through whichever door PROVIDER names. The prompt
    and the attachments are guarded here, once, so neither door can skip it."""
    enforce(prompt)
    enforce_references([p for p in images if p.startswith("assets/")])
    if PROVIDER == "fal":
        return fal_api.vision(prompt, [data_uri(p) for p in images], purpose)
    content = [{"type": "text", "text": prompt}]
    content += [{"type": "image_url", "image_url": {"url": data_uri(p)}} for p in images]
    return ask([{"role": "user", "content": content}], key)


def unfence(raw: str) -> str:
    text = raw.strip()
    if "```" in text:                      # models fence JSON however they like
        text = text.split("```")[1].removeprefix("json").strip()
    return text


def locate(scene: str, key: str) -> list[dict]:
    """Ask for one box per child. Coordinates are 0-1000, [ymin, xmin, ymax, xmax].

    The children are described in WORDS from the cast sheet and the portraits ride along as a
    second reference. Gemini finds them from the words alone (measured 2026-09-12); the
    portraits cost nothing to attach and settle the two blondes when a hairstyle is ambiguous.

    DISTANCE IS NOT AGE (2026-10-12). Since the find-difficulty bands (2026-09-24) the
    generator puts the children at different depths and says outright that a younger child in
    front may be taller on the page. This prompt still said "nearest and largest" and "match on
    RELATIVE SIZE", so the first picture that put the eldest far back (the swimming pair) had its
    two girls boxed the wrong way round, and the verifier, matching on hair, refused both. The
    verifier is unchanged: it still has to agree, crop by crop, or nothing is offered.

    The box order is Gemini's — [ymin, xmin, ymax, xmax] — and is asked for by name in the
    prompt. Qwen3-VL answered the same question in [xmin, ymin, xmax, ymax] on the same day, so
    a model change here is a coordinate-order change, which a wrong-but-plausible box will not
    announce. `sane_box` below refuses the cases it can see.
    """
    cast = load_cast()
    prompt = locate_prompt(cast)
    # VISITORS ARE THE LIKELIEST LOOK-ALIKES. A visiting cousin is blonde and child-sized on
    # purpose, which is exactly what the busy-town look-alike was (CLAUDE.md, 2026-09-13), so
    # the locator is told who they are. Without guests the question is byte-identical.
    if GUESTS:
        prompt = prompt.replace("Answer with JSON only",
                                scene_guests.finder_decoys(GUESTS) + "\n\nAnswer with JSON only", 1)
    raw = ask_images(prompt, [scene, *avatars(cast)], key, f"locate {os.path.basename(scene)}")
    try:
        return json.loads(unfence(raw))["children"]
    except Exception as exc:
        raise SystemExit(f"could not parse the vision answer: {exc}\n{raw[:400]}")


# What the generator is told to draw (`DOG_V2` in gen-scene.py), asked for in the same words.
def dog_description() -> tuple[str, str]:
    """(appearance, size) from `db/cast.json` — the SAME words the generator was given.

    Was a constant here and another constant in gen-scene.py, which is how the finder ended up
    describing a dog nobody had asked for. Same reasoning as `finder_lines` for the children.
    """
    return dog_lines(load_cast())


def locate_dog(scene: str, key: str) -> list | None:
    """Ask where the dog is hiding. One box, [ymin, xmin, ymax, xmax] in 0-1000, or None.

    A separate call from `locate`, not a fourth entry in it: the children's answer is parsed
    strictly and refuses on anything odd, and the dog must never be able to make that answer
    odd. He is about a tenth of the frame and half hidden by design, so "not found" is an
    ordinary outcome and is returned as None, never raised.
    """
    breed, size = dog_description()
    # What the artist was told he is doing (`--dog-doing`, tools/scene-dog.json). Without it he
    # was asked for hiding, and the finder looks for a dog half behind something.
    where = (f"He is {DOG_DOING}, on his own, away from the children." if DOG_DOING else
             "He is partly hidden: peering out of grass, half behind a tree, a rock, a bush or "
             "a fence.")
    prompt = (
        f"{'Somewhere' if DOG_DOING else 'Hidden somewhere'} in this picture is {breed}. "
        f"{size} {where} He is not one of the children "
        "and not posed with them.\n\n"
        "Find him and give a tight bounding box around the dog alone, including whatever part "
        "of him is visible.\n\n"
        'Answer with JSON only, no prose: {"dog": {"box_2d": [ymin, xmin, ymax, xmax], '
        '"where": "<a few words>"}} with coordinates normalised 0-1000 in the order ymin, '
        'xmin, ymax, xmax. If there is genuinely no such dog, answer {"dog": null}.'
    )
    raw = ask_images(prompt, [scene], key, f"locate dog {os.path.basename(scene)}")
    try:
        dog = json.loads(unfence(raw)).get("dog")
    except Exception as exc:
        print(f"  dog: could not parse the answer ({exc}); leaving him hidden", file=sys.stderr)
        return None
    if not isinstance(dog, dict) or dog.get("box_2d") is None:
        print("  dog: not found; leaving him hidden", file=sys.stderr)
        return None
    box = dog["box_2d"]
    if not (isinstance(box, list) and len(box) == 4
            and all(isinstance(v, (int, float)) for v in box)
            and all(0 <= v <= 1000 for v in box) and box[2] > box[0] and box[3] > box[1]):
        print(f"  dog: unusable box {box!r}; leaving him hidden", file=sys.stderr)
        return None
    print(f"  dog: {(dog.get('where') or '').strip()[:60]}", file=sys.stderr)
    return box


def dog_region(box: list, regions: list[dict]) -> dict | None:
    """The dog's tap target as fractions, grown to the floor, or None if it would touch a child.

    Grown like a child's target (`grow_to_tap_floor`) because a finger is the same size
    whatever it is aiming at. NOT trimmed to open a gutter and never a problem for `check`:
    if the padded box comes within the gutter of any child's target, the dog is dropped from
    this scene and the children keep their picture. Nothing about the egg may cost a scene.
    """
    x, y, w, h = to_fractions(box)
    r = {"x": x, "y": y, "w": w, "h": h}
    grow_to_tap_floor([r])
    for c in regions:
        gap_x = max(r["x"] - (c["x"] + c["w"]), c["x"] - (r["x"] + r["w"])) * LOGICAL_W
        gap_y = max(r["y"] - (c["y"] + c["h"]), c["y"] - (r["y"] + r["h"])) * LOGICAL_H
        if max(gap_x, gap_y) < GUTTER_PX - 1e-6:
            gap = max(gap_x, gap_y)
            how = f"overlaps slot {c['slot']}'s target" if gap < 0 else \
                f"{gap:.0f}px from slot {c['slot']}'s target"
            print(f"  dog: {how} — dropped, the children come first", file=sys.stderr)
            return None
    print(f"  dog   {r['w'] * LOGICAL_W:5.0f}x{r['h'] * LOGICAL_H:5.0f} logical px"
          f"  at ({r['x']:.3f}, {r['y']:.3f})", file=sys.stderr)
    return {k: round(v, 4) for k, v in r.items()}


FLAT_SCALE = False   # set by --flat-scale; see `floor_in_for`
SWIMWEAR = False     # set by --swimwear; changes what "fully clothed" is asked as, never whether
DOG_DOING = ""       # set by --dog-doing; what the dog was drawn doing, when not hiding
GUESTS: list = []    # set by --guests-file; visiting family the locator must not box

# The clothed question, two ways. The swimwear form exists for a setting an adult forced with
# `swimwear: true` (BACKLOG 4.11). It is still a yes/no question about a covered top AND covered
# bottoms — a swim shirt is allowed to BE the top, nothing else changes — and the answer is
# still read with `is not True`, so a bare-chested child is refused in a pool exactly as in a park.
CLOTHED_QUESTION = {
    False: (
        "Also say whether that child is FULLY CLOTHED: wearing both a top and bottoms. A child "
        "who is bare-chested, in swimwear or in underwear is NOT fully clothed.\n\n"
    ),
    True: (
        "This is a swimming picture. Also say whether that child is FULLY CLOTHED FOR SWIMMING: "
        "a swim shirt or swimsuit top that covers the chest, AND swim shorts or swimsuit bottoms. "
        "A child who is bare-chested, wearing bottoms only, or in underwear is NOT fully "
        "clothed. Answer fully_clothed true only if you can see both.\n\n"
    ),
}


def floor_in_for(portrait: int) -> float:
    """The smallest this child may be DRAWN, in inches on the glass.

    Per-child, from `db/cast.json` `find.min_in`. A cast written before find-difficulty existed
    has no such key and every child falls back to `MIN_CHILD_HEIGHT_IN`, which is also the
    absolute below which no child is recognisable however easy she is supposed to be to find.
    """
    if FLAT_SCALE:
        # Every figure is drawn at one size by instruction, so a per-child floor would refuse
        # the youngest for obeying it. One floor, the absolute one.
        return MIN_CHILD_HEIGHT_IN
    for c in load_cast()["children"]:
        if c["slot"] == portrait:
            return float((c.get("find") or {}).get("min_in", MIN_CHILD_HEIGHT_IN))
    return MIN_CHILD_HEIGHT_IN


def head_box(raw, body: tuple[float, float, float, float]) -> dict | None:
    """The head crop for the rail, or None — in which case the rail keeps the cartoon avatar.

    Checked against the child's OWN body box rather than against absolute limits, because that
    is the only thing that can catch the failure that matters: a model that answers the head
    question with the body box again. That is not a wrong number, it is a plausible one, and it
    would put a full-length figure in a 64px circle where a face should be — the exact shape of
    bug this repo keeps shipping. A head is roughly the top fifth of a standing child and never
    more than half of them; anything bigger is the body, and anything outside the body box is a
    different child.
    """
    if raw is None or sane_box(raw) is not None:
        return None
    hx, hy, hw, hh = to_fractions(raw)
    bx, by, bw, bh = body
    if hh > bh * 0.5 or hw > bw * 1.2:
        return None                                   # that is the body again, or a crowd
    if hx + hw < bx or hx > bx + bw or hy + hh < by or hy > by + bh:
        return None                                   # not on this child at all
    return {"x": round(hx, 4), "y": round(hy, 4), "w": round(hw, 4), "h": round(hh, 4)}


def sane_box(box: list) -> str | None:
    """The reason a box cannot be a [ymin, xmin, ymax, xmax] box in 0-1000, or None."""
    if not (isinstance(box, list) and len(box) == 4
            and all(isinstance(v, (int, float)) for v in box)):
        return f"not four numbers: {box!r}"
    y0, x0, y1, x1 = box
    if not all(0 <= v <= 1000 for v in box):
        return f"outside 0-1000: {box}"
    if y1 <= y0 or x1 <= x0:
        return f"max not above min: {box}"
    # A standing child is taller than wide. A box that is much wider than tall in a landscape
    # frame is more likely a transposed answer than a child lying down.
    if (x1 - x0) * (9 / 16) > 2.0 * (y1 - y0):
        return f"wider than tall by more than 2:1 — transposed coordinate order? {box}"
    return None


def to_fractions(box: list[float]) -> tuple[float, float, float, float]:
    """[ymin, xmin, ymax, xmax] out of 1000 -> (x, y, w, h) as fractions, clamped to frame."""
    ymin, xmin, ymax, xmax = (max(0.0, min(1000.0, float(v))) for v in box)
    x, y = xmin / 1000.0, ymin / 1000.0
    return x, y, max(0.0, xmax / 1000.0 - x), max(0.0, ymax / 1000.0 - y)


def grow_to_tap_floor(regions: list[dict]) -> None:
    """Expand each box, about its own centre, until it meets the tap floor. In place.

    THE CHILD IS WHAT YOU LOOK FOR; THE TARGET IS WHAT YOU TOUCH, and they do not have to be
    the same rectangle. This exists because the first real run refused a perfectly good scene:
    two children measured 74x149 and 77x151 logical px — heights comfortably over the 96px
    floor, widths under it — for the obvious reason that a standing child is about 2.5 times
    taller than she is wide. Demanding 96px in BOTH axes of a figure's own bounding box is
    really demanding a much larger figure, which would have quietly undone the household's
    actual request: that the three of them can be anywhere from the foreground to the middle
    distance rather than always looming across the bottom edge.

    So the box grows and the child does not. A 74px-wide box padded to 96 is still centred on
    her, and the padding is grass. What is NOT relaxed is anything about being able to see her:
    `MIN_HEIGHT_FRACTION` still refuses a child drawn too far back to recognise, and the gutter
    check below runs AFTER this expansion, so if growing two targets makes them collide the
    scene is still refused. Nothing here lowers the 96px floor; it stops measuring the wrong
    rectangle against it.
    """
    for r in regions:
        need_w = TAP_FLOOR_PX / LOGICAL_W
        need_h = TAP_FLOOR_PX / LOGICAL_H
        if r["w"] < need_w:
            r["x"] -= (need_w - r["w"]) / 2
            r["w"] = need_w
        if r["h"] < need_h:
            r["y"] -= (need_h - r["h"]) / 2
            r["h"] = need_h
        # Clamp back inside the frame without shrinking below the floor again.
        r["x"] = max(0.0, min(r["x"], 1.0 - r["w"]))
        r["y"] = max(0.0, min(r["y"], 1.0 - r["h"]))


def fit_gutters(regions: list[dict]) -> None:
    """Open the gutter between two neighbouring targets by TRIMMING them, not refusing.

    The same principle as `grow_to_tap_floor`, in the other direction. On 2026-09-12 the finder
    refused the two best pictures of the morning — three children walking abreast, exactly the
    grouping every photograph of three children has — for a 1px and a 5px gap between two
    targets it had itself just grown to 96px. The CHILDREN were not touching; the padding was.

    A target that is 96px wide and 260px tall can lose 16px of width and still be a target
    nobody misses: the trim comes off the side that faces the neighbour, which is an arm or a
    sleeve, and the head and body stay inside. So a colliding pair gives up the shortfall
    between them, the wider one first, and neither goes under `ABS_TAP_FLOOR_PX` — the
    household's absolute 64px floor, which is about motor skill and does not move. If the pair
    cannot open the gutter within that, `check` refuses the scene exactly as before.

    Only a little. A shortfall bigger than `MAX_TRIM_PX` is not padding touching padding, it is
    one figure drawn across another — a child in front of a child — and that is a picture to
    refuse, not a pair of rectangles to shave into slivers.

    VERTICALLY TOO, since 2026-10-18. It was sideways only, which assumed the children stand in
    a row. A small child in the BACKGROUND stands above a big one in the foreground instead —
    the composition the household asked for ("I like the option of having kids smaller and in
    the background") — and `2026w43-autumn-forest-nb2` was refused for an 8px gap between a
    girl at a leaf hut and the boy below her, which no sideways trim can open because the two
    boxes overlap across their whole width. So the pair is opened along whichever axis is
    nearer: a stacked pair gives up the bottom of the upper box first (feet and knees, never
    the head that tells her apart), then the top of the lower one, and neither goes under
    `TAP_FLOOR_PX` in height — the floor `check` holds every height to.
    """
    abs_floor_w = ABS_TAP_FLOOR_PX / LOGICAL_W
    floor_h = TAP_FLOOR_PX / LOGICAL_H
    for i, a in enumerate(regions):
        for b in regions[i + 1:]:
            gap_x = max(a["x"] - (b["x"] + b["w"]), b["x"] - (a["x"] + a["w"])) * LOGICAL_W
            gap_y = max(a["y"] - (b["y"] + b["h"]), b["y"] - (a["y"] + a["h"])) * LOGICAL_H
            if max(gap_x, gap_y) >= GUTTER_PX:
                continue                       # already clear on one axis; nothing to open
            short_x, short_y = GUTTER_PX - gap_x, GUTTER_PX - gap_y
            for axis in sorted(("x", "y"), key=lambda k: short_x if k == "x" else short_y):
                short_px = short_x if axis == "x" else short_y
                if short_px > MAX_TRIM_PX:
                    continue
                if axis == "x":
                    # Sideways: from the wider target first, then split what is left.
                    left, right = (a, b) if a["x"] <= b["x"] else (b, a)
                    short = short_px / LOGICAL_W
                    for r, side in sorted(((left, "right"), (right, "left")), key=lambda t: -t[0]["w"]):
                        give = min(short, max(0.0, r["w"] - abs_floor_w))
                        if give <= 0:
                            continue
                        r["w"] -= give
                        if side == "left":
                            r["x"] += give
                        r["trimmed"] = True
                        short -= give
                        if short <= 1e-9:
                            break
                else:
                    # Stacked: the upper box's feet first, then the lower box's top.
                    upper, lower = (a, b) if a["y"] <= b["y"] else (b, a)
                    short = short_px / LOGICAL_H
                    for r, side in ((upper, "bottom"), (lower, "top")):
                        give = min(short, max(0.0, r["h"] - floor_h))
                        if give <= 0:
                            continue
                        r["h"] -= give
                        if side == "top":
                            r["y"] += give
                        r["trimmed_h"] = True      # height only; the width floor is untouched
                        short -= give
                        if short <= 1e-9:
                            break
                if short <= 1e-9:
                    break


def check(regions: list[dict], children: int = 3) -> list[str]:
    """Every reason this scene must not be promoted. Empty list means it may be."""
    problems: list[str] = []
    if len(regions) != children:
        problems.append(f"found {len(regions)} of {children} children")
    for r in regions:
        w_px, h_px = r["w"] * LOGICAL_W, r["h"] * LOGICAL_H
        floor_w = ABS_TAP_FLOOR_PX if r.get("trimmed") else TAP_FLOOR_PX
        if w_px < floor_w or h_px < TAP_FLOOR_PX:
            problems.append(
                f"slot {r['slot']}: {w_px:.0f}x{h_px:.0f} logical px is under the "
                f"{floor_w}x{TAP_FLOOR_PX}px floor"
            )
    for i, a in enumerate(regions):
        for b in regions[i + 1:]:
            gap_x = max(a["x"] - (b["x"] + b["w"]), b["x"] - (a["x"] + a["w"])) * LOGICAL_W
            gap_y = max(a["y"] - (b["y"] + b["h"]), b["y"] - (a["y"] + a["h"])) * LOGICAL_H
            gap = max(gap_x, gap_y)
            if gap < GUTTER_PX - 1e-6:         # a gutter opened to exactly 16px is 16px
                problems.append(
                    f"slots {a['slot']} and {b['slot']}: {gap:.0f}px apart, under the {GUTTER_PX}px gutter"
                )
    return problems


def verify_identity(scene: str, regions: list[dict], key: str) -> list[str]:
    """The check that catches the failure the others cannot: a box on the WRONG child.

    Crops are sent rather than coordinates, because "does this picture show the blonde one
    with the ponytail" is a question a vision model answers far more reliably than "is your
    own earlier box correct".
    """
    im = Image.open(scene).convert("RGB")
    W, H = im.size
    tmp = os.path.join("/tmp", f"region-{os.getpid()}")
    os.makedirs(tmp, exist_ok=True)
    crops = []
    for r in regions:
        c = im.crop((int(r["x"] * W), int(r["y"] * H),
                     int((r["x"] + r["w"]) * W), int((r["y"] + r["h"]) * H)))
        path = os.path.join(tmp, f"slot{r['slot']}.png")
        c.save(path)
        crops.append(path)

    cast = load_cast()
    prompt = verify_prompt(cast, len(crops))
    raw = ask_images(prompt, [*crops, *avatars(cast)], key, f"verify {os.path.basename(scene)}")
    try:
        matches = json.loads(unfence(raw))["matches"]
    except Exception as exc:
        return [f"identity check unreadable: {exc}"]

    problems = []
    for letter, r, m in zip("ABCDEFGH", regions, matches):
        if m.get("portrait") != r["portrait"]:
            problems.append(
                f"slot {r['slot']}: box holds portrait {m.get('portrait')}, expected {r['portrait']}"
            )
        if m.get("mostly_whole") is False:
            problems.append(f"slot {r['slot']}: the child is cut off by her own box")
        # THE ONE THAT IS NOT ABOUT TAPPING. A seed on 2026-09-03 drew the youngest child
        # bare-chested: the prompt asked for clothing in his accent colour and the model
        # satisfied it with trousers alone. This picture hangs in a living room that children
        # and guests stand in front of, so a prompt line asking nicely is not the mechanism —
        # the refusal is. `is not True` rather than `is False` on purpose: a model that
        # declines to answer, or answers in a shape we cannot read, must not pass.
        if m.get("fully_clothed") is not True:
            problems.append(
                f"slot {r['slot']}: not confirmed fully clothed — refusing rather than shipping it"
            )
        # Findability, not decorum. A child taps HERSELF in this picture and the rail is hidden
        # here, so a child drawn from behind is a child who cannot navigate — and the crop match
        # above gets much weaker with no face in it, which makes every other check softer too.
        if m.get("face_visible") is not True:
            problems.append(f"slot {r['slot']}: face not visible — she cannot find herself")
        # The pose that started this: back to the viewer, head cranked round over the shoulder.
        if m.get("head_and_body_agree") is not True:
            problems.append(
                f"slot {r['slot']}: head and body face opposite ways — the head reads as on backwards"
            )
    return problems


def main(scene_id: str, image: str, dst: str) -> None:
    key = os.environ["NOUS_API_KEY"] if PROVIDER == "nous" else ""
    if PROVIDER == "fal":
        fal_api.key()   # fail on a missing key before the first call, not inside it
    cast = load_cast()
    n = len(cast["children"])
    slot_of = slots(cast)
    print(f"locating {count_words(n)} children in {image} via {PROVIDER}", file=sys.stderr)
    found = locate(image, key)

    regions = []
    bad_boxes = []
    for entry in found:
        p = entry.get("portrait")
        if entry.get("box_2d") is None or p not in range(1, n + 1):
            continue
        why = sane_box(entry["box_2d"])
        if why:
            bad_boxes.append(f"portrait {p}: unusable box — {why}")
            continue
        x, y, w, h = to_fractions(entry["box_2d"])
        region = {"slot": slot_of[p - 1], "portrait": p, "x": x, "y": y, "w": w, "h": h,
                  "find": (entry.get("why") or "").strip()[:70]}
        head = head_box(entry.get("head_2d"), (x, y, w, h))
        if head is not None:
            region["head"] = head
        regions.append(region)
    regions.sort(key=lambda r: r["portrait"])

    # Height is judged on the child as DRAWN, before any padding — otherwise the expansion
    # below would launder a child who is genuinely too far back into a passing measurement.
    #
    # EACH CHILD AGAINST HER OWN FLOOR since 2026-09-24. One shared floor was actively fighting
    # the find-difficulty bands: the whole point of giving the eldest a 0.9in minimum is that
    # she may be drawn small and hidden, and a single floor set for the YOUNGEST would refuse
    # exactly the picture the feature exists to produce. `db/cast.json` carries the per-child
    # `find.min_in`; `MIN_CHILD_HEIGHT_IN` remains the fallback for a cast that has none, and
    # is still the absolute below which nobody is recognisable at all.
    too_far_back = [
        f"slot {r['slot']}: drawn {r['h'] * PANEL_HEIGHT_IN:.2f}in tall, under this child's "
        f"{floor_in_for(r['portrait']):.2f}in floor — too far back for her to find herself"
        for r in regions
        if r["h"] * PANEL_HEIGHT_IN < floor_in_for(r["portrait"])
    ]
    grow_to_tap_floor(regions)
    fit_gutters(regions)
    problems = bad_boxes + too_far_back + check(regions, n)
    # The content pass runs EVEN WHEN GEOMETRY FAILS. They are different classes of problem
    # with different fixes — a gutter violation means re-roll the layout, a bare-chested child
    # means the image is wrong — and short-circuiting hid the second behind the first on
    # 2026-09-03, when a scene was refused for a 1px gap while also containing a child the
    # clothing check would have caught. One run should report everything wrong with a scene.
    print("verifying each box holds the right child, fully clothed", file=sys.stderr)
    problems += verify_identity(image, regions, key)

    for r in regions:
        print(f"  slot {r['slot']}  {r['w'] * LOGICAL_W:5.0f}x{r['h'] * LOGICAL_H:5.0f} logical px"
              f"  at ({r['x']:.3f}, {r['y']:.3f})"
              f"{'  [trimmed to open a gutter]' if r.get('trimmed') or r.get('trimmed_h') else ''}"
              f"  — {r['find']}", file=sys.stderr)

    if problems:
        print("\nNOT PROMOTED. " + str(len(problems)) + " problem(s):", file=sys.stderr)
        for p in problems:
            print("  - " + p, file=sys.stderr)
        raise SystemExit(REFUSED)

    # No dog in the cast sheet, no dog pass: there is nothing in the picture to find, and a
    # "found" box would be the finder obliging the question rather than seeing a dog.
    dog = None
    if cast.get("dog"):
        print("locating the dog", file=sys.stderr)
        dog_box = locate_dog(image, key)
        dog = dog_region(dog_box, regions) if dog_box is not None else None

    manifest = {
        "_comment": (
            "Regions found by tools/scene-regions.py, not authored by hand. Activities and "
            "placement are dynamic from 2026-09-02, so they cannot be measured once and "
            "reused. Every check in that script passed, including the one that matters most: "
            "each box was cropped and matched back against its reference portrait."
        ),
        "id": scene_id,
        "image": f"scenes/{scene_id}.jpg",
        "aspect": round(LOGICAL_W / LOGICAL_H, 4),
        "regions": [{"slot": r["slot"], "find": r["find"],
                     "x": round(r["x"], 4), "y": round(r["y"], 4),
                     "w": round(r["w"], 4), "h": round(r["h"], 4),
                     **({"head": r["head"]} if r.get("head") else {})} for r in regions],
    }
    if dog is not None:
        manifest["dog"] = dog
    with open(dst, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(f"\nwrote {dst}", file=sys.stderr)


def heads_only(scene_id: str, image: str, dst: str) -> None:
    """Patch HEAD crops into a manifest the finder has already written, and touch nothing else.

    Same posture as `dog_only`, for the same reason: the child regions in an approved manifest
    were verified against the reference portraits and this pass has no business re-deciding
    them. It calls `locate` for the head boxes, then keeps its hands off `x/y/w/h` — those have
    been grown to the tap floor and gutter-fitted, and re-deriving them here would silently
    undo both.

    Exit 0 whether or not anything was found. A scene with no head crops is a scene; the rail
    simply keeps the cartoon avatars, which is what it did before this existed.
    """
    key = os.environ["NOUS_API_KEY"] if PROVIDER == "nous" else ""
    if PROVIDER == "fal":
        fal_api.key()
    with open(dst, encoding="utf-8") as fh:
        manifest = json.load(fh)
    if manifest.get("id") != scene_id:
        raise SystemExit(f"{dst} is the manifest for {manifest.get('id')!r}, not {scene_id!r}")
    regions = [dict(r) for r in manifest.get("regions", [])]
    by_slot = {r.get("slot"): r for r in regions}
    cast = load_cast()
    n = len(cast["children"])
    slot_of = slots(cast)
    print(f"locating {count_words(n)} heads in {image} via {PROVIDER}", file=sys.stderr)

    found = 0
    for entry in locate(image, key):
        p = entry.get("portrait")
        if p not in range(1, n + 1):
            continue
        region = by_slot.get(slot_of[p - 1])
        if region is None:
            continue
        # Validated against the region ALREADY IN THE FILE, not against the body box this call
        # just produced — the stored one is the verified truth about where that child is.
        body = (region["x"], region["y"], region["w"], region["h"])
        head = head_box(entry.get("head_2d"), body)
        if head is None:
            region.pop("head", None)
            print(f"  slot {region['slot']}: no usable head box — keeping the cartoon avatar",
                  file=sys.stderr)
            continue
        region["head"] = head
        found += 1
        print(f"  slot {region['slot']}: head {head}", file=sys.stderr)

    manifest["regions"] = regions
    with open(dst, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(f"wrote {dst}  ({found}/{n} heads)", file=sys.stderr)


def dog_only(scene_id: str, image: str, dst: str) -> None:
    """Find only the dog and patch him into a manifest the finder has already written.

    Reads `dst`, keeps every child region exactly as it is (they were verified; this pass may
    not touch them), and writes or removes the top-level `dog`. Exit 0 either way — a scene
    with no findable dog is still a scene.
    """
    key = os.environ["NOUS_API_KEY"] if PROVIDER == "nous" else ""
    if PROVIDER == "fal":
        fal_api.key()
    with open(dst, encoding="utf-8") as fh:
        manifest = json.load(fh)
    if manifest.get("id") != scene_id:
        raise SystemExit(f"{dst} is the manifest for {manifest.get('id')!r}, not {scene_id!r}")
    regions = [dict(r) for r in manifest.get("regions", [])]
    if not load_cast().get("dog"):
        print(f"{dst} unchanged (the cast sheet has no dog)", file=sys.stderr)
        return
    print(f"locating the dog in {image} via {PROVIDER}", file=sys.stderr)
    dog_box = locate_dog(image, key)
    dog = dog_region(dog_box, regions) if dog_box is not None else None
    if dog is None and "dog" not in manifest:
        print(f"{dst} unchanged (no dog)", file=sys.stderr)
        return
    if dog is None:
        manifest.pop("dog", None)
    else:
        manifest["dog"] = dog
    with open(dst, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(f"wrote {dst} ({'dog added' if dog else 'no dog'})", file=sys.stderr)


def selftest() -> None:
    """The gutter fitter on measured geometry. No image, no key, no network."""
    def box(slot, x0, y0, x1, y1):
        return {"slot": slot, "x": x0 / LOGICAL_W, "y": y0 / LOGICAL_H,
                "w": (x1 - x0) / LOGICAL_W, "h": (y1 - y0) / LOGICAL_H}

    # 2026w43-autumn-forest-nb2, as the finder measured it: a small girl at the leaf hut stands
    # 8px above the boy's box below her. Refused for the gutter before; it must pass now.
    nb2 = [box(1, 140, 300, 260, 480), box(2, 552, 237, 600, 316), box(0, 470, 324, 794, 486)]
    assert any("gutter" in p or "apart" in p or "gap" in p for p in check([dict(r) for r in nb2])), \
        "the nb2 pair was supposed to fail before fitting"
    fit_gutters(nb2)
    assert check(nb2) == [], check(nb2)
    girl, boy = nb2[1], nb2[2]
    assert girl.get("trimmed_h") and not girl.get("trimmed"), "stacked pair trims height, not width"
    assert abs(girl["h"] * LOGICAL_H - 75) < 0.01, girl["h"] * LOGICAL_H   # 4px off her feet
    assert abs(boy["y"] * LOGICAL_H - 324) < 0.01, "the lower box keeps its top when the upper can pay"

    # Side by side: unchanged behaviour, sideways trim, wider box first.
    row = [box(0, 100, 100, 200, 400), box(1, 205, 100, 285, 400), box(2, 600, 100, 700, 400)]
    fit_gutters(row)
    assert check(row) == [], check(row)
    assert row[0].get("trimmed") and not row[0].get("trimmed_h")

    # One child drawn across another is still a refusal on both axes.
    over = [box(0, 100, 100, 260, 400), box(1, 200, 200, 300, 450), box(2, 600, 100, 700, 400)]
    fit_gutters(over)
    assert check(over) != [], "an overlap of 60px is a picture to refuse, not to shave"

    # A stacked pair whose upper box is already at the height floor takes the rest from below.
    floor = [box(0, 300, 100, 360, 100 + TAP_FLOOR_PX), box(1, 300, 100 + TAP_FLOOR_PX + 6, 400, 400),
             box(2, 700, 100, 800, 400)]
    fit_gutters(floor)
    assert check(floor) == [], check(floor)
    assert abs(floor[0]["h"] * LOGICAL_H - TAP_FLOOR_PX) < 0.01
    print("gutter fitting OK (stacked, side by side, overlap, height floor)")


if __name__ == "__main__":
    argv = sys.argv[1:]
    if argv == ["--selftest"]:
        selftest()
        raise SystemExit(0)
    entry = main
    while argv and argv[0].startswith("--"):
        flag = argv.pop(0)
        if flag == "--dog-only":
            entry = dog_only
        elif flag == "--heads-only":
            entry = heads_only
        elif flag == "--swimwear":
            SWIMWEAR = True
        elif flag == "--flat-scale":
            FLAT_SCALE = True
        elif flag == "--guests-file":
            GUESTS = scene_guests.load_selected(argv.pop(0))
        elif flag == "--dog-doing":
            DOG_DOING = " ".join(argv.pop(0).split())
        elif flag == "--provider":
            PROVIDER = argv.pop(0)
            if PROVIDER not in ("fal", "nous"):
                raise SystemExit(f"unknown provider {PROVIDER!r}; known: fal, nous")
        else:
            raise SystemExit(f"unknown flag {flag}\n{__doc__}")
    if len(argv) != 3:
        raise SystemExit(__doc__)
    entry(*argv)
