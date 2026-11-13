package com.tulmi.app.keyboard

import android.content.Context
import org.json.JSONObject
import java.security.MessageDigest

/**
 * THE CRASH GUARD, PORTED TO THE ANDROID IME. [native/SPEC.md §3.7, §4.1]
 *
 * iOS has had one for a while; Android has had none at all, so a config that
 * killed the keyboard killed it again at every open, for ever. This is the
 * same idea, with the one fix the spec calls for on both platforms:
 *
 *   **A trial is cleared only by a CLEAN FINISH, never by a timer.** The iOS
 *   guard cleared its trial 20 seconds in, which meant it only ever caught a
 *   crash during the first draw. The deaths that skins will actually cause —
 *   the memory death once art and animated keys have built up — happen later
 *   than that. So the mark goes down when a config is applied and comes up in
 *   onFinishInputView. Anything that ends the process in between is a strike.
 *
 * WHAT A STRIKE COSTS, in order:
 *   1 strike   nothing. Phones get killed for being in the background.
 *   2 strikes  PLAIN MODE for that config's sha: `face`, `press`, `fontFamily`
 *              and face art are ignored, the tree and the colours stay — those
 *              are today's features and they were never the suspect. The next
 *              config request carries X-Tulmi-Keyboard-Bad, so the server
 *              answers with the unskinned tree and the phone stops guessing.
 *   4 strikes, or 2 on a config with no skin at all: the cached config is
 *              dropped and the bundled snapshot draws. That is today's
 *              behaviour and the bundled snapshot has no faces, so it cannot
 *              be the thing that is crashing.
 *
 * Nothing here leaves the device. A sha is a hash of bytes the server itself
 * sent us; the skin id is the server's own name for a skin.
 */
object KbGuard {

    /**
     * THE GUARD'S OWN FILE. It used to share `tulmi_kb` with `config_json`,
     * and beginTrial/finishTrial write through with commit() — so every hide
     * and every show synchronously rewrote the whole cached config, on the
     * main thread, to change one short string. [H12-Q6.5]
     *
     * Excluded from device-transfer in res/xml/tailzu_data_extraction_rules.xml,
     * so a new phone does not inherit this phone's strikes.
     */
    private const val PREFS = "tulmi_kb_guard"

    /**
     * THIS PROCESS. A trial is "$sha $LAUNCH", and only a trial left by
     * ANOTHER launch is a strike. [H12-Q6.1]
     *
     * res/xml/method.xml declares no configChanges, so a rotation or a
     * light/dark flip tears the input view down and calls onCreateInputView
     * again WITHOUT onFinishInputView. Without this, turning the phone twice
     * with the keyboard up was two strikes, and two strikes on an unskinned
     * config drops the served keyboard to the bundled snapshot. Nothing about
     * that is launch dark: it would have happened to every user on day one.
     *
     * This is the same rule §3.7 already gives the widget guard.
     */
    private val LAUNCH: String = java.util.UUID.randomUUID().toString()

    /** The config whose session is open right now, as "<sha> <launch>". */
    private const val KEY_TRIAL = "kbguard.trial"

    /** Strikes per config sha, as a small JSON object. */
    private const val KEY_STRIKES = "kbguard.strikes"

    /** The skin the guard struck on, for X-Tulmi-Keyboard-Bad. */
    private const val KEY_BAD_SKIN = "kbguard.badSkin"

    /** That skin's sha when it was refused, so a REPUBLISHED skin of the same
     *  name is tried again instead of being refused for the life of the
     *  install. See [markBadSkin]. */
    private const val KEY_BAD_SHA = "kbguard.badSkinSha"

    /** Strikes before the faces go, and before the whole config goes. */
    private const val PLAIN_AT = 2
    private const val DROP_AT = 4

    /** How many shas the ledger remembers. Old configs are never coming back. */
    private const val LEDGER_MAX = 8

    /** What a config is allowed to draw this session. */
    enum class Verdict {
        /** Draw everything the config asks for. */
        FULL,

        /** Draw the tree and the colours; ignore face, press, fontFamily, art. */
        PLAIN,

