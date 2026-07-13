package com.tulmi.app.keyboard

import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AudioEffect
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor

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

    fun close() {
        try { aec?.release() } catch (_: Throwable) {}
        try { ns?.release() }  catch (_: Throwable) {}
        try { agc?.release() } catch (_: Throwable) {}
    }

    /** True when at least one effect is attached and enabled. */
    val active: Boolean
        get() = (aec?.enabled == true) || (ns?.enabled == true) || (agc?.enabled == true)

    companion object {
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
