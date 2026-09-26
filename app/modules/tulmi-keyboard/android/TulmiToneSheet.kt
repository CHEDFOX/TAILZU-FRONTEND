package com.tulmi.app.keyboard

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.TimeInterpolator
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.RenderEffect
import android.graphics.Shader
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.animation.PathInterpolator
import android.widget.FrameLayout
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * The sheet a hold opens: the keyboard frosts behind it, and a panel of rows
 * springs out of the key that was held, then collapses back into it as the
 * frost clears. The Android twin of the blur view and UIView spring the iOS
 * keyboard uses for the same two sheets.
 *
 * Two things open one — the tone pill (kb.tone.sheet.*, read in the renderer)
 * and a personality row chip (kb.personalityRow.*) — each with its own knobs.
 * They hand every number over in [Look], so nothing here decides one.
 *
 * iOS frosts with a dark material. Android blurs what is behind (API 31+;
 * RenderEffect does not exist before) and lays a tint over it, which alone
 * carries the "pushed back" read on older devices.
 */
internal class TulmiToneSheet(private val look: Look) {

    /** How the sheet looks and moves. Sizes are px, times ms, colours ARGB. */
    class Look(
        val panelColor: Int,
        val radius: Float,
        val shadowColor: Int,
        val shadowOpacity: Float,
        val shadowRadius: Float,
        val shadowDy: Float,
        /** The blur behind the sheet, as RenderEffect takes it; 0 is none. */
        val blurRadius: Float,
        val scrimColor: Int,
        val blurInMs: Long,
        val openMs: Long,
        val closeMs: Long,
        /** UIKit spring damping ratio and initial velocity for the open. */
        val damping: Float,
        val velocity: Float,
        /** Where the panel grows from and shrinks back to: this scale, this
         *  far below (negative: above) where it settles. */
        val collapsedScale: Float,
        val collapsedDy: Float,
    )

    private var scrim: Scrim? = null
    private var panel: View? = null
    private var frosted: List<View> = emptyList()
    /** How far the frost is in, 0 to 1, so a close starts from where it is. */
    private var frost = 0f
    private val anims = ArrayList<Animator>()

    /**
     * Frost [host] and spring [content] out of [anchor]. [place] positions the
     * panel once it has measured: it gets the panel and the anchor's frame in
     * [host], and sets the panel's FrameLayout margins (and its height, to cap
     * it). False when the sheet could not be shown; nothing is left behind.
     */
    fun show(host: FrameLayout, content: View, anchor: View, place: (View, Rect) -> Unit): Boolean {
        dismiss(animated = false)
        return try {
            val a = frameIn(anchor, host)
            val ctx = host.context
            // What is already in the host blurs; the scrim and panel go on top.
            val behind = (0 until host.childCount).map { host.getChildAt(it) }.filter { it !is Scrim }
            val s = Scrim(ctx).apply {
                isClickable = true
                // The panel's shadow falls outside the panel.
                clipChildren = false
                setOnClickListener { dismiss(animated = true) }
            }
            // A detach reports the window gone too; only this sheet's own scrim
            // still up is a keyboard that hid with the sheet open.
            s.onHidden = { if (scrim === s) dismiss(animated = false) }
            // The tint fades on its own, beside the panel rather than around it.
            s.tint.setBackgroundColor(look.scrimColor)
            s.tint.alpha = 0f
            s.addView(s.tint, FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
            val p = Panel(ctx, look).apply {
                alpha = 0f
                // A tap between the rows is not a tap on the scrim.
                isClickable = true
                addView(content, FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT))
            }
            s.addView(p, FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT))
            // Held before it is added, so a failure past here still takes it down.
            scrim = s
            panel = p
            host.addView(s, FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
            frosted = if (Build.VERSION.SDK_INT >= 31 && look.blurRadius > 0f) behind else emptyList()
            val targets = frosted
            run(ValueAnimator.ofFloat(0f, 1f), look.blurInMs, null) { f -> frost = f; applyFrost(targets, s, f) }
            // Placed after the first measure, then sucked out of the anchor: it
            // starts as a speck and springs to full size.
            p.post {
                if (panel !== p) return@post
                try { place(p, a) } catch (t: Throwable) { Log.w("SDUI", "tone sheet placement failed: ${t.message}") }
                pose(p, 0f)
                run(ValueAnimator.ofFloat(0f, 1f), look.openMs,
                    SpringInterpolator(look.damping, look.velocity, look.openMs / 1000f)) { f -> pose(p, f) }
            }
            true
        } catch (t: Throwable) {
            Log.w("SDUI", "tone sheet failed: ${t.message}")
            dismiss(animated = false)
            false
        }
    }

