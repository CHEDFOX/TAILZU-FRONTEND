package expo.modules.tulmibridge

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import java.io.File
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * nlook on Android, part three: THE PAINTER. Every pixel a plan asks for, and the budget that stops it being too many.
 *
 * THE FACTS THIS FILE EXISTS FOR (SPEC §1.1):
 *  - A widget's bitmaps travel to the launcher through a Binder transaction. Past the launcher's budget you get
 *    TransactionTooLarge and a dead widget, and nothing on our side can catch it. So every bitmap is counted BEFORE it is
 *    attached, summed across every size of one widget, and a paint that would not fit is simply not made.
 *  - Icon.createWithBitmap skips the RemoteViews BitmapCache, which dedups only setImageViewBitmap and only by object
 *    IDENTITY. So a mask is painted once per (key, px) and the SAME Bitmap OBJECT is handed to every size that uses it.
 *  - Masks are theme-neutral alpha: painted white, tinted light and night by setColorStateList at apply time. One bitmap
 *    serves both themes, which halves the budget against drawing each theme. THE TINT IS NOT OPTIONAL: a mask with no
 *    tint is white on white by day, so the planner adds one from the node's own fill or stroke (NLookPlan.shape).
 *  - A drawing that is REAL COLOURS and not a mask — the stage bar, the ring's two tones, the week's filled and hollow
 *    beads — cannot be tinted into its second theme, so it is painted TWICE, light and night, and set with
 *    setIcon(..., "setImageIcon", light, dark) exactly as today's X0View.picture does. Both count against the budget.
 *  - Painting happens off the main thread, on the widgets' one serial queue (TailzuWork), never inline on a broadcast.
 *
 * The path grammar is at the BOTTOM of this file, at top level, between its two NLookPathCore markers (the words are not
 * written out here, because tools/ci/marked-regions.mjs finds the region by the FIRST match of the marker text). It is
 * top level and not a member so the keyboard's copy can be the same lines at the same indentation, and CI can diff the
 * two regions byte for byte.
 */
internal object NLookPaint {
  // ------------------------------------------------------------------ the budget

  /**
   * What one widget's draw may spend on bitmaps, across EVERY size the launcher listed. Measured as the pixels really
   * allocated (width × height × 4), not as the file sizes, because that is what crosses the Binder.
   */
  internal class Budget(context: Context) {
    private val cap: Long = try {
      val m = context.resources.displayMetrics
      val screen = m.widthPixels.toLong() * m.heightPixels.toLong() * 4L
      // The launcher's own allowance is about one and a half screens of pixels; we take the share the contract sets.
      (screen * 3L / 2L * NLookLimits.BITMAP_SHARE.toDouble()).toLong()
    } catch (_: Throwable) {
      4L * 1024L * 1024L
    }

    private var spent = 0L
    private val counted = HashSet<String>()

    /** Whether a bitmap this big may still be made. A key already counted is free: one object, handed to every size. */
    fun take(key: String, w: Int, h: Int): Boolean {
      if (w <= 0 || h <= 0) return false
      if (!counted.add(key)) return true
      val bytes = w.toLong() * h.toLong() * 4L
      if (spent + bytes > cap) return false
      spent += bytes
      return true
    }
  }

  // ------------------------------------------------------------------ painting

  /**
   * Painted bitmaps for ONE widget's draw, by (key, px, theme). It exists for one reason: Icon.createWithBitmap and
   * setImageViewBitmap dedup by object IDENTITY, so the same mask used at two sizes of one RemoteViews must be the SAME
   * object. Nothing outside one draw needs it, and keeping it would be a strong reference to several megabytes of
   * bitmaps inside the app's own process for as long as the process lives. NLookRemote.widget clears it when it is done.
   */
  private val live = HashMap<String, Bitmap>()

  @Synchronized
  private fun cached(key: String): Bitmap? = live[key]?.takeIf { !it.isRecycled }

  @Synchronized
  private fun keep(key: String, bitmap: Bitmap): Bitmap {
    live[key] = bitmap
    return bitmap
  }

