package com.tulmi.app.keyboard

import android.content.Context
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.graphics.drawable.AnimatedImageDrawable
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.graphics.Movie
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.widget.ImageView
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.zip.CRC32

/**
 * Kotlin twin of TulmiImageLoader.swift.
 *
 * The backend can push any image asset (PNG, JPG, WebP, GIF, APNG) to
 * bootstrap.media[key]; the keyboard resolves that URL and hands the result
 * to an [ImageView] or [android.widget.ImageButton] for rendering. GIF and
 * APNG both animate — SDK >= 28 uses [ImageDecoder] + [AnimatedImageDrawable]
 * which drives its own frame timer; older builds fall back to the deprecated
 * [Movie] class wrapped in a custom [Drawable].
 *
 * A small disk cache under app-private files/keyboard-media/ keeps hot
 * assets warm across keyboard sessions so the mic art doesn't re-download
 * every time the IME opens.
 *
 * Everything the caller can express — the URL, whether animation loops,
 * frame rate multiplier — comes from the backend. The loader does not
 * hardcode any URL, key, or animation constant.
 */
object TulmiImageLoader {

    private const val CACHE_DIR = "keyboard-media"

    private val memory = ConcurrentHashMap<String, Drawable>()

    /**
     * Insertion order, so the cap evicts the oldest rather than everything.
     *
     * An IME is not under iOS's jetsam ceiling, but it is a long-lived process
     * the user never restarts, and a decoded bitmap is the biggest thing it
     * holds. Unbounded, every asset the backend has ever served stays resident
     * for as long as the keyboard is installed. The disk cache is untouched, so
     * an evicted image comes back without a network round trip.
     */
    private val order = java.util.Collections.synchronizedList(mutableListOf<String>())

    /** How many decoded images stay in memory — the server's number, the one
     *  iOS reads (kb.images.memoryCap); 12 until a config says otherwise. */
    private fun memoryLimit(): Int = knobInt("kb.images.memoryCap", 12).coerceAtLeast(0)

    private fun remember(url: String, drawable: Drawable) {
        if (memory.put(url, drawable) == null) order.add(url)
        val limit = memoryLimit()
        while (order.size > limit) {
            val oldest = synchronized(order) { if (order.isEmpty()) null else order.removeAt(0) }
                ?: break
            memory.remove(oldest)
        }
    }

    /** Drop every decoded image; the disk cache brings them back. */
    fun purgeMemory() {
        memory.clear()
        order.clear()
        purgeFaces()
    }
    private val inflight = ConcurrentHashMap.newKeySet<String>()
    private val io = Executors.newFixedThreadPool(2)
    private val main = Handler(Looper.getMainLooper())

    /**
     * Return a drawable for [url] synchronously if it's already in the memory
     * or disk cache; otherwise return null and kick off a background fetch.
     * When the fetch completes, [onLoad] is invoked on the main thread with
     * the resolved drawable so callers can swap it into their target view.
     *
     * Static images are returned as [BitmapDrawable]; animated GIF / APNG as
     * [AnimatedImageDrawable] (SDK 28+) or a Movie-backed drawable (SDK < 28).
     * Callers can call [android.graphics.drawable.Animatable.start] on either
     * type to (re)begin playback.
     */
    fun cached(context: Context, url: String, onLoad: ((Drawable) -> Unit)? = null): Drawable? {
        memory[url]?.let { return it }
        val disk = readDisk(context, url)
        if (disk != null) {
            remember(url, disk)
            return disk
        }
        fetch(context, url, onLoad)
        return null
    }

    /**
     * Convenience: fetch [url] and drop the drawable into [target] as soon as
     * it lands. If the target is an [ImageView] and the drawable is
     * [android.graphics.drawable.Animatable], playback starts automatically.
     */
    fun into(context: Context, url: String, target: ImageView) {
        val hit = cached(context, url) { d ->
            target.setImageDrawable(d)
            (d as? android.graphics.drawable.Animatable)?.start()
        }
        if (hit != null) {
            target.setImageDrawable(hit)
            (hit as? android.graphics.drawable.Animatable)?.start()
        }
    }

