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
    @Volatile private var capturing = false

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
                "final", "done" -> onFinal(o.optString("text"))
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
                MediaRecorder.AudioSource.MIC,
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

    /** Stop the mic, tell the server we're done, and close. */
    fun finish() {
        stopCapture()
        ws?.send("{\"type\":\"stop\"}")
        ws?.close(1000, null)
    }

    /** Abort immediately (keyboard dismissed, error). */
    fun cancel() {
        stopCapture()
        ws?.cancel()
        ws = null
    }
}
