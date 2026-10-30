package expo.modules.tulmibridge

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Writes the app's backend URL + the user's token into the app's `tulmi`
 * SharedPreferences. The Tulmi IME runs in the same package, so it can read
 * these directly (see Net.load in the keyboard module). What the home-screen
 * widgets draw goes the same way, into `tulmi.widget`.
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

    // THE WIDGET THEME. The colours the app writes on every bootstrap (from
    // widget.color.*: `colors` for dark, `light` for light); the widgets read
    // them over their own palette (WidgetInk), From your people and X0 alike.
    // An empty string clears it (sign-out). Both redraw. (There is no Month
    // widget on Android any more: X0 took its place, so its key, which nothing
    // reads now, goes too.)
    Function("setWidgetTheme") { json: String ->
      val ctx = appContext.reactContext ?: return@Function
      ctx.getSharedPreferences(TailzuQuick.PREFS, Context.MODE_PRIVATE)
        .edit()
        .putString(TailzuQuick.THEME_KEY, json)
        .remove("tulmi.widget.month")
        .apply()
      TailzuQuick.requestUpdate(ctx)
      TailzuX0.requestUpdate(ctx)
    }

    // THE X0 WIDGET'S GLANCE (TailzuX0Widget.kt): GET /v1/shell/glance?v=2
    // as the app checked it (src/widgets/glance.ts), under `x0.glance`, with
    // the moment it was written (an answer pressed on the widget is drawn
    // over its question until the next write). The bots' faces are files the
    // app downloads beside it (files/widget-faces/<face>.png). An empty string
    // clears it (sign-out). Every placed X0 redraws.
    Function("setWidgetGlance") { json: String ->
      val ctx = appContext.reactContext ?: return@Function
      val e = ctx.getSharedPreferences(TailzuQuick.PREFS, Context.MODE_PRIVATE).edit()
      if (json.isEmpty()) e.remove(TailzuX0.KEY) else e.putString(TailzuX0.KEY, json)
      e.putLong(TailzuX0.WRITTEN_AT, System.currentTimeMillis()).apply()
      TailzuX0.requestUpdate(ctx)
    }

    // THE QUICK-ACCESS WIDGETS' ROWS (TailzuQuickWidgets.kt): GET
    // /v1/widgets/now's document as the app checked it (src/widgets/now.ts),
    // with the moment it was written (a pressed button's outcome is drawn over
    // its row until the next write). An empty string clears it (sign-out).
    // From your people redraws.
    Function("setWidgetNow") { json: String ->
      val ctx = appContext.reactContext ?: return@Function
      val e = ctx.getSharedPreferences(TailzuQuick.PREFS, Context.MODE_PRIVATE).edit()
      if (json.isEmpty()) e.remove(TailzuQuick.NOW).remove(TailzuQuick.STATE) else e.putString(TailzuQuick.NOW, json)
      e.putLong(TailzuQuick.WRITTEN_AT, System.currentTimeMillis()).apply()
      TailzuQuick.requestUpdate(ctx)
    }

    // THE WIDGETS' OWN TOKEN (POST /v1/widgets/token): it can only answer this
    // person's needs-you and tick their own tasks, and runs out in a day. Kept
    // in this app's private SharedPreferences, beside where a button posts.
    // Never the session's token. An empty string deletes it.
    Function("setWidgetToken") { json: String ->
      val ctx = appContext.reactContext ?: return@Function
      val e = ctx.getSharedPreferences(TailzuQuick.PREFS, Context.MODE_PRIVATE).edit()
      val o = TailzuQuick.obj(json)
      val token = o?.optString("token")?.takeIf { it.startsWith("xwt_") }
      if (o == null || token == null) {
        e.remove(TailzuQuick.TOKEN).remove(TailzuQuick.TOKEN_META).apply()
        TailzuX0.requestUpdate(ctx)
        return@Function
      }
      val meta = org.json.JSONObject()
        .put("expiresAt", o.optLong("expiresAt", 0L))
        .put("baseUrl", o.optString("baseUrl", ""))
        .put("path", o.optString("path", "/v1/widgets/act"))
      e.putString(TailzuQuick.TOKEN, token).putString(TailzuQuick.TOKEN_META, meta.toString()).apply()
      // X0's answers answer here only while there is a token: drawn again with it.
      TailzuX0.requestUpdate(ctx)
    }

    // THE APP ICON'S LONG-PRESS LIST (TailzuShortcuts.kt), as the server
    // lists it: dynamic shortcuts that open their link like any link.
    Function("setQuickActions") { json: String ->
      val ctx = appContext.reactContext ?: return@Function
      TailzuShortcuts.apply(ctx, json)
    }

    // Android's shortcuts arrive as links: nothing is ever left to consume.
    Function("consumeQuickAction") { "" }

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
