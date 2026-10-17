# The chore plan

**Written 2026-08-31**, from the household's spoken list. This file is the reasoning and the
queue; the real list with real ids is `db/chores.json`, which is gitignored because it is
household data, not because a plan may not name anybody.

Children appear here as **A** (fluent), **B** (emergent), **C** (pre-reader) in `sort_order`,
matching `db/chores.example.json`. That is so the packages in §5 can be handed to a sub-agent
verbatim — build-plan §3.1 forbids names in a **prompt to a third-party model**, not in the
repo, and PRD §3 names all three deliberately. A brief cut from this file is already safe.

---

## 1. The question that was asked: is the back end good enough?

**Yes, and nothing here needs a schema change.** The schema is frozen (`db/schema.sql`,
H1-reviewed) and it already carries every distinction the household described. Concretely:

| What was asked for | What already models it |
|---|---|
| Required chores vs. money-earning ones | `chore.kind` — `duty` \| `extra`. It picks the destination; `base_points` picks the pay. |
| "Alternate days" for the dinner jobs | `assignment_model = 'rotation'` + `chore_rotation_member`, resolved by a pure function of (chore, date) and **frozen** at materialization so nobody re-rolls it by refreshing |
| "Either kid can do it, split them up" | `first_complete` — everyone listed gets a tile, the first claim wins, the others go `superseded`, which is a terminal non-paying state and **not a miss** (it never breaks a streak, ADR-0005) |
| Weekly / fortnightly | `chore.rrule`, expanded only in local-date space |
| Add, remove, reassign without fear | `provision --chores <file>`. Additive, never deletes, retire is `active = 0`, `restore` undoes it. Re-running is safe, and a truncated file cannot empty the board or orphan a ledger row. |
| A window, and lateness | `due_by_local` stored; `overdue` **derived** in the view layer, never persisted — so it is right at every instant with no cron, and a failed 5:55 AM job cannot blank the wall |

The one thing the model does *not* have is a way to express "this chore pays, that one
doesn't" as a **rule** rather than as a field on each row. That is deliberate — the
`kind`/`base_points` split is documented in `db/chores.example.json` as the one rule the code
does not enforce — and it is fine, but it means the house rule lives in the data and a
typo makes a duty pay. Worth a lint later; not a blocker.

## 2. Half the list is not chores — it is the morning routine, and it mostly exists

"We get dressed, we put socks and shoes on, we get our backpacks ready" is a **routine**, not
a chore board: it is time-boxed, ordered, unpaid, and its whole purpose is sequence. The
distinction is load-bearing here, because routines already have the exact feature the
per-child half needs — `routine_step_assignment` gives *one* routine *different step sets per
child*, which is precisely "A gets snacks, B gets lunch, C gets a blanket".

`rt-morning` (06:00–08:00, MO–FR) already has **Dressed, Shoes, Bag, Teeth**. Three steps are
missing, one per child, and they are assignments rather than new routines.

**So: the morning list is a three-row addition to a table built for it.** Do not put it on
the chore board — a chore board that also carries getting dressed stops being the place where
work is tracked.

## 3. Three defects found while checking this, one of them serious

### 3.1 The dinner rotation lands two jobs on one child, every day, forever — FIXED IN DATA

`rotationAssignee` folds `fnv1a(choreId) % memberCount` into the day index so two rotations
sharing a roster do not track each other. With three jobs over three children that works only
if the three hashes are **distinct mod 3**. For the natural ids they are not:

```
ch-set-table    fnv1a % 3 = 1
ch-clear-table  fnv1a % 3 = 2
ch-dishwasher   fnv1a % 3 = 1     <-- collides with set-table
```

Unrotated, this is what every night looks like:

```
2026-09-01  set=B  clear=C  dish=B      <- B does two, A does none
2026-09-02  set=C  clear=A  dish=C
2026-09-03  set=A  clear=B  dish=A
```

One child does two dinner jobs every single night and a third is never assigned either. It
would surface on day one, it would read as the wall playing favourites, and nothing in the
code is wrong — it is a property of three strings nobody had looked at.

**The fix is one line of data and no code:** rotating a roster by *k* is exactly "add *k* to
the index", so `ch-dishwasher`'s member list is written rotated by two. Every night now has
three different children and each child cycles all three roles over three days, verified for
400 days. Pinned by `test/unit-c.dinner-rotation.test.ts`, which also asserts that the naive
version *does* collide — so the reasoning cannot be tidied away by someone making the three
rosters match.

### 3.2 Fortnightly recycling works, but by luck, and the luck is now pinned

