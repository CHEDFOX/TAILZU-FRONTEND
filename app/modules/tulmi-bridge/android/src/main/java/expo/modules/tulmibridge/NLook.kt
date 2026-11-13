package expo.modules.tulmibridge

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * nlook FORMAT 1 ON ANDROID, part one: what a design IS, read from disk leniently, and the limits every later step clamps to.
 * The contract is the backend's shared/types/nlook.ts; the shared cases are shared/native/fixtures/.
 *
 * Three rules, the same three the contract opens with, and nothing here bends them:
 *   1. Unknown degrades, never throws. An unknown node type keeps its `fallback`; an unknown style key is dropped on the floor;
 *      a design whose `format` is higher than this build draws is skipped ALONE, not the catalog around it.
 *   2. Checked three times. The server cleaned on publish, the app's JS cleaned before writing, and this file clamps again. A
 *      file on disk is still only a file: nothing here assumes the two earlier passes ran.
 *   3. Anything missing, too new, too big or broken ends at today's hand-written X0 views (TailzuX0Widget.kt). A limit is never
 *      a crash and never a blank widget.
 *
 * WHAT IS PURE AND WHY. The model below (NLookNode, NLookDesign, the value helpers) is plain Kotlin with no Android and no
 * org.json in it, because NLookPlan.kt plans against it on the JVM in tests. Only NLookStore touches org.json and the file
 * system; it turns JSON into the model once, and nothing downstream ever sees a JSONObject.
 *
 * The files the app's JS writes (TulmiBridgeModule.setNativeLooks):
 *
 *   files/nlook/current          one line: the name of the version folder in use. Swapped write-temp-then-rename, which is
 *                                atomic for a FILE on Android; renaming a directory over a non-empty one is not.
 *   files/nlook/v<N>/index.json  the catalog index: v, drawsFormat, palettes, design id to file, art key to file
 *   files/nlook/v<N>/<id>.json   one design
 *   files/nlook/art/<sha>@<s>.png  art, by content, never overwritten (a new sha is a new file)
 */

// ====================================================================================================== limits

/** NLOOK_LIMITS from shared/types/nlook.ts, the Android half. Anything past one of these is dropped, never drawn badly. */
internal object NLookLimits {
  /** The format this binary draws. A design above it is skipped alone (NativeLook1). */
  const val FORMAT = 1

  /**
   * RemoteViews levels the PLANNER counts, including the size-map level and every wrapper fragment. The launcher's own
   * MAX_NESTED_VIEWS is 10 and it throws "Too many nested views." while unpacking, in ITS process, where we cannot catch it.
   * So we stop at 8 and never find out.
   */
  const val LEVELS = 8
  const val EACH_COPIES = 8
  const val VIEWS_PER_SIZE = 60
  const val TEXT_CHARS = 200
  const val NODES_PER_ROOT = 80
  const val NODES = 150

  /** The path grammar's own caps (M L Q C Z O). */
  const val PATH_CHARS = 900
  const val PATHS_PER_SHAPE = 12

  /** nlook needs setViewLayoutWidth/Height/Margin, a night-aware setColorStateList and outline radius: all API 31. */
  const val MIN_SDK = 31

  /** Share of the launcher's RemoteViews bitmap budget we may use, summed across every size of one widget. */
  const val BITMAP_SHARE = 0.7f

  /** An art file on disk: PNG, this big at most, this long on its longest edge. */
  const val ART_BYTES = 512L * 1024L
  const val ART_LONG_EDGE = 1200

  /** One design's JSON on disk. A file past this is not read: it cannot be a format-1 widget design. */
  const val DESIGN_BYTES = 64L * 1024L

  /** The index. Bigger than one catalog's 256 KB, because the index also lists art and fonts. */
  const val INDEX_BYTES = 512L * 1024L
}

/** The three roots Android draws. RemoteViews has no accessory families, so inline, rect and circle are ignored, not an error. */
internal val NLOOK_ANDROID_ROOTS = listOf("small", "medium", "large")

/** The fourteen node types of format 1. Anything else keeps its `fallback`, then draws nothing. */
internal val NLOOK_TYPES = setOf(
  "V", "H", "Z", "Spacer", "Grid", "Text", "Image", "Bot", "Shape", "Bar", "Ring", "Kit", "Each", "Button",
)

