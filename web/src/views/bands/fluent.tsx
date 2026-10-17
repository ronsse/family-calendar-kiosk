/**
 * Unit H — the FLUENT band.  Child A is seven and reads.
 *
 * The most conventional of the three, and the one to be most careful with: it is
 * the band a developer instinctively designs first, and every unnecessary word
 * here is a habit that then leaks downward into the other two.  It gets full
 * labels, real numerals, money and streaks — and the same icons, because the wall
 * is read from across the room by everyone.
 *
 * Icons are SMALLER here than in the other bands, and so are the tap targets.  That
 * inversion is the whole point of the band scale (Unit G): literacy buys density.
 */

import type {
  AvatarProps,
  ChoreCardProps,
  CountdownCardProps,
  EventCardProps,
  PointsBadgeProps,
  RendererSet,
  RoutineStepProps,
  StatusPillProps,
} from '../contract.ts';
import {
  bandTypography,
  colour,
  layoutPx,
  fontSizePx,
  fontWeight,
  freshnessColour,
  iconPx,
  radius,
  spacePx,
  stateTreatments,
  strokePx,
} from '../../design/tokens.ts';
import { AccentFrame, AssetImage } from '../primitives/AssetImage.tsx';
import { EmojiOrIcon } from '../primitives/EmojiOrIcon.tsx';
import { Glyph } from '../primitives/Glyph.tsx';
import { StateMark } from '../primitives/StateMark.tsx';
import { Tappable } from '../primitives/Tappable.tsx';
import { card, numeralText, onSolid, px, tapTarget, text } from '../primitives/style.ts';
import { truncateWords } from '../logic/labels.ts';
import { counted, NOUN, nounFor } from '../logic/plural.ts';
import { NAME_BELOW_GAP_PX, NAME_BESIDE_GAP_PX, NAME_TILE_PAD_PX } from '../logic/railNames.ts';
import { numeralThatFits } from '../logic/routineFit.ts';
import { useBandTypography } from './registry.tsx';

/**
 * The band's scale AT THE READER'S DISTANCE.
 *
 * These were module-level constants read straight off `bandTypography`, which meant the near
 * scale introduced by H8 reached the chrome that calls the hook and NOT the leaves — the type
 * on a child's own screen never moved. A hook is the only way a leaf can know how far away
 * somebody is standing, because distance is context, not a prop.
 *
 * `TYPO` keeps its name on purpose: test/unit-h.sources greps `tapTarget(TYPO.minTapPx` to
 * prove no target is sized by a number somebody picked.
 */
function useTypo() {
  const TYPO = useBandTypography();
  return {
    TYPO,
    PRIMARY_TEXT: TYPO.primaryTextPx ?? fontSizePx.bodyLarge,
    SECONDARY_TEXT: TYPO.secondaryTextPx ?? fontSizePx.small,
    NUMERAL_TEXT: TYPO.numeralTextPx ?? fontSizePx.sectionTitle,
    full: (s: string): string => truncateWords(s, TYPO.maxLabelWords),
  };
}



/**
 * What a chore past its bound says to the child who can read it.
 *
 * An offer, not a verdict. Not "Late", not "Overdue", not "Missed" — she is seven, she reads it
 * fluently, and so does everyone else in the room including her sisters and any guest. The
 * H10 panel's whole finding was that a shared wall makes a failure state a public one.
 */
const STILL_TIME_WORD = 'Still time';
const STREAK_WORD = 'day streak';
const WAITING_WORD = 'waiting to cash out';
const CASH_OUT_WORD = 'Cash out';

/**
 * The face, and the name where the rail has room for it.
 *
 * The inline pill of 2026-08 is gone for good: it carried the name beside a 64px avatar in a
 * column a third of the wall wide, and the failure mode was `text()` ellipsising a child's own
 * name to "Col…" on the board that is supposed to be hers. What a rail draws now is the THEME's
 * choice (`nameAt`): under the face on the plinth and the spine, in a pill beside it on felt's
 * bottom row — where the row is the long axis and a name has the width it never had in a column.
 *
 * No progress. The rail is navigation (see `AvatarProps`); "2/5" lives on her own screen.
 */
