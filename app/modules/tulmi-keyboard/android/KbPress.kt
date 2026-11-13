package com.tulmi.app.keyboard

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.os.Build
import android.provider.Settings
import android.view.View
import org.json.JSONObject

/**
 * `style.press` — WHAT A KEY DOES WHEN YOUR FINGER LANDS ON IT.
 * [native/SPEC.md §1.6 item 4; shared/types/keyboardFace.ts PRESS_KINDS]
 *
 * Three kinds, and the server picks the numbers:
 *   fade   today's: the press colour, easing back out. Always available.
 *   pop    the key grows by `scale` and lifts by `dy`, then settles.
 *   glow   a wash of `color` blooms over the cap and fades.
 *
 * A PRESSED STATE, NOT A BOUNCE. [H12-Q2] The effect goes on at finger-down
 * and comes off at lift — pop eases to (scale, dy) over `ms` and HOLDS there
 * while the finger is down; glow's wash is full at once; both settle over `ms`
 * from wherever they had got to. iPhone ships exactly this (KBPress.begin from
 * keyTouchDown, end from keyTouchUp), and one `press` block goes to both
 * phones, so a release-only bounce here would make the same skin feel like a
 * different skin on each.
 *
 * THE FIVE RULES THAT MAKE THIS SAFE TO SHIP ON A KEYBOARD:
 *  1. **Visual only.** A press effect never inserts, never deletes, never
 *     decides anything. It is paint over a key whose behaviour is already
 *     settled by the tree.
 *  2. **Never in front of the commit.** The keyboard types on contact
 *     (kb.keyPlane.commitOnDown). Starting the effect is a timestamp or an
 *     animator start inside setPressed; its first frame is drawn on the next
 *     vsync, after the handler has returned from the commit. On the plain
 *     path the effect started long before the lift commit and costs it
 *     nothing. Nothing is reordered.
 *  3. **THE KEY VIEW IS NEVER TRANSFORMED.** Rows hit-test with getHitRect
 *     and the grid caches frames from getLocationInWindow; both include a
 *     view's own transform, and the grid re-measures after every suggestion
 *     strip change — which while typing is about the next keystroke. A key
 *     that was still popping would have its frame cached a few dp up and out
 *     until the next refresh. So a `pop` key is a [PopButton] that scales its
 *     own DRAWING: the paint moves and the hit rect never does, which is the
 *     rule the drawn path's popRect already follows.
 *  4. **Rollover is one down and one up per key.** Nothing double-fires: a
 *     slide across a row presses and releases each key in turn, and a new
 *     down on the same key starts from the value it is at.
 *  5. **Reduce Motion wins.** Animators off on the device means `fade` —
 *     today's behaviour, which is a colour change and not motion at all.
 *
 * An unknown kind is `fade` too. That is the rule for the whole format: a
 * phone that does not understand something draws what it has always drawn.
 */
object KbPress {

    /**
     * keyboardFace.ts KEY_FACE_LIMITS.press. The same numbers on both phones,
     * so one `press` block cannot read as a sink on iPhone and as nothing at
     * all on Android. [H12-Q2]
     *
     * On a key about 32 pt wide with the usual 6 pt gap, 1.12 grows about
     * 1.9 pt a side and stays inside its half of the gap; 6 dp is about half
     * the row gap; 0.9 allows a press-in sink.
     */
    private const val MAX_MS = 400L
    private const val SCALE_MIN = 0.9f
    private const val SCALE_MAX = 1.12f
    private const val DY_MAX_DP = 6f

    /** A press effect as the server described it, already clamped. */
    class Spec(
        val kind: String,
        val ms: Long,
        /** pop: how far it grows. 1 = not at all. */
        val scale: Float,
        /** pop: how far it lifts, in px (the caller converts dp). */
        val dyPx: Float,
        /** glow: the colour it washes with, already ARGB. */
        val color: Int,
        val ease: String,
    ) {
        val isPop: Boolean get() = kind == "pop"
        val isGlow: Boolean get() = kind == "glow"
    }