/** A scheme may leave these out; they resolve to another role rather than losing the node (ROLE_FALLBACK in nlook.ts). */
internal val NLOOK_ROLE_FALLBACK = mapOf("paper" to "ground", "dim" to "meta", "outline" to "line", "hollow" to "line")

/** Every palette role format 1 promises. An unknown role becomes `ink`. */
internal val NLOOK_ROLES = setOf("ground", "ink", "paper", "meta", "dim", "line", "surface", "accent", "outline", "hollow")

// ====================================================================================================== the model (pure)

/**
 * One node: `{ type, props, style, children, if, fallback }`, the same shape as a KeyboardNode, so the two renderers read
 * alike. `props` and `style` stay open bags on purpose — an unknown key is IGNORED, and that is how a build survives a design
 * written for a later format.
 */
internal class NLookNode(
  val type: String,
  val props: Map<String, Any?> = emptyMap(),
  val style: Map<String, Any?> = emptyMap(),
  val children: List<NLookNode> = emptyList(),
  /** `if`: an AND over keys, each key an OR over its values. No expressions, ever. */
  val cond: Map<String, Any?>? = null,
  /** Drawn instead, when this node cannot be: unknown type, over a level cap, missing art. */
  val fallback: NLookNode? = null,
)

/** One design. Its `format` is its own, so a design too new is skipped and the rest of the catalog is kept. */
internal class NLookDesign(
  val id: String,
  val format: Int,
  val surface: String,
  /** The design to use where this one cannot be. Then today's native view. */
  val fallback: String?,
  val palette: String?,
  val roots: Map<String, NLookNode>,
  /** `liveupdate` only: the Android notice is a template fill, not a canvas. */
  val fill: Map<String, Any?>?,
  val art: List<String>,
) {
  /** Whether this binary draws it at all. A higher format is skipped ALONE. */
  fun drawable(surfaceWanted: String): Boolean = format in 1..NLookLimits.FORMAT && surface == surfaceWanted
}

/** One scheme of a palette, role to colour string, with the roles a scheme may leave out already resolved. */
internal class NLookScheme(private val roles: Map<String, String>) {
  fun role(name: String): String? {
    roles[name]?.let { return it }
    val next = NLOOK_ROLE_FALLBACK[name] ?: return null
    return roles[next]
  }
}

/**
 * A scheme for each theme, and the palette's `alpha` block as the catalog writes it.
 *
 * `dimAlpha` and `ruleAlpha` are PARSED AND NOT APPLIED, deliberately. A scheme gives `dim` and `line` as concrete
 * colours and carries these two numbers beside them; iPhone reads both and never applies them (NLookStyle.swift), and
 * today's hand-written Android views draw the line role at full opacity. Applying them as well faded every rule and
 * every bar track to invisibility. They are kept on the class so a design that round-trips the palette does not lose
 * them, and so the next reader sees why nothing uses them (NLookBind.role).
 */
internal class NLookPalette(val light: NLookScheme, val dark: NLookScheme, val dimAlpha: Float?, val ruleAlpha: Float?)

/** What the phone wrote beside its designs, so a widget finds one by id without parsing a catalog. */
internal class NLookIndex(
  val v: Int,
  val drawsFormat: Int,
  val dir: File,
  val palettes: Map<String, NLookPalette>,
  /** design id to its file name inside `dir`. */
  val designs: Map<String, String>,
  /** art key to its file, under files/ (nlook/art/<sha>@<scale>.png). */
  val art: Map<String, String>,
  /**
   * font key to its file, under files/ (nlook/font/<sha>). Nothing on an Android WIDGET reads it — setTypeface is not
   * remotable, so a widget's faces come from res/font alone — and the app's JS does not send fonts to this platform. It is
   * read only so the channel sweep knows which files are still named, instead of deleting whatever it does not recognise.
   */
  val fonts: Map<String, String>,
)

// ====================================================================================================== value helpers (pure)

/** A number, however the JSON spelled it; null for anything that is not finite. */
internal fun nlNum(v: Any?): Double? = when (v) {
  is Number -> v.toDouble().takeIf { it.isFinite() }
  is String -> v.trim().toDoubleOrNull()?.takeIf { it.isFinite() }
  else -> null
}

internal fun nlInt(v: Any?): Int? = nlNum(v)?.let { if (it > 2.1e9 || it < -2.1e9) null else it.toInt() }

