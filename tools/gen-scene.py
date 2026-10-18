#!/usr/bin/env python3
"""Generate ONE search-and-find scene with the three children conditioned on their avatars.

    OP_SERVICE_ACCOUNT_TOKEN="$(cat ~/.config/op-service-token)" \
    op run --env-file=tools/op.env -- \
    python3 tools/gen-scene.py --style pencil-spot --composition close-front \
        "<setting>" "<crowd>" out.jpg

    --provider fal|nous|nvidia   (default fal — see tools/fal_api.py for why)
    --model <fal model id>       (default: the style's `model`, else by its `family`)
    --prompt-version 1|2         (default 2; 1 is the pre-2026-09-12 prompt, kept as the control)
    --print-prompt               (assemble and print the prompt, spend nothing)
    --print-digest               (print the draw digest --reuse-if-same compares, spend nothing)
    --premise <id>               (what KIND of picture — tools/scene-premises.json; default plain)
    --context <week.json>        (what the week may tell the picture — tools/scene_context.py)
    --swimwear                   (swim shirts and swim bottoms instead of ordinary clothes; only
                                  a `swimwear: true` setting passes it — BACKLOG 4.11)
    --reuse-if-same              (keep an existing out.jpg ONLY if it was drawn from this exact
                                  prompt, model, seed and avatars; otherwise set it aside and draw)
    --guests-file <list.json>    (visiting family who are in the picture too — written per run by
                                  scene-week from db/guests.json and the calendar; absent or
                                  empty leaves the prompt byte-identical — tools/scene_guests.py)
    --activities-file <set.json> (what the children are doing, WRITTEN for this scene by
                                  tools/scene_activity_writer.py and frozen in
                                  db/scene-activities/; replaces the table pick, re-validated
                                  here. A story moment and a premise's own list still win)

THE PROMPT WAS REWRITTEN ON 2026-09-12 (version 2). The first prompt had grown by accretion —
every clause was a fix for one bad picture, so it said the same thing in three places, phrased
half its rules as prohibitions, and carried an identity contract (eye colour, "not the colours
from their portraits") that the household never wanted. Version 2 is one labelled section per
concern, each rule said once and positively, and the cast comes from `db/cast.json` through
`scene_cast.py` — ages, sex, hair, and heights as body landmarks — so the generator and the
finder read the same description. Version 1 stays importable as the A/B control and nothing
else; delete it when the measurement in docs/scene-prompting-review.md has been repeated once.

STYLE IS DATA, AND SO IS THE CAMERA. `tools/scene-styles.json` holds six styles extracted from
the household's own example prompts and `tools/scene-compositions.json` holds six vantages;
`--style` and `--composition` pick one of each and nothing else in this file changes. The
camera axis was added 2026-09-10 on the observation that every scene so far looked like the
same photograph of a different place — setting varied WHERE, style varied HOW IT IS DRAWN, and
nothing varied where you were standing. The subject was
stripped out of those prompts on purpose — the SETTING comes from the week (weather, and the
coming weekend's event category) and the STYLE is what rotates.

WP-B of docs/scene-pipeline.md, in its first form: character conditioning only, no style
sheet, no context, no scheduling. It exists to answer the question the whole plan rests on —
does attaching the avatars actually make the foreground children match them? — for the price
of one image.

THE POINT OF THE ATTACHMENTS. The scene scaffold in docs/image-prompts.md §4 asks for "a
distinguishing garment colour" and lets the model choose everything else, so the figures were
never tied to anything: on trailer-camp.jpg, B is drawn as a brunette in purple where her
avatar is a blonde in amber. The avatars are the character bible and they are already approved
house art, so the fix is to attach them rather than to describe anyone in words.

DISCLOSURE (ADR-0002, build-plan §3.1). Nothing new leaves the house. `prompt_guard.enforce`
reads the whole assembled prompt, and `enforce_references` refuses any attachment that is not
inside assets/ AND tracked by git — so a photograph cannot be substituted for an avatar here,
which is the failure mode that would matter. No name, age, hair colour or household reference
appears in the text at all; the appearance travels as house art.

A SCENE IS NOT AN ICON. It is 16:9 and full-bleed, it is deliberately CROWDED (the mechanic is
finding yourself among many figures), and it keeps its background — there is no ground to cut
out. So this shares the endpoint and the guard with gen-icon.py and none of its post-processing.
"""
import base64
import hashlib
import io
import json
import os
import random
import sys
import urllib.request

from PIL import Image

import fal_api
import scene_activities  # noqa: E402  (the strict activity filter, shared with scene-week)
import scene_guests  # noqa: E402  (visiting family: prompt section, nearest clause)
from gen_icon_shim import ENDPOINT, MODEL, data_uri
from prompt_guard import enforce, enforce_references
from scene_cast import (
    avatars, cast_fits, count_words, dog_lines, fill_children, find_lines, height_lines,
    load_cast, roster_lines, the_children, together,
)

# The character bible is the cast file's `avatar` paths (`scene_cast.avatars`), in SLOT order —
# matching `Child.sortOrder % n` as assets/scenes/*.json documents it, so the numbered clauses
# in the prompt line up with the attachments and with the manifest the regions are written
# into. It was a hardcoded triple here and another in scene-regions.py until 2026-10-12.

STYLES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scene-styles.json")
COMPOSITIONS_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "scene-compositions.json"
)

# Verbatim from docs/image-prompts.md §4 — parts 1, 5 and 6 never change.
FRAME = "A wide 16:9 landscape illustration, edge to edge, filling the whole frame."

ACTIVITIES_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "scene-activities.json"
)
PREMISES_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "scene-premises.json"
)

# The identity contract, and the ONLY thing that is byte-identical in every scene and every
# style. Two halves, and keeping them apart is the point:
#
#   The PORTRAITS say WHO. Hair colour, hairstyle, eye colour, and the accent that becomes
#   their clothing. That travels as committed house art rather than as text, which is what
#   keeps this whole feature's disclosure posture unchanged (docs/scene-pipeline.md §0).
#
#   The PROMPT says HOW. Until 2026-09-02 it did not, and the avatars pinned the rendering as
#   well as the characters — a graphite world with three flat cartoon children standing in it.
#   Fine in `pencil-spot`, where it reads as spot colour. Wrong everywhere else. The paragraph
#   below is what separates the two, and it is why per-style character sheets are still not
#   needed.
#
# WHAT IS DELIBERATELY NOT HERE ANY MORE: the activities and the positions. They used to be
# welded in — flowers, marshmallow, scooter, bottom-left, centre, bottom-right — so every
# scene repeated the same three poses in the same three places. See scene-activities.json for
# what that convention was protecting and why the trade was reversed.
CHILDREN = (
    "Three specific children appear in this picture, and the three attached portraits are "
    "those three children. Each keeps the HAIR COLOUR, HAIRSTYLE and EYE COLOUR of their own "
    "portrait — that is how each child is recognised, and it never changes.\n\n"
    "They are three different ages and it SHOWS. Portrait 1 is the oldest and clearly the "
    "TALLEST; portrait 2 is in the middle and noticeably shorter than her; portrait 3 is the "
    "youngest and clearly the SHORTEST and smallest of the three. Keep that order however "
    "they are posed, standing or not.\n\n"
    "Their CLOTHES are not fixed. Dress all three in ordinary everyday clothes suited to the "
    "weather and the season of this scene, in any colours that suit the picture. They are not "
    "wearing the colours from their portraits, and they are not dressed alike.\n\n"
    "BUT THEIR HAIR STAYS VISIBLE. No hat, hood or helmet may cover a child's hair so that "
    "its colour and its style stop being obvious — in cold weather use earmuffs, a headband, "
    "a scarf, or a hat pushed back with the hair clearly showing below it.\n\n"
    "DRAW THEM IN THE STYLE OF THIS ILLUSTRATION, not in the style of the portraits. The "
    "portraits are reference for WHO each child is; every line, texture and colouring "
    "decision comes from the style described below, and the children are rendered with "
    "exactly the same technique as everything else in the picture."
)

