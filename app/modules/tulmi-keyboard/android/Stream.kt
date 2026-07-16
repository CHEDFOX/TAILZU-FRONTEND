package com.tulmi.app.keyboard

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
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
 * Live (streaming) dictation for the keyboard. Opens a WebSocket to
 * `/v1/transcribe-stream`, streams raw 16 kHz mono PCM from the mic, and reports
 * partial + final transcripts as they arrive. Engine-agnostic — the backend
 * relays audio to whatever speech engine it uses. See STREAMING.md.
 *
 * Callbacks fire on OkHttp/recorder threads; the caller marshals to the UI.
 */
class Stream(
    private val onReady: () -> Unit,
    private val onPartial: (String) -> Unit,
    private val onFinal: (String) -> Unit,
    private val onError: (String) -> Unit,
    private val onClosed: () -> Unit,
) {
    // A dedicated client: no call timeout, so the socket can stay open.
    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    private var ws: WebSocket? = null
    private var record: AudioRecord? = null
    private var audioFx: TulmiAudioFx? = null
    private var captureThread: Thread? = null
    @Volatile private var capturing = false

    /**
     * Backpressure cap — mirrors iOS TulmiStream.swift `sendCapBytes`. The IME
     * process has a hard memory ceiling and unbounded audio queuing on a
     * slow/failing socket gets it OOM-killed. We rely on OkHttp's own accounting
     * via `WebSocket.queueSize()` (bytes queued to be transmitted) rather than
     * a manual counter, since OkHttp's `send()` has no completion callback that
     * would let us decrement one accurately. We drop the NEWEST frames when
     * over cap (iOS drops newest too), and log the first drop only so a bad
     * network doesn't flood logcat.
     */
    private val sendCapBytes = 2 * 1024 * 1024
    @Volatile private var dropLogged = false

    fun start(targetApp: String, language: String) {
        val req = Request.Builder()
            .url(Net.streamUrl())
            .addHeader("Authorization", "Bearer ${Net.bearer()}")
            .build()
        ws = client.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                val start = JSONObject()
                    .put("type", "start")
                    .put("token", Net.bearer())
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
                onError(t.message ?: "stream failed")
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                stopCapture()
                onClosed()
            }
        })
    }

    private fun handle(text: String) {
        try {
            val o = JSONObject(text)
            when (o.optString("type")) {
                "ready" -> onReady()
                "partial" -> onPartial(o.optString("text"))
                "final" -> onFinal(o.optString("text"))
                // "done" is the terminal marker, NOT a transcript — it carries
                // no text. Treating it as a final inserted a stray trailing
                // space at the cursor. It's a clean close.
                "done" -> onClosed()
                "error" -> onError(o.optString("message", "stream error"))
            }
        } catch (_: Exception) { /* ignore malformed frames */ }
    }

    private fun startCapture(webSocket: WebSocket) {
        val minBuf = AudioRecord.getMinBufferSize(
            16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT
        )
        val bufSize = maxOf(minBuf, 4096)
        val rec = try {
            AudioRecord(
                // VOICE_RECOGNITION applies the OS's STT-tuned front-end
                // (less aggressive than VOICE_COMMUNICATION's call AEC) and is
                // the recommended source for dictation.
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                16000,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                bufSize * 2,
            )
        } catch (e: SecurityException) {
            onError("Microphone permission denied")
            return
        }
        if (rec.state != AudioRecord.STATE_INITIALIZED) {
            rec.release()
            onError("Mic unavailable")
            return
        }
        record = rec
        // Attach OS noise-suppression / echo-cancel / AGC to this capture
        // session. AudioRecord exposes a real session id (MediaRecorder does
        // not), so effects actually bind here. Each is guarded by isAvailable()
        // inside the helper; released in stopCapture().
        audioFx = try { TulmiAudioFx.attach(rec.audioSessionId) } catch (_: Throwable) { null }
        capturing = true
        rec.startRecording()
        captureThread = thread(name = "tulmi-mic") {
            val buf = ByteArray(bufSize)
            while (capturing) {
                val n = rec.read(buf, 0, buf.size)
                if (n <= 0) continue
                // Drop newest frames when the socket is backlogged rather than
                // queuing forever (keyboard process would OOM). Matches iOS.
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

    private fun stopCapture() {
        // Signal the capture loop to exit, then JOIN it before touching the
        // AudioRecord. The mic thread blocks in rec.read(); releasing the record
        // on another thread while a read is in flight is a use-after-free on
        // native memory → hard crash. Joining first guarantees the read has
        // returned and the thread has stopped touching `record`.
        capturing = false
        captureThread?.let { t -> try { t.join(700) } catch (_: InterruptedException) {} }
        captureThread = null
        try { record?.stop() } catch (_: Exception) {}
        try { record?.release() } catch (_: Exception) {}
        record = null
        try { audioFx?.close() } catch (_: Exception) {}
        audioFx = null
    }

    /**
     * Stop the mic and tell the server we're done — but KEEP the socket open.
     * The speech engine only emits the final tail segment(s) AFTER it receives
     * our "stop" and flushes; the server then sends "done" and closes. Closing
     * here (the old behaviour) dropped that tail → truncated endings. A watchdog
     * force-closes if "done" never arrives so we don't leak the socket.
     */
    fun finish() {
        stopCapture()
        val socket = ws ?: run { onClosed(); return }
        socket.send("{\"type\":\"stop\"}")
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
            try { ws?.close(1000, null) } catch (_: Exception) {}
        }, 2500)
    }

    /** Abort immediately (keyboard dismissed, error). */
    fun cancel() {
        stopCapture()
        ws?.cancel()
        ws = null
    }
}