/** A string, trimmed; null for anything else (JSON's null included: org.json would hand back "null"). */
internal fun nlStr(v: Any?): String? = (v as? String)?.trim()

internal fun nlBool(v: Any?): Boolean? = when (v) {
  is Boolean -> v
  is String -> when (v.trim().lowercase()) { "true" -> true; "false" -> false; else -> null }
  else -> null
}

/** One value, or a list of them, as a list: `if` keys are an OR over their values and may be written either way. */
internal fun nlList(v: Any?): List<Any?> = when (v) {
  null -> emptyList()
  is List<*> -> v
  else -> listOf(v)
}

/** `align`: start | center | end, and NOTHING else. nlook has no `justify`; a stray value draws `start` (nlook.ts NLookAlign). */
internal fun nlAlign(v: Any?): String {
  val s = nlStr(v) ?: return "start"
  return if (s == "center" || s == "end") s else "start"
}

/** A text literal or template, cut at 200 characters rather than dropped: words are the point of the node. */
internal fun nlText(v: Any?): String {
  val s = nlStr(v) ?: return ""
  return if (s.length <= NLookLimits.TEXT_CHARS) s else s.substring(0, NLookLimits.TEXT_CHARS)
}

/** `pad`: one number, or [top, right, bottom, left]. Always four, in that order. */
internal fun nlPad(v: Any?): FloatArray? {
  nlNum(v)?.let { n -> return floatArrayOf(n.toFloat(), n.toFloat(), n.toFloat(), n.toFloat()) }
  val list = (v as? List<*>) ?: return null
  if (list.size != 4) return null
  val out = FloatArray(4)
  for (i in 0 until 4) out[i] = (nlNum(list[i]) ?: return null).toFloat()
  return out
}

// ====================================================================================================== reading from disk

/**
 * The designs on disk: the pointer file, the index and one design at a time, each read leniently and clamped again. Every
 * entry point returns null rather than throwing, because a widget provider that throws takes the app's process with it.
 */
internal object NLookStore {
  private const val DIR = "nlook"
  private const val POINTER = "current"

  /** Where the app reported designs it saw break (TailzuX0Widget's try/catch), two strikes and the native view draws. */
  private const val BAD = "nlook.bad"

  /**
   * The index, or null: never written, written badly, or this phone is below API 31 and keeps today's twelve layouts.
   *
   * Parsed once and kept, because one home screen redraws every placed widget at once and each one would otherwise read
   * and parse the same file. The memo is keyed on the version folder AND the index file's own timestamp, so the write that
   * swaps the pointer is picked up by the very next draw — which is the draw the bridge asks for straight after writing.
   */
  @Synchronized
  fun index(context: Context): NLookIndex? = try {
    if (android.os.Build.VERSION.SDK_INT < NLookLimits.MIN_SDK) {
      null
    } else {
      val root = File(context.filesDir, DIR)
      val name = read(File(root, POINTER), 256L)?.trim()
      val stamp = if (name == null) 0L else File(File(root, name), "index.json").lastModified()
      val mark = (name ?: "") + "@" + stamp
      if (mark == memoMark) {
        memo
      } else {
        memo = readIndex(context)
        memoMark = mark
        memo
      }
    }
  } catch (_: Throwable) {
    null
  }

  private var memo: NLookIndex? = null
  private var memoMark: String = ""

  /** The default palette the catalog carries, which the contract makes THE source for widget colour. Null before one is held. */
  fun palette(context: Context, name: String? = null): NLookPalette? {
    val index = index(context) ?: return null
    return (name?.let { index.palettes[it] }) ?: index.palettes["ink"] ?: index.palettes.values.firstOrNull()
  }

  private fun readIndex(context: Context): NLookIndex? {
    val root = File(context.filesDir, DIR)
    val name = read(File(root, POINTER), 256L)?.trim() ?: return null
    if (!name.matches(Regex("^v[0-9]{1,9}$"))) return null
    val dir = File(root, name)
    val raw = read(File(dir, "index.json"), NLookLimits.INDEX_BYTES) ?: return null
    val o = JSONObject(raw)
    val palettes = HashMap<String, NLookPalette>()
    o.optJSONObject("palettes")?.let { ps ->
      for (key in ps.keys()) ps.optJSONObject(key)?.let { palette(it) }?.let { palettes[key] = it }
    }
    return NLookIndex(
      v = nlInt(o.opt("v")) ?: 0,
      drawsFormat = nlInt(o.opt("drawsFormat")) ?: NLookLimits.FORMAT,
      dir = dir,
      palettes = palettes,
      designs = names(o.optJSONObject("designs")),
      art = names(o.optJSONObject("art")),
      fonts = names(o.optJSONObject("fonts")),
    )
  }

