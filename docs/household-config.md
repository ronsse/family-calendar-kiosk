# Household configuration

A household's settings live in one JSON file, `db/household.json`. That file is gitignored. The
committed example is `db/household.example.json`. Those settings are the zone, the locale, the
switched-off surfaces, the board windows, the pet and the scene preferences.

The file is **input, not state**. The running wall never reads it. It reads rows in the
`household_config` table. Only `provision.ts --settings` turns the file into those rows. So
editing the file changes nothing until the file is applied.

The roster is a different file with a confusingly similar name: `db/household.sql` (children,
routines, chores), applied with `--household`. The two cannot be applied in one run (see below).

The loader is `src/config/household.ts`. Its Python twin is `tools/household_config.py`.

## The schema (version 1)

Every key except `version` is optional. A missing key, or a missing sub-key inside `features`
or `scenes`, takes its default. An unknown key is refused. A key starting with `_` is a comment
and is ignored. Every error is reported as `<path>: <why>`. All errors are collected before
anything is written.

The defaults are the wall exactly as it ran before the file existed (`DEFAULT_HOUSEHOLD`,
src/config/household.ts:87), with one deliberate exception: `pets` defaults to `[]`, not to a
dog.

| Key | Default | Validated as | What it gates | Row written |
|---|---|---|---|---|
| `version` | required, `1` | exactly 1 | refuses a file from a future schema | none |
| `timezone` | `America/Denver` | an IANA zone `Intl.DateTimeFormat` accepts | every local date and time: the day boundary, board windows, chore days, the calendar sync window | `timezone` (text) |
| `locale` | `en-US` | a locale `Intl` supports | clock and date wording on the wall | `locale` (text) |
| `currency` | `USD` | an ISO code `Intl.NumberFormat` accepts | how balances are written | `currency` (text) |
| `features.chores` | `true` | boolean | the snapshot's `chores` and `streaks` lists | `features` (JSON) |
| `features.money` | `true` | boolean | the snapshot's `balances` and `redemptions` lists | `features` |
| `features.routines` | `true` | boolean | the snapshot's `routines` list | `features` |
| `features.countdowns` | `true` | boolean | the snapshot's `countdowns` list | `features` |
| `boardWindows` | `05:45–08:30`, `18:45–20:45` | a list of `{opensAtLocal, closesAtLocal}`, `HH:MM`, opens before closes | when the board replaces the picture; `[]` means never | `board_windows` (JSON) |
| `pets` | `[]` | at most one entry `{id, kind: "dog", name}`; `id` matches `^[a-z][a-z0-9-]{0,23}$`, `name` is 1–24 characters | the dog door: `snapshot.dog`, the pet sheet, the deed route | `pets` (JSON) |
| `scenes.mode` | `generated` | `off`, `static` or `generated` | `off` means no picture at all; `static` and `off` make the Sunday timer a no-op | `scenes` (JSON) |
| `scenes.provider` | `fal` | `fal`, `nvidia` or `nous` | which image service the scene tools call | `scenes` |
| `scenes.styles` | `null` | `null` or a list of ids | an allowlist over `tools/scene-styles.json`; `null` means every style | `scenes` |
| `scenes.settings` | `null` | `null` or a list of ids | an allowlist over `tools/scene-settings.json`; `null` means every setting | `scenes` |
| `scenes.premises` | `["plain"]` | a list of ids | what the timer may draw unattended | `scenes` |
| `scenes.weeklyBudgetUsd` | `null` | `null` or a finite number ≥ 0 | a cap on fal spend over the last seven days (the ledger is summed on a rolling window); `null` means uncapped | `scenes` |
| `scenes.activities` | `written` | `written` or `table` | what the children are doing in a scene: `written` asks a text model for a fresh, guardrailed set per scene (frozen in `db/scene-activities/`, table as fallback); `table` picks from `tools/scene-activities.json` only | `scenes` |
| `scenes.director` | `ai` | `ai` or `rotation` | who picks each run's setting, style, camera and premise: `ai` asks a text model that reads the coming window's brief (weather, calendar, visitors) and freezes its choice in `db/scene-director/`, falling back to the rotation when it refuses twice or cannot be reached; `rotation` is the old week-number arithmetic | `scenes` |
| `scenes.shareTitles` | `false` | boolean | what the director is told about the calendar: `false` sends only category counts and "N grown-ups and M children visiting"; `true` also sends one-off event titles and visitors' descriptions (never names in the image prompt). Opt-in because titles are household data leaving the house | `scenes` |