function FluentAvatar({
  crop,
  avatar,
  accent,
  selected,
  selectedTint,
  nameplate,
  nameAt,
  faceSizePx,
  frame,
  onSelect,
}: AvatarProps) {
  const { TYPO } = useTypo();
  const face = faceSizePx ?? TYPO.navAvatarPx;
  // A rail that sets the face is one that names its children, and it charged the padding.
  const pad = faceSizePx === undefined ? spacePx.xs : NAME_TILE_PAD_PX;
  const beside = nameAt === 'beside';
  return (
    <Tappable
      enabled
      onTap={onSelect}
      style={tapTarget(TYPO.navTapPx, {
        flexDirection: beside ? 'row' : 'column',
        // 8, not the target's 12: the face is 64 and the rail is 80. See `navTapPx`.
        padding: px(pad),
        gap: px(beside ? NAME_BESIDE_GAP_PX : NAME_BELOW_GAP_PX),
        background: selected && selectedTint !== false ? accent.tint : 'transparent',
        borderRadius: radius.xl,
        ...(faceSizePx === undefined ? {} : { minHeight: px(face + 2 * pad) }),
      })}
    >
      <AccentFrame accent={accent} sizePx={face} selected={selected} shape={frame}>
        <AssetImage asset={avatar} sizePx={face} crop={crop} />
      </AccentFrame>
      {/* Her name, as the rail drew it: placed here, never read here (contract `nameplate`). */}
      {nameplate}
    </Tappable>
  );
}

/**
 * ONE ROW IN A COLUMN, OR ONE CELL OF A GRID (H5 §3.3).
 *
 * The steps used to sit in an auto-fit grid, which put a SEQUENCE into a shape the eye can
 * read two ways — left-to-right-then-down, or top-to-bottom — and a routine is ordered either
 * way. The tournament caught that, and the patch at the time was to put the position numeral
 * back so something still carried the order.
 *
 * The numeral is gone again in felt and gallery, because the column has taken the job back.
 * Order is carried by position, which is what position is for. Storybook draws it anyway
 * (`showOrder`), as a book numbers the one list on the wall that is a sequence.
 *
 * The grid came back in 2026-10 for the one place a column cannot hold a routine — felt's short
 * pane, where a four-step morning scrolled — and only there (`fitRoutineGrid`). The numeral did
 * NOT come back with it: charged to felt's 3-across columns it scrolls an eight-step routine
 * again. The next-step ring is what points, whichever way the grid is read.
 *
 * Rows, not tiles, and every size in a row comes from the panel's fit rather than from this
 * band (`fit`, logic/routineFit.ts): the pane is fixed, so a routine with more steps gets
 * slightly smaller ones, down to the 64px tap floor and 14px type, and only then scrolls.
 */
function FluentRoutineStep({
  labelFull,
  icon,
  done,
  doneAtText,
  confirmPending,
  isNext,
  position,
  showOrder,
  fit,
  markSide,
  markShape,
  onToggle,
}: RoutineStepProps) {
  const { TYPO, PRIMARY_TEXT, SECONDARY_TEXT, NUMERAL_TEXT, full } = useTypo();
  const treatment = done ? stateTreatments.approved : stateTreatments.pending;
  const ink = done ? treatment.ink : colour.ink;
  /*
    The mark is sized by the fit with the rest of the row. It is the successor of the trailing
    glyph whose 48px once made every row 76 tall and clipped the fourth step 16px below the fold
    (measured on the panel 2026-08-27): nothing in a step is sized on its own any more, so
    nothing can quietly become the tallest thing in the row again.
  */
  const mark = <StateMark treatment={treatment} shape={markShape} sizePx={fit.markPx} />;
  return (
    <Tappable
      enabled
      onTap={onToggle}
      style={tapTarget(TYPO.minTapPx, {
        justifyContent: 'flex-start',
        width: '100%',
        minHeight: px(fit.rowPx),
        height: px(fit.rowPx),
        padding: px(fit.padPx),
        gap: px(spacePx.sm),
        background: done ? treatment.fill : colour.surface,
        // THE CONFIRM RING. One tap has landed and nothing has been applied yet, so this must
        // NOT look like "done" — it is a heavy ink outline, saying only "I heard you, do it
        // again". Wordless on purpose: the pre-reader's screens carry no text, and he is the
        // child this mechanism most exists to protect. It also outranks the `isNext` focus
        // ring, because what the wall is waiting for right now matters more than what is next.
        border: confirmPending
          ? `${px(strokePx.focus)} solid ${colour.ink}`
          : `${px(isNext && !done ? strokePx.focus : treatment.edgeWidthPx)} solid ${treatment.edge}`,
        borderRadius: radius.md,
      })}
    >
      {/*
        The position numeral, ONLY where the theme numbers its steps (storybook). In felt and
        gallery the column carries the order by itself — a numeral beside it would be the same
        fact twice, spent on a seven-year-old who can already see the second row is second. A
        book numbers its one real sequence anyway, and there it is a third carrier, never the
        only one.
      */}
      {showOrder ? (
        <span
          style={{
            ...numeralText(numeralThatFits(NUMERAL_TEXT, fit.contentPx), done ? treatment.ink : colour.inkMuted),
            minWidth: px(spacePx.xl),
            textAlign: 'center',
            flex: '0 0 auto',
          }}
        >
          {position}
        </span>
      ) : null}
      {markSide === 'start' ? mark : null}
      {/* The fitted icon, which is this band's secondary: in a row the LABEL is fluent's
          primary channel, and a big icon beside it claims a hierarchy it does not have here. */}
      <AssetImage asset={icon} sizePx={fit.iconPx} />
      {/*
        The fitted label: the band's primary at the reader's distance, stepping down the type
        scale only as far as a long routine needs, never under 14. Two lines, then an ellipsis.
      */}
      <span
        style={{
          ...text(fit.labelPx ?? PRIMARY_TEXT, { wrap: true, lines: 2 }),
          color: ink,
          flex: 1,
          minWidth: 0,
        }}
      >
        {full(labelFull)}
      </span>
      {doneAtText.length === 0 ? null : (
        <span style={{ ...text(TYPO.statusTextPx ?? SECONDARY_TEXT), color: ink, flex: '0 0 auto' }}>
          {doneAtText}
        </span>
      )}
      {markSide === 'end' ? mark : null}
    </Tappable>
  );
}

