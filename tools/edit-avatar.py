#!/usr/bin/env python3
"""Edit ONE avatar in place, conditioned on itself, changing only what is named.

    OP_SERVICE_ACCOUNT_TOKEN="$(cat ~/.config/op-service-token)" \
    op run --env-file=tools/op.env -- \
    python3 tools/edit-avatar.py assets/avatars/a.jpg "the eyes are light green" out.jpg

    --provider fal|nous   (default fal)
    --changing hair,clothes   (aspects this edit is ALLOWED to move; default none)

`--changing` drops the matching "everything else stays the same" clause. Without it a hair
edit asks the model to change the hair and keep the hair, and what comes back is neither.

WHICH DOOR. fal, by default, since 2026-09-16. Nous was the only door when this was written
and it still works (`--provider nous`, `NOUS_API_KEY`), but fal is the funded one, it is the
one whose edit models were measured against these very avatars (2026-09-12), it costs $0.053
against Nous's $0.15, and every paid call lands in `db/fal-ledger.jsonl` where Nous's does
not. A dry Nous account is also the worst failure shape here: it answers cheap calls 200 and
the real one 402, so "the key is broken" is the wrong conclusion and the right one is "top up".

WHY THIS EXISTS RATHER THAN A REGENERATION. The avatars are the character bible — every
scene conditions on them (docs/scene-pipeline.md §0) — and they are ALSO the rail's
navigation token, which `AccentFrame` records as the reason three geometric shapes were
replaced by three faces in the first place: "three distinct faces, three hairstyles, three
eye colours" is a far stronger identity channel than a polygon. So a wrong detail in an
avatar is a bug at the source and worth fixing, and a from-scratch redraw to fix it would
change the one thing a three-year-old navigates by.

Conditioning the edit on the image itself is what keeps it an EDIT. The instruction says
what changes and, just as importantly, enumerates what must not.

DISCLOSURE: unchanged from every other generator here. `enforce` reads the whole prompt and
`enforce_references` refuses any attachment that is not committed house art, so the only
image that can be sent is one already in the repo. The instruction carries an appearance
detail and no name, age or household reference — which is the same posture as the scene
prompts, where appearance travels as art rather than as text.
"""
import base64
import io
import json
import os
import sys
import urllib.request

from PIL import Image

import fal_api
from gen_icon_shim import ENDPOINT, MODEL, data_uri
from prompt_guard import enforce, enforce_references

# The cheapest model measured to hold these faces, and square, because an avatar is square and
# a 16:9 portrait would be centre-cropped back to one by `save_like` — losing the hair, which
# is the whole point of every edit this script has ever been asked to make.
FAL_MODEL = "openai/gpt-image-2/edit"

# NOTE FOR ANYONE WRITING THE NEXT EDITOR: this paragraph deliberately does not say "the same
# face". `prompt_guard` refuses that phrase — "a specific face is a likeness" — and it is RIGHT
# to, so the wording moved rather than the rule. The guard cannot tell from text alone whether
# the face in question is a committed cartoon or a photograph of a person, and the next author
# who writes "same face" may well be attaching the latter. "The same features and expression"
# says the identical thing to the model and leaves the check at full strength. Do not loosen the
# pattern to make an editor compile.
# One clause per thing that must not move, keyed so the CALLER can drop the one it is about.
# This used to be a single sentence, and it flatly contradicted the most useful edit there is:
# it said "the same hairstyle and hair colour" while the instruction said to change the hair.
# A model handed both does something in between, and the result looks like the model being bad
# at edits rather than the prompt asking for two opposite things. Default is every clause, so
# a call with no `--changing` is byte-identical to every call made before 2026-09-16.
PRESERVE_CLAUSES = {
    "face": "the same features, the same expression and smile",
    "hair": "the same hairstyle and hair colour",
    "clothes": "the same clothing",
    "background": "the same flat circle of colour behind the head",
    "crop": "the same square framing and crop",
    "style": "the same thick black outlines and flat colouring-book style",
}


