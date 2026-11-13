package expo.modules.tulmistream

import android.content.Context
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
  private var route: CallRoute? = null

  override fun definition() = ModuleDefinition {
    Name("TulmiStream")

    Events("onReady", "onPartial", "onFinal", "onError", "onClosed", "onInterrupted")

    // THE PHONE'S AUDIO FOR PLAN EASE'S LIVE CALL (src/sdui/voice/callRealtime.ts).
    //
    //   prepare  which echo canceller the call wants (CallAec). React builds the
    //            live client's audio as the app starts, before any JS runs, so the
    //            ask is remembered and applied at the next start (CallAec, and
    //            TulmiStreamPackage's application listener).
    //   begin    communication mode, audio focus, and the loudspeaker unless a
    //            headset is the route; focus lost is reported as an interruption.
    //   end      all of it given back.
    //
    // Every op answers which canceller this process really HAS ("soft" or "hw"),
    // never what was asked for: a call that wanted the software one and did not
    // get it stays a turn call rather than let the bot hear itself.
    Function("callAudio") { op: String, options: Map<String, Any?> ->
      val ctx = appContext.reactContext
      when (op) {
        "prepare" -> {
          val want = if (options["aec"] == "soft") "soft" else "hw"
          if (ctx != null) CallAec.remember(ctx, want)
          android.util.Log.i("TulmiStream", "call echo canceller: asked for $want, using ${CallAec.applied()}")
        }
        "begin" -> {
          route?.end()
          route = ctx?.let { c -> CallRoute(c) { sendEvent("onInterrupted", emptyMap()) }.also { it.begin() } }
        }
        "end" -> {
          route?.end()
          route = null
        }
      }
      CallAec.has()
    }

    Function("start") { options: Map<String, Any?> ->
      val url = options["url"] as? String ?: ""
      // No placeholder token: without a real one the request goes out
      // unauthenticated and the server's 401 says so, instead of a fake
      // "dev" bearer that could only ever be refused.
      val token = (options["token"] as? String)?.trim().orEmpty()
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
      route?.end()
      route = null
    }
  }
}

/**
 * THE AUDIO ROUTE FOR A LIVE CALL, and the one notice the call needs.
 *
 * The live client (react-native-webrtc) opens the microphone itself. What this adds is what the client leaves to the app:
 *
 *   * COMMUNICATION MODE AND FOCUS, so the phone treats the call as a call: the earpiece/speaker path, the in-call volume
 *     keys, and other apps ducked while it runs.
 *   * THE LOUDSPEAKER, unless a headset is the route — someone wearing one chose it. The item card has to stay in view, as it
 *     does on today's call. From API 31 the system picks the call's device and knows Bluetooth and LE Audio headsets; below
 *     it, only a wired one turns the loudspeaker off, because a call reaches Bluetooth there only over SCO, which we do not
 *     start: counting one would leave the call in the earpiece with the phone on the table.
 *   * FOCUS LOST (a cellular call, an alarm): the call stops its live part and waits for a tap, the same as the app going to
 *     the background (src/sdui/voice/callRealtime.ts).
 *
 * The echo canceller is not here: it has to be chosen as the app starts, before React builds the live client's audio, so it
 * lives in CallAec.kt and TulmiStreamPackage.kt.
 */
