package expo.modules.tulmibridge

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.text.SpannableString
import android.text.Spanned
import android.text.TextPaint
import android.text.style.StyleSpan
import android.util.SizeF
import android.util.TypedValue
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.RemoteViews
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Locale
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * X0, ON AN ANDROID HOME SCREEN: the one widget that shows the whole app at a glance and leads with what matters now (the
 * backend's docs/widget-glance-v2.md is the contract; iOS draws the same glance in targets/widgets). Four cases, each at three
 * sizes, as designed:
 *
 *   needs     something needs the person: the bot's face, its question, the answers (answered right here, through the widgets'
 *             own narrow token, TailzuWidgetActReceiver) and You decide
 *   working   bots at work: the job's task, its stage bar with the stages' names, minutes so far; who else is at work
 *   done      something just finished: what, how long, See the PR
 *   quiet     all quiet: the greeting and the day's line, the week's beads, Blip (X0's own) at rest, Ask with his peek key
 *
 *   2x2 (small, narrower than 250dp)  ·  4x2 (medium)  ·  4x4 (large, 280dp tall and more: the bots as Home's tiles, Ask)
 *
 * Everything drawn is the glance the app fetched and checked (src/widgets/glance.ts) and wrote to this app's `tulmi.widget`
 * SharedPreferences under `x0.glance` (setWidgetGlance); every word is the glance's `words` first, a string resource after.
 * EVERY CARD SHOWS THE BOT WHOSE CARD IT IS — the one working, the one asking, the one that finished, each tile's own: its
 * dotted still as the app drew it, else the face file it downloaded (files/widget-faces/<face>.png), else a built-in bot's
 * bundled head, else a disc in its colour with its initial (X0Faces). Blip is only in the quiet state, where there is no card,
 * and beside the Ask bar as his own peek key. Nothing here asks the server anything. Every tap opens a link of this
 * app's (TailzuQuick.openIntent), except See the PR, which opens the pull request on github.com.
 *
 * Light and dark: the app's palette (WidgetInk; the widget theme's colours over it), colour only from the bots. Android 12+ is
 * handed every colour, and the stage bar, for both themes and one layout per size the launcher may show (RemoteViews(Map)); before
 * that the provider draws the theme showing, a portrait and a landscape layout picked by the sizes the launcher reports.
 *
 * Each layout is generated from one spec (android/x0-layouts.py); a size or a case has only the views it shows, so every view is
 * set through Views, which skips an id its layout does not have (a set on a missing view would fail the whole widget).
 *
 * Redrawn whenever the app writes a glance, after an answer pressed here, and, while a job runs or a finished thing shows, every
 * few minutes by itself (an inexact alarm that never wakes the phone), so its minutes count on; it stops on a glance hours old.
 * And at each of the glance's steps (X0Steps): a leave-by takes Plan Ease's line at its minute, then the next thing, with no new
 * glance, through a second alarm of the same kind set for the next step.
 */
class TailzuX0Widget : AppWidgetProvider() {
  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    TailzuX0.drawAll(context, appWidgetManager, appWidgetIds)
  }

  // A resize, or the launcher turning between portrait and landscape: drawn again for the sizes it shows now.
  override fun onAppWidgetOptionsChanged(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int, newOptions: Bundle?) {
    TailzuX0.drawAll(context, appWidgetManager, intArrayOf(appWidgetId))
  }

  /**
   * EVERY DRAW GOES OFF THE MAIN THREAD, on the widgets' one serial queue (TailzuWork), under goAsync so the process
   * stays alive while it runs.
   *
   * Not only the alarm. Most APPWIDGET_UPDATE broadcasts X0 gets are OURS, sent by TailzuQuick.requestUpdate on every
   * glance sync, theme write, catalog write and answer — so they arrive on the app's main thread while the person is
   * using the app, and with a design on they would read a file and paint bitmaps there. Serial because two draws must
   * never overlap: the paint budget has one writer, the newest glance must land last, and a sweep must never delete a
   * folder a draw is reading.
   *
   * Everything that is not a draw — DELETED, ENABLED, DISABLED — is cheap and still goes to super.onReceive inline.
   */
  override fun onReceive(context: Context, intent: Intent) {
    val app = context.applicationContext ?: context
    if (intent.action == TailzuX0.TICK || intent.action == TailzuX0.STEP) {
      TailzuWork.receive(goAsync()) {
        TailzuX0.drawAll(app)
        // A Board counts the same minutes and turns at the same doneMs, and its own provider has no alarm: it rides this
        // one, which is what tailzu_x0_board_info.xml has always promised. X0's drawAll arms the alarm for both kinds.
        TailzuX0Board.drawAll(app)
        // The ongoing "Bots at work" notice counts minutes too, and it rides this same alarm rather than owning one:
        // the phone is already awake for the widget, and a second inexact alarm would buy nothing (TailzuBotsUpdate).
        TailzuBotsUpdate.post(app)
      }
      return
    }
    // The person swiped the "Bots at work" notice away. It stays away until the app sets a new state.
    if (intent.action == TailzuX0.NOTICE_GONE) {
      TailzuWork.receive(goAsync()) {
        TailzuBotsUpdate.dismissed(app)
        TailzuX0.arm(app, AppWidgetManager.getInstance(app), X0Doc.load(app), System.currentTimeMillis())
      }
      return
    }
    val ids = TailzuWork.widgetIds(intent)
    val manager = if (ids == null) null else AppWidgetManager.getInstance(app)
    if (ids != null && manager != null) {
      // The same two calls AppWidgetProvider.onReceive would make, made on the queue instead of on this thread.
      TailzuWork.receive(goAsync()) {
        if (intent.action == AppWidgetManager.ACTION_APPWIDGET_OPTIONS_CHANGED) {
          onAppWidgetOptionsChanged(app, manager, ids[0], intent.extras?.getBundle(AppWidgetManager.EXTRA_APPWIDGET_OPTIONS))
        } else {
          onUpdate(app, manager, ids)
        }
      }
      return
    }
    super.onReceive(context, intent)
  }

  /**
   * The last X0 came off the home screen. The alarms are not simply cancelled: a Board may still be placed, and the
   * "Bots at work" notice may still be standing, and both of those count minutes on this same tick. `arm` works that out.
   */
  override fun onDisabled(context: Context) {
    val app = context.applicationContext ?: context
    val now = System.currentTimeMillis()
    TailzuX0.arm(app, AppWidgetManager.getInstance(app), X0Doc.load(app, now), now)
  }
}

object TailzuX0 {
  /** Where setWidgetGlance keeps the glance, and when it wrote it (TulmiBridgeModule.kt), in TailzuQuick.PREFS. */
  const val KEY = "x0.glance"
  const val WRITTEN_AT = "x0.glance.writtenAt"

  /** The widget's own redraw while a job runs (an explicit broadcast to the provider, from this app's own alarm). */
  internal const val TICK = "expo.modules.tulmibridge.X0_TICK"
  private const val TICK_MS = 3 * 60_000L

  /** The redraw at the glance's next step (X0Steps), on an alarm of its own so it never moves the tick's. */
  internal const val STEP = "expo.modules.tulmibridge.X0_STEP"

  /** The "Bots at work" notice's deleteIntent: the person swiped it away (TailzuBotsUpdate). */
  internal const val NOTICE_GONE = "expo.modules.tulmibridge.X0_NOTICE_GONE"

  /** No ticking on a glance older than this: what it says of a running job is no longer worth counting on. */
  private const val TICK_FOR_MS = 3 * 3_600_000L

  /** A finished thing leads for two hours after it ended (the contract's lastDone window), then the next case does. */
  internal const val DONE_MS = 2 * 3_600_000L

  /** Ask every placed X0 to draw again (a broadcast, so the caller never waits on a draw). Never throws. */
  fun requestUpdate(context: Context) = TailzuQuick.requestUpdate(context, TailzuX0Widget::class.java)

