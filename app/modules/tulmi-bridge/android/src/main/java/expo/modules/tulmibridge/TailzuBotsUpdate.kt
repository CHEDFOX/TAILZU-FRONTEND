package expo.modules.tulmibridge

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Bundle
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * "BOTS AT WORK" ON ANDROID: the ongoing notice that says what a bot is doing while it does it. iOS has had this as a Live
 * Activity since the X0 widget shipped; Android had nothing, because startBotsActivity and its siblings did nothing here.
 *
 * IT IS A TEMPLATE FILL, NOT A CANVAS. Android 16's Live Updates refuse custom RemoteViews, setColorized, group summaries
 * and a low importance, so there is no nlook tree to draw: the server sends a `liveupdate` design whose `fill` names a
 * title, a text, a sub, a status-bar chip, progress, a tracker and large picture, a colour and up to three actions, and
 * each of those is a template over the same closed bind table the widget uses (bu.base in shared/native/looks.json).
 *
 *   Android 16 (API 36)   promoted to an ongoing Live Update with a status-bar chip (POST_PROMOTED_NOTIFICATIONS, a normal
 *                         permission), and a SEGMENTED bar — one segment per stage, with the running bot's own still as
 *                         the tracker. This module compiles against 36, so those calls are compiled, not reflected.
 *   Android 12 to 15      an ordinary ongoing progress notification. Everyone gets something real.
 *
 * PRIVACY (SPEC §7). A bot's task and its question can say anything the person wrote or a bot read. So the notice is posted
 * VISIBILITY_PRIVATE with a public version built from the lock-safe fields only, and the chip — which the status bar and
 * Always-On show, over the lock screen, to anyone looking at the phone — refuses a sensitive path outright rather than
 * redacting it.
 *
 * THE BOT, NOT THE APP. The large icon and the bar's tracker show the bot doing the job — its still, its face, else a disc
 * in its colour (botIcon) — whether or not a server design is on. Only the small icon is the app's own monochrome mark,
 * because Android requires one and draws it in the status bar.
 *
 * LAUNCH DARK. Nothing here posts on its own. The notice exists only while the app has called setBotsUpdate, which it does
 * only when the server's switch is on, so an unswitched build is silent even though the code is in it.
 */
internal object TailzuBotsUpdate {
  /** Where setBotsUpdate keeps the state, so the X0 TICK alarm can repost it with no round trip to JS. */
  internal const val KEY = "bu.state"

  /** When setBotsUpdate last wrote that state, so a notice nobody ever ended does not stand for ever. */
  private const val KEY_AT = "bu.at"

  /** Set when the person swiped the notice away: no repost until the app sets a new state. */
  private const val KEY_GONE = "bu.gone"
  private const val CHANNEL = "tailzu.bots"
  private const val NOTE_ID = 0x6207

  /**
   * HOW LONG A STATE IS WORTH POSTING. The app ends the notice when the job ends, but an end can be missed — a force
   * stop, a data push that never arrived, a crash — and on Android 13 and below an ongoing notice cannot be swiped away
   * at all. So the state carries its own expiry: past this, the notice goes by itself on the next tick. Eight hours is
   * longer than any job and short enough that nobody wakes up to yesterday's.
   */
  private const val MAX_AGE_MS = 8 * 3_600_000L

  /** One request code block for the notice's own buttons, clear of the widgets' (X0Ctx.code starts at 0x40000). */
  private const val CODE = 0x30000

  /** The ink in both themes, for a bot this phone knows no colour for. The same pair X0's own views fall back to. */
  private val INK = Ink(0xFF0A0A0A.toInt(), 0xFFFFFFFF.toInt())

  // ------------------------------------------------------------------ the bridge's two calls

  /** The app's state for the running job, as ContentState spells it. An empty string ends the notice. */
  fun set(context: Context, json: String) {
    if (json.isEmpty()) {
      end(context)
      return
    }
    val state = TailzuQuick.obj(json) ?: return
    try {
      TailzuQuick.prefs(context).edit()
        .putString(KEY, state.toString())
        .putLong(KEY_AT, System.currentTimeMillis())
        // A new state is a new word from the app: whatever was swiped away was about the job as it was.
        .remove(KEY_GONE)
        .apply()
    } catch (_: Throwable) {
    }
    post(context)
    // The minutes in the notice count on by themselves only if something redraws it. That is the X0 tick, and until now
    // nothing armed it from here: a phone with no X0 widget on its home screen froze the notice at the minute it was set.
    try {
      TailzuX0.arm(context, null, X0Doc.load(context), System.currentTimeMillis())
    } catch (_: Throwable) {
    }
  }

