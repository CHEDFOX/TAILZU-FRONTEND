package com.tulmi.app.keyboard

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.textservice.SentenceSuggestionsInfo
import android.view.textservice.SpellCheckerSession
import android.view.textservice.SuggestionsInfo
import android.view.textservice.TextInfo
import android.view.textservice.TextServicesManager

/**
 * Word suggestions for the keyboard's suggestion bar.
 *
 * The bar has been rendering since it shipped, bound to a list nothing ever
 * wrote to — so it has always been empty. This is the engine behind it, and the
 * Android half of what UITextChecker does on iOS.
 *
 * Android's own spell checker is the right source: it is the dictionary the
 * user's device already has, in the languages they have already installed,
 * including whatever they have added themselves. Shipping a wordlist instead
 * would be smaller, worse, and immediately wrong for anyone typing an Indian
 * language.
 *
 * Two things are layered on top of it, both matching the iOS behaviour:
 *
 *   • the user's own vocabulary (kb.personality.vocabulary) is offered first,
 *     because a name the model was told about should never be "corrected" into
 *     a common word.
 *   • the typed word itself is kept as an option whenever it is not a clear
 *     misspelling, so accepting a suggestion is always a choice rather than
 *     something that happens to the user.
 *
 * The session is asynchronous by design — a spell check is IPC to another
 * process, and blocking the typing thread on it would be felt on every key.
 */
