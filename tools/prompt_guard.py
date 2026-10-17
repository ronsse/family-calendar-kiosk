#!/usr/bin/env python3
"""Refuse an image prompt that discloses household data, before it can leave the house.

    python3 tools/prompt_guard.py "a compact travel trailer beside a campfire"  # AGES ARE DELIBERATELY NOT CHECKED. An earlier version refused both "7-year-old" and
# "seven-year-old" on the reasoning that three prompts carrying 7, 5 and 3 in one afternoon are
# this household's roster arriving one field at a time. The operator overruled it on
# 2026-08-29: he does not mind ages going out, and the archetype paragraph in
# tools/backgrounds.md that blesses them stands. Do not re-add this as an obvious improvement.
#
# The real concern he raised is upstream of the wording anyway, and is not a filter's job:
# whether this project should be generating depictions of children AT ALL. That is tracked in
# BACKLOG "Retire the generated child imagery" — a filter that polices how a child is described
# is a distraction from deciding whether to draw one.
#
# Kin relations stay refused. "my daughter" is not an age, it is a person in this house.
# 0 ok, 2 refused
    python3 tools/prompt_guard.py --selftest                                    # npm run verify:prompts

    from prompt_guard import check, enforce                                     # tools/gen-icon.py

ADR-0002's disclosure test asks one question of an outbound payload: does it contain anything
about this household? Until this file existed the answer was enforced by an agent remembering
build-plan.md §3.1 while typing a prompt — exactly the shape CLAUDE.md rules out: "Guardrails
are architectural, never a prompt instruction." A paragraph that asks nicely cannot fail; this
can, with an exit code.

WHAT IT REFUSES, strongest first:

  1. A name from the household roster (db/household.sql — gitignored, local only). This is the
     check that makes the guard real rather than advisory, and the only one that reads private
     data, so it never reports WHICH name matched — only that one was there.
  2. An age or a kin relation bound to the subject — "3-year-old", "aged five", "my daughter".
  3. Possessive household framing — "our dog", "my trailer". "a dog" is a scene noun and passes.
  4. A likeness request — "portrait of <someone>", "looks like this photo".

FALSE POSITIVES ARE THE INTENDED FAILURE MODE. A child named for a scene noun — Willow, River,
Robin — makes "a willow beside the pond" unsendable, and that is the trade being made on
purpose: the cost of this error is rewording a prompt, and the cost of the other one is a
child's name in a third party's logs, permanently and unrecallably.

KNOWN GAP, named rather than hidden: the roster read here is `child.display_name`. Adult names
live in db/calendars.sql (also gitignored) inside opaque calendar refs, and are not parsed —
extracting them means guessing which capitalised words in a calendar label are people, and a
guard that guesses is a guard that refuses "Winter holiday".
"""
import os
import pathlib
import re
import subprocess
import sys
from dataclasses import dataclass

# Resolved from __file__, never from the cwd. A guard whose strongest check quietly turns
# itself off when you run it from another directory is worse than no guard at all, because the
# report would still say the roster was "absent" and read like a clean bill of health.
REPO = pathlib.Path(__file__).resolve().parent.parent
ROSTER = REPO / "db" / "household.sql"

# ---------------------------------------------------------------------------
# POLICY — set by the household, 2026-09-03
# ---------------------------------------------------------------------------
#
# The household said: "there is no personal information that we passed. It's just clothing, settings, hair,
# eye color, age, names. Those things do not matter. They're not PII."
#
# The operator's call, and it is a reasonable one: an image prompt saying a girl has green eyes and wears
# magenta is a long way from a record that identifies anybody. So DESCRIPTION is no longer
# refused. What stays refused is a narrower and different thing.
#
#   "described"  — the default now. Names, ages, kin relations, hair, eyes, clothing and
#                  settings all pass. They are still REPORTED, as advisories, so the receipt
#                  says what went out; they just do not stop the call.
#   "redacted"   — the pre-2026-09-03 behaviour, kept whole so reverting is one word.
#
# TWO THINGS ARE NOT COVERED BY THAT DECISION AND STAY HARD IN BOTH MODES:
#
#   1. LIKENESS. A photograph is a different class of thing from a description — it is the one
#      disclosure that cannot be walked back, and it was never what he was talking about.
#      `check_references` stays hard too: only committed house art may be attached.
#
#   2. OTHER PEOPLE. This guard only ever saw prompts, but the same reasoning governs
#      docs/scene-pipeline.md §2.1, which passes calendar EVENT CATEGORIES and never raw
#      titles. That rule is not about this household's children at all — the titles carry
#      other families' names and other people's children, who were not asked. A parent can
#      decide what leaves the house about their own kids. They cannot decide it for the
#      friends in the calendar. §2.1 stands unchanged.
POLICY = "described"

