/**
 * QUICK ACCESS FROM OUTSIDE THE APP, IN ONE PLACE FOR THE SHELL (SduiApp): the two widgets (now.ts), a notification's buttons
 * (notifications/categories.ts, actions.ts, backgroundTask.ts) and the app icon's long-press list (quickActions/quickActions.ts).
 *
 *   publishQuickAccess()   on every bootstrap: the server's long-press list and notification categories, registered when they
 *                          changed; Android's background task for a press with the app closed
 *   refreshQuickAccess()   on launch, coming to the front, a push, an answer: the widgets' rows (and their token), and any answer
 *                          from a notification still owed
 *   signingOut()           before the session goes: the widgets' token revoked on the server
 *   forgetQuickAccess()    once it has gone: nothing of the account left in a widget, the Keychain or the owed answers
 */
import { registerNotificationTask } from "../notifications/backgroundTask";
import { registerNotificationCategories } from "../notifications/categories";
import { flushOwedActions, forgetOwedActions } from "../notifications/actions";
import { applyQuickActions } from "../quickActions/quickActions";
import { forgetWidgets, refreshWidgetsNow, revokeWidgetToken } from "./now";

export function publishQuickAccess(): void {
  applyQuickActions();
  void registerNotificationCategories();
  void registerNotificationTask();
}

export function refreshQuickAccess(o: { force?: boolean } = {}): void {
  void refreshWidgetsNow(o);
  void flushOwedActions();
}

export async function signingOut(): Promise<void> {
  await revokeWidgetToken();
}

export function forgetQuickAccess(): void {
  forgetWidgets();
  forgetOwedActions();
}
