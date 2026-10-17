/**
 * Settings → Leave-by alerts, one tap in: the three numbers behind the alert.
 *
 * Asked for with the alert itself: *"think about a way to have an alarm or an alert that we
 * can turn on and off. I don't know if we always want it. We can try it out."* The switch is on
 * the Settings row this opens from, because on or off is the question asked most; it is never on
 * the banner — a banner a child can dismiss is a banner that is off by 7:20 every school morning.
 *
 * Each row is a name that never loses space, a numeral, and the portal's minus and plus
 * (`StepKey`). A lead time's keys go dim and inert at the server's rails (`leadStep`), because a
 * step past one is a 400 the household would read as a broken key; the school time wraps at
 * midnight and has no rail. Every write answers with the whole settings and the screen renders
 * the response, so a value the server refused cannot show here.
 *
 * What is NOT here: the days school runs, the categories that count, the label. Those are
 * file-authored defaults (`domain/departures`) — a household changes them once a year, if
 * ever, and a row for each is four more tap targets for a thing nobody taps. The one line that
 * says where they come from (`leavingSourcesLine`) sits under the sub-view's heading in
 * `SettingsPanel`: under the rows it had 12px of a 294px column in felt and was cut in half.
 */

import type { ReactNode } from 'react';
import type { DepartureRules } from '../../../../src/types.ts';
import type { DepartureRulesPatch } from '../../app/adminActions.ts';
import { approvalRowHeightPx } from '../../app/adminActions.ts';
import { colour, fontSizePx, fontWeight, radius, spacePx, strokePx } from '../../design/tokens.ts';
import { useBandTypography } from '../bands/registry.tsx';
import { ScrollColumn } from '../primitives/ScrollColumn.tsx';
import { numeralText, px, text } from '../primitives/style.ts';
import { StepKey } from './MoneyPanel.tsx';
import {
  LEAD_STEP_MINUTES,
  leadStep,
  localTimeText,
  stepLocalTime,
} from '../logic/departures.ts';

const READY_WORD = 'Get ready';
const TRAVEL_WORD = 'Drive';
const SCHOOL_WORD = 'School leaves at';
const MINUTES_WORD = 'min';

const LEAD_WORDS: Readonly<Record<'readyMinutes' | 'travelMinutes', { down: string; up: string }>> = {
  readyMinutes: { down: 'Less time to get ready', up: 'More time to get ready' },
  travelMinutes: { down: 'A shorter drive', up: 'A longer drive' },
};
const SCHOOL_EARLIER_WORDS = 'Leave for school earlier';
const SCHOOL_LATER_WORDS = 'Leave for school later';

export function LeavingPanel({
  rules,
  busy,
  onChange,
}: {
  rules: DepartureRules;
  busy: boolean;
  onChange: (patch: DepartureRulesPatch) => void;
}) {
  const TYPO = useBandTypography();
  const PRIMARY_TEXT = TYPO.primaryTextPx ?? fontSizePx.bodyLarge;
  const SECONDARY_TEXT = TYPO.secondaryTextPx ?? fontSizePx.small;
  const NUMERAL_TEXT = TYPO.numeralTextPx ?? fontSizePx.cardTitle;

  const row = (id: string, name: string, control: ReactNode, value: string, unit?: string) => (
    <div
      data-leaving-row={id}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: px(spacePx.sm),
        paddingLeft: px(spacePx.md),
        paddingRight: px(spacePx.xxs),
        height: px(approvalRowHeightPx(TYPO.minTapPx)),
        minWidth: 0,
        flex: '0 0 auto',
        overflow: 'hidden',
        // The portal's row grammar: the surface, an edge, no ledge.
        background: colour.surface,
        border: `${px(strokePx.medium)} solid ${colour.border}`,
        borderRadius: radius.md,
        boxSizing: 'border-box',
      }}
    >
      <span style={{ ...text(PRIMARY_TEXT), flex: 1, minWidth: 0 }}>{name}</span>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: px(spacePx.xxs), flex: '0 0 auto' }}>
        <span style={{ ...numeralText(NUMERAL_TEXT, colour.ink), fontWeight: fontWeight.black }}>{value}</span>
        {unit === undefined ? null : <span style={text(SECONDARY_TEXT, { muted: true })}>{unit}</span>}
      </span>
      <span style={{ display: 'flex', gap: px(spacePx.tapGap), flex: '0 0 auto' }}>{control}</span>
    </div>
  );

  const lead = (key: 'readyMinutes' | 'travelMinutes') => {
    const step = leadStep(rules[key]);
    return (
      <>
        <StepKey
          glyph="minus"
          label={LEAD_WORDS[key].down}
          live={step.down !== null}
          busy={busy}
          onTap={() => {
            if (step.down !== null) onChange({ [key]: step.down });
          }}
        />
        <StepKey
          glyph="plus"
          label={LEAD_WORDS[key].up}
          live={step.up !== null}
          busy={busy}
          onTap={() => {
            if (step.up !== null) onChange({ [key]: step.up });
          }}
        />
      </>
    );
  };

  return (
    <ScrollColumn gapPx={spacePx.tapGap} ground={colour.surface}>
      {row('ready', READY_WORD, lead('readyMinutes'), String(rules.readyMinutes), MINUTES_WORD)}
      {row('travel', TRAVEL_WORD, lead('travelMinutes'), String(rules.travelMinutes), MINUTES_WORD)}
      {row(
        'school',
        SCHOOL_WORD,
        <>
          <StepKey
            glyph="minus"
            label={SCHOOL_EARLIER_WORDS}
            live
            busy={busy}
            onTap={() => {
              onChange({ schoolLeaveAt: stepLocalTime(rules.school.leaveAt, -LEAD_STEP_MINUTES) });
            }}
          />
          <StepKey
            glyph="plus"
            label={SCHOOL_LATER_WORDS}
            live
            busy={busy}
            onTap={() => {
              onChange({ schoolLeaveAt: stepLocalTime(rules.school.leaveAt, LEAD_STEP_MINUTES) });
            }}
          />
        </>,
        localTimeText(rules.school.leaveAt),
      )}
    </ScrollColumn>
  );
}