  internal fun drawAll(context: Context, manager: AppWidgetManager? = null, only: IntArray? = null) {
    try {
      val widgets = manager ?: AppWidgetManager.getInstance(context) ?: return
      val ids = only ?: widgets.getAppWidgetIds(ComponentName(context, TailzuX0Widget::class.java)) ?: IntArray(0)
      val now = System.currentTimeMillis()
      val doc = X0Doc.load(context, now)
      for (id in ids) draw(context, widgets, id, doc)
      // Always, even with no X0 placed: the alarms serve the Board and the notice as well, and this is where they are
      // decided. With nothing at all to redraw, `arm` cancels them.
      arm(context, widgets, doc, now)
    } catch (_: Throwable) {
      // A widget never stops the app.
    }
  }

  /**
   * THE TWO ALARMS, for EVERYTHING that counts minutes: X0, the X0 Board and the "Bots at work" notice. Each of the
   * three used to decide this for itself, which left a Board frozen until the app wrote a glance and left the notice's
   * minutes standing still on a phone with no X0 on its home screen. One place, asked by all of them.
   */
  internal fun arm(context: Context, widgets: AppWidgetManager?, doc: X0Doc?, now: Long) {
    val placed = placed(context, widgets)
    val notice = TailzuBotsUpdate.running(context)
    tick(context, (placed && doc != null && ticks(doc, now)) || notice)
    step(context, if (placed) doc?.nextStepAt else null)
  }

  /** Whether either widget kind is on a home screen. */
  private fun placed(context: Context, widgets: AppWidgetManager?): Boolean = try {
    val manager = widgets ?: AppWidgetManager.getInstance(context)
    val x0 = manager?.getAppWidgetIds(ComponentName(context, TailzuX0Widget::class.java))?.size ?: 0
    val board = manager?.getAppWidgetIds(ComponentName(context, TailzuX0BoardWidget::class.java))?.size ?: 0
    x0 + board > 0
  } catch (_: Throwable) {
    false
  }

  /**
   * One widget drawn and handed to the launcher, with the two fallbacks SPEC §3.7 asks for. The host's own errors — no
   * memory for the bitmaps, a Binder transaction too large — arrive here as an exception from updateAppWidget, and
   * there is nothing to read in them. So:
   *   a design's views were refused   strike that design (two strikes and this phone never draws it again) and draw
   *                                   today's own views, which cost one bitmap and have been accepted for years;
   *   today's views were refused too  the plain layout as placed, rather than "can't load widget".
   * Before this, a refused design fell straight to an EMPTY layout and took no strike, so the next TICK did it again.
   */
  private fun draw(context: Context, manager: AppWidgetManager, id: Int, doc: X0Doc?) {
    var design = ""
    try {
      val made = drawn(context, doc, manager.getAppWidgetOptions(id), id, true)
      design = made.design
      manager.updateAppWidget(id, made.views)
      return
    } catch (_: Throwable) {
    }
    try {
      if (design.isNotEmpty()) {
        NLookStore.strike(context, design)
        manager.updateAppWidget(id, drawn(context, doc, manager.getAppWidgetOptions(id), id, false).views)
        return
      }
    } catch (_: Throwable) {
    }
    try {
      manager.updateAppWidget(id, RemoteViews(context.packageName, R.layout.tailzu_x0_medium_quiet))
    } catch (_: Throwable) {
    }
  }

