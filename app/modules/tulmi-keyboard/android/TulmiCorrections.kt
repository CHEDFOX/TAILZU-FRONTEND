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
    context: Context,
    private val onSuggestions: (List<String>) -> Unit,
) : SpellCheckerSession.SpellCheckerSessionListener {

    private val main = Handler(Looper.getMainLooper())
    private var session: SpellCheckerSession? = null

    /** Words the user told us about. Offered ahead of the dictionary's. */
    var vocabulary: List<String> = emptyList()

    /** How many chips the bar shows. Backend-tunable to match iOS. */
    var maxSuggestions: Int = 3

    private companion object {
        /** Ask for a few, so the first that starts and ends correctly can win. */
        const val MAX_RESOLVE = 5
    }

    /** The word currently being checked, so a late reply for an older word
     *  cannot overwrite suggestions for the one being typed now. */
    private var inFlight: String = ""

    init {
        runCatching {
            val tsm = context.getSystemService(Context.TEXT_SERVICES_MANAGER_SERVICE)
                as? TextServicesManager
            session = tsm?.newSpellCheckerSession(null, null, this, true)
        }.onFailure {
            // No spell checker on this device (some AOSP builds ship none).
            // Vocabulary suggestions still work; dictionary ones simply do not
            // appear, which is a quieter bar rather than a broken one.
            session = null
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
            topCandidate = null
            onSuggestions(emptyList())
            return
        }
        inFlight = w

        // The user's own words first, and synchronously — these must appear
        // even when there is no spell checker to ask.
        val vocab = vocabulary.filter {
            it.length >= w.length && it.startsWith(w, ignoreCase = true) && !it.equals(w, true)
        }.take(maxSuggestions)
        if (vocab.isNotEmpty()) onSuggestions(dedupe(listOf(w) + vocab))

        val s = session ?: return
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR2) {
                s.getSentenceSuggestions(arrayOf(TextInfo(w)), maxSuggestions)
            } else {
                @Suppress("DEPRECATION")
                s.getSuggestions(TextInfo(w), maxSuggestions)
            }
        }
    }

    /** The best correction for the word being typed, or null. Cached from the
     *  last spell-check reply so a space keypress can act SYNCHRONOUSLY — asking
     *  the checker at commit time would put an IPC round trip on the keystroke
     *  path and land the correction after the space. */
    var topCandidate: String? = null
        private set

    /** Nothing is in flight and the bar should be empty — e.g. after a commit. */
    fun clear() {
        inFlight = ""
        topCandidate = null
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
     */
    fun resolve(skeleton: String, onResult: (List<String>) -> Unit) {
        val s = session
        if (s == null) { onResult(emptyList()); return }
        pendingResolve = onResult
        runCatching {
            s.getSentenceSuggestions(arrayOf(TextInfo(skeleton)), MAX_RESOLVE)
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
            // merged[0] is the typed word itself; the first real alternative is
            // what autocorrect would apply.
            topCandidate = merged.getOrNull(1)
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
