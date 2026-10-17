/**
 * Unit H — the grown-up portal's frame: where the sections are, the way out, and the sheet a
 * section is drawn on.
 *
 * Past the PIN an adult is not navigating by the children's faces, so the portal draws no rail,
 * no wall header, no leave-by banner and no picture behind it — the sections are the navigation,
 * and the wall's own chrome would be a second way round the same screen. Two forms, chosen by
 * the theme (`WallLayout.grownupNav`, logic/theme.ts), both measured in `grownupGeometry`:
 *
 *   - **tabs** (felt) — one row of section pills across the top IS the header. The selected one
 *     is solid ink. Words come off in a fixed order when the row cannot hold them all
 *     (`tabWordsFit`): Home first, then every tab but yours, then Leave's, then yours.
 *   - **column** (gallery, storybook) — the sections stand in a full-height column flush to the
 *     left edge, drawn exactly the way that theme draws the children's rail (the plinth's ink
 *     frame, the spine's bookmark), so the portal is the same room with different people in it.
 *     A header row beside it carries the title, the time, the stale label and Leave.
 *
 * LEAVE IS ALWAYS IN SIGHT, and it is in the tab row or the header rather than the column:
 * seven keys down the column would need 7x64 + 6x16 = 544px of a 540px wall. Leaving forgets the
 * PIN (app/grownupVisit.ts) — the door is where the visit ends, not a section of it.
 *
 * THE STALE LABEL STAYS. A wall showing yesterday must say so on whatever screen is up; it is the
 * one thing in the strip that never shrinks, and the tabs give way around it.
 *
 * THE STRIP. What just happened, or what went wrong, stands under the section on the same sheet
 * (logic/grownup.ts §5) — never over a row, because a strip over the last row hides the very
 * decision it may be reporting on. The whole strip is the control that closes it: a refusal
 * stays until somebody taps it or moves on, where the old screens put "Not now" in a corner for a
 * moment and an adult who looked away never knew the tap had failed. It carries no Undo: undoing
 * a decision is a second pass, not this one.
 *
 * `data-grownup`, `data-grownup-nav`, `data-grownup-leave` and `data-grownup-strip` are for
 * `tools/panel-audit.mjs` and the probes, which walk the sections by these marks.
 */

import { useEffect, type CSSProperties, type ReactNode } from 'react';
import {
  colour,
  controlShadow,
  font,
  fontSizePx,
  fontWeight,
  iconPx,
  radius,
  spacePx,
  strokePx,
  tapPx,
} from '../../design/tokens.ts';
import { useWall } from '../../app/wallContext.ts';
import { useWallLayout } from '../../app/layoutContext.ts';
import { useBandTypography } from '../bands/registry.tsx';
import { Glyph } from '../primitives/Glyph.tsx';
import { Tappable } from '../primitives/Tappable.tsx';
import { useTextRoom } from '../primitives/useTextRoom.ts';
import { card, numeralText, plateStyle, px, tapColumn, tapTarget, text } from '../primitives/style.ts';
import { clientTimeText } from '../logic/clock.ts';
import { freshnessStatus, type FreshnessStatus } from '../logic/freshness.ts';
import { headerPlate } from '../logic/plate.ts';
import { railInsetPx, tileFramePx } from '../logic/railNames.ts';
import { grownupGeometry, type DoorForm } from '../logic/theme.ts';
import {
  LEAVE_GLYPH,
  LEAVE_WORD,
  SECTION_GLYPHS,
  SECTION_TITLES,
  SECTION_WORDS,
  SHEET_PAD_PX,
  TAB_GAP_PX,
  TAB_GLYPH_GAP_PX,
  TAB_GLYPH_PX,
  TAB_PAD_X_PX,
  TAB_TEXT_PX,
  TOAST_HEIGHT_PX,
  grownupSectionsFor,
  headerClockFit,
  tabWidthPx,
  tabWordsFit,
  type GrownupSection,
  type Toast,
} from '../logic/grownup.ts';