Notes on the table:

- Each feature flag empties its list in the snapshot (src/http/snapshot.ts:155 to
  src/http/snapshot.ts:197). The client also checks the flag through `featureOn`, which reads a
  missing or non-boolean flag as ON (web/src/views/logic/features.ts:20). An older client that
  does not know the flag therefore sees empty lists, which it already renders.
- The grown-up nav and Home tiles hide an off feature's screens
  (`grownupSectionsFor` and `homeTilesFor` in web/src/views/logic/grownup.ts).
- The TypeScript loader does not check `scenes.styles`, `scenes.settings` or `scenes.premises`
  against the taste tables. `tools/scene-week.py` checks them, before any spend, and exits 2
  on an unknown id or on an allowlist that leaves a season with nothing to draw.

### What the wall sees

The snapshot carries `household`, built by `toView` (src/config/household.ts:419). It holds
`timezone`, `locale`, `currency`, `features`, `boardWindows`, and `pets` as `{id, name}` only.
It **does not carry `scenes`**: scene preferences are read by the host-side tools only.

### Four other `household_config` rows this file does not own

Four more rows share the `household_config` table, each owned by its own module, and
`--settings` never touches them:

- `cents_per_point` (`src/domain/settings`)
- `departures` (`src/domain/departures`)
- `wall_theme` (`src/domain/theme`)
- `parent_pin_scrypt` (`src/http/auth`)

These rows are changed behind the PIN or by their own provision flags.

### Reading rows never fails

`readHousehold` (src/config/household.ts:375) runs on every snapshot and never throws. A row
that fails validation logs a warning once and reads as that key's default. The other keys are
unaffected. A household with no rows at all reads as `DEFAULT_HOUSEHOLD`. That is how a
database that predates this file keeps behaving exactly as it did.

## Applying it

The command runs **inside the container**. The database is in the container's `/data` volume,
and the host has no path to it.

There are two forms. The file form needs the file inside the container. The repo is not
mounted, so in practice this means a file you copied in:

```bash
docker cp db/household.json family-calendar-wall:/tmp/household.json
docker exec family-calendar-wall node --experimental-strip-types \
  stacks/wall/entry/provision.ts --db /data/wall.db --settings /tmp/household.json
```

The stdin form needs no copy, so it is the one to use:

```bash
docker exec -i family-calendar-wall node --experimental-strip-types \
  stacks/wall/entry/provision.ts --db /data/wall.db --settings - < db/household.json
```

`--settings` is all-or-nothing:

- **Success.** It prints `settings applied: timezone, locale, currency, features,
  board_windows, pets, scenes` and exits 0. Every one of the seven rows is written in one
  transaction (`writeHousehold`, src/config/household.ts:404). A key missing from the file is
  written as its default, so it does not keep a previous value.
- **Bad file.** If the JSON is unreadable, or anything fails validation, it prints every error
  and then `settings NOT applied: N error(s). Nothing was written.`, and exits 1.
- **Bad invocation.** `--settings` with no path exits 2. So does `--settings` combined with
  `--household`. The two are different files with nearly the same name, and applying them one
  at a time keeps a mistake to one file.

During development there is also `npm run provision -- --settings db/household.json`. That
command writes to `dev.db`, not to the wall.

### When the wall sees the change

- **Zone, locale, currency, features, board windows and pets** reach the panel on its next
  snapshot fetch. `provision.ts` writes the database directly and **deliberately sends no
  invalidation**: it is a separate process with no handle on the server's event stream.
  The panel refetches on its 15-minute poll (`POLL_HEALTHY_MS`, web/src/data/backoff.ts:44),
  after each calendar sync (also every 15 minutes), at the date boundary, and whenever it
  reconnects. So a change can take **up to about 15 minutes** to appear. To make it
  immediate, restart the kiosk (`systemctl --user restart kiosk.service` on the Pi).
- **The server's own zone** is set once at boot (stacks/wall/entry/main.ts:128) and once when
  the sync worker starts (src/http/sync-worker.ts:50). A `timezone` change therefore also
  needs a **container restart** before chores materialize and the calendar window computes
  in the new zone. The boot log confirms it: `household timezone <zone>`.
- **Scene preferences** take effect the next time `tools/scene-week.py` runs. That script
  reads the FILE (`db/household.json`, or the path in `HOUSEHOLD_CONFIG`), not the rows,
  because it runs on the host. So for the scene tools alone, editing the file is enough.

