# H7 — the design problem is a missing destination, not a muddled one

**2026-08-26.** The household said: *"the dashboard design and the GUI… it's all mixed up. It doesn't really
make sense… functionally, we have lots of nice components, but the design piece is really the
challenge."*

That reading is right, and this document argues the cause is narrower and more fixable than it
feels. We have been tuning a layout that is missing a room.

---

## 1. The finding

**Eight admin routes exist, are implemented and tested, and NOT ONE of them is reachable from
the wall.**

```
/api/admin/v1/chores/:assignmentId/approve
/api/admin/v1/chores/:assignmentId/reject
/api/admin/v1/redemptions/:id/approve
/api/admin/v1/redemptions/:id/reject
/api/admin/v1/ledger/adjust
/api/admin/v1/children/:id/ledger
/api/admin/v1/devices
/api/admin/v1/devices/:id
```

`grep -rn "api/admin" web/src/` returns nothing. The frontend wires six actions — claim a
chore, complete a step, revoke a step, request a redemption, cancel one — and every one of
them belongs to a child.

So on the wall as it stands, a chore goes `pending → claimed → ` and stops. The eldest can claim
"Make your bed" and nothing in the building can approve it except `curl`. The points ledger,
the redemption flow, the PIN, the whole economy the four jobs are built on — all of it is
real, tested, and unreachable by the people who own it.

**That is why the layout feels mixed up.** A child's screen is carrying the entire product,
because there is nowhere else for anything to go. Every fix we have made this week — the
switcher, the single column, the points row, the agenda — has been redistributing one screen's
worth of space among four jobs and two audiences. The pixels were never the problem.

---

## 2. What established products actually do

Read from ChoreOps 1.5.1's own `dashboard_registry.json`, and from the Skylight and Hearth
screens in [H5 §2](H5-layout-proposal.md).

**Every one of them splits by AUDIENCE before anything else.** ChoreOps ships nine dashboard
templates and the registry's first field for each is `audience`:

| audience | templates |
|---|---|
| `user` | `chores-lite`, `chores-essential`, `chores-standard`, `gamification-premier`, `kidschores-classic` |
| `approver` | `shared`, `per-user`, and classic variants of both |

Five child dashboards and four adult ones — for a product whose whole subject is chores. The
adult surface is not a settings page tucked behind a gear; it is **half the design**, and it
has its own information architecture (`shared approval hub` versus `per-user approval
workspace` — two different theories of how a parent triages).

Three more patterns repeat across all three products:

- **One destination per person**, reached from persistent navigation. ChoreOps generates one
  Lovelace view per user (`title: << user.name >>`, `path: << user.slug >>`); Skylight gives
  each child a column; Hearth a row of avatars.