export interface GrownupChromeProps {
  readonly section: GrownupSection;
  readonly onSection: (section: GrownupSection) => void;
  /** Out of the portal, which forgets the PIN. */
  readonly onLeave: () => void;
  /** How many decisions wait: the Waiting key's badge, absent at zero. */
  readonly waiting: number;
  /** What just happened, or what went wrong; null draws no strip and costs no row. */
  readonly strip: Toast | null;
  readonly onStripClose: () => void;
  /** The section, drawn on the sheet. */
  readonly children: ReactNode;
}

type ColumnForm = 'plinth' | 'spine';

/** The spine's right edge, as ChildBar draws it — the page's gutter, drawn. */
const SPINE_EDGE_PX = strokePx.focus;

export function GrownupChrome({ section, onSection, onLeave, waiting, strip, onStripClose, children }: GrownupChromeProps) {
  const { layout } = useWallLayout();
  const { clock, snapshot } = useWall();
  const geo = grownupGeometry(layout);
  const status = freshnessStatus(snapshot.freshness, clock.localDate, snapshot.requestedLocalDate);
  // The nav draws only this household's sections. A feature turned off mid-visit takes its
  // screen with it: the visit goes Home, once, on the change — never on every render.
  const sections = grownupSectionsFor(snapshot.household);
  const hidden = !sections.includes(section);
  useEffect(() => {
    if (hidden) onSection('home');
  }, [hidden, onSection]);

  const sheet = (
    <Sheet heightPx={geo.body.height} strip={strip} onStripClose={onStripClose}>
      {children}
    </Sheet>
  );

  if (geo.nav === 'tabs') {
    return (
      <div
        data-grownup="tabs"
        data-grownup-section={section}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: px(geo.gutterPx),
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          padding: `${px(geo.pad.top)} ${px(geo.pad.right)} ${px(geo.pad.bottom)} ${px(geo.pad.left)}`,
          boxSizing: 'border-box',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <TabRow
          sections={sections}
          section={section}
          onSection={onSection}
          onLeave={onLeave}
          waiting={waiting}
          status={status}
          heightPx={geo.navPx}
        />
        {sheet}
      </div>
    );
  }

  const form: ColumnForm = layout.rail === 'spine' ? 'spine' : 'plinth';
  return (
    <div
      data-grownup="column"
      data-grownup-section={section}
      style={{ display: 'flex', flexDirection: 'row', flex: 1, minHeight: 0, minWidth: 0, position: 'relative' }}
    >
      <SectionColumn form={form} sections={sections} section={section} onSection={onSection} waiting={waiting} widthPx={geo.navPx} />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: px(geo.gutterPx),
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          padding: `${px(geo.pad.top)} ${px(geo.pad.right)} ${px(geo.pad.bottom)} ${px(geo.pad.left)}`,
          boxSizing: 'border-box',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <GrownupHeader section={section} onLeave={onLeave} status={status} padTop={geo.pad.top} heightPx={geo.headerPx} />
        {sheet}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Felt: the tab row
// ---------------------------------------------------------------------------

/**
 * Pills, measured. Every pill is the tap floor at least, and a worded one is its word plus its
 * chrome (`tabWidthPx`) — so the row's arithmetic in `tabWordsFit` is the row's real width, and a
 * word never arrives cut. Until the first reading (it lands before paint) every pill has its word.
 */
function TabRow({
  sections,
  section,
  onSection,
  onLeave,
  waiting,
  status,
  heightPx,
}: {
  sections: readonly GrownupSection[];
  section: GrownupSection;
  onSection: (section: GrownupSection) => void;
  onLeave: () => void;
  waiting: number;
  status: FreshnessStatus;
  heightPx: number;
}) {
  const { ref, room } = useTextRoom<HTMLDivElement>(fontWeight.bold);
  const chipWords = status.tone === 'ok' ? null : status.words.short;
  const fit = room === null ? null : tabWordsFit(section, room.roomPx, room.measure, chipWords, sections);
  const widthFor = (words: string | null): CSSProperties =>
    room === null ? {} : { width: px(tabWidthPx(words === null ? null : room.measure(words, TAB_TEXT_PX))) };
  const leaveWorded = fit === null || fit.leaveWorded;

  return (
    <nav
      ref={ref}
      data-grownup-nav-row=""
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: px(TAB_GAP_PX),
        height: px(heightPx),
        flex: '0 0 auto',
        minWidth: 0,
      }}
    >
      {sections.map((s) => {
        const on = s === section;
        const worded = fit === null || fit.worded.has(s);
        return (
          <Tappable
            key={s}
            enabled={!on}
            onTap={() => {
              onSection(s);
            }}
            data={{ 'data-grownup-nav': s }}
            label={worded ? undefined : SECTION_WORDS[s]}
            style={tabStyle(on ? 'on' : 'off', widthFor(worded ? SECTION_WORDS[s] : null))}
          >
            <Glyph name={SECTION_GLYPHS[s]} sizePx={TAB_GLYPH_PX} tone={on ? colour.inkInverse : colour.ink} />
            {worded ? <TabWord words={SECTION_WORDS[s]} ink={on ? colour.inkInverse : colour.ink} /> : null}
            {s === 'waiting' && waiting > 0 ? <Badge count={waiting} /> : null}
          </Tappable>
        );
      })}
      {chipWords === null ? null : (
        <span
          data-grownup-stale=""
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: px(TAB_GLYPH_GAP_PX),
            flex: '0 0 auto',
            ...widthFor(chipWords),
            height: px(iconPx.md),
            marginLeft: 'auto',
            padding: `0 ${px(TAB_PAD_X_PX - strokePx.min)}`,
            background: colour.surfaceSunken,
            border: `${px(strokePx.min)} solid ${colour.borderStrong}`,
            borderRadius: radius.md,
            boxSizing: 'border-box',
          }}
        >
          <Glyph name="alert" sizePx={TAB_GLYPH_PX} tone={colour.ink} />
          <TabWord words={chipWords} ink={colour.ink} />
        </span>
      )}
      <Tappable
        enabled
        onTap={onLeave}
        data={{ 'data-grownup-leave': '' }}
        label={leaveWorded ? undefined : LEAVE_WORD}
        style={tabStyle('leave', {
          ...widthFor(leaveWorded ? LEAVE_WORD : null),
          ...(chipWords === null ? { marginLeft: 'auto' } : {}),
        })}
      >
        <Glyph name={LEAVE_GLYPH} sizePx={TAB_GLYPH_PX} tone={colour.ink} />
        {leaveWorded ? <TabWord words={LEAVE_WORD} ink={colour.ink} /> : null}
      </Tappable>
    </nav>
  );
}

