import { useEffect } from "react";
import { fetchScreen, peekScreen, userErrorMessage, errorDetail } from "../../client";
import type { ScreenResponse } from "../../types";
import type { NavItem, Phase, SetState } from "../types";

/** The screen on top of the stack: drawn from the cache at once, revalidated behind it, an error card when it never loaded. */
export function useCurrentScreen({
  phase, current, reload, online, setScreen, setScreenError, setScreenLoading,
}: {
  phase: Phase;
  current: NavItem | undefined;
  reload: number;
  online: boolean | null;
  setScreen: SetState<ScreenResponse | null>;
  setScreenError: SetState<string | null>;
  setScreenLoading: SetState<boolean>;
}) {
  // Fetch the current screen whenever the top of the stack (or reload) changes.
  // On failure we surface a visible error state with a retry button instead of
  // silently keeping the previous (or empty) screen — the old behavior looked
  // identical to a successful empty render, which is what surfaced as "Home
  // and Settings are blank" in the field.
  useEffect(() => {
    if (phase !== "ready" || !current) return;
    let alive = true;
    // Show what we already have INSTANTLY, then revalidate behind it. A screen
    // the user has opened before should not make them wait on the network to
    // see it again; that wait is the whole of "the app feels slow".
    const cached = peekScreen(current.screenId, current.params);
    if (cached) {
      setScreen(cached.screen);
      setScreenError(null);
      // Fresh enough to trust — don't refetch at all.
      if (!cached.stale || online === false) { setScreenLoading(false); return; }
    }
    setScreenLoading(true);
    setScreenError(null);
    fetchScreen(current.screenId, current.params)
      .then((s) => {
        if (!alive) return;
        setScreen(s);
        setScreenError(null);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        // We DON'T reset `screen` to null on error — if the user had a valid
        // previous render we keep it visible and layer the retry banner on
        // top. Only when there was NEVER a successful load do we render a
        // full-screen error card (handled in the render section below).
        //
        // The card shows words, not "/v1/app/screen → 500": the raw detail
        // is for the log, the person gets the server's error.* copy.
        console.warn(`[screen] ${current.screenId}: ${errorDetail(err)}`);
        setScreenError(userErrorMessage(err));
      })
      .finally(() => alive && setScreenLoading(false));
    return () => {
      alive = false;
    };
  }, [phase, current, reload, online]);
}
