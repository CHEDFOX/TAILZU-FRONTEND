package com.tulmi.app.keyboard

import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RenderEffect
import android.graphics.Shader
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import android.util.TypedValue
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject

/**
 * SDUIRenderer — the Server-Driven UI renderer for the Tulmi Android IME.
 *
 * Mirrors the iOS SDUI renderer. Walks a KeyboardNode tree pushed from the
 * backend and produces the actual Android View subtree. The IME opts in per
 * config: when `features.sdui == true` AND `root != null`, `onCreateInputView`
 * hands the container to this renderer instead of inflating the hardcoded
 * keyboard.xml layout. When SDUI is off (or the tree is missing), the existing
 * hand-built path stays intact as fallback.
 *
 * Serialization: the project has no kotlinx-serialization / Moshi on the
 * classpath (see Net.kt using org.json.JSONObject). To avoid touching the
 * plugin/gradle wiring we parse the tree with org.json into typed data classes
 * defined below, and keep runtime dependencies zero-adds.
 */

// ===========================================================================
// State — mirrors the iOS KBState. `hasFullAccess` is always true on Android
// (no equivalent of iOS's Full Access restriction); kept for parity so the
// same server-side conditions work verbatim across platforms.
// ===========================================================================
class KBState(
    var shift: Boolean = false,
    var capsLock: Boolean = false,
    var layoutId: String = "en",
    var dictating: Boolean = false,
    var refining: Boolean = false,
    var hasFullAccess: Boolean = true,
    var status: String = "",
    var micLevel: Float = 0f,
    var suggestions: List<String> = emptyList(),
)

// ===========================================================================
// Host interface — the IME implements this; the renderer calls back into it
// for input-connection ops, dictation/refine, layout switching, and state
// re-renders. Keeping this narrow means the renderer can be unit-tested with
// a fake host if we ever want to.
// ===========================================================================
interface KBHost {
    fun context(): Context
    fun ic(): InputConnection?
    fun startDictation()
    fun stopDictation()
    fun runRefine()
    fun switchLayout(language: String?)
    fun cycleLayout()
    fun showLanguageMenu()
    fun setStatus(text: String)
    fun state(): KBState
    fun config(): KBConfig
    fun rootView(): View?
    fun onStateChanged()
}

// ===========================================================================
// Typed model — parsed from the backend JSON. Order-independent bags stay as
// Map<String, Any?> because the schema is intentionally loose (matches the
// TS ThemeTokens.style/props "polymorphic bag" model).
// ===========================================================================

data class KBConfig(
    val theme: KBTheme,
    val features: Map<String, Boolean>,
    val labels: Map<String, String>,
    val flags: Map<String, Any?>,
    val layouts: List<KBLayout>,
    val root: KBNode?,
    val actions: Map<String, KBActionSpec>,
)

data class KBTheme(
    val background: String,
    val key: String,
    val keyText: String,
    val accent: String,
    val keyPressed: String,
    val backgroundEffect: KBEffect?,
    val keyEffect: KBEffect?,
    val keyRadius: Float,
    val keyShadow: Boolean,
)

sealed class KBEffect {
    data class Solid(val color: String) : KBEffect()
    data class Blur(val style: String) : KBEffect()
    data class Gradient(val colors: List<String>, val direction: String = "vertical") : KBEffect()
}

data class KBLayout(
    val language: String,
    val displayName: String?,
    val rows: List<List<String>>,
)

data class KBNode(
    val type: String,
    val id: String?,
    val props: Map<String, Any?>,
    val style: Map<String, Any?>,
    val children: List<KBNode>,
    val bind: Map<String, String>,
    val on: Map<String, KBActionRef>,
    val effect: KBEffect?,
    val visibleIf: KBCondition?,
)

sealed class KBActionRef {
    data class Named(val name: String) : KBActionRef()
    data class Inline(val spec: KBActionSpec) : KBActionRef()
}

sealed class KBActionSpec {
    data class InsertText(val text: String) : KBActionSpec()
    data class InsertKey(val char: String) : KBActionSpec()
    object DeleteBackward : KBActionSpec()
    object DeleteWord : KBActionSpec()
    object Shift : KBActionSpec()
    object CapsLock : KBActionSpec()
    object Return : KBActionSpec()
    data class SwitchLayout(val language: String?) : KBActionSpec()
    object ShowLanguageMenu : KBActionSpec()
    object StartDictation : KBActionSpec()
    object StopDictation : KBActionSpec()
    object RunRefine : KBActionSpec()
    data class OpenApp(val screenId: String?) : KBActionSpec()
    object OpenSettings : KBActionSpec()
    data class Haptic(val style: String) : KBActionSpec()
    data class Sequence(val actions: List<KBActionRef>) : KBActionSpec()
    data class Condition(
        val cond: KBCondition,
        val then: KBActionRef,
        val otherwise: KBActionRef?,
    ) : KBActionSpec()
}

sealed class KBCondition {
    data class Eq(val path: String, val value: Any?) : KBCondition()
    data class Neq(val path: String, val value: Any?) : KBCondition()
    data class Gt(val path: String, val value: Double) : KBCondition()
    data class Gte(val path: String, val value: Double) : KBCondition()
    data class Lt(val path: String, val value: Double) : KBCondition()
    data class Lte(val path: String, val value: Double) : KBCondition()
    data class In(val path: String, val values: List<Any?>) : KBCondition()
    data class Contains(val path: String, val value: String) : KBCondition()
    data class Truthy(val path: String) : KBCondition()
    data class Falsy(val path: String) : KBCondition()
    data class Flag(val name: String) : KBCondition()
    data class Platform(val name: String) : KBCondition()
    data class Not(val inner: KBCondition) : KBCondition()
    data class All(val conds: List<KBCondition>) : KBCondition()
    data class AnyOf(val conds: List<KBCondition>) : KBCondition()
}

