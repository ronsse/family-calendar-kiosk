/**
 * Unit H — the grown-up portal: a door, a home, and five rooms behind it
 * (the admin mockups, private notes).
 *
 * Eight admin routes were implemented and tested long before any of them was reachable from the
 * wall, so a chore went `pending → claimed →` and stopped: a child could claim "Make your bed" and
 * nothing in the building could approve it except `curl`. This file is where those routes became
 * reachable, and it is now the whole of the adult surface but one: the queue, the chores, the
 * routines, the money and the settings, behind one door. The picture library is the exception —
 * its own destination, because putting a picture up asks for no PIN at all.
 *
 * **THE PIN IS THE DOOR (2026-10).** Nothing behind it is drawn until a PIN is held AND the
 * portal's first read — the settings, which the server checks like every request — has accepted
 * it once. A wrong PIN goes back to the pad as "Ask a grown-up." instead of opening a portal in
 * which every control then fails. There is still no verify route and there does not need to be:
 * the first real read IS the check. WallApp holds the PIN for the visit (app/grownupVisit.ts) and
 * the SERVER is unchanged — `requireParentPin` is per request, never a session.
 *
 * The queue used to be readable without a PIN, on the reasoning that a child may read what she is
 * waiting on. That stopped being true of this screen when the ledger, every balance and what each
 * chore is worth moved in behind the same door; a child reads her own waiting chores on her own
 * card, which says "Waiting for a grown-up" in exactly those words.
 *
 * **Home, then five sections.** Home is six tiles that are doors (GrownupHome). GrownupChrome
 * draws the navigation, Leave and the strip, in the theme's form; this file owns the PIN, every
 * request, and every refusal, so there is one place a rejected PIN is forgotten.
 *
 * **One list, across all children.** ChoreOps ships two adult theories — a shared approval hub and
 * a per-user workspace — and the hub is the right one for a wall (H7 §4.3): an adult standing here
 * for ninety seconds after dinner wants one list, not three screens to page through.
 *
 * **A decision in Waiting waits five seconds before it is sent (2026-10, pass 2).** With the
 * PIN held, Approve and Send back HOLD the row (logic/heldDecisions.ts). The row says what was
 * decided and offers Undo, and the request goes when the window closes, when the adult moves to
 * another room, or when the portal is left. Undo therefore writes nothing: the ledger never sees
 * a decision that was taken back. A decision made through the pad is sent at once, as before.
 *
 * **What happened stays in sight.** A good outcome stands in the strip for five seconds; a refusal
 * stays until somebody taps it or moves on (logic/grownup.ts §5).
 */

import { useEffect, useRef, useState } from 'react';
import {
  childAccentForSlot,
  colour,
  controlShadow,
  fontSizePx,
  fontWeight,
  iconPx,
  layoutPx,
  radius,
  spacePx,
  stateTreatments,
  strokePx,
} from '../../design/tokens.ts';
import {
  NULL_ADMIN_ACTIONS,
  REFUSAL_WORDS,
  approvalQueue,
  approvalRowHeightPx,
  performApproval,
  refusalCodeOf,
  refusalIsRetryable,
  refusalMessageOf,
  type AdminActions,
  type ApprovalDecision,
  type ApprovalItem,
  type ApprovalKind,
  type ChoreCatalog,
  type HouseholdSettings,
  type RefusalCode,
  type RoutineCatalog,
} from '../../app/adminActions.ts';
import { useWall } from '../../app/wallContext.ts';
import { useWallLayout } from '../../app/layoutContext.ts';
import { BandScope, DeskScope, useBandTypography } from '../bands/registry.tsx';
import type { GlyphName } from '../contract.ts';
import { AccentFrame, AssetImage } from '../primitives/AssetImage.tsx';
import { Glyph } from '../primitives/Glyph.tsx';
import { Tappable } from '../primitives/Tappable.tsx';
import { ScrollColumn } from '../primitives/ScrollColumn.tsx';
import { card, onSolid, px, tapTarget, text } from '../primitives/style.ts';
import { AMBIENT_BAND } from '../logic/idle.ts';
import { defaultRoutineId } from '../logic/routineAssign.ts';
import { orderedChildren } from '../logic/summary.ts';
import {
  DOOR_BACK_GLYPH,
  DOOR_BACK_WORDS,
  DOOR_HEAD_WORDS,
  SECTION_NEEDS,
  approvalMeta,
  decidedWords,
  doorDetail,
  fetchOutcomeToast,
  fetchRefusalWords,
  newRequestId,
  toastExpiresAtMs,
  withWorths,
  type GrownupSection,
  type Toast,
} from '../logic/grownup.ts';
import { PinSheet } from './PinSheet.tsx';
import { GrownupChrome } from './GrownupChrome.tsx';
import { GrownupHome } from './GrownupHome.tsx';
import { MoneyPanel } from './MoneyPanel.tsx';
import { SettingsPanel } from './SettingsPanel.tsx';
import { RoutinesPanel } from './RoutinesPanel.tsx';
import { ChoresPanel } from './ChoresPanel.tsx';
import { RETIRE_WORDS } from '../logic/choreRetire.ts';
import { PIN_CHANGE_WORDS, type PinChangeOutcome } from '../logic/pinChange.ts';
import {
  UNDO_WORDS,
  dueDecisions,
  holdDecision,
  nextDueAtMs,
  undoDecision,
  type HeldDecision,
} from '../logic/heldDecisions.ts';
import { Pill } from './NewChoreSheet.tsx';

