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

    /** Key faces (KeySkin1). [H10-Q2] A print drawn, a print refused (budget,
     *  missing art, a file that is not a still PNG), and a session the crash
     *  guard put in plain mode. The server allowlists these three names. */
    const val FACE_PAINTED = "facePainted"
    const val FACE_DROPPED = "faceDropped"
    const val SKIN_PLAIN_SESSIONS = "skinPlainSessions"

    private const val PREFS = "tulmi.kb.telemetry"
    private const val KEY_COUNTERS = "counters"
    private const val KEY_WINDOW_START = "windowStart"

    /** The window's skin tag, and whether the window saw more than one. */
    private const val KEY_WINDOW_SKIN = "windowSkin"
    private const val KEY_WINDOW_MIXED = "windowMixed"

    /** What was drawing when this process last heard. [H18] The IME process
     *  dies far more often than a window ends, and the first bump after a
     *  cold start (COLD_STARTS itself) lands before the service has worked
     *  out its verdict — so without this the window would be tagged null and
     *  then marked mixed, and a perfectly stable skin would upload untagged. */
    private const val KEY_DRAWING = "drawing"

    /** Persist at most this often. Typing bursts hundreds of events; writing
     *  each one would put a disk commit on the keystroke path. The server's
     *  number, in seconds as iOS reads it (kb.telemetry.persistSec). */
    private fun persistThrottleMs(): Long = (knobFloat("kb.telemetry.persistSec", 20f).toDouble() * 1000.0).toLong()
    /** Don't upload more often than this — config refreshes on every keyboard
     *  open, which for a heavy user is dozens of times an hour. Seconds, as on
     *  iOS (kb.telemetry.uploadIntervalSec). */
    private fun uploadIntervalMs(): Long = (knobFloat("kb.telemetry.uploadIntervalSec", 1800f).toDouble() * 1000.0).toLong()

    /** The server's off switch: counting and uploading both stop. */
    private fun enabled(): Boolean = knobBool("kb.telemetry.enabled", true)

    private val lock = Any()
    private val counters = HashMap<String, Int>()
    private var lastPersist = 0L
    private var windowStart = 0L
    private var loaded = false

    // -- the window's skin tag [H10-Q2] -------------------------------------
    //
    // A window of counters is up to half an hour long, and in that time the
    // person can pick another skin or the guard can drop into plain mode. The
    // tag is therefore taken at the window's FIRST bump and checked at every
    // one after it: a window that saw two different answers uploads with no
    // skin at all, because a wrong tag is worse than none — it would stop the
    // wrong skin. Nothing reads the skin off the upload thread.

    /** What a bump would tag right now: the live skin id, or null in plain
     *  mode and on an unskinned config. Set by the service. */
    @Volatile private var liveSkin: String? = null

    private var windowSkin: String? = null
    private var windowSkinSet = false
    private var windowMixed = false

    /**
     * The skin the keyboard is drawing from this moment on, or null for plain
     * mode and for a config with no skin. Called when a config is applied and
     * when the guard changes its verdict.
     *
     * It is also written to disk, so the next process starts out knowing what
     * was drawing instead of counting its own cold start as a skin change.
     * `apply()` is right here: this runs on a config apply or a verdict
     * change, never on the keystroke path.
     */
    fun noteSkin(ctx: Context, id: String?) {
        val now = id?.trim()?.takeIf { it.isNotEmpty() }
        liveSkin = now
        runCatching { prefs(ctx).edit().putString(KEY_DRAWING, now.orEmpty()).apply() }
    }

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
            // A window outlives the process, so its tag has to as well.
            windowSkin = p.getString(KEY_WINDOW_SKIN, null)?.takeIf { it.isNotEmpty() }
            windowSkinSet = p.contains(KEY_WINDOW_SKIN)
            windowMixed = p.getBoolean(KEY_WINDOW_MIXED, false)
            // What was drawing when the last process was last heard from.
            // Restored BEFORE anything can bump, so the cold start itself is
            // tagged with the skin that is about to draw again. If the guard
            // then says something else, the next noteSkin corrects it and the
            // window is genuinely mixed.
            if (p.contains(KEY_DRAWING)) {
                liveSkin = p.getString(KEY_DRAWING, null)?.takeIf { it.isNotEmpty() }
            }
            val raw = p.getString(KEY_COUNTERS, null) ?: return
            runCatching {
                val obj = JSONObject(raw)
                for (k in obj.keys()) counters[k] = obj.optInt(k, 0)
            }
        }
    }

    /** Increment one counter. The only way anything gets in here. */
    fun bump(name: String, by: Int = 1) {
        if (!enabled()) return
        synchronized(lock) {
            counters[name] = (counters[name] ?: 0) + by
            val now = liveSkin
            if (!windowSkinSet) {
                windowSkin = now
                windowSkinSet = true
            } else if (windowSkin != now) {
                windowMixed = true
            }
        }
    }

    /** Write to disk, but not more than once per throttle window. Pass
     *  force=true on teardown, where this is the last chance to keep them. */
    fun persist(ctx: Context, force: Boolean = false) {
        synchronized(lock) {
            val now = System.currentTimeMillis()
            if (!force && now - lastPersist < persistThrottleMs()) return
            lastPersist = now
            val obj = JSONObject()
            for ((k, v) in counters) obj.put(k, v)
            val e = prefs(ctx).edit()
                .putString(KEY_COUNTERS, obj.toString())
                .putLong(KEY_WINDOW_START, windowStart)
                .putBoolean(KEY_WINDOW_MIXED, windowMixed)
            if (windowSkinSet) e.putString(KEY_WINDOW_SKIN, windowSkin.orEmpty())
            else e.remove(KEY_WINDOW_SKIN)
            e.apply()
        }
    }

    /**
     * The batch to send, or null when there is nothing worth sending yet.
     * Returns a snapshot — the counters are NOT cleared here, because a failed
     * request must not cost the data. Call [commitUpload] only once the POST
     * succeeded.
     */
    fun pendingUpload(ctx: Context): Batch? {
        if (!enabled()) return null
        load(ctx)
        synchronized(lock) {
            val now = System.currentTimeMillis()
            val windowMs = now - windowStart
            if (windowMs < uploadIntervalMs()) return null
            if (counters.isEmpty()) return null
            val obj = JSONObject()
            for ((k, v) in counters) if (v > 0) obj.put(k, v)
            if (obj.length() == 0) return null
            // The tag travels WITH the counters, worked out here under the
            // lock, so the upload thread never reads the live skin.
            return Batch(obj, windowMs, if (windowMixed) null else windowSkin)
        }
    }

    /** One window's counters, how long it ran, and the skin that drew all of
     *  it (null when there was none, or when the window saw more than one). */
    class Batch(val counters: JSONObject, val windowMs: Long, val skin: String?)

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
            // A new window takes its tag from its own first bump.
            windowSkin = null
            windowSkinSet = false
            windowMixed = false
        }
        persist(ctx, force = true)
    }
}
