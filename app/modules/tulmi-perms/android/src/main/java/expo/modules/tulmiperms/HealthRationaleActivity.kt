package expo.modules.tulmiperms

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle

/**
 * "Why does X0 Bot want this?" in Health Connect.
 *
 * Health Connect shows a link beside its permission sheet, and from Android 14
 * the permissions screen has its own "see how this app uses your data". Both
 * are supposed to land on a page that really explains it, so this opens the
 * privacy policy's health section and closes itself at once. It is reached by
 * two manifest entries, which plugin/withTulmiPerms.js writes ONLY when the
 * Android health build switch is on: the ACTION_SHOW_PERMISSIONS_RATIONALE
 * filter on this activity (Android 13 and older) and a VIEW_PERMISSION_USAGE
 * alias guarded by START_VIEW_PERMISSION_USAGE (Android 14 and newer).
 *
 * react-native-health-connect's own plugin writes those two entries pointing at
 * MainActivity, which cannot tell JavaScript which action started it, so the
 * person would land on Home. That plugin is deliberately not in app.config.ts;
 * the library still links on its own.
 */
class HealthRationaleActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    try {
      startActivity(
        Intent(Intent.ACTION_VIEW, Uri.parse(POLICY)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      )
    } catch (_: Exception) {
      // No browser: there is nothing to show, and the sheet behind is untouched.
    }
    finish()
  }

  private companion object {
    const val POLICY = "https://x0bot.com/privacy#health"
  }
}