`FREQ=WEEKLY;BYDAY=TU;INTERVAL=2` gives the household exactly what it asked for — **no
recycling 2026-09-01, recycling 2026-09-08**. But `recurrence.ts` anchors week parity to the
**epoch Monday**, and uses `DTSTART` only as a lower bound, never as a phase anchor. Which
fortnight is "on" was not chosen; it was handed to us and it happened to be right.

The consequence to know about: **there is currently no way to shift a fortnightly chore by
one week.** If bin night ever needs to move, that is a change to `recurrence.ts` (teach
`DTSTART` to anchor the phase), not to the chore file. Until then the parity is pinned by
test, so a well-meaning change to the week arithmetic fails loudly instead of silently moving
bin night.

### 3.3 The picture stopped coming back, and it was the approval queue — FIXED

Reported as "hitting home doesn't return to the image". It was not the home button.

`WallApp` passed the **approval-queue length** to the idle gate's `anythingOverdue`
parameter. On the live wall that is currently **seven claims** nobody has approved, so the
gate had been answering "something is overdue" continuously, and the board was pinned up —
through the home button, through the 90-second decay, through everything. The picture had
been unreachable for days.

The two facts point in opposite directions. `isOverdue` already says in its own body that *"a
claim awaiting a grown-up is the child's part already done"* — so a growing queue is evidence
that **work got finished**, and it was suppressing the reward for finishing it. Approvals
already have a door and a badge; they do not get a third channel.

Fixed: a real `anythingOverdue(chores, now)` built from the same `isOverdue`, so the board
that appears and the card that says "still time" can never disagree. Four regression tests.
**This does not touch the 6:00 AM invariant** — that is held by the board *windows*
(05:45–08:30, 18:45–20:45) and the clock-trust gate, both unchanged; this flag only ever
added the board *outside* those hours.

### 3.4 …and then it was the real overdue, so the reason is gone altogether — FIXED (2026-09-13)

Reported as *"stuck on the two calendar days screen … how do I get to the image display?"* The
gate was answering `overdue` honestly this time: duties due 17:00, untouched at 18:11. With
duties due at 17:00 every day that meant the picture was gone from five o'clock until the
evening window closed at 20:45 — every evening the family is actually in the room. §3.3 fixed
the input; this fixes the rule. `idleMode` now takes the clock verdict and the hour and
nothing else. A late chore is on the board inside its hours and on the child's own screen
always; it does not also take the picture down.

Two more things were wrong in the same report. The calendar opened from the idle wall with
nobody selected **never closed**: `destination` was a `useState` beside the shell reducer,
closed off the back of its decay, and the reducer only ran its clock while a child was selected.
It is shell memory now, with the same 90 s. And there was **no way to ask for the picture**: the
rail's house was inert on the board. It is live whenever a picture exists, goes to the picture
from any screen, and decays back to whatever the gate says.

## 4. The icons — DONE 2026-08-31, and the free tier lost the bake-off

`provision --chores` refuses the whole file if any `iconAssetId` is missing, so this was the
only thing standing between the plan and a live board. Nine icons now exist and are registered.

**The household asked whether the free NVIDIA tokens could do it.** They can generate; they
cannot hold the set. `tools/gen-icon.py` grew a `--provider nvidia` backend (FLUX.1-dev on
`ai.api.nvidia.com`, free, verified working) and three subjects were generated both ways. FLUX
came back with **soft gradients, elliptical drop shadows, a recycling glyph stamped on the bin,
thinner non-uniform outlines, and off-palette colour** — a tan trash can when black was asked
for. The existing set is flat, unshaded, shadowless and heavily outlined, and ADR-0002's
requirement is that *the set matches*, not that any one image is good.

This is not a surprise and it is the same failure the repo already recorded: `backgrounds.md`
lever 4 says reference-image conditioning is what made the eleven-icon set come back coherent
first time **after wording alone had failed three times**. The NVIDIA image endpoint takes a
bare `prompt` string — there is nowhere to attach a reference — so lever 4 is unavailable and
wording is carrying the set on its own. That is exactly the configuration that already failed.

The drop shadow is the one worth naming, because it survives `cut()`: the flood fill only
removes the near-white ground, so a grey ellipse stays baked into the transparent PNG and would
show as a smudge under every icon on the tinted chore rows.

**The backend was kept rather than deleted**, with the finding written into its docstring. It is
free and it is fine for a subject with an unambiguous silhouette where the set is not at stake.
It is not the default and should not become one.

