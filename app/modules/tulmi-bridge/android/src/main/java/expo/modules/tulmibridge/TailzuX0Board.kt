package expo.modules.tulmibridge

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.RemoteViews
import android.widget.ScrollView
import android.widget.TextView

/**
 * "X0 BOARD": a second home-screen widget whose contents the person chooses.
 *
 * X0 itself always leads with what matters now. A board does not: it shows the one thing its owner picked, and a NEW board
 * ("Plan today", "This week") later becomes a design in the catalog rather than another store release. That is the whole
 * reason this kind exists, and it is why one spare kind is worth shipping while a dozen named ones are not.
 *
 * THREE THINGS THIS KIND HAS TO GET RIGHT, because a shipped widget kind can NEVER be removed from a store build:
 *
 *   It is never empty.      The catalog bundles board.base, so the gallery entry draws something real at review and on
 *                           first run (App Review 2.3.1), before any sync and before any sign-in. With no catalog at all
 *                           it draws X0's own hand-written view, which needs nothing but the glance.
 *   Placing it asks nothing. widgetFeatures is reconfigurable|configuration_optional, so dropping it on the home screen
 *                           draws the default board at once; "Choose a board" is there for whoever wants it, not a gate.
 *   Its words stay true.    The gallery line promises only what the default always draws (what needs you, who is working),
 *                           and the catalog may add boards without the line ever becoming a lie.
 */