const EMPTY_HEAD_WORD = 'Nothing is waiting';
const EMPTY_BODY_WORD = 'Everything the children have done is sorted.';
const LOADING_HEAD_WORD = 'One moment';
const LOADING_BODY_WORD = 'Reading what things are worth.';
const UNREADABLE_HEAD_WORD = 'Could not read the settings';
const UNREADABLE_BODY_WORD = 'Leave this screen and come back in.';
const ROUTINES_LOADING_BODY_WORD = 'Reading the routines.';
const ROUTINES_UNREADABLE_HEAD_WORD = 'Could not read the routines';
const CHORES_LOADING_BODY_WORD = 'Reading the chores.';
const CHORES_UNREADABLE_HEAD_WORD = 'Could not read the chores';
const SEPARATOR = ' · ';

/**
 * The verbs, per kind, because the two machines do genuinely different things and a shared
 * word would lie about one of them.  Sending a chore back returns it to `pending` so the
 * child can redo it — there is no `rejected` chore state, by decision (src/types.ts) — while
 * declining a redemption closes that request and hands the points back, freeing the child's
 * one open slot so she can ask again.  "Not yet" is the true word for the second.
 */
const DECISION_WORDS: Record<ApprovalKind, Record<ApprovalDecision, string>> = {
  chore: { approve: 'Approve', reject: 'Send back' },
  redemption: { approve: 'Pay out', reject: 'Not yet' },
};

interface DecisionLook {
  readonly fill: string;
  readonly edge: string;
  readonly ink: string;
  readonly glyph: GlyphName;
  /** True when the word sits on a coloured solid, which floors its size at 24 (Unit G). */
  readonly solidGround: boolean;
}

/**
 * Approving reuses the state ladder's own DONE treatment rather than inventing an adult palette —
 * the same move `freshnessColour` makes. Sending back is red, asked for by name ("a red button
 * with an x and a check mark"), and this is the one place on the wall where red is legal: the
 * adult surface, behind the PIN. Nothing a child can reach is ever red (PRD §4).
 *
 * The keys carry their WORDS again. "Check and then an x" was right while the row was the only
 * thing on the screen; with the queue one room of five, and the two keys the only controls in it
 * that move a child's points, a key that says "Send back" is not a key an adult presses by
 * mistake. The words were already the accessible names and the pad's headline.
 */
const DECISION_LOOK: Record<ApprovalDecision, DecisionLook> = {
  approve: {
    fill: stateTreatments.approved.fill,
    edge: stateTreatments.approved.edge,
    ink: stateTreatments.approved.ink,
    glyph: 'check',
    solidGround: true,
  },
  reject: {
    fill: colour.danger,
    edge: colour.danger,
    ink: colour.inkInverse,
    glyph: 'cross',
    solidGround: true,
  },
};

/**
 * Send back as the gallery and storybook mocks draw it: a red outline on the paper, beside the
 * one solid key on the row. Felt keeps the red solid (`WallLayout.rejectKey`). Red words on the
 * surface are an adult-only pair, which is what this row is.
 */
const REJECT_OUTLINE: DecisionLook = {
  fill: colour.surface,
  edge: colour.danger,
  ink: colour.danger,
  glyph: 'cross',
  solidGround: false,
};

interface ApprovalIntent {
  readonly item: ApprovalItem;
  readonly decision: ApprovalDecision;
}

export interface ApprovalsViewProps {
  /**
   * The admin port.  Absent, the screen still renders — it simply cannot read or decide
   * anything, which is the right posture for a preview surface.
   */
  actions?: AdminActions | undefined;
  /**
   * The PIN this visit to the grown-up portal is holding, or null if the door has not been
   * opened yet.  Owned by `WallApp` and shared with the picture catalog — see grownupVisit.ts
   * for what a "visit" is and exactly when it ends.
   */
  pin?: string | null | undefined;
  /** Hand back a PIN that worked, or null to forget one the server rejected. */
  onPin?: ((pin: string | null) => void) | undefined;
  /** Out of the portal, back to the wall. Forgets the PIN (the visit is over). */
  onLeave?: (() => void) | undefined;
  /** To the picture library, which is its own destination and keeps the PIN. */
  onPictures?: (() => void) | undefined;
}

/**
 * Always the band adults read in, at ARM'S LENGTH.
 *
 * `AMBIENT_BAND` is not a literal and not a branch: it is the household's already-made
 * decision about which rendering an adult gets, the same one the idle wall uses.  Without
 * it this screen would inherit whichever child's screen was up when somebody tapped the
 * grown-up tile — and opened in the picture band it would show an adult no words at all.
 */
export function ApprovalsView({ actions, pin, onPin, onLeave, onPictures }: ApprovalsViewProps) {
  return (
    <BandScope band={AMBIENT_BAND}>
      {/*
        THE DESK, not `near`. Same arm's length; a different reader. An adult operating controls
        reads 14px fine where a five-year-old finding her chore does not, and the household's
        verdict on the first version of this screen was *"you can shrink the size in the [admin]
        tab a lot."* One step down the scale, and the 64px tap floor deliberately unmoved — see
        `deskTypography` for why that half does not follow.
      */}
      <DeskScope>
        <ApprovalsPane
          actions={actions ?? NULL_ADMIN_ACTIONS}
          pin={pin ?? null}
          onPin={onPin ?? (() => undefined)}
          onLeave={onLeave ?? (() => undefined)}
          onPictures={onPictures ?? (() => undefined)}
        />
      </DeskScope>
    </BandScope>
  );
}

