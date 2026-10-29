package expo.modules.tulmibridge

import android.content.Context
import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import org.json.JSONArray

/**
 * LONG-PRESS THE APP ICON (Android app shortcuts): Ask, Dictate, New note, Spaces, as the server lists them
 * (app.quickActions.android; src/quickActions in the app), set on every launch the list changed. Each opens its link through the
 * app's own deep-link intent filter, so it arrives like any link (the app's router decides what it may open). The icon is a
 * drawable by the server's name (tailzu_qa_* ship with the bridge), else the app's own icon. Android 7.1 and later.
 */
object TailzuShortcuts {
  /** Replace the dynamic shortcuts with the server's list ([{ id, title, subtitle?, icon?, url }]); an empty list clears them. */
  fun apply(context: Context, json: String) {
    if (Build.VERSION.SDK_INT < 25) return
    try {
      val manager = context.getSystemService(ShortcutManager::class.java) ?: return
      val list = try {
        JSONArray(json)
      } catch (_: Exception) {
        JSONArray()
      }
      val out = ArrayList<ShortcutInfo>()
      val max = manager.maxShortcutCountPerActivity.coerceAtMost(4)
      for (i in 0 until list.length()) {
        if (out.size >= max) break
        val o = list.optJSONObject(i) ?: continue
        val id = o.optString("id")
        val title = o.optString("title")
        val url = o.optString("url")
        if (id.isEmpty() || title.isEmpty()) continue
        val intent = TailzuQuick.openIntent(context, url) ?: continue
        val subtitle = o.optString("subtitle").ifEmpty { title }
        val iconRes = TailzuQuick.drawable(context, o.optString("icon"), context.applicationInfo.icon)
        out.add(
          ShortcutInfo.Builder(context, "x0_$id")
            .setShortLabel(title.take(25))
            .setLongLabel(subtitle.take(40))
            .setIcon(Icon.createWithResource(context, iconRes))
            .setIntent(Intent(Intent.ACTION_VIEW, intent.data ?: Uri.parse(url)).setPackage(context.packageName))
            .setRank(out.size)
            .build()
        )
      }
      if (out.isEmpty()) manager.removeAllDynamicShortcuts() else manager.setDynamicShortcuts(out)
    } catch (_: Exception) {
      // Rate-limited, or a launcher that refused: the app opens as ever.
    }
  }
}
