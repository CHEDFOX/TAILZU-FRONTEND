/**
 * "X0 IS CALLING", THE RULES (calls.ts and ringtone.ios.ts do the work; the backend's docs/plan-ease.md "Calls" is the whole
 * story). Free of react-native, expo-notifications and expo-file-system, so each rule is tested on its own (callsCore.test.ts).
 *
 * A leave-by or a bill due today can ring the phone instead of arriving as a plain push: an ordinary notification titled
 * "<Name> is calling", with Answer and Not now (the server's categories x0_call and x0_call_missed), our own ringtone on an
 * iPhone, and a "calls" channel with a call-like vibration on Android. Never CallKit or VoIP: nothing here looks like the
 * system's call screen. The server rings only a phone whose push token says it can take a call (`BotCall`), so an older
 * JavaScript, or an Android phone where the person blocked Calls or Reminders, keeps getting today's push.
 */

/** The App Group the app and its extensions share (app.config.ts entitlements); its Library/Sounds is where iOS finds the tone. */
export const APP_GROUP = "group.com.tulmi.app";
/** The push's `sound`. Change the number to change the tone: iOS caches a sound by its name, and a new tone needs a new cap. */
export const RINGTONE_FILE = "x0_ring_1.wav";
/** Push-token cap: this JavaScript takes calls (handles call pushes, draws bots.plan.call, clears stale rings). */
export const CALL_CAP = "BotCall";
/** Push-token cap, iOS only: RINGTONE_FILE is in the App Group's Library/Sounds, so the push may name it. */
export const RINGTONE_CAP = "BotRingtone";
/** Android channels this JavaScript makes itself (the server never lists them: an older JavaScript would make "calls" without
 *  its vibration, and Android never changes a channel once it exists). "calls_ring" is kept for a store build that carries the
 *  tone in res/raw: a channel's sound is fixed when it is made, so that build needs a channel of its own. */
export const CALLS_CHANNEL = "calls";
export const CALLS_MISSED_CHANNEL = "calls_missed";
/** The ring's vibration: three long buzzes, a breath, two more (6.9 s in all). It says "a call", and never buzzes on and on. */
export const CALL_VIBRATION = [0, 800, 500, 800, 500, 800, 1400, 800, 500, 800];
/** A ring older than this is over (the server's 45 s ring window + 5 s). */
export const STALE_RING_MS = 50_000;
/** A ringing call's push kind (data.kind). Unanswered, it is replaced by "plan_call_missed", which names the same call. */
export const RING_KIND = "plan_call";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
/** A call's id as the server writes it (a uuid); anything else is not a call of ours. */
const CALL_ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * The push-token caps this JS adds: BotCall on iOS, and on Android only when its call channels are made and not blocked;
 * BotRingtone on an iPhone whose tone is in place.
 */
export function callCaps(platform: string, o: { ringtone?: boolean; channels?: boolean }): string[] {
  if (platform === "ios") return o.ringtone === true ? [CALL_CAP, RINGTONE_CAP] : [CALL_CAP];
  if (platform === "android") return o.channels === true ? [CALL_CAP] : [];
  return [];
}

/** A ringing call's notification (data.kind "plan_call"). */
export function isRingingCall(data: unknown): boolean {
  return isObj(data) && data.kind === RING_KIND && callOf(data) !== "";
}

/** The call a notification is about (data.call), or "". A missed call's notification names its call too. */
export function callOf(data: unknown): string {
  if (!isObj(data) || typeof data.call !== "string") return "";
  return CALL_ID.test(data.call) ? data.call : "";
}

/**
 * When a notification was delivered, in ms, or 0 when it does not say. expo-notifications hands Android's in ms but iOS's in
 * SECONDS (NotificationRecords.swift: `notification.date.timeIntervalSince1970`), so a number too small to be ms in this
 * century is read as seconds. Read as ms, every iPhone ring would look 55 years old and be cleared the moment the app came to
 * the front, live or not.
 */
export function deliveredMs(date: unknown): number {
  const d = typeof date === "number" ? date : typeof date === "string" && date.trim() ? Number(date) : NaN;
  if (!Number.isFinite(d) || d <= 0) return 0;
  return d < 1e11 ? Math.round(d * 1000) : d;
}

/**
 * A ringing call's notification delivered more than STALE_RING_MS before `now` (its Notification.date). A ring still inside its
 * window is never stale: unlocking an iPhone with X0 in front makes the app "active", and that must not take a live ring away.
 * A missed call is never stale (it is the record of the call), and one with no date is left alone.
 */
export function isStaleRing(data: unknown, date: unknown, now: number): boolean {
  if (!isRingingCall(data)) return false;
  const at = deliveredMs(date);
  return at > 0 && now - at > STALE_RING_MS;
}

/**
 * Whether Android may take calls: both call channels there, and neither "calls" nor "plan_reminders" blocked (importance NONE,
 * passed in so this file stays free of expo-notifications). Expo drops a push whose channel is missing, and a person who turned
 * off Reminders or Calls in Android's settings must get today's push (or nothing, as they chose), never a ring they turned off.
 */
export function channelsUsable(
  ch: { calls?: { importance: number } | null; missed?: { importance: number } | null; reminders?: { importance: number } | null },
  none: number,
): boolean {
  if (!ch.calls || !ch.missed) return false;
  if (ch.calls.importance === none) return false;
  if (ch.reminders && ch.reminders.importance === none) return false;
  return true;
}