class TailzuX0BoardWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    TailzuX0Board.drawAll(context, appWidgetManager, appWidgetIds)
  }

  override fun onAppWidgetOptionsChanged(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int, newOptions: Bundle?) {
    TailzuX0Board.drawAll(context, appWidgetManager, intArrayOf(appWidgetId))
  }

  /**
   * A board's draw goes off the main thread, on the same serial queue X0's does: a board is a design and nothing else,
   * so every one of its draws can paint bitmaps. Anything that is not a draw stays inline.
   */
  override fun onReceive(context: Context, intent: Intent) {
    val app = context.applicationContext ?: context
    val ids = TailzuWork.widgetIds(intent)
    val manager = if (ids == null) null else AppWidgetManager.getInstance(app)
    if (ids != null && manager != null) {
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

  /** A board taken off the home screen takes its pick with it. */
  override fun onDeleted(context: Context, appWidgetIds: IntArray) {
    TailzuX0Board.forget(context, appWidgetIds)
  }
}

object TailzuX0Board {
  /** The compiled default: the board a placed widget shows until someone picks another. Always in the catalog. */
  internal const val DEFAULT = "board.base"

  /** Which board each placed widget shows, by widget id, in the widgets' own prefs. */
  private const val PICK = "board.pick."

  fun requestUpdate(context: Context) = TailzuQuick.requestUpdate(context, TailzuX0BoardWidget::class.java)

  internal fun drawAll(context: Context, manager: AppWidgetManager? = null, only: IntArray? = null) {
    try {
      val widgets = manager ?: AppWidgetManager.getInstance(context) ?: return
      val ids = only ?: widgets.getAppWidgetIds(ComponentName(context, TailzuX0BoardWidget::class.java)) ?: return
      if (ids.isEmpty()) return
      val now = System.currentTimeMillis()
      val doc = X0Doc.load(context, now)
      // A Board has no alarm of its own: it rides X0's tick. On a phone where only a Board is placed, this is the one
      // call that ever arms it, so it is made whether or not an X0 exists.
      TailzuX0.arm(context, widgets, doc, now)
      for (id in ids) draw(context, widgets, doc, id)
    } catch (_: Throwable) {
      // A widget never stops the app.
    }
  }

  /**
   * One board handed to the launcher, with the same two fallbacks X0 has (SPEC §3.7): a board the host refuses takes a
   * strike and is redrawn as X0's own view, and only if THAT is refused too does the plain layout go up.
   */
  private fun draw(context: Context, widgets: AppWidgetManager, doc: X0Doc?, id: Int) {
    var design = ""
    try {
      val made = views(context, doc, widgets.getAppWidgetOptions(id), id)
      design = made.second
      widgets.updateAppWidget(id, made.first)
      return
    } catch (_: Throwable) {
    }
    try {
      if (design.isNotEmpty()) {
        NLookStore.strike(context, design)
        widgets.updateAppWidget(id, TailzuX0.drawn(context, doc, widgets.getAppWidgetOptions(id), id, false).views)
        return
      }
    } catch (_: Throwable) {
    }
    try {
      widgets.updateAppWidget(id, RemoteViews(context.packageName, R.layout.tailzu_x0_medium_quiet))
    } catch (_: Throwable) {
    }
  }

  private fun views(context: Context, doc: X0Doc?, options: Bundle?, id: Int): Pair<RemoteViews, String> {
    val c = X0Ctx(context, doc, id)
    if (Build.VERSION.SDK_INT >= NLookLimits.MIN_SDK) {
      val sizes = TailzuX0.listedSizes(options)
      NLookRemote.widget(c, sizes, "board", pick(context, id, doc))?.let { return Pair(it.views, it.design) }
    }
    // No catalog, no board, or anything at all wrong with one: X0's own view, which needs only the glance.
    return Pair(TailzuX0.views(context, doc, options, id), "")
  }

  /** The board this widget shows: the person's pick, else whatever the server named, else the bundled default. */
  internal fun pick(context: Context, id: Int, doc: X0Doc?): String = try {
    TailzuQuick.prefs(context).getString(PICK + id, null)?.takeIf { it.isNotEmpty() }
      ?: doc?.look("board")
      ?: DEFAULT
  } catch (_: Throwable) {
    DEFAULT
  }

  /**
   * Remember the board this widget was given. "Overview" is the DEFAULT, not a design id: picking it REMOVES the pick, so
   * the board follows `look.board` again if the server ever names one. Storing `board.base` would pin it for good, and the
   * person would have no way back (H19, "also found" C).
   */
  internal fun choose(context: Context, id: Int, design: String) {
    try {
      val prefs = TailzuQuick.prefs(context).edit()
      if (design == DEFAULT) prefs.remove(PICK + id) else prefs.putString(PICK + id, design)
      prefs.apply()
    } catch (_: Throwable) {
    }
  }

  internal fun forget(context: Context, ids: IntArray) {
    try {
      val e = TailzuQuick.prefs(context).edit()
      for (id in ids) e.remove(PICK + id)
      e.apply()
    } catch (_: Throwable) {
    }
  }

  /**
   * The boards there are to choose from: the compiled default first, then whatever the GLANCE lists. The names are the
   * server's, in this person's language, and the list is data — so a new board is a catalog change and never a build.
   *
   * Names never come from ids. "board.night" tidied into "night" tells a person nothing about what they would be
   * placing, and a design carries no gallery words of its own in format 1. A board the server has no name for in this
   * language is simply not offered, on both platforms.
   */
  internal fun boards(context: Context, doc: X0Doc?): List<Pair<String, String>> {
    val out = ArrayList<Pair<String, String>>()
    out.add(Pair(DEFAULT, context.getString(R.string.tailzu_x0_board_default)))
    try {
      for (board in doc?.boards ?: emptyList()) {
        if (out.size >= 13) break
        out.add(board)
      }
    } catch (_: Throwable) {
    }
    return out
  }
}

/**
 * "Choose a board". A plain list, built in code so it needs no theme of its own and no layout to keep in step with the
 * boards. Placing the widget never opens it (configuration_optional); it is reached from the launcher's reconfigure.
 */
class TailzuX0BoardConfigure : Activity() {
  override fun onCreate(saved: Bundle?) {
    super.onCreate(saved)
    val id = intent?.extras?.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
      ?: AppWidgetManager.INVALID_APPWIDGET_ID
    // Cancelled unless a row is pressed: the launcher removes a widget whose configure screen was dismissed, EXCEPT where
    // the widget is configuration_optional, in which case it keeps the one it already drew. Either way is the right answer.
    setResult(RESULT_CANCELED, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id))
    if (id == AppWidgetManager.INVALID_APPWIDGET_ID) {
      finish()
      return
    }
    setTitle(getString(R.string.tailzu_x0_board_choose))
    val night = WidgetInk.isNight(this)
    val ink = if (night) Color.WHITE else Color.parseColor("#0A0A0A")
    val ground = if (night) Color.parseColor("#0A0A0A") else Color.WHITE

    val list = LinearLayout(this)
    list.orientation = LinearLayout.VERTICAL
    list.setBackgroundColor(ground)
    val pad = dp(16)
    list.setPadding(pad, pad, pad, pad)

    val doc = X0Doc.load(this)
    val chosen = TailzuX0Board.pick(this, id, doc)
    for (board in TailzuX0Board.boards(this, doc)) {
      val row = TextView(this)
      row.text = board.second
      row.setTextColor(ink)
      row.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
      row.gravity = Gravity.CENTER_VERTICAL
      row.setPadding(dp(4), dp(14), dp(4), dp(14))
      if (board.first == chosen) row.alpha = 1f else row.alpha = 0.72f
      row.layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
      row.setOnClickListener { pickAndFinish(id, board.first) }
      list.addView(row)
      val rule = View(this)
      rule.setBackgroundColor(if (night) Color.parseColor("#262626") else Color.parseColor("#E6E6E6"))
      rule.layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1)
      list.addView(rule)
    }

    val scroll = ScrollView(this)
    scroll.setBackgroundColor(ground)
    scroll.addView(list)
    scroll.clipToPadding = false
    // targetSdk 36 means edge to edge: without this the first row sits under the status bar and the cutout, and the last
    // one under the gesture bar. The window's own padding is added to the 16dp the list already has.
    scroll.fitsSystemWindows = true
    scroll.setOnApplyWindowInsetsListener { view, insets ->
      val bars = if (Build.VERSION.SDK_INT >= 30) {
        insets.getInsets(android.view.WindowInsets.Type.systemBars() or android.view.WindowInsets.Type.displayCutout())
      } else {
        null
      }
      if (bars != null) view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      insets
    }
    setContentView(scroll)
  }

  private fun pickAndFinish(id: Int, design: String) {
    TailzuX0Board.choose(this, id, design)
    // The redraw goes on the widgets' own queue: a board can paint several bitmaps, and this is the UI thread of a
    // screen the person is looking at. The screen closes at once; the home screen catches up a moment later.
    val app = applicationContext
    TailzuWork.post { TailzuX0Board.drawAll(app, AppWidgetManager.getInstance(app), intArrayOf(id)) }
    setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id))
    finish()
  }

  private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
}
