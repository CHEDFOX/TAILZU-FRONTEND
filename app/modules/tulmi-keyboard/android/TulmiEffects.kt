package com.tulmi.app.keyboard

import android.animation.ValueAnimator
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorFilter
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.drawable.Drawable
import android.os.Build
import android.view.Choreographer
import android.view.View
import android.view.ViewGroup
import kotlin.random.Random

/**
 * The keyboard's passing effects — the Android half of what iOS's
 * SDUIRenderer draws with CAEmitterLayers and its dictation veil:
 *
 *   • confetti, when the server runs the `confetti` action (kb.confetti.*);
 *   • dots that stream from the mic to the tone pill while the mic records
 *     (kb.dictation.dots.*);
 *   • the frost on the key rows for the same stretch (kb.dictation.dim.*).
 *
 * The particles are one Drawable in the keyboard container's overlay, like the
 * key pop-up: no part in layout, never a touch, drawn over the keys without
 * moving one — and over the mic, never instead of it. They live in fixed
 * arrays allocated the first time anything flies, and the frame loop runs only
 * while something is being emitted or is still in the air. A keyboard that is
 * only being typed on pays nothing, and one that is put away stops at once
 * (teardown).
 *
 * iOS sizes are points; here they are dp. Every number is the server's, read
 * when the effect starts, with iOS's default beside it.
 */
internal class TulmiEffects(private val container: ViewGroup) {

    private val density = container.resources.displayMetrics.density

    // ------------------------------------------------------------ the loop

    private var sky: Sky? = null
    private var looping = false
    private var lastFrameNanos = 0L
    private val frame = Choreographer.FrameCallback { now -> onFrame(now) }

    private fun ensureSky(): Sky {
        val s = sky ?: Sky().also {
            container.overlay.add(it)
            sky = it
        }
        s.setBounds(0, 0, container.width, container.height)
        return s
    }

    private fun ensureLoop() {
        if (looping) return
        looping = true
        lastFrameNanos = 0L
        Choreographer.getInstance().postFrameCallback(frame)
    }

    private fun onFrame(now: Long) {
        if (!looping) return
        val s = sky
        // A keyboard put away or torn down under a burst stops here, whatever
        // was flying (isShown is false for a hidden window and a detached view).
        if (s == null || !container.isShown) { teardown(); return }
        val dt = if (lastFrameNanos == 0L) 0f
            else ((now - lastFrameNanos) / 1_000_000_000f).coerceIn(0f, MAX_STEP_SEC)
        lastFrameNanos = now
        try {
            step(s, now, dt)
        } catch (_: Throwable) {
            // An effect is never worth the keyboard: drop what is flying.
            s.n = 0
        }
        s.invalidateSelf()
        if (s.n > 0 || dotsOn || now < confettiBirthUntil) {
            Choreographer.getInstance().postFrameCallback(frame)
        } else {
            looping = false
        }
    }

    private fun step(s: Sky, now: Long, dt: Float) {
        // Births, at the emitters' rates. A full sky drops the rest rather
        // than queueing them: a burst is a feeling, not a count.
        if (dotsOn) {
            dotsAccum += dotsRate * dt
            while (dotsAccum >= 1f) {
                dotsAccum -= 1f
                if (!spawnDot(s)) { dotsAccum = 0f; break }
            }
        }
        if (now < confettiBirthUntil) {
            confettiAccum += confettiRate * dt
            while (confettiAccum >= 1f) {
                confettiAccum -= 1f
                if (!spawnConfetti(s, now)) { confettiAccum = 0f; break }
            }
        }
        // iOS removes the dot emitter kb.dictation.dots.decayMs after the stop,
        // and whatever it still carries goes with it.
        val killDots = dotsKillAt != 0L && now >= dotsKillAt
        if (killDots) dotsKillAt = 0L
        var i = 0
        while (i < s.n) {
            if (killDots && s.kind[i] == DOT) { s.remove(i); continue }
            s.age[i] += dt
            if (s.age[i] >= s.life[i]) { s.remove(i); continue }
            s.x[i] += s.vx[i] * dt
            s.y[i] += s.vy[i] * dt
            s.rot[i] += s.spin[i] * dt
            i++
        }
    }

