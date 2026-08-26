package com.tulmi.app.keyboard

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Tiny backend client for the keyboard. Uses OkHttp (already on the classpath
 * via React Native), so no extra Gradle dependency is needed.
 *
 * NOTE: until we bridge the app's saved backend URL into the keyboard, set
 * baseUrl here. Android emulator → your PC = 10.0.2.2; a physical phone → your
 * PC's LAN IP, or your VPS URL.
 */
object Net {
    var baseUrl: String = "https://api.tailzu.space"
    private var token = "dev" // shared by the app via SharedPreferences (see load)

    private val client = OkHttpClient.Builder()
        .callTimeout(60, TimeUnit.SECONDS)
        .build()

    /**
     * Load the backend URL + user token the main app shared (it writes them to
     * the "tulmi" SharedPreferences via the tulmi-bridge native module). The IME
     * runs in the same package, so it can read them directly. Keeps the baked
     * defaults when nothing has been shared yet.
     */
    fun load(context: android.content.Context) {
        val p = context.getSharedPreferences("tulmi", android.content.Context.MODE_PRIVATE)
        p.getString("tulmi.baseUrl", null)?.let { if (it.isNotBlank()) baseUrl = it }
        p.getString("tulmi.token", null)?.let { if (it.isNotBlank()) token = it }
    }

    /** The user token, exposed for the live streaming client (Stream.kt). */
    fun bearer(): String = token

    /** WebSocket URL for live dictation: same host as baseUrl, ws/wss scheme. */
    fun streamUrl(): String {
        val ws = when {
            baseUrl.startsWith("https://") -> "wss://" + baseUrl.removePrefix("https://")
            baseUrl.startsWith("http://") -> "ws://" + baseUrl.removePrefix("http://")
            else -> baseUrl
        }
        return "$ws/v1/transcribe-stream"
    }

    /** Server-driven keyboard config (theme/labels/flags). Fetched + cached. */
    data class KbConfig(
        val background: String,
        val keyText: String,
        val accent: String,
        val voice: Boolean,
        val refine: Boolean,
        val liveVoice: Boolean,
        /**
         * Whether dictated words paint the field LIVE as you speak (true) or
         * only land as one block AFTER you stop (false). Backend-tunable via the
         * `kb.mic.liveText` flag — flip the dictation "button logic" without a
         * rebuild. Default true keeps the live-typing feel when the flag is
         * absent.
         */
        val liveText: Boolean = true,
        val labels: Map<String, String>,
        /**
         * Per-key accent glyphs for long-press. Keys are lowercase letters
         * (e.g. "a"); values are the list of accented characters shown in
         * the popover. Backend sets this in bootstrap flags under
         * `kb.accents.<char>`; missing = no menu for that key.
         */
        val accents: Map<String, List<Char>> = emptyMap(),
    )

    fun parseConfig(s: String): KbConfig {
        val o = JSONObject(s)
        val t = o.getJSONObject("theme")
        val f = o.getJSONObject("features")
        val l = o.getJSONObject("labels")
        val labels = HashMap<String, String>()
        for (k in l.keys()) labels[k] = l.getString(k)

        // Accent glyphs — backend authors kb.accents.<char> = "áâäàā" as a
        // string; we split into a Char list. Absent object → empty map.
        val accents = HashMap<String, List<Char>>()
        val flags = o.optJSONObject("flags")
        val accentsObj = flags?.optJSONObject("kb.accents")
        if (accentsObj != null) {
            for (k in accentsObj.keys()) {
                val v = accentsObj.optString(k, "")
                if (v.isNotEmpty()) accents[k.lowercase()] = v.toList()
            }
        }

        return KbConfig(
            background = t.optString("background", "#15151b"),
            keyText = t.optString("keyText", "#ffffff"),
            accent = t.optString("accent", "#FFFFFF"),
            voice = f.optBoolean("voice", true),
            refine = f.optBoolean("refine", true),
            liveVoice = f.optBoolean("liveVoice", false),
            // Dictation "button logic": show interim words live (default) or
            // only commit the final after stop. Backend flag, no rebuild needed.
            liveText = flags?.optBoolean("kb.mic.liveText", true) ?: true,
            labels = labels,
            accents = accents,
        )
    }

    /** Returns the raw config JSON (so the caller can both apply and cache it). */
    fun getKeyboardConfigJson(): String {
        val req = Request.Builder()
            .url("$baseUrl/v1/keyboard/config")
            .addHeader("Authorization", "Bearer $token")
            .get()
            .build()
        client.newCall(req).execute().use { res ->
            val s = res.body?.string() ?: ""
            if (!res.isSuccessful) throw RuntimeException("config ${res.code}: $s")
            return s
        }
    }

    fun refine(text: String, targetApp: String, tone: String = ""): String {
        // Route to the backend's per-tone endpoint when a known LLM tone is
        // selected; "none" → skip-refine endpoint; everything else (Neutral,
        // empty, or anything unrecognized) → the catch-all /v1/refine that
        // always exists. This can only ever fall BACK to the safe default —
        // never a 404 — so an unexpected tone value can't break refine.
        val toneId = tone.trim().lowercase().replace(' ', '-')
        val path = when (toneId) {
            "formal", "casual", "very-casual", "excited" -> "/v1/refine/$toneId"
            "none" -> "/v1/refine/none"
            else -> "/v1/refine"
        }
        val json = JSONObject()
            .put("text", text)
            .put("targetApp", targetApp)
            .put("language", "auto")
            .toString()
        val req = Request.Builder()
            .url("$baseUrl$path")
            .addHeader("Authorization", "Bearer $token")
            .post(json.toRequestBody("application/json".toMediaType()))
            .build()
        client.newCall(req).execute().use { res ->
            val s = res.body?.string() ?: ""
            if (!res.isSuccessful) throw RuntimeException("refine ${res.code}: $s")
            return JSONObject(s).optString("refinedText")
        }
    }

    /**
     * Ship a telemetry batch. Counters only — the payload is built by
     * TulmiTelemetry, which cannot hold anything but integers.
     *
     * Throws on failure so the caller keeps the counters for the next window
     * rather than dropping them; losing a batch to a flaky network would make
     * quiet periods indistinguishable from failing uploads.
     */
    fun postTelemetry(counters: JSONObject, windowMs: Long, build: String) {
        val json = JSONObject()
            .put("counters", counters)
            .put("windowMs", windowMs)
            .put("build", build)
            .put("platform", "android")
            .toString()
        val req = Request.Builder()
            .url("$baseUrl/v1/keyboard/telemetry")
            .addHeader("Authorization", "Bearer $token")
            .post(json.toRequestBody("application/json".toMediaType()))
            .build()
        client.newCall(req).execute().use { res ->
            if (!res.isSuccessful) {
                throw RuntimeException("telemetry ${res.code}: ${res.body?.string() ?: ""}")
            }
        }
    }

    fun transcribeClean(file: File, targetApp: String): String {
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("audio", "audio.m4a", file.asRequestBody("audio/m4a".toMediaType()))
            .addFormDataPart("targetApp", targetApp)
            .addFormDataPart("language", "auto")
            .build()
        val req = Request.Builder()
            .url("$baseUrl/v1/transcribe-clean")
            .addHeader("Authorization", "Bearer $token")
            .post(body)
            .build()
        client.newCall(req).execute().use { res ->
            val s = res.body?.string() ?: ""
            if (!res.isSuccessful) throw RuntimeException("transcribe ${res.code}: $s")
            return JSONObject(s).optString("cleanedText")
        }
    }
}
