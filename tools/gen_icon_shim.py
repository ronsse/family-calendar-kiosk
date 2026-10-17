"""Shared endpoint constants and the data-URI helper.

A shim rather than `from gen_icon import ...` because gen-icon.py has a hyphen in its name and
is therefore not importable as a module. Keeping ONE definition of the endpoint matters more
than the awkwardness: two copies drift, and the copy that drifts is the one nobody tested.
"""
import base64

ENDPOINT = "https://inference-api.nousresearch.com/v1/chat/completions"
MODEL = "google/gemini-3-pro-image"


def data_uri(path: str) -> str:
    with open(path, "rb") as fh:
        return "data:image/png;base64," + base64.b64encode(fh.read()).decode()
