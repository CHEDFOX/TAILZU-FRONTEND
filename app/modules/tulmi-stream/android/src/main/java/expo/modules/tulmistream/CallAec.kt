package expo.modules.tulmistream

import android.app.Application
import android.content.Context

/**
 * WHICH ECHO CANCELLER PLAN EASE'S LIVE CALL USES (src/sdui/voice/callRealtime.ts, SOFT_AEC_MODELS; docs/STREAMING.md).
 *
 * Some budget phones hear themselves: their own canceller is not good enough for a speakerphone call, and the bot ends up
 * answering its own voice. For those, the live client is asked to build its software canceller instead.
 *
 * THE CHOICE CANNOT BE MADE WHEN THE CALL STARTS. React creates its native modules as the app starts, before any JavaScript
 * runs, and the live client builds its audio in its own constructor: by the time a call could ask, the phone's own canceller
 * is already in use and asking does nothing. So the ask is REMEMBERED (`remember`, from the call's `prepare`) and applied at
 * the next start of the app (`applyStored`, from TulmiStreamPackage's application listener). A phone added to the list gets
 * the software canceller from its next start, and `applied` says what this process really has, so the log cannot claim one
 * canceller while the call uses the other.
 *
 * Nothing here loads the live client unless the software canceller was asked for: a phone that does not need it never pays
 * for the client's native library at start-up.
 */
object CallAec {
  private const val PREFS = "tulmi.call"
  private const val KEY = "aec"

  /** What this process really has. Set once, at the start of the app. */
  @Volatile private var software = false

  /** What the call's `prepare` asked for: "soft" or "hw". It takes effect at the next start of the app. */
  fun remember(ctx: Context, want: String) {
    try {
      ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, if (want == "soft") "soft" else "hw").apply()
    } catch (e: Throwable) {
      android.util.Log.w("TulmiStream", "echo canceller not remembered: ${e.message}")
    }
  }

  /** Which canceller a call on this process really gets: "soft" or "hw". The call reads it and stays a turn call on a mismatch. */
  fun has(): String = if (software) "soft" else "hw"

  /** The same thing in the words the log says. */
  fun applied(): String = if (software) "libwebrtc's own (software)" else "the phone's own"

  /**
   * At the start of the app: the software canceller, when the last call asked for it. The live client's options object is
   * reached by name (consumer-rules.pro keeps it), so this module still compiles and runs in a build without that client.
   */
  fun applyStored(application: Application) {
    val want = try {
      application.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "hw")
    } catch (e: Throwable) {
      null
    }
    if (want != "soft") return
    software = build(application)
  }

  private fun build(ctx: Context): Boolean = try {
    val optionsClass = Class.forName("com.oney.WebRTCModule.WebRTCModuleOptions")
    val options = optionsClass.getMethod("getInstance").invoke(null)
    val field = optionsClass.getField("audioDeviceModule")
    if (field.get(options) != null) {
      // Something built the client's audio before us: the phone's own canceller is what the call will use.
      false
    } else {
      val moduleClass = Class.forName("org.webrtc.audio.JavaAudioDeviceModule")
      var builder = moduleClass.getMethod("builder", Context::class.java).invoke(null, ctx)!!
      for (setter in listOf("setUseHardwareAcousticEchoCanceler", "setUseHardwareNoiseSuppressor")) {
        builder = builder.javaClass.getMethod(setter, Boolean::class.javaPrimitiveType).invoke(builder, false)!!
      }
      field.set(options, builder.javaClass.getMethod("createAudioDeviceModule").invoke(builder))
      true
    }
  } catch (e: Throwable) {
    android.util.Log.w("TulmiStream", "software echo canceller not set: ${e.message}")
    false
  }
}
