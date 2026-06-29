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
 * added to that provider's "Authorized Client IDs". iOS also needs the reversed
 * iOS client id registered as a URL scheme in app.config.ts before it can
 * complete — until then the button stays hidden (isGoogleConfigured === false).
 */
export const GOOGLE_OAUTH = {
  webClientId: "PASTE_WEB_CLIENT_ID.apps.googleusercontent.com",
  iosClientId: "PASTE_IOS_CLIENT_ID.apps.googleusercontent.com",
  androidClientId: "PASTE_ANDROID_CLIENT_ID.apps.googleusercontent.com",
};

export const isGoogleConfigured = () => !GOOGLE_OAUTH.webClientId.startsWith("PASTE_");

/** Toggle phone sign-in on once an SMS provider is configured in Supabase. */
export const AUTH_METHODS = {
  enablePhone: false,
};

export interface Country {
  iso: string;
  name: string;
  dial: string;
  flag: string;
}

/**
 * Built-in dial-code list (fallback / default). Curated common set — the picker
 * searches by name or dial code. Can be replaced/extended from the backend.
 */
export const COUNTRIES: Country[] = [
  { iso: "US", name: "United States", dial: "+1", flag: "🇺🇸" },
  { iso: "IN", name: "India", dial: "+91", flag: "🇮🇳" },
  { iso: "GB", name: "United Kingdom", dial: "+44", flag: "🇬🇧" },
  { iso: "CA", name: "Canada", dial: "+1", flag: "🇨🇦" },
  { iso: "AU", name: "Australia", dial: "+61", flag: "🇦🇺" },
  { iso: "AE", name: "United Arab Emirates", dial: "+971", flag: "🇦🇪" },
  { iso: "SG", name: "Singapore", dial: "+65", flag: "🇸🇬" },
  { iso: "DE", name: "Germany", dial: "+49", flag: "🇩🇪" },
  { iso: "FR", name: "France", dial: "+33", flag: "🇫🇷" },
  { iso: "ES", name: "Spain", dial: "+34", flag: "🇪🇸" },
  { iso: "IT", name: "Italy", dial: "+39", flag: "🇮🇹" },
  { iso: "NL", name: "Netherlands", dial: "+31", flag: "🇳🇱" },
  { iso: "BR", name: "Brazil", dial: "+55", flag: "🇧🇷" },
  { iso: "MX", name: "Mexico", dial: "+52", flag: "🇲🇽" },
  { iso: "PT", name: "Portugal", dial: "+351", flag: "🇵🇹" },
  { iso: "SA", name: "Saudi Arabia", dial: "+966", flag: "🇸🇦" },
  { iso: "PK", name: "Pakistan", dial: "+92", flag: "🇵🇰" },
  { iso: "BD", name: "Bangladesh", dial: "+880", flag: "🇧🇩" },
  { iso: "ID", name: "Indonesia", dial: "+62", flag: "🇮🇩" },
  { iso: "JP", name: "Japan", dial: "+81", flag: "🇯🇵" },
  { iso: "KR", name: "South Korea", dial: "+82", flag: "🇰🇷" },
  { iso: "CN", name: "China", dial: "+86", flag: "🇨🇳" },
  { iso: "ZA", name: "South Africa", dial: "+27", flag: "🇿🇦" },
  { iso: "NG", name: "Nigeria", dial: "+234", flag: "🇳🇬" },
  { iso: "KE", name: "Kenya", dial: "+254", flag: "🇰🇪" },
  { iso: "EG", name: "Egypt", dial: "+20", flag: "🇪🇬" },
  { iso: "TR", name: "Türkiye", dial: "+90", flag: "🇹🇷" },
  { iso: "RU", name: "Russia", dial: "+7", flag: "🇷🇺" },
  { iso: "SE", name: "Sweden", dial: "+46", flag: "🇸🇪" },
  { iso: "PL", name: "Poland", dial: "+48", flag: "🇵🇱" },
];

export const pickCountry = (region: string | undefined, list: Country[] = COUNTRIES): Country => {
  const r = (region || "").toUpperCase();
  return list.find((c) => c.iso === r) || list.find((c) => c.iso === "US") || list[0];
};
