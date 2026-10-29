/**
 * A NOTIFICATION'S BUTTON WITH THE APP CLOSED (Android). A button that does not open the app (Done, Yes, No, Reply) reaches the
 * app's listeners only while it runs; with the app swiped away, Android hands the press to this task instead, run by
 * expo-task-manager in the app's JavaScript without a window. It does what the listener would (actions.ts), with the session the
 * app keeps on disk.
 *
 * Defined at module scope, because a background run starts from the bundle's entry (index.ts loads this file before anything
 * else); registered once the knobs are known (registerNotificationTask, from SduiApp), and only on Android: iOS launches the app
 * itself for a press and the listener handles it there (expo-notifications keeps the press for getLastNotificationResponseAsync).
 * Knob push.actions.backgroundTask (on): off unregisters it.
 */
import { Platform } from "react-native";
import * as TaskManager from "expo-task-manager";
import * as Notifications from "expo-notifications";
import { bool } from "../sdui/knobs";

export const NOTIFICATION_ACTION_TASK = "x0-notification-action";

TaskManager.defineTask<Notifications.NotificationTaskPayload>(NOTIFICATION_ACTION_TASK, async ({ data, error }) => {
  if (error || !data || typeof data !== "object" || !("actionIdentifier" in data)) return;   // a data push, not a press
  try {
    // Loaded here, not at the top: this file is loaded by index.ts before the app's own tree, and the app's client should load
    // inside App.tsx's guard as it always has.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { handleNotificationAction } = require("./actions") as typeof import("./actions");
    await handleNotificationAction(data as Notifications.NotificationResponse);
  } catch { /* owed, and sent when the app next comes to the front */ }
});

/** Ask Android to run the task for a press (or stop asking, when the server says so). Never throws. */
export async function registerNotificationTask(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    const on = await TaskManager.isTaskRegisteredAsync(NOTIFICATION_ACTION_TASK);
    if (bool("push.actions.backgroundTask", true)) {
      if (!on) await Notifications.registerTaskAsync(NOTIFICATION_ACTION_TASK);
    } else if (on) {
      await Notifications.unregisterTaskAsync(NOTIFICATION_ACTION_TASK);
    }
  } catch { /* the buttons still work while the app runs */ }
}