  /** Redraw in a few minutes (on) or not (off). Inexact and never waking the phone: it runs when the phone is awake anyway. */
  internal fun tick(context: Context, on: Boolean) {
    try {
      val alarms = context.getSystemService(AlarmManager::class.java) ?: return
      val intent = Intent(context, TailzuX0Widget::class.java).setAction(TICK)
      val pending = PendingIntent.getBroadcast(context, 0x58, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      if (on) alarms.set(AlarmManager.ELAPSED_REALTIME, SystemClock.elapsedRealtime() + TICK_MS, pending)
      else alarms.cancel(pending)
    } catch (_: Exception) {
    }
  }

  /**
   * Redraw at `at` (wall-clock ms), the glance's next step, or not at all (null). Inexact and never waking the phone, as the tick:
   * a line only has to be right when someone looks, and the phone is awake then. No exact-alarm permission is asked for.
   */
  internal fun step(context: Context, at: Long?) {
    try {
      val alarms = context.getSystemService(AlarmManager::class.java) ?: return
      val intent = Intent(context, TailzuX0Widget::class.java).setAction(STEP)
      val pending = PendingIntent.getBroadcast(context, 0x59, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      if (at != null && at > 0L) alarms.set(AlarmManager.RTC, at, pending)
      else alarms.cancel(pending)
    } catch (_: Exception) {
    }
  }

  internal fun ticks(doc: X0Doc, now: Long): Boolean {
    if (doc.at > 0 && now - doc.at > TICK_FOR_MS) return false
    return when (doc.caseAt(now)) {
      "working" -> doc.job?.startedAt?.let { it > 0 } == true
      "done" -> true
      else -> false
    }
  }

  // ------------------------------------------------------------------ sizes

  internal const val SMALL = 0
  internal const val MEDIUM = 1
  internal const val LARGE = 2

  /** The layout for a case at a size. */
  private val LAYOUTS = mapOf(
    "needs" to intArrayOf(R.layout.tailzu_x0_small_needs, R.layout.tailzu_x0_medium_needs, R.layout.tailzu_x0_large_needs),
    "working" to intArrayOf(R.layout.tailzu_x0_small_working, R.layout.tailzu_x0_medium_working, R.layout.tailzu_x0_large_working),
    "done" to intArrayOf(R.layout.tailzu_x0_small_done, R.layout.tailzu_x0_medium_done, R.layout.tailzu_x0_large_done),
    "quiet" to intArrayOf(R.layout.tailzu_x0_small_quiet, R.layout.tailzu_x0_medium_quiet, R.layout.tailzu_x0_large_quiet),
  )

  /** 2x2 below 250dp wide, 4x4 from 280dp tall, 4x2 between. */
  internal fun sizeClass(s: SizeDp): Int = when {
    s.w < 250f -> SMALL
    s.h >= 280f -> LARGE
    else -> MEDIUM
  }

  /** Today's hand-written views for a glance. Internal so the X0 Board kind can fall back to exactly this and nothing else. */
  internal fun views(context: Context, doc: X0Doc?, options: Bundle?, id: Int): RemoteViews =
    drawn(context, doc, options, id, true).views

  /** What was drawn, and which design drew it ("" for today's own views). */
  internal class Drawn(val views: RemoteViews, val design: String)

  internal fun drawn(context: Context, doc: X0Doc?, options: Bundle?, id: Int, look: Boolean): Drawn {
    val c = X0Ctx(context, doc, id)
    if (Build.VERSION.SDK_INT >= 31) {
      val listed = listedSizes(options)
      // A LOOK THE SERVER SENT, first (NLookRemote): the design the glance named, drawn from data this build already holds.
      // Null for every reason there is — no design, an id this phone does not hold, a format too new, over a level or
      // bitmap cap, a design this phone marked bad, or anything at all thrown on the way — and today's views below draw
      // instead. Nothing about the twelve layouts changes, so an old build and a dark switch look the same.
      if (look) NLookRemote.widget(c, listed, "x0")?.let { return Drawn(it.views, it.design) }
      // One layout per size the launcher may show, each drawn for exactly its size; the launcher shows the one that fits.
      if (listed.size > 1) return Drawn(RemoteViews(listed.associate { SizeF(it.w, it.h) to build(c, it) }), "")
      if (listed.size == 1) return Drawn(build(c, listed[0]), "")
    }
    val (portrait, landscape) = extremes(options)
    val p = build(c, portrait)
    if (portrait == landscape) return Drawn(p, "")
    return Drawn(RemoteViews(build(c, landscape), p), "")
  }

  private fun build(c: X0Ctx, size: SizeDp): RemoteViews {
    val case = c.doc?.caseAt(c.now) ?: "quiet"
    val cls = sizeClass(size)
    val v = Views(c.context, LAYOUTS.getValue(case)[cls], c.night)
    X0Fill(c, v, size, cls).fill(case)
    return v.rv
  }

  /** Android 12+: the sizes, in dp, the launcher may show this widget at. */
  internal fun listedSizes(options: Bundle?): List<SizeDp> {
    if (Build.VERSION.SDK_INT < 31 || options == null) return emptyList()
    val listed = try {
      @Suppress("DEPRECATION")
      options.getParcelableArrayList<SizeF>(AppWidgetManager.OPTION_APPWIDGET_SIZES)
    } catch (_: Exception) {
      null
    }
    return listed.orEmpty().filter { it.width > 0f && it.height > 0f }.map { SizeDp(sane(it.width), sane(it.height)) }.distinct().take(6)
  }

  /** Before Android 12: by the platform's convention the narrow-and-tall extremes are portrait, the wide-and-short landscape. */
  private fun extremes(options: Bundle?): Pair<SizeDp, SizeDp> {
    fun dim(key: String) = options?.getInt(key, 0)?.toFloat() ?: 0f
    val portrait = SizeDp(
      sane(dim(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH), 300f), sane(dim(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT), 180f),
    )
    val landscape = SizeDp(
      sane(dim(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH), portrait.w), sane(dim(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT), portrait.h),
    )
    return Pair(portrait, landscape)
  }

  private fun sane(dp: Float, fallback: Float = 180f): Float = if (dp.isFinite() && dp > 0f) dp.coerceIn(40f, 2000f) else fallback
}

internal data class SizeDp(val w: Float, val h: Float)

// ====================================================================================================== the glance, as written

/**
 * The glance the app wrote, read leniently: a missing or mistyped field is absent and its caller falls back. JSON's null is
 * absent too (org.json's optString would say "null").
 */
internal class X0Doc private constructor(o: JSONObject, val writtenAt: Long, val now: Long) {
  class Bot(val slug: String, val name: String, val color: Int?, val face: String?, val state: String, val needs: Int,
            val working: Boolean, val line: String, val link: String)

  class Choice(val id: String, val label: String, val primary: Boolean)

  class Item(val id: String, val bot: String, val botName: String, val face: String?, val question: String,
             val choices: List<Choice>, val decideLink: String, val answerable: Boolean, val link: String)

  class Job(val id: String, val bot: String, val task: String, val stage: Int, val of: Int, val stageName: String,
            val stages: List<String>, val startedAt: Long, val link: String)

  class Done(val bot: String, val botName: String, val result: String, val endedAt: Long, val minutes: Int, val prNumber: Int,
             val prUrl: String, val link: String)

  /**
   * The glance exactly as the app wrote it. Only nlook's closed bind table reads it (NLookBind), so a server design can
   * reach the same fields these typed ones do without a new native build for each one. Nothing else here touches it.
   */
  internal val raw: JSONObject = o

  val at: Long = num(o, "at")?.toLong() ?: 0L
  private val case: String = str(o, "case")
  private val greeting = o.optJSONObject("greeting")
  val hello: String = str(greeting, "hello")
  val line: String = str(greeting, "line")
  val summary: String = str(o, "summary")
  private val week = o.optJSONObject("week")
  val weekDots: Int = (num(week, "dots")?.toInt() ?: 0).coerceIn(0, 5)
  val weekLine: String = str(week, "line")
  /** The glance's steps, oldest first: lines that take over at their own minute (X0Steps; glanceCore.ts GlanceStep). */
  private val steps: List<X0Steps.Step> = objects(o.optJSONArray("steps")).mapNotNull { st ->
    val l = st.optJSONObject("lock")
    val lock = if (l == null) null else X0Steps.Lock(str(l, "inline"), str(l, "title"), str(l, "line"))
    X0Steps.of(num(st, "at")?.toLong(), str(st, "bot"), str(st, "line"), lock)
  }.sortedBy { it.at }.take(X0Steps.MAX)

  /** Each bot as the glance reads now: an idle row's line from its latest step begun by now. */
  val bots: List<Bot> = objects(o.optJSONArray("bots")).mapNotNull { b ->
    val slug = str(b, "slug").takeIf { it.isNotEmpty() } ?: return@mapNotNull null
    val state = str(b, "state").ifEmpty { "idle" }
    val working = b.opt("working") == true || state == "working"
    val line = X0Steps.line(steps, slug, state, working, now) ?: str(b, "line")
    Bot(slug, str(b, "name").ifEmpty { slug }, WidgetInk.hex(str(b, "color").ifEmpty { null }), face(str(b, "face")), state,
      num(b, "needs")?.toInt() ?: 0, working, line, str(b, "link"))
  }.take(8)
  private val needs = o.optJSONObject("needs")
  val items: List<Item> = objects(needs?.optJSONArray("items")).mapNotNull { i ->
    val id = str(i, "id").takeIf { it.isNotEmpty() } ?: return@mapNotNull null
    val choices = objects(i.optJSONArray("choices")).mapNotNull { c ->
      val cid = str(c, "id")
      val label = str(c, "label")
      if (cid.isEmpty() || label.isEmpty()) null else Choice(cid, label, c.opt("primary") == true)
    }.take(3)
    Item(id, str(i, "bot"), str(i, "botName"), face(str(i, "face")), str(i, "question"), choices, str(i, "decideLink"),
      i.opt("answerable") == true && choices.isNotEmpty(), str(i, "link"))
  }.take(3)
  val needsCount: Int = max(num(needs, "count")?.toInt() ?: 0, items.size)
  val job: Job? = o.optJSONObject("job")?.let { j ->
    val stages = strings(j.optJSONArray("stages"))
    val of = (num(j, "of")?.toInt() ?: stages.size).coerceIn(1, 12)
    Job(str(j, "id"), str(j, "bot"), str(j, "task"), (num(j, "stage")?.toInt() ?: 1).coerceIn(1, of), of, str(j, "stageName"),
      stages, num(j, "startedAt")?.toLong() ?: 0L, str(j, "link"))
  }
  val done: Done? = o.optJSONObject("lastDone")?.let { d ->
    val pr = d.optJSONObject("pr")
    Done(str(d, "bot"), str(d, "botName"), str(d, "result"), num(d, "endedAt")?.toLong() ?: 0L, num(d, "minutes")?.toInt() ?: 0,
      num(pr, "number")?.toInt() ?: 0, str(pr, "url"), str(d, "link"))
  }
  private val lock = o.optJSONObject("lock")
  // A step's lock words from its minute on, except while the widget leads with a question: what needs the person comes first.
  private val lockNow: X0Steps.Lock? = if (caseAt(now) == "needs") null else X0Steps.lock(steps, now)
  val lockTitle: String = lockNow?.title ?: str(lock, "title")
  val lockLine: String = lockNow?.line ?: str(lock, "line")

  /** When the glance next reads differently on its own (its next step's minute), or null. */
  val nextStepAt: Long? = X0Steps.next(steps, now)
  private val links = o.optJSONObject("links")
  val ask: String = str(links, "ask")
  val home: String = str(links, "home")
  val mic: String = str(links, "mic")
  private val words = o.optJSONObject("words")

  /** The glance's word, or the fallback. */
  fun word(key: String, fallback: String): String = str(words, key).ifBlank { fallback }

  /**
   * The design the server named for a widget kind ("x0", "board"), for a build that said NativeLook1 and sent its `nl`.
   * Null when it named none, which is the normal state while the look switch is off: today's views draw.
   */
  fun look(kind: String): String? = str(raw.optJSONObject("look"), kind).takeIf { it.isNotEmpty() }

  /**
   * THE BOARDS "X0 Board" OFFERS, as the server worded them. Names come down on the glance, already in this person's
   * language and already filtered to what this phone can draw, because a design carries no gallery words and a widget
   * may not invent any: a list built out of design ids would read "night" to a person who has never seen the catalog.
   *
   * A board with no name is not offered. An id IS offered even when this phone does not hold its design yet — X0's own
   * hand-written view draws it meanwhile, exactly as it does on iPhone. With no list at all the picker shows only the
   * bundled "Overview", which is the truth while the look switch is off.
   */
  val boards: List<Pair<String, String>> = objects(o.optJSONArray("boards")).mapNotNull { b ->
    val id = str(b, "id")
    val name = str(b, "name")
    if (!BOARD.matches(id) || !id.startsWith("board.") || id == "board.base" || name.isEmpty()) return@mapNotNull null
    Pair(id, name.take(40))
  }.distinctBy { it.first }.take(12)

  /** The free map the server fills beside `look` (bind.ts), the one way a design binds data this struct has no field for. */
  fun vars(): JSONObject? = raw.optJSONObject("vars")

  fun bot(slug: String?): Bot? = if (slug.isNullOrEmpty()) null else bots.firstOrNull { it.slug == slug }

  /**
   * The case to lead with now: the server's while the glance backs it, else the contract's order (needs, done, working,
   * quiet). A finished thing stops leading two hours after it ended, even with no new glance.
   */
  fun caseAt(now: Long): String {
    val backed = mapOf(
      "needs" to (needsCount > 0 || items.isNotEmpty()),
      "done" to (done != null && (done.endedAt <= 0L || now - done.endedAt < TailzuX0.DONE_MS)),
      "working" to (job != null || bots.any { it.working }),
      "quiet" to true,
    )
    if (backed[case] == true) return case
    return ORDER.first { backed[it] == true }
  }

  companion object {
    private val ORDER = listOf("needs", "done", "working", "quiet")
    private val FACE = Regex("^[a-z0-9][a-z0-9_-]{0,47}$")

    /** A design id, the same shape NLookStore reads: a board the glance names has to be one. */
    private val BOARD = Regex("^[a-z0-9._-]{1,40}$")

    /** What setWidgetGlance last stored, as it reads at `now`, or nothing (never written, or signed out). Never throws. */
    fun load(context: Context, now: Long = System.currentTimeMillis()): X0Doc? = try {
      val p = TailzuQuick.prefs(context)
      TailzuQuick.obj(p.getString(TailzuX0.KEY, null))
        ?.takeIf { (it.opt("v") as? Number)?.toInt() == 2 }
        ?.let { X0Doc(it, p.getLong(TailzuX0.WRITTEN_AT, 0L), now) }
    } catch (_: Exception) {
      null
    }

    fun face(s: String): String? = s.takeIf { FACE.matches(it) }

    private fun str(o: JSONObject?, key: String): String = (o?.opt(key) as? String)?.trim() ?: ""

    private fun num(o: JSONObject?, key: String): Double? = (o?.opt(key) as? Number)?.toDouble()?.takeIf { it.isFinite() }

    private fun objects(a: JSONArray?): List<JSONObject> = if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.optJSONObject(it) }

    private fun strings(a: JSONArray?): List<String> = if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.opt(it) as? String }
  }
}

