/**
 * SDUI transport. Talks to the Experience service (/v1/app/*) with the same
 * base URL + Supabase auth as src/api.ts.
 *
 * The bootstrap and its disk copy (bootstrap.ts), screens and their caches
 * (screens.ts), what this build declares about itself (capabilities.ts), the
 * request plumbing (http.ts) and how failures are worded (errors.ts), the
 * sign-in screen's config (authConfig.ts), the generic call behind the
 * callEndpoint action (endpoint.ts), the update check (updates.ts) and the
 * keyboard's credentials (keyboard.ts).
 */
export { APP_VERSION } from "./version";
export { syncKeyboardCredentials } from "./keyboard";
export { token, commonHeaders } from "./http";
export { QuotaExceededError, HttpError, userErrorMessage, streamErrorMessage, errorDetail } from "./errors";
export { reportUpdateCheck } from "./updates";
export { LAST_BOOT_NOTE } from "./capabilities";
export {
  peekBootstrap, markKnobsPrimed, primeKnobsFromDisk, bootstrap, expireBootstrap, bootstrapIsFresh, forgetAccountData,
} from "./bootstrap";
export { hydrateScreenCache, peekScreen, prefetchScreens, refreshCachedScreens, invalidateScreens, fetchScreen } from "./screens";
export { fetchAuthConfig, type AuthBackground } from "./authConfig";
export { callEndpoint } from "./endpoint";
