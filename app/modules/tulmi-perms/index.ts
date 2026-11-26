/**
 * The contact picker, the one-fix area name, and build 8.9.1's calendar, Reminders, Focus, motion,
 * arrival reminders and attestation: the native half of perms/SPEC.md sections 2 and 3 and of
 * perms2/SPEC.md sections 2-8.
 *
 * NOTHING IN src/ IMPORTS THIS FILE. The module was added after the store
 * build that is out, so an older binary does not have it, and the app may only
 * reach it through src/device/natives.ts, which asks for it by name
 * (requireOptionalNativeModule("TulmiPerms")) and handles a missing module.
 * These types are the module's own description, kept here beside the Swift and
 * the Kotlin so the three cannot drift; natives.ts mirrors them.
 *
 * What the module does, and what it deliberately does not:
 *  - pickEmail() opens the SYSTEM contact picker. It runs outside the app and
 *    hands back the one email the person tapped, so there is no contacts
 *    permission, no usage string and no prompt. The address book is never
 *    read, counted or uploaded. iOS CNContactPickerViewController (no
 *    CNContactStore anywhere, which is what would need the key); Android
 *    ACTION_PICK on Email.CONTENT_TYPE (no READ_CONTACTS).
 *  - locationArea() takes ONE foreground fix and gives it to the phone's own
 *    geocoder, which is the phone's own map service (Apple's or Google's)
 *    naming the point. Only the words come back: THE COORDINATE NEVER REACHES
 *    JAVASCRIPT, and no street, house number or postcode is ever returned.
 *    This is the single native entry point for reading location, so when the
 *    Android 17 system location button lands it replaces only this function's
 *    Android body.
 *  - Health is not here. The two health packages do that work, reached through
 *    src/device/natives.ts as well. Android's Health Connect rationale screen
 *    IS here (HealthRationaleActivity.kt), because it has to open the policy
 *    page and MainActivity cannot.
 *
 * BUILD 8.9.1 adds the rest of the phone's own things, and the same two rules hold for every one of
 * them: the raw thing stays native, and only the smallest answer crosses into JavaScript.
 *  - calendarEditor() opens the PHONE'S OWN event editor, filled in. On iOS 17+
 *    EKEventEditViewController runs out of process and needs no calendar access at all; on Android
 *    it is ACTION_INSERT, which opens the calendar app's own screen and needs no permission. The
 *    event is made by the calendar, not by this app, and nothing is read back.
 *  - calendarBusy() returns BUSY TIMES ONLY — `{ s, e, allDay }` per event, with free, declined
 *    and cancelled events skipped. The title, place, notes, attendees, URL and calendar name are
 *    read in Swift and never put in the answer, so they do not exist in JavaScript; on Android
 *    (behind TULMI_ANDROID_CALENDAR) they are not even in the query's projection.
 *  - remindersRead() / remindersApply() touch ONE list, "X0 Bot", which this module makes. No
 *    other list is ever in a predicate. iPhone only.
 *  - focusState() says whether a quiet mode is on, never which one: on the iPhone what X0 Bot's
 *    own Focus Filter last wrote, on Android the notification interruption filter, which needs no
 *    permission to read.
 *  - motionDays() / motionDriving() are CMPedometer and CMMotionActivityManager: daily step
 *    totals, walk/run/ride spans in whole minutes, and a yes/no "in a car?". Never a place, never
 *    anything finer than a day, and the driving answer is not kept. On Android (behind
 *    TULMI_ANDROID_MOTION) the same two names are TYPE_STEP_COUNTER and Play services' activity
 *    transitions, `spans` is always empty because there is no motion history to read, and
 *    motionWatch() / motionForget() are the pair Android needs and the iPhone does not.
 *  - arrivalArm() hands places to the SYSTEM's own location notification trigger on the iPhone,
 *    which watches the place and shows the reminder itself, so the app is not woken; on Android
 *    (behind TULMI_ANDROID_ARRIVAL) they are geofences and this app shows the reminder. Either
 *    way the position never comes back and nobody is told of an arrival, and it refuses to arm
 *    without precise location.
 *  - attestKey() / attestAssert() / attestForget() / deviceCheckToken() / integrityPrepare() /
 *    integrityToken() are abuse and fraud prevention, and only ever that (perms2/SPEC.md 8, whose
 *    9.2 names `attestKey`). They ask Apple or Google
 *    whether this is the real app on a real device; the server keeps the answer. NO DEVICE ID IS
 *    EVER MADE from the phone: no IDFV, no SSAID, no advertising id, no boot time, no disk space,
 *    and — because Apple names the network connection as a fingerprinting input — nothing about
 *    the network either. A phone test scans the trust files for every one of those names.
 *  - abilities() says what THIS binary on THIS OS can really do, read from the binary itself: the
 *    usage keys that are in Info.plist, the OS version, each `isSupported`, and on Android whether
 *    a permission is in the merged manifest. It is the reason a key cut from app.config.ts takes
 *    its screen row away with no JavaScript change (perms2/SPEC.md 9.2).
 *
 * WHAT STILL IS NOT HERE, and must not arrive without a new store build with its own strings,
 * cards, policy and review notes: reading an event's name, place or attendees; a second Reminders
 * list; Always or background location; Focus Status; anything that turns a device or network trait
 * into an id.
 */

