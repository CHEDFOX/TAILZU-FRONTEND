package com.tulmi.app.keyboard

import android.content.Context
import android.graphics.Typeface
import android.os.Build
import org.json.JSONObject
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * THE SKIN BLOCK — the one thing a skin sends the phone that is not a key.
 * [native/SPEC.md §1.6, §2.10, §3.5; shared/types/keyboardFace.ts]
 *
 * Skins are authored and RESOLVED ON THE SERVER. config.ts expands the
 * person's pick straight into the key tree it already builds: into node
 * `style`, `props.face` and `style.press`, into themeDark / themeLight, into
 * the kb.callout.* flags. There is no skin resolver on the phone and no
 * precedence chain, and this object is not one. It holds four things:
 *
 *   - the skin's **id and sha**, for the crash guard and for telemetry,
 *   - the **budget** the view enforces whatever the tree asks for,
 *   - the **manifest**, which is fetched in ONE batch right after the config
 *     arrives and never again,
 *   - the **fonts** that batch registered.
 *
 * WHY ONE BATCH MATTERS. Nothing is fetched in response to a key press or a
 * layout switch, so no request this keyboard ever makes can be lined up
 * against a keystroke. That is the privacy promise, and it is kept here by
 * construction rather than by care: the renderer reads the cache and only the
 * cache. Art that has not landed means the key draws its flat colour for this
 * session. Everything comes by content hash from our own compiled-in host
 * (KbSafety), with no cookies and no id in the URL, so a skin cannot carry a
 * tracking pixel.
 */
object KbSkin {

    /** The parsed `skin` block. Absent = today's unskinned keyboard. */
    class Info(
        val id: String,
        val sha: String,
        /** Bytes of decoded images allowed on live key views. */
        val decodedBytes: Long,
        /** Keys that may run a display link at once. */
        val animatedKeys: Int,
        val art: List<String>,
        val fonts: List<Pair<String, String>>,
    )

    /** keyboardFace.ts KEY_FACE_LIMITS — the view's own ceilings. */
    const val LIMIT_FACED_KEYS = 64
    const val LIMIT_ART_FILES = 24
    const val LIMIT_ART_BYTES = 128 * 1024
    const val LIMIT_ART_EDGE_PX = 160
    const val LIMIT_LIVE_IMAGE_BYTES = 6L * 1024L * 1024L
    const val LIMIT_ANIMATED_KEYS = 3
    const val LIMIT_FONT_BYTES = 300 * 1024
    const val LIMIT_FONTS = 2

    /** Where a content-addressed file lives on our own host. Art and fonts
     *  are two different routes: the art route's own pattern refuses a .ttf,
     *  so a font asked for down the art path silently 400s. [H12-Q4] */
    private const val ART_PATH = "/v1/native/art/"
    private const val FONT_PATH = "/v1/native/font/"

    /** The only shape an art name may have: a sha-256 and a scale. The server
     *  checks the same pattern, and a manifest never carries a host. */
    private val ART_NAME = Regex("^[0-9a-f]{64}@[123]\\.png$")

    private val io = Executors.newFixedThreadPool(1)

    /** Hooked faces, by the manifest's own font id. */
    private val hooked = ConcurrentHashMap<String, Typeface>()

    /** Bundled faces, by type token, resolved once per process. */
    private val bundled = ConcurrentHashMap<String, Typeface>()

    /** Decoded bytes currently attached to live key views, and animated keys. */
    private val liveBytes = java.util.concurrent.atomic.AtomicLong(0L)
    private val animating = AtomicInteger(0)

    /** The skin the current config carries, or null. */
    @Volatile var current: Info? = null
        private set

    // -- parse --------------------------------------------------------------

