/**
 * Grown-ups → Money: what a point is worth, what each child has, and where it came from
 * (the admin mockups, private notes, B-7).
 *
 * Three things, and the mock's arrangement of them is kept in spirit and moved in one respect.
 * The mock put the rate card down the left and the children above a short ledger on the right;
 * on this sheet (374px of height) three rows that each hold a 64px key leave the ledger about a
 * hundred pixels, which is two lines under a scroll fade. So the CHILDREN take the left column,
 * where their rows have the height they need, and the rate card sits over the ledger on the
 * right, which gives the ledger about two hundred.
 *
 * A child row is two controls and not one. Its face and words choose whose ledger is open; its
 * minus and plus move that child's balance by one point. Pressing a key also turns the ledger to
 * that child, after the server has answered, so the line the press made is the first thing an
 * adult sees beside the number that moved.
 *
 * Every press is one request with its OWN idempotency key (`newRequestId`), minted per tap: the
 * server pays a repeated key once, so a key reused across taps would make the second bonus
 * vanish. A minus at zero is drawn inert — the server would take a balance below zero without
 * complaint, which is exactly why the wall does not offer it.
 *
 * The PIN and its refusals are the pane's (ApprovalsView): this panel is handed what to call and
 * is told only whether it worked.
 */

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { HouseholdSettings, LedgerHistory } from '../../app/adminActions.ts';
import { useWall } from '../../app/wallContext.ts';
import { useWallLayout } from '../../app/layoutContext.ts';
import {
  childAccentForSlot,
  colour,
  controlShadow,
  cssTokens,
  fontSizePx,
  iconPx,
  radius,
  spacePx,
  strokePx,
} from '../../design/tokens.ts';
import { useBandTypography } from '../bands/registry.tsx';
import type { GlyphName } from '../contract.ts';
import { AccentFrame, AssetImage } from '../primitives/AssetImage.tsx';
import { Glyph } from '../primitives/Glyph.tsx';
import { ScrollColumn } from '../primitives/ScrollColumn.tsx';
import { Tappable } from '../primitives/Tappable.tsx';
import { card, numeralText, px, tapTarget, text } from '../primitives/style.ts';
import {
  LEDGER_EMPTY_WORDS,
  RATE_RULE_WORDS,
  ledgerHeading,
  ledgerLines,
  moneyRows,
  rateStep,
  rateWords,
  type MoneyRow,
} from '../logic/grownup.ts';
import { approvalRowHeightPx } from '../../app/adminActions.ts';

const RATE_TITLE_WORDS = 'What a point is worth';
const RATE_DOWN_WORDS = 'Less per point';
const RATE_UP_WORDS = 'More per point';
const LEDGER_READING_WORDS = 'Reading the ledger.';
const LEDGER_UNREADABLE_WORDS = 'Could not read the ledger. Leave and come back in.';
const NOBODY_EARNS_WORDS = 'Nobody earns points yet.';

export interface MoneyPanelProps {
  settings: HouseholdSettings;
  busy: boolean;
  onRate: (centsPerPoint: number) => void;
  /** One point up or down. Resolves true when the server took it; a refusal is the pane's to say. */
  onAdjust: (childId: string, delta: number) => Promise<boolean>;
  /** One child's ledger, or null when it could not be read (the pane has said why). */
  readLedger: (childId: string) => Promise<LedgerHistory | null>;
}

