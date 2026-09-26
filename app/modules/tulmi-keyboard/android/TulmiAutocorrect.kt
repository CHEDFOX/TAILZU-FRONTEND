package com.tulmi.app.keyboard

import android.graphics.PointF
import kotlin.math.hypot
import kotlin.math.min

/**
 * Decides whether a candidate word is a correction worth making.
 *
 * A spell checker will happily offer a suggestion for anything it does not
 * recognise. Applying all of them is what makes autocorrect infuriating: it
 * turns names into words, slang into formality, and one deliberate typo into
 * three rounds of fighting the keyboard. The question is not "is there a
 * suggestion" but "is this suggestion explainable as a slip of the finger".
 *
 * So the cost model asks what it would have taken to type the wrong thing:
 *
 *   NEIGHBOUR SUBSTITUTION is cheap. "gome" -> "home" only requires the finger
 *   to have landed one key left. That happens constantly and the user does not
 *   notice it happening.
 *
 *   DISTANT SUBSTITUTION is expensive. "gome" -> "some" needs a finger to have
 *   missed by half a keyboard, which is not a slip — it is a different word.
 *
 *   MISSING PUNCTUATION is nearly free. "dont" -> "don't", "im" -> "I'm". The
 *   apostrophe is the single most-skipped character on a phone and restoring it
 *   is almost never wrong.
 *
 * Adjacency comes from the KEYS AS LAID OUT, not a hardcoded QWERTY table —
 * so it stays true for any layout the backend sends, including scripts whose
 * rows are nothing like a Latin keyboard.
 *
 * The weights are backend-tunable (kb.autocorrect.*), which is the point: this
 * is a judgement call that should be settled with the revert counter rather
 * than with an opinion.
 */
object TulmiAutocorrect {

    /**
     * The weights, read from the server's knobs each time a decision is made
     * (a snapshot per call — the inner loop never touches the config):
     *
     *   kb.autocorrect.neighborCost    swapping a letter for an on-screen neighbour
     *   kb.autocorrect.distantCost     swapping it for a distant one
     *   kb.autocorrect.punctCost       inserting or removing punctuation
     *   kb.autocorrect.maxCostPerChar  total cost allowed per typed character
     *   kb.autocorrect.minLen          words this short are left alone
     *   kb.autocorrect.maxLengthDelta  a candidate this much longer/shorter is a different word
     *   kb.autocorrect.punctChars      which characters count as punctuation
     */
    private class Weights(
        val neighbour: Float,
        val distant: Float,
        val punct: Float,
        val punctChars: String,
    )

    /**
     * Key centres by lowercase character, in the plane's own coordinates.
     * Rebuilt whenever the layout changes; empty means every substitution is
     * treated as distant, which fails safe by correcting less.
     */
    private var centres: Map<Char, PointF> = emptyMap()

    /** Distance below which two keys count as neighbours, as a multiple of the
     *  median key spacing. Derived rather than fixed so it holds on any layout
     *  and any screen size. */
    private var neighbourRadius: Float = 0f

    fun setKeyCentres(next: Map<Char, PointF>) {
        centres = next
        neighbourRadius = if (next.size < 2) 0f else {
            // Median nearest-neighbour distance x 1.6 — comfortably includes the
            // keys either side and excludes the row above's far end.
            val nearest = next.values.map { a ->
                next.values.filter { it !== a }.minOf { b -> hypot(a.x - b.x, a.y - b.y) }
            }.sorted()
            nearest[nearest.size / 2] * knobFloat("kb.autocorrect.neighborRadius", 1.6f)
        }
    }

    private fun areNeighbours(a: Char, b: Char): Boolean {
        if (neighbourRadius <= 0f) return false
        val pa = centres[a] ?: return false
        val pb = centres[b] ?: return false
        return hypot(pa.x - pb.x, pa.y - pb.y) <= neighbourRadius
    }

    /**
     * Should `typed` be replaced by `candidate`?
     *
     * Case and punctuation-only differences are treated generously; anything
     * requiring the user to have missed by a long way is refused.
     */
    fun accepts(typed: String, candidate: String): Boolean {
        val a = typed.trim()
        val b = candidate.trim()
        if (a.isEmpty() || b.isEmpty()) return false
        if (a.equals(b, ignoreCase = true)) return false
        if (a.length < knobInt("kb.autocorrect.minLen", 3)) return false
        // A candidate that is a wildly different length is a different word, not
        // a repair of this one.
        if (kotlin.math.abs(a.length - b.length) > knobInt("kb.autocorrect.maxLengthDelta", 2)) return false
        // Never "correct" something the user capitalised deliberately — a name
        // they typed with a capital is a name.
        if (a.first().isUpperCase() && !b.first().isUpperCase()) return false

        val w = Weights(
            neighbour = knobFloat("kb.autocorrect.neighborCost", 0.4f),
            distant = knobFloat("kb.autocorrect.distantCost", 1.0f),
            punct = knobFloat("kb.autocorrect.punctCost", 0.2f),
            punctChars = knobString("kb.autocorrect.punctChars", "'\u2019-."),
        )
        val cost = weightedDistance(a.lowercase(), b.lowercase(), w)
        return cost <= knobFloat("kb.autocorrect.maxCostPerChar", 0.5f) * a.length
    }

    /**
     * Levenshtein, but each edit is priced by how likely a finger was to make
     * it. Punctuation is nearly free, neighbouring keys are cheap, everything
     * else is full price.
     */
    private fun weightedDistance(a: String, b: String, w: Weights): Float {
        val n = a.length
        val m = b.length
        val distantCost = w.distant
        val punctCost = w.punct
        val neighbourCost = w.neighbour
        fun Char.isPunct(): Boolean = w.punctChars.indexOf(this) >= 0
        var prev = FloatArray(m + 1) { it * distantCost }
        // The first row prices deletions from `b`; punctuation is cheap there
        // too, which is what makes "dont" -> "don't" almost free.
        for (j in 1..m) prev[j] = prev[j - 1] + if (b[j - 1].isPunct()) punctCost else distantCost
        val cur = FloatArray(m + 1)

        for (i in 1..n) {
            cur[0] = prev[0] + if (a[i - 1].isPunct()) punctCost else distantCost
            for (j in 1..m) {
                val ca = a[i - 1]
                val cb = b[j - 1]
                val sub = prev[j - 1] + when {
                    ca == cb -> 0f
                    areNeighbours(ca, cb) -> neighbourCost
                    else -> distantCost
                }
                val del = prev[j] + if (ca.isPunct()) punctCost else distantCost
                val ins = cur[j - 1] + if (cb.isPunct()) punctCost else distantCost
                cur[j] = min(sub, min(del, ins))
            }
            val swap = prev; prev = cur.copyOf(); System.arraycopy(swap, 0, cur, 0, cur.size)
        }
        return prev[m]
    }

}