  fun end(context: Context) {
    try {
      TailzuQuick.prefs(context).edit().remove(KEY).remove(KEY_AT).remove(KEY_GONE).apply()
    } catch (_: Throwable) {
    }
    try {
      manager(context)?.cancel(NOTE_ID)
    } catch (_: Throwable) {
    }
  }

  /** The person swiped it away (the deleteIntent). The state stays, so `end` is still the app's to call, but nothing reposts. */
  fun dismissed(context: Context) {
    try {
      TailzuQuick.prefs(context).edit().putBoolean(KEY_GONE, true).apply()
    } catch (_: Throwable) {
    }
  }

  /**
   * Whether a notice is standing AND still worth redrawing, so the X0 tick knows to keep reposting it as the minutes
   * count on. Swiped away, aged out, or notifications turned off for this app: the tick has nothing left to do.
   */
  fun running(context: Context): Boolean = try {
    val prefs = TailzuQuick.prefs(context)
    !prefs.getString(KEY, null).isNullOrEmpty() &&
      !prefs.getBoolean(KEY_GONE, false) &&
      !stale(prefs.getLong(KEY_AT, 0L)) &&
      manager(context)?.areNotificationsEnabled() != false
  } catch (_: Throwable) {
    false
  }

  /** A state written this long ago says nothing true about a job any more. 0 (an old build's state) counts as fresh once. */
  private fun stale(at: Long): Boolean = at > 0L && System.currentTimeMillis() - at > MAX_AGE_MS

  // ------------------------------------------------------------------ posting

  /** Post (or repost) the notice from the state last written. Never throws: a notice never stops the app. */
  fun post(context: Context) {
    try {
      val prefs = TailzuQuick.prefs(context)
      // Aged out: the app never told us the job ended, so the notice ends itself rather than standing for ever.
      if (stale(prefs.getLong(KEY_AT, 0L))) {
        end(context)
        return
      }
      // Swiped away. It comes back only when the app sets a new state, never on a tick.
      if (prefs.getBoolean(KEY_GONE, false)) return
      val state = TailzuQuick.obj(prefs.getString(KEY, null)) ?: return
      val manager = manager(context) ?: return
      if (!manager.areNotificationsEnabled()) return
      channel(manager, context)
      val doc = X0Doc.load(context)
      val index = NLookStore.index(context)
      val design = index?.let { NLookStore.chain(context, it, look(doc), "liveupdate") }
      val fill = design?.fill
      val bind = Fill(state, doc)
      val note = build(context, state, bind, fill, index, lockSafe = false) ?: return
      manager.notify(NOTE_ID, note)
    } catch (_: Throwable) {
    }
  }

  /** The design the glance named for the notice, else the bundled default the catalog ships. */
  private fun look(doc: X0Doc?): String = doc?.look("bots")?.takeIf { it.isNotEmpty() } ?: "bu.base"