export function MoneyPanel({ settings, busy, onRate, onAdjust, readLedger }: MoneyPanelProps) {
  const { snapshot, clock } = useWall();
  const rows = moneyRows(snapshot);
  const earners = rows.filter((r) => r.ledger);

  // Whose ledger is open: the first child who earns, until somebody chooses.
  const [chosen, setChosen] = useState<string | null>(null);
  const selected = earners.find((r) => r.childId === chosen) ?? earners[0] ?? null;
  const selectedId = selected?.childId ?? null;

  // The ledger as last read, and for whom. A read for one child never lands on another's list.
  const [ledger, setLedger] = useState<{ childId: string; history: LedgerHistory | null } | null>(null);
  const [reads, setReads] = useState(0);
  useEffect(() => {
    if (selectedId === null) return;
    let live = true;
    void readLedger(selectedId).then((history) => {
      if (live) setLedger({ childId: selectedId, history });
    });
    return () => {
      live = false;
    };
    // `readLedger` is a new function on every render of the pane; the child and the count of
    // presses are what this read depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, reads]);

  function press(row: MoneyRow, delta: number): void {
    void onAdjust(row.childId, delta).then((took) => {
      if (!took) return;
      setChosen(row.childId);
      setReads((n) => n + 1);
    });
  }

  const current = ledger !== null && ledger.childId === selectedId ? ledger : null;
  const lines = current === null || current.history === null ? [] : ledgerLines(current.history, snapshot.chores, clock.localDate);
  const ledgerWords =
    selected === null
      ? NOBODY_EARNS_WORDS
      : current === null
        ? LEDGER_READING_WORDS
        : current.history === null
          ? LEDGER_UNREADABLE_WORDS
          : lines.length === 0
            ? LEDGER_EMPTY_WORDS
            : null;

  return (
    <div data-grownup-money="" style={{ display: 'flex', gap: px(spacePx.tapGap), flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: px(spacePx.xs), flex: '1 1 0', minWidth: 0 }}>
        {rows.map((row) => (
          <ChildRow
            key={row.childId}
            row={row}
            selected={row.childId === selectedId}
            busy={busy}
            onChoose={() => {
              setChosen(row.childId);
            }}
            onPress={(delta) => {
              press(row, delta);
            }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: px(spacePx.tapGap), flex: '1 1 0', minWidth: 0 }}>
        <RateCard centsPerPoint={settings.centsPerPoint} busy={busy} onRate={onRate} />
        <div
          data-grownup-ledger=""
          style={card({
            display: 'flex',
            flexDirection: 'column',
            gap: px(spacePx.xs),
            padding: px(spacePx.sm),
            flex: 1,
            minHeight: 0,
          })}
        >
          <LedgerBody heading={selected === null ? null : ledgerHeading(selected.name)} words={ledgerWords} lines={lines} />
        </div>
      </div>
    </div>
  );
}

function LedgerBody({
  heading,
  words,
  lines,
}: {
  heading: string | null;
  words: string | null;
  lines: ReturnType<typeof ledgerLines>;
}) {
  const TYPO = useBandTypography();
  const PRIMARY_TEXT = TYPO.primaryTextPx ?? fontSizePx.small;
  const SECONDARY_TEXT = TYPO.secondaryTextPx ?? fontSizePx.meta;
  return (
    <>
      {heading === null ? null : <span style={{ ...text(SECONDARY_TEXT, { muted: true }), flex: '0 0 auto' }}>{heading}</span>}
      {words !== null ? (
        <span style={text(SECONDARY_TEXT, { muted: true, wrap: true, lines: 3 })}>{words}</span>
      ) : (
        <ScrollColumn gapPx={spacePx.xxs} ground={colour.surface} style={{ flex: 1, minHeight: 0 }}>
          {lines.map((line) => (
            <div
              key={line.id}
              style={{ display: 'flex', alignItems: 'baseline', gap: px(spacePx.sm), minWidth: 0, flex: '0 0 auto' }}
            >
              <span style={{ ...text(SECONDARY_TEXT, { muted: true }), flex: '0 0 auto', minWidth: px(iconPx.md) }}>
                {line.day}
              </span>
              <span style={{ ...text(PRIMARY_TEXT), flex: 1, minWidth: 0 }}>{line.words}</span>
              <span style={{ ...numeralText(PRIMARY_TEXT, colour.ink), flex: '0 0 auto' }}>{line.delta}</span>
            </div>
          ))}
        </ScrollColumn>
      )}
    </>
  );
}

/** One child: who, what she has, and the two keys — or the stickers sentence and no keys. */
function ChildRow({
  row,
  selected,
  busy,
  onChoose,
  onPress,
}: {
  row: MoneyRow;
  selected: boolean;
  busy: boolean;
  onChoose: () => void;
  onPress: (delta: number) => void;
}) {
  const TYPO = useBandTypography();
  const { layout } = useWallLayout();
  const PRIMARY_TEXT = TYPO.primaryTextPx ?? fontSizePx.small;
  const SECONDARY_TEXT = TYPO.secondaryTextPx ?? fontSizePx.meta;
  const accent = childAccentForSlot(row.sortOrder);
  return (
    <div
      data-money-child={row.childId}
      style={{
        display: 'flex',
        alignItems: 'center',
        // The tap gutter: the name and face are a key too (they open her ledger).
        gap: px(spacePx.tapGap),
        height: px(approvalRowHeightPx(TYPO.minTapPx)),
        padding: `${px(spacePx.xxs)} ${px(spacePx.xs)}`,
        background: colour.surface,
        // The open ledger's row wears the strong edge; whose row it is rides on the left edge and
        // the face, the same two channels as every row in the portal.
        border: `${px(strokePx.medium)} solid ${selected ? colour.ink : colour.border}`,
        borderLeftWidth: px(strokePx.focus),
        borderLeftColor: accent.solid,
        borderRadius: radius.md,
        boxSizing: 'border-box',
        flex: '0 0 auto',
        overflow: 'hidden',
      }}
    >
      <Tappable
        enabled={row.ledger && !selected}
        onTap={onChoose}
        style={tapTarget(TYPO.minTapPx, {
          flex: 1,
          minWidth: 0,
          height: '100%',
          justifyContent: 'flex-start',
          gap: px(spacePx.sm),
          padding: px(spacePx.none),
        })}
      >
        <AccentFrame accent={accent} sizePx={iconPx.md} selected={selected} shape={layout.faceFrame}>
          <AssetImage asset={row.avatar} sizePx={iconPx.md} />
        </AccentFrame>
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
          <span style={text(PRIMARY_TEXT)}>{row.name}</span>
          <span style={text(SECONDARY_TEXT, { muted: true, wrap: true, lines: 2 })}>{row.line}</span>
        </span>
      </Tappable>
      {row.ledger ? (
        <span style={{ display: 'flex', gap: px(spacePx.tapGap), flex: '0 0 auto' }}>
          <StepKey
            glyph="minus"
            label={`One point less for ${row.name}`}
            live={row.canTakeOff}
            busy={busy}
            onTap={() => {
              onPress(-1);
            }}
          />
          <StepKey
            glyph="plus"
            label={`One more point for ${row.name}`}
            live={row.canAdd}
            busy={busy}
            onTap={() => {
              onPress(1);
            }}
          />
        </span>
      ) : null}
    </div>
  );
}

/** The rate: what a point is worth, a worked example, the two keys, and what a change does. */
function RateCard({ centsPerPoint, busy, onRate }: { centsPerPoint: number; busy: boolean; onRate: (cents: number) => void }) {
  const TYPO = useBandTypography();
  const SECONDARY_TEXT = TYPO.secondaryTextPx ?? fontSizePx.meta;
  const words = rateWords(centsPerPoint);
  const step = rateStep(centsPerPoint);
  return (
    <div
      data-grownup-rate=""
      style={card({
        display: 'flex',
        flexDirection: 'column',
        gap: px(spacePx.xs),
        padding: px(spacePx.md),
        flex: '0 0 auto',
      })}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: px(spacePx.sm), minWidth: 0 }}>
        <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          <span style={text(SECONDARY_TEXT, { muted: true })}>{RATE_TITLE_WORDS}</span>
          <span style={numeralText(TYPO.numeralTextPx ?? fontSizePx.bodyLarge, colour.ink)}>{words.head}</span>
          <span style={text(SECONDARY_TEXT, { muted: true })}>{words.example}</span>
        </span>
        <span style={{ display: 'flex', gap: px(spacePx.tapGap), flex: '0 0 auto' }}>
          <StepKey
            glyph="minus"
            label={RATE_DOWN_WORDS}
            live={step.down !== null}
            busy={busy}
            onTap={() => {
              if (step.down !== null) onRate(step.down);
            }}
          />
          <StepKey
            glyph="plus"
            label={RATE_UP_WORDS}
            live={step.up !== null}
            busy={busy}
            onTap={() => {
              if (step.up !== null) onRate(step.up);
            }}
          />
        </span>
      </span>
      <span style={text(SECONDARY_TEXT, { muted: true, wrap: true, lines: 2 })}>{RATE_RULE_WORDS}</span>
    </div>
  );
}

/**
 * A round key with a mark on it. At a rail it is drawn DIM and inert — an adult needs to see that
 * it will not answer, where a child's card never dims (Tappable). While a request is away it is
 * inert and NOT dimmed, so a press does not make every key on the screen flicker. It is the
 * portal's one round key: the minus and plus here, on a chore's worth and on the leave-by
 * minutes; the earlier key that moves a turn on a chore row; and the forward and back keys into
 * and out of Settings → Leave-by alerts, which pass `busy={false}` because stepping between
 * views is not a request.
 */
export function StepKey({
  glyph,
  label,
  live,
  busy,
  onTap,
}: {
  glyph: GlyphName;
  label: string;
  live: boolean;
  busy: boolean;
  onTap: () => void;
}) {
  const TYPO = useBandTypography();
  const style: CSSProperties = tapTarget(TYPO.minTapPx, {
    width: px(TYPO.minTapPx),
    height: px(TYPO.minTapPx),
    padding: px(spacePx.none),
    flex: '0 0 auto',
    justifyContent: 'center',
    background: colour.surface,
    border: `${px(strokePx.medium)} solid ${colour.borderStrong}`,
    borderRadius: radius.pill,
    boxShadow: controlShadow,
    ...(live ? {} : { opacity: cssTokens['--o-disabled'] }),
  });
  return (
    <Tappable enabled={live && !busy} onTap={onTap} label={label} data={{ 'data-step-key': glyph }} style={style}>
      <Glyph name={glyph} sizePx={iconPx.xs} tone={colour.ink} />
    </Tappable>
  );
}