  /** The end of one widget's draw: these bitmaps are in the RemoteViews now and this process has no further use for them. */
  @Synchronized
  fun forget() {
    live.clear()
  }

  /**
   * ONE PICTURE FOR BOTH THEMES, or two. `first` is what a light phone shows; `second` is null when one bitmap serves
   * both (a mask the caller tints, or art), and otherwise the night drawing. Null when nothing can be made at all: over
   * budget, a path that does not parse, art that is not on disk. Null is always safe — the node's own fallback draws.
   */
  fun pair(context: Context, req: NLookPaintReq, density: Float, budget: Budget): Pair<Bitmap, Bitmap?>? = try {
    val light = draw(context, req, density, budget, false)
    when {
      light == null -> null
      !twoTone(req) -> Pair(light, null)
      // The night drawing over budget is the one case where the light one serves both. It is what this file did for
      // every bar until now, and a bar in the wrong colour still shows the stages; nothing at all shows less. The
      // widget is near the cap by then anyway, so something has to give — and a limit never means a blank widget.
      else -> Pair(light, draw(context, req, density, budget, true))
    }
  } catch (_: Throwable) {
    null
  }

  /**
   * Whether this request paints REAL COLOURS rather than a tintable mask. A bar has the bot's colour and the track's; a
   * ring has its progress and its track; beads have filled and hollow. One tint cannot say two colours, so these are
   * painted once per theme.
   */
  private fun twoTone(req: NLookPaintReq): Boolean =
    req.kind == PAINT_BAR || req.kind == PAINT_RING || req.kind == PAINT_DOTS

  /** One paint request in one theme, or null when it cannot be made. */
  fun draw(context: Context, req: NLookPaintReq, density: Float, budget: Budget, night: Boolean = false): Bitmap? = try {
    val wPx = px(req.wDp, density)
    val hPx = px(req.hDp, density)
    val key = req.key + "@" + wPx + "x" + hPx + (if (twoTone(req)) (if (night) "#d" else "#l") else "")
    val hit = cached(key)
    // A hit is counted too. The budget dedups by key, so this costs nothing the first time and keeps the SECOND draw of
    // the same widget from being handed the whole cap again — which is what let the real total run past the share.
    if (hit != null) {
      if (budget.take(key, hit.width, hit.height)) hit else null
    } else {
      make(context, req, key, wPx, hPx, density, budget, night)
    }
  } catch (_: Throwable) {
    null
  }

  private fun make(
    context: Context,
    req: NLookPaintReq,
    key: String,
    wPx: Int,
    hPx: Int,
    density: Float,
    budget: Budget,
    night: Boolean,
  ): Bitmap? {
    val made = when (req.kind) {
      // Art charges its own, because what it decodes is not what was asked for (see `art`).
      PAINT_ART -> art(context, req, key, wPx, hPx, budget)
      PAINT_PATH -> if (budget.take(key, wPx, hPx)) path(req, wPx, hPx) else null
      PAINT_DOTS -> if (budget.take(key, wPx, hPx)) dots(req, wPx, hPx, density, night) else null
      PAINT_RING -> if (budget.take(key, wPx, hPx)) ring(req, wPx, hPx, density, night) else null
      PAINT_BAR -> if (budget.take(key, wPx, hPx)) bar(context, req, density, night) else null
      else -> null
    } ?: return null
    return keep(key, made)
  }

