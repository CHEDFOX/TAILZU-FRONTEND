package com.tulmi.app.keyboard

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.PopupMenu
import android.widget.TextView
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Personality quick-swap row above the keyboard keys.
 *
 * Backend contract (identical to iOS TulmiPersonalityRow.swift):
 *   kb.personality.pinned    Array<{ id, name, emoji, tone }>
 *   kb.personality.activeId  currently-selected preset id
 *   kb.personality.tones     Ordered list of tone { id, label } — "None" first
 *
 * Interactions:
 *   • Tap → switch active preset. Fires [onSelect] with (presetId, null) so
 *     the caller uses the preset's default tone.
 *   • Hold (kb.personalityRow.longPressSec) → the tone sheet springs out of
 *     the chip over the frosted keyboard; a pick fires (presetId, tone).
 *
 * No hardcoded chips, no hardcoded tones, no hardcoded colors. Every visible
 * value comes from [update] or from a kb.personalityRow.* knob — the iOS row's
 * keys, with its meanings and defaults (sizes, the sheet's colour and shadow,
 * the animation). If the backend clears the pinned list, the row hides itself.
 */
class TulmiPersonalityRow @JvmOverloads constructor(
    context: Context,
    attrs: android.util.AttributeSet? = null,
) : HorizontalScrollView(context, attrs) {

    /** A single chip. Mirrors TulmiPersonalityRow.ChipData on iOS. */
    data class ChipData(
        val id: String,
        val name: String,
        val emoji: String,
        val tone: String,
    )

    /** Single tone in the long-press popover. */
    data class Tone(
        val id: String,
        val label: String,
    )

    /** Fired on tap (tone = null → preset's default) or on tone pick. */
    var onSelect: ((presetId: String, tone: String?) -> Unit)? = null

    /**
     * Where the search for the sheet's host starts. The renderer points it at
     * the frame the keyboard sits in, outside the tree a rebuild empties, so a
     * pick (which rebuilds) does not tear the sheet down mid-animation.
     */
    var overlayHost: (() -> View?)? = null

    private val stack = LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        val marginH = dp(knobFloat("kb.personalityRow.marginH", 8f))
        val marginV = dp(knobFloat("kb.personalityRow.marginV", 4f))
        setPadding(marginH, marginV, marginH, marginV)
    }

    private var chips: List<ChipData> = emptyList()
    private var tones: List<Tone>? = null
    private var activeId: String = ""
    private var accent: Int = Color.WHITE
    private var chipBg: Int = withAlpha(Color.WHITE, knobFloat("kb.personalityRow.chipBgAlpha", 0.09f))
    private var chipFg: Int = withAlpha(Color.WHITE, knobFloat("kb.personalityRow.chipFgAlpha", 0.9f))

    /** Frosted scrim + tone sheet shown over the whole keyboard on a hold. */
    private var sheet: TulmiToneSheet? = null

    init {
        isHorizontalScrollBarEnabled = false
        overScrollMode = OVER_SCROLL_NEVER
        addView(
            stack,
            ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        visibility = View.GONE
    }

    /**
     * Update the row. [chips] come from the backend keyboard-config flags —
     * this view holds no defaults for them. [tones] is what a chip's sheet
     * offers: null when the keyboard offers no tones (a hold then does
     * nothing), the server's list, or empty when the server offers tones but
     * sent no list — then its fallback pair, kb.personalityRow.fallbackTone*.
     */
    fun update(
        chips: List<ChipData>,
        tones: List<Tone>?,
        activeId: String,
        accentColor: Int,
        chipBgColor: Int,
        chipFgColor: Int,
    ) {
        this.chips = chips
        this.tones = tones
        this.activeId = activeId
        this.accent = accentColor
        this.chipBg = chipBgColor
        this.chipFg = chipFgColor
        rebuild()
    }

    /** kb.personalityRow.height tall, unless the server's node sized the row. */
    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val mode = MeasureSpec.getMode(heightMeasureSpec)
        if (mode == MeasureSpec.EXACTLY) {
            super.onMeasure(widthMeasureSpec, heightMeasureSpec)
            return
        }
        var h = dp(knobFloat("kb.personalityRow.height", 36f)).coerceAtLeast(0)
        if (mode == MeasureSpec.AT_MOST) h = h.coerceAtMost(MeasureSpec.getSize(heightMeasureSpec))
        super.onMeasure(widthMeasureSpec, MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY))
    }

    private fun rebuild() {
        stack.removeAllViews()
        if (chips.isEmpty()) {
            visibility = View.GONE
            return
        }
        visibility = View.VISIBLE

        chips.forEachIndexed { i, chip ->
            val v = chipView(chip, isActive = chip.id == activeId)
            if (i > 0) {
                val gap = View(context)
                stack.addView(gap, LinearLayout.LayoutParams(dp(knobFloat("kb.personalityRow.spacing", 6f)), 1))
            }
            stack.addView(v)
        }
    }

    private fun chipView(chip: ChipData, isActive: Boolean): TextView {
        val tv = TextView(context)
        tv.text = if (chip.emoji.isNotEmpty()) "${chip.emoji} ${chip.name}" else chip.name
        // The active chip is the accent at activeAlpha, its text black or
        // white against it, as on iOS.
        tv.setTextColor(if (isActive) readableOn(accent) else chipFg)
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, knobFloat("kb.personalityRow.chipFontSize", 12f))
        tv.setTypeface(Typeface.DEFAULT, if (isActive) Typeface.BOLD else Typeface.NORMAL)
        tv.gravity = Gravity.CENTER
        val chipPadH = dp(knobFloat("kb.personalityRow.chipPadH", 10f))
        val chipPadV = dp(knobFloat("kb.personalityRow.chipPadV", 5f))
        tv.setPadding(chipPadH, chipPadV, chipPadH, chipPadV)
        tv.background = pill(
            fill = if (isActive) withAlpha(accent, knobFloat("kb.personalityRow.activeAlpha", 0.9f)) else chipBg,
            radiusDp = knobFloat("kb.personalityRow.chipRadius", 14f),
        )

        // Tap → switch. Hold → tone sheet.
        tv.setOnClickListener {
            it.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
            onSelect?.invoke(chip.id, null)
        }
        bindHold(tv) { showTonePopover(tv, chip) }
        return tv
    }

    /**
     * [onHold] after an unbroken press of kb.personalityRow.longPressSec — the
     * server's threshold, not the system's long-press timeout — and the
     * release that follows is not also a tap. Moving past the touch slop, or
     * the row taking the drag to scroll, calls it off.
     */
    private fun bindHold(v: View, onHold: () -> Unit) {
        val holdMs = (knobFloat("kb.personalityRow.longPressSec", 0.35f) * 1000f).toLong().coerceIn(50L, 10_000L)
        val slop = ViewConfiguration.get(context).scaledTouchSlop
        var fired = false
        var downX = 0f
        var downY = 0f
        val hold = Runnable {
            fired = true
            // Runs straight off the looper: nothing in a sheet may take the keyboard down.
            try { onHold() } catch (t: Throwable) { android.util.Log.w("SDUI", "personality sheet failed: ${t.message}") }
        }
        v.setOnTouchListener { view, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    fired = false
                    downX = e.x
                    downY = e.y
                    view.postDelayed(hold, holdMs)
                    false
                }
                MotionEvent.ACTION_MOVE -> {
                    if (!fired && (abs(e.x - downX) > slop || abs(e.y - downY) > slop)) view.removeCallbacks(hold)
                    false
                }
                MotionEvent.ACTION_UP -> {
                    view.removeCallbacks(hold)
                    if (fired) {
                        // The view sees a cancel: its pressed state and the tap clear.
                        val cancel = MotionEvent.obtain(e)
                        cancel.action = MotionEvent.ACTION_CANCEL
                        view.onTouchEvent(cancel)
                        cancel.recycle()
                        true
                    } else false
                }
                MotionEvent.ACTION_CANCEL -> {
                    view.removeCallbacks(hold)
                    false
                }
                else -> false
            }
        }
    }

    /**
     * What the sheet offers: the server's tones, else its fallback pair of
     * lists (ids and labels, zipped), as on iOS. Nothing at all when the
     * keyboard offers no tones.
     */
    private fun sheetTones(): List<Tone> {
        val server = tones ?: return emptyList()
        if (server.isNotEmpty()) return server
        val ids = knobStrings("kb.personalityRow.fallbackToneIds", listOf(
            "none", "formal", "casual", "very-casual", "excited",
        ))
        val labels = knobStrings("kb.personalityRow.fallbackToneLabels", listOf(
            "None · raw", "Formal", "Casual", "Very Casual", "Excited",
        ))
        return ids.zip(labels) { id, label -> Tone(id, label) }
    }

    private fun showTonePopover(anchor: View, chip: ChipData) {
        val tones = sheetTones()
        if (tones.isEmpty()) return
        anchor.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)

        // Cover the whole keyboard so the sheet floats over a frosted backdrop.
        // If we can't find a host container, fall back to a plain menu.
        val host = findOverlayHost()
        if (host == null) { legacyTonePopup(anchor, chip, tones); return }
        dismissSheet(animated = false)

        // Just above the held chip, from its left edge, kept inside the host.
        val edge = dp(knobFloat("kb.personalityRow.sheetEdgeMin", 8f))
        val gap = dp(knobFloat("kb.personalityRow.sheetGap", 6f))
        val s = TulmiToneSheet(sheetLook())
        sheet = s
        val shown = s.show(host, buildToneSheet(chip, tones), anchor) { panel, a ->
            val lp = panel.layoutParams as FrameLayout.LayoutParams
            val maxLeft = (host.width - panel.width - edge).coerceAtLeast(edge)
            lp.leftMargin = a.left.coerceIn(edge, maxLeft)
            lp.topMargin = (a.top - gap - panel.height).coerceAtLeast(edge)
            panel.layoutParams = lp
        }
        if (!shown) {
            sheet = null
            legacyTonePopup(anchor, chip, tones)
        }
    }

    /**
     * The sheet's look and motion. The panel is a grey (sheetWhite) at
     * sheetAlpha with a black shadow; it grows from popScale, popDrop below
     * where it settles, on a popInSec spring (popDamping, popVelocity), and
     * shrinks back over popOutSec as the frost (blurInSec in) clears.
     */
    private fun sheetLook(): TulmiToneSheet.Look {
        val white = unit(knobFloat("kb.personalityRow.sheetWhite", 0.09f))
        return TulmiToneSheet.Look(
            panelColor = Color.argb(unit(knobFloat("kb.personalityRow.sheetAlpha", 0.96f)), white, white, white),
            radius = dpf(knobFloat("kb.personalityRow.sheetRadius", 12f)),
            shadowColor = Color.BLACK,
            shadowOpacity = knobFloat("kb.personalityRow.sheetShadowOpacity", 0.35f),
            shadowRadius = dpf(knobFloat("kb.personalityRow.sheetShadowRadius", 12f)),
            shadowDy = dpf(knobFloat("kb.personalityRow.sheetShadowY", 6f)),
            blurRadius = knobFloat("kb.personalityRow.blurRadius", 22f),
            scrimColor = parseHex(knobString("kb.personalityRow.scrimColor", "#0000008C")),
            blurInMs = ms(knobFloat("kb.personalityRow.blurInSec", 0.16f)),
            openMs = ms(knobFloat("kb.personalityRow.popInSec", 0.42f)),
            closeMs = ms(knobFloat("kb.personalityRow.popOutSec", 0.2f)),
            damping = knobFloat("kb.personalityRow.popDamping", 0.72f),
            velocity = knobFloat("kb.personalityRow.popVelocity", 0.6f),
            collapsedScale = knobFloat("kb.personalityRow.popScale", 0.06f),
            collapsedDy = dpf(knobFloat("kb.personalityRow.popDrop", 14f)),
        )
    }

    private fun buildToneSheet(chip: ChipData, tones: List<Tone>): View {
        val list = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            val pad = dp(knobFloat("kb.personalityRow.sheetPadding", 6f))
            setPadding(pad, pad, pad, pad)
            minimumWidth = dp(knobFloat("kb.personalityRow.sheetMinWidth", 150f))
        }
        val spacing = dp(knobFloat("kb.personalityRow.sheetSpacing", 2f))
        val fontSize = knobFloat("kb.personalityRow.toneFontSize", 13f)
        val padV = dp(knobFloat("kb.personalityRow.tonePadV", 8f))
        val padH = dp(knobFloat("kb.personalityRow.tonePadH", 14f))
        val color = parseHex(knobString("kb.personalityRow.itemColor", "#FFFFFF"))
        tones.forEach { t ->
            val item = TextView(context).apply {
                text = t.label
                setTextColor(color)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, fontSize)
                typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
                setPadding(padH, padV, padH, padV)
                gravity = Gravity.START or Gravity.CENTER_VERTICAL
                isClickable = true
                setOnClickListener {
                    it.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
                    dismissSheet(animated = true)
                    onSelect?.invoke(chip.id, t.id)
                    activeId = chip.id
                    rebuild()
                }
            }
            val lp = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            )
            if (list.childCount > 0) lp.topMargin = spacing
            list.addView(item, lp)
        }
        return list
    }

    private fun legacyTonePopup(anchor: View, chip: ChipData, tones: List<Tone>) {
        val popup = PopupMenu(context, anchor)
        tones.forEachIndexed { idx, t -> popup.menu.add(0, idx, idx, t.label) }
        popup.setOnMenuItemClickListener { item ->
            val tone = tones.getOrNull(item.itemId) ?: return@setOnMenuItemClickListener false
            onSelect?.invoke(chip.id, tone.id)
            true
        }
        try { popup.show() } catch (_: Throwable) { /* no window to show it in */ }
    }

    /**
     * The view the sheet and its scrim cover. Walking up from [overlayHost]
     * (else this row's parent), the first FrameLayout taller than
     * kb.personalityRow.overlayMinHeight — big enough to float a menu in, as
     * on iOS — else the outermost FrameLayout on the way.
     */
    private fun findOverlayHost(): FrameLayout? {
        val minHeight = dp(knobFloat("kb.personalityRow.overlayMinHeight", 120f))
        var v: View? = overlayHost?.invoke() ?: (parent as? View)
        var outermost: FrameLayout? = null
        while (v != null) {
            if (v is FrameLayout) {
                if (v.height > minHeight) return v
                outermost = v
            }
            v = v.parent as? View
        }
        return outermost
    }

    private fun dismissSheet(animated: Boolean) {
        sheet?.dismiss(animated)
        sheet = null
    }

    // -- helpers -----------------------------------------------------------

    private fun dp(value: Float): Int =
        (value * resources.displayMetrics.density).toInt()

    private fun dpf(value: Float): Float =
        value * resources.displayMetrics.density

    /** Seconds (the iOS knobs' unit) to animator milliseconds. */
    private fun ms(sec: Float): Long =
        if (sec.isNaN()) 0L else (sec.coerceIn(0f, 10f) * 1000f).toLong()

    /** A 0…1 knob as a colour channel. */
    private fun unit(f: Float): Int =
        if (f.isNaN()) 0 else (f.coerceIn(0f, 1f) * 255f).roundToInt()

    /** [color] with its alpha replaced, as UIColor.withAlphaComponent does. */
    private fun withAlpha(color: Int, alpha: Float): Int =
        Color.argb(unit(alpha), Color.red(color), Color.green(color), Color.blue(color))

    /**
     * Black or white, whichever reads on [color]: the luminance pick the
     * renderer's readableOn makes, cut at kb.personalityRow.contrastThreshold,
     * so the active chip's text stays legible on any accent the server sends.
     */
    private fun readableOn(color: Int): Int {
        val lum = 0.2126f * Color.red(color) / 255f +
            0.7152f * Color.green(color) / 255f +
            0.0722f * Color.blue(color) / 255f
        return if (lum > knobFloat("kb.personalityRow.contrastThreshold", 0.55f)) Color.BLACK else Color.WHITE
    }

    private fun pill(fill: Int, radiusDp: Float): GradientDrawable =
        GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = radiusDp * resources.displayMetrics.density
            setColor(fill)
        }
}