// ====================================================================================================== one draw's context

/** A bot's face: a bundled drawable (a built-in bot's head) or a bitmap (its still, its downloaded face, or a disc). */
internal sealed class Face {
  class Res(val id: Int) : Face()
  class Bmp(val bitmap: Bitmap) : Face()
}

/**
 * THE PICTURE OF A BOT A CARD SHOWS, in one place because three surfaces draw it: X0 itself, the X0 Board and the "Bots at
 * work" notice. Every card shows THE BOT WHOSE CARD IT IS — the one working, the one asking, the one that finished, each
 * row's own — in this order:
 *
 *   1. its dotted still, as the app drew it from the bots' own looks into the art channel (files/nlook/art/...)
 *   2. its face, as the app downloaded it (files/widget-faces/<face>.png)
 *   3. a disc in its own colour with its initial
 *
 * Blip and the X0 mark are NOT in this list. They belong where there is no card at all: the quiet state, the Ask bar's peek
 * key, the launcher icon, and the notice's small icon (which Android requires to be the app's own monochrome mark).
 */
internal object X0Faces {
  /** A decoded picture's longest edge: the same cap the notice and the painter use, so a face costs the same everywhere. */
  private const val MAX_PX = 256

  /**
   * The dotted still the app drew for this bot, at the moment asked for ("work" while it works, "rest" otherwise), else at
   * any moment the art channel holds for it. Null before the app has drawn one — there is no still for a bot no design asks
   * about, which is the normal state while the look switch is off.
   */
  fun still(context: Context, index: NLookIndex?, slug: String?, moment: String): Bitmap? {
    val file = stillFile(context, index, slug, moment) ?: return null
    return decode(file)
  }

  private fun stillFile(context: Context, index: NLookIndex?, slug: String?, moment: String): File? {
    if (index == null || slug.isNullOrEmpty() || X0Doc.face(slug) == null) return null
    val prefix = "bot:$slug."
    // Sorted, so one bot draws the SAME still on every size and every redraw rather than flickering between moments.
    val keys = index.art.keys.filter { it.startsWith(prefix) }.sorted()
    if (keys.isEmpty()) return null
    val key = keys.firstOrNull { it.startsWith(prefix + moment + "@") }
      ?: keys.firstOrNull { it.startsWith(prefix + "rest@") }
      ?: keys.first()
    val relative = index.art[key] ?: return null
    if (relative.contains("..")) return null
    return File(context.filesDir, relative).takeIf { it.isFile && it.length() in 1..NLookLimits.ART_BYTES }
  }

  /** The face file the app downloaded for a bot, named by its face key. Null until it is there. */
  fun face(context: Context, key: String?): Bitmap? {
    val k = key?.let { X0Doc.face(it) } ?: return null
    return decode(File(File(context.filesDir, "widget-faces"), "$k.png"))
  }

  /** A bot with no picture at all: a disc in its own colour, its initial over it. A face slot's size by default. */
  fun disc(color: Int, name: String, px: Int = 96): Bitmap {
    val b = Bitmap.createBitmap(px, px, Bitmap.Config.ARGB_8888)
    val c = Canvas(b)
    val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color }
    c.drawCircle(px / 2f, px / 2f, px / 2f, fill)
    val initial = name.trim().firstOrNull()?.uppercase(Locale.getDefault()) ?: ""
    if (initial.isNotEmpty()) {
      val p = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        this.color = if (fill.color == Color.WHITE) Color.BLACK else Color.WHITE
        textSize = px * 0.46f
        typeface = Typeface.DEFAULT_BOLD
        textAlign = Paint.Align.CENTER
      }
      val m = p.fontMetrics
      c.drawText(initial, px / 2f, px / 2f - (m.ascent + m.descent) / 2f, p)
    }
    return b
  }

  /** A file off disk, sampled down to the face slot's size. Null for anything missing, too big or unreadable. */
  fun decode(file: File): Bitmap? = try {
    if (!file.isFile || file.length() > 2_000_000L) {
      null
    } else {
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(file.path, bounds)
      if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
        null
      } else {
        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / sample > MAX_PX) sample *= 2
        BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample })
      }
    }
  } catch (_: Throwable) {
    null
  }
}

/** What every size of one widget's draw shares: the glance, the colours, the faces (decoded once), the taps. */
internal class X0Ctx(val context: Context, val doc: X0Doc?, private val widgetId: Int) {
  /** The moment the glance was read as of (its steps applied), so every part of one draw tells the same time. */
  val now = doc?.now ?: System.currentTimeMillis()
  val night = WidgetInk.isNight(context)
  val density: Float = context.resources.displayMetrics.density.takeIf { it > 0f } ?: 1f

  // The catalog's palette when the phone holds one (it is THE source for widget colour), today's resources otherwise.
  private val palette = WidgetInk.Palette(context, NLookStore.palette(context))
  private val theme = TailzuQuick.obj(TailzuQuick.prefs(context).getString(TailzuQuick.THEME_KEY, null))
  private val darks = listOf(theme?.optJSONObject("colors"))
  private val lights = listOf(theme?.optJSONObject("light"))
  private fun role(key: String, role: String) = WidgetInk.resolve(key, palette.role(role), lights, darks)

  val ground = role("ground", "ground")
  val ink = role("pale", "ink")
  val meta = role("meta", "meta")
  val line = role("line", "line")
  val surface = role("surface", "surface")
  val dim = palette.role("dim")
  val hollow = palette.role("hollow")
  val outline = palette.role("outline")
  val clear = Ink(0, 0)

  /** What answers pressed here did, since the glance was written. */
  val states: Map<String, String> = doc?.let { TailzuQuick.states(context, it.writtenAt) } ?: emptyMap()

  /** Whether an answer can go from here (the widgets' token is kept); else an answer opens the app. */
  val canAnswer = TailzuQuick.canAnswer(context)

  /** A bot's colour in both themes, or the ink for a bot without one. */
  fun botInk(slug: String?): Ink = if (slug.isNullOrEmpty()) ink else WidgetInk.bot(doc?.bot(slug)?.color, slug, ink) ?: ink

  /** The glance's word, else the resource. */
  fun word(key: String, res: Int): String {
    val fallback = context.getString(res)
    return doc?.word(key, fallback) ?: fallback
  }

