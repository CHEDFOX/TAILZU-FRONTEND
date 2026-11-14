package expo.modules.tulmiperms

import android.Manifest
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofenceStatusCodes
import com.google.android.gms.location.GeofencingEvent
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices

/**
 * ARRIVAL REMINDERS ON ANDROID: THE GEOFENCES (perms2/SPEC.md 7; Android half, build 8.9.1).
 * THE REAL HALF — compiled only when `TULMI_ANDROID_ARRIVAL` is on (`android/src/arrival/java`); the
 * other half, `android/src/arrivalOff/java`, answers "unavailable" and links no Play services.
 *
 * THE SAME PROMISE AS THE IPHONE'S, AND IT IS THE WHOLE POINT OF THIS FILE: the phone watches for
 * the place and shows the reminder; **X0 Bot is never told where the person is or that they
 * arrived** (SPEC 0, 7.2). What leaves the phone on arrival: nothing. Not a request, not an
 * analytics event, not a log line. `TulmiArrivalStore.notifyArrival` builds a notification and the
 * receiver returns.
 *
 * THE ONE HONEST DIFFERENCE FROM THE IPHONE. iOS has
 * `UNLocationNotificationTrigger`, where the system both watches the region and shows the
 * notification, so the app needs only *While Using* and is never woken (SPEC 7.1). Android has no
 * such thing: a geofence is delivered to the app, which then shows the notification itself. That
 * means two permissions the iPhone does not need — `ACCESS_FINE_LOCATION` and
 * `ACCESS_BACKGROUND_LOCATION` — a Play background-location declaration and a demo video. Which is
 * exactly why this is the switch that ships OFF in every profile until Play has answered
 * (OWNER-ANDROID.md), and why it is its own switch rather than riding on the others.
 *
 * WHAT IS ARMED: at most `TulmiArrivalStore.MAX` (10) circular regions, enter only
 * (`GEOFENCE_TRANSITION_ENTER`, no exit, no dwell), never expiring, ids all starting `x0.arrive.`.
 *
 * A SYNC IS A DIFF, NOT A REPLACEMENT, and that is not a performance choice. `arrival.sync` runs on
 * every Plan Ease page appear (SPEC 7.2), so removing and re-adding the whole set would re-arm a
 * fence the person is standing inside several times a day — and `INITIAL_TRIGGER_ENTER` would fire
 * each time, so an item at home would say "You're at …" on every app open and after every reboot.
 * So: no initial trigger at all (a geofence fires on a real crossing), and only the ids that
 * changed are touched. A finished or deleted item's fence is removed at the next sync (SPEC 7.3);
 * an unchanged one is left exactly as it was.
 *
 * WITH TWO EXCEPTIONS, BECAUSE THE SYSTEM CAN THROW THEM AWAY WITHOUT TELLING US TWICE. When
 * location is turned off on the phone, Android delivers one GEOFENCE_NOT_AVAILABLE alert and drops
 * every fence; clearing Play services' data drops them with no alert at all. The stored list still
 * names them, so a diff would decide they were armed and add nothing — the reminders would stop
 * silently. The receiver writes a "stale" flag on that alert, and the first sync of each process
 * re-adds the set anyway, which is what covers the data clear. Re-adding costs one call and fires
 * nothing, because there is no initial trigger.
 *
 * AFTER A REBOOT: Android drops every geofence. The receiver re-registers the stored set on
 * `BOOT_COMPLETED` — without that, an arrival reminder silently stops working after the first
 * restart. **This app declares no `RECEIVE_BOOT_COMPLETED` of its own**: expo-notifications already
 * merges that permission, and a BOOT_COMPLETED receiver with it, into every build (it reschedules
 * date-triggered local notifications), so the permission is there and declaring or blocking it here
 * would only put that at risk.
 */
object TulmiArrivalGeofences {
  const val DENIED = "denied"
  const val BACKGROUND = "background"
  const val UNAVAILABLE = "unavailable"
  const val ERROR = "error"

  /** The receiver's action, this package's own so no other app can send it. */
  const val ACTION = "expo.modules.tulmiperms.GEOFENCE"

  private const val REQUEST = 0x7ED3

  /**
   * Whether THIS PROCESS has armed yet. False again after every cold start, which is the only
   * cheap way to cover a Play services data clear: that throws our geofences away and tells us
   * nothing, so the first sync of a process re-adds the wanted set instead of trusting the stored
   * list. Re-adding an unchanged fence costs one call and fires nothing — there is no initial
   * trigger — so this is safe to be wrong about.
   */
  private var armedThisProcess = false

  /** True on a build that has Play services' geofencing linked. The off half returns false. */
  fun supported(): Boolean = true

  /** Whether precise location is held. Approximate is not enough for a geofence. */
  fun fineGranted(ctx: Context): Boolean =
    ctx.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

  /**
   * Whether "Allow all the time" is held. Below Android 10 there is no separate grant, so holding
   * fine location is holding it.
   */
  fun backgroundGranted(ctx: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return fineGranted(ctx)
    return ctx.checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED
  }

