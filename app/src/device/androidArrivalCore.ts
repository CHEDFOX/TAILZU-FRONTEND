/**
 * ARRIVAL REMINDERS ON ANDROID: THE TWO-STEP PERMISSION FLOW AND THE OUTCOME
 * (perms2/SPEC.md 7, 9.1; Android half, build 8.9.1).
 *
 * Pure: no react-native, no native module, so every rule is tested in Node
 * (androidArrivalCore.test.ts). `src/device/arrival.ts` calls `arrivalGrants` and
 * `arrivalBackground` below in its `Platform.OS === "android"` branch, and `arrivalOutcome` on what
 * the native `arrivalArm(items)` resolved — on Android
 * `modules/tulmi-perms/android/.../TulmiArrivalGeofences.kt`. The item checks, the armed set and the
 * sync loop are the same on both phones and stay in the shared `arrivalCore.ts`; nothing here
 * duplicates them.
 *
 * THE PROMISE IS THE IPHONE'S, WORD FOR WORD (SPEC 0, 7.2): the phone watches for the place and
 * shows the reminder; **X0 Bot is never told where the person is or that they arrived.** Nothing in
 * this file takes a position in, and nothing it produces is ever posted anywhere: `arrival.sync`
 * sends places DOWN to the phone and gets back only how many were armed.
 *
 * WHERE ANDROID REALLY DIFFERS, AND WHY THIS SHIPS OFF. iOS has a trigger where the system both
 * watches the region and shows the notification, so it needs only *While Using* and no Play
 * paperwork (SPEC 7.1). Android has no such thing: a geofence is delivered to the app, which shows
 * the notification itself, and for that to work with the app closed it needs `ACCESS_FINE_LOCATION`
 * **and** `ACCESS_BACKGROUND_LOCATION` — a Play background-location declaration, a demo video and a
 * human review (OWNER-ANDROID.md). So `TULMI_ANDROID_ARRIVAL` ships **off in every shipping
 * profile**, and a slow Play review never holds the release: with it off the two permissions stay in
 * `blockedPermissions`, no geofencing is in the binary, `abilities().arrival` is false and the
 * server draws no switch.
 *
 * THE TWO STEPS, AND WHY NEITHER CAN BE SKIPPED:
 *
 *  1. **Precise, in the foreground.** `locate.ts` asks for COARSE only, which is all "Use my
 *     location" ever needed — and a geofence with approximate location does not work. From Android
 *     12 a FINE-only request is ignored unless COARSE is asked in the same breath, so step one is
 *     `requestMultiple([FINE, COARSE])`; a person who picks *Approximate* in that sheet grants
 *     COARSE alone, and the honest answer to them is the iPhone's "approximate", not a failure.
 *  2. **"Allow all the time".** From Android 11 the system shows no such choice inside an ordinary
 *     prompt — `request(BACKGROUND)` on API 30+ opens the app's own location page and answers when
 *     they come back — and Play requires the app to explain why FIRST. So: our card, then that
 *     request. Never Settings with no explanation, and never a bare `openSettings` whose result
 *     nothing can read.
 */
import {
  ACCESS_BACKGROUND_LOCATION, ACCESS_COARSE_LOCATION, ACCESS_FINE_LOCATION,
  answer, held, type AndroidAsk, type AndroidPerm,
} from "./androidPermCore.ts";

export { ACCESS_BACKGROUND_LOCATION, ACCESS_COARSE_LOCATION, ACCESS_FINE_LOCATION };

/** Every geofence id the phone arms starts with this, so a sync replaces OUR set and nothing else. */
export const ARRIVAL_PREFIX = "x0.arrive.";

/** The most reminders armed at once, the same cap as the iPhone's (SPEC 7.1). */
export const MAX_ARRIVALS = 10;

/** The API level from which "Allow all the time" is its own, separately granted step. */
export const BACKGROUND_SINCE_API = 29;

