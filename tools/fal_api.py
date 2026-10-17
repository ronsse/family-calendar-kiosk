"""fal.ai, in one place: the queue call, the model allowlist, the price table and the ledger.

An underscore name because gen-scene.py, scene-regions.py and scene-week.py all import it, and
the hyphenated scripts cannot be imported themselves (the gen_icon_shim precedent).

WHY FAL. Measured 2026-09-12 (docs/scene-imagery-plan.md §1): with nothing but the three
committed avatars attached, the Gemini-image and OpenAI edit models on fal hold all three
children across cartoon, anime AND photoreal; FLUX holds them in cartoon but cannot leave the
avatars' style; Seedream and Kontext do not hold them at all. Nous — the previous door to the
same Gemini model — is dry, and the LiteLLM `image` tiers are text-to-image and cannot take the
avatars. So scenes call fal directly, and only the models in MODELS below.

THE ALLOWLIST IS THE GUARDRAIL, not a preference. A model that draws four children, or the
wrong children, produces a picture that LOOKS like a scene and is not one: a child taps the
figure she thinks is herself and nothing happens, and the rail is hidden on that screen. So
`generate` refuses a model id that is not in the table rather than trying it, and the table
carries what was measured and when.

NO BALANCE ENDPOINT AND NO COST IN THE RESPONSE. fal returns neither, so every call appends
one line to a ledger (`db/fal-ledger.jsonl`, gitignored — it is the household's spend, not the
repo's) with the model, the list price and what it was for. `python3 tools/fal_api.py` prints
the running total. The list prices are fal's as of 2026-09-12; re-check them when the bill
disagrees with the ledger.

THE KEY is read from the FAL_KEY environment variable and nothing else. The caller supplies it,
typically from 1Password with `op run --env-file=tools/op.env -- …`, where tools/op.env
(gitignored) holds a line of the form

    FAL_KEY=op://<vault>/<item>/credential

tools/op.env.example is the committed template. This module never names a vault.
"""
import base64
import datetime as dt
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request

REPO = pathlib.Path(__file__).resolve().parent.parent
# FAL_LEDGER points the ledger elsewhere. The tests set it to an empty temp path, so the
# household's real spend this week can never decide whether a dry run says "over budget".
LEDGER = pathlib.Path(os.environ["FAL_LEDGER"]) if os.environ.get("FAL_LEDGER") else REPO / "db" / "fal-ledger.jsonl"

QUEUE = "https://queue.fal.run"
SYNC = "https://fal.run"

# Every scene model this repo may call, with the request shape each one wants (they differ:
# Gemini takes an aspect ratio and a resolution tier; OpenAI and FLUX take pixel sizes) and its
# list price per image. `styles` says which style FAMILIES a model may be asked for, from the
# measurement: FLUX.2-pro holds the cast but paints cartoon children into a photograph when
# asked for photoreal, so it is a cartoon-only choice. `illustration` covers every row of
# scene-styles.json that is drawn rather than photographed.
MODELS = {
    "openai/gpt-image-2/edit": {
        "price": 0.053,
        "styles": ("illustration", "anime", "render"),
        "note": "cheapest that holds the cast; best cartoon layout; returns 1920x1072",
        "body": lambda prompt, refs: {
            "prompt": prompt, "image_urls": refs,
            "image_size": {"width": 1920, "height": 1080}, "quality": "medium",
        },
    },
    "fal-ai/nano-banana-2/edit": {
        "price": 0.12,
        "styles": ("illustration", "anime", "render"),
        "note": "Gemini 3.1 Flash Image; 2752x1536; once put the eldest at the back",
        "body": lambda prompt, refs: {
            "prompt": prompt, "image_urls": refs,
            "aspect_ratio": "16:9", "resolution": "2K", "num_images": 1,
        },
    },
    "fal-ai/nano-banana-pro/edit": {
        "price": 0.15,
        "styles": ("illustration", "anime", "render"),
        "note": "Gemini 3 Pro Image; the model Nous sold at $0.14; held everything twice",
        "body": lambda prompt, refs: {
            "prompt": prompt, "image_urls": refs,
            "aspect_ratio": "16:9", "resolution": "2K", "num_images": 1,
        },
    },
    "fal-ai/flux-2-pro/edit": {
        "price": 0.05,
        "styles": ("illustration",),
        "note": "holds the cast in cartoon; cannot leave the avatars' style for photoreal",
        "body": lambda prompt, refs: {
            "prompt": prompt, "image_urls": refs,
            "image_size": {"width": 1920, "height": 1080},
        },
    },
}

# Which model draws which style FAMILY when the style row does not pin one. gpt-image-2 is the
# cheapest model that holds the cast and had the best cartoon layouts in the probe; the Gemini
# image models held the cast in every style and are the choice where the picture has to leave
# the avatars' cartoon manner altogether. scene-week.py offers one candidate from the default
# and one from the next allowed model.
DEFAULT_FOR_FAMILY = {
    "illustration": "openai/gpt-image-2/edit",
    "anime": "fal-ai/nano-banana-2/edit",
    # `render` (2026-09-20) is the 3D family. Gemini by default for the same reason as anime:
    # it is the one that leaves the avatars' cartoon manner most willingly, and a clay puppet
    # or a paper figure is about as far from a flat colouring-book portrait as this wall goes.
    "render": "fal-ai/nano-banana-2/edit",
}