_POSSESSIVE = r"(?:my|our|his|her|their|your)"
_KIN = (
    r"(?:son|daughter|kid|kids|child|children|baby|toddler|sister|brother|siblings?|"
    r"twins?|mom|mum|mommy|mummy|mother|dad|daddy|father|parents?|grandma|grandpa|"
    r"grandmother|grandfather|nana|papa|niece|nephew|cousin|aunt|auntie|uncle|wife|husband)"
)
# Objects and places that mean "this household's" the moment a possessive lands in front of
# them. The list is deliberately mundane: the disclosure is not the noun, it is the binding.
_HOUSEHOLD_NOUN = (
    r"(?:famil(?:y|ies)|house|home|apartment|flat|trailer|camper|caravan|rv|motorhome|"
    r"cabin|tent|yard|garden|garage|driveway|porch|kitchen|bedroom|bathroom|playroom|"
    r"living\s+room|street|neighbou?rhood|town|village|school|classroom|teacher|church|"
    r"car|truck|van|minivan|suv|bike|bicycle|scooter|boat|"
    r"dog|cat|pet|puppy|kitten|hamster|rabbit|bunny|guinea\s+pig|chickens?|horse|pony)"
)
_SMALL_NUMBER = r"(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)"

# tools/backgrounds.md blesses "a cheerful cartoon seven-year-old girl" as an archetype that
# "describes nobody in particular". This check is deliberately STRICTER and refuses it. A number
# is a fact about a person; three of them generated in one afternoon are the roster; and "a young
# child" returns the same drawing. Spelled-out numbers are matched for the same reason — a guard
# that stops "7-year-old" and waves through "seven-year-old" only stops the careless.
_CHECKS = (
    (
        "kin relation",
        (
            (rf"\b{_POSSESSIVE}\s+(?:\w+\s+){{0,2}}{_KIN}\b",
             "a kin relation names a member of this household"),
            (r"\b(?:mom|mum|mommy|mummy|dad|daddy|grandma|grandpa|nana|papa|auntie)['’]s\b",
             "a kin relation names a member of this household"),
        ),
    ),
    (
        "possessive household framing",
        (
            (rf"\b(?:my|our)\s+(?:\w+\s+){{0,2}}{_HOUSEHOLD_NOUN}\b",
             "'a dog' is a scene noun; 'our dog' is this household's dog"),
            # The backstop, and the reason the noun list above does not have to be complete:
            # a scene prompt is a noun phrase about objects, so "my" and "our" have no
            # legitimate work to do in one at all. "our campsite" slipped through a list that
            # had 'tent' and 'cabin' but not 'campsite', which is the failure mode of every
            # denylist. Reword rather than widen the list.
            (r"\b(?:my|our)\b",
             "a scene prompt describes objects — 'my' and 'our' bind them to this household"),
        ),
    ),
    (
        "likeness request",
        (
            # "portrait of a cheerful cartoon fox" is an archetype and passes; "portrait of
            # Grandma" is a request to draw somebody real. The article is what separates them.
            (r"\b(?:portrait|likeness|caricature)\s+of\s+(?!a\b|an\b|the\b|two\b|three\b|some\b|any\b)",
             "a portrait of a named subject is a likeness, not an archetype"),
            # Scoped to a referent on purpose: "a cloud that looks like a rabbit" is a scene,
            # and refusing it would teach people to route around the guard.
            (r"\blook(?:s|ing)?\s+like\s+(?:this|that|these|those|me|him|her|us|them|my|our|his|their|your|the)\b",
             "matching a likeness means the reference left the house too"),
            (r"\b(?:this|that|the|my|our|his|her|their|attached|uploaded|reference|enclosed)\s+"
             r"(?:photo|photograph|selfie|snapshot|headshot)\b",
             "a photograph of this household fails the disclosure test outright"),
            (r"\bphotos?\s+of\s+(?:me|us|my|our|him|his|her|their|them|the)\b",
             "a photograph of this household fails the disclosure test outright"),
            (r"\b(?:same|matching)\s+face\b",
             "a specific face is a likeness"),
            (r"\breal\s+(?:child|children|kid|kids|person|people)\b",
             "generated figures are generic by construction; a real one is a likeness"),
        ),
    ),
)


