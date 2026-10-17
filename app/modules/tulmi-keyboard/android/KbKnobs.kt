package com.tulmi.app.keyboard

import org.json.JSONArray
import org.json.JSONObject

/**
 * Knobs for the parts of the keyboard that are not the renderer — Net, the
 * stream, autocorrect, telemetry, the image loader, the service glue.
 *
 * Those files had no way to ask the server anything, so their numbers,
 * endpoints and strings were literals. Now they call
 * knobFloat("kb.network.timeoutMs", 15000f) and the value comes from the last
 * config the keyboard applied (or the one it shipped with), falling back to
 * the literal only before any config.
 *
 * Every key read here is collected by tools/knobs/extract-keyboard.mjs, and
 * the backend sends each one explicitly.
 */
object KbKnobs {
    @Volatile private var flags: JSONObject = JSONObject()
    @Volatile private var labels: JSONObject = JSONObject()

    /** Point the knobs at a config (the raw JSON the server sent). */
    fun update(json: String) {
        try {
            val o = JSONObject(json)
            flags = o.optJSONObject("flags") ?: JSONObject()
            labels = o.optJSONObject("labels") ?: JSONObject()
        } catch (_: Exception) { /* keep the last good knobs */ }
    }

    internal fun flag(key: String): Any? = if (flags.has(key) && !flags.isNull(key)) flags.opt(key) else null
    internal fun label(key: String): String? = if (labels.has(key)) labels.optString(key) else null
}

/** Finite, or the fallback: "NaN" or 1e39 from the console is no number. */
fun knobFloat(key: String, fallback: Float): Float {
    val f = when (val v = KbKnobs.flag(key)) {
        is Number -> v.toFloat()
        is String -> v.toFloatOrNull() ?: return fallback
        else -> return fallback
    }
    return if (f.isNaN() || f.isInfinite()) fallback else f
}

fun knobInt(key: String, fallback: Int): Int = knobFloat(key, fallback.toFloat()).toInt()

fun knobLong(key: String, fallback: Long): Long = when (val v = KbKnobs.flag(key)) {
    is Number -> v.toDouble().let { if (it.isNaN() || it.isInfinite()) fallback else v.toLong() }
    is String -> v.toDoubleOrNull()?.takeIf { !it.isNaN() && !it.isInfinite() }?.toLong() ?: fallback
    else -> fallback
}

/** Read the way the renderer's flagBoolean reads: a console "false" or 0 is
 *  off, not ignored — these are the kill switches. */
fun knobBool(key: String, fallback: Boolean): Boolean = when (val v = KbKnobs.flag(key)) {
    is Boolean -> v
    is Number -> v.toDouble() != 0.0
    is String -> when (v.trim().lowercase()) {
        "true", "1", "yes" -> true
        "false", "0", "no" -> false
        else -> fallback
    }
    else -> fallback
}

fun knobString(key: String, fallback: String): String = (KbKnobs.flag(key) as? String) ?: fallback

/** A list of strings (patterns, words, ids) — the fallback until one arrives. */
fun knobStrings(key: String, fallback: List<String>): List<String> {
    val a = KbKnobs.flag(key) as? JSONArray ?: return fallback
    return (0 until a.length()).mapNotNull { a.optString(it, "").takeIf { s -> s.isNotEmpty() } }
}

fun knobLabel(key: String, fallback: String): String = KbKnobs.label(key) ?: fallback