/**
 * A ROW, filled, matching the step rows above it (H5 §3.5).
 *
 * Two changes at once, and they are the same change. It used to be a two-line COLUMN — icon
 * over label, then glyph, state word and points — inside a white card with a coloured stripe
 * down one edge. That is ~120px per chore, and it is an OUTLINE: on a panel at 225 nits behind
 * etched glass a 2px edge is the first thing to go, and a stripe carrying identity is the
 * first thing to go with it.
 *
 * Now it is one row, filled with the child's own tint while there is still something to do.
 * The fill is the loudest channel this panel has and it costs nothing, where the stripe cost
 * an edge nobody across the room could resolve. Identity is carried by the fill AND the stripe
 * AND the fixed rail position AND the avatar — four channels, none of them alone.
 *
 * `treatment.fillRole === 'outline'` is the pending state, and it is the one this overrides:
 * claimed, approved and superseded already carry their own fills and must keep them, because
 * those fills are what distinguishes them from each other.
 */
/**
 * TWO ROWS, because on one row the chore's NAME was the thing that lost.
 *
 * Measured on the panel 2026-09-09, in a 392px card: icon 32, name **116**, "Still time" 72,
 * clock 48, state glyph 48. The name — the only part that says what to actually go and do —
 * got under a third of the card, and on a claimed chore, where the word is "Waiting for a
 * grown-up", it got about 110px and broke mid-word. The operator saw `Clea` / `r t…` and `Feed th…`
 * and said the children cannot read their own chore list.
 *
 * The cause is a flex row where every sibling is content-sized and only the name has
 * `minWidth: 0`. That makes the name the ONLY thing that can shrink, so it absorbs every
 * pixel the others want — precisely backwards. Widening it inside one row does not fix it
 * either: the status word, the points and the glyph are 200px between them however they are
 * arranged, and the name is left with what is over.
 *
 * So the name gets a row of its own — 332px instead of 116 — and everything that describes its
 * STATE moves to a second row underneath. The card grows from 88 to ~110, which costs nothing:
 * the board is a two-column grid in a ~412px pane, and three rows of cards fit at either
 * height.
 *
 * **The invariant, and it is why the name is drawn first:** nothing on this card may take
 * space from the chore's name. The status word on row two is `minWidth: 0` with an ellipsis,
 * so if a longer phrase ever arrives it is the STATUS that truncates and never the name.
 *
 * ## The clock is gone from this band
 *
 * It said the same thing as the words beside it — "Still time" *and* a clock — and two round
 * glyphs at the right edge of a tappable card read as two buttons. The household said: *"I'm not sure what
 * the still time, the circle with the time clock, and then the empty circle are. They seem to
 * be doing the same things when I click them."* They were not buttons at all; the whole card
 * is one tap target. This band has a fluent reader, so the word is the better channel and the
 * clock was pure duplication.
 *
 * It stays in the PICTURE band, where it is not duplication but the entire message — a
 * three-year-old cannot read "Still time", and that card carries no words at all. It also
 * stays in `emergent`, where a reader who is still guessing at words benefits from the shape
 * beside them. Same glyph, three different jobs; only the redundant one was removed.
 */