    /** Close the sheet: collapsed back into its anchor as the frost clears
     *  (UIKit's ease-in), or at once. */
    fun dismiss(animated: Boolean) {
        val s = scrim
        if (s == null) {
            // A close already running finishes now when the caller needs it gone.
            if (!animated) stopAll()
            return
        }
        stopAll()
        val p = panel
        val targets = frosted
        val from = frost
        scrim = null
        panel = null
        frosted = emptyList()
        frost = 0f
        if (!animated || p == null || look.closeMs <= 0L) { finish(s, targets); return }
        // Touches go to the keyboard while it closes, as they do on iOS.
        s.closing = true
        val a0 = p.alpha
        val s0 = p.scaleX
        val t0 = p.translationY
        val anim = ValueAnimator.ofFloat(0f, 1f)
        anim.addListener(object : AnimatorListenerAdapter() {
            override fun onAnimationEnd(animation: Animator) { finish(s, targets) }
        })
        run(anim, look.closeMs, PathInterpolator(0.42f, 0f, 1f, 1f)) { q ->
            p.alpha = a0 * (1f - q)
            val sc = (s0 + (look.collapsedScale - s0) * q).coerceAtLeast(0f)
            p.scaleX = sc
            p.scaleY = sc
            p.translationY = t0 + (look.collapsedDy - t0) * q
            applyFrost(targets, s, from * (1f - q))
        }
    }

    /** The panel at [f] of the way from collapsed (0) to settled (1). A spring
     *  runs past 1; alpha stops at 1, and the scale never flips. */
    private fun pose(p: View, f: Float) {
        p.alpha = f.coerceIn(0f, 1f)
        val sc = (look.collapsedScale + (1f - look.collapsedScale) * f).coerceAtLeast(0f)
        p.scaleX = sc
        p.scaleY = sc
        p.translationY = look.collapsedDy * (1f - f)
    }

    /** The scrim's tint and the blur behind it, [f] of the way in. */
    private fun applyFrost(targets: List<View>, s: Scrim, f: Float) {
        s.tint.alpha = f.coerceIn(0f, 1f)
        if (targets.isEmpty() || Build.VERSION.SDK_INT < 31) return
        val r = look.blurRadius * f.coerceIn(0f, 1f)
        try {
            // A radius of 0 makes no effect at all (and throws).
            val fx = if (r >= 0.5f) RenderEffect.createBlurEffect(r, r, Shader.TileMode.CLAMP) else null
            targets.forEach { it.setRenderEffect(fx) }
        } catch (_: Throwable) { /* the tint still reads as frost */ }
    }

    private fun finish(s: View, targets: List<View>) {
        (s.parent as? ViewGroup)?.removeView(s)
        if (targets.isNotEmpty() && Build.VERSION.SDK_INT >= 31) {
            try { targets.forEach { it.setRenderEffect(null) } } catch (_: Throwable) {}
        }
    }

    private fun stopAll() {
        // A cancel ends the animator, whose end listener lets go of it.
        ArrayList(anims).forEach { it.cancel() }
        anims.clear()
    }

    /** Animators throw on a negative duration; a server typo is not a crash. */
    private fun run(anim: ValueAnimator, ms: Long, curve: TimeInterpolator?, onFrame: (Float) -> Unit) {
        anim.duration = ms.coerceIn(0L, 10_000L)
        if (curve != null) anim.interpolator = curve
        anim.addUpdateListener { onFrame(it.animatedValue as Float) }
        anim.addListener(object : AnimatorListenerAdapter() {
            override fun onAnimationEnd(animation: Animator) { anims.remove(animation) }
        })
        anims += anim
        anim.start()
    }

    private fun frameIn(v: View, host: View): Rect {
        val a = IntArray(2)
        v.getLocationInWindow(a)
        val h = IntArray(2)
        host.getLocationInWindow(h)
        val x = a[0] - h[0]
        val y = a[1] - h[1]
        return Rect(x, y, x + v.width, y + v.height)
    }

