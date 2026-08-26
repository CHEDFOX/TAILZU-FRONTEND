package com.tulmi.app.keyboard

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

/**
 * Keyboard diagnostics — COUNTERS ONLY. The Android half of
 * KeyboardTelemetry.swift, hitting the same endpoint with the same names.
 *
 * A keyboard sees everything the user types, so this is built so that leaking
 * content is impossible rather than unlikely: the only thing it can hold is an
 * integer per named counter. There is no API here that accepts user text, and
 * the backend independently allowlists names and rejects non-numeric values.
 *
 * Why it exists at all: without it Android ships blind. iOS spent fourteen
 * builds unmeasured and the cost of that showed up as questions nobody could
 * answer — whether a touch fix helped, whether a correction was wanted. Doing
 * the same thing again on a second platform would be a choice, not an
 * oversight.
 *
 * Cost discipline — this runs on the typing hot path:
 *   • bump() is a map increment. No I/O, no allocation per keystroke.
 *   • Persistence is SharedPreferences on a throttle and on teardown, NOT per
 *     keystroke, so counters survive the service being killed without paying a
 *     write per key.
 *   • Upload piggybacks the config refresh the service already performs.
 */
object TulmiTelemetry {
    /**
     * Counter names the backend accepts. Kept in sync with TELEMETRY_COUNTERS
     * in server.ts and with the Swift enum — an unknown name is dropped
     * server-side, so a typo here is silent data loss rather than an error.
     */
    const val KEYSTROKES = "keystrokes"
    const val AUTOCORRECT_APPLIED = "autocorrectApplied"
    const val AUTOCORRECT_REVERTED = "autocorrectReverted"
    const val SUGGESTION_ACCEPTED = "suggestionAccepted"
    const val SWIPE_COMMITTED = "swipeCommitted"
    const val ACCENT_TRAY_OPENED = "accentTrayOpened"
    const val TRACKPAD_USED = "trackpadUsed"
    const val MIC_TAPS = "micTaps"
    const val DICTATION_COMMITTED = "dictationCommitted"
    const val REFINE_REQUESTED = "refineRequested"
    const val REFINE_FAILED = "refineFailed"
    const val TONE_CHANGED = "toneChanged"
    const val VOICE_CHANGED = "voiceChanged"
    const val COLD_STARTS = "coldStarts"

    private const val PREFS = "tulmi.kb.telemetry"
    private const val KEY_COUNTERS = "counters"
    private const val KEY_WINDOW_START = "windowStart"

    /** Persist at most this often. Typing bursts hundreds of events; writing
     *  each one would put a disk commit on the keystroke path. */
    private const val PERSIST_THROTTLE_MS = 20_000L
    /** Don't upload more often than this — config refreshes on every keyboard
     *  open, which for a heavy user is dozens of times an hour. */
    private const val UPLOAD_INTERVAL_MS = 30L * 60_000L

    private val lock = Any()
    private val counters = HashMap<String, Int>()
    private var lastPersist = 0L
    private var windowStart = 0L
    private var loaded = false

    private fun prefs(ctx: Context): SharedPreferences =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Restore anything a previous session left behind. Safe to call repeatedly. */
    fun load(ctx: Context) {
        synchronized(lock) {
            if (loaded) return
            loaded = true
            val p = prefs(ctx)
            windowStart = p.getLong(KEY_WINDOW_START, 0L)
            if (windowStart == 0L) windowStart = System.currentTimeMillis()
            val raw = p.getString(KEY_COUNTERS, null) ?: return
            runCatching {
                val obj = JSONObject(raw)
                for (k in obj.keys()) counters[k] = obj.optInt(k, 0)
            }
        }
    }

    /** Increment one counter. The only way anything gets in here. */
    fun bump(name: String, by: Int = 1) {
        synchronized(lock) { counters[name] = (counters[name] ?: 0) + by }
    }

    /** Write to disk, but not more than once per throttle window. Pass
     *  force=true on teardown, where this is the last chance to keep them. */
    fun persist(ctx: Context, force: Boolean = false) {
        synchronized(lock) {
            val now = System.currentTimeMillis()
            if (!force && now - lastPersist < PERSIST_THROTTLE_MS) return
            lastPersist = now
            val obj = JSONObject()
            for ((k, v) in counters) obj.put(k, v)
            prefs(ctx).edit()
                .putString(KEY_COUNTERS, obj.toString())
                .putLong(KEY_WINDOW_START, windowStart)
                .apply()
        }
    }

    /**
     * The batch to send, or null when there is nothing worth sending yet.
     * Returns a snapshot — the counters are NOT cleared here, because a failed
     * request must not cost the data. Call [commitUpload] only once the POST
     * succeeded.
     */
    fun pendingUpload(ctx: Context): Pair<JSONObject, Long>? {
        load(ctx)
        synchronized(lock) {
            val now = System.currentTimeMillis()
            val windowMs = now - windowStart
            if (windowMs < UPLOAD_INTERVAL_MS) return null
            if (counters.isEmpty()) return null
            val obj = JSONObject()
            for ((k, v) in counters) if (v > 0) obj.put(k, v)
            if (obj.length() == 0) return null
            return obj to windowMs
        }
    }

    /**
     * Clear what was actually sent. Subtraction, not clear(): anything counted
     * while the request was in flight belongs to the next window rather than
     * being thrown away.
     */
    fun commitUpload(ctx: Context, sent: JSONObject) {
        synchronized(lock) {
            for (k in sent.keys()) {
                val was = counters[k] ?: 0
                val n = was - sent.optInt(k, 0)
                if (n > 0) counters[k] = n else counters.remove(k)
            }
            windowStart = System.currentTimeMillis()
        }
        persist(ctx, force = true)
    }
}
