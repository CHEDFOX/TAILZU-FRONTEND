package expo.modules.tulmibridge

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.TextPaint
import android.text.TextUtils
import android.util.SizeF
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject
import java.text.NumberFormat
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * THE MONTH, ON AN ANDROID HOME SCREEN. The iOS Month widget
 * (app/targets/widgets/MonthWidget.swift) with plain framework APIs: the
 * headline number, what it counts, and the line; the streak only when the
 * server turns it on; the mark (the app icon's bot) at the top, or alone in
 * the middle before the app has written anything.
 *
 * In the app's own look, and the phone's theme: white and ink in light, the
 * dark ink at night (WidgetInk; the server's colours go over the palette's,
 * `colors` for dark and `light` for light). On Android 12+ the face is drawn
 * once for each theme and the launcher shows the one that matches, as the
 * theme changes; before that it is drawn in the theme showing.
 *
 * Everything it draws comes from the one JSON the app writes with
 * setWidgetMonth (src/widgets/month.ts builds it from the bootstrap): the
 * numbers, the words, the colours, where a tap goes. Every field read here keeps
 * the literal the Swift side keeps as its fallback. Nothing here talks to the
 * server, and nothing the user said is ever drawn.
 *
 * RemoteViews has no way to draw a 3dp line in a colour it is handed at run
 * time, so the face is drawn into a bitmap at the widget's own size and shown
 * in one ImageView. The ground under it is a rounded shape tinted to the
 * JSON's colour, so it fills the cell exactly whatever size the launcher
 * settles on. The mark is a themed drawable (on a small white disc at night,
 * so the black bot shows), never tinted.
 *
 * There is no timer (updatePeriodMillis is 0): the app asks for a redraw every
 * time it writes fresh numbers, and nothing between those writes would change
 * what is drawn. The JSON's refreshSec is iOS's timeline and is not read here.
 */
class TailzuMonthWidget : AppWidgetProvider() {

  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    for (id in appWidgetIds) redraw(context, appWidgetManager, id)
  }

  // A resize, or the launcher turning between portrait and landscape: the face
  // is drawn for one size, so it is drawn again for the new one.
  override fun onAppWidgetOptionsChanged(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetId: Int,
    newOptions: Bundle?,
  ) {
    redraw(context, appWidgetManager, appWidgetId)
  }

  companion object {
    /** Where setWidgetMonth keeps the JSON (TulmiBridgeModule.kt). */
    const val PREFS = "tulmi.widget"
    const val KEY = "tulmi.widget.month"

    /** Where setWidgetTheme keeps the always-published colours (same file). */
    const val THEME_KEY = "tulmi.widget.theme"

    /** Where a tap goes when the JSON names nowhere this app opens: the Bots app's Usage, the month's own page. */
    private const val DEFAULT_URL = "tulmi://screen/bots.usage"

    /** A 2x2 cell, for a launcher that reports no size at all. */
    private const val DEFAULT_DP = 150f

    /** No face wider or taller than this many pixels, however big the widget. */
    private const val MAX_EDGE_PX = 1024f

    /** A card shorter than this many dp shows the month without the mark above it: the number needs the room. */
    private const val MARK_MIN_DP = 136f

    /** The room the small mark takes at the top: its 14dp margin, its 22dp, and a gap. */
    private const val MARK_ROOM_DP = 44f

    /**
     * Ask every Month widget on the home screen to draw again. A broadcast to
     * this provider rather than a draw here, so the caller (setWidgetMonth, on
     * the JS thread) never waits on a bitmap. Never throws.
     */
    fun requestUpdate(context: Context) {
      try {
        val manager = AppWidgetManager.getInstance(context) ?: return
        val ids = manager.getAppWidgetIds(ComponentName(context, TailzuMonthWidget::class.java))
        if (ids == null || ids.isEmpty()) return
        context.sendBroadcast(
          Intent(context, TailzuMonthWidget::class.java)
            .setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
        )
      } catch (_: Exception) {
        // A widget never stops the app.
      }
    }

    private fun redraw(context: Context, manager: AppWidgetManager, id: Int) {
      val look = MonthLook.load(context)
      try {
        manager.updateAppWidget(id, views(context, look, manager.getAppWidgetOptions(id)))
      } catch (_: Throwable) {
        // No memory for the bitmap, or a host that refused it: the ground and
        // the tap still go up, with nothing drawn on them, rather than the
        // launcher's "can't load widget".
        try {
          manager.updateAppWidget(id, bare(context, look))
        } catch (_: Throwable) {
        }
      }
    }

    private fun views(context: Context, look: MonthLook, options: Bundle?): RemoteViews {
      val sizes = sizes(context, options)
      // Android 12 and later take one face per size the launcher may show the
      // widget at and pick the one that fits, so each is drawn at exactly its
      // size instead of one face being stretched to the other; and each face
      // twice, once per theme.
      if (Build.VERSION.SDK_INT >= 31 && sizes.size > 1) {
        val budget = pixelBudget(context, sizes.size * 2)
        return RemoteViews(sizes.associate { SizeF(it.w, it.h) to face(context, look, it, budget) })
      }
      return face(context, look, sizes[0], pixelBudget(context, if (Build.VERSION.SDK_INT >= 31) 2 else 1))
    }

    /** The ground, the tap and what the face says, with nothing drawn yet: the mark alone. */
    private fun bare(context: Context, look: MonthLook): RemoteViews {
      val rv = RemoteViews(context.packageName, R.layout.tailzu_widget_month)
      WidgetInk.image(rv, R.id.tailzu_month_ground, look.ground, look.night)
      rv.setContentDescription(R.id.tailzu_month_face, look.spoken())
      rv.setViewVisibility(R.id.tailzu_month_mark, View.GONE)
      rv.setViewVisibility(R.id.tailzu_month_mark_big, View.VISIBLE)
      tap(context, look.url)?.let { rv.setOnClickPendingIntent(android.R.id.background, it) }
      return rv
    }

    private fun face(context: Context, look: MonthLook, size: SizeDp, budget: Float): RemoteViews {
      val rv = bare(context, look)
      // Nothing written yet, or a phone that has not signed in: the mark alone.
      if (look.month == null) return rv
      val marked = size.h >= MARK_MIN_DP
      rv.setViewVisibility(R.id.tailzu_month_mark_big, View.GONE)
      rv.setViewVisibility(R.id.tailzu_month_mark, if (marked) View.VISIBLE else View.GONE)
      val top = if (marked) MARK_ROOM_DP else 0f
      val density = context.resources.displayMetrics.density.takeIf { it > 0f } ?: 1f
      var scale = density
      if (size.w * size.h * scale * scale > budget) scale = sqrt(budget / (size.w * size.h))
      scale = min(scale, MAX_EDGE_PX / max(size.w, size.h))
      if (Build.VERSION.SDK_INT >= 31) {
        rv.setIcon(
          R.id.tailzu_month_face, "setImageIcon",
          Icon.createWithBitmap(MonthFace.draw(look, size.w, size.h, scale, night = false, top = top)),
          Icon.createWithBitmap(MonthFace.draw(look, size.w, size.h, scale, night = true, top = top)),
        )
      } else {
        rv.setImageViewBitmap(R.id.tailzu_month_face, MonthFace.draw(look, size.w, size.h, scale, look.night, top))
      }
      return rv
    }

    // RemoteViews refuses an update whose bitmaps add up to more than about one
    // and a half screens of pixels. Every face together gets half a screen, so
    // the limit is never near; past its share a face is drawn at fewer pixels
    // to the dp and the ImageView scales it up.
    private fun pixelBudget(context: Context, faces: Int): Float {
      val dm = context.resources.displayMetrics
      val screen = dm.widthPixels.toFloat() * dm.heightPixels.toFloat()
      return max(160f * 160f, screen / 2f / max(1, faces))
    }

    /**
     * The sizes, in dp, the launcher may show this widget at. Android 12 and
     * later list them; before that there are only the extremes, and by the
     * platform's convention the narrow-and-tall pair is portrait and the
     * wide-and-short pair landscape.
     */
    private fun sizes(context: Context, options: Bundle?): List<SizeDp> {
      if (Build.VERSION.SDK_INT >= 31 && options != null) {
        val listed = try {
          @Suppress("DEPRECATION")
          options.getParcelableArrayList<SizeF>(AppWidgetManager.OPTION_APPWIDGET_SIZES)
        } catch (_: Exception) {
          null
        }
        val sizes = listed.orEmpty()
          .filter { it.width > 0f && it.height > 0f }
          .map { SizeDp(sane(it.width), sane(it.height)) }
          .distinct()
          .take(4)
        if (sizes.isNotEmpty()) return sizes
      }
      val landscape = context.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
      val w = options?.getInt(
        if (landscape) AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH else AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0
      ) ?: 0
      val h = options?.getInt(
        if (landscape) AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT else AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0
      ) ?: 0
      return listOf(SizeDp(sane(w.toFloat()), sane(h.toFloat())))
    }

    private fun sane(dp: Float): Float = if (dp.isFinite() && dp > 0f) dp.coerceIn(40f, 2000f) else DEFAULT_DP

    /**
     * Open the app on the JSON's link, as iOS's widgetURL does: always this
     * app, never a browser. A link this app has no screen for falls back to the
     * Bots app's Usage, then to simply opening the app.
     */
    private fun tap(context: Context, url: String?): PendingIntent? {
      return try {
        val intent = viewIntent(context, url)
          ?: viewIntent(context, DEFAULT_URL)
          ?: context.packageManager.getLaunchIntentForPackage(context.packageName)
          ?: return null
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        PendingIntent.getActivity(
          context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
      } catch (_: Exception) {
        null
      }
    }

    private fun viewIntent(context: Context, url: String?): Intent? {
      val s = url?.trim()
      if (s.isNullOrEmpty()) return null
      val uri = Uri.parse(s)
      if (uri.scheme.isNullOrEmpty()) return null
      val intent = Intent(Intent.ACTION_VIEW, uri).setPackage(context.packageName)
      return if (intent.resolveActivity(context.packageManager) != null) intent else null
    }
  }
}

internal data class SizeDp(val w: Float, val h: Float)

/**
 * What the app last wrote, read the way WidgetLook and MonthStats read it on
 * iOS: leniently. A missing or mistyped field is simply absent and its caller
 * falls back to the literal; JSON that is not an object, or carries none of the
 * month's numbers, is nothing written, and the widget shows the mark.
 */
internal class MonthLook private constructor(o: JSONObject?, theme: JSONObject?, palette: WidgetInk.Palette?, val night: Boolean) {
  private val labels: JSONObject? = o?.optJSONObject("labels")
  // The always-published theme (tulmi.widget.theme) is read first, so the
  // colours are the server's even before any month numbers have been written;
  // each falls through to the month key and then to the palette. `colors` is
  // the dark theme's, `light` the light one's.
  private val darks: List<JSONObject?> = listOf(theme?.optJSONObject("colors"), o?.optJSONObject("colors"))
  private val lights: List<JSONObject?> = listOf(theme?.optJSONObject("light"), o?.optJSONObject("light"))

  /** Where a tap goes (widget.month.url). */
  val url: String? = o?.opt("url") as? String

  /** Whether the month shows the streak (widget.month.streak). Off: minimal. */
  val showStreak: Boolean = o?.opt("showStreak") as? Boolean ?: false

  /** Whether the month shows the progress line (widget.month.show.progress). */
  val showProgress: Boolean = o?.opt("showProgress") as? Boolean ?: true

  // The app's ink: white and ink with greys, per theme. Colour is the bots'
  // alone, so none of it is here.
  val ground: Ink = color("ground", "ground", palette)
  /** The number. */
  val pale: Ink = color("pale", "ink", palette)
  /** The line's fill. The ink unless the server says otherwise. */
  val mark: Ink = WidgetInk.resolve("mark", pale, lights, darks)
  /** What the number counts, and the streak. */
  val meta: Ink = color("meta", "meta", palette)
  /** The empty part of the month's line. */
  val track: Ink = color("line", "line", palette)

  val month: Month? = o?.let { if (NUMBERS.any { k -> number(it, k) != null }) Month(it) else null }

  /** A label, or the literal it replaced. */
  fun text(key: String, fallback: String): String = labels?.opt(key) as? String ?: fallback

  /** What the headline counts. */
  fun label(m: Month): String =
    if (m.entitled) text("thisMonth", "THIS MONTH") else text("wordsLeft", "WORDS LEFT")

  /** The face as a screen reader says it: the number and what it counts. */
  fun spoken(): String {
    val m = month ?: return text("brand", "X0")
    return "${count(m.headline)} ${label(m)}"
  }

  // The theme key's colour first, then the month's, then the palette's.
  private fun color(key: String, role: String, palette: WidgetInk.Palette?): Ink =
    WidgetInk.resolve(key, palette?.role(role) ?: FALLBACK.getValue(role), lights, darks)

  /** The month's numbers, and the headline and line the app worked out. */
  internal class Month(o: JSONObject) {
    val entitled: Boolean = o.opt("entitled") as? Boolean ?: false
    val streak: Int = whole(o, "streak")
    val headline: Long
    val fraction: Float

    init {
      val used = whole(o, "used")
      val total = whole(o, "total")
      val remaining = whole(o, "remaining")
      // Sent by the app; worked out here, by the same rule as the stats
      // screen, only for JSON an older app wrote without them.
      headline = number(o, "headline")?.takeIf { abs(it) < 1e15 }?.let { Math.round(it) }
        ?: (if (entitled) used else remaining).toLong()
      val span = number(o, "span")?.takeIf { it > 0 } ?: 120_000.0
      fraction = (
        number(o, "fraction")
          ?: if (entitled) max(0, used) / span
          else if (total > 0) max(0, used).toDouble() / total
          else 0.0
        ).coerceIn(0.0, 1.0).toFloat()
    }
  }

  companion object {
    private val NUMBERS = listOf("used", "total", "remaining", "headline")

    /** The palette as literals (tailzu_widget_colors.xml in res/values and values-night), for a look made without a Context. */
    private val FALLBACK = mapOf(
      "ground" to Ink(Color.rgb(0xFF, 0xFF, 0xFF), Color.rgb(0x0A, 0x0A, 0x0A)),
      "ink" to Ink(Color.rgb(0x0A, 0x0A, 0x0A), Color.rgb(0xFF, 0xFF, 0xFF)),
      "meta" to Ink(Color.rgb(0x5C, 0x5C, 0x5C), Color.rgb(0xA3, 0xA3, 0xA3)),
      "line" to Ink(Color.rgb(0xE6, 0xE6, 0xE6), Color.rgb(0x26, 0x26, 0x26)),
    )

    /** What setWidgetMonth / setWidgetTheme last stored, or nothing. Never throws. */
    fun load(context: Context): MonthLook {
      val night = WidgetInk.isNight(context)
      val palette = try {
        WidgetInk.Palette(context)
      } catch (_: Exception) {
        null
      }
      return try {
        val prefs = context.getSharedPreferences(TailzuMonthWidget.PREFS, Context.MODE_PRIVATE)
        MonthLook(
          obj(prefs.getString(TailzuMonthWidget.KEY, null)),
          obj(prefs.getString(TailzuMonthWidget.THEME_KEY, null)),
          palette, night,
        )
      } catch (_: Exception) {
        MonthLook(null, null, palette, night)
      }
    }

    /** The month JSON alone, as it was before the theme key existed. */
    fun parse(raw: String?): MonthLook = MonthLook(obj(raw), null, null, false)

    private fun obj(raw: String?): JSONObject? = raw?.let {
      try {
        JSONObject(it)
      } catch (_: Exception) {
        null
      }
    }

    /** A finite number, or absent. A string that looks like one is not one. */
    private fun number(o: JSONObject, key: String): Double? {
      val v = o.opt(key)
      if (v !is Number) return null
      return v.toDouble().takeIf { it.isFinite() }
    }

    private fun whole(o: JSONObject, key: String): Int {
      val v = number(o, key) ?: return 0
      return Math.round(v.coerceIn(Int.MIN_VALUE.toDouble(), Int.MAX_VALUE.toDouble())).toInt()
    }

    /** "#RGB", "#RRGGBB" or "#RRGGBBAA" (the # optional); null for anything else. */
    fun hex(value: String?): Int? {
      var s = value?.trim() ?: return null
      if (s.startsWith("#")) s = s.substring(1)
      if (s.length == 3) s = s.map { "$it$it" }.joinToString("")
      if (s.length != 6 && s.length != 8) return null
      if (!s.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }) return null
      val v = s.toLong(16)
      val rgb = if (s.length == 8) v shr 8 else v
      val a = if (s.length == 8) (v and 0xFF).toInt() else 0xFF
      return Color.argb(a, ((rgb shr 16) and 0xFF).toInt(), ((rgb shr 8) and 0xFF).toInt(), (rgb and 0xFF).toInt())
    }

    /** A colour at a strength of its own alpha, as SwiftUI's opacity() is. */
    fun fade(color: Int, alpha: Float): Int =
      (color and 0x00FFFFFF) or ((Color.alpha(color) * alpha.coerceIn(0f, 1f)).roundToInt() shl 24)

    /** A count as the app prints it: "4,820". */
    fun count(value: Long): String = try {
      NumberFormat.getIntegerInstance().format(value)
    } catch (_: Exception) {
      value.toString()
    }
  }
}