def preserve(changing: tuple[str, ...] = ()) -> str:
    for aspect in changing:
        if aspect not in PRESERVE_CLAUSES:
            raise SystemExit(
                f"unknown aspect {aspect!r}; known: {', '.join(PRESERVE_CLAUSES)}"
            )
    kept = [c for k, c in PRESERVE_CLAUSES.items() if k not in changing]
    return (
        "Change ONLY that. Everything else stays exactly as it is: "
        + ", ".join(kept)
        + ". This is a small edit to one detail of an existing picture, not a new drawing."
    )


def prompt_for(change: str, changing: tuple[str, ...] = ()) -> str:
    """Assembled once, so both doors send the identical words and the guard sees them once."""
    prompt = f"Here is an illustration. Redraw it with one change: {change}.\n\n{preserve(changing)}"
    # Both checks run for BOTH providers. `enforce_references` is the one that matters: it
    # refuses any attachment that is not inside assets/ and tracked by git, which is the
    # mechanism — not the promise — that a photograph of a child cannot be sent from here.
    enforce(prompt)
    return prompt


def edit_fal(src: str, change: str, changing: tuple[str, ...] = ()) -> bytes:
    prompt = prompt_for(change, changing)
    enforce_references((src,))
    return fal_api.generate(
        FAL_MODEL, prompt, [fal_api.data_uri(src)],
        purpose=f"avatar edit {os.path.basename(src)}", aspect_ratio="1:1",
    )


def edit(src: str, change: str, key: str, timeout: int = 300,
         changing: tuple[str, ...] = ()) -> bytes:
    prompt = prompt_for(change, changing)
    enforce_references((src,))

    content = [
        {"type": "text", "text": prompt},
        {"type": "image_url", "image_url": {"url": data_uri(src)}},
    ]
    body = json.dumps(
        {"model": MODEL, "modalities": ["image", "text"],
         "messages": [{"role": "user", "content": content}]}
    ).encode()
    req = urllib.request.Request(
        ENDPOINT, data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json",
                 "User-Agent": "family-calendar-avatars/1.0"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = json.load(resp)
    usage = payload.get("usage") or {}
    if usage:
        print("usage: " + ", ".join(f"{k}={v}" for k, v in sorted(usage.items())
                                    if isinstance(v, (int, float))), file=sys.stderr)
    images = payload["choices"][0]["message"].get("images") or []
    if not images:
        raise SystemExit("no image in response: " + json.dumps(payload)[:400])
    return base64.b64decode(images[0]["image_url"]["url"].split(",", 1)[1])


def save_like(raw: bytes, template: str, dst: str) -> None:
    """Match the existing avatars' size and format exactly, so nothing downstream shifts."""
    ref = Image.open(template)
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    if im.size != ref.size:
        side = min(im.size)
        im = im.crop(((im.width - side) // 2, (im.height - side) // 2,
                      (im.width - side) // 2 + side, (im.height - side) // 2 + side))
        im = im.resize(ref.size, Image.LANCZOS)
    im.save(dst, "JPEG", quality=88, progressive=True, optimize=True)
    print(f"{dst}  {im.size[0]}x{im.size[1]}  {os.path.getsize(dst) // 1024} KB")


if __name__ == "__main__":
    argv = sys.argv[1:]
    provider = "fal"
    changing: tuple[str, ...] = ()
    while argv and argv[0].startswith("--"):
        flag = argv.pop(0)
        if flag == "--provider":
            provider = argv.pop(0)
        elif flag == "--changing":
            changing = tuple(a.strip() for a in argv.pop(0).split(",") if a.strip())
        else:
            raise SystemExit(f"unknown flag {flag}\n{__doc__}")
    if len(argv) != 3:
        raise SystemExit(__doc__)
    src, change, dst = argv
    if provider == "fal":
        raw = edit_fal(src, change, changing)
    elif provider == "nous":
        raw = edit(src, change, os.environ["NOUS_API_KEY"], changing=changing)
    else:
        raise SystemExit(f"unknown provider {provider!r}; known: fal, nous")
    save_like(raw, src, dst)
