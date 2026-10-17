/**
 * Grown-ups → Settings: the wall itself — how it looks, whether it says when to leave, and
 * whether its calendars are current (the admin mockups, private notes, B-8).
 *
 * ## What moved out
 *
 * Until October 2026 this pane was a grid of what every chore is worth, with the point rate in
 * the tab row above it. Both went where the thing they price is: a chore's worth is on its row
 * under Chores, and the rate heads Money beside the balances it changes. What is left is about the
 * wall rather than the household's economy.
 *
 * ## Three rows
 *
 * **The look** heads the pane as three large cards (`ThemePicker`). The household chose the felt
 * board and asked to be able to switch; a tap is a request, and the answer changes every screen
 * at once, this one included.
 *
 * **Leave-by alerts** carries its switch on the row, because on or off is the question asked
 * most, and the three numbers one tap in (`LeavingPanel`) behind a forward key, with a back key
 * out. A sub-view rather than a tab: Leaving was a tab of its own until the redesign gave the
 * portal six rooms, and the numbers are set about once a school year.
 *
 * **Calendar** says how current the wall is, from the server's per-source health — labels only,
 * never an adapter handle or an upstream's error text — and offers Fetch now. The key is inert
 * while a fetch is running or when nothing is connected, since a press could change neither.
 * Its answer is the strip's (`fetchOutcomeToast`), and the pane re-reads the settings both after
 * the press and on every new snapshot, so the row moves on when the run lands.
 *
 * ## The PIN row
 *
 * **Grown-up PIN · Change** opens the door's own pad three times in a sub-view
 * (`logic/pinChange.ts`): the PIN now, a new one, the new one again. The first entry authorises
 * the change, not the PIN the visit holds. A wrong one comes back to step one in words, and the
 * portal stays open, because the visit's PIN was right. On success the visit holds the new PIN,
 * so the next request does not bounce to the door.
 *
 * Every tap is a request and the pane draws the response: there is no draft to lose, no save
 * button to forget, and nothing on screen the server does not already agree with.
 */

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { WallThemeId } from '../../../../src/types.ts';
import type { DepartureRulesPatch, HouseholdSettings } from '../../app/adminActions.ts';
import { useWall } from '../../app/wallContext.ts';
import { colour, fontSizePx, iconPx, radius, spacePx, strokePx } from '../../design/tokens.ts';
import { useBandTypography } from '../bands/registry.tsx';
import type { GlyphName } from '../contract.ts';
import { Glyph } from '../primitives/Glyph.tsx';
import { ScrollColumn } from '../primitives/ScrollColumn.tsx';
import { Tappable } from '../primitives/Tappable.tsx';
import { px, tapTarget, text } from '../primitives/style.ts';
import {
  FETCH_WORDS,
  LEAVE_BY_HEAD,
  calendarLine,
  leaveBySummary,
  type CalendarTone,
} from '../logic/grownup.ts';
import { leavingSourcesLine } from '../logic/departures.ts';
import { LeavingPanel } from './LeavingPanel.tsx';
import { StepKey } from './MoneyPanel.tsx';
import { Pill } from './NewChoreSheet.tsx';
import { ThemePicker } from './ThemePicker.tsx';
import { PinSheet } from './PinSheet.tsx';
import {
  PIN_CHANGE_WORDS,
  currentRefused,
  enterPin,
  startPinChange,
  type PinChangeOutcome,
  type PinChangeState,
} from '../logic/pinChange.ts';

const ON_WORDS = 'On';
const OFF_WORDS = 'Off';
const LEAVING_OPEN_WORDS = 'Change the leave-by times';
const LEAVING_BACK_WORDS = 'Back to Settings';

/** The calendar row's mark: the calendar while all is well, the alert when it is not, the arrows while it fetches. */
const CALENDAR_GLYPHS: Readonly<Record<CalendarTone, GlyphName>> = {
  idle: 'calendar',
  ok: 'calendar',
  trouble: 'alert',
  busy: 'sync',
};

export interface SettingsPanelProps {
  settings: HouseholdSettings;
  busy: boolean;
  onTheme: (theme: WallThemeId) => void;
  onDepartures: (patch: DepartureRulesPatch) => void;
  onFetch: () => void;
  /**
   * Send a PIN change. The answer is the outcome rather than the settings, because the sub-view
   * needs to know which step to return to; the caller handles the settings, the held PIN and the strip.
   */
  onChangePin: (currentPin: string, newPin: string) => Promise<PinChangeOutcome>;
}

