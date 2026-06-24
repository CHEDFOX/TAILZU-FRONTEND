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
    var baseUrl: String = "http://10.0.2.2:8770"
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
        val labels: Map<String, String>,
    )

    fun parseConfig(s: String): KbConfig {
        val o = JSONObject(s)
        val t = o.getJSONObject("theme")
        val f = o.getJSONObject("features")
        val l = o.getJSONObject("labels")
        val labels = HashMap<String, String>()
        for (k in l.keys()) labels[k] = l.getString(k)
        return KbConfig(
            background = t.optString("background", "#15151b"),
            keyText = t.optString("keyText", "#ffffff"),
            accent = t.optString("accent", "#5b4bff"),
            voice = f.optBoolean("voice", true),
            refine = f.optBoolean("refine", true),
            liveVoice = f.optBoolean("liveVoice", false),
            labels = labels,
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

    fun refine(text: String, targetApp: String): String {
        val json = JSONObject()
            .put("text", text)
            .put("targetApp", targetApp)
            .put("language", "auto")
            .toString()
        val req = Request.Builder()
            .url("$baseUrl/v1/refine")
            .addHeader("Authorization", "Bearer $token")
            .post(json.toRequestBody("application/json".toMediaType()))
            .build()
        client.newCall(req).execute().use { res ->
            val s = res.body?.string() ?: ""
            if (!res.isSuccessful) throw RuntimeException("refine ${res.code}: $s")
            return JSONObject(s).optString("refinedText")
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