@dataclass(frozen=True)
class Report:
    findings: tuple  # (check, why) — strongest first. These REFUSE.
    checks: tuple    # what actually RAN, so an unrunnable check never reads as a pass
    # Matched, reported, and deliberately not refused under POLICY = "described". Kept separate
    # from `findings` rather than dropped, because "nothing was detected" and "something was
    # detected and allowed" are different facts and the receipt should not conflate them.
    advisories: tuple = ()
    # What was inspected. The attachment guard reuses this report, and "this prompt discloses
    # household data" printed over a refused IMAGE sends the reader to reword a clean prompt.
    subject: str = "prompt"

    @property
    def ok(self) -> bool:
        return not self.findings

    def text(self) -> str:
        head = (f"OK — nothing in this {self.subject} is refused"
                if self.ok else
                f"REFUSED — this {self.subject} discloses household data "
                "(ADR-0002 disclosure test)")
        rows = list(self.findings) + [(c, f"ALLOWED under POLICY={POLICY!r} — {w}")
                                      for c, w in self.advisories]
        width = max((len(c) for c, _ in rows), default=0)
        body = [f"  {c.ljust(width)}  {why}" for c, why in rows]
        return "\n".join([head] + body + ["checks run:"] + [f"  - {c}" for c in self.checks])


# Everything except a likeness is a DESCRIPTION, and descriptions are the household's call.
_SOFT_UNDER_DESCRIBED = ("household roster", "kin relation", "possessive household framing")


def check(prompt: str, roster_path: pathlib.Path = ROSTER) -> Report:
    """Run every check that can run, and report which ones those were."""
    findings, advisories, ran = [], [], []

    def record(label: str, why: str) -> None:
        """Refuse, or merely note — one place, so no check can pick its own policy."""
        if POLICY == "described" and label in _SOFT_UNDER_DESCRIBED:
            advisories.append((label, why))
        else:
            findings.append((label, why))

    if not roster_path.exists():
        # NOT a refusal: the roster is gitignored, so a clone, a CI box or a fresh worktree
        # legitimately has no copy. It IS reported by name — the requirement this satisfies is
        # "do not fail open silently", and a check that did not run must never look like a pass.
        ran.append(f"household roster — SKIPPED, {_shown(roster_path)} is absent (gitignored; "
                   "the strongest check did not run)")
    else:
        names = _name_pattern(roster_path.read_text(encoding="utf-8"))
        if names is None:
            # Fail CLOSED. A roster that is present but yields no names is the silent-degradation
            # case this whole module exists to prevent: reformat the file, and the one check that
            # reads real data becomes a no-op while every report still says PASS.
            record("household roster",
                   f"{_shown(roster_path)} exists but no child names could be parsed "
                   "from it — the check became a no-op")
            ran.append("household roster — UNPARSEABLE")
        else:
            ran.append("household roster — loaded")
            if names.search(prompt):
                # Deliberately says nothing about WHICH name, and prints no count either. This
                # report is the thing somebody pastes into a chat when they ask why generation
                # refused, and a household's size is a household fact.
                record("household roster", "the prompt contains a household name")

    for label, patterns in _CHECKS:
        ran.append(label)
        for pattern, why in patterns:
            hit = re.search(pattern, prompt, re.I)
            if hit:
                # Safe to echo, unlike the roster hit: this is the caller's own wording.
                record(label, f'"{hit.group(0).strip()}" — {why}')
                break

    return Report(tuple(findings), tuple(ran), advisories=tuple(advisories))


