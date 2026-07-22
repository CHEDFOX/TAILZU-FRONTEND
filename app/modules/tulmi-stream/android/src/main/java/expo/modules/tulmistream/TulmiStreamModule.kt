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
import okio.ByteString.Companion.toByteString
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
  private var captureThread: Thread? = null
  @Volatile private var capturing = false

  // Backpressure cap — mirrors the keyboard's Stream.kt sendCapBytes. On a poor
  // uplink an unbounded OkHttp send queue balloons until the process OOMs; we
  // drop the newest frames once queued bytes exceed the cap and log the first
  // drop only so a bad network doesn't flood logcat.
  private val sendCapBytes = 2 * 1024 * 1024
  @Volatile private var dropLogged = false

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
        "final" -> emit("onFinal", mapOf("text" to o.optString("text")))
        // "done" carries no text — it's the terminal marker, not a transcript.
        "done" -> emit("onClosed", emptyMap())
        // A mid-stream backend error is terminal: release the mic immediately so
        // it doesn't stay hot if the JS onError handler forgets to call cancel().
        "error" -> {
          stopCapture()
          emit("onError", mapOf("message" to o.optString("message", "stream error")))
        }
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
    captureThread = thread(name = "tulmi-mic") {
      val buf = ByteArray(bufSize)
      while (capturing) {
        val n = rec.read(buf, 0, buf.size)
        if (n <= 0) continue
        // Drop newest frames when the socket is backlogged rather than queuing
        // forever (the process would OOM on a slow uplink). Matches the keyboard.
        if (webSocket.queueSize() + n > sendCapBytes) {
          if (!dropLogged) {
            dropLogged = true
            android.util.Log.w(
              "TulmiStream",
              "backpressure: dropping audio frames (queueSize=${webSocket.queueSize()}, cap=$sendCapBytes)",
            )
          }
          continue
        }
        webSocket.send(buf.toByteString(0, n))
      }
    }
  }

  @Synchronized
  private fun stopCapture() {
    // Idempotent — finish()/cancel()/onClosed/onError can all land here from
    // different threads; @Synchronized + this guard stop a double stop/release.
    if (record == null && captureThread == null) return
    capturing = false
    // Snapshot + detach so a concurrent caller can't touch the same refs.
    val t = captureThread; captureThread = null
    val rec = record; record = null
    // Release on a teardown thread AFTER an UNBOUNDED join. The mic thread blocks
    // in rec.read(); it exits only once that read returns (capturing is now
    // false). The OLD bounded join(700) released the AudioRecord even if the
    // join timed out — freeing native mic memory out from under an in-flight
    // read = use-after-free crash. An unbounded join guarantees the read has
    // returned before release; off the caller thread so stop() doesn't block.
    thread(name = "tulmi-mic-teardown") {
      try { t?.join() } catch (_: InterruptedException) {}
      try { rec?.stop() } catch (_: Exception) {}
      try { rec?.release() } catch (_: Exception) {}
    }
  }

  fun finish() {
    // Keep the socket open after "stop" so the engine's flushed tail + "done"
    // still arrive (closing here truncated the ending). Watchdog force-closes
    // if "done" never comes.
    stopCapture()
    val socket = ws ?: run { emit("onClosed", emptyMap()); return }
    socket.send("{\"type\":\"stop\"}")
    android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
      try { ws?.close(1000, null) } catch (_: Exception) {}
    }, 2500)
  }

  fun cancel() {
    stopCapture()
    ws?.cancel()
    ws = null
  }
}
