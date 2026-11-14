package expo.modules.tulmiperms

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone
import org.json.JSONObject

/**
 * MOTION ON ANDROID: DAILY STEPS FROM THE PHONE'S OWN STEP COUNTER (perms2/SPEC.md 5.1, 9.1; Android
 * half, build 8.9.1). No Play services, no Health Connect, no Google Fit.
 *
 * The same function and the same answer as the iPhone's `motionDays(fromMs, toMs, offsetMin)`
 * (SPEC 5.4): `[{ day, steps, spans }]`, so `src/device/motion.ts` needs no platform branch beyond
 * the capability gate.
 *
 * `spans` IS ALWAYS EMPTY ON ANDROID, and that is a design decision, not a gap to fill later. The
 * iPhone's walk/run/ride spans come from CMMotionActivityManager, which keeps a queryable history.
 * Android's only equivalents are Google Fit (shut down) and Play services' activity recognition,
 * which reports transitions as they happen and keeps no history, so a "ride of 10 minutes or more"
 * could only ever be a guess assembled from events we happened to be awake for. A made-up workout
 * on a fitness bot's streak is worse than no workout, so Android sends steps and nothing else:
 * `window()` below writes `spans` as an empty list and there is no code path that can fill it. (The
 * JavaScript side is `motionCore.motionRead`, shared with the iPhone; it would accept spans, so the
 * promise is kept HERE, where the only Android producer is.) An Android person who wants exercise
 * minutes connects Health Connect (`TULMI_ANDROID_HEALTH`), which really knows them.
 *
 * WHAT THE COUNTER CAN AND CANNOT SAY. `TYPE_STEP_COUNTER` is a running total since the phone last
 * booted. There is no history in it at all: it answers "how many steps since boot", once, now. So a
 * daily total has to be kept by us, and this is the whole of that bookkeeping — a ledger in this
 * module's own SharedPreferences, holding, per day, a step count and nothing else:
 *
 *   - a day X0 Bot never read on is **absent**, never a zero. A zero would read as "walked nothing"
 *     and would quietly break a streak the person did earn.
 *   - a day is closed at ITS OWN LAST READ. The steps between that read and the next one — which
 *     may be minutes later, across midnight, or four days later — belong to nobody and are
 *     dropped. Crediting them to the older day would pin Tuesday to Wednesday's figure the first
 *     time someone does not open the app for a week, and crediting them to today would make a
 *     streak out of a walk that happened days ago. A count that is a little low is honest; a
 *     fabricated daily total is not. (Health sync runs on page appear, so gaps are normal.)
 *   - a reboot restarts the counter. The steps up to the last read are kept, and everything the
 *     counter has since the reboot is put on the day of this read. Steps taken while the phone was
 *     off are nobody's. A reboot is seen two ways, because one is not enough: the counter reading
 *     below the last one, and `Settings.Global.BOOT_COUNT` changing — the second catches a reboot
 *     followed by more steps than the old reading, which the first would miss and undercount.
 *   - at most MAX_DAYS days are kept, oldest dropped first (the server keeps 31 too, SPEC 5.1).
 *
 * Nothing else is in the ledger: no time finer than a day, no place, no sensor sample, no source
 * app. `TulmiArrivalStore`-style JSON in one key, so the whole of what this feature stores on the
 * phone is one line of text.
 *
 * PERMISSION: `ACTIVITY_RECOGNITION` (runtime, API 29+), behind the build switch
 * `TULMI_ANDROID_MOTION`. From Android 10 the system refuses to register a step-counter listener
 * without it, so the steps read and the driving check (TulmiMotionDrive) share the one grant, as
 * they share `NSMotionUsageDescription` on the iPhone.
 */
object TulmiMotionSteps {
  /** How many days of totals the ledger keeps. The same 31 as the server (SPEC 5.1). */
  const val MAX_DAYS = 31

  /** How long to wait for the sensor's first report before giving up. */
  const val READ_TIMEOUT_MS = 4_000L

  private const val PREFS = "tulmi.motion"
  private const val LEDGER = "steps.ledger"
  private const val DAY_MS = 86_400_000L

  /** Whether the runtime permission the step counter needs is held. Never asks. */
  fun granted(ctx: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true
    return ctx.checkSelfPermission(Manifest.permission.ACTIVITY_RECOGNITION) == PackageManager.PERMISSION_GRANTED
  }

