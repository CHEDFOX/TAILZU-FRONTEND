/**
 * "X0 IS CALLING" ON THE PHONE (the rules: callsCore.ts). Three jobs, each never throwing:
 *
 *   makeCallChannels()   Android: the "calls" channel (the ring: high importance, the default sound, a call-like vibration) and
 *                        "calls_missed" (quiet), made by this JavaScript before the push token is registered, so the token says
 *                        BotCall only when both are there and the person has blocked neither Calls nor Reminders.
 *   clearRingingCalls()  on launch and on coming to the front: a ring past its window (50 s by its own delivery time) is taken
 *                        out of the list. A live ring stays, and a missed call always stays.
 *   dismissCall(id)      on a tap or a button on one of a call's notifications: every notification of that call goes (a late
 *                        Answer whose missed notification had already arrived, an Android that kept both).
 *
 * Expo's push API cannot take a notification back, so ring 2 and the missed call replace ring 1 by their collapseId / tag
 * (call-<id>), and this file sweeps up whatever a device kept anyway.
 */
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { txt } from "../sdui/knobs";
import { CALLS_CHANNEL, CALLS_MISSED_CHANNEL, CALL_VIBRATION, callOf, channelsUsable, isStaleRing } from "./callsCore";

/** The channel the server's leave-by and bill pushes use today (push.plan_leave.channelId): blocking it says "no reminders". */
const REMINDERS_CHANNEL = "plan_reminders";

/**
 * Android's call channels, made (Android fixes a channel's importance, sound and vibration the first time, so these are right
 * from the start), then read back: true only when both exist and neither "calls" nor "plan_reminders" is blocked. False off
 * Android, and on any failure.
 */
export async function makeCallChannels(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  try {
    await Notifications.setNotificationChannelAsync(CALLS_CHANNEL, {
      name: txt("push.calls.channelName", "Calls"),
      description: txt("push.calls.channelDescription", "When your bot calls you: time to leave, or a bill due today."),
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
      enableVibrate: true,
      vibrationPattern: CALL_VIBRATION,
      bypassDnd: false,
    }).catch(() => null);
    await Notifications.setNotificationChannelAsync(CALLS_MISSED_CHANNEL, {
      name: txt("push.calls.missedChannelName", "Missed calls"),
      description: txt("push.calls.missedChannelDescription", "Calls you didn't answer, with what they were about."),
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: null,
      enableVibrate: false,
      vibrationPattern: null,
      bypassDnd: false,
    }).catch(() => null);
    const [calls, missed, reminders] = await Promise.all([
      Notifications.getNotificationChannelAsync(CALLS_CHANNEL),
      Notifications.getNotificationChannelAsync(CALLS_MISSED_CHANNEL),
      Notifications.getNotificationChannelAsync(REMINDERS_CHANNEL),
    ]);
    return channelsUsable({ calls, missed, reminders }, Notifications.AndroidImportance.NONE);
  } catch {
    return false;
  }
}

/** Every shown notification for which `pick` holds, taken out of the list. Never throws. */
async function dismissWhere(pick: (n: Notifications.Notification) => boolean): Promise<void> {
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    for (const n of shown) {
      let hit = false;
      try { hit = pick(n); } catch { /* not one of ours */ }
      const id = n?.request?.identifier;
      if (hit && id) await Notifications.dismissNotificationAsync(id).catch(() => undefined);
    }
  } catch {
    // nothing shown, or a phone that cannot say: nothing to clear
  }
}

/**
 * A ring whose window is over (delivered more than 50 s ago), cleared: on launch and on coming to the front. Never from a
 * push's arrival, and never a ring still ringing or a missed call.
 */
export function clearRingingCalls(): Promise<void> {
  const now = Date.now();
  return dismissWhere((n) => isStaleRing(n?.request?.content?.data, n?.date, now));
}

/** Every notification of one call (its ring, its missed call), cleared: the person has just answered or put it away. */
export function dismissCall(callId: string): Promise<void> {
  if (!callId) return Promise.resolve();
  return dismissWhere((n) => callOf(n?.request?.content?.data) === callId);
}
