package com.tulmi.app.keyboard

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.BlurMaskFilter
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.widget.LinearLayout
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/**
 * A row of keys that owns its own touch, instead of leaving each key to Android's
 * per-view dispatch. The Android half of iOS's KeyPlaneView.
 *
 * Android's default is: a Button gets the touch that lands inside its own bounds,
 * and nothing else. Three things follow from that, and all three are felt.
 *
 *   DEAD ZONES. The margin between two keys belongs to neither, so a tap there
 *   does nothing at all. On a phone keyboard those margins are a real fraction
 *   of the surface, and every tap that lands in one is a character the user
 *   meant to type and did not get. `fillGaps` gives every point in the row to
 *   its nearest key, so there is nowhere left to miss.
 *
 *   TWITCH RETARGETING. A finger that rolls a millimetre while pressing crosses
 *   into the neighbour and types that instead. `holdMultiplier` grows the owned
 *   key's rect once it is owned, so a small drift stays on the key you pressed
 *   and only a deliberate move to another key retargets.
 *
 *   CANCELLED TAPS. A scroll container, a system gesture, or the IME itself can
 *   cancel a touch that the user experienced as a completed tap. Android drops
 *   it. `cancelCommit` keeps the ones that were short and barely moved — those
 *   were taps, whatever the framework decided.
 *
 * Multi-touch is press-order: each pointer owns its own key, and fast typing
 * where the next key goes down before the last comes up commits both, in the
 * order they were pressed (`rolloverCommit`).
 *
 * The plane does NOT reimplement what a key does. It resolves which key a touch
 * belongs to and when it fires, then calls performClick() — so every listener
 * the renderer already attached keeps working untouched.
 *
 * Anything whose gesture is not a tap — a suggestion strip that scrolls, the
 * personality row, a key that repeats while held — is left to handle its own
 * touch, because the plane would break it. See isKey().
 *
 * THE GRID. One more plane sits over the whole keyboard (`gridMode`), and it
 * is the one that decides where a finger lands. A row cannot: rows are
 * separate views, and the 10pt band between two of them belongs to neither,
 * so a thumb that lands there types nothing however generous each row is
 * inside its own bounds. The grid measures every key of every row, clusters
 * them into rows, grows each into an ownership box (vSlop above and below,
 * more for the top and bottom rows, out to the screen edge for the outermost
 * keys) and resolves a touch to the nearest key it falls in. Anything
 * interactive that is not a letter — the mic, the tone pill, the suggestion
 * chips, the face of space and backspace — vetoes it, so a touch there falls
 * through to that control and its own gestures. That is iOS's KeyPlaneView,
 * the same geometry and the same knobs (kb.touch.*, kb.keyPlane.*), resolving
 * into the rows below it: the rows still paint the keys and run what they do.
 */
class TulmiKeyPlane(context: Context) : LinearLayout(context) {

    /** kb.keyPlane.enabled — off restores stock per-view dispatch exactly. */
    var planeEnabled: Boolean = true

    /**
     * Swallow every touch and act on none of them.
     *
     * Set while the mic is recording. The keys are blurred to say "not now",
     * and this is what makes that true rather than decorative — without it a
     * stray thumb mid-utterance types a character into the very text the
     * refine pass is about to rewrite.
     *
     * Intercepting rather than disabling: a disabled ViewGroup still lets its
     * children take touches, and the row must eat the gesture whole. The grid
     * instead declines every touch, so it falls to the locked rows below.
     */
    var locked: Boolean = false

    /** kb.touch.fillGaps (the grid) / kb.row.expandHitTargets (a row) — give
     *  the margins between keys to the nearest key. */
    var fillGaps: Boolean = true

    /** kb.touch.holdMultiplier — how far a finger may drift off the pressed key
     *  before another one can take it. 1.0 disables the slack. */
    var holdMultiplier: Float = 1.35f

    /** kb.touch.cancelCommit.maxMs / .maxDriftPt (the grid), kb.key.cancelMs
     *  (a row) — a cancelled touch this short and this still was a tap; commit
     *  it rather than losing the character. */
    var cancelCommitMaxMs: Long = 300L
    var cancelCommitMaxDriftPx: Float = 12f * context.resources.displayMetrics.density

    /**
     * kb.key.liftSlop — for a row's keys, which fire on lift like iOS's lift
     * keys: a cancelled tap is rescued only when the finger was still within
     * this far of the key. Negative keeps the drift-from-down rule above.
     */
    var liftSlopPx: Float = -1f

    /**
     * kb.key.hitSlop.x / .y — how far past its bounds a key still takes a
     * touch. In a row it decides a press in the band around a key before the
     * gap filling does; on the grid it is the halo a control keeps around it
     * (clipped to its own row), and the reach of shift and the layer keys.
     */
    var hitSlopXPx: Float = 2f * context.resources.displayMetrics.density
    var hitSlopYPx: Float = 8f * context.resources.displayMetrics.density

    /**
     * kb.keyPlane.rolloverCommit (the grid) / kb.key.liftRollover (a row) —
     * a key going down anywhere types every key still held and not yet typed,
     * first. Committing at each finger's own lift inverted overlapping pairs
     * ("teh" for "the", "hellow orld"), which is exactly how fast typists
     * overlap.
     */
    var rolloverCommit: Boolean = false

    /**
     * Any plane on the keyboard claimed a finger. The renderer answers by
     * flushing every OTHER plane's held keys, so press order holds across
     * rows and across the grid.
     */
    var onClaim: ((TulmiKeyPlane) -> Unit)? = null

    /**
     * kb.keyPlane.commitOnDown — on the grid, a character is typed when the
     * finger LANDS. The highlight and the haptic fire on contact; waiting for
     * the lift put the user's own 60-120 ms press between a key lighting up
     * and its letter appearing. A key with an accent tray still gets its
     * hold: the tray takes the typed letter back (Gestures.retract) and the
     * release decides again.
     */
    var commitOnDown: Boolean = false

    /** Fired just before a key's own listener runs, for anything that wants to
     *  observe commits centrally. Left unset by default — feedback and counting
     *  belong with the key, not with the resolver. */
    var onKeyCommitted: ((View) -> Unit)? = null

    /** kb.swipe.enabled — trace a word across the keys instead of tapping it. */
    var swipeEnabled: Boolean = false
        set(v) { field = v; if (v) setWillNotDraw(false) }

    /** How far a finger must travel before the gesture stops being a press and
     *  becomes a trace. Below this, a slightly sloppy tap is still a tap. */
    var swipeMinTravelPx: Float = 44f * context.resources.displayMetrics.density

    /**
     * A completed trace, as the keys it crossed and the keys it TURNED on
     * (see pivotLabels). Fired instead of a key commit — a swipe types a
     * word, not the letter it happened to end on.
     */
    var onSwipe: ((List<String>, List<String>) -> Unit)? = null

    /**
     * What a key does beyond a tap, answered by the renderer. The plane times
     * the hold and routes the finger; the renderer decides what it means and
     * draws it. Every method has a do-nothing default, so a plane without
     * gestures behaves exactly as it did.
     */
    interface Gestures {
        /**
         * The key under the one finger that is down, for the pop-up above it.
         * `owner` null means hide it: no finger, two fingers, or a finger that
         * is holding a tray or driving the trackpad. `rect` is what is painted,
         * in plane coordinates.
         */
        fun focus(plane: TulmiKeyPlane, owner: Any?, label: String?, rect: RectF?) {}

        /** The alternates behind this key, base first, or null for none. */
        fun accentsFor(owner: Any, label: String?): List<String>? = null

        /** Show the tray for a held key. False leaves the key as a plain hold. */
        fun trayOpen(plane: TulmiKeyPlane, owner: Any, items: List<String>, rect: RectF): Boolean = false

        /** The finger moved while its tray is open (plane coordinates). */
        fun trayMove(plane: TulmiKeyPlane, x: Float, y: Float) {}

        /**
         * The finger lifted (or was cancelled) with the tray open. The renderer
         * types a chosen alternate itself; true asks the plane to fire the key
         * as a normal tap, for the base chip or a lift back on the key.
         */
        fun trayRelease(plane: TulmiKeyPlane, x: Float, y: Float, onKey: Boolean, cancelled: Boolean): Boolean = false

        /** Is this the key a hold turns into a trackpad (the space bar)? */
        fun isTrackpad(owner: Any): Boolean = false
        fun trackpadStart(plane: TulmiKeyPlane) {}
        /** Horizontal travel since the trackpad started, in px. */
        fun trackpadMove(plane: TulmiKeyPlane, dx: Float) {}
        fun trackpadEnd(plane: TulmiKeyPlane) {}

        /**
         * A key typed on contact is being held for its tray: take back what it
         * typed, so the release can choose. False when it can no longer be
         * taken back (something else was typed since) — no tray then.
         */
        fun retract(owner: Any, label: String?): Boolean = false

        /** The tray did not open after all: type the retracted char again. */
        fun restoreRetracted() {}

        /** kb.touch.lmBias — the letters likely to come next, lowercase. */
        fun likelyNext(): String = ""

        /** The layer showing now, so a layer-peek can come back to it. */
        fun layoutId(): String? = null

        /** A layer-peek slide typed its key: go back to where it began. */
        fun peekReturn(layout: String) {}
    }

    var gestures: Gestures? = null

    /** kb.accentTray.longPressMs — hold before a key's alternates open. */
    var trayHoldMs: Long = 500L

    /** kb.trackpad.longPressMs — hold on space before it becomes a trackpad. */
    var trackpadHoldMs: Long = 300L

    /** kb.longPress.ms — hold before a key's own onLongPress fires, when the
     *  key does not name its own (shift does, from kb.shift.longPressMs). */
    var longPressMs: Long = LONG_PRESS_MS

    /**
     * kb.accentTray.cancelDriftPt — a finger that wanders this far before its
     * hold fires is rolling to the next key, not holding this one.
     */
    var holdCancelDriftPx: Float = 12f * context.resources.displayMetrics.density

    // The trace, as the primary pointer walks it. Only one finger traces; a
    // second pointer during a swipe is ignored rather than starting a race.
    private var tracing = false
    private var traceTravel = 0f
    private var lastTraceX = 0f
    private var lastTraceY = 0f
    private val traced = ArrayList<Any>(12)

    // ---------------------------------------------------------------- drawn
    //
    // DRAWN MODE. The plane can own its keys as GEOMETRY instead of as child
    // views: one View for a whole row, keys painted straight onto its canvas.
    //
    // The view-per-key model is what separates us from the system keyboards.
    // Android's own IME does not build a Button per letter — it draws them all
    // into one surface — because 30-odd views mean 30 measure/layout passes and
    // 30 TextViews shaping text on every change. That cost lands exactly while
    // a finger is down.
    //
    // Touch is NOT reimplemented here. The state machine below is owner-
    // agnostic: an owner is a child View in view mode and a DrawnKey in drawn
    // mode, and rectOf/pressOwner/commitOwner are the only places that care.
    // One implementation, so gap-fill, drift tolerance, rollover and
    // cancel-commit cannot drift apart between the two.

