/**
 * LONG-PRESS THE APP ICON, THE RULES (quickActions.ts applies them). The list (titles, subtitles, icons, targets, order) is the
 * server's, per platform (app.quickActions.ios / app.quickActions.android), applied on every launch; the app keeps today's four as
 * the fallback. Free of react-native, so it is tested on its own (quickActionsCore.test.ts).
 *
 *   { id: "ask", title: "Ask", subtitle: "Ask any bot", icon: "sparkles", url: "tulmi://screen/bots.ask" }
 *
 * `icon` is an SF Symbol's name on iOS and a drawable's name on Android (the bridge ships tailzu_wi_*; an unknown one draws the
 * app's own). `url` is one of this app's own links. `arm` (iOS) opens the microphone's arming screen through the App Group
 * tombstone the keyboard and the Dictate control use, since a link may never open a microphone screen.
 */
import { isAppLink } from "../widgets/nowCore.ts";

export interface QuickAction { id: string; title: string; subtitle?: string; icon?: string; url: string; arm?: string }

/** iOS and Android both cap the list at four (iOS shows four; Android may show fewer). */
export const PLATFORM_MAX = 4;

const ICON: Record<"ios" | "android", RegExp> = { ios: /^[a-z0-9.]{1,64}$/, android: /^[a-z0-9_]{1,64}$/ };

/** The server's list for this platform, checked, in its order, at most `max` (and never more than the platform takes). */
export function cleanQuickActions(list: unknown, platform: "ios" | "android", max: number): QuickAction[] {
  if (!Array.isArray(list)) return [];
  const cap = Math.max(0, Math.min(PLATFORM_MAX, Number.isFinite(max) ? Math.floor(max) : PLATFORM_MAX));
  const out: QuickAction[] = [];
  const seen = new Set<string>();
  for (const x of list) {
    if (out.length >= cap) break;
    if (!x || typeof x !== "object" || Array.isArray(x)) continue;
    const o = x as Record<string, unknown>;
    if (typeof o.id !== "string" || !/^[a-z0-9_]{1,24}$/.test(o.id) || seen.has(o.id)) continue;
    if (typeof o.title !== "string" || !o.title.trim() || !isAppLink(o.url)) continue;
    const a: QuickAction = { id: o.id, title: o.title.trim().slice(0, 40), url: o.url };
    if (typeof o.subtitle === "string" && o.subtitle.trim()) a.subtitle = o.subtitle.trim().slice(0, 60);
    if (typeof o.icon === "string" && ICON[platform].test(o.icon)) a.icon = o.icon;
    if (platform === "ios" && typeof o.arm === "string" && /^screen\/[A-Za-z0-9_.-]{1,60}$/.test(o.arm)) a.arm = o.arm;
    seen.add(o.id);
    out.push(a);
  }
  return out;
}

/** A fingerprint of the list, so an unchanged one is not handed to the system on every launch. */
export function quickActionsSignature(list: QuickAction[]): string {
  return JSON.stringify(list.map((a) => [a.id, a.title, a.subtitle ?? "", a.icon ?? "", a.url, a.arm ?? ""]));
}