/**
 * The face, drawn in dp on a clear bitmap: the iOS small widget's stack, from
 * the bottom up, in one theme's colours. The mark is not drawn here: it is its
 * own view over the face. Sizes are fixed dp, not sp, as the iOS widget's are
 * fixed points: the layout is a picture of a card, and a larger font setting
 * would only push the number off it.
 */
internal object MonthFace {
  private const val INSET = 16f
  private const val NUMBER = 34f
  private const val SMALL = 10f
  private const val TRACKING = 0.4f
  private const val LINE = 3f

  // Android has no rounded system face; the default sans at the weights the
  // Swift side asks for is the nearest thing every phone has.
  private val semibold: Typeface by lazy { weight(600) }
  private val medium: Typeface by lazy { weight(500) }

  private fun weight(w: Int): Typeface =
    if (Build.VERSION.SDK_INT >= 28) Typeface.create(Typeface.DEFAULT, w, false)
    else Typeface.create("sans-serif-medium", Typeface.NORMAL)

  /**
   * The face at w × h dp, `scale` pixels to the dp, in the light or the dark
   * theme's colours; `top` dp at the top left for the mark. Empty with no month.
   */
  fun draw(look: MonthLook, w: Float, h: Float, scale: Float, night: Boolean, top: Float = 0f): Bitmap {
    val bitmap = Bitmap.createBitmap(
      max(1, (w * scale).roundToInt()), max(1, (h * scale).roundToInt()), Bitmap.Config.ARGB_8888
    )
    val canvas = Canvas(bitmap)
    canvas.scale(bitmap.width / w, bitmap.height / h)
    look.month?.let { month(canvas, look, it, w, h, night, top) }
    return bitmap
  }