/** Where the person is, in words. Never a street, a house number, a postcode or a coordinate. */
export interface AreaParts {
  subLocality?: string | null;
  locality?: string | null;
  subAdminArea?: string | null;
  adminArea?: string | null;
  countryCode?: string | null;
}

/**
 * What the system says about location for this app.
 *
 *  - "granted"      — while using the app (approximate is enough; nothing asks for precise).
 *  - "denied"       — refused just now, and asking again is allowed. Android only after a single refusal;
 *                     on iPhone it is what locationAsk() answers when the person declines the sheet.
 *  - "blocked"      — off for this app, and only Settings can change it. iPhone only here
 *                     (.denied/.restricted from an earlier run); see below for Android.
 *  - "undetermined" — never asked.
 *
 * ANDROID ANSWERS ONLY "granted", "denied" OR "undetermined" from both calls below. Android tells
 * "don't ask again" from "never asked" only through a request, so "blocked" cannot be read without
 * asking: on Android the caller asks with PermissionsAndroid for ACCESS_COARSE_LOCATION and reads
 * its never_ask_again as "blocked" (src/device/locate.ts does exactly that).
 */
export type LocationWord = "granted" | "denied" | "blocked" | "undetermined";

/**
 * The same four words for calendar, Reminders and motion. iOS has no "refused once, ask again",
 * so a refusal from an earlier run reads as "blocked"; for the calendar, `.writeOnly` counts as
 * "denied", because it cannot read busy times. Android never says "blocked" (see LocationWord).
 */
export type PermWord = LocationWord;

/** What `abilities()` may say. The names are permCapsCore.ts's `Ability` names, exactly. */
export type Ability =
  | "calendarAdd"
  | "calendarRead"
  | "reminders"
  | "focus"
  | "motion"
  | "healthSleep"
  | "arrival"
  | "appAttest"
  | "deviceCheck"
  | "playIntegrity";

/** What the phone's own editor opens with. Nothing is read back, and nothing is read at all. */
export interface EventDraft {
  title: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  /** The item's own words plus the line "Made with X0 Bot". Never a link with a token. */
  notes: string;
}

/** One busy block: when it starts, when it ends, whether it is all day. That is the whole answer. */
export interface BusyBlock {
  s: number;
  e: number;
  allDay: boolean;
}

/** One item of the X0 Bot list. No notes, URL, place, priority, alarm or subtask is ever read. */
export interface ReminderItem {
  /** The opaque identifier of that item, which the server keeps as `ext_ref`. */
  ext: string;
  title: string;
  dueIso?: string;
  dueHasTime: boolean;
  done: boolean;
  /** lastModifiedDate, so the server can tell which side changed last. */
  changedAt: string;
}

/** What the server's merge reply asks the phone to do, to the X0 Bot list and no other. */
export interface ReminderOps {
  listId: string;
  add: { id: string; title: string; dueIso?: string; dueHasTime: boolean }[];
  update: { ext: string; title?: string; dueIso?: string; dueHasTime?: boolean; done?: boolean }[];
  remove: string[];
}