    /**
     * The `skin` block of a config, clamped to the limits above. A config with
     * no skin, or one whose block is not an object, gives null and the
     * keyboard is exactly what it is today.
     */
    fun parse(rawJson: String): Info? = try {
        val o = JSONObject(rawJson).optJSONObject("skin")
        if (o == null) null else {
            val id = o.optString("id", "").trim()
            val b = o.optJSONObject("budget")
            val m = o.optJSONObject("manifest")
            val artArr = m?.optJSONArray("art")
            val art = ArrayList<String>()
            for (i in 0 until (artArr?.length() ?: 0)) {
                val name = artArr?.optString(i, "")?.trim().orEmpty()
                // Content-addressed names only, and exactly one shape:
                // <sha256>@<1|2|3>.png. A slash, a scheme or a traversal is
                // somebody trying to leave our host, and none of them can
                // survive this pattern.
                if (!ART_NAME.matches(name)) continue
                if (art.size >= LIMIT_ART_FILES) break
                art += name
            }
            val fontArr = m?.optJSONArray("fonts")
            val fonts = ArrayList<Pair<String, String>>()
            for (i in 0 until (fontArr?.length() ?: 0)) {
                val f = fontArr?.optJSONObject(i) ?: continue
                val fid = f.optString("id", "").trim()
                val sha = f.optString("sha256", "").trim().lowercase()
                if (fid.isEmpty() || sha.length != 64 || !sha.all { it in "0123456789abcdef" }) continue
                if (fonts.size >= LIMIT_FONTS) break
                fonts += fid to sha
            }
            Info(
                id = id,
                sha = o.optString("sha", "").trim(),
                decodedBytes = (b?.optLong("decodedKB", 0L) ?: 0L)
                    .let { if (it <= 0L) LIMIT_LIVE_IMAGE_BYTES else (it * 1024L).coerceAtMost(LIMIT_LIVE_IMAGE_BYTES) },
                animatedKeys = (b?.optInt("animatedKeys", LIMIT_ANIMATED_KEYS) ?: LIMIT_ANIMATED_KEYS)
                    .coerceIn(0, LIMIT_ANIMATED_KEYS),
                art = art,
                fonts = fonts,
            )
        }
    } catch (_: Throwable) {
        null
    }

    // -- the one batch ------------------------------------------------------

    /**
     * THE SKIN THIS CONFIG CARRIES, set BEFORE the tree is built.
     *
     * It has to be: the budget the build enforces (decodedKB, animatedKeys)
     * and the manifest a face's art is checked against both come from here.
     * Set after the build — which is where [prefetch] used to do it — and the
     * first build of a new config would police the PREVIOUS skin's numbers.
     *
     * The service calls this from the verdict, which already parses the
     * config, so there is no second parse.
     */
    fun arm(skin: Info?) {
        val changed = skin?.sha != current?.sha
        current = skin
        if (changed) {
            wroteFiles.set(false)
            // THE PREVIOUS SKIN'S DECODED PRINTS GO WITH IT. They are held in
            // a map of their own that the live-image budget does not count —
            // the budget counts what is ATTACHED to keys — so without this
            // every skin tried in one process kept its 24 decoded prints
            // (about 2.4 MB each) until the system asked for memory back. The
            // IME shares the app's process, so that is the app's headroom.
            // The files stay on disk; a skin picked again decodes from cache.
            try { TulmiImageLoader.purgeFaces() } catch (_: Throwable) {}
        }
    }

    /**
     * Fetch every file the manifest names, once, off the main thread, right
     * after the config has been applied. Already-cached files cost nothing.
     * Failures are silent: a missing file is the flat colour for a key, which
     * is a worse-looking keyboard and not a broken one.
     *
     * The batch also DECODES what it fetched, at the same edge the renderer
     * asks for, so the build that follows only reads the memo. Without that,
     * the first rebuild after a batch decodes up to 24 PNGs on the main
     * thread — during a shift press, if that is what triggered the rebuild.
     */
    fun prefetch(context: Context, skin: Info?) {
        arm(skin)
        if (skin == null) return
        val app = context.applicationContext
        try {
            io.execute {
                var wrote = false
                for (name in skin.art) {
                    val url = artUrl(name) ?: continue
                    try {
                        if (TulmiImageLoader.prefetch(app, url, LIMIT_ART_BYTES)) wrote = true
                        // Warm the decode here, on this thread. No budget is
                        // claimed: the budget counts what is ATTACHED to live
                        // keys, and that is decided at build time.
                        TulmiImageLoader.warmFace(app, url, LIMIT_ART_EDGE_PX)
                    } catch (_: Throwable) {}
                }
                for ((id, sha) in skin.fonts) {
                    try { if (fetchFont(app, id, sha)) wrote = true } catch (_: Throwable) {}
                }
                if (wrote) wroteFiles.set(true)
            }
        } catch (_: Throwable) {
            // No thread to be had. The keyboard draws unskinned this session.
        }
    }

