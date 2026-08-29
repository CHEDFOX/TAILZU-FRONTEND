package com.tulmi.app.keyboard

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PointF
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
import android.widget.ImageView
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
    /** Label to render on the Return key (Search / Send / Go / Next / Done /
     * Return, or a backend-localized override). Updated by the IME whenever
     * a new input field takes focus. */
    var returnLabel: String = "Return",
    /**
     * More than one keyboard is enabled on the device, so the globe key has
     * somewhere to go. The SDUI tree gates GlobeKey on this — a device with
     * only Tailzu installed shows no switcher, because there is nothing to
     * switch to.
     */
    var hasMultipleKeyboards: Boolean = false,
    /**
     * Backend scratch dict. setState / toggleState / incrementState / clearState
     * (and callEndpoint.assignTo) write here; bind + visibleIf read it back via
     * `state.user.<key>`. This is what lets the backend compose stateful
     * keyboards ("if state.user.mode == 'search' then …") without new Kotlin per
     * flag. Mirrors iOS KBState.user.
     */
    var user: MutableMap<String, Any?> = mutableMapOf(),
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
    /**
     * Accept a suggestion chip: REPLACE the word the caret is in, not append
     * to it. Appending is the obvious-looking implementation and the wrong one
     * — tapping "hello" after typing "helo" would leave "helohello".
     */
    fun applySuggestion(word: String)
    /** Text was just committed by a key; the word under the caret has changed. */
    fun onTextInserted()
    /** A trace crossed these letters, in order. The host decodes them to a word. */
    fun onSwipe(letters: String)
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
    object CycleTone : KBActionSpec()
    data class OpenApp(val screenId: String?) : KBActionSpec()
    object OpenSettings : KBActionSpec()
    data class OpenUrl(val url: String, val external: Boolean) : KBActionSpec()
    data class Haptic(val style: String) : KBActionSpec()
    data class Toast(val message: String, val tone: String) : KBActionSpec()
    data class CopyToClipboard(val text: String, val toastMessage: String?) : KBActionSpec()
    // ----- backend scratch dict (state.user.*) -----
    data class SetState(val path: String, val value: Any?) : KBActionSpec()
    data class ToggleState(val path: String) : KBActionSpec()
    data class IncrementState(val path: String, val by: Double) : KBActionSpec()
    data class ClearState(val path: String) : KBActionSpec()
    // ----- network -----
    data class CallEndpoint(
        val method: String,
        val path: String,
        val body: Any?,
        val assignTo: String?,
        val onSuccess: KBActionRef?,
        val onError: KBActionRef?,
    ) : KBActionSpec()
    // ----- flow control -----
    data class Sequence(val actions: List<KBActionRef>) : KBActionSpec()
    data class Parallel(val actions: List<KBActionRef>) : KBActionSpec()
    data class Delay(val ms: Double) : KBActionSpec()
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

    // Mic particle sim — the Android twin of iOS MicParticleView. Held STRONGLY
    // (not just via the view tree) so the SAME instance survives redraw()'s
    // removeAllViews() and can run its reverse "reassemble into the mark" pass.
    // `micReassembling` keeps renderMicKey mounting the sim (not the static
    // mark) during that converge window; `lastDictating` edge-detects the
    // start/stop transition inside stateChanged() (there's no reflectDictating
    // hook on Android — every mutation funnels through stateChanged()).
    private var currentMicParticles: MicParticleView? = null
    private var micReassembling = false
    private var lastDictating = false
    private var markBitmapCache: Bitmap? = null
    private var markBitmapResolved = false

    // Fast-shift path (Android twin of iOS applyFastShiftUpdate). A shift/caps
    // flip — which auto-cap fires ~twice per sentence, plus every manual shift
    // tap — used to trigger a full redraw() (removeAllViews + re-walk of the
    // whole tree) just to recolor the shift key and re-case letters. Instead we
    // register the letter + shift buttons on each redraw and, when ONLY
    // shift/caps changed, mutate them in place. `treeKey()` fingerprints every
    // OTHER tree input so any real change still forces a full redraw.
    private val letterButtonsByChar = HashMap<String, Button>()
    private var shiftButton: Button? = null
    private var lastTreeKey: String? = null

    /** Decode the bundled brand mark (res/drawable-nodpi/tailzu_mark.png) once. */
    private fun markBitmap(): Bitmap? {
        if (markBitmapResolved) return markBitmapCache
        markBitmapResolved = true
        markBitmapCache = try {
            val res = host.context().resources
            val id = res.getIdentifier("tailzu_mark", "drawable", host.context().packageName)
            if (id != 0) BitmapFactory.decodeResource(res, id) else null
        } catch (_: Throwable) { null }
        return markBitmapCache
    }

    private fun flagBoolean(key: String, def: Boolean): Boolean = when (val v = kbConfig.flags[key]) {
        is Boolean -> v
        is Number -> v.toInt() != 0
        is String -> v.equals("true", ignoreCase = true)
        else -> def
    }

    private fun flagFloat(key: String, def: Float): Float =
        (kbConfig.flags[key] as? Number)?.toFloat() ?: def

    /** Attach the root tree. Called from the IME after `parseKBConfig`. */
    fun mount(root: KBNode) {
        rootNode = root
        redraw()
    }

    /** Cheap re-render: clear + walk again. Called on any state mutation. */
    fun stateChanged() {
        // Detect the dictation start/stop edge to drive the mic sim's physics
        // (mirrors iOS reflectDictating). Every mutation funnels through here,
        // but dictating only flips via start/stopDictation, so an edge check is
        // enough and cheap.
        val nowDict = host.state().dictating
        if (nowDict != lastDictating) {
            if (nowDict) {
                // (Re)entering recording — scatter the dots (re-burst if we were
                // mid-reassembly from a quick stop→start).
                micReassembling = false
                currentMicParticles?.beginRecording()
            } else {
                // Stopping — the dots spring back INTO the mark, then hand off to
                // the crisp static mark. Keep the sim mounted until it settles.
                currentMicParticles?.let { p ->
                    micReassembling = true
                    p.reassemble {
                        if (micReassembling) {
                            micReassembling = false
                            currentMicParticles = null
                            redraw()   // final rebuild → static brand mark
                        }
                    }
                }
            }
            lastDictating = nowDict
        }
        // Fast-shift path: if the only thing that changed is shift/caps (every
        // other tree input is identical), re-case the letters + recolor the
        // shift key in place instead of tearing down and rebuilding the tree.
        if (letterButtonsByChar.isNotEmpty() && treeKey() == lastTreeKey) {
            applyFastShiftUpdate()
            // Suggestions are NOT in treeKey, so a completion change lands here
            // rather than forcing a rebuild. It used to be fingerprinted, which
            // meant every keystroke that changed the word list tore down the
            // entire keyboard — removeAllViews(), a full re-walk of the tree,
            // every key re-inflated, geometry re-published — to repaint three
            // chips. That was the Android lag.
            refreshSuggestionBarInPlace()
            return
        }
        redraw()
    }

    /** The live suggestion row, for chip refreshes that must never remount. */
    private var suggestionRow: LinearLayout? = null

    /** Chip surface, captured from the SuggestionBar node at render time. */
    private var suggestionChipBackground: (() -> android.graphics.drawable.Drawable?)? = null

    /** Marks a row's current contents so an identical refill is skipped. */
    private val SUGGESTION_TAG_PREFIX = "tulmi.sugg:"

    /**
     * One-shot latch for the fallback below. A tree that has NO SuggestionBar
     * node at all (or gates it behind visibleIf) has no row to fill in place —
     * so redraw ONCE to let that gate re-evaluate, and then stop, rather than
     * paying a rebuild on every keystroke forever.
     */
    private var suggestionRemountAttempted = false

    private fun refreshSuggestionBarInPlace() {
        val want = host.state().suggestions
        val row = suggestionRow
        // isAttachedToWindow, not parent != null: redraw() detaches the whole
        // tree from the container, but the row's parent (its scroll view) stays
        // set — so a parent check would happily fill a dead row forever.
        if (row == null || !row.isAttachedToWindow) {
            if (want.isNotEmpty() && !suggestionRemountAttempted) {
                suggestionRemountAttempted = true
                redraw()
            }
            return
        }
        suggestionRemountAttempted = false
        if (row.tag == SUGGESTION_TAG_PREFIX + want.joinToString("")) return
        fillSuggestionRow(row, want)
    }

    /**
     * Fill (or refill) a suggestion row. Chip views are REUSED — only their
     * text and click target change — so a repaint costs no inflation and no
     * layout churn beyond the widths actually changing.
     */
    private fun fillSuggestionRow(row: LinearLayout, words: List<String>) {
        while (row.childCount > words.size) row.removeViewAt(row.childCount - 1)
        for (i in words.indices) {
            val chip = if (i < row.childCount) {
                row.getChildAt(i) as Button
            } else {
                val b = Button(host.context())
                suggestionChipBackground?.invoke()?.let { b.background = it }
                val lp = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ).apply { setMargins(dp(4), dp(4), dp(4), dp(4)) }
                row.addView(b, lp)
                b
            }
            val word = words[i]
            chip.text = word
            chip.setTextColor(parseHex(kbConfig.theme.keyText))
            // Rebound every pass: a reused chip must apply the word it is
            // showing NOW, never the one it carried before.
            chip.setOnClickListener {
                hapticTap(chip)
                host.applySuggestion(word)
            }
        }
        row.tag = SUGGESTION_TAG_PREFIX + words.joinToString("")
    }

    /** Fingerprint of every tree input EXCEPT shift/caps. When this is unchanged
     *  across a stateChanged(), the delta can only be shift/caps → fast path. */
    private fun treeKey(): String {
        val s = host.state()
        return listOf(
            s.layoutId, s.dictating, s.refining, s.status, s.returnLabel,
            s.hasMultipleKeyboards,
            // suggestions deliberately NOT fingerprinted — they are applied in
            // place by refreshSuggestionBarInPlace(). Including them here put a
            // full teardown-and-rebuild of the whole keyboard on the keystroke
            // path, just to repaint three chips.
            currentTone(), micReassembling,
            // Fingerprint the scratch dict so a setState/toggle/increment/clear
            // forces a full redraw (visibleIf/bind gates on state.user.* must
            // re-evaluate) instead of being swallowed by the fast-shift path.
            s.user.entries.sortedBy { it.key }.joinToString(",") { "${it.key}=${it.value}" },
        ).joinToString("\u0000")
    }

    /** Re-case the registered letter buttons + refresh the shift key, no remount. */
    private fun applyFastShiftUpdate() {
        val upper = host.state().shift || host.state().capsLock
        for ((base, btn) in letterButtonsByChar) {
            btn.text = if (upper) base.uppercase() else base.lowercase()
        }
        // Drawn rows re-label in place and repaint — one invalidate per row,
        // versus a setText on every Button and the layout pass that follows.
        if (drawnLettersByChar.isNotEmpty()) {
            for ((base, k) in drawnLettersByChar) {
                k.label = if (upper) base.uppercase() else base.lowercase()
            }
            drawnShiftKey?.let { k ->
                k.label = if (host.state().capsLock) "\u21ea" else "\u21e7"
                k.textColor = parseHex(
                    if (upper) kbConfig.theme.accent else kbConfig.theme.keyText)
            }
            for (p in drawnPlanes) p.invalidate()
        }
        shiftButton?.let { b ->
            b.text = if (host.state().capsLock) "⇪" else "⇧"
            b.setTextColor(parseHex(if (upper) kbConfig.theme.accent else kbConfig.theme.keyText))
        }
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
        // Reset the fast-shift refs — repopulated as the fresh tree renders.
        letterButtonsByChar.clear()
        shiftButton = null
        drawnLettersByChar.clear()
        drawnShiftKey = null
        drawnPlanes.clear()
        // Dropped with the tree that owned them; renderSuggestionBar re-registers
        // if the fresh tree still has a bar.
        suggestionRow = null
        suggestionChipBackground = null
        container.removeAllViews()
        applyEffect(container, kbConfig.theme.backgroundEffect ?: KBEffect.Solid(kbConfig.theme.background))
        rootNode?.let { render(it, container) }
        // Baseline for the next fast-shift comparison.
        lastTreeKey = treeKey()
        publishKeyGeometry(container)
    }

    /**
     * Hand the autocorrect cost model the keys AS LAID OUT.
     *
     * Adjacency has to come from the real geometry, not a hardcoded QWERTY
     * table: the backend can send any layout, including scripts whose rows look
     * nothing like a Latin keyboard, and a wrong neighbour map turns the cost
     * model from a help into a hazard.
     *
     * Positions only exist after layout, so this waits for a layout pass rather
     * than reading zeroes off freshly-added views.
     */
    private fun publishKeyGeometry(container: View) {
        if (letterButtonsByChar.isEmpty()) return
        container.post {
            val centres = HashMap<Char, android.graphics.PointF>()
            for ((base, btn) in letterButtonsByChar) {
                val ch = base.firstOrNull() ?: continue
                if (btn.width == 0 || btn.height == 0) continue
                val loc = IntArray(2)
                btn.getLocationInWindow(loc)
                centres[ch] = android.graphics.PointF(
                    loc[0] + btn.width / 2f,
                    loc[1] + btn.height / 2f,
                )
            }
            if (centres.size >= 2) TulmiAutocorrect.setKeyCentres(centres)
        }
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
            "MediaPlayer" -> renderMediaPlayer(node, parent)
            "Slideshow" -> renderSlideshow(node, parent)
            "PersonalityRow" -> renderPersonalityRow(node, parent)
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
        // Every row is a key plane. It only takes over a gesture that STARTS on
        // a Button, so rows carrying a scrolling strip or the personality row
        // behave exactly as before; rows of keys gain gap-filling, drift
        // tolerance and cancelled-tap rescue. See TulmiKeyPlane.
        val ll = TulmiKeyPlane(host.context()).apply {
            orientation = LinearLayout.HORIZONTAL
            planeEnabled = flagBoolean("kb.keyPlane.enabled", true)
            fillGaps = flagBoolean("kb.touch.fillGaps", true)
            holdMultiplier = flagFloat("kb.touch.holdMultiplier", 1.35f)
            cancelCommitMaxMs = flagFloat("kb.touch.cancelCommit.maxMs", 300f).toLong()
            cancelCommitMaxDriftPx =
                flagFloat("kb.touch.cancelCommit.maxDriftPt", 12f) *
                    host.context().resources.displayMetrics.density
            // Deliberately no haptic or counter here: the plane decides WHICH
            // key and WHEN, the key's own listener decides what that means. A
            // mic or tone key is not a keystroke, and firing feedback here as
            // well as in the listener buzzes twice for one tap.
            //
            // Swipe is OFF unless the backend turns it on. A swipe that guesses
            // the wrong word costs far more trust than no swipe at all, so it
            // ships dark and gets enabled per cohort once the revert counter
            // says it earns its place.
            swipeEnabled = flagBoolean("kb.swipe.enabled", false)
            // The plane hands back the LETTERS it crossed — it knows them in
            // both modes, where the old Button cast only worked in one.
            onSwipe = { letters ->
                val word = letters.joinToString("")
                if (word.length >= 2) host.onSwipe(word)
            }
        }
        applyBackgroundEffect(ll, node)
        addChildWithStyle(parent, ll, node.style, isRow = parent.isHorizontal())
        applyPadding(ll, node.style)
        applyEvents(ll, node)
        // Drawn keys: ONE view for the row instead of a Button per key. Only
        // taken when every child is a plain key — the tools row carries a mic
        // and a scrolling suggestion strip, real views with their own gestures.
        if (flagBoolean("kb.render.drawnKeys", false) && buildDrawnRow(node, ll)) return
        for (c in node.children) render(c, ll)
    }

    /** Key types the drawn path paints. Anything else sends the WHOLE row back
     *  to the view path — all or nothing, never a mix. */
    private fun isDrawableKey(t: String) = t == "LetterKey" || t == "ShiftKey" ||
        t == "BackspaceKey" || t == "SpaceKey" || t == "ReturnKey" || t == "Spacer"

    /** Drawn letter keys, so the fast-shift path can re-label without a rebuild. */
    private val drawnLettersByChar = HashMap<String, TulmiKeyPlane.DrawnKey>()
    private val drawnPlanes = ArrayList<TulmiKeyPlane>()

    /**
     * Paint a row of keys onto the plane itself.
     *
     * Returns false when the row holds anything the drawn path does not
     * faithfully reproduce, in which case the caller renders it as views
     * exactly as before. That fallback is the safety story: an unhandled key
     * type degrades one row to the old path, it never breaks it.
     *
     * GlobeKey is deliberately absent from isDrawableKey — it carries an icon
     * from the system drawable registry and its own IME-switch behaviour, and a
     * hand-drawn approximation of a system affordance is worse than the real
     * one. Its row falls back, which is the correct outcome.
     */
    private fun buildDrawnRow(node: KBNode, plane: TulmiKeyPlane): Boolean {
        if (node.children.isEmpty()) return false
        if (node.children.any { !isDrawableKey(it.type) }) return false
        val dm = host.context().resources.displayMetrics
        val st = host.state()
        val keys = ArrayList<TulmiKeyPlane.DrawnKey>(node.children.size)

        for (c in node.children) {
            val flex = numFromStyle(c.style["flex"]) ?: 1f
            val fixedW = (numFromStyle(c.style["width"]) ?: 0f) * dm.density
            if (c.type == "Spacer") {
                keys += TulmiKeyPlane.DrawnKey("", flex, fixedW, isSpacer = true)
                continue
            }
            val fill = parseHex((c.style["bg"] as? String) ?: kbConfig.theme.key)
            val fg = parseHex((c.style["fg"] as? String) ?: kbConfig.theme.keyText)
            val size = (numFromStyle(c.style["fontSize"]) ?: 16f) * dm.scaledDensity
            val radius = kbConfig.theme.keyRadius * dm.density

            // Case is read from LIVE state at COMMIT time, never baked into the
            // key — the same rule the Button path follows, so a fast-shift
            // repaint can never desync from what actually gets typed.
            val raw = if (c.bind["content"] == "tone") currentTone()
                      else ((c.props["char"] as? String) ?: "")
            val hasPress = c.on.containsKey("onPress")
            val upper = st.shift || st.capsLock
            val label = when (c.type) {
                "LetterKey" -> if (raw.length == 1) {
                    if (upper) raw.uppercase() else raw.lowercase()
                } else raw
                "SpaceKey" -> kbConfig.labels["space"] ?: "space"
                "ReturnKey" -> kbConfig.labels["return"] ?: "return"
                "ShiftKey" -> if (st.capsLock) "⇪" else "⇧"
                "BackspaceKey" -> "⌫"
                else -> ""
            }
            val labelColor = if (c.type == "ShiftKey" && upper) {
                parseHex(kbConfig.theme.accent)
            } else fg

            var pressEnd: (() -> Unit)? = null
            var pressStart: (() -> Unit)? = null
            val key: TulmiKeyPlane.DrawnKey
            val commit: () -> Unit = when (c.type) {
                "ShiftKey" -> {
                    {
                        val s = host.state()
                        s.shift = !s.shift
                        s.capsLock = false
                        host.onStateChanged()
                        invokeEvent(c, "onPress")
                    }
                }
                "BackspaceKey" -> {
                    { host.ic()?.deleteSurroundingText(1, 0); invokeEvent(c, "onPress") }
                }
                "SpaceKey" -> { { insertText(" "); invokeEvent(c, "onPress") } }
                "ReturnKey" -> {
                    { host.ic()?.commitText("\n", 1); invokeEvent(c, "onPress") }
                }
                else -> {
                    {
                        if (hasPress) invokeEvent(c, "onPress") else {
                            val s = host.state()
                            val ins = if (raw.length == 1) {
                                if (s.shift || s.capsLock) raw.uppercase() else raw.lowercase()
                            } else raw
                            insertText(ins)
                            if (s.shift && !s.capsLock) { s.shift = false; host.onStateChanged() }
                        }
                    }
                }
            }

            key = TulmiKeyPlane.DrawnKey(
                label = label, flex = flex, fixedWidthPx = fixedW,
                fill = fill, textColor = labelColor, textSizePx = size, radiusPx = radius,
                onCommit = { hapticTap(plane); commit() },
                onLongPress = when (c.type) {
                    // Long-press shift = caps lock, as on the Button path.
                    "ShiftKey" -> {
                        {
                            val s = host.state()
                            s.capsLock = !s.capsLock
                            s.shift = false
                            host.onStateChanged()
                        }
                    }
                    else -> if (c.on.containsKey("onLongPress")) {
                        { invokeEvent(c, "onLongPress") }
                    } else null
                },
                onPressStart = { pressStart?.invoke() },
                onPressEnd = { pressEnd?.invoke() },
            )

            // Backspace repeats while held. Wired through press start/end
            // rather than long-press because it must run UNTIL RELEASE, and it
            // suppresses the release commit so the last delete isn't doubled.
            if (c.type == "BackspaceKey") {
                var repeat: Runnable? = null
                val r = object : Runnable {
                    override fun run() {
                        key.suppressCommit = true
                        host.ic()?.deleteSurroundingText(1, 0)
                        handler.postDelayed(this, BACKSPACE_REPEAT_MS)
                    }
                }
                repeat = r
                pressStart = { handler.postDelayed(r, BACKSPACE_REPEAT_DELAY_MS) }
                pressEnd = { repeat?.let { handler.removeCallbacks(it) } }
            }

            keys += key
            if (c.type == "LetterKey" && raw.length == 1 && !hasPress) {
                drawnLettersByChar[raw.lowercase()] = key
            }
            if (c.type == "ShiftKey") drawnShiftKey = key
        }

        plane.drawnGapPx = (numFromStyle(node.style["gap"]) ?: 0f) * dm.density
        plane.pressedFill = parseHex(kbConfig.theme.keyPressed)
        plane.setDrawnKeys(keys)
        drawnPlanes += plane
        return true
    }

    private var drawnShiftKey: TulmiKeyPlane.DrawnKey? = null

    /** Hold before backspace starts repeating, then the gap between deletes.
     *  Matches the Button path's own repeat. Plain properties, NOT a second
     *  companion object — a class gets exactly one, and this file already has
     *  it (parseHex lives there). */
    private val BACKSPACE_REPEAT_DELAY_MS = 400L
    private val BACKSPACE_REPEAT_MS = 50L

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
        // A LetterKey bound to "tone" (the tone pill) shows the LIVE tone, not a
        // static char. Only single-char labels follow shift-casing; multi-char
        // titles like "Neutral" stay as authored (mirrors iOS buildLetterKey).
        val raw = if (node.bind["content"] == "tone") currentTone()
                  else ((node.props["char"] as? String) ?: "")
        val label = if (raw.length == 1) {
            if (host.state().shift || host.state().capsLock) raw.uppercase() else raw.lowercase()
        } else raw
        val b = keyButton(label, node)
        // Register plain letters for the in-place fast-shift path (keyed by the
        // base lowercase char). Special keys (onPress override) and multi-char
        // labels are excluded — they don't re-case.
        if (raw.length == 1 && !node.on.containsKey("onPress")) {
            letterButtonsByChar[raw.lowercase()] = b
        }
        b.setOnClickListener {
            hapticTap(b)
            // If the backend attached an onPress action (tone pill → cycleTone,
            // layer keys "123"/"ABC"/"#+=" → switchLayout, …), dispatch THAT and
            // do NOT type the label. Only a plain letter (no onPress override)
            // inserts its character. Previously this always inserted the label
            // AND fired onPress, so those special keys typed "123"/"neutral" into
            // the field. Mirrors iOS bindTap (on.onPress wins over insert).
            if (node.on.containsKey("onPress")) {
                invokeEvent(node, "onPress")
            } else {
                // Case from LIVE state at tap time — so a fast-shift update (or
                // even no rebuild at all) still inserts the right case instead
                // of a label captured when the tree was last built.
                val ins = if (raw.length == 1) {
                    if (host.state().shift || host.state().capsLock) raw.uppercase() else raw.lowercase()
                } else label
                insertText(ins)
                if (host.state().shift && !host.state().capsLock) {
                    host.state().shift = false
                    host.onStateChanged()
                }
            }
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
        if (active) b.setTextColor(parseHex(kbConfig.theme.accent))
        shiftButton = b   // let the fast-shift path recolor it in place
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
        // The repeat below is driven by this key's OWN up/cancel. The key plane
        // must not intercept them, or the repeat never stops.
        view.tag = TulmiKeyPlane.RAW_TOUCH
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
            keyButton(kbConfig.labels["globe"] ?: "\u2295", node)   // circled plus, a text mark not a pictograph
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

    /**
     * MicKey — toggles dictation. Three visuals mirror iOS:
     *   • RECORDING / REASSEMBLING → the brand structure bursts into a physics
     *     particle sim, then springs back into the mark on stop (MicParticleView,
     *     the SAME persistent instance across redraws). Backend can disable via
     *     kb.mic.particles=false.
     *   • IDLE  → the clean brand mark ("the structure") on the key.
     *   • fallback → system mic icon / 🎙️ emoji if the mark can't be loaded.
     */
    private fun renderMicKey(node: KBNode, parent: ViewGroup) {
        val particlesOn = flagBoolean("kb.mic.particles", true)
        val mark = markBitmap()
        val dictating = host.state().dictating

        val view: View = if (particlesOn && (dictating || micReassembling)) {
            val frame = FrameLayout(host.context()).apply { background = keyBackground(node) }
            val inset = dp(flagFloat("kb.mic.particles.inset", 6f).toInt())
            frame.setPadding(inset, inset, inset, inset)
            val particles = currentMicParticles?.also { existing ->
                (existing.parent as? ViewGroup)?.removeView(existing)   // detach from the discarded tree
            } ?: MicParticleView(
                host.context(),
                count = flagFloat("kb.mic.particles.count", 40f).toInt(),
                dotRadius = flagFloat("kb.mic.particles.radius", 1.5f),
                dotColor = parseHex(kbConfig.theme.keyText),
                mark = mark,
            ).also { currentMicParticles = it }
            frame.addView(
                particles,
                FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                ),
            )
            frame
        } else if (mark != null) {
            ImageButton(host.context()).apply {
                setImageBitmap(mark)
                scaleType = ImageView.ScaleType.FIT_CENTER
                background = keyBackground(node)
                val pad = dp(flagFloat("kb.mic.idleIconInset", 10f).toInt())
                setPadding(pad, pad, pad, pad)
            }
        } else {
            val resId = iconRegistry["mic"]
            if (resId != null) {
                ImageButton(host.context()).apply {
                    setImageResource(resId)
                    background = keyBackground(node)
                }
            } else {
                keyButton(kbConfig.labels["mic"] ?: "\u25CF", node)     // filled circle; the brand mark replaces it when the drawable loads
            }
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
        val label = kbConfig.labels["refine"] ?: "Refine"
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
        // The chip surface comes from the bar NODE, so it has to be captured
        // here — the in-place refresh runs without a node in hand.
        suggestionChipBackground = { keyBackground(node) }
        suggestionRow = row
        fillSuggestionRow(row, host.state().suggestions)
        addChildWithStyle(parent, scroll, node.style, isRow = parent.isHorizontal())
    }

    /** Waveform — N thin vertical bars scaled by state.micLevel. */
    private fun renderWaveform(node: KBNode, parent: ViewGroup) {
        val bars = (node.props["bars"] as? Number)?.toInt() ?: 24
        val color = (node.props["color"] as? String) ?: kbConfig.theme.accent
        val wf = WaveformView(
            host.context(),
            bars,
            parseHex(color),
            levelProvider = { host.state().micLevel },
            activeProvider = { host.state().dictating },
        )
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
        // Schema parity with iOS: BlurBackdrop reads blur style from node.effect
        // (which is a KBEffect discriminated by kind). Fall back to node.props
        // for compatibility with older backend emits.
        val style = when (val eff = node.effect) {
            is KBEffect.Blur -> eff.style
            else -> (node.props["style"] as? String) ?: "regular"
        }
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

    // -----------------------------------------------------------------------
    // MediaPlayer — image / GIF / APNG loaded via TulmiImageLoader from a
    // backend-provided URL. Same node type the main app uses; on the
    // keyboard we only care about static + animated images (no video/lottie
    // in-keyboard for memory reasons). Node props:
    //   props.spec.url   Backend URL
    //   props.contentFit "contain" | "cover" | "fill" — default "contain"
    // -----------------------------------------------------------------------
    private fun renderMediaPlayer(node: KBNode, parent: ViewGroup) {
        val iv = android.widget.ImageView(host.context()).apply {
            scaleType = when (node.props["contentFit"] as? String) {
                "cover" -> android.widget.ImageView.ScaleType.CENTER_CROP
                "fill" -> android.widget.ImageView.ScaleType.FIT_XY
                else -> android.widget.ImageView.ScaleType.FIT_CENTER
            }
        }
        addChildWithStyle(parent, iv, node.style, isRow = parent.isHorizontal())
        val spec = node.props["spec"] as? Map<*, *>
        val url = (spec?.get("url") as? String) ?: (node.props["url"] as? String)
        if (!url.isNullOrEmpty()) {
            TulmiImageLoader.into(host.context(), url, iv)
        }
        applyEvents(iv, node)
    }

    // -----------------------------------------------------------------------
    // Slideshow — cycles through props.frames at props.frameMs for
    // props.loops. Fires onComplete when finished. Uses the same
    // TulmiImageLoader path per frame so animated frames still animate.
    // -----------------------------------------------------------------------
    private fun renderSlideshow(node: KBNode, parent: ViewGroup) {
        val iv = android.widget.ImageView(host.context()).apply {
            scaleType = when (node.props["contentFit"] as? String) {
                "cover" -> android.widget.ImageView.ScaleType.CENTER_CROP
                "fill" -> android.widget.ImageView.ScaleType.FIT_XY
                else -> android.widget.ImageView.ScaleType.CENTER_CROP
            }
        }
        addChildWithStyle(parent, iv, node.style, isRow = parent.isHorizontal())
        // Press wiring (on.onPress / on.onLongPress if the backend authored any) —
        // mirrors renderMediaPlayer. onComplete is fired separately when the run
        // finishes; it is NOT a press handler.
        applyEvents(iv, node)
        val frames = (node.props["frames"] as? List<*>).orEmpty()
        val frameMs = (node.props["frameMs"] as? Number)?.toLong() ?: 120L
        // loops<=0 = "run until the tree is torn down" (matches the RN Slideshow's
        // documented 0 = infinite). Either way ticks post on the renderer's shared
        // `handler`, which redraw() clears — so a config refetch/remount can't
        // leave an orphaned loop ticking against a detached ImageView. The old
        // per-Slideshow Handler was never cleared, so perpetual loops stacked and
        // loops=0 leaked by construction.
        val loops = (node.props["loops"] as? Number)?.toInt() ?: 1
        if (frames.isEmpty()) return
        val ctx = host.context()
        var index = 0
        var cycles = 0
        val tick = object : Runnable {
            override fun run() {
                val f = frames[index] as? Map<*, *> ?: return
                val url = f["url"] as? String
                if (!url.isNullOrEmpty()) TulmiImageLoader.into(ctx, url, iv)
                index += 1
                if (index >= frames.size) {
                    cycles += 1
                    if (loops > 0 && cycles >= loops) {
                        // Fire the node's onComplete action (startDictation /
                        // openApp / …). The old code called applyEvents() here,
                        // which only (re)wired press handlers and never ran
                        // onComplete, so a one-shot Slideshow's finish was inert.
                        invokeEvent(node, "onComplete")
                        return
                    }
                    index = 0
                }
                handler.postDelayed(this, frameMs)
            }
        }
        handler.post(tick)
    }

    // -----------------------------------------------------------------------
    // PersonalityRow — pinned preset chips + long-press tone popover.
    // Reads its content from kb.personality.pinned and kb.personality.tones
    // in the config flags. Emits a state update on selection so backend
    // action trees can react via visibleIf/bind expressions.
    // -----------------------------------------------------------------------
    private fun renderPersonalityRow(node: KBNode, parent: ViewGroup) {
        val row = TulmiPersonalityRow(host.context())
        addChildWithStyle(parent, row, node.style, isRow = parent.isHorizontal())

        // pinned + tones both come from the config flags. Depending on how
        // org.json surfaced them they may be a Kotlin List or a raw JSONArray;
        // normalize either into a plain list, and read element fields whether the
        // element is a Map or a JSONObject.
        fun itemList(raw: Any?): List<Any?> = when (raw) {
            is List<*> -> raw
            is JSONArray -> (0 until raw.length()).map { raw.opt(it) }
            else -> emptyList()
        }
        fun strField(el: Any?, key: String): String? = when (el) {
            is Map<*, *> -> el[key] as? String
            is JSONObject -> if (el.has(key) && !el.isNull(key)) el.optString(key) else null
            else -> null
        }

        val pinned = itemList(kbConfig.flags["kb.personality.pinned"])
        // kb.personality.tones is now served as a flat JSON array of tone LABEL
        // strings (Object.values(TONE_LABELS)); older configs shipped
        // { id, label } objects. Both element shapes are handled below.
        val toneItems = itemList(kbConfig.flags["kb.personality.tones"])
        val activeId = (kbConfig.flags["kb.personality.activeId"] as? String) ?: ""

        val chips = pinned.mapNotNull { p ->
            TulmiPersonalityRow.ChipData(
                id = strField(p, "id") ?: return@mapNotNull null,
                name = strField(p, "name") ?: "",
                emoji = strField(p, "emoji") ?: "",
                tone = strField(p, "tone") ?: "",
            )
        }
        val toneList = toneItems.mapNotNull { t ->
            when (t) {
                // New shape: a bare label string. Derive a stable id (lowercased,
                // spaces→dashes) matching Net.refine's toneId scheme.
                is String -> if (t.isBlank()) null
                    else TulmiPersonalityRow.Tone(
                        id = t.trim().lowercase().replace(' ', '-'),
                        label = t,
                    )
                // Back-compat: { id, label } objects (Map or JSONObject).
                else -> strField(t, "id")?.let { id ->
                    TulmiPersonalityRow.Tone(id = id, label = strField(t, "label") ?: "")
                }
            }
        }
        val accent = parseHex(kbConfig.theme.accent)
        row.update(
            chips = chips,
            tones = toneList,
            activeId = activeId,
            accentColor = accent,
            chipBgColor = Color.argb(23, 255, 255, 255),
            chipFgColor = parseHex(kbConfig.theme.keyText),
        )
        row.onSelect = { presetId, tone ->
            // Backend owns the actual switching logic — the row just reports.
            // The host publishes into KBState and posts to the backend so any
            // condition/visibleIf referencing state.activePresetId re-evaluates.
            host.state().let { /* no-op — real state update owned by host */ }
            host.onStateChanged()
        }
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
            is KBActionSpec.CycleTone -> cycleTone()
            is KBActionSpec.OpenApp -> openApp(spec.screenId)
            is KBActionSpec.OpenSettings -> openInputMethodSettings()
            is KBActionSpec.OpenUrl -> openUrl(spec.url)
            is KBActionSpec.Haptic -> haptic(spec.style)
            is KBActionSpec.Toast -> toast(spec.message, spec.tone)
            is KBActionSpec.CopyToClipboard -> {
                copyToClipboard(spec.text)
                spec.toastMessage?.let { toast(it, "success") }
            }
            is KBActionSpec.SetState -> {
                writeStatePath(spec.path, spec.value)
                host.onStateChanged()
            }
            is KBActionSpec.ToggleState -> {
                writeStatePath(spec.path, !isTruthy(host.state().user[spec.path]))
                host.onStateChanged()
            }
            is KBActionSpec.IncrementState -> {
                val cur = numFromAny(host.state().user[spec.path]) ?: 0.0
                writeStatePath(spec.path, cur + spec.by)
                host.onStateChanged()
            }
            is KBActionSpec.ClearState -> {
                writeStatePath(spec.path, null)
                host.onStateChanged()
            }
            is KBActionSpec.CallEndpoint -> callEndpoint(spec)
            is KBActionSpec.Sequence -> spec.actions.forEach { invokeAction(it) }
            is KBActionSpec.Parallel -> spec.actions.forEach { ref ->
                // "At the same time" from the tree's POV — each re-enters on the
                // main looper (mirrors iOS's DispatchQueue.main.async fan-out).
                handler.post { invokeAction(ref) }
            }
            is KBActionSpec.Delay -> { /* pause primitive; standalone no-op (mirrors iOS) */ }
            is KBActionSpec.Condition -> {
                if (evaluate(spec.cond)) invokeAction(spec.then)
                else spec.otherwise?.let { invokeAction(it) }
            }
        }
    }

    private fun insertText(text: String) {
        host.ic()?.commitText(text, 1)
        TulmiTelemetry.bump(TulmiTelemetry.KEYSTROKES)
        // SDUI keys commit straight through here and never reach onKey(), so
        // this — not the legacy key handler — is where the suggestion bar has
        // to be told the word changed. Wiring it to onKey() left the bar dead
        // on the path every user is actually on.
        host.onTextInserted()
    }

    // --- Tone pill (SDUI) ---------------------------------------------------
    // The tone pill is a LetterKey with bind.content == "tone" and
    // on.onPress == { kind: "cycleTone" }. In SDUI mode the hand-built pill
    // isn't shown, so this is the only way to change tone. We read/write the
    // SAME SharedPreferences the hand-built pill + IME use ("tulmi_kb"/"tone")
    // so the two stay in lockstep and the IME's refine path sees the selection.

    private fun toneStore() =
        host.context().getSharedPreferences("tulmi_kb", Context.MODE_PRIVATE)

    private fun currentTone(): String = toneStore().getString("tone", "Neutral") ?: "Neutral"

    /** Tones from backend flag `kb.tones` (comma-separated) or a default set —
     *  mirrors iOS configuredTones(). */
    private fun configuredTones(): List<String> {
        (kbConfig.flags["kb.tones"] as? String)?.let { raw ->
            val parts = raw.split(",").map { it.trim() }.filter { it.isNotEmpty() }
            if (parts.isNotEmpty()) return parts
        }
        return listOf("Neutral", "Casual", "Formal", "Excited")
    }

    private fun cycleTone() {
        val tones = configuredTones()
        val idx = tones.indexOf(currentTone())
        val next = tones[(idx + 1) % tones.size.coerceAtLeast(1)]
        toneStore().edit().putString("tone", next).apply()
        host.onStateChanged() // re-render → the tone pill re-reads currentTone()
    }

    /** Look back for a word boundary and delete that many chars. */
    private fun deleteWord() {
        val ic = host.ic() ?: return
        // 1024-char lookback is plenty for any real word (longest German
        // compound is ~64 chars). Bigger buffers just waste an IPC roundtrip.
        val before = ic.getTextBeforeCursor(1024, 0)?.toString() ?: return
        if (before.isEmpty()) return
        var i = before.length - 1
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

    /** Open an arbitrary URL. Unlike iOS keyboard extensions (which can't launch
     *  URLs and drop a tombstone), an Android IME can startActivity directly —
     *  same pattern as openApp/openInputMethodSettings. `external` is implicit on
     *  Android (the OS routes to the right handler). */
    private fun openUrl(url: String) {
        if (url.isEmpty()) return
        val i = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            host.context().startActivity(i)
        } catch (t: Throwable) {
            Log.w("SDUI", "openUrl failed: ${t.message}")
        }
    }

    /** Transient message. Android's system Toast is the pragmatic equivalent of
     *  iOS's in-keyboard toast label; `tone` has no visual treatment here. */
    private fun toast(message: String, @Suppress("UNUSED_PARAMETER") tone: String) {
        if (message.isEmpty()) return
        try {
            android.widget.Toast.makeText(
                host.context(), message, android.widget.Toast.LENGTH_SHORT,
            ).show()
        } catch (t: Throwable) {
            Log.w("SDUI", "toast failed: ${t.message}")
        }
    }

    private fun copyToClipboard(text: String) {
        val cm = host.context().getSystemService(Context.CLIPBOARD_SERVICE)
            as? android.content.ClipboardManager ?: return
        cm.setPrimaryClip(android.content.ClipData.newPlainText("tulmi", text))
    }

    // --- backend scratch dict (state.user.*) --------------------------------
    // setState/toggle/increment/clear + callEndpoint.assignTo write here; bind +
    // visibleIf read via state.user.<path> (see lookupState). `path` is the bare
    // key (dotted keys are stored/read verbatim). Mirrors iOS writeStatePath.

    private fun writeStatePath(path: String, value: Any?) {
        if (value == null) host.state().user.remove(path)
        else host.state().user[path] = value
    }

    private fun numFromAny(v: Any?): Double? = when (v) {
        is Number -> v.toDouble()
        is String -> v.toDoubleOrNull()
        else -> null
    }

    // -----------------------------------------------------------------------
    // callEndpoint — lets the backend trigger a GET/POST from the keyboard,
    // reusing the same base URL + bearer the config was fetched with (Net.kt).
    // Runs off the UI thread on a plain HttpURLConnection (no new dependency);
    // a JSON response body lands at state.user[assignTo] (stored raw — nested
    // field access into it isn't supported on Android). onSuccess/onError refs
    // run on the main looper after the response is decoded. Mirrors iOS
    // callEndpoint.
    // -----------------------------------------------------------------------
    private fun callEndpoint(spec: KBActionSpec.CallEndpoint) {
        val urlStr = Net.baseUrl + spec.path
        val bodyStr = jsonBody(spec.body)
        Thread {
            var ok = false
            var respText: String? = null
            try {
                val conn = (java.net.URL(urlStr).openConnection() as java.net.HttpURLConnection).apply {
                    requestMethod = spec.method.uppercase()
                    connectTimeout = 15000
                    readTimeout = 15000
                    setRequestProperty("Authorization", "Bearer ${Net.bearer()}")
                    setRequestProperty("Content-Type", "application/json")
                }
                if (bodyStr != null && conn.requestMethod != "GET") {
                    conn.doOutput = true
                    conn.outputStream.use { it.write(bodyStr.toByteArray()) }
                }
                val code = conn.responseCode
                ok = code in 200..299
                respText = (if (ok) conn.inputStream else conn.errorStream)
                    ?.bufferedReader()?.use { it.readText() }
                conn.disconnect()
            } catch (t: Throwable) {
                Log.w("SDUI", "callEndpoint failed: ${t.message}")
            }
            val success = ok
            val text = respText
            handler.post {
                if (success) {
                    if (spec.assignTo != null && text != null) {
                        val parsed: Any? = try { JSONObject(text) } catch (_: Throwable) {
                            try { JSONArray(text) } catch (_: Throwable) { text }
                        }
                        writeStatePath(spec.assignTo, parsed)
                        host.onStateChanged()
                    }
                    spec.onSuccess?.let { invokeAction(it) }
                } else {
                    spec.onError?.let { invokeAction(it) }
                }
            }
        }.start()
    }

    private fun jsonBody(body: Any?): String? = when (body) {
        null -> null
        is String -> body
        else -> body.toString()   // JSONObject / JSONArray / primitives → JSON text
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
            "hasMultipleKeyboards" -> s.hasMultipleKeyboards
            "status" -> s.status
            "micLevel" -> s.micLevel
            "suggestions" -> s.suggestions
            // Backend scratch dict: state.user.<key>. Dotted keys rejoin so
            // state.user.a.b resolves user["a.b"] (what setState wrote).
            "user" -> if (parts.size > 1) s.user[parts.drop(1).joinToString(".")] else null
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
    // MicParticleView — Android twin of iOS MicParticleView.
    //
    // Idle, the mic key shows the brand mark ("the structure"). Recording, the
    // structure bursts into tiny dots that wander inside the round key, bouncing
    // off the circular wall and each other (.DISPERSE). Stopping, each dot
    // springs back to its home point on the mark (.REASSEMBLE) and, once landed,
    // hands off to the crisp static mark — one unbroken motion. Home targets are
    // the same deterministic mark samples the dots were seeded from, so every
    // dot returns exactly where it started.
    //
    // Self-driven via postInvalidateOnAnimation() gated on activity (same
    // battery model as WaveformView) — no timers to leak. The renderer holds a
    // strong ref so the SAME instance survives redraw()'s removeAllViews() and
    // its physics stay continuous across the stop remount.
    // -----------------------------------------------------------------------
    private class MicParticleView(
        ctx: Context,
        private val count: Int,
        private val dotRadius: Float,
        dotColor: Int,
        private val mark: Bitmap?,
    ) : View(ctx) {
        private class Dot(var x: Float, var y: Float, var vx: Float, var vy: Float)
        private val dots = ArrayList<Dot>()
        private var seeded = false
        private val rnd = java.util.Random()
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = dotColor
            style = Paint.Style.FILL
        }

        private enum class Mode { DISPERSE, REASSEMBLE }
        private var mode = Mode.DISPERSE
        private val targets = ArrayList<PointF>()   // home points during REASSEMBLE
        private var reassembleElapsed = 0f
        private var reassembleFinished = false
        private var onReassembleDone: (() -> Unit)? = null
        private var lastFrameNanos = 0L

        init {
            isClickable = false
            isFocusable = false
        }

        override fun onAttachedToWindow() {
            super.onAttachedToWindow()
            lastFrameNanos = 0L                     // avoid a huge dt after re-attach
            postInvalidateOnAnimation()
        }

        private val radius: Float get() = minOf(width, height) / 2f
        private val midX: Float get() = width / 2f
        private val midY: Float get() = height / 2f

        // -- Mode transitions (driven by the renderer's stateChanged edge) -----

        /** (Re)enter the recording wander; re-burst if we were mid-reassembly. */
        fun beginRecording() {
            val wasReassembling = mode == Mode.REASSEMBLE
            mode = Mode.DISPERSE
            targets.clear()
            reassembleElapsed = 0f
            reassembleFinished = false
            onReassembleDone = null
            if (wasReassembling) for (d in dots) {
                val v = burst(d.x, d.y); d.vx = v.x; d.vy = v.y
            }
            postInvalidateOnAnimation()
        }

        /** Reverse: spring the dots back into the mark, then fire [onComplete]. */
        fun reassemble(onComplete: () -> Unit) {
            if (!seeded || dots.isEmpty()) { onComplete(); return }
            mode = Mode.REASSEMBLE
            reassembleElapsed = 0f
            reassembleFinished = false
            onReassembleDone = onComplete
            computeTargets()
            postInvalidateOnAnimation()
        }

        // -- Physics -----------------------------------------------------------

        /** An outward kick from centre through (px,py) with angular jitter. */
        private fun burst(px: Float, py: Float): PointF {
            var dx = px - midX; var dy = py - midY
            val len = kotlin.math.sqrt(dx * dx + dy * dy)
            if (len > 0.5f) { dx /= len; dy /= len }
            else {
                val a = rnd.nextFloat() * (2f * Math.PI.toFloat())
                dx = kotlin.math.cos(a); dy = kotlin.math.sin(a)
            }
            val j = rnd.nextFloat() - 0.5f
            val rx = dx * kotlin.math.cos(j) - dy * kotlin.math.sin(j)
            val ry = dx * kotlin.math.sin(j) + dy * kotlin.math.cos(j)
            val speed = 55f + rnd.nextFloat() * 55f            // 55..110 px/s
            return PointF(rx * speed, ry * speed)
        }

        private fun seed() {
            seeded = true
            dots.clear()
            val starts = markPoints(count)
            val r = maxOf(1f, radius - dotRadius)
            for (i in 0 until count) {
                val p = if (i < starts.size) starts[i] else {
                    val ang = rnd.nextFloat() * (2f * Math.PI.toFloat())
                    val rad = r * kotlin.math.sqrt(rnd.nextFloat())   // uniform in the disc
                    PointF(midX + kotlin.math.cos(ang) * rad, midY + kotlin.math.sin(ang) * rad)
                }
                val v = burst(p.x, p.y)
                dots.add(Dot(p.x, p.y, v.x, v.y))
            }
        }

        private fun computeTargets() {
            targets.clear()
            val pts = markPoints(dots.size)
            if (pts.isEmpty()) return
            for (i in dots.indices) targets.add(pts[i % pts.size])
        }

        /**
         * Up to [want] opaque points from the mark, aspect-fit + inset into this
         * view's bounds. Deterministic even-stride sampling (no randomness) so
         * home targets equal the seed positions — dots return to their origin.
         */
        private fun markPoints(want: Int): List<PointF> {
            val bmp = mark ?: return emptyList()
            if (want <= 0 || width < 4) return emptyList()
            val sw = bmp.width; val sh = bmp.height
            if (sw <= 0 || sh <= 0) return emptyList()
            val pix = IntArray(sw * sh)
            try { bmp.getPixels(pix, 0, sw, 0, 0, sw, sh) } catch (_: Throwable) { return emptyList() }
            val inset = dotRadius + 2f
            val boxW = width - 2f * inset; val boxH = height - 2f * inset
            val scale = minOf(boxW / sw, boxH / sh)
            val dw = sw * scale; val dh = sh * scale
            val ox = (width - dw) / 2f; val oy = (height - dh) / 2f
            val all = ArrayList<PointF>()
            var y = 0
            while (y < sh) {
                var x = 0
                while (x < sw) {
                    val a = (pix[y * sw + x] ushr 24) and 0xff       // alpha channel
                    if (a > 90) all.add(PointF(ox + (x + 0.5f) * scale, oy + (y + 0.5f) * scale))
                    x++
                }
                y++
            }
            if (all.size <= want) return all
            val out = ArrayList<PointF>(want)
            val stride = all.size.toFloat() / want
            var idx = 0f
            while (idx.toInt() < all.size && out.size < want) { out.add(all[idx.toInt()]); idx += stride }
            return out
        }

        override fun onDraw(canvas: Canvas) {
            if (!seeded && width > 4) seed()
            val now = System.nanoTime()
            val dt = if (lastFrameNanos == 0L) 1f / 60f
                     else ((now - lastFrameNanos) / 1_000_000_000f).coerceIn(0f, 1f / 30f)
            lastFrameNanos = now
            if (dots.isNotEmpty()) {
                if (mode == Mode.REASSEMBLE) stepReassemble(dt) else stepDisperse(dt)
            }
            for (d in dots) canvas.drawCircle(d.x, d.y, dotRadius, paint)
            if (mode == Mode.DISPERSE || !reassembleFinished) postInvalidateOnAnimation()
        }

        /** Recording: burst → wall-bounce → collide → wander (perpetual). */
        private fun stepDisperse(dt: Float) {
            val wall = maxOf(0f, radius - dotRadius)
            for (d in dots) {
                d.x += d.vx * dt; d.y += d.vy * dt
                val dx = d.x - midX; val dy = d.y - midY
                val dist = kotlin.math.sqrt(dx * dx + dy * dy)
                if (dist > wall && dist > 0f) {
                    val nx = dx / dist; val ny = dy / dist
                    d.x = midX + nx * wall; d.y = midY + ny * wall
                    val vn = d.vx * nx + d.vy * ny
                    d.vx -= 2f * vn * nx; d.vy -= 2f * vn * ny
                }
            }
            val minD = dotRadius * 2f
            for (a in dots.indices) {
                for (b in (a + 1) until dots.size) {
                    val da = dots[a]; val db = dots[b]
                    val dx = db.x - da.x; val dy = db.y - da.y
                    val dist = kotlin.math.sqrt(dx * dx + dy * dy)
                    if (dist >= minD || dist <= 0.0001f) continue
                    val nx = dx / dist; val ny = dy / dist
                    val overlap = (minD - dist) / 2f
                    da.x -= nx * overlap; da.y -= ny * overlap
                    db.x += nx * overlap; db.y += ny * overlap
                    val rvn = (db.vx - da.vx) * nx + (db.vy - da.vy) * ny
                    if (rvn < 0f) {                              // only if approaching
                        da.vx += rvn * nx; da.vy += rvn * ny
                        db.vx -= rvn * nx; db.vy -= rvn * ny
                    }
                }
            }
            val drag = 0.985f; val minSpeed = 13f
            for (d in dots) {
                d.vx *= drag; d.vy *= drag
                val s = kotlin.math.sqrt(d.vx * d.vx + d.vy * d.vy)
                if (s > 0.001f && s < minSpeed) { val k = minSpeed / s; d.vx *= k; d.vy *= k }
            }
        }

        /** Stopping: damped spring to home points, then snap + hand off. */
        private fun stepReassemble(dt: Float) {
            reassembleElapsed += dt
            val stiffness = 26f; val damping = 0.80f
            var maxDist = 0f
            for (i in dots.indices) {
                val d = dots[i]
                val t = if (targets.isEmpty()) PointF(midX, midY) else targets[i % targets.size]
                val toX = t.x - d.x; val toY = t.y - d.y
                d.vx = (d.vx + toX * stiffness * dt) * damping
                d.vy = (d.vy + toY * stiffness * dt) * damping
                d.x += d.vx * dt; d.y += d.vy * dt
                val dd = kotlin.math.sqrt(toX * toX + toY * toY)
                if (dd > maxDist) maxDist = dd
            }
            if (!reassembleFinished && (maxDist < 0.8f || reassembleElapsed > 0.6f)) {
                for (i in dots.indices) {
                    val t = if (targets.isEmpty()) PointF(midX, midY) else targets[i % targets.size]
                    dots[i].x = t.x; dots[i].y = t.y
                }
                reassembleFinished = true
                val done = onReassembleDone; onReassembleDone = null
                // Defer the handoff out of onDraw — it triggers redraw()
                // (removeAllViews), which must not run mid-draw.
                post { done?.invoke() }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Waveform view — draws N bars whose heights follow state.micLevel. Level
    // is polled per-frame via the supplied provider so this View doesn't need
    // to be re-rendered by the tree walker every time the mic level ticks.
    //
    // Battery: the redraw loop only runs while `activeProvider()` returns true
    // (typically `state.dictating`) — otherwise onDraw returns after the initial
    // paint, leaving a static bar row instead of a permanent 60 FPS repaint.
    // -----------------------------------------------------------------------
    private class WaveformView(
        ctx: Context,
        private val barCount: Int,
        private val color: Int,
        private val levelProvider: () -> Float,
        private val activeProvider: () -> Boolean,
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
            if (activeProvider()) postInvalidateOnAnimation()
        }
    }

    // =======================================================================
    // JSON parsing — org.json-based. Kept in this file so the schema and the
    // renderer stay in one place; the fallback path still uses Net.parseConfig.
    // =======================================================================
    companion object {
        /**
         * Which Android keyboard build a telemetry batch came from. Bump it
         * with any change to typing, correction or dictation behaviour —
         * counters are meaningless if two builds report into one bucket.
         * Deliberately its own series: this keyboard is not a port of the iOS
         * one and its stamps should never be read as tracking K-numbers.
         */
        const val BUILD_STAMP = "A1"

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
                "cycleTone" -> KBActionSpec.CycleTone
                "openApp" -> KBActionSpec.OpenApp(optStringOrNull(o, "screenId"))
                "openSettings" -> KBActionSpec.OpenSettings
                "openUrl" -> KBActionSpec.OpenUrl(
                    o.optString("url", ""),
                    o.optBoolean("external", false),
                )
                "haptic" -> KBActionSpec.Haptic(o.optString("style", "selection"))
                "toast" -> KBActionSpec.Toast(
                    o.optString("message", ""),
                    o.optString("tone", "info"),
                )
                "copyToClipboard" -> KBActionSpec.CopyToClipboard(
                    o.optString("text", ""),
                    optStringOrNull(o, "toastMessage"),
                )
                "setState" -> KBActionSpec.SetState(o.optString("path", ""), o.opt("value"))
                "toggleState" -> KBActionSpec.ToggleState(o.optString("path", ""))
                "incrementState" -> KBActionSpec.IncrementState(
                    o.optString("path", ""),
                    o.optDouble("by", 1.0),
                )
                "clearState" -> KBActionSpec.ClearState(o.optString("path", ""))
                "callEndpoint" -> KBActionSpec.CallEndpoint(
                    method = o.optString("method", "GET"),
                    path = o.optString("path", ""),
                    body = o.opt("body"),
                    assignTo = optStringOrNull(o, "assignTo"),
                    onSuccess = parseActionRef(o.opt("onSuccess")),
                    onError = parseActionRef(o.opt("onError")),
                )
                "sequence" -> {
                    val arr = o.optJSONArray("actions") ?: JSONArray()
                    val list = (0 until arr.length()).mapNotNull { parseActionRef(arr.opt(it)) }
                    KBActionSpec.Sequence(list)
                }
                "parallel" -> {
                    val arr = o.optJSONArray("actions") ?: JSONArray()
                    val list = (0 until arr.length()).mapNotNull { parseActionRef(arr.opt(it)) }
                    KBActionSpec.Parallel(list)
                }
                "delay" -> KBActionSpec.Delay(o.optDouble("ms", 0.0))
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