/** iPhone: what the Focus Filter last wrote. Android: `{ on }` only. Never WHICH Focus. */
export interface FocusState {
  on: boolean;
  hold?: "calls" | "callsAndPings";
  /** When the filter said so, so the server can let it lapse after 12 hours. iPhone only. */
  at?: number;
}

/** One day of motion: the same shape Apple Health sends, so the server has one path for both. */
export interface MotionDay {
  /** The local day, YYYY-MM-DD. Nothing finer ever leaves the phone. */
  day: string;
  steps: number;
  /** Walks, runs and rides of 10 minutes or more. Driving is never in here. */
  spans: { kind: "walk" | "run" | "cycle"; minutes: number }[];
}

/** One arrival reminder for the system to watch. The places come from the server; nothing goes back. */
export interface ArrivalItem {
  /** ^[a-z0-9_-]{1,64}$. The module prefixes "x0.arrive.". */
  id: string;
  lat: number;
  lon: number;
  /** 100-500 metres. */
  radiusM: number;
  /** <= 60 characters. */
  title: string;
  /** <= 140 characters, the item's own words. */
  body: string;
  /** The screen a tap opens, <= 120 characters. */
  screen?: string;
}

export interface TulmiPermsNative {
  /** The system picker. The ONE email tapped, or null when the person backed out. Rejects only if no picker opened. */
  pickEmail(): Promise<string | null>;
  /** Reads the system's answer. Never prompts. Android never says "blocked" (see above). */
  locationStatus(): LocationWord;
  /**
   * iPhone only: requestWhenInUseAuthorization, resolving once the person has answered.
   * On Android this asks nothing and answers "granted" or "undetermined" only — the caller
   * must ask there with PermissionsAndroid for ACCESS_COARSE_LOCATION, whose never_ask_again
   * is "blocked".
   */
  locationAsk(): Promise<LocationWord>;
  /**
   * One fix, then the phone's own geocoder. Resolves with the area's words, or null when the
   * phone could not name the place (no geocoder backend, nothing known there). REJECTS when
   * there was no fix to name: no permission, location off, or `timeoutMs` ran out.
   */
  locationArea(timeoutMs: number): Promise<AreaParts | null>;

  // ----------------------------------------------------------------------- build 8.9.1

  /**
   * What this binary on this OS can really do. Synchronous, and read from the binary: the usage
   * keys that are in Info.plist, the OS version, each `isSupported`, and on Android whether a
   * permission is in the merged manifest. A name left out reads as false.
   *
   * iPhone: calendarAdd and calendarRead and reminders need iOS 17+ (and their usage keys);
   * focus needs iOS 16+; motion needs NSMotionUsageDescription and both CoreMotion availability
   * checks; healthSleep needs NSHealthShareUsageDescription to name sleep; arrival needs
   * NSLocationWhenInUseUsageDescription; appAttest and deviceCheck are their services'
   * `isSupported`. Android: calendarAdd, focus and playIntegrity are true; healthSleep is
   * READ_SLEEP in this package's requested permissions; and from 8.9.1 calendarRead, motion and
   * arrival are each their own build switch's permission being in that same merged manifest
   * (TULMI_ANDROID_CALENDAR / _MOTION / _ARRIVAL), with motion also needing a step counter on the
   * phone and arrival also needing geofencing compiled in. From 8.9.1 the shipping profiles have
   * all three ON, so a release build answers true to each one wherever the phone can do it.
   * `reminders`, `appAttest` and `deviceCheck` are false on Android.
   */
  abilities(): Partial<Record<Ability, boolean>>;

  // --- calendar (perms2/SPEC.md 2.6) ---

  /**
   * The phone's own event editor, filled in. NO PERMISSION ON EITHER PHONE.
   *
   * iPhone (17+): "saved" or "cancel", from the editor's own result. Android: "opened", because
   * the calendar apps do not report a usable result code for ACTION_INSERT, so the app claims
   * nothing about whether it was saved. "unavailable" on iOS 16 and older, and on an Android
   * phone with no calendar app. Rejects "no_screen" when there was no screen to open it on, and
   * "bad_event" when startMs is not a finite number.
   */
  calendarEditor(e: EventDraft): Promise<"saved" | "cancel" | "opened" | "unavailable">;

