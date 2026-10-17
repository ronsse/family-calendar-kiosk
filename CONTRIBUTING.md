# Contributing

Thanks for looking. This is a wall calendar for one household's children, published so other
households can run their own. Two rules matter more than any code style.

## Where things are

[`docs/README.md`](docs/README.md) indexes every document. It lists the guides for using the wall
(setup, configuration, pictures, repairs, the API) apart from the design history (the PRD,
roadmap, decisions and reviews), which is kept as it was written.

## 1. No real household data in the tree, ever

Everything that describes a real family lives in gitignored files and in the running
container's volume, never in git:

- `db/household.json`, `db/household.sql`, `db/calendars.sql`, `db/chores.json`,
  `db/cast.json`, `db/scene-place.json`, `db/fal-ledger.jsonl`, `db/scene-context/`,
  `db/scene-activities/`
- `stacks/wall/op.env`, `tools/op.env` (secret references), `CLAUDE.local.md`
- `local/` and `docs/local/` (private notes and release-prep inputs)

Each has a committed, synthetic twin (`*.example.*`) that tests and docs use. When you add a
fixture, an example or a doc, use the example household (`child-a`/`child-b`/`child-c`,
"Child A", the dog "Biscuit") and placeholder hosts (`homeserver`, `wall-pi`,
`example.ts.net`). Never commit a real name, address, calendar address, photo of a person,
API key or token. Committed images must be synthetic, and each one's sha256 is listed in
`tools/release/public-assets.sha256`; an image that is not listed fails the release gate.

The same rule applies to anything sent to a third-party model: prompts carry the example
cast's words or the household's gitignored files at run time, never text committed for that
purpose.

## 2. Run the gate before you publish

```bash
npx tsc --noEmit                      # npm test does NOT typecheck
npm test
npm run build
npm run verify:release                # committed checks, the same ones CI runs
tools/release/verify-clean.sh --full  # local: also greps for your household's own words
```

`--full` needs a private term list at `local/sensitive-terms.txt` (gitignored): one literal
string per line, at least 45 lines — your children's and adults' names, pet names, hostnames,
tailnet name and addresses, street, city, school and venue words, data paths, and anything else
that identifies your household. It matches whole words, case-insensitively. It prints only
`path:line` for each hit, never the matched text, so its output is safe to paste. It also checks
that no tracked file is a blob listed in `local/forbidden-blobs.txt` (`<blob sha> <path>` per
line: the real photos and portraits you never want published) and that none of the gitignored
paths above has been force-added.

If you maintain a fork for your own household, run `--full` before every push. A clean
`verify:release` alone only proves the tree has no generic secret shapes; it knows nothing
about your family.

## Screenshots

The images in `docs/images/` are captured from the example household, never drawn by hand.
After a change that alters what the wall shows, regenerate them with
`npm run build && npm run screenshots`, then refresh their lines in
`tools/release/public-assets.sha256`; every capture changes the hashes, because the clock is
in the picture. Never capture a real household: the script provisions the synthetic one into a
throwaway database, and a screenshot of your own wall is household data.

## Making a change

- Read `CLAUDE.md` (project gotchas) and `docs/extension-points.md` before extending the wall.
- Keep the wall rendering from local state: nothing on the 6:00 AM path may wait on the network.
- Destructive actions must be impossible from the wall, not merely discouraged.
- Licence discipline: this project is AGPL-3.0-only. Do not paste code from projects whose
  licence is incompatible, and record any borrowed design or code in `THIRD_PARTY.md`.
