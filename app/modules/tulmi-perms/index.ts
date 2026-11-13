/**
 * The contact picker and the one-fix area name: the native half of
 * perms/SPEC.md sections 2 and 3.
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
}
