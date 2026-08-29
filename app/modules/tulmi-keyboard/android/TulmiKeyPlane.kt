package com.tulmi.app.keyboard

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.os.Handler
import android.os.Looper
import android.view.MotionEvent
import android.view.View
import android.widget.LinearLayout
import kotlin.math.abs
import kotlin.math.hypot

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
 * order they were pressed.
 *
 * The plane does NOT reimplement what a key does. It resolves which key a touch
 * belongs to and when it fires, then calls performClick() — so every listener
 * the renderer already attached keeps working untouched.
 *
 * Anything whose gesture is not a tap — a suggestion strip that scrolls, the
 * personality row, a key that repeats while held — is left to handle its own
 * touch, because the plane would break it. See isKey().
 */
class TulmiKeyPlane(context: Context) : LinearLayout(context) {

    /** kb.keyPlane.enabled — off restores stock per-view dispatch exactly. */
    var planeEnabled: Boolean = true

    /** kb.touch.fillGaps — give the margins between keys to the nearest key. */
    var fillGaps: Boolean = true

    /** kb.touch.holdMultiplier — how far a finger may drift off the pressed key
     *  before another one can take it. 1.0 disables the slack. */
    var holdMultiplier: Float = 1.35f

    /** kb.touch.cancelCommit.maxMs / .maxDriftPt — a cancelled touch this short
     *  and this still was a tap; commit it rather than losing the character. */
    var cancelCommitMaxMs: Long = 300L
    var cancelCommitMaxDriftPx: Float = 12f * context.resources.displayMetrics.density

    /** Fired just before a key's own listener runs, for anything that wants to
     *  observe commits centrally. Left unset by default — feedback and counting
     *  belong with the key, not with the resolver. */
    var onKeyCommitted: ((View) -> Unit)? = null

    /** kb.swipe.enabled — trace a word across the keys instead of tapping it. */
    var swipeEnabled: Boolean = false

    /** How far a finger must travel before the gesture stops being a press and
     *  becomes a trace. Below this, a slightly sloppy tap is still a tap. */
    var swipeMinTravelPx: Float = 44f * context.resources.displayMetrics.density