    /** Stop everything now: the keyboard was put away. */
    fun teardown() {
        dotsGen++
        dotsOn = false
        dotsKillAt = 0L
        confettiBirthUntil = 0L
        if (looping) {
            Choreographer.getInstance().removeFrameCallback(frame)
            looping = false
        }
        sky?.let { it.n = 0; it.invalidateSelf() }
        // The frost lands where it was going; the rows it was fading are the
        // ones on screen, and they must not be left half-dimmed.
        frostAnim?.let { frostAnim = null; it.end() }
    }

    // ------------------------------------------------------------ confetti

    private var confettiColors = IntArray(0)
    private var confettiRate = 0f
    private var confettiAccum = 0f
    private var confettiLife = 0f
    private var confettiVelocity = 0f
    private var confettiSpin = 0f
    private var confettiSide = 0f
    private var confettiBirthUntil = 0L
    private var confettiTeardownAt = 0L

    /**
     * A burst of confetti from just above the keyboard's top edge, falling
     * through it — iOS's fireConfetti. A cell per colour, each born at
     * kb.confetti.birthRate a second for kb.confetti.burstMs; each piece lives
     * kb.confetti.lifetimeMs and the whole burst is gone kb.confetti.teardownMs
     * after it began. A second burst runs alongside the first, as a second
     * emitter layer does on iOS.
     */
    fun confetti() {
        try {
            if (container.width <= 0 || !container.isShown) return
            val colors = knobStrings("kb.confetti.colors", listOf("#FF3B30", "#007AFF", "#34C759", "#FFCC00", "#AF52DE", "#FF9500"))
                .mapNotNull { hexColor(it) }
            val rate = knobFloat("kb.confetti.birthRate", 6f)
            val life = knobFloat("kb.confetti.lifetimeMs", 3000f) / 1000f
            if (colors.isEmpty() || rate <= 0f || life <= 0f) return
            val now = System.nanoTime()
            confettiColors = colors.toIntArray()
            confettiRate = (rate * colors.size).coerceAtMost(MAX_BIRTHS_PER_SEC)
            confettiLife = life
            // pt/sec there, dp/sec here.
            confettiVelocity = knobFloat("kb.confetti.velocity", 200f) * density
            confettiSpin = knobFloat("kb.confetti.spin", 3f)
            // iOS scales its square.fill symbol. An emitter cell draws its
            // picture a pixel to the point, and the symbol was drawn at the
            // screen's scale, so a piece there is the symbol's size × screen
            // scale × kb.confetti.scale points across; the display density
            // stands in for the screen scale here.
            confettiSide = CONFETTI_SQUARE_DP * density * knobFloat("kb.confetti.scale", 0.06f) * density
            confettiBirthUntil = now + nanosOf(knobFloat("kb.confetti.burstMs", 400f))
            confettiTeardownAt = now + nanosOf(knobFloat("kb.confetti.teardownMs", 3500f))
            confettiAccum = 0f
            ensureSky()
            ensureLoop()
        } catch (_: Throwable) {
            // A celebration that cannot be drawn is simply not drawn.
        }
    }

    private fun spawnConfetti(s: Sky, now: Long): Boolean {
        val i = s.add()
        if (i < 0) return false
        s.kind[i] = CONFETTI
        // The emitter is a line across the keyboard, 10pt above its top edge.
        s.x[i] = Random.nextFloat() * s.bounds.width()
        s.y[i] = -10f * density
        val a = DOWN + (Random.nextFloat() - 0.5f) * CONFETTI_SPREAD
        val v = confettiVelocity * (1f + (Random.nextFloat() * 2f - 1f) * 0.2f)
        s.vx[i] = kotlin.math.cos(a) * v
        s.vy[i] = kotlin.math.sin(a) * v
        s.age[i] = 0f
        // Its own lifetime, or what is left of the burst's, whichever is sooner.
        s.life[i] = minOf(confettiLife, (confettiTeardownAt - now) / 1_000_000_000f)
        s.size[i] = confettiSide
        s.rot[i] = 0f
        s.spin[i] = confettiSpin * (1f + (Random.nextFloat() * 2f - 1f) * 1.3f)
        s.alphaSpeed[i] = 0f
        s.color[i] = confettiColors[Random.nextInt(confettiColors.size)]
        return true
    }

    // ------------------------------------------------------------ dictation dots

