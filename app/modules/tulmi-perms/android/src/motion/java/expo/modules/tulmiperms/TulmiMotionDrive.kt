package expo.modules.tulmiperms

import android.Manifest
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.SystemClock
import java.util.concurrent.atomic.AtomicBoolean
import com.google.android.gms.location.ActivityRecognition
import com.google.android.gms.location.ActivityTransition
import com.google.android.gms.location.ActivityTransitionEvent
import com.google.android.gms.location.ActivityTransitionRequest
import com.google.android.gms.location.ActivityTransitionResult
import com.google.android.gms.location.DetectedActivity

/**
 * "CALLS WAIT WHILE YOU DRIVE" ON ANDROID (perms2/SPEC.md 5.2, 5.3; Android half, build 8.9.1).
 * THE REAL HALF — compiled only when `TULMI_ANDROID_MOTION` is on (`android/src/motion/java`); the
 * other half, `android/src/motionOff/java`, answers "unknown" and links no Play services.
 *
 * THE ANSWER IS THREE WORDS AND NOTHING MORE: "driving", "not driving" or "unknown" (SPEC 9.1,
 * 5.3). Never a speed, a place, a confidence number, a vehicle type or a time. One question, asked
 * once, about 30 seconds before a Nudj call would ring, and the answer is not written anywhere
 * after it is given.
 *
 * TRANSITIONS ARE EDGES, NOT A HEARTBEAT, which is the one thing this file has to get right. An
 * IN_VEHICLE **enter** ten minutes ago with no **exit** after it means the person is still in the
 * car: nothing else is coming, because the next event is the exit. So a stored `in = true` answers
 * "driving" for as long as MAX_HOLD_SEC, and only a stored `in = false` has to be fresh (a drive
 * that ended half an hour ago says nothing about now). Reading the enter as "too old, so unknown"
 * is what makes a feature that holds calls almost never hold one.
 *
 * WHY IT IS NOT A ONE-SHOT ON ANDROID, AND WHAT IS KEPT INSTEAD. The iPhone can ask CoreMotion
 * "what was happening in the last 3 minutes?" and get a history back. Play services has no such
 * query: `requestActivityTransitionUpdates` tells you when the person gets into or out of a car, as
 * it happens, through a BroadcastReceiver, and keeps nothing. So the switch being on means we are
 * registered for exactly two transitions — IN_VEHICLE **enter** and IN_VEHICLE **exit** — and the
 * receiver writes down one line:
 *
 *     { in: true | false, at: <when> }
 *
 * That is the whole of it: a boolean and a timestamp, in this module's own SharedPreferences. No
 * other activity type is requested, so walking, running, cycling and standing still are never
 * reported to this app at all. The line is **thrown away as soon as it is too old to answer with**
 * (every read prunes anything older than the window the caller asked about, WINDOW_SEC by default),
 * and `watch(ctx, false)` deletes it and unregisters — so with the switch off, or the person's
 * switch off, nothing about driving exists on the phone (SPEC 5.2: "never stored on the phone
 * longer than needed").
 *
 * "unknown" IS A REAL ANSWER AND THE COMMON ONE. Nothing recent means we do not know, and the
 * server's rule for that is already written: no answer rings as today (SPEC 5.3). It never guesses
 * "not driving" from silence.
 *
 * PERMISSION: `ACTIVITY_RECOGNITION` (runtime from API 29; the Play services permission of the same
 * name below API 29, which is install-time), shared with the step counter (TulmiMotionSteps).
 */
object TulmiMotionDrive {
  /** How recent a "not driving" has to be to answer with. The iPhone's window too (SPEC 5.3: 180 s). */
  const val WINDOW_SEC = 180

  /**
   * How long an unclosed "in a car" may answer "driving" for: three hours.
   *
   * A drive is open until the exit arrives, so there is no window on it in principle — but Play
   * services does miss events, and a missed exit must not hold this person's calls for ever. Three
   * hours is longer than almost every drive and short enough that a missed exit costs one afternoon
   * of calls at worst; past it the line is deleted and the answer is "unknown", which rings as today.
   */
  const val MAX_HOLD_SEC = 3 * 60 * 60

  /** The receiver's action, this package's own so no other app can send it. */
  const val ACTION = "expo.modules.tulmiperms.ACTIVITY_TRANSITION"

  private const val PREFS = "tulmi.motion"
  private const val KEY_IN = "drive.in"
  private const val KEY_AT = "drive.at"
  /** Whether Play services accepted our registration. A boolean, written by the Task's own callback. */
  private const val KEY_REG = "drive.registered"