| id | Subject | Note |
|---|---|---|
| `ico-settable` | a table laid with two plates | Deliberately paired with the next one — same table, plates or none. That parallel is what makes the two readable side by side to a pre-reader; the older `ico-table` place setting stays untouched as the `kitchen` fallback |
| `ico-cleartable` | the same table, bare | |
| `ico-dishwasher` | open dishwasher, rack out, **a large arrow pointing down into it** | The household's own solve: a child putting dishes in and a child taking them out are the same picture, so direction is carried by the arrow rather than the pose |
| `ico-trash` | curbside wheeled bin, black lid, brown body, side on | |
| `ico-recycling` | curbside wheeled bin, red, face on | |
| `ico-fish` | goldfish in a bowl | |
| `ico-lunchbox` | open lunch box, sandwich and juice inside | First attempt came back as a magenta briefcase. Regenerated open-with-contents, which is unmistakable |
| `ico-snack` | an apple and a bag of crackers | |
| `ico-blanket` | folded blankets, stacked | |

**One thing to check on the panel.** Trash and recycling separate strongly by hue — CIE76 ΔE
51.8, twice the ~25 that reads as "clearly different colours" — but their **luminance ratio is
1.17**, i.e. they are almost exactly as light as each other. On a 225-nit panel behind
anti-glare etched glass, hue is the first thing to go. The backstop is that the silhouettes
differ too (side-on with a raised handle and one wheel, versus face-on with two), and shape
does more work than colour for the pre-reader. Worth one look on the wall before trusting it.

## 5. The queue, cut for sub-agents

Disjoint file ownership, in dependency order. Packages 1 and 2 are independent of each other.

| # | Package | Owns | Done means |
|---|---|---|---|
| 1 | ~~**The eight icons**~~ | — | **DONE** — see §4. Nine icons, `unit-i.assets` green |
| 2 | **The three morning steps** | `db/household.sql` (routine + assignment rows only) | Each child's morning shows her own fourth step; `unit-e.steps` green |
| 3 | **Apply the chore list** | nothing — it is a provision run | `provision --chores db/chores.json` clean, dev-seed chores retired, board shows the real seven |
| 4 | **Panel-audit the new board** | `tools/panel-audit.mjs` runs only | Zero findings across all stops; seven duties do not push the pre-reader's tiles below the fold |

Package 1 is done. Package 4 depends on 3. **A sub-agent may not decide** which chores
pay, what a point is worth, or whether a chore is a duty — those are §6.

## 6. Two things that are the household's, not mine

**6.1 Which of these pay.** The spoken list opened with *"extra chores that make money"* and
closed with *"those are gonna be household required chores… things they can make money from,
we need to work on that list separately."* The second reading is the one I built: **all seven
are duties at zero points**, and the money list is a separate exercise. Trash and recycling
are the ones most likely to have been meant as paid. Flipping any chore is two fields —
`kind` and `basePoints` — and re-running provision.

**6.2 Bed-making.** The dev seed's `ch-bed` is retired by this file because it was not in the
spoken list. `restore` brings it back.

## 7. The imagery question this ran into (backlog, private notes)

The report that *"the picture on the board shows B as a brunette at a table, not a blonde"* is
correct and is two separate defects, neither of which is about hair:

1. **B's figure was never drawn as a foreground child.** The scaffold asks for three children
   "two or three times the size of everyone else". In `trailer-camp.jpg` two of them are;
   B's is not — she is a background-sized figure kneeling at the campfire, giving the
   smallest tap region in the set (106×108 against 154×243 and 139×216) and the hardest
   figure to find, for the child in the middle reading band.
2. **Garment colour is not bound to anything.** Every child already has an accent
   (`--c-id-1/2/3`) that the rail, her cards and her avatar ring all use — it is how the
   pre-reader navigates. The scene prompt asks only for "a distinguishing garment colour" and
   the model picks. In the current scene one of three matches by luck and slot 1 is wearing
   slot 2's colour.

**The fix that gets what was asked for without breaking the disclosure rule** is to bind each
foreground child's garment to that child's accent, and hold activity and position fixed per
slot across every scene. That makes the figures stable and recognisable — *"I'm the one in
yellow"* — in the wall's own existing identity language, with no name, no hair colour and no
likeness leaving the house.

Pinning hair colour would be different. `tools/backgrounds.md` names **"no hair colour"**
explicitly as part of the disclosure test, alongside no names and no likeness — a real
child's appearance bound to a real child is household data whatever the intent. That is an
invariant the household can overrule, as it did with ages on 2026-08-29, but it should be
overruled on purpose and written down, not drifted past.

**And it collides with an open backlog question (private notes).** It asks whether this project
should generate depictions of children *at all*. Making the depictions more consistent and
more identifiable is movement in the opposite direction. Both are reasonable; they are not
both doable. **Regenerating scenes is not queued above, on purpose** — it would be spending
the effort on assets §5.0 might retire. That decision comes first.
