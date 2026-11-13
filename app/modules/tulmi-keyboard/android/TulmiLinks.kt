package com.tulmi.app.keyboard

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.util.Log

/**
 * Where the keyboard sends someone in the Tailzu app, and how it gets them
 * there — the Android half of the iOS renderer's appURL / openContainingApp.
 *
 * Every URL is the server's (kb.deepLink.*), with the defaults iOS has. The
 * app routes tulmi://s/<id> (and tulmi://screen/<id>) to that SDUI screen and
 * tulmi:// to wherever it is.
 *
 * An iOS keyboard cannot open anything itself: it leaves the app a note in the
 * App Group and asks the host to switch. An IME may start an Activity, so here
 * the open is the whole of it and there is no note to leave.
 *
 * THE 4.4.1 LOCK [native/SPEC.md §4.1, §6]. Every URL below now passes through
 * [KbSafety], whose list of our own schemes is COMPILED IN. Before this, the
 * only gate was kb.deepLink.openUrlSchemes — a pushed config could have added
 * "mailto" or another app's scheme and a key would have opened it, which is
 * exactly the "keyboard as a launcher for other apps" that App Review 4.4.1
 * forbids. The knob survives: it can switch one of our own schemes off, and it
 * can do nothing else.
 */
object TulmiLinks {

    /** kb.deepLink.openUrlSchemes, as a list. Narrows the compiled list. */
    private fun serverSchemes(): List<String> =
        knobString("kb.deepLink.openUrlSchemes", "tulmi").split(",")

    /**
     * The app's URL for a screen: kb.deepLink.urlTemplate with "{screen}"
     * replaced; no screen is the app root, kb.deepLink.rootUrl. A template the
     * console left blank keeps the default rather than opening nothing.
     *
     * The filled URL must be one of ours. A template that would make something
     * else — a console typo, or a push trying to point a key away — costs that
     * one setting and the default is used.
     */
    fun appUrl(screen: String?): String {
        val schemes = serverSchemes()
        if (screen.isNullOrEmpty()) {
            return KbSafety.ownUrlOr(knobString("kb.deepLink.rootUrl", "tulmi://"), schemes, "tulmi://")
        }
        val template = knobString("kb.deepLink.urlTemplate", "tulmi://s/{screen}").trim()
            .ifEmpty { "tulmi://s/{screen}" }
        val filled = template.replace("{screen}", Uri.encode(screen, "/"))
        // Checked AFTER filling, not before: the screen id is the server's too.
        return KbSafety.ownUrlOr(filled, schemes, "tulmi://s/" + Uri.encode(screen, "/"))
    }

    /**
     * kb.deepLink.openApp. Off, a tree's openApp / openSettings / openUrl-into-
     * the-app actions do nothing — on iOS they then only leave the note for the
     * app's next foreground, and Android has no note to leave. The keyboard's
     * own hops (the microphone permission, out of words) are not the tree's and
     * are not gated, as on iOS.
     */
    fun treeMayOpenApp(): Boolean = knobBool("kb.deepLink.openApp", true)

    /** A URL on one of the app's own schemes: the compiled list, narrowed by
     *  kb.deepLink.openUrlSchemes. */
    fun isOwnScheme(url: String): Boolean = KbSafety.isOwnScheme(url, serverSchemes())

    /**
     * Open a URL of the app's own. Pinned to this package, so another app that
     * also claims the scheme cannot take a link meant for Tailzu.
     *
     * It used to fall through to "whoever will answer" when nothing here did.
     * It no longer does: a tulmi:// URL this app does not route is a mistake
     * in a config, and handing it to another app that has registered our
     * scheme is the one outcome worth refusing outright. Nothing happens
     * instead, which is also what the key did before the config was wrong.
     */
    fun openOwn(context: Context, url: String): Boolean {
        if (!isOwnScheme(url)) {
            Log.w("TulmiLinks", "refused: not one of our schemes")
            return false
        }
        val uri = try { Uri.parse(url) } catch (_: Throwable) { return false }
        val pinned = Intent(Intent.ACTION_VIEW, uri)
            .setPackage(context.packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return try {
            context.startActivity(pinned)
            true
        } catch (_: ActivityNotFoundException) {
            false
        } catch (t: Throwable) {
            Log.w("TulmiLinks", "open failed: ${t.message}")
            false
        }
    }

    /**
     * The settings a keyboard's "open settings" means (kb.deepLink.settingsUrl).
     *
     * On iOS the keyboard opens the app there and the app, told "openSettings",
     * opens the system's page for Tailzu — the one place the microphone can be
     * switched back on. An IME can go to that page directly, so the app root
     * (the default) means it: APPLICATION_DETAILS_SETTINGS for this package.
     * Any other URL is a screen of the app's own and is opened as one.
     */
    fun openSettings(context: Context): Boolean {
        // Ours, or the default — a settings key is never a way out to another
        // app, whatever the console says.
        val url = KbSafety.ownUrlOr(knobString("kb.deepLink.settingsUrl", "tulmi://"), serverSchemes(), "tulmi://")
        val uri = try { Uri.parse(url) } catch (_: Throwable) { null }
        val bareRoot = uri == null || url.isEmpty() ||
            (uri.host.isNullOrEmpty() && uri.path.isNullOrEmpty() && uri.query.isNullOrEmpty())
        if (!bareRoot) return openOwn(context, url)
        return try {
            context.startActivity(
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            true
        } catch (t: Throwable) {
            Log.w("TulmiLinks", "settings failed: ${t.message}")
            false
        }
    }
}