    /**
     * `style.press`, clamped. Null for no press block, for plain mode, and for
     * anything that parses to nothing — all three mean today's fade.
     */
    fun parse(style: Map<String, Any?>, density: Float): Spec? {
        val o = style["press"] as? JSONObject ?: return null
        val kind = o.optString("kind", "fade").trim().lowercase()
        if (kind != "pop" && kind != "glow") return null          // fade is the floor; nothing to do
        val color = o.optString("color", "").takeIf { it.isNotEmpty() }
            ?.let { runCatching { parseHex(it) }.getOrNull() } ?: Color.argb(64, 255, 255, 255)
        return Spec(
            kind = kind,
            ms = o.optLong("ms", 140L).coerceIn(0L, MAX_MS),
            // The server clamps to the same range and writes every number
            // explicitly, so no phone default ever decides how a skin looks;
            // this is the floor under that, not a second opinion.
            scale = o.optDouble("scale", 1.08).toFloat().coerceIn(SCALE_MIN, SCALE_MAX),
            dyPx = o.optDouble("dy", 0.0).toFloat().coerceIn(-DY_MAX_DP, DY_MAX_DP) * density,
            color = color,
            ease = o.optString("ease", "ease"),
        )
    }

    /** Motion is off on this device (Reduce Motion, or a battery saver). */
    fun motionOn(context: Context): Boolean = try {
        if (Build.VERSION.SDK_INT >= 26) ValueAnimator.areAnimatorsEnabled()
        else Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) != 0f
    } catch (_: Throwable) {
        true
    }

    /** 0..1 eased the way [Spec.ease] asks. `spring` overshoots a touch. */
    private fun ease(spec: Spec, t: Float): Float {
        val x = t.coerceIn(0f, 1f)
        return when (spec.ease) {
            "linear" -> x
            "spring" -> {
                // A fast, settling curve — quicker off the mark than `ease`
                // and softer at the end. Not a real spring: a keyboard press
                // is 140 ms, and no amount of physics is visible in that, so
                // there is no velocity to carry between frames.
                val k = 1f - x
                1f - k * k * (1f + 1.6f * x)
            }
            else -> 1f - (1f - x) * (1f - x)
        }
    }

    // -- the view path ------------------------------------------------------

    /** The animation a key is running, so a new touch can take over from it. */
    private val running = java.util.WeakHashMap<View, ValueAnimator>()

    /**
     * A key `pop` draws itself through. A `Button` cannot be transformed —
     * the hit tests read the transform — so the scale and the lift go on the
     * CANVAS inside draw(), where they move pixels and nothing else.
     *
     * Only a key whose style asks for `pop` is built as one of these; every
     * other key stays a plain Button, so nothing about the typing path
     * changes for the keyboard anybody has today.
     */
    class PopButton(context: Context) : android.widget.Button(context) {

        /** The spec this key presses with, set when the key is built. */
        var popSpec: Spec? = null

        /** 0 at rest, 1 fully pressed. */
        var popLevel: Float = 0f
            set(v) {
                val n = v.coerceIn(0f, 1f)
                if (n == field) return
                field = n
                invalidate()
                // A grown key paints outside its own bounds, so the row has
                // to repaint too. Key rows already run with clipChildren off
                // for the shadow, which is what lets it show at all.
                (parent as? View)?.invalidate()
            }

        override fun draw(canvas: Canvas) {
            val s = popSpec
            if (s == null || popLevel <= 0f) { super.draw(canvas); return }
            val k = popLevel
            val sc = 1f + (s.scale - 1f) * k
            val save = canvas.save()
            canvas.scale(sc, sc, width / 2f, height / 2f)
            canvas.translate(0f, s.dyPx * k)
            super.draw(canvas)
            canvas.restoreToCount(save)
        }
    }

    /**
     * Finger down: go to the pressed state. Called from setPressed, so the
     * first frame is drawn after the handler has returned from the commit.
     */
    fun down(view: View, spec: Spec?) {
        running.remove(view)?.cancel()
        if (spec == null) return
        if (!motionOn(view.context)) return                      // Reduce Motion: fade only
        when {
            spec.isPop -> {
                val b = view as? PopButton ?: return
                if (spec.ms <= 0L) { b.popLevel = 1f; return }
                animate(view, b.popLevel, 1f, spec) { b.popLevel = it }
            }
            spec.isGlow -> {
                if (Build.VERSION.SDK_INT < 23) return           // no foreground to wash with
                // Full at once, as on iPhone: a wash that arrives late reads
                // as lag, and on the commit-on-down path the letter is in the
                // field already.
                glowOf(view, spec).level = 1f
            }
        }
    }

    /** Finger gone: settle back over `ms`, from wherever it had got to. */
    fun up(view: View, spec: Spec?) {
        running.remove(view)?.cancel()
        if (spec == null) return
        when {
            spec.isPop -> {
                val b = view as? PopButton ?: return
                if (spec.ms <= 0L || !motionOn(view.context)) { b.popLevel = 0f; return }
                animate(view, b.popLevel, 0f, spec) { b.popLevel = it }
            }
            spec.isGlow -> {
                if (Build.VERSION.SDK_INT < 23) return
                val g = view.foreground as? GlowDrawable ?: return
                if (spec.ms <= 0L || !motionOn(view.context)) { clearGlow(view); return }
                // The wash comes off with the animator, so a key at rest
                // carries no foreground and costs the row nothing to draw.
                animate(view, g.level, 0f, spec, done = { if (view.foreground === g) clearGlow(view) }) { g.level = it }
            }
        }
    }

    // There is no public "cancel": every path that lets a key go — a lift, a
    // slide off the key, ACTION_CANCEL, the trackpad taking over — goes
    // through the plane's releaseSilently and so through [up], which settles
    // the key and takes the wash off. A second way to reset would be a second
    // thing to keep in step.

    private fun clearGlow(view: View) {
        if (Build.VERSION.SDK_INT >= 23 && view.foreground is GlowDrawable) view.foreground = null
    }

    private fun glowOf(view: View, spec: Spec): GlowDrawable {
        (view.foreground as? GlowDrawable)?.let { return it }
        val g = GlowDrawable(spec.color, capRadius(view))
        view.foreground = g
        return g
    }

    /**
     * One animator per key from [from] to [to], eased the way the spec asks,
     * over as much of `ms` as the distance left needs — so a key let go
     * halfway up settles in half the time rather than crawling.
     */
    private fun animate(view: View, from: Float, to: Float, spec: Spec, done: (() -> Unit)? = null, set: (Float) -> Unit) {
        val span = Math.abs(to - from)
        if (span <= 0.001f) { set(to); done?.invoke(); return }
        val a = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = (spec.ms * span).toLong().coerceAtLeast(1L)
            addUpdateListener {
                val t = it.animatedValue as Float
                set(from + (to - from) * ease(spec, t))
            }
        }
        a.addListener(object : android.animation.AnimatorListenerAdapter() {
            override fun onAnimationEnd(animation: android.animation.Animator) {
                // Android runs onAnimationEnd after a CANCEL too. A cancelled
                // animator must not finish its job: the key has been pressed
                // again and a newer animator is already running from where
                // this one had got to. Only the animator still on the books
                // settles the key.
                if (running[view] !== a) return
                running.remove(view)
                set(to)
                done?.invoke()
            }
        })
        running[view] = a
        a.start()
    }

    /**
     * The key cap's corner radius, so the wash has the key's own shape.
     *
     * A faced key's background is a LayerDrawable (the cap, then the print),
     * so the cap is layer 0 rather than the background itself. getCornerRadius
     * only exists from API 24; below that the wash is square-cornered, which
     * on a rounded key reads as a slightly wide flash and not as a bug.
     */
    private fun capRadius(view: View): Float {
        if (Build.VERSION.SDK_INT < 24) return 0f
        val bg = view.background
        val cap = when (bg) {
            is android.graphics.drawable.GradientDrawable -> bg
            is android.graphics.drawable.LayerDrawable ->
                if (bg.numberOfLayers > 0) bg.getDrawable(0) as? android.graphics.drawable.GradientDrawable else null
            else -> null
        } ?: return 0f
        return try { cap.cornerRadius } catch (_: Throwable) { 0f }
    }

    /** The wash itself: one rounded rect, so it costs no layer and no bitmap. */
    private class GlowDrawable(private val tint: Int, private val radius: Float) :
        android.graphics.drawable.Drawable() {
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        private val r = RectF()
        var level: Float = 0f
            set(v) { field = v.coerceIn(0f, 1f); invalidateSelf() }

        override fun draw(canvas: Canvas) {
            if (level <= 0f) return
            r.set(bounds)
            paint.color = tint
            paint.alpha = (Color.alpha(tint) * level).toInt().coerceIn(0, 255)
            canvas.drawRoundRect(r, radius, radius, paint)
        }

        override fun setAlpha(alpha: Int) {}
        override fun setColorFilter(colorFilter: android.graphics.ColorFilter?) {}
        override fun getOpacity(): Int = android.graphics.PixelFormat.TRANSLUCENT
    }

    // -- the drawn path -----------------------------------------------------
    //
    // A drawn row is ONE view, so there is no view to scale and no foreground
    // to attach: the plane keeps three numbers per key and calls [level] from
    // onDraw. Same curve, same clamps, same pressed state as the animators
    // above — a row drawn on the fast path and the same row drawn as Buttons
    // must not feel different.

    /**
     * How pressed a drawn key is right now, 0 to 1.
     *
     * [downAt] non-zero means the finger is still on it: the level eases up
     * to 1 over `ms` and stays. [upAt] non-zero means it has gone: the level
     * falls from [from] — where it had got to at the lift — to 0 over the
     * same `ms`. Both zero is a key at rest.
     *
     * Returns 0 for a key that has finished settling, so the caller can stop
     * asking for frames.
     */
    fun level(spec: Spec?, downAt: Long, upAt: Long, from: Float, now: Long): Float {
        if (spec == null) return 0f
        val ms = spec.ms.coerceAtLeast(1L)
        if (downAt > 0L) {
            // A glow is full at once, as on iPhone: a wash that arrives late
            // reads as lag, and the letter is already in the field.
            if (spec.isGlow) return 1f
            val t = (now - downAt).toFloat() / ms
            return if (t >= 1f) 1f else ease(spec, t)
        }
        if (upAt > 0L) {
            val t = (now - upAt).toFloat() / ms
            if (t >= 1f) return 0f
            return from * (1f - ease(spec, t))
        }
        return 0f
    }

    /** True while [level] still has frames to give: the plane uses this to
     *  decide whether to ask for another. A held key is steady at 1 and needs
     *  no more frames once it is there. */
    fun moving(spec: Spec?, downAt: Long, upAt: Long, now: Long): Boolean {
        if (spec == null) return false
        val ms = spec.ms.coerceAtLeast(1L)
        if (downAt > 0L) return !spec.isGlow && now - downAt < ms
        if (upAt > 0L) return now - upAt < ms
        return false
    }

    /**
     * Where a popped key is painted: [src] grown about its centre and lifted,
     * written into [out]. [k] is the level from [level]; 0 and a null spec
     * leave the rect alone. The HIT rect is never this one.
     */
    fun popRect(spec: Spec?, src: RectF, out: RectF, k: Float) {
        out.set(src)
        if (spec == null || !spec.isPop || k <= 0f) return
        val s = 1f + (spec.scale - 1f) * k
        val dx = src.width() * (s - 1f) / 2f
        val dy = src.height() * (s - 1f) / 2f
        out.set(src.left - dx, src.top - dy, src.right + dx, src.bottom + dy)
        out.offset(0f, spec.dyPx * k)
    }

    /** The glow wash over a drawn key, or 0 when there is none this frame. */
    fun glowColor(spec: Spec?, k: Float): Int {
        if (spec == null || !spec.isGlow || k <= 0f) return 0
        val a = (Color.alpha(spec.color) * k.coerceIn(0f, 1f)).toInt().coerceIn(0, 255)
        return if (a == 0) 0 else Color.argb(a, Color.red(spec.color), Color.green(spec.color), Color.blue(spec.color))
    }
}