  private fun build(
    context: Context,
    state: JSONObject,
    bind: Fill,
    fill: Map<String, Any?>?,
    index: NLookIndex?,
    lockSafe: Boolean,
  ): Notification? {
    val builder = newBuilder(context)

    // Every line is a template over the closed bind table, and a line that resolves empty is simply not set.
    val title = bind.line(nlStr(fill?.get("title")) ?: "{{botName}}", lockSafe)
    val text = bind.line(nlStr(fill?.get("text")) ?: "{{stageName}}", lockSafe)
    val sub = bind.line(nlStr(fill?.get("sub")) ?: "{{words.step}}", lockSafe)
    if (title.isEmpty() && text.isEmpty()) return null
    builder.setContentTitle(title.ifEmpty { text })
    if (text.isNotEmpty() && title.isNotEmpty()) builder.setContentText(text)
    if (sub.isNotEmpty()) builder.setSubText(sub)
    builder.setSmallIcon(R.drawable.tailzu_widget_mark)
    builder.setOngoing(true)
    builder.setOnlyAlertOnce(true)
    builder.setShowWhen(false)
    // A bot's task can say anything the person wrote: the real notice is private, and the public version below is what a
    // locked phone shows instead.
    builder.setVisibility(Notification.VISIBILITY_PRIVATE)

    // Opening the notice itself goes where the job is, through the app's own link check.
    TailzuQuick.open(context, bind.line("{{link}}", true).ifEmpty { null }, CODE)?.let { builder.setContentIntent(it) }

    // Swiped away (Android 14 and up can dismiss an ongoing notice): it stays away until the app sets a new state.
    if (!lockSafe) gone(context)?.let { builder.setDeleteIntent(it) }

    // Progress: the job's stages, as far as it has got. One segment per stage on Android 16, a plain bar below it, so
    // every version from 12 up draws something true.
    val progress = fill?.get("progress") as? Map<*, *>
    val of = max(1, bind.number(nlStr(progress?.get("segments"))?.let { "{{$it}}" } ?: "", state) ?: bind.int("of") ?: 1)
    val at = (bind.int("stage") ?: 0).coerceIn(0, of)
    if (lockSafe || !segments(context, builder, bind, progress, fill, index, of, at)) {
      builder.setProgress(of, at, false)
    }
    bind.colour(nlStr(fill?.get("color")))?.let { builder.setColor(it) }

    if (!lockSafe) {
      botIcon(context, index, bind, nlStr(fill?.get("large")))?.let { builder.setLargeIcon(it) }
      actions(context, bind, fill).forEach { builder.addAction(it) }
      // The chip, on the status bar and in Always-On, where anyone can see it: non-sensitive paths only (§7).
      val chipTemplate = nlStr(fill?.get("chip")) ?: ""
      val chip = if (chipTemplate.isEmpty() || bind.sensitive(chipTemplate)) "" else bind.line(chipTemplate, true)
      promote(builder, chip)
      // A locked phone shows this instead: the same notice with nothing a bot wrote in it.
      builder.setPublicVersion(build(context, state, bind, fill, index, lockSafe = true))
    }
    return builder.build()
  }

  /** The deleteIntent: our own broadcast to the X0 provider, which is not exported — only this PendingIntent reaches it. */
  private fun gone(context: Context): PendingIntent? = try {
    PendingIntent.getBroadcast(
      context,
      CODE + 1,
      android.content.Intent(context, TailzuX0Widget::class.java).setAction(TailzuX0.NOTICE_GONE),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  } catch (_: Throwable) {
    null
  }

  @Suppress("DEPRECATION")
  private fun newBuilder(context: Context): Notification.Builder =
    if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, CHANNEL) else Notification.Builder(context)

  /**
   * Android 16's Live Update: ask for the ongoing promotion and give the status-bar chip its few characters. Below 36
   * neither exists and the notice stays an ordinary ongoing one, which is already true and already useful — nothing is
   * lied about to any version.
   *
   * The promotion is asked for through the extra the platform reads, not through Notification.Builder's own setter: that
   * setter landed in 36.1, and this module compiles against 36 (react-native 0.85's catalog sets compileSdk 36 and
   * nothing in this app overrides it). The key is the same one NotificationCompat writes, so a 36 phone promotes the
   * notice exactly as a direct call would. setShortCriticalText IS in 36, so it is called directly.
   */
  private fun promote(builder: Notification.Builder, chip: String) {
    if (Build.VERSION.SDK_INT < 36) return
    try {
      builder.addExtras(Bundle().apply { putBoolean(EXTRA_REQUEST_PROMOTED_ONGOING, true) })
      if (chip.isNotEmpty()) builder.setShortCriticalText(chip.take(7))
    } catch (_: Throwable) {
    }
  }

  /** Notification.EXTRA_REQUEST_PROMOTED_ONGOING, which is only a constant from API 36.1. */
  private const val EXTRA_REQUEST_PROMOTED_ONGOING = "android.requestPromotedOngoing"

