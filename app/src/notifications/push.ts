/**
 * Push notifications wiring.
 *
 * On app start (after auth) we grab an Expo push token and POST it to the
 * backend. The backend stores it per user and can then send targeted pushes
 * (retention nudges, feature announcements, streak reminders) without a
 * client change.
 *
 * The user hasn't necessarily granted permission yet — so this is safe to
 * call on every boot; it only registers if permission is already granted.
 * Backend-driven `requestPushPermission` action lets the SDUI screen ask
 * when it wants to.
 */
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { callEndpoint } from "../sdui/client";

const expoProjectId =
  (Constants.expoConfig?.extra as any)?.eas?.projectId ??
  (Constants as any).easConfig?.projectId ??
  "";

// Default handler — show alerts + play sound when a notification arrives while
// the app is foregrounded. Can be overridden by feature-specific handlers.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

let lastToken: string | null = null;

export async function registerForPushToken(): Promise<string | null> {
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return null;

    // Android needs a notification channel or the OS never displays pushes.
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "General",
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: "default",
      });
    }

    const tokenData = expoProjectId
      ? await Notifications.getExpoPushTokenAsync({ projectId: expoProjectId })
      : await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;
    if (!token || token === lastToken) return token ?? null;
    lastToken = token;

    // Best-effort — backend endpoint stores {token, platform, appVersion}.
    // Silent failure is fine; we retry on next boot.
    try {
      await callEndpoint("POST", "/v1/push/register", {
        token,
        platform: Platform.OS,
        appVersion: Constants.expoConfig?.version ?? "0.0.0",
      });
    } catch { /* silent */ }

    return token;
  } catch {
    return null;
  }
}

/** Handler for when the user taps a notification. Called once wired in SduiApp. */
export function addNotificationResponseListener(handler: (data: any) => void) {
  return Notifications.addNotificationResponseReceivedListener((res) => {
    try { handler(res.notification.request.content.data ?? {}); } catch { /* no-op */ }
  });
}