  /**
   * iPhone: EKEventStore.authorizationStatus; `.writeOnly` reads as "denied" (it cannot read).
   * Android: whether READ_CALENDAR is held. It NEVER answers "blocked" there — only a real
   * request can tell "refused once" from "never ask again" — so src/device/calendar.ts does the
   * asking with PermissionsAndroid (src/device/androidCalendarCore.ts).
   */
  calendarStatus(): PermWord;

  /**
   * iPhone: requestFullAccessToEvents (iOS 17+); there is no read-only calendar grant.
   * Android: PROMPTS NOTHING, like locationAsk — it answers "granted" or "undetermined", and the
   * JavaScript asks with PermissionsAndroid. This name exists so one JS path serves both phones.
   */
  calendarAsk(): Promise<PermWord>;

  /**
   * BUSY TIMES ONLY, for the window asked, at most `max` of them. Free, declined and cancelled
   * events are skipped. The array is built from start, end and all-day alone — in Swift from
   * EventKit, on Android from a seven-column CalendarContract.Instances projection — so no title,
   * place, note, attendee, URL or calendar name is in the answer, or in the process.
   */
  calendarBusy(fromMs: number, toMs: number, max: number): Promise<BusyBlock[]>;

  // --- Reminders, the X0 Bot list and no other (perms2/SPEC.md 3.4) ---

  /** iPhone only. */
  remindersStatus(): PermWord;

  /** iPhone only. requestFullAccessToReminders: there is no write-only reminders grant either. */
  remindersAsk(): Promise<PermWord>;

  /**
   * iPhone only. The X0 Bot list, made on first use and then found by its stored identifier: open
   * items plus items completed in the last 7 days. No other list is ever fetched.
   */
  remindersRead(): Promise<{ listId: string; items: ReminderItem[] }>;

  /** iPhone only. Applies the server's reply to that one list. Says which added item got which id. */
  remindersApply(ops: ReminderOps): Promise<{ applied: { id: string; ext: string }[] }>;

  // --- Focus and Do Not Disturb, no permission on either phone (perms2/SPEC.md 4.5) ---

  /**
   * Whether a quiet mode is on. iPhone: what X0 Bot's own Focus Filter last wrote to the App
   * Group, or null when it has never run. Android: the notification interruption filter
   * (PRIORITY, ALARMS and NONE all read as on; an unknown filter reads as off, because claiming a
   * Focus that is not there would silence a call the person expected). Never WHICH Focus.
   */
  focusState(): FocusState | null;

  // --- motion (perms2/SPEC.md 5.4; Android behind TULMI_ANDROID_MOTION) ---

  /** iPhone: CoreMotion's authorization. Android: ACTIVITY_RECOGNITION, and never "blocked" (see calendarStatus). */
  motionStatus(): PermWord;

  /** iPhone: the system prompt, only after the app's own card's Continue. Android: prompts nothing (see calendarAsk). */
  motionAsk(): Promise<PermWord>;

  /**
   * Daily steps and walk/run/ride spans, by local day (`offsetMin` is the phone's UTC offset).
   * ANDROID ANSWERS NO SPANS, ever: there is no queryable motion history there, and a guessed ride
   * on a fitness bot's streak is worse than none. A day it was never read on is ABSENT, not a zero.
   */
  motionDays(fromMs: number, toMs: number, offsetMin: number): Promise<MotionDay[]>;

  /**
   * Whether the phone has been in a car in the last `windowSec`: true, false, or null when
   * CoreMotion cannot say. Asked once, just before a Nudj call, and never kept.
   */
  motionDriving(windowSec: number): Promise<boolean | null>;

  /**
   * ANDROID ONLY in substance. Registers (or unregisters) the car-transition watch, which is how
   * Android answers `motionDriving` at all: there is no motion history there, only transitions the
   * phone is registered for. On iPhone this is a no-op that answers true.
   *
   * `false` also deletes the one line the receiver keeps — a boolean and a timestamp — so turning
   * "Wait while I'm driving" off leaves nothing about driving on the phone (perms2/SPEC.md 5.2).
   */
  motionWatch(on: boolean): Promise<boolean>;