private class CallRoute(
  private val ctx: Context,
  private val interrupted: () -> Unit,
) {
  private val audio = ctx.getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
  private var focus: Any? = null
  private var listener: android.media.AudioManager.OnAudioFocusChangeListener? = null
  private var wasMode = android.media.AudioManager.MODE_NORMAL

  @Suppress("DEPRECATION") // the pre-26 focus request and the pre-31 speakerphone switch; minSdk is 24
  fun begin() {
    wasMode = audio.mode
    val l = android.media.AudioManager.OnAudioFocusChangeListener { change ->
      if (change == android.media.AudioManager.AUDIOFOCUS_LOSS ||
        change == android.media.AudioManager.AUDIOFOCUS_LOSS_TRANSIENT
      ) {
        interrupted()
      }
    }
    listener = l
    try {
      if (android.os.Build.VERSION.SDK_INT >= 26) {
        val attrs = android.media.AudioAttributes.Builder()
          .setUsage(android.media.AudioAttributes.USAGE_VOICE_COMMUNICATION)
          .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH)
          .build()
        val request = android.media.AudioFocusRequest
          .Builder(android.media.AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
          .setAudioAttributes(attrs)
          .setOnAudioFocusChangeListener(l)
          .build()
        focus = request
        audio.requestAudioFocus(request)
      } else {
        audio.requestAudioFocus(l, android.media.AudioManager.STREAM_VOICE_CALL, android.media.AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
      }
      audio.mode = android.media.AudioManager.MODE_IN_COMMUNICATION
      toSpeaker()
    } catch (e: Exception) {
      android.util.Log.w("TulmiStream", "call audio begin: ${e.message}")
    }
  }

  @Suppress("DEPRECATION") // the pre-26 focus request and the pre-31 speakerphone switch; minSdk is 24
  fun end() {
    try {
      if (android.os.Build.VERSION.SDK_INT >= 31) {
        audio.clearCommunicationDevice()
      } else {
        audio.isSpeakerphoneOn = false
      }
      audio.mode = wasMode
      val f = focus
      if (android.os.Build.VERSION.SDK_INT >= 26 && f is android.media.AudioFocusRequest) {
        audio.abandonAudioFocusRequest(f)
      } else {
        listener?.let { audio.abandonAudioFocus(it) }
      }
    } catch (e: Exception) {
      android.util.Log.w("TulmiStream", "call audio end: ${e.message}")
    }
    focus = null
    listener = null
  }

  /** A headset if one is there, the built-in speaker otherwise. */
  @Suppress("DEPRECATION") // the pre-31 speakerphone switch; minSdk is 24
  private fun toSpeaker() {
    // Plugged in: the sound goes there by itself, so the loudspeaker stays off.
    val wired = setOf(
      android.media.AudioDeviceInfo.TYPE_WIRED_HEADSET,
      android.media.AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
      android.media.AudioDeviceInfo.TYPE_USB_HEADSET,
    )
    if (android.os.Build.VERSION.SDK_INT >= 31) {
      // From 31 the system routes a call for us, and it knows about Bluetooth and LE Audio headsets too.
      val headsets = wired + setOf(
        android.media.AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
        android.media.AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
        android.media.AudioDeviceInfo.TYPE_BLE_HEADSET,
      )
      val devices = audio.availableCommunicationDevices
      val pick = devices.firstOrNull { headsets.contains(it.type) }
        ?: devices.firstOrNull { it.type == android.media.AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
      if (pick != null) audio.setCommunicationDevice(pick)
      return
    }
    // Below 31 a call reaches a Bluetooth headset only over SCO, and we do not start SCO: counting one as a headset would
    // leave the call in the earpiece with the phone on the table. A wired one is the only one that turns the speaker off.
    val outs = audio.getDevices(android.media.AudioManager.GET_DEVICES_OUTPUTS)
    val onWired = outs.any { wired.contains(it.type) }
    audio.isSpeakerphoneOn = !onWired
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
      .apply { if (token.isNotEmpty()) addHeader("Authorization", "Bearer $token") }
      .build()
    ws = client.newWebSocket(req, object : WebSocketListener() {
      override fun onOpen(webSocket: WebSocket, response: Response) {
        val start = JSONObject()
          .put("type", "start")
          .put("targetApp", targetApp)
          .put("language", language)
          .put("sampleRate", 16000)
          .put("encoding", "pcm_s16le")
          .put("channels", 1)
        if (token.isNotEmpty()) start.put("token", token)
        webSocket.send(start.toString())
        startCapture(webSocket)
      }

      override fun onMessage(webSocket: WebSocket, text: String) = handle(text)
      override fun onMessage(webSocket: WebSocket, bytes: ByteString) = handle(bytes.utf8())

      override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
        stopCapture()
        emit("onError", mapOf("code" to "network", "message" to (t.message ?: "stream failed")))
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
          // The server's `code` rides with its message, so JS can tell the
          // server's sentence from this module's own notes (each of which
          // carries a device code). See classify() in index.ts.
          val code = o.optString("code", "")
          val payload = mutableMapOf<String, Any?>("message" to o.optString("message", "stream error"))
          if (code.isNotEmpty()) payload["code"] = code
          emit("onError", payload)
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
      emit("onError", mapOf("code" to "permission", "message" to "Microphone permission denied"))
      return
    }
    if (rec.state != AudioRecord.STATE_INITIALIZED) {
      rec.release()
      emit("onError", mapOf("code" to "mic", "message" to "Mic unavailable"))
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