/**
 * A pill. The chosen section is SOLID INK with light words — the one pairing on the wall that is
 * legal at any size — and is not a control: you are already there. Leave wears the strong edge,
 * because it is the one key in the row that goes somewhere else entirely.
 */
function tabStyle(kind: 'on' | 'off' | 'leave', extra: CSSProperties): CSSProperties {
  return tapTarget(tapPx.min, {
    position: 'relative',
    flex: '0 0 auto',
    height: px(tapPx.min),
    gap: px(TAB_GLYPH_GAP_PX),
    padding: `0 ${px(TAB_PAD_X_PX - strokePx.min)}`,
    background: kind === 'on' ? colour.ink : colour.surface,
    border: `${px(strokePx.min)} solid ${
      kind === 'on' ? colour.ink : kind === 'leave' ? colour.borderStrong : colour.border
    }`,
    borderRadius: radius.pill,
    // The key's ledge, on the keys that ARE keys. The chosen tab is not a control any more, so it
    // sits flat — the same difference a pressed key shows.
    ...(kind === 'on' ? {} : { boxShadow: controlShadow }),
    ...extra,
  });
}

/** A tab's word: one line, never an ellipsis — the pill was measured to hold it. */
function TabWord({ words, ink }: { words: string; ink: string }) {
  return <span style={{ ...text(TAB_TEXT_PX), color: ink, overflow: 'visible', textOverflow: 'clip' }}>{words}</span>;
}

