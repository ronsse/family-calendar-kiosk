# ADR-0001 — Home Assistant as the integration layer, Lovelace as the first frontend

```yaml
status: superseded
date: 2026-08-22
superseded-by: ADR-0004 (2026-08-24)
deciders: the operator
```

> **Superseded by [ADR-0004](0004-build-the-app.md).** Home Assistant is no longer the
> integration layer and Lovelace is not the frontend; the product is a custom app and HA is a
> calendar source behind an adapter. Two things below still hold and are why this file stays:
> the **substrate-risk bar** (which disqualified Magic Frame at 371★, and a fortiori every
> purpose-built OSS family dashboard, all of which are smaller), and the observation that the
> frontend and the data layer are separable — the "escape hatch" this ADR documented is the
> door ADR-0004 walked through. Its Level 1 case has partly dissolved: the *first* argument,
> interactive Todoist, was dropped 2026-08-23.

## Context

The handoff brief framed the choice as "Home Assistant + Lovelace **or** a custom web app."
That is a false binary. Magic Frame, Lovelace, and a custom app are all *frontends over an
integration layer*. The decision is two levels, and they have very different weights.

## Level 1 — is Home Assistant the integration layer?

Effectively forced, by three requirements that were settled independently:

1. **Interactive Todoist.** Checking a task off from the wall is a write path. HA's native
   Todoist integration exposes projects as `todo` entities and the built-in to-do list card
   does add / edit / check-off / clear. Building this means OAuth, token storage, and sync
   reconciliation, for one widget.
2. **Guardrails for children and guests.** This is the strongest argument and it is a safety
   argument, not a convenience one. HA's LLM API can only act on entities explicitly exposed
   to Assist, and performs no administrative operations at all. That is an allowlist enforced
   below the model. A prompt-level guardrail on an 8B model is not a boundary — a curious
   child will talk past it in a few attempts.
3. **Phase 3 mmWave presence** is HA + ESPHome territory under any frontend.

A custom app would rebuild three integrations *and* invent its own permission model. Rejected.

## Level 2 — which frontend?

| Option | Pixel control | Writes | Risk | Verdict |
|---|---|---|---|---|
| Lovelace + Calendar Card Pro | Good with card-mod; walls exist | Native | Low — 1.2k★, 1297 commits, v4 | **Chosen** |
| Magic Frame | Drag-drop editor, live multi-screen sync | Todos/shopping | Medium — v1.1, 371★, one maintainer, Polyform Noncommercial (not OSI) | Rejected for now |
| Custom app over HA WebSocket | Total | Build it | Medium — you own it | Escape hatch, not the start |
| MagicMirror² | High | **Display-only by design** | — | Fails interactive Todoist |
| DAKboard | Low | Yes | — | Cloud + subscription; fails two invariants |

Lovelace is the durable base under a family-critical always-on display. Magic Frame is
genuinely purpose-built for this exact use case and is the fastest path to something that
looks good — but v1.1, a single maintainer, and a non-OSI licence are not what belongs under
the thing that has to be correct at 6:00 AM on a school day. Revisit past v1.x (roadmap
icebox).

## Decision

- **Home Assistant** is the integration and state layer.
- **Lovelace** is the frontend, starting from Calendar Card Pro for the calendar surface.
- The **escape hatch is documented and cheap**: a custom frontend reads the same HA data over
  its REST + WebSocket API. Switching frontends does not touch the data layer. If Lovelace
  styling hits a wall on the dim anti-glare panel — hairline strokes, sub-14px type, touch
  targets too small for small hands — that is the trigger to take it, not a reason to have
  started there.

## Consequences

- HA becomes a stack this household depends on. It did not exist before on the home server;
  it now needs backups, updates, and an owner.
- HA is LAN + tailnet only. It has mandatory auth of its own, unlike Trellis. The kiosk
  authenticates once and keeps the session; `trusted_networks` auto-login is the fallback and
  requires a stable Pi address.
- Assistant model choice is capped at 7–8B by the always-on RTX 2080. The desktop's 14B is not
  reachable in interactive time (powered off, ~2 min wake).
- **Inference must pin a local model by name.** LiteLLM's `aux` tier falls back to `bulk`,
  which hits NVIDIA first — pointing HA at it would ship family calendar contents to a hosted
  provider. Point HA straight at Ollama; `local-8b` has no fallback anyway, so LiteLLM buys
  only logging while adding a cloud-capable router to the path. The same trap is already
  documented for another stack in the home server's service catalog.
