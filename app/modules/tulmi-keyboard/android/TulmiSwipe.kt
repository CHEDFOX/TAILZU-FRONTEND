package com.tulmi.app.keyboard

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * Turning a swipe into words — the Android half of iOS's decodeSwipe, the
 * same rules and the same kb.swipe.* dial.
 *
 * A trace gives two things: the keys the finger crossed, in order, and the
 * keys it TURNED on (the pivots, see TulmiKeyPlane.pivotLabels). A word is a
 * candidate only when:
 *
 *   • it starts and ends on the keys the finger did (or a neighbour) — the
 *     two letters the user was deliberate about;
 *   • its letters appear in order along the crossed keys (a neighbour will
 *     do, a doubled letter rides one key, an apostrophe is free);
 *   • every letter the finger turned on is in it, in order — a word that
 *     does not account for a deliberate corner is not what was traced.
 *
 * The candidates are ranked by frequency (a word's place in the core list),
 * exactness (crossed the key itself, not its neighbour), length affinity
 * (a word swept across about keysPerLetter keys per letter) and how many of
 * the pivots it uses.
 *
 * The core list is iOS's own, embedded, and kb.swipe.coreWords replaces it
 * wholesale when the server sends one. Past it come the words no list has:
 * the user's own vocabulary and the device dictionary's guesses for the
 * trace's letters, which the caller supplies.
 */
object TulmiSwipe {

    /** Frequency-ordered core lexicon — the words people actually glide. */
    private val embedded: List<String> = """
        the be to of and a in that have i it for not on with he as you do at this
        but his by from they we say her she or an will my one all would there their
        what so up out if about who get which go me when make can like time no just
        him know take people into year your good some could them see other than then
        now look only come its over think also back after use two how our work first
        well way even new want because any these give day most us is was are been has
        had were said did having may should am place made find where much too very
        still being going before great same those both does another around thought
        while together children saw few though feel man men woman women child life
        world school state family student group country problem hand part case week
        company system program question government number night point home water room
        mother area money story fact month lot right study book eye job word business
        issue side kind head house service friend father power hour game line end
        member law car city community name president team minute idea body information
        nothing ago face others level office door health person art war history party
        result change morning reason research girl guy moment air teacher force
        education call try ask need become leave put mean keep let begin seem help
        talk turn start show hear play run move live believe hold bring happen write
        provide sit stand lose pay meet include continue set learn lead understand
        watch follow stop create speak read allow add spend grow open walk win offer
        remember love consider appear buy wait serve die send expect build stay fall
        cut reach kill remain little important different small large next early young
        public bad able best better sure free low late hard major economic strong
        possible whole real american big high old hello thanks thank please sorry
        okay yeah cool nice awesome happy tomorrow today tonight later maybe really
        actually definitely probably haha gonna wanna gotta yes no here come coming
        meeting message send sent text call called calling home working dinner lunch
        coffee drink food great night week weekend friday monday tuesday wednesday
        thursday saturday sunday don't can't won't didn't i'm i'll i've it's that's
        what's you're we're they're isn't wasn't couldn't wouldn't shouldn't
    """.split(' ', '\n').map { it.trim() }.filter { it.isNotEmpty() }

    /** The core list: the server's (kb.swipe.coreWords) when it sends one,
     *  else the embedded one. Rank in it is what "frequency" means. */
    private fun core(): List<String> {
        val served = knobStrings("kb.swipe.coreWords", listOf()).map { it.lowercase() }.filter { it.isNotEmpty() }
        return served.ifEmpty { embedded }
    }

    private fun isApostrophe(c: Char) = c == '\'' || c == '’'

    /** A character a word is made of, in any script: a letter, a combining
     *  mark (a Devanagari vowel sign is one), or an apostrophe. iOS keeps only
     *  ASCII here; the device dictionary is how a swipe works in Hindi or
     *  Marathi on Android, so its words are not turned away. */
    private fun isWordChar(c: Char): Boolean {
        if (c.isLetter() || isApostrophe(c)) return true
        val t = Character.getType(c)
        return t == Character.NON_SPACING_MARK.toInt() || t == Character.COMBINING_SPACING_MARK.toInt()
    }

    /**
     * Ranked candidates for a trace, best first.
     *
     * [extra] joins the core list (kb.swipe.extraWords); [dictionary] is
     * everything past it, in the caller's order — the user's vocabulary, then
     * the checker's guesses. [near] says whether two keys are the same or
     * neighbours on the layout as drawn.
     */
    fun decode(
        swept: String,
        pivots: String,
        extra: List<String>,
        dictionary: List<String>,
        near: (Char, Char) -> Boolean,
    ): List<String> {
        val keys = swept.lowercase()
        if (keys.length < 2) return emptyList()
        val first = keys.first()
        val last = keys.last()
        val core = core() + extra.map { it.lowercase() }.filter { it.isNotEmpty() }
        val seen = HashSet<String>(core)
        val lexicon = ArrayList<String>(core)
        for (raw in dictionary) {
            val w = raw.trim().lowercase()
            if (w.length < 2 || w in seen) continue
            if (!w.all { isWordChar(it) }) continue
            seen += w
            lexicon += w
        }
        val total = max(1, core.size)
        val turns = pivots.lowercase()

        /** The share of the word's letters that crossed their exact key, or
         *  null when its letters cannot be walked along the trace in order. */
        fun exactness(word: String): Double? {
            var i = 0
            var exact = 0
            var matched = 0
            var prev: Char? = null
            for (wc in word) {
                if (isApostrophe(wc)) continue
                if (wc == prev) continue          // a doubled letter rides one key
                var found = false
                while (i < keys.length) {
                    val sc = keys[i++]
                    if (sc == wc) { exact++; matched++; found = true; break }
                    if (near(sc, wc)) { matched++; found = true; break }
                }
                if (!found) return null
                prev = wc
            }
            return if (matched == 0) null else exact.toDouble() / matched
        }

        /** Every letter the finger turned on, in the word, in order. With only
         *  the two endpoints there is nothing to check. */
        fun coversTurns(letters: String): Boolean {
            if (turns.length <= 2) return true
            var i = 0
            for (pc in turns) {
                var found = false
                while (i < letters.length) {
                    if (near(letters[i++], pc)) { found = true; break }
                }
                if (!found) return false
            }
            return true
        }

        // The scoring dial, kb.swipe.score.* — frequency, exactness, length
        // affinity (and the keys-per-letter ratio it assumes), pivot bonus.
        val wFreq = knobFloat("kb.swipe.score.freq", 2.0f).toDouble()
        val wExact = knobFloat("kb.swipe.score.exact", 1.5f).toDouble()
        val wLength = knobFloat("kb.swipe.score.length", 0.6f).toDouble()
        val keysPerLetter = knobFloat("kb.swipe.score.keysPerLetter", 1.6f).toDouble()
        val wPivot = knobFloat("kb.swipe.score.pivot", 0.4f).toDouble()
        val extraLetters = knobInt("kb.swipe.maxExtraLetters", 2).coerceIn(0, 16)

        val scored = ArrayList<Pair<String, Double>>()
        for ((rank, word) in lexicon.withIndex()) {
            val letters = word.filterNot { isApostrophe(it) }
            if (letters.length < 2 || letters.length > keys.length + extraLetters) continue
            if (!near(first, letters.first()) || !near(last, letters.last())) continue
            if (!coversTurns(letters)) continue
            val exact = exactness(word) ?: continue
            // Past the core list a word has no frequency prior: valid, not common.
            val freq = if (rank < total) 1.0 - rank.toDouble() / total else 0.0
            val lengthAffinity = 1.0 - min(1.0, abs(keys.length - letters.length * keysPerLetter) / keys.length)
            val pivotBonus = if (turns.length > 2) min(1.0, letters.length.toDouble() / max(1, turns.length)) * wPivot else 0.0
            scored += word to (freq * wFreq + exact * wExact + lengthAffinity * wLength + pivotBonus)
        }
        val top = knobInt("kb.swipe.candidates", 5).coerceIn(1, 32)
        return scored.sortedByDescending { it.second }.take(top).map { it.first }
    }
}