CHILDREN_AS_TEXT = (
    "Three specific children appear in this picture. They are the same three children every "
    "time, recognised by their hair and eyes, which never change:\n"
    "  - Child 1: the OLDEST and clearly the TALLEST — a girl with mid-brown hair in two "
    "braids and light green eyes.\n"
    "  - Child 2: the middle one, noticeably shorter than child 1 — a girl with long pale "
    "blonde hair worn loose or in a ponytail, never braided, and blue eyes.\n"
    "  - Child 3: the YOUNGEST, clearly the shortest and smallest — a boy with SHORT pale "
    "blonde hair and light green eyes.\n\n"
    "Their difference in height is one of the ways they are told apart, so keep it obvious "
    "however they are posed.\n\n"
    "Dress all three in ordinary everyday clothes suited to the weather and season of this "
    "scene, in any colours that suit the picture; they are not dressed alike. No hat, hood or "
    "helmet covers a child's hair — its colour and style stay clearly visible. Draw all three "
    "in the style of this illustration, rendered with exactly the same technique as everything "
    "else in the picture."
)

# The family dog, in every picture, and deliberately HIDDEN in it.
#
# BREED. Name a breed an image model has seen thousands of times AND describe the coat; the
# name alone is one token of hope. A rare or newly recognised breed name is the trap: the model
# has almost certainly never been trained on the word and falls back to a generic dog, so name
# the common breed it descends from and let the description carry the rest. The real dog's
# breed and coat live in the gitignored db/cast.json (`dog.breed`), which version 2 reads; this
# version-1 literal carries the example breed from db/cast.example.json.
#
# THIRD ATTEMPT AT THIS DESCRIPTION, and the failures are instructive. The first
# description asked for a two-tone coat with a chest patch and a patch on the head; the head
# patch was wrong and came out anyway, and the coat kept arriving smooth and short-haired.
# Corrected 2026-09-05 to ONE colour with no patches at all — the household said to simplify
# the colouring "because it can't seem to get that right." Fewer constraints, more reliable
# output, and the coat's texture is what actually makes him recognisable as himself.
#
# SIZE. "he can be very small like show up at a minimum of one in" — one inch on the glass,
# which on this panel (10.54in tall) is about a tenth of the frame height and roughly a fifth
# of the smallest a CHILD may be drawn. That asymmetry is the point: the children have to be
# findable from the sofa and tappable at 96px, and he has to be neither. He is not a tap
# target, so no floor in tools/scene-regions.py applies to him. At one inch he still subtends
# ~29 arcmin from ten feet, which is a recognisable shape rather than a speck.
#
# NO PATCH ON HIS FACE. The first version gave him a small patch on the top of his head as
# well as the chest; corrected 2026-09-04 — the chest patch was the only one.
#
# Asked for on 2026-09-03: *"I think we should have him included in any of our photos... but
# it'd be cool if he was kind of hidden."* That is a second search-and-find layer sitting under
# the first, and it costs nothing — the three children are what the picture is FOR, and he is
# what the picture rewards a second look with.
#
# The description is fixed wording, exactly like the children's, because a dog who changes
# colour every week is not the same dog. It stays here rather than in scene-activities.json:
# activities rotate, he does not.
#
# What is deliberately NOT said: "our dog". The possessive is what binds a scene noun to this
# household, and a description does the same job without it. (Under POLICY = "described" it
# would only raise an advisory now, but there is no reason to spend one.)
DOG = (
    "Hidden somewhere in the picture is a dog: a medium-sized black-and-white border collie "
    "with a long coat and pricked ears. Keep his coat long and his two colours clear.\n"
    "He is SMALL and he is HIDING. Draw him roughly a tenth of the picture's height — much "
    "smaller than the children, smaller than most things in the scene — and tuck him where he "
    "takes a moment to find: peering out of long grass or ferns, half behind a tree trunk, a "
    "rock, a bush or a fence, with part of him out of sight. He is never in the centre of the "
    "picture, never the biggest thing in it, and never posed with the children."
)

# The head and the body face the same way, and both face the room.
#
# A seed on 2026-09-03 sat all three on a log with their backs to the viewer and then turned
# the youngest one's HEAD round over his shoulder to look out of the picture — "it just looked
# like his head was on backwards instead of turning his neck." It does.
#
# But the reason this is a rule rather than a preference is functional. A child finds herself
# in this picture BY HER FACE, hair and clothing colour, and then taps herself; that is the
# whole mechanic, and the rail is hidden on this screen precisely because the picture IS the
# navigation. A child drawn from behind shows a back and the top of a head. She is not
# findable, and the identity check in tools/scene-regions.py has a much harder time matching
# her too.
#
# Deliberately NOT over-tightened: three-quarter, profile and glancing-sideways poses are all
# fine and are most of what makes the set look alive — the household said as much about the
# other drawings. What is refused is the one impossible pose.
FACING = (
    "Each of the three children is turned towards the viewer — face on, three-quarter or in "
    "profile — so that their face can be seen. Their head and their body always face the SAME "
    "direction. Never draw a child from behind, and never turn a child's head round over their "
    "shoulder to look out of the picture while their body faces away from it."
)

# Said explicitly because it came back wrong. A seed on 2026-09-03 drew the youngest child
# bare-chested — the prompt had asked for "clothing in the colour of the circle behind their
# portrait" and the model satisfied that with trousers alone. This is a picture that hangs in
# a living room where children and guests stand in front of it, so it is not a matter of taste.
#
# The wording is here AND the refusal is in tools/scene-regions.py, on purpose. A prompt line
# is a request; the check is what makes it true. CLAUDE.md's rule — guardrails are
# architectural, never a prompt instruction — applies to what a model draws just as much as to
# what a child can tap.
CLOTHED = (
    "EVERY child and every adult in this picture is FULLY CLOTHED, wearing both a top and "
    "bottoms — a t-shirt, jumper, dress or coat on top, and trousers, shorts or a skirt below. "
    "Nobody is bare-chested, in swimwear or in underwear, whatever the season or the activity."
)