    /**
     * One key the plane paints itself.
     *
     * `flex` and `fixedWidthPx` mirror what LinearLayout was doing: a flex key
     * shares the leftover width, a fixed key takes exactly its own. A spacer
     * occupies width and is never drawn, hit, or committed.
     */
    class DrawnKey(
        /** var: the fast-shift path re-labels letters in place, no rebuild. */
        var label: String,
        val flex: Float = 1f,
        val fixedWidthPx: Float = 0f,
        val fill: Int = 0,
        var textColor: Int = 0,
        val textSizePx: Float = 0f,
        val radiusPx: Float = 0f,
        val isSpacer: Boolean = false,
        /** Drawn instead of the label when set — shift, backspace, globe. */
        val glyph: ((Canvas, RectF, Paint) -> Unit)? = null,
        val onCommit: () -> Unit = {},
        val onLongPress: (() -> Unit)? = null,
        /** Finger down / finger gone. Backspace uses this pair to run its
         *  repeat-while-held; a plain letter leaves both unset. */
        val onPressStart: (() -> Unit)? = null,
        val onPressEnd: (() -> Unit)? = null,
        /** Hold before [onLongPress] fires; 0 = the plane's default. Shift
         *  sets it from kb.shift.longPressMs. */
        val longPressMs: Long = 0L,
        /** This key's own press colour (its style.pressedBg); 0 = the row's. */
        val pressedFill: Int = 0,
        /** kb.key.commitOnDown — types when the finger lands, in a row. */
        val downCommit: Boolean = false,
    ) {
        /** Filled in by the plane at layout time. */
        val rect = RectF()

        /** Set by a key that already acted while held — a backspace whose
         *  repeat has fired must not delete once more on release. */
        var suppressCommit = false

        /** The press colour fading back out (kb.press.fadeMs): where it began
         *  and when. 0 = not fading. */
        internal var fadeFrom = 0
        internal var fadeAt = 0L
    }

    /** Non-empty puts the plane in drawn mode. */
    private var drawnKeys: List<DrawnKey> = emptyList()

