# H10 panel — What governs which scene is on the wall

**Run 2026-08-27.** Status: **SPLIT** — no decision; escalated.  Cost $0.0245.

Two independent reviewers from different labs, neither Anthropic — an Anthropic panelist
correlates with the agent that wrote the brief and buys agreement rather than evidence.
Reproduce with `python3 ~/.claude/skills/decision-panel/panel.py --brief <brief> --reversible`.

> **Tooling note.** The first run of the night reported a SPLIT on a brief where both
> panelists had chosen the same option, because agreement was decided by exact string
> equality on a free-text field and one model answered `"B"` while the other answered
> `"B. <full option title>"`. Fixed in `my-claude-skills@856d290` before any of these ran.
> Any panel record dated before 2026-08-27 may carry that artifact.

---

## The brief, as sent

```markdown
## Context

The idle screen of a wall-mounted family calendar is a full-bleed search-and-find
illustration — a busy colouring-book scene in which each of three children (**A, 7;
B, 5; C, 3**) can find themselves and tap themselves to open their own day.

Two facts about how it is built:

- The scene is a **raster image**, generated once at build time and committed. The wall
  reads it off local disk and never calls an image API, which is what satisfies a hard
  no-cloud-at-runtime rule.
- **Where each child stands in the picture is authored, not detected.** A JSON manifest
  beside the image lists fractional rectangles keyed by slot. A missing or malformed
  manifest degrades cleanly: the picture is still a picture, the tap regions are simply
  absent, and a permanent navigation rail is still the way to a child's day.

There is currently **one** scene. The stated reason to have more is that a new picture
is what gives a child a reason to walk over to the wall in the first place. Scenes are
fetched by id rather than bundled, so adding one is a file drop into an assets volume
rather than a deploy.

Authoring cost per scene, measured: the image itself is one generation call (cents), but
the tap regions must be located by a human or by a vision pass and written into the
manifest, and getting a child recognisably "findable" in a busy scene took several
iterations of prompt work.

## The decision

What should govern which scene is on the wall, given that every scene needs
hand-authored tap regions before it is usable?

## Options

**A. One scene per local date, from a fixed rotation.** `scenes[dayOfYear % count]`.
Deterministic, no state, changes at local midnight — which is also when the wall already
refetches. A child learns "there is a new picture today".

**B. Rotate only when a new scene is added.** The newest scene is the scene. Changing
the wall is an explicit act by a parent dropping a file, not a schedule. Zero surprise,
and no scene appears before its regions have been authored.

**C. Random per idle-entry, from the pool.** A new picture every time the wall decays
back to idle. Maximum novelty; the child cannot predict what she will find, and the
"where am I in this one" game restarts constantly.

**D. Seasonal/contextual selection.** Pick by month or by what is on the calendar — a
snow scene in winter, a beach scene when a holiday is on the calendar. Highest
delight ceiling, needs a mapping and a fallback for every uncovered case.

## Constraints that should drive the choice

1. **A scene without authored regions is a dead end.** If a scene is on the wall and its
   manifest is missing, the "find yourself and tap yourself" interaction silently does
   nothing. The navigation rail is hidden on this screen precisely because the picture IS
   the navigation.
2. **The wall runs unattended for months.** Whatever selects a scene must be correct with
   no operator present and must not depend on anything that can drift.
3. **The pre-reader navigates by "always the same place".** That is a stated property of
   this design. A picture that changes is in tension with it, and the tension is the
   point of the feature — but it bounds how fast changing is safe.
4. **Nothing may be fetched at runtime.** Scenes are local files. No image API on the
   render path, ever.
5. **The 6:00 AM invariant is unaffected** — the gate already shows the information board
   during the morning routine window, so no scene is on the wall then.
6. **A file drop is the intended authoring path** and should stay the intended authoring
   path; a scheme that requires editing code or a database to add a picture has failed.
```

---

## Verdicts, verbatim

### openai/gpt-5.5 → **B**  (confidence 0.78)

**Reason.** The authored manifest is the gating dependency; explicit parent-driven rotation minimizes unattended failure and avoids rapid changes that undermine pre-reader spatial learning.

**Top risk.** Assumes the file-drop process only promotes scenes with valid manifests; otherwise newest-scene selection could expose an incomplete dead-end scene.

**What would change my mind.** A loader test proving daily rotation only includes manifest-validated scenes and children tolerate daily scene changes.

### moonshotai/kimi-k3 → **A**  (confidence 0.62)

**Reason.** A stateless daily rotation delivers the stated 'new picture' pull with zero operator involvement, changes exactly at the existing midnight refetch, and gives the pre-reader a full day per picture; filtering the pool to manifest-valid scenes satisfies constraint 1.

**Top risk.** The formula is fixed but the eligible pool is not: if `count` includes scenes whose manifests are missing or malformed, the dead-end interaction lands on the wall; correctness hinges on filtering by manifest validity.

**What would change my mind.** Observing the 3-year-old fail to relocate herself after an overnight change (daily too fast, favors B), or learning the selector cannot enumerate manifest-valid scenes.

---

## What was done with it

*(filled in as the work lands)*