  /**
   * THE SEGMENTED BAR, Android 16 only: one segment per stage, coloured with the fill's `progress.color` as far as the job
   * has got and with its `track` after that, and the tracker icon riding on top — the running bot itself: its still, else
   * its face, else a disc in its colour (botIcon), never the app's mark.
   *
   * This is the difference between a Live Update that looks like the design and one that looks like a download. False
   * means it was not drawn (an older phone, or anything at all going wrong), and the caller then sets the plain bar, so
   * the notice is never left without one.
   */
  private fun segments(
    context: Context,
    builder: Notification.Builder,
    bind: Fill,
    progress: Map<*, *>?,
    fill: Map<*, *>?,
    index: NLookIndex?,
    of: Int,
    at: Int,
  ): Boolean {
    if (Build.VERSION.SDK_INT < 36) return false
    if (progress == null) return false
    return try {
      val done = roleColour(context, bind, nlStr(progress["color"]), "accent")
      val track = roleColour(context, bind, nlStr(progress["track"]), "line")
      val list = ArrayList<Notification.ProgressStyle.Segment>(of)
      for (i in 1..of) {
        val segment = Notification.ProgressStyle.Segment(1)
        (if (i <= at) done else track)?.let { segment.setColor(it) }
        list.add(segment)
      }
      val style = Notification.ProgressStyle()
      style.setProgressSegments(list)
      style.setProgress(at)
      botIcon(context, index, bind, nlStr(fill?.get("tracker")))?.let { style.setProgressTrackerIcon(it) }
      builder.setStyle(style)
      true
    } catch (_: Throwable) {
      false
    }
  }

  /**
   * A colour for the bar: `#hex` and `$color` through the same grammar the rest of the fill uses, a palette ROLE through
   * the catalog's palette (today's resources behind it). A notification carries one colour, not two, so the light value
   * is the one sent, exactly as `$color` already does.
   */
  private fun roleColour(context: Context, bind: Fill, token: String?, fallback: String): Int? {
    bind.colour(token)?.let { return it }
    val name = (nlStr(token) ?: "").substringBefore("@").trim()
    val role = if (name.isEmpty() || name.startsWith("\$") || name.startsWith("#")) fallback else name
    return try {
      WidgetInk.Palette(context, NLookStore.palette(context)).role(role).light
    } catch (_: Throwable) {
      null
    }
  }

  /** At most three, each from the allow-list: answer the item with the widgets' own token, or open a vetted link. */
  private fun actions(context: Context, bind: Fill, fill: Map<String, Any?>?): List<Notification.Action> {
    val out = ArrayList<Notification.Action>()
    val list = fill?.get("actions") as? List<*> ?: return out
    var slot = 1
    for (entry in list) {
      if (out.size >= 3) break
      val map = entry as? Map<*, *> ?: continue
      val label = bind.line(nlStr(map["label"]) ?: "", true)
      if (label.isEmpty()) continue
      val act = map["act"] as? Map<*, *>
      val intent: PendingIntent? = if (act != null) {
        val item = bind.line(nlStr(act["item"]) ?: "", true)
        val action = bind.line(nlStr(act["action"]) ?: "", true)
        if (item.isEmpty() || action.isEmpty() || !TailzuQuick.canAnswer(context)) null
        else TailzuQuick.answer(context, item, action, CODE + slot)
      } else {
        val open = bind.line(nlStr(map["open"]) ?: "", true)
        if (!NLookPlanner.allowedLink(open)) null else TailzuQuick.open(context, open, CODE + slot)
      }
      slot++
      if (intent == null) continue
      out.add(
        Notification.Action.Builder(Icon.createWithResource(context, R.drawable.tailzu_widget_mark), label, intent).build(),
      )
    }
    return out
  }

  /**
   * THE BOT DOING THE JOB, as the large icon and as the bar's tracker: the still the design named, else the still this
   * phone holds for that bot, else its downloaded face, else a built-in's bundled head, else a disc in its own colour
   * (X0Faces — the same order, step for step, that every widget card follows, so the two never show different pictures of
   * one bot). This runs even with no server design at all, which is when `fill` is null and nothing was ever asked for: a
   * notice about a bot shows that bot, and never falls through to nothing.
   *
   * The SMALL icon is not this. Android requires a monochrome small icon and shows it in the status bar, so that one stays
   * the app's own mark; it is the only place on this notice where the app stands in for the bot.
   */
  private fun botIcon(context: Context, index: NLookIndex?, bind: Fill, key: String?): Icon? {
    picture(context, index, bind.art(key))?.let { return it }
    val slug = bind.slug()
    if (slug.isEmpty()) return null
    val bot = bind.bot()
    // A notice stands only while a job runs, so the moment is "work" whenever the phone has that still.
    X0Faces.still(context, index, slug, "work")?.let { return Icon.createWithBitmap(it) }
    // The face THIS STATE names comes first: a headless push carries one, and the stored glance may be older than the job
    // or hold no row for this bot at all (it keeps only eight).
    val faceKey = bind.face().ifEmpty { null } ?: bot?.face
    X0Faces.face(context, faceKey)?.let { return Icon.createWithBitmap(it) }
    bundled(context, faceKey)?.let { return it }
    bundled(context, slug)?.let { return it }
    // Its own colour, or the ink for a bot this phone knows no colour for — never nothing, which left the notice with no
    // picture of the bot at all.
    val ink = WidgetInk.bot(bot?.color, slug, INK) ?: INK
    return try {
      // The notice's own slot is 64 dp, bigger than a widget's face: drawn at that size rather than scaled up soft.
      Icon.createWithBitmap(X0Faces.disc(ink.light, bind.botName().ifEmpty { bot?.name ?: slug }, 192))
    } catch (_: Throwable) {
      null
    }
  }