  /**
   * Replaces the armed set with `items`.
   *
   * Answers `{ armed: <n> }` — the same object the iPhone's `arrivalArm` resolves with
   * (src/device/natives.ts) — or one of the words: "denied" (no precise location), "background"
   * ("Allow all the time" not given yet, which is Android's own second step and has no iPhone
   * twin), "unavailable" or "error". This side never answers the iPhone's "approximate": a geofence
   * either has precise location or it has nothing, so a missing FINE grant is "denied" here. The
   * person picking *Approximate* in the sheet is Android's own case and is answered before anything
   * reaches this function, by `androidArrivalCore.ts`'s `arrivalGrants`, which carries the word
   * "approximate" through to the screen.
   *
   * An empty `items` is a clear: every `x0.arrive.` geofence is removed and the stored set forgotten.
   */
  fun arm(ctx: Context, items: List<Map<String, Any?>>, done: (Any) -> Unit) {
    val clean = TulmiArrivalStore.clean(items)
    if (clean.isEmpty()) {
      clear(ctx) { done(mapOf("armed" to 0)) }
      return
    }
    if (!fineGranted(ctx)) {
      done(DENIED)
      return
    }
    // The two-step Android 11+ flow: foreground first, then "Allow all the time" in Settings, with
    // our own card before it (SPEC 7.2's card; androidArrivalCore.ts's `arrivalStep`). Nothing is
    // armed until both are held, because a geofence without the background grant fires only while
    // the app is open, which is not what the switch promised.
    if (!backgroundGranted(ctx)) {
      done(BACKGROUND)
      return
    }
    // RE-ADD EVERYTHING WHEN THE STORED LIST CANNOT BE TRUSTED: after a GEOFENCE_NOT_AVAILABLE
    // alert (the receiver below sets the flag) and on the first sync of each process, which is what
    // covers Play services' data being cleared. Otherwise this is the ordinary diff.
    sync(ctx, clean, readd = TulmiArrivalStore.stale(ctx) || !armedThisProcess, done = done)
  }

  /**
   * Arms `wanted`, touching as little as possible.
   *
   * `readd = false` (an ordinary sync): remove only the fences that are gone or have moved, add
   * only the ones that are new or moved, and leave the rest registered exactly as they are.
   * `readd = true`: the stored list cannot be trusted — a reboot, a GEOFENCE_NOT_AVAILABLE alert or
   * a fresh process after Play services' data was cleared — so every wanted fence goes back. Ids
   * that are no longer wanted are removed either way; re-adding an unchanged fence fires nothing,
   * because there is no initial trigger.
   *
   * The stored set is written only once the system has taken the new fences, so a failed or killed
   * re-arm leaves the old set on the phone to try again from, rather than an empty one.
   */
  private fun sync(ctx: Context, wanted: List<TulmiArrivalStore.Item>, readd: Boolean, done: (Any) -> Unit) {
    val have = TulmiArrivalStore.all(ctx)
    val kept = if (readd) emptySet() else have.filter { old -> wanted.any { same(old, it) } }.map { it.fenceId }.toSet()
    val stale = have.map { it.fenceId }.filter { it !in kept }
    val add = wanted.filter { it.fenceId !in kept }
    val finish = {
      TulmiArrivalStore.put(ctx, wanted)
      // The system has them again: the next sync may go back to the cheap diff.
      TulmiArrivalStore.clearStale(ctx)
      armedThisProcess = true
      done(mapOf("armed" to wanted.size))
    }
    val register = {
      if (add.isEmpty()) {
        // Nothing moved and nothing is new: every fence is already registered, and re-adding them
        // is exactly what made the reminder fire again on each app open.
        finish()
      } else {
        try {
          LocationServices.getGeofencingClient(ctx)
            .addGeofences(request(add), pending(ctx))
            .addOnSuccessListener { finish() }
            .addOnFailureListener { done(ERROR) }
        } catch (_: SecurityException) {
          done(DENIED)
        } catch (_: Exception) {
          done(UNAVAILABLE)
        }
      }
    }
    if (stale.isEmpty()) {
      register()
      return
    }
    try {
      LocationServices.getGeofencingClient(ctx)
        .removeGeofences(stale)
        .addOnSuccessListener { register() }
        // A fence we could not remove is a fence that may fire once more; adding the new set still
        // has to happen, or the person loses the reminders they just asked for.
        .addOnFailureListener { register() }
    } catch (_: Exception) {
      register()
    }
  }

  /** Whether an armed fence still means the same thing: same id, same place, same radius. */
  private fun same(a: TulmiArrivalStore.Item, b: TulmiArrivalStore.Item): Boolean =
    a.id == b.id && a.lat == b.lat && a.lon == b.lon && a.radiusM == b.radiusM

