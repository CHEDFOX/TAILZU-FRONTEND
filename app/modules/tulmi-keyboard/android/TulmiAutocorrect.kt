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

    /** Cost of swapping a letter for one of its on-screen neighbours. */
    var neighbourCost: Float = 0.4f

    /** Cost of swapping a letter for a distant one. */
    var distantCost: Float = 1.0f

    /** Cost of inserting or removing punctuation (apostrophes, mostly). */
    var punctCost: Float = 0.2f

    /** Total cost above which the correction is refused, per character of the
     *  typed word. Higher accepts more aggressive corrections. */
    var maxCostPerChar: Float = 0.5f

    /** Words this short are left alone. Two-letter "corrections" are almost
     *  always the user meaning exactly what they typed. */
    var minLength: Int = 3

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
            nearest[nearest.size / 2] * 1.6f
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
        if (a.length < minLength) return false
        // A candidate that is a wildly different length is a different word, not
        // a repair of this one.
        if (kotlin.math.abs(a.length - b.length) > 2) return false
        // Never "correct" something the user capitalised deliberately — a name
        // they typed with a capital is a name.
        if (a.first().isUpperCase() && !b.first().isUpperCase()) return false

        val cost = weightedDistance(a.lowercase(), b.lowercase())
        return cost <= maxCostPerChar * a.length
    }

    /**
     * Levenshtein, but each edit is priced by how likely a finger was to make
     * it. Punctuation is nearly free, neighbouring keys are cheap, everything
     * else is full price.
     */
    private fun weightedDistance(a: String, b: String): Float {
        val n = a.length
        val m = b.length
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

    private fun Char.isPunct(): Boolean = this == '\'' || this == '’' || this == '-' || this == '.'
}
