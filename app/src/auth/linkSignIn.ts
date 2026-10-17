/**
 * Starting and finishing a sign-in that comes back through a link — Google
 * by way of Supabase's page, or a mailed link when a template sends one.
 *
 * The rules are in ./linkState.ts (tested there). This is the part that
 * touches the phone: where the pending state is kept, and what spending an
 * accepted link means. Both the auth screen (the browser session's own
 * result) and SduiApp's link listener (every other way a link arrives,
 * including a cold start) come through redeemSignInLink, so there is exactly
 * one door and it checks the same things for everyone.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { supabaseAuth } from "./supabaseClient";
import { getBaseUrl } from "../storage";
import { makeRedeemer, mintState, newPending, withState } from "./linkState";

export type { RedeemResult } from "./linkState";

// AsyncStorage, not memory: Android may kill the app while the browser is in
// front, and the link then arrives on a cold start. Not SecureStore either —
// a state is a nonce, not a secret, and one that outlived an uninstall in the
// Keychain would be worse than useless.
const KEY = "tulmi.auth.pendingState";

/** Mint this phone's state for a flow about to leave the app, and keep it. */
export async function beginLinkSignIn(): Promise<string> {
  const state = mintState(Crypto.getRandomBytes(32));
  await AsyncStorage.setItem(KEY, JSON.stringify(newPending(state, Date.now())));
  return state;
}

/**
 * Where a mailed sign-in link should come back to: the backend's callback
 * page, with a fresh state. Only matters if a template mails a link instead
 * of a code; Supabase ignores it (Site URL) unless it is on the allow-list.
 */
export async function emailLinkRedirect(): Promise<string> {
  const state = await beginLinkSignIn();
  return withState(`${await getBaseUrl()}/auth/callback`, state);
}

export const redeemSignInLink = makeRedeemer({
  signedIn: async () => !!(await supabaseAuth.getSession()).data.session,
  readPending: () => AsyncStorage.getItem(KEY),
  clearPending: () => AsyncStorage.removeItem(KEY),
  spend: (link) =>
    link.kind === "code"
      ? supabaseAuth.exchangeCode(link.code)
      : link.kind === "session"
        ? supabaseAuth.setSession(link.accessToken, link.refreshToken)
        : supabaseAuth.verifyLinkToken(link.tokenHash, link.type),
  now: () => Date.now(),
});