  /**
   * Art from the file the app downloaded, decoded AT THE SIZE IT IS DRAWN, never raw.
   *
   * inSampleSize halves, so the decoded long edge lands somewhere between `want` and twice it: a 1199px still asked for
   * at 300 comes back 600 across. The budget is charged for what is really allocated, which is that, not for the size
   * the design asked for — counting the smaller number let four times the pixels cross the Binder.
   */
  private fun art(context: Context, req: NLookPaintReq, key: String, wPx: Int, hPx: Int, budget: Budget): Bitmap? {
    req.file?.let { path ->
      val file = File(path)
      if (!file.isFile || file.length() <= 0L || file.length() > NLookLimits.ART_BYTES) return null
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(file.path, bounds)
      val longEdge = max(bounds.outWidth, bounds.outHeight)
      if (longEdge <= 0 || longEdge > NLookLimits.ART_LONG_EDGE) return null
      var sample = 1
      val want = max(1, max(wPx, hPx))
      while (longEdge / (sample * 2) >= want) sample *= 2
      if (!budget.take(key, max(1, bounds.outWidth / sample), max(1, bounds.outHeight / sample))) return null
      return BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample })
    }
    // A bundled drawable (a Blip pose, a mapped symbol, the app's own mark): drawn into a bitmap at the size asked for.
    val name = req.drawable ?: return null
    if (!name.matches(Regex("^[a-z0-9_]{1,64}$"))) return null
    if (!budget.take(key, wPx, hPx)) return null
    @Suppress("DiscouragedApi")
    val id = context.resources.getIdentifier(name, "drawable", context.packageName)
    if (id == 0) return null
    val d = try {
      context.getDrawable(id)
    } catch (_: Throwable) {
      null
    } ?: return null
    val b = Bitmap.createBitmap(max(1, wPx), max(1, hPx), Bitmap.Config.ARGB_8888)
    d.setBounds(0, 0, b.width, b.height)
    d.draw(Canvas(b))
    return b
  }

  /**
   * A path, or several, as a THEME-NEUTRAL ALPHA MASK: painted white and tinted per theme at apply time, so one bitmap
   * serves light and night. An unknown command drops only its own path; the shape around it still draws.
   */
  private fun path(req: NLookPaintReq, wPx: Int, hPx: Int): Bitmap? {
    val box = req.viewBox ?: floatArrayOf(0f, 0f, req.wDp, req.hDp)
    if (box[2] <= 0f || box[3] <= 0f) return null
    val b = Bitmap.createBitmap(max(1, wPx), max(1, hPx), Bitmap.Config.ARGB_8888)
    val c = Canvas(b)
    c.scale(b.width / box[2], b.height / box[3])
    c.translate(-box[0], -box[1])
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    var drew = false
    for (d in req.paths) {
      val segs = NlPathCore.parse(d) ?: continue
      val p = build(segs) ?: continue
      if (req.fill != null) {
        paint.style = Paint.Style.FILL
        paint.color = Color.WHITE
        c.drawPath(p, paint)
        drew = true
      }
      if (req.stroke != null && req.strokeDp > 0f) {
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = req.strokeDp * (box[2] / max(1f, req.wDp))
        paint.strokeCap = Paint.Cap.ROUND
        paint.strokeJoin = Paint.Join.ROUND
        paint.color = Color.WHITE
        c.drawPath(p, paint)
        drew = true
      }
      if (req.fill == null && req.stroke == null) {
        paint.style = Paint.Style.FILL
        paint.color = Color.WHITE
        c.drawPath(p, paint)
        drew = true
      }
    }
    return if (drew) b else null
  }

  /** Segments to an android Path. `O` is a circle in its own right, as the bots' looks already write dots and puffs. */
  private fun build(segs: List<NlSeg>): Path? {
    val p = Path()
    var any = false
    for (s in segs) {
      when (s.op) {
        'M' -> { p.moveTo(s.v[0], s.v[1]); any = true }
        'L' -> { p.lineTo(s.v[0], s.v[1]); any = true }
        'Q' -> { p.quadTo(s.v[0], s.v[1], s.v[2], s.v[3]); any = true }
        'C' -> { p.cubicTo(s.v[0], s.v[1], s.v[2], s.v[3], s.v[4], s.v[5]); any = true }
        'Z' -> p.close()
        'O' -> { p.addCircle(s.v[0], s.v[1], s.v[2], Path.Direction.CW); any = true }
        else -> return null
      }
    }
    return if (any) p else null
  }

  /** A colour in this theme, or null when the design named none. */
  private fun pick(ink: NLookInk?, night: Boolean): Int? = if (ink == null) null else if (night) ink.dark else ink.light

  /**
   * The dot grid, and the week's beads. A plain grid (`of` 0) is all one colour. A bead row (`of` set, as `Kit beads`
   * sends it) draws `value` filled in `fill` and the rest in `stroke` — two real colours, so this is painted per theme.
   * With no `stroke` the hollow ones are the fill at a lower alpha, which is what the mask used to do for both.
   */
  private fun dots(req: NLookPaintReq, wPx: Int, hPx: Int, density: Float, night: Boolean): Bitmap? {
    val row = req.of > 0
    val n = if (row) req.of else if (req.grid > 0) req.grid else 5
    val b = Bitmap.createBitmap(max(1, wPx), max(1, hPx), Bitmap.Config.ARGB_8888)
    val c = Canvas(b)
    val r = req.dotDp * density
    val gap = req.spacingDp * density
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    val filled = pick(req.fill, night) ?: Color.WHITE
    val hollow = pick(req.stroke, night)
    var x = r
    for (i in 0 until n) {
      if (x + r > b.width) break
      val lit = !row || i < req.value
      paint.color = if (lit) filled else (hollow ?: filled)
      if (!lit && hollow == null) paint.alpha = 90
      c.drawCircle(x, b.height / 2f, r, paint)
      x += gap
    }
    return b
  }

  /** The ring: the track all the way round, the progress over it. Two real colours, so one bitmap per theme. */
  private fun ring(req: NLookPaintReq, wPx: Int, hPx: Int, density: Float, night: Boolean): Bitmap? {
    val size = min(max(1, wPx), max(1, hPx))
    val b = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val c = Canvas(b)
    val w = max(1f, req.strokeDp * density)
    val box = RectF(w / 2f, w / 2f, size - w / 2f, size - w / 2f)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    paint.style = Paint.Style.STROKE
    paint.strokeWidth = w
    paint.strokeCap = Paint.Cap.ROUND
    val progress = pick(req.fill, night) ?: Color.WHITE
    val track = pick(req.stroke, night)
    if (track != null) {
      paint.color = track
    } else {
      paint.color = progress
      paint.alpha = 70
    }
    c.drawArc(box, 0f, 360f, false, paint)
    paint.color = progress
    val of = max(1, req.of)
    c.drawArc(box, -90f, 360f * req.value.coerceIn(0, of) / of, false, paint)
    return b
  }

  /**
   * The stage bar, in the colours the design named rather than as a mask: done segments in the bot's colour, the current one
   * filling with its own stripes, the rest the track. Drawn at the bar's own width so the stripes keep their angle — the
   * same drawing X0Bar already does for today's views, reached through the same code so the two can never drift.
   *
   * The stage NAMES ride inside this same picture when the design named exactly `of` of them, because today's medium
   * view draws them and an extra RemoteViews level to hold them would not fit. The planner has already grown `hDp` by
   * the label row, so the bar itself keeps the height the design asked for (H19, "also found" A).
   */
  private fun bar(context: Context, req: NLookPaintReq, density: Float, night: Boolean): Bitmap? {
    val color = pick(req.fill, night) ?: return null
    val track = pick(req.stroke, night) ?: (if (night) Color.DKGRAY else Color.GRAY)
    val labels = req.labels
    val barDp = if (labels == null) req.hDp else (req.hDp - labels.rowDp).coerceAtLeast(1f)
    val bar = X0Bar.draw(req.wDp, barDp, density, req.value, req.of, color, track)
    if (labels == null) return bar
    return names(context, req, labels, bar, barDp, density, night) ?: bar
  }

  /** The bar with its stage names under it: the current one bold in `ink`, the done ones `meta`, the rest `dim`. */
  private fun names(
    context: Context,
    req: NLookPaintReq,
    labels: NLookBarLabels,
    bar: Bitmap,
    barDp: Float,
    density: Float,
    night: Boolean,
  ): Bitmap? = try {
    val scale = bar.width / max(1f, req.wDp)
    val b = Bitmap.createBitmap(bar.width, max(1, (req.hDp * scale).roundToInt()), Bitmap.Config.ARGB_8888)
    val c = Canvas(b)
    c.drawBitmap(bar, 0f, 0f, null)
    c.scale(scale, scale)
    val n = labels.names.size
    val gap = 3f
    val seg = (req.wDp - gap * (n - 1)) / n
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    paint.textSize = NLookBarLabels.TEXT_DP
    for (i in 0 until n) {
      val here = i == req.value - 1
      paint.typeface = if (here) labels.bold(context) else labels.plain(context)
      paint.color = when {
        here -> pick(labels.ink, night) ?: Color.WHITE
        i < req.value -> pick(labels.meta, night) ?: Color.GRAY
        else -> pick(labels.dim, night) ?: Color.GRAY
      }
      val name = fit(paint, labels.names[i], seg)
      if (name.isEmpty()) continue
      c.drawText(name, i * (seg + gap), barDp + NLookBarLabels.TEXT_DP + 1f, paint)
    }
    b
  } catch (_: Throwable) {
    null
  }

  /** One name, cut to the width of its own segment. Nothing is drawn rather than something that runs into its neighbour. */
  private fun fit(paint: Paint, name: String, widthDp: Float): String {
    if (name.isEmpty() || widthDp <= 2f) return ""
    if (paint.measureText(name) <= widthDp) return name
    var keep = name.length - 1
    while (keep > 0 && paint.measureText(name.substring(0, keep) + "…") > widthDp) keep--
    return if (keep <= 0) "" else name.substring(0, keep) + "…"
  }

  // ------------------------------------------------------------------ the disk cache: there isn't one
  //
  // There was: every new bitmap was PNG-encoded into nlook/paint on the widget queue, and nothing ever read one back. A
  // write-only cache is only a cost — the encode on the draw's own thread, and the files. Masks are cheap to paint and
  // art is already a file on disk being decoded, so there is nothing a second copy would save. `sweep` went with it.

  /** The old write-only paint cache, swept away once on the next catalog write. Remove after a release or two. */
  fun sweep(context: Context) {
    try {
      val dir = File(File(context.filesDir, "nlook"), "paint")
      dir.listFiles()?.forEach { it.delete() }
      dir.delete()
    } catch (_: Throwable) {
    }
  }

  private fun px(dp: Float, density: Float): Int = max(1, (dp * density).roundToInt()).coerceAtMost(1600)
}

