# Feature landscape — what the consumer products actually ship

> **Scope note (2026-08-24):** this document predates
> [ADR-0004](decisions/0004-build-the-app.md). Its *research* stands — it is still the best
> record of what the closed products ship. Its *conclusion* does not: it argued for a household
> operations board, and the product was deliberately narrowed to four kid-facing jobs
> (routines, chores, money/stars, what's upcoming). Milestone references below (M3, M4) are
> pre-pivot. Meal planning, the photo screensaver and the assistant are now iceboxed.

Researched 2026-08-22. The point of this document is scope: the category is a **household
operations board**, not a calendar. Anything scoped as "calendar + tasks" is under-scoped.

## What the competitors offer

Legend: ✓ included · **$** paywalled · — absent

| Feature | Skylight | Hearth | Cozyla | Our answer | Effort |
|---|---|---|---|---|---|
| Multi-source calendar, per-person colour | ✓ | ✓ | ✓ | HA Google Calendar + Calendar Card Pro | Low |
| Lists — grocery, to-do, custom | ✓ | ✓ | ✓ | HA `todo` entities (Todoist / local / Bring!) | Low |
| Chores assigned per kid | ✓ | ✓ | ✓ | **ChoreOps** | Low |
| Chore rewards — stars, points, streaks | **$79/yr** | ✓ | ✓ | **ChoreOps** — XP, badges, streaks, multipliers, achievements, challenges, penalties, bonuses | Low |
| Parent approval of completed chores | lock only | ✓ | — | **ChoreOps** OpsCenter — approve claims *and* reward redemptions | Low |
| **Routines** — step-by-step, visual, for pre-readers | ✓ | **✓ flagship** | — | **GAP — nothing off-the-shelf** | **High** |
| Meal planning + recipes | **$79/yr** | ✓ | ✓ | **Mealie** — native HA integration, already on the home server's roadmap | Med (new stack) |
| Photo screensaver | **$79/yr** | — | ✓ | **WallPanel** — HA media source, Immich, or Unsplash | Low |
| Weather | ✓ | ✓ | ✓ | Native | Low |
| Sleep mode / screen schedule | ✓ | ✓ | ✓ | Roadmap M2 (`wlopm`, then mmWave) | Med |
| Parental lock — no edit/delete from the wall | ✓ | — | — | HA user roles + a separate read-mostly kiosk dashboard | Med |
| Mobile companion app | ✓ | ✓ | ✓ | **HA Companion** (iOS/Android, free) | Low |
| Split-screen / multiple dashboards | ✓ | — | ✓ | Native Lovelace views | Low |
| AI: photo or text → calendar events | **$79/yr** Magic Import | ✓ Hearth Helper | ✓ Cozy AI voice | **Conflicts with the no-cloud invariant** — see below | High |

## The three findings that matter

**1. ChoreOps covers Skylight's entire paid tier, for free and locally.**
[ChoreOps](https://github.com/ccpk1/choreops) (GPL-3.0, ~389★, HACS one-click, the official
successor to KidsChores) does chores per kid with individual / shared / first-complete /
rotation assignment models, full gamification, and a parent approval workflow — all inside
HA, no Docker, no external database, no cloud. Gamification is optional, so it degrades to
plain task management for a kid too young for points to mean anything.

This is the strongest post-hoc validation of ADR-0001. The chore subsystem is the thing
Skylight charges $79/yr for, and on the HA path it is an install.

*On dependency risk:* ChoreOps is younger than the bar Magic Frame failed in ADR-0001 — but
the risk is not comparable and the difference is principled. Magic Frame would have been the
**substrate**: if it breaks, there is no display. ChoreOps is a **feature module**: if it
breaks, chores stop and the calendar keeps working. It is also GPL-3.0 and stores its state
inside HA, so a fork or a manual export is always available. Module-level risk is acceptable
where substrate-level risk was not.

**2. Routines are the real gap, and they are the highest-value feature for young kids.**
Hearth's flagship is step-by-step visual routines — "get dressed → brush teeth → shoes → bag"
with pictures, usable by a child who cannot read yet. Nothing in the HA ecosystem does this
properly. ChoreOps can approximate it by modelling each step as a chore, but that is a
workaround, not the feature: routines are ordered, time-boxed, and reset daily, which chores
are not.

This is where custom work belongs — and it is precisely the work that justified rejecting the
closed products. It also argues for the ADR-0001 escape hatch sooner rather than later: a
routine runner is a custom view over HA state, not a Lovelace card.

**3. The AI photo→event feature cannot be built here without breaking the no-cloud rule.**
Skylight's Magic Import and Hearth Helper both work by photographing a school flyer and
extracting events. That needs a **vision** model. The home server's service catalog states plainly that
there is no local VLM — "RTX 2080 8GB is full with hermes3:8b" — and litellm's `vision` tier
routes to Nous-hosted Qwen3-VL. So this feature is currently: **cloud, or not at all.**

Three honest options, to be decided at M3, not now:

- **Drop it.** Typed or spoken event entry covers most of the value.
- **Carve a narrow exception.** A school flyer is not the household's schedule; a one-shot
  image OCR is a much smaller disclosure than routing every assistant turn to a cloud model.
  This would be an explicit, documented amendment to the invariant — not a quiet drift.
- **Run the VLM on the desktop.** Its RTX 4070 can host a vision model, and photo→event is
  asynchronous, so the desktop's ~2 min wake is tolerable here where it is not for interactive
  queries. This is the only option that keeps the invariant intact, and it is the one to
  price out first.

## Consequences for scope

Roughly one paid competitor tier is a HACS install; one flagship feature is a genuine build;
one feature is blocked on a hardware/policy call. That maps onto the roadmap as:

- **M1** gains ChoreOps and WallPanel (both low effort, high family-visible value).
- **M2** is unchanged.
- **M3** gains Mealie, the routine runner, and the photo→event decision.