  // ---- taps: each view its own request code per widget, so no tap stands in for another

  private fun code(slot: Int) = 0x40000 + (widgetId and 0x3FFF) * 64 + slot

  /** A link of this app's; one that is not opens the app. */
  fun open(url: String?, slot: Int): PendingIntent? = TailzuQuick.open(context, url?.ifEmpty { null } ?: doc?.home, code(slot))

  /** A pull request on github.com, in the browser (the one link here that is not the app's). */
  fun openPr(url: String, slot: Int): PendingIntent? {
    val uri = Uri.parse(url)
    if (uri.scheme != "https" || uri.host?.lowercase(Locale.ROOT) != "github.com") return null
    return try {
      PendingIntent.getActivity(
        context, code(slot), Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    } catch (_: Exception) {
      null
    }
  }

  /** An answer posted from here (TailzuWidgetActReceiver). */
  fun answer(item: String, choice: String, slot: Int): PendingIntent? = TailzuQuick.answer(context, item, choice, code(slot))

  // ---- faces

  private val faces = HashMap<String, Face>()

  /** The designs and the art channel this phone holds, for the bots' stills. Null below API 31 and before the first sync. */
  private val looks = NLookStore.index(context)

  /**
   * THE BOT WHOSE CARD THIS IS, in the one order every card follows (X0Faces): its own dotted still, else its own
   * downloaded face, else a built-in bot's bundled head, else a disc in its colour with its initial. Never Blip and never
   * the app's mark — those belong to the quiet state and the launcher, where there is no card.
   */
  fun face(slug: String?, key: String?, name: String): Face {
    val k = key?.let { X0Doc.face(it) }
    // A bot at work is drawn working; anything else is drawn at rest. The moment is the bot's own, not the widget's case,
    // so a crew row and the lead can show the same bot doing the same thing.
    val moment = if (doc?.bot(slug)?.working == true) "work" else "rest"
    val cacheKey = "${k ?: ""}|${slug ?: ""}|$name|$moment"
    faces[cacheKey]?.let { return it }
    val made = X0Faces.still(context, looks, slug, moment)?.let { Face.Bmp(it) }
      ?: X0Faces.face(context, k)?.let { Face.Bmp(it) }
      ?: k?.let { bundled(it) }
      ?: slug?.let { X0Doc.face(it) }?.let { bundled(it) }
      ?: Face.Bmp(X0Faces.disc(botInk(slug).light, name))
    faces[cacheKey] = made
    return made
  }

  /** A built-in bot's own head, shipped in the build. Keyed by that bot's face or slug, so it is never another bot's. */
  private fun bundled(key: String): Face? {
    @Suppress("DiscouragedApi")
    val id = context.resources.getIdentifier("tailzu_x0_head_" + key.replace('-', '_'), "drawable", context.packageName)
    return if (id != 0) Face.Res(id) else null
  }

  // ---- measuring

  private val pillPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    textSize = 13f * density
  }

  /** How wide a capsule with these words is, in dp, with its 6dp gap after it. */
  fun pillDp(label: String): Float = pillPaint.measureText(label) / density + 32f + 6f

  /** How wide quiet words (You decide) are, in dp. */
  fun quietDp(label: String): Float = pillPaint.measureText(label) / density + 8f

  private val stagePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    textSize = STAGE_DP * density
  }

  /**
   * The size a stage's name is set in to fit its share of the bar whole: 11dp, and a long name ("Understand" on the 4x4's card)
   * a little smaller, never under 9dp, rather than cut.
   */
  fun stageDp(name: String, current: Boolean, room: Float): Float {
    stagePaint.isFakeBoldText = current
    val wide = stagePaint.measureText(name) / density
    return if (wide <= room || wide <= 0f) STAGE_DP else max(9f, STAGE_DP * room / wide)
  }

  companion object {
    /** The stages' names: never smaller unless a name would not fit. */
    const val STAGE_DP = 11f
  }
}

// ====================================================================================================== setting views safely

/**
 * One layout's RemoteViews, set only where the layout has the view: a set on a view a layout lacks fails the whole widget, and
 * the twelve layouts each have only what their case and size show. Which ids a layout has is read once, by inflating it here.
 */
internal class Views(context: Context, layout: Int, private val night: Boolean) {
  val rv = RemoteViews(context.packageName, layout)
  private val ids: Set<Int>? = LayoutIds.of(context, layout)

  fun has(id: Int): Boolean = ids == null || id in ids

  fun visible(id: Int, on: Boolean) {
    if (has(id)) rv.setViewVisibility(id, if (on) View.VISIBLE else View.GONE)
  }

  /** Kept in the layout but not drawn (a tile's place in its row). */
  fun invisible(id: Int) {
    if (has(id)) rv.setViewVisibility(id, View.INVISIBLE)
  }

  /** Words in a colour; no words, no view. Whether it shows. */
  fun text(id: Int, s: CharSequence?, ink: Ink): Boolean {
    if (!has(id)) return false
    val t = s ?: ""
    rv.setTextViewText(id, t)
    WidgetInk.text(rv, id, ink, night)
    rv.setViewVisibility(id, if (t.isEmpty()) View.GONE else View.VISIBLE)
    return t.isNotEmpty()
  }

  fun lines(id: Int, n: Int) {
    if (has(id)) rv.setInt(id, "setMaxLines", max(1, n))
  }

  /** Words' size, in dp. */
  fun size(id: Int, dp: Float) {
    if (has(id)) rv.setTextViewTextSize(id, TypedValue.COMPLEX_UNIT_DIP, dp)
  }

  fun tint(id: Int, ink: Ink) {
    if (has(id)) WidgetInk.image(rv, id, ink, night)
  }

  fun face(id: Int, f: Face) {
    if (!has(id)) return
    when (f) {
      is Face.Res -> rv.setImageViewResource(id, f.id)
      is Face.Bmp -> rv.setImageViewBitmap(id, f.bitmap)
    }
    rv.setViewVisibility(id, View.VISIBLE)
  }

  /** A picture drawn for each theme: both on Android 12+ (the launcher shows the one matching), the one showing before. */
  fun picture(id: Int, light: Bitmap, dark: Bitmap) {
    if (!has(id)) return
    if (Build.VERSION.SDK_INT >= 31) rv.setIcon(id, "setImageIcon", Icon.createWithBitmap(light), Icon.createWithBitmap(dark))
    else rv.setImageViewBitmap(id, if (night) dark else light)
  }

  fun click(id: Int, tap: PendingIntent?) {
    if (tap != null && has(id)) rv.setOnClickPendingIntent(id, tap)
  }
}

/** The view ids in each layout, read once by inflating it in this process. Null when it could not be read (then every set runs). */
internal object LayoutIds {
  private val known = HashMap<Int, Set<Int>>()

  @Synchronized
  fun of(context: Context, layout: Int): Set<Int>? {
    known[layout]?.let { return it }
    return try {
      val out = HashSet<Int>()
      walk(LayoutInflater.from(context.applicationContext ?: context).inflate(layout, null, false), out)
      known[layout] = out
      out
    } catch (_: Throwable) {
      null
    }
  }

  private fun walk(v: View, out: MutableSet<Int>) {
    if (v.id != View.NO_ID) out.add(v.id)
    if (v is ViewGroup) for (i in 0 until v.childCount) walk(v.getChildAt(i), out)
  }
}

// ====================================================================================================== the stage bar

/**
 * The goal gradient: one capsule per stage, the done ones in the bot's colour, the current one filling (its colour striped over
 * itself at 60%), the rest the track's grey; 3dp apart. Drawn at the bar's own width so the stripes keep their angle.
 */
