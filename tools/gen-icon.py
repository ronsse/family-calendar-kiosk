#!/usr/bin/env python3
"""Generate one wall icon in the established colouring-book style, and cut its ground out.

    OP_SERVICE_ACCOUNT_TOKEN="$(cat ~/.config/op-service-token)" \
    op run --env-file=tools/op.env -- \
    python3 tools/gen-icon.py "a soccer ball" assets/icons/sport.png

The keys come from the ENVIRONMENT (NOUS_API_KEY, NVIDIA_API_KEY, FAL_KEY), injected by
`op run` from the gitignored tools/op.env — tools/op.env.example shows the reference form.

THREE BACKENDS, and they are NOT equivalent. `--provider fal` is `fal-ai/nano-banana-2/edit`
(Gemini image, $0.12, via tools/fal_api.py and its ledger) with the same two style references
attached — the door that WORKS since Nous went dry on 2026-09-10. `--provider nous` (the
historical default, kept for the day the account is topped up) is
`google/gemini-3-pro-image` with two approved icons attached as style references — lever 4 in
tools/backgrounds.md, and the thing that made the eleven-icon set come back coherent first time
after wording alone had failed three times. `--provider nvidia` is FLUX.1-dev on
build.nvidia.com, which is FREE but is TEXT-TO-IMAGE ONLY at that endpoint: there is nowhere to
put the reference images, so lever 4 is simply unavailable and the set has to hold on wording
plus `cut()`. Use it to save credits on a subject with an unambiguous silhouette, look at the
result NEXT TO the existing set, and fall back to nous the moment the line weight drifts.

    OP_SERVICE_ACCOUNT_TOKEN="$(cat ~/.config/op-service-token)" \
    op run --env-file=tools/op.env -- \
    python3 tools/gen-icon.py --provider nvidia "a soccer ball" assets/icons/sport.png

Needs Pillow, which is not installed system-wide on the server (PEP 668). A throwaway venv is
the intended way: `python3 -m venv /tmp/icons && /tmp/icons/bin/pip install Pillow`.

This is the tooling half of tools/backgrounds.md, which documented the approach and shipped
no script — so the 2026-08-26 set could not be extended without reconstructing it. The two
things that were reconstructed the hard way are both encoded below: the mandatory User-Agent,
and that a subject whose real-world colours are achromatic comes back greyscale unless the
prompt forbids it outright.

DISCLOSURE (ADR-0002, build-plan.md §3.1): the subject is a scene noun and nothing else. No
name, no age, no household reference of any kind, ever. And no people — not a silhouette, not
a figure in the distance. That rule is no longer a paragraph an author has to remember:
`prompt_guard.enforce` runs inside generate() and exits 2 before a socket is opened.
"""
import base64
import json
import os
import sys
import urllib.request

from PIL import Image, ImageDraw

from prompt_guard import enforce, enforce_references

ENDPOINT = "https://inference-api.nousresearch.com/v1/chat/completions"
MODEL = "google/gemini-3-pro-image"

# The free tier. Verified reachable 2026-08-31 with the NVIDIA key from the environment.
# `steps` must be >= 5 or the endpoint 422s. The response is {"artifacts":[{"base64":...}]},
# NOT an OpenAI-shaped choices/message payload — this is a different API on a different host,
# and only `cut()` is shared downstream.
NVIDIA_ENDPOINT = "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-dev"

# Two approved icons go in the message as style references. This is lever 4 in
# backgrounds.md — `google/gemini-3-pro-image` is text+image->text+image, and conditioning on
# an approved image beats any amount of prompt wording. It is what made the eleven-icon set
# come back coherent first time after wording alone had failed three times.
REFERENCES = ("assets/icons/bag.png", "assets/icons/teeth.png")

COMPOSITION = (
    "A single object, centred, filling most of the square with a comfortable even margin on "
    "all four sides. Plain pure WHITE background, nothing else in the picture. No people, no "
    "hands, no figures, no shadow on the ground."
)
# The first soccer ball came back a beautiful monochrome — because a soccer ball IS black and
# white — and would have been the only greyscale thing on a wall of flat colour. Naming the
# hexes is the palette lever; forbidding greyscale outright is what handles a subject whose
# real colours are achromatic.
PALETTE = (
    "Colour it with flat solid fills from this palette: blue #0D3399, pink #D02076, amber "
    "#FFAE14, green #128239, red #A8221B, cream #FFFDF9, sand #E7DCC9, tan #B9A888, brown "
    "#7D6B57, near-black #171310 for the outlines only. Every icon in this set is BRIGHTLY "
    "COLOURED. Do NOT draw it in greyscale or in black and white, even if the real object "
    "usually is — substitute a colour from the palette instead."
)
STYLE = (
    "Style: children's colouring-book cartoon. VERY THICK uniform black outlines on every "
    "shape, flat solid fills, no shading, no gradients, no texture. Absolutely NO text, NO "
    "letters, NO numbers, NO frame, NO border box."
)