def allowed_for(family: str) -> list[str]:
    """The measured-safe models for a family, default first."""
    first = DEFAULT_FOR_FAMILY.get(family, DEFAULT_FOR_FAMILY["illustration"])
    rest = [m for m, spec in MODELS.items() if family in spec["styles"] and m != first]
    return [first] + rest


# The vision model behind scene-regions.py, on fal's `any-llm/vision` endpoint, which takes a
# prompt and a list of images and returns text. Gemini 2.5 Flash located all three children in
# the campsite scene from a written description alone, in 3s, on 2026-09-12; Qwen3-VL-32B found
# the same boxes but emitted them in a different coordinate order, which is exactly the kind of
# drift a region finder cannot absorb. Standard-rate model; the premium ones cost 3x.
VISION_ENDPOINT = "fal-ai/any-llm/vision"
VISION_MODEL = os.environ.get("SCENE_VISION_MODEL", "google/gemini-2.5-flash")
VISION_PRICE = 0.003   # order of magnitude, for the ledger; fal bills these per token

# TEXT, on fal's `any-llm` endpoint (2026-10-12): what the children are doing in a scene is
# written per scene by tools/scene_activity_writer.py, on the household's word ("kids
# activities can be ai generated and creative. it does not have to drive from a list"). The
# same allowlist discipline as MODELS: `text()` refuses an id that is not here. The price is a
# ledger estimate (fal bills per token, ~1k tokens a call at Gemini 2.5 Flash's rates is about a
# tenth of a cent); rounded UP so a cap errs towards refusing.
TEXT_ENDPOINT = "fal-ai/any-llm"
TEXT_MODELS = {
    "google/gemini-2.5-flash": {
        "price": 0.002,
        "note": "the finder's model; answers the activity writer's JSON in ~2s",
    },
}
TEXT_MODEL = "google/gemini-2.5-flash"


def key() -> str:
    got = os.environ.get("FAL_KEY")
    if not got:
        raise SystemExit("FAL_KEY is not set (tools/op.env.example shows the 1Password form)")
    return got


def data_uri(path: str) -> str:
    mime = "image/png" if path.lower().endswith(".png") else "image/jpeg"
    with open(path, "rb") as fh:
        return f"data:{mime};base64," + base64.b64encode(fh.read()).decode()


def _request(url: str, body: dict | None = None, timeout: int = 60) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Key {key()}", "Content-Type": "application/json",
                 "User-Agent": "family-calendar-scenes/2.0"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def record(model: str, price: float, purpose: str, extra: dict | None = None) -> None:
    """One ledger line per paid call, written BEFORE the result is used, so a call that was
    paid for and then crashed the caller still shows up in the total."""
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    row = {"at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
           "model": model, "price": price, "purpose": purpose}
    if extra:
        row.update(extra)
    with open(LEDGER, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(row) + "\n")


def total() -> tuple[float, int]:
    if not LEDGER.exists():
        return 0.0, 0
    rows = [json.loads(line) for line in LEDGER.read_text().splitlines() if line.strip()]
    return sum(r["price"] for r in rows), len(rows)


def spent_since(since: dt.datetime) -> float:
    """What the ledger says was spent at or after `since` (an aware datetime). The weekly
    budget in scene-week.py is enforced against this, because fal has no balance API.

    A line whose `at` is missing or unreadable is counted as spent: a cap should err towards
    refusing, never towards a bill nobody agreed to."""
    if not LEDGER.exists():
        return 0.0
    total_ = 0.0
    for line in LEDGER.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except ValueError:
            continue
        try:
            at = dt.datetime.fromisoformat(str(row["at"]))
            if at.tzinfo is None:
                at = at.replace(tzinfo=dt.timezone.utc)
            recent = at >= since
        except (KeyError, ValueError):
            recent = True
        if recent:
            total_ += float(row.get("price") or 0)
    return total_


