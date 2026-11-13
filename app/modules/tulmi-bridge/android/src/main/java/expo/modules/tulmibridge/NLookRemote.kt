package expo.modules.tulmibridge

import android.app.PendingIntent
import android.graphics.drawable.Icon
import android.os.Build
import android.os.SystemClock
import android.util.SizeF
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.RemoteViews
import kotlin.math.roundToInt

/**
 * nlook on Android, part five: A PLAN BECOMES A WIDGET. Fragments are added to one another with addView and every set lands
 * on the child's OWN root (every fragment in the kit carries the same id, @id/nl_root), so no set can ever reach into a
 * parent or a sibling.
 *
 * WHAT THIS FILE PROMISES THE PERSON. It decides nothing. If anything at all goes wrong — a layout that is not in the build,
 * a design that does not plan, a bitmap over the budget, an exception from any depth — it returns null, the caller draws
 * today's hand-written X0 views, and the design takes a strike. The launcher's own errors (a tree too deep, a Binder
 * transaction too large) cannot be caught from here at all, which is exactly why NLookPlan counts levels and NLookPaint
 * counts bytes BEFORE anything is attached.
 */
internal object NLookRemote {

  /** PendingIntent slots for nlook's clicks, kept clear of the hand-written fill's (X0Fill.Slot runs 0 upward). */
  private const val SLOT_BASE = 48
  private const val SLOT_COUNT = 16

  private val layouts = HashMap<String, Int>()

  /** A design's views, and which design drew them, so a host that refuses them can strike that design by name. */
  internal class Made(val views: RemoteViews, val design: String)

  /**
   * The whole widget for one kind ("x0" or "board"), or null to fall back to today's views. `sizes` is what the launcher
   * said it may show this widget at; one RemoteViews is planned for each, and the launcher picks the one that fits.
   */
  fun widget(c: X0Ctx, sizes: List<SizeDp>, kind: String, designId0: String? = null): Made? {
    if (Build.VERSION.SDK_INT < NLookLimits.MIN_SDK) return null
    val context = c.context
    var designId: String? = null
    return try {
      val index = NLookStore.index(context) ?: return null
      // A kind whose owner picked a board names it here; X0 takes whatever the glance named, and nothing when it named none.
      val wanted = designId0 ?: c.doc?.look(kind) ?: return null
      val design = NLookStore.chain(context, index, wanted, "widget") ?: return null
      designId = design.id
      val budget = NLookPaint.Budget(context)
      val listed = if (sizes.isEmpty()) listOf(SizeDp(300f, 160f)) else sizes
      // The size map counts as one RemoteViews level in the launcher's own count, so the tree gets one less.
      val levels = NLookLimits.LEVELS - (if (listed.size > 1) 1 else 0)
      val built = ArrayList<Pair<SizeDp, RemoteViews>>()
      for (i in listed.indices) {
        val size = listed[i]
        val family = family(size)
        val root = design.roots[family] ?: return null
        val where = NLookWhere(family, c.night, c.doc?.caseAt(c.now) ?: "quiet", c.canAnswer, size.w, size.h)
        val bind = NLookBind(context, c.doc, index, design.palette, c.night, c.doc?.vars(), c.now)
        val plan = NLookPlanner(bind, where, levels).plan(root) ?: return null
        if (plan.levels > levels || plan.views > NLookLimits.VIEWS_PER_SIZE) return null
        val rv = apply(c, plan.root, budget, i) ?: return null
        tile(c, rv, plan.root)
        built.add(Pair(size, rv))
      }
      if (built.isEmpty()) return null
      val views = if (built.size == 1) built[0].second else RemoteViews(built.associate { SizeF(it.first.w, it.first.h) to it.second })
      Made(views, design.id)
    } catch (_: Throwable) {
      // The provider runs in the app's process: an exception here would take the app down with it on a TICK. It does not.
      designId?.let { NLookStore.strike(context, it) }
      null
    } finally {
      // The painter's identity map exists only so one bitmap object serves every size of THIS RemoteViews. Past here it
      // is just megabytes held in the app's own process.
      NLookPaint.forget()
    }
  }