  private fun request(items: List<TulmiArrivalStore.Item>): GeofencingRequest {
    val fences = items.map { item ->
      Geofence.Builder()
        .setRequestId(item.fenceId)
        .setCircularRegion(item.lat, item.lon, item.radiusM)
        .setExpirationDuration(Geofence.NEVER_EXPIRE)
        .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER)
        .build()
    }
    return GeofencingRequest.Builder()
      // NO INITIAL TRIGGER. A reminder is for arriving somewhere, and a sync that runs on every page
      // appear would otherwise fire it again and again for a place the person is already at — at
      // home, every time they open the app. The fence fires on a real crossing, as the words say.
      .setInitialTrigger(0)
      .addGeofences(fences)
      .build()
  }

  /** The ids armed, as the phone knows them (`x0.arrive.<id>`). */
  fun list(ctx: Context): List<String> = TulmiArrivalStore.all(ctx).map { it.fenceId }

  /** Removes every one of ours and forgets the set. `done(true)` when the system confirmed it. */
  fun clear(ctx: Context, done: (Boolean) -> Unit) {
    TulmiArrivalStore.forget(ctx)
    try {
      LocationServices.getGeofencingClient(ctx)
        .removeGeofences(pending(ctx))
        .addOnSuccessListener { done(true) }
        .addOnFailureListener { done(false) }
    } catch (_: Exception) {
      done(false)
    }
  }

  /**
   * Re-registers the stored set after a reboot, which clears every geofence on the phone.
   *
   * `readd = true`: nothing is registered any more, so the whole set goes back. `done` is called
   * when the system has answered, which is what lets the boot receiver hold its process open.
   */
  internal fun reregister(ctx: Context, done: (Any) -> Unit) {
    val items = TulmiArrivalStore.all(ctx)
    if (items.isEmpty() || !fineGranted(ctx) || !backgroundGranted(ctx)) {
      done(mapOf("armed" to 0))
      return
    }
    sync(ctx, items, readd = true, done = done)
  }

  /** MUTABLE on Android 12+, because the system puts the geofence event into it. */
  private fun pending(ctx: Context): PendingIntent {
    val intent = Intent(ACTION).setPackage(ctx.packageName)
    var flags = PendingIntent.FLAG_UPDATE_CURRENT
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags = flags or PendingIntent.FLAG_MUTABLE
    return PendingIntent.getBroadcast(ctx, REQUEST, intent, flags)
  }
}

/**
 * ARRIVAL, REBOOT, AND "THEY ARE GONE". The only three things that reach this app's code about a
 * place — and the third carries no place at all, only the news that the system dropped our fences.
 *
 * On arrival: look the item up by the geofence's id and show its reminder. That is the end of it —
 * no request, no log, no analytics (SPEC 7.2). The event carries the person's position; this
 * receiver never reads it, never passes it on and never writes it down, and the only field it
 * touches is the triggering geofence's **request id**, which is a string the server already knows
 * because it sent it.
 *
 * On BOOT_COMPLETED: re-arm the stored set, because Android drops geofences on restart.
 *
 * Declared in the merged manifest only with `TULMI_ANDROID_ARRIVAL` on (the config plugin,
 * ANDROID-WIRING.md). Not exported for the geofence action; the boot filter has to be, as every
 * boot receiver does, and it reads nothing it is given.
 */
class TulmiArrivalReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) {
    try {
      if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == "android.intent.action.QUICKBOOT_POWERON") {
        // goAsync, because re-arming is a Task: a cold boot process that returns from onReceive can
        // be killed before Play services answers, and the reminders would silently never come back.
        val pending = goAsync()
        TulmiArrivalGeofences.reregister(ctx) { pending.finish() }
        return
      }
      if (intent.action != TulmiArrivalGeofences.ACTION) return
      val event = GeofencingEvent.fromIntent(intent) ?: return
      if (event.hasError()) {
        // GEOFENCE_NOT_AVAILABLE IS THE ONE ERROR THAT MEANS "THEY ARE GONE": the system drops
        // every fence when location is turned off on the phone, and Google's geofencing guide says
        // an app has to register again afterwards. Nothing tells us a second time, and the stored
        // list still names them, so without this flag every later sync would count them as armed
        // and the reminders would quietly stop. The next sync re-adds the lot instead.
        if (event.errorCode == GeofenceStatusCodes.GEOFENCE_NOT_AVAILABLE) TulmiArrivalStore.markStale(ctx)
        return
      }
      if (event.geofenceTransition != Geofence.GEOFENCE_TRANSITION_ENTER) return
      // triggeringLocation is deliberately NOT read. The ids are all we use, and all we need.
      val ids = event.triggeringGeofences?.map { it.requestId } ?: return
      for (id in ids) {
        val item = TulmiArrivalStore.one(ctx, id) ?: continue
        TulmiArrivalStore.notifyArrival(ctx, item)
      }
    } catch (_: Exception) {
      // A malformed broadcast shows nothing. The item stays open, so the next arrival fires again.
    }
  }
}
