import { useCallback } from "react";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import { haptic } from "../../sdui/components/haptic";
import { supabaseAuth } from "../supabaseClient";
import { callEndpoint } from "../../sdui/client";
import { str, txt } from "../../sdui/knobs";
import { authFailed } from "./authFailed";

/** Sign in with Apple: a hashed nonce, the native sheet, the session, and Apple's one-time code for the server. */
export function useAppleSignIn({ flashError, onAuthed }: {
  flashError: () => void;
  onAuthed: () => void;
}) {
  const onApple = useCallback(async () => {
    try {
      haptic(str("app.haptics.auth.apple", "light"));
      // The nonce is what stops a captured Apple identity token from being
      // replayed, so it has to be unguessable: Math.random() is not.
      const raw = Crypto.randomUUID();
      const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw);
      const cred = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashed,
      });
      if (!cred.identityToken) throw new Error("no identity token");
      // The name Apple shares, given only on this Apple ID's first sign-in to the app: kept on the account (supabaseClient.ts).
      const name = [cred.fullName?.givenName, cred.fullName?.middleName, cred.fullName?.familyName].filter(Boolean).join(" ");
      const { error } = await supabaseAuth.signInWithApple(cred.identityToken, raw, name || undefined);
      if (error) {
        flashError();
        authFailed(
          txt("auth.apple.errorTitle", "Couldn't sign in with Apple"),
          txt("auth.apple.errorBody", "Apple sign-in didn't go through. Try again, or use your email."),
          error,
        );
        return;
      }
      // Apple's one-time code, for the server to trade for the token that lets it end this Apple sign-in when the account is
      // deleted (Apple asks that of every app with Sign in with Apple). Only the phone ever has it, for five minutes. Never in the way.
      if (cred.authorizationCode) void callEndpoint("POST", "/v1/auth/apple/code", { code: cred.authorizationCode }).catch(() => undefined);
      onAuthed();
    } catch (e: any) {
      if (e?.code !== "ERR_REQUEST_CANCELED") {
        flashError();
        authFailed(
          txt("auth.apple.errorTitle", "Couldn't sign in with Apple"),
          txt("auth.apple.errorBody", "Apple sign-in didn't go through. Try again, or use your email."),
          e,
        );
      }
    }
  }, [flashError, onAuthed]);
  return onApple;
}
