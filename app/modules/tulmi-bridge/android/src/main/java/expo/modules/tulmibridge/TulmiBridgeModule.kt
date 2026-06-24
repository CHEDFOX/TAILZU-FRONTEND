package expo.modules.tulmibridge

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Writes the app's backend URL + the user's token into the app's `tulmi`
 * SharedPreferences. The Tulmi IME runs in the same package, so it can read
 * these directly (see Net.load in the keyboard module).
 */
class TulmiBridgeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TulmiBridge")

    Function("setKeyboardCredentials") { baseUrl: String, token: String ->
      val ctx = appContext.reactContext ?: return@Function
      ctx.getSharedPreferences("tulmi", Context.MODE_PRIVATE)
        .edit()
        .putString("tulmi.baseUrl", baseUrl)
        .putString("tulmi.token", token)
        .apply()
    }
  }
}