  /** Whether this phone has a step counter at all. A phone without one never shows the row. */
  fun available(ctx: Context): Boolean = try {
    val sm = ctx.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
    sm?.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) != null
  } catch (_: Exception) {
    false
  }

  /**
   * The days of the window this phone has counts for, oldest first.
   *
   * `done` is called with null when the permission is not held, the phone has no counter, or the
   * counter said nothing within READ_TIMEOUT_MS — so the caller answers "denied" or "unavailable"
   * rather than sending a day of zeros.
   */
  fun days(
    ctx: Context,
    fromMs: Double,
    toMs: Double,
    offsetMin: Double,
    done: (List<Map<String, Any>>?) -> Unit,
  ) {
    if (!granted(ctx) || !available(ctx)) {
      done(null)
      return
    }
    val offset = if (offsetMin.isFinite()) offsetMin.toInt() else 0
    readCounter(ctx) { counter ->
      if (counter == null) {
        done(null)
        return@readCounter
      }
      val now = System.currentTimeMillis()
      val ledger = fold(load(ctx), counter, dayKey(now, offset), bootCount(ctx))
      save(ctx, ledger)
      done(window(ledger, fromMs, toMs, offset, now))
    }
  }

  /** Forgets every daily total. Called when the person switches Motion off (SPEC 5.1: switching off deletes). */
  fun forget(ctx: Context) {
    try {
      ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(LEDGER).apply()
    } catch (_: Exception) {
      // Nothing to do: the ledger holds only step counts, and the server's copy is deleted by the route.
    }
  }

  // --------------------------------------------------------------------------------- the sensor

  /** One report of the since-boot total, or null. The listener is removed either way, exactly once. */
  private fun readCounter(ctx: Context, done: (Long?) -> Unit) {
    val sm = ctx.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
    val sensor = sm?.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
    if (sm == null || sensor == null) {
      done(null)
      return
    }
    val answered = java.util.concurrent.atomic.AtomicBoolean(false)
    val main = Handler(Looper.getMainLooper())
    var listener: SensorEventListener? = null
    fun finish(value: Long?) {
      if (answered.getAndSet(true)) return
      listener?.let { try { sm.unregisterListener(it) } catch (_: Exception) { /* already gone */ } }
      done(value)
    }
    listener = object : SensorEventListener {
      override fun onSensorChanged(event: SensorEvent) {
        val v = event.values?.firstOrNull()?.toDouble()
        finish(if (v != null && v.isFinite() && v >= 0) v.toLong() else null)
      }

      override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
    }
    // TYPE_STEP_COUNTER is an on-change sensor, so registering reports the current total at once.
    val ok = try {
      sm.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_FASTEST)
    } catch (_: Exception) {
      false
    }
    if (!ok) {
      finish(null)
      return
    }
    main.postDelayed({ finish(null) }, READ_TIMEOUT_MS)
  }

  // --------------------------------------------------------------------------------- the ledger

  /**
   * What the ledger holds. `acc` is today's steps before the current counter run; `base` the counter
   * at its start; `boot` the phone's boot count at the last read (-1 when it could not be read).
   */
  data class Ledger(
    val day: String,
    val base: Long,
    val acc: Long,
    val last: Long,
    val boot: Long,
    val totals: Map<String, Long>,
  )

  private val EMPTY = Ledger("", 0, 0, -1, -1, emptyMap())

  /**
   * The ledger after one reading of `counter` on local day `day`, with the phone's boot count.
   * Pure, so the same rules are mirrored and tested in `src/device/androidMotionCore.ts`
   * (`foldCounter`) and in `src/test/.../TulmiMotionStepsTest.kt`.
   *
   * A DAY IS CLOSED AT ITS OWN LAST READ. `atLast` is the steps credited to `prev.day` up to the
   * last read of it, and that is the figure the day keeps. What the counter did between that read
   * and this one is unattributable — the gap can be minutes or days — so it is dropped rather than
   * pinned on whichever day is convenient.
   */
  fun fold(prev: Ledger, counter: Long, day: String, boot: Long = -1L): Ledger {
    if (day.isEmpty()) return prev
    // The first read ever: there is no earlier total to work out, so today starts at zero here.
    if (prev.day.isEmpty() || prev.last < 0) return Ledger(day, counter, 0, counter, boot, prev.totals)
    // Worked out BEFORE any reboot adjustment, because a reboot happened AFTER that last read.
    val atLast = (prev.acc + (prev.last - prev.base).coerceAtLeast(0)).coerceAtLeast(0)
    // Two ways to see a reboot, because one is not enough: the counter went backwards, or the
    // phone's boot count moved (which catches a reboot followed by more steps than the old total).
    val rebooted = counter < prev.last || (boot >= 0 && prev.boot >= 0 && boot != prev.boot)
    var acc = prev.acc
    var base = prev.base
    if (rebooted) {
      // Keep what was counted up to the last read, and take everything the counter has now as
      // steps since the reboot.
      acc = atLast
      base = 0
    }
    if (day != prev.day) {
      // The day turned over. The older day keeps what it had at its last read; today starts at 0.
      val totals = prune(prev.totals + (prev.day to atLast))
      return Ledger(day, counter, 0, counter, boot, totals)
    }
    return Ledger(day, base, acc, counter, boot, prev.totals)
  }

  /** Today's running total from a ledger. */
  fun today(l: Ledger): Long = (l.acc + (l.last - l.base)).coerceAtLeast(0)

  /** The newest MAX_DAYS days. ISO day keys sort in date order, so the oldest are the smallest. */
  private fun prune(totals: Map<String, Long>): Map<String, Long> {
    if (totals.size <= MAX_DAYS) return totals
    val keep = totals.keys.sorted().takeLast(MAX_DAYS).toSet()
    return totals.filterKeys { it in keep }
  }

  /** The window's known days, oldest first. A day with no count is left out, never sent as zero. */
  private fun window(
    l: Ledger,
    fromMs: Double,
    toMs: Double,
    offsetMin: Int,
    now: Long,
  ): List<Map<String, Any>> {
    val from = if (fromMs.isFinite()) fromMs.toLong() else now - MAX_DAYS * DAY_MS
    val to = if (toMs.isFinite()) toMs.toLong() else now
    val first = dayKey(minOf(from, to), offsetMin)
    val last = dayKey(maxOf(from, to), offsetMin)
    val all = HashMap(l.totals)
    if (l.day.isNotEmpty()) all[l.day] = today(l)
    return all.keys.sorted()
      .filter { it >= first && it <= last }
      .map { mapOf<String, Any>("day" to it, "steps" to (all[it] ?: 0L), "spans" to emptyList<Any>()) }
  }

  // --------------------------------------------------------------------------------- storage

  private fun load(ctx: Context): Ledger = try {
    val raw = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(LEDGER, null)
    if (raw.isNullOrEmpty()) EMPTY else parse(JSONObject(raw))
  } catch (_: Exception) {
    EMPTY
  }

  private fun parse(o: JSONObject): Ledger {
    val totals = LinkedHashMap<String, Long>()
    val d = o.optJSONObject("d")
    if (d != null) {
      val it = d.keys()
      while (it.hasNext()) {
        val k = it.next()
        val v = d.optLong(k, -1)
        if (v >= 0) totals[k] = v
      }
    }
    return Ledger(
      day = o.optString("day", ""),
      base = o.optLong("base", 0),
      acc = o.optLong("acc", 0),
      last = o.optLong("last", -1),
      boot = o.optLong("boot", -1),
      totals = prune(totals),
    )
  }

  private fun save(ctx: Context, l: Ledger) {
    try {
      val d = JSONObject()
      for ((k, v) in l.totals) d.put(k, v)
      val o = JSONObject()
        .put("day", l.day)
        .put("base", l.base)
        .put("acc", l.acc)
        .put("last", l.last)
        .put("boot", l.boot)
        .put("d", d)
      ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(LEDGER, o.toString()).apply()
    } catch (_: Exception) {
      // A lost ledger costs this day's count, nothing else: the next read starts it again.
    }
  }

  // --------------------------------------------------------------------------------- days

  /**
   * The local day ("2026-11-14") of an instant, `offsetMin` minutes east of UTC. The same rule as
   * healthCore.dayKey.
   *
   * **`Locale.ROOT`, and it is load-bearing.** Kotlin's `"%04d".format(...)` formats with
   * `Locale.getDefault()`, which on a Bengali, Marathi, Nepali, Farsi or Arabic-digit phone writes
   * the numbers in that locale's own digits (০৯, ٠٩ …). The day key is a wire format, not something
   * a person reads: `motionCore.motionRead` only accepts `^\d{4}-\d{2}-\d{2}$`, and JavaScript's
   * `\d` is ASCII, so a locale-formatted key makes every day of the read drop silently and those
   * people send no steps at all. The ledger is keyed by this too, so it must not move with the
   * phone's language either.
   */
  fun dayKey(at: Long, offsetMin: Int): String {
    val c = Calendar.getInstance(TimeZone.getTimeZone("UTC"))
    c.clear()
    c.timeInMillis = at + offsetMin * 60_000L
    val y = c.get(Calendar.YEAR)
    val m = c.get(Calendar.MONTH) + 1
    val d = c.get(Calendar.DAY_OF_MONTH)
    return String.format(Locale.ROOT, "%04d-%02d-%02d", y, m, d)
  }

  /**
   * How many times this phone has booted (`Settings.Global.BOOT_COUNT`, API 24), or -1.
   *
   * It is a counter, not an identifier: it says nothing about the phone, the person or where they
   * are, and it is read for one reason — a counter that restarted is not a counter that went
   * backwards if the person walked more after the reboot than before it.
   */
  private fun bootCount(ctx: Context): Long = try {
    Settings.Global.getInt(ctx.contentResolver, Settings.Global.BOOT_COUNT, -1).toLong()
  } catch (_: Exception) {
    -1L
  }
}
