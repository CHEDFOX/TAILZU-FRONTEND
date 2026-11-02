import { useEffect } from "react";
import { AccessibilityInfo } from "react-native";
import * as onboardBus from "../../../onboard/stageBus";
import type { ScreenResponse } from "../../types";
import type { Phase } from "../types";

/** Where the app is, for Blip's overlay (onboard/stageBus), and the phone's Reduce Motion. */
export function useBlipPhase({
  phase, shown, screenError,
}: {
  phase: Phase;
  shown: ScreenResponse | null;
  screenError: string | null;
}) {
  /**
   * WHERE THE APP IS, FOR BLIP.
   *
   * Blip is one character drawn above everything (onboard/BlipHost), and he
   * must not blink when the app swaps trees: the sign-in gate goes, the first
   * screen is fetched, the screen is drawn. This tells his overlay which of
   * those moments it is, so it can keep the paper and his last pose up through
   * "auth", "loading" and the wait for a screen, and let go (a 200 ms fade)
   * the moment the app settles somewhere that is not onboarding. Nothing here
   * draws anything or changes what the app does.
   */
  useEffect(() => {
    onboardBus.setAppPhase(onboardBus.appPhaseFor({
      phase,
      hasScreen: !!shown,
      rootType: shown?.root?.type,
      // No screen and an error is the "Couldn't load this screen" card: let go
      // of the paper so the card and its Retry button can be seen.
      failed: !!screenError,
    }));
  }, [phase, shown, screenError]);

  // Someone who asked the phone for less motion gets a fade and no walk.
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then((on) => { if (alive) onboardBus.setReduced(!!on); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.("reduceMotionChanged", (on) => onboardBus.setReduced(!!on));
    return () => { alive = false; sub?.remove?.(); };
  }, []);
}
