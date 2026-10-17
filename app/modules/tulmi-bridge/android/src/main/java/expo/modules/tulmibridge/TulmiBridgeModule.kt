package expo.modules.tulmibridge

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Writes the app's backend URL + the user's token into the app's `tulmi`
 * SharedPreferences. The Tulmi IME runs in the same package, so it can read
 * these directly (see Net.load in the keyboard module). The month for the
 * home-screen widget goes the same way, into `tulmi.widget`.
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

    // The language the user picked (hi / es / hinglish / auto / …). The
    // keyboard sends it with dictation and refine as a hint (Net.language);
    // without it the server's kb.dictation.defaultLanguage applies.
    Function("setKeyboardLanguage") { code: String ->
      val ctx = appContext.reactContext ?: return@Function
      ctx.getSharedPreferences("tulmi", Context.MODE_PRIVATE)
        .edit()
        .putString("tulmi.language", code)
        .apply()
    }

    // Text-expansion dictionary (JSON array of { word, replacement }).
    Function("setDictionary") { json: String ->
      val ctx = appContext.reactContext ?: return@Function
      ctx.getSharedPreferences("tulmi", Context.MODE_PRIVATE)
        .edit()
        .putString("tulmi.dictionary", json)
        .apply()
    }

    // Pre-seed the keyboard with the config the app just fetched
    // (GET /v1/keyboard/config), so the keyboard's very first open draws the
    // server's current keyboard instead of the one bundled at build time. Same
    // SharedPreferences file + key the IME caches its own fetches under
    // ("tulmi_kb" / "config_json"); the IME re-validates it before use and
    // replaces it with its own fetch as soon as it has one. Anything that is
    // not a keyboard config (not JSON, or neither a tree nor a theme) is
    // ignored so a bad payload can never replace a good cache.
    Function("setKeyboardConfig") { json: String ->
      val ctx = appContext.reactContext ?: return@Function
      val usable = try {
        val o = org.json.JSONObject(json)
        o.has("root") || o.has("theme")
      } catch (_: Exception) {
        false
      }
      if (!usable) return@Function
      ctx.getSharedPreferences("tulmi_kb", Context.MODE_PRIVATE)
        .edit()
        .putString("config_json", json)
        .apply()
    }

    // THE MONTH, FOR THE WIDGET. The same JSON the iOS widget reads from the
    // App Group: the numbers the app just fetched, and the words, colours and
    // tap target the widget draws them with, built from the server's labels
    // and flags (src/widgets/month.ts). Kept in the app's own
    // SharedPreferences, since the widget's provider runs in this package
    // (TailzuMonthWidget.kt), and every placed widget is asked to draw again.
    // Nothing the widget shows is fetched by the widget.
    Function("setWidgetMonth") { json: String ->
      val ctx = appContext.reactContext ?: return@Function
      ctx.getSharedPreferences(TailzuMonthWidget.PREFS, Context.MODE_PRIVATE)
        .edit()
        .putString(TailzuMonthWidget.KEY, json)
        .apply()
      TailzuMonthWidget.requestUpdate(ctx)
    }

    // THE WIDGET THEME. The colours and alphas the app writes on every
    // bootstrap (from widget.color.* / widget.alpha.*); MonthLook reads this
    // key first, so the widget's colours are the server's even before any
    // month numbers have been written. An empty string clears it (sign-out),
    // and MonthLook falls back to the month key and the literal. Same
    // SharedPreferences file as the month, and every placed widget redraws.
    Function("setWidgetTheme") { json: String ->
      val ctx = appContext.reactContext ?: return@Function
      ctx.getSharedPreferences(TailzuMonthWidget.PREFS, Context.MODE_PRIVATE)
        .edit()
        .putString(TailzuMonthWidget.THEME_KEY, json)
        .apply()
      TailzuMonthWidget.requestUpdate(ctx)
    }

    // Whether the Tulmi IME is enabled (and currently selected). Android IMEs
    // get network via the manifest, so there's no separate "Full Access" — being
    // enabled is the permission the onboarding gate waits for.
    Function("getKeyboardStatus") {
      val ctx = appContext.reactContext
        ?: return@Function mapOf("enabled" to false, "fullAccess" to false, "selected" to false, "lastActiveMs" to 0.0)
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
