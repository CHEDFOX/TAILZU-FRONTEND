import { getBaseUrl } from "../../storage";
import { getSupabaseAccessToken as getAccessToken } from "../../auth/supabaseClient";
import { setKeyboardCredentials } from "../../../modules/tulmi-bridge";

/**
 * Share the current backend URL + the user's token with the native keyboard
 * extension so the keyboard reaches the same backend and authenticates as the
 * user. Safe to call often; no-op in Expo Go.
 *
 * Signed out, the token is EMPTY, which clears it: both keyboards send no
 * credential then and say so. This wrote "dev" — a token the production
 * server can only refuse, which made a signed-out keyboard look like one whose
 * session had expired (the keyboards dropped their own "dev" for that reason).
 */
export async function syncKeyboardCredentials(): Promise<void> {
  try {
    const [base, tok] = await Promise.all([getBaseUrl(), getAccessToken()]);
    setKeyboardCredentials(base, tok ?? "");
  } catch {
    // best-effort: never block the app on bridging
  }
}