internal object X0Bar {
  fun draw(wDp: Float, hDp: Float, density: Float, stage: Int, of: Int, color: Int, track: Int): Bitmap {
    val scale = min(density, 1600f / max(1f, wDp))
    val b = Bitmap.createBitmap(max(1, (wDp * scale).roundToInt()), max(1, (hDp * scale).roundToInt()), Bitmap.Config.ARGB_8888)
    val c = Canvas(b)
    c.scale(b.width / wDp, b.height / hDp)
    val n = of.coerceIn(1, 12)
    val gap = 3f
    val seg = (wDp - gap * (n - 1)) / n
    if (seg <= 0f) return b
    val r = hDp / 2f
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    for (i in 0 until n) {
      val left = i * (seg + gap)
      val box = RectF(left, 0f, left + seg, hDp)
      when {
        i < stage - 1 -> {
          paint.color = color
          c.drawRoundRect(box, r, r, paint)
        }
        i == stage - 1 -> {
          paint.color = (color and 0x00FFFFFF) or (0x99 shl 24)
          c.drawRoundRect(box, r, r, paint)
          c.save()
          c.clipPath(Path().apply { addRoundRect(box, r, r, Path.Direction.CW) })
          // repeating-linear-gradient(-45deg, colour 0 4px, colour at 60% 4px 7px): stripes rising to the right.
          paint.color = color
          paint.strokeWidth = 4f
          paint.style = Paint.Style.STROKE
          val step = 7f * sqrt(2f)
          var x = left - hDp - step
          while (x < left + seg + hDp) {
            c.drawLine(x, hDp + 1f, x + hDp + 2f, -1f, paint)
            x += step
          }
          paint.style = Paint.Style.FILL
          c.restore()
        }
        else -> {
          paint.color = track
          c.drawRoundRect(box, r, r, paint)
        }
      }
    }
    return b
  }
}

// ====================================================================================================== filling a layout

/** One size of one case, filled from the glance. */
internal class X0Fill(private val c: X0Ctx, private val v: Views, private val size: SizeDp, private val cls: Int) {
  private val doc = c.doc
  private val inner = size.w - 32f

  private object Slot {
    const val ROOT = 0
    const val HEAD = 1
    const val CARD = 2
    const val PILL = 3 // 3, 4, 5
    const val DECIDE = 6
    const val ASK = 7
    const val KEY = 8
    const val TILE = 9 // 9 to 12
    const val CREW = 13
    const val PR = 14
  }

  fun fill(case: String) {
    v.tint(R.id.tailzu_x0_ground, c.ground)
    when (case) {
      "needs" -> needs()
      "working" -> working()
      "done" -> done()
      else -> quiet()
    }
    if (cls == TailzuX0.LARGE) {
      hello()
      tiles(case)
      ask()
    }
  }

  // ------------------------------------------------------------------ shared blocks

  private fun lowerFirst(s: String) = s.replaceFirstChar { it.lowercase(Locale.getDefault()) }

  private fun hello() {
    val d = doc
    v.text(R.id.tailzu_x0_hello, d?.hello, c.meta)
    val weekOn = d != null && (d.weekLine.isNotEmpty() || d.weekDots > 0)
    v.visible(R.id.tailzu_x0_week, weekOn)
    if (!weekOn) return
    val beads = intArrayOf(R.id.tailzu_x0_bead0, R.id.tailzu_x0_bead1, R.id.tailzu_x0_bead2, R.id.tailzu_x0_bead3, R.id.tailzu_x0_bead4)
    beads.forEachIndexed { i, id ->
      v.visible(id, i < d!!.weekDots)
      if (i < d.weekDots) v.tint(id, c.ink)
    }
    v.tint(R.id.tailzu_x0_bead_open, c.hollow)
    v.text(R.id.tailzu_x0_week_text, d!!.weekLine, c.meta)
  }

  private fun ask() {
    v.tint(R.id.tailzu_x0_ask_bg, c.surface)
    v.tint(R.id.tailzu_x0_ask_ring, c.line)
    v.text(R.id.tailzu_x0_ask_text, c.word("ask", R.string.tailzu_x0_ask), c.meta)
    v.click(R.id.tailzu_x0_ask, c.open(doc?.ask?.ifEmpty { null } ?: ASK_LINK, Slot.ASK))
    v.click(R.id.tailzu_x0_ask_key, c.open(doc?.mic?.ifEmpty { null } ?: doc?.ask?.ifEmpty { null } ?: ASK_LINK, Slot.KEY))
  }

  /** A face view for a bot. */
  private fun face(id: Int, slug: String?, key: String?, name: String) = v.face(id, c.face(slug, key, name))

  /** A pill: its words, filled (primary) or ringed (secondary), and its tap. */
  private fun pill(n: Int, label: String, primary: Boolean, tap: PendingIntent?) {
    val ids = PILLS[n]
    v.text(ids[3], label, if (primary) c.ground else c.ink)
    v.tint(ids[1], if (primary) c.ink else c.clear)
    v.tint(ids[2], if (primary) c.clear else c.outline)
    v.click(ids[0], tap)
    v.visible(ids[0], true)
  }

  /** The others at work beside the lead: their faces (at work first) and what the first is doing; else the situation line. */
  private fun crew(lead: String?) {
    val d = doc ?: return
    val others = d.bots.filter { it.slug != lead }
    val working = others.filter { it.working }
    val seats = intArrayOf(R.id.tailzu_x0_crew0, R.id.tailzu_x0_crew1, R.id.tailzu_x0_crew2)
    val discs = intArrayOf(R.id.tailzu_x0_crew0_disc, R.id.tailzu_x0_crew1_disc, R.id.tailzu_x0_crew2_disc)
    val faces = intArrayOf(R.id.tailzu_x0_crew0_face, R.id.tailzu_x0_crew1_face, R.id.tailzu_x0_crew2_face)
    if (working.isEmpty() || size.h < 150f) {
      v.visible(R.id.tailzu_x0_crew, false)
      v.text(R.id.tailzu_x0_summary, if (size.h < 150f) "" else d.summary, c.meta)
      return
    }
    v.visible(R.id.tailzu_x0_crew, true)
    v.visible(R.id.tailzu_x0_summary, false)
    val shown = (working + others.filter { !it.working }).take(3)
    for (i in 0 until 3) {
      val b = shown.getOrNull(i)
      v.visible(seats[i], b != null)
      if (b == null) continue
      v.tint(discs[i], c.ground)
      face(faces[i], b.slug, b.face, b.name)
    }
    val first = working.first()
    v.text(R.id.tailzu_x0_crew_name, first.name, c.ink)
    v.text(R.id.tailzu_x0_crew_line, first.line, c.botInk(first.slug))
    v.click(R.id.tailzu_x0_crew, c.open(first.link, Slot.CREW))
  }

  /** The check: an ink disc with the ground's tick. */
  private fun check() {
    v.visible(R.id.tailzu_x0_check, true)
    v.tint(R.id.tailzu_x0_check_disc, c.ink)
    v.tint(R.id.tailzu_x0_check_mark, c.ground)
  }

  /** Minutes since a moment, or null without one. */
  private fun minutes(since: Long): Int? = if (since <= 0L) null else max(0L, (c.now - since) / 60_000L).toInt()

  private fun fmt(template: String, vararg pairs: Pair<String, Any>): String =
    pairs.fold(template) { s, (k, value) -> s.replace("{$k}", value.toString()) }

  // ------------------------------------------------------------------ needs

