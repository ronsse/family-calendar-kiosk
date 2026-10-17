# Extension points

This file lists the ten places where the wall is meant to be extended. For each one it gives
the interface, the file, the test that pins it, and one worked example. A `file:line`
reference points at the declaration; if a reference here has drifted, the code is right and
this file is stale.

Some rules hold everywhere:

- **Guardrails are tests or refusals, never comments.** Each point below says which test fails
  or which refusal fires when an extension is half-done. When a point has no such test, the
  entry says so.
- **A run that refuses spends nothing.** The scene tools check everything they can before the
  first paid call. A refusal there exits 2, which means "configuration error", and costs
  nothing.
- **Use the public names in examples:** Child A/B/C (`child-a/b/c`), a dog called Biscuit, and
  coordinates 41.9, -87.6. The household's real data lives only in gitignored files under `db/`.

---

## 1. The household config schema: adding a key

**Interface.**

- **The type.** `HouseholdConfig` and `DEFAULT_HOUSEHOLD` (src/config/household.ts:87).
- **Parsing.** One `parse<Key>` function per top-level key, used by both `parseHousehold`
  (src/config/household.ts:290) and `readHousehold` (src/config/household.ts:375).
- **Storage.** The `ROWS` table maps each key to its `household_config` row.
- **The client's view.** `toView` (src/config/household.ts:419) builds it.

**Files.**

- `src/config/household.ts`
- `tools/household_config.py` (the Python twin)
- `db/household.example.json`
- `HouseholdView` in `src/types.ts`, if the client needs the key

**Tests.**

- test/unit-g.config.test.ts covers parsing, the error format, the round trip, the per-key
  fallback, and **(f) CONTRACT** (test/unit-g.config.test.ts:170). The contract test runs both
  loaders on the example file and requires the same result.
- `npm run verify:config`.

**Worked example.** Add `weekStartsOn: "sunday" | "monday"` (default `"sunday"`):

1. Add the field to `HouseholdConfig` and `DEFAULT_HOUSEHOLD`.
2. Write `parseWeekStartsOn` returning `Field<…>`, with errors as `weekStartsOn: <why>`.
3. Add it to the `pick(…)` list in `parseHousehold`, to the known-keys list, and to `ROWS`
   (`{ key: 'week_starts_on', json: false, parse: parseWeekStartsOn }`).
4. Add it to `toView`, and to `HouseholdView`, if the wall draws from it.
5. Mirror the default and the validator in `tools/household_config.py` (`DEFAULTS` and `parse`).
6. Add the key to `db/household.example.json`, so the contract test exercises it.
7. Add a row to the table in `docs/household-config.md`.

Forget step 5 and test (f) fails. Forget step 3's known-keys list and every file that uses the
key is refused as having an unknown key.

The default must reproduce today's behaviour, so that a database with no row stays unchanged.

---

## 2. Time

**Interface.** The household's zone is held in one place, `src/time.ts`:

- `configureTime({ timeZone })` (src/time.ts:50) sets it, and throws on an unknown zone
  without changing anything.
- `householdTimeZone()` (src/time.ts:59) reads it.
- Every local-date helper in that module (`localDate`, `addDays`, …) uses it.
- Locale and currency are held separately, in `src/config/presentation.ts` (`configureLocale`,
  `applyHouseholdView`).

The zone is configured in three places:

- the server at boot (stacks/wall/entry/main.ts:128)
- the sync worker at start (src/http/sync-worker.ts:50)
- the browser on each snapshot (`applyHouseholdView`, called from `web/src/data/useWallData.ts`)

**Tests.**

- test/unit-g.time.test.ts: the default zone, `configureTime` moving "today", and an unknown
  zone refused.
- test/unit-g.datezone.test.ts: UTC+13 and UTC+14 dates. It also checks that every day of 2026
  in the default zone renders exactly as it did before the zone became configurable.

**Worked example.** A household in Chicago sets `"timezone": "America/Chicago"`, applies
`--settings`, and **restarts the container**. The server and the worker read the zone only when
they start, so until the restart they keep the old zone while the browser already shows the new
one. The boot log line `household timezone America/Chicago` confirms the change.

