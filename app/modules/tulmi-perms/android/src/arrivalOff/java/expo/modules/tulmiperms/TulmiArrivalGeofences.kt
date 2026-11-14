package expo.modules.tulmiperms

import android.content.Context

/**
 * ARRIVAL REMINDERS ON ANDROID, THE SWITCH-OFF HALF (perms2/SPEC.md 7; build 8.9.1).
 *
 * Compiled only when `TULMI_ANDROID_ARRIVAL` is OFF (`android/src/arrivalOff/java`), in place of
 * `android/src/arrival/java`'s real one. Same object, same function names, same return types, so
 * `TulmiPermsModule.kt` is one file for both values of the switch.
 *
 * THIS IS THE HALF EVERY SHIPPING BUILD CARRIES until Play has approved the background-location
 * declaration (SPEC 7.4's "Android: held until two Play declarations are worth it";
 * OWNER-ANDROID.md has the declaration text and the demo-video script). With it:
 *
 *   - no Play services geofencing in the binary,
 *   - `ACCESS_FINE_LOCATION` and `ACCESS_BACKGROUND_LOCATION` stay in `blockedPermissions`, so the
 *     merged manifest declares neither and Play asks for no declaration at all,
 *   - no receiver of ours in the manifest (expo-notifications' own BOOT_COMPLETED receiver and its
 *     `RECEIVE_BOOT_COMPLETED` are unaffected: they are what reschedules local notifications, and
 *     this build neither declares nor blocks them),
 *   - `abilities().arrival` is false, so the server never draws the switch on an Android phone and
 *     the person is never shown something that cannot work.
 *
 * Why a file and not an `if`: see the note in `motionOff/.../TulmiMotionDrive.kt`. Off has to mean
 * the library is not in the build, not that a runtime branch skips it.
 */
object TulmiArrivalGeofences {
  const val DENIED = "denied"
  const val BACKGROUND = "background"
  const val UNAVAILABLE = "unavailable"
  const val ERROR = "error"

  /** False, and this is what `abilities().arrival` reads on Android. */
  fun supported(): Boolean = false

  /** Neither permission is in this build's manifest, so neither can be held. */
  fun fineGranted(ctx: Context): Boolean = false

  fun backgroundGranted(ctx: Context): Boolean = false

  /** Nothing can be armed, and the honest answer is that this build cannot do it. */
  fun arm(ctx: Context, items: List<Map<String, Any?>>, done: (Any) -> Unit) = done(UNAVAILABLE)

  fun list(ctx: Context): List<String> = emptyList()

  /** Nothing was armed, but the stored set is cleared anyway, in case a build with the switch on wrote one. */
  fun clear(ctx: Context, done: (Boolean) -> Unit) {
    TulmiArrivalStore.forget(ctx)
    done(true)
  }
}