  /**
   * WHETHER THE PERSON ASKED FOR THIS AT ALL — their switch, and the only thing that may put the
   * registration back.
   *
   * It is a SECOND flag on purpose. KEY_REG says whether Play services took our last registration;
   * it survives a reboot that dropped that registration, so reading it as consent gets the feature
   * wrong in both directions: a reboot would register car-transition tracking for someone who only
   * ever turned steps on (the grant is shared), and a person who did turn the switch on would never
   * be registered again, because the flag still said yes. Written only by `watch(ctx, true/false)`,
   * which is `motionWatch` — the person's own switch (SPEC 5.2).
   */
  private const val KEY_WANT = "drive.want"
  private const val REQUEST = 0x7ED2

  /** Whether the runtime permission is held. Never asks; the JS asks with PermissionsAndroid. */
  fun granted(ctx: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true
    return ctx.checkSelfPermission(Manifest.permission.ACTIVITY_RECOGNITION) == PackageManager.PERMISSION_GRANTED
  }

  /** True on a build that has Play services' activity recognition linked. The off half returns false. */
  fun supported(): Boolean = true

  /**
   * Turns the two IN_VEHICLE transitions on or off — THE PERSON'S OWN SWITCH, and the only thing
   * that writes their intent down (KEY_WANT). Returns whether the request was SUBMITTED; whether
   * Play services accepted it is answered later, by the Task, into KEY_REG and into `done`.
   *
   * Off forgets the intent first, then the one line and the registration, so nothing — not a
   * reboot, not the next driving read — can put it back, and the switch going off leaves nothing
   * behind.
   *
   * Safe to call twice: `requestActivityTransitionUpdates` with the same PendingIntent replaces the
   * registration rather than adding a second one, which is what makes `ensureWatching` below cheap.
   */
  fun watch(ctx: Context, on: Boolean, done: (Boolean) -> Unit = {}): Boolean {
    val answered = AtomicBoolean(false)
    // Play services answers once, through one of the two listeners; `done` is for a caller holding a
    // broadcast's process open, and calling it twice would be an error there.
    val answer = { ok: Boolean -> if (answered.compareAndSet(false, true)) done(ok) }
    if (!on) {
      want(ctx, false)
      forget(ctx)
      registered(ctx, false)
      return try {
        ActivityRecognition.getClient(ctx).removeActivityTransitionUpdates(pending(ctx))
          .addOnSuccessListener { answer(true) }
          .addOnFailureListener { answer(false) }
        true
      } catch (_: Exception) {
        answer(false)
        false
      }
    }
    if (!granted(ctx)) {
      answer(false)
      return false
    }
    want(ctx, true)
    return try {
      val transitions = listOf(
        ActivityTransition.Builder()
          .setActivityType(DetectedActivity.IN_VEHICLE)
          .setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_ENTER)
          .build(),
        ActivityTransition.Builder()
          .setActivityType(DetectedActivity.IN_VEHICLE)
          .setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_EXIT)
          .build(),
      )
      ActivityRecognition.getClient(ctx)
        .requestActivityTransitionUpdates(ActivityTransitionRequest(transitions), pending(ctx))
        // THE TASK'S OWN ANSWER, not an assumption. A phone with no Play services, an out-of-date
        // one, or a revoked grant fails here, and claiming "registered" would mean the next
        // "unknown" looked like a quiet drive instead of a feature that never started.
        .addOnSuccessListener {
          registered(ctx, true)
          answer(true)
        }
        .addOnFailureListener {
          registered(ctx, false)
          answer(false)
        }
      true
    } catch (_: Exception) {
      // No Play services on this phone (or too old): there is no driving check here, and the
      // caller's answer stays "unknown", which the server already handles.
      registered(ctx, false)
      answer(false)
      false
    }
  }

  /**
   * Registers again if the person's switch is on and nothing is registered. Called before every
   * driving read and from BOOT_COMPLETED, because **a reboot drops the registration** — Play
   * services keeps no PendingIntent across one — and nothing else would ever put it back: the
   * person turned the switch on weeks ago.
   *
   * IT NEVER STARTS WATCHING ON ITS OWN. KEY_WANT is the person's switch, and without it this
   * returns at once: the ACTIVITY_RECOGNITION grant is shared with the step counter, so somebody
   * who only ever turned steps on must not get car-transition tracking from a reboot or from a
   * stray driving read. `done` is called exactly once, after Play services has answered when a
   * registration was really submitted, which is what lets the boot receiver hold its process open.
   */
  fun ensureWatching(ctx: Context, done: () -> Unit = {}) {
    try {
      if (!wanted(ctx) || !granted(ctx) || watching(ctx)) {
        done()
        return
      }
      watch(ctx, true) { done() }
    } catch (_: Exception) {
      // Nothing to do: the read that follows answers "unknown", which rings as today.
      done()
    }
  }

  /** Whether the person's switch is on. The only thing `ensureWatching` may act on. */
  fun wanted(ctx: Context): Boolean = try {
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_WANT, false)
  } catch (_: Exception) {
    false
  }

  private fun want(ctx: Context, on: Boolean) {
    try {
      val edit = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      if (on) edit.putBoolean(KEY_WANT, true) else edit.remove(KEY_WANT)
      edit.apply()
    } catch (_: Exception) {
      // A lost "on" only means the next reboot does not re-register, and the switch says so.
    }
  }

  /**
   * Forgets that Play services ever took a registration, WITHOUT touching the person's switch.
   *
   * The boot receiver calls this first: a reboot really did drop the registration, whatever the
   * flag says, so leaving it set would make `ensureWatching` think there was nothing to do and the
   * driving check would answer "unknown" for ever after the first restart.
   */
  internal fun forgetRegistration(ctx: Context) = registered(ctx, false)

  /** Whether Play services said yes to our last registration. */
  fun watching(ctx: Context): Boolean = try {
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_REG, false)
  } catch (_: Exception) {
    false
  }

  private fun registered(ctx: Context, ok: Boolean) {
    try {
      ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_REG, ok).apply()
    } catch (_: Exception) {
      // A lost flag only means the next read tries to register again, which is harmless.
    }
  }

  /**
   * Whether the phone is in a car, from the last transition if it is recent enough.
   *
   * true = driving, false = not driving, **null = we do not know** — which is the common answer
   * here and a real one: the server's rule for no answer is to ring as it does today (SPEC 5.3).
   * Silence is never reported as false. The same `Promise<boolean | null>` the iPhone's CoreMotion
   * read answers (src/device/natives.ts `motionDriving`), so the JavaScript needs no platform
   * branch; `src/device/motionCore.ts`'s `drivingAnswer` is what reads it, and the server's own rule
   * turns it into the one of three words (SPEC 5.3): true, false, and null meaning we do not know.
   *
   * TWO AGES, BECAUSE THE TWO EVENTS MEAN DIFFERENT THINGS (see the note at the top):
   *
   *  - `in = true` (an **enter**, no exit since): still in the car, up to MAX_HOLD_SEC. A drive of
   *    forty minutes has one event at the start of it, so a three-minute window would answer
   *    "unknown" for thirty-seven of those minutes and the call would ring in the car.
   *  - `in = false` (an **exit**): only fresh within the window. A drive that ended an hour ago says
   *    nothing about now.
   *
   * Reading PRUNES: a line too old to answer with is deleted, not just ignored, so nothing about a
   * drive sits on the phone waiting for the next call.
   */
  fun driving(ctx: Context, windowSec: Int): Boolean? {
    val window = (if (windowSec > 0) windowSec else WINDOW_SEC).coerceAtMost(60 * 60)
    return try {
      val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val at = p.getLong(KEY_AT, 0L)
      if (at <= 0L) return null
      val age = System.currentTimeMillis() - at
      if (age < 0) {
        // The clock moved backwards; the line cannot be judged.
        forget(ctx)
        return null
      }
      val inVehicle = p.getBoolean(KEY_IN, false)
      val limit = if (inVehicle) MAX_HOLD_SEC * 1000L else window * 1000L
      if (age > limit) {
        forget(ctx)
        return null
      }
      inVehicle
    } catch (_: Exception) {
      null
    }
  }

  /** Deletes the one line. Called on every stale read and whenever the switch goes off. */
  fun forget(ctx: Context) {
    try {
      // KEY_REG and KEY_WANT are not a drive: one says whether Play services took our registration
      // and the other is the person's switch, and deleting either on a stale read would mean
      // re-registering on every call, or quietly turning the switch off under them.
      ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY_IN).remove(KEY_AT).apply()
    } catch (_: Exception) {
      // Nothing more can be done, and the line expires on the next read anyway.
    }
  }

  /**
   * The wall-clock time of an event Play services timestamped with elapsed-realtime nanoseconds.
   *
   * The DELIVERY time is not the EVENT time: a transition detected while the phone was dozing can
   * arrive minutes later, and reading it as "just now" would answer "driving" after the person had
   * parked, or hold a call for a drive that had ended. `elapsedRealtimeNanos` counts from boot and
   * does not move with the clock, so the difference from now is the event's real age.
   */
  internal fun eventTime(eventNanos: Long): Long {
    val now = System.currentTimeMillis()
    if (eventNanos <= 0L) return now
    val ageMs = (SystemClock.elapsedRealtimeNanos() - eventNanos) / 1_000_000L
    if (ageMs < 0L) return now
    return now - ageMs
  }

  /** Written by the receiver only. */
  internal fun remember(ctx: Context, inVehicle: Boolean, atMs: Long) {
    try {
      ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .putBoolean(KEY_IN, inVehicle)
        .putLong(KEY_AT, atMs)
        .apply()
    } catch (_: Exception) {
      // A dropped transition reads as "unknown", which rings as today.
    }
  }

  /**
   * The PendingIntent Play services fills the result into. It has to be MUTABLE on Android 12+,
   * because the whole point is that the system puts the transition in it.
   */
  private fun pending(ctx: Context): PendingIntent {
    val intent = Intent(ACTION).setPackage(ctx.packageName)
    var flags = PendingIntent.FLAG_UPDATE_CURRENT
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags = flags or PendingIntent.FLAG_MUTABLE
    return PendingIntent.getBroadcast(ctx, REQUEST, intent, flags)
  }
}

