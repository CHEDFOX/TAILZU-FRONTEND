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
const KEY_LANGUAGE = "tulmi.language";

export async function getLanguage(): Promise<string | null> {
  return AsyncStorage.getItem(KEY_LANGUAGE);
}

export async function setLanguage(code: string): Promise<void> {
  await AsyncStorage.setItem(KEY_LANGUAGE, code);
}