  /**
   * One design by id, read and parsed now, whether or not this build can draw it. Drawability is the caller's question,
   * because a design that is too new still tells us which design to use INSTEAD (its `fallback`).
   */
  fun design(context: Context, index: NLookIndex, id: String): NLookDesign? {
    if (!id.matches(Regex("^[a-z0-9._-]{1,40}$"))) return null
    if (strikes(context, id) >= 2) return null
    val file = index.designs[id] ?: return null
    if (!file.matches(Regex("^[A-Za-z0-9._-]{1,80}$"))) return null
    val raw = read(File(index.dir, file), NLookLimits.DESIGN_BYTES) ?: return null
    return try {
      parse(JSONObject(raw))
    } catch (_: Throwable) {
      null
    }
  }

  /**
   * The first design in the `fallback` chain this build can actually draw: this one, then the one it names instead, and
   * so on. At most three hops and never round a ring — a widget is a surface that must not hang. Null means every link
   * was missing, too new, for another surface or marked bad, and today's hand-written view draws.
   */
  fun chain(context: Context, index: NLookIndex, id: String?, surface: String): NLookDesign? {
    var next = id
    val seen = HashSet<String>()
    var hops = 0
    while (!next.isNullOrEmpty() && hops < 3 && seen.add(next)) {
      val d = design(context, index, next)
      if (d != null && d.drawable(surface) && (surface != "widget" || d.roots.isNotEmpty())) return d
      next = d?.fallback
      hops++
    }
    return null
  }

  /**
   * A design this phone saw break. Two strikes and it is never read again: the native view draws, and the app reports the id
   * so the server stops naming it for this device.
   */
  fun strike(context: Context, id: String) {
    try {
      val p = TailzuQuick.prefs(context)
      val o = TailzuQuick.obj(p.getString(BAD, null)) ?: JSONObject()
      o.put(id, (nlInt(o.opt(id)) ?: 0) + 1)
      p.edit().putString(BAD, o.toString()).apply()
    } catch (_: Throwable) {
    }
  }

  fun strikes(context: Context, id: String): Int = try {
    nlInt(TailzuQuick.obj(TailzuQuick.prefs(context).getString(BAD, null))?.opt(id)) ?: 0
  } catch (_: Throwable) {
    0
  }

  /** The ids this phone marked bad, for the app to report. */
  fun badIds(context: Context): List<String> = try {
    val o = TailzuQuick.obj(TailzuQuick.prefs(context).getString(BAD, null)) ?: JSONObject()
    o.keys().asSequence().filter { (nlInt(o.opt(it)) ?: 0) >= 2 }.toList()
  } catch (_: Throwable) {
    emptyList()
  }

  // ---- parsing

  /** One design, leniently. Null when it is not a format-1 design at all. */
  fun parse(o: JSONObject): NLookDesign? {
    val id = nlStr(o.opt("id")) ?: return null
    if (!id.matches(Regex("^[a-z0-9._-]{1,40}$"))) return null
    val format = nlInt(o.opt("format")) ?: return null
    val surface = nlStr(o.opt("surface")) ?: return null
    val roots = HashMap<String, NLookNode>()
    o.optJSONObject("roots")?.let { rs ->
      for (key in rs.keys()) {
        if (surface == "widget" && key !in NLOOK_ANDROID_ROOTS) continue
        val node = rs.optJSONObject(key)?.let { node(it, 0) } ?: continue
        if (count(node) > NLookLimits.NODES_PER_ROOT) continue
        roots[key] = node
      }
    }
    val art = ArrayList<String>()
    (o.opt("art") as? JSONArray)?.let { a -> for (i in 0 until a.length()) nlStr(a.opt(i))?.let { art.add(it) } }
    return NLookDesign(
      id = id,
      format = format,
      surface = surface,
      fallback = nlStr(o.opt("fallback")),
      palette = nlStr(o.opt("palette")),
      roots = roots,
      fill = o.optJSONObject("fill")?.let { map(it) },
      art = art,
    )
  }

