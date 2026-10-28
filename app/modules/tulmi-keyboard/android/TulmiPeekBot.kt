package com.tulmi.app.keyboard

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.os.Build
import android.os.SystemClock
import android.view.View
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.random.Random

/**
 * THE MIC KEY AS A TINY BOT (kb.mic.bot = "peek"). The Android half of
 * iOS's PeekBotView, with the same numbers.
 *
 * The key is a round window. Now and then the bot peeks in from below,
 * holding the rim, and looks around; tap the key and it pops up to listen,
 * ears and antenna pulsing with the voice; while the words are cleaned up it
 * shows thinking dots on its visor; when they land it smiles, a sparkle goes
 * off, and it ducks back down. Everything is springs.
 *
 * Units: the key's radius is 1, the centre is 0,0, y down. The renderer
 * feeds it the mic state; the bot works out its own moment from it.
 */
class TulmiPeekBot(context: Context) : View(context) {
    // Inputs — the renderer points these at its state.
    var dictating: () -> Boolean = { false }
    var busy: () -> Boolean = { false }
    var level: () -> Float = { 0f }

    // Look — kb.mic.bot.* colours and timings, set by the renderer.
    var windowColor = Color.parseColor("#2E2B28")
    var shellTop = Color.parseColor("#FBF0DE")
    var shellBottom = Color.parseColor("#E9D0A8")
    var bodyColor = Color.parseColor("#E2C59A")
    var visorColor = Color.parseColor("#1D1C1B")
    var glowColor = Color.parseColor("#FFF1D6")
    var clayColor = Color.parseColor("#C9683F")
    var peekMin = 4.0
    var peekMax = 9.0
    var doneHold = 1.6

    private enum class Mode { IDLE, LISTEN, THINK, DONE }

    private companion object {
        const val HIDDEN = 1.62; const val PEEK = 0.86; const val UP = 0.1
        const val HEAD_W = 1.12; const val HEAD_H = 0.86; const val HEAD_R = 0.32
        const val VISOR_W = 0.84; const val VISOR_H = 0.46; const val VISOR_R = 0.2; const val VISOR_Y = -0.05
        const val EYE_X = 0.19; const val EYE_W = 0.12; const val EYE_H = 0.19
        const val STALK = 0.22; const val BALL = 0.075; const val EAR_R = 0.1; const val PAW_R = 0.1; const val PAW_X = 0.5
    }

    /** Damped spring: rate in rad/s, damp the damping ratio (1 critical). */
    private class Spring(var x: Double) {
        var v = 0.0
        fun step(to: Double, dt: Double, rate: Double, damp: Double) {
            v += ((to - x) * rate * rate - 2 * damp * rate * v) * dt
            x += v * dt
        }
        fun snap(to: Double) { x = to; v = 0.0 }
    }

    private val y = Spring(HIDDEN); private val tilt = Spring(0.0)
    private val lookX = Spring(0.0); private val lookY = Spring(0.0)
    private val ant = Spring(0.0); private val ear = Spring(0.0); private val glow = Spring(0.0)
    private val think = Spring(0.0); private val happy = Spring(0.0); private val paws = Spring(0.0)
    private var mode = Mode.IDLE
    private var lastMode = Mode.IDLE
    private var clock = 0.0
    private var lastTick = 0L
    private var peekIn = 1.2
    private var peekLeft = 0.0
    private var typingUntil = 0.0
    private var blinkIn = 2.0
    private var blinkT = 0.0
    private var blink = 1.0
    private var sparkle = 0.0
    private var doneAt = -100.0
    private var lastActive = -100.0
    private var wasActive = false
    private var lv = 0.0
    private var running = false
    private var resting = true

