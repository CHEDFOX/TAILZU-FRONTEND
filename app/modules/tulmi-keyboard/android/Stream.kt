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
    // Cheap per-frame mic level (0..1 RMS) so level-bound UI (a Waveform node,
    // etc.) reacts during live streaming — the file-based path polls
    // MediaRecorder.maxAmplitude, but AudioRecord exposes no equivalent, so we
    // derive it off the PCM here. Fires on the capture thread; the caller
    // marshals to the UI. Defaults to a no-op for callers that don't need it.
    private val onLevel: (Float) -> Unit = {},
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

    // One-shot terminal guard. A normal end delivers a "done" frame AND then a
    // socket close (code 1000) — two paths into teardown. onFailure/onError are
    // terminal too. This ensures exactly one of onClosed()/onError() ever fires.
    @Volatile private var closed = false

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
                if (closed) return
                closed = true
                stopCapture()
                onError(t.message ?: "stream failed")
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                finishClose()
            }
        })
    }

    /** Fire the one terminal onClosed() + release the mic, at most once. */
    private fun finishClose() {
        if (closed) return
        closed = true
        stopCapture()
        onClosed()
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
                // space at the cursor. It's a clean close. Guarded so the socket
                // close (code 1000) that follows doesn't double-fire teardown.
                "done" -> finishClose()
                "error" -> {
                    // Terminal server error mid-stream: release the mic + socket
                    // right here (matching the failure/closed paths) so the mic
                    // can't stay hot even if the caller forgets to cancel().
                    if (closed) return
                    closed = true
                    stopCapture()
                    try { ws?.cancel() } catch (_: Exception) {}
                    onError(o.optString("message", "stream error"))
                }
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
                // A stop can flip `capturing` while we were blocked in read();
                // don't send (or level-report) a frame captured after stop.
                if (!capturing) break
                if (n <= 0) continue
                // Publish a cheap RMS level so level-bound UI reacts while the
                // mic is live (even for frames we end up dropping below).
                onLevel(rmsLevel(buf, n))
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
        // Release the mic WITHOUT blocking the caller (this runs on the IME's UI
        // thread via finish()/cancel()) and WITHOUT ever racing an in-flight
        // read. The mic thread blocks in rec.read(); freeing the AudioRecord
        // while a read is in flight is a use-after-free on native memory → hard
        // crash. The old code join(700)'d on the UI thread — an ANR risk, and if
        // the join TIMED OUT it released the record anyway (the very race it
        // meant to prevent). Instead: snapshot + null the refs under a lock (so
        // concurrent stop calls can't both release), then do an UNBOUNDED join +
        // release on a background thread. read() returns within one buffer
        // (~128ms) once `capturing` is false, so the join is short but bounded by
        // actual thread exit — release can never outrun the read.
        val t: Thread?
        val rec: AudioRecord?
        val fx: TulmiAudioFx?
        synchronized(this) {
            capturing = false
            t = captureThread
            rec = record
            fx = audioFx
            captureThread = null
            record = null
            audioFx = null
        }
        if (t == null) {
            // No capture thread (never started / already torn down) — nothing can
            // race, so release inline.
            try { rec?.stop() } catch (_: Exception) {}
            try { rec?.release() } catch (_: Exception) {}
            try { fx?.close() } catch (_: Exception) {}
            return
        }
        t.interrupt() // best-effort nudge; read() itself returns on the next buffer
        thread(name = "tulmi-mic-teardown") {
            try { t.join() } catch (_: InterruptedException) {}
            try { rec?.stop() } catch (_: Exception) {}
            try { rec?.release() } catch (_: Exception) {}
            try { fx?.close() } catch (_: Exception) {}
        }
    }

    /** Cheap RMS over one PCM frame (16-bit LE), normalized to 0..1. */
    private fun rmsLevel(buf: ByteArray, n: Int): Float {
        var sum = 0.0
        var i = 0
        while (i + 1 < n) {
            val s = (buf[i + 1].toInt() shl 8) or (buf[i].toInt() and 0xff)
            sum += (s * s).toDouble()
            i += 2
        }
        val samples = (n / 2).coerceAtLeast(1)
        return (kotlin.math.sqrt(sum / samples) / 32768.0).toFloat().coerceIn(0f, 1f)
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
        val socket = ws ?: run { finishClose(); return }
        socket.send("{\"type\":\"stop\"}")
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
            try { ws?.close(1000, null) } catch (_: Exception) {}
        }, 2500)
    }

    /** Abort immediately (keyboard dismissed, error). */
    fun cancel() {
        // Silent abort: mark terminal FIRST so the forced ws.cancel() below can't
        // bubble an onFailure → onError back to a caller that's already tearing
        // down. The caller manages its own state after cancel().
        closed = true
        stopCapture()
        ws?.cancel()
        ws = null
    }
}
