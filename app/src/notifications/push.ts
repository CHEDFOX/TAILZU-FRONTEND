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
import { APP_VERSION, callEndpoint } from "../sdui/client";
import { bool, str, txt } from "../sdui/knobs";

const expoProjectId =
  (Constants.expoConfig?.extra as any)?.eas?.projectId ??
  (Constants as any).easConfig?.projectId ??
  "";

// Default handler — show alerts + play sound when a notification arrives while
// the app is foregrounded. Can be overridden by feature-specific handlers.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: bool("push.foreground.showAlert", true),
    shouldPlaySound: bool("push.foreground.playSound", true),
    shouldSetBadge: bool("push.foreground.setBadge", true),
    shouldShowBanner: bool("push.foreground.showBanner", true),
    shouldShowList: bool("push.foreground.showList", true),
  }),
});

let lastToken: string | null = null;

/** Signed out: the next account to sign in registers this phone's token as its own. */
export function forgetPushToken(): void {
  lastToken = null;
}

/**
 * THIS PHONE STOPS BEING THE ACCOUNT'S — asked just BEFORE signing out.
 *
 * The server keeps one row per (account, platform), so a signed-out account's
 * row still pointed at this phone and its pushes kept arriving here, on the
 * next person's lock screen. Before the session goes, because afterwards
 * there is no token left to prove whose row it is. The server also takes the
 * token from any other account when someone registers it, which covers a
 * sign-out this cannot reach (offline, an expired session).
 *
 * Bounded: signing out never waits on the network, and a failure is silent.
 * The path is fixed rather than a knob — nothing is gained by letting it move.
 */
const UNREGISTER_WAIT_MS = 3000;
export async function unregisterPushToken(): Promise<void> {
  const work = (async () => {
    let token = lastToken;
    // Not registered THIS launch (the POST failed) can still mean registered
    // on an earlier one, so ask for the token rather than assume there is none.
    if (!token) {
      if (!(await Notifications.getPermissionsAsync()).granted) return;
      token = (expoProjectId
        ? await Notifications.getExpoPushTokenAsync({ projectId: expoProjectId })
        : await Notifications.getExpoPushTokenAsync()).data;
    }
    if (token) await callEndpoint("POST", "/v1/push/unregister", { token });
  })().catch(() => { /* best-effort — the server's takeover rule is the backstop */ });
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([work, new Promise<void>((r) => { timer = setTimeout(r, UNREGISTER_WAIT_MS); })]);
  if (timer) clearTimeout(timer);
}

export async function registerForPushToken(): Promise<string | null> {
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return null;

    // Android needs a notification channel or the OS never displays pushes.
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(str("push.android.channelId", "default"), {
        name: txt("push.android.channelName", "General"),
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: "default",
      });
    }

    const tokenData = expoProjectId
      ? await Notifications.getExpoPushTokenAsync({ projectId: expoProjectId })
      : await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;
    if (!token || token === lastToken) return token ?? null;

    // Best-effort — backend endpoint stores {token, platform, appVersion}.
    // Only mark the token as "sent" AFTER a successful POST, so a failed
    // registration is retried on the next call this session instead of being
    // suppressed by the dedupe guard above.
    try {
      await callEndpoint("POST", str("net.pushRegisterPath", "/v1/push/register"), {
        token,
        platform: Platform.OS,
        // The binary's own version (see client.readAppVersion) — this said
        // "0.0.0" whenever the manifest had none.
        appVersion: APP_VERSION,
      });
      lastToken = token;
    } catch { /* silent — retry on next boot / call */ }

    return token;
  } catch {
    return null;
  }
}

// Taps already acted on, so the launch tap and the listener never both open it.
const handledTaps = new Set<string>();

function onTap(res: Notifications.NotificationResponse, handler: (data: any) => void) {
  const id = res?.notification?.request?.identifier;
  if (id) {
    if (handledTaps.has(id)) return;
    handledTaps.add(id);
  }
  handler(res?.notification?.request?.content?.data ?? {});
}

/**
 * Handler for when the user taps a notification. Called once wired in SduiApp.
 *
 * A tap that launches the app from closed can be delivered before this
 * listener exists, so the launch tap is also asked for once, and cleared so a
 * reload does not open it again. The push's data becomes the screen's params,
 * which is how the server learns the push was answered (data.pushId).
 */
export function addNotificationResponseListener(handler: (data: any) => void) {
  const sub = Notifications.addNotificationResponseReceivedListener((res) => {
    try { onTap(res, handler); } catch { /* no-op */ }
  });
  Notifications.getLastNotificationResponseAsync()
    .then((res) => {
      if (!res) return;
      try { onTap(res, handler); } catch { /* no-op */ }
      void (Notifications as unknown as { clearLastNotificationResponseAsync?: () => Promise<void> })
        .clearLastNotificationResponseAsync?.()?.catch?.(() => {});
    })
    .catch(() => { /* no launch tap */ });
  return sub;
}
