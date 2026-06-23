/**
 * Local settings (AsyncStorage). The backend base URL is switchable so the same
 * build can point at your PC during testing or your VPS in production.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY_BASE_URL = "tulmi.baseUrl";

// Default for testing:
//  - Android emulator reaches your PC's localhost at 10.0.2.2
//  - On a physical phone, change this (in the app's Settings) to your PC's LAN
//    IP (e.g. http://192.168.1.20:8770) or your VPS URL (https://...).
export const DEFAULT_BASE_URL = "http://10.0.2.2:8770";

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
