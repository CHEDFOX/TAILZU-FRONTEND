package expo.modules.tulmiperms

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CalendarContract
import java.util.Calendar
import java.util.TimeZone

/**
 * "PLAN AROUND MY CALENDAR" ON ANDROID: BUSY TIMES ONLY (perms2/SPEC.md 2.3, 9.1; Android half, build 8.9.1).
 *
 * The same function and the same answer as the iPhone's `calendarBusy(fromMs, toMs, max)`
 * (SPEC 2.6, 10.2): a list of `{ s, e, allDay }`, nothing else, so `src/device/calendar.ts`
 * needs no platform branch beyond the capability gate.
 *
 * WHAT IS READ, AND WHAT IS NOT. The query asks `CalendarContract.Instances` for seven columns:
 * BEGIN, END, ALL_DAY, AVAILABILITY, STATUS, SELF_ATTENDEE_STATUS, START_DAY and END_DAY. Six of
 * them decide whether a block counts and the last two place an all-day block on the right local
 * day. TITLE, EVENT_LOCATION, DESCRIPTION, ORGANIZER, the attendee tables and CALENDAR_DISPLAY_NAME
 * are never in the projection, so no name, place, note, person or calendar name exists in this
 * process at all, let alone crosses into JavaScript. `COLUMNS` below is the whole of it.
 *
 * WHAT IS SKIPPED: an event marked free (AVAILABILITY_FREE) is not busy; a cancelled event
 * (STATUS_CANCELED) is not happening; one this person declined (ATTENDEE_STATUS_DECLINED) is not
 * theirs. The same three the iPhone skips.
 *
 * ONE PERMISSION, READ ONLY: `READ_CALENDAR`, behind the build switch `TULMI_ANDROID_CALENDAR`
 * (app.config.ts; blockedPermissions takes it back out with the switch off). There is NO
 * `WRITE_CALENDAR` and nothing here writes: *Add to my calendar* is the calendar app's own
 * ACTION_INSERT screen, which needs no permission (SPEC 2.2).
 *
 * BOUNDS, so a screen bug cannot turn into a bulk read: the window is clamped to MAX_DAYS and
 * cannot start before yesterday, and at most MAX_BLOCKS blocks come back, oldest first. The route
 * checks the same numbers again (SPEC 2.5).
 *
 * Nothing is kept here: no cache, no file, no SharedPreferences. One read per call, on the caller's
 * thread (the module calls it from an AsyncFunction, which is off the main thread).
 */
object TulmiCalendarRead {
  /** The same cap as the route and the iPhone read (SPEC 2.4, 2.5). */
  const val MAX_BLOCKS = 300

  /** The widest window the route accepts: 14 days asked for, 15 allowed (SPEC 2.5). */
  const val MAX_DAYS = 15

  /** Julian day 2440588 is 1970-01-01, which is what Instances.START_DAY counts from. */
  private const val JULIAN_EPOCH = 2_440_588L
  private const val DAY_MS = 86_400_000L

  /**
   * THE WHOLE PROJECTION. Adding a column here is adding a data type to the store declaration and
   * the policy, so it does not happen without the card, the string and the review note changing too
   * (SPEC rule 8).
   */
  private val COLUMNS = arrayOf(
    CalendarContract.Instances.BEGIN,
    CalendarContract.Instances.END,
    CalendarContract.Instances.ALL_DAY,
    CalendarContract.Instances.AVAILABILITY,
    CalendarContract.Instances.STATUS,
    CalendarContract.Instances.SELF_ATTENDEE_STATUS,
    CalendarContract.Instances.START_DAY,
    CalendarContract.Instances.END_DAY,
  )