### The gap between a deploy and `--settings`

Applying `--settings` must be part of the deploy, not a step for later. The rule that matters
most is the pet:

- A new image reads `pets` from the rows.
- A wall upgraded from before this file has no `pets` row.
- So from the moment the new container boots until `--settings` is applied, the snapshot says
  `dog: null`, and the dog door is gone.

After the apply, the panel picks the row up on its next snapshot fetch, as above. Nothing
pushes it, by design. Restart the kiosk if the gap matters. The order on an upgrade is:

1. Deploy the image.
2. Apply `--settings`.
3. Restart the kiosk.

## Two loaders, one schema

The scene tools are Python, run on the host, and read the file. The app is TypeScript, runs in
the container, and reads the rows. Both must parse the same file the same way, so there are two
loaders:

- `src/config/household.ts`: `parseHousehold` (src/config/household.ts:290) for the file, and
  `readHousehold` for the rows.
- `tools/household_config.py`: `parse` (tools/household_config.py:201), `load`, and
  `load_or_defaults` (tools/household_config.py:247). `config_path` takes an explicit path,
  then `HOUSEHOLD_CONFIG`, then `db/household.json`. A missing file reads as the defaults.

They are pinned together by test **(f) CONTRACT** (test/unit-g.config.test.ts:170). That test
runs the Python twin's `--dump` on `db/household.example.json` and requires the same result as
`parseHousehold`. `npm run verify:config` runs the Python half alone.

One asymmetry is deliberate: Python checks `locale` and `currency` only as non-empty strings,
because it has no `Intl`. The rows can only be written through the TypeScript check, so a bad
locale cannot reach the wall either way.

**Changing the schema means changing both loaders and `db/household.example.json` in the same
commit.** The contract test fails if you do not. See `docs/extension-points.md` §1.

## Why the schema is shaped like this

### Reading bands are not ages

A child's screen is drawn in one of three bands: `picture`, `emergent` or `fluent`. A band says
how a child reads. It does not say how old the child is. A six-year-old who reads well and a
nine-year-old who does not are both real, and both need the screen that matches what they can
do. So the band is set per child by an adult and never inferred:

- **Where it is set.** It is a column on the child row in the roster (`db/household.sql`), or
  set in place with `provision.ts --band child-a=fluent`. It is not a key in this file.
- **Ages have one other use.** The children's ages appear only in the scene cast
  (`db/cast.json`), where they describe how a child looks in a picture.
- **The band changes rendering only.** It changes the drawing and never the data model
  (src/types.ts:110).

### `pets` is a list that accepts one

The format is a list because the next household will have two cats. The validator accepts at
most one entry, of kind `dog`, and says so: `v0.1 supports at most one pet, of kind dog`. Only
the dog has a door built (the pet sheet, the deeds pool, the pet extras), and a second pet
would be a key the wall accepts and silently ignores. When a second kind is built, the limit is
lifted, and every file already written keeps parsing, because the shape never changes.

### `scenes` is tools-only

Scene preferences decide what the host-side tools pay for. The panel does not need them, so
`toView` drops them and they are never on the snapshot. One field is the exception:
`scenes.mode = off`. The server reads that one, in `activeScene`
(src/domain/scenes/library.ts:286), so that `off` means no picture even when approved scenes
exist.

The children in a generated scene are not in this file at all. They come from the cast file
(`db/cast.json`, see `docs/extension-points.md` §6), which also carries the scene's dog. The
scene's dog is separate from `pets`. A household can have a dog on the wall and none in the
pictures, or the other way round.

## Worked example

Here is a one-child household with no money, an evening-only board, a dog called Biscuit, and
a still picture instead of generated ones:

```json
{
  "version": 1,
  "timezone": "America/Chicago",
  "features": { "money": false },
  "boardWindows": [{ "opensAtLocal": "18:30", "closesAtLocal": "20:00" }],
  "pets": [{ "id": "dog", "kind": "dog", "name": "Biscuit" }],
  "scenes": { "mode": "static" }
}
```

Apply it in this order:

1. Apply the settings with `--settings -` as above.
2. Add the picture: `provision.ts --add-backdrop /tmp/porch.jpg --id porch`. The file must be a
   JPEG or PNG, and 4 MB or smaller.
3. Restart the container, because the zone changed.
4. Restart the kiosk.

The roster for one child is `db/household.solo.example.sql`.