class TulmiCorrections(
    private val context: Context,
    private val onSuggestions: (List<String>) -> Unit,
) : SpellCheckerSession.SpellCheckerSessionListener {

    private val main = Handler(Looper.getMainLooper())
    private var session: SpellCheckerSession? = null

    /** Words the user told us about. Offered ahead of the dictionary's. */
    var vocabulary: List<String> = emptyList()

    /** How many chips the bar shows. Backend-tunable to match iOS. */
    var maxSuggestions: Int = 3

    /** The word currently being checked, so a late reply for an older word
     *  cannot overwrite suggestions for the one being typed now. */
    private var inFlight: String = ""

    /** The languages the session was opened for, so a config that names the
     *  same ones does not reopen it. */
    private var sessionFor: String? = null

    init {
        refreshLanguage()
    }

    /**
     * Open the dictionary in the language the server asks for, the way iOS
     * picks its checker's: kb.autocorrect.lang when it names one, else the
     * device's own spell-checker language; kb.autocorrect.fallbackLang when
     * the one wanted has no dictionary here. Reopened only when those change.
     *
     * No spell checker at all (some AOSP builds ship none) leaves the session
     * null: vocabulary suggestions still work, dictionary ones simply do not
     * appear, which is a quieter bar rather than a broken one.
     */
    fun refreshLanguage() {
        val lang = knobString("kb.autocorrect.lang", "").trim()
        val fallback = knobString("kb.autocorrect.fallbackLang", "en_US").trim()
        val key = "$lang|$fallback"
        if (key == sessionFor && session != null) return
        sessionFor = key
        runCatching { session?.close() }
        session = runCatching { open(lang, fallback) }.getOrNull()
    }

    private fun open(lang: String, fallback: String): SpellCheckerSession? {
        val tsm = context.getSystemService(Context.TEXT_SERVICES_MANAGER_SERVICE)
            as? TextServicesManager ?: return null
        fun named(tag: String): SpellCheckerSession? {
            val locale = localeOf(tag) ?: return null
            // Only if the user has the spell checker on: a language the server
            // names must not switch back on what the user turned off.
            if (!checkerOn(tsm)) return null
            return runCatching { tsm.newSpellCheckerSession(null, locale, this, false) }.getOrNull()
        }
        fun device(): SpellCheckerSession? =
            runCatching { tsm.newSpellCheckerSession(null, null, this, true) }.getOrNull()
        return if (lang.isNotEmpty()) named(lang) ?: named(fallback) ?: device()
        else device() ?: named(fallback)
    }

    private fun checkerOn(tsm: TextServicesManager): Boolean = try {
        if (Build.VERSION.SDK_INT >= 31) tsm.isSpellCheckerEnabled
        else android.provider.Settings.Secure.getInt(context.contentResolver, "spell_checker_enabled", 1) != 0
    } catch (_: Throwable) { true }

    /** "en_US", "en-US" or "en" as a Locale; null for nothing usable. */
    private fun localeOf(tag: String): java.util.Locale? {
        val parts = tag.replace('-', '_').split('_').filter { it.isNotEmpty() }
        @Suppress("DEPRECATION")
        return when (parts.size) {
            0 -> null
            1 -> java.util.Locale(parts[0])
            else -> java.util.Locale(parts[0], parts[1])
        }
    }

    /**
     * Ask for suggestions on the word the caret is currently inside. Passing a
     * blank or a completed word clears the bar.
     */
    fun suggest(word: String) {
        val w = word.trim()
        if (w.isEmpty()) {
            inFlight = ""
            candidates = emptyList()
            onSuggestions(emptyList())
            return
        }
        inFlight = w
        // A candidate belongs to the word it was computed for. Keeping the last
        // one while this word's reply is in flight let a space typed quickly
        // "correct" the new word with a guess made for its prefix.
        candidates = emptyList()
        topCandidateFor = ""

        // The user's own words first, and synchronously — these must appear
        // even when there is no spell checker to ask.
        val vocab = vocabulary.filter {
            it.length >= w.length && it.startsWith(w, ignoreCase = true) && !it.equals(w, true)
        }.take(maxSuggestions)
        if (vocab.isNotEmpty()) onSuggestions(dedupe(listOf(w) + vocab))

        val s = session ?: return
        // As many guesses as autocorrect weighs (kb.autocorrect.maxGuesses),
        // however few chips the bar shows.
        val limit = maxOf(maxSuggestions, knobInt("kb.autocorrect.maxGuesses", 8).coerceIn(1, 64))
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR2) {
                s.getSentenceSuggestions(arrayOf(TextInfo(w)), limit)
            } else {
                @Suppress("DEPRECATION")
                s.getSuggestions(TextInfo(w), limit)
            }
        }
    }

    /** The alternatives to the word being typed, best first, for autocorrect
     *  to weigh (TulmiAutocorrect.pick). Cached from the last spell-check reply
     *  so a space keypress can act SYNCHRONOUSLY — asking the checker at commit
     *  time would put an IPC round trip on the keystroke path and land the
     *  correction after the space. */
    var candidates: List<String> = emptyList()
        private set

    /** The word [candidates] were computed for. */
    var topCandidateFor: String = ""
        private set

    /** Nothing is in flight and the bar should be empty — e.g. after a commit. */
    fun clear() {
        inFlight = ""
        candidates = emptyList()
        topCandidateFor = ""
        onSuggestions(emptyList())
    }

    /**
     * One-off lookup that does NOT touch the suggestion bar — for the swipe
     * decoder, which asks about a traced skeleton rather than about the word
     * the user is typing.
     *
     * Kept separate from suggest() on purpose: routing it through the bar's
     * state would make a trace flash chips for a string the user never typed,
     * and a late reply would fight the word they moved on to.
     *
     * Several skeletons go in one request (the letters crossed, the letters
     * turned on), [limit] guesses each (kb.swipe.dictGuesses).
     */
    fun resolve(skeletons: List<String>, limit: Int, onResult: (List<String>) -> Unit) {
        val s = session
        val infos = skeletons.filter { it.length in 2..32 }.map { TextInfo(it) }
        if (s == null || limit <= 0 || infos.isEmpty()) { onResult(emptyList()); return }
        pendingResolve = onResult
        runCatching {
            s.getSentenceSuggestions(infos.toTypedArray(), limit)
        }.onFailure {
            pendingResolve = null
            onResult(emptyList())
        }
    }

    /** Set while a resolve() is in flight; consumed by the next reply. */
    private var pendingResolve: ((List<String>) -> Unit)? = null

    fun close() {
        runCatching { session?.close() }
        session = null
    }

    // MARK: - SpellCheckerSessionListener (called off the main thread)

    override fun onGetSuggestions(results: Array<out SuggestionsInfo>?) {
        deliver(results?.flatMap { infoWords(it) } ?: emptyList())
    }

    override fun onGetSentenceSuggestions(results: Array<out SentenceSuggestionsInfo>?) {
        val words = mutableListOf<String>()
        results?.forEach { sentence ->
            for (i in 0 until sentence.suggestionsCount) {
                words += infoWords(sentence.getSuggestionsInfoAt(i))
            }
        }
        // A resolve() is waiting on the next reply and owns it — hand it over
        // rather than letting it repaint the bar for a word nobody typed.
        val waiting = pendingResolve
        if (waiting != null) {
            pendingResolve = null
            main.post { waiting(dedupe(words)) }
            return
        }
        deliver(words)
    }

    private fun infoWords(info: SuggestionsInfo?): List<String> {
        if (info == null) return emptyList()
        val out = ArrayList<String>(info.suggestionsCount)
        for (i in 0 until info.suggestionsCount) out += info.getSuggestionAt(i)
        return out
    }

    private fun deliver(words: List<String>) {
        val typed = inFlight
        if (typed.isEmpty()) return
        val merged = dedupe(listOf(typed) + vocabulary.filter {
            it.startsWith(typed, ignoreCase = true) && !it.equals(typed, true)
        } + words)
        main.post {
            // A reply that arrived after the user moved on belongs to a word
            // that is no longer being typed — drop it rather than showing
            // suggestions for something already committed.
            if (inFlight != typed) return@post
            // merged[0] is the typed word itself; the rest are the alternatives
            // autocorrect chooses from.
            candidates = merged.drop(1)
            topCandidateFor = typed
            onSuggestions(merged.take(maxSuggestions + 1))
        }
    }

    /** Case-insensitive, order-preserving. The typed word leads, so the bar
     *  always offers "keep what I wrote" as its first option. */
    private fun dedupe(words: List<String>): List<String> {
        val seen = HashSet<String>()
        val out = ArrayList<String>(words.size)
        for (w in words) {
            val t = w.trim()
            if (t.isEmpty()) continue
            if (seen.add(t.lowercase())) out += t
        }
        return out
    }
}