/**
 * The stage names a `Bar` draws under itself, and the three roles they are drawn in. Kept beside the request rather
 * than inside it so a Bar with no names costs nothing. The faces are the bundled `sans` (Geist), the same one the kit's
 * text fragments use, looked up once per process.
 */
internal class NLookBarLabels(
  val names: List<String>,
  val ink: NLookInk?,
  val meta: NLookInk?,
  val dim: NLookInk?,
) {
  fun plain(context: Context): android.graphics.Typeface? = face(context, "geist_medium")

  fun bold(context: Context): android.graphics.Typeface? = face(context, "geist_semibold")

  companion object {
    /** The label's size, and the height the label row adds to the Bar's own picture. */
    const val TEXT_DP = 11f
    const val ROW_DP = 15f

    private val faces = HashMap<String, android.graphics.Typeface?>()

    @Synchronized
    private fun face(context: Context, name: String): android.graphics.Typeface? {
      if (faces.containsKey(name)) return faces[name]
      // Resources.getFont is API 26, and nlook itself needs 31; the guard is here so a lint over the whole module
      // (minSdk 24) reads the same way the runtime does.
      val got = try {
        @Suppress("DiscouragedApi")
        val id = context.resources.getIdentifier(name, "font", context.packageName)
        if (id == 0 || android.os.Build.VERSION.SDK_INT < 26) null else context.resources.getFont(id)
      } catch (_: Throwable) {
        null
      }
      faces[name] = got
      return got
    }
  }

  val rowDp: Float get() = ROW_DP
}


