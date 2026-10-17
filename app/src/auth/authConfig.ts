/**
 * Auth config for the sign-in gate.
 *
 * The gate runs BEFORE there's a session, so its method list is configured here
 * (structured to be fed from the backend later). Each method only shows when
 * it's actually usable:
 *   • email  — always on
 *   • phone  — AUTH_METHODS.enablePhone (needs an SMS provider in Supabase)
 *   • apple  — iOS, when available
 *   • google — when GOOGLE_OAUTH is configured (isGoogleConfigured)
 *
 * APPLE: no client ID needed — native Sign in with Apple uses the iOS bundle id
 * (com.tulmi.app). Configure it in Supabase → Authentication → Providers → Apple.
 *
 * GOOGLE: three OAuth 2.0 client IDs from Google Cloud (one project), via
 * expo-auth-session (NOT the native google-signin pod). The WEB client id +
 * secret go in Supabase → Providers → Google; the iOS + Android client ids are
 * added to that provider's "Authorized Client IDs".
 *
 * THE WAY BACK. On a native build the provider redirects Google to
 * `com.tulmi.app:/oauthredirect` — the application id as a custom scheme — on
 * BOTH platforms, and the app has to claim that scheme (app.config.ts: the
 * top-level `scheme` array for Android, CFBundleURLTypes for iOS) or the
 * browser has nowhere to go after consent. On Android that looked like being
 * dropped on google.com. Claiming a scheme is a manifest change, so it needs
 * a new build, not an OTA.
 *
 * THE WAY BACK WITHOUT A BUILD. The backend can switch Android onto Supabase's
 * own OAuth page instead (AUTH_GOOGLE_WEB, served as flags["auth.googleWeb"]):
 * Supabase finishes Google with the web client secret it already holds, lands
 * on a backend page, and that page hands the session to tulmi://auth/callback
 * — which every build has always claimed. That path is JavaScript only, so it
 * ships as an OTA. See onGoogle in AuthGateScreen. A build that claims the
 * scheme (1.0.1 and later) ignores the bridge and goes native — decided from
 * the binary's own config, not from the backend — because native is the flow
 * that shows "Tailzu" on Google's consent screen rather than a domain.
 *
 * The Android client in Google Cloud is bound to the package name AND the
 * SHA-1 of the SIGNING certificate. A Play build is signed by Play App Signing,
 * whose certificate is not the upload key's — its SHA-1 is under Play Console →
 * Setup → App signing. If sign-in still fails after the scheme is claimed, that
 * fingerprint is the next thing to check, and Google says so with a visible
 * error page rather than a silent bounce.
 */
import { bool, list, str } from "../sdui/knobs";

/**
 * Everything below is a knob, read when it is USED rather than when this file
 * loads, so the server's values apply the moment a bootstrap is in hand (the
 * sign-in screen fetches one; App.tsx primes the last one from disk). Getters,
 * so every existing `GOOGLE_OAUTH.webClientId` read keeps working unchanged.
 */
export const GOOGLE_OAUTH = {
  get webClientId(): string {
    return str("auth.google.webClientId", "276376169707-t4e6u8pd27o9cdm1ffm0619m6e0on8up.apps.googleusercontent.com");
  },
  get iosClientId(): string {
    return str("auth.google.iosClientId", "276376169707-29fkjccf3kp8t46nlnnfpvml6i4um9h7.apps.googleusercontent.com");
  },
  get androidClientId(): string {
    return str("auth.google.androidClientId", "276376169707-9u6js1ir1ti74ac1pee4ld434ju598s2.apps.googleusercontent.com");
  },
};

export const isGoogleConfigured = () =>
  !!GOOGLE_OAUTH.webClientId && !GOOGLE_OAUTH.webClientId.startsWith("PASTE_");

/** Phone sign-in: the server switches it on once an SMS provider is live. */
export const AUTH_METHODS = {
  get enablePhone(): boolean { return bool("auth.enablePhone", false); },
  /** Whether a code may CREATE an account, or only sign in to one. */
  get allowSignup(): boolean { return bool("auth.allowSignup", true); },
};

/**
 * Cloudflare Turnstile — the bot challenge in front of the auth endpoints.
 *
 * The site key is PUBLIC, like the Supabase anon key beside it. The secret half
 * goes in Supabase → Authentication → Attack Protection, and never here.
 *
 * `origin` is what the hidden WebView reports as its domain. A Turnstile key is
 * bound to a domain list, and a page built from a string has no domain of its
 * own, so this value must be one of the domains on the key.
 *
 * Empty siteKey = no challenge, and every auth call goes out without a token —
 * exactly today's behaviour. Fill it in (the server's auth.turnstile.siteKey)
 * AND turn on Attack Protection, in that order: enabling Supabase first rejects
 * every sign-in, including yours.
 */