function ApprovalsPane({
  actions,
  pin,
  onPin,
  onLeave,
  onPictures,
}: {
  actions: AdminActions;
  pin: string | null;
  onPin: (pin: string | null) => void;
  onLeave: () => void;
  onPictures: () => void;
}) {
  const { snapshot, clock, resetKey } = useWall();
  const TYPO = useBandTypography();
  const PRIMARY_TEXT = TYPO.primaryTextPx ?? fontSizePx.bodyLarge;
  const SECONDARY_TEXT = TYPO.secondaryTextPx ?? fontSizePx.small;

  const [intent, setIntent] = useState<ApprovalIntent | null>(null);
  const [refusal, setRefusal] = useState<RefusalCode | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * The PIN is not held here. It arrives as a PROP, so that it is one PIN for the portal and not
   * one per screen — `pin` and `onPin` are the whole of this screen's relationship with it, and
   * WallApp drops it the moment the wall leaves the portal (`visitPinAfterMove`), which the
   * 90-second idle decay does on its own.
   *
   * The pad is up on arrival — the door — unless the portal is already open.
   */
  const [padOpen, setPadOpen] = useState(pin === null);
  /**
   * True from the door's submit until the first settings read answers. That read is the PIN's
   * first real use, and the portal stays behind the door until it has said yes — so a wrong PIN
   * is refused AT THE DOOR rather than on the first decision an adult tries to make.
   */
  const [verifying, setVerifying] = useState(false);
  /**
   * Rows this screen has already decided, hidden until the server's own answer arrives.
   *
   * The server invalidates and the data layer refetches, so the row leaves on its own
   * within a beat — but "I tapped approve and the row is still sitting there" is the exact
   * failure the redemption amendment describes from the other side, and an adult who
   * believes nothing happened taps again.  Cleared on every new snapshot, so this can lie
   * for one refresh at most and the truth always wins.
   */
  const [settled, setSettled] = useState<readonly string[]>([]);
  /** Which room is up. Home, because it is the one that says where everything else stands. */
  const [section, setSection] = useState<GrownupSection>('home');
  /**
   * The household settings: the rate, what each chore is worth, the leave-by rules, the theme
   * and how each calendar is doing. Read on the way in (it is the door's check) and replaced by
   * every write's RESPONSE, so nothing on screen is a local guess the database disagrees with.
   */
  const [settings, setSettings] = useState<HouseholdSettings | null>(null);
  const [settingsFailed, setSettingsFailed] = useState(false);
  /** The routine definitions, read when Routines first opens; every write's response replaces them. */
  const [routines, setRoutines] = useState<RoutineCatalog | null>(null);
  const [routinesFailed, setRoutinesFailed] = useState(false);
  const [routineId, setRoutineId] = useState<string | null>(null);
  /** The chore catalog, on the same terms as the routines. */
  const [chores, setChores] = useState<ChoreCatalog | null>(null);
  const [choresFailed, setChoresFailed] = useState(false);
  // The New-chore sheet: open or not, and the server's words for the last refused attempt.
  const [choreSheet, setChoreSheet] = useState<{ open: boolean; refusal: string | null }>({
    open: false,
    refusal: null,
  });
  const children = orderedChildren(snapshot.children);
  /** Whose routine is being edited: the first child, so the room opens on somebody. */
  const [childId, setChildId] = useState<string | null>(children[0]?.id ?? null);
  /** What just happened. A refusal is not kept here — it is `refusal`, and it outranks this. */
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    setSettled((previous) => (previous.length === 0 ? previous : []));
  }, [resetKey]);

  // A good outcome goes by itself; a refusal never does (`toastExpiresAtMs` is null for one).
  useEffect(() => {
    const at = toast === null ? null : toastExpiresAtMs(toast);
    if (at === null) return;
    const t = setTimeout(() => {
      setToast((current) => (current === toast ? null : current));
    }, Math.max(0, at - Date.now()));
    return () => {
      clearTimeout(t);
    };
  }, [toast]);

  /**
   * Decisions taken in Waiting and not yet sent. The ref mirrors the state, so the timer and the
   * unmount flush always see the latest list, never one captured by an older render.
   */
  const [held, setHeldState] = useState<readonly HeldDecision[]>([]);
  const heldRef = useRef<readonly HeldDecision[]>([]);
  function setHeld(next: readonly HeldDecision[]): void {
    heldRef.current = next;
    setHeldState(next);
  }

  // The queue as drawn in Waiting: every row the server still has, held ones included.
  const queue = approvalQueue(snapshot).filter((item) => !settled.includes(item.key));
  // What is still WAITING for a decision: what the home tile, the door and the nav count.
  const waiting = queue.filter((item) => !held.some((h) => h.item.key === item.key));

  /**
   * Send held decisions. Each row is marked settled as it goes, so it does not flash back into
   * the list while its request is away. A refusal un-settles it, so the row returns and says why.
   */
  function commitHeld(hs: readonly HeldDecision[]): void {
    if (hs.length === 0) return;
    setSettled((previous) => [...previous, ...hs.map((h) => h.item.key)]);
    for (const h of hs) {
      void send(h.item, h.decision, h.pin).then(
        () => {
          setToast({ tone: 'ok', words: decidedWords(h.item, h.decision), atMs: Date.now() });
        },
        (err: unknown) => {
          setSettled((previous) => previous.filter((key) => key !== h.item.key));
          settingsRefused(err);
        },
      );
    }
  }

  function flushHeld(): void {
    const all = heldRef.current;
    setHeld([]);
    commitHeld(all);
  }

  // The next window to close. One timer, for the earliest; it re-arms whenever the list changes.
  useEffect(() => {
    const at = nextDueAtMs(held);
    if (at === null) return;
    const t = setTimeout(() => {
      const { due, rest } = dueDecisions(heldRef.current, Date.now());
      setHeld(rest);
      commitHeld(due);
    }, Math.max(0, at - Date.now()));
    return () => {
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held]);

  // Leaving the portal (Leave, the idle decay, anything) sends what is held rather than losing it.
  useEffect(
    () => () => {
      const all = heldRef.current;
      heldRef.current = [];
      commitHeld(all);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /**
   * The ONE call that reaches the queue's server routes. The pad's `decide` and the undo
   * window's `commitHeld` both come through here, so there is still one door to the admin
   * surface, and the PIN is its last argument with no arity that omits it.
   */
  function send(item: ApprovalItem, decision: ApprovalDecision, parentPin: string): Promise<void> {
    return performApproval(actions, item, decision, parentPin);
  }

  /**
   * The pad's path to the queue: a decision that was waiting on a PIN.
   *
   * `parentPin` is a parameter of this function: it arrives from the held PIN or from the pad,
   * is spent on one request, and is handed back to WallApp only if the server took it.
   */
  function decide(parentPin: string, target: ApprovalIntent | null = intent): void {
    if (target === null || busy) return;
    setBusy(true);
    setRefusal(null);
    void send(target.item, target.decision, parentPin).then(
      () => {
        setBusy(false);
        setIntent(null);
        setRefusal(null);
        // It worked, so it is the household's PIN. Hold it for the rest of this visit.
        onPin(parentPin);
        setPadOpen(false);
        setSettled((previous) => [...previous, target.item.key]);
        setToast({ tone: 'ok', words: decidedWords(target.item, target.decision), atMs: Date.now() });
      },
      (err: unknown) => {
        setBusy(false);
        const code = refusalCodeOf(err);
        if (code === 'bad_pin') {
          // Forget it and ask again. Holding a PIN the server rejected would turn one typo
          // into every later decision failing for no visible reason.
          onPin(null);
          setPadOpen(true);
          forgetReads();
        }
        // Some codes are contracted to say nothing at all. Nothing means nothing: close the
        // sheet and leave the wall as it was, rather than inventing a sentence for it.
        if (REFUSAL_WORDS[code].length === 0) {
          setIntent(null);
          setRefusal(null);
          return;
        }
        setRefusal(code);
      },
    );
  }

  /**
   * After a rejected PIN, what was read with it must be read again with the next one — the
   * settings above all, because their read is the door's check, and a copy left over from the
   * old PIN would wave the new one through unchecked.
   */
  function forgetReads(): void {
    setSettings(null);
    setSettingsFailed(false);
    setRoutinesFailed(false);
    setChoresFailed(false);
    setVerifying(false);
  }

  /**
   * A refusal from any other route, handled EXACTLY as the queue's is.
   *
   * One door, one rejected PIN, one place that forgets it. A settings call refused for a stale
   * PIN that left the queue's copy in place would be two halves of one screen disagreeing about
   * whether an adult is standing here.
   */
  function settingsRefused(err: unknown): void {
    const code = refusalCodeOf(err);
    if (code === 'bad_pin') {
      onPin(null);
      setPadOpen(true);
      // A decision refused earlier must not ride back in behind the door and spend the next PIN.
      setIntent(null);
      forgetReads();
    }
    if (REFUSAL_WORDS[code].length > 0) setRefusal(code);
  }

  // Each read fires when a room that needs it is opened with a PIN in hand, and not again: the
  // `…Failed` flags are what stop a refusal from retrying on every render. The settings are ALSO
  // read while `verifying`, whatever room is up, because that read is the door.
  useEffect(() => {
    if (
      !(SECTION_NEEDS[section].settings || verifying) ||
      pin === null ||
      settings !== null ||
      settingsFailed
    )
      return;
    void actions.fetchSettings(pin).then(
      (got) => {
        setSettings(got);
        setVerifying(false);
      },
      (err: unknown) => {
        setSettingsFailed(true);
        setVerifying(false);
        settingsRefused(err);
      },
    );
    // `settingsRefused` closes over setters only, all of which React guarantees are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, pin, settings, settingsFailed, verifying, actions]);

  // The calendar line in Settings is the one thing behind this door that something ELSE moves: a
  // finished fetch invalidates the snapshot, so a new snapshot is the cue to read it again —
  // quietly, keeping what is on screen until the answer arrives.
  useEffect(() => {
    if (section !== 'settings' || pin === null || settings === null || busy) return;
    let live = true;
    void actions.fetchSettings(pin).then(
      (got) => {
        if (live) setSettings(got);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  useEffect(() => {
    if (!SECTION_NEEDS[section].routines || pin === null || routines !== null || routinesFailed) return;
    void actions.fetchRoutines(pin).then(
      (got) => {
        setRoutines(got);
        setRoutineId((current) => current ?? defaultRoutineId(got));
      },
      (err: unknown) => {
        setRoutinesFailed(true);
        settingsRefused(err);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, pin, routines, routinesFailed, actions]);

  useEffect(() => {
    if (!SECTION_NEEDS[section].chores || pin === null || chores !== null || choresFailed) return;
    void actions.fetchChores(pin).then(
      (got) => {
        setChores(got);
      },
      (err: unknown) => {
        setChoresFailed(true);
        settingsRefused(err);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, pin, chores, choresFailed, actions]);

  function applyChores(call: Promise<ChoreCatalog>): void {
    if (busy) return;
    setBusy(true);
    void call.then(
      (got) => {
        setBusy(false);
        setChores(got);
      },
      (err: unknown) => {
        setBusy(false);
        settingsRefused(err);
      },
    );
  }

  /**
   * The sheet's send. A `bad_request` is the one refusal that is FOR the parent — the server
   * lists every reason in its message — so it stays on the sheet in the server's words rather
   * than becoming the strip's generic "not now". Anything else is handled as every write is.
   */
  function applyCreateChore(call: Promise<ChoreCatalog>): void {
    if (busy) return;
    setBusy(true);
    void call.then(
      (got) => {
        setBusy(false);
        setChores(got);
        setChoreSheet({ open: false, refusal: null });
      },
      (err: unknown) => {
        setBusy(false);
        const words = refusalMessageOf(err);
        if (words !== null) setChoreSheet({ open: true, refusal: words });
        else settingsRefused(err);
      },
    );
  }

  /**
   * The PIN change's send. The header carries the PIN typed in its FIRST step, not the one this
   * visit holds, so `bad_pin` here means that entry was wrong. The portal stays open (the held PIN
   * still works) and the sub-view goes back to step one. That is why this does not go through
   * `settingsRefused`, which would close the door on a PIN that is still good.
   */
  function changePin(currentPin: string, newPin: string): Promise<PinChangeOutcome> {
    if (busy) return Promise.resolve('failed');
    setBusy(true);
    return actions.changePin(currentPin, newPin).then(
      (got): PinChangeOutcome => {
        setBusy(false);
        setSettings(got);
        // From here on the old PIN is refused, so the visit must hold the new one.
        onPin(newPin);
        setToast({ tone: 'ok', words: PIN_CHANGE_WORDS.done, atMs: Date.now() });
        return 'changed';
      },
      (err: unknown): PinChangeOutcome => {
        setBusy(false);
        if (refusalCodeOf(err) === 'bad_pin') return 'wrong_current';
        settingsRefused(err);
        return 'failed';
      },
    );
  }

  /**
   * Retire's one refusal the parent can fix is a claim still waiting (`not_claimable`). The
   * frozen refusal table words that code for the Waiting queue ("already been sorted"), so the strip says the chores-screen
   * sentence instead, naming what to do first.
   */
  function applyRetire(call: Promise<ChoreCatalog>): void {
    if (busy) return;
    setBusy(true);
    void call.then(
      (got) => {
        setBusy(false);
        setChores(got);
      },
      (err: unknown) => {
        setBusy(false);
        if (refusalCodeOf(err) === 'not_claimable') {
          setToast({ tone: 'trouble', words: RETIRE_WORDS.waiting, atMs: Date.now() });
        } else settingsRefused(err);
      },
    );
  }

  function applyRoutines(call: Promise<RoutineCatalog>): void {
    if (busy) return;
    setBusy(true);
    void call.then(
      (got) => {
        setBusy(false);
        setRoutines(got);
      },
      (err: unknown) => {
        setBusy(false);
        settingsRefused(err);
      },
    );
  }

  function applySetting(call: Promise<HouseholdSettings>): void {
    if (busy) return;
    setBusy(true);
    void call.then(
      (got) => {
        setBusy(false);
        // The RESPONSE is the new settings. Nothing is guessed locally, so a value the server
        // clamped or refused cannot leave this screen showing a number the database disagrees
        // with — which is exactly what an optimistic local update invites.
        setSettings(got);
      },
      (err: unknown) => {
        setBusy(false);
        settingsRefused(err);
      },
    );
  }

  /**
   * A chore's worth, set from its own row. The answer is the SETTINGS (worth lives there), so
   * the row's number comes from the response too, merged into the chore list it is drawn from.
   */
  function applyWorth(call: Promise<HouseholdSettings>): void {
    if (busy) return;
    setBusy(true);
    void call.then(
      (got) => {
        setBusy(false);
        setSettings(got);
        setChores((current) => (current === null ? current : withWorths(current, got.chores)));
      },
      (err: unknown) => {
        setBusy(false);
        settingsRefused(err);
      },
    );
  }

  /**
   * Fetch now. The route answers at once — started, already running, or not configured — and the
   * fetch itself finishes later and invalidates the snapshot, which is what re-reads the line.
   * `unavailable` (no calendar scheduler on this wall) is outside the frozen refusal table, so it
   * is worded from the raw code rather than folded into "Not now".
   */
  function fetchCalendars(): void {
    if (busy || pin === null) return;
    const held = pin;
    setBusy(true);
    void actions.refreshCalendar(held).then(
      (outcome) => {
        setBusy(false);
        setToast({ ...fetchOutcomeToast(outcome), atMs: Date.now() });
        void actions.fetchSettings(held).then(setSettings, () => undefined);
      },
      (err: unknown) => {
        setBusy(false);
        if (refusalCodeOf(err) === 'bad_pin') settingsRefused(err);
        else setToast({ tone: 'trouble', words: fetchRefusalWords(err), atMs: Date.now() });
      },
    );
  }

  const said = refusal === null ? null : REFUSAL_WORDS[refusal];
  // Only a wrong PIN is worth another go at the pad. Everything else needs a different fix,
  // and a live pad would invite an adult to spend a correct PIN on a row that has moved on.
  const padInert = busy || (refusal !== null && !refusalIsRetryable(refusal));
  /**
   * THE DOOR IS UNCONDITIONAL. It is up whenever no PIN is held, whatever is or is not waiting:
   * an adult learns where the PIN is asked for, and that has to be the same place every time. For
   * one day in 2026-09 it was suppressed over an empty queue, and the only pad left in the
   * building was the picture catalog's — "it switched off of the admin tab into the image
   * switcher rather than staying on the admin tab."
   */
  const doorUp = padOpen;
  const behindDoor = doorUp || pin === null || (verifying && settings === null && !settingsFailed);

  // A refusal outranks a good outcome, and stays until it is tapped or the room changes.
  const strip: Toast | null =
    said !== null && said.length > 0 ? { tone: 'trouble', words: said, atMs: 0 } : toast;

  function change(next: GrownupSection): void {
    // Moving on is "I am done here": whatever is held goes now.
    flushHeld();
    setSection(next);
    setRefusal(null);
    setToast(null);
    setIntent(null);
  }

  if (behindDoor) {
    return (
      <div style={{ padding: px(layoutPx.wallPad), flex: 1, display: 'flex', minWidth: 0, minHeight: 0 }}>
        {/*
          THE DOOR, drawn as a card in every theme: the wall's own chrome is gone, so the pad
          needs a ground of its own. Its exit leaves the portal altogether — behind a door there
          is nothing to step back to.
        */}
        <div data-pin-door="" style={card({ position: 'relative', flex: 1, minWidth: 0 })}>
          <PinSheet
            ground="transparent"
            exit={{ word: DOOR_BACK_WORDS, glyph: DOOR_BACK_GLYPH, wide: true, marks: { 'data-grownup-leave': '' } }}
            headline={intent === null ? DOOR_HEAD_WORDS : DECISION_WORDS[intent.item.kind][intent.decision]}
            detail={
              intent === null
                ? doorDetail(waiting.length)
                : `${intent.item.labelFull}${SEPARATOR}${approvalMeta(intent.item, clock.nowMs)}`
            }
            busy={padInert || verifying}
            refusal={said}
            onSubmit={(entered) => {
              /*
                AT THE DOOR there is nothing to spend the PIN on yet — so take it, close the pad,
                and let the settings read be where the server gets its say (`verifying` holds
                the door shut until it has).

                This branch is the 2026-09-10 fix and it stays: before it, the door called
                `decide`, which returns immediately when `intent` is null, and the pad swallowed
                the PIN and sat there — "I hit green check and it just stays on that page."
              */
              setRefusal(null);
              setVerifying(intent === null);
              if (intent === null) {
                onPin(entered);
                setPadOpen(false);
                return;
              }
              decide(entered);
            }}
            onCancel={() => {
              setPadOpen(false);
              setIntent(null);
              setRefusal(null);
              onLeave();
            }}
          />
        </div>
      </div>
    );
  }

  const body =
    section === 'home' ? (
      <GrownupHome
        items={waiting}
        settings={settings}
        settingsFailed={settingsFailed}
        onSection={change}
        onPictures={onPictures}
      />
    ) : section === 'waiting' ? (
      queue.length === 0 ? (
        <EmptyQueue primaryTextPx={PRIMARY_TEXT} secondaryTextPx={SECONDARY_TEXT} />
      ) : (
        <ScrollColumn gapPx={spacePx.tapGap} ground={colour.surface}>
          {queue.map((item) => {
            const hold = held.find((h) => h.item.key === item.key) ?? null;
            return (
              <ApprovalRow
                key={item.key}
                item={item}
                meta={hold === null ? approvalMeta(item, clock.nowMs) : decidedWords(item, hold.decision)}
                held={hold !== null}
                onUndo={() => {
                  setHeld(undoDecision(heldRef.current, item.key));
                }}
                onDecide={(decision) => {
                  setRefusal(null);
                  // With the PIN in hand the key IS the decision — no pad, no confirm step — and
                  // it is HELD for the undo window rather than sent (file header).
                  if (pin !== null) {
                    setHeld(holdDecision(heldRef.current, item, decision, pin, Date.now()));
                    return;
                  }
                  const next = { item, decision };
                  setIntent(next);
                  setPadOpen(true);
                }}
              />
            );
          })}
        </ScrollColumn>
      )
    ) : section === 'money' ? (
      settings === null ? (
        <EmptyQueue
          primaryTextPx={PRIMARY_TEXT}
          secondaryTextPx={SECONDARY_TEXT}
          head={settingsFailed ? UNREADABLE_HEAD_WORD : LOADING_HEAD_WORD}
          body={settingsFailed ? UNREADABLE_BODY_WORD : LOADING_BODY_WORD}
          glyph={settingsFailed ? 'alert' : 'hourglass'}
        />
      ) : (
        <MoneyPanel
          settings={settings}
          busy={busy}
          onRate={(cents) => {
            if (pin !== null) applySetting(actions.setCentsPerPoint(cents, pin));
          }}
          onAdjust={(who, delta) => {
            if (busy || pin === null) return Promise.resolve(false);
            setBusy(true);
            // One idempotency key per PRESS: the server pays a repeated key once, so a key
            // reused across taps would make the second bonus vanish.
            return actions.adjustLedger(who, delta, newRequestId(), pin).then(
              () => {
                setBusy(false);
                return true;
              },
              (err: unknown) => {
                setBusy(false);
                settingsRefused(err);
                return false;
              },
            );
          }}
          readLedger={(who) => {
            if (pin === null) return Promise.resolve(null);
            return actions.fetchLedger(who, pin).then(
              (got) => got,
              (err: unknown) => {
                settingsRefused(err);
                return null;
              },
            );
          }}
        />
      )
    ) : section === 'chores' ? (
      chores === null ? (
        <EmptyQueue
          primaryTextPx={PRIMARY_TEXT}
          secondaryTextPx={SECONDARY_TEXT}
          head={choresFailed ? CHORES_UNREADABLE_HEAD_WORD : LOADING_HEAD_WORD}
          body={choresFailed ? UNREADABLE_BODY_WORD : CHORES_LOADING_BODY_WORD}
          glyph={choresFailed ? 'alert' : 'hourglass'}
        />
      ) : (
        <ChoresPanel
          catalog={chores}
          busy={busy}
          sheet={choreSheet}
          onOpenSheet={() => {
            setChoreSheet({ open: true, refusal: null });
          }}
          onCloseSheet={() => {
            setChoreSheet({ open: false, refusal: null });
          }}
          onCreate={(request) => {
            if (pin !== null) applyCreateChore(actions.createChore(request, pin));
          }}
          onMember={(choreId, who, member) => {
            if (pin !== null) applyChores(actions.setChoreMember(choreId, who, member, pin));
          }}
          onMove={(choreId, who, direction) => {
            if (pin !== null) applyChores(actions.moveChoreMember(choreId, who, direction, pin));
          }}
          onModel={(choreId, model) => {
            if (pin !== null) applyChores(actions.setChoreModel(choreId, model, pin));
          }}
          onWorth={(choreId, basePoints) => {
            if (pin !== null) applyWorth(actions.setChorePoints(choreId, basePoints, pin));
          }}
          onEdit={(choreId, patch) => {
            // The same answer as a new chore: success closes the sheet, the server's reasons stay on it.
            if (pin !== null) applyCreateChore(actions.editChore(choreId, patch, pin));
          }}
          onRetire={(choreId) => {
            if (pin !== null) applyRetire(actions.retireChore(choreId, pin));
          }}
          onRestore={(choreId) => {
            if (pin !== null) applyChores(actions.restoreChore(choreId, pin));
          }}
        />
      )
    ) : section === 'routines' ? (
      routines === null ? (
        <EmptyQueue
          primaryTextPx={PRIMARY_TEXT}
          secondaryTextPx={SECONDARY_TEXT}
          head={routinesFailed ? ROUTINES_UNREADABLE_HEAD_WORD : LOADING_HEAD_WORD}
          body={routinesFailed ? UNREADABLE_BODY_WORD : ROUTINES_LOADING_BODY_WORD}
          glyph={routinesFailed ? 'alert' : 'hourglass'}
        />
      ) : (
        <RoutinesPanel
          catalog={routines}
          routineId={routineId}
          childId={childId}
          busy={busy}
          onRoutine={setRoutineId}
          onChild={setChildId}
          onAssign={(id, stepId, assigned) => {
            if (pin !== null && childId !== null) {
              applyRoutines(actions.assignRoutineStep(id, stepId, childId, assigned, pin));
            }
          }}
          onMove={(id, stepId, direction) => {
            if (pin !== null && childId !== null) {
              applyRoutines(actions.moveRoutineStep(id, stepId, childId, direction, pin));
            }
          }}
        />
      )
    ) : settings === null ? (
      <EmptyQueue
        primaryTextPx={PRIMARY_TEXT}
        secondaryTextPx={SECONDARY_TEXT}
        head={settingsFailed ? UNREADABLE_HEAD_WORD : LOADING_HEAD_WORD}
        body={settingsFailed ? UNREADABLE_BODY_WORD : LOADING_BODY_WORD}
        glyph={settingsFailed ? 'alert' : 'hourglass'}
      />
    ) : (
      <SettingsPanel
        settings={settings}
        busy={busy}
        onTheme={(theme) => {
          if (pin !== null) applySetting(actions.setTheme(theme, pin));
        }}
        onDepartures={(patch) => {
          if (pin !== null) applySetting(actions.setDepartures(patch, pin));
        }}
        onFetch={fetchCalendars}
        onChangePin={changePin}
      />
    );

  return (
    <GrownupChrome
      section={section}
      onSection={change}
      onLeave={onLeave}
      waiting={waiting.length}
      strip={strip}
      onStripClose={() => {
        setToast(null);
        setRefusal(null);
        setIntent(null);
      }}
    >
      {body}
    </GrownupChrome>
  );
}

/**
 * This room is empty most of the time, and empty is the GOOD state — so it has to look finished
 * rather than broken.  A plain sentence, a muted mark, and no count: a zero is a number, and a
 * number invites you to wonder what is missing. Drawn straight on the sheet, which is already the
 * card; a card inside it would be a box with nothing in it.
 */
function EmptyQueue({
  primaryTextPx,
  secondaryTextPx,
  head = EMPTY_HEAD_WORD,
  body = EMPTY_BODY_WORD,
  glyph = 'check',
}: {
  primaryTextPx: number;
  secondaryTextPx: number;
  /** Defaulted, because the queue's own empty state is the one this was built for. */
  head?: string;
  body?: string;
  /**
   * The tick is the queue's, and ONLY the queue's. Reused for "could not read the settings"
   * it drew a check mark over a failure — a tick beside "could not" reads as "fine, then".
   */
  glyph?: GlyphName;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: px(spacePx.sm),
        padding: px(spacePx.lg),
        flex: 1,
        minHeight: 0,
      }}
    >
      <Glyph name={glyph} sizePx={iconPx.md} tone={colour.inkMuted} />
      <span style={text(primaryTextPx)}>{head}</span>
      <span style={text(secondaryTextPx, { muted: true })}>{body}</span>
    </div>
  );
}

/**
 * ONE ROW, the same shape as the chore rows a child sees (fluent.tsx's `FluentChoreCard`) —
 * left accent edge, picture, label, meta — with the two decisions at the far end.
 *
 * It is one size taller than a chore card and that is not a preference: a chore card IS a
 * tap target, where this row CONTAINS two of them, so the band's floor has to fit inside
 * the row rather than being the row.  The two are separated by the mandatory dead space, so
 * a miss between them lands on nothing.
 */
function ApprovalRow({
  item,
  meta,
  held,
  onUndo,
  onDecide,
}: {
  item: ApprovalItem;
  /** Whose, what it pays, and how long it has waited (`approvalMeta`) — or, held, what was decided. */
  meta: string;
  /** Decided and inside the undo window: the pair gives way to one Undo key. */
  held: boolean;
  onUndo: () => void;
  onDecide: (decision: ApprovalDecision) => void;
}) {
  const TYPO = useBandTypography();
  const PRIMARY_TEXT = TYPO.primaryTextPx ?? fontSizePx.bodyLarge;
  const SECONDARY_TEXT = TYPO.secondaryTextPx ?? fontSizePx.small;
  const accent = childAccentForSlot(item.sortOrder);

  return (
    <div
      data-approval-row={item.key}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: px(spacePx.sm),
        height: px(approvalRowHeightPx(TYPO.minTapPx)),
        padding: `${px(spacePx.xxs)} ${px(spacePx.xs)}`,
        background: colour.surface,
        border: `${px(strokePx.medium)} solid ${colour.border}`,
        // Whose it is, carried by the edge as well as by the face — the same two channels
        // the chore card uses, because identity never rides on one of them.
        borderLeftWidth: px(strokePx.focus),
        borderLeftColor: accent.solid,
        borderRadius: radius.md,
        boxSizing: 'border-box',
        overflow: 'hidden',
        flex: '0 0 auto',
      }}
    >
      {/*
        Fixed, not band-scaled. Every other avatar on this wall is sized for the child
        reading it; this one is read by an adult, always.
      */}
      <AccentFrame accent={accent} sizePx={iconPx.md} selected={false}>
        <AssetImage asset={item.avatar} sizePx={iconPx.md} />
      </AccentFrame>
      {/*
        What they did, as a picture. A chore brings its own; a redemption is a gift mark —
        the same one the cash-out control already uses. Two kinds of waiting thing must be
        separable by SHAPE and not only by their words (Unit G rule 4).
      */}
      {item.icon === null ? (
        <Glyph name="gift" sizePx={TYPO.secondaryIconPx} tone={colour.ink} />
      ) : (
        <AssetImage asset={item.icon} sizePx={TYPO.secondaryIconPx} />
      )}
      <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <span style={text(PRIMARY_TEXT)}>{item.labelFull}</span>
        <span style={text(SECONDARY_TEXT, { muted: true })}>{meta}</span>
      </span>
      {/*
        THE PAIR GETS ITS OWN GAP, and it is the tap gap rather than the row's: 12px between
        "Send back" and "Approve" was measured on the panel on 2026-09-10, under the 16px inert
        gutter, on the one row of this wall where a mis-tap sends a child's finished chore back.
      */}
      {held ? (
        <Pill
          word={UNDO_WORDS}
          on={false}
          solid
          live
          minTapPx={TYPO.minTapPx}
          textPx={PRIMARY_TEXT}
          onTap={onUndo}
          data={{ 'data-approval-undo': item.key }}
        />
      ) : (
        <span style={{ display: 'flex', gap: px(spacePx.tapGap), flex: '0 0 auto', height: '100%' }}>
          <DecisionButton
            decision="reject"
            word={DECISION_WORDS[item.kind].reject}
            onTap={() => {
              onDecide('reject');
            }}
          />
          <DecisionButton
            decision="approve"
            word={DECISION_WORDS[item.kind].approve}
            onTap={() => {
              onDecide('approve');
            }}
          />
        </span>
      )}
    </div>
  );
}

function DecisionButton({
  decision,
  word,
  onTap,
}: {
  decision: ApprovalDecision;
  word: string;
  onTap: () => void;
}) {
  const TYPO = useBandTypography();
  const { layout } = useWallLayout();
  const look = decision === 'reject' && layout.rejectKey === 'outline' ? REJECT_OUTLINE : DECISION_LOOK[decision];
  // 24 is not a preference: `--c-ink-inverse` on `--c-state-done-fill` is a declared-legal
  // pair only at 24px logical and above (Unit G's CONTRAST_RULES). `onSolid` is the helper
  // that already holds that floor, so the rule lives in one place. The outline key's word is
  // the same size so the pair reads as a pair.
  const wordStyle = look.solidGround
    ? { ...text(fontSizePx.bodyLarge, { weight: fontWeight.black }), ...onSolid({ onSolid: look.ink, minTextOnSolidPx: fontSizePx.bodyLarge }) }
    : { ...text(fontSizePx.bodyLarge, { weight: fontWeight.black }), color: look.ink };

  return (
    <Tappable
      enabled
      onTap={onTap}
      label={word}
      data={{ 'data-decision': decision }}
      style={tapTarget(TYPO.minTapPx, {
        height: '100%',
        gap: px(spacePx.xs),
        padding: `${px(spacePx.none)} ${px(spacePx.md)}`,
        background: look.fill,
        border: `${px(strokePx.medium)} solid ${look.edge}`,
        borderRadius: layout.rejectKey === 'solid' ? radius.pill : radius.md,
        boxShadow: controlShadow,
        flex: '0 0 auto',
      })}
    >
      <Glyph name={look.glyph} sizePx={iconPx.xs} tone={look.ink} />
      <span style={wordStyle}>{word}</span>
    </Tappable>
  );
}