    // -- Fetch + decode -----------------------------------------------------

    private fun fetch(context: Context, url: String, onLoad: ((Drawable) -> Unit)?) {
        // OUR HOSTS ONLY, COMPILED IN. [native/SPEC.md §4.1] Until now this
        // fetched whatever URL a config named, which made every key a possible
        // request to somebody else's server — a tracking pixel with a letter
        // printed on it. `asset`, `sf` and `emoji` never reach here; they need
        // no network. No config in the field uses a remote URL, so nothing
        // that ships today changes.
        if (!KbSafety.mayFetch(url)) return
        if (!inflight.add(url)) return
        io.execute {
            val bytes = downloadBytes(url)
            inflight.remove(url)
            if (bytes == null) return@execute
            val drawable = decode(context, bytes) ?: return@execute
            remember(url, drawable)
            writeDisk(context, url, bytes)
            if (onLoad != null) main.post { onLoad(drawable) }
        }
    }

    private fun downloadBytes(url: String): ByteArray? {
        return try {
            // A GET, so it takes the backend client's retry policy
            // (kb.network.retries — none by default, the single attempt this
            // always made). This runs on the io pool, never the main thread.
            val (code, bytes) = Net.getWithRetry { downloadOnce(url) }
            if (code in 200..299) bytes else null
        } catch (_: Throwable) {
            null
        }
    }