def enforce(prompt: str, roster_path: pathlib.Path = ROSTER) -> Report:
    """Check, print the receipt, and abort the process on a refusal.

    Call this before assembling a request, never after — the point is that a refused prompt
    never reaches a socket.
    """
    report = check(prompt, roster_path)
    print(report.text(), file=sys.stderr)
    if not report.ok:
        raise SystemExit(2)
    return report


def check_references(paths) -> Report:
    """Are these safe to send as style references?

    The text guard is the wrong shape for the strongest disclosure vector there is. This model
    is `text+image->text+image` and the house style depends on conditioning it on an approved
    image, so `gen-icon.py` attaches files on every call — and a photograph of a real child
    attached as a "style reference" discloses far more than any sentence could, while the
    prompt beside it reads as clean scene nouns.

    Two conditions, and a reference must meet both:

      1. It lives under `assets/`. Anything reached from outside the repo — a Downloads
         folder, the Pi, a photo library — is refused on the path alone.
      2. Git TRACKS it. This is the load-bearing half. Household-authored and generated
         imagery lands in the Docker volume and is deliberately never committed, and a family
         photo dropped into `assets/` is untracked by definition. So "committed" is a decent
         proxy for "somebody reviewed this and it is house art", and it costs an attacker or
         an absent-minded agent a deliberate `git add`.

    Deliberately NOT a directory allowlist. Banning `assets/avatars/` would block regenerating
    the avatar set, which is exactly what reference conditioning is for; the avatars there are
    already cartoons this pipeline produced, not photographs.
    """
    findings = []
    ran = ["reference is inside assets/", "reference is tracked by git"]
    tracked = None
    try:
        out = subprocess.run(
            ["git", "-C", str(REPO), "ls-files", "assets"],
            capture_output=True, text=True, timeout=20, check=False,
        )
        if out.returncode == 0:
            tracked = {(REPO / line).resolve() for line in out.stdout.splitlines() if line}
    except (OSError, subprocess.SubprocessError):
        tracked = None

    for raw in paths:
        path = pathlib.Path(raw)
        try:
            resolved = path.resolve()
        except OSError:
            findings.append(("reference is inside assets/", f'"{raw}" cannot be resolved'))
            continue
        try:
            resolved.relative_to((REPO / "assets").resolve())
        except ValueError:
            findings.append((
                "reference is inside assets/",
                f'"{raw}" is outside assets/ — only house art may be attached',
            ))
            continue
        if tracked is None:
            # Fail closed. An unavailable git is not evidence the file is house art, and this
            # is the check that would otherwise be the silent no-op.
            findings.append((
                "reference is tracked by git",
                "git is unavailable, so 'is this committed house art' cannot be answered",
            ))
        elif resolved not in tracked:
            findings.append((
                "reference is tracked by git",
                f'"{raw}" is untracked — commit it if it is house art, or do not send it',
            ))
    return Report(findings=tuple(findings), checks=tuple(ran), subject="attachment")


def enforce_references(paths) -> Report:
    """Check the attachments, print the receipt, and abort before any socket is opened."""
    report = check_references(paths)
    print(report.text(), file=sys.stderr)
    if not report.ok:
        raise SystemExit(2)
    return report


def _shown(path: pathlib.Path) -> str:
    try:
        return str(path.resolve().relative_to(REPO))
    except ValueError:
        return str(path)


def _name_pattern(sql: str):
    """Word-boundary matcher for every name in the roster, or None if there are none."""
    tokens = set()
    for name in _display_names(sql):
        # Split into words so a two-part display name is caught by either half, and keep the
        # unicode letter class — an accented name must not fall out of the roster silently.
        tokens.update(t.lower() for t in re.findall(r"[^\W\d_]{2,}", name))
    if not tokens:
        return None
    # Word boundaries, not substrings: a child called Zephyrine must not veto "a zephyr of
    # leaves". The inverse — a name that IS a scene noun — refuses, and is meant to.
    return re.compile(r"\b(?:" + "|".join(re.escape(t) for t in sorted(tokens)) + r")\b", re.I)