// ===========================================================================
// The renderer itself. Constructed with a host + config; `mount` attaches the
// root tree to a container; `stateChanged` re-walks the tree (cheap re-render).
// ===========================================================================
class SDUIRenderer(
    private val host: KBHost,
    private var kbConfig: KBConfig,
    private val container: ViewGroup,
) {
    private var rootNode: KBNode? = null

    // Long-press repeat handler for backspace. Held here rather than per-view so
    // we don't leak posts across re-renders when the tree recomputes.
    private val handler = android.os.Handler(android.os.Looper.getMainLooper())

    /** Attach the root tree. Called from the IME after `parseKBConfig`. */
    fun mount(root: KBNode) {
        rootNode = root
        redraw()
    }

    /** Cheap re-render: clear + walk again. Called on any state mutation. */
    fun stateChanged() {
        redraw()
    }

    /** Swap in a freshly-fetched config (e.g. background refetch returned). */
    fun updateConfig(cfg: KBConfig) {
        kbConfig = cfg
        cfg.root?.let { rootNode = it }
        redraw()
    }

    private fun redraw() {
        // Clear any pending long-press repeats attached to the previous view
        // tree so they don't fire against views that no longer exist.
        handler.removeCallbacksAndMessages(null)
        container.removeAllViews()
        applyEffect(container, kbConfig.theme.backgroundEffect ?: KBEffect.Solid(kbConfig.theme.background))
        rootNode?.let { render(it, container) }
    }

    // -----------------------------------------------------------------------
    // Render dispatch — one method per component. Unknown types render as a
    // small red View so schema mismatches surface visibly instead of silently
    // producing blank space.
    // -----------------------------------------------------------------------
    private fun render(node: KBNode, parent: ViewGroup) {
        node.visibleIf?.let { if (!evaluate(it)) return }
        when (node.type) {
            "Container" -> renderContainer(node, parent)
            "Column" -> renderColumn(node, parent)
            "Row" -> renderRow(node, parent)
            "Spacer" -> renderSpacer(node, parent)
            "LetterKey" -> renderLetterKey(node, parent)
            "IconKey" -> renderIconKey(node, parent)
            "SpaceKey" -> renderSpaceKey(node, parent)
            "ShiftKey" -> renderShiftKey(node, parent)
            "ReturnKey" -> renderReturnKey(node, parent)
            "BackspaceKey" -> renderBackspaceKey(node, parent)
            "GlobeKey" -> renderGlobeKey(node, parent)
            "MicKey" -> renderMicKey(node, parent)
            "RefineKey" -> renderRefineKey(node, parent)
            "SuggestionBar" -> renderSuggestionBar(node, parent)
            "Waveform" -> renderWaveform(node, parent)
            "StatusLabel" -> renderStatusLabel(node, parent)
            "Divider" -> renderDivider(node, parent)
            "BlurBackdrop" -> renderBlurBackdrop(node, parent)
            else -> renderUnknown(node, parent)
        }
    }

    /** Container = vertical LinearLayout. Same as Column. */
    private fun renderContainer(node: KBNode, parent: ViewGroup) = renderColumn(node, parent)

    /** Column = vertical LinearLayout. weightSum honored via style.flex on children. */
    private fun renderColumn(node: KBNode, parent: ViewGroup) {
        val ll = LinearLayout(host.context()).apply {
            orientation = LinearLayout.VERTICAL
        }
        applyBackgroundEffect(ll, node)
        addChildWithStyle(parent, ll, node.style, isRow = parent.isHorizontal())
        applyPadding(ll, node.style)
        applyEvents(ll, node)
        for (c in node.children) render(c, ll)
    }

    /** Row = horizontal LinearLayout. */
    private fun renderRow(node: KBNode, parent: ViewGroup) {
        val ll = LinearLayout(host.context()).apply {
            orientation = LinearLayout.HORIZONTAL
        }
        applyBackgroundEffect(ll, node)
        addChildWithStyle(parent, ll, node.style, isRow = parent.isHorizontal())
        applyPadding(ll, node.style)
        applyEvents(ll, node)
        for (c in node.children) render(c, ll)
    }

    /** Spacer = flex-weighted empty View. Direction inferred from parent orientation. */
    private fun renderSpacer(node: KBNode, parent: ViewGroup) {
        val v = View(host.context())
        val flex = numFromStyle(node.style["flex"]) ?: 1f
        val lp: ViewGroup.LayoutParams = if (parent.isHorizontal()) {
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, flex)
        } else {
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, flex)
        }
        v.layoutParams = lp
        parent.addView(v)
    }

    /** LetterKey — Button labeled with props.char (capitalized on shift/caps). */
    private fun renderLetterKey(node: KBNode, parent: ViewGroup) {
        val raw = (node.props["char"] as? String) ?: ""
        val label = if (host.state().shift || host.state().capsLock) raw.uppercase() else raw.lowercase()
        val b = keyButton(label, node)
        b.setOnClickListener {
            hapticTap(b)
            insertText(label)
            if (host.state().shift && !host.state().capsLock) {
                host.state().shift = false
                host.onStateChanged()
            }
            invokeEvent(node, "onPress")
        }
        b.setOnLongClickListener { invokeEvent(node, "onLongPress"); true }
        addChildWithStyle(parent, b, node.style, isRow = parent.isHorizontal())
    }

    /**
     * IconKey — ImageButton driven by props.icon (mapped via a tiny registry to
     * Android system drawables). If a mapping is missing we fall back to a Button
     * showing the icon key as text so the schema mismatch is still visible.
     */
    private fun renderIconKey(node: KBNode, parent: ViewGroup) {
        val icon = (node.props["icon"] as? String) ?: ""
        val resId = iconRegistry[icon]
        val view: View = if (resId != null) {
            ImageButton(host.context()).apply {
                setImageResource(resId)
                background = keyBackground(node)
            }
        } else {
            keyButton(icon, node)
        }
        view.setOnClickListener {
            hapticTap(view)
            invokeEvent(node, "onPress")
        }
        view.setOnLongClickListener { invokeEvent(node, "onLongPress"); true }
        addChildWithStyle(parent, view, node.style, isRow = parent.isHorizontal())
    }

    /** SpaceKey — wide button using labels.space or "space" as fallback. */
    private fun renderSpaceKey(node: KBNode, parent: ViewGroup) {
        val label = kbConfig.labels["space"] ?: "space"
        val b = keyButton(label, node)
        b.setOnClickListener {
            hapticTap(b)
            insertText(" ")
            invokeEvent(node, "onPress")
        }
        addChildWithStyle(parent, b, node.style, isRow = parent.isHorizontal())
    }

    /** ShiftKey — toggles state.shift; long-press → capsLock. */
    private fun renderShiftKey(node: KBNode, parent: ViewGroup) {
        val active = host.state().shift || host.state().capsLock
        val label = when {
            host.state().capsLock -> "⇪"
            host.state().shift -> "⇧"
            else -> "⇧"
        }
        val b = keyButton(label, node)
        if (active) b.setTextColor(Color.parseColor(kbConfig.theme.accent))
        b.setOnClickListener {
            hapticTap(b)
            val s = host.state()
            s.shift = !s.shift
            s.capsLock = false
            host.onStateChanged()
            invokeEvent(node, "onPress")
        }
        b.setOnLongClickListener {
            hapticTap(b)
            val s = host.state()
            s.capsLock = !s.capsLock
            s.shift = false
            host.onStateChanged()
            invokeEvent(node, "onLongPress")
            true
        }
        addChildWithStyle(parent, b, node.style, isRow = parent.isHorizontal())
    }

    /** ReturnKey — commits a newline. Label from labels.return. */
    private fun renderReturnKey(node: KBNode, parent: ViewGroup) {
        val label = kbConfig.labels["return"] ?: "return"
        val b = keyButton(label, node)
        b.setOnClickListener {
            hapticTap(b)
            host.ic()?.commitText("\n", 1)
            invokeEvent(node, "onPress")
        }
        addChildWithStyle(parent, b, node.style, isRow = parent.isHorizontal())
    }

    /** BackspaceKey — deletes; long-press repeats every ~50ms until release. */
    private fun renderBackspaceKey(node: KBNode, parent: ViewGroup) {
        val resId = iconRegistry["backspace"]
        val view: View = if (resId != null) {
            ImageButton(host.context()).apply {
                setImageResource(resId)
                background = keyBackground(node)
            }
        } else {
            keyButton("⌫", node)
        }
        view.setOnClickListener {
            hapticTap(view)
            host.ic()?.deleteSurroundingText(1, 0)
            invokeEvent(node, "onPress")
        }
        val repeat = object : Runnable {
            override fun run() {
                host.ic()?.deleteSurroundingText(1, 0)
                handler.postDelayed(this, 50)
            }
        }
        view.setOnLongClickListener {
            hapticTap(view)
            handler.postDelayed(repeat, 300)
            invokeEvent(node, "onLongPress")
            true
        }
        view.setOnTouchListener { _, e ->
            if (e.action == android.view.MotionEvent.ACTION_UP ||
                e.action == android.view.MotionEvent.ACTION_CANCEL
            ) {
                handler.removeCallbacks(repeat)
            }
            false
        }
        addChildWithStyle(parent, view, node.style, isRow = parent.isHorizontal())
    }

    /** GlobeKey — press = system IME picker; long-press = cycle layouts. */
    private fun renderGlobeKey(node: KBNode, parent: ViewGroup) {
        val resId = iconRegistry["globe"]
        val view: View = if (resId != null) {
            ImageButton(host.context()).apply {
                setImageResource(resId)
                background = keyBackground(node)
            }
        } else {
            keyButton("🌐", node)
        }
        view.setOnClickListener {
            hapticTap(view)
            val imm = host.context().getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
            imm?.showInputMethodPicker()
            invokeEvent(node, "onPress")
        }
        view.setOnLongClickListener {
            hapticTap(view)
            host.cycleLayout()
            invokeEvent(node, "onLongPress")
            true
        }
        addChildWithStyle(parent, view, node.style, isRow = parent.isHorizontal())
    }

    /** MicKey — toggles dictation. Uses state.dictating to decide start/stop. */
    private fun renderMicKey(node: KBNode, parent: ViewGroup) {
        val resId = iconRegistry["mic"]
        val view: View = if (resId != null) {
            ImageButton(host.context()).apply {
                setImageResource(resId)
                background = keyBackground(node)
            }
        } else {
            keyButton("🎙️", node)
        }
        view.setOnClickListener {
            hapticTap(view)
            if (host.state().dictating) host.stopDictation() else host.startDictation()
            invokeEvent(node, "onPress")
        }
        addChildWithStyle(parent, view, node.style, isRow = parent.isHorizontal())
    }

    /** RefineKey — triggers the existing refine path. */
    private fun renderRefineKey(node: KBNode, parent: ViewGroup) {
        val label = kbConfig.labels["refine"] ?: "✨"
        val b = keyButton(label, node)
        b.setOnClickListener {
            hapticTap(b)
            host.runRefine()
            invokeEvent(node, "onPress")
        }
        addChildWithStyle(parent, b, node.style, isRow = parent.isHorizontal())
    }

    /** SuggestionBar — horizontal scroll of chip buttons from state.suggestions. */
    private fun renderSuggestionBar(node: KBNode, parent: ViewGroup) {
        val scroll = HorizontalScrollView(host.context()).apply {
            isHorizontalScrollBarEnabled = false
        }
        val row = LinearLayout(host.context()).apply { orientation = LinearLayout.HORIZONTAL }
        scroll.addView(
            row,
            ViewGroup.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT),
        )
        for (s in host.state().suggestions) {
            val chip = Button(host.context()).apply {
                text = s
                background = keyBackground(node)
                setTextColor(parseHex(kbConfig.theme.keyText))
            }
            chip.setOnClickListener {
                hapticTap(chip)
                insertText(s)
            }
            val lp = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply { setMargins(dp(4), dp(4), dp(4), dp(4)) }
            row.addView(chip, lp)
        }
        addChildWithStyle(parent, scroll, node.style, isRow = parent.isHorizontal())
    }

    /** Waveform — N thin vertical bars scaled by state.micLevel. */
    private fun renderWaveform(node: KBNode, parent: ViewGroup) {
        val bars = (node.props["bars"] as? Number)?.toInt() ?: 24
        val color = (node.props["color"] as? String) ?: kbConfig.theme.accent
        val wf = WaveformView(host.context(), bars, parseHex(color)) { host.state().micLevel }
        addChildWithStyle(parent, wf, node.style, isRow = parent.isHorizontal())
    }

    /** StatusLabel — TextView bound to state.status. */
    private fun renderStatusLabel(node: KBNode, parent: ViewGroup) {
        val tv = TextView(host.context()).apply {
            text = host.state().status
            setTextColor(parseHex(kbConfig.theme.keyText))
        }
        applyTextStyle(tv, node.style)
        addChildWithStyle(parent, tv, node.style, isRow = parent.isHorizontal())
    }

    /** Divider — hairline strip. Uses theme.keyText @ low alpha unless overridden. */
    private fun renderDivider(node: KBNode, parent: ViewGroup) {
        val v = View(host.context())
        val bg = (node.style["bg"] as? String) ?: kbConfig.theme.keyText
        v.setBackgroundColor(parseHex(bg) and 0x33FFFFFF.toInt())
        val h = dp(1)
        val lp: ViewGroup.LayoutParams = if (parent.isHorizontal()) {
            LinearLayout.LayoutParams(h, ViewGroup.LayoutParams.MATCH_PARENT)
        } else {
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, h)
        }
        v.layoutParams = lp
        parent.addView(v)
    }

    /**
     * BlurBackdrop — approximates iOS UIVisualEffectView. On API 31+ we set a
     * RenderEffect blur; on older devices we drop back to a translucent solid.
     * Android has no true chromeMaterial equivalent, so blur radii are picked
     * to feel "in the family" per style rather than pixel-matching iOS.
     */
    private fun renderBlurBackdrop(node: KBNode, parent: ViewGroup) {
        val wrapper = FrameLayout(host.context())
        val backdrop = View(host.context())
        val style = (node.props["style"] as? String) ?: "regular"
        val (radius, fallbackAlpha) = when (style) {
            "systemUltraThinMaterial" -> 8f to 0x40
            "systemThinMaterial" -> 16f to 0x66
            "chromeMaterialLight" -> 24f to 0xB3
            "chromeMaterialDark" -> 24f to 0xB3
            else -> 20f to 0x99
        }
        val baseColor = if (style.contains("Light")) Color.WHITE else Color.BLACK
        backdrop.setBackgroundColor((fallbackAlpha shl 24) or (baseColor and 0x00FFFFFF))
        if (Build.VERSION.SDK_INT >= 31) {
            try {
                backdrop.setRenderEffect(
                    RenderEffect.createBlurEffect(radius, radius, Shader.TileMode.CLAMP),
                )
            } catch (_: Throwable) { /* falls back to the translucent solid above */ }
        }
        wrapper.addView(
            backdrop,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        addChildWithStyle(parent, wrapper, node.style, isRow = parent.isHorizontal())
        val inner = LinearLayout(host.context()).apply { orientation = LinearLayout.VERTICAL }
        wrapper.addView(
            inner,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        for (c in node.children) render(c, inner)
    }

    /** Unknown component — render a small red View so mismatches are visible. */
    private fun renderUnknown(node: KBNode, parent: ViewGroup) {
        Log.w("SDUI", "unknown component: ${node.type}")
        val v = View(host.context())
        v.setBackgroundColor(Color.RED)
        val lp = LinearLayout.LayoutParams(dp(24), dp(24))
        parent.addView(v, lp)
    }

    // -----------------------------------------------------------------------
    // Style / effect / event helpers
    // -----------------------------------------------------------------------

    /** Create a plain key button styled from theme.keyRadius/keyEffect. */
    private fun keyButton(label: String, node: KBNode): Button {
        val b = Button(host.context())
        b.text = label
        b.background = keyBackground(node)
        b.setTextColor(parseHex(kbConfig.theme.keyText))
        val fs = numFromStyle(node.style["fontSize"])
        if (fs != null) b.setTextSize(TypedValue.COMPLEX_UNIT_SP, fs)
        val fw = (node.style["fontWeight"] as? String)
        if (fw == "bold" || fw == "600" || fw == "700" || fw == "800" || fw == "900") {
            b.setTypeface(b.typeface, android.graphics.Typeface.BOLD)
        }
        return b
    }

    /** GradientDrawable background derived from theme.keyEffect + radius. */
    private fun keyBackground(node: KBNode): GradientDrawable {
        val gd = GradientDrawable()
        gd.cornerRadius = kbConfig.theme.keyRadius * host.context().resources.displayMetrics.density
        val fill = (node.style["bg"] as? String) ?: kbConfig.theme.key
        gd.setColor(parseHex(fill))
        return gd
    }

    /** Apply node.effect to a rendered background layer. */
    private fun applyBackgroundEffect(v: View, node: KBNode) {
        node.effect?.let { applyEffect(v, it) }
        (node.style["bg"] as? String)?.let { v.setBackgroundColor(parseHex(it)) }
    }

    /** Effect resolver — solid | blur | gradient. */
    private fun applyEffect(v: View, effect: KBEffect) {
        when (effect) {
            is KBEffect.Solid -> v.setBackgroundColor(parseHex(effect.color))
            is KBEffect.Blur -> {
                // See BlurBackdrop rationale — approximated on Android.
                val alpha = when (effect.style) {
                    "systemUltraThinMaterial" -> 0x40
                    "systemThinMaterial" -> 0x66
                    else -> 0x99
                }
                val base = if (effect.style.contains("Light")) Color.WHITE else Color.BLACK
                v.setBackgroundColor((alpha shl 24) or (base and 0x00FFFFFF))
                if (Build.VERSION.SDK_INT >= 31) {
                    try {
                        v.setRenderEffect(
                            RenderEffect.createBlurEffect(16f, 16f, Shader.TileMode.CLAMP),
                        )
                    } catch (_: Throwable) {}
                }
            }
            is KBEffect.Gradient -> {
                val gd = GradientDrawable()
                gd.orientation = if (effect.direction == "horizontal") {
                    GradientDrawable.Orientation.LEFT_RIGHT
                } else {
                    GradientDrawable.Orientation.TOP_BOTTOM
                }
                gd.colors = effect.colors.map { parseHex(it) }.toIntArray()
                v.background = gd
            }
        }
    }

    /** Attach a child to a LinearLayout parent honoring width/height/flex. */
    private fun addChildWithStyle(
        parent: ViewGroup,
        v: View,
        style: Map<String, Any?>,
        isRow: Boolean,
    ) {
        val w = dimenFromStyle(style["width"]) ?: ViewGroup.LayoutParams.WRAP_CONTENT
        val h = dimenFromStyle(style["height"]) ?: ViewGroup.LayoutParams.WRAP_CONTENT
        val flex = numFromStyle(style["flex"]) ?: 0f
        val lp = when (parent) {
            is LinearLayout -> {
                if (flex > 0f) {
                    if (isRow) LinearLayout.LayoutParams(0, if (h == 0) ViewGroup.LayoutParams.MATCH_PARENT else h, flex)
                    else LinearLayout.LayoutParams(if (w == 0) ViewGroup.LayoutParams.MATCH_PARENT else w, 0, flex)
                } else LinearLayout.LayoutParams(w, h)
            }
            is FrameLayout -> FrameLayout.LayoutParams(w, h)
            else -> ViewGroup.LayoutParams(w, h)
        }
        if (v is Button || v is TextView) applyTextStyle(v as TextView, style)
        (style["radius"] as? Number)?.let {
            // Wrap in / merge into a GradientDrawable if the view doesn't already have one.
            val existing = v.background as? GradientDrawable ?: GradientDrawable().also {
                (style["bg"] as? String)?.let { c -> it.setColor(parseHex(c)) }
            }
            existing.cornerRadius = it.toFloat() * host.context().resources.displayMetrics.density
            v.background = existing
        }
        (style["fg"] as? String)?.let { if (v is TextView) v.setTextColor(parseHex(it)) }
        parent.addView(v, lp)
    }

    private fun applyTextStyle(v: TextView, style: Map<String, Any?>) {
        (style["fontSize"] as? Number)?.let { v.setTextSize(TypedValue.COMPLEX_UNIT_SP, it.toFloat()) }
        val fw = (style["fontWeight"] as? String)
        if (fw == "bold" || fw == "600" || fw == "700" || fw == "800" || fw == "900") {
            v.setTypeface(v.typeface, android.graphics.Typeface.BOLD)
        }
        (style["fg"] as? String)?.let { v.setTextColor(parseHex(it)) }
    }

    private fun applyPadding(v: View, style: Map<String, Any?>) {
        val pAll = numFromStyle(style["padding"])?.toInt()?.let { dp(it) } ?: 0
        val pl = numFromStyle(style["paddingLeft"])?.toInt()?.let { dp(it) } ?: pAll
        val pt = numFromStyle(style["paddingTop"])?.toInt()?.let { dp(it) } ?: pAll
        val pr = numFromStyle(style["paddingRight"])?.toInt()?.let { dp(it) } ?: pAll
        val pb = numFromStyle(style["paddingBottom"])?.toInt()?.let { dp(it) } ?: pAll
        v.setPadding(pl, pt, pr, pb)
    }

    private fun applyEvents(v: View, node: KBNode) {
        node.on["onPress"]?.let { ref ->
            v.setOnClickListener {
                hapticTap(v)
                invokeAction(ref)
            }
        }
        node.on["onLongPress"]?.let { ref ->
            v.setOnLongClickListener {
                hapticTap(v)
                invokeAction(ref)
                true
            }
        }
    }

    /** Invoke a specific handler on the node (used by built-in keys). */
    private fun invokeEvent(node: KBNode, event: String) {
        node.on[event]?.let { invokeAction(it) }
    }

    // -----------------------------------------------------------------------
    // Action interpreter
    // -----------------------------------------------------------------------

    private fun invokeAction(ref: KBActionRef) {
        val spec = resolve(ref) ?: return
        runAction(spec)
    }

    private fun resolve(ref: KBActionRef): KBActionSpec? = when (ref) {
        is KBActionRef.Inline -> ref.spec
        is KBActionRef.Named -> kbConfig.actions[ref.name].also {
            if (it == null) Log.w("SDUI", "unknown named action: ${ref.name}")
        }
    }

    private fun runAction(spec: KBActionSpec) {
        when (spec) {
            is KBActionSpec.InsertText -> insertText(spec.text)
            is KBActionSpec.InsertKey -> insertText(spec.char)
            is KBActionSpec.DeleteBackward -> host.ic()?.deleteSurroundingText(1, 0)
            is KBActionSpec.DeleteWord -> deleteWord()
            is KBActionSpec.Shift -> {
                host.state().shift = !host.state().shift
                host.state().capsLock = false
                host.onStateChanged()
            }
            is KBActionSpec.CapsLock -> {
                host.state().capsLock = !host.state().capsLock
                host.state().shift = false
                host.onStateChanged()
            }
            is KBActionSpec.Return -> host.ic()?.commitText("\n", 1)
            is KBActionSpec.SwitchLayout -> {
                if (spec.language == null) host.cycleLayout()
                else host.switchLayout(spec.language)
            }
            is KBActionSpec.ShowLanguageMenu -> host.showLanguageMenu()
            is KBActionSpec.StartDictation -> host.startDictation()
            is KBActionSpec.StopDictation -> host.stopDictation()
            is KBActionSpec.RunRefine -> host.runRefine()
            is KBActionSpec.OpenApp -> openApp(spec.screenId)
            is KBActionSpec.OpenSettings -> openInputMethodSettings()
            is KBActionSpec.Haptic -> haptic(spec.style)
            is KBActionSpec.Sequence -> spec.actions.forEach { invokeAction(it) }
            is KBActionSpec.Condition -> {
                if (evaluate(spec.cond)) invokeAction(spec.then)
                else spec.otherwise?.let { invokeAction(it) }
            }
        }
    }

    private fun insertText(text: String) {
        host.ic()?.commitText(text, 1)
    }

    /** Look back for a word boundary and delete that many chars. */
    private fun deleteWord() {
        val ic = host.ic() ?: return
        val before = ic.getTextBeforeCursor(64, 0)?.toString() ?: return
        if (before.isEmpty()) return
        var i = before.length - 1
        // Skip trailing whitespace first.
        while (i >= 0 && before[i].isWhitespace()) i--
        while (i >= 0 && !before[i].isWhitespace()) i--
        val toDelete = before.length - (i + 1)
        if (toDelete > 0) ic.deleteSurroundingText(toDelete, 0)
    }

    private fun openApp(screenId: String?) {
        val uri = Uri.parse("tulmi://screen/${screenId ?: ""}")
        val i = Intent(Intent.ACTION_VIEW, uri).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            host.context().startActivity(i)
        } catch (t: Throwable) {
            Log.w("SDUI", "openApp failed: ${t.message}")
        }
    }

    private fun openInputMethodSettings() {
        val i = Intent(Settings.ACTION_INPUT_METHOD_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            host.context().startActivity(i)
        } catch (t: Throwable) {
            Log.w("SDUI", "openSettings failed: ${t.message}")
        }
    }

    private fun haptic(style: String) {
        val root = host.rootView() ?: container
        val constant = when (style) {
            "success" -> HapticFeedbackConstants.CONFIRM
            "warning", "error" -> HapticFeedbackConstants.LONG_PRESS
            "heavy" -> HapticFeedbackConstants.LONG_PRESS
            "medium", "light", "selection" -> HapticFeedbackConstants.KEYBOARD_TAP
            else -> HapticFeedbackConstants.KEYBOARD_TAP
        }
        root.performHapticFeedback(constant)
    }

    private fun hapticTap(v: View) {
        v.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
    }

    // -----------------------------------------------------------------------
    // Condition evaluator — walks the state path (dot notation) against the
    // typed state + config.flags. Everything else returns false so a malformed
    // condition never crashes the keyboard.
    // -----------------------------------------------------------------------
    private fun evaluate(cond: KBCondition): Boolean {
        return when (cond) {
            is KBCondition.Eq -> eqAny(lookup(cond.path), cond.value)
            is KBCondition.Neq -> !eqAny(lookup(cond.path), cond.value)
            is KBCondition.Gt -> (numLookup(cond.path) ?: return false) > cond.value
            is KBCondition.Gte -> (numLookup(cond.path) ?: return false) >= cond.value
            is KBCondition.Lt -> (numLookup(cond.path) ?: return false) < cond.value
            is KBCondition.Lte -> (numLookup(cond.path) ?: return false) <= cond.value
            is KBCondition.In -> cond.values.any { eqAny(lookup(cond.path), it) }
            is KBCondition.Contains -> (lookup(cond.path) as? String)?.contains(cond.value) ?: false
            is KBCondition.Truthy -> isTruthy(lookup(cond.path))
            is KBCondition.Falsy -> !isTruthy(lookup(cond.path))
            is KBCondition.Flag -> isTruthy(kbConfig.flags[cond.name])
            is KBCondition.Platform -> cond.name == "android"
            is KBCondition.Not -> !evaluate(cond.inner)
            is KBCondition.All -> cond.conds.all { evaluate(it) }
            is KBCondition.AnyOf -> cond.conds.any { evaluate(it) }
        }
    }

    private fun eqAny(a: Any?, b: Any?): Boolean {
        if (a == null && b == null) return true
        if (a == null || b == null) return false
        if (a is Number && b is Number) return a.toDouble() == b.toDouble()
        return a.toString() == b.toString()
    }

    private fun isTruthy(v: Any?): Boolean = when (v) {
        null -> false
        is Boolean -> v
        is Number -> v.toDouble() != 0.0
        is String -> v.isNotEmpty() && v != "false" && v != "0"
        else -> true
    }

    private fun numLookup(path: String): Double? = when (val v = lookup(path)) {
        is Number -> v.toDouble()
        is String -> v.toDoubleOrNull()
        else -> null
    }

    /** Path lookup on state + config.flags. `state.shift`, `flags.beta`, `micLevel`. */
    private fun lookup(path: String): Any? {
        val parts = path.split(".")
        val head = parts.first()
        val tail = parts.drop(1)
        return when (head) {
            "state" -> lookupState(tail)
            "flags" -> if (tail.isNotEmpty()) kbConfig.flags[tail.first()] else null
            "config" -> null // reserved, not exposed
            else -> lookupState(parts) // treat unqualified as state.*
        }
    }

    private fun lookupState(parts: List<String>): Any? {
        if (parts.isEmpty()) return null
        val s = host.state()
        return when (parts.first()) {
            "shift" -> s.shift
            "capsLock" -> s.capsLock
            "layoutId" -> s.layoutId
            "dictating" -> s.dictating
            "refining" -> s.refining
            "hasFullAccess" -> s.hasFullAccess
            "status" -> s.status
            "micLevel" -> s.micLevel
            "suggestions" -> s.suggestions
            else -> null
        }
    }

    // -----------------------------------------------------------------------
    // Small util
    // -----------------------------------------------------------------------

    private fun dp(v: Int): Int =
        (v * host.context().resources.displayMetrics.density).toInt()

    private fun ViewGroup.isHorizontal(): Boolean =
        this is LinearLayout && this.orientation == LinearLayout.HORIZONTAL

    private fun dimenFromStyle(v: Any?): Int? = when (v) {
        null -> null
        is Number -> if (v.toInt() < 0) v.toInt() else dp(v.toInt())
        is String -> when (v) {
            "match_parent", "fill" -> ViewGroup.LayoutParams.MATCH_PARENT
            "wrap_content", "wrap" -> ViewGroup.LayoutParams.WRAP_CONTENT
            else -> v.toIntOrNull()?.let { dp(it) }
        }
        else -> null
    }

    private fun numFromStyle(v: Any?): Float? = when (v) {
        is Number -> v.toFloat()
        is String -> v.toFloatOrNull()
        else -> null
    }

    // -----------------------------------------------------------------------
    // Icon registry — maps schema icon names to Android system drawables so
    // we don't ship separate resource assets. Falls back to text buttons for
    // names that don't have a match.
    // -----------------------------------------------------------------------
    private val iconRegistry: Map<String, Int> = mapOf(
        "shift" to android.R.drawable.ic_menu_upload,
        "backspace" to android.R.drawable.ic_input_delete,
        "globe" to android.R.drawable.ic_menu_mapmode,
        "mic" to android.R.drawable.ic_btn_speak_now,
        "refine" to android.R.drawable.star_on,
        "settings" to android.R.drawable.ic_menu_preferences,
    )

    // -----------------------------------------------------------------------
    // Waveform view — draws N bars whose heights follow state.micLevel. Level
    // is polled per-frame via the supplied provider so this View doesn't need
    // to be re-rendered by the tree walker every time the mic level ticks.
    // -----------------------------------------------------------------------
    private class WaveformView(
        ctx: Context,
        private val barCount: Int,
        private val color: Int,
        private val levelProvider: () -> Float,
    ) : View(ctx) {
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this@apply.color = this@WaveformView.color
        }

        override fun onDraw(canvas: Canvas) {
            val level = levelProvider().coerceIn(0f, 1f)
            val w = width.toFloat()
            val h = height.toFloat()
            val slot = w / barCount
            val barW = slot * 0.45f
            for (i in 0 until barCount) {
                val phase = (i.toFloat() / barCount) * Math.PI.toFloat() * 2f
                val jitter = (0.5f + 0.5f * kotlin.math.sin(phase + level * 6f))
                val barH = h * (0.1f + 0.85f * level * jitter)
                val cx = slot * i + slot / 2f
                canvas.drawRoundRect(
                    cx - barW / 2f,
                    (h - barH) / 2f,
                    cx + barW / 2f,
                    (h + barH) / 2f,
                    barW / 2f,
                    barW / 2f,
                    paint,
                )
            }
            postInvalidateOnAnimation()
        }
    }

    // =======================================================================
    // JSON parsing — org.json-based. Kept in this file so the schema and the
    // renderer stay in one place; the fallback path still uses Net.parseConfig.
    // =======================================================================
    companion object {
        /** True iff the raw JSON opts in to SDUI and ships a root tree. */
        fun isSDUI(rawJson: String): Boolean {
            return try {
                val o = JSONObject(rawJson)
                val sdui = o.optJSONObject("features")?.optBoolean("sdui", false) ?: false
                sdui && o.has("root") && !o.isNull("root")
            } catch (_: Throwable) {
                false
            }
        }

        fun parseKBConfig(rawJson: String): KBConfig {
            val o = JSONObject(rawJson)
            val t = o.optJSONObject("theme") ?: JSONObject()
            val theme = KBTheme(
                background = t.optString("background", "#15151b"),
                key = t.optString("key", "#2b2b33"),
                keyText = t.optString("keyText", "#ffffff"),
                accent = t.optString("accent", "#ffffff"),
                keyPressed = t.optString("keyPressed", "#3a3a45"),
                backgroundEffect = parseEffect(t.optJSONObject("backgroundEffect")),
                keyEffect = parseEffect(t.optJSONObject("keyEffect")),
                keyRadius = t.optDouble("keyRadius", 6.0).toFloat(),
                keyShadow = t.optBoolean("keyShadow", false),
            )
            val featObj = o.optJSONObject("features") ?: JSONObject()
            val features = HashMap<String, Boolean>()
            for (k in featObj.keys()) features[k] = featObj.optBoolean(k, false)
            val labelObj = o.optJSONObject("labels") ?: JSONObject()
            val labels = HashMap<String, String>()
            for (k in labelObj.keys()) labels[k] = labelObj.optString(k, "")
            val flagObj = o.optJSONObject("flags") ?: JSONObject()
            val flags = HashMap<String, Any?>()
            for (k in flagObj.keys()) flags[k] = flagObj.opt(k)
            val layouts = mutableListOf<KBLayout>()
            o.optJSONArray("layouts")?.let { arr ->
                for (i in 0 until arr.length()) {
                    val lo = arr.optJSONObject(i) ?: continue
                    val rowsArr = lo.optJSONArray("rows")
                    val rows = mutableListOf<List<String>>()
                    if (rowsArr != null) for (r in 0 until rowsArr.length()) {
                        val rowArr = rowsArr.optJSONArray(r) ?: continue
                        rows += (0 until rowArr.length()).map { rowArr.optString(it, "") }
                    }
                    layouts += KBLayout(
                        language = lo.optString("language", "en"),
                        displayName = optStringOrNull(lo, "displayName"),
                        rows = rows,
                    )
                }
            }
            val actions = HashMap<String, KBActionSpec>()
            o.optJSONObject("actions")?.let { ao ->
                for (k in ao.keys()) {
                    parseActionSpec(ao.optJSONObject(k))?.let { actions[k] = it }
                }
            }
            val root = parseNode(o.optJSONObject("root"))
            return KBConfig(
                theme = theme,
                features = features,
                labels = labels,
                flags = flags,
                layouts = layouts,
                root = root,
                actions = actions,
            )
        }

        private fun parseEffect(o: JSONObject?): KBEffect? {
            if (o == null) return null
            return when (o.optString("kind")) {
                "solid" -> KBEffect.Solid(o.optString("color", "#000000"))
                "blur" -> KBEffect.Blur(o.optString("style", "regular"))
                "gradient" -> {
                    val arr = o.optJSONArray("colors") ?: return null
                    val colors = (0 until arr.length()).map { arr.optString(it, "#000000") }
                    KBEffect.Gradient(colors, o.optString("direction", "vertical"))
                }
                else -> null
            }
        }

        private fun parseNode(o: JSONObject?): KBNode? {
            if (o == null) return null
            val props = jsonToMap(o.optJSONObject("props"))
            val style = jsonToMap(o.optJSONObject("style"))
            val bindObj = o.optJSONObject("bind")
            val bind = HashMap<String, String>()
            if (bindObj != null) for (k in bindObj.keys()) bind[k] = bindObj.optString(k, "")
            val children = mutableListOf<KBNode>()
            o.optJSONArray("children")?.let { arr ->
                for (i in 0 until arr.length()) parseNode(arr.optJSONObject(i))?.let { children += it }
            }
            val on = HashMap<String, KBActionRef>()
            o.optJSONObject("on")?.let { ao ->
                for (k in ao.keys()) parseActionRef(ao.opt(k))?.let { on[k] = it }
            }
            return KBNode(
                type = o.optString("type", "Container"),
                id = optStringOrNull(o, "id"),
                props = props,
                style = style,
                children = children,
                bind = bind,
                on = on,
                effect = parseEffect(o.optJSONObject("effect")),
                visibleIf = parseCondition(o.optJSONObject("visibleIf")),
            )
        }

        private fun parseActionRef(v: Any?): KBActionRef? = when (v) {
            is String -> KBActionRef.Named(v)
            is JSONObject -> parseActionSpec(v)?.let { KBActionRef.Inline(it) }
            else -> null
        }

        private fun parseActionSpec(o: JSONObject?): KBActionSpec? {
            if (o == null) return null
            return when (o.optString("kind")) {
                "insertText" -> KBActionSpec.InsertText(o.optString("text", ""))
                "insertKey" -> KBActionSpec.InsertKey(o.optString("char", ""))
                "deleteBackward" -> KBActionSpec.DeleteBackward
                "deleteWord" -> KBActionSpec.DeleteWord
                "shift" -> KBActionSpec.Shift
                "capsLock" -> KBActionSpec.CapsLock
                "return" -> KBActionSpec.Return
                "switchLayout" -> KBActionSpec.SwitchLayout(optStringOrNull(o, "language"))
                "showLanguageMenu" -> KBActionSpec.ShowLanguageMenu
                "startDictation" -> KBActionSpec.StartDictation
                "stopDictation" -> KBActionSpec.StopDictation
                "runRefine" -> KBActionSpec.RunRefine
                "openApp" -> KBActionSpec.OpenApp(optStringOrNull(o, "screenId"))
                "openSettings" -> KBActionSpec.OpenSettings
                "haptic" -> KBActionSpec.Haptic(o.optString("style", "selection"))
                "sequence" -> {
                    val arr = o.optJSONArray("actions") ?: JSONArray()
                    val list = (0 until arr.length()).mapNotNull { parseActionRef(arr.opt(it)) }
                    KBActionSpec.Sequence(list)
                }
                "condition" -> {
                    val ifCond = parseCondition(o.optJSONObject("if")) ?: return null
                    val then = parseActionRef(o.opt("then")) ?: return null
                    val otherwise = parseActionRef(o.opt("else"))
                    KBActionSpec.Condition(ifCond, then, otherwise)
                }
                else -> {
                    Log.w("SDUI", "unknown action kind: ${o.optString("kind")}")
                    null
                }
            }
        }

        private fun parseCondition(o: JSONObject?): KBCondition? {
            if (o == null) return null
            // The TS Condition is a discriminated union keyed by field name, not a
            // "kind" tag. Sniff for the tag-of-interest.
            o.optJSONArray("eq")?.let { a ->
                if (a.length() >= 2) return KBCondition.Eq(a.optString(0), a.opt(1))
            }
            o.optJSONArray("neq")?.let { a ->
                if (a.length() >= 2) return KBCondition.Neq(a.optString(0), a.opt(1))
            }
            o.optJSONArray("gt")?.let { a ->
                if (a.length() >= 2) return KBCondition.Gt(a.optString(0), a.optDouble(1, 0.0))
            }
            o.optJSONArray("gte")?.let { a ->
                if (a.length() >= 2) return KBCondition.Gte(a.optString(0), a.optDouble(1, 0.0))
            }
            o.optJSONArray("lt")?.let { a ->
                if (a.length() >= 2) return KBCondition.Lt(a.optString(0), a.optDouble(1, 0.0))
            }
            o.optJSONArray("lte")?.let { a ->
                if (a.length() >= 2) return KBCondition.Lte(a.optString(0), a.optDouble(1, 0.0))
            }
            o.optJSONArray("in")?.let { a ->
                if (a.length() >= 2) {
                    val vals = a.optJSONArray(1) ?: JSONArray()
                    val list = (0 until vals.length()).map { vals.opt(it) }
                    return KBCondition.In(a.optString(0), list)
                }
            }
            o.optJSONArray("contains")?.let { a ->
                if (a.length() >= 2) return KBCondition.Contains(a.optString(0), a.optString(1))
            }
            optStringOrNull(o, "truthy")?.let { return KBCondition.Truthy(it) }
            optStringOrNull(o, "falsy")?.let { return KBCondition.Falsy(it) }
            optStringOrNull(o, "flag")?.let { return KBCondition.Flag(it) }
            optStringOrNull(o, "platform")?.let { return KBCondition.Platform(it) }
            o.optJSONObject("not")?.let { parseCondition(it)?.let { c -> return KBCondition.Not(c) } }
            o.optJSONArray("all")?.let { a ->
                val list = (0 until a.length()).mapNotNull { parseCondition(a.optJSONObject(it)) }
                return KBCondition.All(list)
            }
            o.optJSONArray("any")?.let { a ->
                val list = (0 until a.length()).mapNotNull { parseCondition(a.optJSONObject(it)) }
                return KBCondition.AnyOf(list)
            }
            return null
        }

        /** JSONObject.optString returns "" when the value is null in JSON. We want a real null. */
        private fun optStringOrNull(o: JSONObject, name: String): String? =
            if (o.has(name) && !o.isNull(name)) o.optString(name) else null

        private fun jsonToMap(o: JSONObject?): Map<String, Any?> {
            if (o == null) return emptyMap()
            val out = HashMap<String, Any?>()
            for (k in o.keys()) out[k] = o.opt(k)
            return out
        }

        /**
         * Hex color parser. Handles 6-char `#RRGGBB` and 8-char `#RRGGBBAA`
         * (Kotlin's Color.parseColor accepts `#AARRGGBB`, so we reorder alpha).
         */
        fun parseHex(hex: String): Int {
            val h = hex.trim()
            if (!h.startsWith("#")) return runCatching { Color.parseColor(h) }.getOrDefault(Color.MAGENTA)
            return when (h.length) {
                7 -> runCatching { Color.parseColor(h) }.getOrDefault(Color.MAGENTA)
                9 -> {
                    // #RRGGBBAA → #AARRGGBB
                    val rr = h.substring(1, 3)
                    val gg = h.substring(3, 5)
                    val bb = h.substring(5, 7)
                    val aa = h.substring(7, 9)
                    runCatching { Color.parseColor("#$aa$rr$gg$bb") }.getOrDefault(Color.MAGENTA)
                }
                else -> runCatching { Color.parseColor(h) }.getOrDefault(Color.MAGENTA)
            }
        }
    }
}

/** File-scope alias so callers don't need to spell out the companion. */
fun parseHex(hex: String): Int = SDUIRenderer.parseHex(hex)