  /** A built-in bot's own head, shipped in the build, keyed by that bot's face or its slug (X0Ctx.bundled, as an Icon). */
  private fun bundled(context: Context, key: String?): Icon? {
    val k = key?.let { X0Doc.face(it) } ?: return null
    return try {
      @Suppress("DiscouragedApi")
      val id = context.resources.getIdentifier("tailzu_x0_head_" + k.replace('-', '_'), "drawable", context.packageName)
      if (id == 0) null else Icon.createWithResource(context, id)
    } catch (_: Throwable) {
      null
    }
  }

  private fun picture(context: Context, index: NLookIndex?, key: String?): Icon? {
    if (key.isNullOrEmpty() || index == null) return null
    val relative = index.art[key] ?: index.art[key.removePrefix("art:")] ?: return null
    if (relative.contains("..")) return null
    val file = File(context.filesDir, relative)
    if (!file.isFile || file.length() !in 1..NLookLimits.ART_BYTES) return null
    return try {
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(file.path, bounds)
      var sample = 1
      while (max(bounds.outWidth, bounds.outHeight) / sample > 256) sample *= 2
      val bitmap = BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
      Icon.createWithBitmap(bitmap)
    } catch (_: Throwable) {
      null
    }
  }

  private fun manager(context: Context): NotificationManager? =
    context.getSystemService(NotificationManager::class.java)

  private fun channel(manager: NotificationManager, context: Context) {
    if (Build.VERSION.SDK_INT < 26) return
    // A Live Update may not be a minimum-importance channel, and people can turn this one off on its own.
    val channel = NotificationChannel(CHANNEL, context.getString(R.string.tailzu_bots_channel), NotificationManager.IMPORTANCE_DEFAULT)
    channel.setShowBadge(false)
    channel.enableVibration(false)
    channel.setSound(null, null)
    channel.description = context.getString(R.string.tailzu_bots_channel_about)
    manager.createNotificationChannel(channel)
  }

  // ------------------------------------------------------------------ filling a template from ContentState

  /**
   * The `liveupdate` half of the bind table. The fields are ContentState's own (activity.ts), and the WORDS come from the
   * LAST GLANCE THE APP STORED, not from this state — a push carries no words, so a word is the one thing a design may bind
   * here that is not in the state.
   */
  internal class Fill(private val state: JSONObject, private val doc: X0Doc?) {
    private val now = System.currentTimeMillis()

    /** WORD_SLOTS' `state` half. `working` has no fill here, so "{n} working" resolves EMPTY rather than printing "{n}". */
    private val slots: Map<String, Map<String, String?>> = mapOf(
      "step" to mapOf("stage" to "stage", "of" to "of"),
      "working" to mapOf("n" to null),
      "minIn" to mapOf("n" to "@minutesSince:startedAt"),
      "min" to mapOf("n" to "minutes"),
      "pr" to mapOf("n" to "pr.number"),
    )

    /** One template filled. `lockSafe` swaps anything a bot may have written for the lock-safe line. */
    fun line(template: String, lockSafe: Boolean): String {
      if (template.isEmpty()) return ""
      if (lockSafe && sensitive(template)) return safe()
      val out = StringBuilder()
      var i = 0
      var slotCount = 0
      var filled = 0
      while (i < template.length) {
        val open = template.indexOf("{{", i)
        if (open < 0) {
          out.append(template, i, template.length)
          break
        }
        val close = template.indexOf("}}", open)
        if (close < 0) {
          out.append(template, i, template.length)
          break
        }
        out.append(template, i, open)
        val path = template.substring(open + 2, close).trim()
        slotCount++
        val v = value(path)
        if (v.isNotEmpty()) filled++
        out.append(v)
        i = close + 2
      }
      if (slotCount > 0 && filled == 0) return ""
      return out.toString().trim().take(NLookLimits.TEXT_CHARS)
    }

