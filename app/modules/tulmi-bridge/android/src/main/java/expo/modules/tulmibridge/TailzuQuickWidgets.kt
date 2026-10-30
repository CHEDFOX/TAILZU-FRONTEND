package expo.modules.tulmibridge

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Bundle
import android.text.format.DateFormat
import android.text.format.DateUtils
import android.view.View
import android.widget.RemoteViews
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.util.Date
import java.util.UUID
import kotlin.math.max
import kotlin.math.min

/**
 * THE QUICK-ACCESS WIDGET ON AN ANDROID HOME SCREEN: "From your people" (TailzuPeopleWidget), the iOS PeopleWidget.swift with
 * plain framework APIs; and what every widget here shares: the prefs file, the links a widget may open, answering in place with
 * the widgets' own token (the X0 widget's answers come through here too, TailzuX0Widget.kt).
 *
 * Everything it draws is the server's: GET /v1/widgets/now's document, which the app checked and wrote with setWidgetNow
 * (src/widgets/now.ts) to this app's `tulmi.widget` SharedPreferences: the rows already worded, each tap's link, each button and
 * whether it answers here or opens the app, how many rows each size shows, the colours, each kind's drawable, the empty state
 * and its button. Every field read here keeps a literal fallback, so a missing one never stops the rest; a new kind of row or
 * button is the server's data, not code. Nothing here asks the server for rows.
 *
 * In the app's own look and the phone's theme (WidgetInk): white and ink with greys, the dark ink at night; the mark (the app
 * icon's bot) in the header; rows parted by hairlines, each with an avatar (the person's initial, or the row's mark ringed in
 * its bot's own colour, by the row's `bot`, the one place colour shows); buttons as capsules, a primary one ink-filled, a secondary one
 * a line-grey ring. The server's colours go over the palette's: the look's `colors` and `styles` for dark, `light` and
 * `lightStyles` for light.
 *
 * A button that answers here is a broadcast to TailzuWidgetActReceiver (not exported: only these PendingIntents reach it), which
 * posts it with the widgets' OWN narrow token (POST /v1/widgets/token; it can only answer this person's needs-you and tick their
 * own tasks, runs out in a day, is revoked at sign-out), kept in the same private SharedPreferences. Never the session's token.
 * The row says how it went ("Done", "Already answered", "Open X0 to finish") until the app writes the rows again.
 *
 * Rows are nested RemoteViews added to a column at draw time, one per row the widget's height has room for (at most the server's
 * `limits.android`). No timer: the app asks for a redraw whenever it writes rows, and after a button.
 */
object TailzuQuick {
  /** The app's SharedPreferences file every widget reads (TulmiBridgeModule writes it). */
  const val PREFS = "tulmi.widget"

  /** The widget theme (setWidgetTheme): the server's colours, `colors` for dark and `light` for light. */
  const val THEME_KEY = "tulmi.widget.theme"
  const val NOW = "tulmi.widget.now"
  const val WRITTEN_AT = "tulmi.widget.now.writtenAt"
  const val STATE = "tulmi.widget.now.state"
  const val TOKEN = "tulmi.widget.token"
  const val TOKEN_META = "tulmi.widget.token.meta"
  const val ACT = "expo.modules.tulmibridge.WIDGET_ACT"

  /** The header's height in dp (its padding, the mark, the gap under it): what is left is the rows'. */
  private const val HEADER_DP = 56f

  /** Ask the quick-access widget to draw again (a broadcast, so the caller never waits on a draw). Never throws. */
  fun requestUpdate(context: Context) = requestUpdate(context, TailzuPeopleWidget::class.java)