export function SettingsPanel({ settings, busy, onTheme, onDepartures, onFetch, onChangePin }: SettingsPanelProps) {
  const TYPO = useBandTypography();
  const PRIMARY_TEXT = TYPO.primaryTextPx ?? fontSizePx.bodyLarge;
  const SECONDARY_TEXT = TYPO.secondaryTextPx ?? fontSizePx.small;
  const { clock } = useWall();
  const [view, setView] = useState<'main' | 'leaving' | 'pin'>('main');
  const rules = settings.departures;

  if (view === 'pin') {
    return (
      <PinChangeView
        busy={busy}
        onSend={onChangePin}
        onDone={() => {
          setView('main');
        }}
      />
    );
  }

  if (view === 'leaving') {
    return (
      <div
        data-settings-view="leaving"
        style={{ display: 'flex', flexDirection: 'column', gap: px(spacePx.tapGap), flex: 1, minWidth: 0, minHeight: 0 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: px(spacePx.tapGap), flex: '0 0 auto', minWidth: 0 }}>
          {/* Never busy: stepping out of a sub-view is not a request, so a press in flight does not hold it. */}
          <StepKey
            glyph="back"
            label={LEAVING_BACK_WORDS}
            live
            busy={false}
            onTap={() => {
              setView('main');
            }}
          />
          <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
            <span style={text(PRIMARY_TEXT)}>{LEAVE_BY_HEAD}</span>
            <span style={text(SECONDARY_TEXT, { muted: true })}>{leavingSourcesLine(rules)}</span>
          </span>
        </div>
        <LeavingPanel rules={rules} busy={busy} onChange={onDepartures} />
      </div>
    );
  }

  const line = calendarLine(settings.calendar.sources, clock.nowMs);
  const fetchable = line.tone !== 'busy' && settings.calendar.sources.length > 0;

  return (
    <ScrollColumn gapPx={spacePx.tapGap} ground={colour.surface}>
      <div
        data-settings-row="theme"
        style={{
          ...rowEdge(),
          padding: px(spacePx.md),
          flex: '0 0 auto',
          minWidth: 0,
        }}
      >
        <ThemePicker
          theme={settings.theme}
          busy={busy}
          onTheme={onTheme}
          primaryTextPx={PRIMARY_TEXT}
          secondaryTextPx={SECONDARY_TEXT}
          minTapPx={TYPO.minTapPx}
        />
      </div>
      <SettingRow id="leave-by" glyph="clock" head={LEAVE_BY_HEAD} detail={leaveBySummary(rules)}>
        <Pill
          word={ON_WORDS}
          on={rules.enabled}
          live={!busy}
          minTapPx={TYPO.minTapPx}
          textPx={PRIMARY_TEXT}
          onTap={() => {
            onDepartures({ enabled: true });
          }}
        />
        <Pill
          word={OFF_WORDS}
          on={!rules.enabled}
          live={!busy}
          minTapPx={TYPO.minTapPx}
          textPx={PRIMARY_TEXT}
          onTap={() => {
            onDepartures({ enabled: false });
          }}
        />
        <StepKey
          glyph="forward"
          label={LEAVING_OPEN_WORDS}
          live
          busy={false}
          onTap={() => {
            setView('leaving');
          }}
        />
      </SettingRow>
      <SettingRow
        id="calendar"
        glyph={CALENDAR_GLYPHS[line.tone]}
        trouble={line.tone === 'trouble'}
        head={line.head}
        detail={line.detail}
      >
        <WordKey glyph="sync" words={FETCH_WORDS} live={fetchable} busy={busy} onTap={onFetch} />
      </SettingRow>
      <SettingRow id="pin" glyph="grown-up" head={PIN_CHANGE_WORDS.row} detail={PIN_CHANGE_WORDS.rowDetail}>
        <Pill
          word={PIN_CHANGE_WORDS.open}
          on={false}
          live={!busy}
          minTapPx={TYPO.minTapPx}
          textPx={PRIMARY_TEXT}
          onTap={() => {
            setView('pin');
          }}
          data={{ 'data-settings-key': 'pin' }}
        />
      </SettingRow>
    </ScrollColumn>
  );
}

/**
 * The pad, three times. Keyed by step so each step opens with an empty buffer even when the
 * same step comes round again after a mismatch. The PINs live in `PinChangeState` only until
 * the send is answered, and this view is unmounted the moment it is.
 */