  /**
   * WHAT THE WHOLE TILE DOES, which no design node can say, and which today's views have always done.
   *
   *   The corners. Today's layouts carry @android:id/background with a `system_app_widget_background_radius` ground, and
   *   that id is how Launcher3 decides what to round. Every kit fragment's root is @id/nl_root instead, so the radius is
   *   asked for here. The fragments already carry clipToOutline, which is what makes a radius actually clip.
   *   The tap. A design's own Buttons cover what they cover; today a tap ANYWHERE else opens the case's link, or home.
   *   Without this an nlook widget did nothing at all when pressed between its words, which no other tile on the home
   *   screen does. It is set FIRST, so any Button inside still wins on its own view.
   */
  private fun tile(c: X0Ctx, rv: RemoteViews, root: NLookPlanNode) {
    // Both are defaults, not overrides: a root that names its own `corner`, or carries its own Button, keeps what the
    // design said. These sets were applied before this runs, so they would otherwise be written over.
    if (root.sets.none { it is NLookSet.Corner }) {
      try {
        rv.setViewOutlinePreferredRadiusDimen(R.id.nl_root, android.R.dimen.system_app_widget_background_radius)
      } catch (_: Throwable) {
      }
    }
    if (root.sets.any { it is NLookSet.Click }) return
    // One slot for every size: they all open the same link, so one PendingIntent serves the whole size map. Slot 0 is
    // the hand-written fill's own root slot (X0Fill.Slot.ROOT), and the two are never on screen at the same time.
    c.open(rootLink(c), 0)?.let { rv.setOnClickPendingIntent(R.id.nl_root, it) }
  }

  /** The link today's root opens for this case: the needs item's, the job's, the finished thing's, else home. */
  private fun rootLink(c: X0Ctx): String? {
    val d = c.doc ?: return null
    val link = when (d.caseAt(c.now)) {
      "needs" -> d.items.firstOrNull()?.let {
        it.link.ifEmpty { null } ?: it.decideLink.ifEmpty { null } ?: d.bot(it.bot)?.link
      }
      "working" -> d.job?.link?.ifEmpty { null } ?: d.bot(d.job?.bot)?.link
      "done" -> d.done?.link?.ifEmpty { null }
      else -> null
    }
    return link?.ifEmpty { null } ?: d.home
  }

  /** 2x2 below 250dp wide, 4x4 from 280dp tall, 4x2 between — the same three the hand-written views already use. */
  private fun family(size: SizeDp): String = when (TailzuX0.sizeClass(size)) {
    TailzuX0.SMALL -> "small"
    TailzuX0.LARGE -> "large"
    else -> "medium"
  }

  // ------------------------------------------------------------------ applying one fragment

  private fun apply(c: X0Ctx, node: NLookPlanNode, budget: NLookPaint.Budget, sizeIndex: Int): RemoteViews? {
    val id = layout(c, node.layout)
    if (id == 0) return null
    val rv = RemoteViews(c.context.packageName, id)
    for (set in node.sets) one(c, rv, set, budget, sizeIndex)
    for (kid in node.children) {
      val child = apply(c, kid, budget, sizeIndex) ?: continue
      rv.addView(R.id.nl_root, child)
    }
    return rv
  }

  private fun one(c: X0Ctx, rv: RemoteViews, set: NLookSet, budget: NLookPaint.Budget, sizeIndex: Int) {
    val id = R.id.nl_root
    val night = c.night
    when (set) {
      is NLookSet.Words -> rv.setTextViewText(id, set.value)
      is NLookSet.TextSizeDp -> rv.setTextViewTextSize(id, TypedValue.COMPLEX_UNIT_DIP, set.dp)
      is NLookSet.TextColor -> WidgetInk.set(rv, id, "setTextColor", ink(set.ink), night)
      is NLookSet.MaxLines -> rv.setInt(id, "setMaxLines", set.n)
      is NLookSet.TextAlign -> rv.setInt(id, "setGravity", gravity(set.align))
      is NLookSet.Track -> rv.setFloat(id, "setLetterSpacing", set.em)
      is NLookSet.AllCaps -> rv.setBoolean(id, "setAllCaps", set.on)
      is NLookSet.Background -> WidgetInk.set(rv, id, "setBackgroundColor", ink(set.ink), night)
      // API 31's own corners, so no bucket of corner drawables is needed. The CLIPPING is baked into every fragment's
      // XML (android:clipToOutline), because this call only sets an OutlineProvider and nothing remotable turns clipping
      // on: a radius here rounds the view, and a radius of 0 leaves it square.
      is NLookSet.Corner -> rv.setViewOutlinePreferredRadius(id, set.dp, TypedValue.COMPLEX_UNIT_DIP)
      is NLookSet.PadDp -> {
        val d = c.density
        // nlook writes pad as [top, right, bottom, left]; setViewPadding takes pixels, left first.
        rv.setViewPadding(id, px(set.pad[3], d), px(set.pad[0], d), px(set.pad[1], d), px(set.pad[2], d))
      }
      is NLookSet.WidthDp -> dimension(rv, id, true, set.dp, set.fill, set.fit)
      is NLookSet.HeightDp -> dimension(rv, id, false, set.dp, set.fill, set.fit)
      is NLookSet.MarginDp -> {
        if (set.start > 0f) rv.setViewLayoutMargin(id, RemoteViews.MARGIN_START, set.start, TypedValue.COMPLEX_UNIT_DIP)
        if (set.top > 0f) rv.setViewLayoutMargin(id, RemoteViews.MARGIN_TOP, set.top, TypedValue.COMPLEX_UNIT_DIP)
        if (set.end > 0f) rv.setViewLayoutMargin(id, RemoteViews.MARGIN_END, set.end, TypedValue.COMPLEX_UNIT_DIP)
        if (set.bottom > 0f) rv.setViewLayoutMargin(id, RemoteViews.MARGIN_BOTTOM, set.bottom, TypedValue.COMPLEX_UNIT_DIP)
      }
      // TextView's own, and only ever sent to a text fragment (NLookPlanner.ceiling). Both take PIXELS, not dp.
      is NLookSet.MaxWidthDp -> rv.setInt(id, "setMaxWidth", px(set.dp, c.density))
      is NLookSet.MaxHeightDp -> rv.setInt(id, "setMaxHeight", px(set.dp, c.density))
      is NLookSet.ImageAlpha -> rv.setInt(id, "setImageAlpha", (set.value * 255f).roundToInt().coerceIn(0, 255))
      is NLookSet.Tint -> WidgetInk.image(rv, id, ink(set.ink), night)
      is NLookSet.Describe -> rv.setContentDescription(id, set.words)
      is NLookSet.Paint -> {
        val made = NLookPaint.pair(c.context, set.req, c.density, budget)
        when {
          made == null -> rv.setViewVisibility(id, View.GONE)
          // A mask, or art: one bitmap, and the launcher's own BitmapCache dedups it across the sizes by identity.
          made.second == null -> rv.setImageViewBitmap(id, made.first)
          // Real colours: the drawing for each theme, and the launcher picks as the theme changes. Exactly what today's
          // X0View.picture does for its bar and its faces.
          else -> rv.setIcon(id, "setImageIcon", Icon.createWithBitmap(made.first), Icon.createWithBitmap(made.second))
        }
      }
      is NLookSet.Click -> click(c, set.click, sizeIndex)?.let { rv.setOnClickPendingIntent(id, it) }
      is NLookSet.Timer -> {
        // A Chronometer counts from elapsed-realtime, so the glance's wall-clock moment is moved onto that clock here.
        val base = SystemClock.elapsedRealtime() - (System.currentTimeMillis() - set.baseMs)
        rv.setChronometer(id, base, null, true)
        if (Build.VERSION.SDK_INT >= 24) rv.setChronometerCountDown(id, set.countDown)
      }
    }
  }

