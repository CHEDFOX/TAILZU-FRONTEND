import { useCallback, useEffect, useRef } from "react";
import type { NavItem, SetState, Ref } from "../types";

/** The backend's arrival prompt, held until the user is plainly idle. */
export function useArrivalPrompt({ readyRef, setStack }: { readyRef: Ref<boolean>; setStack: SetState<NavItem[]> }) {
  /**
   * The backend's arrival prompt, held until the user is plainly idle.
   *
   * A card that appears the moment the app opens interrupts whatever brought
   * the user here. So it is armed, not shown: after the delay it appears only
   * if they are still sitting on the screen they landed on, having neither
   * navigated nor switched tabs. Anyone who started doing something never
   * sees it, and the server will ask again on a later launch.
   *
   * The timer is cancelled on any navigation and on unmount, so a dismissed
   * or superseded prompt can never surface later on top of unrelated work.
   */
  const promptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const promptIdleRef = useRef(false);

  const cancelArrivalPrompt = useCallback(() => {
    promptIdleRef.current = false;
    if (promptTimer.current) {
      clearTimeout(promptTimer.current);
      promptTimer.current = null;
    }
  }, []);

  const armArrivalPrompt = useCallback((screenId: string, afterMs: number) => {
    cancelArrivalPrompt();
    promptIdleRef.current = true;
    promptTimer.current = setTimeout(() => {
      promptTimer.current = null;
      // Still untouched? Then this is a pause, and the card is welcome.
      if (!promptIdleRef.current || !readyRef.current) return;
      promptIdleRef.current = false;
      setStack((cur) => (cur.length === 1 ? [...cur, { screenId }] : cur));
    }, Math.max(0, afterMs));
  }, [cancelArrivalPrompt]);

  useEffect(() => cancelArrivalPrompt, [cancelArrivalPrompt]);
  return { cancelArrivalPrompt, armArrivalPrompt };
}