function PinChangeView({
  busy,
  onSend,
  onDone,
}: {
  busy: boolean;
  onSend: (currentPin: string, newPin: string) => Promise<PinChangeOutcome>;
  onDone: () => void;
}) {
  const [state, setState] = useState<PinChangeState>(startPinChange);
  const [round, setRound] = useState(0);
  const [sending, setSending] = useState(false);
  // Leaving Settings while a send is away must not set state on a view that is gone.
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  function submit(pin: string): void {
    const out = enterPin(state, pin);
    setRound((r) => r + 1);
    if (out.send === undefined) {
      setState(out.state);
      return;
    }
    setSending(true);
    void onSend(out.send.current, out.send.fresh).then((outcome) => {
      if (!mounted.current) return;
      setSending(false);
      if (outcome === 'changed') onDone();
      else if (outcome === 'wrong_current') setState(currentRefused());
      // Anything else is the strip's to say; the pad starts over so nothing half-typed is kept.
      else setState(startPinChange());
    });
  }

  return (
    <div data-settings-view="pin" style={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 0 }}>
      <PinSheet
        key={`${state.step}-${String(round)}`}
        ground="transparent"
        exit={{ word: PIN_CHANGE_WORDS.back, glyph: 'back', wide: false, marks: { 'data-pin-change-back': '' } }}
        headline={PIN_CHANGE_WORDS.headline[state.step]}
        detail={PIN_CHANGE_WORDS.detail[state.step]}
        busy={busy || sending}
        refusal={state.said}
        onSubmit={submit}
        onCancel={onDone}
      />
    </div>
  );
}

/** The portal's row edge (Waiting, Chores, Routines, Money): the surface, an edge, no ledge. */
function rowEdge() {
  return {
    background: colour.surface,
    border: `${px(strokePx.medium)} solid ${colour.border}`,
    borderRadius: radius.md,
    boxSizing: 'border-box' as const,
  };
}

/** One setting: its mark, what it is and how it stands, and its controls at the end. */
function SettingRow({
  id,
  glyph,
  trouble = false,
  head,
  detail,
  children,
}: {
  id: string;
  glyph: GlyphName;
  trouble?: boolean;
  head: string;
  detail: string;
  children: ReactNode;
}) {
  const TYPO = useBandTypography();
  const PRIMARY_TEXT = TYPO.primaryTextPx ?? fontSizePx.bodyLarge;
  const SECONDARY_TEXT = TYPO.secondaryTextPx ?? fontSizePx.small;
  return (
    <div
      data-settings-row={id}
      style={{
        ...rowEdge(),
        display: 'flex',
        alignItems: 'center',
        gap: px(spacePx.sm),
        minHeight: px(TYPO.minTapPx + 2 * (spacePx.xxs + strokePx.medium)),
        padding: `${px(spacePx.xxs)} ${px(spacePx.xxs)} ${px(spacePx.xxs)} ${px(spacePx.md)}`,
        flex: '0 0 auto',
        minWidth: 0,
      }}
    >
      {/* The adult red is for the adult screens only, and only on a mark: the words stay ink. */}
      <Glyph name={glyph} sizePx={iconPx.sm} tone={trouble ? colour.danger : colour.ink} />
      <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <span style={text(PRIMARY_TEXT)}>{head}</span>
        <span style={text(SECONDARY_TEXT, { muted: true, wrap: true, lines: 2 })}>{detail}</span>
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: px(spacePx.tapGap), flex: '0 0 auto' }}>
        {children}
      </span>
    </div>
  );
}

/**
 * A key that says what it does in words, with its mark in front. Dim and inert when a press could
 * change nothing; inert and NOT dim while a request is away, so nothing flickers (`StepKey`'s rule).
 */
function WordKey({
  glyph,
  words,
  live,
  busy,
  onTap,
}: {
  glyph: GlyphName;
  words: string;
  live: boolean;
  busy: boolean;
  onTap: () => void;
}) {
  const TYPO = useBandTypography();
  const PRIMARY_TEXT = TYPO.primaryTextPx ?? fontSizePx.bodyLarge;
  const ink = live ? colour.ink : colour.inkMuted;
  return (
    <Tappable
      enabled={live && !busy}
      onTap={onTap}
      data={{ 'data-settings-key': glyph }}
      style={tapTarget(TYPO.minTapPx, {
        gap: px(spacePx.xs),
        flex: '0 0 auto',
        whiteSpace: 'nowrap',
        padding: `${px(spacePx.none)} ${px(spacePx.lg)}`,
        background: live ? colour.surface : colour.surfaceSunken,
        border: `${px(strokePx.medium)} solid ${live ? colour.borderStrong : colour.surfaceSunken}`,
        borderRadius: radius.pill,
      })}
    >
      <Glyph name={glyph} sizePx={iconPx.xs} tone={ink} />
      <span style={{ ...text(PRIMARY_TEXT), color: ink }}>{words}</span>
    </Tappable>
  );
}
