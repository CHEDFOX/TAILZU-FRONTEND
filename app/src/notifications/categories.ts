/**
 * A NOTIFICATION'S BUTTONS, REGISTERED: the categories the server lists in the bootstrap (push.categories), registered with the
 * system on every launch the list changed, so a new category or a renamed button needs no release. Which push kind carries which
 * category is the server's push engine's (push.<kind>.category). The rules are categoriesCore.ts; the buttons' work is actions.ts.
 *
 * Knobs: push.actions.enabled (the kill switch: none registered, and any registered before are taken away), push.categories.
 */
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { bool, list } from "../sdui/knobs";
import { categoriesSignature, cleanCategories, type Category } from "./categoriesCore";

const SIG_KEY = "x0.push.categoriesSig";
const IDS_KEY = "x0.push.categoryIds";

/** The categories as the server last listed them (today's three until it has). Empty when switched off. */
export function currentCategories(): Category[] {
  if (!bool("push.actions.enabled", true)) return [];
  return cleanCategories(list<Record<string, unknown>>("push.categories", [
    { id: "x0_reply", actions: [{ id: "reply", title: "Reply", icon: "arrowshape.turn.up.left", input: { placeholder: "Reply…", send: "Send" }, foreground: false, destructive: false, auth: false, act: "reply" }] },
    { id: "x0_task", actions: [{ id: "done", title: "Done", icon: "checkmark", foreground: false, destructive: false, auth: false, act: "done" }] },
    { id: "x0_yesno", actions: [{ id: "yes", title: "Yes", icon: "checkmark", foreground: false, destructive: false, auth: true, act: "yes" }, { id: "no", title: "No", icon: "xmark", foreground: false, destructive: false, auth: false, act: "no" }] },
  ]));
}

let busy: Promise<void> | null = null;

/** Register the server's categories with the system when they changed since the last time. Never throws. */
export function registerNotificationCategories(): Promise<void> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return Promise.resolve();
  if (busy) return busy;
  busy = (async () => {
    try {
      const cats = currentCategories();
      const sig = categoriesSignature(cats);
      if ((await AsyncStorage.getItem(SIG_KEY).catch(() => null)) === sig) return;
      const before = JSON.parse((await AsyncStorage.getItem(IDS_KEY).catch(() => null)) ?? "[]") as unknown;
      for (const c of cats) {
        await Notifications.setNotificationCategoryAsync(c.id, c.actions.map((a) => ({
          identifier: a.id,
          buttonTitle: a.title,
          ...(a.input ? { textInput: { submitButtonTitle: a.input.send, placeholder: a.input.placeholder } } : {}),
          options: { opensAppToForeground: a.foreground || !!a.open, isDestructive: a.destructive, isAuthenticationRequired: a.auth },
        })), c.previewPlaceholder ? { previewPlaceholder: c.previewPlaceholder } : undefined).catch(() => undefined);
      }
      // A category the server no longer lists goes, so its buttons stop appearing on pushes that still name it.
      const now = new Set(cats.map((c) => c.id));
      for (const id of Array.isArray(before) ? before : []) {
        if (typeof id === "string" && !now.has(id)) await Notifications.deleteNotificationCategoryAsync(id).catch(() => false);
      }
      await AsyncStorage.multiSet([[SIG_KEY, sig], [IDS_KEY, JSON.stringify([...now])]]).catch(() => {});
    } catch {
      // the buttons are a convenience: a push still opens the app
    } finally {
      busy = null;
    }
  })();
  return busy;
}