# THE GAP IS STATED AS A FRACTION BECAUSE "a whole child's width" WAS NOT LANDING. Three
# generations in a row were refused by scene-regions.py's gutter check at 1px, 4px and 7px
# apart — no overlap, but far under the 16 logical px two tap targets need between them. A
# relative phrase invites the model to judge; a tenth of the frame is 96 logical px, six times
# the floor, and leaves room for the tap boxes to grow around each child without colliding.
#
# Shared activities are the worst offenders because they are literally about proximity, so the
# clause names one — passing a ball — rather than leaving it implied.
PLACEMENT = (
    "Place the three of them anywhere between the front of the picture and the middle "
    "distance. They do NOT have to stand in a row along the bottom edge, they do not all have "
    "to be the same size, and they do not have to face the viewer. None of them is far away in "
    "the background: each is drawn large and clear enough that their face, hair and clothing "
    "colour are unmistakable.\n\n"
    "SPACING, and it is the constraint most often broken: leave AT LEAST A TENTH OF THE "
    "PICTURE'S WIDTH of clear ground between one child and the next. Not touching, not "
    "overlapping, not shoulder to shoulder, and not merely a small gap — a tenth of the frame, "
    "measured between them. This holds even when they are sharing one activity: three children "
    "passing a ball are spread across the clearing, not standing in a huddle."
)

TOP_STRIP = (
    "The top strip of the picture, all the way across, is LOW IN DETAIL and even in tone — an "
    "open sky with at most a bird, a distant hill or a few stars in it. Small white labels float "
    "over that corner and need quiet behind them."
)

NO_TEXT = (
    "Absolutely NO text, NO letters, NO numbers, NO frame, NO border box, no watermark. Every "
    "sign, flag, banner, board and box in the picture is a blank unlettered shape."
)

# 1920x1080 exactly. campsite.jpg is 1920x1072 and "gets away with it" at 0.7% off, but regions
# are percentages of the CONTAINER while the image is drawn with `cover`, so any drift silently
# slides every rectangle off the child it was measured against.
WIDTH, HEIGHT = 1920, 1080


NVIDIA_ENDPOINT = "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-dev"


