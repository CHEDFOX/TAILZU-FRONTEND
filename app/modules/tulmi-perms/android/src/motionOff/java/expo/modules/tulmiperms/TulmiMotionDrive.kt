package expo.modules.tulmiperms

import android.content.Context

/**
 * "CALLS WAIT WHILE YOU DRIVE" ON ANDROID, THE SWITCH-OFF HALF (perms2/SPEC.md 5.2; build 8.9.1).
 *
 * Compiled only when `TULMI_ANDROID_MOTION` is OFF (`android/src/motionOff/java`), in place of
 * `android/src/motion/java`'s real one. Same object, same function names, same return types, so
 * `TulmiPermsModule.kt` is one file for both values of the switch and nothing in it is conditional.
 *
 * WHY A FILE AND NOT AN `if`: the real half imports `com.google.android.gms.location`, and that
 * dependency is only added to `android/build.gradle` when the switch is on (ANDROID-WIRING.md). A
 * build with the switch off has no Play services location classes at all, so code naming them would
 * not compile, and code that guards the call at runtime would still link them. Two source sets is
 * the only shape where "off" really means the library is not in the binary — the same all-or-nothing
 * rule the health switch follows (react-native.config.js, withTulmiPerms.js, check-health-switch.mjs).
 *
 * `driving()` answers null, which is a real answer the server already has a rule for: no answer
 * means the call rings as it does today (SPEC 5.3). `abilities().motion` is false on this build, so
 * the row is not drawn and the question is never asked in the first place.
 */
object TulmiMotionDrive {
  const val WINDOW_SEC = 180
  const val MAX_HOLD_SEC = 3 * 60 * 60

  /** Never asked for on this build: there is no receiver and no Play services to send to it. */
  fun granted(ctx: Context): Boolean = false

  /** False, and this is what `abilities().motion` reads for the driving half of the string. */
  fun supported(): Boolean = false

  /** Nothing to turn on or off; `done` is answered at once so a caller never waits on this build. */
  fun watch(ctx: Context, on: Boolean, done: (Boolean) -> Unit = {}): Boolean {
    done(false)
    return false
  }

  /** Nothing to register, so nothing to re-register after a reboot. */
  fun ensureWatching(ctx: Context, done: () -> Unit = {}) = done()

  /** Never watching on this build. */
  fun watching(ctx: Context): Boolean = false

  /** The person's switch, which this build cannot act on either way. */
  fun wanted(ctx: Context): Boolean = false

  /** Nothing was registered, so there is no registration to forget. */
  internal fun forgetRegistration(ctx: Context) = Unit

  /** Always null ("unknown") here: the phone was never watching, so it has nothing to say. */
  fun driving(ctx: Context, windowSec: Int): Boolean? = null

  /** Nothing was ever written down, so there is nothing to forget. */
  fun forget(ctx: Context) = Unit
}
