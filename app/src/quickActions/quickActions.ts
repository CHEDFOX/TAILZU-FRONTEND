/**
 * LONG-PRESS THE APP ICON: Home Screen quick actions on iOS, app shortcuts on Android (Ask, Dictate, New note, Spaces), each
 * opening straight there. The list is the server's (app.quickActions.ios / .android, app.quickActions.max, the kill switch
 * app.quickActions.enabled), applied on every launch from the bootstrap; today's four are the fallback. Rules: quickActionsCore.ts.
 *
 * Android's shortcuts open their link through the app's own deep-link intent filter, so they arrive like any link. iOS hands the
 * chosen item to the app delegate (the bridge's TulmiShortcuts.swift), which keeps its link (or, for `arm`, leaves the keyboard's
 * tombstone, so the microphone's screen opens the way the Dictate control opens it); the app takes it on launch and on coming to
 * the front (takeQuickAction), and when it arrives while the app runs (onQuickAction).
 */
import { Platform } from "react-native";
import { addQuickActionListener, consumeQuickAction, setQuickActions } from "../../modules/tulmi-bridge";
import { bool, list, num } from "../sdui/knobs";
import { cleanQuickActions, quickActionsSignature } from "./quickActionsCore";

let applied = "";

/** Hand the system the server's list (or none, when switched off). Skipped when nothing changed. Never throws. */
export function applyQuickActions(): void {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return;
  try {
    const raw = Platform.OS === "ios"
      ? list<Record<string, unknown>>("app.quickActions.ios", [
        { id: "ask", title: "Ask", subtitle: "Ask any bot", icon: "sparkles", url: "tulmi://screen/bots.ask" },
        { id: "dictate", title: "Dictate", subtitle: "Turn the mic on", icon: "waveform", url: "tulmi://screen/bots.keybot", arm: "screen/flow_arm" },
        { id: "note", title: "New note", icon: "square.and.pencil", url: "tulmi://screen/bots.plan.item?kind=task" },
        { id: "spaces", title: "Spaces", subtitle: "Family and friends", icon: "person.2.fill", url: "tulmi://screen/bots.spaces" },
      ])
      : list<Record<string, unknown>>("app.quickActions.android", [
        { id: "ask", title: "Ask", subtitle: "Ask any bot", icon: "tailzu_qa_ask", url: "tulmi://screen/bots.ask" },
        { id: "dictate", title: "Dictate", subtitle: "Talk to Keybot", icon: "tailzu_qa_mic", url: "tulmi://screen/bots.keybot" },
        { id: "note", title: "New note", icon: "tailzu_qa_note", url: "tulmi://screen/bots.plan.item?kind=task" },
        { id: "spaces", title: "Spaces", subtitle: "Family and friends", icon: "tailzu_qa_spaces", url: "tulmi://screen/bots.spaces" },
      ]);
    const items = bool("app.quickActions.enabled", true)
      ? cleanQuickActions(raw, Platform.OS, num("app.quickActions.max", 4))
      : [];
    const sig = quickActionsSignature(items);
    if (sig === applied) return;
    applied = sig;
    setQuickActions(items);
  } catch {
    // the icon's menu is a convenience: the app opens as ever
  }
}

/** The link a quick action left for the app (iOS), taken once; null when there is none. */
export function takeQuickAction(): string | null {
  return Platform.OS === "ios" ? consumeQuickAction() : null;
}

/** Told when a quick action arrives while the app runs (iOS). Returns an unsubscribe. */
export function onQuickAction(fn: () => void): () => void {
  return Platform.OS === "ios" ? addQuickActionListener(fn) : () => {};
}