    /**
     * A completed trace, as the keys it turned on. Fired instead of a key
     * commit — a swipe types a word, not the letter it happened to end on.
     */
    var onSwipe: ((List<String>) -> Unit)? = null

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
    ) {
        /** Filled in by the plane at layout time. */
        val rect = RectF()

        /** Set by a key that already acted while held — a backspace whose
         *  repeat has fired must not delete once more on release. */
        var suppressCommit = false
    }

    /** Non-empty puts the plane in drawn mode. */
    private var drawnKeys: List<DrawnKey> = emptyList()
    private var pressedKey: DrawnKey? = null
    private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textAlign = Paint.Align.CENTER
    }

    /** Colour a key flashes on press (theme.keyPressed). */
    var pressedFill: Int = 0

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
        setWillNotDraw(keys.isEmpty())
        requestLayout()
        invalidate()
    }

    fun drawnKeys(): List<DrawnKey> = drawnKeys

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
        for (k in drawnKeys) {
            if (k.isSpacer || k.rect.width() <= 0f) continue
            fillPaint.color = if (k === pressedKey && pressedFill != 0) pressedFill else k.fill
            canvas.drawRoundRect(k.rect, k.radiusPx, k.radiusPx, fillPaint)
            val g = k.glyph
            if (g != null) {
                g(canvas, k.rect, textPaint)
                continue
            }
            if (k.label.isEmpty()) continue
            textPaint.color = k.textColor
            textPaint.textSize = k.textSizePx
            // Centre on the text's own metrics, not on the font's line box —
            // otherwise descenders push every glyph visibly high in the key.
            val fm = textPaint.fontMetrics
            val baseline = k.rect.centerY() - (fm.ascent + fm.descent) / 2f
            canvas.drawText(k.label, k.rect.centerX(), baseline, textPaint)
        }
    }

    // Per-pointer state. Small arrays rather than maps — this is the touch path
    // and at most a few fingers are ever down.
    //
    // `owners` is Any? so one state machine drives both modes: the entry is a
    // child View when the row was built, and a DrawnKey when it was painted.
    private val pointerIds = IntArray(MAX_POINTERS) { -1 }
    private val owners = arrayOfNulls<Any>(MAX_POINTERS)
    private val downX = FloatArray(MAX_POINTERS)
    private val downY = FloatArray(MAX_POINTERS)
    private val downAt = LongArray(MAX_POINTERS)

    private val hitRect = Rect()

    init {
        orientation = HORIZONTAL
        isMotionEventSplittingEnabled = false   // the plane splits pointers itself
    }

    /**
     * Take the gesture only when it starts on a key. A touch that begins on a
     * scrolling strip or a custom row belongs to that view.
     */
    override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
        if (!planeEnabled) return false
        if (ev.actionMasked != MotionEvent.ACTION_DOWN) return false
        return keyAt(ev.x, ev.y) != null
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(ev: MotionEvent): Boolean {
        if (!planeEnabled) return super.onTouchEvent(ev)

        when (ev.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> {
                val i = ev.actionIndex
                claim(ev.getPointerId(i), ev.getX(i), ev.getY(i))
            }

            MotionEvent.ACTION_MOVE -> {
                for (i in 0 until ev.pointerCount) {
                    val slot = slotOf(ev.getPointerId(i)) ?: continue
                    val x = ev.getX(i)
                    val y = ev.getY(i)
                    val held = owners[slot] ?: continue
                    // Stay on the pressed key while the finger is anywhere in
                    // its grown rect. Only a move that lands on ANOTHER key
                    // retargets — drifting into a gap keeps what you pressed.
                    if (swipeEnabled && slot == 0) {
                        traceTravel += hypot(x - lastTraceX, y - lastTraceY)
                        lastTraceX = x
                        lastTraceY = y
                        if (!tracing && traceTravel >= swipeMinTravelPx) {
                            // Long enough to be deliberate. Everything the
                            // finger has already crossed counts, starting with
                            // the key it pressed.
                            tracing = true
                            traced.clear()
                            traced.add(held)
                        }
                    }
                    if (within(held, x, y, holdMultiplier)) continue
                    val next = keyAt(x, y) ?: continue
                    if (next === held) continue
                    setPressed(held, false)
                    (held as? DrawnKey)?.onPressEnd?.invoke()
                    owners[slot] = next
                    setPressed(next, true)
                    (next as? DrawnKey)?.let { it.suppressCommit = false; it.onPressStart?.invoke() }
                    cancelLongPress()
                    // A trace records each NEW key it enters. Consecutive
                    // duplicates are dropped, so wobbling on one key does not
                    // double a letter — a real double letter comes from the
                    // dictionary, not from the path.
                    if (tracing && traced.lastOrNull() !== next) traced.add(next)
                }
            }

            MotionEvent.ACTION_UP, MotionEvent.ACTION_POINTER_UP -> {
                val i = ev.actionIndex
                if (tracing && slotOf(ev.getPointerId(i)) == 0) {
                    // A trace types a word, not the letter it ended on — so the
                    // key under the finger must NOT also commit.
                    val path = ArrayList(traced)
                    endTrace()
                    releaseSilently(ev.getPointerId(i))
                    val letters = path.mapNotNull { labelOf(it) }
                        .filter { it.length == 1 }
                        .map { it.lowercase() }
                    if (letters.size >= 2) onSwipe?.invoke(letters)
                    return true
                }
                release(ev.getPointerId(i), commit = true, x = ev.getX(i), y = ev.getY(i))
            }

            MotionEvent.ACTION_CANCEL -> {
                // Everything still down was cancelled by something outside this
                // view. Rescue the ones that were taps.
                endTrace()
                for (slot in 0 until MAX_POINTERS) {
                    val id = pointerIds[slot]
                    if (id != -1) release(id, commit = false, x = downX[slot], y = downY[slot])
                }
            }
        }
        return true
    }

    /** Drop a pointer's ownership without firing its key. */
    private fun releaseSilently(id: Int) {
        val slot = slotOf(id) ?: return
        owners[slot]?.let { setPressed(it, false); (it as? DrawnKey)?.onPressEnd?.invoke() }
        pointerIds[slot] = -1
        owners[slot] = null
    }

    private fun endTrace() {
        tracing = false
        traceTravel = 0f
        traced.clear()
    }

    private fun claim(id: Int, x: Float, y: Float) {
        val key = keyAt(x, y) ?: return
        val slot = freeSlot() ?: return
        if (slot == 0) {
            traceTravel = 0f
            lastTraceX = x
            lastTraceY = y
            tracing = false
        }
        pointerIds[slot] = id
        owners[slot] = key
        downX[slot] = x
        downY[slot] = y
        downAt[slot] = System.currentTimeMillis()
        setPressed(key, true)
        (key as? DrawnKey)?.let { it.suppressCommit = false; it.onPressStart?.invoke() }
        if (slot == 0) armLongPress(key)
    }

    private fun release(id: Int, commit: Boolean, x: Float, y: Float) {
        cancelLongPress()
        val slot = slotOf(id) ?: return
        val key = owners[slot]
        val heldMs = System.currentTimeMillis() - downAt[slot]
        val drift = hypot(x - downX[slot], y - downY[slot])

        pointerIds[slot] = -1
        owners[slot] = null
        if (key == null) return
        setPressed(key, false)
        (key as? DrawnKey)?.onPressEnd?.invoke()

        // A normal lift always commits. A CANCEL commits only when the gesture
        // looked like a tap — short, and barely moved.
        val shouldCommit = commit ||
            (heldMs <= cancelCommitMaxMs && drift <= cancelCommitMaxDriftPx)
        if (!shouldCommit) return

        commitOwner(key)
    }

    /**
     * Fire a key. A built key runs its click listener; a drawn key its lambda.
     *
     * onKeyCommitted takes a View, so it is view-mode only. Nothing sets it —
     * feedback and counting belong with the key — and rather than invent a
     * View to pass, drawn mode simply doesn't have it.
     */
    private fun commitOwner(o: Any) {
        when (o) {
            is DrawnKey -> {
                if (o.suppressCommit) { o.suppressCommit = false } else o.onCommit()
            }
            is View -> { onKeyCommitted?.invoke(o); o.performClick() }
        }
    }

    /** The owner's visible text, for the swipe trace. */
    private fun labelOf(o: Any): String? = when (o) {
        is DrawnKey -> o.label
        is android.widget.Button -> o.text?.toString()
        else -> null
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

    private fun armLongPress(o: Any) {
        cancelLongPress()
        val k = o as? DrawnKey ?: return
        val action = k.onLongPress ?: return
        val r = Runnable {
            armedLongPress = null
            // The key is consumed by the long-press: clear it so the lift
            // that follows does not ALSO type the character.
            for (i in 0 until MAX_POINTERS) if (owners[i] === k) owners[i] = null
            setPressed(k, false)
            action()
        }
        armedLongPress = r
        longPressHandler.postDelayed(r, LONG_PRESS_MS)
    }

    private fun cancelLongPress() {
        armedLongPress?.let { longPressHandler.removeCallbacks(it) }
        armedLongPress = null
    }

    /** The owner's rect in plane coordinates. */
    private fun rectOf(o: Any, out: Rect): Boolean = when (o) {
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

    /**
     * Which key owns this point.
     *
     * Inside a key's bounds it is that key. In the margin between keys it is the
     * nearest key by centre distance when fillGaps is on — which is what stops a
     * tap in a gap from doing nothing — and nothing at all when it is off.
     */
    private fun keyAt(x: Float, y: Float): Any? {
        if (drawnKeys.isNotEmpty()) return drawnKeyAt(x, y)
        var nearest: View? = null
        var nearestDist = Float.MAX_VALUE
        for (i in 0 until childCount) {
            val c = getChildAt(i)
            if (!isKey(c)) continue
            c.getHitRect(hitRect)
            if (hitRect.contains(x.toInt(), y.toInt())) return c
            if (!fillGaps) continue
            val cx = (hitRect.left + hitRect.right) / 2f
            val cy = (hitRect.top + hitRect.bottom) / 2f
            // Horizontal distance dominates in a key ROW: a point below the row
            // still belongs to the key above it, not to a far key that happens
            // to be vertically closer.
            val d = abs(x - cx) + abs(y - cy) * 0.25f
            if (d < nearestDist) { nearestDist = d; nearest = c }
        }
        return nearest
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

    private fun setPressed(o: Any, pressed: Boolean) {
        when (o) {
            is View -> o.isPressed = pressed
            is DrawnKey -> {
                // One repaint of one view, versus a Button re-running its
                // background state list and invalidating its own layer.
                pressedKey = if (pressed) o else null
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

    companion object {
        /** More fingers than anyone types with; the array cost is nil. */
        private const val MAX_POINTERS = 5

        /** Hold before a drawn key's long-press fires. Matches Android's own. */
        private const val LONG_PRESS_MS = 500L

        /**
         * Tag a key with this and the plane will not take its touches. For keys
         * whose behaviour IS the gesture — press-and-hold to repeat, drag to
         * move the caret — rather than a tap.
         */
        const val RAW_TOUCH = "tulmi.rawTouch"
    }
}