def generate_nvidia(prompt: str, key: str, seed: int = 0, timeout: int = 300) -> bytes:
    """FLUX.1-dev on build.nvidia.com. FREE, and text-to-image only.

    Why this exists at all, given the icon bake-off (705d8b2) said NVIDIA could not hold a set:
    that verdict was about REFERENCE CONDITIONING, which this endpoint has no slot for. Scenes
    stopped needing it the day `--no-refs` was measured to carry hair, eyes and clothing in
    words alone (BACKLOG 4.10). So the objection and the requirement went away together.

    `flux.1-kontext-dev` — the reference-conditioned FLUX, also free — is NOT used, and not for
    want of trying: NVCF asset upload works, and the only `image` form its validator accepts,
    `data:image/png;example_id,<assetId>`, returns HTTP 500 on every attempt across both JPEG
    and PNG. A 500 after validation means the shape is right and the backend is not. See
    BACKLOG 4.9.
    """
    enforce(prompt)
    body = json.dumps(
        {"prompt": prompt, "width": 1344, "height": 768, "steps": 40,
         "cfg_scale": 3.5, "seed": seed}
    ).encode()
    req = urllib.request.Request(
        NVIDIA_ENDPOINT, data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json",
                 "Accept": "application/json", "User-Agent": "family-calendar-scenes/1.0"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = json.load(resp)
    artifacts = payload.get("artifacts") or []
    if not artifacts:
        raise SystemExit("no image in response: " + json.dumps(payload)[:400])
    print("usage: cost=0 (NVIDIA free tier)", file=sys.stderr)
    return base64.b64decode(artifacts[0]["base64"])


def load_style(style_id: str) -> dict:
    with open(STYLES_PATH, encoding="utf-8") as fh:
        table = json.load(fh)["styles"]
    for entry in table:
        if entry["id"] == style_id:
            return entry
    raise SystemExit(
        f"unknown style {style_id!r}; known: " + ", ".join(e["id"] for e in table)
    )


def load_composition(composition_id: str) -> dict:
    """WHERE THE CAMERA IS — the fourth axis, added 2026-09-10.

    Same shape as `load_style`, and resolved for the same reason: a typo'd id must say which
    ids exist rather than dying on a missing API key three frames later, or after the image has
    been paid for.
    """
    with open(COMPOSITIONS_PATH, encoding="utf-8") as fh:
        table = json.load(fh)["compositions"]
    for entry in table:
        if entry["id"] == composition_id:
            return entry
    raise SystemExit(
        f"unknown composition {composition_id!r}; known: "
        + ", ".join(e["id"] for e in table)
    )


def pick_activities(
    setting_tags: list[str], season: str, rng: random.Random, pool: list[dict] | None = None,
    solo_only: bool = False, n: int = 3,
) -> str:
    """Choose what the `n` children are doing, and phrase it for the prompt.

    A `shared` activity puts two or three children in ONE thing together, which the old fixed
    structure could not express at all. It is chosen a third of the time: often enough that the
    picture is not always three separate poses, rarely enough that each child still usually has
    something of her own to be found doing.

    Filtering is STRICT (tools/scene_activities.py). It used to be permissive — an activity
    with no `settings` fitted anywhere and a setting with no tags took the whole table — and on
    2026-10-04 that put a deer ride and a tree climb inside a school library. An empty menu is
    now refused before anything is paid for, by `scene_activities.check()`.

    `pool` is a premise's own list (scene-premises.json `activities`), which REPLACES the
    everyday table: a child on a unicorn and a child picking flowers in one picture reads as two
    pictures. A premise pool has no shared entries — anything that seats the three together
    fights the tap gutter, and the impossible things are better one each.
    """
    if pool is None:
        solo, shared = scene_activities.eligible(
            scene_activities.load(ACTIVITIES_PATH), setting_tags, season)
        # A premise may forbid the shared entries (`solo_only`): they seat children together,
        # which a seek-and-find and a cutaway both cannot have.
        # One child has nobody to share with, so a single-child cast never draws from `shared`
        # (and never consumes the coin, which only matters to n == 1's own repeatability).
        # An entry written for three ("two of them ... while the third") is dropped for any
        # other headcount; at n == 3 the list is unchanged, so the draw is too.
        shared = [e for e in shared if cast_fits(e, n)]
        if scene_activities.coin(rng, shared, solo_only, n):
            return (f"{together(n)}: "
                    + fill_children(shared[rng.randrange(len(shared))]["do"], n) + ".")
    else:
        solo = list(pool)
    # At most one activity per FAMILY. Three of the twenty-one solo entries are animal-riding,
    # so an unconstrained sample put one child on a bear and another on an elk in the same
    # picture — which reads as the generator having one idea rather than as three children with
    # three ideas. Shuffle and take greedily by family: order stays random, the constraint just
    # skips the second of a kind.
    pool = solo[:]
    rng.shuffle(pool)
    chosen, seen = [], set()
    for entry in pool:
        fam = entry.get("family") or entry["do"]
        if fam in seen:
            continue
        seen.add(fam)
        chosen.append(entry)
        if len(chosen) == n:
            break
    if len(chosen) < n:
        raise SystemExit(
            f"only {len(chosen)} distinct activity families fit {setting_tags} / {season!r} "
            f"for {n} children — the pool needs more KINDS of thing, not more entries of a kind "
            "it already has"
        )
    head = "What the child is doing:" if n == 1 else "Each of them is doing something different:"
    return head + "".join(
        f"\n  - The child from portrait {i} is {fill_children(e['do'], n)}."
        for i, e in enumerate(chosen, start=1)
    )


# ---------------------------------------------------------------------------------------------
# PROMPT VERSION 2 (2026-09-12). One section per concern; every rule once; positive phrasing.
#
# What changed from version 1 and why, in order of how much it matters:
#
#   IDENTITY IS COUNT, HEIGHT ORDER AND HAIR. Version 1 also pinned eye colour and spent a
#   paragraph on what the clothes must NOT be. The household's rule is the opposite — *"I don't
#   want the kids to be wearing the same thing every time. I don't want their faces to be the
#   same every time... maybe what it is is I want the relative size"* — so the clothes, faces
#   and poses are handed to the model as things to INVENT, and the contract shrinks to the three
#   things a child at the wall actually uses to find herself.
#
#   HEIGHT IS SAID AS A LANDMARK, not as "noticeably shorter". "Comes up to her chin" is
#   something an image model can draw; "the difference SHOWS" is an instruction to care.
#
#   AGES ARE STATED. They are the strongest body-proportion cue these models have, and under
#   prompt_guard's POLICY = "described" they are permitted.
#
#   THE OTHER CHILDREN ARE ALLOWED. Several crowds name "children with balloons"; version 1's
#   "three specific children appear" left it to luck whether the model drew a fourth at the
#   front. Version 2 says ours are the three NEAREST AND LARGEST, which is also the rule the
#   finder can apply.
#
#   PROHIBITIONS BECAME REQUESTS where a request exists. "Never draw a child from behind" is
#   "each child's face is towards the viewer"; "no hat may cover the hair" is "hair clear and
#   uncovered", with the cold-weather alternatives kept because they are the useful part.
#
#   THE DOG IS A THIRD THE LENGTH. The breed, coat, colour, size and hiding places survive; the
#   history of what he used to look like lives in the comment on DOG above, where it belongs.
#
# Section labels are plain uppercase lines. Both model families this repo uses read them as
# structure; nothing downstream parses them.
# ---------------------------------------------------------------------------------------------

# `family` on a style row picks the noun and the technique clause. Photoreal scenes are
# photographs, not illustrations, and telling the model to "draw" one is how the FLUX probe
# ended up with cartoon children on a photographic background.
FRAME_V2 = {
    "illustration": "A wide 16:9 landscape illustration, edge to edge, filling the whole frame.",
    "anime": "A wide 16:9 landscape anime illustration, edge to edge, filling the whole frame.",
    # No `photoreal` entry since 2026-09-18 — the family is gone, see CLAUDE.md.
    #
    # `render` says "3D-rendered" and deliberately NOT "photorealistic". The distinction is the
    # whole reason the family is allowed to exist: a stylised 3D frame is a drawing made with a
    # different tool, and a photorealistic one is the thing the household removed two days
    # earlier because near-miss faces are worse than a drawing. One adjective separates them.
    "render": "A wide 16:9 3D-rendered scene, edge to edge, filling the whole frame.",
}

HAIR_V2 = (
    "Hair is how they are recognised, so each child's hair colour and hairstyle are clear and "
    "uncovered — no hat, hood or helmet hides it. In cold weather use earmuffs, a headband, a "
    "scarf, or a hat pushed back with the hair plainly showing."
)

INVENT_V2 = (
    "Everything else about them is yours to invent, fresh for this picture: their clothes "
    "(ordinary everyday clothes for this weather and season, in colours that suit the picture, "
    "each child dressed differently from the others), their expressions, and their poses."
)

# The clauses below that COUNT the children are written for any n, and at n == 3 each renders
# the exact sentence it always did (test/fixtures/prompt-v2.example.txt is the frozen copy).
# A single child reads in the singular rather than as "the one children".


def portraits_v2(n: int) -> str:
    if n == 1:
        return ("The attached picture is the child's portrait. The portrait says WHO the child "
                "is, not how to draw them: render the child with exactly the same technique as "
                "everything else in this picture.")
    return (
        f"The {count_words(n)} attached pictures are their portraits, in the order listed. The "
        "portraits say WHO each child is, not how to draw them: render the children with "
        "exactly the same technique as everything else in this picture."
    )


def nearest_v2(n: int) -> str:
    if n == 1:
        return ("The child is the nearest and largest child in the picture. Any other children in "
                "the crowd are far off and clearly smaller.")
    return (
        f"They are the {count_words(n)} nearest and largest children in the picture. Any other "
        "children in the crowd are far off and clearly smaller."
    )


def layout_v2(n: int) -> str:
    if n == 1:
        return (
            "The child is in the front half of the picture, between the foreground and the "
            "middle distance, and is at least a quarter of the picture's height tall — large "
            "enough that hair and face read clearly from across a room. The child's face is "
            "towards the viewer (front on, three-quarter or profile) with head and body turned "
            "the same way."
        )
    who = "Both" if n == 2 else f"All {count_words(n)}"
    return (
        f"{who} are in the front half of the picture, between the foreground and the middle "
        "distance, and each is at least a quarter of the picture's height tall — large enough that "
        "hair and face read clearly from across a room. Each child's face is towards the viewer "
        "(front on, three-quarter or profile) with head and body turned the same way.\n"
        "Spread them across the scene with clear ground between them: at least a tenth of the "
        "picture's width from one child to the next, even when they share one activity. Not a "
        "huddle, and not a row along the bottom edge."
    )


CLOTHED_V2 = (
    "Every person in the picture is fully clothed, in a top and bottoms, whatever the season "
    "or the activity."
)

# THE SWIMMING EXCEPTION (BACKLOG 4.11, option 2, 2026-10-12). Only a setting that says
# `swimwear: true` gets this, and check_tables only lets such a setting be drawn by an adult
# forcing it. It is NOT "modestly dressed": it keeps the same crisp rule, a covered top AND
# covered bottoms, and only says what the top may be, so scene-regions --swimwear can still
# refuse on a yes/no answer. The accident that made the rule (a bare-chested youngest child,
# 2026-09-03) is refused here exactly as it is everywhere else.
def clothed_swim_v2(n: int) -> str:
    who = "The child wears" if n == 1 else f"Each of the {count_words(n)} children wears"
    return (
        f"This is a swimming picture. {who} a swim shirt that covers the "
        "chest and shoulders, and swim shorts or swimsuit bottoms: a covered top AND covered "
        "bottoms, always. No child is bare-chested. Every other person is in a swimsuit that covers "
        "the body, a swim shirt, or ordinary clothes."
    )


def clothed_v2(wardrobe: str, swimwear: bool = False, n: int = 3) -> str:
    """The clothing clause, plus the setting's COSTUME when it has one.

    Asked for 2026-09-16: *"it would be much cooler if the kids were dressed as the theme of
    the picture... they don't need to be wearing the same thing, they just need to see their
    faces."* Both halves of that are already the identity contract rather than a concession to
    it — identity here is COUNT, HEIGHT ORDER and HAIR, and clothes and faces were always meant
    to vary (2026-09-12). A costume is therefore free: it changes nothing the finder matches on,
    and it is checked by the same verify pass as every other picture.

    "Not the same thing" is said outright, because a single named costume is exactly what a
    model will put on all three children — and three children in identical robes is a uniform,
    which is harder to read at a glance than three different ones, not easier.

    The face rule is stated here too. It is the one thing a costume can genuinely cost: a hood,
    a helmet, a mask or a scarf pulled up takes away the thing the child is looking for.
    """
    base = clothed_swim_v2(n) if swimwear else CLOTHED_V2
    if not wardrobe:
        return base
    wardrobe = fill_children(wardrobe, n)
    if n == 1:
        return (
            f"{base} The child is dressed for where they are: {wardrobe} Whatever they wear, "
            "their face is fully visible and unobscured: no mask, no hood up, no helmet or hat "
            "brim across the eyes, nothing covering the hair that tells who they are."
        )
    words = count_words(n)
    times = "twice" if n == 2 else f"{words} times"
    return (
        f"{base} The {words} children are dressed for where they are: {wardrobe} Give each "
        f"of the {words} a DIFFERENT outfit within that — different colours, different pieces — "
        f"rather than the same costume {times}. Whatever they wear, every one of their faces "
        "is fully visible and unobscured: no mask, no hood up, no helmet or hat brim across the "
        "eyes, nothing covering the hair that tells them apart."
    )

def dog_v2(cast: dict) -> str:
    """The dog clause, built from `db/cast.json` through `scene_cast.dog_lines`.

    It was a module constant carrying its own copy of both his appearance and his size, and the
    size half said "about a tenth of the picture's height" — a fact about the frame, which gave
    the picture no scale anchor at all. See `dog_lines`; he is measured against the children now.
    """
    breed, size = dog_lines(cast)
    if not breed:
        return ""  # no dog in this household; `everyone` drops the empty clause
    return (
        f"Hidden somewhere in the picture is {breed}. {size} He is hiding — peering out of long "
        "grass, half behind a tree trunk, a rock, a bush or a fence — never in the centre, never "
        "the biggest thing in the scene, and never posed with the children."
    )

# Measured 2026-09-12, eight scenes: nano-banana-2 draws whatever the rules NAME. "The top
# strip ... small labels float there" produced a flat beige band across the top of one scene, a
# white pill in another and two blank white signs in a third — three of its four pictures. The
# words "strip", "label", "banner" and "blank shape" each describe a thing to draw, and it drew
# them. gpt-image-2 ignored the same wording. So the rule now describes the SKY, which is what
# we actually want in that space, and never mentions what will be laid over it.
RULES_V2 = (
    "The top of the picture, right across its width, is the quietest part of it: open sky or a "
    "plain ceiling in one smooth wash of colour, with at most a bird, a star or a distant hill "
    "in it, and nothing else drawn up there.\n"
    "There is no writing anywhere in the picture: no letters, numbers, words, watermarks or "
    "frames, and nothing in it carries lettering."
)


def build_prompt_v2(
    setting: str,
    crowd: str,
    style: dict,
    composition: dict,
    activities: str,
    use_refs: bool,
    cast: dict,
    premise: dict | None = None,
    context: dict | None = None,
    wardrobe: str = "",
    placement: str = "",
    swimwear: bool = False,
    guests: list | None = None,
) -> str:
    premise = premise or {}
    context = context or {}
    guests = guests or []
    n = len(cast["children"])
    for kind, entry in (("composition", composition), ("premise", premise)):
        if entry and not cast_fits(entry, n):
            raise SystemExit(f"{kind} {entry.get('id')!r} is written for a cast of "
                             f"{entry['cast']}, and this cast has {n}")
    family = style.get("family", "illustration")
    frame = FRAME_V2.get(family) or FRAME_V2["illustration"]
    crowded = style.get("crowd") and composition.get("crowd")
    # A premise's crowd sentence carries a `{crowd}` slot for the setting's own list, so the
    # place still supplies the nouns and the premise only says how densely and at what scale.
    if premise.get("crowd"):
        crowd_clause = fill_children(premise["crowd"], n).format(crowd=crowd)
    elif crowded:
        crowd_clause = f"Behind and around them the place is busy and full of life: {crowd}."
    else:
        crowd_clause = f"Behind them, sparsely and with plenty of space around each: {crowd}."
    children = [
        "One particular child is the subject of this picture:" if n == 1
        else f"{count_words(n).capitalize()} particular children are the subject of this picture:",
        roster_lines(cast, with_portraits=use_refs),
        height_lines(cast),
        HAIR_V2,
        INVENT_V2,
    ]
    # HOW FAR AWAY EACH ONE IS — the find-difficulty bands, drawn for this picture. Placed after
    # the height order deliberately: it is read as a qualification of it, not a replacement, and
    # the clause itself repeats that the order still holds.
    if placement:
        children.append(placement)
    if use_refs:
        children.append(portraits_v2(n))
    # VISITORS ARE NEAR TOO. A visiting eight-year-old is bigger than every child in the cast, so
    # "the nearest and largest children" would ask for a picture that cannot exist, or push the
    # visitors back into the crowd. Only with guests; without them the clause is unchanged.
    if premise.get("nearest"):
        children.append(fill_children(premise["nearest"], n))
    else:
        children.append(scene_guests.nearest_clause(n) if guests else nearest_v2(n))
    if not use_refs:
        # pick_activities names them by portrait; without portraits that is a dangling reference.
        activities = activities.replace("The child from portrait", "Child")
    technique = (
        "The children are rendered with exactly the same technique as the rest of the picture."
        if not use_refs else ""
    )
    # THIS WEEK. The weather is part of the scene, so it sits with the setting; the props of
    # the week are things in the place, so they sit with everyone else; and a note the
    # household wrote to be sent is its own section, because it is the one part of this prompt
    # a person composed for the picture (docs/scene-pipeline.md §2.3).
    scene = "\n".join(p for p in (frame, setting, context.get("weather_line", "")) if p)
    everyone = "\n".join(
        p for p in (crowd_clause, context.get("props_line", ""), clothed_v2(wardrobe, swimwear, n), dog_v2(cast)) if p
    )
    rules = "\n".join(p for p in (RULES_V2, fill_children(premise.get("rules", ""), n)) if p)
    hints = [h for h in context.get("hints", []) if h.strip()]
    return "\n\n".join(
        part for part in (
            f"SCENE\n{scene}",
            f"PREMISE\n{fill_children(premise['brief'], n)}" if premise.get("brief") else "",
            f"CAMERA\n{fill_children(composition['camera'], n)}",
            ("THE CHILD\n" if n == 1 else f"THE {count_words(n).upper()} CHILDREN\n")
            + "\n".join(c for c in children if c),
            f"VISITING FAMILY\n{scene_guests.prompt_section(guests, cast)}" if guests else "",
            f"WHAT THEY ARE DOING\n{activities}",
            "THIS WEEK'S NOTE\n" + "\n".join(hints) if hints else "",
            f"LAYOUT\n{fill_children(premise['layout'], n) if premise.get('layout') else layout_v2(n)}",
            f"EVERYONE ELSE\n{everyone}",
            f"STYLE\n{fill_children(style['style'], n)}\n{fill_children(style['palette'], n)}\n{technique}".rstrip(),
            f"RULES\n{rules}",
        ) if part
    )


def load_premise(premise_id: str) -> dict:
    """WHAT KIND OF PICTURE — the fifth axis, added 2026-09-13 (scene-premises.json).

    `plain` is a real row that overrides nothing, so "no premise" and "the plain premise" are
    the same prompt byte for byte and the A/B against every earlier scene stays honest.
    """
    with open(PREMISES_PATH, encoding="utf-8") as fh:
        table = json.load(fh)["premises"]
    for entry in table:
        if entry["id"] == premise_id:
            return entry
    raise SystemExit(
        f"unknown premise {premise_id!r}; known: " + ", ".join(e["id"] for e in table)
    )


def load_context(path: str | None) -> dict:
    """THIS WEEK — what the week is allowed to tell the picture (tools/scene_context.py).

    The file is written once per week and reused, so a re-run repeats the brief. Absent is a
    valid answer and produces the same prompt as before the axis existed: the season is
    already in the setting, and a picture with no weather line is a good picture rather than
    a wrong one (docs/scene-pipeline.md §2.2).
    """
    if not path:
        return {}
    with open(path, encoding="utf-8") as fh:
        ctx = json.load(fh)
    for key in ("weather_line", "props_line", "hints"):
        ctx.setdefault(key, [] if key == "hints" else "")
    return ctx


def build_prompt(
    setting: str,
    crowd: str,
    style_id: str,
    activities: str,
    use_refs: bool,
    composition_id: str = "eye-level",
    version: int = 2,
    premise: dict | None = None,
    context: dict | None = None,
    wardrobe: str = "",
    placement: str = "",
    swimwear: bool = False,
    guests: list | None = None,
) -> str:
    """The whole prompt, assembled once so every provider sends identical words.

    Three providers now reach an image model from this file, and the fastest way to make an A/B
    meaningless is to let them drift apart by a clause. Only the CHILDREN block differs between
    `use_refs` and not, and only because one provider can take attachments and another cannot.
    `version` selects the prompt generation: 2 is current, 1 is the control (see the module
    docstring).
    """
    style = load_style(style_id)
    composition = load_composition(composition_id)
    cast = load_cast()
    if version == 2:
        return build_prompt_v2(
            setting, crowd, style, composition, activities, use_refs, cast, wardrobe=wardrobe,
            placement=placement, swimwear=swimwear,
            premise=premise, context=context, guests=guests,
        )
    if guests:
        raise SystemExit("--guests-file is a prompt-version-2 feature; version 1 is the control")
    if premise and premise["id"] != "plain":
        raise SystemExit("a premise is a prompt-version-2 feature; version 1 is the control")
    if context:
        raise SystemExit("--context is a prompt-version-2 feature; version 1 is the control")
    if swimwear:
        raise SystemExit("--swimwear is a prompt-version-2 feature; version 1 is the control")
    if version != 1:
        raise SystemExit(f"unknown prompt version {version}; known: 1, 2")
    if len(cast["children"]) != 3:
        raise SystemExit("prompt version 1 is the three-child control and is never rewritten; "
                         f"this cast has {len(cast['children'])}. Use --prompt-version 2")
    # Version 1 is frozen text, but the tables it reads now carry child tokens; fill them for
    # three, which gives back exactly the words it was written against.
    style = {**style, "style": fill_children(style["style"], 3),
             "palette": fill_children(style["palette"], 3)}
    composition = {**composition, "camera": fill_children(composition["camera"], 3)}
    # `crowd` is only asked for where BOTH the style and the camera can carry it. Forcing a
    # Waldo-grade crowd into `dreamlike` or `lantern-night` produces clutter rather than a
    # search, and clutter behind a child is what makes her unfindable — the one failure this
    # screen cannot absorb. The camera is the second half of that question and was not being
    # asked at all until 2026-09-10: a doorway or a worm's-eye view SEES much less of the place
    # than an eye-level shot, so a crowd written for the whole clearing lands in the narrow strip
    # that is actually visible.
    crowded = style.get("crowd") and composition.get("crowd")
    crowd_clause = (
        f"Behind and around them the place is busy and full of life: {crowd}"
        if crowded
        else f"Behind them, sparsely and with plenty of space around each: {crowd}"
    )
    who = CHILDREN if use_refs else CHILDREN_AS_TEXT
    # THE CAMERA GOES BEFORE PLACEMENT AND FACING, never after, and the order is the rule.
    # A composition may move the vantage; it may not move the children. PLACEMENT's size floor
    # and FACING's "never from behind" are what tools/scene-regions.py actually refuses on, so
    # they are appended last and win any argument a camera clause could pick with them.
    return (
        f"{FRAME}\n\n{setting}\n\n{composition['camera']}\n\n{who}\n\n{activities}\n\n"
        f"{PLACEMENT}\n\n{FACING}\n\n"
        f"{CLOTHED}\n\n{DOG}\n\n{crowd_clause}\n\n{style['palette']}\n\n"
        f"{style['style']} {TOP_STRIP} {NO_TEXT}"
    )


def generate(
    setting: str,
    crowd: str,
    style_id: str,
    activities: str,
    key: str,
    use_refs: bool = True,
    timeout: int = 420,
    composition_id: str = "eye-level",
    version: int = 2,
    premise: dict | None = None,
    context: dict | None = None,
    guests: list | None = None,
) -> bytes:
    prompt = build_prompt(
        setting, crowd, style_id, activities, use_refs, composition_id, version,
        premise=premise, context=context, wardrobe=wardrobe, placement=placement,
        guests=guests,
    )

    # Both guards, on this side of the socket, for the reason gen-icon.py gives: a second
    # generator is exactly how a disclosure rule quietly becomes a property of one code path.
    # `activities` now reaches the wire too, so it is inside `enforce` rather than beside it.
    enforce(prompt)
    content = [{"type": "text", "text": prompt}]
    if use_refs:
        refs = avatars(load_cast())
        enforce_references(refs)
        content += [{"type": "image_url", "image_url": {"url": data_uri(a)}} for a in refs]
    body = json.dumps(
        {
            "model": MODEL,
            "modalities": ["image", "text"],
            "messages": [{"role": "user", "content": content}],
        }
    ).encode()
    req = urllib.request.Request(
        ENDPOINT,
        data=body,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            # Mandatory: the endpoint 403s Python's default UA and it reads as an auth failure.
            "User-Agent": "family-calendar-scenes/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = json.load(resp)
    usage = payload.get("usage") or {}
    if usage:
        print(
            "usage: "
            + ", ".join(f"{k}={v}" for k, v in sorted(usage.items()) if isinstance(v, (int, float))),
            file=sys.stderr,
        )
    images = payload["choices"][0]["message"].get("images") or []
    if not images:
        raise SystemExit("no image in response: " + json.dumps(payload)[:400])
    return base64.b64decode(images[0]["image_url"]["url"].split(",", 1)[1])


def choose_model(style: dict, override: str | None) -> str:
    """The style's own `model`, or the family default, or the CLI's — and in every case a model
    that was measured to hold the cast in that family. FLUX.2-pro asked for photoreal is the
    case this refuses: it holds the children and cannot leave the cartoon, which is a scene
    that looks right and is not."""
    family = style.get("family", "illustration")
    model = override or style.get("model") or fal_api.DEFAULT_FOR_FAMILY[family]
    spec = fal_api.MODELS.get(model)
    if spec is None:
        raise SystemExit(
            f"{model!r} is not an allowed scene model; allowed: " + ", ".join(fal_api.MODELS)
        )
    if family not in spec["styles"]:
        raise SystemExit(
            f"{model} was not measured to hold the cast in a {family!r} style "
            f"(it holds: {', '.join(spec['styles'])}); pick another --model"
        )
    return model


def generate_fal(prompt: str, model: str, use_refs: bool, purpose: str) -> bytes:
    """fal.ai edit models with the cast's committed avatars attached inline. The guards run here,
    on this side of the socket, for the same reason the other two generators run them.

    THERE IS NO PHOTOGRAPH PATH ANY MORE. One existed for a day (2026-09-17): a `--faces` flag
    that swapped these three cartoon portraits for photographs of the children, behind its own
    stricter door. It was built for photorealism and photorealism is gone — the near-but-wrong
    faces were worse than a drawing, which is the uncanny valley arriving exactly where it was
    predicted. Removing the flag rather than leaving it dormant is the point: a path that can
    send family photographs to a third party and currently has no caller is the most dangerous
    shape of code this repo has, because the next person to find it will assume it is supported.
    `enforce_references` is the only door again.
    """
    enforce(prompt)
    refs: list[str] = []
    if use_refs:
        paths = avatars(load_cast())
        enforce_references(paths)
        refs = [data_uri(a) for a in paths]
    return fal_api.generate(model, prompt, refs, purpose)


def fit(raw: bytes, dst: str) -> None:
    """Centre-crop to exactly 16:9 at 1920x1080, then save q82 progressive.

    Cropping rather than scaling: the model returns arbitrary dimensions (§2.2 — `aspectRatio`
    lives in generationConfig and the OpenAI-shaped path strips it), and squashing a 4:3 return
    into 16:9 would distort the figures the regions are measured against.
    """
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    w, h = im.size
    want = WIDTH / HEIGHT
    if w / h > want:
        new_w = round(h * want)
        im = im.crop(((w - new_w) // 2, 0, (w - new_w) // 2 + new_w, h))
    else:
        new_h = round(w / want)
        im = im.crop((0, (h - new_h) // 2, w, (h - new_h) // 2 + new_h))
    im = im.resize((WIDTH, HEIGHT), Image.LANCZOS)
    im.save(dst, "JPEG", quality=82, progressive=True, optimize=True)
    print(f"{dst}  {WIDTH}x{HEIGHT}  {os.path.getsize(dst) // 1024} KB  (source {w}x{h})")


# ---------------------------------------------------------------------------------------------
# WHAT DREW THIS PICTURE (2026-10-04). An image on disk used to be reused because it EXISTED:
# scene-week's `offer()` saw `<id>.jpg` and skipped generation, so a re-run after a prompt change
# re-registered the OLD picture and said so in one line of log. Six candidates came back in
# ordinary clothes that way after `wardrobe` was added, and the Halloween fair had to have its
# cache deleted by hand. The cache is keyed on the inputs now: every image carries a stamp of
# what drew it, and an image is reused only when the stamp matches what would be drawn now.
# A mismatch, or an image with no stamp at all, is SET ASIDE (never deleted — a generated
# picture exists nowhere else) and a new one is drawn.
# ---------------------------------------------------------------------------------------------

def draw_digest(prompt: str, provider: str, model: str | None, seed, use_refs: bool) -> str:
    """Everything that decides the picture. The avatars are hashed by CONTENT, because a repaint
    keeps the filename and changes the children (2026-09-16)."""
    h = hashlib.sha256(json.dumps(
        {"prompt": prompt, "provider": provider, "model": model, "seed": seed, "refs": use_refs},
        sort_keys=True).encode())
    if use_refs:
        for a in avatars(load_cast()):
            with open(a, "rb") as fh:
                h.update(hashlib.sha256(fh.read()).digest())
    return h.hexdigest()


def stamp_path(dst: str) -> str:
    return os.path.splitext(dst)[0] + ".draw.json"


def reuse_or_set_aside(dst: str, digest: str) -> bool:
    """True when `dst` was drawn from exactly these inputs. Otherwise moves it out of the way."""
    if not (os.path.exists(dst) and os.path.getsize(dst) > 0):
        return False
    old = None
    try:
        with open(stamp_path(dst), encoding="utf-8") as fh:
            old = json.load(fh).get("digest")
    except (OSError, ValueError):
        pass
    if old == digest:
        print(f"reusing {dst}: drawn from this exact prompt (draw {digest[:12]})")
        return True
    stem, ext = os.path.splitext(dst)
    aside = f"{stem}.superseded-{old[:8] if old else 'unstamped'}{ext}"
    os.replace(dst, aside)
    if old:
        os.replace(stamp_path(dst), os.path.splitext(aside)[0] + ".draw.json")
    print(f"NOT reusing {dst}: it was drawn from "
          + ("a DIFFERENT prompt" if old else "an unknown prompt (no stamp)")
          + f"; kept as {aside}, drawing a new one")
    return False


def write_stamp(dst: str, digest: str, prompt: str, provider: str, model: str | None) -> None:
    with open(stamp_path(dst), "w", encoding="utf-8") as fh:
        json.dump({"digest": digest, "provider": provider, "model": model, "prompt": prompt},
                  fh, indent=2, ensure_ascii=False)
        fh.write("\n")


if __name__ == "__main__":
    argv = sys.argv[1:]
    style_id, season, tags, seed, use_refs, provider = "house", "", [], None, True, "fal"
    composition_id, model, version, print_only = "eye-level", None, 2, False
    premise_id, context_path, wardrobe, moment = "plain", None, "", ""
    reuse_if_same, swimwear, print_digest = False, False, False
    activities_file, guests_file = None, None
    while argv and argv[0].startswith("--"):
        flag = argv.pop(0)
        if flag == "--style":
            style_id = argv.pop(0)
        elif flag == "--composition":
            composition_id = argv.pop(0)
        elif flag == "--season":
            season = argv.pop(0)
        elif flag == "--tags":
            tags = [t.strip() for t in argv.pop(0).split(",") if t.strip()]
        elif flag == "--wardrobe":
            wardrobe = argv.pop(0)
        elif flag == "--swimwear":
            swimwear = True
        elif flag == "--moment":
            moment = argv.pop(0)
        elif flag == "--seed":
            seed = int(argv.pop(0))
        elif flag == "--no-refs":
            use_refs = False
        elif flag == "--provider":
            provider = argv.pop(0)
        elif flag == "--model":
            model = argv.pop(0)
        elif flag == "--prompt-version":
            version = int(argv.pop(0))
        elif flag == "--print-prompt":
            print_only = True
        elif flag == "--print-digest":
            print_digest = True
        elif flag == "--reuse-if-same":
            reuse_if_same = True
        elif flag == "--premise":
            premise_id = argv.pop(0)
        elif flag == "--context":
            context_path = argv.pop(0)
        elif flag == "--activities-file":
            activities_file = argv.pop(0)
        elif flag == "--guests-file":
            guests_file = argv.pop(0)
        else:
            raise SystemExit(f"unknown flag {flag}\n{__doc__}")
    if len(argv) != 3:
        raise SystemExit(__doc__)
    setting, crowd, dst = argv
    # Resolve the style BEFORE touching the environment, so a typo'd `--style` says which
    # styles exist rather than dying on a missing API key three frames down.
    style = load_style(style_id)
    load_composition(composition_id)
    premise = load_premise(premise_id)
    context = load_context(context_path)
    guests = scene_guests.load_selected(guests_file)
    # A premise restricts the families it can be drawn in — an impossible PHOTOGRAPH is the
    # whole idea of `impossible-photo`, and a cutaway needs walls a photograph cannot remove.
    # Refused here, before a key is read, for the same reason as a typo'd style.
    if style.get("family", "illustration") not in premise.get("families", []):
        raise SystemExit(
            f"premise {premise_id!r} is not drawn in a {style.get('family', 'illustration')!r} "
            f"style (it allows: {', '.join(premise.get('families', []))}); pick another --style"
        )
    # A premise may pin the camera: a cutaway is seen straight on or the rooms skew, and a
    # seek-and-find wants the raised view that lays the place out. Said aloud, because the
    # caller passed a composition and is about to get a different one.
    if premise.get("camera") and premise["camera"] != composition_id:
        print(f"premise {premise_id} pins the camera to {premise['camera']} "
              f"(was {composition_id})", file=sys.stderr)
        composition_id = premise["camera"]
        load_composition(composition_id)
    rng = random.Random(seed)
    if premise.get("buildings"):
        premise = dict(premise)
        # replace(), not format(): the brief also carries the child tokens fill_children owns.
        premise["brief"] = premise["brief"].replace(
            "{building}", premise["buildings"][rng.randrange(len(premise["buildings"]))]
        )
    n_children = len(load_cast()["children"])
    activities = pick_activities(tags, season, rng, pool=premise.get("activities"),
                                 solo_only=bool(premise.get("solo_only")), n=n_children)
    # A WRITTEN SET REPLACES THE TABLE PICK (2026-10-12), phrased exactly as the pick would be.
    # The pick above still runs so the RNG reaches the placement lines in the same state either
    # way. A premise's own list wins (it is the premise), and a story moment wins below.
    if activities_file and not premise.get("activities"):
        import scene_activity_writer
        activities = scene_activity_writer.load_for_prompt(
            activities_file, n=n_children, tags=tags, swimwear=swimwear)
    # A STORY MOMENT REPLACES THE ACTIVITY TABLE. It arrives already phrased as something the
    # three of them are doing, so it lands exactly where a shared activity would and nothing
    # downstream needs to know a story exists. Whether it was ALLOWED to be shown was decided by
    # `tools/scene_story.py` against how far the household has read; nothing here re-decides it,
    # and nothing here may be the only thing standing between a child and a spoiler.
    if moment:
        activities = f"{together(n_children)}: {fill_children(moment, n_children)}."
    # A flat-scale premise (busy-town) draws everyone the same size on purpose, which is the
    # opposite of what the find-difficulty bands ask for. The premise wins: in a seek-and-find
    # every child is equally hidden, and that is the difficulty.
    flat = bool(premise.get("flat_scale"))
    placement = find_lines(load_cast(), rng) if version == 2 and not flat else ""
    print(activities.replace("\n", " "), file=sys.stderr)
    if premise_id != "plain":
        print(f"premise: {premise_id}", file=sys.stderr)
    if context:
        print(f"context: {context_path} ({context.get('week', '?')})", file=sys.stderr)
    if guests:
        print(f"guests: {', '.join(g['id'] for g in guests)}", file=sys.stderr)
    if version == 2:
        print(f"cast: {load_cast()['source']}", file=sys.stderr)
    if provider == "nvidia":
        # FLUX has nowhere to attach the portraits, so the children MUST travel as words.
        # Saying so rather than silently ignoring --refs: a caller who thinks references are
        # in play and is getting none would blame the model for drift that is our own doing.
        if use_refs:
            print("nvidia is text-to-image only — using the written character description",
                  file=sys.stderr)
        use_refs = False
    prompt = build_prompt(
        setting, crowd, style_id, activities, use_refs, composition_id=composition_id,
        version=version, premise=premise, context=context, wardrobe=wardrobe,
        placement=placement, swimwear=swimwear, guests=guests,
    )
    if print_only:
        enforce(prompt)
        print(prompt)
        print(f"\n[{len(prompt.split())} words, prompt version {version}, provider {provider}"
              + (f", model {choose_model(style, model)}" if provider == "fal" else "") + "]",
              file=sys.stderr)
        raise SystemExit(0)
    drawn_by = choose_model(style, model) if provider == "fal" else model
    digest = draw_digest(prompt, provider, drawn_by, seed, use_refs)
    if print_digest:
        # The cache key `--reuse-if-same` compares, printed and nothing drawn: how a prompt
        # change is proved NOT to change what an existing picture was drawn from.
        print(digest)
        raise SystemExit(0)
    if reuse_if_same and reuse_or_set_aside(dst, digest):
        raise SystemExit(0)
    if provider == "nvidia":
        fit(generate_nvidia(prompt, os.environ["NVIDIA_API_KEY"], seed or 0), dst)
    elif provider == "nous":
        fit(
            generate(
                setting, crowd, style_id, activities, os.environ["NOUS_API_KEY"], use_refs,
                composition_id=composition_id, version=version, premise=premise,
                context=context, guests=guests,
            ),
            dst,
        )
    elif provider == "fal":
        chosen = choose_model(style, model)
        purpose = (f"scene {style_id}/{composition_id}/{premise_id} v{version} "
                   f"-> {os.path.basename(dst)}")
        fit(generate_fal(prompt, chosen, use_refs, purpose), dst)
    else:
        raise SystemExit(f"unknown provider {provider!r}; known: fal, nous, nvidia")
    write_stamp(dst, digest, prompt, provider, drawn_by)
