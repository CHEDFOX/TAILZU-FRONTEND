package expo.modules.tulmistream

import android.app.Application
import android.content.Context
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package

/**
 * THE ONE THING THIS MODULE HAS TO DO BEFORE REACT STARTS: pick the live call's echo canceller (CallAec; the call itself is
 * src/sdui/voice/callRealtime.ts). Autolinking finds this class by its name and its import, and expo's
 * ApplicationLifecycleDispatcher runs it from Application.onCreate — before the native modules are created, which is where
 * the live client builds its audio and the choice stops being possible.
 *
 * It reads what the last call stored and nothing else: no network, no permission, and no live client at all unless the
 * software canceller was asked for.
 */
class TulmiStreamPackage : Package {
  override fun createApplicationLifecycleListeners(context: Context?): List<ApplicationLifecycleListener> =
    listOf(object : ApplicationLifecycleListener {
      override fun onCreate(application: Application) {
        CallAec.applyStored(application)
      }
    })
}
