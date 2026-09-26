package com.tulmi.app.keyboard

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AudioEffect
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import android.os.Build

/**
 * Audio conditioning for the keyboard's mic recording — the Android twin of
 * the iOS AVAudioSession .voiceChat mode + `voiceProcessing` enable path.
 *
 * Given the audio session id from a [android.media.MediaRecorder] or
 * [android.media.AudioRecord], attach the three system effects when the
 * device supports them:
 *
 *   • AcousticEchoCanceler   — kills the loopback signal (music playing on
 *                              the same device), important when the user
 *                              dictates while media is playing.
 *   • NoiseSuppressor        — knocks down steady-state background noise
 *                              (fans, HVAC, café hiss).
 *   • AutomaticGainControl   — keeps quiet speech from getting lost and
 *                              hot speech from clipping.
 *
 * Each effect is opt-in per device via [isAvailable]; on devices that
 * don't ship one, we skip it silently rather than fail — same behaviour as
 * the iOS voiceProcessing-not-supported fallback.
 *
 * Release [close] at recorder-stop time so we don't leak native handles.
 */
class TulmiAudioFx private constructor(
    private val aec: AcousticEchoCanceler?,
    private val ns: NoiseSuppressor?,
    private val agc: AutomaticGainControl?,
) : AutoCloseable {

    override fun close() {
        try { aec?.release() } catch (_: Throwable) {}
        try { ns?.release() }  catch (_: Throwable) {}
        try { agc?.release() } catch (_: Throwable) {}
    }

    /** True when at least one effect is attached and enabled. */
    val active: Boolean
        get() = (aec?.enabled == true) || (ns?.enabled == true) || (agc?.enabled == true)

    companion object {
        /**
         * kb.audio.voiceProcessing — the server's switch for all of this, the
         * one iOS reads to pick .voiceChat over a raw input. On (the default)
         * is how the keyboard has always recorded; off, no effect is attached
         * and the file recorder asks for the plain speech source.
         */
        fun voiceProcessing(): Boolean = knobBool("kb.audio.voiceProcessing", true)

        /**
         * Attach every supported effect to [audioSessionId]. Never throws —
         * returns a wrapper you can query and [close] at recorder-stop time.
         */
        fun attach(audioSessionId: Int): TulmiAudioFx {
            val aec = if (AcousticEchoCanceler.isAvailable()) {
                safeCreate { AcousticEchoCanceler.create(audioSessionId) }
                    ?.also { it.enabled = true }
            } else null
            val ns = if (NoiseSuppressor.isAvailable()) {
                safeCreate { NoiseSuppressor.create(audioSessionId) }
                    ?.also { it.enabled = true }
            } else null
            val agc = if (AutomaticGainControl.isAvailable()) {
                safeCreate { AutomaticGainControl.create(audioSessionId) }
                    ?.also { it.enabled = true }
            } else null
            return TulmiAudioFx(aec, ns, agc)
        }

        private inline fun <T : AudioEffect> safeCreate(block: () -> T?): T? =
            try { block() } catch (_: Throwable) { null }
    }
}

/**
 * What other apps' audio does while the keyboard records — the Android half of
 * iOS's .duckOthers session option (kb.audio.duckOthers).
 *
 * On (the default), music and podcasts are lowered for the length of the
 * dictation and come back when it ends, as on iOS. Off, the keyboard takes the
 * audio outright: iOS without .duckOthers interrupts other audio, and
 * GAIN_TRANSIENT_EXCLUSIVE is the request Android documents for speech
 * recognition that wants the same.
 *
 * Refused focus is not a failure — the recording goes ahead either way; this
 * only decides what everyone else hears. Never throws; [close] gives the focus
 * back and is safe to call more than once.
 */
class TulmiAudioFocus private constructor(
    private val am: AudioManager,
    private val request: Any,
) : AutoCloseable {

    @Volatile private var released = false

    override fun close() {
        if (released) return
        released = true
        try {
            if (Build.VERSION.SDK_INT >= 26 && request is AudioFocusRequest) {
                am.abandonAudioFocusRequest(request)
            } else if (request is AudioManager.OnAudioFocusChangeListener) {
                @Suppress("DEPRECATION") am.abandonAudioFocus(request)
            }
        } catch (_: Throwable) {}
    }

    companion object {
        fun request(context: Context): TulmiAudioFocus? = try {
            val am = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
            if (am == null) null else {
                val gain = if (knobBool("kb.audio.duckOthers", true)) AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK
                    else AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE
                // Losing focus back mid-dictation changes nothing: the mic keeps
                // recording whatever else starts to play.
                val listener = AudioManager.OnAudioFocusChangeListener { }
                if (Build.VERSION.SDK_INT >= 26) {
                    val req = AudioFocusRequest.Builder(gain)
                        .setAudioAttributes(
                            AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_ASSISTANT)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                                .build(),
                        )
                        .setOnAudioFocusChangeListener(listener)
                        .build()
                    am.requestAudioFocus(req)
                    TulmiAudioFocus(am, req)
                } else {
                    @Suppress("DEPRECATION") am.requestAudioFocus(listener, AudioManager.STREAM_MUSIC, gain)
                    TulmiAudioFocus(am, listener)
                }
            }
        } catch (_: Throwable) { null }
    }
}