    private var dotsOn = false
    /** Bumped on every stop, so an anchor posted before it does not restart the stream. */
    private var dotsGen = 0
    private var dotsKillAt = 0L
    private var dotsAccum = 0f
    private var dotsRate = 0f
    private var dotsLife = 0f
    private var dotsJitter = 0f
    private var dotsSpread = 0f
    private var dotsDiameter = 0f
    private var dotsScale = 0f
    private var dotsScaleRange = 0f
    private var dotsAlphaSpeed = 0f
    private var dotsColor = 0
    private var dotsX = 0f
    private var dotsY = 0f
    private var dotsAim = 0f
    private var dotsVelocity = 0f
    private var dotsVelocityRange = 0f
    private val loc = IntArray(2)
    private val base = IntArray(2)

    /**
     * The dot stream, called at the end of every rebuild with whether the mic
     * is recording and where this rebuild drew the mic and the tone pill.
     *
     * On iOS the stream starts with the recording visuals, is re-anchored to
     * the new mic after each remount, and on stop its births end while the
     * dots already in the air finish their flight. Same here: the anchor waits
     * for the layout pass (a post runs after it), so it reads real positions.
     * A tree with no mic or no pill has nothing to stream between.
     */
    fun recordingDots(active: Boolean, mic: View?, tone: View?) {
        if (!active) { stopDots(); return }
        if (mic == null || tone == null) return
        val gen = dotsGen
        container.post { if (gen == dotsGen) anchorDots(mic, tone) }
    }

    private fun anchorDots(mic: View, tone: View) {
        try {
            if (!mic.isAttachedToWindow || !tone.isAttachedToWindow || mic.width == 0 || tone.width == 0) return
            centreOf(mic)
            val sx = cx; val sy = cy
            centreOf(tone)
            val tx = cx; val ty = cy
            if (!dotsOn) {
                // The stream's numbers are read once, when it starts, as iOS does.
                if (!knobBool("kb.dictation.dots.enabled", true)) return
                val rate = knobFloat("kb.dictation.dots.birthRate", 7f)
                val life = knobFloat("kb.dictation.dots.lifetimeMs", 1800f) / 1000f
                // Zero is the server turning the stream off without the switch.
                if (rate <= 0f || life <= 0f) return
                dotsRate = rate.coerceAtMost(MAX_BIRTHS_PER_SEC)
                dotsLife = life
                dotsJitter = knobFloat("kb.dictation.dots.velocityJitter", 0.05f)
                dotsSpread = knobFloat("kb.dictation.dots.spread", 0.08f)
                // A dot is a kb.dictation.dots.size circle scaled by
                // kb.dictation.dots.scale, drawn a pixel to the point from a
                // picture made at the screen's scale (see confetti above).
                dotsDiameter = knobFloat("kb.dictation.dots.size", 14f) * density * density
                dotsScale = knobFloat("kb.dictation.dots.scale", 0.35f)
                dotsScaleRange = knobFloat("kb.dictation.dots.scaleRange", 0.1f)
                // Per second; negative fades the dot out on its way.
                dotsAlphaSpeed = knobFloat("kb.dictation.dots.alphaSpeed", -0.55f)
                dotsColor = hexColor(knobString("kb.dictation.dots.color", "#E8A23C")) ?: DOT_FALLBACK
                dotsAccum = 0f
                dotsKillAt = 0L
                dotsOn = true
            }
            // Out of the mic and, across one lifetime, into the pill: the pill
            // "receives" them. A rebuild mid-recording moves both ends.
            dotsX = sx
            dotsY = sy
            val dx = tx - sx
            val dy = ty - sy
            val distance = kotlin.math.sqrt(dx * dx + dy * dy)
            dotsAim = kotlin.math.atan2(dy, dx)
            dotsVelocity = distance / dotsLife
            dotsVelocityRange = distance * dotsJitter
            ensureSky()
            ensureLoop()
        } catch (_: Throwable) {
            dotsOn = false
        }
    }

    private fun stopDots() {
        dotsGen++
        if (!dotsOn) return
        dotsOn = false
        dotsKillAt = System.nanoTime() + nanosOf(knobFloat("kb.dictation.dots.decayMs", 2500f))
    }