  private fun needs() {
    val d = doc ?: return quiet()
    val item = d.items.firstOrNull()
    val slug = item?.bot?.ifEmpty { null }
    val bot = d.bot(slug)
    val name = item?.botName?.ifEmpty { null } ?: bot?.name ?: ""
    val needsYou = c.word("needsYou", R.string.tailzu_x0_needs_you)
    val link = item?.link?.ifEmpty { null } ?: item?.decideLink?.ifEmpty { null } ?: bot?.link ?: d.home

    // The disc's initial is the ASKING BOT'S, never X0's: a bot the glance has no row for (it keeps eight) has no name
    // here, and "X0" would put X0's own letter on another bot's card. No bot at all leaves the disc plain.
    face(R.id.tailzu_x0_face, slug, item?.face ?: bot?.face, name.ifEmpty { slug ?: "" })
    v.text(R.id.tailzu_x0_name, name.ifEmpty { needsYou }, c.ink)
    v.tint(R.id.tailzu_x0_dot, c.ink)
    v.text(R.id.tailzu_x0_status, lowerFirst(needsYou), c.meta)
    v.text(R.id.tailzu_x0_label, (if (name.isEmpty()) needsYou else "$needsYou · $name").uppercase(Locale.getDefault()), c.ink)
    v.text(R.id.tailzu_x0_question, item?.question?.ifEmpty { null } ?: d.lockLine.ifEmpty { d.lockTitle }, c.ink)
    v.click(android.R.id.background, c.open(link, Slot.ROOT))
    v.click(R.id.tailzu_x0_head, c.open(link, Slot.HEAD))
    v.click(R.id.tailzu_x0_card, c.open(link, Slot.CARD))

    // What the bot is doing besides asking (4x2): its line in its colour under its face.
    val doing = bot?.takeIf { it.working && it.line.isNotEmpty() }
    v.visible(R.id.tailzu_x0_lead, doing != null)
    if (doing != null) {
      v.tint(R.id.tailzu_x0_lead_dot, c.botInk(doing.slug))
      v.text(R.id.tailzu_x0_lead_text, doing.line, c.botInk(doing.slug))
    }

    val choices = item?.choices.orEmpty()
    val answers = if (cls == TailzuX0.SMALL) min(choices.size, 2) else choices.size
    v.lines(R.id.tailzu_x0_question, when (cls) {
      TailzuX0.SMALL -> floor((size.h - 80f - (if (answers > 1) 74f else 34f)) / 18f).toInt().coerceIn(1, 3)
      TailzuX0.MEDIUM -> floor((size.h - 85f) / 20f).toInt().coerceIn(1, 3)
      else -> if (size.h < 420f) 2 else 3
    })

    // How an answer pressed here went, until the next glance; else the answers.
    val state = item?.let { c.states[it.id] }
    if (item != null && !state.isNullOrEmpty()) {
      val line = when (state) {
        "working" -> c.word("sending", R.string.tailzu_x0_sending)
        "done" -> c.word("done", R.string.tailzu_x0_done)
        "gone" -> c.word("gone", R.string.tailzu_x0_gone)
        else -> c.word("failed", R.string.tailzu_x0_failed)
      }
      v.text(R.id.tailzu_x0_state, line, if (state == "done") c.ink else c.meta)
      v.visible(R.id.tailzu_x0_pills, false)
      for (p in PILLS) v.visible(p[0], false)
      return
    }
    v.visible(R.id.tailzu_x0_state, false)
    if (item == null) {
      for (p in PILLS) v.visible(p[0], false)
      v.visible(R.id.tailzu_x0_pills, false)
      return
    }

    val decide = c.word("youDecide", R.string.tailzu_x0_you_decide)
    val decideLink = item.decideLink.ifEmpty { item.link }
    val primary = choices.indexOfFirst { it.primary }.let { if (it < 0) 0 else it }
    val room = when (cls) {
      TailzuX0.MEDIUM -> inner - 64f - 12f
      TailzuX0.LARGE -> inner - 30f
      else -> Float.MAX_VALUE
    }
    var used = 0f
    var shown = 0
    for ((i, ch) in choices.withIndex()) {
      if (shown >= (if (cls == TailzuX0.SMALL) 2 else 3)) break
      val w = c.pillDp(ch.label)
      if (shown > 0 && used + w > room) break
      val tap = if (item.answerable && c.canAnswer) c.answer(item.id, ch.id, Slot.PILL + shown) else c.open(decideLink, Slot.PILL + shown)
      pill(shown, ch.label, i == primary, tap)
      used += w
      shown++
    }
    if (shown == 0 && cls == TailzuX0.SMALL) {
      // Nothing to answer with here: the one button opens it.
      pill(0, decide, true, c.open(decideLink, Slot.DECIDE))
      shown = 1
    }
    for (n in shown until PILLS.size) v.visible(PILLS[n][0], false)
    val decideOn = cls != TailzuX0.SMALL && decideLink.isNotEmpty() && (shown == 0 || used + c.quietDp(decide) <= room)
    if (decideOn) {
      v.text(R.id.tailzu_x0_decide, decide, c.meta)
      v.click(R.id.tailzu_x0_decide, c.open(decideLink, Slot.DECIDE))
    } else {
      v.visible(R.id.tailzu_x0_decide, false)
    }
    v.visible(R.id.tailzu_x0_pills, shown > 0 || decideOn)
  }

  // ------------------------------------------------------------------ working

  private fun working() {
    val d = doc ?: return quiet()
    val job = d.job
    val slug = job?.bot?.ifEmpty { null } ?: d.bots.firstOrNull { it.working }?.slug
    val bot = d.bot(slug)
    val name = bot?.name ?: slug ?: ""
    val tone = c.botInk(slug)
    val link = job?.link?.ifEmpty { null } ?: bot?.link
    v.click(android.R.id.background, c.open(link, Slot.ROOT))
    v.click(R.id.tailzu_x0_card, c.open(link, Slot.CARD))
    face(R.id.tailzu_x0_face, slug, bot?.face, name)

    val title = job?.task?.ifEmpty { null } ?: bot?.line?.replaceFirstChar { it.titlecase(Locale.getDefault()) } ?: name
    v.text(R.id.tailzu_x0_title, title, c.ink)
    if (cls == TailzuX0.SMALL) v.lines(R.id.tailzu_x0_title, if (size.h < 170f) 1 else 2)

    if (job == null) {
      v.text(R.id.tailzu_x0_sub, if (title == name) "" else name, c.meta)
      v.visible(R.id.tailzu_x0_count, false)
      v.visible(R.id.tailzu_x0_chip, false)
      v.visible(R.id.tailzu_x0_track, false)
      v.visible(R.id.tailzu_x0_steps, false)
    } else {
      val step = fmt(c.word("step", R.string.tailzu_x0_step), "stage" to job.stage, "of" to job.of)
      val stage = job.stageName.ifEmpty { job.stages.getOrNull(job.stage - 1) ?: "" }
      val sub = when {
        stage.isEmpty() -> if (cls == TailzuX0.MEDIUM) "$name · $step" else name
        cls == TailzuX0.MEDIUM -> "$name · $stage, ${lowerFirst(step)}"
        else -> "$name · $stage"
      }
      v.text(R.id.tailzu_x0_sub, sub, c.meta)
      v.text(R.id.tailzu_x0_count, "${job.stage}/${job.of}", tone)

      val mins = minutes(job.startedAt)
      if (mins != null && v.has(R.id.tailzu_x0_chip)) {
        v.visible(R.id.tailzu_x0_chip, true)
        v.tint(R.id.tailzu_x0_chip_bg, c.surface)
        v.text(R.id.tailzu_x0_chip_text, fmt(c.word("min", R.string.tailzu_x0_min), "n" to mins), tone)
      } else {
        v.visible(R.id.tailzu_x0_chip, false)
      }
      v.text(R.id.tailzu_x0_step, step, c.ink)
      v.text(R.id.tailzu_x0_minin, if (mins == null) "" else " · " + fmt(c.word("minIn", R.string.tailzu_x0_min_in), "n" to mins), c.meta)
      v.visible(R.id.tailzu_x0_steps, true)
      bar(job, tone)
    }

    if (cls == TailzuX0.SMALL) {
      val others = d.bots.filter { it.working && it.slug != slug }
      val count = max(others.size, d.bots.count { it.working }.let { if (it > 0) it - 1 else 0 })
      if (others.isEmpty() || size.h < 150f) {
        v.visible(R.id.tailzu_x0_more, false)
      } else {
        v.visible(R.id.tailzu_x0_more, true)
        val first = others.first()
        face(R.id.tailzu_x0_more_face, first.slug, first.face, first.name)
        v.text(R.id.tailzu_x0_more_text, fmt(c.word("working", R.string.tailzu_x0_working), "n" to "+$count"), c.meta)
      }
    } else if (cls == TailzuX0.MEDIUM) {
      crew(slug)
    }
  }