    /** Scratch for the painted (inset) rect. Reused because onDraw runs on
     *  every press and allocating there is how a keyboard starts stuttering. */
    private val painted = android.graphics.RectF()
    private var pressedKey: DrawnKey? = null
    private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textAlign = Paint.Align.CENTER
    }

    /** Colour a key flashes on press (theme.keyPressed). */
    var pressedFill: Int = 0

    /**
     * kb.press.fadeMs — the press colour eases back out over this long when
     * the finger leaves, as on iOS; the press itself is instant. 0 snaps.
     */
    var pressFadeMs: Long = 0L

    /** A built key's own press colour (its style.pressedBg), over the row's. */
    private val pressedOverride = java.util.WeakHashMap<View, Int>()

    fun setPressedColor(v: View, color: Int) { pressedOverride[v] = color }

    /**
     * kb.touch.vInsetPx — paint each key this far inside its row, top and
     * bottom, while its TOUCH rect keeps the row's full height.
     *
     * The gutter between two rows belongs to neither of them: a row is its own
     * view, Android delivers a touch to the view whose bounds contain it, and
     * the 9-11pt band between rows is inside no row. That is the same
     * structural dead zone iOS had, and it cannot be fixed from inside a row
     * that does not extend into it.
     *
     * It CAN be fixed by moving the gap: make the rows flush and taller by the
     * gap, then inset what is PAINTED by the same amount. The keyboard looks
     * identical, every point on it belongs to a key, and the change is two
     * numbers in the backend's keyboard tree — no rebuild to try it, and no
     * rebuild to undo it.
     *
     * Default 0, so this ships doing nothing until those numbers are set.
     */
    var drawnVInsetPx: Float = 0f
        set(v) { field = v; invalidate() }

    /** Horizontal gap between keys, in px — the row's `gap` style. */
    var drawnGapPx: Float = 0f

    /**
     * Hand the plane a row of keys to paint. Replaces any child views: the two
     * modes are exclusive, because a row is either drawn or built, never both.
     */
    fun setDrawnKeys(keys: List<DrawnKey>) {
        if (childCount > 0) removeAllViews()
        drawnKeys = keys
        pressedKey = null
        setWillNotDraw(keys.isEmpty() && !swipeEnabled)
        requestLayout()
        invalidate()
    }

    /**
     * The grid is exactly as big as the keyboard beneath it. It is added last,
     * so its siblings were measured earlier in this same pass and their size
     * is current; sized from them, it can never make the keyboard taller.
     * (MATCH_PARENT would not do: a wrap-content frame with one match-parent
     * child measures that child against the frame's spec, not its result.)
     */
    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        if (!gridMode) { super.onMeasure(widthMeasureSpec, heightMeasureSpec); return }
        var w = 0
        var h = 0
        val p = parent as? ViewGroup
        if (p != null) {
            for (i in 0 until p.childCount) {
                val c = p.getChildAt(i)
                if (c === this || c.visibility == GONE) continue
                w = max(w, c.measuredWidth)
                h = max(h, c.measuredHeight)
            }
        }
        setMeasuredDimension(resolveSize(w, widthMeasureSpec), resolveSize(h, heightMeasureSpec))
    }

    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
        if (drawnKeys.isEmpty()) { super.onLayout(changed, l, t, r, b); return }
        layoutDrawnKeys((r - l).toFloat(), (b - t).toFloat())
    }

    /** Same width split LinearLayout performed, done once per layout. */
    private fun layoutDrawnKeys(w: Float, h: Float) {
        if (drawnKeys.isEmpty() || w <= 0f) return
        val gaps = drawnGapPx * (drawnKeys.size - 1).coerceAtLeast(0)
        var fixed = 0f
        var flexTotal = 0f
        for (k in drawnKeys) {
            if (k.fixedWidthPx > 0f) fixed += k.fixedWidthPx else flexTotal += k.flex
        }
        val free = (w - gaps - fixed).coerceAtLeast(0f)
        val unit = if (flexTotal > 0f) free / flexTotal else 0f
        var x = 0f
        for (k in drawnKeys) {
            val kw = if (k.fixedWidthPx > 0f) k.fixedWidthPx else unit * k.flex
            k.rect.set(x, 0f, x + kw, h)
            x += kw + drawnGapPx
        }
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (drawnKeys.isEmpty()) return
        var fading = false
        val now = SystemClock.uptimeMillis()
        for (k in drawnKeys) {
            if (k.isSpacer || k.rect.width() <= 0f) continue
            // PAINT inset, HIT rect untouched. k.rect stays the row's full
            // height so every point still belongs to a key; only the pixels
            // move inward, which is what lets the gap between rows be owned by
            // the rows instead of by nobody.
            val paintRect = if (drawnVInsetPx > 0f) {
                painted.set(k.rect.left, k.rect.top + drawnVInsetPx,
                            k.rect.right, k.rect.bottom - drawnVInsetPx)
                painted
            } else k.rect
            if (shadowOn) {
                paintShadow(canvas, paintRect.left, paintRect.top, paintRect.right, paintRect.bottom,
                    k.radiusPx, Color.alpha(k.fill))
            }
            val press = if (k.pressedFill != 0) k.pressedFill else pressedFill
            fillPaint.color = when {
                k === pressedKey && press != 0 -> press
                k.fadeAt > 0L -> {
                    val t = (now - k.fadeAt).toFloat() / pressFadeMs.coerceAtLeast(1L)
                    if (t >= 1f) { k.fadeAt = 0L; k.fill } else { fading = true; blend(k.fadeFrom, k.fill, easeOut(t)) }
                }
                else -> k.fill
            }
            canvas.drawRoundRect(paintRect, k.radiusPx, k.radiusPx, fillPaint)
            val g = k.glyph
            if (g != null) {
                g(canvas, paintRect, textPaint)
                continue
            }
            if (k.label.isEmpty()) continue
            textPaint.color = k.textColor
            textPaint.textSize = k.textSizePx
            // Centre on the text's own metrics, not on the font's line box —
            // otherwise descenders push every glyph visibly high in the key.
            val fm = textPaint.fontMetrics
            val baseline = paintRect.centerY() - (fm.ascent + fm.descent) / 2f
            canvas.drawText(k.label, paintRect.centerX(), baseline, textPaint)
        }
        if (fading) postInvalidateOnAnimation()
    }

    override fun dispatchDraw(canvas: Canvas) {
        // The sheet's display pass (kb.keyPlane.sheet): bring the geometry up
        // to date here, where the tree has settled and no finger is waiting.
        if (gridMode && sheet) ensureFrames()
        // Built keys cast their shadow before they are drawn, so it sits under
        // them and shows through a translucent key the way iOS's does.
        if (shadowOn && shadowed.isNotEmpty()) {
            for (i in 0 until childCount) {
                val c = getChildAt(i)
                if (c.visibility != VISIBLE) continue
                val s = shadowed[c] ?: continue
                paintShadow(canvas, c.left.toFloat(), c.top.toFloat(), c.right.toFloat(), c.bottom.toFloat(),
                    s[0], (s[1] * c.alpha).toInt())
            }
        }
        super.dispatchDraw(canvas)
        drawTrail(canvas)
    }

    // --------------------------------------------------------------- shadow
    //
    // theme.keyShadow + kb.key.shadow.*: the hairline under every key that
    // gives the iOS keyboard its depth. A layer shadow there, a rounded rect
    // painted by the row here — offset, blurred by its radius, and faded by
    // the key's own alpha, because a translucent key casts a lighter shadow.
    // Painted by the parent so no key's background has to change shape: the
    // press tint, the radius pass and the flash all keep their drawable.

    private var shadowOn = false
    private var shadowRgb = Color.BLACK
    private var shadowOpacity = 0f
    private var shadowDy = 0f
    private val shadowPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val shadowRect = RectF()
    private val shadowed = java.util.WeakHashMap<View, FloatArray>()

    fun setKeyShadow(color: Int, opacity: Float, offsetYPx: Float, radiusPx: Float) {
        shadowRgb = color
        shadowOpacity = opacity.coerceIn(0f, 1f)
        shadowDy = offsetYPx
        shadowOn = shadowOpacity > 0f && Color.alpha(color) > 0
        shadowPaint.maskFilter = if (radiusPx > 0f) BlurMaskFilter(radiusPx, BlurMaskFilter.Blur.NORMAL) else null
        invalidate()
    }

    /** A built key that casts the shadow: its corner radius and fill alpha. */
    fun addShadow(v: View, cornerRadiusPx: Float, fillAlpha: Int) {
        shadowed[v] = floatArrayOf(cornerRadiusPx, fillAlpha.toFloat())
    }

    private fun paintShadow(canvas: Canvas, l: Float, t: Float, r: Float, b: Float, corner: Float, fillAlpha: Int) {
        val a = (Color.alpha(shadowRgb) * shadowOpacity * fillAlpha.coerceIn(0, 255) / 255f).toInt().coerceIn(0, 255)
        if (a == 0) return
        shadowPaint.color = (shadowRgb and 0x00FFFFFF) or (a shl 24)
        shadowRect.set(l, t + shadowDy, r, b + shadowDy)
        canvas.drawRoundRect(shadowRect, corner, corner, shadowPaint)
    }

    // ---------------------------------------------------------------- trail
    //
    // kb.swipe.trail.* — the ink a swipe leaves behind, as on iOS: the last
    // trail.maxPoints points of the path, trail.width wide, fading over
    // trail.fadeMs once the finger lifts. Drawn from a reused Path; a move
    // costs one lineTo per point and no allocation.

    var trailColor: Int = Color.argb(0xD9, 0xFF, 0xFF, 0xFF)
    var trailWidthPx: Float = 7f * context.resources.displayMetrics.density
    var trailFadeMs: Long = 260L
    var trailMaxPoints: Int = 40

    /** kb.swipe.pathCap / pathTrim — the path is trimmed by pathTrim points
     *  whenever it would grow past pathCap, so a long jittery hold cannot grow
     *  memory. */
    var swipePathCap: Int = 128
        set(v) {
            val c = v.coerceAtLeast(8)
            if (c != field) { field = c; pathXY = FloatArray(c * 2); pathCount = 0 }
        }
    var swipePathTrim: Int = 64

    /** kb.swipe.pivot.* — the corner detector in pivotLabels(). */
    var pivotWindow: Int = 3
    var pivotMinTravelPx: Float = 8f * context.resources.displayMetrics.density
    var pivotMaxCos: Float = 0.57f

    private var pathXY = FloatArray(swipePathCap * 2)
    private var pathCount = 0
    private val trailPath = Path()
    private val trailPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    /** When the lifted trail began to fade; 0 = not fading. */
    private var trailFadeAt = 0L

    private fun resetPath() {
        pathCount = 0
        trailFadeAt = 0L
    }

    private fun addPathPoint(x: Float, y: Float) {
        if (pathCount >= swipePathCap) {
            val drop = swipePathTrim.coerceIn(1, pathCount)
            System.arraycopy(pathXY, drop * 2, pathXY, 0, (pathCount - drop) * 2)
            pathCount -= drop
        }
        pathXY[pathCount * 2] = x
        pathXY[pathCount * 2 + 1] = y
        pathCount++
    }

    private fun drawTrail(canvas: Canvas) {
        if (pathCount < 2 || !(tracing || trailFadeAt > 0L)) return
        var k = 1f
        if (!tracing) {
            val t = (SystemClock.uptimeMillis() - trailFadeAt).toFloat() / trailFadeMs.coerceAtLeast(1L)
            if (t >= 1f) { trailFadeAt = 0L; pathCount = 0; return }
            k = 1f - t
            postInvalidateOnAnimation()
        }
        val start = max(0, pathCount - max(2, trailMaxPoints))
        trailPath.rewind()
        trailPath.moveTo(pathXY[start * 2], pathXY[start * 2 + 1])
        for (i in start + 1 until pathCount) trailPath.lineTo(pathXY[i * 2], pathXY[i * 2 + 1])
        trailPaint.color = trailColor
        trailPaint.alpha = (Color.alpha(trailColor) * k).toInt().coerceIn(0, 255)
        trailPaint.strokeWidth = trailWidthPx
        canvas.drawPath(trailPath, trailPaint)
    }

    /**
     * The keys the finger actually TURNED on.
     *
     * A swipe crosses many keys incidentally, but it changes direction at the
     * letters that matter — the strongest signal in swipe decoding. Walk the
     * path with a lookaround window, measure the turn between the incoming
     * and outgoing direction, and treat a sharp one as a deliberate stop.
     * Endpoints always count: a word starts and ends where the finger did.
     */
    private fun pivotLabels(): List<String> {
        val n = pathCount
        if (n < 2) return emptyList()
        val window = pivotWindow.coerceAtLeast(1)
        val at = ArrayList<Int>()
        at += 0
        var i = window
        while (i < n - window) {
            val x = pathXY[i * 2]; val y = pathXY[i * 2 + 1]
            val v1x = x - pathXY[(i - window) * 2]; val v1y = y - pathXY[(i - window) * 2 + 1]
            val v2x = pathXY[(i + window) * 2] - x; val v2y = pathXY[(i + window) * 2 + 1] - y
            val m1 = hypot(v1x, v1y); val m2 = hypot(v2x, v2y)
            // Jitter is not a turn: both sides must actually have travelled.
            if (m1 > pivotMinTravelPx && m2 > pivotMinTravelPx) {
                if ((v1x * v2x + v1y * v2y) / (m1 * m2) < pivotMaxCos) {
                    at += i
                    i += window   // one corner, not a cluster of adjacent samples
                }
            }
            i += 1
        }
        at += n - 1
        val out = ArrayList<String>()
        for (p in at) {
            val o = keyAt(pathXY[p * 2], pathXY[p * 2 + 1]) ?: continue
            val l = labelOf(o)?.lowercase() ?: continue
            if (l.length != 1) continue
            if (out.lastOrNull() != l) out += l
        }
        return out
    }

    // Per-pointer state. Small arrays rather than maps — this is the touch path
    // and at most a few fingers are ever down.
    //
    // `owners` is Any? so one state machine drives every mode: the entry is a
    // child View when the row was built, a DrawnKey when it was painted, and a
    // GridKey on the grid.
    private val pointerIds = IntArray(MAX_POINTERS) { -1 }
    private val owners = arrayOfNulls<Any>(MAX_POINTERS)
    private val downX = FloatArray(MAX_POINTERS)
    private val downY = FloatArray(MAX_POINTERS)
    private val downAt = LongArray(MAX_POINTERS)
    /** What each finger is doing: typing a key, holding a tray, or steering. */
    private val modes = IntArray(MAX_POINTERS)
    /** Where the finger was when the trackpad took over. */
    private val modeAnchorX = FloatArray(MAX_POINTERS)
    private val lastX = FloatArray(MAX_POINTERS)
    private val lastY = FloatArray(MAX_POINTERS)
    /** Already typed — on contact or by rollover. The lift types nothing. */
    private val committed = BooleanArray(MAX_POINTERS)
    /** Typed on contact: an accent tray may still take it back. */
    private val downCommitted = BooleanArray(MAX_POINTERS)
    /** The finger began on shift or a layer key (grid only). */
    private val roles = IntArray(MAX_POINTERS)
    /** Where a layer-peek goes back to once its slide has typed. */
    private val peekBack = arrayOfNulls<String>(MAX_POINTERS)
    /** A control under a later finger on the grid; tapped on lift. */
    private val passViews = arrayOfNulls<View>(MAX_POINTERS)

    private val hitRect = Rect()
    private val focusRect = RectF()

    /** Does any finger hold a tray or the trackpad? New fingers wait. */
    private fun anyHeldMode(): Boolean {
        for (i in 0 until MAX_POINTERS) {
            if (pointerIds[i] != -1 && (modes[i] == MODE_TRAY || modes[i] == MODE_TRACKPAD)) return true
        }
        return false
    }

    /**
     * Tell the renderer which key the pop-up belongs over. Only a lone finger
     * on a plain key gets one: two fingers would fight over it, and a tray or
     * the trackpad replaces it.
     */
    private fun updateFocus() {
        val g = gestures ?: return
        var fingers = 0
        var slot = -1
        for (i in 0 until MAX_POINTERS) if (pointerIds[i] != -1) { fingers++; slot = i }
        val o = if (slot >= 0) owners[slot] else null
        if (fingers != 1 || o == null || modes[slot] != MODE_KEY || tracing || !paintedRect(o, focusRect)) {
            g.focus(this, null, null, null)
            return
        }
        g.focus(this, unwrap(o), labelOf(o), focusRect)
    }

    /** Leave a held mode: the tray or the trackpad lets go of the finger. */
    private fun endMode(slot: Int, x: Float, y: Float, cancelled: Boolean): Boolean {
        val g = gestures
        val o = owners[slot]
        return when (modes[slot]) {
            MODE_TRAY -> {
                modes[slot] = MODE_KEY
                val onKey = o != null && within(o, x, y, holdMultiplier)
                g?.trayRelease(this, x, y, onKey, cancelled) == true
            }
            MODE_TRACKPAD -> {
                modes[slot] = MODE_KEY
                g?.trackpadEnd(this)
                false
            }
            else -> false
        }
    }

    init {
        orientation = HORIZONTAL
        isMotionEventSplittingEnabled = false   // the plane splits pointers itself
    }

    /**
     * Take the gesture only when it starts on a key. A touch that begins on a
     * scrolling strip or a custom row belongs to that view.
     */
    override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
        if (gridMode) return false          // no children; onTouchEvent decides
        if (locked) return true
        if (!planeEnabled) return false
        if (ev.actionMasked != MotionEvent.ACTION_DOWN) return false
        return keyAt(ev.x, ev.y) != null
    }

    /**
     * kb.row.expandHitTargets with the plane off: a press that lands in the
     * gap between two keys, or in a key's hit slop, is handed to the nearest
     * key instead of to nobody — iOS's KeyRowStackView. Only the DOWN moves:
     * it lands inside the key, so the key owns the gesture, and the rest of it
     * arrives where the finger really is, well within the key's touch slop.
     */
    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (!gridMode && !planeEnabled && !locked && drawnKeys.isEmpty() &&
            ev.actionMasked == MotionEvent.ACTION_DOWN) {
            val k = gapTarget(ev.x, ev.y)
            if (k != null) {
                k.getHitRect(hitRect)
                val dx = ev.x.coerceIn(hitRect.left + 0.5f, hitRect.right - 0.5f) - ev.x
                val dy = hitRect.exactCenterY() - ev.y
                ev.offsetLocation(dx, dy)
                val handled = super.dispatchTouchEvent(ev)
                ev.offsetLocation(-dx, -dy)
                return handled
            }
        }
        return super.dispatchTouchEvent(ev)
    }

    /** The key a stock-dispatched press in a gap belongs to, or null when it
     *  already lands on a view (or nowhere the row should claim). */
    private fun gapTarget(x: Float, y: Float): View? {
        if (x < 0f || y < 0f || x >= width || y >= height) return null
        var nearest: View? = null
        var best = Float.MAX_VALUE
        for (i in 0 until childCount) {
            val c = getChildAt(i)
            if (c.visibility != VISIBLE) continue
            c.getHitRect(hitRect)
            if (hitRect.contains(x.toInt(), y.toInt())) return null
            if (!isKey(c) || !c.isEnabled) continue
            val dx = when {
                x < hitRect.left -> hitRect.left - x
                x > hitRect.right -> x - hitRect.right
                else -> 0f
            }
            val dy = when {
                y < hitRect.top -> hitRect.top - y
                y > hitRect.bottom -> y - hitRect.bottom
                else -> 0f
            }
            val inSlop = dx <= hitSlopXPx && dy <= hitSlopYPx
            if (!fillGaps && !inSlop) continue
            if (dx < best) { best = dx; nearest = c }
        }
        return nearest
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(ev: MotionEvent): Boolean {
        if (gridMode) {
            if (locked || !planeEnabled) {
                // Declined whole, so the locked rows below eat it; a finger
                // the grid already holds is let go without typing.
                if (ev.actionMasked == MotionEvent.ACTION_DOWN) return false
                if (ev.actionMasked == MotionEvent.ACTION_UP || ev.actionMasked == MotionEvent.ACTION_CANCEL) {
                    releaseAllSilently()
                }
                return true
            }
        } else {
            if (locked) return true          // consumed, and deliberately inert
            if (!planeEnabled) return super.onTouchEvent(ev)
        }

        when (ev.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> {
                val i = ev.actionIndex
                val x = ev.getX(i)
                val y = ev.getY(i)
                if (ev.actionMasked == MotionEvent.ACTION_DOWN) {
                    // A new gesture: no finger can still be down. Anything a
                    // swallowed lift left behind goes, without typing.
                    releaseAllSilently()
                    // Not the grid's: decline, and the control beneath takes it.
                    if (gridMode && !owns(x, y)) return false
                }
                // A finger already holding a tray or steering the trackpad
                // owns the moment; a second one landing is a brush, not a key.
                if (!anyHeldMode()) {
                    // A second finger means typing, not holding: the first
                    // key's tray or trackpad would open under a rolling hand.
                    if (armedHoldIsGesture) cancelArmedLongPress()
                    if (gridMode && ev.actionMasked == MotionEvent.ACTION_POINTER_DOWN && !owns(x, y)) {
                        claimOutside(ev.getPointerId(i), x, y)
                    } else {
                        claim(ev.getPointerId(i), x, y)
                    }
                }
                updateFocus()
                if (gridMode && sheet) invalidate()
            }

            MotionEvent.ACTION_MOVE -> {
                for (i in 0 until ev.pointerCount) {
                    val slot = slotOf(ev.getPointerId(i)) ?: continue
                    val x = ev.getX(i)
                    val y = ev.getY(i)
                    lastX[slot] = x
                    lastY[slot] = y
                    when (modes[slot]) {
                        MODE_TRAY -> { gestures?.trayMove(this, x, y); continue }
                        MODE_TRACKPAD -> { gestures?.trackpadMove(this, x - modeAnchorX[slot]); continue }
                        MODE_PASS -> continue
                    }
                    // Drifted off before the hold fired: the finger is rolling
                    // on, so no tray or trackpad opens under it.
                    if (armedHoldIsGesture && armedSlot == slot &&
                        hypot(x - downX[slot], y - downY[slot]) > holdCancelDriftPx) {
                        cancelArmedLongPress()
                    }
                    // Already typed. The only thing a moving finger can still
                    // decide is whether the hold was meant (above).
                    if (committed[slot]) continue
                    val held = owners[slot] ?: continue
                    // Stay on the pressed key while the finger is anywhere in
                    // its grown rect. Only a move that lands on ANOTHER key
                    // retargets — drifting into a gap keeps what you pressed.
                    if (swipeEnabled && slot == 0 && roles[slot] == ROLE_NONE) {
                        addPathPoint(x, y)
                        traceTravel += hypot(x - lastTraceX, y - lastTraceY)
                        lastTraceX = x
                        lastTraceY = y
                        if (!tracing && traceTravel >= swipeMinTravelPx && uncommittedFingers() == 1) {
                            // Long enough to be deliberate. Everything the
                            // finger has already crossed counts, starting with
                            // the key it pressed.
                            tracing = true
                            traced.clear()
                            traced.add(held)
                            cancelArmedLongPress()
                            updateFocus()
                        }
                    }
                    if (within(held, x, y, holdMultiplier)) continue
                    val next = keyAt(x, y) ?: continue
                    if (next === held) continue
                    setPressed(held, false)
                    pressEnd(held)
                    owners[slot] = next
                    setPressed(next, true)
                    pressStart(next)
                    cancelArmedLongPress()
                    // A trace records each NEW key it enters. Consecutive
                    // duplicates are dropped, so wobbling on one key does not
                    // double a letter — a real double letter comes from the
                    // dictionary, not from the path.
                    if (tracing && traced.lastOrNull() !== next) traced.add(next)
                    updateFocus()
                }
                if (tracing) invalidate()
            }

            MotionEvent.ACTION_UP, MotionEvent.ACTION_POINTER_UP -> {
                val i = ev.actionIndex
                val id = ev.getPointerId(i)
                val slot = slotOf(id)
                val x = ev.getX(i)
                val y = ev.getY(i)
                if (slot == null) { updateFocus(); return true }
                when {
                    modes[slot] == MODE_PASS -> {
                        // A later finger that landed on a control: its tap.
                        val v = passViews[slot]
                        releaseSilently(id)
                        if (v != null && v.isAttachedToWindow && nearView(v, x, y)) v.performClick()
                    }
                    modes[slot] != MODE_KEY -> {
                        // The tray or the trackpad had this finger; it decides.
                        cancelArmedLongPress()
                        val key = owners[slot]
                        val fire = endMode(slot, x, y, cancelled = false)
                        releaseSilently(id)
                        if (fire && key != null) commitOwner(key)
                    }
                    tracing && slot == 0 -> {
                        // A trace types a word, not the letter it ended on — so
                        // the key under the finger must NOT also commit.
                        val path = ArrayList(traced)
                        val pivots = pivotLabels()
                        endTrace(fade = true)
                        releaseSilently(id)
                        val letters = path.mapNotNull { labelOf(it) }
                            .filter { it.length == 1 }
                            .map { it.lowercase() }
                        if (letters.size >= 2) onSwipe?.invoke(letters, pivots)
                    }
                    roles[slot] != ROLE_NONE -> {
                        // Shift and the layer keys acted on contact. What the
                        // lift adds is the key the finger slid onto: a one-shot
                        // capital, or a layer-peek that goes back where it began.
                        cancelArmedLongPress()
                        val o = owners[slot]
                        val back = peekBack[slot]
                        val slid = o is GridKey && o.kind != KIND_SHIFT && o.kind != KIND_LAYER
                        releaseSilently(id)
                        if (slid && o != null) {
                            commitOwner(o)
                            if (back != null) gestures?.peekReturn(back)
                        }
                    }
                    committed[slot] -> { cancelArmedLongPress(); releaseSilently(id) }
                    else -> release(id, commit = true, x = x, y = y)
                }
                if (slot == 0 && pathCount > 0 && !tracing && trailFadeAt == 0L) pathCount = 0
                updateFocus()
                if (gridMode && sheet) invalidate()
            }

            MotionEvent.ACTION_CANCEL -> {
                // Everything still down was cancelled by something outside this
                // view. Rescue the ones that were taps.
                endTrace(fade = true)
                for (slot in 0 until MAX_POINTERS) {
                    val id = pointerIds[slot]
                    if (id == -1) continue
                    when {
                        modes[slot] == MODE_TRAY || modes[slot] == MODE_TRACKPAD -> {
                            // A tray or trackpad cut off mid-gesture types
                            // nothing — except a char typed on contact and taken
                            // back for the tray, which goes back where it was.
                            val wasTray = modes[slot] == MODE_TRAY
                            val key = owners[slot]
                            endMode(slot, lastX[slot], downY[slot], cancelled = true)
                            releaseSilently(id)
                            if (wasTray && downCommitted[slot] && key != null) commitOwner(key)
                        }
                        modes[slot] == MODE_PASS || roles[slot] != ROLE_NONE || committed[slot] ->
                            releaseSilently(id)
                        // Where the finger LAST was, not where it went down:
                        // a system back swipe that starts on an edge key has
                        // travelled far by the time it is cancelled, and must
                        // not be rescued as a tap on that key.
                        else -> release(id, commit = false, x = lastX[slot], y = lastY[slot])
                    }
                }
                cancelArmedLongPress()
                updateFocus()
            }
        }
        return true
    }

    /**
     * The row is leaving the screen (a rebuild) with fingers still on it: let
     * the tray, the trackpad and the pop-up go with it rather than leave them
     * floating over keys that no longer exist.
     */
    override fun onDetachedFromWindow() {
        cancelArmedLongPress()
        for (slot in 0 until MAX_POINTERS) {
            if (pointerIds[slot] == -1) continue
            if (modes[slot] == MODE_TRAY || modes[slot] == MODE_TRACKPAD) {
                endMode(slot, lastX[slot], downY[slot], cancelled = true)
            }
            clearSlot(slot)
        }
        endTrace(fade = false)
        gestures?.focus(this, null, null, null)
        if (layoutListenerOn) {
            layoutListenerOn = false
            try { viewTreeObserver.removeOnGlobalLayoutListener(layoutListener) } catch (_: Throwable) {}
        }
        super.onDetachedFromWindow()
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (gridMode) listenForLayout()
    }

    private fun clearSlot(slot: Int) {
        pointerIds[slot] = -1
        owners[slot] = null
        modes[slot] = MODE_KEY
        committed[slot] = false
        downCommitted[slot] = false
        roles[slot] = ROLE_NONE
        peekBack[slot] = null
        passViews[slot] = null
    }

    /** Drop a pointer's ownership without firing its key. */
    private fun releaseSilently(id: Int) {
        val slot = slotOf(id) ?: return
        owners[slot]?.let { setPressed(it, false); pressEnd(it) }
        clearSlot(slot)
    }

    private fun releaseAllSilently() {
        var any = false
        for (slot in 0 until MAX_POINTERS) {
            val id = pointerIds[slot]
            if (id == -1) continue
            any = true
            if (modes[slot] == MODE_TRAY || modes[slot] == MODE_TRACKPAD) {
                endMode(slot, lastX[slot], lastY[slot], cancelled = true)
            }
            releaseSilently(id)
        }
        if (any) { cancelArmedLongPress(); endTrace(fade = false); updateFocus() }
    }

    private fun endTrace(fade: Boolean) {
        if (tracing && fade && pathCount >= 2) {
            trailFadeAt = SystemClock.uptimeMillis()
            invalidate()
        } else if (!fade) {
            pathCount = 0
            trailFadeAt = 0L
        }
        tracing = false
        traceTravel = 0f
        traced.clear()
    }

    private fun claim(id: Int, x: Float, y: Float) {
        // Press order first: every key still held and not yet typed — here and
        // on every other plane — goes in before this one, then this one is
        // resolved against whatever that left on screen.
        flushHeld()
        onClaim?.invoke(this)
        var role = ROLE_NONE
        val key: Any? = if (gridMode) {
            val r = roleKeyAt(x, y)
            if (r != null) {
                role = if (r.kind == KIND_SHIFT) ROLE_SHIFT else ROLE_LAYER
                r
            } else {
                // A point the grid claimed must resolve to something: "is it
                // mine" is generous and "which key" is not, and where the two
                // disagree the touch is already the grid's (kb.touch.totalResolve).
                gridKeyAt(x, y) ?: if (totalResolve) nearestKey(x, y) else null
            }
        } else keyAt(x, y) ?: return
        takeSlot(id, x, y, key, role)
    }

    /**
     * A later finger lands where the grid would decline a first one. Every
     * pointer after the first is the grid's whatever it touches, so it is
     * resolved here: the face of space / return / backspace is that key, a
     * control is tapped on lift, anything else is ignored.
     */
    private fun claimOutside(id: Int, x: Float, y: Float) {
        flushHeld()
        onClaim?.invoke(this)
        for (f in frames) {
            if (f.kind != KIND_ACTION) continue
            paintedRect(f, scratchRect)
            if (scratchRect.contains(x, y)) { takeSlot(id, x, y, f, ROLE_NONE); return }
        }
        for (i in 0 until obstacleCount) {
            val v = obstacleOwner[i] ?: continue
            if (!obstacleRects[i].contains(x, y)) continue
            val slot = freeSlot() ?: return
            clearSlot(slot)
            pointerIds[slot] = id
            modes[slot] = MODE_PASS
            passViews[slot] = v
            downX[slot] = x; downY[slot] = y; lastX[slot] = x; lastY[slot] = y
            downAt[slot] = SystemClock.uptimeMillis()
            return
        }
    }

    private fun takeSlot(id: Int, x: Float, y: Float, key: Any?, role: Int) {
        val slot = freeSlot() ?: return
        clearSlot(slot)
        if (slot == 0) {
            traceTravel = 0f
            lastTraceX = x
            lastTraceY = y
            tracing = false
            resetPath()
            if (swipeEnabled && role == ROLE_NONE) addPathPoint(x, y)
        }
        pointerIds[slot] = id
        owners[slot] = key
        modes[slot] = MODE_KEY
        roles[slot] = role
        downX[slot] = x
        downY[slot] = y
        lastX[slot] = x
        lastY[slot] = y
        downAt[slot] = SystemClock.uptimeMillis()
        if (key == null) return
        setPressed(key, true)
        pressStart(key)
        when (role) {
            ROLE_SHIFT -> {
                // Shift arms on contact, like the system keyboard, and the same
                // finger may slide onto a letter for a one-shot capital. A hold
                // that never slid is caps lock (the key's own hold).
                commitOwner(key)
                armLongPress(key, slot, alone = activeFingers() == 1)
            }
            ROLE_LAYER -> {
                // Layer-peek: switch NOW. The tree rebuilds under this finger and
                // the grid, which stays, rebinds to it — so the same finger can
                // slide onto the new layer's keys. A plain tap stays switched.
                val g = gestures
                val from = g?.layoutId()
                commitOwner(key)
                val now = g?.layoutId()
                if (from != null && now != null && now != from) peekBack[slot] = from
            }
            else -> {
                if (downCommits(key)) {
                    committed[slot] = true
                    downCommitted[slot] = true
                    commitOwner(key)
                }
                armLongPress(key, slot, alone = activeFingers() == 1)
            }
        }
    }

    /** Does this key type on contact? A grid character with
     *  kb.keyPlane.commitOnDown; a row key the renderer marked
     *  (kb.key.commitOnDown). */
    private fun downCommits(o: Any): Boolean = when (o) {
        // A character whose hold means something of its own (a server
        // onLongPress) waits for the lift: typed on contact, the hold could
        // not take it back.
        is GridKey -> commitOnDown && o.kind == KIND_CHAR && o.char.isNotEmpty() && when (val t = o.target) {
            is DrawnKey -> t.onLongPress == null
            is View -> !o.row.viewHolds.containsKey(t)
            else -> true
        }
        is DrawnKey -> o.downCommit
        is View -> downCommitViews.containsKey(o)
        else -> false
    }

    private val downCommitViews = java.util.WeakHashMap<View, Boolean>()

    /** kb.key.commitOnDown: this built key types when the finger lands. */
    fun setCommitOnDown(v: View) { downCommitViews[v] = true }

    private fun activeFingers(): Int {
        var n = 0
        for (i in 0 until MAX_POINTERS) if (pointerIds[i] != -1) n++
        return n
    }

    private fun uncommittedFingers(): Int {
        var n = 0
        for (i in 0 until MAX_POINTERS) if (pointerIds[i] != -1 && !committed[i]) n++
        return n
    }

    /** Guards the flush against itself: committing a key runs its listener,
     *  and a listener that presses another key would flush again. */
    private var flushing = false

    /**
     * Another key is going down, here or on another plane. A pending tray or
     * trackpad hold is a rolling hand, not a hold; and with rollover on, every
     * key still held and not yet typed is typed now, in the order pressed.
     */
    fun otherKeyDown() {
        if (armedHoldIsGesture) cancelArmedLongPress()
        flushHeld()
    }

    private fun flushHeld() {
        if (!rolloverCommit || flushing) return
        flushing = true
        try {
            for (slot in 0 until MAX_POINTERS) {
                if (pointerIds[slot] == -1 || modes[slot] != MODE_KEY) continue
                if (committed[slot] || roles[slot] != ROLE_NONE) continue
                if (tracing && slot == 0) continue
                val o = owners[slot] ?: continue
                // MARKED BEFORE FIRING: the key's listener may press another
                // key, whose claim flushes again.
                committed[slot] = true
                if (armedSlot == slot) cancelArmedLongPress()
                setPressed(o, false)
                pressEnd(o)
                commitOwner(o)
            }
        } finally {
            flushing = false
        }
    }

    private fun release(id: Int, commit: Boolean, x: Float, y: Float) {
        cancelArmedLongPress()
        val slot = slotOf(id) ?: return
        val key = owners[slot]
        val heldMs = SystemClock.uptimeMillis() - downAt[slot]
        val drift = hypot(x - downX[slot], y - downY[slot])

        clearSlot(slot)
        if (key == null) return
        setPressed(key, false)
        pressEnd(key)

        // A normal lift always commits. A CANCEL commits only when the gesture
        // looked like a tap — short, and barely moved (for a row's lift keys:
        // short, and still on or near the key).
        val shouldCommit = commit || when {
            cancelCommitMaxMs <= 0L -> false
            liftSlopPx >= 0f -> heldMs < cancelCommitMaxMs && nearKey(key, x, y, liftSlopPx)
            else -> heldMs <= cancelCommitMaxMs && drift <= cancelCommitMaxDriftPx
        }
        if (!shouldCommit) return

        commitOwner(key)
    }

    /**
     * Fire a key. A built key runs its click listener; a drawn key its lambda;
     * a grid key the row that holds it.
     *
     * onKeyCommitted takes a View, so it is view-mode only. Nothing sets it —
     * feedback and counting belong with the key — and rather than invent a
     * View to pass, drawn mode simply doesn't have it.
     */
    private fun commitOwner(o: Any) {
        when (o) {
            is GridKey -> o.row.commitOwner(o.target)
            is DrawnKey -> {
                if (o.suppressCommit) { o.suppressCommit = false } else o.onCommit()
            }
            is View -> { onKeyCommitted?.invoke(o); o.performClick() }
        }
        if (gridMode && sheet) invalidate()
    }

    /** The owner's visible text, for the swipe trace. */
    private fun labelOf(o: Any): String? = when (o) {
        is GridKey -> o.row.labelOf(o.target)
        is DrawnKey -> o.label
        is android.widget.Button -> o.text?.toString()
        else -> null
    }

    /** What the renderer knows the key as: the row's View or DrawnKey. */
    private fun unwrap(o: Any): Any = if (o is GridKey) o.target else o

    private fun pressStart(o: Any) {
        val t = unwrap(o)
        if (t is DrawnKey) { t.suppressCommit = false; t.onPressStart?.invoke() }
    }

    private fun pressEnd(o: Any) {
        (unwrap(o) as? DrawnKey)?.onPressEnd?.invoke()
    }

    /**
     * Long-press for drawn keys.
     *
     * View mode never had this THROUGH the plane — the plane commits with
     * performClick(), which does not fire an OnLongClickListener — so a drawn
     * key that arms its own timer is strictly more capable, not a regression.
     */
    private val longPressHandler = Handler(Looper.getMainLooper())
    private var armedLongPress: Runnable? = null
    /** The finger the armed hold belongs to. */
    private var armedSlot = -1
    /** The armed hold opens a tray or the trackpad (not a key's own hold). */
    private var armedHoldIsGesture = false

    /**
     * Arm what holding this key does. A hold the key names itself (shift's
     * caps lock, the tone pill's sheet, a server onLongPress) comes first;
     * then a tray of alternates; then the trackpad, for space.
     */
    private fun armLongPress(o: Any, slot: Int, alone: Boolean) {
        val t = unwrap(o)
        val holdRow = if (o is GridKey) o.row else this
        val own: Pair<Long, () -> Unit>? = when (t) {
            is DrawnKey -> t.onLongPress?.let { (if (t.longPressMs > 0L) t.longPressMs else longPressMs) to it }
            is View -> holdRow.viewHolds[t]
            else -> null
        }
        // A key's own hold arms for the first finger, as it always has. A tray
        // or the trackpad only for a finger that lands alone: one landing while
        // another is down is part of a rolling hand, not a deliberate press.
        if (if (own != null) slot != 0 else !alone) return
        cancelArmedLongPress()
        val r: Runnable
        val delay: Long
        val g = gestures
        val accents = if (own == null && g != null) g.accentsFor(t, labelOf(o))?.takeIf { it.size > 1 } else null
        when {
            own != null -> {
                delay = own.first
                r = Runnable {
                    armedLongPress = null
                    // The key is consumed by the long-press: clear it so the lift
                    // that follows does not ALSO type the character.
                    for (i in 0 until MAX_POINTERS) if (owners[i] === o) owners[i] = null
                    setPressed(o, false)
                    updateFocus()
                    own.second()
                }
            }
            accents != null && g != null -> {
                delay = trayHoldMs
                r = Runnable {
                    armedLongPress = null
                    if (pointerIds[slot] == -1 || owners[slot] !== o || !paintedRect(o, focusRect)) return@Runnable
                    // Typed on contact: the tray offers alternatives to that
                    // char, so it is taken back first — and only while it is
                    // still the last thing typed.
                    val took = downCommitted[slot]
                    if (took && !g.retract(t, labelOf(o))) return@Runnable
                    // The take-back can return a one-shot shift, so the chips
                    // are cased from the key as it reads now (É, not é).
                    val items = if (took) g.accentsFor(t, labelOf(o))?.takeIf { it.size > 1 } ?: accents else accents
                    if (g.trayOpen(this, t, items, focusRect)) {
                        modes[slot] = MODE_TRAY
                        setPressed(o, false)
                        updateFocus()
                    } else if (took) {
                        g.restoreRetracted()
                    }
                }
            }
            g != null && g.isTrackpad(t) -> {
                delay = trackpadHoldMs
                r = Runnable {
                    armedLongPress = null
                    if (pointerIds[slot] == -1 || owners[slot] !== o || committed[slot]) return@Runnable
                    modes[slot] = MODE_TRACKPAD
                    modeAnchorX[slot] = lastX[slot]
                    // A trace that had begun on space is over: the finger steers.
                    if (slot == 0) endTrace(fade = false)
                    setPressed(o, false)
                    updateFocus()
                    g.trackpadStart(this)
                }
            }
            else -> return
        }
        armedLongPress = r
        armedSlot = slot
        armedHoldIsGesture = own == null
        longPressHandler.postDelayed(r, delay.coerceAtLeast(50L))
    }

    /**
     * Holds for BUILT keys. The plane commits a view key with performClick(),
     * which never fires an OnLongClickListener — so a key whose hold means
     * something (shift → caps lock, the tone pill → its sheet) registers it
     * here, and keeps everything else the plane gives it: gap filling, drift
     * tolerance, and rolling presses with the keys around it.
     */
    private val viewHolds = java.util.WeakHashMap<View, Pair<Long, () -> Unit>>()

    fun setHold(v: View, holdMs: Long, action: () -> Unit) {
        viewHolds[v] = holdMs.coerceAtLeast(50L) to action
    }

    private fun cancelArmedLongPress() {
        armedLongPress?.let { longPressHandler.removeCallbacks(it) }
        armedLongPress = null
        armedSlot = -1
        armedHoldIsGesture = false
    }

    /** The owner's rect in plane coordinates. */
    private fun rectOf(o: Any, out: Rect): Boolean = when (o) {
        is GridKey -> {
            out.set(o.rect.left.toInt(), o.rect.top.toInt(), o.rect.right.toInt(), o.rect.bottom.toInt())
            true
        }
        is DrawnKey -> {
            out.set(
                o.rect.left.toInt(), o.rect.top.toInt(),
                o.rect.right.toInt(), o.rect.bottom.toInt(),
            )
            true
        }
        is View -> { o.getHitRect(out); true }
        else -> false
    }

    /** What the owner PAINTS, in plane coordinates — for the pop-up and a
     *  tray, and for the veto of an action key. */
    private fun paintedRect(o: Any, out: RectF): Boolean {
        when (o) {
            is GridKey -> {
                out.set(o.rect)
                val inset = if (o.target is DrawnKey) o.row.drawnVInsetPx else 0f
                if (inset > 0f) { out.top += inset; out.bottom -= inset }
            }
            is DrawnKey -> {
                out.set(o.rect)
                if (drawnVInsetPx > 0f) { out.top += drawnVInsetPx; out.bottom -= drawnVInsetPx }
            }
            is View -> { o.getHitRect(hitRect); out.set(hitRect) }
            else -> return false
        }
        return true
    }

    /**
     * Which key owns this point.
     *
     * On the grid, the grid's resolver (gridKeyAt). In a row: inside a key's
     * bounds, or within its hit slop, it is that key. In the margin between
     * keys it is the nearest key by centre distance when fillGaps is on —
     * which is what stops a tap in a gap from doing nothing — and nothing at
     * all when it is off.
     */
    private fun keyAt(x: Float, y: Float): Any? {
        if (gridMode) return gridKeyAt(x, y)
        if (drawnKeys.isNotEmpty()) return drawnKeyAt(x, y)
        var nearest: View? = null
        var nearestDist = Float.MAX_VALUE
        var slopHit: View? = null
        for (i in 0 until childCount) {
            val c = getChildAt(i)
            if (!isKey(c)) {
                // A touch that lands ON something with its own gestures — the
                // backspace that repeats, the tone pill's hold, the mic, the
                // scrolling suggestion strip — belongs to that view. Gap-filling
                // used to hand it to the nearest KEY instead, so the plane took
                // it: backspace typed the letter beside it, and a mic or chip
                // tap in the tools row fired the tone pill.
                if (c.visibility == VISIBLE && ownsItsTouches(c)) {
                    c.getHitRect(hitRect)
                    if (hitRect.contains(x.toInt(), y.toInt())) return null
                }
                continue
            }
            c.getHitRect(hitRect)
            if (hitRect.contains(x.toInt(), y.toInt())) return c
            if (slopHit == null && x >= hitRect.left - hitSlopXPx && x < hitRect.right + hitSlopXPx &&
                y >= hitRect.top - hitSlopYPx && y < hitRect.bottom + hitSlopYPx) slopHit = c
            if (!fillGaps) continue
            val cx = (hitRect.left + hitRect.right) / 2f
            val cy = (hitRect.top + hitRect.bottom) / 2f
            // Horizontal distance dominates in a key ROW: a point below the row
            // still belongs to the key above it, not to a far key that happens
            // to be vertically closer.
            val d = abs(x - cx) + abs(y - cy) * 0.25f
            if (d < nearestDist) { nearestDist = d; nearest = c }
        }
        return slopHit ?: nearest
    }

    /**
     * Drawn-mode twin of keyAt. Same two-stage rule: a point inside a key's own
     * rect is that key; otherwise, with fillGaps on, the nearest by centre —
     * so the margins between keys belong to somebody and a tap there types.
     */
    private fun drawnKeyAt(x: Float, y: Float): DrawnKey? {
        var nearest: DrawnKey? = null
        var nearestDist = Float.MAX_VALUE
        for (k in drawnKeys) {
            if (k.isSpacer) continue
            if (k.rect.contains(x, y)) return k
            if (!fillGaps) continue
            // Horizontal distance dominates in a key ROW, exactly as in view
            // mode: a point below the row belongs to the key above it.
            val d = abs(x - k.rect.centerX()) + abs(y - k.rect.centerY()) * 0.25f
            if (d < nearestDist) { nearestDist = d; nearest = k }
        }
        return nearest
    }

    /** Is the point inside this key's rect, grown by `scale` about its centre. */
    private fun within(o: Any, x: Float, y: Float, scale: Float): Boolean {
        if (!rectOf(o, hitRect)) return false
        if (scale <= 1f) return hitRect.contains(x.toInt(), y.toInt())
        val cx = (hitRect.left + hitRect.right) / 2f
        val cy = (hitRect.top + hitRect.bottom) / 2f
        val hw = hitRect.width() * scale / 2f
        val hh = hitRect.height() * scale / 2f
        return x >= cx - hw && x <= cx + hw && y >= cy - hh && y <= cy + hh
    }

    /** Within `slop` of the key's rect on every side (kb.key.liftSlop). */
    private fun nearKey(o: Any, x: Float, y: Float, slop: Float): Boolean {
        if (!rectOf(o, hitRect)) return false
        return x >= hitRect.left - slop && x <= hitRect.right + slop &&
            y >= hitRect.top - slop && y <= hitRect.bottom + slop
    }

    /** The platform's own tap tolerance: a Button still clicks this far out. */
    private val touchSlopPx = android.view.ViewConfiguration.get(context).scaledTouchSlop.toFloat()

    /** A lift still on, or near, a control's rect — as near as the control
     *  itself would have accepted. */
    private fun nearView(v: View, x: Float, y: Float): Boolean {
        if (!measureView(v, scratchRect)) return false
        val slop = max(touchSlopPx, max(liftSlopPx, max(hitSlopXPx, hitSlopYPx)))
        return x >= scratchRect.left - slop && x <= scratchRect.right + slop &&
            y >= scratchRect.top - slop && y <= scratchRect.bottom + slop
    }

    /**
     * Only real keys.
     *
     * A ViewGroup (a scrolling suggestion strip, the personality row) has
     * gestures of its own that a tap-resolver would destroy. So does anything
     * tagged RAW_TOUCH — the backspace key tracks its own UP/CANCEL to stop
     * long-press repeat, and if the plane swallowed those it would delete until
     * the field was empty.
     *
     * Everything else clickable is a key, whatever class it is: a letter is a
     * Button, backspace and the globe can be ImageButtons.
     */
    private fun isKey(v: View): Boolean =
        v.visibility == VISIBLE && v.isClickable && v !is android.view.ViewGroup &&
            v.tag != RAW_TOUCH

    /** Not a key, but interactive: its area is its own, never a gap to fill.
     *  A plain spacer is none of these, so a tap on one still reaches a key. */
    private fun ownsItsTouches(v: View): Boolean =
        v.tag == RAW_TOUCH || v.isClickable || v is android.view.ViewGroup

    /**
     * The rest colour of each key view, captured the first time it is pressed.
     * Weak, because a remount replaces every key and nothing here should be the
     * reason the old ones stay alive.
     */
    private val restFill = java.util.WeakHashMap<View, Int>()

    /** A release fading back to the rest colour, per key, so a press that
     *  lands mid-fade can stop it. */
    private val fades = java.util.WeakHashMap<View, android.animation.ValueAnimator>()

    private fun setPressed(o: Any, pressed: Boolean) {
        when (o) {
            // The grid resolves; the row paints.
            is GridKey -> o.row.setPressed(o.target, pressed)
            is View -> {
                o.isPressed = pressed
                // isPressed ON ITS OWN CHANGED NOTHING, ON EVERY KEY.
                //
                // It sets the state and asks the background to redraw for it,
                // and the background is a plain GradientDrawable: one colour,
                // no state list. isStateful() is false, setState() returns
                // false, no invalidate is scheduled. So the press was registered
                // — the plane claimed the pointer and the character was on its
                // way — and the screen said nothing about it.
                //
                // That is the whole of the feel. A key that does not light up
                // is indistinguishable from a key that was missed, so every
                // press had to be confirmed by watching the text field instead,
                // which is the one place the character has not arrived yet.
                //
                // Tinting the drawable rather than building a state list keeps
                // this out of the way of the radius pass in addChildWithStyle,
                // which reads the background back as a GradientDrawable and
                // would throw away anything else.
                val gd = o.background as? android.graphics.drawable.GradientDrawable ?: return
                if (pressed) {
                    fades.remove(o)?.cancel()
                    val fill = pressedOverride[o] ?: pressedFill
                    if (fill == 0) return
                    if (!restFill.containsKey(o)) restFill[o] = gd.color?.defaultColor ?: return
                    gd.setColor(fill)
                } else {
                    val rest = restFill[o] ?: return
                    val from = gd.color?.defaultColor ?: rest
                    if (pressFadeMs <= 0L || from == rest) { gd.setColor(rest); return }
                    // The press is instant; the release eases out
                    // (kb.press.fadeMs), which is what reads as a soft glow
                    // rather than a flicker.
                    val anim = android.animation.ValueAnimator.ofArgb(from, rest)
                    anim.duration = pressFadeMs
                    anim.interpolator = android.view.animation.DecelerateInterpolator()
                    anim.addUpdateListener { gd.setColor(it.animatedValue as Int) }
                    fades[o] = anim
                    anim.start()
                }
            }
            is DrawnKey -> {
                // One repaint of one view, versus a Button re-running its
                // background state list and invalidating its own layer.
                if (pressed) {
                    o.fadeAt = 0L
                    pressedKey = o
                } else if (pressedKey === o) {
                    pressedKey = null
                    val press = if (o.pressedFill != 0) o.pressedFill else pressedFill
                    if (pressFadeMs > 0L && press != 0) {
                        o.fadeFrom = press
                        o.fadeAt = SystemClock.uptimeMillis()
                    }
                }
                invalidate()
            }
        }
    }

    private fun slotOf(id: Int): Int? {
        for (i in 0 until MAX_POINTERS) if (pointerIds[i] == id) return i
        return null
    }

    private fun freeSlot(): Int? {
        for (i in 0 until MAX_POINTERS) if (pointerIds[i] == -1) return i
        return null
    }

    // ------------------------------------------------------------------ grid

    /**
     * One key the grid resolves to, wherever it lives: a View or DrawnKey of
     * [row], which paints it and runs what it does.
     */
    class GridKey(
        val row: TulmiKeyPlane,
        val target: Any,
        /** KIND_CHAR / KIND_ACTION / KIND_SHIFT / KIND_LAYER. */
        val kind: Int,
        /** What a character key types, lowercase; "" for every other kind. */
        val char: String = "",
    ) {
        /** The key's rect on the grid, no taller than kb.touch.maxKeyHeight. */
        val rect = RectF()
        /** Its ownership box: rect grown by the row-aware slops. */
        val own = RectF()
        var live = false
    }

    /**
     * This plane is the grid: it has no keys of its own, sits over the whole
     * keyboard, and resolves every touch into the rows beneath it.
     */
    var gridMode: Boolean = false
        set(v) {
            field = v
            if (v) {
                setWillNotDraw(false)
                importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
                if (isAttachedToWindow) listenForLayout()
            }
        }

    /** kb.touch.lmBias.pt (0 = off) — how much nearer a likely next letter
     *  counts for a touch that is ambiguous anyway. A touch inside a key's
     *  own rect scores 0 and always wins; only gaps and slop move. */
    var lmBiasPx: Float = 0f

    /** kb.touch.vSlop — every key's reach above and below its rect. */
    var vSlopPx: Float = 8f * context.resources.displayMetrics.density
    /** kb.touch.topRowUpSlop — the top row's reach toward the tools row. */
    var topRowUpSlopPx: Float = 12f * context.resources.displayMetrics.density
    /** kb.touch.bottomRowDownSlop — the bottom row's reach downward. */
    var bottomRowDownSlopPx: Float = 10f * context.resources.displayMetrics.density
    /** kb.touch.edgeToMargin — a row's outermost keys own the margin beside
     *  them out to the keyboard's edge (the corners beside a and l). */
    var edgeToMargin: Boolean = true
    /** kb.touch.sideReach — past half its own width, sideways. */
    var sideReachPx: Float = 6f * context.resources.displayMetrics.density
    /** kb.touch.rowTolerance — keys whose centres sit this close are a row. */
    var rowTolerancePx: Float = 8f * context.resources.displayMetrics.density
    /** kb.touch.maxKeyHeight — a key stretched taller than this is measured
     *  as this tall, so its box follows what it draws. */
    var keyHeightCapPx: Float = 64f * context.resources.displayMetrics.density
    /** kb.touch.roleReach — how far past its rect shift or a layer key claims
     *  a touch, where it is nearer than any other key. */
    var roleReachPx: Float = 20f * context.resources.displayMetrics.density
    /** kb.touch.totalResolve — a point the grid claimed always resolves. */
    var totalResolve: Boolean = true
    /** kb.touch.alwaysRefresh — re-measure every key on every layout pass,
     *  rather than trusting one witness per row to say nothing moved. */
    var alwaysRefresh: Boolean = true
    /** kb.keyPlane.sheet — also re-measure at every display pass after a touch,
     *  a layout or a commit, the way the debug sheet did as a side effect. */
    var sheet: Boolean = true

    private var gridKeys: List<GridKey> = emptyList()
    private val gridIndex = java.util.IdentityHashMap<Any, GridKey>()
    /** Characters and action keys: the partition. */
    private val frames = ArrayList<GridKey>()
    /** Shift and the layer keys: anchors a finger starts on, never rolled to. */
    private val roleFrames = ArrayList<GridKey>()
    /** Everything interactive that is not the grid's, and what each vetoes. */
    private val obstacleViews = ArrayList<View>()
    private val obstacleRects = ArrayList<RectF>()
    private val obstacleOwner = ArrayList<View?>()
    private var obstacleCount = 0
    /** The key area: inside it every point belongs to SOME key. */
    private val gridBand = RectF()
    private var framesDirty = true
    private var obstaclesDirty = true
    private val gridLoc = IntArray(2)
    private val scratchLoc = IntArray(2)
    private val scratchRect = RectF()
    private var geoW = -1
    private var geoH = -1
    /** One witness per row plane: where it was and how big, last measured. */
    private val witnessRows = ArrayList<View>()
    private var witnessVals = IntArray(16)
    private var rowYs = FloatArray(16)
    private var rowMinX = FloatArray(16)
    private var rowMaxX = FloatArray(16)
    private var rowOf = IntArray(64)

    private var layoutListenerOn = false
    private val layoutListener = ViewTreeObserver.OnGlobalLayoutListener {
        if (!gridMode) return@OnGlobalLayoutListener
        // At a frame boundary, where measuring is cheap and no finger waits.
        if (alwaysRefresh) framesDirty = true
        try { ensureFrames() } catch (_: Throwable) { framesDirty = true }
        if (sheet) invalidate()
    }

    private fun listenForLayout() {
        if (layoutListenerOn) return
        layoutListenerOn = true
        viewTreeObserver.addOnGlobalLayoutListener(layoutListener)
    }

    /**
     * Swap the key set after a rebuild. Fingers keep their state: an owner
     * from the old tree resolves to nothing and re-targets against the new
     * geometry on its next move — which is what layer-peek rides on.
     */
    fun rebind(keys: List<GridKey>) {
        gridKeys = keys
        gridIndex.clear()
        for (k in keys) gridIndex[k.target] = k
        frames.clear()
        roleFrames.clear()
        framesDirty = true
        obstaclesDirty = true
        if (sheet) invalidate()
    }

    /** The controls may have changed (suggestion chips came and went):
     *  re-walk them before the next touch resolves. */
    fun setObstaclesDirty() { obstaclesDirty = true }

    private fun ensureFrames() {
        if (!gridMode) return
        if (obstaclesDirty) { collectObstacles(); framesDirty = true }
        if (framesDirty || frames.isEmpty() || width != geoW || height != geoH) { refreshFrames(); return }
        getLocationInWindow(scratchLoc)
        if (scratchLoc[0] != gridLoc[0] || scratchLoc[1] != gridLoc[1]) { refreshFrames(); return }
        // One witness per row, because the rows move independently: a single
        // witness could say nothing moved while a row it is not in had.
        for (i in witnessRows.indices) {
            val r = witnessRows[i]
            if (!r.isAttachedToWindow) { refreshFrames(); return }
            r.getLocationInWindow(scratchLoc)
            val b = i * 4
            if (scratchLoc[0] != witnessVals[b] || scratchLoc[1] != witnessVals[b + 1] ||
                r.width != witnessVals[b + 2] || r.height != witnessVals[b + 3]) {
                refreshFrames(); return
            }
        }
    }

    /** A view's rect on the grid; false when it is not on screen. */
    private fun measureView(v: View, out: RectF): Boolean {
        if (!v.isAttachedToWindow || !v.isShown || v.width <= 0 || v.height <= 0) return false
        v.getLocationInWindow(scratchLoc)
        val x = (scratchLoc[0] - gridLoc[0]).toFloat()
        val y = (scratchLoc[1] - gridLoc[1]).toFloat()
        out.set(x, y, x + v.width, y + v.height)
        return true
    }

    private fun measureKey(k: GridKey, out: RectF): Boolean {
        return when (val t = k.target) {
            is View -> measureView(t, out)
            is DrawnKey -> {
                val row = k.row
                if (t.isSpacer || t.rect.width() <= 0f || !row.isAttachedToWindow || !row.isShown) return false
                row.getLocationInWindow(scratchLoc)
                val x = (scratchLoc[0] - gridLoc[0]).toFloat()
                val y = (scratchLoc[1] - gridLoc[1]).toFloat()
                out.set(t.rect.left + x, t.rect.top + y, t.rect.right + x, t.rect.bottom + y)
                true
            }
            else -> false
        }
    }

    private fun refreshFrames() {
        framesDirty = false
        getLocationInWindow(gridLoc)
        geoW = width
        geoH = height
        frames.clear()
        roleFrames.clear()
        for (k in gridKeys) {
            k.live = measureKey(k, k.rect)
            if (!k.live) continue
            // A key is never taller than its row: a view stretched to fill a
            // container reports a rect running off the keyboard, and its box,
            // the band and its veto would all follow it there.
            if (k.rect.height() > keyHeightCapPx) k.rect.bottom = k.rect.top + keyHeightCapPx
            if (k.kind == KIND_SHIFT || k.kind == KIND_LAYER) roleFrames += k else frames += k
        }
        val n = frames.size
        if (rowOf.size < n) rowOf = IntArray(n * 2)
        if (rowYs.size < n) { rowYs = FloatArray(n * 2); rowMinX = FloatArray(n * 2); rowMaxX = FloatArray(n * 2) }
        // Cluster into rows by vertical centre, then resolve each key's row once.
        var rows = 0
        for (f in frames) {
            val cy = f.rect.centerY()
            var known = false
            for (r in 0 until rows) if (abs(rowYs[r] - cy) < rowTolerancePx) { known = true; break }
            if (!known) rowYs[rows++] = cy
        }
        java.util.Arrays.sort(rowYs, 0, rows)
        for (r in 0 until rows) { rowMinX[r] = Float.MAX_VALUE; rowMaxX[r] = -Float.MAX_VALUE }
        for (i in 0 until n) {
            val f = frames[i]
            val cy = f.rect.centerY()
            var ri = 0
            for (r in 0 until rows) if (abs(rowYs[r] - cy) < rowTolerancePx) { ri = r; break }
            rowOf[i] = ri
            rowMinX[ri] = min(rowMinX[ri], f.rect.left)
            rowMaxX[ri] = max(rowMaxX[ri], f.rect.right)
        }
        val lastRow = rows - 1
        val w = width.toFloat()
        for (i in 0 until n) {
            val f = frames[i]
            val r = f.rect
            val ri = rowOf[i]
            val up = if (ri == 0) topRowUpSlopPx else vSlopPx
            val down = if (ri == lastRow) bottomRowDownSlopPx else vSlopPx
            val reach = r.width() / 2f + sideReachPx
            var left = r.left - reach
            var right = r.right + reach
            if (edgeToMargin) {
                if (r.left <= rowMinX[ri] + 0.5f) left = 0f
                if (r.right >= rowMaxX[ri] - 0.5f) right = w
            }
            f.own.set(left, r.top - up, right, r.bottom + down)
        }
        // Witnesses: each row plane once, as it stands now.
        witnessRows.clear()
        for (k in gridKeys) {
            if (!k.live || witnessRows.contains(k.row)) continue
            val b = witnessRows.size * 4
            if (witnessVals.size < b + 4) witnessVals = witnessVals.copyOf(b * 2 + 4)
            k.row.getLocationInWindow(scratchLoc)
            witnessVals[b] = scratchLoc[0]
            witnessVals[b + 1] = scratchLoc[1]
            witnessVals[b + 2] = k.row.width
            witnessVals[b + 3] = k.row.height
            witnessRows += k.row
        }
        // The band: the keys actually on the grid, full width, reaching up and
        // down by the outer rows' slops. Outside it nothing is ever claimed, so
        // a near-miss on the suggestion strip does nothing rather than type.
        var top = Float.MAX_VALUE
        var bottom = -Float.MAX_VALUE
        for (f in frames) {
            if (f.rect.right <= 0f || f.rect.left >= w || f.rect.bottom <= 0f || f.rect.top >= height) continue
            top = min(top, f.rect.top)
            bottom = max(bottom, f.rect.bottom)
        }
        if (top > bottom) gridBand.setEmpty() else gridBand.set(0f, top - topRowUpSlopPx, w, bottom + bottomRowDownSlopPx)
        refreshObstacleRects()
    }

    /**
     * Every interactive view in the tree that is not the grid's to resolve:
     * the mic, the tone pill, the globe, a suggestion chip, a backend button.
     * A disabled one counts too — its area going to a letter would type where
     * the user expected a dead button. Stacks are walked through, not vetoed.
     */
    private fun collectObstacles() {
        obstaclesDirty = false
        obstacleViews.clear()
        val root = parent as? ViewGroup ?: return
        for (i in 0 until root.childCount) {
            val c = root.getChildAt(i)
            if (c !== this) walkObstacles(c)
        }
    }

    private fun walkObstacles(v: View) {
        if (v.visibility != VISIBLE) return
        // The grid's own keys: letters, shift and the layer keys take no part;
        // the action keys veto only their painted face (refreshObstacleRects).
        if (gridIndex.containsKey(v)) return
        if ((v.isClickable || v.isLongClickable || v.tag == RAW_TOUCH) && v !is LinearLayout) {
            obstacleViews += v
            return
        }
        if (v is ViewGroup) for (i in 0 until v.childCount) walkObstacles(v.getChildAt(i))
    }

    private fun nextObstacle(owner: View?): RectF {
        if (obstacleCount == obstacleRects.size) { obstacleRects += RectF(); obstacleOwner += null }
        obstacleOwner[obstacleCount] = owner
        return obstacleRects[obstacleCount++]
    }

    private fun refreshObstacleRects() {
        obstacleCount = 0
        for (v in obstacleViews) {
            val r = nextObstacle(v)
            if (!measureView(v, r)) { obstacleCount--; continue }
            // A control vetoes its halo (kb.key.hitSlop) — but only the part of
            // it that can actually be touched. The slop that falls outside the
            // control's own row can never reach it, and vetoing it only made
            // holes above the top row and under z and x.
            if (v.tag != SDUIRenderer.CHIP_TAG) {
                r.inset(-hitSlopXPx, -hitSlopYPx)
                val p = v.parent as? View
                if (p != null && measureView(p, scratchRect) && !r.intersect(scratchRect)) { obstacleCount--; continue }
            }
            if (r.width() <= 0f || r.height() <= 0f) obstacleCount--
        }
        // Space, return and backspace veto only what they paint, so a direct
        // touch reaches their own gestures (the repeat, the trackpad) and the
        // band around them comes to the grid.
        for (f in frames) {
            if (f.kind != KIND_ACTION) continue
            val r = nextObstacle(null)
            paintedRect(f, r)
            if (r.width() <= 0f || r.height() <= 0f) obstacleCount--
        }
    }

    private fun vetoed(x: Float, y: Float): Boolean {
        for (i in 0 until obstacleCount) if (obstacleRects[i].contains(x, y)) return true
        return false
    }

    /** L1 distance from a point to a rect; 0 inside. Scoring both axes makes a
     *  touch between two rows go to the NEARER row. */
    private fun l1(r: RectF, x: Float, y: Float): Float {
        val dx = max(0f, max(r.left - x, x - r.right))
        val dy = max(0f, max(r.top - y, y - r.bottom))
        return dx + dy
    }

    private fun inRoleSlop(r: RectF, x: Float, y: Float): Boolean =
        x >= r.left - hitSlopXPx && x < r.right + hitSlopXPx &&
            y >= r.top - hitSlopYPx && y < r.bottom + hitSlopYPx

    /**
     * Is this point the grid's at all? Same yes/no as "some key or role key
     * would take it", without scoring which — the resolve runs once, after.
     */
    private fun owns(x: Float, y: Float): Boolean {
        ensureFrames()
        if (vetoed(x, y)) return false
        for (f in roleFrames) if (inRoleSlop(f.rect, x, y)) return true
        if (frames.isEmpty()) return false
        if (fillGaps) return gridBand.contains(x, y)
        for (f in frames) if (f.own.contains(x, y)) return true
        return false
    }

    /**
     * The key a point belongs to. A control's rect is never a key's. Among
     * the ownership boxes that contain the point, the key whose REAL rect is
     * nearest wins — the language model shaving kb.touch.lmBias.pt off a
     * likely next letter's distance. Outside every box but inside the band,
     * the nearest key, when gaps are filled.
     */
    private fun gridKeyAt(x: Float, y: Float): GridKey? {
        ensureFrames()
        if (vetoed(x, y)) return null
        if (roleKeyAt(x, y) != null) return null
        val likely = if (lmBiasPx > 0f) gestures?.likelyNext() ?: "" else ""
        var best: GridKey? = null
        var bestScore = Float.MAX_VALUE
        for (f in frames) {
            if (!f.own.contains(x, y)) continue
            var score = l1(f.rect, x, y)
            if (score > 0f && likely.isNotEmpty() && f.char.length == 1 && likely.indexOf(f.char[0]) >= 0) {
                score = max(0.01f, score - lmBiasPx)
            }
            if (best == null || score < bestScore) { best = f; bestScore = score }
        }
        if (best != null) return best
        if (!fillGaps || !gridBand.contains(x, y)) return null
        return nearestKey(x, y)
    }

    /** The nearest key on the grid, ungated — the last resort for a point the
     *  grid already took, where "nothing" is the one wrong answer. */
    private fun nearestKey(x: Float, y: Float): GridKey? {
        var best: GridKey? = null
        var bestD = Float.MAX_VALUE
        val w = width.toFloat()
        val h = height.toFloat()
        for (f in frames) {
            if (f.rect.right <= 0f || f.rect.left >= w || f.rect.bottom <= 0f || f.rect.top >= h) continue
            val d = l1(f.rect, x, y)
            if (best == null || d < bestD) { best = f; bestD = d }
        }
        return best
    }

    /**
     * The shift or layer key whose rect (with its hit slop) holds the point —
     * the nearest, where two overlap. Past that, half the gap is theirs too:
     * a point within kb.touch.roleReach that is nearer to the role key than
     * to any other key or control goes to it, so a thumb a hair right of
     * shift gets a capital rather than z.
     */
    private fun roleKeyAt(x: Float, y: Float): GridKey? {
        var best: GridKey? = null
        var bestD = Float.MAX_VALUE
        for (f in roleFrames) {
            val d = l1(f.rect, x, y)
            if (!inRoleSlop(f.rect, x, y)) {
                if (roleReachPx <= 0f || d > roleReachPx || !gridBand.contains(x, y)) continue
                var nearer = false
                for (g in frames) if (l1(g.rect, x, y) <= d) { nearer = true; break }
                if (!nearer) for (i in 0 until obstacleCount) if (l1(obstacleRects[i], x, y) <= d) { nearer = true; break }
                if (nearer) continue
            }
            if (best == null || d < bestD) { best = f; bestD = d }
        }
        return best
    }

    /** Forget every key: the grid is leaving, or has nothing to resolve. */
    fun clearGrid() {
        releaseAllSilently()
        rebind(emptyList())
        obstacleViews.clear()
        obstacleCount = 0
    }

    companion object {
        /** More fingers than anyone types with; the array cost is nil. */
        private const val MAX_POINTERS = 5

        /** Hold before a drawn key's long-press fires. Matches Android's own. */
        private const val LONG_PRESS_MS = 500L

        /** What a finger is doing. */
        private const val MODE_KEY = 0
        private const val MODE_TRAY = 1
        private const val MODE_TRACKPAD = 2
        /** A later finger on the grid that landed on a control. */
        private const val MODE_PASS = 3

        /** What a finger began on, on the grid. */
        private const val ROLE_NONE = 0
        private const val ROLE_SHIFT = 1
        private const val ROLE_LAYER = 2

        /** What a grid key is. */
        const val KIND_CHAR = 0
        const val KIND_ACTION = 1
        const val KIND_SHIFT = 2
        const val KIND_LAYER = 3

        /**
         * Tag a key with this and the plane will not take its touches. For keys
         * whose behaviour IS the gesture — press-and-hold to repeat, drag to
         * move the caret — rather than a tap.
         */
        const val RAW_TOUCH = "tulmi.rawTouch"

        private fun easeOut(t: Float): Float = 1f - (1f - t) * (1f - t)

        /** a → b by k, per channel. */
        private fun blend(a: Int, b: Int, k: Float): Int {
            fun ch(x: Int, y: Int) = (x + (y - x) * k).toInt().coerceIn(0, 255)
            return Color.argb(
                ch(Color.alpha(a), Color.alpha(b)), ch(Color.red(a), Color.red(b)),
                ch(Color.green(a), Color.green(b)), ch(Color.blue(a), Color.blue(b)),
            )
        }
    }
}
