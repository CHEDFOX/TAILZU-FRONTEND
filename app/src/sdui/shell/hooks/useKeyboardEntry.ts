import { useCallback, useEffect, useRef } from "react";
import { Linking } from "react-native";
import type { BootstrapResponse } from "../../types";
import { num, bool, str, list } from "../../knobs";
import { consumeKeyboardDeepLink, consumeKeyboardRecordRequest } from "../../../../modules/tulmi-bridge";
import { armFlow } from "../../../widgets/flow";
import { isScreenId } from "../../../security";
import type { NavItem, Phase, SetState, Ref, KbEntry } from "../types";

/** What the keyboard left in the App Group (a mic handoff, a deep link), routed and armed on the cold start and on each foreground. */
export function useKeyboardEntry({
  phase, bootRef, kbEntryRef, kbRoutedRef, pendingLinkRef, consumeKbRef, setStack,
}: {
  phase: Phase;
  bootRef: Ref<BootstrapResponse | null>;
  kbEntryRef: Ref<KbEntry>;
  kbRoutedRef: Ref<boolean>;
  pendingLinkRef: Ref<NavItem | null>;
  consumeKbRef: Ref<() => void>;
  setStack: SetState<NavItem[]>;
}) {
  /**
   * Has this user spent the free plan's words?
   *
   * The server computes it — it counts the words and it knows who has paid —
   * and sends the answer in the bootstrap, refreshed on every launch and every
   * foreground. The app only has to route on it. An entitled user is never
   * over: `quota.exceeded` already folds the entitlement in, so there is no
   * second condition here to get out of step with the server's.
   */
  const overFreeLimit = useCallback(() => bool("quota.exceeded", false), []);

  // Consume whatever the keyboard extension left in the shared App Group (a mic
  // "handoff" record request or a deep-link tombstone) and route / arm from it.
  // Returns "record" (routed to the mic-record screen), "navigated" (routed via
  // a deep link, e.g. Flow arm), or "none". Shared by BOTH the cold-start path
  // and the foreground AppState path: the keyboard can COLD-LAUNCH a terminated
  // app (or one iOS killed in the background), and on a cold launch the AppState
  // "change→active" event never fires — so without a cold-start caller, a Flow
  // "arm" tombstone is never consumed, armFlowSession never runs, the session
  // never arms, and the keyboard mic just re-opens the app forever.
  /**
   * WHAT THE APP STILL OWES, before anything the keyboard asks for may open.
   *
   * Two gates, and both must be past. The setup steps are read from the screen
   * the SERVER picked — it already decides that from the profile and the
   * device, so asking it is asking the one thing that knows. The name is read
   * from the server's own flag (profile.complete); absent, nothing is owed.
   */
  const firstRunOwed = useCallback((): { screenId: string } | null => {
    const b = bootRef.current;
    const first = b?.initialScreenId;
    if (first && list<string>("boot.firstRunGateIds", ["onboarding", "onboarding_keyboard", "onboard"]).includes(first)) {
      return { screenId: first };
    }
    const done = bool("profile.complete", true);
    // Where the name is asked (the Bots app's About you, on its You tab).
    return done ? null : { screenId: str("profile.hostScreenId", "personality") };
  }, []);

  const consumeKeyboardEntry = useCallback((): "record" | "navigated" | "none" => {
    // The stash first: boot already drained the bridge, and asking it again
    // would answer "nothing" for the very launch this exists to handle.
    const stash = kbEntryRef.current ?? null;
    kbEntryRef.current = null;
    const rec = stash ? stash.rec : consumeKeyboardRecordRequest();
    const handoffScreenId = str("kb.handoff.screenId", "keyboard_record");
    const flowArmScreenId = str("kb.flow.armScreenId", "flow_arm");
    if (rec) {
      // Fresh mic handoff. Drain the PAIRED deep-link tombstone too, so it can't
      // re-open the record screen on a later, unrelated foreground.
      if (!stash) consumeKeyboardDeepLink(num("app.keyboard.deepLinkMaxAgeMs", 45000));
      // Over the free cap, the mic is not what should open. The server will
      // refuse the dictation anyway, so arming a session and showing a
      // recording screen only walks the user into a rejection — and lands them
      // on an error toast instead of the one screen that can fix it.
      if (overFreeLimit()) {
        kbRoutedRef.current = true;
        setStack([{ screenId: str("quota.screenId", "paywall") }]);
        return "navigated";
      }
      // FIRST RUN COMES FIRST. Same shape as the free-limit check above: the
      // app opens on what is still owed, not on the recording screen.
      const owed = firstRunOwed();
      if (owed) {
        kbRoutedRef.current = true;
        setStack([{ screenId: owed.screenId }]);
        return "navigated";
      }
      kbRoutedRef.current = true;
      setStack([{
        screenId: handoffScreenId,
        params: { session: rec.sessionId, host: rec.hostApp, source: "keyboard" },
      }]);
      return "record";
    }
    const pending = stash ? stash.link : consumeKeyboardDeepLink(num("app.keyboard.deepLinkMaxAgeMs", 45000));
    if (!pending) return "none";
    if (pending === "openSettings") {
      Linking.openSettings().catch(() => {});
      return "none";
    }
    if (pending.startsWith("screen/")) {
      const screenId = pending.slice("screen/".length);
      if (screenId === flowArmScreenId) {
        // Same rule as the mic handoff: no point arming a mic whose every
        // transcript the server is going to refuse.
        if (overFreeLimit()) {
          kbRoutedRef.current = true;
          setStack([{ screenId: str("quota.screenId", "paywall") }]);
          return "navigated";
        }
        // First run first — and crucially, DO NOT ARM YET. Turning the mic on
        // and then showing the name card would leave a live microphone behind
        // a screen that says nothing about it.
        const owedFlow = firstRunOwed();
        if (owedFlow) {
          kbRoutedRef.current = true;
          setStack([{ screenId: owedFlow.screenId }]);
          return "navigated";
        }
        // Flow Session arming: the keyboard opened us here to turn the background
        // mic on. Arm it deterministically (idle window backend-tunable via
        // kb.flow.idleTimeoutMs) AND route to the backend-authored "swipe back"
        // arming screen (whose onAppear re-arms too — arm() is idempotent).
        // Arming and routing travel together, or the screen appears over a mic
        // that was never turned on.
        void armFlow();
        kbRoutedRef.current = true;
        setStack([{ screenId: flowArmScreenId }]);
        return "navigated";
      }
      if (isScreenId(screenId) && !list<string>("kb.micOnlyScreenIds", ["keyboard_record", "keyboard_primer"]).includes(screenId)) {
        // keyboard_record / keyboard_primer are mic-tap-only (owned by the
        // record-request path above); a leftover deep-link to them is stale.
        kbRoutedRef.current = true;
        setStack([{ screenId }]);
        return "navigated";
      }
    }
    return "none";
  }, [firstRunOwed, overFreeLimit]);

  useEffect(() => { consumeKbRef.current = () => { consumeKeyboardEntry(); }; }, [consumeKeyboardEntry]);

  // Cold-start keyboard entry — runs ONCE, the first time we reach "ready". The
  // AppState listener below only fires on a background→foreground transition, so
  // a terminated app cold-launched by the keyboard would otherwise never arm.
  const coldEntryDone = useRef(false);
  useEffect(() => {
    if (phase !== "ready" || coldEntryDone.current) return;
    coldEntryDone.current = true;
    const entry = consumeKeyboardEntry();
    // A deep link / push tap that arrived during cold boot was stashed above
    // (loadBoot's default [home] stack would otherwise clobber it). Apply it
    // now — unless a keyboard entry (mic handoff / flow arm) already claimed
    // this cold start, in which case the keyboard target wins.
    if (entry === "none" && pendingLinkRef.current) {
      setStack([pendingLinkRef.current]);
    }
    pendingLinkRef.current = null;
  }, [phase, consumeKeyboardEntry]);
  return consumeKeyboardEntry;
}