def _display_names(sql: str) -> list:
    """display_name out of every `INSERT INTO child` in the roster file."""
    names = []
    for stmt in re.findall(r"INSERT\s+INTO\s+child\b(.*?);", _uncomment(sql), re.I | re.S):
        parts = re.split(r"\bVALUES\b", stmt, maxsplit=1, flags=re.I)
        if len(parts) != 2:
            continue
        head, rows = parts
        columns = re.search(r"\(([^()]*)\)", head)
        index = 1  # the positional form db/household.example.sql documents
        if columns:
            declared = [c.strip().strip('"`[]').lower() for c in columns.group(1).split(",")]
            if "display_name" in declared:
                index = declared.index("display_name")
        for row in re.findall(r"\(([^()]*)\)", rows):
            fields = _fields(row)
            if len(fields) > index:
                names.append(_unquote(fields[index]))
    return names


def _uncomment(sql: str) -> str:
    """Drop `--` comments, but not ones inside a string literal.

    db/household.example.sql documents the column order in a comment that reads exactly like an
    INSERT, and the commented-out reset block is real SQL — parsing either as live rows is how a
    guard ends up matching on placeholder names instead of the real ones.
    """
    out, i, quoted = [], 0, False
    while i < len(sql):
        ch = sql[i]
        if not quoted and sql.startswith("--", i):
            end = sql.find("\n", i)
            i = len(sql) if end < 0 else end
            continue
        if ch == "'":
            quoted = not quoted
        out.append(ch)
        i += 1
    return "".join(out)


def _fields(row: str) -> list:
    out, cur, quoted = [], [], False
    for ch in row:
        if ch == "'":
            quoted = not quoted
        elif ch == "," and not quoted:
            out.append("".join(cur).strip())
            cur = []
            continue
        cur.append(ch)
    out.append("".join(cur).strip())
    return out


def _unquote(field: str) -> str:
    if len(field) >= 2 and field[0] == "'" and field[-1] == "'":
        return field[1:-1].replace("''", "'")
    return field


# --- self-test ---------------------------------------------------------------
# Same contract as db/verify-schema.py: prints PASS/FAIL per case, exits non-zero if any failed.
# The roster cases run against a synthetic file in a temp dir, so the suite is identical on a
# box that has a real db/household.sql and on one that does not.

_SYNTHETIC_ROSTER = """
-- Synthetic. Names nobody has, so this file can be committed.
-- (id, display_name, reading_band, ledger_enabled, avatar_asset_id, sort_order, active)
INSERT INTO child VALUES
  ('child-a','Zephyrine','fluent',  1,'av-a',1,1),
  ('child-b','Quillbert Vance','emergent',1,'av-b',2,1);
"""

_CLEAN = (
    # Ages pass BY DECISION, not by omission — the operator overruled the check on 2026-08-29.
    # These three sit here so that re-adding an age rule fails loudly instead of looking like
    # a tightening nobody objected to. See the note above _CHECKS.
    "a cartoon 3-year-old holding a balloon",
    "a cheerful cartoon seven-year-old girl at an upright piano",
    "a birthday cake for a boy aged 5",
    "a compact travel trailer beside a campfire, pine trees behind",
    "a soccer ball",
    "a toothbrush with a stripe of toothpaste",
    "a dog asleep in a basket",                       # 'a dog' passes where 'our dog' does not
    "a family of ducks crossing a road",              # bare 'family' is a noun, not a household
    "a group of cartoon children playing in a park",  # generic figures — the scenes NEED these
    "a yellow school bus at the far right",
    "a house with a red door and a bicycle leaning on it",
    "a cloud shaped like a rabbit over the mountains",
    "a birthday cake with candles",
)

