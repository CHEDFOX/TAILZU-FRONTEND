package com.tulmi.app.keyboard

import android.content.Context
import android.graphics.Color
import android.graphics.RenderEffect
import android.graphics.Shader
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.util.TypedValue
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.animation.AnticipateInterpolator
import android.view.animation.OvershootInterpolator
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.PopupMenu
import android.widget.TextView

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
 *   • Long-press → PopupMenu of tones, tap fires (presetId, tone).
 *
 * No hardcoded chips, no hardcoded tones, no hardcoded colors. Every visible
 * value comes from [update] or from a kb.personalityRow.* knob (sizes, the
 * sheet's colours, the animation). If the backend clears the pinned list, the
 * row hides itself.
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

    private val stack = LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        val pad = dp(knobFloat("kb.personalityRow.padH", 8f))
        val padV = dp(knobFloat("kb.personalityRow.padV", 4f))
        setPadding(pad, padV, pad, padV)
    }

    private var chips: List<ChipData> = emptyList()
    private var tones: List<Tone> = emptyList()
    private var activeId: String = ""
    private var accent: Int = Color.WHITE
    private var chipBg: Int = Color.argb(23, 255, 255, 255)   // 0.09 alpha
    private var chipFg: Int = Color.argb(229, 255, 255, 255)  // 0.9 alpha

    /** Frosted scrim + tone sheet shown over the whole keyboard on long-press. */
    private var scrim: FrameLayout? = null
    private var blurredKids: List<View> = emptyList()

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
     * Update the row. [chips] and [tones] both come from the backend
     * keyboard-config flags — this view holds no defaults for either.
     */
    fun update(
        chips: List<ChipData>,
        tones: List<Tone>,
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
                stack.addView(gap, LinearLayout.LayoutParams(dp(knobFloat("kb.personalityRow.gap", 6f)), 1))
            }
            stack.addView(v)
        }
    }

    private fun chipView(chip: ChipData, isActive: Boolean): TextView {
        val tv = TextView(context)
        tv.text = if (chip.emoji.isNotEmpty()) "${chip.emoji} ${chip.name}" else chip.name
        tv.setTextColor(if (isActive) accent else chipFg)
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, knobFloat("kb.personalityRow.fontSize", 13f))
        tv.setTypeface(Typeface.DEFAULT, if (isActive) Typeface.BOLD else Typeface.NORMAL)
        tv.gravity = Gravity.CENTER
        val chipPadH = dp(knobFloat("kb.personalityRow.chipPadH", 14f))
        val chipPadV = dp(knobFloat("kb.personalityRow.chipPadV", 7f))
        tv.setPadding(chipPadH, chipPadV, chipPadH, chipPadV)
        tv.background = pill(
            fill = if (isActive) blend(chipBg, accent, knobFloat("kb.personalityRow.activeBlend", 0.24f)) else chipBg,
            stroke = if (isActive) accent else Color.TRANSPARENT,
            radiusDp = knobFloat("kb.personalityRow.chipRadius", 999f),
        )

        // Tap → switch. Long-press → tone popover.
        tv.setOnClickListener {
            it.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
            onSelect?.invoke(chip.id, null)
        }
        tv.setOnLongClickListener {
            showTonePopover(tv, chip)
            true
        }
        return tv
    }

    private fun showTonePopover(anchor: View, chip: ChipData) {
        if (tones.isEmpty()) return
        anchor.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)

        // Cover the whole keyboard so the sheet floats over a frosted/dimmed
        // backdrop. If we can't find a host container, fall back to a plain menu.
        val host = findOverlayHost()
        if (host == null) { legacyTonePopup(anchor, chip); return }
        dismissScrim(animated = false)

        // Blur the keyboard behind (API 31+); dark scrim carries the "pushed back"
        // read on older devices. Snapshot existing children so only they blur —
        // not the scrim we add on top.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val kids = ArrayList<View>(host.childCount)
            for (i in 0 until host.childCount) kids.add(host.getChildAt(i))
            blurredKids = kids
            val r = knobFloat("kb.personalityRow.blurRadius", 22f)
            val fx = RenderEffect.createBlurEffect(r, r, Shader.TileMode.CLAMP)
            kids.forEach { it.setRenderEffect(fx) }
        }

        val scrimView = FrameLayout(context).apply {
            setBackgroundColor(parseHex(knobString("kb.personalityRow.scrimColor", "#0000008C")))
            isClickable = true
            alpha = 0f
            setOnClickListener { dismissScrim(animated = true) }
        }
        host.addView(
            scrimView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            ),
        )
        scrim = scrimView

        val sheet = buildToneSheet(chip)
        scrimView.addView(
            sheet,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
            ),
        )

        // Position the sheet just above the long-pressed chip, then "suck it out"
        // of the chip: scale up from a near-zero point at its bottom-left.
        val hostLoc = IntArray(2); host.getLocationInWindow(hostLoc)
        val anchorLoc = IntArray(2); anchor.getLocationInWindow(anchorLoc)
        scrimView.animate().alpha(1f).setDuration(knobLong("kb.personalityRow.scrimFadeMs", 160L)).start()
        sheet.post {
            val lp = sheet.layoutParams as FrameLayout.LayoutParams
            lp.leftMargin = (anchorLoc[0] - hostLoc[0]).coerceAtLeast(dp(8f))
            lp.topMargin = (anchorLoc[1] - hostLoc[1] - sheet.height - dp(6f)).coerceAtLeast(dp(8f))
            sheet.layoutParams = lp
            sheet.pivotX = 0f
            sheet.pivotY = sheet.height.toFloat()
            val from = knobFloat("kb.personalityRow.popScale", 0.06f)
            sheet.scaleX = from
            sheet.scaleY = from
            sheet.alpha = 0f
            sheet.animate()
                .scaleX(1f).scaleY(1f).alpha(1f)
                .setInterpolator(OvershootInterpolator(knobFloat("kb.personalityRow.popOvershoot", 1.6f)))
                .setDuration(knobLong("kb.personalityRow.popMs", 300L))
                .start()
        }
    }

    private fun buildToneSheet(chip: ChipData): LinearLayout {
        val sheet = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            background = pill(
                parseHex(knobString("kb.personalityRow.sheetBg", "#17171AF5")),
                Color.TRANSPARENT,
                knobFloat("kb.personalityRow.sheetRadius", 14f),
            )
            val pad = dp(knobFloat("kb.personalityRow.sheetPad", 6f))
            setPadding(pad, pad, pad, pad)
            elevation = dp(knobFloat("kb.personalityRow.sheetElevation", 10f)).toFloat()
        }
        tones.forEach { t ->
            val item = TextView(context).apply {
                text = t.label
                setTextColor(parseHex(knobString("kb.personalityRow.itemColor", "#FFFFFF")))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, knobFloat("kb.personalityRow.itemFontSize", 14f))
                setPadding(dp(16f), dp(9f), dp(24f), dp(9f))
                gravity = Gravity.START or Gravity.CENTER_VERTICAL
                isClickable = true
                setOnClickListener {
                    it.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
                    onSelect?.invoke(chip.id, t.id)
                    activeId = chip.id
                    rebuild()
                    dismissScrim(animated = true)
                }
            }
            sheet.addView(
                item,
                LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                ),
            )
        }
        return sheet
    }

    private fun legacyTonePopup(anchor: View, chip: ChipData) {
        val popup = PopupMenu(context, anchor)
        tones.forEachIndexed { idx, t -> popup.menu.add(0, idx, idx, t.label) }
        popup.setOnMenuItemClickListener { item ->
            val tone = tones.getOrNull(item.itemId) ?: return@setOnMenuItemClickListener false
            onSelect?.invoke(chip.id, tone.id)
            true
        }
        popup.show()
    }

    /** Largest FrameLayout ancestor (the IME input view) to host the overlay. */
    private fun findOverlayHost(): FrameLayout? {
        var v: View? = this
        var best: FrameLayout? = null
        while (v != null) {
            if (v is FrameLayout) best = v
            v = v.parent as? View
        }
        return best
    }

    private fun dismissScrim(animated: Boolean) {
        val scrimView = scrim
        scrim = null
        if (scrimView == null) { clearBlur(); return }
        if (!animated) {
            (scrimView.parent as? ViewGroup)?.removeView(scrimView)
            clearBlur()
            return
        }
        // Reverse suction: the sheet collapses back toward the chip as frost clears.
        val to = knobFloat("kb.personalityRow.popScale", 0.06f)
        val ms = knobLong("kb.personalityRow.dismissMs", 190L)
        (scrimView.getChildAt(0))?.animate()
            ?.scaleX(to)?.scaleY(to)?.alpha(0f)
            ?.setInterpolator(AnticipateInterpolator(knobFloat("kb.personalityRow.dismissAnticipate", 1.1f)))
            ?.setDuration(ms)?.start()
        scrimView.animate().alpha(0f).setDuration(ms).withEndAction {
            (scrimView.parent as? ViewGroup)?.removeView(scrimView)
            clearBlur()
        }.start()
    }

    private fun clearBlur() {
        if (blurredKids.isEmpty()) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            blurredKids.forEach { it.setRenderEffect(null) }
        }
        blurredKids = emptyList()
    }

    // -- helpers -----------------------------------------------------------

    private fun dp(value: Float): Int =
        (value * resources.displayMetrics.density).toInt()

    private fun pill(fill: Int, stroke: Int, radiusDp: Float): GradientDrawable =
        GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = radiusDp * resources.displayMetrics.density
            setColor(fill)
            if (stroke != Color.TRANSPARENT) setStroke(dp(1f), stroke)
        }

    private fun blend(a: Int, b: Int, t: Float): Int {
        val u = 1 - t
        return Color.argb(
            (Color.alpha(a) * u + Color.alpha(b) * t).toInt().coerceIn(0, 255),
            (Color.red(a)   * u + Color.red(b)   * t).toInt().coerceIn(0, 255),
            (Color.green(a) * u + Color.green(b) * t).toInt().coerceIn(0, 255),
            (Color.blue(a)  * u + Color.blue(b)  * t).toInt().coerceIn(0, 255),
        )
    }
}
