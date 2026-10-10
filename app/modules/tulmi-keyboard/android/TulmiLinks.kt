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
 */
object TulmiLinks {

    /**
     * The app's URL for a screen: kb.deepLink.urlTemplate with "{screen}"
     * replaced; no screen is the app root, kb.deepLink.rootUrl. A template the
     * console left blank keeps the default rather than opening nothing.
     */
    fun appUrl(screen: String?): String {
        if (screen.isNullOrEmpty()) {
            return knobString("kb.deepLink.rootUrl", "tulmi://").trim().ifEmpty { "tulmi://" }
        }
        val template = knobString("kb.deepLink.urlTemplate", "tulmi://s/{screen}").trim()
            .ifEmpty { "tulmi://s/{screen}" }
        return template.replace("{screen}", Uri.encode(screen, "/"))
    }

    /**
     * kb.deepLink.openApp. Off, a tree's openApp / openSettings / openUrl-into-
     * the-app actions do nothing — on iOS they then only leave the note for the
     * app's next foreground, and Android has no note to leave. The keyboard's
     * own hops (the microphone permission, out of words) are not the tree's and
     * are not gated, as on iOS.
     */
    fun treeMayOpenApp(): Boolean = knobBool("kb.deepLink.openApp", true)

    /** A URL on one of the app's own schemes (kb.deepLink.openUrlSchemes,
     *  comma-separated, "tulmi" until a config says otherwise). */
    fun isOwnScheme(url: String): Boolean {
        val scheme = try { Uri.parse(url).scheme?.lowercase() } catch (_: Throwable) { null } ?: return false
        return knobString("kb.deepLink.openUrlSchemes", "tulmi").split(",")
            .map { it.trim().lowercase() }
            .any { it.isNotEmpty() && it == scheme }
    }

    /**
     * Open a URL of the app's own. Pinned to this package first, so another
     * app that also claims the scheme cannot take a link meant for Tailzu;
     * only when nothing here answers (a server URL the app does not route) is
     * it offered to whatever does.
     */
    fun openOwn(context: Context, url: String): Boolean {
        val uri = try { Uri.parse(url) } catch (_: Throwable) { return false }
        val pinned = Intent(Intent.ACTION_VIEW, uri)
            .setPackage(context.packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(pinned)
            return true
        } catch (_: ActivityNotFoundException) {
            // Fall through to an open anyone may answer.
        } catch (t: Throwable) {
            Log.w("TulmiLinks", "open failed: ${t.message}")
            return false
        }
        return openAny(context, url)
    }

    /** Open a URL with whatever handles it — a web link, say. */
    fun openAny(context: Context, url: String): Boolean = try {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    } catch (t: Throwable) {
        Log.w("TulmiLinks", "open failed: ${t.message}")
        false
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
        val url = knobString("kb.deepLink.settingsUrl", "tulmi://").trim()
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