/**
 * The transitions arriving, and the reboot. Writes one boolean and one timestamp and returns —
 * nothing is sent anywhere, and no other activity type can arrive here because none was requested.
 *
 * On BOOT_COMPLETED: register again, IF THE PERSON'S SWITCH IS ON. A reboot drops the registration,
 * and nothing else would put it back — they turned the switch on weeks ago and will not touch it
 * again — but the ACTIVITY_RECOGNITION grant is shared with the step counter, so somebody who only
 * ever turned steps on must not be registered for car transitions by a restart. KEY_WANT is what
 * tells the two apart. (The boot filter needs `RECEIVE_BOOT_COMPLETED`, which expo-notifications
 * already merges into every build for its own scheduled-notification receiver; this app does not
 * declare it.)
 *
 * Declared in the merged manifest only with `TULMI_ANDROID_MOTION` on (the config plugin,
 * ANDROID-WIRING.md), not exported for our own action, so only Play services' own broadcast to this
 * package reaches it; the boot action is delivered by the system.
 */
class TulmiMotionReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) {
    try {
      if (intent.action == Intent.ACTION_BOOT_COMPLETED ||
        intent.action == "android.intent.action.QUICKBOOT_POWERON"
      ) {
        // goAsync, because registering is a Task: without it the boot process can be killed between
        // the request and Play services' answer, and the switch would stay silently unregistered.
        // So `finish` is handed to `ensureWatching` and runs when Play services has answered — not
        // when the request was submitted, which is all returning from here would mean.
        val pending = goAsync()
        val done = AtomicBoolean(false)
        // THE FLAG GOES FIRST. The reboot dropped the registration whatever it says, and leaving it
        // set would make ensureWatching think there was nothing to do — the driving check would then
        // answer "unknown" for ever, with the person's switch still on.
        TulmiMotionDrive.forgetRegistration(ctx)
        TulmiMotionDrive.ensureWatching(ctx) { if (done.compareAndSet(false, true)) pending.finish() }
        return
      }
      if (intent.action != TulmiMotionDrive.ACTION) return
      if (!ActivityTransitionResult.hasResult(intent)) return
      val result = ActivityTransitionResult.extractResult(intent) ?: return
      // The newest IN_VEHICLE event wins; the list is in the order they happened.
      var newest: ActivityTransitionEvent? = null
      for (e in result.transitionEvents) {
        if (e.activityType != DetectedActivity.IN_VEHICLE) continue
        newest = e
      }
      val event = newest ?: return
      TulmiMotionDrive.remember(
        ctx,
        event.transitionType == ActivityTransition.ACTIVITY_TRANSITION_ENTER,
        // The event's own time, not this delivery's: a transition detected during doze can arrive
        // minutes after it happened.
        TulmiMotionDrive.eventTime(event.elapsedRealTimeNanos),
      )
    } catch (_: Exception) {
      // A malformed broadcast is nothing to act on: the answer stays "unknown".
    }
  }
}