Never compute a date with `toISOString().slice(0, 10)`. That gives the UTC date, and the module
header explains why it is banned.

---

## 3. Calendar source

**Interface.**

- **The contract.** `CalendarSource` (src/calendar/CalendarSource.ts:62): `kind`,
  `listSources()`, `fetchEvents(externalRef, window)` and `probe()`. `fetchEvents` **must
  throw on partial failure** rather than return a short list, or a truncated result is
  promoted over good data.
- **The table of built-in sources.** `CALENDAR_SOURCES` (src/calendar/registry.ts:25). Each
  entry has a module path, an export name, and the environment variable it needs.
- **The choice.** `chooseCalendarSource(env)` (src/calendar/registry.ts:58) reads
  `WALL_CALENDAR_SOURCE`, which defaults to `homeassistant` and throws on an unknown name.
  `WALL_CALENDAR_ADAPTER` and `WALL_CALENDAR_EXPORT` override the module and the export.
- **The import.** The sync worker imports the module by path (src/http/sync-worker.ts:57).
  Nothing outside `src/calendar/<impl>/` names an upstream.

**Built-in sources.**

- `homeassistant` (`src/calendar/homeassistant/`): needs `HA_BASE_URL`.
- `ics` (`src/calendar/ics/`): needs one `ICS_URL_<EXTERNAL_REF>` per calendar.

**Tests.**

- **No test imports `src/calendar/registry.ts` directly.** That is a known gap.
- The adapters are pinned by test/unit-b.adapter.test.ts (Home Assistant, from recorded
  fixtures) and test/unit-b.ics.test.ts.
- test/unit-f.scheduler.test.ts pins two behaviours:
  - with no adapter configured, the scheduler refuses to run and logs why;
  - a finished sweep sends an invalidation, never the events themselves.

**Worked example.** A CalDAV source:

1. Create `src/calendar/caldav/index.ts`, exporting `createCalDavCalendar(env = process.env)`,
   which returns a `CalendarSource` and throws at construction if `CALDAV_URL` is unset.
2. Add an entry to `CALENDAR_SOURCES`:
   `caldav: { module: './caldav/index.ts', export: 'createCalDavCalendar', configured: (env) => !!env['CALDAV_URL'], needs: 'CALDAV_URL is not set' }`.
3. Point the `calendar_source` rows' `external_ref` at the CalDAV collection ids.
4. Set `WALL_CALENDAR_SOURCE=caldav` and deploy.
5. Check the boot log. It must say `calendar sync scheduled (caldav)`, not `NOT running`.

An out-of-tree adapter needs no entry in the table: set `WALL_CALENDAR_ADAPTER` to its module
path instead. Credentials go in the env file, and thrown messages name the VARIABLE, never its
value.

---

## 4. Scenes and the static backdrop

**Interface.** `scenes.mode` in the household file is `off`, `static` or `generated`:

- **`off`.** `activeScene` (src/domain/scenes/library.ts:286) returns null, so there is no
  picture.
- **`static`.** The Sunday timer exits 0 with nothing to draw. The wall shows the most recently
  approved scene, which is usually a backdrop.
- **`generated`.** The weekly pipeline (`docs/scene-pipeline.md`).

How a still picture behaves:

- **The manifest.** A still picture is a scene whose manifest says `"static": true` with
  `"regions": []`.
- **How it reads.** `readSceneManifest` (src/domain/scenes/library.ts:230) reads that as "no
  tap targets", not as "unreadable".
- **The committed floor.** The committed backdrop is `assets/scenes/backdrop.json`. Static
  manifests rank oldest at registration (src/domain/scenes/library.ts:376), so it sits under
  the committed three-child picture and under anything a parent approves.
- **Boot registration.** `registerBaselineScenes` (src/domain/scenes/library.ts:359) runs at
  every boot. It always approves a static manifest. It approves a picture with regions only
  when its region count equals the number of children, and otherwise registers it as a
  candidate and logs why.

**Command.** `provision.ts --add-backdrop <file> [--id <slug>]` takes a JPEG or PNG of 4 MB or
less. It copies the file into the asset volume, writes a static manifest, and registers and
approves the scene.

**Tests.**

