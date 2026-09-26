package com.tulmi.app.keyboard

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
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
 * The base URL and the user's token come from the app (tulmi-bridge writes
 * them to SharedPreferences, see [load]). Every path except the config's own
 * is a knob, and so is every timeout — the config has to be reachable before
 * any knob is, so its path stays fixed. The knobs are the ones iOS reads
 * (kb.endpoints.*, kb.network.timeouts.*, kb.network.retries, kb.upload.*), so
 * one value on the server moves both keyboards.
 */
object Net {
    var baseUrl: String = "https://api.tailzu.space"

    /**
     * The signed-in user's token, shared by the app. EMPTY when nothing has been
     * shared — and then no Authorization header is sent at all. There used to be
     * a "dev" placeholder here, which the server could only ever answer with a
     * 401, and which made a keyboard that had never been signed in look like one
     * whose session had expired.
     */
    private var token = ""

    /**
     * Which keyboard build is asking. The backend targets configs and rollouts
     * by this (A<n> is Android, K<n> is iOS); the number is BUILD_STAMP, the one
     * constant that also stamps telemetry.
     */
    const val BUILD_HEADER = "X-Tulmi-Keyboard-Build"

    /** One client; each call sets its own deadline (see [call]). */
    private val client = OkHttpClient.Builder().build()

    /**
     * Load the backend URL + user token the main app shared (it writes them to
     * the "tulmi" SharedPreferences via the tulmi-bridge native module). The IME
     * runs in the same package, so it can read them directly.
     */
    fun load(context: android.content.Context) {
        val p = context.getSharedPreferences("tulmi", android.content.Context.MODE_PRIVATE)
        p.getString("tulmi.baseUrl", null)?.let { if (it.isNotBlank()) baseUrl = it }
        // Read every time, blank included: a sign-out must stop us sending the
        // old token, not leave it in place because the new value was empty.
        token = p.getString("tulmi.token", null)?.trim().orEmpty()
        pickedLanguage = p.getString("tulmi.language", null)?.trim().orEmpty()
    }

    /** The user token, exposed for the live streaming client (Stream.kt). Empty when signed out. */
    fun bearer(): String = token

    /** The language the user picked in the app (tulmi-bridge), or empty. */
    private var pickedLanguage = ""

    /**
     * The language dictation and refine are sent with: the user's pick, else
     * the server's kb.dictation.defaultLanguage ("auto": the server detects it,
     * code-switching included). A soft hint either way — the backend never
     * pins the recognizer to it. The same rule as iOS's TulmiBackend.language.
     */
    fun language(): String = pickedLanguage.ifEmpty { knobString("kb.dictation.defaultLanguage", "auto") }

    /** The headers every request to our backend carries. */
    fun authorize(b: Request.Builder): Request.Builder {
        if (token.isNotEmpty()) b.header("Authorization", "Bearer $token")
        b.header(BUILD_HEADER, SDUIRenderer.BUILD_STAMP)
        return b
    }

    /** Same, for code that talks HttpURLConnection (the renderer's callEndpoint). */
    fun authorize(conn: java.net.HttpURLConnection) {
        if (token.isNotEmpty()) conn.setRequestProperty("Authorization", "Bearer $token")
        conn.setRequestProperty(BUILD_HEADER, SDUIRenderer.BUILD_STAMP)
    }

    /** A server timeout, given in seconds as on iOS, as milliseconds. */
    private fun secondsMs(sec: Float): Long = (sec.toDouble() * 1000.0).toLong()

    /** Run a request with its own deadline; returns (code, body). */
    private fun call(req: Request, timeoutMs: Long): Pair<Int, String> {
        val c = client.newCall(req)
        c.timeout().timeout(timeoutMs.coerceAtLeast(1000L), TimeUnit.MILLISECONDS)
        c.execute().use { res -> return res.code to (res.body?.string() ?: "") }
    }

    /**
     * The server's path for an endpoint, or [fallback] when what it sent is
     * blank or is not a path at all. A typo in the console must cost that one
     * setting, not the request: the path is appended to the base URL, and
     * anything that does not start with "/" or has a space in it would make a
     * URL that fails, or worse, one on another host.
     */
    private fun path(server: String, fallback: String): String {
        val p = server.trim()
        return if (p.startsWith("/") && !p.startsWith("//") && p.none { it.isWhitespace() }) p else fallback
    }

    /** A response worth asking again for: the server failed or asked us to wait. */
    private fun transient(code: Int): Boolean = code >= 500 || code == 408 || code == 429

