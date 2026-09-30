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
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.TextPaint
import android.text.TextUtils
import android.util.SizeF
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
 * server turns it on; the wave mark alone before the app has written anything.
 *
 * Everything it draws comes from the one JSON the app writes with
 * setWidgetMonth (src/widgets/month.ts builds it from the bootstrap): the
 * numbers, the words, the colours, where a tap goes. Every field read here keeps
 * the literal the Swift side keeps as its fallback. Nothing here talks to the
 * server, and nothing the user said is ever drawn.
 *
 * RemoteViews has no way to draw a 3dp line in a colour it is handed at run
 * time, or the mark, so the face is drawn into a bitmap at the widget's own
 * size and shown in one ImageView. The ground under it is a rounded shape
 * tinted to the JSON's colour, so it fills the cell exactly whatever size the
 * launcher settles on.
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

    /** Where a tap goes when the JSON names nowhere this app opens. */
    private const val DEFAULT_URL = "tulmi://screen/stats"

    /** A 2x2 cell, for a launcher that reports no size at all. */
    private const val DEFAULT_DP = 150f

    /** No face wider or taller than this many pixels, however big the widget. */
    private const val MAX_EDGE_PX = 1024f

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
      // size instead of one face being stretched to the other.
      if (Build.VERSION.SDK_INT >= 31 && sizes.size > 1) {
        val budget = pixelBudget(context, sizes.size)
        return RemoteViews(sizes.associate { SizeF(it.w, it.h) to face(context, look, it, budget) })
      }
      return face(context, look, sizes[0], pixelBudget(context, 1))
    }

    /** The ground, the tap and what the face says, with nothing drawn yet. */
    private fun bare(context: Context, look: MonthLook): RemoteViews {
      val rv = RemoteViews(context.packageName, R.layout.tailzu_widget_month)
      // The shape keeps its own alpha; the colour's goes on the image, so a
      // ground sent with one is see-through rather than lightened.
      rv.setInt(R.id.tailzu_month_ground, "setColorFilter", look.ground or 0xFF000000.toInt())
      rv.setInt(R.id.tailzu_month_ground, "setImageAlpha", Color.alpha(look.ground))
      rv.setContentDescription(R.id.tailzu_month_face, look.spoken())
      tap(context, look.url)?.let { rv.setOnClickPendingIntent(android.R.id.background, it) }
      return rv
    }

    private fun face(context: Context, look: MonthLook, size: SizeDp, budget: Float): RemoteViews {
      val rv = bare(context, look)
      val density = context.resources.displayMetrics.density.takeIf { it > 0f } ?: 1f
      var scale = density
      if (size.w * size.h * scale * scale > budget) scale = sqrt(budget / (size.w * size.h))
      scale = min(scale, MAX_EDGE_PX / max(size.w, size.h))
      rv.setImageViewBitmap(R.id.tailzu_month_face, MonthFace.draw(look, size.w, size.h, scale))
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
     * stats screen, then to simply opening the app.
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
internal class MonthLook private constructor(o: JSONObject?) {
  private val labels: JSONObject? = o?.optJSONObject("labels")
  private val colors: JSONObject? = o?.optJSONObject("colors")
  private val alphas: JSONObject? = o?.optJSONObject("alpha")

  /** Where a tap goes (widget.month.url). */
  val url: String? = o?.opt("url") as? String

  /** Whether the month shows the streak (widget.month.streak). Off: minimal. */
  val showStreak: Boolean = o?.opt("showStreak") as? Boolean ?: false

  // The ink: a dark ground and one pale ink at a few strengths. The brand
  // colour stays in the app.
  val ground: Int = color("ground", GROUND)
  val pale: Int = color("pale", PALE)
  /** The mark and the line's fill. Pale unless the server says otherwise. */
  val mark: Int = color("mark", pale)
  val dim: Int = fade(pale, alpha("dim", 0.52f))
  /** The empty part of the month's line, as a strength of the mark. */
  val track: Float = alpha("track", 0.14f)

  val month: Month? = o?.let { if (NUMBERS.any { k -> number(it, k) != null }) Month(it) else null }

  /** A label, or the literal it replaced. */
  fun text(key: String, fallback: String): String = labels?.opt(key) as? String ?: fallback

  /** What the headline counts. */
  fun label(m: Month): String =
    if (m.entitled) text("thisMonth", "THIS MONTH") else text("wordsLeft", "WORDS LEFT")

  /** The face as a screen reader says it: the number and what it counts. */
  fun spoken(): String {
    val m = month ?: return text("brand", "Tailzu")
    return "${count(m.headline)} ${label(m)}"
  }

  private fun color(key: String, fallback: Int): Int = hex(colors?.opt(key) as? String) ?: fallback

  private fun alpha(key: String, fallback: Float): Float {
    val a = alphas?.let { number(it, key) } ?: return fallback
    return if (a in 0.0..1.0) a.toFloat() else fallback
  }

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
    private val GROUND = Color.rgb(0x0F, 0x0D, 0x0B)
    private val PALE = Color.rgb(0xF3, 0xE2, 0xC6)
    private val NUMBERS = listOf("used", "total", "remaining", "headline")

    /** What setWidgetMonth last stored, or nothing written. Never throws. */
    fun load(context: Context): MonthLook = try {
      parse(
        context.getSharedPreferences(TailzuMonthWidget.PREFS, Context.MODE_PRIVATE)
          .getString(TailzuMonthWidget.KEY, null)
      )
    } catch (_: Exception) {
      MonthLook(null)
    }

    fun parse(raw: String?): MonthLook = MonthLook(
      raw?.let {
        try {
          JSONObject(it)
        } catch (_: Exception) {
          null
        }
      }
    )

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
 * the bottom up, or the mark alone. Sizes are fixed dp, not sp, as the iOS
 * widget's are fixed points: the layout is a picture of a card, and a larger
 * font setting would only push the number off it.
 */
internal object MonthFace {
  /** The seven bars of the app icon's wave, as the keyboard's mic key draws them. */
  private val BARS = floatArrayOf(28f, 36f, 41f, 46f, 43f, 34f, 28f)

  private const val INSET = 16f
  private const val NUMBER = 34f
  private const val SMALL = 9f
  private const val TRACKING = 1.4f
  private const val LINE = 3f

  // Android has no rounded system face; the default sans at the weights the
  // Swift side asks for is the nearest thing every phone has.
  private val semibold: Typeface by lazy { weight(600) }
  private val medium: Typeface by lazy { weight(500) }

  private fun weight(w: Int): Typeface =
    if (Build.VERSION.SDK_INT >= 28) Typeface.create(Typeface.DEFAULT, w, false)
    else Typeface.create("sans-serif-medium", Typeface.NORMAL)

  /** The face at w × h dp, `scale` pixels to the dp. */
  fun draw(look: MonthLook, w: Float, h: Float, scale: Float): Bitmap {
    val bitmap = Bitmap.createBitmap(
      max(1, (w * scale).roundToInt()), max(1, (h * scale).roundToInt()), Bitmap.Config.ARGB_8888
    )
    val canvas = Canvas(bitmap)
    canvas.scale(bitmap.width / w, bitmap.height / h)
    val m = look.month
    if (m == null) {
      // Nothing written yet, or a phone that has not signed in: the mark alone.
      wave(canvas, w / 2f, h / 2f, 36f, 24f, look.dim)
    } else {
      month(canvas, look, m, w, h)
    }
    return bitmap
  }

  /**
   * The number, what it counts, and the line; the streak between them only
   * when the server turns it on. Bottom-leading, like the iOS stack.
   */
  private fun month(c: Canvas, look: MonthLook, m: MonthLook.Month, w: Float, h: Float) {
    val inset = min(INSET, min(w, h) / 8f)
    val width = w - inset * 2f
    val room = h - inset * 2f
    if (width <= 0f || room <= 0f) return

    val number = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
      typeface = semibold
      textSize = NUMBER
      color = look.pale
      fontFeatureSettings = "tnum"
    }
    val small = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
      typeface = medium
      textSize = SMALL
      color = look.dim
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
    // number cut off at the top.
    val smallBox = box(small)
    val need = box(number) + 2f + smallBox + (if (streak != null) smallBox + 2f else 0f) + 10f + LINE
    val k = min(1f, room / need)
    c.save()
    c.translate(inset, h - inset)
    c.scale(k, k)
    var y = 0f
    line(c, width / k, y - LINE, m.fraction, look.mark, look.track)
    y -= LINE + 10f
    if (streak != null) {
      text(c, streak, small, y)
      y -= smallBox + 2f
    }
    text(c, label, caps, y)
    y -= smallBox + 2f
    text(c, headline, number, y)
    c.restore()
  }

  /** One line of text whose box sits on `bottom`, from the left edge. */
  private fun text(c: Canvas, s: CharSequence, paint: TextPaint, bottom: Float) {
    c.drawText(s, 0, s.length, 0f, bottom - paint.fontMetrics.descent, paint)
  }

  private fun box(paint: TextPaint): Float = paint.fontMetrics.let { it.descent - it.ascent }

  /** The line: the month, as far along as it is. Two capsules, the track under the fill. */
  private fun line(c: Canvas, w: Float, top: Float, fraction: Float, mark: Int, track: Float) {
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    val r = LINE / 2f
    paint.color = MonthLook.fade(mark, track)
    c.drawRoundRect(RectF(0f, top, w, top + LINE), r, r, paint)
    val fill = w * fraction.coerceIn(0f, 1f)
    if (fill <= 0f) return
    paint.color = mark
    val fr = min(fill, LINE) / 2f
    c.drawRoundRect(RectF(0f, top, fill, top + LINE), fr, fr, paint)
  }

  /**
   * THE WAVE OF THE MARK, w × h and centred on (cx, cy): seven bars of uneven
   * height, each as wide as the gap between them.
   */
  private fun wave(c: Canvas, cx: Float, cy: Float, w: Float, h: Float, color: Int) {
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color }
    val gap = w / (BARS.size * 2 - 1)
    val unit = h / 46f
    var x = cx - w / 2f
    for (bar in BARS) {
      val half = bar * unit / 2f
      c.drawRoundRect(RectF(x, cy - half, x + gap, cy + half), gap / 2f, gap / 2f, paint)
      x += gap * 2f
    }
  }
}