    private val fillP = Paint(Paint.ANTI_ALIAS_FLAG)
    private val strokeP = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND }
    private val rect = RectF()
    private val path = Path()
    private val disk = Path()

    init { isClickable = false; isFocusable = false }

    /** A key was pressed: no peeking while someone types. */
    fun noteTyping() { typingUntil = clock + 1.2 }

    /** Start (or resume) the frame loop; the renderer calls this whenever the
     *  mic's state may have changed. Animations off: one still frame. */
    fun wake() {
        if (Build.VERSION.SDK_INT >= 26 && !ValueAnimator.areAnimatorsEnabled()) {
            running = false
            holdStill()
            invalidate()
            return
        }
        lastTick = 0L
        resting = false
        if (!isAttachedToWindow) return
        removeCallbacks(frame)          // a pending rest check: run now instead
        running = true
        postOnAnimation(frame)
    }

    override fun onAttachedToWindow() { super.onAttachedToWindow(); wake() }
    override fun onDetachedFromWindow() { running = false; removeCallbacks(frame); super.onDetachedFromWindow() }

    private val frame = object : Runnable {
        override fun run() {
            if (!running) return
            tick()
            // At rest, a few checks a second; moving, every frame.
            if (resting) postDelayed(this, 250L) else postOnAnimation(this)
        }
    }

    private fun tick() {
        val now = SystemClock.uptimeMillis()
        val dt = if (lastTick == 0L) 1.0 / 60 else min((now - lastTick) / 1000.0, if (resting) 0.5 else 1.0 / 30)
        lastTick = now
        clock += dt
        mode = currentMode()
        if (resting) {
            if (mode == Mode.IDLE) {
                peekIn -= dt
                if (peekIn > 0 || clock < typingUntil) return
            }
            resting = false
            lastTick = now
            return
        }
        update(min(dt, 1.0 / 30))
        invalidate()
        if (mode == Mode.IDLE && peekLeft <= 0 && abs(y.x - HIDDEN) < 0.002 && abs(y.v) < 0.01 && paws.x < 0.01 && sparkle <= 0) {
            resting = true
        }
    }

    private fun currentMode(): Mode {
        if (dictating()) { lastActive = clock; wasActive = true; return Mode.LISTEN }
        if (busy()) { lastActive = clock; wasActive = true; return Mode.THINK }
        if (wasActive) {
            // A beat for the clean-up to start after the microphone closes.
            if (clock - lastActive < 0.35) return if (lastMode == Mode.THINK) Mode.THINK else Mode.LISTEN
            wasActive = false
            doneAt = clock
        }
        return if (clock - doneAt < doneHold) Mode.DONE else Mode.IDLE
    }

    private fun update(dt: Double) {
        val lvNow = if (mode == Mode.LISTEN) level().toDouble().coerceIn(0.0, 1.0) else 0.0
        lv = lvNow
        if (mode != lastMode) {
            if (mode == Mode.LISTEN && lastMode == Mode.IDLE) ant.v += 9     // the pop flicks the antenna
            if (mode == Mode.DONE) { sparkle = 1.0; ant.v -= 6 }
            lastMode = mode
        }
        // Peeks: idle only, at random, never while typing.
        if (mode == Mode.IDLE) {
            if (peekLeft > 0) peekLeft -= dt
            else if (peekIn <= 0) {
                if (clock >= typingUntil) peekLeft = 1.8 + Random.nextDouble() * 1.4
                peekIn = peekMin + Random.nextDouble() * max(0.0, peekMax - peekMin)
            } else peekIn -= dt
            if (clock < typingUntil) peekLeft = min(peekLeft, 0.15)
        } else peekLeft = 0.0
        val peeking = mode == Mode.IDLE && peekLeft > 0
        val sinceDone = clock - doneAt
        val yTo = when (mode) {
            Mode.LISTEN, Mode.THINK -> UP
            Mode.DONE -> if (sinceDone < 1.1) UP - (if (sinceDone < 0.25) 0.12 else 0.0) else HIDDEN
            Mode.IDLE -> if (peeking) PEEK else HIDDEN
        }
        val pop = yTo < y.x
        y.step(yTo, dt, if (pop) 15.0 else 9.0, if (pop) 0.42 else 0.8)
        val t = clock
        val (lx, ly) = when (mode) {
            Mode.IDLE -> if (peeking) Pair(sin(t * 1.7) * 0.07, -0.02) else Pair(0.0, 0.0)
            Mode.LISTEN -> Pair(-0.05, -0.04)
            Mode.THINK -> Pair(0.05 * cos(t * 5), -0.05)
            Mode.DONE -> Pair(0.0, 0.0)
        }
        lookX.step(lx, dt, 14.0, 0.7); lookY.step(ly, dt, 14.0, 0.7)
        tilt.step(when (mode) { Mode.LISTEN -> -0.1 + lvNow * 0.05; Mode.THINK -> 0.06 * sin(t * 3); else -> 0.0 }, dt, 9.0, 0.5)
        ear.step(lvNow, dt, 26.0, 0.6)
        glow.step(when (mode) { Mode.LISTEN -> 0.35 + lvNow * 0.65; Mode.THINK -> 0.5 + 0.3 * sin(t * 8); else -> 0.0 }, dt, 22.0, 0.8)
        think.step(if (mode == Mode.THINK) 1.0 else 0.0, dt, 18.0, 1.0)
        happy.step(if (mode == Mode.DONE && sinceDone < 1.3) 1.0 else 0.0, dt, 20.0, 1.0)
        paws.step(if (peeking) 1.0 else 0.0, dt, 16.0, 0.9)
        // Antenna: a pendulum on the head, driven by its tilt and its rise.
        ant.step(-tilt.x * 1.5 + (if (mode == Mode.LISTEN) sin(t * 9) * 0.12 * lvNow else 0.0), dt, 13.0, 0.18)
        ant.v += -y.v * dt * 1.2 * (if (ant.x < 0) -1 else 1)
        sparkle = max(0.0, sparkle - dt * 1.1)
        blinkIn -= dt
        if (blinkIn <= 0) { blinkIn = 2.2 + Random.nextDouble() * 2.8; blinkT = 0.16 }
        if (blinkT > 0) { blinkT -= dt; blink = abs(cos((1 - blinkT / 0.16) * Math.PI)) } else blink = 1.0
    }

    /** Animations off: the pose of the moment, still — peeking when idle. */
    private fun holdStill() {
        mode = currentMode()
        lastMode = mode
        y.snap(if (mode == Mode.IDLE) PEEK else UP)
        think.snap(if (mode == Mode.THINK) 1.0 else 0.0)
        happy.snap(if (mode == Mode.DONE) 1.0 else 0.0)
        paws.snap(if (mode == Mode.IDLE) 1.0 else 0.0)
    }

    // ------------------------------------------------------------ drawing

    private var R = 1f
    private fun u(v: Double) = (v * R).toFloat()
    private fun disc(x: Double, y: Double, r: Double, col: Int, c: Canvas) {
        fillP.shader = null; fillP.color = col
        c.drawCircle(u(x), u(y), u(r), fillP)
    }
    private fun rr(x: Double, y: Double, w: Double, h: Double, r: Double, col: Int, c: Canvas) {
        fillP.shader = null; fillP.color = col
        rect.set(u(x), u(y), u(x + w), u(y + h))
        val rad = min(u(r), min(rect.width(), rect.height()) / 2f)
        c.drawRoundRect(rect, rad, rad, fillP)
    }
    private fun alpha(col: Int, a: Double) = (col and 0x00FFFFFF) or ((a.coerceIn(0.0, 1.0) * Color.alpha(col)).toInt() shl 24)

    override fun onDraw(c: Canvas) {
        R = min(width, height) / 2f
        if (R <= 1f) return
        c.save()
        c.translate(width / 2f, height / 2f)
        disk.reset(); disk.addCircle(0f, 0f, R, Path.Direction.CW)
        c.save()
        c.clipPath(disk)
        c.drawColor(windowColor)

        val st = (-y.v * 0.035).coerceIn(-0.14, 0.2)
        c.save()
        c.translate(0f, u(y.x)); c.rotate(Math.toDegrees(tilt.x).toFloat()); c.scale((1 - st * 0.55).toFloat(), (1 + st).toFloat())
        // Body, down out of the window
        rr(-0.34, 0.3, 0.68, 1.4, 0.2, bodyColor, c)
        // Ears, behind the shell, pulsing with the voice
        val er = EAR_R + 0.05 * ear.x
        disc(-HEAD_W / 2, -0.02, er, clayColor, c); disc(HEAD_W / 2, -0.02, er, clayColor, c)
        // Antenna
        val ax = sin(ant.x) * STALK
        val ay = -HEAD_H / 2 - cos(ant.x) * STALK
        strokeP.color = shellBottom; strokeP.strokeWidth = u(0.05)
        path.reset(); path.moveTo(0f, u(-HEAD_H / 2 + 0.02)); path.quadTo(u(ax * 0.2), u(ay + 0.1), u(ax), u(ay))
        c.drawPath(path, strokeP)
        val g = glow.x.coerceIn(0.0, 1.0)
        if (g > 0.02) disc(ax, ay, BALL + 0.15 * glow.x, alpha(clayColor, 0.3 * g), c)
        disc(ax, ay, BALL, clayColor, c)
        // Shell, lighter on top
        fillP.shader = LinearGradient(0f, u(-HEAD_H / 2), 0f, u(HEAD_H / 2), shellTop, shellBottom, Shader.TileMode.CLAMP)
        rect.set(u(-HEAD_W / 2), u(-HEAD_H / 2), u(HEAD_W / 2), u(HEAD_H / 2))
        c.drawRoundRect(rect, u(HEAD_R), u(HEAD_R), fillP)
        fillP.shader = null
        rr(-0.4, -0.38, 0.26, 0.07, 0.035, Color.argb(140, 255, 255, 255), c)
        // Visor and face
        rr(-VISOR_W / 2, VISOR_Y - VISOR_H / 2, VISOR_W, VISOR_H, VISOR_R, visorColor, c)
        val fx = lookX.x
        val fy = VISOR_Y + lookY.x
        if (happy.x > 0.5) {
            strokeP.color = glowColor; strokeP.strokeWidth = u(0.06)
            for (s in intArrayOf(-1, 1)) {
                val cx = s * EYE_X + fx
                rect.set(u(cx - 0.075), u(fy + 0.04 - 0.075), u(cx + 0.075), u(fy + 0.04 + 0.075))
                c.drawArc(rect, 207f, 126f, false, strokeP)
            }
        } else if (think.x > 0.5) {
            for (i in 0 until 3) {
                val bounce = max(0.0, sin(clock * 7 - i * 0.9)) * 0.06
                disc((i - 1) * 0.15 + fx * 0.5, fy - bounce, 0.045, glowColor, c)
            }
        } else {
            val eh = max(0.02, EYE_H * blink * (1 + 0.15 * ear.x))
            for (s in intArrayOf(-1, 1)) {
                val x = s * EYE_X + fx
                // A soft halo, then the eye: a glowing pill that blinks.
                rr(x - EYE_W * 0.85, fy - eh * 0.85, EYE_W * 1.7, eh * 1.7, EYE_W * 0.85, alpha(glowColor, 0.18), c)
                rr(x - EYE_W / 2, fy - eh / 2, EYE_W, eh, EYE_W / 2, glowColor, c)
            }
            if (mode == Mode.LISTEN) {
                val mw = 0.08 + 0.06 * lv
                val mh = 0.025 + 0.07 * lv
                rr(fx - mw / 2, fy + 0.15 - mh / 2, mw, mh, min(mw, mh) / 2, glowColor, c)
            }
        }
        c.restore()
        // Paws on the rim while peeking
        if (paws.x > 0.02) {
            val py = 0.93 - 0.1 * paws.x.coerceIn(0.0, 1.0)
            disc(-PAW_X, py, PAW_R, shellTop, c); disc(PAW_X, py, PAW_R, shellTop, c)
        }
        // Sparkle when the words land
        if (sparkle > 0) {
            c.save()
            c.translate(u(0.55), u(-0.5)); c.rotate(Math.toDegrees((1 - sparkle) * 1.5).toFloat())
            val k = u(0.14 * (0.6 + 0.4 * sin(sparkle * Math.PI)))
            path.reset()
            for (i in 0 until 8) {
                val a = i * Math.PI / 4
                val r = if (i % 2 == 1) k * 0.32f else k
                val px = (cos(a) * r).toFloat(); val py = (sin(a) * r).toFloat()
                if (i == 0) path.moveTo(px, py) else path.lineTo(px, py)
            }
            path.close()
            fillP.shader = null; fillP.color = alpha(glowColor, min(1.0, sparkle * 2))
            c.drawPath(path, fillP)
            c.restore()
        }
        // The rim: a soft inner shadow, so the bot sits inside the window
        fillP.shader = RadialGradient(0f, 0f, R, intArrayOf(Color.TRANSPARENT, Color.TRANSPARENT, Color.argb(107, 0, 0, 0)),
            floatArrayOf(0f, 0.72f, 1f), Shader.TileMode.CLAMP)
        c.drawCircle(0f, 0f, R, fillP)
        fillP.shader = null
        c.restore()
        // A glint on the glass
        strokeP.color = Color.argb(41, 255, 255, 255); strokeP.strokeWidth = u(0.05)
        rect.set(-u(0.86), -u(0.86), u(0.86), u(0.86))
        c.drawArc(rect, 194.4f, 54f, false, strokeP)
        c.restore()
    }
}
