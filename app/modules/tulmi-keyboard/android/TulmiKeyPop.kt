package com.tulmi.app.keyboard

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorFilter
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.drawable.Drawable

/**
 * What floats above the keys: the pop-up over a pressed letter, and the tray
 * of alternates a held letter opens. The Android half of iOS's KeyCalloutView
 * and accent tray.
 *
 * It is a Drawable in the keyboard container's overlay, not a view, so it
 * takes no part in layout and can never take a touch. The key plane keeps the
 * finger the whole time and tells the renderer what to show; this only paints.
 *
 * Every size is in px, set by the renderer from the server's kb.callout.* and
 * kb.accentTray.* flags.
 */
class TulmiKeyPop : Drawable() {

    // ------------------------------------------------------------ pop-up

    var headExtraWidth = 0f
    var headMinWidth = 0f
    var headExtraHeight = 0f
    var neckHeight = 0f
    var headRadius = 0f
    var keyRadius = 0f
    var edgeInset = 0f

    private var popShown = false
    private val popPath = Path()
    private val popHead = RectF()
    private var popChar = ""
    private val popFill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val popInk = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER }

    /** A soft shadow under the pop-up and the tray. Radius 0 = none. */
    fun setShadow(color: Int, radius: Float, dx: Float, dy: Float) {
        if (radius > 0f && Color.alpha(color) > 0) {
            popFill.setShadowLayer(radius, dx, dy, color)
            trayFill.setShadowLayer(radius, dx, dy, color)
        } else {
            popFill.clearShadowLayer()
            trayFill.clearShadowLayer()
        }
    }

    /**
     * Show [ch] in a balloon that grows out of [key] (container coords): the
     * key's own shape, a neck, and a wider head above it with the glyph.
     */
    fun showPop(key: RectF, ch: String, fill: Int, ink: Int, textPx: Float) {
        val w = bounds.width().toFloat()
        val headW = maxOf(key.width() + headExtraWidth, headMinWidth)
        val headH = key.height() + headExtraHeight
        val headBottom = key.top - neckHeight
        var left = key.centerX() - headW / 2f
        if (w > 0f) left = left.coerceIn(edgeInset, maxOf(edgeInset, w - edgeInset - headW))
        popHead.set(left, headBottom - headH, left + headW, headBottom)

        val r = headRadius.coerceAtMost(minOf(headW, headH) / 2f)
        val kr = keyRadius.coerceAtMost(minOf(key.width(), key.height()) / 2f)
        val neck = neckHeight
        popPath.reset()
        // Up the key's left side, curve out to the head, round the head, curve
        // back in to the key's right side, down and round the key's foot.
        popPath.moveTo(key.left, key.bottom - kr)
        popPath.lineTo(key.left, key.top)
        popPath.cubicTo(key.left, key.top - neck * 0.5f, popHead.left, popHead.bottom + neck * 0.5f,
            popHead.left, popHead.bottom)
        popPath.lineTo(popHead.left, popHead.top + r)
        popPath.quadTo(popHead.left, popHead.top, popHead.left + r, popHead.top)
        popPath.lineTo(popHead.right - r, popHead.top)
        popPath.quadTo(popHead.right, popHead.top, popHead.right, popHead.top + r)
        popPath.lineTo(popHead.right, popHead.bottom)
        popPath.cubicTo(popHead.right, popHead.bottom + neck * 0.5f, key.right, key.top - neck * 0.5f,
            key.right, key.top)
        popPath.lineTo(key.right, key.bottom - kr)
        popPath.quadTo(key.right, key.bottom, key.right - kr, key.bottom)
        popPath.lineTo(key.left + kr, key.bottom)
        popPath.quadTo(key.left, key.bottom, key.left, key.bottom - kr)
        popPath.close()

        popFill.color = fill
        popInk.color = ink
        popInk.textSize = textPx
        popChar = ch
        popShown = true
        invalidateSelf()
    }

    fun hidePop() {
        if (!popShown) return
        popShown = false
        invalidateSelf()
    }

    // ------------------------------------------------------------ tray

    var chipWidth = 0f
    var chipGap = 0f
    var trayPadding = 0f
    var trayHeight = 0f
    var trayRadius = 0f
    var chipRadius = 0f
    var trayOffsetY = 0f

    private var trayItems: List<String> = emptyList()
    private val trayRect = RectF()
    private val trayKey = RectF()
    private val chipRect = RectF()
    private val trayFill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val chipFill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val chipInk = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER }
    private var chipInkColor = Color.WHITE
    private var chipActiveInk = Color.WHITE

    /** Which chip is lit, or -1 for none. */
    var active = -1
        private set

    val trayOpen: Boolean get() = trayItems.isNotEmpty()

    /** What the lit chip says, or null. */
    fun activeItem(): String? = trayItems.getOrNull(active)

    /**
     * Open the tray above [key] with [items] (the base first). The base chip
     * sits over the key where it fits, so the finger starts on it and slides
     * right through the alternates, like the system keyboard.
     */
    fun showTray(key: RectF, items: List<String>, bg: Int, ink: Int, activeBg: Int, textPx: Float) {
        if (items.isEmpty()) return
        val w = bounds.width().toFloat()
        val n = items.size
        // Nine chips for "a" are 400dp at the server's width; on a 360dp phone
        // the last ones would be off screen and unreachable. Narrow them to fit.
        if (w > 0f) {
            val fit = (w - 2f * edgeInset - 2f * trayPadding - (n - 1) * chipGap) / n
            if (fit > 0f) chipWidth = minOf(chipWidth, fit)
        }
        val width = n * chipWidth + (n - 1) * chipGap + trayPadding * 2f
        val margin = edgeInset
        var left = key.centerX() - trayPadding - chipWidth / 2f
        if (w > 0f) left = left.coerceIn(margin, maxOf(margin, w - margin - width))
        val top = maxOf(0f, key.top + trayOffsetY)
        trayRect.set(left, top, left + width, top + trayHeight)
        trayKey.set(key)
        trayItems = items
        trayFill.color = bg
        chipFill.color = activeBg
        chipInkColor = ink
        // Ink on the lit chip reads against the lit colour, not the tray's.
        chipActiveInk = if (luminance(activeBg) < 0.6) Color.WHITE else Color.BLACK
        chipInk.textSize = textPx
        active = 0
        invalidateSelf()
    }

    /**
     * The chip a finger at (x, y) points to. Horizontal position picks it, so
     * the finger need not climb onto the tray; a finger dragged well below the
     * key it held points to none.
     */
    fun chipAt(x: Float, y: Float): Int {
        if (trayItems.isEmpty()) return -1
        if (y > trayKey.bottom + trayKey.height()) return -1
        val first = trayRect.left + trayPadding
        val step = chipWidth + chipGap
        if (x < first - chipWidth / 2f || x > trayRect.right - trayPadding + chipWidth / 2f) return -1
        return ((x - first + chipGap / 2f) / step).toInt().coerceIn(0, trayItems.size - 1)
    }

    fun setActive(i: Int) {
        if (i == active) return
        active = i
        invalidateSelf()
    }

    fun hideTray() {
        if (trayItems.isEmpty()) return
        trayItems = emptyList()
        active = -1
        invalidateSelf()
    }

    fun clear() {
        popShown = false
        trayItems = emptyList()
        active = -1
        invalidateSelf()
    }

    // ------------------------------------------------------------ paint

    override fun draw(canvas: Canvas) {
        if (popShown && trayItems.isEmpty()) {
            canvas.drawPath(popPath, popFill)
            val fm = popInk.fontMetrics
            canvas.drawText(popChar, popHead.centerX(), popHead.centerY() - (fm.ascent + fm.descent) / 2f, popInk)
        }
        if (trayItems.isNotEmpty()) {
            canvas.drawRoundRect(trayRect, trayRadius, trayRadius, trayFill)
            val fm = chipInk.fontMetrics
            var x = trayRect.left + trayPadding
            for ((i, item) in trayItems.withIndex()) {
                chipRect.set(x, trayRect.top + trayPadding, x + chipWidth, trayRect.bottom - trayPadding)
                if (i == active) canvas.drawRoundRect(chipRect, chipRadius, chipRadius, chipFill)
                chipInk.color = if (i == active) chipActiveInk else chipInkColor
                canvas.drawText(item, chipRect.centerX(), chipRect.centerY() - (fm.ascent + fm.descent) / 2f, chipInk)
                x += chipWidth + chipGap
            }
        }
    }

    override fun setAlpha(alpha: Int) {}
    override fun setColorFilter(colorFilter: ColorFilter?) {}
    @Deprecated("Deprecated in Java")
    override fun getOpacity(): Int = PixelFormat.TRANSLUCENT

    private fun luminance(c: Int): Double =
        (0.299 * Color.red(c) + 0.587 * Color.green(c) + 0.114 * Color.blue(c)) / 255.0
}
