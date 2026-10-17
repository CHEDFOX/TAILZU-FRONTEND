// Compile-only stand-ins for the two AndroidX classes the keyboard uses, so
// tools/android-compile/check.sh can type-check the keyboard without the
// Google Maven repository. Never shipped: the real build uses AndroidX.
package androidx.core.content

import android.content.Context
import android.content.pm.PackageManager

object ContextCompat {
    @JvmStatic
    fun checkSelfPermission(context: Context, permission: String): Int = PackageManager.PERMISSION_GRANTED
}
