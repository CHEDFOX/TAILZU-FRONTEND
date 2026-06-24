package expo.modules.tulmistream

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * Live (streaming) dictation for the main app.
 *
 * JS calls `start({ url, token, targetApp, language })`; the native side opens a
 * WebSocket, captures the mic as 16 kHz mono PCM, streams it, and emits
 * `onReady` / `onPartial` / `onFinal` / `onError` / `onClosed` back to JS.
 * See STREAMING.md for the wire protocol.
 */
class TulmiStreamModule : Module() {
  private var streamer: Streamer? = null

  override fun definition() = ModuleDefinition {
    Name("TulmiStream")

    Events("onReady", "onPartial", "onFinal", "onError", "onClosed")

    Function("start") { options: Map<String, Any?> ->
      val url = options["url"] as? String ?: ""
      val token = options["token"] as? String ?: "dev"
      val targetApp = options["targetApp"] as? String ?: "Generic"
      val language = options["language"] as? String ?: "auto"
      streamer?.cancel()
      streamer = Streamer { name, payload -> sendEvent(name, payload) }.also {
        it.start(url, token, targetApp, language)
      }
    }

    Function("stop") { streamer?.finish() }

    Function("cancel") {
      streamer?.cancel()
      streamer = null
    }

    OnDestroy {
      streamer?.cancel()
      streamer = null
    }
  }
}

/** Capture + WebSocket plumbing; mirrors the keyboard's Stream.kt. */
private class Streamer(
  private val emit: (String, Map<String, Any?>) -> Unit,
) {
  private val client = OkHttpClient.Builder()
    .readTimeout(0, TimeUnit.MILLISECONDS) // keep the socket open
    .build()

  private var ws: WebSocket? = null
  private var record: AudioRecord? = null
  @Volatile private var capturing = false

  fun start(url: String, token: String, targetApp: String, language: String) {
    val req = Request.Builder()
      .url(url)
      .addHeader("Authorization", "Bearer $token")
      .build()
    ws = client.newWebSocket(req, object : WebSocketListener() {
      override fun onOpen(webSocket: WebSocket, response: Response) {
        val start = JSONObject()
          .put("type", "start")
          .put("token", token)
          .put("targetApp", targetApp)
          .put("language", language)
          .put("sampleRate", 16000)
          .put("encoding", "pcm_s16le")
          .put("channels", 1)
        webSocket.send(start.toString())
        startCapture(webSocket)
      }

      override fun onMessage(webSocket: WebSocket, text: String) = handle(text)
      override fun onMessage(webSocket: WebSocket, bytes: ByteString) = handle(bytes.utf8())

      override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
        stopCapture()
        emit("onError", mapOf("message" to (t.message ?: "stream failed")))
      }

      override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
        stopCapture()
        emit("onClosed", emptyMap())
      }
    })
  }

  private fun handle(text: String) {
    try {
      val o = JSONObject(text)
      when (o.optString("type")) {
        "ready" -> emit("onReady", emptyMap())
        "partial" -> emit("onPartial", mapOf("text" to o.optString("text")))
        "final", "done" -> emit("onFinal", mapOf("text" to o.optString("text")))
        "error" -> emit("onError", mapOf("message" to o.optString("message", "stream error")))
      }
    } catch (_: Exception) { /* ignore malformed frames */ }
  }

  @Suppress("MissingPermission") // the app requests RECORD_AUDIO before starting
  private fun startCapture(webSocket: WebSocket) {
    val minBuf = AudioRecord.getMinBufferSize(
      16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT
    )
    val bufSize = maxOf(minBuf, 4096)
    val rec = try {
      AudioRecord(
        MediaRecorder.AudioSource.MIC,
        16000,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        bufSize * 2,
      )
    } catch (e: SecurityException) {
      emit("onError", mapOf("message" to "Microphone permission denied"))
      return
    }
    if (rec.state != AudioRecord.STATE_INITIALIZED) {
      rec.release()
      emit("onError", mapOf("message" to "Mic unavailable"))
      return
    }
    record = rec
    capturing = true
    rec.startRecording()
    thread(name = "tulmi-mic") {
      val buf = ByteArray(bufSize)
      while (capturing) {
        val n = rec.read(buf, 0, buf.size)
        if (n > 0) webSocket.send(ByteString.of(buf, 0, n))
      }
    }
  }

  private fun stopCapture() {
    capturing = false
    try { record?.stop() } catch (_: Exception) {}
    try { record?.release() } catch (_: Exception) {}
    record = null
  }

  fun finish() {
    stopCapture()
    ws?.send("{\"type\":\"stop\"}")
    ws?.close(1000, null)
  }

  fun cancel() {
    stopCapture()
    ws?.cancel()
    ws = null
  }
}
