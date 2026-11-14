/**
 * ARRIVAL REMINDERS: THE RULES (docs: perms2 7). Pure: no react-native, no native module, so each rule is tested in Node
 * (arrivalCore.test.ts); arrival.ts hands the set to the module.
 *
 * The phone watches the place ITSELF. iOS's own location notification trigger needs only Location While Using: the system
 * monitors the region and shows the notification on arrival, the app is not even woken, and X0 Bot is never told where the person
 * is or that they arrived. So nothing is POSTed here at all — the places come FROM the server, and the only thing that goes back
 * is that the switch is on. Precise Location is required, and a phone with only Approximate is told so rather than armed.
 *
 * ANDROID (build 8.9.1, behind TULMI_ANDROID_ARRIVAL) keeps every one of those rules and adds ONE WORD, "background": a geofence
 * is delivered to the app, so it needs precise location AND "Allow all the time", and from Android 11 the system shows no prompt
 * for the second — our own card comes first, then the system's own location page. That is not a denial, so it is its own outcome.
 * The decision behind it lives in androidArrivalCore.ts; the asking is the only part of this that differs by phone, which is why
 * `deps.grant(ask)` is one call rather than a status-then-ask pair.
 */

import { arrivalOutcome } from "./androidArrivalCore.ts";

/** iOS caps an app's monitored conditions; the server sends ten at most and so do we. */
export const MAX_ITEMS = 10;
export const RADIUS_MIN = 100;
export const RADIUS_MAX = 500;
export const RADIUS_DEFAULT = 150;
export const TITLE_MAX = 60;
export const BODY_MAX = 140;
export const SCREEN_MAX = 120;

/** The phone's own prefix for every request it schedules, so a sync replaces exactly its own set and nothing else. */
export const ARRIVE_PREFIX = "x0.arrive.";

const ID = /^[a-z0-9_-]{1,64}$/;

/** The kind of push an arrival notification carries, so a tap can open the item (notifications/push.ts). */
export const ARRIVAL_KIND = "arrival";

const text = (v: unknown, max: number): string => {
  if (typeof v !== "string") return "";
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max).trim() : s;
};

/** One arrival reminder as the phone will arm it. */
export interface ArrivalIn {
  id: string;
  lat: number;
  lon: number;
  radiusM: number;
  title: string;
  body: string;
  screen?: string;
}

/**
 * The set to arm: every item checked here as well as on the server — a plain id, a real point, a radius between 100 and 500
 * metres, a title and body within their lengths — and ten at most, because iOS watches no more. A duplicate id is kept once. An
 * item that does not pass is dropped rather than guessed at, so one bad row never costs the others.
 */
export function cleanItems(raw: unknown): ArrivalIn[] {
  if (!Array.isArray(raw)) return [];
  const out: ArrivalIn[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const it = r as Record<string, unknown>;
    const id = typeof it.id === "string" && ID.test(it.id) ? it.id : "";
    const lat = Number(it.lat);
    const lon = Number(it.lon);
    const title = text(it.title, TITLE_MAX);
    const body = text(it.body, BODY_MAX);
    if (!id || seen.has(id) || !title) continue;
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) continue;
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) continue;
    const asked = Math.round(Number(it.radiusM));
    const radiusM = Number.isFinite(asked) ? Math.max(RADIUS_MIN, Math.min(RADIUS_MAX, asked)) : RADIUS_DEFAULT;
    const item: ArrivalIn = { id, lat, lon, radiusM, title, body };
    const screen = text(it.screen, SCREEN_MAX);
    if (screen) item.screen = screen;
    seen.add(id);
    out.push(item);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

export type ArrivalOutcome =
  | "armed" | "cleared" | "approximate"
  /** ANDROID ONLY: precise location is held, "Allow all the time" is not. NOT a denial. */
  | "background"
  | "denied" | "blocked" | "unavailable" | "error";

/**
 * Where the permission flow has got to, in the words `arrival.sync`'s branches already use. One answer for both phones: the
 * iPhone can only ever say "arm", "denied" or "blocked" (it detects Approximate at arm time instead), and Android adds
 * "approximate" and "background" from its two-step flow (androidArrivalCore.ts).
 */
export type ArrivalGrant = "arm" | "background" | "approximate" | "denied" | "blocked";

export interface ArrivalDeps {
  /**
   * Check, and ask ONLY when `ask` is true. One call, not a status-then-ask pair: Android's flow is two grants in sequence
   * (precise location, then "Allow all the time"), and "the second one is still owed" is not a state a status read can report.
   * arrival.ts gives this androidArrivalCore's `arrivalGrants` on Android and locate.ts's pair on the iPhone.
   */
  grant: (ask: boolean) => Promise<ArrivalGrant>;
  /** Replaces the x0.arrive.* set with these. */
  arm: (items: ArrivalIn[]) => Promise<unknown>;
  /** Takes every x0.arrive.* request off the phone. */
  clear: () => Promise<void>;
  /** False when this binary has no arrival functions at all. */
  available: () => boolean;
}

/**
 * The arrival.sync action. An empty set CLEARS the phone's own reminders and needs no permission at all (taking something off
 * the phone is not reading anything). Otherwise: the location grant, asked only when `ask`, and precise location, which the
 * iPhone's native side checks and refuses with "approximate" so the screen can say exactly that, and which Android asks for
 * outright. Android's second grant comes back as "background", its own outcome and not a refusal.
 */
export async function arrivalSync(
  action: { items?: unknown; ask?: boolean },
  deps: ArrivalDeps,
): Promise<{ outcome: ArrivalOutcome; armed?: number }> {
  try {
    if (!deps.available()) return { outcome: "unavailable" };
    const items = cleanItems(action.items);
    if (!items.length) {
      await deps.clear();
      return { outcome: "cleared", armed: 0 };
    }
    const grant = await deps.grant(action.ask === true);
    if (grant === "blocked") return { outcome: "blocked" };
    if (grant === "denied") return { outcome: "denied" };
    if (grant === "approximate") return { outcome: "approximate" };
    // NOT a denial: precise location is held and "Allow all the time" is the next step, which the server's own card explains
    // before anything is asked. A screen that has not been taught the word falls back to onApproximate and then onDenied.
    if (grant === "background") return { outcome: "background" };
    const { outcome, armed } = arrivalOutcome(await deps.arm(items));
    return outcome === "armed" ? { outcome, armed } : { outcome };
  } catch {
    return { outcome: "error" };
  }
}

/**
 * The screen an arrival notification's tap opens, or null when the push is not one of ours. The notification is scheduled by the
 * phone itself, so its data is the item's own `{ kind, screen }` and carries nothing about where the person is.
 */
export function arrivalTapScreen(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { kind?: unknown; screen?: unknown };
  if (d.kind !== ARRIVAL_KIND) return null;
  const screen = text(d.screen, SCREEN_MAX);
  return screen || null;
}

/**
 * WHAT AN ARRIVAL TAP HANDS THE SCREEN, and nothing more. iOS scheduled the notification and iOS noticed the arrival, so
 * expo-notifications gives its whole `userInfo` back as the push's `data` — TulmiArrival.swift's `kind: "arrival"` with it.
 * Those become the screen's params, which the app POSTs to /v1/app/screen, so handing them on would tell X0 Bot's servers
 * the moment someone arrived somewhere: exactly what the card, the policy, App Privacy and the review notes say never
 * happens. Only the screen id goes. Null when the push is not one of ours, and then the push's own data is used as ever.
 */
export function arrivalOpening(data: unknown): { screenId: string } | null {
  const screen = arrivalTapScreen(data);
  return screen ? { screenId: screen } : null;
}