// ---------------------------------------------------------------------------
// Gallery and storybook: the section column and the header beside it
// ---------------------------------------------------------------------------

/**
 * The column, drawn the way the theme draws its rail (ChildBar `railStyle`): the plinth sunken
 * with a line beside it, the spine dark with light words. Six keys of the tap floor and five
 * gaps are 464, in 540 less the wall's own margin above and below.
 */
function SectionColumn({
  form,
  sections,
  section,
  onSection,
  waiting,
  widthPx,
}: {
  form: ColumnForm;
  sections: readonly GrownupSection[];
  section: GrownupSection;
  onSection: (section: GrownupSection) => void;
  waiting: number;
  widthPx: number;
}) {
  const inset = railInsetPx(form);
  return (
    <nav
      data-grownup-column={form}
      style={{
        ...tapColumn,
        position: 'relative',
        zIndex: 1,
        justifyContent: 'flex-start',
        alignItems: 'stretch',
        flex: '0 0 auto',
        width: px(widthPx),
        minWidth: 0,
        height: '100%',
        boxSizing: 'border-box',
        padding: `${px(spacePx.lg)} ${px(inset)}`,
        ...(form === 'plinth'
          ? { background: colour.surfaceSunken, borderRight: `${px(strokePx.min)} solid ${colour.border}` }
          : { background: colour.surfaceInverse, borderRight: `${px(SPINE_EDGE_PX)} solid ${colour.borderStrong}` }),
      }}
    >
      {sections.map((s) => {
        const on = s === section;
        // Light on the dark spine; the bookmark is the page's own paper, so it takes the page's ink.
        const ink = form === 'spine' && !on ? colour.inkInverse : colour.ink;
        return (
          <Tappable
            key={s}
            enabled={!on}
            onTap={() => {
              onSection(s);
            }}
            data={{ 'data-grownup-nav': s }}
            style={columnKeyStyle(form, on)}
          >
            <Glyph name={SECTION_GLYPHS[s]} sizePx={TAB_GLYPH_PX} tone={ink} />
            <span style={{ ...text(TAB_TEXT_PX), color: ink, maxWidth: '100%' }}>{SECTION_WORDS[s]}</span>
            {s === 'waiting' && waiting > 0 ? <Badge count={waiting} /> : null}
          </Tappable>
        );
      })}
    </nav>
  );
}

/**
 * One key in the column, framed the way the rail frames a face (ChildBar `tileStyle`): on the
 * plinth an ink frame and the mat's white round the section you are in, an invisible frame round
 * the rest; on the spine the BOOKMARK — the page's paper, its outer corners rounded and its inner
 * edge run across the spine's edge into the page. Every key keeps the same box whichever is
 * chosen, so choosing one never moves another. Shorthands only: a key that toggles between a
 * longhand and none would leave React a stale side behind.
 */
function columnKeyStyle(form: ColumnForm, on: boolean): CSSProperties {
  const pad = spacePx.xxs;
  const overhang = form === 'spine' && on ? railInsetPx(form) + SPINE_EDGE_PX : 0;
  const shape: CSSProperties =
    form === 'plinth'
      ? {
          border: `${px(tileFramePx(form))} solid ${on ? colour.ink : 'transparent'}`,
          borderRadius: radius.sm,
          background: on ? colour.surface : 'transparent',
        }
      : on
        ? { background: colour.bg, borderRadius: `${radius.lg} 0 0 ${radius.lg}` }
        : {};
  return tapTarget(tapPx.min, {
    position: 'relative',
    zIndex: on ? 1 : 0,
    flexDirection: 'column',
    flex: '0 0 auto',
    height: px(tapPx.min),
    gap: px(TAB_GLYPH_GAP_PX),
    padding: `${px(pad)} ${px(pad + overhang)} ${px(pad)} ${px(pad)}`,
    margin: `0 ${px(-overhang)} 0 0`,
    textAlign: 'center',
    ...shape,
  });
}

