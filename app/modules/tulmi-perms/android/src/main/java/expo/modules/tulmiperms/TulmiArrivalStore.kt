package expo.modules.tulmiperms

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject

/**
 * ARRIVAL REMINDERS ON ANDROID: THE ARMED SET AND THE LOCAL REMINDER (perms2/SPEC.md 7; Android half,
 * build 8.9.1). Framework only — no Play services here, so this file compiles in every build
 * whatever `TULMI_ANDROID_ARRIVAL` says, and `TulmiArrivalGeofences` is the half the switch swaps.
 *
 * THE PROMISE, WORD FOR WORD WITH THE IPHONE'S (SPEC 7.2): the phone watches for the place itself
 * and shows the reminder when the person arrives. **X0 Bot is never told where they are or that
 * they arrived.** So:
 *
 *   - nothing in this file, or in the receiver that calls it, posts, logs, queues or caches an
 *     arrival, a position or a time of arrival. `notifyArrival` builds a notification and returns.
 *   - the server sends the places down (it geocoded them); the phone sends nothing back. On the
 *     iPhone the system schedules the notification, so the app is not even woken; on Android a
 *     geofence has to be received by a BroadcastReceiver, which is the one real difference, and
 *     that receiver does exactly one thing: show the notification.
 *   - what is on the phone is this set — ids, points, radii and the reminder's own words, all of
 *     which came from the server — and it is replaced whole at each sync and cleared when the
 *     switch goes off (SPEC 7.3).
 *
 * At most MAX items, the same cap as the iPhone's (SPEC 7.1: Core Location monitors 20 conditions,
 * so the server sends 10). Android's own limit is 100 geofences per app, far above it, so the cap
 * here is the server's number and not the platform's.
 */
object TulmiArrivalStore {
  /** Every geofence id starts with this, so a sync can replace OUR set and touch nothing else. */
  const val PREFIX = "x0.arrive."

  /** The most reminders that may be armed at once (SPEC 7.1). */
  const val MAX = 10

  /** Radius bounds, the same as the server's knob `arrival.radiusM` (SPEC 7.2). */
  const val MIN_RADIUS_M = 100f
  const val MAX_RADIUS_M = 500f
  const val DEFAULT_RADIUS_M = 150f

  const val TITLE_MAX = 60
  const val BODY_MAX = 140
  const val SCREEN_MAX = 120

  /** The channel the arrival reminder is shown on. Its own, so the person can silence just these. */
  const val CHANNEL = "x0.arrival"
  const val CHANNEL_NAME = "Arrival reminders"

  private const val PREFS = "tulmi.arrival"
  private const val KEY = "armed"

  /**
   * SET WHEN THE SYSTEM HAS THROWN OUR GEOFENCES AWAY WHILE THIS LIST STILL NAMES THEM.
   *
   * Android delivers GEOFENCE_NOT_AVAILABLE when location is turned off on the phone (and after
   * Play services' own data is cleared), and Google's guide is explicit that the app has to
   * register again afterwards — the fences are gone, but nothing tells us a second time. Without
   * this flag every later sync would compare what it wants against this list, decide that all of
   * them are already armed, add nothing, and the reminders would stop for good until an item moved
   * or the phone rebooted.
   */
  private const val KEY_STALE = "stale"
  private const val ID_OK = "^[a-z0-9_-]{1,64}$"

  /** One armed reminder. Everything in it came from the server; nothing is read off the phone. */
  data class Item(
    val id: String,
    val lat: Double,
    val lon: Double,
    val radiusM: Float,
    val title: String,
    val body: String,
    val screen: String?,
  ) {
    /** The geofence's request id. */
    val fenceId: String get() = PREFIX + id
  }

