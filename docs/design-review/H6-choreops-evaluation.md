# H6 — ChoreOps, evaluated against what we built

**2026-08-26.** ChoreOps is installed and loading in the Home Assistant on the home server. This
document is the side-by-side the operator asked for, and a costed read of the one option that is
neither "keep ours" nor "switch".

Everything below is measured from the installed source at `v1.5.1`, not from the README.

---

## 0. What was actually done

- Cloned `ccpk1/choreops` (GPL-3.0) to scratch, **not** into this repo.
- **Added `stacks/homeassistant/config/custom_components/` to `.gitignore` first.** That tree
  lives inside this repo and was not ignored, so a manual install would have put GPL-3.0
  sources in `git status` and one `git add -A` would have committed them — the exact thing
  CLAUDE.md's licence rule forbids. This was the most important five minutes of the exercise.
- Copied the component into HA's config and restarted. HA loads it
  (`We found a custom integration choreops`), all **6 calendars still resolve**, and the wall
  was unaffected throughout.
- Drove the config flow to the point of adding household members over the REST API, where the
  session's own tooling declined the call. **ChoreOps therefore has no config entry yet**, so
  nothing below rests on live entity output — it rests on the source, which for an adapter
  estimate is the same evidence and rather more reliable.

---

## 1. The domain model, side by side

| | This app | ChoreOps 1.5.1 |
|---|---|---|
| **Chore states** | **4** — `pending / claimed / approved / superseded` | **17** — adds `overdue`, `missed`, `due`, `waiting`, `not_my_turn`, `standby`, `paused`, `independent`, and partial variants of claimed / approved / completed |
| **Assignment models** | 4 — individual, shared, first-complete, rotation | the same 4, plus explicit rotation control (`set_rotation_turn`, `reset_rotation`, `open_rotation_cycle`) |
| **Points** | integer ledger, append-only, `cents_per_point` | configurable currency and icon, XP, multipliers |
| **Progression** | **none** | badges (cumulative rank + periodic quest), streaks, multipliers, achievements, challenges, milestones |
| **Bonuses / penalties** | **none** | manual and automated, both |
| **Approval** | parent PIN, per request, never a session | HA user roles, actionable mobile notifications with approve/deny buttons |
| **Rewards** | one redemption request per child, approve or reject | full CRUD on rewards, plus redeem / approve / disapprove |
| **Storage** | SQLite, STRICT tables, foreign keys, triggers | HA Store (JSON on disk), projected into sensors |
| **Reading bands** | **3** — picture / emergent / fluent, one state three renderings | **none.** One rendering |
| **Rendering** | our React bundle, same origin | Lovelace — `manifest.json` declares `"dependencies": ["lovelace"]` |
| **Size** | 2,245 lines of chore + ledger domain (13,517 whole app) | **86,699 lines** of Python |

**On features it is not close, and it never was.** [feature-landscape.md](../feature-landscape.md)
found the same thing in August: ChoreOps covers Skylight's entire $79/yr paid tier, for free,
locally. Nothing here contradicts that.

**Two rows decide it anyway.** Reading bands, and Lovelace.

---

## 2. The thing ChoreOps cannot do

The youngest is three. His chores must render as pictures with no words anywhere, while the eldest's
render as sentences with money — **from the same state, at the same moment, on the same
screen**. That is the whole reason ADR-0004 rejected Lovelace, and it is not a styling
problem: it is one state with three renderings selected by a keyed registry, which is the
central design of Unit H.

ChoreOps has one rendering. It ships dashboards, translations and per-user dashboard shards —
`AssigneeDashboardChoreShardSensor`, `SystemDashboardTranslationSensor` — which is real work
toward per-person views, but they are per-*person*, not per-*literacy*. There is no seam where
"draw this for someone who cannot read" goes.

So "switch to ChoreOps" means giving up the four jobs' central constraint to gain gamification.
That is not a trade this wall can make.

---

## 3. The interesting option: ChoreOps behind a `ChoreSource` adapter

