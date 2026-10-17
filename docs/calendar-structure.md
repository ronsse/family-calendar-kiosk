# Calendar structure

## The pattern (unanimous across every product surveyed)

**One Google calendar per person, each with its own colour, plus one shared `Family`
calendar for whole-household events.**

Skylight calls the per-person layer a "Profile" and merges each external calendar into it.
Home Assistant does the same thing with one `calendar.*` entity per person and a colour per
entity in the card config. Same shape, different vocabulary — so adopting the convention
costs nothing and matches what anyone in the house has already seen elsewhere.

Children too young for Google accounts do **not** need one. The parent creates the child's
calendar inside their own account and owns it. It is just a calendar with a colour.

## Current state (verified 2026-08-22, `list_calendars`)

| Calendar | Role | Note |
|---|---|---|
| `Family` | Shared household events | **Timezone is UTC — should be `America/Denver`.** All-day events will straddle midnight until fixed |
| `Parent A` | Per-person (adult 1) | Already correct |
| *(a hobby calendar)* | Topic calendar | Keep; not a person |
| `Holidays in United States` | Read-only feed | Keep; low visual weight on the wall |
| `Todoist` | Todoist→GCal sync | **Do not render alongside the HA `todo` entity** — tasks would appear twice |

## The roster

Three children, spanning the entire literacy range (ages as of 2026-08-24):

| Person | Age | Reads? | Consequence for the UI |
|---|---|---|---|
| The eldest | 7 | Yes | Text chores, points, streaks all work |
| The middle child | 5 | Emergent | Icons **plus** short words |
| The youngest | 3 | No | Pictures only; points mean nothing at 3 — the completion animation *is* the reward |
| Parent A | adult | — | Calendar exists |
| *(adult 2)* | adult | — | **Name needed** — calendar not yet created or shared |

Full DOBs are deliberately **not** in this repo — first names and ages are what the build
needs, and they live in gitignored household files, not here. Birthdays live on the `Family`
calendar.

## To create

Per-person calendars for the four household members who do not have one. Decided 2026-08-22:
start with `Family`, fill in the kids' as they are created.

**On colour, with six calendars in play:** five people plus `Family` is at the practical limit
for a 225-nit anti-glare panel. Give the five *people* the saturated, well-separated hues and
make `Family` neutral (grey/slate) — it is a category, not a person, and spending a scarce
hue on it costs you a child. Keep the routine-icon palette clear of all of them
([ADR-0002](decisions/0002-image-generation.md)).

For each new one:

1. Google Calendar → **Create new calendar**, name it for the person, set timezone
   `America/Denver`.
2. Assign a distinct colour. Keep colours far apart in hue *and* luminance — the panel is
   225 nits behind anti-glare etched glass, so two mid-tone colours that separate cleanly on
   a laptop can read as the same colour on the wall. Test on the panel, not the laptop.
3. Share to any other adult with **"Make changes to events"**.
4. Add to HA; it appears as a `calendar.<name>` entity.
5. Add the entity to the dashboard card with its colour.

## Sharing model

- Adults: "Make changes to events" on every family-member calendar.
- Children's calendars: owned by an adult account, no child account involved.
- The wall display reads through HA's single Google integration — it does not need per-person
  credentials, and no child's calendar is ever exposed outside the household account.
