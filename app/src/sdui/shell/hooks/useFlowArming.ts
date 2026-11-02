import { useCallback, useEffect } from "react";
import type { BootstrapResponse } from "../../types";
import { bool } from "../../knobs";
import { refreshDeviceSignalsBounded } from "../../../device/signals";
import { getSupabaseAccessToken } from "../../../auth/supabaseClient";
import { armFlow } from "../../../widgets/flow";
import type { Phase } from "../types";

/** The Flow Session armed as soon as the flags allow, for a signed-in user whose microphone is already allowed. */
export function useFlowArming({ phase, boot }: { phase: Phase; boot: BootstrapResponse | null }) {
  // Arm the Flow Session as soon as we have the flags, NOT only on a
  // background→foreground transition.
  //
  // AppState "change" fires on a TRANSITION. Launching the app from the home
  // screen is a cold start straight into "active" — no transition, no event, no
  // arm. So the most ordinary thing a user can do (open the app, swipe away,
  // dictate from the keyboard somewhere else) left the session unarmed, and the
  // keyboard correctly found nothing alive and reopened the app. The keyboard
  // was not being stupid; nobody had ever armed anything.
  //
  // The keyboard-initiated cold launch was already covered by its tombstone.
  // This is the same hole for a user-initiated one.
  //
  // arm() is idempotent — re-arming just refreshes the idle window — so running
  // this whenever the flags land is safe and self-healing.
  //
  // ONLY FOR A SIGNED-IN USER WHOSE MICROPHONE IS ALREADY ALLOWED. Arming opens
  // the audio session: signed out, it held the microphone in the background
  // behind the sign-in screen with nobody to transcribe for (the flag reaches
  // the app from the sign-in screen's own bootstrap and the disk copy, before
  // anyone is signed in); on a fresh install, it raised the microphone prompt
  // over the sign-in code screen. The permission is asked where it is
  // explained (onboarding, the arming screen); this only reads it.
  const armIfAllowed = useCallback(async () => {
    if (!bool("kb.flow.armOnForeground", false)) return;
    if (!(await getSupabaseAccessToken())) return;
    if (!(await refreshDeviceSignalsBounded()).micGranted) return;
    await armFlow();
  }, []);

  useEffect(() => {
    if (phase !== "ready") return;
    if (!bool("kb.flow.armOnForeground", false)) return;
    // NOT GATED ON AppState.currentState.
    //
    // iOS reports "inactive" for the first moments of a cold launch. This
    // returned on that, and its only dependency is `boot` — so a bootstrap
    // landing inside that window meant the session was never armed at all, and
    // the foreground listener below never fired either, because the app was
    // already coming up and there was no transition to hear. The first mic tap
    // then re-opened the app to arm a session this effect had silently
    // declined to arm. arm() is idempotent and cheap; running it a moment
    // early costs nothing, and declining to run it costs the whole feature.
    void (async () => {
      // MEASURED, because "the mic is not warming instantly" has two possible
      // causes and I have guessed wrong on this keyboard enough times. t0 is
      // the moment we could have armed; the two marks say which half of the
      // wait is the bootstrap and which is the token refresh
      // (supabase.auth.getSession() goes to the network when the JWT has
      // expired, which is once an hour and invisible the rest of the time).
      const t0 = Date.now();
      await armIfAllowed();
      // eslint-disable-next-line no-console
      console.log(`[flow] arm checked — ${Date.now() - t0}ms`);
    })();
  }, [boot, phase, armIfAllowed]);
  return armIfAllowed;
}