def generate(model: str, prompt: str, refs: list[str], purpose: str, timeout: int = 420,
             aspect_ratio: str | None = None) -> bytes:
    """Submit to the queue, poll until COMPLETED, fetch the first image. Refuses any model not
    in MODELS. `refs` are data: URIs — fal accepts them inline, so no upload step and nothing
    is hosted anywhere.

    `aspect_ratio` overrides the model's scene shape for a caller that is not drawing a scene
    (gen-icon.py wants a square); it is only honoured by the Gemini models, whose request body
    has the field — the pixel-sized models ignore it, which is why it is not on the table."""
    if model not in MODELS:
        raise SystemExit(
            f"{model!r} is not an allowed scene model; measured and allowed: "
            + ", ".join(MODELS)
        )
    spec = MODELS[model]
    record(model, spec["price"], purpose)
    body = spec["body"](prompt, refs)
    if aspect_ratio is not None and "aspect_ratio" in body:
        body["aspect_ratio"] = aspect_ratio
    try:
        sub = _request(f"{QUEUE}/{model}", body)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode()[:600]
        if exc.code in (402, 403):
            detail += "\n(a 402/403 from fal is a balance or key problem — top up or re-read the key)"
        raise SystemExit(f"fal submit {exc.code} for {model}: {detail}")
    # POLLING AND FETCHING ARE GUARDED TOO, and were not until 2026-09-24. The submit above had
    # its `detail` since the beginning; these two did not, so a non-2xx here escaped as a bare
    # `urllib.error.HTTPError: HTTP Error 422` with fal's own explanation thrown away. That is
    # exactly what the weekly timer produced on 2026-09-20 — a traceback that named a status
    # code and nothing else, for a run nobody was awake to watch. An error that cannot say what
    # is wrong is this repo's signature bug wearing a stack trace.
    def poll(url: str, what: str) -> dict:
        try:
            return _request(url)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode()[:600]
            raise SystemExit(f"fal {what} {exc.code} for {model}: {detail}")

    t0 = time.time()
    while True:
        status = poll(sub["status_url"], "status")
        if status["status"] == "COMPLETED":
            break
        if status["status"] in ("FAILED", "ERROR"):
            raise SystemExit(f"fal job failed for {model}: {json.dumps(status)[:600]}")
        if time.time() - t0 > timeout:
            raise SystemExit(f"fal job for {model} did not finish in {timeout}s")
        time.sleep(3)
    result = poll(sub["response_url"], "result")
    images = result.get("images") or []
    if not images:
        raise SystemExit(f"no image in fal response for {model}: {json.dumps(result)[:400]}")
    print(f"fal: {model}  ${spec['price']:.3f}  {time.time() - t0:.0f}s  "
          f"{images[0].get('width')}x{images[0].get('height')}", file=sys.stderr)
    with urllib.request.urlopen(images[0]["url"], timeout=120) as resp:
        return resp.read()


def vision(prompt: str, images: list[str], purpose: str, model: str = VISION_MODEL,
           timeout: int = 120, attempts: int = 3) -> str:
    """One text answer about one or more images. Retries 5xx and timeouts only — a 4xx is our
    own request being wrong and will be wrong again in four seconds."""
    body = {"prompt": prompt, "image_urls": images, "model": model, "temperature": 0}
    record(VISION_ENDPOINT + ":" + model, VISION_PRICE, purpose)
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            out = _request(f"{SYNC}/{VISION_ENDPOINT}", body, timeout=timeout)
            if out.get("error"):
                raise SystemExit(f"vision model error: {out['error']}")
            return out["output"]
        except urllib.error.HTTPError as exc:
            if exc.code < 500:
                raise SystemExit(f"vision call {exc.code}: {exc.read().decode()[:400]}")
            last = exc
        except (urllib.error.URLError, TimeoutError) as exc:
            last = exc
        if attempt + 1 < attempts:
            wait = 4 * (attempt + 1)
            print(f"  vision call failed ({last}); retrying in {wait}s", file=sys.stderr)
            time.sleep(wait)
    raise SystemExit(f"the vision endpoint failed {attempts} times: {last}")


def text(prompt: str, purpose: str, model: str = TEXT_MODEL, system_prompt: str | None = None,
         temperature: float = 1.0, timeout: int = 90, attempts: int = 3) -> str:
    """One text answer, no images. Ledgered and allowlisted like everything else here; retries
    5xx and timeouts only, as `vision` does."""
    if model not in TEXT_MODELS:
        raise SystemExit(f"{model!r} is not an allowed text model; allowed: " + ", ".join(TEXT_MODELS))
    body: dict = {"prompt": prompt, "model": model, "temperature": temperature}
    if system_prompt:
        body["system_prompt"] = system_prompt
    record(TEXT_ENDPOINT + ":" + model, TEXT_MODELS[model]["price"], purpose)
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            out = _request(f"{SYNC}/{TEXT_ENDPOINT}", body, timeout=timeout)
            if out.get("error"):
                raise SystemExit(f"text model error: {out['error']}")
            return out["output"]
        except urllib.error.HTTPError as exc:
            if exc.code < 500:
                raise SystemExit(f"text call {exc.code}: {exc.read().decode()[:400]}")
            last = exc
        except (urllib.error.URLError, TimeoutError) as exc:
            last = exc
        if attempt + 1 < attempts:
            wait = 4 * (attempt + 1)
            print(f"  text call failed ({last}); retrying in {wait}s", file=sys.stderr)
            time.sleep(wait)
    raise SystemExit(f"the text endpoint failed {attempts} times: {last}")


if __name__ == "__main__":
    spent, calls = total()
    print(f"fal ledger: {calls} calls, ${spent:.2f} at list price  ({LEDGER})")
