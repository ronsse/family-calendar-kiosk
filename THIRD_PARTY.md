# Third-party notices

family-calendar-kiosk is licensed under the GNU Affero General Public License v3.0 only
(see `LICENSE`). It depends on, bundles, or borrows from the works below. Each keeps its own
licence. None of them is GPL or AGPL code copied into this repository.

## ical.js — MPL-2.0

- Source: https://github.com/kewisch/ical.js
- Licence: Mozilla Public License 2.0 (https://mozilla.org/MPL/2.0/)
- Use: an unmodified npm dependency, used by the iCal calendar adapter in `src/calendar/ics/`
  to parse and expand calendar feeds. MPL-2.0 is file-level copyleft: ical.js's own files stay
  under MPL-2.0, and their source is available at the address above. This repository does not
  modify or vendor them.

## DinkyDash — MIT (design lineage)

- Source: https://dinkydash.co
- Licence: MIT
- Use: no files are vendored. The wall's type-scale ratios and role relationships
  (`web/src/design/tokens.css`), the countdown primitive ("3 sleeps until Christmas"), and the
  emoji-forward, pre-reader-legible design language were studied in and adapted from
  DinkyDash's `templates/index.html`. See `docs/decisions/0004-build-the-app.md`, "What we
  harvest, and how". Its MIT notice is reproduced here as attribution; the copyright holders
  are the DinkyDash authors, named in the upstream `LICENSE`:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this
> software and associated documentation files (the "Software"), to deal in the Software
> without restriction, including without limitation the rights to use, copy, modify, merge,
> publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to
> whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
> INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
> PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
> FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
> OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
> DEALINGS IN THE SOFTWARE.

## Studied, not copied

ChoreOps (GPL-3.0) and Donetick (AGPL-3.0) were read to understand the chore domain model
(assignment kinds, claim and approve, rotation). No code from either is in this repository.

## Bundled fonts — SIL Open Font License 1.1

Self-hosted latin subsets in `web/src/design/fonts/`, each with its licence text beside it:

| Font file | Family | Licence file |
|---|---|---|
| `nunito-latin-wght.woff2` | Nunito | `OFL-Nunito.txt` |
| `fredoka-latin-wght.woff2` | Fredoka | `OFL-Fredoka.txt` |
| `fraunces-latin-wght.woff2` | Fraunces | `OFL-Fraunces.txt` |
| `wall-reader-latin-700.woff2` | "Wall Reader", a renamed subset of Andika (SIL International) | `OFL-Andika.txt` |

Andika's licence reserves the names "Andika" and "SIL", and a subset is a Modified Version
under OFL §3, so the subset is renamed in its own name table.

## Runtime npm dependencies

Read from each package's `package.json` in `node_modules` (versions as locked on 2026-10-17).
Direct dependencies are in bold; the rest are pulled in by them.

| Package | Version | Licence |
|---|---|---|
| **better-sqlite3** | 11.10.0 | MIT |
| **ical.js** | 2.2.1 | MPL-2.0 |
| **react** | 18.3.1 | MIT |
| **react-dom** | 18.3.1 | MIT |
| base64-js | 1.5.1 | MIT |
| bindings | 1.5.0 | MIT |
| bl | 4.1.0 | MIT |
| buffer | 5.7.1 | MIT |
| chownr | 1.1.4 | ISC |
| decompress-response | 6.0.0 | MIT |
| deep-extend | 0.6.0 | MIT |
| detect-libc | 2.1.2 | Apache-2.0 |
| end-of-stream | 1.4.5 | MIT |
| expand-template | 2.0.3 | MIT OR WTFPL |
| file-uri-to-path | 1.0.0 | MIT |
| fs-constants | 1.0.0 | MIT |
| github-from-package | 0.0.0 | MIT |
| ieee754 | 1.2.1 | BSD-3-Clause |
| inherits | 2.0.4 | ISC |
| ini | 1.3.8 | ISC |
| js-tokens | 4.0.0 | MIT |
| loose-envify | 1.4.0 | MIT |
| mimic-response | 3.1.0 | MIT |
| minimist | 1.2.8 | MIT |
| mkdirp-classic | 0.5.3 | MIT |
| napi-build-utils | 2.0.0 | MIT |
| node-abi | 3.94.0 | MIT |
| once | 1.4.0 | ISC |
| prebuild-install | 7.1.3 | MIT |
| pump | 3.0.4 | MIT |
| rc | 1.2.8 | BSD-2-Clause OR MIT OR Apache-2.0 |
| readable-stream | 3.6.2 | MIT |
| safe-buffer | 5.2.1 | MIT |
| scheduler | 0.23.2 | MIT |
| semver | 7.8.5 | ISC |
| simple-concat | 1.0.1 | MIT |
| simple-get | 4.0.1 | MIT |
| string_decoder | 1.3.0 | MIT |
| strip-json-comments | 2.0.1 | MIT |
| tar-fs | 2.1.5 | MIT |
| tar-stream | 2.2.0 | MIT |
| tunnel-agent | 0.6.0 | Apache-2.0 |
| util-deprecate | 1.0.2 | MIT |
| wrappy | 1.0.2 | ISC |

Most of the transitive list is `better-sqlite3`'s native-build chain (`prebuild-install` and
what it uses), which runs at install time. Development-only tools (TypeScript, Vite and their
plugins and type packages) are not distributed with the app and are not listed.
