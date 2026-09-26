package com.tulmi.app.keyboard

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * The tone pill's model — the Android twin of iOS configuredTones() /
 * pinnedKeyboardVoices() / persistTonePick().
 *
 * WHAT THE PILL CYCLES is the server's, in the server's order:
 *
 *   kb.personality.pinned  [{ id, name, tone }]  the user's keyboard voices
 *   kb.personality.tones   [{ id, label }]       the tone list ("ZU", "Formal", …)
 *
 * voices first, then tones. The pill shows the label of the item it is on.
 * The keyboard used to read a flag nobody sent (kb.tones) and fall back to a
 * list it made up — "Neutral / Casual / Formal / Excited" — so the pill said
 * "Neutral", a tone the server does not have, and refine was sent a tone name
 * instead of a tone id.
 *
 * WHAT IS ACTIVE: a pick made on the keyboard wins until the app makes a new
 * one. The config is refetched on every open and echoes the server's
 * activeTone / activeId; re-applying that unconditionally would snap the pill
 * back moments after every pick. So a pick records the server values it was
 * made against (the baseline), and only a server value that is NEITHER that
 * baseline NOR the pick itself (our own PUT landing) overrides it.
 *
 * A PICK is saved locally (refine reads it on the very next call) and sent to
 * the server (PUT /v1/personality) so the app and future sessions agree.
 */
object TulmiTone {
    /** One stop on the pill. [kind] is "voice" (a pinned preset) or "tone". */
    data class Item(val kind: String, val id: String, val label: String, val tone: String)

    private const val PREFS = "tulmi_kb"
    private const val K_CURSOR = "tone.cursor"          // "voice:<id>" | "tone:<id>" — where the pill is
    private const val K_TONE = "tone.id"                 // the tone id that pick implies
    private const val K_VOICE = "voice.id"               // the voice id that pick implies ("" for a tone pick)
    private const val K_BASE_TONE = "tone.baseline"      // server activeTone when the pick was made
    private const val K_BASE_VOICE = "voice.baseline"    // server activeId when the pick was made

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    // --- reading the server's lists -------------------------------------------

    /** org.json surfaces arrays as JSONArray; tolerate a List too. */
    private fun elements(raw: Any?): List<Any?> = when (raw) {
        is JSONArray -> (0 until raw.length()).map { raw.opt(it) }
        is List<*> -> raw
        else -> emptyList()
    }

    private fun field(el: Any?, key: String): String? = when (el) {
        is JSONObject -> if (el.has(key) && !el.isNull(key)) el.optString(key).takeIf { it.isNotEmpty() } else null
        is Map<*, *> -> (el[key] as? String)?.takeIf { it.isNotEmpty() }
        else -> null
    }

    private fun serverString(flags: Map<String, Any?>, key: String): String =
        (flags[key] as? String)?.trim().orEmpty()

    /** The user's keyboard voices, in the server's order. */
    fun voices(flags: Map<String, Any?>): List<Item> =
        elements(flags["kb.personality.pinned"]).mapNotNull { el ->
            val id = field(el, "id") ?: return@mapNotNull null
            Item("voice", id, field(el, "name") ?: id, field(el, "tone") ?: "")
        }

    /**
     * The tone list, in the server's order. Rich { id, label } objects are what
     * the server sends; a bare label string (an older shape) gets an id derived
     * the way refine derives one; the legacy comma-separated kb.tones is last.
     */
    fun tones(flags: Map<String, Any?>): List<Item> {
        val rich = elements(flags["kb.personality.tones"]).mapNotNull { el ->
            when (el) {
                is String -> el.trim().takeIf { it.isNotEmpty() }?.let {
                    Item("tone", it.lowercase().replace(' ', '-'), it, it.lowercase().replace(' ', '-'))
                }
                else -> field(el, "id")?.let { id -> Item("tone", id, field(el, "label") ?: id, id) }
            }
        }
        if (rich.isNotEmpty()) return rich
        val csv = (flags["kb.tones"] as? String).orEmpty()
        return csv.split(",").map { it.trim() }.filter { it.isNotEmpty() }
            .map { Item("tone", it.lowercase().replace(' ', '-'), it, it.lowercase().replace(' ', '-')) }
    }

    /** Everything the pill cycles: voices, then tones. */
    fun items(flags: Map<String, Any?>): List<Item> = voices(flags) + tones(flags)

    // --- what is active ------------------------------------------------------

    private fun find(items: List<Item>, cursor: String?): Item? {
        if (cursor.isNullOrEmpty()) return null
        val kind = cursor.substringBefore(':')
        val id = cursor.substringAfter(':')
        return items.firstOrNull { it.kind == kind && it.id == id }
    }