// ---------------------------------------------------------------------------------------------
// The two-step Android 11+ permission flow
// ---------------------------------------------------------------------------------------------

/** What the phone holds now. `fine` is precise location; `background` is "Allow all the time". */
export interface ArrivalHeld {
  fine: boolean;
  background: boolean;
  /** False on a build with the switch off: no geofencing in the binary. */
  supported: boolean;
}

/**
 * What to do next.
 *
 *  - `"unsupported"` — this build has no geofencing (the switch is off, or an older binary). The
 *    row is not drawn; the screen says nothing about Settings, because there is nothing to turn on.
 *  - `"ask-fine"`    — the ordinary system sheet for precise location. Only ever with `ask`.
 *  - `"card-background"` — precise location is held and "Allow all the time" is not. OUR CARD comes
 *    first (Play requires the explanation before the hand-off), and its Continue asks for it. This
 *    one does not wait for `ask`: showing the card prompts nothing, and a page-appear read must be
 *    able to say "one step owed" rather than "refused".
 *  - `"arm"`         — both held; arm the set.
 *  - `"denied"`      — not held and we may not ask (a page-appear sync).
 */
export type ArrivalNext = "unsupported" | "ask-fine" | "card-background" | "arm" | "denied";

export function arrivalStep(now: ArrivalHeld, ask: boolean): ArrivalNext {
  if (!now.supported) return "unsupported";
  // Step one is a SHEET, so it waits for `ask`: a page-appear sync must put no system prompt in
  // front of someone who tapped nothing.
  if (!now.fine) return ask ? "ask-fine" : "denied";
  // Step two is NOT a sheet — it is our own card, and only its Continue asks the system for
  // anything — so it does not wait for `ask`. Naming the state prompts nobody, and a page-appear
  // read has to be able to tell "precise location is held and one step is owed" from "refused":
  // `arrivalBackgroundGranted()` in arrival.ts is exactly that read.
  if (!now.background) return "card-background";
  return "arm";
}

/** Where the Android flow has got to, in the words `arrival.sync`'s branches already use. */
export type ArrivalGrant = "arm" | "background" | "approximate" | "denied" | "blocked";

/**
 * STEP ONE, and what is still owed afterwards: has this phone precise location, and is the
 * background grant outstanding?
 *
 * `ask: false` prompts nothing and answers "denied" when precise location is not already held — a
 * page-appear sync must never put a sheet in front of someone who tapped nothing (SPEC 7.2).
 *
 * `"approximate"` is the person picking *Approximate* in the sheet: COARSE granted, FINE not. It is
 * the iPhone's own word for the same situation, and the screen says the same thing — arrival
 * reminders need precise location — rather than claiming they refused.
 *
 * The decision itself is `arrivalStep` above, so there is ONE table and not a second copy of it
 * written out as branches here. `supported` is that table's own input: false on a build with the
 * switch off, which `arrival.ts` reads from the binary (`hasArrival`).
 */
export async function arrivalGrants(ask: boolean, deps: AndroidAsk, supported = true): Promise<ArrivalGrant> {
  // Both reads are `check()`, so neither prompts. Reading the background grant before the fine one
  // costs nothing and cannot change: granting precise location does not grant "Allow all the time".
  const now: ArrivalHeld = {
    supported,
    fine: (await held(ACCESS_FINE_LOCATION, deps)) === "granted",
    background: (await held(ACCESS_BACKGROUND_LOCATION, deps, BACKGROUND_SINCE_API)) === "granted",
  };
  switch (arrivalStep(now, ask)) {
    case "arm":
      return "arm";
    // STEP TWO IS NOT A DENIAL. Precise location IS held; what is missing is a grant the system will
    // only take on its own page, after our card (`arrivalBackground` below).
    case "card-background":
      return "background";
    // Either nothing is held and we may not ask — a page-appear sync must prompt nobody — or this
    // build has no geofencing at all, which `arrivalCore.ts`'s own `deps.available()` has already
    // turned into "unavailable" before this ran. Both arm nothing and prompt nothing.
    case "unsupported":
    case "denied":
      return "denied";
    case "ask-fine":
      break;
  }
  // Android 12+ IGNORES a FINE-only request: the pair has to be asked together, and the person
  // then picks Precise or Approximate inside the one sheet.
  let got: Record<string, string> = {};
  try {
    got = deps.requestMulti
      ? await deps.requestMulti([ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION])
      : { [ACCESS_FINE_LOCATION]: await deps.request(ACCESS_FINE_LOCATION) };
  } catch {
    return "denied";
  }
  const got1: AndroidPerm = answer(got[ACCESS_FINE_LOCATION]);
  if (got1 !== "granted") {
    if (answer(got[ACCESS_COARSE_LOCATION]) === "granted") return "approximate";
    return got1 === "blocked" ? "blocked" : "denied";
  }
  // Precise location is now held, and what was read above still stands.
  return now.background ? "arm" : "background";
}

