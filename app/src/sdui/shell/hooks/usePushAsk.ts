import { useEffect } from "react";
import * as Notifications from "expo-notifications";
import { num, obj } from "../../knobs";
import { getPushAsked, setPushAsked } from "../../../storage";
import { registerForPushToken } from "../../../notifications/push";
import type { NavItem } from "../types";

/** The notification permission, asked on the screen and after the delay the server names (flag push.ask). */
export function usePushAsk({ current }: { current: NavItem | undefined }) {
  // WHEN TO ASK FOR NOTIFICATIONS is the server's call: flag push.ask names a
  // screen and a delay ({ screen: "stats", afterMs: 1500, key: "v1" }). The
  // first time that screen is shown on this install, the app asks. Absent or
  // with no screen, nothing asks — the default while no notifications are
  // sent. A new key asks once more.
  const currentScreenId = current?.screenId;
  useEffect(() => {
    const ask = obj<{ screen?: string; afterMs?: number; key?: string }>("push.ask", {});
    if (!ask.screen || currentScreenId !== ask.screen) return;
    const key = ask.key || "default";   // a storage key, not copy
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        if (cancelled || (await getPushAsked(key))) return;
        await setPushAsked(key);
        const p = await Notifications.requestPermissionsAsync();
        if (p.granted) await registerForPushToken();
      } catch { /* the ask is best-effort */ }
    }, typeof ask.afterMs === "number" ? ask.afterMs : num("push.askDelayMs", 1500));
    return () => { cancelled = true; clearTimeout(timer); };
  }, [currentScreenId]);
}