    private fun spawnDot(s: Sky): Boolean {
        val i = s.add()
        if (i < 0) return false
        s.kind[i] = DOT
        s.x[i] = dotsX
        s.y[i] = dotsY
        val a = dotsAim + (Random.nextFloat() - 0.5f) * dotsSpread
        val v = dotsVelocity + (Random.nextFloat() * 2f - 1f) * dotsVelocityRange
        s.vx[i] = kotlin.math.cos(a) * v
        s.vy[i] = kotlin.math.sin(a) * v
        s.age[i] = 0f
        s.life[i] = dotsLife
        val scale = (dotsScale + (Random.nextFloat() * 2f - 1f) * dotsScaleRange).coerceAtLeast(0f)
        s.size[i] = dotsDiameter * scale
        s.rot[i] = 0f
        s.spin[i] = 0f
        s.alphaSpeed[i] = dotsAlphaSpeed
        s.color[i] = dotsColor
        return true
    }

    private var cx = 0f
    private var cy = 0f

    /** A view's centre in the container's coordinates, into (cx, cy). */
    private fun centreOf(v: View) {
        v.getLocationInWindow(loc)
        container.getLocationInWindow(base)
        cx = (loc[0] - base[0]) + v.width / 2f
        cy = (loc[1] - base[1]) + v.height / 2f
    }

    // ------------------------------------------------------------ the frost

    private var frostRows: List<TulmiKeyPlane> = emptyList()
    private var frostOn = false
    /** 0 clear … 1 fully frosted, as it stands on screen. */
    private var frostLevel = 0f
    private var frostAlpha = 1f
    private var frostBlurPx = 0f
    private var frostBlocks = true
    private var frostAnim: ValueAnimator? = null

    /**
     * Frost the key rows while the mic records, or clear them — called at the
     * end of every rebuild, so fresh rows take the frost as it stands.
     *
     * On iOS the veil fades in over kb.dictation.dim.fadeMs and takes the rows'
     * touches from the start (kb.dictation.dim.blocksTouches); on stop the keys
     * are back at once and the veil fades off them. Here the blur
     * (kb.dictation.dim.blur, API 31+) and the lock switch at the edge and the
     * rows' alpha fades — the one property that animates without making
     * anything per frame.
     */
    fun frost(rows: List<TulmiKeyPlane>, active: Boolean, keyAlpha: Float, blurPx: Float,
              blocksTouches: Boolean, fadeMs: Float) {
        frostRows = rows
        frostAlpha = keyAlpha.coerceIn(0f, 1f)
        frostBlurPx = blurPx.coerceAtLeast(0f)
        frostBlocks = blocksTouches
        if (active != frostOn) {
            frostOn = active
            frostAnim?.let { frostAnim = null; it.cancel() }
            val from = frostLevel
            val to = if (active) 1f else 0f
            // A keyboard that is not on screen has nothing to fade: it lands.
            if (fadeMs > 0f && from != to && container.isShown) {
                frostAnim = ValueAnimator.ofFloat(0f, 1f).apply {
                    duration = fadeMs.toLong()
                    addUpdateListener { a ->
                        val f = a.animatedFraction
                        frostLevel = from + (to - from) * f
                        if (f >= 1f && frostAnim === a) frostAnim = null
                        paintFrostAlpha()
                    }
                }
                frostAnim?.start()
            } else {
                frostLevel = to
            }
        }
        paintFrost()
    }

    private fun rowAlpha(): Float = 1f + (frostAlpha - 1f) * frostLevel

    private fun paintFrost() {
        // Rows fresh from a rebuild are clear and unlocked already.
        if (!frostOn && frostLevel == 0f && frostAnim == null) return
        val a = rowAlpha()
        for (i in 0 until frostRows.size) {
            val row = frostRows[i]
            row.locked = frostOn && frostBlocks
            row.alpha = a
        }
        if (Build.VERSION.SDK_INT >= 31) {
            val fx = if (frostOn && frostBlurPx > 0f) {
                android.graphics.RenderEffect.createBlurEffect(
                    frostBlurPx, frostBlurPx, android.graphics.Shader.TileMode.CLAMP)
            } else null
            for (i in 0 until frostRows.size) frostRows[i].setRenderEffect(fx)
        }
    }

    private fun paintFrostAlpha() {
        val a = rowAlpha()
        for (i in 0 until frostRows.size) frostRows[i].alpha = a
    }