  /** One node and its children. Depth is capped here too, so a pathological file cannot recurse the parser to death. */
  fun node(o: JSONObject, depth: Int): NLookNode? {
    if (depth > 12) return null
    val type = nlStr(o.opt("type")) ?: return null
    if (type.isEmpty() || type.length > 24) return null
    val kids = ArrayList<NLookNode>()
    (o.opt("children") as? JSONArray)?.let { a ->
      for (i in 0 until a.length()) {
        if (kids.size >= 32) break
        a.optJSONObject(i)?.let { node(it, depth + 1) }?.let { kids.add(it) }
      }
    }
    return NLookNode(
      type = type,
      props = o.optJSONObject("props")?.let { map(it) } ?: emptyMap(),
      style = o.optJSONObject("style")?.let { map(it) } ?: emptyMap(),
      children = kids,
      cond = o.optJSONObject("if")?.let { map(it) },
      fallback = o.optJSONObject("fallback")?.let { node(it, depth + 1) },
    )
  }

  /** How many nodes a tree holds, its fallbacks counted: a root is capped at 80 and a design at 150. */
  fun count(node: NLookNode): Int {
    var n = 1
    for (kid in node.children) n += count(kid)
    node.fallback?.let { n += count(it) }
    return n
  }

  private fun palette(o: JSONObject): NLookPalette? {
    val light = o.optJSONObject("light")?.let { scheme(it) } ?: return null
    val dark = o.optJSONObject("dark")?.let { scheme(it) } ?: return null
    val alpha = o.optJSONObject("alpha")
    return NLookPalette(light, dark, nlNum(alpha?.opt("dim"))?.toFloat(), nlNum(alpha?.opt("rule"))?.toFloat())
  }

  private fun scheme(o: JSONObject): NLookScheme {
    val roles = HashMap<String, String>()
    for (key in o.keys()) {
      if (key !in NLOOK_ROLES) continue
      nlStr(o.opt(key))?.let { roles[key] = it }
    }
    return NLookScheme(roles)
  }

  private fun names(o: JSONObject?): Map<String, String> {
    if (o == null) return emptyMap()
    val out = HashMap<String, String>()
    for (key in o.keys()) nlStr(o.opt(key))?.let { out[key] = it }
    return out
  }

  /** org.json to plain Kotlin: numbers become Double, arrays become List, objects become Map, JSON null disappears. */
  private fun map(o: JSONObject): Map<String, Any?> {
    val out = HashMap<String, Any?>()
    for (key in o.keys()) {
      if (out.size >= 32) break
      value(o.opt(key))?.let { out[key] = it }
    }
    return out
  }

  private fun value(v: Any?): Any? = when {
    v == null || v === JSONObject.NULL -> null
    v is JSONObject -> map(v)
    v is JSONArray -> {
      val out = ArrayList<Any?>()
      for (i in 0 until minOf(v.length(), 32)) value(v.opt(i))?.let { out.add(it) }
      out
    }
    v is Number -> v.toDouble().takeIf { it.isFinite() }
    v is Boolean -> v
    v is String -> v
    else -> null
  }

  /** A file's text, or null: missing, empty, or bigger than it could legitimately be. */
  private fun read(file: File, cap: Long): String? = try {
    if (!file.isFile || file.length() <= 0L || file.length() > cap) null else file.readText(Charsets.UTF_8)
  } catch (_: Throwable) {
    null
  }

  // ---- what the bridge writes