    /** Words no bot wrote: the bot's name and where it has got to, which is what a locked phone may show. */
    private fun safe(): String {
      val name = value("botName")
      val stage = value("stageName")
      return listOf(name, stage).filter { it.isNotEmpty() }.joinToString(" · ")
    }

    fun sensitive(template: String): Boolean {
      for (path in listOf("task", "question", "result")) if (template.contains("{{$path}}")) return true
      return template.contains("{{vars.")
    }

    fun int(path: String): Int? = value(path).toDoubleOrNull()?.takeIf { it.isFinite() }?.roundToInt()

    /** The bot this notice is about, as the app's state names it. Empty when the state carries none. */
    fun slug(): String = value("bot")

    /** Its name, for the initial on a disc. Lock-safe: the app writes it, never a bot. */
    fun botName(): String = value("botName")

    /** The face key the state itself carries (ContentState.face) — the same one the iPhone's Live Activity draws. */
    fun face(): String = value("face")

    /** That bot as the last glance knew it: where its face file and its colour come from. */
    fun bot(): X0Doc.Bot? = doc?.bot(slug().ifEmpty { null })

    /** How many segments a progress bar has: the named list's length, else nothing. */
    fun number(template: String, from: JSONObject): Int? {
      if (template.isEmpty()) return null
      val name = template.removePrefix("{{").removeSuffix("}}")
      return (from.opt(name) as? JSONArray)?.length()?.takeIf { it > 0 }
    }

    fun colour(token: String?): Int? {
      val s = token?.trim() ?: return null
      if (s.startsWith("#")) return WidgetInk.hex(s)
      if (s != "\$color") return null
      val slug = value("bot").ifEmpty { return null }
      val base = WidgetInk.bot(doc?.bot(slug)?.color, slug, INK) ?: return null
      return base.light
    }

    fun art(key: String?): String? {
      val s = key?.trim() ?: return null
      if (s.isEmpty()) return null
      if (!s.startsWith("bot:")) return s
      // "bot:$bot.work": the running bot's own still, as the phone drew it into the art channel. With no bot in the
      // state there is no still to ask for: a guessed slug would look up a picture of the WRONG bot, and the phone never
      // drew one for it anyway. The same rule as NLookPlan.bot (H20-Q3).
      val slug = value("bot")
      if (slug.isEmpty()) return null
      return s.replace("\$bot", slug)
    }

    private fun value(path: String): String {
      if (path.startsWith("words.")) return word(path.substring(6))
      if (path.startsWith("vars.")) {
        val key = path.substring(5)
        if (key.contains('.')) return ""
        return nlStr(state.optJSONObject("vars")?.opt(key)) ?: ""
      }
      var here: Any? = state
      for (step in path.split('.')) {
        here = (here as? JSONObject)?.opt(step) ?: return ""
        if (here === JSONObject.NULL) return ""
      }
      return when (val v = here) {
        is String -> v.trim()
        is Number -> {
          val d = v.toDouble()
          if (!d.isFinite()) "" else if (d == d.roundToInt().toDouble()) d.roundToInt().toString() else d.toString()
        }
        else -> ""
      }
    }

    private fun word(key: String): String {
      if (key.isEmpty() || key.contains('.')) return ""
      var raw = doc?.word(key, "") ?: return ""
      if (raw.isEmpty()) return ""
      val table = slots[key] ?: return raw
      for (slot in table) {
        val marker = "{" + slot.key + "}"
        if (!raw.contains(marker)) continue
        val spec = slot.value ?: return ""
        val filled = if (spec.startsWith("@minutesSince:")) minutesSince(spec.substring(14)) else value(spec)
        if (filled.isEmpty()) return ""
        raw = raw.replace(marker, filled)
      }
      return raw
    }

    private fun minutesSince(path: String): String {
      val at = value(path).toDoubleOrNull()?.takeIf { it.isFinite() && it > 0 }?.toLong() ?: return ""
      return max(0L, (now - at) / 60000L).toString()
    }
  }
}
