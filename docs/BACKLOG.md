# Backlog

Open items only. Decisions and their reasoning live in `docs/decisions/` and `docs/design-review/`.

- **Swimwear for more settings.** Only `swim-pool` opts in; a lake or beach day should copy that pattern, never loosen the clothed check.
- **Fewer than three children.** Scene quality with a one- or two-child cast is untested; such a household boots onto `backdrop`.
- **Picture readout.** Whether the idle picture needs an at-a-glance chip waits on the door-tap counter (H10).
- **Partial cash-out** for the two bands that cannot type a number.
- **The sibling-tap trap.** A pre-reader can still land on a text-heavy sibling screen; only the escape is fixed.
- **A transparent calendar card.** The week grid sits on an opaque card so titles never land on the picture; going transparent needs the text to survive the art.
- **Band scaling** for the younger bands may be larger than it needs to be.
- **`claimed_in_part` / `approved_in_part`** chore states were not built.
- **Streak vanishing** after a long run is itself a visible signal. ADR-0006 §5 replaces the streak with week dots; open until they ship.
- **Motivation build** (ADR-0006): all-done celebration, week dots and good weeks, duty titles and after-tap words, clearing your own plate, a day off for one child. ("Toys away", the "Family helpers" heading and the away-for-a-job skip shipped 2026-10-22.)
- **Allowance design review** (ADR-0006 §7): spend/save/give, real jars, payday, and the re-opened coin-jar decision. The amount is decided: half the age in dollars a week.
- **`low-poly` style** needs a child's verdict that she can still find herself in it.
- **Panel brightness.** The 225-nit figure came from a sibling model's datasheet; re-check before trusting contrast guidance.
- **Pi Wi-Fi drop root cause** is unknown; read the persisted journal on the next occurrence.
- **Photoreal stays off.** `check_tables()` refuses a style or premise that brings it back.