  /**
   * Write a whole catalog version and then point at it. Each version lands in its own folder and the POINTER file is swapped
   * write-temp-then-rename, which is atomic for a file; an index a widget is halfway through reading is never overwritten.
   * Returns the folder name, or null when nothing was written.
   *
   * `designs` is keyed by DESIGN ID, which is the one shape both bridges take (iOS's TulmiNativeLooks does the same). The
   * file each one lands in is `<id>.json`, and the index's `designs` map is REPLACED with exactly the files that landed —
   * never kept from the app's own copy, because an index that names a file this folder does not hold is an index whose
   * every design falls back to the hand-written view.
   *
   * The folder is numbered by a LOCAL COUNTER, the highest `v<N>` already here plus one, not by the clock. Two writes in
   * the same second would otherwise reuse the folder the pointer is already on and overwrite it in place, which is the one
   * thing the version folders exist to prevent.
   */
  fun write(context: Context, indexJson: String, designs: Map<String, String>): String? = try {
    val root = File(context.filesDir, DIR)
    root.mkdirs()
    val name = next(root)
    val dir = File(root, name)
    if (dir.exists()) {
      null
    } else {
      dir.mkdirs()
      val landed = LinkedHashMap<String, String>()
      for (entry in designs) {
        // Exactly as the contract spells it, never trimmed: a key with a space in it is a contract break, and quietly
        // repairing one is how a break hides. iPhone reads the key the same way.
        val id = entry.key
        if (!id.matches(ID)) continue
        val file = "$id.json"
        File(dir, file).writeText(entry.value, Charsets.UTF_8)
        landed[id] = file
      }
      if (landed.isEmpty()) {
        dir.deleteRecursively()
        null
      } else {
        val index = JSONObject(indexJson)
        val map = JSONObject()
        for (entry in landed) map.put(entry.key, entry.value)
        index.put("designs", map)
        File(dir, "index.json").writeText(index.toString(), Charsets.UTF_8)
        val temp = File(root, "current.tmp")
        temp.writeText(name, Charsets.UTF_8)
        if (temp.renameTo(File(root, POINTER))) {
          name
        } else {
          temp.delete()
          dir.deleteRecursively()
          null
        }
      }
    }
  } catch (_: Throwable) {
    null
  }

  private val ID = Regex("^[a-z0-9._-]{1,40}$")

  /** The next version folder's name: the highest `v<N>` here plus one, so a name in use is never written over. */
  private fun next(root: File): String {
    var highest = 0
    try {
      root.listFiles()?.forEach { f ->
        if (!f.isDirectory || f.name.length < 2 || f.name[0] != 'v') return@forEach
        val n = f.name.substring(1).toIntOrNull() ?: return@forEach
        if (n > highest) highest = n
      }
    } catch (_: Throwable) {
    }
    // The pointer's own pattern allows nine digits. Past that, start again from 1: the old folders are long swept.
    return "v" + (if (highest in 1..999_999_998) highest + 1 else 1)
  }

  /** The `v` of the index in use, for the app to tell the server which catalog this phone holds. Null before one is held. */
  fun version(context: Context): Int? = index(context)?.v?.takeIf { it > 0 }

  /** Where art and fonts live: beside the version folders, never inside one, because they are shared by content. */
  internal fun channel(context: Context, name: String): File = File(File(context.filesDir, DIR), name)

  /** Old version folders, dropped after the pointer moved and every widget has drawn once since. Never the one in use. */
  fun sweep(context: Context) {
    try {
      val root = File(context.filesDir, DIR)
      val keep = read(File(root, POINTER), 256L)?.trim() ?: return
      val kids = root.listFiles() ?: return
      for (f in kids) {
        if (!f.isDirectory || f.name == keep || f.name == "art" || f.name == "font") continue
        if (!f.name.startsWith("v")) continue
        f.deleteRecursively()
      }
    } catch (_: Throwable) {
    }
  }
}

// ====================================================================================================== art and fonts

/**
 * The art and font channel, by CONTENT. Every picture a design draws and every font it names is a file the app downloaded
 * from our own host beforehand, named by its sha256, and checked here one more time before it is moved into place.
 *
 * A new sha is always a NEW FILE, never an overwrite. That is what makes it safe to write while a widget is drawing: an
 * index that is live, and the widget reading it, can only ever reach files that are already finished.
 */
internal object NLookFiles {
  private val SHA = Regex("^[0-9a-f]{64}$")

  /**
   * Every file name written since the last sweep. A still that `syncNativeStills` writes WHILE `syncNativeLooks` is
   * building an index that does not name it yet would otherwise be swept the moment that index lands, and the design that
   * wanted it would draw its fallback until the next catalog. Names, never timestamps — no FileTimestamp reason is wanted
   * in anyone's privacy manifest for a sweep.
   */
  private val pending = HashSet<String>()