export const TURNSTILE = {
  get siteKey(): string { return str("auth.turnstile.siteKey", ""); },
  get origin(): string { return str("auth.turnstile.origin", "https://tailzu.space"); },
};

export interface Country {
  iso: string;
  name: string;
  dial: string;
  flag: string;
}

/**
 * The dial-code list the phone picker offers — the server's (auth.countries),
 * with this curated common set as the fallback. The picker searches by name or
 * dial code.
 */
export function countries(): Country[] {
  const l = list<Country>("auth.countries", [
    { "iso": "US", "name": "United States", "dial": "+1", "flag": "🇺🇸" },
    { "iso": "IN", "name": "India", "dial": "+91", "flag": "🇮🇳" },
    { "iso": "GB", "name": "United Kingdom", "dial": "+44", "flag": "🇬🇧" },
    { "iso": "CA", "name": "Canada", "dial": "+1", "flag": "🇨🇦" },
    { "iso": "AU", "name": "Australia", "dial": "+61", "flag": "🇦🇺" },
    { "iso": "AE", "name": "United Arab Emirates", "dial": "+971", "flag": "🇦🇪" },
    { "iso": "SG", "name": "Singapore", "dial": "+65", "flag": "🇸🇬" },
    { "iso": "DE", "name": "Germany", "dial": "+49", "flag": "🇩🇪" },
    { "iso": "FR", "name": "France", "dial": "+33", "flag": "🇫🇷" },
    { "iso": "ES", "name": "Spain", "dial": "+34", "flag": "🇪🇸" },
    { "iso": "IT", "name": "Italy", "dial": "+39", "flag": "🇮🇹" },
    { "iso": "NL", "name": "Netherlands", "dial": "+31", "flag": "🇳🇱" },
    { "iso": "BR", "name": "Brazil", "dial": "+55", "flag": "🇧🇷" },
    { "iso": "MX", "name": "Mexico", "dial": "+52", "flag": "🇲🇽" },
    { "iso": "PT", "name": "Portugal", "dial": "+351", "flag": "🇵🇹" },
    { "iso": "SA", "name": "Saudi Arabia", "dial": "+966", "flag": "🇸🇦" },
    { "iso": "PK", "name": "Pakistan", "dial": "+92", "flag": "🇵🇰" },
    { "iso": "BD", "name": "Bangladesh", "dial": "+880", "flag": "🇧🇩" },
    { "iso": "ID", "name": "Indonesia", "dial": "+62", "flag": "🇮🇩" },
    { "iso": "JP", "name": "Japan", "dial": "+81", "flag": "🇯🇵" },
    { "iso": "KR", "name": "South Korea", "dial": "+82", "flag": "🇰🇷" },
    { "iso": "CN", "name": "China", "dial": "+86", "flag": "🇨🇳" },
    { "iso": "ZA", "name": "South Africa", "dial": "+27", "flag": "🇿🇦" },
    { "iso": "NG", "name": "Nigeria", "dial": "+234", "flag": "🇳🇬" },
    { "iso": "KE", "name": "Kenya", "dial": "+254", "flag": "🇰🇪" },
    { "iso": "EG", "name": "Egypt", "dial": "+20", "flag": "🇪🇬" },
    { "iso": "TR", "name": "Türkiye", "dial": "+90", "flag": "🇹🇷" },
    { "iso": "RU", "name": "Russia", "dial": "+7", "flag": "🇷🇺" },
    { "iso": "SE", "name": "Sweden", "dial": "+46", "flag": "🇸🇪" },
    { "iso": "PL", "name": "Poland", "dial": "+48", "flag": "🇵🇱" }
  ]);
  // A malformed server list must not empty the picker.
  const ok = l.filter((c) => c && typeof c.iso === "string" && typeof c.dial === "string");
  return ok.length ? ok : [{ iso: "US", name: "United States", dial: "+1", flag: "🇺🇸" }];
}

export const pickCountry = (region: string | undefined, list: Country[] = countries()): Country => {
  const r = (region || "").toUpperCase();
  const fallback = str("auth.defaultCountry", "US");
  return list.find((c) => c.iso === r) || list.find((c) => c.iso === fallback) || list[0];
};
