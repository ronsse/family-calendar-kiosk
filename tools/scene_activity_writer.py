#!/usr/bin/env python3
"""What the children are doing in a scene, WRITTEN per scene by a text model (2026-10-12).

The household's words: "kids activities can be ai generated and creative. it does not have to
drive from a list." Until then every scene drew from tools/scene-activities.json — 36 solo
lines and 10 shared ones — and a weekly picture of the same three children kept riding the same
moose. With `scenes.activities: "written"` (the default) a text model writes a fresh set for
each scene; `"table"` keeps the old pick.

THE MODEL IS CREATIVE; THE GUARDRAILS ARE CODE. Nothing below trusts the prompt to keep a child
the right way up, her face visible, or a deer out of a library. `problems()` reads every line
the model returns and refuses it for any of the reasons the table was curated against — the
exact count, one sentence of at most 140 characters starting with a lowercase gerund, distinct
kinds, nothing upside down, nothing over a face, no swimwear outside a swimwear setting, no
proper names, nothing dangerous, nothing outdoor-only indoors, no particular child singled out,
no repeat of a recent line, and everything `prompt_guard` refuses or flags. A refused answer is
asked for again ONCE, with the reasons quoted; a second refusal falls back to the table, says so
on stderr, and freezes that fallback so a re-run does not pay to be refused again.

FROZEN PER SCENE. The set lands in `db/scene-activities/<scene_id>.json` (gitignored) with the
model and a digest of its inputs, keyed by the BASE scene id, so the gpt and nb2 candidates of
a pair draw the same activities (the pair is a comparison of models, not of briefs). A re-run
reads the file and never calls the model, so the prompt — and gen-scene's `--reuse-if-same`
draw digest — repeat exactly, and a cached picture is reused rather than bought again. A writer
that could not be REACHED is not frozen: like an incomplete THIS WEEK brief, it is tried again
next run, and this run draws from the table.

WHAT IS SENT. The setting's own table text, its place tags, the season, THIS WEEK's lines (the
same ones the image prompt already carries), the crowd, wardrobe and swimwear flags, the number
of children, whether this picture is one thing done together, and the last few written lines as
"do not repeat these". No name, age, sex, hair or any other cast field: the writer only ever
knows "portrait 1..N". `prompt_guard.check` runs on the request before it leaves.

    python3 tools/scene_activity_writer.py --selftest       # no network; npm run verify:activities
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import pathlib
import random
import re
import sys
from typing import Callable

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))

import prompt_guard  # noqa: E402
import scene_activities  # noqa: E402
from scene_cast import cast_fits, fill_children, together  # noqa: E402

PROMPT_VERSION = 2   # 2 (2026-10-28): the camera, the premise and the place's last kinds are sent
MAX_CHARS = 140
# The recent lines quoted back as "do not repeat". Three until 2026-10-28, which with two
# pictures a run was barely the last run's pair; six is the last three runs.
RECENT = 6
TOKENS = ("{the_children}", "{The_children}", "{count}", "{Count}", "{all_of_them}",
          "{All_of_them}", "{are}", "{s}")
# A shared line may open on the group before its verb: "{all_of_them} rolling ...".
SHARED_OPENERS = ("{all_of_them} ", "{the_children} ")


def directory() -> pathlib.Path:
    env = os.environ.get("SCENE_ACTIVITIES_DIR")
    return pathlib.Path(env) if env else REPO / "db" / "scene-activities"


def path_for(scene_id: str, where: pathlib.Path | None = None) -> pathlib.Path:
    return (where or directory()) / f"{scene_id}.json"


# ---------------------------------------------------------------------------------------------
# THE GUARDRAILS. Each is (reason, pattern). Word-bounded on purpose: "arrow" must not refuse
# "narrow", nor "hood" a "neighbourhood".
def _words(*alts: str) -> re.Pattern:
    return re.compile(r"\b(?:" + "|".join(alts) + r")\b", re.IGNORECASE)


UPSIDE_DOWN = _words(r"hand\s?stands?", r"head\s?stands?", r"cartwheel\w*", r"flip\w*",
                     r"somersault\w*", r"upside[- ]down", r"inverted", r"back\s?bends?",
                     r"hanging (?:by|from) (?:the|their|his|her) (?:knees|legs|feet)",
                     r"roly[- ]pol(?:y|ies)", r"forward rolls?", r"backward rolls?")
FACE_COVER = _words(r"hoods?", r"hooded", r"hoodies?", r"masks?", r"masked", r"helmets?",
                    r"brims?", r"brimmed", r"goggles", r"visors?", r"balaclavas?",
                    r"costume heads?", r"face[- ]?paint\w*", r"painted faces?", r"sunglasses",
                    r"snorkel\w*", r"veils?", r"fake beards?", r"beards?", r"scarf over",
                    r"covering (?:the|their|his|her) faces?", r"hiding (?:the|their|his|her) faces?")
SWIMWEAR = _words(r"swim\w*", r"bathing", r"bikinis?", r"(?:swim|bathing) trunks",
                  r"bare[- ]chested", r"shirtless", r"topless", r"naked", r"nude",
                  r"underwear", r"underpants", r"nappy", r"nappies", r"diapers?", r"wetsuits?")
DANGER = _words(r"weapons?", r"swords?", r"knife", r"knives", r"daggers?", r"guns?",
                r"spears?", r"axes?", r"arrows?", r"bows? and arrows?", r"cannons?",
                r"fire[- ]breathing", r"flames?", r"on fire", r"cliffs?", r"ledges?",
                r"precipices?", r"lava", r"chainsaws?", r"matches", r"lighters?",
                r"fireworks?", r"explosi\w+", r"blood\w*", r"fight\w*", r"punch\w*",
                r"wrestl\w*", r"traffic", r"busy road", r"rooftops?", r"edge of")
# Outdoor-only things, refused in an `indoor` setting: the 2026-10-04 library deer, in code.
OUTDOOR_ONLY = (
    ("riding an animal", re.compile(
        r"\briding\b(?!\s+(?:a|an|the)?\s*(?:rocking|toy|hobby|wooden|carousel|stuffed|plush))",
        re.IGNORECASE)),
    ("climbing a tree", re.compile(r"\bclimb\w*\b[^.]*\btrees?\b", re.IGNORECASE)),
    ("sledding", _words(r"sled\w*", r"sledg\w*", r"toboggan\w*")),
    ("swimming", _words(r"swim\w*")),
    ("skiing", _words(r"ski", r"skis", r"skiing", r"skier")),
    ("a kite", _words(r"kites?")),
    ("snow", _words(r"snowm[ae]n", r"snowballs?", r"snow angels?")),
    ("puddles", _words(r"puddles?")),
    ("a boat", _words(r"canoe\w*", r"kayak\w*", r"rowing", r"row ?boats?")),
    ("a campfire", _words(r"campfires?", r"bonfires?")),
    ("fishing", _words(r"fishing", r"fish(?:es)? with a rod")),
)
# One particular child, or a household relation. The writer only knows "portrait 1..N"; a line
# that says "the youngest" or "her sister" is either guessing or reaching for the roster.
SINGLES_OUT = _words(r"eldest", r"youngest", r"oldest", r"littlest", r"smallest child",
                     r"tallest", r"shortest", r"portraits?", r"child \d", r"first child",
                     r"second child", r"third child", r"sisters?", r"brothers?", r"siblings?",
                     r"twins?", r"mum", r"mom", r"mother", r"dad", r"father", r"parents?",
                     r"grand\w+", r"baby")
# A guessed sex. The writer is never told who is a girl or a boy, so "her stack of books" on
# portrait 2 is a coin toss that can misgender a child (measured on the tuning calls,
# 2026-10-12: one answer gave portrait 1 "her" and portrait 3 "his"). The table says "their".
GENDERED = _words(r"he", r"she", r"his", r"her", r"hers", r"him", r"himself", r"herself")
CARRIED = _words(r"piggy[- ]?back\w*", r"being carried", r"carried by",
                 r"on (?:the|their|his|her|someone's) shoulders", r"shoulder ride")
GERUND = re.compile(r"^[a-z]+ing\b")
UNKNOWN_TOKEN = re.compile(r"\{[^}]*\}")


def problems(answer, *, n: int, shared: bool, indoor: bool, swimwear: bool,
             recent: list[str] = (), last_kinds: list[str] = ()) -> list[str]:
    """Every reason this answer may not reach a picture, as sentences. Empty means it may."""
    if not isinstance(answer, dict) or not isinstance(answer.get("lines"), list):
        return ['the answer is not {"lines": [...]}']
    lines = answer["lines"]
    want = 1 if shared else n
    out = []
    if len(lines) != want:
        out.append(f"there are {len(lines)} lines; this picture needs exactly {want}"
                   + (" (one shared line)" if shared else " (one per child)"))
    seen_kinds: dict[str, int] = {}
    recent_norm = {_norm(r) for r in recent}
    for i, line in enumerate(lines, start=1):
        if not isinstance(line, dict) or not isinstance(line.get("do"), str) \
                or not isinstance(line.get("kind"), str):
            out.append(f"line {i}: needs a string `do` and a string `kind`")
            continue
        do, kind = line["do"].strip(), line["kind"].strip().lower()
        tag = f"line {i} ({do[:50]!r})"
        if not kind:
            out.append(f"{tag}: `kind` is empty")
        elif kind in seen_kinds:
            out.append(f"{tag}: kind {kind!r} repeats line {seen_kinds[kind]}; every child "
                       "needs a different KIND of thing")
        else:
            seen_kinds[kind] = i
        out += [f"{tag}: {why}" for why in line_problems(do, n=n, shared=shared, indoor=indoor,
                                                          swimwear=swimwear)]
        if _norm(do) in recent_norm:
            out.append(f"{tag}: repeats a line from a recent picture word for word")
    # THE SAME PLACE, THE SAME KINDS (2026-10-28). Only a word-for-word repeat was refused, so
    # a library got an animal, a building and a magic line every time it came round, each
    # reworded. A set may share kinds with the last picture of this place, never be made of them.
    last = {k.strip().lower() for k in last_kinds}
    if last and seen_kinds and set(seen_kinds) <= last:
        out.append(f"every kind here ({', '.join(sorted(seen_kinds))}) was in the last picture of "
                   "this place; make at least one line a different KIND of thing")
    return out


def line_problems(do: str, *, n: int, shared: bool, indoor: bool, swimwear: bool) -> list[str]:
    out = []
    body = do[:-1] if do.endswith(".") else do
    if not body:
        return ["is empty"]
    if len(body) > MAX_CHARS:
        out.append(f"is {len(body)} characters; at most {MAX_CHARS}")
    if "\n" in body or re.search(r"[.!?;:]", body):
        out.append("is more than one sentence (no . ! ? ; : inside a line)")
    bare = body
    if shared:
        for opener in SHARED_OPENERS:
            if bare.startswith(opener):
                bare = bare[len(opener):]
                break
    if not GERUND.match(bare):
        out.append('must start with a lowercase -ing verb, completing "The child from '
                   'portrait i is ___"')
    unknown = [t for t in UNKNOWN_TOKEN.findall(body) if t not in TOKENS]
    if unknown:
        out.append(f"uses unknown token(s) {', '.join(unknown)}")
    detokened = body
    for t in TOKENS:
        detokened = detokened.replace(t, " ")
    if re.search(r"[A-Z]", detokened):
        out.append("has a capital letter: no names, titles or proper nouns")
    for label, pattern in (("is upside down (the finder reads it as a head on backwards)",
                            UPSIDE_DOWN),
                           ("covers or hides a face (a child must find her own face)", FACE_COVER),
                           ("is dangerous", DANGER),
                           ("singles out one particular child or a relative", SINGLES_OUT),
                           ("guesses a child's sex (write their / them)", GENDERED),
                           ("has a child being carried", CARRIED)):
        hit = pattern.search(detokened)
        if hit:
            out.append(f"{label}: {hit.group(0)!r}")
    if not swimwear:
        hit = SWIMWEAR.search(detokened)
        if hit:
            out.append(f"is about swimwear or bare skin, and this setting is not a swimwear "
                       f"one: {hit.group(0)!r}")
    if indoor:
        for label, pattern in OUTDOOR_ONLY:
            hit = pattern.search(detokened)
            if hit:
                out.append(f"is outdoor-only ({label}) in an indoor setting: {hit.group(0)!r}")
    report = prompt_guard.check(fill_children(body, n) if n >= 1 else body)
    for check_, why in list(report.findings) + list(report.advisories):
        out.append(f"prompt guard ({check_}): {why}")
    return out


def _norm(text: str) -> str:
    return re.sub(r"[^a-z{}_ ]", "", text.lower()).strip()


# ---------------------------------------------------------------------------------------------
# PHRASING — exactly as pick_activities phrases a table pick, so the image prompt cannot tell a
# written set from a picked one except by its words.
def phrase(written: dict, n: int) -> str:
    lines = written["lines"]
    if written.get("shared"):
        do = lines[0]["do"].strip().rstrip(".")
        return f"{together(n)}: " + fill_children(do, n) + "."
    head = "What the child is doing:" if n == 1 else "Each of them is doing something different:"
    return head + "".join(
        f"\n  - The child from portrait {i} is {fill_children(e['do'].strip().rstrip('.'), n)}."
        for i, e in enumerate(lines, start=1)
    )


# ---------------------------------------------------------------------------------------------
# THE COIN. The same one pick_activities tosses, from the same seed, after the same draws.
def decide_shared(tags: list[str], season: str, seed: int | None, n: int,
                  premise: dict | None = None) -> bool:
    premise = premise or {}
    rng = random.Random(seed)
    if premise.get("buildings"):
        rng.randrange(len(premise["buildings"]))
    _, shared = scene_activities.eligible(scene_activities.load(), tags, season)
    shared = [e for e in shared if cast_fits(e, n)]
    return scene_activities.coin(rng, shared, bool(premise.get("solo_only")), n)


# ---------------------------------------------------------------------------------------------
# THE REQUEST.
SYSTEM = (
    "You write what children are doing in one illustrated storybook picture. You answer with "
    "JSON only, no prose and no code fence."
)


def build_request(*, setting: dict, season: str, week_lines: list[str], n: int, shared: bool,
                  recent: list[str], reasons: list[str] = (), premise: dict | None = None,
                  camera: dict | None = None, last_kinds: list[str] = ()) -> str:
    tags = setting.get("tags") or []
    indoor = "indoor" in tags
    swim = bool(setting.get("swimwear"))
    parts = [
        "THE PLACE: " + setting["setting"].strip(),
        "Kind of place: " + ", ".join(tags) + (" (INDOORS)" if indoor else "") + ".",
        f"Season: {season}.",
        "Around them: " + setting.get("crowd", "").strip(),
    ]
    if setting.get("wardrobe"):
        parts.append("They are dressed for the place: " + setting["wardrobe"].strip())
    if week_lines:
        parts.append("This week: " + " ".join(line.strip() for line in week_lines if line))
    # The picture's own shape, so the lines suit it: a giants picture wants giant-sized things to
    # do, and a picture seen from above wants actions that read from above. Labels only — a
    # premise's brief carries tokens for gen-scene and is not written for this reader.
    if premise and premise.get("id", "plain") != "plain":
        parts.append(f"Kind of picture: {premise.get('label', premise['id'])}.")
    if camera:
        parts.append(f"Seen from: {camera.get('label', camera['id']).lower()}.")
    if n == 1:
        parts.append("There is ONE child in the picture.")
    else:
        parts.append(f"There are {n} children in the picture, known only as portrait 1 to "
                     f"portrait {n}. Nothing else is known about them.")
    if shared:
        parts.append(
            "THIS PICTURE IS ONE THING THEY ALL DO TOGETHER. Write exactly ONE line, starting "
            'with the verb itself (e.g. "pulling a giant turnip out of the ground together").')
    else:
        parts.append(
            f"Write exactly {n} line{'s' if n != 1 else ''}, one for each child, each a "
            "DIFFERENT KIND of thing (no two of the same kind, e.g. not two animal rides).")
    parts += [
        "WHAT TO WRITE: imaginative storybook whimsy that BELONGS in this place and this season "
        "— the delightful, slightly magical thing a picture-book illustrator would have a child "
        "doing here, something a child looking at the picture would point at and grin. Gentle "
        "and kind; small surprises with animals, objects, weather or the place itself are "
        "welcome. Each must be something an illustrator can DRAW and a child can spot from "
        "across the room: an action with the hands or the whole body, with a thing or a "
        "creature you can see. Not watching, imagining, pretending, wishing, listening or "
        "feeling — those cannot be drawn.",
        'Each `do` completes the sentence "The child from portrait i is ___." — so its FIRST '
        "word is a lowercase -ing verb (never gently, carefully, slowly or any -ly word before "
        "it), it is ONE short phrase of at most "
        "100 characters, and it has no full stop, colon or semicolon. `kind` is one or two "
        'lowercase words naming the KIND (e.g. "animal", "building", "music", "magic", "food", '
        '"game").',
        "RULES, all of them required: every face stays fully visible (nothing on or over a "
        "head or face, no hoods, masks, helmets, hat brims, goggles or face paint); everyone "
        "stays the right way up (no handstands, cartwheels, flips or hanging upside down); "
        "nothing dangerous (no weapons, fire, cliffs or edges); nobody is carried; no names, "
        "titles or capital letters at all; never single out one child by age or size or as "
        "anyone's relative; never he, she, his, her or him (write their, them); refer to the "
        "group only as {the_children} or {all_of_them}."
        + ("" if swim else " Everyone is fully clothed; nothing about swimming or swimwear.")
        + (" This is INDOORS: no riding animals, climbing trees, snow, water, boats, kites, "
           "fires or anything else that needs the outdoors." if indoor else ""),
    ]
    if last_kinds:
        parts.append("The last picture of this place used these kinds: " + ", ".join(last_kinds)
                     + ". Use at least one different KIND of thing this time.")
    if recent:
        parts.append("Recent pictures already used these; do NOT repeat them or near-copies:\n"
                     + "\n".join(f"- {r}" for r in recent))
    if reasons:
        parts.append("Your previous answer was REFUSED for these reasons; fix every one:\n"
                     + "\n".join(f"- {r}" for r in reasons))
    parts.append('Answer as JSON exactly like {"lines": [{"do": "...", "kind": "..."}]}.')
    return "\n\n".join(parts)


LEADING_ADVERB = re.compile(r"^(?:[a-z]+ly)\s+(?=[a-z]+ing\b)")


def normalize(answer):
    """Drop ONE leading -ly adverb before the verb ("gently stroking" -> "stroking").

    Measured on the tuning calls (2026-10-12): Gemini 2.5 Flash opened a line with "gently" or
    "carefully" in four answers of nine, ignored the instruction not to, and repeated it on the
    retry with the reason quoted — so a guardrail that only refused it bought a table fallback
    for an adverb. Trimming it keeps the rule (every frozen line starts with the -ing verb)
    without paying twice for nothing. Anything else before the verb is still refused."""
    if isinstance(answer, dict) and isinstance(answer.get("lines"), list):
        for line in answer["lines"]:
            if isinstance(line, dict) and isinstance(line.get("do"), str):
                line["do"] = LEADING_ADVERB.sub("", line["do"].strip())
    return answer


def parse_answer(raw: str):
    """Lenient about wrapping, strict about content: strips a ``` fence and any prose around
    the outermost JSON object."""
    text = raw.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        return json.loads(text[start:end + 1])
    except ValueError:
        return None


def inputs_digest(*, setting: dict, season: str, week_lines: list[str], n: int,
                  shared: bool, model: str, premise: str = "plain", camera: str = "") -> str:
    """What the set was written FROM, minus the recent lines (those change every week and must
    not make a frozen set look stale)."""
    blob = json.dumps({
        "v": PROMPT_VERSION, "setting": setting.get("id"), "text": setting.get("setting"),
        "tags": setting.get("tags") or [], "crowd": setting.get("crowd"),
        "wardrobe": setting.get("wardrobe") or "", "swimwear": bool(setting.get("swimwear")),
        "season": season, "week": list(week_lines), "n": n, "shared": shared, "model": model,
        "premise": premise, "camera": camera,
    }, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode()).hexdigest()


def recent_lines(where: pathlib.Path, exclude: str, count: int = RECENT) -> list[str]:
    """The `do` lines of the most recent OTHER written sets, newest first."""
    if not where.exists():
        return []
    sets = []
    for p in where.glob("*.json"):
        if p.stem == exclude:
            continue
        try:
            got = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if got.get("source") == "written":
            sets.append((str(got.get("written_at", "")), got))
    sets.sort(key=lambda s: s[0], reverse=True)
    return [line["do"] for _, got in sets[:count] for line in got.get("lines", [])]


def _same_place(got: dict, stem: str, setting_id: str) -> bool:
    """Is this frozen set a picture of `setting_id`? Sets written since 2026-10-28 say so; older
    ones are known by their scene id (`2026w43b-big-library-gpt`)."""
    if got.get("setting"):
        return got["setting"] == setting_id
    rest = re.sub(r"^\d{4}w\d{2}b?-", "", stem)
    return rest == setting_id or rest.startswith(setting_id + "-")


def last_kinds(where: pathlib.Path, exclude: str, setting_id: str) -> list[str]:
    """The kinds of the most recent OTHER written set for the same place, or [] if none."""
    if not where.exists():
        return []
    best: tuple[str, list[str]] | None = None
    for p in where.glob("*.json"):
        if p.stem == exclude:
            continue
        try:
            got = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if got.get("source") != "written" or not _same_place(got, p.stem, setting_id):
            continue
        at = str(got.get("written_at", ""))
        if best is None or at > best[0]:
            best = (at, [str(ln.get("kind", "")).strip().lower() for ln in got.get("lines", [])])
    return [k for k in (best[1] if best else []) if k]


def fal_writer(prompt: str, purpose: str) -> str:
    import fal_api  # noqa: E402  (imported here so the selftest and dry runs need no key)
    return fal_api.text(prompt, purpose, model=fal_api.TEXT_MODEL, system_prompt=SYSTEM)


def load_frozen(path: pathlib.Path) -> dict | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def written_set(scene_id: str, *, setting: dict, season: str, week_lines: list[str], n: int,
                seed: int | None, premise: dict | None = None, camera: dict | None = None,
                writer: Callable[[str, str], str] | None = None,
                where: pathlib.Path | None = None, model: str = "google/gemini-2.5-flash",
                log=sys.stderr) -> dict:
    """The frozen set for this scene, writing and freezing it on first use.

    Returns the set dict: `source` is "written" (pass `path_for(scene_id)` to gen-scene) or
    "table" (draw from the table as before). Never raises for a bad or missing answer."""
    where = where or directory()
    path = path_for(scene_id, where)
    tags = setting.get("tags") or []
    season = scene_activities.effective_season(tags, season)
    shared = decide_shared(tags, season, seed, n, premise)
    digest = inputs_digest(setting=setting, season=season, week_lines=week_lines, n=n,
                           shared=shared, model=model,
                           premise=(premise or {}).get("id", "plain"),
                           camera=(camera or {}).get("id", ""))
    frozen = load_frozen(path)
    if frozen is not None:
        if frozen.get("inputs_digest") != digest:
            print(f"activities: {path.name} was written from different inputs; reusing it "
                  "anyway (frozen per scene — delete it to write a new set)", file=log)
        return frozen
    recent = recent_lines(where, scene_id)
    kinds = last_kinds(where, scene_id, setting.get("id", ""))
    indoor = "indoor" in tags
    swim = bool(setting.get("swimwear"))
    write = writer or fal_writer
    reasons: list[str] = []
    attempts = 0
    for attempt in range(2):
        request = build_request(setting=setting, season=season, week_lines=week_lines, n=n,
                                shared=shared, recent=recent, reasons=reasons, premise=premise,
                                camera=camera, last_kinds=kinds)
        guard = prompt_guard.check(request)
        if guard.findings or guard.advisories:
            # Our own request tripping the guard is a code bug, never a reason to send it.
            why = "; ".join(w for _, w in list(guard.findings) + list(guard.advisories))
            print(f"activities: the writer's REQUEST failed prompt_guard ({why}); not sent — "
                  "drawing from the table", file=log)
            return {"scene_id": scene_id, "source": "table", "reason": "request refused by guard"}
        attempts += 1
        try:
            raw = write(request, f"scene activities {scene_id} (try {attempt + 1})")
        except (SystemExit, OSError, ValueError, KeyError) as err:
            print(f"activities: the writer could not be reached ({err}); drawing from the table "
                  "this run, and trying the writer again next run", file=log)
            return {"scene_id": scene_id, "source": "table", "reason": f"unreachable: {err}"}
        answer = normalize(parse_answer(raw or ""))
        reasons = (["the answer was not JSON"] if answer is None else
                   problems(answer, n=n, shared=shared, indoor=indoor, swimwear=swim,
                            recent=recent, last_kinds=kinds))
        if not reasons:
            out = {
                "scene_id": scene_id, "setting": setting.get("id"), "source": "written",
                "shared": shared,
                "lines": [{"do": ln["do"].strip().rstrip("."), "kind": ln["kind"].strip().lower()}
                          for ln in answer["lines"]],
                "model": model, "prompt_version": PROMPT_VERSION, "inputs_digest": digest,
                "attempts": attempts,
                "written_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            }
            _freeze(path, out)
            return out
        print(f"activities: answer {attempt + 1} refused:\n  - " + "\n  - ".join(reasons),
              file=log)
    out = {"scene_id": scene_id, "source": "table", "shared": shared, "lines": [],
           "model": model, "prompt_version": PROMPT_VERSION, "inputs_digest": digest,
           "attempts": attempts, "reason": "refused twice: " + "; ".join(reasons)[:600],
           "written_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}
    _freeze(path, out)
    print("activities: the writer was refused twice; drawing from the TABLE, and that choice "
          f"is frozen in {path}", file=log)
    return out


def _freeze(path: pathlib.Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def load_for_prompt(path: str, *, n: int, tags: list[str], swimwear: bool) -> str:
    """gen-scene's `--activities-file`: re-validate (the file is on disk and could have been
    edited by hand) and phrase. Refuses rather than drawing an unchecked line."""
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    if data.get("source") != "written":
        raise SystemExit(f"{path}: not a written set (source {data.get('source')!r}); "
                         "draw without --activities-file to use the table")
    found = problems(data, n=n, shared=bool(data.get("shared")), indoor="indoor" in tags,
                     swimwear=swimwear)
    if found:
        raise SystemExit(f"{path}: refused:\n  - " + "\n  - ".join(found))
    return phrase(data, n)


# ---------------------------------------------------------------------------------------------
def selftest() -> None:
    """Every guardrail accepts its good case and refuses its bad one; freeze, reuse and fallback
    work with a fake writer. No network."""
    import tempfile
    fails: list[str] = []

    def ok(lines, *, n=3, shared=False, indoor=False, swimwear=False, recent=()):
        got = problems({"lines": lines}, n=n, shared=shared, indoor=indoor, swimwear=swimwear,
                       recent=list(recent))
        if got:
            fails.append(f"refused a good answer {lines}: {got}")

    def bad(label, lines, needle, *, n=3, shared=False, indoor=False, swimwear=False, recent=()):
        got = problems({"lines": lines}, n=n, shared=shared, indoor=indoor, swimwear=swimwear,
                       recent=list(recent))
        if not any(needle in g for g in got):
            fails.append(f"{label}: expected a refusal containing {needle!r}, got {got}")

    L = lambda do, kind: {"do": do, "kind": kind}  # noqa: E731
    good = [L("feeding acorns to a squirrel wearing a tiny scarf", "animal"),
            L("stacking pumpkins into a wobbly tower", "building"),
            L("playing a tune on a leaf whistle for {all_of_them}", "music")]
    ok(good)
    ok([L("{all_of_them} pulling a giant turnip out of the ground", "garden")], shared=True)
    ok([L("rolling a snowball as big as a barrel", "snow")], n=1)
    ok([L("splashing in the shallow end with a rubber duck", "water"),
        L("swimming a slow width with a float", "swim"),
        L("sitting on the edge dangling toes in the water", "rest")], swimwear=True)
    bad("count", good[:2], "needs exactly 3")
    bad("shared count", good, "needs exactly 1", shared=True)
    bad("not json shape", [], "needs exactly 3")
    bad("length", [L("racing " + "very " * 30 + "fast", "a")] + good[1:], "characters")
    bad("two sentences", [L("feeding a squirrel. then running", "animal")] + good[1:],
        "one sentence")
    bad("not a gerund", [L("a child feeding a squirrel", "animal")] + good[1:], "-ing verb")
    bad("capital start", [L("Feeding a squirrel", "animal")] + good[1:], "-ing verb")
    bad("same kind", [good[0], L("petting a hedgehog", "animal"), good[2]], "repeats line")
    bad("upside down", [L("doing a cartwheel in the leaves", "gym")] + good[1:], "upside down")
    bad("handstand", [L("walking on her hands in a handstand", "gym")] + good[1:], "upside down")
    bad("hood", [L("pulling up a hood against the rain", "weather")] + good[1:], "face")
    bad("mask", [L("wearing a fox mask at the fair", "dress")] + good[1:], "face")
    bad("face paint", [L("getting face paint at a stall", "art")] + good[1:], "face")
    bad("helmet", [L("cycling with a shiny helmet", "ride")] + good[1:], "face")
    bad("swimwear", [L("paddling in swim shorts", "water")] + good[1:], "swimwear")
    bad("shirtless", [L("running shirtless through a sprinkler", "water")] + good[1:], "swimwear")
    bad("name", [L("waving to Lucy across the square", "friends")] + good[1:], "capital")
    bad("her", [L("balancing a pumpkin on her stack of books", "object")] + good[1:], "sex")
    bad("his", [L("tapping his wand on a book", "magic")] + good[1:], "sex")
    ok([L("balancing a pumpkin on their stack of books", "object")] + good[1:])
    trimmed = normalize({"lines": [L("gently stroking a fawn", "animal"),
                                   L("carefully happily stacking cups", "building"),
                                   L("rolling a hoop", "game")]})["lines"]
    if [t["do"] for t in trimmed] != ["stroking a fawn", "carefully happily stacking cups",
                                      "rolling a hoop"]:
        fails.append(f"normalize: only an -ly word right before the verb, got {trimmed}")
    bad("adverb survives normalize once", [trimmed[1]] + good[1:], "-ing verb")
    bad("title", [L("reading about the Wizard of the hill", "books")] + good[1:], "capital")
    bad("sword", [L("waving a wooden sword at a dragon", "play")] + good[1:], "dangerous")
    bad("cliff", [L("peering over a cliff at the sea", "look")] + good[1:], "dangerous")
    bad("fire", [L("toasting bread over open flames", "food")] + good[1:], "dangerous")
    bad("indoor ride", [L("riding a friendly deer between the shelves", "animal")] + good[1:],
        "outdoor-only", indoor=True)
    bad("indoor tree", [L("climbing a tree beside the desk", "climb")] + good[1:],
        "outdoor-only", indoor=True)
    bad("indoor sled", [L("sledding down the stairs", "snow")] + good[1:],
        "outdoor-only", indoor=True)
    bad("indoor kite", [L("flying a paper kite between the shelves", "toy")] + good[1:],
        "outdoor-only", indoor=True)
    ok([L("riding a rocking horse between the shelves", "toy")] + good[1:], indoor=True)
    bad("eldest", [L("helping the youngest reach a book", "help")] + good[1:], "singles out")
    bad("relative", [L("handing a lantern to a little brother", "help")] + good[1:],
        "singles out")
    bad("carried", [L("riding piggyback through the crowd", "play")] + good[1:], "carried")
    bad("possessive", [L("walking our dog along the path", "pet")] + good[1:], "prompt guard")
    bad("unknown token", [L("waving to {the_dog} by the gate", "pet")] + good[1:], "unknown token")
    bad("repeat", good, "word for word", recent=[good[1]["do"]])
    got = problems({"lines": good}, n=3, shared=False, indoor=False, swimwear=False,
                   last_kinds=["animal", "building", "music", "magic"])
    if not any("last picture of this place" in g for g in got):
        fails.append(f"a set made only of the place's last kinds was not refused: {got}")
    ok(good[:2] + [L("conducting a choir of frogs with a reed", "weather")])
    if problems({"lines": good[:2] + [L("conducting a choir of frogs with a reed", "weather")]},
                n=3, shared=False, indoor=False, swimwear=False,
                last_kinds=["animal", "building", "music"]):
        fails.append("one new kind among the place's last kinds must pass")

    # Phrasing is pick_activities' phrasing.
    solo = phrase({"shared": False, "lines": good}, 3)
    want = ("Each of them is doing something different:\n  - The child from portrait 1 is "
            "feeding acorns to a squirrel wearing a tiny scarf.")
    if not solo.startswith(want) or "for all three." not in solo:
        fails.append(f"solo phrasing drifted: {solo!r}")
    one = phrase({"shared": True, "lines": [L("{all_of_them} pulling a turnip", "garden")]}, 3)
    if one != "The three of them together: all three pulling a turnip.":
        fails.append(f"shared phrasing drifted: {one!r}")

    # The coin is the table's coin: same seed, same answer, for many seeds.
    import importlib.util
    spec = importlib.util.spec_from_file_location("gen_scene", HERE / "gen-scene.py")
    gen = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(gen)
        for seed in range(60):
            picked = gen.pick_activities(["forest"], "autumn", random.Random(seed), n=3)
            if picked.startswith("The three of them together") != decide_shared(
                    ["forest"], "autumn", seed, 3):
                fails.append(f"seed {seed}: the writer's coin disagrees with pick_activities")
                break
    except ImportError as err:  # PIL missing: the coin check needs gen-scene importable
        print(f"  (coin parity skipped: {err})")

    # Freeze, reuse, fallback, transport error — with fake writers.
    setting = {"id": "t", "setting": "an autumn wood", "crowd": "a few walkers",
               "tags": ["forest"]}
    with tempfile.TemporaryDirectory() as tmp:
        where = pathlib.Path(tmp)
        calls = []

        def writer_ok(prompt, purpose):
            calls.append(prompt)
            shared = "ONE THING THEY ALL DO TOGETHER" in prompt
            lines = ([L("{all_of_them} raking leaves into a dragon shape", "garden")] if shared
                     else good)
            return "```json\n" + json.dumps({"lines": lines}) + "\n```"

        quiet = open(os.devnull, "w")
        first = written_set("s1", setting=setting, season="autumn", week_lines=[], n=3, seed=7,
                            writer=writer_ok, where=where, log=quiet)
        again = written_set("s1", setting=setting, season="autumn", week_lines=[], n=3, seed=7,
                            writer=lambda *a: fails.append("reuse called the writer") or "",
                            where=where, log=quiet)
        if first.get("source") != "written" or first != again or len(calls) != 1:
            fails.append(f"freeze/reuse: {first} / {again} / {len(calls)} calls")
        # The cast's fields never reach the writer: no sex, hair, years or heights.
        for word in ("girl", "boy", "hair", r"\d+ years?", r"years old", r"\d+ ?cm"):
            if re.search(rf"\b{word}\b", calls[0], re.IGNORECASE):
                fails.append(f"the request mentions {word!r}: it must carry no cast field")

        bad_calls = []

        def writer_bad(prompt, purpose):
            bad_calls.append(prompt)
            return json.dumps({"lines": [L("doing a handstand", "gym")]})

        fell = written_set("s2", setting=setting, season="autumn", week_lines=[], n=3, seed=7,
                           writer=writer_bad, where=where, log=quiet)
        if fell.get("source") != "table" or len(bad_calls) != 2 \
                or "REFUSED" not in bad_calls[1] or not path_for("s2", where).exists():
            fails.append(f"fallback after two bad answers: {fell}, {len(bad_calls)} calls")
        if written_set("s2", setting=setting, season="autumn", week_lines=[], n=3, seed=7,
                       writer=writer_bad, where=where, log=quiet)["source"] != "table" \
                or len(bad_calls) != 2:
            fails.append("a frozen table fallback called the writer again")

        def writer_down(prompt, purpose):
            raise SystemExit("the text endpoint failed 3 times")

        down = written_set("s3", setting=setting, season="autumn", week_lines=[], n=3, seed=7,
                           writer=writer_down, where=where, log=quiet)
        if down.get("source") != "table" or path_for("s3", where).exists():
            fails.append(f"an unreachable writer must fall back and NOT freeze: {down}")
        recent = recent_lines(where, "s9")
        if not recent:
            fails.append("recent_lines found no written set")
        # The same place's last kinds reach the next request, with its camera and premise.
        calls.clear()
        written_set("s4", setting=setting, season="autumn", week_lines=[], n=3, seed=7,
                    writer=writer_ok, where=where, log=quiet,
                    camera={"id": "high-angle", "label": "Looking down from above"},
                    premise={"id": "giants", "label": "Three giants"})
        want_kinds = ", ".join(ln["kind"] for ln in first["lines"])
        if not calls or f"this place used these kinds: {want_kinds}" not in calls[0] \
                or "Seen from: looking down from above." not in calls[0] \
                or "Kind of picture: Three giants." not in calls[0]:
            fails.append("the request lacks the place's last kinds, the camera or the premise")
        if last_kinds(where, "x", "another-place"):
            fails.append("last_kinds matched a different place")
        if last_kinds(where, "x", "") or _same_place({}, "2026w43b-big-library-gpt", "big-library") \
                is not True or _same_place({}, "2026w43b-big-library-annex-gpt", "big-lib"):
            fails.append("_same_place reads ids wrongly")
        quiet.close()

    if fails:
        raise SystemExit("scene_activity_writer selftest FAILED:\n  " + "\n  ".join(fails))
    print("scene_activity_writer selftest: ok")


if __name__ == "__main__":
    if sys.argv[1:] == ["--selftest"]:
        selftest()
    else:
        raise SystemExit(__doc__)
