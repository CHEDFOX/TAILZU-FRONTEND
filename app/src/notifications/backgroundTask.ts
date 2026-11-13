/**
 * A NOTIFICATION'S BUTTON WITH THE APP CLOSED (Android). A button that does not open the app (Done, Yes, No, Reply) reaches the
 * app's listeners only while it runs; with the app swiped away, Android hands the press to this task instead, run by
 * expo-task-manager in the app's JavaScript without a window. It does what the listener would (actions.ts), with the session the
 * app keeps on disk.
 *
 * Defined at module scope, because a background run starts from the bundle's entry (index.ts loads this file before anything
 * else); registered once the knobs are known (registerNotificationTask, from SduiApp). A BUTTON's press is Android's alone: iOS
 * launches the app itself for a press and the listener handles it there (expo-notifications keeps the press for
 * getLastNotificationResponseAsync). Knob push.actions.backgroundTask (on): off unregisters it.
 *
 * The same task also hears the two SILENT pushes of the native looks (backgroundCore.ts), on both platforms: a `native.looks` nudge
 * (the catalog moved: fetch it, so a new design is on the phone before the next widget draw) and, on Android, a `bots.update` (repost
 * or end the ongoing "Bots at work" notice while the app is shut). On iOS that needs the `remote-notification` background mode and a
 * content-available push; it is budgeted by the system, best effort, and never happens after a force-quit. A force-stopped Android app
 * receives nothing either. Registered on iOS only by a binary that carries the looks (hasBinaryFeature "nativeLook"), so a binary
 * built before them is never asked.
 */
import { Platform } from "react-native";
import * as TaskManager from "expo-task-manager";
import * as Notifications from "expo-notifications";
import { bool } from "../sdui/knobs";

export const NOTIFICATION_ACTION_TASK = "x0-notification-action";

TaskManager.defineTask<Notifications.NotificationTaskPayload>(NOTIFICATION_ACTION_TASK, async ({ data, error }) => {
  if (error || !data || typeof data !== "object") return;
  if (!("actionIdentifier" in data)) {
    // A data push, not a press: a nudge to something this phone already knows how to do.
    await handleSilentPush(data);
    return;
  }
  if (Platform.OS !== "android") return;   // iOS's press is the listener's
  try {
    // Loaded here, not at the top: this file is loaded by index.ts before the app's own tree, and the app's client should load
    // inside App.tsx's guard as it always has.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { handleNotificationAction } = require("./actions") as typeof import("./actions");
    await handleNotificationAction(data as Notifications.NotificationResponse);
  } catch { /* owed, and sent when the app next comes to the front */ }
});

/**
 * A silent push, played. Never throws, and never does more than the nudge says: it cannot make the phone do a new thing, only an old
 * thing now. Loaded lazily for the same reason actions.ts is (the app's client loads inside App.tsx's guard).
 */
async function handleSilentPush(payload: unknown): Promise<void> {
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { nudgeOf } = require("./backgroundCore") as typeof import("./backgroundCore");
    const n = nudgeOf(payload);
    if (!n) return;
    if (n.kind === "notice") {
      if (Platform.OS !== "android") return;
      (require("./botsNotice") as typeof import("./botsNotice")).applyNoticePush(payload);
      return;
    }
    const looks = require("../native/looks") as typeof import("../native/looks");
    // iOS gives a content-available wake about 30 s: stop starting downloads at 20 s, and draw no stills (the next glance does).
    await looks.nudgeNativeLooks(n.v, undefined, { deadline: Date.now() + 20_000, stills: false });
    /* eslint-enable @typescript-eslint/no-require-imports */
  } catch { /* the next app open syncs it */ }
}

/** Ask the OS to run the task (Android: a button's press and the silent pushes; iOS: the silent pushes, from a binary that carries the looks). Never throws. */
export async function registerNotificationTask(): Promise<void> {
  try {
    let wanted = Platform.OS === "android";
    if (Platform.OS === "ios") {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      wanted = (require("../device/binary") as typeof import("../device/binary")).hasBinaryFeature("nativeLook");
    }
    if (!wanted) return;
    const on = await TaskManager.isTaskRegisteredAsync(NOTIFICATION_ACTION_TASK);
    if (bool("push.actions.backgroundTask", true)) {
      if (!on) await Notifications.registerTaskAsync(NOTIFICATION_ACTION_TASK);
    } else if (on) {
      await Notifications.unregisterTaskAsync(NOTIFICATION_ACTION_TASK);
    }
  } catch { /* the buttons still work while the app runs, and the next open syncs the looks */ }
}
