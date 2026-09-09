/**
 * Supabase auth client for Tulmi — the Plutto-style flow.
 *
 * Methods: email OTP (6-digit code), phone OTP (SMS), Apple + Google id-token
 * sign-in. Sessions persist in SecureStore via a chunked adapter (a Supabase
 * session is larger than SecureStore's ~2048-byte per-value limit, so we split
 * it across keys and reassemble).
 *
 * Wiring:
 *   - Email codes are delivered by Supabase SMTP (point it at Resend — see
 *     STREAMING/AUTH setup). Make the email template use {{ .Token }} so the
 *     user gets a 6-digit CODE, not a magic link.
 *   - Phone OTP needs an SMS provider (Twilio/MessageBird) in Supabase.
 *   - Apple/Google need their providers enabled in Supabase + the client IDs in
 *     ./authConfig.ts.
 */
import "react-native-url-polyfill/auto";
import { createClient, type Session } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseConfig";

// SecureStore caps values at ~2048 bytes; Supabase sessions exceed that. Split
// large values across `${key}__0..n` with a `${key}__n` count, falling back to
// the legacy single key so already-signed-in users aren't logged out.
const CHUNK = 1800;
const ChunkedSecureStore = {
  getItem: async (key: string): Promise<string | null> => {
    const countRaw = await SecureStore.getItemAsync(`${key}__n`).catch(() => null);
    if (countRaw == null) return SecureStore.getItemAsync(key).catch(() => null);
    const n = parseInt(countRaw, 10) || 0;
    let out = "";
    for (let i = 0; i < n; i++) {
      const part = await SecureStore.getItemAsync(`${key}__${i}`).catch(() => null);
      if (part == null) return null;
      out += part;
    }
    return out || null;
  },
  setItem: async (key: string, value: string): Promise<void> => {
    const v = value == null ? "" : String(value);
    const chunks: string[] = [];
    for (let i = 0; i < v.length; i += CHUNK) chunks.push(v.slice(i, i + CHUNK));
    if (!chunks.length) chunks.push("");
    for (let i = 0; i < chunks.length; i++) await SecureStore.setItemAsync(`${key}__${i}`, chunks[i]);
    await SecureStore.setItemAsync(`${key}__n`, String(chunks.length));
    for (let i = chunks.length; i < chunks.length + 8; i++) {
      await SecureStore.deleteItemAsync(`${key}__${i}`).catch(() => {});
    }
    await SecureStore.deleteItemAsync(key).catch(() => {});
  },
  removeItem: async (key: string): Promise<void> => {
    const countRaw = await SecureStore.getItemAsync(`${key}__n`).catch(() => null);
    const n = parseInt(countRaw ?? "0", 10) || 0;
    for (let i = 0; i < n + 8; i++) await SecureStore.deleteItemAsync(`${key}__${i}`).catch(() => {});
    await SecureStore.deleteItemAsync(`${key}__n`).catch(() => {});
    await SecureStore.deleteItemAsync(key).catch(() => {});
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: ChunkedSecureStore,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export const supabaseAuth = {
  /**
   * Email + password. The ONE account that signs in this way.
   *
   * App Review and Play Review both need to reach the whole app, and neither
   * reviewer can receive a code at an address they do not own. The backend
   * names the address (flags["auth.reviewEmail"]) and the app offers a password
   * field for that address alone; the password itself lives in Supabase, so
   * knowing the address grants nothing. Clearing the flag removes the path
   * without a release.
   */
  signInWithPassword: (email: string, password: string, captchaToken?: string) =>
    supabase.auth.signInWithPassword({ email, password, options: { captchaToken } }),

  /**
   * Email OTP — sends a 6-digit code.
   *
   * WHICH OF TWO TEMPLATES SENDS IT DEPENDS ON WHETHER THE ADDRESS IS NEW.
   * GoTrue routes this call by account state: an address it has never seen gets
   * "Confirm signup", one it already knows gets "Magic Link". Both default to
   * {{ .ConfirmationURL }}, and both have to be changed to {{ .Token }} — fix
   * one and the project mails codes to new users and links to returning ones,
   * which reads as random. See docs/SUPABASE.md in the backend repo.
   *
   * If a link goes out anyway, deeplinks/router.ts redeems it rather than
   * letting it dead-end.
   */
  sendEmailCode: (email: string, captchaToken?: string) =>
    supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true, captchaToken } }),
  verifyEmailCode: (email: string, token: string) =>
    supabase.auth.verifyOtp({ email, token, type: "email" }),

  /** Phone OTP — signs UP as readily as it signs in (needs an SMS provider in
   *  Supabase). `shouldCreateUser` is spelled out rather than left to the
   *  library default: this is the whole sign-up path for a phone-first user,
   *  and if it ever defaulted otherwise a new number would get "Signups not
   *  allowed for otp" instead of an account.
   *
   *  THE ONE CALL THAT COSTS MONEY. Everything else here spends a request; this
   *  spends an SMS on our Twilio account, to any number on earth, on nothing but
   *  the anon key that ships inside the app. `captchaToken` is what stands
   *  between that and a bot — see ./captcha.tsx. Undefined is accepted so the
   *  app keeps working before Attack Protection is switched on in Supabase. */
  sendPhoneCode: (phone: string, captchaToken?: string) =>
    supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: true, captchaToken } }),
  /** No captcha: GoTrue challenges the endpoints that SEND, not /verify, and
   *  asking a user to solve a second one to type a code they already have is
   *  friction that buys nothing. */
  verifyPhoneCode: (phone: string, token: string) =>
    supabase.auth.verifyOtp({ phone, token, type: "sms" }),

  /**
   * Redeem a one-time link minted by our own backend.
   *
   * The review account's code is a fixed pair held in the backend's env, so
   * nothing was ever mailed for it. The server checks the pair and returns the
   * hashed token of a magiclink; this exchanges that for a session, with the
   * ANON key, exactly as the app would redeem an emailed one. No service-role
   * credential comes anywhere near the device, and the session that lands is
   * an ordinary session with nothing special about it afterwards.
   */
  verifyTokenHash: (tokenHash: string) =>
    supabase.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" }),

  /**
   * Redeem a token hash whose TYPE came off the link, not from us.
   *
   * verifyTokenHash above is for the review account, where we mint the link and
   * therefore know it is a magiclink. A link that arrived by email could be a
   * signup confirmation instead, and GoTrue rejects a hash presented under the
   * wrong type — so the type travels with the link and is passed through.
   */
  verifyLinkToken: (tokenHash: string, type: string) =>
    supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as never }),

  /** Adopt a session GoTrue already minted and handed back in a URL. */
  setSession: (accessToken: string, refreshToken: string) =>
    supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }),

  /** Native Sign in with Apple (identity token + nonce). */
  signInWithApple: (identityToken: string, nonce?: string) =>
    supabase.auth.signInWithIdToken({ provider: "apple", token: identityToken, nonce }),

  /** Google (id token from native Google sign-in). Pass the auth request's
   *  nonce when one was used — Supabase rejects id_tokens whose nonce claim
   *  arrives without the matching raw nonce. */
  signInWithGoogle: (idToken: string, nonce?: string) =>
    supabase.auth.signInWithIdToken({ provider: "google", token: idToken, nonce }),

  getSession: () => supabase.auth.getSession(),
  getUser: () => supabase.auth.getUser(),
  signOut: () => supabase.auth.signOut(),
  /**
   * Forget the session on THIS DEVICE only, without calling the server.
   *
   * For the fresh-install case: the Keychain outlives the app, so a reinstall
   * finds a session the new install has no business holding. scope "local"
   * clears the stored copy and leaves the account alone — the tokens on the
   * server stay valid, which matters because the same account may well be
   * signed in on another device that has nothing to do with this reinstall.
   * A plain signOut() would revoke those too.
   */
  clearLocalSession: () => supabase.auth.signOut({ scope: "local" }),
  onAuthStateChange: (cb: (event: string, session: Session | null) => void) =>
    supabase.auth.onAuthStateChange(cb),
};

/** The current access token (Supabase JWT) for API/WS auth, or null. */
export async function getSupabaseAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
