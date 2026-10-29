/**
 * A NOTIFICATION'S BUTTON, PRESSED: Reply (with the words typed into the notification), Done, Yes, No, or whatever the server's
 * categories add (categories.ts, categoriesCore.ts). Most answer without opening the app: they go to POST /v1/widgets/act with the
 * app's own session (the same door a widget's button uses; the server checks it is the person's own and answers it once, by its
 * key), or to one of the app's own /v1/ endpoints. Opening the app is the server's choice per button (`foreground`, `open`).
 *
 * KEPT UNTIL IT LANDS. The press is written down first (an answer owed, with its key), then sent; it is crossed off only once the
 * server has it, or has refused it. Offline, or the phone put the app away before the answer was out, it goes again the next
 * time the app comes to the front (flushOwedActions), with the same key, so the server never does it twice. A refusal (it was
 * already answered, it is not theirs any more) is not tried again: the person gets a quiet notification saying to finish in the
 * app. On iOS the app asks the system for a little time in the background while it sends (the bridge's beginBackgroundWork).
 *
 * Knobs: push.actions.enabled, push.actions.path ("/v1/widgets/act"), push.actions.keepHours (24), push.actions.maxTries (5),
 * labels push.actions.failedTitle / push.actions.failedBody.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { beginBackgroundWork, endBackgroundWork } from "../../modules/tulmi-bridge";
import { callEndpoint, primeKnobsFromDisk } from "../sdui/client";
import { bool, num, str, txt } from "../sdui/knobs";
import { actKey } from "../widgets/nowCore";
import { refreshWidgetsNow } from "../widgets/now";
import { currentCategories } from "./categories";
import { callFor, owe, retryable, stillOwed, type Owed } from "./categoriesCore";

const OWED_KEY = "x0.push.owed";
const HOUR = 3_600_000;

async function readOwed(): Promise<Owed[]> {
  try {
    const raw = await AsyncStorage.getItem(OWED_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? (list as Owed[]) : [];
  } catch {
    return [];
  }
}

async function writeOwed(list: Owed[]): Promise<void> {
  await AsyncStorage.setItem(OWED_KEY, JSON.stringify(list)).catch(() => {});
}

/** Send one owed answer. "done": crossed off. "again": kept for later. "refused": crossed off, and the person told. */
async function send(o: Owed): Promise<"done" | "again" | "refused"> {
  try {
    if (o.call.kind === "act") await callEndpoint("POST", o.call.path, o.call.body);
    else await callEndpoint(o.call.method, o.call.path, o.call.body);
    return "done";
  } catch (e) {
    const status = (e as { status?: unknown })?.status;
    return retryable(typeof status === "number" ? status : undefined) ? "again" : "refused";
  }
}

async function settle(o: Owed, outcome: "done" | "again" | "refused", screenId?: string): Promise<void> {
  const list = await readOwed();
  if (outcome === "again") {
    await writeOwed(owe(list, { ...o, tries: o.tries + 1 }));
    return;
  }
  await writeOwed(list.filter((x) => x.key !== o.key));
  if (outcome === "done") {
    void refreshWidgetsNow({ force: true });
    return;
  }
  // Refused: say so, quietly, and let a tap finish it in the app.
  await Notifications.scheduleNotificationAsync({
    content: {
      title: txt("push.actions.failedTitle", "Couldn't do that from here"),
      body: txt("push.actions.failedBody", "Open X0 Bot to finish it."),
      data: screenId ? { screenId } : {},
      sound: false,
    },
    trigger: null,
  }).catch(() => undefined);
}

/**
 * A press on one of a notification's buttons. "open": it is a tap, or a button that opens the app (the caller navigates to the
 * push's screen). "handled": its answer is on its way (or owed). Never throws.
 */
export async function handleNotificationAction(res: Notifications.NotificationResponse): Promise<"open" | "handled"> {
  const id = res?.actionIdentifier;
  if (!id || id === Notifications.DEFAULT_ACTION_IDENTIFIER) return "open";
  // A press can wake the app before anything else has run (Android's background task, iOS's background launch): the server's
  // categories and words are the ones on disk.
  await primeKnobsFromDisk().catch(() => undefined);
  if (!bool("push.actions.enabled", true)) return "open";
  const action = currentCategories().flatMap((c) => c.actions).find((a) => a.id === id);
  if (!action) return "open";
  const content = res.notification?.request?.content;
  const data = (content?.data ?? {}) as Record<string, unknown>;
  const call = callFor(action, data, typeof res.userText === "string" ? res.userText : "", actKey(), str("push.actions.path", "/v1/widgets/act"));
  if (call.kind === "open" || call.kind === "none") return call.kind === "none" && action.input ? "handled" : "open";
  const owed: Owed = { key: call.kind === "act" ? call.body.key : actKey(), call, at: Date.now(), tries: 0 };
  const work = beginBackgroundWork();
  try {
    await writeOwed(owe(await readOwed(), owed));
    const outcome = await send(owed);
    await settle(owed, outcome, typeof data.screenId === "string" ? data.screenId : undefined);
    if (outcome !== "again") {
      const ident = res.notification?.request?.identifier;
      if (ident) await Notifications.dismissNotificationAsync(ident).catch(() => undefined);
    }
  } finally {
    endBackgroundWork(work);
  }
  return "handled";
}

let flushing = false;

/** The answers still owed, sent again (on coming to the front). Too old or tried too often: dropped. Never throws. */
export async function flushOwedActions(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const now = Date.now();
    const all = await readOwed();
    const live = stillOwed(all, now, num("push.actions.keepHours", 24) * HOUR, num("push.actions.maxTries", 5));
    if (live.length !== all.length) await writeOwed(live);
    for (const o of live) await settle(o, await send(o));
  } catch {
    // tried again next time
  } finally {
    flushing = false;
  }
}

/** Signed out: nothing owed by that account is sent by the next. */
export function forgetOwedActions(): void {
  void AsyncStorage.removeItem(OWED_KEY).catch(() => {});
}
