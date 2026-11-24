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
  // Only whether we are OFFLINE re-runs the fetch. `online` starts null and turns true once the connection is first
  // read — usually while the first screen is already loading — and depending on it directly threw that fetch away
  // (alive = false) and started the same one again.
  const offline = online === false;
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
      if (!cached.stale || offline) { setScreenLoading(false); return; }
    }
    setScreenLoading(true);
    setScreenError(null);
    fetchScreen(current.screenId, current.params)
      .then((s) => {
        if (!alive) return;
        setScreenError(null);
        // The revalidation came back with what is already on screen (the usual case for a stale cached copy): keep
        // the object we have. A new one is a new Store (ScreenHost) — the field being typed in emptied and every
        // toggle went back, a beat after arriving — and a rebuild of the whole tree, for a screen that did not change.
        if (cached && sameScreen(cached.screen, s)) return;
        setScreen(s);
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
  }, [phase, current, reload, offline]);
}

/** Two copies of a screen that would draw the same thing. */
function sameScreen(a: ScreenResponse, b: ScreenResponse): boolean {
  if (a === b) return true;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}