  /** The stage bar at its width, both themes, and the stages' names under it where they fit. */
  private fun bar(job: X0Doc.Job, tone: Ink) {
    if (!v.has(R.id.tailzu_x0_bar)) return
    v.visible(R.id.tailzu_x0_track, true)
    val width = if (cls == TailzuX0.LARGE) inner - 30f else inner
    val height = if (cls == TailzuX0.MEDIUM) 8f else 6f
    v.picture(
      R.id.tailzu_x0_bar,
      X0Bar.draw(width, height, c.density, job.stage, job.of, tone.light, c.line.light),
      X0Bar.draw(width, height, c.density, job.stage, job.of, tone.dark, c.line.dark),
    )
    val labels = intArrayOf(
      R.id.tailzu_x0_stage0, R.id.tailzu_x0_stage1, R.id.tailzu_x0_stage2,
      R.id.tailzu_x0_stage3, R.id.tailzu_x0_stage4, R.id.tailzu_x0_stage5,
    )
    val named = job.stages.size == job.of && job.of <= labels.size && !(cls == TailzuX0.MEDIUM && size.h < 140f)
    v.visible(R.id.tailzu_x0_stages, named)
    if (!named) return
    val room = (width - 3f * (job.of - 1)) / job.of
    labels.forEachIndexed { i, id ->
      if (i >= job.of) {
        v.visible(id, false)
        return@forEachIndexed
      }
      val current = i == job.stage - 1
      v.size(id, c.stageDp(job.stages[i], current, room))
      val words: CharSequence = if (current) {
        SpannableString(job.stages[i]).apply { setSpan(StyleSpan(Typeface.BOLD), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) }
      } else {
        job.stages[i]
      }
      v.text(id, words, if (current) c.ink else if (i < job.stage - 1) c.meta else c.dim)
    }
  }

  // ------------------------------------------------------------------ done

  private fun done() {
    val d = doc ?: return quiet()
    val last = d.done ?: return quiet()
    val slug = last.bot.ifEmpty { null }
    val bot = d.bot(slug)
    val name = last.botName.ifEmpty { bot?.name ?: "" }
    v.click(android.R.id.background, c.open(last.link, Slot.ROOT))
    v.click(R.id.tailzu_x0_card, c.open(last.link, Slot.CARD))
    // The disc's initial is the FINISHING BOT'S, never X0's (see needs): its slug's letter when the glance has no row.
    face(R.id.tailzu_x0_face, slug, bot?.face, name.ifEmpty { slug ?: "" })
    check()
    v.text(R.id.tailzu_x0_title, last.result.ifEmpty { c.word("done", R.string.tailzu_x0_done) }, c.ink)
    if (cls == TailzuX0.SMALL) v.lines(R.id.tailzu_x0_title, floor((size.h - 147f) / 19f).toInt().coerceIn(1, 3))
    val parts = listOfNotNull(
      name.ifEmpty { null },
      last.minutes.takeIf { it > 0 }?.let { fmt(c.word("min", R.string.tailzu_x0_min), "n" to it) },
      last.prNumber.takeIf { it > 0 && cls != TailzuX0.SMALL }?.let { fmt(c.word("pr", R.string.tailzu_x0_pr), "n" to it) },
    )
    v.text(R.id.tailzu_x0_sub, parts.joinToString(" · "), c.meta)
    val pr = if (last.prUrl.isNotEmpty()) c.openPr(last.prUrl, Slot.PR) else null
    if (pr != null) pill(0, c.word("seePr", R.string.tailzu_x0_see_pr), true, pr)
    else v.visible(R.id.tailzu_x0_p0, false)
    if (cls == TailzuX0.MEDIUM) crew(slug)
  }

  // ------------------------------------------------------------------ quiet

  private fun quiet() {
    val d = doc
    v.click(android.R.id.background, c.open(d?.home, Slot.ROOT))
    if (cls != TailzuX0.LARGE) v.text(R.id.tailzu_x0_hello, d?.hello, c.meta)
    val line = d?.line?.ifEmpty { null } ?: d?.summary?.ifEmpty { null } ?: c.context.getString(R.string.tailzu_x0_empty)
    v.text(R.id.tailzu_x0_line, line, c.ink)
    when (cls) {
      TailzuX0.SMALL -> {
        // Blip and the key take the top; the words what is left.
        val room = size.h - 32f - 52f - (if (d?.hello.isNullOrEmpty()) 0f else 16f)
        v.lines(R.id.tailzu_x0_line, floor(room / 20f).toInt().coerceIn(1, 3))
        v.click(R.id.tailzu_x0_ask_key, c.open(d?.ask?.ifEmpty { null } ?: ASK_LINK, Slot.KEY))
      }
      TailzuX0.MEDIUM -> {
        val room = size.h - 32f - 44f - 8f
        if (room < 18f + 4f + 25f) v.visible(R.id.tailzu_x0_hello, false)
        v.lines(R.id.tailzu_x0_line, if (room >= 18f + 4f + 50f) 2 else 1)
        ask()
      }
    }
  }

  // ------------------------------------------------------------------ the tiles (4x4)

  private fun tiles(case: String) {
    val d = doc
    // What the rest of the 4x4 takes (the hello, the card or the big line, Ask, the gaps), so the tiles get what is left.
    val base = when (case) {
      "needs" -> 278f
      "working" -> 279f
      "done" -> 264f
      else -> 233f
    }
    val rows = when {
      d == null || d.bots.isEmpty() -> 0
      size.h >= base + 136f && d.bots.size > 2 -> 2
      size.h >= base + 64f -> 1
      else -> 0
    }
    v.visible(R.id.tailzu_x0_tiles, rows > 0)
    if (rows == 0 || d == null) return
    v.visible(R.id.tailzu_x0_tiles_row2, rows == 2)
    for (i in 0 until 4) {
      val t = TILES[i]
      val b = d.bots.getOrNull(i)?.takeIf { i < rows * 2 }
      if (b == null) {
        v.invisible(t[0])
        continue
      }
      v.visible(t[0], true)
      v.tint(t[1], c.surface)
      face(t[2], b.slug, b.face, b.name)
      v.text(t[3], b.name, c.ink)
      val tone = c.botInk(b.slug)
      when {
        b.state == "needs" || b.needs > 0 -> {
          v.visible(t[4], true)
          v.tint(t[4], c.ink)
          v.text(t[5], lowerFirst(c.word("needsYou", R.string.tailzu_x0_needs_you)), c.ink)
        }
        b.working -> {
          v.visible(t[4], true)
          v.tint(t[4], tone)
          v.text(t[5], b.line.ifEmpty { fmt(c.word("working", R.string.tailzu_x0_working), "n" to 1) }, tone)
        }
        else -> {
          v.visible(t[4], false)
          v.text(t[5], b.line.ifEmpty { c.word("ready", R.string.tailzu_x0_ready) }, c.meta)
        }
      }
      v.click(t[0], c.open(b.link, Slot.TILE + i))
    }
  }

  companion object {
    private const val ASK_LINK = "tulmi://screen/bots.ask"

    /** Each pill: its frame, fill, ring, words. */
    private val PILLS = arrayOf(
      intArrayOf(R.id.tailzu_x0_p0, R.id.tailzu_x0_p0_bg, R.id.tailzu_x0_p0_ring, R.id.tailzu_x0_p0_text),
      intArrayOf(R.id.tailzu_x0_p1, R.id.tailzu_x0_p1_bg, R.id.tailzu_x0_p1_ring, R.id.tailzu_x0_p1_text),
      intArrayOf(R.id.tailzu_x0_p2, R.id.tailzu_x0_p2_bg, R.id.tailzu_x0_p2_ring, R.id.tailzu_x0_p2_text),
    )

    /** Each tile: its frame, ground, face, name, mark, line. */
    private val TILES = arrayOf(
      intArrayOf(R.id.tailzu_x0_tile0, R.id.tailzu_x0_tile0_bg, R.id.tailzu_x0_tile0_face, R.id.tailzu_x0_tile0_name, R.id.tailzu_x0_tile0_dot, R.id.tailzu_x0_tile0_line),
      intArrayOf(R.id.tailzu_x0_tile1, R.id.tailzu_x0_tile1_bg, R.id.tailzu_x0_tile1_face, R.id.tailzu_x0_tile1_name, R.id.tailzu_x0_tile1_dot, R.id.tailzu_x0_tile1_line),
      intArrayOf(R.id.tailzu_x0_tile2, R.id.tailzu_x0_tile2_bg, R.id.tailzu_x0_tile2_face, R.id.tailzu_x0_tile2_name, R.id.tailzu_x0_tile2_dot, R.id.tailzu_x0_tile2_line),
      intArrayOf(R.id.tailzu_x0_tile3, R.id.tailzu_x0_tile3_bg, R.id.tailzu_x0_tile3_face, R.id.tailzu_x0_tile3_name, R.id.tailzu_x0_tile3_dot, R.id.tailzu_x0_tile3_line),
    )
  }
}
