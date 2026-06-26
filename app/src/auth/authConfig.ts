/**
 * OAuth config for social sign-in.
 *
 * APPLE: no client ID needed here — native Sign in with Apple uses the iOS
 * bundle id (com.tulmi.app). Configure it in Supabase → Authentication →
 * Providers → Apple (Services ID, Team ID, Key ID, .p8).
 *
 * GOOGLE: three OAuth 2.0 client IDs from Google Cloud (one project). The WEB
 * client id + secret go in Supabase → Providers → Google; the iOS + Android
 * client ids are added to that provider's "Authorized Client IDs" list so native
 * id-tokens are accepted. iOS also needs the reversed iOS client id registered
 * as a URL scheme in app.config.ts.
 */
export const GOOGLE_OAUTH = {
  webClientId: "PASTE_WEB_CLIENT_ID.apps.googleusercontent.com",
  iosClientId: "PASTE_IOS_CLIENT_ID.apps.googleusercontent.com",
  androidClientId: "PASTE_ANDROID_CLIENT_ID.apps.googleusercontent.com",
};

export const isGoogleConfigured = () => !GOOGLE_OAUTH.webClientId.startsWith("PASTE_");