/**
 * STEP TWO: ask for "Allow all the time", after our card's Continue.
 *
 * On API 30+ this opens the app's own location-permission page and answers when the person comes
 * back; on API 29 it is a choice in the ordinary dialog. Either way it is a REQUEST, not a bare
 * `openSettings`: Settings with no result to read is a dead end, and the screen could not tell
 * whether the person granted it. Plain `openSettings` is the fallback for "blocked" only.
 */
export async function arrivalBackground(deps: AndroidAsk): Promise<AndroidPerm> {
  if (typeof deps.api === "number" && deps.api < BACKGROUND_SINCE_API) return "granted";
  try {
    return answer(await deps.request(ACCESS_BACKGROUND_LOCATION));
  } catch {
    return "denied";
  }
}

// ---------------------------------------------------------------------------------------------
// What the native side answered
// ---------------------------------------------------------------------------------------------

/** What the native `arrivalArm` answers, and what the action does with it. */
export type ArrivalOutcome = "armed" | "background" | "approximate" | "denied" | "blocked" | "unavailable" | "error";

/**
 * The outcome from the native answer, which is the iPhone's union plus Android's two extra words
 * (`natives.ts`: `arrivalArm` resolves `{ armed: number } | "approximate" | "denied"`, and Android
 * adds `"background"` and `"unavailable"`).
 *
 * THIS IS THE ONE MAPPING FOR BOTH PHONES — `arrivalCore.ts`'s `arrivalSync` calls it — so
 * `"approximate"` is carried through rather than folded into `"denied"`: on the iPhone it is a real
 * answer the screen says exactly ("arrival reminders need Precise Location"), and folding it there
 * would lose that. On ANDROID the native side never produces it (TulmiArrivalGeofences answers only
 * an armed count, "denied", "background", "unavailable" or "error"), because a geofence either has
 * precise location or has nothing — Android's own approximate case comes out of `arrivalGrants`
 * above instead, before anything is armed.
 *
 * `"background"` is its own outcome and NOT a denial: precise location IS held, and the way on is
 * our card and then the system's own location page.
 */
export function arrivalOutcome(raw: unknown): { outcome: ArrivalOutcome; armed: number } {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const n = (raw as { armed?: unknown }).armed;
    const armed = typeof n === "number" ? n : Number(n);
    if (Number.isFinite(armed) && armed >= 0) {
      return { outcome: "armed", armed: Math.min(MAX_ARRIVALS, Math.floor(armed)) };
    }
    return { outcome: "error", armed: 0 };
  }
  if (raw === "background") return { outcome: "background", armed: 0 };
  if (raw === "denied") return { outcome: "denied", armed: 0 };
  if (raw === "approximate") return { outcome: "approximate", armed: 0 };
  if (raw === "blocked") return { outcome: "blocked", armed: 0 };
  if (raw === "unavailable") return { outcome: "unavailable", armed: 0 };
  return { outcome: "error", armed: 0 };
}
