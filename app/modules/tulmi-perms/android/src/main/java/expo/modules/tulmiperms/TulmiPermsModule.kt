package expo.modules.tulmiperms

import android.Manifest
import android.app.Activity
import android.app.NotificationManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Geocoder
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.CalendarContract
import android.provider.ContactsContract
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.Locale

/**
 * The Android half of "Add from contacts" and "Use my location" (perms/SPEC.md 2, 3, 6.2).
 *
 * pickEmail()           ACTION_PICK on Email.CONTENT_TYPE. The Contacts app runs outside this
 *                       app and hands back ONE row this app may read once, so there is no
 *                       READ_CONTACTS, no prompt and no store form. The address book is never
 *                       read, counted or uploaded.
 * locationStatus()      what the system says about ACCESS_COARSE_LOCATION. Never asks. On Android
 *                       it answers "granted", "denied" or "undetermined" and NEVER "blocked":
 *                       nothing but a refused request tells the two apart here.
 * locationAsk()         asks nothing on Android, and answers "granted" or "undetermined" only.
 *                       The JS must ask with PermissionsAndroid, whose never_ask_again is the only
 *                       honest way to tell "blocked" from "refused once"; this exists so the one
 *                       JS path can call the same name on both phones.
 * locationArea(timeout) one fix (the fused provider from Android 12, which the system coarsens for
 *                       an app holding only COARSE; the network provider otherwise and as the
 *                       fallback), then Geocoder, which is the phone's own Google service naming
 *                       the point. Only the area words come back: THE COORDINATE NEVER REACHES
 *                       JAVASCRIPT, and no street, house number or postcode is ever read off the
 *                       address.
 *
 * Nothing here repeats, runs in the background or keeps anything: one fix per tap, as the
 * app's card and the permission's purpose say.
 *
 * ADDED IN BUILD 8.9.1 (perms2/SPEC.md 2.6, 4.3, 8.5, 9.2). The four below need NO Android
 * permission at all:
 *
 * calendarEditor(e)     ACTION_INSERT on the calendar's events, which opens the CALENDAR APP'S
 *                       own new-event screen with the fields filled in. The person taps Save
 *                       there, in their calendar, not here. No READ_CALENDAR, no
 *                       WRITE_CALENDAR, no Play form, and nothing is ever read back: Android
 *                       does not report whether they saved, so this answers only "opened" or
 *                       "unavailable" and the app says nothing either way.
 * focusState()          getCurrentInterruptionFilter(), which needs no permission at all
 *                       (ACCESS_NOTIFICATION_POLICY is for CHANGING Do Not Disturb, and this
 *                       app never changes it). Just whether a quiet mode is on, so Plan Ease
 *                       can send a notice instead of ringing. Never which mode, never a schedule
 *                       and never anything about other apps.
 * integrityPrepare(p)   Play Integrity's warm-up and token, for abuse and fraud prevention
 * integrityToken(h)     only. The work is in TulmiTrust.kt, which says what it may and may not
 *                       do; these two are the doorway.
 * abilities()           what THIS binary on THIS Android version can really do, read from the
 *                       binary itself, so the JavaScript can only claim a thing the build
 *                       carries. Android's row: the calendar intent and Do Not Disturb always;
 *                       sleep only while READ_SLEEP is in this package's requested permissions,
 *                       which the build switch decides; Play Integrity always, because a phone
 *                       without Play services is a call-time "no signal" and not a lie about
 *                       what the build can do. The three 8.9.1 switches below read the same way.
 *
 * AND THE THREE BEHIND THEIR OWN BUILD SWITCH (perms2/SPEC.md 2, 5, 7;
 * perms2/ANDROID-WIRING.md). Each is OFF in every shipping profile, and off means the
 * permission is removed from the merged manifest, the code is not compiled in, and abilities()
 * says false — so the server draws no row at all:
 *
 * calendarStatus()      TULMI_ANDROID_CALENDAR, READ_CALENDAR, READ ONLY. Busy times for 14 days
 * calendarAsk()         and nothing else (TulmiCalendarRead.kt). Neither of the first two asks:
 * calendarBusy(f,t,n)   only PermissionsAndroid can, so src/device/calendar.ts does the asking.
 * motionStatus()        TULMI_ANDROID_MOTION, ACTIVITY_RECOGNITION (plus the API 24-28 Play
 * motionAsk()           services twin). Daily steps from TYPE_STEP_COUNTER (TulmiMotionSteps.kt)
 * motionDays(f,t,o)     and the "in a car?" check from Play services' activity transitions
 * motionDriving(w)      (TulmiMotionDrive.kt, src/motion or src/motionOff). motionWatch and
 * motionWatch(on)       motionForget have no iPhone twin: Android can only answer the driving
 * motionForget()        check while registered, and has to keep daily totals itself.
 * arrivalArm(items)     TULMI_ANDROID_ARRIVAL, ACCESS_FINE_LOCATION + ACCESS_BACKGROUND_LOCATION,
 * arrivalList()         which need Play's background-location declaration, a demo video and a
 * arrivalClear()        human review. A GeofencingClient, enter only, and the reminder shown by
 *                       this app itself (TulmiArrivalGeofences.kt, src/arrival or src/arrivalOff).
 *                       The position never reaches JavaScript and nobody is told of an arrival.
 */
