package expo.modules.tulmibridge

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * nlook on Android, part four: BINDING. `{{job.task}}` to words, `$color` to a colour, `art:dusk.sky` to a file.
 *
 * THE CLOSED TABLE. A design may bind only the paths shared/types/nlook.ts BIND_PATHS lists, which mirror glance v2's own
 * field names. An unknown path gives an empty string, and a Text that resolves to empty HIDES, so a design written against a
 * later build degrades quietly instead of drawing a hole. Nothing here evaluates anything: there are no expressions in
 * format 1 and there never will be.
 *
 * AS OF THIS DRAW'S MINUTE. The glance carries `steps` — lines that take over at their own minute without a new glance
 * (X0Steps). X0Doc already resolves `case`, each bot's line and the lock words that way, so those four come from X0Doc and
 * everything else comes from the glance as written. One draw therefore tells one time, everywhere.
 *
 * A WORD'S OWN SLOTS. A knob word may hold slots — "Step {stage} of {of}", "{n} working" — and what fills each one is not
 * guesswork: WORD_SLOTS in the contract pins it, per surface, and SLOTS below is this side's copy. A slot with no fill
 * resolves the WHOLE word to empty, so a raw "{n}" never prints on a home screen.
 */
internal class NLookBind(
  private val context: Context,
  private val doc: X0Doc?,
  private val index: NLookIndex?,
  private val paletteName: String?,
  private val night: Boolean,
  /** The free map the glance carries beside `look`, already clamped by the app's JS. */
  private val vars: JSONObject?,
  private val now: Long,
) : NLookSource {

  private val glance: JSONObject? = doc?.raw
  private val words: JSONObject? = glance?.optJSONObject("words")
  private val fallbackPalette = WidgetInk.Palette(context)
  private val palette: NLookPalette? = paletteName?.let { index?.palettes?.get(it) } ?: index?.palettes?.get("ink")

  // ------------------------------------------------------------------ templates

  override fun fill(template: String, scope: NLookScope?): NLookFilled {
    if (template.isEmpty()) return NLookFilled("", true)
    if (!template.contains(BIND_OPEN)) return NLookFilled(template, false)
    val out = StringBuilder()
    val literal = StringBuilder()
    var slots = 0
    var filled = 0
    var i = 0
    while (i < template.length) {
      val open = template.indexOf(BIND_OPEN, i)
      if (open < 0) {
        out.append(template, i, template.length)
        literal.append(template, i, template.length)
        break
      }
      val close = template.indexOf(BIND_CLOSE, open)
      if (close < 0) {
        out.append(template, i, template.length)
        literal.append(template, i, template.length)
        break
      }
      out.append(template, i, open)
      literal.append(template, i, open)
      val path = template.substring(open + BIND_OPEN.length, close).trim()
      slots++
      val value = value(path, scope)
      if (value.isNotEmpty()) filled++
      out.append(value)
      i = close + BIND_CLOSE.length
    }
    // The hide rule: every slot came back empty AND the words around them are only punctuation. "3/5" keeps its slash only
    // while a number landed either side of it; "Step  of " never prints.
    val hide = slots > 0 && filled == 0 && !literal.any { it.isLetterOrDigit() }
    return NLookFilled(out.toString().trim(), hide)
  }

  override fun sensitive(template: String, scope: NLookScope?): Boolean {
    var i = 0
    while (i < template.length) {
      val open = template.indexOf(BIND_OPEN, i)
      if (open < 0) return false
      val close = template.indexOf(BIND_CLOSE, open)
      if (close < 0) return false
      if (isSensitive(template.substring(open + BIND_OPEN.length, close).trim(), scope)) return true
      i = close + BIND_CLOSE.length
    }
    return false
  }

  override fun has(path: String, scope: NLookScope?): Boolean = value(path, scope).isNotEmpty()

  override fun listCount(path: String): Int {
    val array = array(path) ?: return 0
    return array.length().coerceAtMost(NLookLimits.EACH_COPIES)
  }

  override fun dateMs(path: String, scope: NLookScope?): Long? {
    val raw = value(path, scope)
    val n = raw.toDoubleOrNull() ?: return null
    if (!n.isFinite() || n <= 0.0) return null
    return n.toLong()
  }

  override fun relative(path: String, scope: NLookScope?): String {
    val at = dateMs(path, scope) ?: return ""
    val minutes = max(0L, (now - at) / 60000L).toString()
    // The word is read RAW here, never through word(): WORD_SLOTS fills "min"'s own {n} from lastDone.minutes, and this
    // node is asking about a different date. Filling it twice would print the wrong number and look right.
    val raw = nlStr(words?.opt("min"))
    return if (raw.isNullOrEmpty()) "$minutes min" else raw.replace("{n}", minutes)
  }

  // ------------------------------------------------------------------ one path

  /** One bind path as words. Empty for anything this build does not know, which is how an older build degrades quietly. */
  private fun value(path: String, scope: NLookScope?): String {
    if (path.isEmpty()) return ""

    // Inside an Each: `it` for a list of plain strings, `it.<name>` otherwise.
    if (scope != null && (path == scope.alias || path.startsWith(scope.alias + "."))) {
      val item = item(scope) ?: return ""
      if (path == scope.alias) return scalarText(item)
      return text(dig(item, path.substring(scope.alias.length + 1)))
    }

    // The four X0Doc resolves as of this draw's minute, so the whole widget tells one time.
    when (path) {
      "case" -> return doc?.caseAt(now) ?: ""
      "lock.title" -> return doc?.lockTitle ?: ""
      "lock.line" -> return doc?.lockLine ?: ""
      "counts.working" -> return count("counts.working") { doc?.bots?.count { b -> b.working } ?: 0 }
      "counts.needs" -> return count("counts.needs") { doc?.needsCount ?: 0 }
    }

    if (path.startsWith("words.")) return word(path.substring(6))
    if (path.startsWith("vars.")) {
      val key = path.substring(5)
      if (key.contains('.')) return ""
      return nlStr(vars?.opt(key)) ?: ""
    }
    val root = glance ?: return ""
    return text(dig(root, path))
  }

  /** A `counts.*` the glance carries, else the same number worked out from what it does carry. */
  private fun count(path: String, otherwise: () -> Int): String {
    val root = glance
    if (root != null) {
      val v = dig(root, path)
      if (v != null) return text(v)
    }
    val n = otherwise()
    return if (n > 0) n.toString() else "0"
  }

  /** Walk "a.b[0].c" through the glance. A literal index only, 0 to 7: a number written in the design, never computed. */
  private fun dig(from: Any?, path: String): Any? {
    var here: Any? = from
    for (step in path.split('.')) {
      if (here == null || step.isEmpty()) return null
      var name = step
      val bracket = step.indexOf('[')
      var index = -1
      if (bracket > 0 && step.endsWith("]")) {
        name = step.substring(0, bracket)
        index = step.substring(bracket + 1, step.length - 1).toIntOrNull() ?: return null
        if (index < 0 || index > 7) return null
      }
      here = (here as? JSONObject)?.opt(name) ?: return null
      if (here === JSONObject.NULL) return null
      if (index >= 0) {
        val a = here as? JSONArray ?: return null
        if (index >= a.length()) return null
        here = a.opt(index)
      }
    }
    return here
  }

  private fun array(path: String): JSONArray? {
    val root = glance ?: return null
    return dig(root, path) as? JSONArray
  }

  private fun item(scope: NLookScope): JSONObject? {
    val a = array(scope.list) ?: return null
    if (scope.index >= a.length()) return null
    return a.optJSONObject(scope.index) ?: a.opt(scope.index)?.let { JSONObject().put("", it) }
  }

  /** A JSON value as the words a widget prints. A number prints whole; true and false print nothing. */
  private fun text(v: Any?): String = when (v) {
    null, JSONObject.NULL -> ""
    is String -> v.trim()
    is Boolean -> if (v) "1" else ""
    is Number -> {
      val d = v.toDouble()
      if (!d.isFinite()) "" else if (d == d.roundToInt().toDouble()) d.roundToInt().toString() else d.toString()
    }
    else -> ""
  }

  /** A `{{it}}` over a list of plain strings (job.stages) lands here through the one-key object item() builds. */
  private fun scalarText(item: JSONObject): String = nlStr(item.opt("")) ?: ""

  // ------------------------------------------------------------------ words and their slots

  /**
   * One knob word, in the person's language, with its own slots filled. WORD_SLOTS' widget half, copied here because format 1
   * is frozen into the binary and four renderers must not each guess.
   */
  private val SLOTS: Map<String, Map<String, String>> = mapOf(
    "step" to mapOf("stage" to "job.stage", "of" to "job.of"),
    "working" to mapOf("n" to "counts.working"),
    "minIn" to mapOf("n" to "@minutesSince:job.startedAt"),
    "min" to mapOf("n" to "lastDone.minutes"),
    "pr" to mapOf("n" to "lastDone.pr.number"),
  )

  private fun word(key: String): String {
    if (key.isEmpty() || key.contains('.')) return ""
    var raw = nlStr(words?.opt(key)) ?: return ""
    if (raw.isEmpty()) return ""
    val slots = SLOTS[key] ?: return raw
    for (slot in slots) {
      val marker = "{" + slot.key + "}"
      if (!raw.contains(marker)) continue
      val filled = slotValue(slot.value)
      // A slot with nothing to put in it empties the whole word, so a bare "{n}" never reaches a home screen.
      if (filled.isEmpty()) return ""
      raw = raw.replace(marker, filled)
    }
    return raw
  }

  /** A slot's fill: a path, or the one computed fill format 1 allows — whole minutes from a date to this draw's minute. */
  private fun slotValue(spec: String): String {
    if (!spec.startsWith("@minutesSince:")) return value(spec, null)
    val at = dateMs(spec.substring(14), null) ?: return ""
    if (at <= 0L) return ""
    return max(0L, (now - at) / 60000L).toString()
  }

  // ------------------------------------------------------------------ privacy

  /** The paths whose words can be private, as BIND_PATHS marks them. `vars.*` is sensitive by default: free strings cannot be classified. */
  private fun isSensitive(path: String, scope: NLookScope?): Boolean {
    if (path.startsWith("vars.")) return true
    val name = if (scope != null && path.startsWith(scope.alias + ".")) path.substring(scope.alias.length + 1) else path
    if (scope != null && scope.list == "needs.items" && name == "question") return true
    return name == "job.task" || name == "lastDone.result" || name == "task" || name == "question" || name == "result" ||
      name.endsWith("].question")
  }

  // ------------------------------------------------------------------ colour

  /**
   * The colour grammar, shared with the keyboard and the bots' looks: "#RRGGBB", "#RRGGBBAA", a palette role, `$color` (the
   * bound bot's own ink) or `$bot.<slug>`, any of them with an "@0.6" alpha. An unknown token becomes `ink`, never nothing.
   */
  override fun ink(token: String, scope: NLookScope?): NLookInk? {
    var name = token.trim()
    if (name.isEmpty()) return null
    var alpha = 1f
    val at = name.lastIndexOf('@')
    if (at > 0) {
      alpha = name.substring(at + 1).toFloatOrNull()?.coerceIn(0f, 1f) ?: 1f
      name = name.substring(0, at)
    }
    val base = when {
      name.startsWith("#") -> WidgetInk.hex(name)?.let { NLookInk(it, it) }
      name == "\$color" -> botInk(botFor(scope))
      name.startsWith("\$bot.") -> botInk(name.substring(5))
      else -> role(name)
    } ?: role("ink")
    if (base == null) return null
    if (alpha >= 1f) return base
    return NLookInk(fade(base.light, alpha), fade(base.dark, alpha))
  }

  /**
   * A palette role, from the catalog's palette first and today's resource palette after. An unknown role is the ink.
   *
   * THE PALETTE'S `alpha` IS NOT APPLIED HERE, and that is deliberate. A scheme gives `dim` and `line` as concrete
   * colours (the catalog's "ink" palette: line #E6E6E6 / #262626, dim #6E6E6E / #8A8A8A) AND carries `alpha.rule` 0.15
   * and `alpha.dim` 0.64. iPhone reads both numbers and never applies them (NLookStyle.swift), and today's hand-written
   * Android views draw the line role at full opacity. Fading the concrete colour by the alpha as well took every rule
   * and every bar track down to about 15% of a pale grey, which is invisible on either ground. So the role's colour is
   * the role's colour, the same on all three renderers.
   */
  private fun role(name: String): NLookInk? {
    val wanted = if (name in NLOOK_ROLES) name else "ink"
    palette?.let { p ->
      val light = p.light.role(wanted)?.let { WidgetInk.hex(it) }
      val dark = p.dark.role(wanted)?.let { WidgetInk.hex(it) }
      if (light != null && dark != null) return NLookInk(light, dark)
    }
    val resolved = fallbackPalette.role(if (wanted == "paper") "ground" else wanted)
    return NLookInk(resolved.light, resolved.dark)
  }

  /**
   * Which bot `$bot` and `$color` mean here: the one this Each copy is about, else the running job's, else the first
   * needs item's, else the last done. A Bot node's still is looked up by this slug, so it is the planner's answer too.
   */
  override fun botFor(scope: NLookScope?): String? {
    if (scope != null) {
      val item = item(scope)
      nlStr(item?.opt("slug"))?.let { return it }
      nlStr(item?.opt("bot"))?.let { return it }
    }
    doc?.job?.bot?.takeIf { it.isNotEmpty() }?.let { return it }
    doc?.items?.firstOrNull()?.bot?.takeIf { it.isNotEmpty() }?.let { return it }
    doc?.done?.bot?.takeIf { it.isNotEmpty() }?.let { return it }
    return null
  }

  private fun botInk(slug: String?): NLookInk? {
    if (slug.isNullOrEmpty()) return null
    val base = role("ink") ?: return null
    val ink = WidgetInk.bot(doc?.bot(slug)?.color, slug, Ink(base.light, base.dark)) ?: return null
    return NLookInk(ink.light, ink.dark)
  }

  private fun fade(color: Int, alpha: Float): Int {
    val a = ((color ushr 24) and 0xFF) * alpha.coerceIn(0f, 1f)
    return (color and 0x00FFFFFF) or ((a.roundToInt().coerceIn(0, 255)) shl 24)
  }

  // ------------------------------------------------------------------ art and bundled pictures

  /**
   * The file a picture is already on disk as. The widget never fetches anything: every art file and bot still was downloaded
   * or drawn by the app beforehand, by content hash, into the version folder's art channel.
   */
  override fun art(key: String, scope: NLookScope?): String? {
    val k = key.trim()
    if (k.isEmpty()) return null
    if (k.startsWith("face:")) {
      val slug = X0Doc.face(k.substring(5)) ?: return null
      val file = File(File(context.filesDir, "widget-faces"), "$slug.png")
      return if (file.isFile && file.length() in 1..NLookLimits.ART_BYTES) file.path else null
    }
    if (k.startsWith("pose:") || k.startsWith("sym:")) return null
    val name = if (k.startsWith("art:")) k.substring(4) else k
    val relative = index?.art?.get(name) ?: index?.art?.get(k) ?: return null
    if (relative.contains("..")) return null
    val file = File(context.filesDir, relative)
    return if (file.isFile && file.length() in 1..NLookLimits.ART_BYTES) file.path else null
  }

  /**
   * A bot's own face file, by its slug: the picture the app downloaded for it, under the face key the glance carries. A
   * Bot node draws this when no still of that bot is on the phone yet, so a card is never handed the mascot instead.
   */
  override fun faceArt(slug: String?): String? {
    if (slug.isNullOrEmpty()) return null
    val key = doc?.bot(slug)?.face?.takeIf { it.isNotEmpty() }
      ?: doc?.items?.firstOrNull { it.bot == slug }?.face?.takeIf { it.isNotEmpty() }
      ?: return null
    return art("face:$key", null)
  }

  /**
   * The bundled drawables a design may name. `pose:` is one of today's Blip heads; `sym:` is the glyph set the quick widgets
   * already draw. Anything not in the build is nothing, and the node's `alt` or its fallback draws instead.
   */
  override fun bundled(src: String): String? {
    val s = src.trim()
    val name = when {
      s.startsWith("pose:") -> "tailzu_x0_head_" + s.substring(5).replace('-', '_')
      s.startsWith("sym:") -> "tailzu_wi_" + s.substring(4).replace('-', '_')
      s.matches(Regex("^[a-z0-9_]{1,64}$")) -> s
      else -> return null
    }
    if (!name.matches(Regex("^[a-z0-9_]{1,64}$"))) return null
    @Suppress("DiscouragedApi")
    val id = try {
      context.resources.getIdentifier(name, "drawable", context.packageName)
    } catch (_: Throwable) {
      0
    }
    return if (id != 0) name else null
  }

  companion object {
    const val BIND_OPEN = "{{"
    const val BIND_CLOSE = "}}"
  }
}