  /** Whether this app may read the phone's calendars. Never asks; the JS asks with PermissionsAndroid. */
  fun granted(ctx: Context): Boolean =
    ctx.checkSelfPermission(Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED

  /**
   * The busy blocks between `fromMs` and `toMs`, oldest first, at most `max` of them.
   *
   * Returns null when the permission is not held, so the caller can answer "denied" without
   * pretending the calendar is empty. An empty list means the window really is free.
   */
  fun busy(ctx: Context, fromMs: Double, toMs: Double, max: Double): List<Map<String, Any>>? {
    if (!granted(ctx)) return null
    val now = System.currentTimeMillis()
    val from = clampFrom(fromMs, now)
    val to = clampTo(toMs, from)
    val cap = cap(max)
    if (cap <= 0 || to <= from) return emptyList()

    val out = ArrayList<Map<String, Any>>(minOf(cap, 64))
    val cursor = try {
      CalendarContract.Instances.query(ctx.contentResolver, COLUMNS, from, to)
    } catch (_: Exception) {
      // No provider on this phone (a stripped build, a work profile that hides it), or the
      // permission was revoked between the check and the query.
      return null
    } ?: return null

    cursor.use { c ->
      while (c.moveToNext()) {
        if (out.size >= cap) break
        if (skip(c.getInt(3), c.getInt(4), c.getInt(5), c.isNull(4), c.isNull(5))) continue
        val allDay = c.getInt(2) == 1
        var s = c.getLong(0)
        var e = c.getLong(1)
        if (allDay) {
          // An all-day instance's BEGIN/END are UTC midnights, so on a phone east or west of UTC
          // they would read as a block starting the evening before or the morning after. START_DAY
          // and END_DAY are the provider's own local day numbers, which is what the iPhone's
          // EventKit hands back directly.
          val bounds = allDayBounds(c.getInt(6), c.getInt(7))
          s = bounds.first
          e = bounds.second
        }
        if (e <= s) continue
        out.add(mapOf("s" to s, "e" to e, "allDay" to allDay))
      }
    }
    // The provider usually answers in BEGIN order, but it is not promised and an all-day block's
    // bounds move above, so the order is made here instead of being relied on.
    out.sortWith(compareBy({ it["s"] as Long }, { it["e"] as Long }))
    return out
  }

  /**
   * Whether this instance is not a busy time: free, cancelled, or declined by this person.
   *
   * A null AVAILABILITY or SELF_ATTENDEE_STATUS means the provider does not know, which is not a
   * reason to drop the block — an event with no availability set is the ordinary busy case.
   */
  private fun skip(
    availability: Int,
    status: Int,
    selfStatus: Int,
    statusNull: Boolean,
    selfNull: Boolean,
  ): Boolean {
    if (availability == CalendarContract.Events.AVAILABILITY_FREE) return true
    if (!statusNull && status == CalendarContract.Events.STATUS_CANCELED) return true
    if (!selfNull && selfStatus == CalendarContract.Attendees.ATTENDEE_STATUS_DECLINED) return true
    return false
  }

  /** The window may not start before yesterday's local midnight (SPEC 2.5). */
  private fun clampFrom(fromMs: Double, now: Long): Long {
    val asked = if (fromMs.isFinite()) fromMs.toLong() else now
    val floor = now - DAY_MS
    return maxOf(asked, floor)
  }

  /** The window may not be longer than MAX_DAYS. */
  private fun clampTo(toMs: Double, from: Long): Long {
    val asked = if (toMs.isFinite()) toMs.toLong() else from
    return minOf(asked, from + MAX_DAYS * DAY_MS)
  }

  private fun cap(max: Double): Int {
    val n = if (max.isFinite()) max.toInt() else MAX_BLOCKS
    return minOf(maxOf(n, 0), MAX_BLOCKS)
  }

  /**
   * Local midnight at the start of `startDay` and at the end of `endDay`, from the provider's
   * Julian day numbers. END_DAY is inclusive, so the block ends at the midnight after it.
   *
   * Written with java.util.Calendar rather than java.time because this module's minSdk is 24 and
   * java.time only arrives at 26.
   */
  private fun allDayBounds(startDay: Int, endDay: Int): Pair<Long, Long> =
    localMidnight(startDay) to localMidnight(endDay + 1)

  private fun localMidnight(julianDay: Int): Long {
    val utc = Calendar.getInstance(TimeZone.getTimeZone("UTC"))
    utc.clear()
    utc.timeInMillis = (julianDay - JULIAN_EPOCH) * DAY_MS
    val local = Calendar.getInstance()
    local.clear()
    local.set(utc.get(Calendar.YEAR), utc.get(Calendar.MONTH), utc.get(Calendar.DAY_OF_MONTH), 0, 0, 0)
    return local.timeInMillis
  }
}