    /**
     * Run an idempotent request (a GET), retrying a network failure or a
     * 5xx / 408 / 429 up to kb.network.retries times. The first retry waits
     * kb.network.retryBackoffMs and each later one twice the one before. The
     * default is no retries — exactly the single attempt this always made. A
     * 4xx (an expired token, say) is never retried: asking again won't fix it.
     *
     * [attempt] returns the status and whatever it read, and throws an
     * IOException when there was no response at all. The pauses block the
     * calling thread, so this is only ever called off the main thread — the
     * config refresh and the image loader's pool. Both numbers are capped so a
     * console typo cannot park that thread for hours.
     */
    fun <T> getWithRetry(attempt: () -> Pair<Int, T>): Pair<Int, T> {
        var left = knobInt("kb.network.retries", 0).coerceIn(0, 10)
        var delayMs = knobFloat("kb.network.retryBackoffMs", 500f).toDouble().coerceIn(0.0, 60_000.0)
        while (true) {
            val result = try {
                attempt()
            } catch (e: java.io.IOException) {
                if (left <= 0) throw e
                null
            }
            if (result != null && (left <= 0 || !transient(result.first))) return result
            left -= 1
            try {
                Thread.sleep(delayMs.toLong())
            } catch (e: InterruptedException) {
                // Torn down mid-wait: stop asking. The last answer, if there was one.
                Thread.currentThread().interrupt()
                return result ?: throw java.io.IOException("interrupted")
            }
            delayMs = (delayMs * 2).coerceAtMost(60_000.0)
        }
    }

    /** WebSocket URL for live dictation: same host as baseUrl, ws/wss scheme. */
    fun streamUrl(): String {
        val ws = when {
            baseUrl.startsWith("https://") -> "wss://" + baseUrl.removePrefix("https://")
            baseUrl.startsWith("http://") -> "ws://" + baseUrl.removePrefix("http://")
            else -> baseUrl
        }
        return ws + path(knobString("kb.endpoints.stream", "/v1/transcribe-stream"), "/v1/transcribe-stream")
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
        /**
         * Whether the free words are gone — `kb.quota.exhausted`.
         *
         * The 429 on the transcribe route is the authority and stays the
         * backstop; a config is cached and can be minutes stale. This is here
         * because being refused AFTER saying a sentence is a worse way to
         * learn it than being told when you reach for the button. Absent flag
         * → false, so an anonymous or old config behaves as it always did.
         */
        val wordsExhausted: Boolean = false,
        /** Where to send them when it is gone. Named by the backend so the
         *  destination can move without a keyboard build. */
        val quotaScreenId: String = "words_out",
    )