  /**
   * The items worth arming, from what JavaScript handed over: ids, points and radii checked, words
   * trimmed, duplicates dropped, at most MAX of them in the order given.
   *
   * `src/device/arrivalCore.ts`'s `cleanItems` checks the same bounds on both phones before the
   * call, so a bad item never reaches the native side; this is the second pair of eyes, because what
   * arms a geofence must be right whatever a screen sent.
   */
  fun clean(raw: List<Map<String, Any?>>): List<Item> {
    val out = ArrayList<Item>(minOf(raw.size, MAX))
    val seen = HashSet<String>()
    val idRe = Regex(ID_OK)
    for (row in raw) {
      if (out.size >= MAX) break
      val id = (row["id"] as? String)?.trim().orEmpty()
      if (!idRe.matches(id) || !seen.add(id)) continue
      val lat = num(row["lat"]) ?: continue
      val lon = num(row["lon"]) ?: continue
      if (lat < -90.0 || lat > 90.0 || lon < -180.0 || lon > 180.0) continue
      val radius = (num(row["radiusM"]) ?: DEFAULT_RADIUS_M.toDouble())
        .coerceIn(MIN_RADIUS_M.toDouble(), MAX_RADIUS_M.toDouble())
        .toFloat()
      val title = words(row["title"], TITLE_MAX)
      val body = words(row["body"], BODY_MAX)
      if (title.isEmpty()) continue
      val screen = words(row["screen"], SCREEN_MAX).ifEmpty { null }
      out.add(Item(id, lat, lon, radius, title, body, screen))
    }
    return out
  }

  private fun num(v: Any?): Double? {
    val d = when (v) {
      is Number -> v.toDouble()
      is String -> v.toDoubleOrNull()
      else -> null
    }
    return if (d != null && d.isFinite()) d else null
  }

  /** One line of the server's own words, control characters out, cut to `max`. */
  private fun words(v: Any?, max: Int): String {
    val s = (v as? String) ?: return ""
    val flat = s.map { if (it.code < 0x20 || it.code == 0x7f) ' ' else it }
      .joinToString("")
      .replace(Regex("\\s+"), " ")
      .trim()
    return if (flat.length <= max) flat else flat.take(max).trim()
  }

  // ------------------------------------------------------------------------------ the armed set

  fun put(ctx: Context, items: List<Item>) {
    try {
      val a = JSONArray()
      for (i in items) {
        a.put(
          JSONObject()
            .put("id", i.id)
            .put("lat", i.lat)
            .put("lon", i.lon)
            .put("r", i.radiusM.toDouble())
            .put("t", i.title)
            .put("b", i.body)
            .put("s", i.screen ?: JSONObject.NULL)
        )
      }
      prefs(ctx).edit().putString(KEY, a.toString()).apply()
    } catch (_: Exception) {
      // The geofences are registered with the system either way; losing this list only means a
      // reboot cannot re-register them, and the next sync puts them back.
    }
  }

  fun all(ctx: Context): List<Item> = try {
    val raw = prefs(ctx).getString(KEY, null)
    if (raw.isNullOrEmpty()) emptyList() else read(JSONArray(raw))
  } catch (_: Exception) {
    emptyList()
  }

  private fun read(a: JSONArray): List<Item> {
    val rows = ArrayList<Map<String, Any?>>(a.length())
    for (i in 0 until a.length()) {
      val o = a.optJSONObject(i) ?: continue
      rows.add(
        mapOf(
          "id" to o.optString("id", ""),
          "lat" to o.optDouble("lat", Double.NaN),
          "lon" to o.optDouble("lon", Double.NaN),
          "radiusM" to o.optDouble("r", DEFAULT_RADIUS_M.toDouble()),
          "title" to o.optString("t", ""),
          "body" to o.optString("b", ""),
          "screen" to if (o.isNull("s")) null else o.optString("s", ""),
        )
      )
    }
    return clean(rows)
  }

  fun one(ctx: Context, fenceId: String): Item? =
    all(ctx).firstOrNull { it.fenceId == fenceId }

  fun forget(ctx: Context) {
    try {
      // The flag goes with the list: with nothing armed there is nothing to re-register.
      prefs(ctx).edit().remove(KEY).remove(KEY_STALE).apply()
    } catch (_: Exception) {
      // Nothing kept here is sensitive, and the geofences themselves are removed by the caller.
    }
  }

