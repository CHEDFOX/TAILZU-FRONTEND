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

    // Whether the Tulmi IME is enabled (and currently selected). Android IMEs
    // get network via the manifest, so there's no separate "Full Access" — being
    // enabled is the permission the onboarding gate waits for.
    Function("getKeyboardStatus") {
      val ctx = appContext.reactContext
        ?: return@Function mapOf("enabled" to false, "fullAccess" to false, "lastActiveMs" to 0.0)
      val imm = ctx.getSystemService(Context.INPUT_METHOD_SERVICE)
        as android.view.inputmethod.InputMethodManager
      val pkg = ctx.packageName
      val enabled = imm.enabledInputMethodList.any { it.packageName == pkg }
      val selected = android.provider.Settings.Secure
        .getString(ctx.contentResolver, android.provider.Settings.Secure.DEFAULT_INPUT_METHOD)
        ?.startsWith(pkg) == true
      mapOf("enabled" to enabled, "fullAccess" to enabled, "selected" to selected, "lastActiveMs" to 0.0)
    }
  }
}