    /**
     * What covers the keyboard while the sheet is up: the tint, and the panel
     * over it. A tap on it closes the sheet; it lets touches through while the
     * sheet closes, and a keyboard that hides with the sheet open does not
     * come back with it still up.
     */
    private class Scrim(ctx: Context) : FrameLayout(ctx) {
        val tint = View(ctx)
        var closing = false
        var onHidden: (() -> Unit)? = null

        override fun dispatchTouchEvent(ev: MotionEvent): Boolean = !closing && super.dispatchTouchEvent(ev)

        override fun onWindowVisibilityChanged(visibility: Int) {
            super.onWindowVisibilityChanged(visibility)
            // Posted: removing a view while its parent walks its children crashes.
            val hidden = onHidden ?: return
            if (visibility != View.VISIBLE) Handler(Looper.getMainLooper()).post { hidden() }
        }
    }

    /**
     * The panel: its fill and its shadow — colour, opacity, blur and drop —
     * painted the way a CALayer paints both. A shadow layer on a shape draws
     * under hardware acceleration from API 28; before that the system's
     * elevation shadow stands in, as deep as the blur.
     */
    private class Panel(ctx: Context, private val look: Look) : FrameLayout(ctx) {
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        private val box = RectF()
        private val drawn = Build.VERSION.SDK_INT >= 28

        init {
            val op = if (look.shadowOpacity.isNaN()) 0f else look.shadowOpacity.coerceIn(0f, 1f)
            val shadow = Color.argb(
                (Color.alpha(look.shadowColor) * op).roundToInt().coerceIn(0, 255),
                Color.red(look.shadowColor), Color.green(look.shadowColor), Color.blue(look.shadowColor),
            )
            if (drawn) {
                setWillNotDraw(false)
                paint.color = look.panelColor
                if (Color.alpha(shadow) > 0) {
                    paint.setShadowLayer(look.shadowRadius.coerceAtLeast(0.5f), 0f, look.shadowDy, shadow)
                }
            } else {
                background = GradientDrawable().apply {
                    setColor(look.panelColor)
                    cornerRadius = look.radius
                }
                if (Color.alpha(shadow) > 0) elevation = look.shadowRadius.coerceAtLeast(0f)
            }
        }

        override fun onDraw(canvas: Canvas) {
            if (drawn) {
                box.set(0f, 0f, width.toFloat(), height.toFloat())
                canvas.drawRoundRect(box, look.radius, look.radius, paint)
            }
            super.onDraw(canvas)
        }

        // Alpha per draw call rather than through a layer the size of the
        // panel, which would cut the shadow off while the panel fades.
        override fun hasOverlappingRendering(): Boolean = false
    }
}

/**
 * A UIKit spring — damping ratio and initial velocity — as the curve of an
 * animation lasting [durationSec]. Tuned the way a UIView spring of that
 * duration is, to come to rest by the end: it runs past 1 on the way (the
 * overshoot a damping under 1 gives) and lands on exactly 1. The velocity is
 * UIKit's too, the whole distance per second.
 *
 * Only the framework is available here (no dynamic-animation library), so
 * the spring is solved in closed form rather than stepped.
 */
internal class SpringInterpolator(damping: Float, velocity: Float, durationSec: Float) : TimeInterpolator {
    private val zeta = (if (damping.isNaN()) 1f else damping).coerceIn(0.05f, 1f).toDouble()
    // Time runs 0 to 1 over the duration, so the velocity is scaled into it.
    private val v0 = (if (velocity.isNaN() || velocity.isInfinite()) 0f else velocity).toDouble() *
        (if (durationSec.isNaN()) 0f else durationSec.coerceIn(0f, 10f)).toDouble()
    // The swing dies to a thousandth of the distance by the end.
    private val w0 = ln(1000.0) / zeta
    private val wd = w0 * sqrt(1.0 - zeta * zeta)

    override fun getInterpolation(input: Float): Float {
        if (input >= 1f) return 1f
        if (input <= 0f) return 0f
        val t = input.toDouble()
        val decay = exp(-zeta * w0 * t)
        val y = if (wd < 1e-6) {
            1.0 - decay * (1.0 + (w0 - v0) * t)
        } else {
            1.0 - decay * (cos(wd * t) + ((zeta * w0 - v0) / wd) * sin(wd * t))
        }
        return y.toFloat()
    }
}