  /** The system dropped our fences (location turned off, or Play services data cleared). */
  fun markStale(ctx: Context) {
    try {
      prefs(ctx).edit().putBoolean(KEY_STALE, true).apply()
    } catch (_: Exception) {
      // A lost flag only means the next sync is the ordinary diff, as it was before 8.9.1.
    }
  }

  /** Whether the next sync has to put every wanted fence back rather than trust this list. */
  fun stale(ctx: Context): Boolean = try {
    prefs(ctx).getBoolean(KEY_STALE, false)
  } catch (_: Exception) {
    false
  }

  /** Cleared only once the system has taken the fences again. */
  fun clearStale(ctx: Context) {
    try {
      prefs(ctx).edit().remove(KEY_STALE).apply()
    } catch (_: Exception) {
      // Still set: the next sync re-adds an unchanged fence, which fires nothing (no initial trigger).
    }
  }

  private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  // ------------------------------------------------------------------------------ the reminder

  /**
   * Shows the reminder. THIS IS THE ONLY THING THAT HAPPENS ON ARRIVAL: no request, no log, no
   * analytics event, nothing written down (SPEC 7.2: "No analytics event on arrival or tap").
   *
   * One notification per item, replaced rather than stacked if the person arrives twice, and the
   * tap opens the item through the app's own deep link, which is the same route a quick action
   * uses (`src/quickActions/quickActions.ts`: `tulmi://screen/<id>`).
   */
  fun notifyArrival(ctx: Context, item: Item) {
    try {
      val manager = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val channel = NotificationChannel(CHANNEL, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH)
        channel.description = "Reminders your phone shows when you get to a place."
        manager.createNotificationChannel(channel)
      }
      val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(ctx, CHANNEL)
      } else {
        @Suppress("DEPRECATION")
        Notification.Builder(ctx)
      }
      builder
        .setSmallIcon(smallIcon(ctx))
        .setContentTitle(item.title)
        .setAutoCancel(true)
      if (item.body.isNotEmpty()) builder.setContentText(item.body)
      tap(ctx, item)?.let { builder.setContentIntent(it) }
      manager.notify(CHANNEL, item.id.hashCode(), builder.build())
    } catch (_: Exception) {
      // A reminder that cannot be shown is a reminder missed, and there is nothing else to try:
      // the item is still open, so the next arrival fires again.
    }
  }

  /**
   * THE STATUS-BAR ICON HAS TO BE MONOCHROME. From API 21 Android draws a small icon from its ALPHA
   * CHANNEL only, so handing it the launcher icon — a full-colour adaptive drawable — shows a solid
   * blob in the status bar, not a mark. So: expo-notifications' own `notification_icon` first (the
   * app's configured white-on-transparent one, which its own notifications use), then the widget
   * mark this app already draws in a status bar (tulmi-bridge's TailzuBotsUpdate.kt uses it as its
   * small icon, and a library's resources merge into this one package). The launcher icon is the
   * last resort, because a blob is still better than no notification at all.
   */
  private fun smallIcon(ctx: Context): Int {
    for (name in listOf("notification_icon", "tailzu_widget_mark")) {
      val id = try {
        ctx.resources.getIdentifier(name, "drawable", ctx.packageName)
      } catch (_: Exception) {
        0
      }
      if (id != 0) return id
    }
    return ctx.applicationInfo.icon
  }

  private fun tap(ctx: Context, item: Item): PendingIntent? {
    val intent = when {
      item.screen != null -> Intent(Intent.ACTION_VIEW, Uri.parse("tulmi://screen/" + item.screen))
        .setPackage(ctx.packageName)
      else -> ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
    } ?: return null
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    var flags = PendingIntent.FLAG_UPDATE_CURRENT
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags = flags or PendingIntent.FLAG_IMMUTABLE
    return try {
      PendingIntent.getActivity(ctx, item.id.hashCode(), intent, flags)
    } catch (_: Exception) {
      null
    }
  }
}
