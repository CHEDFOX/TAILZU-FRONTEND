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
  /** Email OTP — sends a 6-digit code (template must use {{ .Token }}). */
  sendEmailCode: (email: string) =>
    supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } }),
  verifyEmailCode: (email: string, token: string) =>
    supabase.auth.verifyOtp({ email, token, type: "email" }),

  /** Phone OTP (needs an SMS provider configured in Supabase). */
  sendPhoneCode: (phone: string) => supabase.auth.signInWithOtp({ phone }),
  verifyPhoneCode: (phone: string, token: string) =>
    supabase.auth.verifyOtp({ phone, token, type: "sms" }),

  /** Native Sign in with Apple (identity token + nonce). */
  signInWithApple: (identityToken: string, nonce?: string) =>
    supabase.auth.signInWithIdToken({ provider: "apple", token: identityToken, nonce }),

  /** Google (id token from native Google sign-in). */
  signInWithGoogle: (idToken: string) =>
    supabase.auth.signInWithIdToken({ provider: "google", token: idToken }),

  getSession: () => supabase.auth.getSession(),
  getUser: () => supabase.auth.getUser(),
  signOut: () => supabase.auth.signOut(),
  onAuthStateChange: (cb: (event: string, session: Session | null) => void) =>
    supabase.auth.onAuthStateChange(cb),
};

/** The current access token (Supabase JWT) for API/WS auth, or null. */
export async function getSupabaseAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
