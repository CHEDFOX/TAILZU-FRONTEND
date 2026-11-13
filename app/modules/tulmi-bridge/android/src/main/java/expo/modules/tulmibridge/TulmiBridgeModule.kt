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
      TailzuX0Board.requestUpdate(ctx)
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
      // A board reads the same glance, so it redraws on the same write.
      TailzuX0Board.requestUpdate(ctx)
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

    // ---------------------------------------------------------------- nlook: looks as data
    //
    // THE CATALOG THE WIDGETS DRAW FROM. The app fetched GET /v1/native/looks, cleaned every design on its own
    // (src/native/looksCore.ts) and hands the result here as
    //
    //     { "index": { v, drawsFormat, palettes, designs, art, fonts }, "designs": { "<id>": <design> } }
    //
    // keyed by DESIGN ID on both platforms, which lands in a NEW version folder (files/nlook/v<N>/) before one small
    // pointer file (files/nlook/current) is swapped by write-temp-then-rename. That rename is atomic for a file on
    // Android; renaming a directory over a non-empty directory is not, which is why the pointer exists at all. A widget
    // halfway through reading an old folder is never overwritten. Returns the folder's name, or "" when nothing was
    // written — and "" is not an error, it is today's twelve layouts carrying on.
    //
    // The three sweeps (old version folders, the paint cache, the art and font channels) are QUEUED behind the redraw
    // this call asks for, on the widgets' own serial queue: a sweep that ran here could delete a folder a widget was
    // reading at that moment.
    Function("setNativeLooks") { json: String ->
      val ctx = appContext.reactContext ?: return@Function ""
      if (json.isEmpty()) {
        TailzuWork.post { NLookStore.sweep(ctx) }
        return@Function ""
      }
      val o = TailzuQuick.obj(json) ?: return@Function ""
      val index = o.optJSONObject("index") ?: return@Function ""
      val designs = HashMap<String, String>()
      o.optJSONObject("designs")?.let { all ->
        for (key in all.keys()) {
          val design = all.optJSONObject(key) ?: continue
          designs[key] = design.toString()
        }
      }
      if (designs.isEmpty()) return@Function ""
      val name = NLookStore.write(ctx, index.toString(), designs) ?: return@Function ""
      TailzuX0.requestUpdate(ctx)
      TailzuX0Board.requestUpdate(ctx)
      TailzuWork.post {
        NLookStore.sweep(ctx)
        NLookPaint.sweep(ctx)
        NLookFiles.sweep(ctx, NLookStore.index(ctx))
      }
      name
    }

    // WHICH CATALOG THIS PHONE HOLDS: the `v` of the index the pointer names, so the app can ask the server only for what
    // it does not have. Null before any catalog has landed (src/native/looks.ts calls it when the binary has it).
    Function("nativeLooksVersion") {
      val ctx = appContext.reactContext ?: return@Function null
      NLookStore.version(ctx)
    }

    // ONE ART FILE, BY CONTENT. The app downloaded it from our art host and checked its PNG magic bytes, its size and its
    // sha256 before calling; this side checks the caps again and moves it into files/nlook/art/<sha>@<scale>.png, where a
    // new sha is always a NEW FILE. Nothing a current index or a drawing widget reads is ever overwritten. Returns the
    // path relative to files/, which is what the index maps an art key to, or "".
    Function("writeNativeArt") { sha: String, scale: Int, path: String ->
      val ctx = appContext.reactContext ?: return@Function ""
      NLookFiles.art(ctx, sha, scale, path)
    }

    // ONE FONT FILE, BY CONTENT. Android WIDGETS cannot use it — setTypeface is not remotable, so a widget's faces come
    // only from res/font — but the Tulmi IME in this same APK can (Typeface.createFromFile), so the hook is here and the
    // file is kept the same way art is. Returns the path relative to files/, or "".
    Function("writeNativeFont") { sha: String, path: String ->
      val ctx = appContext.reactContext ?: return@Function ""
      NLookFiles.font(ctx, sha, path)
    }

    // DESIGNS THIS PHONE SAW BREAK. Two strikes and a design is never drawn again here; the app reports these ids so the
    // server stops naming them for this device.
    Function("nativeLooksBad") {
      val ctx = appContext.reactContext ?: return@Function emptyList<String>()
      NLookStore.badIds(ctx)
    }

    // ---------------------------------------------------------------- "Bots at work", the Android notice
    //
    // The state of the running job, as the Live Activity's ContentState spells it (bot, botName, task, stage, of,
    // stageName, stages, startedAt, phase, minutes, link, vars). The notice is a TEMPLATE FILL, not a canvas: Android 16
    // Live Updates refuse custom layouts, so the look is the catalog's `liveupdate` design (bu.base) and this is only its
    // data. Kept in prefs so the X0 tick can repost it with the minutes counted on, without waking JavaScript.
    //
    // Nothing is posted until the app calls this, and the app calls it only when the server's switch is on: the notice is
    // dark in a build that carries it.
    Function("setBotsUpdate") { json: String ->
      val ctx = appContext.reactContext ?: return@Function
      TailzuBotsUpdate.set(ctx, json)
    }

    // The job ended, or the person signed out: the notice goes, and its state with it.
    Function("endBotsUpdate") {
      appContext.reactContext?.let { TailzuBotsUpdate.end(it) }
    }

    // THE APP ICON'S LONG-PRESS LIST (TailzuShortcuts.kt), as the server
    // lists it: dynamic shortcuts that open their link like any link.
    Function("setQuickActions") { json: String ->
      val ctx = appContext.reactContext ?: return@Function
      TailzuShortcuts.apply(ctx, json)
    }

    // Android's shortcuts arrive as links: nothing is ever left to consume.
    Function("consumeQuickAction") { "" }

    // WHAT THIS BINARY CAN DO THAT A JAVASCRIPT UPDATE CANNOT ADD. An update
    // reaches binaries built before these existed, so the app tells the server
    // only what the binary says here (src/device/binaryCore.ts). glanceSteps:
    // the X0 widget switches its lines on its own at the glance's `steps`
    // (TailzuX0Widget.kt). realtimeCall: this build links the live voice client
    // (react-native-webrtc) and TulmiStream's callAudio, so Plan Ease's call can
    // be a real conversation instead of turn by turn (callRealtime.ts). Time
    // Sensitive is iOS's alone; a leave-by already wakes an Android phone
    // through its high priority and channel.
    //   nativeLook   this build carries the nlook composer (NLook*.kt), so widget
    //                LOOKS can be sent as data. Told as NativeLook1. RemoteViews
    //                only gained setViewLayoutWidth/Height/Margin, a night-aware
    //                setColorStateList and setViewOutlinePreferredRadius in API 31,
    //                so an older phone is NOT told: it keeps today's 12 layouts.
    //   keySkin      the Tulmi IME in this same APK draws key faces (prints, marks,
    //                press effects, our fonts: KbKeyFace.kt). Told as KeySkin1, so
    //                the Keybot skin picker shows only where a skin can be drawn.
    //   liveUpdate   the ongoing "Bots at work" notice (TailzuBotsUpdate.kt). Told
    //                as LiveUpdate1. On API 36 it is promoted to a status-bar chip;
    //                below that it is an ordinary ongoing progress notification, so
    //                every version gets something and none is told a lie.
    //   widgetBoard  the spare "X0 Board" widget kind is in this build.
    // A name is added here only in the same build as what it promises, and comes
    // out again in the same commit if that item is cut.
    Function("binaryFeatures") {
      val names = mutableListOf("glanceSteps", "realtimeCall", "keySkin", "liveUpdate", "widgetBoard")
      if (android.os.Build.VERSION.SDK_INT >= 31) names.add("nativeLook")
      names.toList()
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
