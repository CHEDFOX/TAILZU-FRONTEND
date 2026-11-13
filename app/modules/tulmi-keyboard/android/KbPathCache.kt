package com.tulmi.app.keyboard

import android.graphics.Path
import android.graphics.RectF

/**
 * PARSED PATHS, KEPT. [native/SPEC.md §2.4, §4.4]
 *
 * `KbPath.parse` walks up to 900 characters of grammar and builds a new
 * `Path`; `KbPath.centre` walks the same string a second time. That is fine
 * once. The mic key is not once: while it is playing it asks for the next
 * frame every time it draws, so a mark with a few long `path` shapes was
 * parsing hundreds of strings and allocating hundreds of `Path`s a second, on
 * the thread that also takes the next keystroke. On a cheap phone that is
 * visible as jank, and the garbage is all of it avoidable: the `d` string does
 * not change between frames.
 *
 * So a `d` is parsed once and its `Path` and centre are kept here, keyed by
 * the string itself. A config change needs no invalidation — different bytes
 * are a different key — and the map is bounded, so a server that sends a
 * thousand different marks costs the last few dozen and nothing more.
 *
 * THE PATH THIS HANDS BACK IS SHARED AND MUST NOT BE CHANGED. Callers that
 * need it moved or scaled transform it INTO a path of their own
 * (`src.transform(matrix, dst)`), which leaves the master alone. A path that
 * does not parse is remembered as a miss, so a bad `d` is not re-parsed on
 * every frame either.
 */
object KbPathCache {

    /** How many distinct `d` strings are remembered. A mark has a handful of
     *  shapes; this is several marks' worth and a few kilobytes. */
    private const val MAX = 48

    /** A parse, good or bad. A miss carries nulls and is cached all the same. */
    private class Entry(val path: Path?, val centre: FloatArray?)

    private val MISS = Entry(null, null)

    /** Access-ordered, so the paths actually being drawn are the ones kept. */
    private val cache = object : LinkedHashMap<String, Entry>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Entry>): Boolean =
            size > MAX
    }

    private fun entry(d: String?): Entry {
        val s = d?.trim().orEmpty()
        if (s.isEmpty() || s.length > KbPath.MAX_D_CHARS) return MISS
        synchronized(cache) { cache[s] }?.let { return it }
        // Parsed outside the lock: two threads parsing the same path once each
        // is cheaper than either waiting, and the result is the same bytes.
        val e = try {
            val p = KbPath.parse(s)
            if (p == null) MISS else {
                val r = RectF()
                p.computeBounds(r, true)
                Entry(p, floatArrayOf(r.centerX(), r.centerY()))
            }
        } catch (_: Throwable) {
            MISS
        }
        synchronized(cache) { cache[s] = e }
        return e
    }

    /** The shared `Path` for [d], or null. Transform it into your own path. */
    fun path(d: String?): Path? = entry(d).path

    /** The centre of the box around [d]'s points, in the caller's own units. */
    fun centre(d: String?): FloatArray? = entry(d).centre

    /** Let the lot go. The service calls this when the system asks for memory
     *  back; everything here is rebuilt from the config on the next frame. */
    fun clear() {
        synchronized(cache) { cache.clear() }
    }
}