function FluentChoreCard({
  labelFull,
  icon,
  treatment,
  stateWordFull,
  points,
  accent,
  interactive,
  stillTime,
  markSide,
  markShape,
  onClaim,
}: ChoreCardProps) {
  const { TYPO, PRIMARY_TEXT, SECONDARY_TEXT, NUMERAL_TEXT, full } = useTypo();
  const ink = treatment.fillRole === 'solid' ? treatment.ink : colour.ink;
  return (
    <Tappable
      enabled={interactive}
      onTap={onClaim}
      style={tapTarget(TYPO.minTapPx, {
        justifyContent: 'flex-start',
        gap: px(spacePx.sm),
        width: '100%',
        padding: px(spacePx.xs),
        background: treatment.fillRole === 'outline' ? accent.tint : treatment.fill,
        border: `${px(stillTime ? strokePx.focus : treatment.edgeWidthPx)} solid ${treatment.edge}`,
        borderLeftWidth: px(strokePx.focus),
        borderLeftColor: accent.solid,
        borderRadius: radius.md,
        opacity: treatment.opacity,
      })}
    >
      {/*
        The ledger's box (gallery, storybook) leads the card beside BOTH rows, so it takes its
        width from the whole card rather than from the name's row. Felt's sticker ends the
        status row instead, beside the points.
      */}
      {markSide === 'start' ? <StateMark treatment={treatment} shape={markShape} sizePx={iconPx.md} /> : null}
      <span
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: px(spacePx.xxs),
          flex: 1,
          minWidth: 0,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: px(spacePx.sm), minWidth: 0 }}>
          <AssetImage asset={icon} sizePx={TYPO.secondaryIconPx} />
          <span
            style={{
              ...text(fontSizePx.bodyLarge, { wrap: true, lines: 2 }),
              color: ink,
              flex: 1,
              minWidth: 0,
            }}
          >
            {full(labelFull)}
          </span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: px(spacePx.sm), minWidth: 0 }}>
          {/*
            The word she reads, and it is an OFFER. "Still time" and not "Late", "Overdue" or
            "Missed" — she is seven, she can read it, and so can her sisters and anyone standing
            in the room. It replaces the state word rather than crowding in beside it, because a
            pending chore's state word says nothing this does not say better.

            SMALLER TEXT, NOT FEWER WORDS: the status line has its own type step
            (`statusTextPx`, never under 14), so "Waiting for a grown-up" fits as written. And
            `minWidth: 0` with an ellipsis is the invariant in the header made mechanical: this
            is the element that gives way when the card is tight, so the name never is.
          */}
          <span
            style={{
              ...text(TYPO.statusTextPx ?? SECONDARY_TEXT),
              color: ink,
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {full(stillTime ? STILL_TIME_WORD : stateWordFull)}
          </span>
          {points === 0 ? null : (
            <span
              style={{
                ...numeralText(SECONDARY_TEXT, ink),
                fontWeight: fontWeight.black,
                flex: '0 0 auto',
              }}
            >
              {counted(points, NOUN.point)}
            </span>
          )}
          {markSide === 'end' ? <StateMark treatment={treatment} shape={markShape} sizePx={iconPx.sm} /> : null}
        </span>
      </span>
    </Tappable>
  );
}

/**
 * A ROW, not a billboard (H5 §3.8).
 *
 * This used to be a column: a full-width solid accent bar carrying the numeral, then the cash
 * line, then the cash-out button. Measured on the panel it came to ~230px of a 540px screen —
 * to show the number zero, which is what it shows most of the day, because points are earned
 * in bursts and spent in bursts and sit still in between.
 *
 * Skylight and Hearth both carry a balance as a small pill on a line the child is already
 * reading (H5 §2). Same here: the pill is sized to its content, the cash sits beside it, and
 * the cash-out button is at the far end of the same row. Roughly 80px, and the ~150 it gives
 * back go to the chore board above it.
 */
