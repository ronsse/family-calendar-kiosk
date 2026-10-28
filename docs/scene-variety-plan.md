# Scene variety plan (2026-10-28)

The household's report: two pictures a run, and they are the same picture twice; run after run
the wall gets a library or a costume fair again, never a new idea. This is why, and what to do.

## Why it repeats

| Cause | Where | Status |
|---|---|---|
| `season: []` meant both "occasion, the director may pick it" and "this year's costumes, `--setting` only". The director labelled all five "for an occasion", so anything festive on the calendar drew a hand-authored Halloween picture again. W44's frozen decision chose `halloween-book-fair` while it sat on its own do-not-repeat list. | `scene_director.py` pool and `build_request` | **Fixed (A)** |
| Recent settings were prose in the prompt ("do not repeat these"); only a recent STYLE was refused in code. | `scene_director.problems()` | **Fixed (B)** |
| The pair shares setting, style, camera, premise, seed, activities, dog — only the model differs. It was built as a model comparison, settled on 2026-09-12. | `scene-week.py` candidates loop | **Fixed (C)** |
| The director is told "Prefer a listed setting" and "premise `plain` unless another clearly fits", so it reaches for the nearest catalog row and almost never a premise. | `build_request` HOW TO CHOOSE | **Fixed (D)** |
| The rotation fallback (director refused twice, or unreachable) is week arithmetic, blind to the wall: the W44b dry run's fallback is `book-fair`. | `scene-week.py` rotation | **Fixed (C)** |
| Activities are written per setting and only word-for-word repeats are refused; the same place gets the same kind of lines. | `scene_activity_writer.py` | **Fixed (E)** |
| The dog hides three times as often as any mood. | `scene-dog.json` weights | **Fixed (F)** |

## Plan

**A. `manual` settings leave the director's list — done 2026-10-28.** `"manual": true` on
`halloween-book-fair`, `halloween-party`, `swim-pool`; `decide()` filters it like swimwear;
`check_tables` refuses a manual setting with a season. Selftest: "a manual setting is never
offered".

**B. A recent setting is refused in code — done 2026-10-28.** `problems()` refuses a listed or
invented setting among the wall's last six unless every setting is recent. Three selftest
cases.

**C. Two different pictures per run — done 2026-10-28.** The director returns two decisions that must
differ in setting (and ideally premise or style); each is validated by `problems()` plus a
pairwise check, and both freeze in `db/scene-director/<run>.json`. `scene-week` plans each
decision on its own (id, style settle, seed, dog, moment, written activities) and gives each
ONE model: `{run}-{settingA}-gpt`, `{run}-{settingB}-nb2`, alternating which model gets the
first brief by run parity. Same image spend; one more writer call (~$0.002). The rotation
fallback skips the wall's recent settings and gives the second brief the next in-season
setting, so a failed director still yields two different pictures. Ids keep their shape, so
the Pictures screen, `recent_settings` and `scene_memory` need no change. Rewrite the "a pair
is a comparison" comment: the household chose variety over comparison.

**D. Let the director invent — done 2026-10-28.** Replace "Prefer a listed setting" with "choose a NEW place at
least every other run; use the catalog when a row already fits this week's event", and
"premise `plain` unless…" with "`plain` no more than two runs running" (`cutaway`, `giants`,
`tiny` are built). Around a holiday, `scene_context` says "invent a place for it" rather than
only a prop line, and its table grows to cover the holiday WEEK (Halloween, Thanksgiving,
first snow). Every guardrail stays in `problems()`. Eyeball with `--dry-run --ask-director`.

**E. Activity variety — done 2026-10-28.** `RECENT` 3 → 6; refuse a set whose kinds all appeared in the last set
for the same setting; pass premise and camera to the writer.

**F. Small — done 2026-10-28.** Lower the dog's `hiding` weight to 1 now that the director chooses moods; add
setting recency to `scene_memory` so the rotation sees the wall too.

## What shipped for C–F, where it differs from the plan

- **C.** `scene_director.decide(pictures=2)` freezes `{"decisions": [one, two]}`; an old
  single-format file still means one brief, two models. `pair_problems()` refuses the same
  place, the same style (while two non-recent styles exist) and a pair with no invented place.
  Model per brief: each style's family default, and on a tie the brief at index
  `run parity` (0 for Sunday, 1 for Wednesday) keeps it and the other takes its next allowed
  model. A retry ignores this run's own rows when reading recency, so it is the same pair.
  `scene_memory.settle(extra_avoid=)` keeps the second picture off the first's style.
- **D.** "At least one of the two pictures is a new place" is both asked and checked in code.
  The `plain`-limit sentence is sent only when `scenes.premises` offers more than `plain`; the
  household's list is `['plain']`, so adding `cutaway`, `giants` or `tiny` there is the opt-in.
  Holiday spans: Halloween Oct 24–31, Thanksgiving−6..Thanksgiving, Christmas Dec 18–25, New
  Year Dec 31–Jan 1; an autumn snow forecast is the "first snow" line. Single quotes are now
  refused in the director's words (a live answer quoted `'ring-the-pumpkin'`).
- **E.** Writer `PROMPT_VERSION` 2; frozen activity files carry `setting`; a digest mismatch
  on a frozen file warns rather than refuses.
- **F.** As planned; `recent_settings` moved from the director into `scene_memory`.

None of A–F changes the assembled image prompt for an existing scene, so the prompt-v2 fixture
and cached draw digests are untouched.