        /** Do not use this config at all — fall through to the bundled one. */
        DROP,
    }

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** SHA-256 of the raw config, hex. The guard's whole key. */
    fun shaOf(rawJson: String): String = try {
        MessageDigest.getInstance("SHA-256")
            .digest(rawJson.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    } catch (_: Throwable) {
        // No SHA-256 on this device is not a thing, but a guard that throws is
        // worse than a guard that does nothing.
        ""
    }

    // -- the ledger ---------------------------------------------------------

    private fun ledger(context: Context): JSONObject = try {
        JSONObject(prefs(context).getString(KEY_STRIKES, "{}") ?: "{}")
    } catch (_: Throwable) {
        JSONObject()
    }

    private fun writeLedger(context: Context, o: JSONObject) {
        // Keep it small: the oldest keys go once there are too many. Insertion
        // order is JSONObject's own, which is enough for a ledger of 8.
        var trimmed = o
        if (o.length() > LEDGER_MAX) {
            trimmed = JSONObject()
            val keys = o.keys().asSequence().toList()
            for (k in keys.takeLast(LEDGER_MAX)) trimmed.put(k, o.opt(k))
        }
        prefs(context).edit().putString(KEY_STRIKES, trimmed.toString()).apply()
    }

    fun strikes(context: Context, sha: String): Int =
        if (sha.isEmpty()) 0 else ledger(context).optInt(sha, 0)

    // -- the trial ----------------------------------------------------------

    /**
     * Called once as the keyboard comes up, BEFORE anything is built.
     *
     * A trial still open here, written by a DIFFERENT launch, belongs to a
     * session that never finished: the process went away with the keyboard on
     * screen. That is the strike. A trial from this same launch is the input
     * view being re-created — a rotation, a light/dark flip — and it is not.
     */
    fun openSession(context: Context) {
        val open = prefs(context).getString(KEY_TRIAL, "").orEmpty()
        if (open.isEmpty()) return
        val sha = open.substringBefore(' ')
        val launch = open.substringAfter(' ', "")
        val strike = sha.isNotEmpty() &&
            launch != LAUNCH &&                      // same process = a rebuild, not a death
            !diedForAReasonOfOurOwn(context)         // an app update or a force-stop
        if (strike) {
            val l = ledger(context)
            l.put(sha, l.optInt(sha, 0) + 1)
            writeLedger(context, l)
        }
        // The ledger first, then the marker, written THROUGH: a process that
        // dies between the two loses a strike, which is nothing. The other
        // order could count one death twice.
        prefs(context).edit().remove(KEY_TRIAL).commit()
    }

    /**
     * Whether the last time this process went away, it was because somebody
     * asked. The IME runs in the app's own process (the config plugin sets no
     * android:process), so an app update, a force-stop from Settings or a
     * "stop" from the task switcher would otherwise each count as a crash.
     */
    private fun diedForAReasonOfOurOwn(context: Context): Boolean = try {
        if (android.os.Build.VERSION.SDK_INT < 30) false else {
            val am = context.getSystemService(android.app.ActivityManager::class.java)
            val last = am?.getHistoricalProcessExitReasons(context.packageName, 0, 1)?.firstOrNull()
            when (last?.reason) {
                android.app.ApplicationExitInfo.REASON_PACKAGE_UPDATED,
                android.app.ApplicationExitInfo.REASON_USER_REQUESTED,
                android.app.ApplicationExitInfo.REASON_USER_STOPPED,
                -> true
                else -> false
            }
        }
    } catch (_: Throwable) {
        false
    }

    /**
     * A config (and its prefetched art) is on screen. Written through, not
     * posted: the process may not get another chance.
     *
     * Called at every show, not only the first — see the service. The marker
     * carries this launch, so re-arming it costs nothing and the LATE deaths
     * the guard exists for (memory, once art and prints have built up) are
     * inside a trial instead of outside one.
     */
    fun beginTrial(context: Context, sha: String) {
        if (sha.isEmpty()) return
        prefs(context).edit().putString(KEY_TRIAL, "$sha $LAUNCH").commit()
    }

    /**
     * A clean finish: the keyboard went away on purpose.
     *
     * The trial closes, and the strikes toward DROPPING come back down,
     * because they must be IN A ROW, as they are on iOS. Without this the
     * ledger only ever grows, so two unrelated deaths weeks apart drop a
     * config that works.
     *
     *   unskinned           → 0. Nothing is held against it.
     *   skinned, 2 or more  → back to 2. Plain mode sticks (it is the safe
     *                         mode, and the server has been told), and
     *                         dropping needs two more deaths in a row.
     *   skinned, below 2    → unchanged. Strikes toward plain mode add up
     *                         across sessions, as iOS's skinSuspect does.
     */
    fun finishTrial(context: Context, sha: String = "", skinned: Boolean = false) {
        prefs(context).edit().remove(KEY_TRIAL).commit()
        if (sha.isEmpty()) return
        val l = ledger(context)
        val n = l.optInt(sha, 0)
        if (n == 0) return
        when {
            !skinned -> l.remove(sha)
            n > PLAIN_AT -> l.put(sha, PLAIN_AT)
            else -> return
        }
        writeLedger(context, l)
    }

    // -- the verdict --------------------------------------------------------

    /**
     * What this config may draw. [skinned] is whether it carries a `skin`
     * block at all — an unskinned config that keeps dying is not a face
     * problem, so there is no plain mode worth trying and it goes straight to
     * the bundled snapshot.
     */
    fun verdict(context: Context, sha: String, skinned: Boolean): Verdict {
        val n = strikes(context, sha)
        return when {
            n >= DROP_AT -> Verdict.DROP
            n >= PLAIN_AT && !skinned -> Verdict.DROP
            n >= PLAIN_AT -> Verdict.PLAIN
            else -> Verdict.FULL
        }
    }

    /**
     * Remember which skin we are refusing, so the next config request can say
     * so and the server can send the unskinned tree instead of us drawing half
     * of one for ever.
     *
     * THE MARK IS AGAINST THIS VERSION OF THE SKIN, NOT ITS NAME FOR EVER.
     * Once the server honours the header it sends the UNSKINNED tree, so no
     * skin ever draws cleanly again and [clearBadSkin] — which only fires for
     * a session that drew the same skin — can never run. A skin fixed on the
     * server would stay refused on this phone for the life of the install.
     * So the sha goes down with the id, and [noteSkinVersion] lifts the mark
     * the moment a skin of that name arrives with different bytes. A skin
     * republished unchanged stays refused, which is the point.
     */
    fun markBadSkin(context: Context, skinId: String, skinSha: String = "") {
        if (skinId.isEmpty()) return
        prefs(context).edit()
            .putString(KEY_BAD_SKIN, skinId)
            .putString(KEY_BAD_SHA, skinSha)
            .apply()
    }

    /**
     * A skin of this name is on the way in. When it is the one we refused but
     * its bytes have changed, it has been republished: forget the mark and let
     * it draw. Called before the verdict is acted on, so a skin that is still
     * broken simply strikes again.
     */
    fun noteSkinVersion(context: Context, skinId: String, skinSha: String) {
        if (skinId.isEmpty() || skinId != badSkin(context)) return
        val had = prefs(context).getString(KEY_BAD_SHA, "").orEmpty()
        // An empty stored sha is a mark from a build before this field, or a
        // skin the server sent without one: nothing to compare, so it stands.
        if (had.isEmpty() || had == skinSha) return
        prefs(context).edit().remove(KEY_BAD_SKIN).remove(KEY_BAD_SHA).apply()
    }

    /** The value of X-Tulmi-Keyboard-Bad, or "" when there is nothing to say. */
    fun badSkin(context: Context): String =
        prefs(context).getString(KEY_BAD_SKIN, "").orEmpty()

    /**
     * A skin drew a whole session without dying. Forget it was ever suspect —
     * otherwise one bad night marks a skin for the life of the install.
     */
    fun clearBadSkin(context: Context, skinId: String) {
        if (skinId.isEmpty()) return
        if (badSkin(context) == skinId) {
            prefs(context).edit().remove(KEY_BAD_SKIN).remove(KEY_BAD_SHA).apply()
        }
    }
}