  private fun dimension(rv: RemoteViews, id: Int, horizontal: Boolean, dp: Float?, fill: Boolean, fit: Boolean) {
    val value: Float
    val unit: Int
    when {
      fill -> {
        value = -1f
        unit = TypedValue.COMPLEX_UNIT_PX
      }
      fit -> {
        value = -2f
        unit = TypedValue.COMPLEX_UNIT_PX
      }
      dp != null -> {
        value = dp
        unit = TypedValue.COMPLEX_UNIT_DIP
      }
      else -> return
    }
    if (horizontal) rv.setViewLayoutWidth(id, value, unit) else rv.setViewLayoutHeight(id, value, unit)
  }

  /**
   * A click. Checked AGAIN here, after the server and after the planner: a link opens only this app's own scheme, or a pull
   * request on the one https host today's allow-list permits. An answer goes through the widgets' own narrow token, which a
   * design can never widen.
   */
  private fun click(c: X0Ctx, click: NLookClick, sizeIndex: Int): PendingIntent? {
    val slot = SLOT_BASE + ((sizeIndex * 4 + click.slot) and (SLOT_COUNT - 1))
    if (click.item != null && click.action != null) return c.answer(click.item, click.action, slot)
    val open = click.open ?: return null
    if (open.startsWith("https://github.com/")) return c.openPr(open, slot)
    if (!open.startsWith("tulmi://")) return null
    return c.open(open, slot)
  }

  private fun gravity(align: String): Int = when (align) {
    "center" -> Gravity.CENTER_HORIZONTAL or Gravity.CENTER_VERTICAL
    "end" -> Gravity.END or Gravity.CENTER_VERTICAL
    else -> Gravity.START or Gravity.CENTER_VERTICAL
  }

  private fun ink(v: NLookInk): Ink = Ink(v.light, v.dark)

  private fun px(dp: Float, density: Float): Int = (dp * density).roundToInt().coerceIn(0, 4000)

  /**
   * A fragment's layout id, looked up by name once per process. A name the build does not carry comes back 0, and that node
   * — and so the whole draw — falls back to today's views rather than throwing inside the launcher.
   */
  @Synchronized
  private fun layout(c: X0Ctx, name: String): Int {
    layouts[name]?.let { return it }
    if (!name.matches(Regex("^nl_[a-z0-9_]{1,40}$"))) return 0
    @Suppress("DiscouragedApi")
    val id = try {
      c.context.resources.getIdentifier(name, "layout", c.context.packageName)
    } catch (_: Throwable) {
      0
    }
    layouts[name] = id
    return id
  }
}