BOX = 256      # what the manifest and the existing set use
CONTENT = 208  # long side of the drawn content; matches the existing set's ~200-213px
SENTINEL = (255, 0, 255)


def _data_uri(path: str) -> str:
    with open(path, "rb") as fh:
        return "data:image/png;base64," + base64.b64encode(fh.read()).decode()


def generate(subject: str, key: str, timeout: int = 300) -> bytes:
    prompt = (
        "Here are two icons from an existing set. Draw ONE NEW icon that belongs to "
        "exactly this set: the same line weight, the same flat cartoon construction, "
        "the same kind of simple bright palette.\n\n"
        f"Subject: {subject}\n\n{COMPOSITION}\n\n{PALETTE}\n\n{STYLE}"
    )
    # The guard sits HERE rather than in __main__, so a future caller of generate() — a batch
    # script, a notebook, an agent — cannot route around it. It reads the whole assembled
    # prompt, not just the subject, because the scaffold is editable too and a household
    # reference dropped into COMPOSITION would leave the house just as readily.
    enforce(prompt)

    # The attachments matter more than the sentence: this is text+image->image, and a
    # photograph sent as a "style reference" discloses more than any prompt could while
    # the prompt beside it still reads as clean scene nouns.
    enforce_references(REFERENCES)
    content = [{"type": "text", "text": prompt}]
    content += [{"type": "image_url", "image_url": {"url": _data_uri(r)}} for r in REFERENCES]

    body = json.dumps(
        {"model": MODEL, "modalities": ["image", "text"], "messages": [{"role": "user", "content": content}]}
    ).encode()
    req = urllib.request.Request(
        ENDPOINT,
        data=body,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            # Mandatory. The endpoint 403s the default Python-urllib User-Agent and the
            # failure is indistinguishable from an auth rejection — the same trap the
            # decision-panel skill documents, rediscovered here because this script did
            # not exist.
            "User-Agent": "family-calendar-icons/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = json.load(resp)
    # Report what the call actually cost. An image model billed per output token gives no
    # hint of its price from the outside, and this pipeline is heading for a WEEKLY scheduled
    # run — a per-call number in the log is the difference between a known line item and a
    # surprise. `usage` is absent on some proxy paths, so this never fails the generation.
    usage = payload.get("usage") or {}
    if usage:
        print(
            "usage: "
            + ", ".join(f"{k}={v}" for k, v in sorted(usage.items()) if isinstance(v, (int, float))),
            file=sys.stderr,
        )
    images = payload["choices"][0]["message"].get("images") or []
    if not images:
        # The proxy occasionally answers with prose, or an HTML error page. Retry.
        raise SystemExit("no image in response: " + json.dumps(payload)[:400])
    return base64.b64decode(images[0]["image_url"]["url"].split(",", 1)[1])


def generate_fal(subject: str) -> bytes:
    """The Nous prompt, word for word, sent to the same Gemini image model through fal.

    Lever 4 survives: fal's edit models take `image_urls`, so the two approved icons ride along
    exactly as they do on Nous. The square comes from `aspect_ratio="1:1"` — the model table in
    fal_api is shaped for 16:9 scenes, and an icon squeezed into a scene frame comes back as a
    small object in a wide white field that `cut()` then scales up from fewer pixels.
    """
    import fal_api  # tools/ is on sys.path when run as a script

    prompt = (
        "Here are two icons from an existing set. Draw ONE NEW icon that belongs to "
        "exactly this set: the same line weight, the same flat cartoon construction, "
        "the same kind of simple bright palette.\n\n"
        f"Subject: {subject}\n\n{COMPOSITION}\n\n{PALETTE}\n\n{STYLE}"
    )
    enforce(prompt)
    enforce_references(REFERENCES)
    return fal_api.generate(
        "fal-ai/nano-banana-2/edit",
        prompt,
        [fal_api.data_uri(r) for r in REFERENCES],
        purpose=f"icon: {subject[:40]}",
        aspect_ratio="1:1",
    )


def generate_nvidia(subject: str, key: str, seed: int = 0, timeout: int = 300) -> bytes:
    """FLUX.1-dev on build.nvidia.com. Free, and weaker where it matters.

    Same scaffold, same guard, same `cut()` afterwards. What is missing is the reference
    images: this endpoint takes a bare `prompt` string, so the strongest consistency lever in
    tools/backgrounds.md cannot be applied and the wording is carrying the whole set on its
    own. That is exactly the configuration that failed three times before lever 4 was adopted,
    so the output is a CANDIDATE and not a drop-in — look at it beside the existing icons
    before committing it.

    The reference sentence from the nous prompt is replaced rather than dropped. Telling a
    text-to-image model "here are two icons" when nothing is attached is an instruction it
    cannot follow, and an unfollowable clause is a good way to lose the clauses around it.
    """
    prompt = (
        "A single flat cartoon icon drawn in a children's colouring-book style, one of a "
        "matching set.\n\n"
        f"Subject: {subject}\n\n{COMPOSITION}\n\n{PALETTE}\n\n{STYLE}"
    )
    # Same guard, same reason, and it must stay on THIS side of the socket: a second backend
    # is exactly how a disclosure rule quietly becomes a property of one code path.
    enforce(prompt)

    body = json.dumps(
        {
            "prompt": prompt,
            "width": 1024,
            "height": 1024,
            # 30/3.5 is the vendor default band. `steps` under 5 is a 422.
            "steps": 30,
            "cfg_scale": 3.5,
            "seed": seed,
        }
    ).encode()
    req = urllib.request.Request(
        NVIDIA_ENDPOINT,
        data=body,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "family-calendar-icons/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = json.load(resp)
    artifacts = payload.get("artifacts") or []
    if not artifacts:
        raise SystemExit("no image in response: " + json.dumps(payload)[:400])
    return base64.b64decode(artifacts[0]["base64"])


def cut(raw: bytes, dst: str) -> None:
    """Ground to transparent, then framing normalised by construction.

    The flood fill works ONLY because the style has thick closed outlines — the style is what
    makes the post-processing possible. Icons sit on white cards AND on tinted chore rows, so
    a baked-in white square would show behind every icon on half the wall.

    Cropping to the drawn content and scaling the long side to a fixed fraction is the lever
    backgrounds.md calls the one that cannot fail: whatever the model did with margins, the
    set ends up identically framed.
    """
    import io

    im = Image.open(io.BytesIO(raw)).convert("RGB")
    w, h = im.size
    for corner in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        # thresh catches the anti-aliased near-white ring around every outline; without it the
        # fill stops a pixel short and leaves a halo that reads as a white keyline on a tint.
        ImageDraw.floodfill(im, corner, SENTINEL, thresh=40)

    rgba = im.convert("RGBA")
    px = rgba.load()
    for y in range(h):
        for x in range(w):
            if px[x, y][:3] == SENTINEL:
                px[x, y] = (0, 0, 0, 0)

    bbox = rgba.getbbox()
    if bbox is None:
        raise SystemExit("the flood fill consumed the whole image — outlines were not closed")
    content = rgba.crop(bbox)
    cw, ch = content.size
    scale = CONTENT / max(cw, ch)
    content = content.resize((max(1, round(cw * scale)), max(1, round(ch * scale))), Image.LANCZOS)

    out = Image.new("RGBA", (BOX, BOX), (0, 0, 0, 0))
    out.paste(content, ((BOX - content.size[0]) // 2, (BOX - content.size[1]) // 2))
    out.save(dst)
    print(f"{dst}  content={content.size} in {BOX}x{BOX}")


if __name__ == "__main__":
    argv = sys.argv[1:]
    provider = "nous"
    seed = 0
    while argv and argv[0].startswith("--"):
        flag = argv.pop(0)
        if flag == "--provider":
            provider = argv.pop(0)
        elif flag == "--seed":
            seed = int(argv.pop(0))
        else:
            raise SystemExit(f"unknown flag {flag}\n{__doc__}")
    if len(argv) != 2 or provider not in ("nous", "nvidia", "fal"):
        raise SystemExit(__doc__)

    subject, dst = argv
    if provider == "nvidia":
        cut(generate_nvidia(subject, os.environ["NVIDIA_API_KEY"], seed), dst)
    elif provider == "fal":
        cut(generate_fal(subject), dst)
    else:
        cut(generate(subject, os.environ["NOUS_API_KEY"]), dst)
