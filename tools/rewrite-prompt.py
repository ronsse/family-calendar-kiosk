#!/usr/bin/env python3
"""Rewrite a structured scene brief into the idiom a given image model actually follows.

    OP_SERVICE_ACCOUNT_TOKEN="$(cat ~/.config/op-service-token)" \
    op run --env-file=tools/op.env -- \
    python3 tools/rewrite-prompt.py --for flux < brief.txt > prompt.txt

MOONSHOT_API_KEY comes from the ENVIRONMENT, injected by `op run` from the gitignored
tools/op.env (add a MOONSHOT_API_KEY line in the form tools/op.env.example shows).

WHY. `gen-scene.py` assembles ~3,600 characters of structured English — three named children
with fixed hair, eye and clothing colours, an activity each, placement rules, a facing rule, a
clothing rule, a hidden dog, a crowd, a palette and a style. `google/gemini-3-pro-image` is an
instruction-following multimodal model and honours nearly all of it. FLUX.1-dev is not: given
the same brief it returned a pretty picture that dropped the dog, the fox, the crowd, one
child's entire accent colour and the painterly style (measured 2026-09-05).

The fix is not a shorter brief — every clause in it was added because something went wrong
without it. The fix is a TRANSLATION step: a cheap text model turns the brief into the dense,
front-loaded, comma-separated form diffusion models weight properly, while being told which
facts are load-bearing and must survive verbatim.

That also puts the expensive model where the money is. Text is cents; images are not.

DISCLOSURE. The brief is the same text `prompt_guard.enforce` has already cleared, and the
rewrite is checked again on the way out — a translator is a place where wording changes, and
a guard that only ran upstream would be guarding the wrong string.
"""
import json
import os
import sys
import urllib.request

from prompt_guard import enforce
from scene_cast import fill_children, load_cast

ENDPOINTS = {
    "moonshot": ("https://api.moonshot.ai/v1/chat/completions", "kimi-k2.6", "MOONSHOT_API_KEY"),
    "local": ("http://localhost:11434/v1/chat/completions", "hermes3:8b", None),
}

# What the translator may NOT paraphrase away. Everything here is a rule that exists because a
# generated image broke without it, so "it said roughly that" is not good enough.
LOAD_BEARING = """
These facts are LOAD-BEARING and must survive into your output, exactly, even if it makes the
prompt longer:
  - all {count} children, each with their own hair colour, hairstyle, eye colour and clothing
    colour exactly as given
  - what each child is doing
  - every child fully clothed, in a top and bottoms
  - every child's face visible, head and body facing the same way, nobody drawn from behind
  - the small hidden dog, if the brief has one, with his breed, coat and colours exactly as
    the brief describes them
  - the art style and the palette
  - no text, letters or numbers anywhere in the image
"""

INSTRUCTION = """You rewrite illustration briefs into prompts for the FLUX.1 diffusion model.

FLUX follows dense, front-loaded description and ignores long multi-paragraph instructions. It
weights the START of a prompt most heavily. Rewrite the brief below as ONE flowing paragraph of
concrete visual description: subject and style first, then {the_children} with their exact
appearance and actions, then the setting and everything else in it.

Use commas, not bullet points, headings or numbered lists. Describe what IS in the picture, never
what is absent — "everyone in long sleeves and trousers" rather than "nobody is bare-chested".
Do not add anything the brief does not contain. Do not explain yourself.
"""


def rewrite(brief: str, provider: str, timeout: int = 120) -> str:
    url, model, key_env = ENDPOINTS[provider]
    # NO `temperature`. Kimi is a reasoning model and rejects it with a bare HTTP 400 that says
    # nothing about which field is at fault — the same request minus this key succeeds. Left as
    # a comment rather than a conditional because the next provider added here will hit it too.
    body = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": fill_children(INSTRUCTION + LOAD_BEARING,
                                                        len(load_cast()["children"]))},
            {"role": "user", "content": brief},
        ],
    }).encode()
    headers = {"Content-Type": "application/json", "User-Agent": "family-calendar/1.0"}
    if key_env:
        headers["Authorization"] = f"Bearer {os.environ[key_env]}"
    req = urllib.request.Request(url, data=body, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = json.load(resp)
    usage = payload.get("usage") or {}
    if usage:
        print("rewrite usage: " + ", ".join(f"{k}={v}" for k, v in sorted(usage.items())
                                            if isinstance(v, (int, float))), file=sys.stderr)
    out = payload["choices"][0]["message"]["content"].strip()
    # Re-checked on the way OUT. A translator is exactly where wording changes.
    enforce(out)
    return out


if __name__ == "__main__":
    argv = sys.argv[1:]
    provider = "moonshot"
    while argv and argv[0].startswith("--"):
        flag = argv.pop(0)
        if flag == "--provider":
            provider = argv.pop(0)
        else:
            raise SystemExit(f"unknown flag {flag}\n{__doc__}")
    if provider not in ENDPOINTS:
        raise SystemExit(f"unknown provider {provider}; known: {', '.join(ENDPOINTS)}")
    print(rewrite(sys.stdin.read(), provider))
