/**
 * The phone's calendar (docs: perms2 2). The native functions are reached ONLY through natives.ts, and every one of them may be
 * missing: an older binary, Expo Go, a build whose usage key was cut, or an Android build with TULMI_ANDROID_CALENDAR off. Then
 * the action says "unavailable" and the server stops drawing the row (the capability is gone too).
 *
 * *Add to my calendar* asks nothing of the person and reads nothing: the phone's own editor opens filled in, and the phone's
 * calendar app makes the event. *Plan around my calendar* reads busy times only — on the iPhone it asks for full access, because
 * iOS offers no read-only grant; on Android it asks for READ_CALENDAR and never WRITE_CALENDAR. The shared rules are in
 * calendarCore.ts, and Android's asking is in androidCalendarCore.ts, because the native module cannot prompt there.
 */
import { PermissionsAndroid, Platform } from "react-native";
import { tulmiPerms } from "./natives";
import { calendarReady } from "./androidCalendarCore";
import {
  busySync, editorOutcome, eventDraft,
  type BusyDeps, type BusyOutcome, type BusyPayload, type CalendarReady, type EditorOutcome,
} from "./calendarCore";
import { tzString } from "./healthCore";

const lastAt = new Map<string, number>();

/** PermissionsAndroid as androidCalendarCore asks for it, exactly as locate.ts calls the same two functions for coarse. */
const androidAsk = {
  check: (p: string) => PermissionsAndroid.check(p as never),
  request: (p: string) => PermissionsAndroid.request(p as never) as Promise<string>,
  requestMulti: (ps: string[]) =>
    PermissionsAndroid.requestMultiple(ps as never[]) as Promise<Record<string, string>>,
  api: Number(Platform.Version),
};

/** The calendar.editor action: the phone's own editor, and what the person did with it. */
export async function runCalendarEditor(action: {
  title?: unknown; startsAtIso?: unknown; endsAtIso?: unknown; allDay?: unknown; notes?: unknown;
}): Promise<{ outcome: EditorOutcome }> {
  try {
    const m = tulmiPerms();
    if (!m?.calendarEditor) return { outcome: "unavailable" };
    const draft = eventDraft(action);
    if (!draft) return { outcome: "error" };
    return { outcome: editorOutcome(await m.calendarEditor(draft)) };
  } catch {
    return { outcome: "error" };
  }
}

async function prepare(ask: boolean): Promise<CalendarReady> {
  const m = tulmiPerms();
  if (!m?.calendarBusy) return "unavailable";
  // ANDROID: THE BINARY SAYS WHETHER THIS BUILD CAN READ A CALENDAR, NOT THE FUNCTION'S PRESENCE. calendarBusy is in every
  // 8.9.1 Android binary; READ_CALENDAR is only in one whose TULMI_ANDROID_CALENDAR switch is on. Asking for a permission a
  // build does not declare comes straight back never_ask_again, which reads as "blocked" and makes the screen offer Settings
  // for a switch that is not there — so `abilities().calendarRead` is the test.
  if (Platform.OS === "android" && m.abilities?.()?.calendarRead !== true) return "unavailable";
  // ANDROID ASKS WITH PermissionsAndroid, as locate.ts does: the module's calendarAsk cannot show a sheet, and only a real
  // request can tell "refused once" from "never ask again". The whole decision — and the rule that ask:false prompts nothing —
  // is androidCalendarCore.calendarReady.
  if (Platform.OS === "android") return calendarReady(ask, androidAsk);
  if (!m.calendarStatus) return "unavailable";
  const status = m.calendarStatus();
  if (status === "granted") return "ready";
  if (status === "blocked") return "blocked";
  if (!ask || !m.calendarAsk) return "denied";
  // iOS 17+ asks for FULL access: there is no read-only calendar grant. The card said so before this ran.
  const after = await m.calendarAsk();
  return after === "granted" ? "ready" : after === "blocked" ? "blocked" : "denied";
}

const deps = (post: (path: string, body: BusyPayload) => Promise<unknown>, everyMs: number): BusyDeps => ({
  now: () => new Date(),
  offsetMin: (at) => -at.getTimezoneOffset(),
  prepare,
  busy: async (fromMs, toMs, max) => {
    const m = tulmiPerms();
    if (!m?.calendarBusy) throw new Error("no calendar module");
    return m.calendarBusy(fromMs, toMs, max);
  },
  post,
  tz: tzString,
  everyMs,
  lastAt,
});

/** The calendar.sync action. Returns the outcome name only: no event name, place or attendee exists in JavaScript to return. */
export function runCalendarSync(
  action: { path: string; days?: number; ask?: boolean; enable?: boolean },
  post: (path: string, body: BusyPayload) => Promise<unknown>,
  everyMs: number,
): Promise<{ outcome: BusyOutcome }> {
  return busySync(action, deps(post, everyMs));
}
