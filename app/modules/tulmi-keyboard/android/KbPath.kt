package com.tulmi.app.keyboard

import android.graphics.Path

/**
 * THE PATH GRAMMAR, ON THE KEYBOARD. [native/SPEC.md §2.4, §2.11, §4.4]
 *
 * `M L Q C Z O` — the bots' looks format-1 grammar, plus `C` (the animation
 * spec's cubic) and `O` (a circle: cx cy r). One grammar for the bots' looks,
 * for nlook's `Shape`, and for a key's `path` mark, so a curve drawn once in
 * the animation tool is drawable as a widget shape and as a key print without
 * anybody rewriting it.
 *
 * Numbers are absolute, in whatever units the caller's artboard uses: the
 * bots' looks use bot heights, a key mark uses its own `viewBox`. The core
 * below neither scales nor clamps them — that is the caller's job, because the
 * sane range differs per surface — it only refuses what is not a number.
 *
 * THE MARKED REGION AT THE BOTTOM OF THIS FILE IS SHARED CODE, AND THE WIDGET
 * SIDE HOLDS THE PEN ON IT. `NLookPaint.kt` (tulmi-bridge) carries the same
 * bytes between the same two markers — comment lines included, so its own text
 * names both files — and CI (`tools/ci/marked-regions.mjs`) diffs them. The
 * region is at top level, outside `object KbPath`, because that is where the
 * widget copy sits; copy it by marker, never by line number, and change the
 * two copies in one commit or CI fails. Everything this module alone needs
 * — `MAX_D_CHARS`, `parse`, `centre` — stays outside the markers.
 */
object KbPath {

    /** A path longer than this is refused outright (KEY_FACE_LIMITS.mark). */
    const val MAX_D_CHARS = 900

    /**
     * [d] as an [android.graphics.Path], or null when it is empty, too long,
     * or says something this build does not understand.
     *
     * The grammar itself lives in the shared core below; this only walks the
     * segments it returns into a `Path`, exactly as the widget side's
     * `NLookPaint.build` does. A bad path drops THAT shape and nothing else:
     * the rest of the mark still draws, which is the whole "unknown degrades,
     * never throws" rule.
     */
    fun parse(d: String?): Path? {
        val s = d?.trim().orEmpty()
        if (s.isEmpty() || s.length > MAX_D_CHARS) return null
        return try {
            val segs = NlPathCore.parse(s) ?: return null
            build(segs)
        } catch (_: Throwable) {
            null
        }
    }

    /** Segments to an android Path. `O` is a circle in its own right, as the bots' looks write dots and puffs. */
    private fun build(segs: List<NlSeg>): Path? {
        val p = Path()
        var any = false
        for (s in segs) {
            when (s.op) {
                'M' -> { p.moveTo(s.v[0], s.v[1]); any = true }
                'L' -> { p.lineTo(s.v[0], s.v[1]); any = true }
                'Q' -> { p.quadTo(s.v[0], s.v[1], s.v[2], s.v[3]); any = true }
                'C' -> { p.cubicTo(s.v[0], s.v[1], s.v[2], s.v[3], s.v[4], s.v[5]); any = true }
                'Z' -> p.close()
                'O' -> { p.addCircle(s.v[0], s.v[1], s.v[2], Path.Direction.CW); any = true }
                else -> return null
            }
        }
        return if (any) p else null
    }

    /**
     * The centre of the box around [d]'s points, in the caller's own units,
     * or null when it does not parse.
     *
     * Used by the mic mark's dispersal, which has to know where each shape
     * starts from. Deliberately OUTSIDE the shared region: the widget side
     * has no dispersing mark, and the shared core knows nothing about what
     * either module draws with it.
     */
    fun centre(d: String?): FloatArray? {
        val p = parse(d) ?: return null
        val r = android.graphics.RectF()
        p.computeBounds(r, true)
        return floatArrayOf(r.centerX(), r.centerY())
    }
}


// BEGIN NLookPathCore — kept byte-identical to modules/tulmi-keyboard/android/.../KbPath.kt's own copy, and to
// targets/widgets/NLookPath.swift line for line in meaning. CI diffs the two Kotlin regions between these two
// markers. It is at TOP LEVEL, not inside an object, so the keyboard's copy can be the same lines with the same
// indentation. Do not edit one alone.
/** One command of the path grammar: `op` is M L Q C Z O, `v` holds its numbers, already counted. */
internal class NlSeg(val op: Char, val v: FloatArray)