    /**
     * The item the pill is on. A keyboard pick first; else the server's active
     * tone; else its active voice; else the first voice's own tone (a new user,
     * whose only voice is the house one); else whatever comes first.
     */
    fun current(ctx: Context, flags: Map<String, Any?>): Item? {
        val all = items(flags)
        if (all.isEmpty()) return null
        find(all, prefs(ctx).getString(K_CURSOR, null))?.let { return it }
        val tones = all.filter { it.kind == "tone" }
        val voices = all.filter { it.kind == "voice" }
        val srvTone = serverString(flags, "kb.personality.activeTone")
        val srvVoice = serverString(flags, "kb.personality.activeId")
        if (srvTone.isNotEmpty()) tones.firstOrNull { it.id == srvTone }?.let { return it }
        if (srvVoice.isNotEmpty()) voices.firstOrNull { it.id == srvVoice }?.let { return it }
        voices.firstOrNull()?.tone?.let { t -> tones.firstOrNull { it.id == t }?.let { return it } }
        return all.first()
    }

    /** What the pill says. Empty when the server sent no voices or tones. */
    fun label(ctx: Context, flags: Map<String, Any?>): String = current(ctx, flags)?.label ?: ""

    /** The tone id refine should write in ("" = let the server use the saved one). */
    fun activeToneId(ctx: Context, flags: Map<String, Any?>): String {
        val cur = current(ctx, flags)
        val srvTone = serverString(flags, "kb.personality.activeTone")
        return when (cur?.kind) {
            "tone" -> cur.id
            "voice" -> cur.tone.ifEmpty { srvTone }
            else -> srvTone
        }
    }

    /** The voice the sheet ticks: a keyboard pick, else the server's. */
    fun activeVoiceId(ctx: Context, flags: Map<String, Any?>): String {
        val p = prefs(ctx)
        if (find(items(flags), p.getString(K_CURSOR, null)) != null) {
            val picked = p.getString(K_VOICE, "").orEmpty()
            if (picked.isNotEmpty()) return picked
        }
        return serverString(flags, "kb.personality.activeId")
    }

    /**
     * A config arrived. Keep a keyboard pick unless the app has made a NEW
     * selection since — see the class comment for why a plain overwrite loses
     * every pick.
     */
    fun sync(ctx: Context, flags: Map<String, Any?>) {
        val p = prefs(ctx)
        if (!p.contains(K_CURSOR)) return
        val srvTone = serverString(flags, "kb.personality.activeTone")
        val srvVoice = serverString(flags, "kb.personality.activeId")
        val baseTone = p.getString(K_BASE_TONE, "").orEmpty()
        val baseVoice = p.getString(K_BASE_VOICE, "").orEmpty()
        if (srvTone == baseTone && srvVoice == baseVoice) return          // a stale echo
        val pickTone = p.getString(K_TONE, "").orEmpty()
        val pickVoice = p.getString(K_VOICE, "").orEmpty()
        val toneAgrees = srvTone == baseTone || srvTone == pickTone
        val voiceAgrees = srvVoice == baseVoice || (pickVoice.isNotEmpty() && srvVoice == pickVoice)
        if (toneAgrees && voiceAgrees) {
            // Our own save landing. Adopt it as the new baseline and keep the pick.
            p.edit().putString(K_BASE_TONE, srvTone).putString(K_BASE_VOICE, srvVoice).apply()
        } else {
            // The app chose something new: it wins, and the pill follows the server.
            p.edit().remove(K_CURSOR).remove(K_TONE).remove(K_VOICE)
                .remove(K_BASE_TONE).remove(K_BASE_VOICE).apply()
        }
    }

    /** The user picked [item] on the keyboard: save it here and on the server. */
    fun select(ctx: Context, flags: Map<String, Any?>, item: Item) {
        val toneId = if (item.kind == "tone") item.id else item.tone
        prefs(ctx).edit()
            .putString(K_CURSOR, "${item.kind}:${item.id}")
            .putString(K_TONE, toneId)
            .putString(K_VOICE, if (item.kind == "voice") item.id else "")
            .putString(K_BASE_TONE, serverString(flags, "kb.personality.activeTone"))
            .putString(K_BASE_VOICE, serverString(flags, "kb.personality.activeId"))
            .apply()
        TulmiTelemetry.bump(if (item.kind == "voice") TulmiTelemetry.VOICE_CHANGED else TulmiTelemetry.TONE_CHANGED)
        val body = JSONObject()
        if (item.kind == "voice") body.put("activePresetId", item.id)
        if (toneId.isNotEmpty()) body.put("activeTone", toneId)
        if (body.length() == 0) return
        // Fire and forget: the local pick already drives the next refine, and
        // the next config fetch reconciles whatever the server ends up with.
        Thread {
            try { Net.putPersonality(body) } catch (_: Exception) { /* offline: the pick still holds locally */ }
        }.start()
    }
}