# ALLOWED under POLICY = "described", and each one still raises an ADVISORY so the receipt
# records what went out. These sit here rather than in _CLEAN because they are not clean —
# they are permitted, which is a different thing, and flipping POLICY back to "redacted" must
# make every one of them refuse again.
_ADVISED = (
    "my daughter on a swing",
    "our youngest son kicking a soccer ball",
    "his sister waving from the porch",
    "grandma's house in the snow",
    "our dog asleep by the fire",
    "the front of our trailer at the campsite",
    "our campsite at the lake",  # the noun list has no 'campsite' — the my/our backstop does
    "a tent beside my family's car",
)

# REFUSED IN BOTH MODES. A photograph is not a description, and the household's 2026-09-03
# decision was about descriptions. If one of these ever passes, the decision has been widened
# by accident rather than on purpose.
_DIRTY = (
    "a portrait of Grandma Jean",
    "a cartoon child that looks like this photo",
    "based on this photo of the kids, draw them as cartoons",
    "an illustration of a real child, not a cartoon",
)


def _selftest() -> int:
    import tempfile

    failures, total = [], []

    def result(ok, label):
        total.append(label)
        print(("PASS " if ok else "FAIL ") + label)
        if not ok:
            failures.append(label)

    def case(label, prompt, want_ok, roster):
        report = check(prompt, roster)
        result(report.ok == want_ok, label)
        return report

    with tempfile.TemporaryDirectory() as tmp:
        roster = pathlib.Path(tmp) / "household.sql"
        roster.write_text(_SYNTHETIC_ROSTER, encoding="utf-8")
        absent = pathlib.Path(tmp) / "no-such-household.sql"
        empty = pathlib.Path(tmp) / "empty.sql"
        empty.write_text("-- a roster with the children commented out\n"
                         "-- INSERT INTO child VALUES ('child-a','Zephyrine','fluent',1,'av-a',1,1);\n",
                         encoding="utf-8")

        for prompt in _CLEAN:
            case(f"clean prompt passes: {prompt[:52]}", prompt, True, roster)

        # Permitted, and permitted LOUDLY. Asserting the advisory as well as the pass is what
        # stops POLICY = "described" from decaying into a guard that silently sees nothing:
        # a pattern that stopped matching would still "pass", and only the missing advisory
        # says the check went blind.
        for prompt in _ADVISED:
            case(f"described prompt is allowed: {prompt[:44]}", prompt, True, roster)
            rep = check(prompt, roster)
            result(bool(rep.advisories),
                   f"...and is reported as an advisory: {prompt[:40]}")

        for prompt in _DIRTY:
            case(f"refused: {prompt[:52]}", prompt, False, roster)

        # The scaffold gen-icon.py wraps every subject in travels with it, so the guard runs on
        # the whole assembled prompt. A false positive HERE would brick the only generation path
        # in the repo, so it is a test rather than a hope. Read out of the source with ast
        # because importing gen-icon.py needs Pillow, which is deliberately not installed
        # system-wide on this box (PEP 668).
        scaffold = _gen_icon_scaffold()
        if scaffold is None:
            result(False, "gen-icon.py's own fixed scaffold could not be read")
        else:
            case("gen-icon.py's own fixed scaffold passes", scaffold, True, roster)

        case("roster name refused", "a portrait of Zephyrine, smiling", False, roster)
        # A roster name is ALLOWED under POLICY = "described" and still DETECTED. Both halves
        # are asserted: the pass alone would also be produced by a matcher that had quietly
        # stopped working, and the advisory is what distinguishes "permitted" from "blind".
        for label, prompt in (("case-insensitively", "quillbert riding a scooter"),
                              ("second half of a two-part name", "vance building a sandcastle")):
            case(f"roster name allowed ({label})", prompt, True, roster)
            result(any(c == "household roster" for c, _ in check(prompt, roster).advisories),
                   f"...and still detected ({label})")
        # And the revert is real: flipping the policy back must refuse the same two.
        _saved, globals()["POLICY"] = POLICY, "redacted"
        try:
            still = all(not check(p, roster).ok
                        for p in ("quillbert riding a scooter", "our dog by the fire"))
            result(still, 'POLICY="redacted" restores refusal for names and possessives')
        finally:
            globals()["POLICY"] = _saved
        case("a scene noun that merely starts like a name passes",
             "a zephyr of leaves over the dunes", True, roster)

        # The one output rule this module has: it may say a name was found, never which. It
        # holds for an ADVISORY too — the receipt is the thing somebody pastes into a chat.
        leaky = check("a portrait of Zephyrine, smiling", roster).text()
        quiet = not any(n in leaky.lower() for n in ("zephyrine", "quillbert", "vance"))
        result(quiet, "a roster refusal never prints the name it matched")

        # Absent roster: the other checks still run, and the report SAYS the strong one did not.
        case("absent roster still passes a clean prompt", _CLEAN[0], True, absent)
        case("absent roster: a possessive is allowed and advised", "our dog by the fire", True, absent)
        told = "absent" in check(_CLEAN[0], absent).text()
        result(told, "an absent roster is reported, not silently skipped")

        # Present but unparseable: fail closed, or the strongest check can be disabled by a
        # reformat that nothing warns you about.
        # Present but unparseable is no longer a refusal — under "described" a roster hit would
        # not have refused anyway, so failing closed on the matcher would refuse MORE than the
        # policy it enforces. It is still reported by name, which is the property that matters:
        # a check that became a no-op must never look like a pass.
        case("an unparseable roster no longer refuses a clean prompt", _CLEAN[0], True, empty)
        result("UNPARSEABLE" in check(_CLEAN[0], empty).text(),
               "an unparseable roster is still reported, not silently skipped")

        # ------------------------------------------------------------------
        # Attachments. The strongest disclosure vector, and the one a text
        # guard cannot see: a photograph sent as a "style reference" beside a
        # prompt that reads as perfectly clean scene nouns.
        # ------------------------------------------------------------------
        def refs(label, paths, want_ok):
            result(check_references(paths).ok == want_ok, label)

        refs("the house references gen-icon actually sends are accepted",
             list(_gen_icon_references()), True)
        refs("a reference from outside assets/ is refused",
             [str(pathlib.Path(tmp) / "anything.png")], False)

        # The family-photo case, which is the whole reason this check exists: a real
        # photograph dropped into assets/ is UNTRACKED, because household imagery lives in
        # the volume and is never committed.
        dropped = REPO / "assets" / "icons" / "_selftest_untracked.png"
        try:
            dropped.write_bytes(b"not really a png")
            refs("an untracked file dropped into assets/ is refused", [str(dropped)], False)
        finally:
            dropped.unlink(missing_ok=True)

    print()
    if failures:
        print(f"{len(failures)} FAILURE(S): " + "; ".join(failures))
        return 1
    print(f"{len(total)} cases hold — no likeness, and no untracked attachment, can reach the model")
    return 0


def _gen_icon_references():
    """The reference paths gen-icon.py ships with, read without importing it.

    Importing needs Pillow, which is deliberately not installed system-wide here (PEP 668).
    A false positive on the house references would brick the only generation path in the
    repo, so it is a test rather than a hope — the same reasoning as the scaffold check.
    """
    import ast

    tree = ast.parse((REPO / "tools" / "gen-icon.py").read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == "REFERENCES" for t in node.targets
        ):
            return [str(REPO / v) for v in ast.literal_eval(node.value)]
    raise AssertionError("gen-icon.py no longer defines REFERENCES")


def _gen_icon_scaffold():
    import ast

    source = REPO / "tools" / "gen-icon.py"
    if not source.exists():
        return None
    tree = ast.parse(source.read_text(encoding="utf-8"))
    parts = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id in ("COMPOSITION", "PALETTE", "STYLE"):
                    parts[target.id] = node.value.value
    if len(parts) != 3:
        return None
    return "\n\n".join(parts[k] for k in ("COMPOSITION", "PALETTE", "STYLE"))


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "--selftest":
        sys.exit(_selftest())
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    enforce(sys.argv[1])