/**
 * The header beside the column: what this screen is, the time, the stale label, and Leave. It is
 * the theme's header plate — storybook's hangs from the top of the glass like its running head
 * does on every other screen — so the portal keeps the wall's card language.
 */
function GrownupHeader({
  section,
  onLeave,
  status,
  padTop,
  heightPx,
}: {
  section: GrownupSection;
  onLeave: () => void;
  status: FreshnessStatus;
  padTop: number;
  heightPx: number;
}) {
  const { layout } = useWallLayout();
  const { clock } = useWall();
  const { ref, room } = useTextRoom<HTMLSpanElement>(fontWeight.bold);
  const timeText = clientTimeText(clock.nowMs);
  const fit =
    room === null
      ? { words: timeText, sizePx: fontSizePx.small }
      : headerClockFit(clock.localDate, timeText, room.roomPx, room.measure);
  const head = headerPlate(layout.header, padTop);
  const hang: CSSProperties =
    head.hangPx === 0
      ? {}
      : {
          marginTop: px(-head.hangPx),
          height: px(heightPx + head.hangPx),
          paddingTop: px(spacePx.xs + head.hangPx),
          borderTop: 'none',
          borderTopLeftRadius: 0,
          borderTopRightRadius: 0,
        };
  return (
    <header
      data-header={layout.header}
      data-grownup-header=""
      style={plateStyle(head.plate, {
        display: 'flex',
        alignItems: 'center',
        gap: px(spacePx.tapGap),
        padding: px(spacePx.xs),
        paddingLeft: px(spacePx.md),
        height: px(heightPx),
        boxSizing: 'border-box',
        flex: '0 0 auto',
        position: 'relative',
        zIndex: 1,
        borderRadius: radius.lg,
        ...hang,
      })}
    >
      <span style={{ ...text(fontSizePx.bodyLarge), fontFamily: font.display, flex: '0 0 auto' }}>
        {SECTION_TITLES[section]}
      </span>
      {/* Its width is the room and never its words: grown from nothing, allowed to shrink to nothing. */}
      <span
        ref={ref}
        data-grownup-clock=""
        style={{ ...text(fit?.sizePx ?? fontSizePx.small, { muted: true }), flex: '1 1 0', minWidth: 0, textAlign: 'right' }}
      >
        {fit?.words ?? ''}
      </span>
      {status.tone === 'ok' ? null : (
        <span
          data-grownup-stale=""
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: px(spacePx.xs),
            height: px(iconPx.md),
            paddingLeft: px(spacePx.sm),
            paddingRight: px(spacePx.sm),
            background: colour.surfaceSunken,
            border: `${px(strokePx.min)} solid ${colour.borderStrong}`,
            borderRadius: radius.md,
            boxSizing: 'border-box',
            flex: '0 0 auto',
          }}
        >
          <Glyph name="alert" sizePx={iconPx.sm} tone={colour.ink} />
          <span style={text(fontSizePx.small)}>{status.words.short}</span>
        </span>
      )}
      {/*
        Hit area outside, CHIP inside, as the wall's own header doors are: the target is the tap
        floor and the bar's content is 48, so the reach grows and the drawing does not.
      */}
      <Tappable
        enabled
        onTap={onLeave}
        data={{ 'data-grownup-leave': '' }}
        style={tapTarget(tapPx.min, {
          height: px(tapPx.min),
          padding: 0,
          flex: '0 0 auto',
          background: 'transparent',
          border: 'none',
        })}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: px(spacePx.xs),
            height: px(iconPx.md),
            paddingLeft: px(spacePx.sm),
            paddingRight: px(spacePx.md),
            background: colour.surface,
            border: `${px(strokePx.medium)} solid ${colour.borderStrong}`,
            ...leaveChipShape(layout.doors),
            boxSizing: 'border-box',
          }}
        >
          <Glyph name={LEAVE_GLYPH} sizePx={iconPx.sm} tone={colour.ink} />
          <span style={text(TAB_TEXT_PX)}>{LEAVE_WORD}</span>
        </span>
      </Tappable>
    </header>
  );
}