- test/unit-g.backdrop.test.ts:
  - a static manifest is `[]`;
  - a household with no children gets the backdrop, and the three-child picture waits;
  - `off` means no picture;
  - a new floor never displaces the scene a household already has up.
- test/unit-h.scene-library.test.ts.

**Worked example.** A household that wants its own porch photo:

```bash
docker cp porch.jpg family-calendar-wall:/tmp/porch.jpg
docker exec family-calendar-wall node --experimental-strip-types \
  stacks/wall/entry/provision.ts --db /data/wall.db --add-backdrop /tmp/porch.jpg --id porch
```

It prints `backdrop porch: … (approved)` and is the picture from the next snapshot. Set
`"scenes": { "mode": "static" }` so the Sunday timer stops buying candidates.

---

## 5. Pets

**Interface.**

- **The setting.** `pets` in the household file: a list that accepts one dog (`MAX_PETS`,
  `PET_KINDS` in src/config/household.ts).
- **The server.** `petEnabled(db)` (src/domain/dog/index.ts:25) gates two things:
  - `snapshot.dog`, which is `null` without a pet (src/http/snapshot.ts:206);
  - the deed route, which refuses with `not_claimable` without a pet.
- **The client.** `dogDoorOpen` and `petNameOf`, in the pet module under
  `web/src/views/logic/`. The pet's sheet renders nothing when `dog` is null.

**Tests.**

- test/unit-g.pets.test.ts:
  - no pets row means `dog: null`;
  - one pet keeps the week exactly as before;
  - a deed is refused with no pet;
  - a pet added at runtime reaches the route on the next request.
- Also: test/unit-f.dog.test.ts, and the pet sheet's client-logic test under `test/unit-h.*`.

**Worked example.** `"pets": [{ "id": "dog", "kind": "dog", "name": "Biscuit" }]` turns on the
dog door. The sheet's title and lines read from the name.

The pet's chores are ordinary chores with `category: "pet"` and `kind: "extra"`, in the
household's chore file. They are not in this setting.

**A cat is not a config change.** It needs a second kind in `PET_KINDS`, its own deed pool and
its own sheet. Until those exist, the validator refuses it, rather than accepting a pet nothing
would draw.

**Upgrades.** A wall upgraded from before this setting has no `pets` row. It must have its pet
applied in the same deploy, or the dog door vanishes (`docs/household-config.md`).

---

## 6. N-children cast

**Interface.**

- **The wall.** The wall itself takes any number of children from the roster
  (`db/household.sql`). Zero is valid.
- **The scene tools.** These read the cast file through `tools/scene_cast.py`:
  - `load_cast` and `cast_path` (tools/scene_cast.py:151). `SCENE_CAST` wins over
    `db/cast.json`, which wins over `db/cast.example.json`.
  - `MAX_CAST = 5` (tools/scene_cast.py:55).
- **Prompt text.** Every prompt fragment that mentions the children uses tokens filled by
  `fill_children` (tools/scene_cast.py:98): `{the_children}`, `{count}`, `{all_of_them}`,
  `{are}` and `{s}`. A composition or premise written for one headcount carries
  `"cast": [n]` and leaves the rotation for any other (`cast_fits`, tools/scene_cast.py:86).
- **The wall's slot join.** `slotForChild(sortOrder, childCount)`
  (web/src/views/logic/sceneFace.ts:111) is the only definition of the child-to-slot wrap.

**Tests.**

- test/unit-g.tools.test.ts:
  - (a) and (b) the three-child prompt is byte-identical to `test/fixtures/prompt-v2.example.txt`,
    and its draw digest is the recorded one;
  - (c) a cast of one draws one child and dry-runs a week;
  - (d) a cast of none is refused with exit 2.
- test/unit-h.features.test.ts: zero and one child do not throw in the slot wrap.
- `npm run verify:cast`.
- `check_tables` (tools/scene-week.py:184) refuses any table field that writes the child count
  as a word (`CHILD_THREE`, tools/scene-week.py:84).

**Worked example.** A one-child household:

1. Write a `db/cast.json` with one entry in `children` (slot 0, `avatar` pointing at a
   committed portrait) and no `dog` block.