Neither "keep ours" nor "switch". ChoreOps owns the chore domain and its gamification; the wall
keeps owning the rendering. Structurally identical to what `CalendarSource` already does for
Home Assistant, and it would keep ADR-0004 intact — nothing outside the adapter would know HA
exists.

**It is genuinely feasible.** The surface is there:

- **Read**: 16 sensor classes. `AssigneeChoresSensor` and `AssigneeChoreStatusSensor` carry
  per-child chore lists and state as entity attributes; `AssigneePointsSensor` carries the
  balance.
- **Write**: 29 services, all callable over the REST API we already authenticate against —
  `claim_chore`, `approve_chore`, `redeem_reward`, `approve_reward`, `apply_bonus`,
  `apply_penalty`, `manual_adjust_points`.
- Quality scale is `platinum` and the integration has a config flow, diagnostics and
  migrations. This is not a hobby component.

### What it would cost

**1. A lossy state projection, and the loss is the expensive part.**
17 states into 4. `overdue`, `missed`, `not_my_turn` and `paused` have nowhere to go —
`ChoreState` is frozen in `src/types.ts`, so widening it is a stop-the-world contract change
that touches all three bands, the state-treatment table, the contrast rules and every renderer.
Collapsing them instead means the wall silently cannot show a child that a chore is overdue,
which is information ChoreOps went to trouble to produce.

**2. The prime invariant takes a real hit.**
Today a claim is a local SQLite write behind a tap gate: it commits, the optimistic value
resolves, and nothing on the network is involved. Through an adapter, every claim and every
approval becomes a live HTTP call to Home Assistant. The calendar's dependency on HA is a
*nightly sweep into local state* — the wall renders from SQLite and never blocks on HA. Chores
would be different in kind: **HA would have to be up at 6:00 AM for a child to tick a chore.**

That is the finding. It is not fatal — a write-behind queue with local optimistic state would
preserve most of it — but a queue that must reconcile against a 17-state machine it does not
own is a different and much larger piece of work than the calendar adapter was.

**3. Two sources of truth for money.**
The ledger is append-only, has a `UNIQUE(child_id, ref_type, ref_id, reason)` idempotency
guard, and refuses zero-value entries. ChoreOps has its own points store with multipliers and
bonuses. Either ours becomes a mirror — and then the redemption guards are enforced against a
number we do not own — or theirs is display-only, in which case the gamification we came for
never reaches the balance.

### Rough size

The calendar adapter is ~600 lines for a read-only, once-a-night, single-shape source. A chore
adapter is bidirectional, per-tap, and spans a 17-state machine plus a points system. **A
realistic estimate is 1,500–2,500 lines plus a contract amendment**, against 2,245 lines of
chore and ledger domain that already exists, is tested, and has no network on its write path.

---

## 4. Recommendation

**Keep ours. Harvest the model, not the code.**

The adapter is the interesting option and it does not pay. It costs more code than the domain
it replaces, moves a 6:00 AM dependency onto a service the wall was deliberately decoupled
from, and splits the money in two — to buy features we can add incrementally to something we
already own.

What ChoreOps is genuinely worth, and what this evaluation should be used for:

- **Its state machine is a checklist.** `overdue` and `missed` are states we will want, and it
  is better to widen `ChoreState` deliberately once than to discover them one at a time.
- **`apply_bonus` / `apply_penalty` / `manual_adjust_points`** name the adult affordances our
  admin surface is missing.
- **Streaks and multipliers** are the highest-value gamification and are already on our list as
  a contract change. ChoreOps confirms the shape.
- **Partial claim and approve** (`claimed_in_part`) is a real case for shared chores that our
  four states cannot express.

Reading it for those is exactly what CLAUDE.md permits, and exactly what its licence forbids
going further than.

## 5. Cleaning up

ChoreOps is installed and idle — loaded by HA with no config entry, so it creates no entities
and touches nothing. Leave it if you want to click through the setup wizard and see it run;
otherwise:

```bash
rm -rf ~/projects/family-calendar/stacks/homeassistant/config/custom_components/choreops
cd ~/projects/family-calendar/stacks/homeassistant && docker compose restart
```

The `.gitignore` line stays either way.