// BEGIN NLookPathCore — kept byte-identical to modules/tulmi-keyboard/android/.../KbPath.kt's own copy, and to
// targets/widgets/NLookPath.swift line for line in meaning. CI diffs the two Kotlin regions between these two
// markers. It is at TOP LEVEL, not inside an object, so the keyboard's copy can be the same lines with the same
// indentation. Do not edit one alone.
/** One command of the path grammar: `op` is M L Q C Z O, `v` holds its numbers, already counted. */
internal class NlSeg(val op: Char, val v: FloatArray)

/**
 * THE PATH GRAMMAR, M L Q C Z O, shared by the bots' looks, the animation format, nlook shapes and the keyboard's `path`
 * mark. One parser so a path drawn for an animation scene stays drawable as a widget shape or a key print.
 *
 *   M x y                     move
 *   L x y                     line
 *   Q cx cy x y               quadratic
 *   C c1x c1y c2x c2y x y     cubic — the animation spec's format-2 addition, accepted from day one
 *   Z                         close
 *   O cx cy r                 circle, r greater than zero
 *
 * Every command carries exactly its own count of numbers and its own letter: `L 1 1 2 2` is not two lines, it drops the
 * path. Letters are upper case only, so a relative command can never be drawn as an absolute one. ANYTHING ELSE DROPS THE
 * WHOLE PATH and returns null: an unknown character, a wrong number count, a token that is not a number, a number that is
 * not finite or is 100000 or more, a token over 24 characters, or more than 400 segments. There is no guessing and no
 * expression evaluation anywhere in this format.
 */