class TulmiPermsModule : Module() {
  /** The one picker in flight, if any: a second call is refused rather than crossing wires. */
  private var picking: Promise? = null

  /** Play Integrity, kept for the process so one warm-up serves every token. See TulmiTrust.kt. */
  private val trust = TulmiTrust()

  override fun definition() = ModuleDefinition {
    Name("TulmiPerms")

    AsyncFunction("pickEmail") { promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject("no_screen", "There is no screen to open the contact picker on.", null)
        return@AsyncFunction
      }
      if (picking != null) {
        promise.reject("busy", "The contact picker is already open.", null)
        return@AsyncFunction
      }
      val intent = Intent(Intent.ACTION_PICK).apply {
        type = ContactsContract.CommonDataKinds.Email.CONTENT_TYPE
      }
      try {
        picking = promise
        activity.startActivityForResult(intent, PICK_EMAIL)
      } catch (e: Exception) {
        // No Contacts app, or it refused to open: the person types the address instead.
        picking = null
        promise.reject("no_contacts", "This phone has no contact picker.", e)
      }
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != PICK_EMAIL) return@OnActivityResult
      val promise = picking ?: return@OnActivityResult
      picking = null
      val ctx = appContext.reactContext
      val data = payload.data
      if (payload.resultCode != Activity.RESULT_OK || data == null || ctx == null) {
        // Backed out: nothing happened, and the field keeps whatever was typed.
        promise.resolve(null)
        return@OnActivityResult
      }
      promise.resolve(emailOf(ctx, data.data))
    }

    Function("locationStatus") {
      val ctx = appContext.reactContext ?: return@Function "undetermined"
      if (ctx.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
        return@Function "granted"
      }
      // Not held. Android only tells the two apart through the activity: "show a reason" means
      // it was refused once and may be asked again; otherwise it was never asked, or it is off
      // for good, which the JS learns from PermissionsAndroid's never_ask_again when it asks.
      val activity = appContext.currentActivity
      if (activity != null && activity.shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_COARSE_LOCATION)) {
        "denied"
      } else {
        "undetermined"
      }
    }

    // Asks nothing here, and never answers "denied" or "blocked": only PermissionsAndroid's
    // never_ask_again tells those apart, so the JS asks with it on Android and uses this
    // only to see whether the permission is already held.
    AsyncFunction("locationAsk") { promise: Promise ->
      val ctx = appContext.reactContext
      val granted = ctx != null &&
        ctx.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
      promise.resolve(if (granted) "granted" else "undetermined")
    }

    AsyncFunction("locationArea") { timeoutMs: Double, promise: Promise ->
      val ctx = appContext.reactContext
      if (ctx == null) {
        promise.reject("no_context", "The app is not running.", null)
        return@AsyncFunction
      }
      if (ctx.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
        promise.reject("no_fix", "X0 Bot may not see where this phone is.", null)
        return@AsyncFunction
      }
      val wait = if (timeoutMs.isFinite() && timeoutMs > 0) timeoutMs.toLong() else 15_000L
      oneFix(ctx, wait) { spot ->
        if (spot == null) promise.reject("no_fix", "The phone could not say where it is.", null)
        else name(ctx, spot) { parts -> promise.resolve(parts) }
      }
    }

    // ---------------------------------------------------------------- build 8.9.1

    /**
     * The calendar app's own new-event screen, filled in. No permission, no prompt, no form.
     *
     * Started with startActivity, not startActivityForResult, on purpose: Android's calendar
     * apps do not report a usable result code for ACTION_INSERT (Google Calendar and Samsung
     * Calendar both answer RESULT_CANCELED whether the person saved or backed out), so pretending
     * to know would be worse than saying nothing. "opened" is the whole truth, and the app shows
     * no "Added" toast on Android because of it.
     */
    AsyncFunction("calendarEditor") { e: EditorEvent, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject("no_screen", "There is no screen to open the calendar on.", null)
        return@AsyncFunction
      }
      val intent = Intent(Intent.ACTION_INSERT).apply {
        data = CalendarContract.Events.CONTENT_URI
        putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, e.startMs.toLong())
        e.endMs?.let { putExtra(CalendarContract.EXTRA_EVENT_END_TIME, it.toLong()) }
        putExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, e.allDay)
        putExtra(CalendarContract.Events.TITLE, e.title)
        e.notes?.let { putExtra(CalendarContract.Events.DESCRIPTION, it) }
      }
      try {
        activity.startActivity(intent)
        promise.resolve("opened")
      } catch (_: ActivityNotFoundException) {
        // No calendar app on this phone. The app says so and offers nothing else: starting the
        // intent and catching this is why no <queries> entry is needed.
        promise.resolve("unavailable")
      } catch (e2: Exception) {
        promise.reject("no_calendar", "The calendar app would not open.", e2)
      }
    }

    /**
     * Whether a quiet mode is on, and nothing else. Reading the interruption filter needs no
     * permission; CHANGING it would need ACCESS_NOTIFICATION_POLICY, which this app does not
     * have and never asks for.
     */
    Function("focusState") { focusState() }

    /** Play Integrity's warm-up. See TulmiTrust.kt for what this may and may not do. */
    AsyncFunction("integrityPrepare") { cloudProjectNumber: String, promise: Promise ->
      val ctx = appContext.reactContext
      if (ctx == null) {
        promise.reject("no_context", "The app is not running.", null)
        return@AsyncFunction
      }
      trust.prepare(
        ctx,
        cloudProjectNumber,
        // true, not null: the JavaScript's mirror (src/device/natives.ts) reads a boolean, and a
        // warm-up that worked is the only thing it needs to know before asking for a token.
        { promise.resolve(true) },
        { code, why -> promise.reject(code, why, null) }
      )
    }

    /** One Play Integrity token over the server's request hash. Never logged, never kept. */
    AsyncFunction("integrityToken") { requestHash: String, promise: Promise ->
      trust.token(
        requestHash,
        { token -> promise.resolve(token) },
        { code, why -> promise.reject(code, why, null) }
      )
    }

    /** What this binary on this Android version can really do (perms2/SPEC.md 9.2). */
    Function("abilities") { abilities() }

    // ------------------------------------------------------------- 8.9.1: calendar read (Android)
    // The same four functions the iPhone has, so src/device/calendar.ts needs no platform branch.
    //
    // NEITHER OF THESE ASKS, AND NEITHER CAN EVER SAY "blocked", for the same reason locationStatus
    // does not (see its note above): Android tells "don't ask again" from "never asked" only
    // through a request. calendarAsk() therefore prompts nothing and answers "granted" or
    // "undetermined".
    //
    // So the JavaScript MUST ask with PermissionsAndroid. A path that called only calendarAsk()
    // could never be granted anything: the card's Continue would show no system sheet and the
    // person would be told "X0 Bot can't see your calendar" without ever having been asked.
    // src/device/androidCalendarCore.ts holds that flow (`calendarReady`) and its test proves
    // ask:true reaches a real request.
    Function("calendarStatus") {
      val ctx = appContext.reactContext ?: return@Function "undetermined"
      if (TulmiCalendarRead.granted(ctx)) return@Function "granted"
      val activity = appContext.currentActivity
      if (activity != null &&
        activity.shouldShowRequestPermissionRationale(Manifest.permission.READ_CALENDAR)
      ) "denied" else "undetermined"
    }

    AsyncFunction("calendarAsk") { promise: Promise ->
      val ctx = appContext.reactContext
      promise.resolve(if (ctx != null && TulmiCalendarRead.granted(ctx)) "granted" else "undetermined")
    }

    // BUSY TIMES ONLY: {s, e, allDay}, free/cancelled/declined skipped, all-day placed on the right
    // LOCAL day, window clamped to 15 days and never before yesterday, 300 blocks at most, oldest
    // first. No title, place, note, person or calendar name is in the query at all
    // (TulmiCalendarRead.kt's seven-column projection), so none of it exists in this process.
    //
    // REJECTS when the permission is not held, rather than resolving an empty list. The difference
    // matters: an empty list means the window really is free, and posting one for a revoked grant
    // would wipe the blocks the server already has. The same shape as locationArea's rejection.
    AsyncFunction("calendarBusy") { fromMs: Double, toMs: Double, max: Double, promise: Promise ->
      val ctx = appContext.reactContext
      if (ctx == null) {
        promise.reject("no_context", "The app is not running.", null)
        return@AsyncFunction
      }
      val blocks = TulmiCalendarRead.busy(ctx, fromMs, toMs, max)
      if (blocks == null) promise.reject("no_calendar", "X0 Bot may not read this phone's calendars.", null)
      else promise.resolve(blocks)
    }

    // ------------------------------------------------------------------- 8.9.1: motion (Android)
    // ONE grant for both halves: from Android 10 the system refuses a step-counter listener without
    // ACTIVITY_RECOGNITION, and the driving check needs it too — as they share
    // NSMotionUsageDescription on the iPhone. Same "never says blocked" note as the calendar above.
    Function("motionStatus") {
      val ctx = appContext.reactContext ?: return@Function "undetermined"
      if (!TulmiMotionSteps.available(ctx)) return@Function "denied"
      if (TulmiMotionSteps.granted(ctx)) return@Function "granted"
      val activity = appContext.currentActivity
      if (activity != null &&
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
        activity.shouldShowRequestPermissionRationale(Manifest.permission.ACTIVITY_RECOGNITION)
      ) "denied" else "undetermined"
    }

    AsyncFunction("motionAsk") { promise: Promise ->
      val ctx = appContext.reactContext
      promise.resolve(if (ctx != null && TulmiMotionSteps.granted(ctx)) "granted" else "undetermined")
    }

    // Daily steps, the same {day, steps, spans} the iPhone answers. `spans` IS ALWAYS EMPTY on
    // Android, and that is a decision, not a gap to fill later: there is no queryable motion
    // history there, and a guessed ride on a fitness bot's streak is worse than none. The note at
    // the top of TulmiMotionSteps.kt says it in full, and src/device/motion.ts's readMotion empties
    // `spans` on this platform before the payload is built, so a future build cannot start
    // inventing them quietly.
    //
    // A DAY X0 BOT NEVER READ ON IS ABSENT, NEVER A ZERO: the step counter is a since-boot total
    // with no history, so only days it was read on can be known, and a zero would say "walked
    // nothing" and break a streak the person earned.
    //
    // Rejects, rather than resolving empty, when the permission is not held, the phone has no step
    // counter, or the sensor said nothing in time — same reasoning as calendarBusy.
    AsyncFunction("motionDays") { fromMs: Double, toMs: Double, offsetMin: Double, promise: Promise ->
      val ctx = appContext.reactContext
      if (ctx == null) {
        promise.reject("no_context", "The app is not running.", null)
        return@AsyncFunction
      }
      TulmiMotionSteps.days(ctx, fromMs, toMs, offsetMin) { days ->
        if (days == null) promise.reject("no_steps", "This phone cannot count steps for X0 Bot.", null)
        else promise.resolve(days)
      }
    }

    // Is the phone in a car right now? true, false, or NULL FOR "we do not know" — which is the
    // common answer on Android, and a real one: the server's rule for no answer is to ring as it
    // does today (SPEC 5.3). Silence is never reported as false. Nothing is kept past the window:
    // every read deletes a line that is too old to answer with.
    AsyncFunction("motionDriving") { windowSec: Double, promise: Promise ->
      val ctx = appContext.reactContext
      if (ctx == null) {
        promise.resolve(null)
      } else {
        // Idempotent, and it costs nothing when the registration is already live: a reboot drops
        // the activity-transition registration, and this is the second of the two places that put
        // it back (the other is the receiver's BOOT_COMPLETED branch). Without either, the
        // person's switch stays on and the answer is "unknown" for ever after the first restart.
        TulmiMotionDrive.ensureWatching(ctx)
        promise.resolve(TulmiMotionDrive.driving(ctx, if (windowSec.isFinite()) windowSec.toInt() else 0))
      }
    }

    // ANDROID ONLY, and the one pair of names that has no iPhone twin. The iPhone can query a
    // motion history, so it needs no watch and keeps no ledger; Android has to be registered for
    // car transitions to know anything, and has to keep daily step totals itself.
    //
    // `motionWatch(false)` and `motionForget()` are what "switching it off deletes them" means on
    // the phone (SPEC 5.1, 5.2): the transition line and every daily total go, in the same breath as
    // the server's rows. On iPhone both can be a no-op that answers true.
    AsyncFunction("motionWatch") { on: Boolean, promise: Promise ->
      val ctx = appContext.reactContext
      promise.resolve(ctx != null && TulmiMotionDrive.watch(ctx, on))
    }

    AsyncFunction("motionForget") { promise: Promise ->
      val ctx = appContext.reactContext
      if (ctx != null) {
        TulmiMotionSteps.forget(ctx)
        TulmiMotionDrive.forget(ctx)
      }
      promise.resolve(true)
    }

    // ------------------------------------------------------------------- 8.9.1: arrival (Android)
    // Replaces the x0.arrive.* set, at most 10, enter only, never expiring. Resolves { armed: n } —
    // the same object the iPhone resolves — or a word.
    //
    // ANDROID HAS ONE STATE THE IPHONE DOES NOT: "background". Precise location IS held and "Allow
    // all the time" is not, and from Android 11 the system shows no prompt for it at all, so the way
    // on is OUR OWN CARD and then the system's own location page (Play requires the explanation
    // first). "approximate" sits in the same slot and is CARRIED THROUGH, not folded into a denial
    // (androidArrivalCore.ts's arrivalOutcome, one mapping for both phones): on the iPhone it is the
    // screen's own answer — arrival reminders need Precise Location — and on Android it is what
    // arrivalGrants says when the person picks Approximate in the sheet, before anything is armed.
    // This function never produces the word: a geofence either has precise location, or "denied".
    //
    // THE PHONE'S POSITION NEVER COMES BACK, AND NOBODY IS TOLD OF AN ARRIVAL: the receiver looks
    // the item up by the geofence's own request id — a string this app chose — shows one local
    // notification, and returns (TulmiArrivalGeofences.kt).
    AsyncFunction("arrivalArm") { items: List<Map<String, Any?>>, promise: Promise ->
      val ctx = appContext.reactContext
      if (ctx == null) {
        promise.resolve(TulmiArrivalGeofences.UNAVAILABLE)
        return@AsyncFunction
      }
      TulmiArrivalGeofences.arm(ctx, items) { answer -> promise.resolve(answer) }
    }

    AsyncFunction("arrivalList") { promise: Promise ->
      val ctx = appContext.reactContext
      promise.resolve(if (ctx == null) emptyList<String>() else TulmiArrivalGeofences.list(ctx))
    }

    AsyncFunction("arrivalClear") { promise: Promise ->
      val ctx = appContext.reactContext
      if (ctx == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      TulmiArrivalGeofences.clear(ctx) { promise.resolve(null) }
    }
  }

  // ------------------------------------------------------------------ build 8.9.1

  /**
   * PRIORITY, ALARMS and NONE all mean "the person asked for quiet", so all three read as on.
   * ALL means off. UNKNOWN (which some phones answer) reads as OFF: never claim a quiet mode is
   * on when the phone did not say so, because that would silence a call the person expected.
   */
  private fun focusState(): Map<String, Boolean>? {
    val ctx = appContext.reactContext ?: return null
    val manager = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return null
    val filter = try {
      manager.currentInterruptionFilter
    } catch (_: Exception) {
      return null
    }
    val on = filter == NotificationManager.INTERRUPTION_FILTER_PRIORITY ||
      filter == NotificationManager.INTERRUPTION_FILTER_ALARMS ||
      filter == NotificationManager.INTERRUPTION_FILTER_NONE
    return mapOf("on" to on)
  }

  /**
   * Read off the binary, never guessed, so a build switch turned off takes its capability with
   * it and the JavaScript cannot claim something this build does not carry.
   *
   * Three of them are in this build when their own switch is on (`TULMI_ANDROID_CALENDAR`,
   * `_MOTION`, `_ARRIVAL`) — busy times, steps and the "in a car?" check, and geofenced arrival
   * reminders. Every shipping profile has all three off, so `abilities()` on a release build
   * answers exactly what it answered before. Reminders has no Android store to sync with, and App
   * Attest and DeviceCheck are Apple's.
   */
  private fun abilities(): Map<String, Boolean> = mapOf(
    // The calendar app's own screen. Tried at use, and "unavailable" if no app answers.
    "calendarAdd" to true,
    // Busy times only, and only while TULMI_ANDROID_CALENDAR put READ_CALENDAR in the manifest.
    "calendarRead" to requests(Manifest.permission.READ_CALENDAR),
    "reminders" to false,
    // getCurrentInterruptionFilter, on every Android this app runs on.
    "focus" to true,
    // Steps and the "in a car?" check share one grant, and a phone with no step counter gets
    // neither — so the row is not drawn on a phone that could not answer it.
    "motion" to (requests(Manifest.permission.ACTIVITY_RECOGNITION) && stepCounter()),
    // Only while the build switch put READ_SLEEP in the manifest.
    "healthSleep" to requests(SLEEP_PERMISSION),
    // Precise + "Allow all the time" in the manifest AND geofencing compiled in. Both are behind
    // TULMI_ANDROID_ARRIVAL, which is off in every shipping profile until Play has approved the
    // background-location declaration (backend docs/owner-8.9.1.md).
    "arrival" to (
      requests(Manifest.permission.ACCESS_BACKGROUND_LOCATION) &&
        TulmiArrivalGeofences.supported()
      ),
    "appAttest" to false,
    "deviceCheck" to false,
    // A phone without Play services fails at call time, which the server reads as no signal —
    // not as a build that lied about what it carries.
    "playIntegrity" to true,
  )

  /** Whether this phone has a step counter at all. A phone without one never shows the Motion row. */
  private fun stepCounter(): Boolean {
    val ctx = appContext.reactContext ?: return false
    return TulmiMotionSteps.available(ctx)
  }

  /** Whether this package's merged manifest asks for `name`. */
  private fun requests(name: String): Boolean {
    val ctx = appContext.reactContext ?: return false
    return try {
      val packages = ctx.packageManager
      val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        packages.getPackageInfo(
          ctx.packageName,
          PackageManager.PackageInfoFlags.of(PackageManager.GET_PERMISSIONS.toLong())
        )
      } else {
        @Suppress("DEPRECATION")
        packages.getPackageInfo(ctx.packageName, PackageManager.GET_PERMISSIONS)
      }
      info.requestedPermissions?.contains(name) == true
    } catch (_: Exception) {
      false
    }
  }

  // ------------------------------------------------------------------ contacts

  /** The one address of the row the Contacts app handed back, or null. The grant dies with this read. */
  private fun emailOf(ctx: Context, row: Uri?): String? {
    if (row == null) return null
    return try {
      ctx.contentResolver.query(
        row,
        arrayOf(ContactsContract.CommonDataKinds.Email.ADDRESS),
        null,
        null,
        null
      )?.use { c ->
        if (!c.moveToFirst()) return@use null
        c.getString(0)?.trim()?.ifEmpty { null }
      }
    } catch (_: Exception) {
      null
    }
  }

  // ------------------------------------------------------------------ one fix, then the words

  /**
   * One location. Never repeats, and COARSE stays the only permission this app holds.
   *
   * From Android 12 the fused provider is open to an app with COARSE alone, and the system
   * coarsens what it hands back. The network provider is the fallback, and on a phone with
   * Google Location Accuracy turned off it is the provider that is off — which used to end
   * in "Couldn't find your area" with GPS on and nothing wrong.
   */
  private fun oneFix(ctx: Context, waitMs: Long, done: (Location?) -> Unit) {
    val manager = ctx.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
    if (manager == null) {
      done(null)
      return
    }
    val provider = pickProvider(manager)
    val answered = java.util.concurrent.atomic.AtomicBoolean(false)
    fun finish(spot: Location?) {
      if (answered.getAndSet(true)) return
      done(spot)
    }
    if (!manager.isProviderEnabled(provider)) {
      // Location is off on the phone itself. The last thing it knew is better than nothing,
      // and the person can always type their area.
      finish(lastKnown(manager, provider))
      return
    }
    val main = Handler(Looper.getMainLooper())
    main.postDelayed({ finish(lastKnown(manager, provider)) }, waitMs)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        manager.getCurrentLocation(provider, null, ctx.mainExecutor) { spot -> finish(spot) }
      } else {
        val listener = object : LocationListener {
          override fun onLocationChanged(spot: Location) {
            manager.removeUpdates(this)
            finish(spot)
          }

          // Kept for Android 10 and below, where the system still calls them.
          override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
          override fun onProviderEnabled(provider: String) = Unit
          override fun onProviderDisabled(provider: String) {
            manager.removeUpdates(this)
            finish(null)
          }
        }
        manager.requestLocationUpdates(provider, 0L, 0f, listener, Looper.getMainLooper())
        main.postDelayed({ manager.removeUpdates(listener) }, waitMs)
      }
    } catch (_: SecurityException) {
      finish(null)
    } catch (_: Exception) {
      finish(null)
    }
  }

  /** The fused provider where this phone has it and it is on, else the network provider. */
  private fun pickProvider(manager: LocationManager): String {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val fused = LocationManager.FUSED_PROVIDER
      val usable = try {
        manager.hasProvider(fused) && manager.isProviderEnabled(fused)
      } catch (_: Exception) {
        false
      }
      if (usable) return fused
    }
    return LocationManager.NETWORK_PROVIDER
  }

  private fun lastKnown(manager: LocationManager, provider: String): Location? = try {
    manager.getLastKnownLocation(provider)
  } catch (_: Exception) {
    null
  }

  /**
   * The phone's own geocoder names the point: on a phone with Google's services that means
   * Google sees it, as part of the phone, not as anything this app sends. Without a backend
   * (Geocoder.isPresent false, or nothing comes back) the answer is null and the person types
   * their area, exactly as today.
   */
  private fun name(ctx: Context, spot: Location, done: (Map<String, String>?) -> Unit) {
    if (!Geocoder.isPresent()) {
      done(null)
      return
    }
    val geocoder = Geocoder(ctx, Locale.getDefault())
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      geocoder.getFromLocation(spot.latitude, spot.longitude, 1, object : Geocoder.GeocodeListener {
        override fun onGeocode(addresses: MutableList<android.location.Address>) {
          done(parts(addresses.firstOrNull()))
        }

        override fun onError(message: String?) {
          done(null)
        }
      })
      return
    }
    // The blocking call, off the main thread as its own documentation asks.
    Thread {
      val parts = try {
        @Suppress("DEPRECATION")
        parts(geocoder.getFromLocation(spot.latitude, spot.longitude, 1)?.firstOrNull())
      } catch (_: Exception) {
        null
      }
      done(parts)
    }.start()
  }

  /** The area, in words. thoroughfare, subThoroughfare and postalCode are never read. */
  private fun parts(address: android.location.Address?): Map<String, String>? {
    if (address == null) return null
    val out = LinkedHashMap<String, String>()
    fun put(key: String, value: String?) {
      val v = value?.trim().orEmpty()
      if (v.isNotEmpty()) out[key] = v
    }
    put("subLocality", address.subLocality)
    put("locality", address.locality)
    put("subAdminArea", address.subAdminArea)
    put("adminArea", address.adminArea)
    put("countryCode", address.countryCode)
    return if (out.isEmpty()) null else out
  }

  private companion object {
    const val PICK_EMAIL = 0x7ED1

    /** Health Connect's sleep read, behind TULMI_ANDROID_HEALTH_SLEEP in app/app.config.ts. */
    const val SLEEP_PERMISSION = "android.permission.health.READ_SLEEP"
  }
}

/**
 * What calendarEditor is given. The item's own words and times, and nothing else: no link with a
 * token, no place, nobody else's name. `notes` carries the item's own text and the line
 * "Made with X0 Bot".
 *
 * Times are milliseconds since the epoch, as JavaScript counts them, and an all-day event is no
 * different here: the caller (src/device/calendarCore.ts) passes the server's own instant through
 * unchanged, so both phones are handed the same number. The iPhone wants exactly that — an EKEvent
 * with isAllDay reads the local day. Whether an Android calendar app reads an all-day
 * EXTRA_EVENT_BEGIN_TIME as local or as UTC is not settled here, so N0 opens an all-day item in
 * IST on Google Calendar and on Samsung Calendar and looks at which day it lands on. Only if it
 * lands a day early does the JavaScript start mapping all-day to UTC midnight for Android.
 */
class EditorEvent : Record {
  @Field val title: String = ""

  @Field val startMs: Double = 0.0

  /** Left out for an event with no end; the calendar app picks its own default length then. */
  @Field val endMs: Double? = null

  @Field val allDay: Boolean = false

  @Field val notes: String? = null
}