function FluentPointsBadge({
  points,
  cashText,
  streakDays,
  accent,
  pendingRedemptionPoints,
  cashOutOptions,
  onRequestRedemption,
}: PointsBadgeProps) {
  const { TYPO, PRIMARY_TEXT, SECONDARY_TEXT, NUMERAL_TEXT, full } = useTypo();
  return (
    <div
      style={card({
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: px(spacePx.sm),
        padding: px(spacePx.xs),
      })}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: px(spacePx.xs),
          background: accent.solid,
          borderRadius: radius.pill,
          padding: `${px(spacePx.xxs)} ${px(spacePx.sm)}`,
        }}
      >
        <Glyph name="star" sizePx={iconPx.sm} tone={accent.onSolid} />
        <span style={{ ...numeralText(NUMERAL_TEXT, accent.onSolid), fontWeight: fontWeight.black }}>
          {String(points)}
        </span>
        <span style={onSolid(accent)}>{nounFor(points, NOUN.point)}</span>
      </span>
      {cashText === null ? null : <span style={text(PRIMARY_TEXT)}>{cashText}</span>}
      {streakDays === null ? null : (
        <span style={text(SECONDARY_TEXT, { muted: true })}>{`${String(streakDays)} ${STREAK_WORD}`}</span>
      )}
      {pendingRedemptionPoints === null ? null : (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: px(spacePx.xxs) }}>
          <Glyph name="gift" sizePx={iconPx.xs} tone={colour.ink} />
          <span style={text(SECONDARY_TEXT)}>
            {`${counted(pendingRedemptionPoints, NOUN.point)} ${WAITING_WORD}`}
          </span>
        </span>
      )}
      {/*
        Pushed to the far end: the balance is the subject of this row, the actions are not.
        One button per amount she can ask for, cheapest first, "all of it" last — and an
        amount she cannot afford is ABSENT rather than greyed, which is this codebase's rule
        for guardrails: the wrong thing is not offered rather than offered and refused.

        The word stays on the FIRST button only. This reader can read it, and repeating
        "cash out" four times spends the row's width on the one thing she already knows.
      */}
      {onRequestRedemption === null || cashOutOptions.length === 0 ? null : (
        <span
          style={{
            display: 'inline-flex',
            flexWrap: 'wrap',
            marginLeft: 'auto',
            gap: px(spacePx.tapGap),
          }}
        >
          {cashOutOptions.map((option, i) => (
            <Tappable
              key={option.label}
              enabled
              onTap={() => {
                onRequestRedemption(option.points);
              }}
              style={tapTarget(TYPO.minTapPx, {
                padding: `${px(spacePx.xxs)} ${px(spacePx.sm)}`,
                gap: px(spacePx.xxs),
                background: colour.surface,
                border: `${px(strokePx.medium)} solid ${accent.solid}`,
                borderRadius: radius.pill,
              })}
            >
              <Glyph name="gift" sizePx={iconPx.sm} tone={accent.solid} />
              {i === 0 ? <span style={text(SECONDARY_TEXT)}>{CASH_OUT_WORD}</span> : null}
              <span style={numeralText(SECONDARY_TEXT, colour.ink)}>{option.label}</span>
            </Tappable>
          ))}
        </span>
      )}
    </div>
  );
}

/**
 * ONE ROW OF A DAY AGENDA — time on the left, title on the right.
 *
 * This used to be a card with an icon, a wrapped title and the time underneath. Inside the
 * flat "next four events" list that was right; inside a four-day agenda it is not, because
 * four day headings plus eight 88px cards is 824px in a pane that has 420.
 *
 * The time sits in a FIXED-WIDTH column with tabular figures, which is the whole reason a
 * Google-style day view is scannable: every time starts at the same x, so the eye runs down
 * one edge instead of hunting. `4:25 PM` and `All day` share that column.
 *
 * The icon is gone, and it cost nothing to lose. Home Assistant supplies no category, so all
 * 48 synced events resolved the same `ico-calendar` fallback — 56px of width spent on a glyph
 * that told you an event was an event. It comes back the day the icons mean something.
 */