/**
 * THE PATH GRAMMAR, M L Q C Z O, shared by the bots' looks, the animation format, nlook shapes and the keyboard's `path`
 * mark. One parser so a path drawn for an animation scene stays drawable as a widget shape or a key print.
 *
 *   M x y                     move
 *   L x y                     line
 *   Q cx cy x y               quadratic
 *   C c1x c1y c2x c2y x y     cubic — the animation spec's format-2 addition, accepted from day one
 *   Z                         close
 *   O cx cy r                 circle, r greater than zero
 *
 * Every command carries exactly its own count of numbers and its own letter: `L 1 1 2 2` is not two lines, it drops the
 * path. Letters are upper case only, so a relative command can never be drawn as an absolute one. ANYTHING ELSE DROPS THE
 * WHOLE PATH and returns null: an unknown character, a wrong number count, a token that is not a number, a number that is
 * not finite or is 100000 or more, a token over 24 characters, or more than 400 segments. There is no guessing and no
 * expression evaluation anywhere in this format.
 */
internal object NlPathCore {
  /** A `d` longer than this is not parsed at all. */
  const val MAX_CHARS = 900

  /** At most this many segments come out of one `d`. */
  const val MAX_SEGMENTS = 400

  /** One number's text may be this long at most. */
  private const val MAX_TOKEN = 24

  /** A number this far from zero is not a drawing, it is a mistake. */
  private const val MAX_ABS = 100_000.0

  private fun arity(op: Char): Int = when (op) {
    'M' -> 2
    'L' -> 2
    'Q' -> 4
    'C' -> 6
    'Z' -> 0
    'O' -> 3
    else -> -1
  }

  fun parse(d: String): List<NlSeg>? {
    if (d.isEmpty() || d.length > MAX_CHARS) return null
    val out = ArrayList<NlSeg>()
    val numbers = ArrayList<Float>()
    val token = StringBuilder()
    // ' ' means "no letter yet": numbers before the first letter drop the path, as they do on iPhone.
    var op = ' '
    for (c in d) {
      if (arity(c) >= 0) {
        if (!take(token, numbers)) return null
        if (!flush(out, op, numbers)) return null
        op = c
      } else if (c == ' ' || c == ',' || c == '\n' || c == '\t') {
        // Those four and no others. A carriage return is not a separator here, because it is not one on iPhone.
        if (!take(token, numbers)) return null
      } else if (c in '0'..'9' || c == '.' || c == '-' || c == '+' || c == 'e' || c == 'E') {
        token.append(c)
        if (token.length > MAX_TOKEN) return null
      } else {
        // Any other character is a command this grammar does not have (an arc, a relative move): drop the path.
        return null
      }
    }
    if (!take(token, numbers)) return null
    if (!flush(out, op, numbers)) return null
    if (out.isEmpty() || out.size > MAX_SEGMENTS) return null
    return out
  }

  /** The number gathered so far, if any. Parsed as a double so `1e3` reads the same as it does on iPhone. */
  private fun take(token: StringBuilder, numbers: ArrayList<Float>): Boolean {
    if (token.isEmpty()) return true
    val value = token.toString().toDoubleOrNull() ?: return false
    // Written as two comparisons, not kotlin.math.abs, so the region needs no import of its own in either file.
    if (!value.isFinite() || value >= MAX_ABS || value <= -MAX_ABS) return false
    numbers.add(value.toFloat())
    token.setLength(0)
    return true
  }

  /** The numbers gathered for one command letter. Exactly its own count, or the path drops. */
  private fun flush(out: ArrayList<NlSeg>, op: Char, numbers: ArrayList<Float>): Boolean {
    val size = arity(op)
    if (size < 0) {
      // No letter yet: anything gathered before the first one is a path we do not read.
      val clean = numbers.isEmpty()
      numbers.clear()
      return clean
    }
    if (numbers.size != size) {
      numbers.clear()
      return false
    }
    if (op == 'O' && numbers[2] <= 0f) {
      numbers.clear()
      return false
    }
    val v = FloatArray(size)
    for (k in 0 until size) v[k] = numbers[k]
    out.add(NlSeg(op, v))
    numbers.clear()
    return true
  }
}
// END NLookPathCore