  /**
   * The number, what it counts, and the line; the streak between them only
   * when the server turns it on. Bottom-leading, like the iOS stack.
   */
  private fun month(c: Canvas, look: MonthLook, m: MonthLook.Month, w: Float, h: Float, night: Boolean, top: Float) {
    val inset = min(INSET, min(w, h) / 8f)
    val width = w - inset * 2f
    val room = h - inset * 2f - top
    if (width <= 0f || room <= 0f) return

    val number = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
      typeface = semibold
      textSize = NUMBER
      color = look.pale.pick(night)
      letterSpacing = -0.02f
      fontFeatureSettings = "tnum"
    }
    val small = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
      typeface = medium
      textSize = SMALL
      color = look.meta.pick(night)
    }
    val caps = TextPaint(small).apply { letterSpacing = TRACKING / SMALL }

    // The number shrinks to fit, down to half its size, as the Swift side's
    // minimumScaleFactor does; past that it is cut short.
    val digits = MonthLook.count(m.headline)
    val natural = number.measureText(digits)
    if (natural > width) number.textSize = max(NUMBER * 0.5f, NUMBER * width / natural)
    val headline = TextUtils.ellipsize(digits, number, width, TextUtils.TruncateAt.END)
    val label = TextUtils.ellipsize(look.label(m), caps, width, TextUtils.TruncateAt.END)
    val streak = if (look.showStreak && m.streak > 0) {
      val s = look.text("streakShort", "{n}d").replace("{n}", m.streak.toString())
      TextUtils.ellipsize(s, small, width, TextUtils.TruncateAt.END)
    } else {
      null
    }

    // A widget shorter than the stack gets all of it smaller rather than the
    // number cut off at the top. The line and its gap are in the stack only
    // when the server shows the progress line.
    val showProgress = look.showProgress
    val smallBox = box(small)
    val need = box(number) + 4f + smallBox + (if (streak != null) smallBox + 2f else 0f) +
      (if (showProgress) 10f + LINE else 0f)
    val k = min(1f, room / need)
    c.save()
    c.translate(inset, h - inset)
    c.scale(k, k)
    var y = 0f
    if (showProgress) {
      line(c, width / k, y - LINE, m.fraction, look.mark.pick(night), look.track.pick(night))
      y -= LINE + 10f
    }
    if (streak != null) {
      text(c, streak, small, y)
      y -= smallBox + 2f
    }
    text(c, label, caps, y)
    y -= smallBox + 4f
    text(c, headline, number, y)
    c.restore()
  }

  /** One line of text whose box sits on `bottom`, from the left edge. */
  private fun text(c: Canvas, s: CharSequence, paint: TextPaint, bottom: Float) {
    c.drawText(s, 0, s.length, 0f, bottom - paint.fontMetrics.descent, paint)
  }

  private fun box(paint: TextPaint): Float = paint.fontMetrics.let { it.descent - it.ascent }

  /** The line: the month, as far along as it is. Two capsules, the track (the line grey) under the fill (the ink). */
  private fun line(c: Canvas, w: Float, top: Float, fraction: Float, mark: Int, track: Int) {
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    val r = LINE / 2f
    paint.color = track
    c.drawRoundRect(RectF(0f, top, w, top + LINE), r, r, paint)
    val fill = w * fraction.coerceIn(0f, 1f)
    if (fill <= 0f) return
    paint.color = mark
    val fr = min(fill, LINE) / 2f
    c.drawRoundRect(RectF(0f, top, fill, top + LINE), fr, fr, paint)
  }
}