    /**
     * Whether the batch has written a file the tree on screen has not seen.
     *
     * The service rebuilds ONCE, while the keyboard is hidden, so the second
     * open after a skin is picked is printed. Never while the keyboard is up:
     * a rebuild under a finger cancels the gesture and re-measures the grid,
     * and it lands at a moment nobody chose.
     */
    private val wroteFiles = java.util.concurrent.atomic.AtomicBoolean(false)

    /** True once, for the one rebuild it asks for. */
    fun takeNewFiles(): Boolean = wroteFiles.getAndSet(false)

    /**
     * The URL for a content-addressed file on our own host.
     *
     * The host comes from [KbSafety.mediaBase] and nowhere else: a config
     * carries names, never hosts, so there is no way for a pushed skin to
     * point a key's picture at a machine we do not own. mayFetch has the last
     * word all the same, which is what makes this safe to call with anything.
     */
    fun artUrl(name: String): String? {
        val url = KbSafety.mediaBase() + ART_PATH + name
        return if (KbSafety.mayFetch(url)) url else null
    }

    /**
     * `face.art` → a URL, or null.
     *
     * TWO CHECKS, both of which must pass: the name is the bare manifest
     * shape, and the manifest for THIS config actually lists it. The second
     * is what keeps the one-batch promise honest — a face naming a file no
     * batch fetched can only ever draw the flat colour, so there is no path
     * by which a key press turns into a request.
     *
     * There is no `url:` form any more. A skin that sends one is dropped by
     * the server's own check; if one reaches us, it does not match the
     * pattern and the key draws its colour.
     */
    fun artUrlFor(ref: String?): String? {
        val name = ref?.trim().orEmpty()
        if (!ART_NAME.matches(name)) return null
        if (current?.art?.contains(name) != true) return null
        return artUrl(name)
    }

    // -- fonts --------------------------------------------------------------

    private fun fontDir(context: Context): File =
        File(context.filesDir, "keyboard-media/fonts").apply { if (!exists()) mkdirs() }

    /**
     * A hooked font: fetched by content hash, checked against its sha and its
     * size cap, written to disk, then registered. A file that fails any check
     * is deleted, and the design's next font — then the system face — draws.
     */
    private fun fetchFont(context: Context, id: String, sha: String): Boolean {
        if (hooked.containsKey(id)) return false
        val file = File(fontDir(context), "$sha.ttf")
        var wrote = false
        if (!file.exists()) {
            // THE FONT ROUTE, not the art route. /v1/native/art/ answers only
            // to <sha>@<1|2|3>.png, so a .ttf asked for there came back 400
            // and every hooked font failed in silence. [H12-Q4]
            val url = fontUrl(sha) ?: return false
            val bytes = TulmiImageLoader.download(url, LIMIT_FONT_BYTES) ?: return false
            if (sha256(bytes) != sha) return false
            try { file.writeBytes(bytes); wrote = true } catch (_: Throwable) { return false }
        }
        if (file.length() > LIMIT_FONT_BYTES) { file.delete(); return false }
        val tf = try { Typeface.createFromFile(file) } catch (_: Throwable) { null }
        if (tf == null) { file.delete(); return false }
        hooked[id] = tf
        return wrote
    }

    /** A hooked font by content hash, with no extension, as iOS asks for it. */
    private fun fontUrl(sha: String): String? {
        if (sha.length != 64 || !sha.all { it in "0123456789abcdef" }) return null
        val url = KbSafety.mediaBase() + FONT_PATH + sha
        return if (KbSafety.mayFetch(url)) url else null
    }