/** Leave is a door, so it wears the theme's door: a sticker, a square key, a tab's soft corner. */
function leaveChipShape(form: DoorForm): CSSProperties {
  if (form === 'round') return { borderRadius: radius.pill };
  if (form === 'tab') return { borderRadius: radius.md };
  return { borderRadius: radius.sm };
}

// ---------------------------------------------------------------------------
// The sheet and its strip
// ---------------------------------------------------------------------------

/**
 * Every section draws on one card the height of the body, in every theme — so a list measures
 * the same wherever it is (`sheetInnerHeightPx`), and the strip is a row OF the sheet rather than
 * something laid over it.
 */
function Sheet({
  heightPx,
  strip,
  onStripClose,
  children,
}: {
  heightPx: number;
  strip: Toast | null;
  onStripClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      data-grownup-sheet=""
      style={card({
        display: 'flex',
        flexDirection: 'column',
        gap: px(spacePx.tapGap),
        height: px(heightPx),
        flex: '0 0 auto',
        minWidth: 0,
        padding: px(SHEET_PAD_PX),
        position: 'relative',
      })}
    >
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0, position: 'relative' }}>
        {children}
      </div>
      {strip === null ? null : <Strip toast={strip} onClose={onStripClose} />}
    </div>
  );
}

/**
 * One line of what happened, and the whole line is the control that closes it. A good outcome
 * goes by itself (its owner sets the timer); a refusal waits for a finger. The check and the
 * alert are the only two marks it wears — no ×, because the strip itself is the close.
 */
function Strip({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const TYPO = useBandTypography();
  const trouble = toast.tone === 'trouble';
  return (
    <Tappable
      enabled
      onTap={onClose}
      data={{ 'data-grownup-strip': toast.tone }}
      style={tapTarget(TOAST_HEIGHT_PX, {
        flex: '0 0 auto',
        height: px(TOAST_HEIGHT_PX),
        width: '100%',
        justifyContent: 'flex-start',
        gap: px(spacePx.sm),
        padding: `0 ${px(spacePx.md)}`,
        background: colour.surfaceSunken,
        border: `${px(strokePx.medium)} solid ${trouble ? colour.danger : colour.borderStrong}`,
        borderRadius: radius.md,
      })}
    >
      <Glyph name={trouble ? 'alert' : 'check'} sizePx={TYPO.secondaryIconPx} tone={colour.ink} />
      <span style={{ ...text(TYPO.primaryTextPx ?? fontSizePx.small, { wrap: true, lines: 2 }), flex: 1, minWidth: 0 }}>
        {toast.words}
      </span>
    </Tappable>
  );
}

/** How many things are waiting — the wall header's badge, the same mark here. Absent at zero. */
function Badge({ count }: { count: number }) {
  return (
    <span
      style={{
        ...numeralText(fontSizePx.meta, colour.inkInverse),
        position: 'absolute',
        top: 0,
        right: 0,
        minWidth: px(spacePx.md),
        textAlign: 'center',
        background: colour.danger,
        borderRadius: radius.pill,
        paddingLeft: px(spacePx.xxs),
        paddingRight: px(spacePx.xxs),
      }}
    >
      {String(count)}
    </span>
  );
}