  /** Ask every placed widget of one provider to draw again. Never throws. */
  internal fun requestUpdate(context: Context, cls: Class<*>) {
    try {
      val manager = AppWidgetManager.getInstance(context) ?: return
      val ids = manager.getAppWidgetIds(ComponentName(context, cls))
      if (ids == null || ids.isEmpty()) return
      context.sendBroadcast(
        Intent(context, cls).setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE).putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
      )
    } catch (_: Exception) {
      // A widget never stops the app.
    }
  }

  // ------------------------------------------------------------------ reading what the app wrote

  internal fun obj(raw: String?): JSONObject? = raw?.let {
    try {
      JSONObject(it)
    } catch (_: Exception) {
      null
    }
  }

  internal fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  /** The document and what buttons did since it was written. */
  internal fun load(context: Context): Pair<JSONObject?, Map<String, String>> = try {
    val p = prefs(context)
    val doc = obj(p.getString(NOW, null))?.takeIf { it.opt("v") is Number }
    Pair(doc, states(context, p.getLong(WRITTEN_AT, 0L)))
  } catch (_: Exception) {
    Pair(null, emptyMap())
  }

  /** What buttons did to items (working, done, gone, failed) since `since`: a newer write of the widget's data clears them. */
  internal fun states(context: Context, since: Long): Map<String, String> {
    val out = mutableMapOf<String, String>()
    try {
      obj(prefs(context).getString(STATE, null))?.let { o ->
        for (k in o.keys()) {
          val e = o.optJSONObject(k) ?: continue
          if (e.optLong("at", 0L) > since) out[k] = e.optString("s", "")
        }
      }
    } catch (_: Exception) {
    }
    return out
  }

  /** Whether a button can answer here now: the widgets' own token is kept and has not run out. Else it opens the app. */
  internal fun canAnswer(context: Context): Boolean = try {
    val p = prefs(context)
    p.getString(TOKEN, null)?.startsWith("xwt_") == true &&
      (obj(p.getString(TOKEN_META, null))?.optLong("expiresAt", 0L) ?: 0L) > System.currentTimeMillis()
  } catch (_: Exception) {
    false
  }

  /** What a button did to a row: working, done, gone, failed. */
  internal fun setState(context: Context, item: String, state: String) {
    try {
      val p = prefs(context)
      val o = obj(p.getString(STATE, null)) ?: JSONObject()
      val now = System.currentTimeMillis()
      val old = o.keys().asSequence().toList().filter { (o.optJSONObject(it)?.optLong("at", 0L) ?: 0L) < now - DateUtils.DAY_IN_MILLIS }
      for (k in old) o.remove(k)
      o.put(item, JSONObject().put("s", state).put("at", now))
      p.edit().putString(STATE, o.toString()).apply()
    } catch (_: Exception) {
    }
  }

  // ------------------------------------------------------------------ the look

  internal class Look(doc: JSONObject?, context: Context) {
    private val look = doc?.optJSONObject("look")
    private val theme = obj(prefs(context).getString(THEME_KEY, null))
    // The server's colours for each theme: the rows' look first, then the widget theme.
    private val darks = listOf(look?.optJSONObject("colors"), theme?.optJSONObject("colors"))
    private val lights = listOf(look?.optJSONObject("light"), theme?.optJSONObject("light"))
    private val darkStyles = look?.optJSONObject("styles")
    private val lightStyles = look?.optJSONObject("lightStyles")
    private val palette = WidgetInk.Palette(context)

    /** The theme showing now (Android 12+ is handed both and the launcher picks). */
    val night = WidgetInk.isNight(context)

    /** The server's colour for a role, each theme, else the palette's. */
    fun color(key: String, role: String = key): Ink = WidgetInk.resolve(key, palette.role(role), lights, darks)

    val ground = color("ground")
    val ink = color("pale", "ink")
    val accent = WidgetInk.resolve("accent", WidgetInk.resolve("mark", ink, lights, darks), lights, darks)
    val meta = color("meta")
    val line = color("line")
    val surface = color("surface")

    /** One part (fg, bg, border) of a button's style, each theme: the server's, else the app's own. */
    private fun style(name: String, part: String, fallback: Ink): Ink = Ink(
      WidgetInk.hex(lightStyles?.optJSONObject(name)?.opt(part) as? String) ?: fallback.light,
      WidgetInk.hex(darkStyles?.optJSONObject(name)?.opt(part) as? String) ?: fallback.dark,
    )

    // A primary button is ink with the ground's words; any other is the ink's words in a line-grey ring.
    fun fg(name: String): Ink = style(name, "fg", if (name == "primary") ground else ink)
    fun bg(name: String): Ink = style(name, "bg", if (name == "primary") ink else CLEAR)
    fun border(name: String): Ink = style(name, "border", if (name == "primary") CLEAR else line)
  }

  private val CLEAR = Ink(0, 0)

  // ------------------------------------------------------------------ links and buttons

  /** A link this app opens (its schemes, its own https hosts), as an Intent for this app only. Null for anything else. */
  internal fun openIntent(context: Context, url: String?): Intent? {
    val s = url?.trim()
    if (s.isNullOrEmpty()) return null
    val uri = Uri.parse(s)
    val scheme = uri.scheme?.lowercase() ?: return null
    val hosts = setOf("x0bot.com", "app.x0bot.com", "tailzu.space", "app.tailzu.space")
    val ok = scheme == "tulmi" || scheme == "com.tulmi.app" || (scheme == "https" && (uri.host?.lowercase() ?: "") in hosts)
    if (!ok) return null
    return Intent(Intent.ACTION_VIEW, uri).setPackage(context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
  }

  internal fun open(context: Context, url: String?, code: Int): PendingIntent? {
    val intent = openIntent(context, url)
      ?: context.packageManager.getLaunchIntentForPackage(context.packageName)?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      ?: return null
    return try {
      PendingIntent.getActivity(context, code, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    } catch (_: Exception) {
      null
    }
  }

  internal fun answer(context: Context, item: String, action: String, code: Int): PendingIntent? = try {
    val intent = Intent(context, TailzuWidgetActReceiver::class.java)
      .setAction(ACT)
      // Each button its own intent (the data), so one PendingIntent never stands in for another.
      .setData(Uri.parse("x0act://answer/${Uri.encode(item)}/${Uri.encode(action)}"))
      .putExtra("item", item)
      .putExtra("action", action)
    PendingIntent.getBroadcast(context, code, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  } catch (_: Exception) {
    null
  }

  /** A drawable by the server's name (tailzu_wi_*), or the fallback. */
  internal fun drawable(context: Context, name: String?, fallback: Int): Int {
    if (name.isNullOrEmpty() || !name.matches(Regex("^[a-z0-9_]{1,64}$"))) return fallback
    @Suppress("DiscouragedApi")
    val id = context.resources.getIdentifier(name, "drawable", context.packageName)
    return if (id != 0) id else fallback
  }

  // ------------------------------------------------------------------ drawing

  /** How tall the widget is, in dp, as the launcher shows it now. */
  internal fun heightDp(context: Context, options: Bundle?): Float {
    val landscape = context.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
    val h = options?.getInt(
      if (landscape) AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT else AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0
    ) ?: 0
    return if (h > 0) h.toFloat() else 180f
  }

  /**
   * When, the way the server said, never to the second: in whole minutes, hours, days in its words ("minutes": "now", "4m",
   * "3h", "2d", from the document's `timeWords`), counting in the phone's words ("relative": "5 min. ago"), the clock
   * ("clock": "6:30 pm"), or its own words as of the fetch (anything else).
   */
  internal fun whenText(context: Context, row: JSONObject, style: String, words: JSONObject?): String {
    val at = row.optLong("at", 0L)
    if (at > 0L && (style == "minutes" || style == "relative")) {
      val ago = max(0L, System.currentTimeMillis() - at)
      fun word(key: String, fallback: String, n: Long) = (words?.optString(key)?.ifEmpty { null } ?: fallback).replace("{n}", n.toString())
      if (ago < DateUtils.MINUTE_IN_MILLIS) return word("now", "now", 0)
      if (style == "relative") {
        return DateUtils.getRelativeTimeSpanString(at, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS, DateUtils.FORMAT_ABBREV_RELATIVE).toString()
      }
      if (ago < DateUtils.HOUR_IN_MILLIS) return word("min", "{n}m", ago / DateUtils.MINUTE_IN_MILLIS)
      if (ago < DateUtils.DAY_IN_MILLIS) return word("hour", "{n}h", ago / DateUtils.HOUR_IN_MILLIS)
      return word("day", "{n}d", ago / DateUtils.DAY_IN_MILLIS)
    }
    if (at > 0L && style == "clock") return DateFormat.getTimeFormat(context).format(Date(at))
    return row.optString("when", "")
  }

  /** A drawable on an image view: the mark as it is painted, anything else in `ink` (both themes). */
  private fun glyph(rv: RemoteViews, id: Int, context: Context, name: String?, fallback: Int, ink: Ink, night: Boolean) {
    val res = drawable(context, name, fallback)
    rv.setImageViewResource(id, res)
    val mark = if (res == fallback) fallback == R.drawable.tailzu_widget_mark else WidgetInk.isMark(name)
    if (!mark) WidgetInk.image(rv, id, ink, night)
  }

  /** One section of the document (people or needs) drawn into a widget, its rows as many as fit. */
  internal fun draw(
    context: Context, which: String, appWidgetId: Int, options: Bundle?,
    fallbackTitle: String, fallbackEmptyTitle: String, fallbackEmptyBody: String, fallbackEmptyCta: String, fallbackUrl: String,
    rowDp: Float, sectionIcon: Int,
  ): RemoteViews {
    val (doc, states) = load(context)
    val look = Look(doc, context)
    val section = doc?.optJSONObject(which)
    val on = section?.optBoolean("on", false) == true
    val rows = section?.optJSONArray("rows") ?: JSONArray()
    val words = section?.optJSONObject("words")
    val time = doc?.optString("time", "minutes") ?: "minutes"
    val timeWords = doc?.optJSONObject("timeWords")
    val rv = RemoteViews(context.packageName, R.layout.tailzu_widget_quick)
    val night = look.night

    WidgetInk.image(rv, R.id.tailzu_quick_ground, look.ground, night)
    glyph(rv, R.id.tailzu_quick_icon, context, section?.optString("androidIcon"), sectionIcon, look.ink, night)
    rv.setTextViewText(R.id.tailzu_quick_title, section?.optString("title")?.takeIf { it.isNotEmpty() } ?: fallbackTitle)
    WidgetInk.text(rv, R.id.tailzu_quick_title, look.ink, night)
    val base = appWidgetId * 64
    open(context, section?.optString("url")?.takeIf { it.isNotEmpty() } ?: fallbackUrl, base)?.let {
      rv.setOnClickPendingIntent(android.R.id.background, it)
    }

    rv.removeAllViews(R.id.tailzu_quick_rows)
    val room = max(1, ((heightDp(context, options) - HEADER_DP) / rowDp).toInt())
    val limit = section?.optJSONObject("limits")?.optInt("android", if (which == "needs") 3 else 4) ?: 4
    val count = min(min(room, max(1, limit)), rows.length())
    if (doc == null || !on || count == 0) {
      rv.setViewVisibility(R.id.tailzu_quick_rows, View.GONE)
      rv.setViewVisibility(R.id.tailzu_quick_empty, View.VISIBLE)
      val empty = section?.optJSONObject("empty")
      val written = empty?.optString("title")?.isNotEmpty() == true
      rv.setTextViewText(R.id.tailzu_quick_empty_title, if (written) empty!!.optString("title") else fallbackEmptyTitle)
      WidgetInk.text(rv, R.id.tailzu_quick_empty_title, look.ink, night)
      val body = if (written) empty!!.optString("body", "") else fallbackEmptyBody
      rv.setTextViewText(R.id.tailzu_quick_empty_body, body)
      WidgetInk.text(rv, R.id.tailzu_quick_empty_body, look.meta, night)
      rv.setViewVisibility(R.id.tailzu_quick_empty_body, if (body.isEmpty()) View.GONE else View.VISIBLE)
      val cta = if (written) empty!!.optString("cta", "") else fallbackEmptyCta
      rv.setTextViewText(R.id.tailzu_quick_empty_cta_text, cta)
      rv.setViewVisibility(R.id.tailzu_quick_empty_cta, if (cta.isEmpty()) View.GONE else View.VISIBLE)
      pill(rv, R.id.tailzu_quick_empty_cta_bg, R.id.tailzu_quick_empty_cta_ring, R.id.tailzu_quick_empty_cta_text, "primary", look)
      open(context, empty?.optString("url")?.takeIf { it.isNotEmpty() } ?: fallbackUrl, base + 1)?.let {
        rv.setOnClickPendingIntent(R.id.tailzu_quick_empty, it)
        rv.setOnClickPendingIntent(android.R.id.background, it)
      }
      rv.setContentDescription(android.R.id.background, fallbackTitle)
      return rv
    }
    rv.setViewVisibility(R.id.tailzu_quick_rows, View.VISIBLE)
    rv.setViewVisibility(R.id.tailzu_quick_empty, View.GONE)
    for (i in 0 until count) {
      val row = rows.optJSONObject(i) ?: continue
      rv.addView(R.id.tailzu_quick_rows, rowViews(context, row, look, time, timeWords, states[row.optString("id")], words, base + 2 + i * 6, i == 0))
    }
    return rv
  }

  /**
   * A button's look, the server's style: a capsule tinted to its fill, a 1dp capsule ring tinted to its border, and its words
   * (images tinted, as the card is, so every Android version takes them).
   */
  private fun pill(rv: RemoteViews, bg: Int, ring: Int, text: Int, style: String, look: Look) {
    WidgetInk.image(rv, bg, look.bg(style), look.night)
    WidgetInk.image(rv, ring, look.border(style), look.night)
    WidgetInk.text(rv, text, look.fg(style), look.night)
  }

  /** The three button slots of a row: the pressable frame, its fill, its ring, its words. */
  private val BUTTONS = arrayOf(
    intArrayOf(R.id.tailzu_row_b0, R.id.tailzu_row_b0_bg, R.id.tailzu_row_b0_ring, R.id.tailzu_row_b0_text),
    intArrayOf(R.id.tailzu_row_b1, R.id.tailzu_row_b1_bg, R.id.tailzu_row_b1_ring, R.id.tailzu_row_b1_text),
    intArrayOf(R.id.tailzu_row_b2, R.id.tailzu_row_b2_bg, R.id.tailzu_row_b2_ring, R.id.tailzu_row_b2_text),
  )

  /**
   * A row's bot's ring colour, by the row's `bot` (WidgetInk.botRgb: the built-ins' and a person's own bot's palette name),
   * or null for a row that is not a bot's. X0 itself ("tailzu"), or a bot without a colour, is the ink.
   */
  private fun botInk(bot: String, look: Look): Ink? {
    if (bot.isEmpty()) return null
    if (bot == "tailzu") return look.ink
    val rgb = WidgetInk.botRgb(bot) ?: return look.ink
    return WidgetInk.onDark(rgb, look.ink)
  }

  /**
   * The avatar: a bot's row (it names its `bot`) is its mark ringed in that bot's colour; a person's is their initial; a row
   * with neither its kind's drawable.
   */
  private fun avatar(v: RemoteViews, context: Context, row: JSONObject, look: Look) {
    val night = look.night
    WidgetInk.image(v, R.id.tailzu_row_avatar, look.surface, night)
    val bot = botInk(row.optString("bot").trim(), look)
    val initial = row.optString("initial").trim()
    v.setViewVisibility(R.id.tailzu_row_ring, if (bot != null) View.VISIBLE else View.GONE)
    if (bot != null) WidgetInk.image(v, R.id.tailzu_row_ring, bot, night)
    if (bot == null && initial.isNotEmpty()) {
      v.setViewVisibility(R.id.tailzu_row_icon, View.GONE)
      v.setViewVisibility(R.id.tailzu_row_initial, View.VISIBLE)
      v.setTextViewText(R.id.tailzu_row_initial, initial.take(2))
      WidgetInk.text(v, R.id.tailzu_row_initial, look.ink, night)
      return
    }
    v.setViewVisibility(R.id.tailzu_row_initial, View.GONE)
    v.setViewVisibility(R.id.tailzu_row_icon, View.VISIBLE)
    // A kind's own colour (the look's kinds.*.color), when the server gives one; else the ink.
    val tint = WidgetInk.hex(row.optString("color"))?.let { Ink(it, it) } ?: look.ink
    glyph(v, R.id.tailzu_row_icon, context, row.optString("androidIcon"), R.drawable.tailzu_widget_mark, tint, night)
  }

  private fun rowViews(
    context: Context, row: JSONObject, look: Look, time: String, timeWords: JSONObject?, state: String?, words: JSONObject?,
    code: Int, first: Boolean,
  ): RemoteViews {
    val v = RemoteViews(context.packageName, R.layout.tailzu_widget_quick_row)
    val night = look.night
    val item = row.optString("id")
    v.setViewVisibility(R.id.tailzu_row_rule, if (first) View.GONE else View.VISIBLE)
    if (!first) WidgetInk.set(v, R.id.tailzu_row_rule, "setBackgroundColor", look.line, night)
    avatar(v, context, row, look)
    v.setTextViewText(R.id.tailzu_row_who, row.optString("who"))
    WidgetInk.text(v, R.id.tailzu_row_who, look.ink, night)
    val tag = row.optString("tag", "")
    v.setTextViewText(R.id.tailzu_row_tag, tag)
    WidgetInk.text(v, R.id.tailzu_row_tag, look.meta, night)
    v.setViewVisibility(R.id.tailzu_row_tag, if (tag.isEmpty()) View.GONE else View.VISIBLE)
    v.setTextViewText(R.id.tailzu_row_when, whenText(context, row, time, timeWords))
    WidgetInk.text(v, R.id.tailzu_row_when, look.meta, night)
    val text = row.optString("text").ifEmpty { row.optString("line") }
    v.setTextViewText(R.id.tailzu_row_text, text)
    v.setViewVisibility(R.id.tailzu_row_text, if (text.isEmpty()) View.GONE else View.VISIBLE)
    WidgetInk.text(v, R.id.tailzu_row_text, look.ink, night)
    open(context, row.optString("url"), code)?.let { v.setOnClickPendingIntent(R.id.tailzu_row_words, it) }

    // How a pressed button went, until the rows are written again; else the buttons.
    if (!state.isNullOrEmpty()) {
      val line = when (state) {
        "working" -> words?.optString("working")?.ifEmpty { null } ?: "Sending…"
        "done" -> words?.optString("done")?.ifEmpty { null } ?: "Done"
        "gone" -> words?.optString("gone")?.ifEmpty { null } ?: "Already answered"
        else -> words?.optString("failed")?.ifEmpty { null } ?: "Open X0 to finish"
      }
      v.setTextViewText(R.id.tailzu_row_state, line)
      WidgetInk.text(v, R.id.tailzu_row_state, if (state == "done") look.accent else look.meta, night)
      v.setViewVisibility(R.id.tailzu_row_state, View.VISIBLE)
      v.setViewVisibility(R.id.tailzu_row_buttons, View.GONE)
      return v
    }
    v.setViewVisibility(R.id.tailzu_row_state, View.GONE)
    val actions = row.optJSONArray("actions") ?: JSONArray()
    var shown = 0
    for (i in 0 until actions.length()) {
      if (shown >= BUTTONS.size) break
      val a = actions.optJSONObject(i) ?: continue
      val id = a.optString("id")
      val label = a.optString("label")
      if (id.isEmpty() || label.isEmpty()) continue
      val tap = when (a.optString("mode")) {
        "inPlace" -> answer(context, item, id, code + 1 + shown)
        "open" -> if (openIntent(context, a.optString("url")) != null) open(context, a.optString("url"), code + 1 + shown) else null
        else -> null
      } ?: continue
      val (frame, bg, ring) = BUTTONS[shown].let { Triple(it[0], it[1], it[2]) }
      val words2 = BUTTONS[shown][3]
      v.setTextViewText(words2, label)
      pill(v, bg, ring, words2, a.optString("style", "secondary"), look)
      v.setOnClickPendingIntent(frame, tap)
      v.setViewVisibility(frame, View.VISIBLE)
      shown++
    }
    for (j in shown until BUTTONS.size) v.setViewVisibility(BUTTONS[j][0], View.GONE)
    v.setViewVisibility(R.id.tailzu_row_buttons, if (shown > 0) View.VISIBLE else View.GONE)
    return v
  }

  // ------------------------------------------------------------------ answering

  /** One answer, posted with the widgets' own token: done, gone (already answered) or failed. Run off the main thread. */
  internal fun post(context: Context, item: String, action: String): String {
    return try {
      val p = prefs(context)
      val token = p.getString(TOKEN, null)?.takeIf { it.startsWith("xwt_") } ?: return "failed"
      val meta = obj(p.getString(TOKEN_META, null)) ?: return "failed"
      if (meta.optLong("expiresAt", 0L) <= System.currentTimeMillis()) return "failed"
      val base = meta.optString("baseUrl", "").ifEmpty {
        context.getSharedPreferences("tulmi", Context.MODE_PRIVATE).getString("tulmi.baseUrl", null) ?: "https://api.x0bot.com"
      }.trimEnd('/')
      val path = meta.optString("path", "").takeIf { it.startsWith("/v1/") } ?: "/v1/widgets/act"
      val url = URI(base + path).toURL()
      if (url.protocol != "https" && url.host != "localhost" && url.host != "10.0.2.2") return "failed"
      val body = JSONObject().put("item", item).put("action", action).put("key", "w" + UUID.randomUUID().toString().replace("-", ""))
      val conn = url.openConnection() as HttpURLConnection
      try {
        conn.requestMethod = "POST"
        conn.connectTimeout = 8000
        conn.readTimeout = 8000
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json")
        conn.setRequestProperty("X-Widget-Token", token)
        conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
        when (conn.responseCode) {
          in 200..299 -> "done"
          404, 409, 410 -> "gone"
          else -> "failed"
        }
      } finally {
        conn.disconnect()
      }
    } catch (_: Exception) {
      "failed"
    }
  }
}

/** FROM YOUR PEOPLE: the latest from family and friends; a tap on a row opens exactly that thing in the app. */
class TailzuPeopleWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    for (id in appWidgetIds) redraw(context, appWidgetManager, id)
  }

  override fun onAppWidgetOptionsChanged(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int, newOptions: Bundle?) {
    redraw(context, appWidgetManager, appWidgetId)
  }

  private fun redraw(context: Context, manager: AppWidgetManager, id: Int) {
    try {
      manager.updateAppWidget(id, TailzuQuick.draw(
        context, "people", id, manager.getAppWidgetOptions(id),
        fallbackTitle = context.getString(R.string.tailzu_widget_people_label),
        fallbackEmptyTitle = context.getString(R.string.tailzu_widget_people_empty_title),
        fallbackEmptyBody = context.getString(R.string.tailzu_widget_people_empty_body),
        fallbackEmptyCta = context.getString(R.string.tailzu_widget_people_empty_cta),
        fallbackUrl = "tulmi://screen/bots.spaces",
        rowDp = 54f, sectionIcon = R.drawable.tailzu_widget_mark,
      ))
    } catch (_: Throwable) {
      // A launcher that refused it keeps what it had.
    }
  }
}

/**
 * A widget's button that answers here (an answer on X0, a button on a row): posted off the main thread (goAsync keeps the
 * receiver alive for it), the item marked as it goes and as it went, the widgets redrawn. Not exported: only the widgets' own
 * PendingIntents reach it.
 */
class TailzuWidgetActReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != TailzuQuick.ACT) return
    val item = intent.getStringExtra("item") ?: return
    val action = intent.getStringExtra("action") ?: return
    if (!item.matches(Regex("^[A-Za-z0-9_.:-]{1,200}$")) || !action.matches(Regex("^[a-z0-9_]{1,24}$"))) return
    val app = context.applicationContext
    TailzuQuick.setState(app, item, "working")
    TailzuQuick.requestUpdate(app)
    TailzuX0.requestUpdate(app)
    val pending = goAsync()
    Thread {
      try {
        TailzuQuick.setState(app, item, TailzuQuick.post(app, item, action))
        TailzuQuick.requestUpdate(app)
        TailzuX0.requestUpdate(app)
      } finally {
        pending.finish()
      }
    }.start()
  }
}
