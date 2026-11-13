package com.tulmi.app.keyboard

import android.net.Uri

/**
 * THE TWO THINGS A PUSHED CONFIG MAY NEVER MOVE: where a key can send you,
 * and where a key's picture may come from. [native/SPEC.md §4.1, §6]
 *
 * Everything else about this keyboard is the server's — the tree, the colours,
 * the labels, the layouts. These two are not, and they are not knobs either,
 * because a knob is a thing the server sets. They are compiled in:
 *
 *  - **Links.** App Review 4.4.1: a keyboard extension may not become a way to
 *    open other apps. Until now kb.deepLink.openUrlSchemes was the only gate,
 *    so a config push could have added "mailto" or another app's scheme and a
 *    key would have opened it. Now the knob can only ever NARROW this list.
 *  - **Pictures.** TulmiImageLoader would fetch any URL the config named. That
 *    is a request a key can make to a host we do not own, which is both a
 *    tracking pixel and a privacy promise broken. Now the host must be one of
 *    ours.
 *
 * No current config uses a remote image URL or a foreign scheme, so nothing
 * that ships today changes behaviour.
 */
object KbSafety {

    /**
     * The app's own URL schemes. The compiled truth; the server's
     * kb.deepLink.openUrlSchemes is intersected with it, never added to.
     */
    val OWN_SCHEMES: List<String> = listOf("tulmi")

    /**
     * Hosts a key's picture or font may be fetched from — ours, and only ours.
     *
     * TWO EXACT NAMES, no sub-domains, https only. [H10-Q1, H12-Q4]
     *
     * There is no CDN: the API server serves art and fonts from its own disk
     * (/v1/native/art/:file and /v1/native/font/:file). It answers to two
     * names for as long as the domain move lasts — api.x0bot.com is the new
     * one, api.tailzu.space the old one, kept for builds already in the field.
     * A phone whose App Group still says the old name would otherwise fetch
     * its config from one name and its art from the other.
     *
     * What used to be here and is now gone: the apex x0bot.com (a Vercel
     * site), the app.* hosts, and "any sub-domain of", which would have
     * admitted whatever a later CNAME pointed at a third party.
     */
    private val ART_HOSTS: List<String> = listOf(
        "api.x0bot.com",
        "api.tailzu.space",
    )

    /** Where art comes from when the app has not told us anything usable. */
    private const val DEFAULT_MEDIA_BASE = "https://api.x0bot.com"

    /**
     * Whether this APK is a debuggable build.
     *
     * The app's own backend host counts as an art host ONLY here. Launch dark
     * means skins are off in production, so a laptop or a staging server is
     * the only place anybody can look at one before the owner's checks; with
     * the two names alone no development build could show face art at all.
     * A release build never takes this branch, so the store binary carries
     * exactly the two names above.
     *
     * Read from the APPLICATION's flags, set once by [noteApp]. A library
     * module's own BuildConfig.DEBUG does not reliably follow the app's build
     * type, which is why it is not used.
     */
    @Volatile private var debuggable: Boolean = false

    /** Called from Net.load, which the service runs before anything fetches. */
    fun noteApp(context: android.content.Context) {
        debuggable = try {
            (context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0
        } catch (_: Throwable) {
            false
        }
    }

    /** The scheme of [url], lowercased, or null when it does not parse. */
    private fun schemeOf(url: String): String? =
        try { Uri.parse(url).scheme?.lowercase() } catch (_: Throwable) { null }

    /**
     * The host of [url], lowercased and OTHERWISE EXACTLY AS WRITTEN, or null.
     *
     * It used to strip a leading "www.", which quietly made the list of two
     * exact names a list of four: `https://www.api.x0bot.com/…` compared equal
     * to `api.x0bot.com` and was fetched. "www.api.x0bot.com" is a different
     * name, it is not ours, and whoever can make it resolve gets a request
     * from the keyboard. Two names means two. [H12-Q4]
     */
    private fun hostOf(url: String): String? =
        try { Uri.parse(url).host?.lowercase() } catch (_: Throwable) { null }

    /**
     * A URL on one of the app's OWN schemes — compiled list first, and then
     * only if the server's list also names it.
     *
     * [serverSchemes] is kb.deepLink.openUrlSchemes. It can switch one of ours
     * off (an emergency kill switch for a scheme), and it can do nothing else.
     */
    fun isOwnScheme(url: String, serverSchemes: List<String>): Boolean {
        val scheme = schemeOf(url) ?: return false
        if (scheme !in OWN_SCHEMES) return false
        val allowed = serverSchemes.map { it.trim().lowercase() }.filter { it.isNotEmpty() }
        // A config that names no schemes at all leaves the compiled list alone,
        // rather than locking the keyboard out of its own app.
        return allowed.isEmpty() || scheme in allowed
    }

    /**
     * [url] when it is one of ours, else [fallback]. This is what a settings
     * URL, a root URL or a filled URL template goes through: a console typo,
     * or a push that tried to point a key somewhere else, costs that one
     * setting and keeps the default.
     */
    fun ownUrlOr(url: String?, serverSchemes: List<String>, fallback: String): String {
        val u = url?.trim().orEmpty()
        if (u.isNotEmpty() && isOwnScheme(u, serverSchemes)) return u
        return fallback
    }

    /**
     * Whether the keyboard may go to the network for this picture or font.
     *
     * True only for https on one of the two exact hosts above — and, in a
     * debuggable build only, on the host the app itself pointed us at (over
     * http as well, because a laptop server has no certificate). A data:,
     * file:, content: or any other URL is refused here too: the loader has no
     * business opening those, and an `asset`, `sf` or `emoji` reference never
     * reaches this function because it needs no network.
     *
     * A URL carrying userinfo ("https://api.x0bot.com@evil.example/…") parses
     * with `evil.example` as its host, so Uri does that check for us.
     */
    fun mayFetch(url: String): Boolean {
        val scheme = schemeOf(url) ?: return false
        val host = hostOf(url) ?: return false
        if (scheme == "https" && host in ART_HOSTS) return true
        if (!debuggable) return false
        if (scheme != "https" && scheme != "http") return false
        val app = appHost()
        return app.isNotEmpty() && host == app
    }

    /** The host the app itself pointed us at, lowercased, or empty. */
    private fun appHost(): String = hostOf(Net.baseUrl)?.takeIf { it.isNotEmpty() } ?: ""

    /**
     * The base the keyboard builds its own art and font URLs from: the app's
     * configured backend when that is one of our two names, else the compiled
     * default. A manifest never carries a host, so this is the only place a
     * host is chosen. (iOS `mediaBase` does the same.)
     */
    fun mediaBase(): String {
        val app = Net.baseUrl.trimEnd('/')
        val host = hostOf(app)
        if (host != null && host.isNotEmpty() && (host in ART_HOSTS || debuggable)) return app
        return DEFAULT_MEDIA_BASE
    }
}