    // ------------------------------------------------------------ helpers

    private fun nanosOf(ms: Float): Long = (ms.coerceAtLeast(0f) * 1_000_000f).toLong()

    /** #RRGGBB or #RRGGBBAA, as iOS reads them; null for anything else. */
    private fun hexColor(hex: String): Int? {
        val h = hex.trim().removePrefix("#")
        if ((h.length != 6 && h.length != 8) || h.any { Character.digit(it, 16) < 0 }) return null
        val v = h.toLong(16)
        return if (h.length == 6) (0xFF000000L or v).toInt()
            else (((v and 0xFFL) shl 24) or (v ushr 8)).toInt()
    }

    /**
     * Every particle in the air, both kinds, in parallel arrays — sized once,
     * so a frame allocates nothing. Positions and sizes are px in the
     * container's coordinates.
     */
    private class Sky : Drawable() {
        var n = 0
        val kind = IntArray(CAPACITY)
        val x = FloatArray(CAPACITY)
        val y = FloatArray(CAPACITY)
        val vx = FloatArray(CAPACITY)
        val vy = FloatArray(CAPACITY)
        val age = FloatArray(CAPACITY)
        val life = FloatArray(CAPACITY)
        /** A dot's diameter, a confetti square's side. */
        val size = FloatArray(CAPACITY)
        /** Radians, and radians a second. */
        val rot = FloatArray(CAPACITY)
        val spin = FloatArray(CAPACITY)
        /** Alpha lost (or gained) a second, from 1 at birth. */
        val alphaSpeed = FloatArray(CAPACITY)
        val color = IntArray(CAPACITY)
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }

        /** A free slot, or -1 when the sky is full. */
        fun add(): Int = if (n < CAPACITY) n++ else -1

        /** Drop particle [i]; the last one takes its slot. */
        fun remove(i: Int) {
            val last = n - 1
            if (i != last) {
                kind[i] = kind[last]; x[i] = x[last]; y[i] = y[last]
                vx[i] = vx[last]; vy[i] = vy[last]; age[i] = age[last]; life[i] = life[last]
                size[i] = size[last]; rot[i] = rot[last]; spin[i] = spin[last]
                alphaSpeed[i] = alphaSpeed[last]; color[i] = color[last]
            }
            n = last
        }

        override fun draw(canvas: Canvas) {
            for (i in 0 until n) {
                val fade = if (alphaSpeed[i] == 0f) 1f else (1f + alphaSpeed[i] * age[i]).coerceIn(0f, 1f)
                val c = color[i]
                val alpha = (Color.alpha(c) * fade).toInt()
                if (alpha <= 0) continue
                paint.color = (c and 0x00FFFFFF) or (alpha shl 24)
                val h = size[i] / 2f
                if (h <= 0f) continue
                if (kind[i] == DOT) {
                    canvas.drawCircle(x[i], y[i], h, paint)
                } else {
                    val saved = canvas.save()
                    canvas.rotate(rot[i] * RAD_TO_DEG, x[i], y[i])
                    canvas.drawRect(x[i] - h, y[i] - h, x[i] + h, y[i] + h, paint)
                    canvas.restoreToCount(saved)
                }
            }
        }

        override fun setAlpha(alpha: Int) {}
        override fun setColorFilter(colorFilter: ColorFilter?) {}
        @Deprecated("Deprecated in Java")
        override fun getOpacity(): Int = PixelFormat.TRANSLUCENT
    }

    private companion object {
        const val DOT = 0
        const val CONFETTI = 1
        /** More than any burst the server's numbers make; a runaway rate fills it and stops. */
        const val CAPACITY = 512
        const val MAX_BIRTHS_PER_SEC = 2000f
        /** A dropped frame advances the flight by this much at most. */
        const val MAX_STEP_SEC = 1f / 20f
        /** iOS's square.fill symbol at its default size, in points. */
        const val CONFETTI_SQUARE_DP = 18f
        /** The cone the confetti falls in, radians (iOS emissionRange). */
        const val CONFETTI_SPREAD = 0.5f
        /** Straight down the screen, radians. */
        const val DOWN = 1.5707964f
        const val RAD_TO_DEG = 57.29578f
        val DOT_FALLBACK = 0xFFE8A23C.toInt()
    }
}