  /**
   * ANDROID ONLY in substance. Forgets every daily step total the phone keeps.
   *
   * Android's step counter is a since-boot total with no history, so a daily figure has to be kept
   * by us; this is what "switching it off deletes them" means on the phone side (perms2/SPEC.md
   * 5.1). On iPhone, where HealthKit and CoreMotion keep their own history and we keep none, it
   * answers true and does nothing.
   */
  motionForget(): Promise<boolean>;

  // --- arrival reminders the phone itself watches (perms2/SPEC.md 7.4) ---

  /**
   * Replaces the whole x0.arrive.* set with `items` (10 at most). On the iPhone they are
   * notification requests with a location trigger that the SYSTEM watches; on Android they are
   * geofences this app is told about and answers with one local notification of its own.
   * "approximate": Precise Location is off, so nothing is armed and the app says so.
   *
   * ANDROID ADDS "background": precise location IS held and "Allow all the time" is not. It is NOT
   * a denial — from Android 11 the system shows no prompt for that grant, so the way on is the
   * app's own card and then the system's own location page, which is also what Play requires.
   * "unavailable" on a build without geofencing (`TULMI_ANDROID_ARRIVAL` off).
   *
   * Nothing about an arrival is ever sent, logged or kept.
   */
  arrivalArm(items: ArrivalItem[]): Promise<{ armed: number } | "approximate" | "denied" | "background" | "unavailable">;

  /** The ids currently armed, without the x0.arrive. prefix. */
  arrivalList(): Promise<string[]>;

  /** Drops every armed arrival reminder. */
  arrivalClear(): Promise<void>;

  // --- abuse and fraud prevention, dark (perms2/SPEC.md 8.5) ---
  //
  // No prompt, no card, no usage string, because nothing about the person is read. Each one asks
  // Apple or Google whether this is the real X0 Bot on a real device, and the server keeps only
  // that answer. NOTHING HERE MAKES A DEVICE ID, and nothing here reads a device or network trait
  // that could stand in for one.

  /**
   * iPhone only. App Attest: one key for this account on this install, and Apple's statement about
   * it, base64. The key id lives in the KEYCHAIN, never the App Group, filed under `account`.
   *
   * `account` is an opaque per-account key the caller sends — an HMAC of the account id, never the
   * id itself — and the module uses it for nothing but that filing. `challenge` is the server's;
   * the module hashes it as SHA256("x0|attest|" + challenge), so the convention lives in one place.
   *
   * Rejects with a short code (unsupported, unavailable, attested, invalid_key, invalid, system,
   * failed) which the caller reports as it is. "unavailable" is Apple's server not answering,
   * usually this phone's own connection; the same key is kept for the retry. "attested" means this
   * account already holds a vouched-for key: ask for an assertion, never a new key. A missing or
   * failed answer is never a penalty by itself.
   */
  attestKey(account: string, challenge: string): Promise<{ keyId: string; attestation: string }>;

  /**
   * iPhone only. That same key signing SHA256("x0|assert|" + challenge), so a session can say it is
   * still this app on this phone. "no_key" means nothing has been attested yet.
   */
  attestAssert(account: string, challenge: string): Promise<{ keyId: string; assertion: string }>;

  /** iPhone only. Forgets this account's key id, so the next attestation starts a fresh key. */
  attestForget(account: string): Promise<void>;

  /** iPhone only. DeviceCheck: one token for the server to query Apple's two bits with. No entitlement. */
  deviceCheckToken(): Promise<string>;

  /**
   * Android only. Warms up a Play Integrity token provider for that Cloud project number (not a
   * secret; it comes down in the bootstrap). Takes seconds, and Play allows at most 5 a minute per
   * install, so it is called only when the server asks for a check. Resolves true.
   *
   * Rejects with one of: bad_project, unsupported, no_play, throttled, transient, error.
   */
  integrityPrepare(cloudProjectNumber: string): Promise<boolean>;

  /**
   * Android only. One integrity token over the server's request hash (500 bytes at most). The
   * token is handed straight back and never logged or kept.
   *
   * Rejects with one of: not_prepared, hash_too_long, provider_invalid (prepare once more and
   * retry once), unsupported, no_play, throttled, transient, bad_project, error.
   */
  integrityToken(requestHash: string): Promise<string>;
}