internal object NlPathCore {
  /** A `d` longer than this is not parsed at all. */
  const val MAX_CHARS = 900

  /** At most this many segments come out of one `d`. */
  const val MAX_SEGMENTS = 400

  /** One number's text may be this long at most. */
  private const val MAX_TOKEN = 24

  /** A number this far from zero is not a drawing, it is a mistake. */
  private const val MAX_ABS = 100_000.0

  private fun arity(op: Char): Int = when (op) {
    'M' -> 2
    'L' -> 2
    'Q' -> 4
    'C' -> 6
    'Z' -> 0
    'O' -> 3
    else -> -1
  }

  fun parse(d: String): List<NlSeg>? {
    if (d.isEmpty() || d.length > MAX_CHARS) return null
    val out = ArrayList<NlSeg>()
    val numbers = ArrayList<Float>()
    val token = StringBuilder()
    // ' ' means "no letter yet": numbers before the first letter drop the path, as they do on iPhone.
    var op = ' '
    for (c in d) {
      if (arity(c) >= 0) {
        if (!take(token, numbers)) return null
        if (!flush(out, op, numbers)) return null
        op = c
      } else if (c == ' ' || c == ',' || c == '\n' || c == '\t') {
        // Those four and no others. A carriage return is not a separator here, because it is not one on iPhone.
        if (!take(token, numbers)) return null
      } else if (c in '0'..'9' || c == '.' || c == '-' || c == '+' || c == 'e' || c == 'E') {
        token.append(c)
        if (token.length > MAX_TOKEN) return null
      } else {
        // Any other character is a command this grammar does not have (an arc, a relative move): drop the path.
        return null
      }
    }
    if (!take(token, numbers)) return null
    if (!flush(out, op, numbers)) return null
    if (out.isEmpty() || out.size > MAX_SEGMENTS) return null
    return out
  }

  /** The number gathered so far, if any. Parsed as a double so `1e3` reads the same as it does on iPhone. */
  private fun take(token: StringBuilder, numbers: ArrayList<Float>): Boolean {
    if (token.isEmpty()) return true
    val value = token.toString().toDoubleOrNull() ?: return false
    // Written as two comparisons, not kotlin.math.abs, so the region needs no import of its own in either file.
    if (!value.isFinite() || value >= MAX_ABS || value <= -MAX_ABS) return false
    numbers.add(value.toFloat())
    token.setLength(0)
    return true
  }

  /** The numbers gathered for one command letter. Exactly its own count, or the path drops. */
  private fun flush(out: ArrayList<NlSeg>, op: Char, numbers: ArrayList<Float>): Boolean {
    val size = arity(op)
    if (size < 0) {
      // No letter yet: anything gathered before the first one is a path we do not read.
      val clean = numbers.isEmpty()
      numbers.clear()
      return clean
    }
    if (numbers.size != size) {
      numbers.clear()
      return false
    }
    if (op == 'O' && numbers[2] <= 0f) {
      numbers.clear()
      return false
    }
    val v = FloatArray(size)
    for (k in 0 until size) v[k] = numbers[k]
    out.add(NlSeg(op, v))
    numbers.clear()
    return true
  }
}
// END NLookPathCore
