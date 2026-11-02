import { useCallback, useEffect, useRef } from "react";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";
import { haptic } from "../../sdui/components/haptic";
import { supabaseAuth } from "../supabaseClient";
import { parseLink } from "../../deeplinks/router";
import { beginLinkSignIn, redeemSignInLink } from "../linkSignIn";
import { withState } from "../linkState";
import { str, txt } from "../../sdui/knobs";
import { authFailed } from "./authFailed";

/** Sign in with Google: the native client, or Supabase's page on Android when this build cannot come back on its own scheme. */
export function useGoogleSignIn({ googlePrompt, googleRequest, googleResponse, googleViaWeb, googleWeb, flashError, onAuthed }: {
  googlePrompt: ReturnType<typeof Google.useIdTokenAuthRequest>[2];
  googleRequest: ReturnType<typeof Google.useIdTokenAuthRequest>[0];
  googleResponse: ReturnType<typeof Google.useIdTokenAuthRequest>[1];
  googleViaWeb: boolean;
  googleWeb: { callback: string; resume: string } | null;
  flashError: () => void;
  onAuthed: () => void;
}) {
  const onGoogle = useCallback(async () => {
    try {
      haptic(str("app.haptics.auth.google", "light"));
      if (googleViaWeb && googleWeb) {
        // Supabase's page, in an auth session so the browser hands the result
        // back. The redirect carries THIS PHONE's state; the backend page
        // refuses a return without one and bounces the rest to tulmi://auth/
        // callback, with the state and a PKCE code. The link listener in
        // SduiApp receives the same URL: both go through redeemSignInLink,
        // which spends the code once and gives both callers the one answer.
        const state = await beginLinkSignIn();
        const { data, error } = await supabaseAuth.signInWithGoogleWeb(withState(googleWeb.callback, state));
        if (error || !data?.url) throw new Error(String(error?.message ?? "Could not start Google sign-in."));
        const res = await WebBrowser.openAuthSessionAsync(data.url, googleWeb.resume);
        if (res.type !== "success") return;                 // closed it — silent
        const target = parseLink(res.url);
        if (target.kind === "code" || target.kind === "session" || target.kind === "auth") {
          const r = await redeemSignInLink(target);
          if (!r.ok) throw new Error(r.message ?? `Google sign-in could not be finished (${r.verdict}).`);
          onAuthed();
          return;
        }
        // Supabase reports a refused sign-in in the query, and the page
        // forwards the query as-is. Say what it said.
        const q = new URL(res.url.replace(/^tulmi:\/\//, "https://x/")).searchParams;
        throw new Error(q.get("error_description") || q.get("error") || "Google didn't return a session.");
      }
      // Opens the Google consent sheet. On native the resolved value only
      // carries the authorization code — the id_token lands in googleResponse
      // after expo-auth-session's background code exchange, so completion is
      // handled by the effect below.
      await googlePrompt();
    } catch (e: any) {
      flashError();
      authFailed(
        txt("auth.google.errorTitle", "Couldn't sign in with Google"),
        txt("auth.google.errorBody", "Google sign-in didn't go through. Try again, or use your email."),
        e,
      );
    }
  }, [googlePrompt, flashError, googleViaWeb, googleWeb, onAuthed]);

  // Completes Google sign-in once the hook delivers the exchanged tokens.
  // Errors get a visible reason — a silent shake made every failure
  // (misconfigured Supabase provider, missing id_token, network) look identical.
  const googleHandled = useRef<unknown>(null);
  useEffect(() => {
    if (!googleResponse || googleHandled.current === googleResponse) return;
    googleHandled.current = googleResponse;
    if (googleResponse.type === "error") {
      flashError();
      authFailed(
        txt("auth.google.errorTitle", "Couldn't sign in with Google"),
        txt("auth.google.errorBody", "Google sign-in didn't go through. Try again, or use your email."),
        googleResponse.error ?? txt("auth.error.oauth", "OAuth error"),
      );
      return;
    }
    if (googleResponse.type !== "success") return; // cancel / dismiss — silent
    const idToken = (googleResponse.params as Record<string, string> | undefined)?.id_token
      || googleResponse.authentication?.idToken;
    if (!idToken) {
      flashError();
      authFailed(
        txt("auth.google.errorTitle", "Couldn't sign in with Google"),
        txt("auth.google.errorBody", "Google sign-in didn't go through. Try again, or use your email."),
        txt("auth.error.noIdentityToken", "Google didn't return an identity token."),
      );
      return;
    }
    (async () => {
      // The id_token echoes the request's nonce (when one was used) — Supabase
      // rejects the token unless that same nonce is passed alongside it.
      const { error } = await supabaseAuth.signInWithGoogle(idToken, googleRequest?.nonce ?? undefined);
      if (error) {
        flashError();
        authFailed(
          txt("auth.google.errorTitle", "Couldn't sign in with Google"),
          txt("auth.google.errorBody", "Google sign-in didn't go through. Try again, or use your email."),
          error,
        );
        return;
      }
      onAuthed();
    })().catch((e: any) => {
      flashError();
      authFailed(
        txt("auth.google.errorTitle", "Couldn't sign in with Google"),
        txt("auth.google.errorBody", "Google sign-in didn't go through. Try again, or use your email."),
        e ?? txt("auth.error.network", "Network error"),
      );
    });
  }, [googleResponse, googleRequest, flashError, onAuthed]);
  return onGoogle;
}
