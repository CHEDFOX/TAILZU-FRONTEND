/**
 * Local settings (AsyncStorage). The backend base URL is switchable so the same
 * build can point at your PC during testing or your VPS in production.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY_BASE_URL = "tulmi.baseUrl";

// Default = the live production backend, so a fresh (TestFlight) install reaches
// it with no setup. Override in the app's ⚙ Connection screen to point at a PC
// (Android emulator → 10.0.2.2:8770) or LAN IP during local development.
export const DEFAULT_BASE_URL = "https://api.tailzu.space";

export async function getBaseUrl(): Promise<string> {
  const v = await AsyncStorage.getItem(KEY_BASE_URL);
  return (v ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
}

export async function setBaseUrl(url: string): Promise<void> {
  await AsyncStorage.setItem(KEY_BASE_URL, url.trim());
}

/**
 * Has this install ever run before?
 *
 * DELETING THE APP DOES NOT SIGN THE USER OUT. The Supabase session lives in
 * SecureStore, which is the iOS Keychain, and the Keychain deliberately
 * survives app deletion — so a delete-and-reinstall came back already signed
 * in, skipping the sign-in screen entirely and landing on whatever step the
 * previous install had reached. That is not what deleting an app means to
 * anybody.
 *
 * AsyncStorage is the opposite: it goes with the app. So its emptiness is the
 * signal — nothing else the app can read distinguishes a fresh install from a
 * launch.
 *
 * THE SUBTLETY, and the reason this is not a one-line flag: an install that
 * predates this sentinel has no sentinel either, and would look identical to a
 * fresh one — which would sign out every existing user exactly once, on the
 * build that shipped this. So absence of the sentinel is not enough. An app
 * that has run before has written SOMETHING (a base url, a launch count, a
 * cached bootstrap); a genuinely fresh install has written nothing at all.
 * Only the second is treated as new.
 *
 * Writes the sentinel as it goes, so this answers true at most once per
 * install however many times it is called.
 */
const KEY_INSTALLED = "tulmi.installed";

export async function isFreshInstall(): Promise<boolean> {
  try {
    if ((await AsyncStorage.getItem(KEY_INSTALLED)) === "1") return false;
    const keys = await AsyncStorage.getAllKeys();
    const ranBefore = keys.some(
      (k) => k !== KEY_INSTALLED && (k.startsWith("tulmi.") || k.startsWith("tailzu.")),
    );
    await AsyncStorage.setItem(KEY_INSTALLED, "1");
    return !ranBefore;
  } catch {
    // Unreadable storage is not evidence of a new install, and guessing wrong
    // here signs someone out for no reason.
    return false;
  }
}

// Whether the user has seen onboarding (so we show it only on first run).
const KEY_ONBOARDED = "tulmi.onboarded";

export async function getOnboarded(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEY_ONBOARDED)) === "1";
}

export async function setOnboarded(): Promise<void> {
  await AsyncStorage.setItem(KEY_ONBOARDED, "1");
}

// Whether the user has picked their language on the post-auth language screen
// (so it shows once, even if the rest of onboarding isn't finished yet).
const KEY_LAUNCHES = "tulmi.launchCount";

/**
 * Opens of this app, this one included.
 *
 * The server times its arrival prompt by familiarity — "once they have been
 * here a few times" — and familiarity is a thing only the client can count.
 * Per install, deliberately: a reinstall is a fresh acquaintance.
 */
export async function bumpLaunchCount(): Promise<number> {
  try {
    const n = Number(await AsyncStorage.getItem(KEY_LAUNCHES)) || 0;
    const next = n + 1;
    await AsyncStorage.setItem(KEY_LAUNCHES, String(next));
    return next;
  } catch {
    return 0;   // unreadable storage must never cost the boot
  }
}

const KEY_LANGUAGE = "tulmi.language";

export async function getLanguage(): Promise<string | null> {
  return AsyncStorage.getItem(KEY_LANGUAGE);
}

export async function setLanguage(code: string): Promise<void> {
  await AsyncStorage.setItem(KEY_LANGUAGE, code);
  // Mirror into the shared App Group so the iOS keyboard extension sees it
  // (STT + refine both bias off this). Bridge no-ops when not available.
  try {
    const bridge = await import("../modules/tulmi-bridge");
    bridge.setKeyboardLanguage(code);
  } catch {
    // bridge missing (Expo Go / test env) — writing to AsyncStorage is enough
  }
}

// Name captured from the auth provider (Apple gives it only on first consent),
// used to pre-fill the post-onboarding name card.
const KEY_AUTH_NAME = "tulmi.authName";

export async function getAuthName(): Promise<string | null> {
  return AsyncStorage.getItem(KEY_AUTH_NAME);
}

export async function setAuthName(name: string): Promise<void> {
  await AsyncStorage.setItem(KEY_AUTH_NAME, name.trim());
}

// Whether the user has completed the name + gender card (shown once).
const KEY_PROFILE = "tulmi.profileDone";

export async function getProfileDone(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEY_PROFILE)) === "1";
}

export async function setProfileDone(): Promise<void> {
  await AsyncStorage.setItem(KEY_PROFILE, "1");
}

/**
 * How the LAST boot ended, remembered across launches.
 *
 * A boot that hangs cannot report on itself: the code that would send the
 * report is downstream of whatever is stuck. So the app writes a breadcrumb as
 * it goes and sends the PREVIOUS launch's crumb on the next bootstrap, which is
 * the first call a launch makes and therefore always gets through.
 *
 * Diagnostic only. Nothing reads it to make a decision.
 */
const LAST_BOOT_KEY = "tailzu.lastBoot";

export async function setLastBoot(note: string): Promise<void> {
  try { await AsyncStorage.setItem(LAST_BOOT_KEY, note.slice(0, 200)); } catch { /* best effort */ }
}

export async function getLastBoot(): Promise<string | null> {
  try { return await AsyncStorage.getItem(LAST_BOOT_KEY); } catch { return null; }
}
