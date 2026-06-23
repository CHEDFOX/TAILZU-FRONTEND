/**
 * Supabase email auth — dependency-free.
 *
 * Talks to the Supabase Auth REST API (GoTrue) directly with fetch, mirroring
 * the lightweight style of src/api.ts. No supabase-js / native polyfills, so it
 * can't break the Expo build.
 *
 *   signUp / signInWithPassword → obtain a session
 *   getAccessToken              → a valid JWT (auto-refreshes when expired)
 *   signOut                     → clear the session
 *
 * The JWT is what the backend verifies (see tulmi/src/auth/supabase.ts) to
 * resolve the user. Google/Apple sign-in are deferred (need per-app OAuth
 * credentials) — the auth screen shows them as "coming soon".
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SUPABASE_ANON_KEY, SUPABASE_URL, SUPABASE_CONFIGURED } from "./supabaseConfig";

const SESSION_KEY = "tulmi.session";
const AUTH_BASE = `${SUPABASE_URL}/auth/v1`;

export interface AuthUser {
  id: string;
  email?: string;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** Epoch millis when the access token expires. */
  expiresAt: number;
  user: AuthUser;
}

// --- In-memory cache + subscribers ------------------------------------------

let current: Session | null = null;
let loaded = false;
const listeners = new Set<(s: Session | null) => void>();

/** Subscribe to sign-in / sign-out. Returns an unsubscribe function. */
export function onAuthChange(fn: (s: Session | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(current);
}

// --- Persistence ------------------------------------------------------------

async function persist(s: Session | null): Promise<void> {
  current = s;
  if (s) await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else await AsyncStorage.removeItem(SESSION_KEY);
  emit();
}

/** Load the stored session into memory (call once at startup). */
export async function loadSession(): Promise<Session | null> {
  if (loaded) return current;
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    current = raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    current = null;
  }
  loaded = true;
  return current;
}

export function getCurrentSession(): Session | null {
  return current;
}

// --- REST helpers -----------------------------------------------------------

function authHeaders(): Record<string, string> {
  return { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" };
}

/** Turn a GoTrue error response into a human message. */
async function errorMessage(res: Response): Promise<string> {
  try {
    const j = await res.json();
    return j.error_description || j.msg || j.message || j.error || `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: string; email?: string };
}

function sessionFrom(t: TokenResponse): Session {
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    // Refresh a minute early to avoid edge-of-expiry failures.
    expiresAt: Date.now() + (t.expires_in - 60) * 1000,
    user: { id: t.user.id, email: t.user.email },
  };
}

// --- Public auth API --------------------------------------------------------

/**
 * Create an account. Depending on the project's settings, Supabase may require
 * email confirmation before a session is issued — in that case there is no
 * session yet and we surface a "check your email" message.
 */
export async function signUp(
  email: string,
  password: string,
): Promise<{ session: Session | null; needsConfirmation: boolean }> {
  ensureConfigured();
  const res = await fetch(`${AUTH_BASE}/signup`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  const data = (await res.json()) as Partial<TokenResponse>;
  if (data.access_token && data.refresh_token && data.user) {
    const session = sessionFrom(data as TokenResponse);
    await persist(session);
    return { session, needsConfirmation: false };
  }
  // No token → email confirmation is required for this project.
  return { session: null, needsConfirmation: true };
}

export async function signInWithPassword(email: string, password: string): Promise<Session> {
  ensureConfigured();
  const res = await fetch(`${AUTH_BASE}/token?grant_type=password`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  const session = sessionFrom((await res.json()) as TokenResponse);
  await persist(session);
  return session;
}

/** Send a password-reset email. */
export async function resetPassword(email: string): Promise<void> {
  ensureConfigured();
  const res = await fetch(`${AUTH_BASE}/recover`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
}

export async function signOut(): Promise<void> {
  const token = current?.accessToken;
  // Best-effort server-side revoke; local clear always happens.
  if (token) {
    try {
      await fetch(`${AUTH_BASE}/logout`, {
        method: "POST",
        headers: { ...authHeaders(), Authorization: `Bearer ${token}` },
      });
    } catch {
      /* ignore network errors on logout */
    }
  }
  await persist(null);
}

/** Exchange the refresh token for a fresh access token. */
async function refresh(): Promise<Session | null> {
  if (!current?.refreshToken) return null;
  try {
    const res = await fetch(`${AUTH_BASE}/token?grant_type=refresh_token`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ refresh_token: current.refreshToken }),
    });
    if (!res.ok) {
      // Refresh token is invalid/expired → force a re-login.
      await persist(null);
      return null;
    }
    const session = sessionFrom((await res.json()) as TokenResponse);
    await persist(session);
    return session;
  } catch {
    return null; // network blip: keep the current session, caller falls back
  }
}

/**
 * A valid access token, refreshing if it's expired. Returns null when there is
 * no session (caller can fall back to dev mode / show the auth gate).
 */
export async function getAccessToken(): Promise<string | null> {
  if (!loaded) await loadSession();
  if (!current) return null;
  if (Date.now() >= current.expiresAt) {
    const refreshed = await refresh();
    return refreshed?.accessToken ?? current?.accessToken ?? null;
  }
  return current.accessToken;
}

function ensureConfigured() {
  if (!SUPABASE_CONFIGURED) {
    throw new Error("Sign-in isn't configured yet. Add your Supabase URL + anon key.");
  }
}