  /** PNG's magic bytes. A file that does not start with them is not decoded, whatever its name says. */
  private val PNG = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)

  /** TTF (0x00010000) and OTF ("OTTO"): the two the font hook allows. */
  private val TTF = byteArrayOf(0x00, 0x01, 0x00, 0x00)
  private val OTF = byteArrayOf(0x4F, 0x54, 0x54, 0x4F)

  /**
   * Move one downloaded art file into nlook/art/<sha>@<scale>.png. Returns the path RELATIVE TO files/, which is what an
   * index maps an art key to, or "" when it was refused: a bad sha, a scale that is not 1 to 3, a file too big, or bytes
   * that are not a PNG.
   */
  fun art(context: Context, sha: String, scale: Int, from: String): String {
    val key = sha.trim().lowercase()
    if (!SHA.matches(key) || scale < 1 || scale > 3) return ""
    val source = File(from)
    if (!source.isFile || source.length() <= 0L || source.length() > NLookLimits.ART_BYTES) return ""
    if (!starts(source, PNG)) return ""
    val dir = NLookStore.channel(context, "art")
    dir.mkdirs()
    val name = "$key@$scale.png"
    val target = File(dir, name)
    // Content-addressed: the same sha is the same bytes, so a file already there is already right. Marked pending all the
    // same, because a sweep must not take a file the app has just told an index about.
    mark(name)
    if (target.isFile && target.length() == source.length()) return "nlook/art/$name"
    return if (move(source, target)) "nlook/art/$name" else ""
  }

  /**
   * One font file into nlook/font/<sha>. Android WIDGETS cannot use it (setTypeface is not remotable, so a widget's faces
   * come from res/font alone) but the IME in this same APK can, through Typeface.createFromFile.
   */
  fun font(context: Context, sha: String, from: String): String {
    val key = sha.trim().lowercase()
    if (!SHA.matches(key)) return ""
    val source = File(from)
    if (!source.isFile || source.length() <= 0L || source.length() > 300L * 1024L) return ""
    if (!starts(source, TTF) && !starts(source, OTF)) return ""
    val dir = NLookStore.channel(context, "font")
    dir.mkdirs()
    val target = File(dir, key)
    mark(key)
    if (target.isFile && target.length() == source.length()) return "nlook/font/$key"
    return if (move(source, target)) "nlook/font/$key" else ""
  }

  @Synchronized
  private fun mark(name: String) {
    if (pending.size < 512) pending.add(name)
  }

  /**
   * THE CHANNEL SWEEP, run after a catalog has landed and the pointer has moved. Every file in art/ and font/ that the new
   * index does not name and that was not written since the last sweep goes, along with any half-copied `.tmp`.
   *
   * Without it nothing ever deleted a still on this platform: every recoloured bot left one behind for good, and signing
   * out left the account's pictures of its own bots on the disk. `forgetNativeLooks` writes an index that names none of
   * them, so sign-out cleans up through this same sweep and needs no call of its own.
   *
   * Nothing is swept when the index could not be read, because "no index" and "an index that names nothing" must not look
   * the same to a sweep.
   */
  @Synchronized
  fun sweep(context: Context, index: NLookIndex?) {
    if (index == null) {
      pending.clear()
      return
    }
    try {
      val keep = HashSet<String>(pending)
      for (value in index.art.values) keep.add(value.substringAfterLast('/'))
      for (value in index.fonts.values) keep.add(value.substringAfterLast('/'))
      for (channel in listOf("art", "font")) {
        val dir = NLookStore.channel(context, channel)
        val kids = dir.listFiles() ?: continue
        for (f in kids) {
          if (!f.isFile) continue
          if (f.name.endsWith(".tmp")) {
            // A temp file whose target is pending belongs to a `move` that is running RIGHT NOW on the JS thread: it
            // wrote <name>.tmp and has not renamed it yet. Deleting it fails that rename, the call returns "", and the
            // still is missing for a whole pass. `mark()` runs before `move()`, so `pending` already names it.
            if (f.name.removeSuffix(".tmp") in keep) continue
            f.delete()
            continue
          }
          if (f.name in keep) continue
          f.delete()
        }
      }
    } catch (_: Throwable) {
    }
    pending.clear()
  }

  private fun starts(file: File, magic: ByteArray): Boolean = try {
    file.inputStream().use { stream ->
      val head = ByteArray(magic.size)
      if (stream.read(head) != magic.size) false else head.contentEquals(magic)
    }
  } catch (_: Throwable) {
    false
  }

  /** Written to a temp name beside the target and renamed, so a half-copied file is never readable under the real name. */
  private fun move(source: File, target: File): Boolean = try {
    val temp = File(target.parentFile, target.name + ".tmp")
    source.copyTo(temp, overwrite = true)
    val ok = temp.renameTo(target)
    if (!ok) temp.delete()
    ok
  } catch (_: Throwable) {
    false
  }
}