    /** One attempt: the status, and the body when it succeeded. Throws an
     *  IOException when there was no answer at all, so it can be retried. */
    private fun downloadOnce(url: String): Pair<Int, ByteArray?> {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = knobInt("kb.media.connectTimeoutMs", 5000)
            readTimeout = knobInt("kb.media.readTimeoutMs", 10000)
            // Not followed here either. HttpURLConnection follows by default,
            // so this older path would have handed the allow-list to whoever
            // can set a Location header — the one hole download() had closed.
            instanceFollowRedirects = false
        }
        try {
            val code = conn.responseCode
            if (code !in 200..299) return code to null
            conn.inputStream.use { input ->
                val out = ByteArrayOutputStream()
                val buf = ByteArray(16 * 1024)
                while (true) {
                    val n = input.read(buf)
                    if (n <= 0) break
                    out.write(buf, 0, n)
                }
                return code to out.toByteArray()
            }
        } finally {
            conn.disconnect()
        }
    }

    /**
     * Longest edge any decoded image is scaled down to, in px: the server's
     * number in dp (kb.images.maxEdgePx, the iOS knob, which iOS multiplies by
     * the screen scale the same way), 256 until a config says otherwise and
     * never above 2048. The mic art is the largest thing drawn from here and
     * is far smaller; a full-size frame of an animation is megabytes the IME
     * would hold for nothing.
     */
    private fun maxEdgePx(context: Context): Int {
        val v = knobFloat("kb.images.maxEdgePx", 256f)
        val edge = if (v > 0f) v.coerceAtMost(2048f) else 256f
        return Math.round(edge * context.resources.displayMetrics.density).coerceAtLeast(1)
    }

    private fun decode(context: Context, raw: ByteArray): Drawable? {
        val bytes = withFrameDelays(raw)
        // SDK 28+: ImageDecoder handles GIF + APNG natively, returning
        // AnimatedImageDrawable which starts + loops on its own once shown.
        if (Build.VERSION.SDK_INT >= 28) {
            return try {
                val src = ImageDecoder.createSource(java.nio.ByteBuffer.wrap(bytes))
                val max = maxEdgePx(context)
                ImageDecoder.decodeDrawable(src) { decoder, info, _ ->
                    // Scaled while decoding, every frame of an animation too, so
                    // the full-size image is never held at all.
                    val w = info.size.width
                    val h = info.size.height
                    val long = maxOf(w, h)
                    if (long > max) {
                        val s = max.toFloat() / long
                        decoder.setTargetSize(Math.round(w * s).coerceAtLeast(1), Math.round(h * s).coerceAtLeast(1))
                    }
                }
            } catch (_: Throwable) {
                // Fall through to static decode.
                staticBitmap(context, bytes)
            }
        }
        // Legacy path: try Movie for GIF, else static bitmap.
        val movie = Movie.decodeByteArray(bytes, 0, bytes.size)
        if (movie != null && movie.duration() > 0) {
            return MovieDrawable(movie)
        }
        return staticBitmap(context, bytes)
    }

    private fun staticBitmap(context: Context, bytes: ByteArray): Drawable? {
        // Same ceiling as the animated path: sample down by powers of two while
        // decoding, then scale the rest of the way.
        val max = maxEdgePx(context)
        val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
        android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        val srcLong = maxOf(bounds.outWidth, bounds.outHeight)
        var sample = 1
        while (srcLong / (sample * 2) >= max) sample *= 2
        val opts = android.graphics.BitmapFactory.Options().apply { inSampleSize = sample }
        val bmp = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts) ?: return null
        val long = maxOf(bmp.width, bmp.height)
        val out = if (long > max) {
            val s = max.toFloat() / long
            android.graphics.Bitmap.createScaledBitmap(
                bmp, Math.round(bmp.width * s).coerceAtLeast(1), Math.round(bmp.height * s).coerceAtLeast(1), true,
            )
        } else bmp
        return BitmapDrawable(context.resources, out)
    }

    // -- Frame delays -------------------------------------------------------

    /**
     * A frame whose file gives it no delay (0) plays for
     * kb.images.fallbackFrameDelaySec instead — 100ms until a config arrives,
     * which is what iOS gives it and how browsers play an "instant" gif — rather
     * than for however long this device's decoder decides. Android's decoders
     * take no default, so the number is written into a copy of the file before
     * it is decoded. Only GIF and APNG carry per-frame delays; anything else,
     * or a file this cannot walk, is decoded exactly as it came.
     */
    private fun withFrameDelays(bytes: ByteArray): ByteArray = try {
        val v = knobFloat("kb.images.fallbackFrameDelaySec", 0.1f)
        val sec = if (v > 0f) v else 0.1f
        when {
            bytes.size >= 13 && bytes[0] == 'G'.code.toByte() && bytes[1] == 'I'.code.toByte() && bytes[2] == 'F'.code.toByte() ->
                gifDelays(bytes, Math.round(sec * 100f).coerceIn(1, 65535))
            bytes.size >= 8 && bytes[0] == 0x89.toByte() && bytes[1] == 'P'.code.toByte() && bytes[2] == 'N'.code.toByte() && bytes[3] == 'G'.code.toByte() ->
                apngDelays(bytes, Math.round(sec * 1000f).coerceIn(1, 65535))
            else -> bytes
        }
    } catch (_: Throwable) { bytes }

    /** GIF: every Graphic Control Extension with a zero delay gets [centis]. */
    private fun gifDelays(src: ByteArray, centis: Int): ByteArray {
        val b = src.copyOf()
        fun u8(i: Int) = b[i].toInt() and 0xff
        // Sub-blocks run until a zero-length one; returns the index after it.
        fun skipBlocks(start: Int): Int {
            var j = start
            while (j < b.size) {
                val n = u8(j)
                j += 1
                if (n == 0) return j
                j += n
            }
            return b.size
        }
        var i = 13
        if (u8(10) and 0x80 != 0) i += 3 * (1 shl ((u8(10) and 7) + 1))
        var changed = false
        while (i + 1 < b.size) {
            when (u8(i)) {
                0x21 -> {
                    if (u8(i + 1) == 0xF9 && i + 5 < b.size && u8(i + 2) == 4 && u8(i + 4) == 0 && u8(i + 5) == 0) {
                        b[i + 4] = (centis and 0xff).toByte()
                        b[i + 5] = (centis shr 8).toByte()
                        changed = true
                    }
                    i = skipBlocks(i + 2)
                }
                0x2C -> {
                    if (i + 9 >= b.size) break
                    val packed = u8(i + 9)
                    i += 10
                    if (packed and 0x80 != 0) i += 3 * (1 shl ((packed and 7) + 1))
                    i = skipBlocks(i + 1) // past the LZW code size, then the data
                }
                else -> break // the trailer, or bytes this does not understand
            }
        }
        return if (changed) b else src
    }

    /** APNG: every fcTL chunk with a zero delay_num gets [ms]/1000, CRC redone. */
    private fun apngDelays(src: ByteArray, ms: Int): ByteArray {
        val b = src.copyOf()
        fun u32(i: Int) = ((b[i].toInt() and 0xff) shl 24) or ((b[i + 1].toInt() and 0xff) shl 16) or
            ((b[i + 2].toInt() and 0xff) shl 8) or (b[i + 3].toInt() and 0xff)
        var i = 8
        var changed = false
        while (i + 12 <= b.size) {
            val len = u32(i)
            if (len < 0 || i + 12 + len > b.size) break
            val type = String(b, i + 4, 4, Charsets.US_ASCII)
            val data = i + 8
            if (type == "fcTL" && len >= 26 && b[data + 20].toInt() == 0 && b[data + 21].toInt() == 0) {
                b[data + 20] = (ms shr 8).toByte()
                b[data + 21] = (ms and 0xff).toByte()
                b[data + 22] = (1000 shr 8).toByte()
                b[data + 23] = (1000 and 0xff).toByte()
                val crc = CRC32().apply { update(b, i + 4, 4 + len) }.value
                b[data + len] = (crc shr 24).toByte()
                b[data + len + 1] = (crc shr 16).toByte()
                b[data + len + 2] = (crc shr 8).toByte()
                b[data + len + 3] = crc.toByte()
                changed = true
            }
            if (type == "IEND") break
            i = data + len + 4
        }
        return if (changed) b else src
    }

    // -- Disk cache ---------------------------------------------------------

    private fun cacheDir(context: Context): File {
        val dir = File(context.filesDir, CACHE_DIR)
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    private fun cacheFile(context: Context, url: String): File {
        val crc = CRC32().apply { update(url.toByteArray()) }.value.toString(36)
        return File(cacheDir(context), "$crc.bin")
    }

    /** A cached file older than kb.images.maxAgeSec is dropped and fetched
     *  again. 0 (the default) = never expire, which is how this always behaved. */
    private fun readDisk(context: Context, url: String): Drawable? {
        return try {
            val f = cacheFile(context, url)
            if (!f.exists()) return null
            val maxAge = knobFloat("kb.images.maxAgeSec", 0f)
            if (maxAge > 0f && System.currentTimeMillis() - f.lastModified() > maxAge.toDouble() * 1000.0) {
                f.delete()
                return null
            }
            val bytes = f.readBytes()
            decode(context, bytes)
        } catch (_: Throwable) {
            null
        }
    }

    private fun writeDisk(context: Context, url: String, bytes: ByteArray) {
        try {
            cacheFile(context, url).writeBytes(bytes)
        } catch (_: Throwable) {
            /* best-effort — cache miss on next launch is fine */
        }
    }

    // -- Key faces ----------------------------------------------------------
    //
    // A key's print is not the mic art and must not be loaded like it.
    // [native/SPEC.md §2.9 "Keyboard faces"; keyboardFace.ts KEY_FACE_LIMITS]
    //
    //   - It is fetched ONCE, in the batch that follows the config, never in
    //     response to a key press. The renderer reads the cache and only the
    //     cache, so no request this keyboard makes can be lined up against a
    //     keystroke.
    //   - It is decoded at the KEY's size, not at kb.images.maxEdgePx — that
    //     knob is in POINTS and 256 of them is 768 px on a 3x phone, which is
    //     2.3 MB of bitmap for a print 40 px wide.
    //   - Animated raster is refused outright in format 1. Thirty animated
    //     keys is a different class of cost from one mic key; motion in a
    //     print is a `mark` with a `program`, which is geometry.
    //   - Every decoded face is counted against the live-image budget, and a
    //     key that would pass it draws its flat colour instead.

    /** Decoded face prints, by url and the px they were decoded at. */
    private val faces = ConcurrentHashMap<String, Bitmap>()

    /**
     * One file, fetched if it is not already on disk, with its size checked
     * before anything is decoded. Called only from the manifest's batch.
     */
    fun prefetch(context: Context, url: String, maxBytes: Int): Boolean {
        if (!KbSafety.mayFetch(url)) return false
        val f = cacheFile(context, url)
        if (f.exists() && f.length() in 1..maxBytes.toLong()) return false
        val bytes = download(url, maxBytes) ?: return false
        return try { f.writeBytes(bytes); true } catch (_: Throwable) { false }
    }

    /**
     * The bytes at [url], or null — refused when the host is not ours, when
     * the server declares more than [maxBytes], or when the body runs past
     * that while it is being read. Blocking; callers are already off the main
     * thread.
     *
     * Redirects are NOT followed. A redirect is a way out of the allow-list:
     * the host we checked answers with a Location on a host we did not, and
     * following it would hand the whole compiled gate back to whoever can set
     * that header. Our own art is content-addressed and served directly.
     */
    fun download(url: String, maxBytes: Int): ByteArray? {
        if (!KbSafety.mayFetch(url)) return null
        return try {
            val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = knobInt("kb.media.connectTimeoutMs", 5000)
                readTimeout = knobInt("kb.media.readTimeoutMs", 10000)
                instanceFollowRedirects = false
            }
            try {
                if (conn.responseCode !in 200..299) return null
                if (conn.contentLength > maxBytes) return null
                conn.inputStream.use { input ->
                    val out = ByteArrayOutputStream()
                    val buf = ByteArray(16 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n <= 0) break
                        if (out.size() + n > maxBytes) return null
                        out.write(buf, 0, n)
                    }
                    out.toByteArray()
                }
            } finally {
                conn.disconnect()
            }
        } catch (_: Throwable) {
            null
        }
    }

    /**
     * A key print, decoded at the key's own size, from the cache alone.
     *
     * Null means "draw the flat colour this session": the file never arrived,
     * it is not a static PNG, or the budget is spent. None of those is worth a
     * network round trip in the middle of someone typing.
     */
    fun faceBitmap(context: Context, url: String, maxPx: Int): Bitmap? {
        val px = maxPx.coerceIn(1, 512)
        val bmp = decodeFace(context, url, px) ?: return null
        // THE BUDGET IS CLAIMED ON EVERY ATTACH, memo hits included. It counts
        // what is attached to live key views, and resetBudgets() runs at the
        // top of every build; claiming only on the decode meant that from the
        // second build on, nothing was counted at all.
        if (!KbSkin.claimImage(bmp.width.toLong() * bmp.height.toLong() * 4L)) return null
        return bmp
    }

    /**
     * Decode a fetched file into the memo WITHOUT claiming budget, on the
     * batch thread. The build that follows then only reads the memo: without
     * this, the first rebuild after a batch decodes up to 24 PNGs on the main
     * thread. [H12-Q5]
     */
    fun warmFace(context: Context, url: String, maxPx: Int) {
        try { decodeFace(context, url, maxPx.coerceIn(1, 512)) } catch (_: Throwable) {}
    }

    /** The decode itself, memoised per (file, px). No budget, no main-thread
     *  assumption: both callers above are explicit about which they are. */
    private fun decodeFace(context: Context, url: String, px: Int): Bitmap? {
        val key = "$url|$px"
        faces[key]?.let { return it }
        val f = cacheFile(context, url)
        if (!f.exists()) return null
        return try {
            val bytes = f.readBytes()
            if (!isStaticPng(bytes)) return null
            val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
            android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            val srcLong = maxOf(bounds.outWidth, bounds.outHeight)
            if (srcLong <= 0) return null
            var sample = 1
            while (srcLong / (sample * 2) >= px) sample *= 2
            val opts = android.graphics.BitmapFactory.Options().apply { inSampleSize = sample }
            var bmp = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts) ?: return null
            val long = maxOf(bmp.width, bmp.height)
            if (long > px) {
                val s = px.toFloat() / long
                bmp = android.graphics.Bitmap.createScaledBitmap(
                    bmp, Math.round(bmp.width * s).coerceAtLeast(1), Math.round(bmp.height * s).coerceAtLeast(1), true,
                )
            }
            faces[key] = bmp
            bmp
        } catch (_: Throwable) {
            null
        }
    }

    /**
     * A still PNG, and nothing else. An APNG announces itself with an `acTL`
     * chunk before the first `IDAT`; a GIF or a WebP is not a PNG at all.
     */
    private fun isStaticPng(b: ByteArray): Boolean {
        if (b.size < 8) return false
        if (b[0] != 0x89.toByte() || b[1] != 'P'.code.toByte() ||
            b[2] != 'N'.code.toByte() || b[3] != 'G'.code.toByte()
        ) return false
        var i = 8
        while (i + 8 <= b.size) {
            val len = ((b[i].toInt() and 0xff) shl 24) or ((b[i + 1].toInt() and 0xff) shl 16) or
                ((b[i + 2].toInt() and 0xff) shl 8) or (b[i + 3].toInt() and 0xff)
            if (len < 0) return false
            val type = String(b, i + 4, 4, Charsets.US_ASCII)
            if (type == "acTL") return false
            if (type == "IDAT" || type == "IEND") return true
            if (i + 12L + len > b.size) return false
            i += 12 + len
        }
        return false
    }

    /**
     * Every print goes when the skin does: a new skin is new files.
     *
     * Called from [KbSkin.arm] whenever the armed skin's sha changes, and from
     * [purgeMemory] when the system asks for memory back. Those are the only
     * two; the map is otherwise write-only, and nothing in it is counted by
     * the live-image budget.
     */
    fun purgeFaces() {
        faces.clear()
    }
}

/**
 * Simple Movie-backed drawable for SDK < 28 GIF playback. Advances the frame
 * on every draw pass using the drawable's own [invalidateSelf] callback so
 * the framework handles the timer.
 */
private class MovieDrawable(private val movie: Movie) : Drawable() {
    private var start = 0L
    override fun draw(canvas: android.graphics.Canvas) {
        if (start == 0L) start = android.os.SystemClock.uptimeMillis()
        val dur = movie.duration().coerceAtLeast(1)
        val now = (android.os.SystemClock.uptimeMillis() - start).toInt() % dur
        movie.setTime(now)
        val sx = bounds.width().toFloat() / movie.width().toFloat()
        val sy = bounds.height().toFloat() / movie.height().toFloat()
        canvas.save()
        canvas.scale(sx, sy)
        movie.draw(canvas, 0f, 0f)
        canvas.restore()
        invalidateSelf()
    }
    override fun setAlpha(alpha: Int) {}
    override fun setColorFilter(colorFilter: android.graphics.ColorFilter?) {}
    override fun getOpacity(): Int = android.graphics.PixelFormat.TRANSLUCENT
    override fun getIntrinsicWidth() = movie.width()
    override fun getIntrinsicHeight() = movie.height()
}