- **A complexity ladder for the child view.** ChoreOps' `lite → essential → standard →
  premier` is the same problem our reading bands solve, answered a different way: they scale
  *feature density* per child where we scale *literacy*. Worth knowing that a mature product
  in this exact category independently concluded one child view is not enough.
- **Sections in a fixed order** within a person's view, never a mode switch between them.

---

## 3. Why we cannot borrow one wholesale

Two reasons, and they are worth stating plainly because "just copy Skylight" has been the
implicit plan for a week and it keeps not working.

**Orientation.** Skylight Calendar Max and Hearth are 27" **portrait**, roughly 1080x1920.
This wall is 21.5" **landscape**, 960x540 logical. They have three and a half times our
vertical room and spend all of it. Their per-child column, their bottom nav bar, their stacked
sections — every one of those is a vertical-axis decision. Ported to a short wide screen they
do not compress, they break; that is precisely what the last week of overflow measurements has
been.

**The bands.** ChoreOps' nine templates all assume a reader. Its dashboards are Lovelace YAML
built on four HACS frontend dependencies (auto-entities, button-card, mushroom, mini-graph) and
run to 17,877 lines. None of that can render a chore as a picture with no words for a
three-year-old while rendering it as a sentence with money for a seven-year-old, from the same
state, at the same moment.

**What we CAN borrow is the shape, and the shape is the part we are missing.** Audience split
first, one destination per person, sections in a fixed order, a dedicated approval surface.
None of that is pixels. All of it is free.

---

## 4. The proposal: four destinations, one rail

### 4.1 The screen inventory

| # | Destination | Audience | What it is for |
|---|---|---|---|
| 1 | **Household** | the room | The day. Four-day agenda, countdowns, everyone's progress. What the wall shows when nobody has touched it — and therefore the screen the prime invariant is really about. |
| 2 | **A child** | that child | Their routines, their chores, their points. One per child. |
| 3 | **Grown-ups** | an adult, standing at the wall | **The missing room.** What is waiting to be approved, and nothing else. |
| 4 | *(off-wall)* | an adult, at a terminal | Devices, PIN, household definition. `provision.ts` owns this and should keep owning it — it is not a wall job. |

Three destinations on the wall. That is the whole product.

### 4.2 The navigation model

**The rail already is it.** It is permanent, it is in the same place on every screen, and it
holds one tile per child. Add **one more tile at the bottom: the grown-up entrance.**

- Visually a **non-face** — the children are faces, the adult door is not. That is the same
  redundant-channel logic the accents use, and it is what stops a three-year-old wandering in
  by pattern-matching.
- It carries a **count badge**: how many chores and redemptions are waiting. That is the single
  most useful fact an adult wants from across the room, it makes the destination
  self-explaining, and it is zero when there is nothing to do — so the wall stops nagging.
- Tapping it opens the approval queue. **The PIN gates the ACTION, not the door**, which is
  already the rule (`requireParentPin` is per request, never a session). A child can open it
  and look; they cannot approve anything, and there is nothing there to break.

That is the entire navigation model: one rail, four tiles, always the same place. No drawer,
no tab bar competing with the rail, no mode a child can get lost in.

### 4.3 The approval queue, borrowed from ChoreOps' better idea

ChoreOps ships two adult theories and the `shared approval hub` is the right one for a wall:
**one list of everything waiting, across all children**, rather than a per-child workspace you
have to page through. An adult at the wall for ninety seconds after dinner wants one list.

Each row: the child's face, what they did, what it pays, approve and reject. The rows are the
same 88px list card the idle wall already uses, on the same 16px rhythm — this destination
introduces no new geometry, which is the point of having a grid at all.

### 4.4 One grid, so we stop tuning per screen

Every measurement this week landed on the same numbers. Write them down and stop rediscovering
them:

```
wall            960 x 540 logical
header           56          (--wall-header-h)
gutter           16          (--wall-gutter)
pad              24          (--wall-pad)
content pane    912 x 420    (what is left, on every screen)
rail             96 collapsed / 160 open   (--wall-rail-w)
list card        88          (--wall-list-card-h)
agenda row       36          (--wall-agenda-row-h)
vertical rhythm  16          everywhere
```

**The rule: a new screen composes those, or it changes the token for everyone.** No screen gets
its own spacing. That is the discipline that turns "lots of nice components" into a design, and
it costs nothing but saying no.

---

## 5. What to stop doing

- **Stop tuning individual panels.** Six of the last ten changes were overflow fixes on one
  pane. They were all correct and none of them addressed why one pane was carrying two
  audiences.
- **Stop treating the adult as a settings page.** Every mature product in this category treats
  the approver as a first-class audience with its own screens. We have eight routes and no
  door.
- **Stop porting portrait layouts.** They are not compressible. Borrow the shape — audience
  split, one destination per person, fixed section order — and lay it out for a short wide
  screen ourselves.

## 6. What this changes about the child view

Very little, and that is the good news. Once approvals have their own room, a child's screen is
only ever four things — her routines, her chores, her points, and the switcher between them —
which is what it already is. The switcher stops being a compromise and becomes the correct
control, because there genuinely are only two halves of her day.

The work is: **build destination 3**, add the fourth rail tile, and hold the grid.