2. Apply `db/household.solo.example.sql` as the roster.
3. Run `python3 tools/scene-week.py --dry-run` and read the prompt. It says "the child", not
   "the three children".

**Caveats.**

- **Five children do not fit everywhere.** A cast of five is accepted by `scene_cast`, but
  `check_tables` currently refuses it: at least one setting cannot fill five different kinds
  of activity in every season it is drawn in. A five-child household needs more activities
  first.
- **The three-child prompt is frozen.** Any byte change to it is a paid redraw for every
  existing three-child picture. Change the fixture and the digest only on purpose.

---

## 7. Secrets from the environment

**Interface.**

- **Where keys come from.** The scene tools read keys from the environment and nowhere else:
  - `FAL_KEY`, read by `fal_api.key()` (tools/fal_api.py:126);
  - `NOUS_API_KEY` and `NVIDIA_API_KEY`, read by gen-scene's provider branches.
  No tool names a vault, an item or a path.
- **How keys get there.** `tools/op.env` (gitignored, copied from `tools/op.env.example`)
  holds `op://` references only.
- **The wrapper.** `tools/scene-week-timer.sh` is what the systemd unit runs. It:
  - reads the service-account token from `OP_SERVICE_ACCOUNT_TOKEN_FILE`;
  - runs `op run --env-file` around `scene-week.py`;
  - passes scene-week's own exit code through;
  - turns any failure of `op` itself (a missing file, a missing token, an unresolvable
    reference) into exit 2, which the unit retries.

**Tests.** test/unit-g.tools.test.ts:

- the wrapper reports a missing env file as 2, never 1;
- no scene tool names a 1Password vault.

**Worked example.** A household not using 1Password writes a plain env file outside the repo
and runs the script under any loader that exports it:

```bash
env $(cat ~/.config/scene-keys.env) python3 tools/scene-week.py
```

**Do not commit a filled-in `tools/op.env`.** Even references disclose the vault layout.

---

## 8. Preferences and the weekly budget

**Interface.** These keys live in the `scenes` block of the household file, and
`tools/scene-week.py` reads them through `household_config.load_or_defaults()`:

- **Allowlists.** `scenes.styles`, `scenes.settings` and `scenes.premises` narrow the taste
  tables (`apply_preferences`, tools/scene-week.py:264). `null` means the whole table. An
  unknown id exits 2. An id forced by hand (`--style`, `--setting`, `--premise`) is never
  second-guessed.
- **Table checks run after the allowlists.** `check_tables` then runs against the narrowed
  tables, so an allowlist that leaves a season with nothing to draw is refused (exit 2) before
  any spend.
- **The budget.** `scenes.weeklyBudgetUsd` caps spend through `budget()`
  (tools/scene-week.py:298):
  - Spend is read from the fal ledger over the last seven days
    (`fal_api.spent_since`, tools/fal_api.py:169).
  - The projection is each candidate's model price twice plus two vision passes per candidate.
  - Spend plus projection over the cap exits **3**, which the timer does not retry.
  - A cap with a provider other than fal is refused, because only fal calls are ledgered.
  - The dry run prints a `budget  :` line.

**Tests.** test/unit-g.tools.test.ts:

- (e) `off` exits 0;
- allowlists are validated before spend;
- over budget is exit 3;
- an uncapped household says so on the dry run.

**Worked example.** `"scenes": { "styles": ["house", "soft-3d"], "weeklyBudgetUsd": 0.5 }`
draws only those two styles. It stops for the week once the ledger and the next run's
projection pass fifty cents. Use `python3 tools/fal_api.py` to print the ledger total.

---

## 9. Image provider (after the release)

**Interface today.**

- **The switch.** `tools/gen-scene.py --provider fal|nous|nvidia` dispatches to one branch
  per provider: `generate_fal` (tools/gen-scene.py:876) and `generate_nvidia`
  (tools/gen-scene.py:284). An unknown provider exits.
- **The fal door.** fal is the only provider that is metered and allowlisted:
  - `MODELS` (tools/fal_api.py:55) is the allowlist, with each model's price and the style
    families it may draw;
  - `DEFAULT_FOR_FAMILY` (tools/fal_api.py:99) picks the default model for a family;
  - `generate` (tools/fal_api.py:197) appends every paid call to `db/fal-ledger.jsonl`.