function FluentEventCard({ title, emoji, icon, timeText, accent, sourceStripe }: EventCardProps) {
  const { TYPO, PRIMARY_TEXT, SECONDARY_TEXT, NUMERAL_TEXT, full } = useTypo();
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: px(spacePx.sm),
        height: px(layoutPx.agendaRowHeight),
        paddingLeft: px(spacePx.xs),
        paddingRight: px(spacePx.xs),
        borderRadius: radius.md,
        // A household event has no owner and stays on the page's own ground; a per-child one
        // fills with that child's tint. The tint path goes live the day a per-child calendar
        // exists upstream.
        background: accent === null ? 'transparent' : accent.tint,
        // Whose it is beats where it came from; a household event gets its CALENDAR's colour
        // rather than the plain card border, which is what every event used to get.
        borderLeft: `${px(strokePx.focus)} solid ${accent === null ? sourceStripe : accent.solid}`,
        boxSizing: 'border-box',
        minWidth: 0,
      }}
    >
      <span
        style={{
          ...numeralText(SECONDARY_TEXT, colour.inkMuted),
          width: px(layoutPx.agendaTimeWidth),
          flex: '0 0 auto',
          textAlign: 'right',
        }}
      >
        {timeText}
      </span>
      {/*
        This row carried no picture at all until 2026-09-09 — a fluent reader has the title, so
        an icon was width spent on nothing. The emoji is different: this is the IDLE board, read
        from the kitchen by whoever is passing, and the two children who cannot read the title
        are looking at the same row. It goes after the time and before the title, so a long
        title still gets everything that is left.

        `EmojiOrIcon` falls back to the drawn icon, which is why `icon` is now destructured: a
        row with no emoji gets the category picture rather than nothing.
      */}
      <EmojiOrIcon emoji={emoji} asset={icon} sizePx={iconPx.xs} />
      <span style={{ ...text(fontSizePx.body), flex: 1, minWidth: 0 }}>{full(title)}</span>
    </div>
  );
}

/**
 * Same wrap as the event card, and for the same reason: on a wall two columns wide,
 * "Child A's birthday" truncated to "Child A's birt…" and the date under it to "Wed, Ju…",
 * so a card whose entire job is "whose, and how far away" answered neither question.
 */
function FluentCountdownCard({ emoji, labelFull, icon, sleepsRemaining, targetDateText }: CountdownCardProps) {
  const { TYPO, PRIMARY_TEXT, SECONDARY_TEXT, NUMERAL_TEXT, full } = useTypo();
  return (
    <div
      style={card({
        display: 'flex',
        alignItems: 'center',
        gap: px(spacePx.xs),
        padding: px(spacePx.xs),
        height: px(layoutPx.listCardHeight),
        overflow: 'hidden',
      })}
    >
      <EmojiOrIcon emoji={emoji} asset={icon} sizePx={iconPx.sm} />
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
        {/* ONE line of title, not two. The comment below already said the sleeps count must
            not be the half that clips, and measuring the card on the panel on 2026-08-30
            showed it was: two title lines plus the meta line come to 91px inside an 84px
            content box, so the last line was sliced 7px short of the baseline. A clamped
            title ends in an ellipsis, which is a truncation the reader can SEE; a sliced
            line just looks broken. */}
        <span style={text(PRIMARY_TEXT, { wrap: true, lines: 1 })}>{full(labelFull)}</span>
        {/* ONE line. Two lines of title plus two of meta cannot fit a fixed-height card, and
            the sleeps count is the half a child reads — it must not be the half that clips. */}
        <span style={text(SECONDARY_TEXT, { muted: true })}>
          {`${counted(sleepsRemaining, NOUN.sleep)} · ${targetDateText}`}
        </span>
      </span>
    </div>
  );
}

function FluentStatusPill({ tone, glyph, labelFull }: StatusPillProps) {
  const { TYPO, PRIMARY_TEXT, SECONDARY_TEXT, NUMERAL_TEXT, full } = useTypo();
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: px(spacePx.xs),
        padding: px(spacePx.xs),
        borderRadius: radius.pill,
        background: colour.surface,
        border: `${px(strokePx.medium)} solid ${freshnessColour[tone]}`,
      }}
    >
      <Glyph name={glyph} sizePx={iconPx.xs} tone={freshnessColour[tone]} />
      {/* No words (the header's choice while a leave-by banner is up): the glyph alone, centred. */}
      {labelFull === '' ? null : <span style={text(SECONDARY_TEXT)}>{full(labelFull)}</span>}
    </span>
  );
}

export const fluentRenderers: RendererSet = {
  Avatar: FluentAvatar,
  RoutineStep: FluentRoutineStep,
  ChoreCard: FluentChoreCard,
  PointsBadge: FluentPointsBadge,
  EventCard: FluentEventCard,
  CountdownCard: FluentCountdownCard,
  StatusPill: FluentStatusPill,
};