    private fun sha256(bytes: ByteArray): String = try {
        java.security.MessageDigest.getInstance("SHA-256").digest(bytes)
            .joinToString("") { "%02x".format(it) }
    } catch (_: Throwable) { "" }

    /**
     * THE FOUR BUNDLED FILES, by type token and weight. [H9-Q6, H10-Q7]
     *
     * These are the exact file names IOS-WIDGETS' canonical set becomes in
     * res/font (Android resource names are lowercase with underscores). The
     * lookup used to ask for res/font/brand, res/font/display and
     * res/font/dots, which no file is called, so every one of them silently
     * drew in the system face.
     *
     * Two weights of one family, not one weight faked. `Typeface.create(tf,
     * 600, false)` asks the system to synthesise a weight from a static face,
     * which on most devices does nothing and on some smears the outline. Geist
     * ships both cuts, so the right file is simply picked.
     */
    private fun bundledName(token: String, weight: Int): String? = when (token) {
        "brand" -> if (weight >= 600) "geist_semibold" else "geist_medium"
        "display" -> "bricolage_grotesque_semibold"
        "dots" -> "doto_regular"
        else -> null
    }

    /**
     * `style.fontFamily` or `face.font` resolved to a face.
     *
     * Format 1 promises five names in every target: sans, brand, display,
     * dots, mono. A hooked id from the manifest is looked up first, because
     * the font hook exists precisely to add a face this build does not carry.
     * A name that is neither leaves the key with the face it already had,
     * which is the system face and the only honest fallback.
     *
     * A missing file is not an error: the res/font files land in their own
     * commit, and until they do every token resolves to null and the keyboard
     * looks exactly as it does today.
     */
    fun typeface(context: Context, token: String?, weight: Int = 0): Typeface? {
        val name = token?.trim().orEmpty()
        if (name.isEmpty()) return null
        hooked[name]?.let { return it }
        if (name == "sans") return Typeface.DEFAULT
        if (name == "mono") return Typeface.MONOSPACE
        val file = bundledName(name, weight) ?: return null
        bundled[file]?.let { return it }
        val res = bundledFont(context, file) ?: return null
        bundled[file] = res
        return res
    }

    /** res/font/<name>.ttf, by name, so no R.font constant is needed here —
     *  which is what lets the font files land in a later commit with no edit
     *  to any Kotlin file. */
    private fun bundledFont(context: Context, name: String): Typeface? = try {
        val id = context.resources.getIdentifier(name, "font", context.packageName)
        when {
            id == 0 -> null
            Build.VERSION.SDK_INT >= 26 -> context.resources.getFont(id)
            else -> null
        }
    } catch (_: Throwable) {
        null
    }

    // -- the live budgets ---------------------------------------------------

    /** Every build of the tree starts the counters again. */
    fun resetBudgets() {
        liveBytes.set(0L)
        animating.set(0)
    }

    /**
     * Claim [bytes] of decoded image for a key that is about to go on screen.
     * False means this key draws its flat colour: the budget is the ceiling
     * the view enforces whatever the config asked for, and thirty faced keys
     * with art is a different class of cost from one mic key.
     */
    fun claimImage(bytes: Long): Boolean {
        if (bytes <= 0L) return true
        val cap = current?.decodedBytes ?: LIMIT_LIVE_IMAGE_BYTES
        while (true) {
            val now = liveBytes.get()
            val next = now + bytes
            if (next > cap) return false
            if (liveBytes.compareAndSet(now, next)) return true
        }
    }

    /**
     * Claim one of the animated-key slots. False means this key draws its mark
     * at rest and never starts a display link — which is what all but a
     * handful of faced keys do.
     */
    fun claimAnimation(): Boolean {
        val cap = current?.animatedKeys ?: LIMIT_ANIMATED_KEYS
        while (true) {
            val now = animating.get()
            if (now >= cap) return false
            if (animating.compareAndSet(now, now + 1)) return true
        }
    }
}