- **Every attachment.** Every attachment, on any provider, passes `enforce_references`
  (tools/prompt_guard.py:318). It refuses anything that is not committed house art under
  `assets/`. NVIDIA takes no attachments at all.

**Tests.**

- **No test calls a provider.** All of them would spend money.
- The guard is pinned by `npm run verify:prompts`.
- The draw digest in test/unit-g.tools.test.ts pins the provider and model as part of what a
  cached picture was drawn with.

**Worked example (the shape, not a commitment).** A new provider would:

1. Get a `generate_<name>` branch in `gen-scene.py`, reading its key from the environment.
2. Get a line in `tools/op.env.example`.
3. Get its own ledger, or it cannot be used with a budget (§8).
4. Get its value added to `SCENE_PROVIDERS` (src/config/household.ts) and to the Python twin.

Before any of that, it must pass the identity test in `docs/scene-imagery-plan.md`: hold the
cast's count, height order and hair across styles, using the attached avatars. A text-to-image
endpoint cannot take the avatars and is not a scene provider. Adding a model to fal's `MODELS`
is a change to that allowlist, and it needs the same evidence.

---

## 10. The band renderer registry and the taste tables

### Band renderers

**Interface.**

- **The bands.** `ReadingBand = 'picture' | 'emergent' | 'fluent'` (src/types.ts:110).
- **The contract.** `BandRenderers<C>` (src/types.ts:613) lists the presentational leaves:
  `Avatar`, `RoutineStep`, `ChoreCard`, `PointsBadge`, `EventCard`, `CountdownCard` and
  `StatusPill`.
- **The registry.** `BandRendererRegistry<C> = Record<ReadingBand, BandRenderers<C>>`
  (src/types.ts:623). The implementation is web/src/views/bands/registry.tsx:47, declared with
  `satisfies`, so a missing band or leaf is a compile error.
- **Where branching is allowed.** The registry is the **only** place a band may be branched on.

**Tests.** test/unit-h.sources.test.ts:

- "the registry maps every ReadingBand" (test/unit-h.sources.test.ts:194);
- the band-literal guard, which fails any `=== 'picture'` anywhere else in web sources.

**Worked example.** A new leaf, `MoneyJar`:

1. Add it to `BandRenderers`. `tsc` then fails until all three bands implement it.
2. Implement it under `web/src/views/bands/`.
3. Have the domain component call `useBandRenderer().MoneyJar`.

A fourth band is the same change to `ReadingBand`. It also needs to be added in two more
places: the `CHECK` on `child.reading_band` in `db/schema.sql` (which needs a migration), and
`BANDS` in `stacks/wall/entry/provision.ts`, the list `--band` accepts.

### Taste tables

**Interface.** Five JSON tables drive what a generated scene can be:

- `tools/scene-settings.json`: where
- `tools/scene-styles.json`: how it is drawn
- `tools/scene-compositions.json`: where the camera stands
- `tools/scene-activities.json`: what the children do
- `tools/scene-premises.json`: what kind of picture it is

`check_tables` (tools/scene-week.py:184) and `scene_activities.check` refuse, before any
spend, a table that:

- has a duplicate id or an empty clause;
- has an untagged setting or an unknown place tag;
- has a setting that cannot fill enough different kinds of activity in a season;
- writes the child count as a word;
- has a swimwear setting with a season;
- has no crowd-capable camera;
- brings back the photoreal family.

**Tests.**

- `npm run verify:activities`
- `npm run verify:styles`
- `npm run verify:spoilers`
- `npm run verify:context`
- the refusals above, run by every `scene-week.py --dry-run`

**Worked example.** A lake setting:

1. Add an entry to `scene-settings.json` with `"tags": ["lake"]`, the months in `season`, and
   prompt text that uses `{the_children}` rather than a number.
2. Run `python3 tools/scene-week.py --setting <id> --dry-run`. It costs nothing, and it either
   prints the prompt or names the rule the entry breaks.
3. If the setting is a new KIND of place, its activities come first: add them to
   `scene-activities.json` under that place. Until they exist, the refusal is the framework
   working, not a bug.
