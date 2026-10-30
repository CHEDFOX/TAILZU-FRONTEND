package expo.modules.tulmibridge

import android.content.Context
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Color
import android.os.Build
import android.widget.RemoteViews
import org.json.JSONObject

/**
 * A colour for each theme. The widgets follow the phone's light or dark theme: on Android 12+ a view is handed both and the
 * launcher picks as the theme changes; before that the widget is drawn in the theme showing now, and drawn again on the app's
 * next write.
 */
internal data class Ink(val light: Int, val dark: Int) {
  fun pick(night: Boolean): Int = if (night) dark else light
}

/**
 * THE WIDGETS' PALETTE: the app's own (backend bots/palette.ts), white and ink with greys, light and dark. The roles live in
 * res/values/tailzu_widget_colors.xml and res/values-night/, the one source the layouts, previews and shortcut icons share; the
 * server's colours (the month's and the rows' `colors` for dark, `light` for light) go over them role by role.
 *
 *   ground   the card                       ink (pale)   titles, the number, a primary button
 *   meta     times, tags, a label           line         hairlines, a secondary button's border, the line's track
 *   surface  an avatar's disc               dim          idle icons
 */
internal object WidgetInk {
  /** Whether the phone shows its dark theme now. */
  fun isNight(context: Context): Boolean =
    (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

  /** A role's colour resource. Anything not listed is the ink. */
  private fun resource(role: String): Int = when (role) {
    "ground" -> R.color.tailzu_widget_ground
    "meta" -> R.color.tailzu_widget_meta
    "dim" -> R.color.tailzu_widget_dim
    "line" -> R.color.tailzu_widget_line
    "surface" -> R.color.tailzu_widget_surface
    else -> R.color.tailzu_widget_ink
  }

  /** The palette's colours, both themes, read from the resources with the theme forced each way. */
  class Palette(context: Context) {
    private val day = themed(context, false)
    private val night = themed(context, true)

    fun role(role: String): Ink {
      val id = resource(role)
      return Ink(color(day, id, LIGHT[role] ?: LIGHT.getValue("ink")), color(night, id, DARK[role] ?: DARK.getValue("ink")))
    }

    private fun color(context: Context?, id: Int, fallback: Int): Int = try {
      context?.getColor(id) ?: fallback
    } catch (_: Exception) {
      fallback
    }

    private fun themed(context: Context, dark: Boolean): Context? = try {
      val config = Configuration(context.resources.configuration)
      config.uiMode = (config.uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or
        (if (dark) Configuration.UI_MODE_NIGHT_YES else Configuration.UI_MODE_NIGHT_NO)
      context.createConfigurationContext(config)
    } catch (_: Exception) {
      null
    }
  }

  // The same palette as literals, only for a phone that cannot read the resources (it never should).
  private val LIGHT = mapOf(
    "ground" to Color.rgb(0xFF, 0xFF, 0xFF), "ink" to Color.rgb(0x0A, 0x0A, 0x0A), "meta" to Color.rgb(0x5C, 0x5C, 0x5C),
    "dim" to Color.rgb(0x8A, 0x8A, 0x8A), "line" to Color.rgb(0xE6, 0xE6, 0xE6), "surface" to Color.rgb(0xF5, 0xF5, 0xF5),
  )
  private val DARK = mapOf(
    "ground" to Color.rgb(0x0A, 0x0A, 0x0A), "ink" to Color.rgb(0xFF, 0xFF, 0xFF), "meta" to Color.rgb(0xA3, 0xA3, 0xA3),
    "dim" to Color.rgb(0x73, 0x73, 0x73), "line" to Color.rgb(0x26, 0x26, 0x26), "surface" to Color.rgb(0x17, 0x17, 0x17),
  )

  /**
   * A role's colours: the server's for each theme (`dark` its `colors`, `light` its `light`), each falling back through `more`
   * (the month's theme key, then the month) and then the palette.
   */
  fun resolve(key: String, fallback: Ink, light: List<JSONObject?>, dark: List<JSONObject?>): Ink = Ink(
    light.firstNotNullOfOrNull { MonthLook.hex(it?.opt(key) as? String) } ?: fallback.light,
    dark.firstNotNullOfOrNull { MonthLook.hex(it?.opt(key) as? String) } ?: fallback.dark,
  )

  /** A colour through a one-int method (setTextColor, setBackgroundColor): both themes on Android 12+, the one showing before. */
  fun set(rv: RemoteViews, id: Int, method: String, ink: Ink, night: Boolean) {
    if (Build.VERSION.SDK_INT >= 31) rv.setColorInt(id, method, ink.light, ink.dark)
    else rv.setInt(id, method, ink.pick(night))
  }

  fun text(rv: RemoteViews, id: Int, ink: Ink, night: Boolean) = set(rv, id, "setTextColor", ink, night)

  /**
   * An image (a white or themed shape, a glyph) drawn in a colour, its alpha kept: a tint per theme on Android 12+; before
   * that the colour, opaque, as a filter and its alpha on the image, so a see-through colour is see-through rather than paler.
   */
  fun image(rv: RemoteViews, id: Int, ink: Ink, night: Boolean) {
    if (Build.VERSION.SDK_INT >= 31) {
      rv.setColorStateList(id, "setImageTintList", ColorStateList.valueOf(ink.light), ColorStateList.valueOf(ink.dark))
    } else {
      val c = ink.pick(night)
      rv.setInt(id, "setColorFilter", c or 0xFF000000.toInt())
      rv.setInt(id, "setImageAlpha", Color.alpha(c))
    }
  }

  /** A colour too dark to show on the dark ground (X0's own ink): the dark theme's ink instead there. */
  fun onDark(color: Int, ink: Ink): Ink {
    val lum = (0.2126 * Color.red(color) + 0.7152 * Color.green(color) + 0.0722 * Color.blue(color)) / 255.0
    return Ink(color, if (lum < 0.2) ink.dark else color)
  }

  /** The mark (the app icon's bot) is drawn as it is painted, never tinted. */
  fun isMark(name: String?): Boolean = name?.startsWith("tailzu_widget_mark") == true
}