    fun parseConfig(s: String): KbConfig {
        val o = JSONObject(s)
        val t = o.getJSONObject("theme")
        val f = o.getJSONObject("features")
        val l = o.getJSONObject("labels")
        val labels = HashMap<String, String>()
        for (k in l.keys()) labels[k] = l.getString(k)

        // Accent glyphs, per key: kb.accents = { "a": ["à", "á", …] } (what the
        // backend sends and iOS reads) or the older { "a": "àá…" } string form.
        // Absent object → empty map.
        val accents = HashMap<String, List<Char>>()
        val flags = o.optJSONObject("flags")
        val accentsObj = flags?.optJSONObject("kb.accents")
        if (accentsObj != null) {
            for (k in accentsObj.keys()) {
                val arr = accentsObj.optJSONArray(k)
                val chars = if (arr != null) {
                    (0 until arr.length()).mapNotNull { arr.optString(it, "").firstOrNull() }
                } else {
                    accentsObj.optString(k, "").toList()
                }
                if (chars.isNotEmpty()) accents[k.lowercase()] = chars
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
            wordsExhausted = flags?.optBoolean("kb.quota.exhausted", false) ?: false,
            quotaScreenId = flags?.optString("kb.quota.screenId", "words_out")
                ?.ifEmpty { "words_out" } ?: "words_out",
        )
    }

    /** Returns the raw config JSON (so the caller can both apply and cache it). */
    fun getKeyboardConfigJson(): String {
        // The one path that is NOT a knob: knobs arrive in this response.
        val req = authorize(Request.Builder().url("$baseUrl/v1/keyboard/config")).get().build()
        val (code, s) = getWithRetry { call(req, secondsMs(knobFloat("kb.network.timeouts.configSec", 30f))) }
        if (code !in 200..299) throw RuntimeException("config $code: $s")
        return s
    }

    /**
     * The route for a tone.
     *
     * Tones the server has a dedicated route for go there; anything else — an
     * empty tone, or one added on the server after this build — goes to the
     * catch-all, which reads the tone from the body. So this can only ever fall
     * BACK to the safe default, never to a 404.
     */
    private fun refinePath(toneId: String): String {
        val routed = knobStrings("kb.refine.toneRoutes", listOf("formal", "casual", "very-casual", "excited", "none"))
        return if (toneId.isNotEmpty() && toneId in routed) {
            knobString("kb.refine.tonePathPrefix", "/v1/refine/") + toneId
        } else {
            path(knobString("kb.endpoints.refine", "/v1/refine"), "/v1/refine")
        }
    }

    fun refine(
        text: String,
        targetApp: String,
        tone: String = "",
        /** What is already in the field around the selection. iOS has always
         *  sent this; Android never did, so the model was asked to write a
         *  sentence with no sight of the draft it was joining — and produced
         *  something that read as a paragraph on its own and wrong in place. */
        context: String = "",
    ): String {
        val toneId = tone.trim().lowercase().replace(' ', '-')
        val path = refinePath(toneId)
        val json = JSONObject()
            .put("text", text)
            .put("targetApp", targetApp)
            // A hint, never a pin: the backend still detects the language.
            .put("language", language())
            .apply { if (context.isNotBlank()) put("context", context) }
            // The catch-all reads the tone from here; the per-tone routes carry
            // it in the path and ignore it.
            .apply { if (toneId.isNotEmpty()) put("tone", toneId) }
            .toString()
        val req = authorize(Request.Builder().url("$baseUrl$path"))
            .post(json.toRequestBody("application/json".toMediaType()))
            .build()
        val (code, s) = call(req, secondsMs(knobFloat("kb.network.timeouts.refineSec", 60f)))
        if (code !in 200..299) throw RuntimeException("refine $code: $s")
        return JSONObject(s).optString("refinedText")
    }

    /**
     * Save part of the user's personality — the active voice / tone picked on
     * the keyboard. A PARTIAL body: the server merges it into the saved profile,
     * so sending { activeTone } does not wipe vocabulary or pins.
     */
    fun putPersonality(body: JSONObject) {
        val req = authorize(Request.Builder().url(baseUrl + path(knobString("kb.endpoints.personality", "/v1/personality"), "/v1/personality")))
            .put(body.toString().toRequestBody("application/json".toMediaType()))
            .build()
        val (code, s) = call(req, secondsMs(knobFloat("kb.network.timeouts.personalitySec", 15f)))
        if (code !in 200..299) throw RuntimeException("personality $code: $s")
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
        val req = authorize(Request.Builder().url(baseUrl + path(knobString("kb.endpoints.telemetry", "/v1/keyboard/telemetry"), "/v1/keyboard/telemetry")))
            .post(json.toRequestBody("application/json".toMediaType()))
            .build()
        val (code, s) = call(req, secondsMs(knobFloat("kb.network.timeouts.telemetrySec", 15f)))
        if (code !in 200..299) throw RuntimeException("telemetry $code: $s")
    }

    fun transcribeClean(
        file: File,
        targetApp: String,
        /** The draft before the caret (kb.dictation.contextChars of it), so the
         *  sentence this call writes fits what it joins. */
        context: String = "",
    ): String {
        // The upload's name and type are the server's (kb.upload.*), for when
        // the recorder's format changes before this build does. A blank name or
        // a type OkHttp cannot parse keeps the one this always sent.
        val filename = knobString("kb.upload.filename", "audio.m4a").trim().ifEmpty { "audio.m4a" }
        val mimeType = knobString("kb.upload.mimeType", "audio/m4a").trim().toMediaTypeOrNull()
            ?: "audio/m4a".toMediaType()
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("audio", filename, file.asRequestBody(mimeType))
            .addFormDataPart("targetApp", targetApp)
            .addFormDataPart("language", language())
            .apply { if (context.isNotBlank()) addFormDataPart("context", context) }
            .build()
        val req = authorize(Request.Builder().url(baseUrl + path(knobString("kb.endpoints.transcribeClean", "/v1/transcribe-clean"), "/v1/transcribe-clean")))
            .post(body)
            .build()
        val (code, s) = call(req, secondsMs(knobFloat("kb.network.timeouts.transcribeCleanSec", 60f)))
        if (code !in 200..299) throw RuntimeException("transcribe $code: $s")
        return JSONObject(s).optString("cleanedText")
    }
}
