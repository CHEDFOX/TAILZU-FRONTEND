package com.tulmi.app.keyboard

import android.animation.ValueAnimator
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.PointF
import android.graphics.RectF
import android.view.animation.LinearInterpolator
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
import android.view.inputmethod.EditorInfo
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
     * The field's editor action (EditorInfo.IME_ACTION_SEARCH / SEND / GO /
     * NEXT / DONE / PREVIOUS), or 0 when Return should insert a newline — a
     * multi-line field, a field with IME_FLAG_NO_ENTER_ACTION, or none set.
     * Return PERFORMS this instead of typing "\n" into a search box.
     */
    var returnAction: Int = 0,
    /**
     * What the suggestion bar is showing, in iOS's terms: "" (spelling
     * suggestions, led by the word as typed), "candidates" (a swipe's ranked
     * words — the first is the one that was committed), "revert" or
     * "alternates". Only "candidates" has a best answer worth the lead colour.
     */
    var suggestionKind: String = "",
    /**
     * More than one keyboard is enabled on the device, so the globe key has
     * somewhere to go. The SDUI tree gates GlobeKey on this — a device with
     * only Tailzu installed shows no switcher, because there is nothing to
     * switch to.
     */
    var hasMultipleKeyboards: Boolean = false,
    /**
     * The focused field is a password / secure field.
     *
     * Android, unlike iOS, hands a third-party keyboard the password box like
     * any other field, so this has to be known and acted on here. The SDUI tree
     * gates the mic and Refine on it: neither may read a field the user did not
     * mean to share, and a key that would be refused is better not drawn.
     */
    var secured: Boolean = false,
    /** The space bar is being held as a trackpad (state.trackpadActive). */
    var trackpadActive: Boolean = false,
    /**
     * "dark" or "light" — the system appearance.
     *
     * The keyboard tree emits TWO tools rows, one gated on each, because the
     * tone pill's colours are hex literals that cannot auto-flip. Android had
     * no such field, so the condition resolved null: the light row was always
     * hidden and the DARK row always shown, which put a dark pill on a light
     * keyboard for every light-mode user. Same shape as the globe key —
     * a tree gated on state one platform never set.
     */
    var appearance: String = "dark",
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
    /**
     * Show a status string, or nothing.
     *
     * `actionable` is the whole distinction: transient chatter ("Listening…",
     * "Finishing…") is noise over the keys and stays hidden, but guidance the
     * user has to act on — a permission to grant, a field we will not read —
     * has to be visible or the keyboard just looks broken. iOS has drawn this
     * line since the mic shipped; Android suppressed everything, which is why
     * every blocked path there was silent.
     */
    fun setStatus(text: String, actionable: Boolean = false)
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
    /**
     * A word is about to end with [boundary] (" " or "\n"). Called BEFORE the
     * boundary is committed, so the host can expand a dictionary trigger or
     * apply an autocorrection to the word the caret is still inside.
     */
    fun beforeWordBoundary(boundary: String) {}
    /**
     * Backspace was pressed. True when the host consumed it — undoing an
     * autocorrection it just made — so the renderer must not also delete.
     */
    fun onBackspace(): Boolean = false
    /** Text was just deleted by a key; the word under the caret has changed. */
    fun onTextDeleted() {}
    /**
     * Where the caret is, in characters from the start of the field, or -1
     * when the host does not know. The trackpad places the caret from here.
     */
    fun caretPosition(): Int = -1
    /** The trackpad moved the caret: the word under it is a different one. */
    fun onCaretMoved() = onTextDeleted()
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
    /** The server's dark / light themes. When present, the one matching the
     *  system appearance is drawn instead of `theme`. */
    val themeDark: KBTheme? = null,
    val themeLight: KBTheme? = null,
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
    // The mark view that lives across redraws when the server's recording
    // motion is the dispersal, so record → stop → home is one unbroken
    // motion. A new spec, motion or ink (a deploy, a theme flip) makes a new one.
    private var currentMicMark: TulmiMarkView? = null
    private var currentMicMarkKey = ""
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

    /** Finite, or the default: 1e39 is Infinity as a Float. */
    private fun flagFloat(key: String, def: Float): Float =
        (kbConfig.flags[key] as? Number)?.toFloat()?.takeIf { !it.isNaN() && !it.isInfinite() } ?: def

    private fun flagInt(key: String, def: Int): Int =
        (kbConfig.flags[key] as? Number)?.toInt() ?: def

    private fun flagString(key: String, def: String): String =
        (kbConfig.flags[key] as? String) ?: def

    /** A colour flag. A blank or missing value is the default, never magenta. */
    private fun flagColor(key: String, def: String): Int =
        parseHex((kbConfig.flags[key] as? String)?.takeIf { it.isNotBlank() } ?: def)

    /** A server label, or the fallback before any config. */
    private fun label(key: String, def: String): String = kbConfig.labels[key] ?: def

    /**
     * The theme to draw with: the server's dark or light theme when it sent
     * one for the current system appearance, else the plain `theme`. Read
     * through here, never kbConfig.theme, so a dark/light flip repaints right.
     */
    private val theme: KBTheme
        get() = when (host.state().appearance) {
            "light" -> kbConfig.themeLight ?: kbConfig.theme
            else -> kbConfig.themeDark ?: kbConfig.theme
        }

    /** The tone pill's label, resolved once per config / pick rather than on
     *  every keystroke (treeKey reads it on the typing path). */
    private var toneLabel: String = ""

    private fun refreshTone() {
        toneLabel = TulmiTone.label(host.context(), kbConfig.flags)
    }

    /** Attach the root tree. Called from the IME after `parseKBConfig`. */
    fun mount(root: KBNode) {
        rootNode = root
        refreshTone()
        redraw()
    }

    /**
     * A rebuild in progress, and whether another was asked for during it.
     *
     * removeAllViews() sends ACTION_CANCEL to a row that still has a finger on
     * it, and what that cancel does — rescue a tap, end a trackpad drag,
     * refresh suggestions — can call stateChanged() on this same stack. A
     * second redraw() inside the first added the new tree into the child array
     * the outer removal was still nulling out, and the next draw hit a null
     * child. Now the inner request waits and runs once the first has finished.
     */
    private var redrawing = false
    private var redrawAgain = false

    /** Cheap re-render: clear + walk again. Called on any state mutation. */
    fun stateChanged() {
        if (redrawing) { redrawAgain = true; return }
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
                // Or, with the dispersal, the parts fly out and the wave stays.
                currentMicMark?.beginPlay()
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
                // The parts fly home on their own; the same view stays
                // mounted throughout, so there is nothing to swap in.
                currentMicMark?.settle {}
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
     * Reused chip and divider views. Only ever grow, to the largest bar seen —
     * three or four views — so a repaint costs no inflation.
     */
    private val chipPool = ArrayList<TextView>()
    private val dividerPool = ArrayList<View>()

    /**
     * One-shot latch for the fallback below. A tree that has NO SuggestionBar
     * node at all (or gates it behind visibleIf) has no row to fill in place —
     * so redraw ONCE to let that gate re-evaluate, and then stop, rather than
     * paying a rebuild on every keystroke forever.
     */
    private var suggestionRemountAttempted = false

    private fun suggestionTag(words: List<String>): String =
        SUGGESTION_TAG_PREFIX + host.state().suggestionKind + "|" + words.joinToString("\u0000")

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
        if (row.tag == suggestionTag(want)) return
        fillSuggestionRow(row, want)
    }

    /**
     * Fill (or refill) a suggestion row — the Android half of iOS
     * renderSuggestionChips, styled by the same kb.suggestion.* flags.
     *
     * Chips are TextViews, not Buttons: a Button carries a 48dp minimum height
     * and all-caps text from the platform theme, which clipped chips in a 36dp
     * bar and shouted every word. Views are REUSED — only text, colours and
     * click target change — and the row is re-arranged only when its SHAPE
     * changes, so a keystroke repaints words, not the layout.
     *
     * Colours left blank on the server ("") keep the bar's own surface: the
     * SuggestionBar node's bg (or the theme key) and the theme's key text.
     */
    private fun fillSuggestionRow(row: LinearLayout, words: List<String>) {
        val ctx = host.context()
        val kind = host.state().suggestionKind
        val flat = flagString("kb.suggestion.style", "chips").lowercase() == "flat"
        val gap = dp(flagFloat("kb.suggestion.gap", 8f))
        val edge = dp(flagFloat("kb.suggestion.edgeInset", 4f))
        val padH = dp(flagFloat("kb.suggestion.chipPadH", 12f))
        val padV = dp(flagFloat("kb.suggestion.chipPadV", 4f))
        val radius = flagFloat("kb.suggestion.chipRadius", 12f) * ctx.resources.displayMetrics.density
        val fontSize = flagFloat("kb.suggestion.fontSize", 14f)
        val bgHex = flagString("kb.suggestion.chipBg", "")
        val fg = flagString("kb.suggestion.chipFg", "").takeIf { it.isNotBlank() }?.let { parseHex(it) }
            ?: parseHex(theme.keyText)
        val borderHex = flagString("kb.suggestion.chipBorder", "")
        val borderW = dp(flagFloat("kb.suggestion.chipBorderWidth", 1f))
        // Emphasis follows MEANING, not position: only a swipe's ranked
        // candidates have a best answer. A spelling list leads with the word as
        // typed, and painting "keep what I wrote" in brand amber says the
        // opposite of what it is.
        val lead = flagBoolean("kb.suggestion.emphasizeFirst", true) && kind == "candidates"
        val leadBg = flagColor("kb.suggestion.leadBg", "#E8A23C")
        val leadFg = flagColor("kb.suggestion.leadFg", "#000000")
        val dividerColor = flagString("kb.suggestion.dividerColor", "").takeIf { it.isNotBlank() }?.let { parseHex(it) }
            ?: ((parseHex(theme.keyText) and 0x00FFFFFF) or 0x24000000)
        val dividerH = dp(flagFloat("kb.suggestion.dividerHeight", 18f))

        row.setPadding(edge, 0, edge, 0)
        row.gravity = android.view.Gravity.CENTER_VERTICAL
        while (chipPool.size < words.size) {
            chipPool += TextView(ctx).apply {
                gravity = android.view.Gravity.CENTER
                isAllCaps = false
                maxLines = 1
                isClickable = true
                tag = SDUIRenderer.CHIP_TAG
            }
        }
        while (dividerPool.size < (words.size - 1).coerceAtLeast(0)) dividerPool += View(ctx)

        val desired = ArrayList<View>(words.size * 2)
        for (i in words.indices) {
            val isLead = lead && i == 0
            if (flat && i > 0) {
                val sep = dividerPool[i - 1]
                sep.setBackgroundColor(dividerColor)
                sep.layoutParams = LinearLayout.LayoutParams(dp(1), dividerH).apply {
                    leftMargin = gap / 2; rightMargin = gap / 2
                }
                desired += sep
            }
            val chip = chipPool[i]
            val word = words[i]
            // A revert quotes the user's own word — "keep what you typed".
            chip.text = if (kind == "revert") "\u201C$word\u201D" else word
            chip.setTextSize(TypedValue.COMPLEX_UNIT_SP, fontSize)
            chip.setTypeface(android.graphics.Typeface.DEFAULT,
                if (isLead) android.graphics.Typeface.BOLD else android.graphics.Typeface.NORMAL)
            chip.setPadding(padH, padV, padH, padV)
            if (flat) {
                chip.background = null
                chip.setTextColor(if (isLead) leadBg else fg)
            } else {
                val surface = if (bgHex.isBlank() && !isLead) {
                    (suggestionChipBackground?.invoke() as? GradientDrawable) ?: GradientDrawable()
                } else GradientDrawable().apply { setColor(if (isLead) leadBg else parseHex(bgHex)) }
                surface.cornerRadius = radius
                if (!isLead && borderHex.isNotBlank() && borderW > 0) surface.setStroke(borderW, parseHex(borderHex))
                chip.background = surface
                chip.setTextColor(if (isLead) leadFg else fg)
            }
            chip.layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply { if (!flat && i > 0) leftMargin = gap }
            // Rebound every pass: a reused chip must apply the word it is
            // showing NOW, never the one it carried before.
            chip.setOnClickListener {
                hapticTap(chip)
                host.applySuggestion(word)
            }
            desired += chip
        }
        // Touch the row only when its ARRANGEMENT changed.
        val same = row.childCount == desired.size &&
            desired.indices.all { row.getChildAt(it) === desired[it] }
        if (!same) {
            row.removeAllViews()
            for (v in desired) {
                (v.parent as? ViewGroup)?.removeView(v)
                row.addView(v)
            }
        } else {
            row.requestLayout()
        }
        row.tag = suggestionTag(words)
    }

    /** Fingerprint of every tree input EXCEPT shift/caps. When this is unchanged
     *  across a stateChanged(), the delta can only be shift/caps → fast path. */
    private fun treeKey(): String {
        val s = host.state()
        return listOf(
            s.layoutId, s.dictating, s.refining, s.status, s.returnLabel, s.returnAction,
            s.hasMultipleKeyboards, s.appearance,
            // A password box hides the mic and Refine (visibleIf state.secured).
            // Unfingerprinted, moving from a normal field into one took the
            // fast-shift path and left both on screen.
            s.secured,
            // suggestions deliberately NOT fingerprinted — they are applied in
            // place by refreshSuggestionBarInPlace(). Including them here put a
            // full teardown-and-rebuild of the whole keyboard on the keystroke
            // path, just to repaint three chips.
            toneLabel, micReassembling,
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
                k.label = shiftGlyph()
                k.textColor = shiftColor(drawnShiftRest)
            }
            for (p in drawnPlanes) p.invalidate()
        }
        shiftButton?.let { b ->
            b.text = shiftGlyph()
            b.setTextColor(shiftColor(shiftRestColor))
        }
    }

    // --- Shift (kb.shift.*) --------------------------------------------------
    //
    // The glyph and its colour are the server's: kb.shift.icon* name the four
    // states (lower/upper x outlined/locked) the way iOS does, as SF Symbol
    // names, which are drawn here as the matching Unicode shapes. A name this
    // build does not know is used as-is when it is itself a glyph ("⇧"), and
    // falls back to the shift/caps-lock arrows otherwise.

    /** The shift key's resting text colour (its node fg, else the theme's). */
    private var shiftRestColor: Int = 0
    private var drawnShiftRest: Int = 0

    private fun shiftGlyph(): String {
        val s = host.state()
        return if (s.capsLock) {
            glyphFor(if (s.shift) flagString("kb.shift.iconUpperLocked", "arrowtriangle.up.fill")
                     else flagString("kb.shift.iconLowerLocked", "arrowtriangle.down.fill"), "\u21ea")
        } else {
            glyphFor(if (s.shift) flagString("kb.shift.iconUpperOutlined", "arrowtriangle.up")
                     else flagString("kb.shift.iconLowerOutlined", "arrowtriangle.down"), "\u21e7")
        }
    }

    private fun shiftColor(rest: Int): Int =
        if (host.state().capsLock) flagColor("kb.shift.lockedColor", "#E8A23C") else rest

    private fun glyphFor(name: String, fallback: String): String = when (name) {
        "arrowtriangle.up" -> "\u25B3"
        "arrowtriangle.up.fill" -> "\u25B2"
        "arrowtriangle.down" -> "\u25BD"
        "arrowtriangle.down.fill" -> "\u25BC"
        "shift" -> "\u21e7"
        "shift.fill" -> "\u2B06"
        "capslock", "capslock.fill" -> "\u21ea"
        "arrow.up" -> "\u2191"
        "arrow.down" -> "\u2193"
        else -> if (name.isNotEmpty() && name.codePointCount(0, name.length) <= 2) name else fallback
    }

    /** Last shift tap, for double-tap caps lock. */
    private var lastShiftTapAt = 0L

    /**
     * A shift tap, on either render path. Locked → unlock. A second tap within
     * kb.shift.doubleTapMs → caps lock (0 turns the double tap off). Otherwise
     * a one-shot shift.
     */
    private fun pressShift() {
        val s = host.state()
        if (s.capsLock) {
            s.capsLock = false
            s.shift = false
            lastShiftTapAt = 0L
            host.onStateChanged()
            return
        }
        val now = android.os.SystemClock.uptimeMillis()
        val window = flagFloat("kb.shift.doubleTapMs", 0f).toLong()
        if (window > 0 && lastShiftTapAt > 0 && now - lastShiftTapAt <= window) {
            s.capsLock = true
            s.shift = true
            lastShiftTapAt = 0L
            host.onStateChanged()
            return
        }
        s.shift = !s.shift
        lastShiftTapAt = now
        host.onStateChanged()
    }

    /** Hold shift → caps lock, or back off when already locked. Caps lock is
     *  always uppercase-locked (shift stays true), as on iOS. */
    private fun holdShift() {
        val s = host.state()
        if (s.capsLock) {
            s.capsLock = false
            s.shift = false
        } else {
            s.capsLock = true
            s.shift = true
        }
        lastShiftTapAt = 0L
        host.onStateChanged()
    }

    /** Swap in a freshly-fetched config (e.g. background refetch returned). */
    fun updateConfig(cfg: KBConfig) {
        kbConfig = cfg
        cfg.root?.let { rootNode = it }
        refreshTone()
        redraw()
    }

    private fun redraw() {
        if (redrawing) { redrawAgain = true; return }
        redrawing = true
        try {
            redrawNow()
        } finally {
            redrawing = false
        }
        if (redrawAgain) {
            redrawAgain = false
            container.post { stateChanged() }
        }
    }

    private fun redrawNow() {
        // Clear any pending long-press repeats attached to the previous view
        // tree so they don't fire against views that no longer exist.
        handler.removeCallbacksAndMessages(null)
        // The keys the pop-up, tray and trackpad were tied to are going.
        focusByPlane.clear()
        keyPop?.clear()
        trackpadViews.clear()
        trackpadDrawn.clear()
        host.state().trackpadActive = false
        // Reset the fast-shift refs — repopulated as the fresh tree renders.
        letterButtonsByChar.clear()
        shiftButton = null
        drawnLettersByChar.clear()
        drawnShiftKey = null
        drawnPlanes.clear()
        lockableRows.clear()
        // Dropped with the tree that owned them; renderSuggestionBar re-registers
        // if the fresh tree still has a bar.
        suggestionRow = null
        suggestionChipBackground = null
        container.removeAllViews()
        applyEffect(container, theme.backgroundEffect ?: KBEffect.Solid(theme.background))
        rootNode?.let { render(it, container) }
        // A toast still on screen outlives the rebuild instead of vanishing
        // with the tree it was drawn over.
        toastView?.let { t -> if (t.parent == null) container.addView(t, t.layoutParams) }
        // Baseline for the next fast-shift comparison.
        lastTreeKey = treeKey()
        publishKeyGeometry(container)
        // dictating is fingerprinted in treeKey, so a start/stop lands here.
        applyDictationLock(host.state().dictating)
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
        applyStackStyle(ll, node.style)
        applyEvents(ll, node)
        for (c in node.children) render(c, ll)
    }

    /**
     * A stack's own layout knobs: `gap` between children and `align`.
     *
     * The gap is a transparent divider drawn only BETWEEN visible children, so
     * a child culled by visibleIf leaves no double gap, and LinearLayout counts
     * it before sharing out flex — keys keep their proportions. Android ignored
     * `gap` on every stack but drawn rows, so keys sat edge to edge and rows
     * touched, on a tree that asks for 6pt between keys and 10pt between rows.
     */
    private fun applyStackStyle(ll: LinearLayout, style: Map<String, Any?>) {
        val gap = numFromStyle(style["gap"]) ?: 0f
        if (gap > 0f) {
            val px = dp(gap)
            ll.dividerDrawable = GradientDrawable().apply {
                setColor(Color.TRANSPARENT)
                setSize(px, px)
            }
            ll.showDividers = LinearLayout.SHOW_DIVIDER_MIDDLE
        }
        gravityFor(style["align"] as? String, ll.orientation == LinearLayout.HORIZONTAL)?.let { ll.gravity = it }
    }

    /** `align` as a gravity: start / center / end, on the stack's cross axis
     *  for a stack and on both axes' reading line for text. */
    private fun gravityFor(align: String?, horizontal: Boolean): Int? = when (align?.lowercase()) {
        "center" -> android.view.Gravity.CENTER
        "start", "left", "leading" ->
            if (horizontal) android.view.Gravity.START or android.view.Gravity.CENTER_VERTICAL
            else android.view.Gravity.START
        "end", "right", "trailing" ->
            if (horizontal) android.view.Gravity.END or android.view.Gravity.CENTER_VERTICAL
            else android.view.Gravity.END
        else -> null
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
                // kb.swipe.minKeys: how many distinct keys a trace must cross
                // before it is read as a word rather than a sloppy tap.
                if (letters.size >= flagInt("kb.swipe.minKeys", 2).coerceAtLeast(2)) host.onSwipe(word)
            }
        }
        // Held keys: the accent tray, the space-bar trackpad, and the pop-up.
        configureHolds(ll)
        applyBackgroundEffect(ll, node)
        addChildWithStyle(parent, ll, node.style, isRow = parent.isHorizontal())
        applyPadding(ll, node.style)
        applyStackStyle(ll, node.style)
        applyEvents(ll, node)
        // A row of KEYS is blurred and locked while the mic records. The tools
        // row is not: the mic that stops the recording lives there, and blurring
        // the way out of a state is how you strand someone in it.
        if (node.children.none { it.type == "MicKey" || it.type == "SuggestionBar" }) {
            lockableRows += ll
        }
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

    /** Key rows that blur + stop taking touches while dictation is live. */
    private val lockableRows = ArrayList<TulmiKeyPlane>()

    /**
     * Blur the keys and take them out of service while the mic is recording.
     *
     * The blur is the honest signal — the keys are still there, they are just
     * not yours for the moment — and `locked` is what makes it true rather than
     * cosmetic. RenderEffect is API 31+; older devices get the dim alone, which
     * says the same thing with less polish rather than nothing at all.
     */
    private fun applyDictationLock(active: Boolean) {
        if (!flagBoolean("kb.dictation.dim.enabled", true)) return
        val radius = flagFloat("kb.dictation.dim.blurRadius", 14f)
        val dimAlpha = flagFloat("kb.dictation.dim.keyAlpha", 0.45f)
        for (row in lockableRows) {
            row.locked = active
            row.alpha = if (active) dimAlpha else 1f
            if (android.os.Build.VERSION.SDK_INT >= 31) {
                row.setRenderEffect(
                    if (active && radius > 0f) {
                        android.graphics.RenderEffect.createBlurEffect(
                            radius, radius, android.graphics.Shader.TileMode.CLAMP)
                    } else null
                )
            }
        }
    }

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
            val fill = parseHex((c.style["bg"] as? String) ?: theme.key)
            val fg = parseHex((c.style["fg"] as? String) ?: theme.keyText)
            val size = (numFromStyle(c.style["fontSize"]) ?: 16f) * dm.scaledDensity
            val radius = theme.keyRadius * dm.density

            // Case is read from LIVE state at COMMIT time, never baked into the
            // key — the same rule the Button path follows, so a fast-shift
            // repaint can never desync from what actually gets typed.
            val raw = boundText(c) ?: ((c.props["char"] as? String) ?: "")
            val hasPress = c.on.containsKey("onPress")
            val upper = st.shift || st.capsLock
            val keyLabel = when (c.type) {
                "LetterKey" -> if (raw.length == 1 && c.bind["content"] == null) {
                    if (upper) raw.uppercase() else raw.lowercase()
                } else raw
                "SpaceKey" -> label("space", "space")
                "ReturnKey" -> returnKeyLabel()
                "ShiftKey" -> shiftGlyph()
                "BackspaceKey" -> "\u232B"
                else -> ""
            }
            val accentReturn = c.type == "ReturnKey" && returnIsAccent()
            if (c.type == "ShiftKey") drawnShiftRest = fg
            val labelColor = when {
                c.type == "ShiftKey" -> shiftColor(fg)
                accentReturn -> flagColor("kb.returnKey.actionFg", "#FFFFFF")
                else -> fg
            }
            val keyFill = if (accentReturn) flagColor("kb.returnKey.actionBg", "#007AFF") else fill

            var pressEnd: (() -> Unit)? = null
            var pressStart: (() -> Unit)? = null
            val key: TulmiKeyPlane.DrawnKey
            val commit: () -> Unit = when (c.type) {
                "ShiftKey" -> { { pressShift(); invokeEvent(c, "onPress") } }
                "BackspaceKey" -> { { deleteBackwardOnce(); invokeEvent(c, "onPress") } }
                "SpaceKey" -> { { pressSpace(); invokeEvent(c, "onPress") } }
                "ReturnKey" -> { { pressReturn(); invokeEvent(c, "onPress") } }
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
                label = keyLabel, flex = flex, fixedWidthPx = fixedW,
                fill = keyFill, textColor = labelColor, textSizePx = size, radiusPx = radius,
                onCommit = { hapticTap(plane, hapticIdFor(c, raw)); commit() },
                onLongPress = when (c.type) {
                    // Hold shift = caps lock, as on the Button path.
                    "ShiftKey" -> { { hapticTap(plane, "shift"); holdShift() } }
                    else -> if (c.on.containsKey("onLongPress")) {
                        { invokeEvent(c, "onLongPress") }
                    } else null
                },
                onPressStart = { pressStart?.invoke() },
                onPressEnd = { pressEnd?.invoke() },
                longPressMs = if (c.type == "ShiftKey") flagFloat("kb.shift.longPressMs", 500f).toLong() else 0L,
            )

            // Backspace repeats while held. Wired through press start/end
            // rather than long-press because it must run UNTIL RELEASE, and it
            // suppresses the release commit so the last delete isn't doubled.
            if (c.type == "BackspaceKey") {
                var repeat: Runnable? = null
                pressStart = {
                    val r = deleteRepeater(onFirst = { key.suppressCommit = true; invokeEvent(c, "onLongPress") })
                    repeat = r
                    handler.postDelayed(r, deleteInitialDelayMs())
                }
                pressEnd = { repeat?.let { handler.removeCallbacks(it) }; repeat = null }
            }

            keys += key
            // Hold space to steer the caret, unless the server gave it a hold.
            if (c.type == "SpaceKey" && !c.on.containsKey("onLongPress")) trackpadDrawn += key
            if (c.type == "LetterKey" && raw.length == 1 && !hasPress) {
                drawnLettersByChar[raw.lowercase()] = key
            }
            if (c.type == "ShiftKey") drawnShiftKey = key
        }

        plane.drawnGapPx = (numFromStyle(node.style["gap"]) ?: 0f) * dm.density
        // Rows can own the band between them: see TulmiKeyPlane.drawnVInsetPx.
        // Backend-set, 0 by default, so this is inert until it is turned on.
        plane.drawnVInsetPx = flagFloat("kb.touch.vInsetPx", 0f) * dm.density
        plane.pressedFill = parseHex(theme.keyPressed)
        plane.setDrawnKeys(keys)
        drawnPlanes += plane
        return true
    }

    private var drawnShiftKey: TulmiKeyPlane.DrawnKey? = null

    // -----------------------------------------------------------------------
    // Held keys and the pop-up — the Android half of iOS's key callout, accent
    // tray and space-bar trackpad. The planes time the holds and keep the
    // fingers; this decides what a hold means and draws it into the
    // container's overlay, where it can never take a touch or move a key.
    // -----------------------------------------------------------------------

    /** The pop-up and the tray, painted over the whole keyboard. */
    private var keyPop: TulmiKeyPop? = null

    /** Which plane currently has a lone finger on a letter, and on what. */
    private val focusByPlane = HashMap<TulmiKeyPlane, Pair<String, RectF>>()

    /** Space keys a hold turns into a trackpad. */
    private val trackpadViews = java.util.Collections.newSetFromMap(java.util.WeakHashMap<View, Boolean>())
    private val trackpadDrawn = java.util.Collections.newSetFromMap(java.util.IdentityHashMap<TulmiKeyPlane.DrawnKey, Boolean>())

    private var trayMovedFrom: PointF? = null
    private var trackpadAnchor = -1
    /** The text around the caret when the trackpad began, and where the caret
     *  sat in it: steps are counted in characters as a person sees them (an
     *  emoji is one), and the caret stops at the ends of the text. */
    private var trackpadWindow = ""
    private var trackpadCaretInWindow = 0
    private var trackpadSteps = 0

    private val scratchLoc = IntArray(2)
    private val scratchBase = IntArray(2)

    private fun keyPop(): TulmiKeyPop {
        keyPop?.let { return it }
        val p = TulmiKeyPop()
        container.overlay.add(p)
        keyPop = p
        return p
    }

    /** A plane-local rect in container coordinates. */
    private fun toContainer(plane: View, r: RectF): RectF {
        plane.getLocationInWindow(scratchLoc)
        container.getLocationInWindow(scratchBase)
        val dx = (scratchLoc[0] - scratchBase[0]).toFloat()
        val dy = (scratchLoc[1] - scratchBase[1]).toFloat()
        return RectF(r.left + dx, r.top + dy, r.right + dx, r.bottom + dy)
    }

    private fun toContainerX(plane: View, x: Float): Float {
        plane.getLocationInWindow(scratchLoc)
        container.getLocationInWindow(scratchBase)
        return x + (scratchLoc[0] - scratchBase[0])
    }

    private fun toContainerY(plane: View, y: Float): Float {
        plane.getLocationInWindow(scratchLoc)
        container.getLocationInWindow(scratchBase)
        return y + (scratchLoc[1] - scratchBase[1])
    }

    private fun sizePop(p: TulmiKeyPop) {
        p.setBounds(0, 0, container.width, container.height)
    }

    /** Letters only, as on iOS: numbers, symbols and space never pop. */
    private fun pops(label: String?): Boolean =
        label != null && label.length == 1 && label[0].isLetter()

    /**
     * Show the pop-up only while exactly one plane has a lone finger on a
     * letter. Rows are separate planes, so two fingers in two rows would
     * otherwise each claim it and it would flicker between them.
     */
    private fun refreshPop() {
        val p = keyPop ?: if (focusByPlane.isEmpty()) return else keyPop()
        val only = focusByPlane.values.singleOrNull()
        if (only == null || p.trayOpen || host.state().trackpadActive) { p.hidePop(); return }
        sizePop(p)
        val dm = host.context().resources.displayMetrics
        p.headExtraWidth = flagFloat("kb.callout.headExtraWidth", 28f) * dm.density
        p.headMinWidth = flagFloat("kb.callout.headMinWidth", 44f) * dm.density
        p.headExtraHeight = flagFloat("kb.callout.headExtraHeight", 8f) * dm.density
        p.neckHeight = flagFloat("kb.callout.neckHeight", 10f) * dm.density
        p.headRadius = flagFloat("kb.callout.radius", 7f) * dm.density
        p.keyRadius = theme.keyRadius * dm.density
        p.edgeInset = flagFloat("kb.callout.edgeInset", 3f) * dm.density
        val shadow = flagColor("kb.callout.shadowColor", "#000000")
        val opacity = flagFloat("kb.callout.shadowOpacity", 0.18f).coerceIn(0f, 1f)
        p.setShadow(
            Color.argb((opacity * 255).toInt(), Color.red(shadow), Color.green(shadow), Color.blue(shadow)),
            flagFloat("kb.callout.shadowRadius", 5f) * dm.density,
            flagFloat("kb.callout.shadowOffsetX", 0f) * dm.density,
            flagFloat("kb.callout.shadowOffsetY", 2f) * dm.density,
        )
        val keyFill = parseHex(theme.key)
        val dark = luminance(keyFill) < 0.5
        val bg = flagString("kb.callout.bg", "").takeIf { it.isNotBlank() }?.let { parseHex(it) }
            ?: if (dark) Color.rgb(77, 77, 77) else Color.WHITE
        val ink = flagString("kb.callout.text", "").takeIf { it.isNotBlank() }?.let { parseHex(it) }
            ?: if (dark) Color.WHITE else Color.rgb(28, 28, 28)
        p.showPop(only.second, only.first, bg, ink, flagFloat("kb.callout.fontSize", 24f) * dm.scaledDensity)
    }

    private fun luminance(c: Int): Double =
        (0.299 * Color.red(c) + 0.587 * Color.green(c) + 0.114 * Color.blue(c)) / 255.0

    /** kb.accents for this key, as typed right now (shift applies), base first. */
    private fun accentsFor(label: String?): List<String>? {
        if (label == null || label.length != 1) return null
        if (!flagBoolean("kb.keyPlane.accentTrays", true)) return null
        val base = label.lowercase()
        val list: List<String> = when (val raw = (kbConfig.flags["kb.accents"] as? JSONObject)?.opt(base)) {
            is JSONArray -> (0 until raw.length()).mapNotNull { raw.optString(it, "").takeIf { s -> s.isNotEmpty() } }
            // Older configs sent one string of glyphs: "àáâ".
            is String -> {
                val out = ArrayList<String>()
                var i = 0
                while (i < raw.length) {
                    val n = Character.charCount(raw.codePointAt(i))
                    out += raw.substring(i, i + n)
                    i += n
                }
                out
            }
            else -> return null
        }
        if (list.isEmpty()) return null
        val s = host.state()
        val upper = s.shift || s.capsLock
        return (listOf(label) + list).map { if (upper) it.uppercase() else it }
    }

    /** One held-key brain for every row. */
    private val keyGestures = object : TulmiKeyPlane.Gestures {
        override fun focus(plane: TulmiKeyPlane, owner: Any?, label: String?, rect: RectF?) {
            if (!flagBoolean("kb.callout.enabled", true)) {
                if (focusByPlane.isNotEmpty()) { focusByPlane.clear(); keyPop?.hidePop() }
                return
            }
            if (owner == null || rect == null || !pops(label)) {
                if (focusByPlane.remove(plane) == null && focusByPlane.isEmpty()) return
            } else {
                val s = host.state()
                val shown = if (s.shift || s.capsLock) label!!.uppercase() else label!!.lowercase()
                focusByPlane[plane] = shown to toContainer(plane, rect)
            }
            refreshPop()
        }

        override fun accentsFor(owner: Any, label: String?): List<String>? = this@SDUIRenderer.accentsFor(label)

        override fun trayOpen(plane: TulmiKeyPlane, owner: Any, items: List<String>, rect: RectF): Boolean {
            val p = keyPop()
            sizePop(p)
            val dm = host.context().resources.displayMetrics
            p.chipWidth = flagFloat("kb.accentTray.chipWidth", 40f) * dm.density
            p.chipGap = flagFloat("kb.accentTray.gap", 4f) * dm.density
            p.trayPadding = flagFloat("kb.accentTray.padding", 4f) * dm.density
            p.trayHeight = flagFloat("kb.accentTray.height", 48f) * dm.density
            p.trayRadius = flagFloat("kb.accentTray.radius", 8f) * dm.density
            p.chipRadius = flagFloat("kb.accentTray.chipRadius", 6f) * dm.density
            p.trayOffsetY = flagFloat("kb.accentTray.offsetY", -52f) * dm.density
            p.edgeInset = 4f * dm.density
            p.showTray(
                toContainer(plane, rect), items,
                bg = parseHex(theme.key),
                ink = parseHex(theme.keyText),
                activeBg = flagColor("kb.accentTray.chipActiveBg", "#007AFF"),
                textPx = flagFloat("kb.accentTray.chipFontSize", 22f) * dm.scaledDensity,
            )
            trayMovedFrom = null
            holdHaptic(plane)
            TulmiTelemetry.bump(TulmiTelemetry.ACCENT_TRAY_OPENED)
            return true
        }

        override fun trayMove(plane: TulmiKeyPlane, x: Float, y: Float) {
            val p = keyPop ?: return
            val cx = toContainerX(plane, x)
            val cy = toContainerY(plane, y)
            // The base stays lit until the finger actually travels, so a hold
            // released where it started types the letter that was held.
            val from = trayMovedFrom
            if (from == null) { trayMovedFrom = PointF(cx, cy); return }
            val travel = Math.hypot((cx - from.x).toDouble(), (cy - from.y).toDouble())
            if (p.active == 0 && travel < 4.0 * host.context().resources.displayMetrics.density) return
            p.setActive(p.chipAt(cx, cy))
        }

        override fun trayRelease(plane: TulmiKeyPlane, x: Float, y: Float, onKey: Boolean, cancelled: Boolean): Boolean {
            val p = keyPop ?: return false
            val active = p.active
            val pick = p.activeItem()
            p.hideTray()
            trayMovedFrom = null
            if (cancelled) return false
            return when {
                active == 0 -> true                     // the base: the key's own tap
                pick != null -> { typeAccent(pick); false }
                else -> onKey                           // slid off the tray, back on the key
            }
        }

        override fun isTrackpad(owner: Any): Boolean {
            if (!flagBoolean("kb.trackpad.enabled", true)) return false
            return when (owner) {
                is View -> owner in trackpadViews
                is TulmiKeyPlane.DrawnKey -> owner in trackpadDrawn
                else -> false
            }
        }

        override fun trackpadStart(plane: TulmiKeyPlane) {
            val s = host.state()
            s.trackpadActive = true
            trackpadAnchor = host.caretPosition()
            trackpadSteps = 0
            val ic = host.ic()
            val before = ic?.getTextBeforeCursor(2000, 0)?.toString() ?: ""
            val after = ic?.getTextAfterCursor(2000, 0)?.toString() ?: ""
            trackpadWindow = before + after
            trackpadCaretInWindow = before.length
            // The window must start inside the field for the anchor to place it.
            if (trackpadAnchor < before.length) trackpadAnchor = -1
            lastSpaceAt = 0L
            keyPop?.hidePop()
            val dim = flagFloat("kb.trackpad.dimAlpha", 0.35f).coerceIn(0f, 1f)
            for (row in lockableRows) row.alpha = dim
            holdHaptic(plane)
            TulmiTelemetry.bump(TulmiTelemetry.TRACKPAD_USED)
        }

        override fun trackpadMove(plane: TulmiKeyPlane, dx: Float) {
            val perChar = flagFloat("kb.trackpad.ptPerChar", 7f).coerceAtLeast(1f) *
                host.context().resources.displayMetrics.density
            val steps = (dx / perChar).toInt()
            if (steps == trackpadSteps) return
            val delta = steps - trackpadSteps
            trackpadSteps = steps
            moveCaret(delta)
        }

        override fun trackpadEnd(plane: TulmiKeyPlane) {
            val s = host.state()
            s.trackpadActive = false
            lastSpaceAt = 0L
            for (row in lockableRows) row.alpha = 1f
            if (trackpadSteps != 0) host.onCaretMoved()
            trackpadSteps = 0
            trackpadAnchor = -1
            trackpadWindow = ""
        }
    }

    /**
     * Step the caret. From a known start it is placed exactly (setSelection),
     * which never lags however fast the finger moves; without one it steps with
     * arrow keys, which every editor understands.
     */
    private fun moveCaret(delta: Int) {
        val ic = host.ic() ?: return
        if (trackpadAnchor >= 0) {
            val inWindow = stepCodePoints(trackpadWindow, trackpadCaretInWindow, trackpadSteps)
            val target = trackpadAnchor - trackpadCaretInWindow + inWindow
            ic.setSelection(target, target)
            return
        }
        val code = if (delta < 0) android.view.KeyEvent.KEYCODE_DPAD_LEFT else android.view.KeyEvent.KEYCODE_DPAD_RIGHT
        repeat(kotlin.math.abs(delta)) {
            ic.sendKeyEvent(android.view.KeyEvent(android.view.KeyEvent.ACTION_DOWN, code))
            ic.sendKeyEvent(android.view.KeyEvent(android.view.KeyEvent.ACTION_UP, code))
        }
    }

    /** The bump that says a hold took: the tray opened, the trackpad woke. */
    private fun holdHaptic(v: View) {
        if (!flagBoolean("kb.haptics.enabled", true) || !flagBoolean("kb.haptics.holds", true)) return
        v.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
    }

    /** Move `steps` characters from `from` in `s`, never splitting a
     *  surrogate pair and never leaving the string. */
    private fun stepCodePoints(s: String, from: Int, steps: Int): Int {
        var i = from.coerceIn(0, s.length)
        var n = steps
        while (n > 0 && i < s.length) { i += Character.charCount(s.codePointAt(i)); n-- }
        while (n < 0 && i > 0) { i -= Character.charCount(s.codePointBefore(i)); n++ }
        return i.coerceIn(0, s.length)
    }

    /** Type a tray pick: the same shift release and word refresh as a letter. */
    private fun typeAccent(ch: String) {
        insertText(ch)
        val s = host.state()
        if (s.shift && !s.capsLock) { s.shift = false; host.onStateChanged() }
    }

    /** Timings and switches the planes read from the server. */
    private fun configureHolds(plane: TulmiKeyPlane) {
        plane.gestures = keyGestures
        plane.trayHoldMs = flagFloat("kb.accentTray.longPressMs", 500f).toLong()
        plane.trackpadHoldMs = flagFloat("kb.trackpad.longPressMs", 300f).toLong()
        plane.holdCancelDriftPx = flagFloat("kb.accentTray.cancelDriftPt", 12f) *
            host.context().resources.displayMetrics.density
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

    /**
     * The live text a key is bound to (bind.content), or null when it is not
     * bound. Any state key works — "status" (the guidance band), "returnLabel",
     * "tone", "layoutId", "quota.status", "user.x", "flags.kb.x" — so the server
     * can put live state on any key without a build. Android used to honour
     * "tone" alone, which left the tree's status band blank: every permission,
     * sign-in and out-of-words message the keyboard raised was never drawn.
     */
    private fun boundText(node: KBNode): String? {
        val key = node.bind["content"] ?: return null
        if (key == "tone" || key == "state.tone") return toneLabel.ifEmpty { null }
        return when (val v = lookup(key)) {
            null -> null
            is String -> v
            is Number -> if (v.toDouble() == Math.floor(v.toDouble())) v.toLong().toString() else v.toString()
            JSONObject.NULL -> null
            else -> v.toString()
        }
    }

    /** LetterKey — Button labeled with props.char (capitalized on shift/caps). */
    private fun renderLetterKey(node: KBNode, parent: ViewGroup) {
        // A LetterKey bound to live state (the tone pill, the status band)
        // shows that, not a static char. Only single-char, unbound labels
        // follow shift-casing; bound text stays as authored.
        val bound = boundText(node)
        val raw = bound ?: ((node.props["char"] as? String) ?: "")
        val label = if (raw.length == 1 && bound == null) {
            if (host.state().shift || host.state().capsLock) raw.uppercase() else raw.lowercase()
        } else raw
        val b = keyButton(label, node)
        // Register plain letters for the in-place fast-shift path (keyed by the
        // base lowercase char). Special keys (onPress override), bound keys and
        // multi-char labels are excluded — they don't re-case.
        if (raw.length == 1 && bound == null && !node.on.containsKey("onPress")) {
            letterButtonsByChar[raw.lowercase()] = b
        }
        b.setOnClickListener {
            hapticTap(b, raw.ifEmpty { label })
            // If the backend attached an onPress action (tone pill → cycleTone,
            // layer keys "123"/"ABC"/"#+=" → switchLayout, …), dispatch THAT and
            // do NOT type the label. Only a plain letter (no onPress override)
            // inserts its character. Mirrors iOS bindTap (on.onPress wins over insert).
            if (node.on.containsKey("onPress")) {
                invokeEvent(node, "onPress")
            } else if (bound == null) {
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
        val isTonePill = node.bind["content"] == "tone"
        if (isTonePill && flagBoolean("kb.tone.sheet.enabled", true)) {
            // Hold the pill → pick any voice or tone directly instead of
            // cycling, after the server's threshold.
            bindHold(parent, b, flagFloat("kb.tone.sheet.longPressMs", 300f).toLong()) {
                hapticTap(b, "tone")
                showToneSheet(b)
            }
        } else {
            b.setOnLongClickListener { invokeEvent(node, "onLongPress"); true }
        }
        addChildWithStyle(parent, b, node.style, isRow = parent.isHorizontal())
    }

    /**
     * Give a key a hold gesture: [onHold] fires after [holdMs] of an unbroken
     * press, and the release that follows is NOT also a tap.
     *
     * In a key row the row's plane runs it (TulmiKeyPlane.setHold), so the key
     * keeps gap filling and rolling presses — shift held while a letter in the
     * same row goes down still types it. Anywhere else the key times its own
     * press.
     */
    private fun bindHold(parent: ViewGroup, v: View, holdMs: Long, onHold: () -> Unit) {
        val plane = parent as? TulmiKeyPlane
        if (plane != null && plane.planeEnabled) {
            plane.setHold(v, holdMs, onHold)
            return
        }
        var fired = false
        val hold = Runnable { fired = true; onHold() }
        v.setOnTouchListener { view, e ->
            when (e.actionMasked) {
                android.view.MotionEvent.ACTION_DOWN -> {
                    fired = false
                    handler.postDelayed(hold, holdMs.coerceAtLeast(50L))
                    false
                }
                android.view.MotionEvent.ACTION_UP -> {
                    handler.removeCallbacks(hold)
                    if (fired) { swallowRelease(view, e); true } else false
                }
                android.view.MotionEvent.ACTION_CANCEL -> {
                    handler.removeCallbacks(hold)
                    false
                }
                else -> false
            }
        }
    }

    /** End a press the key already acted on WITHOUT its click: the view sees a
     *  cancel, which clears its pressed state and pending taps. */
    private fun swallowRelease(v: View, up: android.view.MotionEvent) {
        val cancel = android.view.MotionEvent.obtain(up)
        cancel.action = android.view.MotionEvent.ACTION_CANCEL
        v.onTouchEvent(cancel)
        cancel.recycle()
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
        val b = keyButton(label("space", "space"), node)
        b.setOnClickListener {
            hapticTap(b, "space")
            pressSpace()
            invokeEvent(node, "onPress")
        }
        // Hold to steer the caret (the row's plane runs it), unless the server
        // gave space a hold of its own.
        if (!node.on.containsKey("onLongPress")) trackpadViews += b
        addChildWithStyle(parent, b, node.style, isRow = parent.isHorizontal())
    }

    /**
     * Space ends a word: the host gets its chance to expand or correct it
     * first, then the space lands, then a symbol layer hands back to letters.
     */
    private fun pressSpace() {
        val now = android.os.SystemClock.uptimeMillis()
        if (smartPeriod(now)) { autoReturnToLetters(); return }
        host.beforeWordBoundary(" ")
        insertText(" ")
        lastSpaceAt = now
        autoReturnToLetters()
    }

    /** When space last typed a space; 0 after anything that breaks the pair. */
    private var lastSpaceAt = 0L

    /**
     * Two spaces in quick succession end the sentence: the first becomes
     * ". ", as on iOS and every system keyboard. kb.smartPeriod turns it off;
     * kb.smartPeriod.windowMs is how quick "quick" is.
     *
     * Only after a word — never after punctuation, a line break or another
     * space — and never in a password box, where two spaces are two spaces.
     */
    private fun smartPeriod(now: Long): Boolean {
        val since = now - lastSpaceAt
        lastSpaceAt = 0L
        if (!flagBoolean("kb.smartPeriod", true) || host.state().secured) return false
        if (since > flagFloat("kb.smartPeriod.windowMs", 500f).toLong()) return false
        val ic = host.ic() ?: return false
        val before = ic.getTextBeforeCursor(2, 0)?.toString() ?: return false
        if (before.length < 2 || before[1] != ' ') return false
        val prev = before[0]
        if (prev.isWhitespace() || isPunctuation(prev)) return false
        ic.beginBatchEdit()
        ic.deleteSurroundingText(1, 0)
        ic.commitText(". ", 1)
        ic.endBatchEdit()
        TulmiTelemetry.bump(TulmiTelemetry.KEYSTROKES)
        host.onTextInserted()
        return true
    }

    private fun isPunctuation(c: Char): Boolean = when (Character.getType(c).toByte()) {
        Character.CONNECTOR_PUNCTUATION, Character.DASH_PUNCTUATION, Character.START_PUNCTUATION,
        Character.END_PUNCTUATION, Character.INITIAL_QUOTE_PUNCTUATION,
        Character.FINAL_QUOTE_PUNCTUATION, Character.OTHER_PUNCTUATION -> true
        else -> false
    }

    /**
     * A space typed on the number or symbol layer flips back to letters, like
     * the system keyboard (kb.layer.returnAfterSpace). Which layers count as
     * symbols and which one is "letters" are the server's to name.
     */
    private fun autoReturnToLetters() {
        if (!flagBoolean("kb.layer.returnAfterSpace", false)) return
        val s = host.state()
        val symbols = flagString("kb.layer.symbolIds", "123,sym").split(",").map { it.trim() }.filter { it.isNotEmpty() }
        if (s.layoutId !in symbols) return
        val letters = flagString("kb.layer.lettersId", "en")
        if (letters.isEmpty() || s.layoutId == letters) return
        // Posted: this runs inside the space key's own click, and the switch
        // rebuilds the tree that key belongs to.
        handler.post {
            if (host.state().layoutId in symbols) {
                host.state().layoutId = letters
                host.onStateChanged()
            }
        }
    }

    /** ShiftKey — tap toggles shift, double-tap or hold locks caps. */
    private fun renderShiftKey(node: KBNode, parent: ViewGroup) {
        val b = keyButton(shiftGlyph(), node)
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, flagFloat("kb.shift.iconSize", 16f))
        applyFontWeight(b, flagString("kb.shift.iconWeight", "semibold"))
        shiftButton = b   // let the fast-shift path recolor it in place
        b.setOnClickListener {
            hapticTap(b, "shift")
            pressShift()
            invokeEvent(node, "onPress")
        }
        bindHold(parent, b, flagFloat("kb.shift.longPressMs", 500f).toLong()) {
            hapticTap(b, "shift")
            holdShift()
            invokeEvent(node, "onLongPress")
        }
        addChildWithStyle(parent, b, node.style, isRow = parent.isHorizontal())
        // After the node style: its fg is the RESTING colour, and a locked
        // shift is drawn in kb.shift.lockedColor over it.
        shiftRestColor = (node.style["fg"] as? String)?.let { parseHex(it) } ?: parseHex(theme.keyText)
        b.setTextColor(shiftColor(shiftRestColor))
    }

    // --- Return -----------------------------------------------------------------

    /** Return performs the field's own action (Search, Send, Go, Next, Done)
     *  when it has one and kb.return.editorAction allows; otherwise it types a
     *  newline. It used to ALWAYS type a newline — into search boxes and chat
     *  fields whose send button it was supposed to be. */
    private fun returnPerformsAction(): Boolean =
        host.state().returnAction != 0 && flagBoolean("kb.return.editorAction", true)

    /** The actions drawn in the accent colour — the ones that finish something.
     *  Next / Previous move focus and stay plain, as on iOS. */
    private fun returnIsAccent(): Boolean {
        if (!returnPerformsAction()) return false
        return when (host.state().returnAction) {
            EditorInfo.IME_ACTION_SEARCH, EditorInfo.IME_ACTION_SEND,
            EditorInfo.IME_ACTION_GO, EditorInfo.IME_ACTION_DONE -> true
            else -> false
        }
    }

    /** "Search" / "Send" / … for an action field (the host resolves those
     *  from labels return.*), the plain labels.return otherwise. */
    private fun returnKeyLabel(): String {
        val plain = label("return", "return")
        return if (returnPerformsAction()) host.state().returnLabel.ifEmpty { plain } else plain
    }

    private fun pressReturn() {
        val ic = host.ic() ?: return
        if (returnPerformsAction()) {
            ic.performEditorAction(host.state().returnAction)
            return
        }
        host.beforeWordBoundary("\n")
        insertText("\n")
    }

    /** ReturnKey — the field's action, or a newline. */
    private fun renderReturnKey(node: KBNode, parent: ViewGroup) {
        val b = keyButton(returnKeyLabel(), node)
        b.setOnClickListener {
            hapticTap(b, "return")
            pressReturn()
            invokeEvent(node, "onPress")
        }
        addChildWithStyle(parent, b, node.style, isRow = parent.isHorizontal())
        // After the node style, which would otherwise repaint it plain.
        if (returnIsAccent()) {
            (b.background as? GradientDrawable)?.setColor(flagColor("kb.returnKey.actionBg", "#007AFF"))
            b.setTextColor(flagColor("kb.returnKey.actionFg", "#FFFFFF"))
        }
    }

    // --- Backspace ----------------------------------------------------------

    /**
     * Delete one thing backwards: an autocorrection the host can undo
     * (kb.autocorrect.backspaceRevert), else the selection, else one character
     * — a whole code point, so an emoji is never cut in half.
     */
    private fun deleteBackwardOnce(checkSelection: Boolean = true) {
        if (host.onBackspace()) return
        val ic = host.ic() ?: return
        val selected = if (checkSelection) ic.getSelectedText(0) else null
        when {
            !selected.isNullOrEmpty() -> ic.commitText("", 1)
            Build.VERSION.SDK_INT >= 24 -> ic.deleteSurroundingTextInCodePoints(1, 0)
            else -> ic.deleteSurroundingText(1, 0)
        }
        TulmiTelemetry.bump(TulmiTelemetry.KEYSTROKES)
        host.onTextDeleted()
    }

    /** Hold before backspace starts repeating (kb.delete.initialDelayMs). */
    private fun deleteInitialDelayMs(): Long = flagFloat("kb.delete.initialDelayMs", 400f).toLong().coerceAtLeast(50L)

    /**
     * The hold-to-delete repeat: a character every kb.delete.repeatIntervalMs,
     * then whole words once kb.delete.wordAfterChars characters have gone (0
     * never switches) — the same acceleration iOS has. [onFirst] runs as the
     * repeat takes over from the tap.
     */
    private fun deleteRepeater(onFirst: () -> Unit): Runnable {
        val interval = flagFloat("kb.delete.repeatIntervalMs", 50f).toLong().coerceAtLeast(10L)
        val wordAfter = flagFloat("kb.delete.wordAfterChars", 0f).toInt()
        var count = 0
        return object : Runnable {
            override fun run() {
                if (count == 0) onFirst()
                count += 1
                if (wordAfter > 0 && count > wordAfter) {
                    if (!host.onBackspace()) { deleteWord(); host.onTextDeleted() }
                } else {
                    deleteBackwardOnce(checkSelection = false)
                }
                handler.postDelayed(this, interval)
            }
        }
    }

    /** BackspaceKey — deletes on tap; held, repeats and then accelerates. */
    private fun renderBackspaceKey(node: KBNode, parent: ViewGroup) {
        val resId = iconRegistry["backspace"]
        val view: View = if (resId != null) {
            ImageButton(host.context()).apply {
                setImageResource(resId)
                background = keyBackground(node)
            }
        } else {
            keyButton("\u232B", node)
        }
        view.setOnClickListener {
            hapticTap(view, "backspace")
            deleteBackwardOnce()
            invokeEvent(node, "onPress")
        }
        // The repeat is driven by this key's OWN down/up/cancel, so the key
        // plane must not take its touches (RAW_TOUCH), or it would never stop.
        view.tag = TulmiKeyPlane.RAW_TOUCH
        var repeat: Runnable? = null
        var repeated = false
        view.setOnTouchListener { v, e ->
            when (e.actionMasked) {
                android.view.MotionEvent.ACTION_DOWN -> {
                    repeated = false
                    val r = deleteRepeater(onFirst = {
                        repeated = true
                        hapticTap(view, "backspace")
                        invokeEvent(node, "onLongPress")
                    })
                    repeat = r
                    handler.postDelayed(r, deleteInitialDelayMs())
                    false
                }
                android.view.MotionEvent.ACTION_UP, android.view.MotionEvent.ACTION_CANCEL -> {
                    repeat?.let { handler.removeCallbacks(it) }
                    repeat = null
                    // A hold that already deleted must not delete once more on release.
                    if (repeated && e.actionMasked == android.view.MotionEvent.ACTION_UP) {
                        swallowRelease(v, e)
                        true
                    } else false
                }
                else -> false
            }
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
            keyButton(label("globe", "\u2295"), node)   // circled plus, a text mark not a pictograph
        }
        view.setOnClickListener {
            hapticTap(view, "globe")
            val imm = host.context().getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
            imm?.showInputMethodPicker()
            invokeEvent(node, "onPress")
        }
        view.setOnLongClickListener {
            hapticTap(view, "globe")
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
        // THE MARK, FROM THE SERVER: its shapes and its motion travel on the
        // node. Absent — a backend older than this — the bundled drawable
        // stands in, which is the same picture standing still.
        val markSpec = node.props["mark"] as? JSONObject
        val markMotion = node.props["motion"] as? JSONObject
        val markProgram = node.props["program"] as? JSONObject
        val fg = (node.style["fg"] as? String)?.let { parseHex(it) } ?: parseHex(theme.keyText)
        val tinted = markSpec?.optBoolean("tint", true) ?: true
        // The dots burst from whichever mark the key is drawing.
        val mark = markSpec?.let { TulmiMarkView.bitmap(it, fg, dp(44)) } ?: markBitmap()
        val dictating = host.state().dictating
        // What the server wants while the microphone is open: the dispersal
        // (the parts fly out and only the wave stays, in the mark branch), the
        // particles, or nothing.
        val recKind = if (markProgram != null && markProgram.optDouble("version", 0.0) >= 1) "program" else TulmiMarkView.recordingKind(markMotion)

        val view: View = if (particlesOn && recKind == "particles" && (dictating || micReassembling)) {
            val frame = FrameLayout(host.context()).apply { background = keyBackground(node) }
            val inset = dp(flagFloat("kb.mic.particles.inset", 6f).toInt())
            frame.setPadding(inset, inset, inset, inset)
            val particles = currentMicParticles?.also { existing ->
                (existing.parent as? ViewGroup)?.removeView(existing)   // detach from the discarded tree
            } ?: MicParticleView(
                host.context(),
                count = flagFloat("kb.mic.particles.count", 40f).toInt(),
                dotRadius = flagFloat("kb.mic.particles.radius", 1.5f),
                dotColor = parseHex(theme.keyText),
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
        } else if (markSpec != null) {
            // THE MARK, DRAWN FROM THE SERVER'S SHAPES, not from a picture:
            // resized, recoloured or set moving by a deploy. Only geometry
            // reaches this branch, so pushed media still cannot stand where
            // the mark stands. With the dispersal it is the same view at idle
            // and while recording: the parts fly out and back in place.
            FrameLayout(host.context()).apply {
                background = keyBackground(node)
                val pad = dp(flagFloat("kb.mic.idleIconInset", 10f).toInt())
                setPadding(pad, pad, pad, pad)
                val ink = if (tinted) fg else null
                addView(
                    if (recKind == "disperse" || recKind == "program") persistedMark(markSpec, markMotion, markProgram, ink)
                    else TulmiMarkView(host.context(), markSpec, markMotion, ink, markProgram),
                    FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT,
                    ),
                )
            }
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
                keyButton(label("mic", "\u25CF"), node)     // filled circle; the brand mark replaces it when the drawable loads
            }
        }

        view.setOnClickListener {
            hapticTap(view, "mic")
            if (host.state().dictating) host.stopDictation() else host.startDictation()
            invokeEvent(node, "onPress")
        }
        addChildWithStyle(parent, view, node.style, isRow = parent.isHorizontal())
    }

    /** The one mark view for the dispersal, reused across redraws while the spec,
     *  motion and ink are the same objects; a new tree or a theme flip makes
     *  a new one. Built mid-recording (a deploy landed), it starts at once. */
    private fun persistedMark(spec: JSONObject, motion: JSONObject?, program: JSONObject?, tint: Int?): TulmiMarkView {
        val key = "${System.identityHashCode(spec)}|${System.identityHashCode(motion)}|${System.identityHashCode(program)}|$tint"
        currentMicMark?.let { if (currentMicMarkKey == key) { (it.parent as? ViewGroup)?.removeView(it); return it } }
        return TulmiMarkView(host.context(), spec, motion, tint, program).also {
            it.level = { host.state().micLevel }
            currentMicMark = it
            currentMicMarkKey = key
            if (host.state().dictating) it.beginPlay()
        }
    }

    /** RefineKey — triggers the existing refine path. */
    private fun renderRefineKey(node: KBNode, parent: ViewGroup) {
        val b = keyButton(label("refine", "Refine"), node)
        b.setOnClickListener {
            hapticTap(b, "refine")
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
            ViewGroup.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )
        // The chip surface comes from the bar NODE, so it has to be captured
        // here — the in-place refresh runs without a node in hand.
        suggestionChipBackground = { keyBackground(node) }
        suggestionRow = row
        fillSuggestionRow(row, host.state().suggestions)
        // The node's own height wins; a tree that leaves it out gets the bar
        // height the server set for every tree (kb.suggestion.height).
        val style = if (node.style.containsKey("height")) node.style
            else node.style + ("height" to flagFloat("kb.suggestion.height", 36f))
        addChildWithStyle(parent, scroll, style, isRow = parent.isHorizontal())
    }

    /** Waveform — bars that follow state.micLevel, shaped by kb.waveform.*. */
    private fun renderWaveform(node: KBNode, parent: ViewGroup) {
        val dm = host.context().resources.displayMetrics
        val bars = (node.props["bars"] as? Number)?.toInt() ?: flagInt("kb.waveform.barCount", 24)
        val color = (node.props["color"] as? String) ?: flagString("kb.waveform.color", "#999999")
        val wf = WaveformView(
            host.context(),
            barCount = bars.coerceIn(1, 128),
            color = parseHex(color),
            radiusPx = flagFloat("kb.waveform.radius", 1.5f) * dm.density,
            spacingPx = flagFloat("kb.waveform.spacing", 3f) * dm.density,
            levelMultiplier = flagFloat("kb.waveform.levelMultiplier", 0.6f),
            baselineMin = flagFloat("kb.waveform.baselineMin", 0.2f),
            baselineMax = flagFloat("kb.waveform.baselineMax", 0.6f),
            fps = flagFloat("kb.waveform.fps", 60f),
            levelProvider = { host.state().micLevel },
            activeProvider = { host.state().dictating },
        )
        val style = if (node.style.containsKey("height")) node.style
            else node.style + ("height" to flagFloat("kb.waveform.height", 24f))
        addChildWithStyle(parent, wf, style, isRow = parent.isHorizontal())
    }

    /** StatusLabel — TextView bound to state.status. */
    private fun renderStatusLabel(node: KBNode, parent: ViewGroup) {
        val tv = TextView(host.context()).apply {
            text = host.state().status
            setTextColor(parseHex(theme.keyText))
        }
        applyTextStyle(tv, node.style)
        addChildWithStyle(parent, tv, node.style, isRow = parent.isHorizontal())
    }

    /** Divider — hairline strip. Uses theme.keyText @ low alpha unless overridden. */
    private fun renderDivider(node: KBNode, parent: ViewGroup) {
        val v = View(host.context())
        val bg = (node.style["bg"] as? String) ?: theme.keyText
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
        // Props arrive as org.json values: an object is a JSONObject, not a Map
        // (the old Map cast never matched, so props.spec.url never loaded).
        val url = when (val spec = node.props["spec"]) {
            is JSONObject -> spec.optString("url", "").takeIf { it.isNotEmpty() }
            is Map<*, *> -> spec["url"] as? String
            else -> null
        } ?: (node.props["url"] as? String)
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
        val frames: List<Any?> = when (val raw = node.props["frames"]) {
            is JSONArray -> (0 until raw.length()).map { raw.opt(it) }
            is List<*> -> raw
            else -> emptyList()
        }
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
                val url = when (val f = frames[index]) {
                    is JSONObject -> f.optString("url", "")
                    is Map<*, *> -> f["url"] as? String
                    is String -> f
                    else -> null
                }
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
        val chips = pinned.mapNotNull { p ->
            TulmiPersonalityRow.ChipData(
                id = strField(p, "id") ?: return@mapNotNull null,
                name = strField(p, "name") ?: "",
                emoji = strField(p, "emoji") ?: "",
                tone = strField(p, "tone") ?: "",
            )
        }
        // The same tone list the pill cycles, in the server's order.
        val toneList = TulmiTone.tones(kbConfig.flags).map { TulmiPersonalityRow.Tone(id = it.id, label = it.label) }
        row.update(
            chips = chips,
            tones = toneList,
            activeId = TulmiTone.activeVoiceId(host.context(), kbConfig.flags),
            accentColor = parseHex(theme.accent),
            chipBgColor = flagColor("kb.personalityRow.chipBg", "#FFFFFF17"),
            chipFgColor = parseHex(theme.keyText),
        )
        row.onSelect = { presetId, tone ->
            // A chip tap switches voice (its own tone); a pick from its tone
            // sheet switches voice AND tone. Saved like a pill pick — locally
            // for the next refine, and to the server.
            val voice = TulmiTone.voices(kbConfig.flags).firstOrNull { it.id == presetId }
            val item = TulmiTone.Item("voice", presetId, voice?.label ?: presetId, tone ?: voice?.tone ?: "")
            TulmiTone.select(host.context(), kbConfig.flags, item)
            refreshTone()
            host.onStateChanged()
        }
    }

    /**
     * Unknown component. Hidden: a node type this build does not know is a
     * NEWER tree, and the user should see the rest of it, not a red square.
     * kb.render.unknownNode = "debug" brings the square back for development.
     */
    private fun renderUnknown(node: KBNode, parent: ViewGroup) {
        Log.w("SDUI", "unknown component: ${node.type}")
        if (flagString("kb.render.unknownNode", "hide") != "debug") return
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
        // The platform Button style upper-cases its text, which drew every
        // lowercase key as a capital and "return" as "RETURN" — the tree's
        // labels are exactly what it wants shown.
        b.isAllCaps = false
        b.text = label
        b.background = keyBackground(node)
        b.setTextColor(parseHex(theme.keyText))
        val fs = numFromStyle(node.style["fontSize"])
        if (fs != null) b.setTextSize(TypedValue.COMPLEX_UNIT_SP, fs)
        applyFontWeight(b, node.style["fontWeight"] as? String)
        return b
    }

    /**
     * A font weight by name or number — "regular", "medium", "semibold",
     * "bold", "400"…"900" — as iOS reads them. Only bold used to be honoured,
     * so "regular" kept the Button style's medium face and "medium" was lost.
     */
    private fun applyFontWeight(v: TextView, fw: String?) {
        val tf = when (fw?.lowercase()) {
            null, "" -> return
            "bold", "700", "800", "900", "heavy", "black" ->
                android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD)
            "semibold", "600" ->
                if (Build.VERSION.SDK_INT >= 28) android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, 600, false)
                else android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL)
            "medium", "500" -> android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL)
            "regular", "normal", "400" ->
                android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.NORMAL)
            "light", "300" -> android.graphics.Typeface.create("sans-serif-light", android.graphics.Typeface.NORMAL)
            "thin", "ultralight", "100", "200" -> android.graphics.Typeface.create("sans-serif-thin", android.graphics.Typeface.NORMAL)
            else -> return
        }
        v.typeface = tf
    }

    /** GradientDrawable background derived from theme.keyEffect + radius. */
    private fun keyBackground(node: KBNode): GradientDrawable {
        val gd = GradientDrawable()
        gd.cornerRadius = theme.keyRadius * host.context().resources.displayMetrics.density
        val fill = (node.style["bg"] as? String) ?: theme.key
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
        // A hairline edge — the tone pill's ring. Merged into the view's own
        // GradientDrawable like the radius above.
        val borderW = numFromStyle(style["borderWidth"]) ?: 0f
        val borderC = style["borderColor"] as? String
        if (borderW > 0f && !borderC.isNullOrBlank()) {
            val gd = v.background as? GradientDrawable ?: GradientDrawable().also { g ->
                (style["bg"] as? String)?.let { c -> g.setColor(parseHex(c)) }
                v.background = g
            }
            gd.setStroke(dp(borderW).coerceAtLeast(1), parseHex(borderC))
        }
        numFromStyle(style["opacity"])?.let { v.alpha = it.coerceIn(0f, 1f) }
        (style["fg"] as? String)?.let { if (v is TextView) v.setTextColor(parseHex(it)) }
        parent.addView(v, lp)
    }

    private fun applyTextStyle(v: TextView, style: Map<String, Any?>) {
        (style["fontSize"] as? Number)?.let { v.setTextSize(TypedValue.COMPLEX_UNIT_SP, it.toFloat()) }
        applyFontWeight(v, style["fontWeight"] as? String)
        gravityFor(style["align"] as? String, horizontal = true)?.let { v.gravity = it }
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
            is KBActionSpec.DeleteBackward -> deleteBackwardOnce()
            is KBActionSpec.DeleteWord -> { deleteWord(); host.onTextDeleted() }
            is KBActionSpec.Shift -> pressShift()
            is KBActionSpec.CapsLock -> holdShift()
            is KBActionSpec.Return -> pressReturn()
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
    // on.onPress == { kind: "cycleTone" }. What it cycles, what it shows and
    // how a pick is saved all live in TulmiTone: the server's pinned voices
    // then its tones, in the server's order, saved locally for the next refine
    // and sent to PUT /v1/personality.

    private fun cycleTone() {
        val items = TulmiTone.items(kbConfig.flags)
        if (items.isEmpty()) return
        val cur = TulmiTone.current(host.context(), kbConfig.flags)
        val next = items[(items.indexOf(cur) + 1) % items.size]
        pickTone(next)
    }

    private fun pickTone(item: TulmiTone.Item) {
        TulmiTone.select(host.context(), kbConfig.flags, item)
        refreshTone()
        host.onStateChanged() // re-render → the tone pill shows the new label
    }

    /**
     * Hold the pill → every voice and tone at once, the active ones ticked in
     * kb.tone.sheet.accent. A plain menu anchored on the pill: it cannot be
     * clipped by the keyboard's frame and needs no overlay of our own.
     */
    private fun showToneSheet(anchor: View) {
        val ctx = host.context()
        val voices = TulmiTone.voices(kbConfig.flags)
        val tones = TulmiTone.tones(kbConfig.flags)
        if (voices.isEmpty() && tones.isEmpty()) return
        val activeVoice = TulmiTone.activeVoiceId(ctx, kbConfig.flags)
        val activeTone = TulmiTone.activeToneId(ctx, kbConfig.flags)
        val accent = flagColor("kb.tone.sheet.accent", "#E8A23C")
        val popup = android.widget.PopupMenu(ctx, anchor)
        val picks = ArrayList<TulmiTone.Item>()
        var order = 0
        fun header(text: String) {
            if (text.isEmpty()) return
            popup.menu.add(0, android.view.Menu.NONE, order++, text).isEnabled = false
        }
        fun entry(item: TulmiTone.Item, active: Boolean) {
            picks += item
            val title: CharSequence = if (active) {
                android.text.SpannableString("${item.label}  \u2713").apply {
                    setSpan(android.text.style.ForegroundColorSpan(accent), 0, length, 0)
                }
            } else item.label
            // Ids start at 1: Menu.NONE (0) is the headers'.
            popup.menu.add(0, picks.size, order++, title)
        }
        if (voices.isNotEmpty()) {
            header(label("tone_sheet_voices", "Voices"))
            voices.forEach { entry(it, it.id == activeVoice) }
            header(label("tone_sheet_tones", "Tones"))
        }
        tones.forEach { entry(it, it.id == activeTone) }
        popup.setOnMenuItemClickListener { mi ->
            picks.getOrNull(mi.itemId - 1)?.let { pickTone(it) }
            true
        }
        try { popup.show() } catch (t: Throwable) { Log.w("SDUI", "tone sheet failed: ${t.message}") }
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
        val uri = Uri.parse(flagString("kb.deeplink.base", "tulmi://screen/") + (screenId ?: ""))
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

    /** The toast on screen, so a rebuild can carry it over (see redraw). */
    private var toastView: TextView? = null

    /**
     * Transient message, drawn IN the keyboard like iOS's toast label and styled
     * by kb.toast.*: colour by tone (error / success / info), size, position,
     * and its fade-in / hold / fade-out timings. The system Toast it replaces
     * appeared over the host app, in the system's style, with none of that
     * under the server's control.
     */
    private fun toast(message: String, tone: String) {
        if (message.isEmpty()) return
        val ctx = host.context()
        toastView?.let { old -> old.animate().cancel(); (old.parent as? ViewGroup)?.removeView(old) }
        val heightPx = dp(flagFloat("kb.toast.height", 32f))
        val bg = when (tone) {
            "error" -> flagColor("kb.toast.color.error", "#FF3B30E6")
            "success" -> flagColor("kb.toast.color.success", "#34C759E6")
            else -> flagColor("kb.toast.color.info", "#000000D9")
        }
        val tv = TextView(ctx).apply {
            text = message
            isAllCaps = false
            maxLines = 1
            gravity = android.view.Gravity.CENTER
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, flagFloat("kb.toast.fontSize", 13f))
            applyFontWeight(this, "medium")
            setPadding(dp(14), 0, dp(14), 0)
            background = GradientDrawable().apply { setColor(bg); cornerRadius = heightPx / 2f }
            alpha = 0f
            isClickable = false
        }
        val lp = FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, heightPx).apply {
            gravity = android.view.Gravity.BOTTOM or android.view.Gravity.CENTER_HORIZONTAL
            // Negative offsetY = above the bottom edge, as on iOS.
            bottomMargin = dp(-flagFloat("kb.toast.offsetY", -18f))
        }
        tv.layoutParams = lp
        container.addView(tv, lp)
        toastView = tv
        // Animators throw on a negative duration or delay.
        val hold = flagFloat("kb.toast.durationMs", 2000f).toLong().coerceAtLeast(0L)
        val fadeOut = flagFloat("kb.toast.fadeOutMs", 250f).toLong().coerceAtLeast(0L)
        tv.animate().alpha(1f).setDuration(flagFloat("kb.toast.fadeInMs", 180f).toLong().coerceAtLeast(0L)).withEndAction {
            tv.animate().alpha(0f).setStartDelay(hold).setDuration(fadeOut).withEndAction {
                (tv.parent as? ViewGroup)?.removeView(tv)
                if (toastView === tv) toastView = null
            }.start()
        }.start()
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
        val timeoutMs = flagFloat("kb.network.timeoutMs", 15000f).toInt()
        Thread {
            var ok = false
            var respText: String? = null
            try {
                val conn = (java.net.URL(urlStr).openConnection() as java.net.HttpURLConnection).apply {
                    requestMethod = spec.method.uppercase()
                    connectTimeout = timeoutMs
                    readTimeout = timeoutMs
                    // Token (when there is one) + the build header, as every Net call.
                    Net.authorize(this)
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

    /**
     * Should THIS key buzz?
     *
     * Two independent ways to be on, because "every key" and "the keys I chose"
     * are different preferences and neither should erase the other. Both
     * default off: a keyboard that buzzes on every letter out of the box is a
     * setting people go hunting for how to turn OFF.
     *
     * A null id is something that is not a key in the picker — a suggestion
     * chip, a personality tile. Those follow the master switch only, since the
     * user was never offered a choice about them individually.
     */
    private fun hapticsOn(keyId: String?): Boolean {
        if (flagBoolean("kb.haptics.all", false)) return true
        val id = keyId?.lowercase() ?: return false
        // Lowercased on BOTH sides — the picker writes "q", the shifted key
        // reports "Q", and a case mismatch would silently drop the setting.
        // org.json hands the object over as a JSONObject; the Map cast alone
        // never matched, so no individually picked key ever buzzed.
        return when (val keys = kbConfig.flags["kb.haptics.keys"]) {
            is JSONObject -> keys.optBoolean(id, false)
            is Map<*, *> -> keys[id] == true
            else -> false
        }
    }

    /** The name a key is known by in kb.haptics.keys — what it types, or its
     *  role. Shared by both render paths so they cannot drift. */
    private fun hapticIdFor(node: KBNode, raw: String): String = when (node.type) {
        "ShiftKey" -> "shift"
        "BackspaceKey" -> "backspace"
        "SpaceKey" -> "space"
        "ReturnKey" -> "return"
        "GlobeKey" -> "globe"
        "MicKey" -> "mic"
        "RefineKey" -> "refine"
        else -> raw
    }

    /**
     * Key feedback. kb.haptics.enabled is the kill switch above the user's own
     * choices; kb.haptics.style picks the feel — "selection" (the keyboard
     * tick), "light" / "soft", "medium", "heavy" / "rigid" — mapped onto the
     * closest Android feedback constants.
     */
    private fun hapticTap(v: View, keyId: String? = null) {
        if (!flagBoolean("kb.haptics.enabled", true)) return
        if (!hapticsOn(keyId)) return
        val constant = when (flagString("kb.haptics.style", "selection").lowercase()) {
            "light", "soft" -> HapticFeedbackConstants.CLOCK_TICK
            "medium" -> HapticFeedbackConstants.VIRTUAL_KEY
            "heavy", "rigid" -> HapticFeedbackConstants.LONG_PRESS
            else -> HapticFeedbackConstants.KEYBOARD_TAP
        }
        v.performHapticFeedback(constant)
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
            // Flag keys are dotted themselves ("kb.quota.status"), so the whole
            // tail is the key — reading only its first segment found nothing.
            "flags" -> if (tail.isNotEmpty()) kbConfig.flags[tail.joinToString(".")] else null
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
            "secured" -> s.secured
            "trackpadActive" -> s.trackpadActive
            "appearance" -> s.appearance
            "status" -> s.status
            "micLevel" -> s.micLevel
            "suggestions" -> s.suggestions
            "hasSuggestions" -> s.suggestions.isNotEmpty()
            "returnLabel" -> returnKeyLabel()
            "returnAction" -> s.returnAction
            "tone" -> toneLabel
            // quota.status is the words-out message; any other quota.<x> reads
            // the server's kb.quota.<x> flag (exhausted, screenId, …).
            "quota" -> when (val k = parts.drop(1).joinToString(".")) {
                "" -> null
                "status" -> quotaStatus()
                else -> kbConfig.flags["kb.quota.$k"]
            }
            // Backend scratch dict: state.user.<key>. Dotted keys rejoin so
            // state.user.a.b resolves user["a.b"] (what setState wrote).
            "user" -> if (parts.size > 1) s.user[parts.drop(1).joinToString(".")] else null
            else -> null
        }
    }

    /** What to say when the free words are gone: the server's kb.quota.status
     *  when it sends one, else the words_out_status label. */
    private fun quotaStatus(): String =
        flagString("kb.quota.status", "").ifBlank {
            label("words_out_status", "Out of free words \u2014 open Tailzu to get more.")
        }

    // -----------------------------------------------------------------------
    // Small util
    // -----------------------------------------------------------------------

    private fun dp(v: Int): Int =
        (v * host.context().resources.displayMetrics.density).toInt()

    private fun dp(v: Float): Int =
        Math.round(v * host.context().resources.displayMetrics.density)

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
    /**
     * THE MARK ON THE MIC KEY, REDRAWN FROM THE BACKEND.
     *
     * The server sends the brand mark as shapes — three squares, the hatched
     * link, the line up to the dot — with the motion each may have, and this
     * draws them on a Canvas: the same picture the bundled drawable held, but
     * resized, recoloured or set moving by a deploy rather than a store build.
     * Geometry is all it accepts. A bitmap, animated or not, cannot stand here,
     * which keeps the rule that pushed media never replaces the mark.
     */
    private class TulmiMarkView(
        ctx: Context,
        spec: JSONObject,
        motion: JSONObject?,
        private val tint: Int?,
        programSpec: JSONObject? = null,
    ) : View(ctx) {
        /** THE PROGRAM. Present, it is what the key does, idle and recording
         *  alike: the legacy `motion` and dispersal are ignored. */
        val program: MotionProgram? = programSpec?.let { MotionProgram.compile(it) }
        class Shape(val id: String?, val kind: String, val o: JSONObject, val color: Int?)
        private val shapes: List<Shape>
        private val vb: FloatArray
        private val idle: List<JSONObject>
        private var phase = 0f              // 0..1 of one dash pattern
        private var breath = 0f             // 0..1, sine-shaped
        private var signal = 0f             // 0..1 of one signal period
        private val animators = ArrayList<ValueAnimator>()

        // THE DISPERSAL — only the wave stays while the microphone is open.
        //
        // The squares, the plain lines and the dot are the parts. At the
        // start of a recording the whole gathers inward a touch, then each
        // part leaves in turn, a beat after the last, along an arc — out past
        // the rim, shrinking and fading as it crosses it, turning as it goes.
        // Once they are away the kept shape, the dashed link between the
        // blocks, glides to the middle and grows: the wave, doing what it
        // does in the splash — the dashes stay put and the bright cluster
        // runs along them, over and over. Stop reverses it: the wave settles back
        // into the link, and the parts glide in on the same arcs in cascade
        // and land exactly where they began; then the idle signal resumes.
        // Every part follows one number, its progress from home to away, on
        // a critically damped spring, so a stop mid-flight simply turns it
        // around: nothing ever jumps. The numbers are the server's.
        class Disperse(
            val keep: String, val out: Float, val spin: Float, val arc: Float, val shrink: Float, val gather: Float, val stagger: Float,
            val settle: Float, val lift: Float, val wait: Float, val tidePeriod: Float, val tideLength: Float, val tideRise: Float,
            val tideRows: Int, val tideDepth: Float, val tideLean: Float, val tideSkew: Float, val tideMess: Float,
            val backSpeed: Float, val backBounce: Float, val backTurbulence: Float, val backTumble: Float, val backStagger: Float, val centre: Boolean,
        )
        private class Part(val index: Int, val cx: Float, val cy: Float, val ux: Float, val uy: Float, val sign: Float) {
            var k = 0                                   // its turn: nearest the wave leaves first, comes back last
            var p = 0f; var v = 0f; var t = 0f          // progress from home (0) to away (1), its speed, its target
        }
        private class Wave(val index: Int, val mx: Float, val my: Float) {
            var q = 0f; var v = 0f; var t = 0f          // progress from the link (0) to the wave (1)
        }
        val disperse: Disperse? = parseDisperse(motion)
        private val parts = ArrayList<Part>()
        private var wave: Wave? = null
        private val idleNoSignal: List<JSONObject>
        private var playing = false
        private var settling = false
        private var clock = 0f
        private var startAt = 0f
        private var stopAt = 0f
        private var settleAt = 0f
        private var lastNanos = 0L
        private var onSettled: (() -> Unit)? = null
        /** The live microphone level, 0..1. The renderer points this at its state. */
        var level: () -> Float = { 0f }
        val isPlaying: Boolean get() = playing || settling || progRec == 1f || progSettling

        // The program's runtime state.
        private var progT = 0f; private var progRec = 0f; private var progFlipped = 0f; private var progSettling = false
        private val progSprings = HashMap<String, FloatArray>()      // v, vel, prev
        private var progCtx: Pair<MotionCtx, List<MotionCtx>>? = null

        init {
            val parsed = parse(spec)
            shapes = parsed?.first ?: emptyList()
            vb = parsed?.second ?: floatArrayOf(0f, 0f, 1f, 1f)
            val arr = motion?.optJSONArray("idle")
            idle = (0 until (arr?.length() ?: 0)).mapNotNull { arr?.optJSONObject(it) }
            // The signal rests while the parts are away: its overlays would not follow the shapes.
            idleNoSignal = idle.filter { it.optString("kind") != "signal" }
            if (disperse != null) tie()
        }

        override fun onAttachedToWindow() { super.onAttachedToWindow(); start(); if (isPlaying) postInvalidateOnAnimation() }
        override fun onDetachedFromWindow() { animators.forEach { it.cancel() }; animators.clear(); removeCallbacks(nextFrame); super.onDetachedFromWindow() }
        private val nextFrame = Runnable { invalidate() }

        /** The idle motion the legacy `motion` describes, as animators; with a
         *  program there are none — the program draws every frame itself. */
        private fun start() {
            if (program != null) { if (animatorsEnabled(context)) { lastNanos = 0L; invalidate() }; return }
            if (animators.isNotEmpty() || !animatorsEnabled(context)) return
            for (m in idle) {
                val period = (m.optDouble("period", 2.6).coerceAtLeast(0.2) * 1000).toLong()
                val a = ValueAnimator.ofFloat(0f, 1f).apply {
                    duration = period; repeatCount = ValueAnimator.INFINITE; interpolator = LinearInterpolator()
                }
                val known = when (m.optString("kind")) {
                    "hatch" -> { a.addUpdateListener { phase = it.animatedValue as Float; invalidate() }; true }
                    "signal" -> { a.addUpdateListener { signal = it.animatedValue as Float; invalidate() }; true }
                    "breathe" -> {
                        a.addUpdateListener {
                            breath = ((1 - Math.cos((it.animatedValue as Float) * 2 * Math.PI)) / 2).toFloat(); invalidate()
                        }
                        true
                    }
                    else -> false          // a kind this build does not know
                }
                if (!known) continue
                animators += a
                a.start()
            }
        }

        private val circle = spec.optString("fit", "circle") != "box"

        private val unit: Float get() = minOf(vb[2], vb[3])
        private val cX: Float get() = vb[0] + vb[2] / 2
        private val cY: Float get() = vb[1] + vb[3] / 2
        private val rim: Float get() = Math.hypot(vb[2].toDouble(), vb[3].toDouble()).toFloat() / 2

        /** The parts and the wave, once, from the geometry; and the order the
         *  parts leave in — nearest the wave first, so the structure opens
         *  from the middle out; they come back in the opposite order. */
        private fun tie() {
            parts.clear(); wave = null
            val keep = disperse?.keep ?: "link"
            shapes.forEachIndexed { i, sh ->
                val o = sh.o
                val cx: Float; val cy: Float
                when (sh.kind) {
                    "rect" -> { cx = (o.optDouble("x") + o.optDouble("w") / 2).toFloat(); cy = (o.optDouble("y") + o.optDouble("h") / 2).toFloat() }
                    "circle" -> { cx = o.optDouble("cx").toFloat(); cy = o.optDouble("cy").toFloat() }
                    else -> { cx = ((o.optDouble("x1") + o.optDouble("x2")) / 2).toFloat(); cy = ((o.optDouble("y1") + o.optDouble("y2")) / 2).toFloat() }
                }
                if (sh.id == keep && (sh.kind == "bars" || (sh.kind == "line" && o.optJSONArray("dash") != null))) { wave = Wave(i, cx, cy); return@forEachIndexed }
                val dx = cx - cX; val dy = cy - cY; val len = maxOf(1e-6f, Math.hypot(dx.toDouble(), dy.toDouble()).toFloat())
                parts += Part(i, cx, cy, dx / len, dy / len, if (parts.size % 2 == 1) -1f else 1f)
            }
            val w = wave ?: return
            parts.sortedBy { Math.hypot((it.cx - w.mx).toDouble(), (it.cy - w.my).toDouble()) }.forEachIndexed { k, p -> p.k = k }
        }

        /** The microphone opened: the parts leave, the wave stays. A no-op
         *  without a dispersal from the server, so a still or particle mark is unaffected. */
        fun beginPlay() {
            if (program != null) {
                if (progRec == 1f) return
                progRec = 1f; progFlipped = progT; progSettling = false; onSettled = null
                removeCallbacks(nextFrame); invalidate()
                return
            }
            if (disperse == null || wave == null) return
            playing = true; settling = false; onSettled = null; settleAt = 0f; lastNanos = 0L; startAt = clock
            postInvalidateOnAnimation()
        }

        /** The microphone closed: everything comes home, then `onDone`. */
        fun settle(onDone: () -> Unit) {
            if (program != null) {
                if (progRec != 1f) { onDone(); return }
                progRec = 0f; progFlipped = progT; progSettling = true; onSettled = onDone
                if (!animatorsEnabled(context)) { progSettling = false; onSettled = null; onDone() }
                return
            }
            if (!playing) { onDone(); return }
            playing = false; settling = true; settleAt = 0f; onSettled = onDone; stopAt = clock
            postInvalidateOnAnimation()
        }

        private fun home() {
            settling = false; playing = false
            for (p in parts) { p.p = 0f; p.v = 0f; p.t = 0f }
            wave?.let { it.q = 0f; it.v = 0f; it.t = 0f }
            val d = onSettled; onSettled = null; d?.invoke()
            invalidate()
        }

        private fun smoothStep(a: Float, b: Float, x: Float): Float { val t = ((x - a) / (b - a)).coerceIn(0f, 1f); return t * t * (3f - 2f * t) }

        /** One frame of the dispersal: every progress toward its cue, on its spring. */
        private fun stepDisperse() {
            val sp = disperse ?: return
            val w = wave ?: return
            val now = System.nanoTime()
            val dt = if (lastNanos == 0L) 1f / 60f else ((now - lastNanos) / 1_000_000_000f).coerceIn(0f, 1f / 30f)
            lastNanos = now
            val u = unit
            clock += dt
            val out = sp.out * rim; val n = parts.size; val tau = clock - startAt; val sigma = clock - stopAt
            var far = 0f; var fast = 0f
            // Out on a critically damped spring; in on a fast underdamped one, so a
            // part arrives like something thrown, overshoots the core and snaps on.
            val w0 = if (playing) 6.5f else sp.backSpeed; val c0 = if (playing) 2f * w0 else 2f * sp.backBounce * w0
            for (p in parts) {
                // Its cue: out after its turn — a touch inward first, the gather —
                // and back after the opposite turn, once the wave has begun to settle.
                val lead = p.k * sp.stagger
                if (playing) p.t = if (tau < lead) 0f else if (tau < lead + 0.1f) -sp.gather else 1f
                else if (sigma >= (n - 1 - p.k) * sp.backStagger + 0.12f) p.t = 0f
                p.v += (p.t - p.p) * w0 * w0 * dt - c0 * p.v * dt; p.p += p.v * dt
                far = maxOf(far, Math.abs(p.p) * out); fast = maxOf(fast, Math.abs(p.v) * out)
            }
            w.t = if (playing) (if (tau >= sp.wait) 1f else 0f) else 0f
            val w1 = 7f; val c1 = 2f * w1
            w.v += (w.t - w.q) * w1 * w1 * dt - c1 * w.v * dt; w.q += w.v * dt
            far = maxOf(far, Math.abs(w.q) * u); fast = maxOf(fast, Math.abs(w.v) * u)
            if (settling) {
                settleAt += dt
                if ((far < u * 0.002f && fast < u * 0.02f) || settleAt > sp.settle) home()
            }
        }


        // THE PROGRAM'S RUNTIME — the mark performs what the server wrote.
        //
        // Each frame: the clock, then the global springs, then for every shape
        // its springs and its expressions — offset, turn, scale, opacity,
        // colour mix, and for bars each bar's rise and lean — then what the
        // program draws around the shapes, all as this frame's shapes for the
        // painter. Nothing about the recording state is known here beyond
        // `rec`, the seconds `since` it flipped, and the voice `level`.
        private class Frame(val shapes: List<Shape>, val mark: FloatArray?)

        private fun programContexts(pg: MotionProgram): Pair<MotionCtx, List<MotionCtx>> {
            val g = MotionCtx()
            for ((k, v) in pg.vars) g.v[k] = v
            g.v["pi"] = Math.PI.toFloat(); g.v["tau"] = 2f * Math.PI.toFloat(); g.v["e"] = Math.E.toFloat()
            g.v["cx"] = cX; g.v["cy"] = cY; g.v["U"] = unit; g.v["R"] = rim; g.v["vbw"] = vb[2]; g.v["vbh"] = vb[3]
            val list = shapes.map { sh ->
                val c = MotionCtx(g); val o = sh.o
                var hx = 0f; var hy = 0f
                when (sh.kind) {
                    "rect" -> { hx = (o.optDouble("x") + o.optDouble("w") / 2).toFloat(); hy = (o.optDouble("y") + o.optDouble("h") / 2).toFloat(); c.v["w"] = o.optDouble("w").toFloat(); c.v["h"] = o.optDouble("h").toFloat() }
                    "circle" -> { hx = o.optDouble("cx").toFloat(); hy = o.optDouble("cy").toFloat(); c.v["r"] = o.optDouble("r").toFloat() }
                    else -> {
                        val x1 = o.optDouble("x1").toFloat(); val y1 = o.optDouble("y1").toFloat(); val x2 = o.optDouble("x2").toFloat(); val y2 = o.optDouble("y2").toFloat()
                        hx = (x1 + x2) / 2; hy = (y1 + y2) / 2
                        val dx = x2 - x1; val dy = y2 - y1; val len = maxOf(1e-6f, Math.hypot(dx.toDouble(), dy.toDouble()).toFloat())
                        c.v["x1"] = x1; c.v["y1"] = y1; c.v["x2"] = x2; c.v["y2"] = y2; c.v["L"] = len
                        c.v["lx"] = dx / len; c.v["ly"] = dy / len; c.v["nx"] = -dy / len; c.v["ny"] = dx / len
                        val bx = dy / len * 0.85f - dx / len * 0.35f; val by = -dx / len * 0.85f - dy / len * 0.35f; val bl = maxOf(1e-6f, Math.hypot(bx.toDouble(), by.toDouble()).toFloat())
                        c.v["bx"] = bx / bl; c.v["by"] = by / bl
                        c.v["width"] = o.optDouble("width", 1.0).toFloat()
                        if (sh.kind == "bars") {
                            val hs = o.optJSONArray("heights"); val n = hs?.length() ?: 0
                            c.v["thick"] = o.optDouble("thick", 6.0).toFloat(); c.v["cols"] = n.toFloat()
                            val sw = o.optJSONObject("swell"); c.v["swh"] = (sw?.optDouble("height", 1.9) ?: 1.9).toFloat(); c.v["swt"] = (sw?.optDouble("thick", 1.3) ?: 1.3).toFloat()
                            c.fn["height"] = { a -> if (n == 0) 0f else hs!!.optDouble(Math.round(if (a.isNotEmpty()) a[0] else 0f).coerceIn(0, n - 1), 0.0).toFloat() }
                        }
                    }
                }
                c.v["home.x"] = hx; c.v["home.y"] = hy
                val ddx = hx - cX; val ddy = hy - cY; val dl = maxOf(1e-6f, Math.hypot(ddx.toDouble(), ddy.toDouble()).toFloat())
                c.v["dir.x"] = ddx / dl; c.v["dir.y"] = ddy / dl
                sh.id?.let { id -> pg.shapes[id]?.vars?.forEach { (k, v) -> c.v[k] = v } }
                c
            }
            return Pair(g, list)
        }

        private fun runProgram(pg: MotionProgram, dt: Float): Frame {
            val ctx = progCtx ?: programContexts(pg).also { progCtx = it }
            val g = ctx.first
            progT += dt
            g.v["t"] = progT; g.v["rec"] = progRec; g.v["since"] = progT - progFlipped; g.v["level"] = level().coerceIn(0f, 1f)
            var quiet = true
            fun step(name: String, sp: MotionProgram.Spring, key: String, c: MotionCtx) {
                val st = progSprings.getOrPut(key) { floatArrayOf(sp.rest, 0f, sp.rest) }
                c.v["prev"] = st[2]
                val target = MotionLang.eval(sp.target, c, pg.funcs)
                val w = MotionLang.eval(sp.rate, c, pg.funcs).coerceIn(0.1f, 1000f); val z = MotionLang.eval(sp.damp, c, pg.funcs).coerceIn(0f, 100f)
                st[2] = target
                // One step is stable only while w·dt and 2·z·w·dt stay small; a
                // stiff spring on a long frame diverges to NaN. Sub-step instead —
                // the shipped springs still take one step per frame.
                val n = Math.ceil((maxOf(w, 2f * z * w) * dt / 0.5f).toDouble()).toInt().coerceIn(1, 64)
                val h = dt / n
                repeat(n) { st[1] += (target - st[0]) * w * w * h - 2f * z * w * st[1] * h; st[0] += st[1] * h }
                if (st[0].isNaN() || st[0].isInfinite() || st[1].isNaN() || st[1].isInfinite() || Math.abs(st[0]) > 1e6f) {
                    st[0] = target; st[1] = 0f
                }
                c.v[name] = st[0]
                if (Math.abs(st[0] - target) > pg.eps || Math.abs(st[1]) > pg.eps * 10f) quiet = false
            }
            for ((name, sp) in pg.springs) if (!sp.shapeScoped) step(name, sp, name, g)
            val mark = floatArrayOf(pg.mark["scale"]?.let { MotionLang.eval(it, g, pg.funcs) } ?: 1f, pg.mark["rot"]?.let { MotionLang.eval(it, g, pg.funcs) } ?: 0f,
                pg.mark["opacity"]?.let { MotionLang.eval(it, g, pg.funcs).coerceIn(0f, 1f) } ?: 1f)
            val out = ArrayList<Shape>(shapes.size + 64)
            shapes.forEachIndexed { i, sh ->
                val c = ctx.second[i]
                for ((name, sp) in pg.springs) if (sp.shapeScoped) step(name, sp, "$name@$i", c)
                val prog = sh.id?.let { pg.shapes[it] }
                val o = JSONObject(sh.o, sh.o.keys().asSequence().toList().toTypedArray())
                if (prog == null) { out += Shape(sh.id, sh.kind, o, sh.color); return@forEachIndexed }
                val pr = prog.props
                val dx = pr["dx"]?.let { MotionLang.eval(it, c, pg.funcs) } ?: 0f; val dy = pr["dy"]?.let { MotionLang.eval(it, c, pg.funcs) } ?: 0f
                val rot = pr["rot"]?.let { MotionLang.eval(it, c, pg.funcs) } ?: 0f; val sc = pr["scale"]?.let { MotionLang.eval(it, c, pg.funcs) } ?: 1f
                val op = (pr["opacity"]?.let { MotionLang.eval(it, c, pg.funcs) } ?: 1f).coerceIn(0f, 1f)
                when (sh.kind) {
                    "rect" -> { o.put("x", sh.o.optDouble("x") + dx); o.put("y", sh.o.optDouble("y") + dy) }
                    "circle" -> { o.put("cx", sh.o.optDouble("cx") + dx); o.put("cy", sh.o.optDouble("cy") + dy) }
                    else -> { o.put("x1", sh.o.optDouble("x1") + dx); o.put("y1", sh.o.optDouble("y1") + dy); o.put("x2", sh.o.optDouble("x2") + dx); o.put("y2", sh.o.optDouble("y2") + dy) }
                }
                o.put("_turn", rot.toDouble()); o.put("_scale", sc.toDouble()); o.put("_alpha", op.toDouble())
                pr["mix"]?.let { mx -> o.put("_color", mix(tint ?: sh.color ?: Color.BLACK, pg.signal, MotionLang.eval(mx, c, pg.funcs))) }
                if (sh.kind == "bars" && (pr.containsKey("rise") || pr.containsKey("lean"))) {
                    val hs = sh.o.optJSONArray("heights"); val n = hs?.length() ?: 0
                    val rises = org.json.JSONArray(); val leans = org.json.JSONArray()
                    for (j in 0 until n) {
                        val bc = MotionCtx(c); bc.v["i"] = j.toFloat(); bc.v["f"] = (j + 0.5f) / n; bc.v["hgt"] = hs!!.optDouble(j, 0.0).toFloat()
                        val rise = (pr["rise"]?.let { MotionLang.eval(it, bc, pg.funcs) } ?: 0f).coerceIn(0f, 1f); bc.v["rise"] = rise
                        val lean = pr["lean"]?.let { MotionLang.eval(it, bc, pg.funcs) } ?: 0f
                        rises.put(rise.toDouble()); leans.put(lean.toDouble())
                    }
                    o.put("_rise", rises); o.put("_lean", leans)
                }
                // What the program draws around this shape, behind it: moved and turned with it.
                val hx = c.v["home.x"] ?: 0f; val hy = c.v["home.y"] ?: 0f
                for (e in pg.emit) {
                    if (e.attach != sh.id) continue
                    val counts = e.repeats.map { MotionLang.eval(it, c, pg.funcs).toInt().coerceIn(0, 64) }
                    val n0 = if (counts.isNotEmpty()) counts[0] else 1; val n1 = if (counts.size > 1) counts[1] else 1
                    val color = if (e.signal) pg.signal else (tint ?: sh.color ?: Color.BLACK)
                    for (a in 0 until n0) for (b in 0 until n1) {
                        val ec = MotionCtx(c)
                        if (e.names.isNotEmpty()) ec.v[e.names[0]] = a.toFloat()
                        if (e.names.size > 1) ec.v[e.names[1]] = b.toFloat()
                        val alpha = MotionLang.eval(e.opacity, ec, pg.funcs).coerceIn(0f, 1f) * op
                        // Invisible costs nothing else: at rest the shipped
                        // program's 42 emitted lines are all at zero, and
                        // building them anyway was most of each idle frame. (A
                        // generated shape may read its counter in its opacity.)
                        if (e.genCount == null && alpha <= 0.002f) continue
                        val eo = JSONObject()
                        eo.put("_color", color); eo.put("_alpha", alpha.toDouble()); eo.put("_turn", rot.toDouble()); eo.put("_scale", sc.toDouble())
                        eo.put("_about_x", (hx + dx).toDouble()); eo.put("_about_y", (hy + dy).toDouble())
                        fun ev(ast: MotionAst?): Float = ast?.let { MotionLang.eval(it, ec, pg.funcs) } ?: 0f
                        when (e.kind) {
                            "line" -> {
                                eo.put("x1", (ev(e.fields["x1"]) + dx).toDouble()); eo.put("y1", (ev(e.fields["y1"]) + dy).toDouble())
                                eo.put("x2", (ev(e.fields["x2"]) + dx).toDouble()); eo.put("y2", (ev(e.fields["y2"]) + dy).toDouble())
                                eo.put("width", ev(e.width).toDouble())
                                out += Shape(null, "line", eo, null)
                            }
                            "circle" -> {
                                eo.put("cx", (ev(e.fields["cx"]) + dx).toDouble()); eo.put("cy", (ev(e.fields["cy"]) + dy).toDouble())
                                eo.put("r", maxOf(0f, e.fields["r"]?.let { MotionLang.eval(it, ec, pg.funcs) } ?: 1f).toDouble())
                                out += Shape(null, "circle", eo, null)
                            }
                            else -> {
                                val pts = org.json.JSONArray()
                                if (e.points != null) for ((xa, ya) in e.points) { pts.put((ev(xa) + dx).toDouble()); pts.put((ev(ya) + dy).toDouble()) }
                                else if (e.genCount != null) { val cnt = ev(e.genCount).toInt().coerceIn(0, 64); for (j in 0 until cnt) { ec.v[e.genName] = j.toFloat(); pts.put((ev(e.genX) + dx).toDouble()); pts.put((ev(e.genY) + dy).toDouble()) } }
                                eo.put("pts", pts); eo.put("width", ev(e.width).toDouble())
                                out += Shape(null, if (e.kind == "polygon") "_poly" else "_pline", eo, null)
                            }
                        }
                    }
                }
                out += Shape(sh.id, sh.kind, o, sh.color)
            }
            // Home: the recording is over and every spring is at rest, or its time is up.
            if (progSettling && (quiet || progT - progFlipped > pg.timeout)) {
                for (st in progSprings.values) st[1] = 0f
                progSettling = false
                val d = onSettled; onSettled = null; d?.invoke()
            }
            return Frame(out, mark)
        }

        /** The shapes as the dispersal has them: each part along its arc,
         *  turned, shrunk and faded by its progress; the link glided and grown
         *  by the wave's, with the bright cluster's lit dashes over it — one
         *  plain line per lit dash, in the signal colour, as the splash runs
         *  it. Copies for one frame; the spec itself stays as sent. */
        private fun moved(tint: Int?, sigColor: Int): List<Shape> {
            val sp = disperse ?: return shapes
            val w = wave ?: return shapes
            val out = ArrayList<Shape>(shapes.size + 12)
            val byIndex = HashMap<Int, Part>(); for (p in parts) byIndex[p.index] = p
            val reach = sp.out * rim; val arc = sp.arc * rim; val spin = sp.spin * Math.PI.toFloat() / 180f; val turb = sp.backTurbulence * rim
            shapes.forEachIndexed { i, sh ->
                val o = JSONObject(sh.o, sh.o.keys().asSequence().toList().toTypedArray())
                val p = byIndex[i]
                if (p != null) {
                    val idx = parts.indexOf(p)
                    val e = p.p; val c = e.coerceIn(0f, 1f); val sc = 1f - sp.shrink * c; val op = 1f - smoothStep(0.55f, 1f, c)
                    // Turning as it goes; thrown in, it tumbles a whole turn more.
                    val rot = (spin + (if (playing) 0f else sp.backTumble * 2f * Math.PI.toFloat())) * e * p.sign
                    // Out along an arc: the straight line from the middle, bent sideways
                    // most at the midpoint, so it swings rather than shoots. Thrown in, it
                    // is buffeted as well — a turbulence that dies as it closes in.
                    val tb = if (playing) 0f else turb * Math.abs(e) * (0.6f * sn(clock * 11f + idx * 2.1f) + 0.4f * sn(clock * 17f + idx * 0.7f))
                    val tr = if (playing) 0f else turb * 0.5f * Math.abs(e) * sn(clock * 13f + idx * 1.3f)
                    val bend = arc * sn(Math.PI.toFloat() * c) * p.sign + tb
                    val dx = p.ux * (reach * e + tr) - p.uy * bend; val dy = p.uy * (reach * e + tr) + p.ux * bend
                    when (sh.kind) {
                        "rect" -> { o.put("x", sh.o.optDouble("x") + dx); o.put("y", sh.o.optDouble("y") + dy) }
                        "circle" -> { o.put("cx", sh.o.optDouble("cx") + dx); o.put("cy", sh.o.optDouble("cy") + dy) }
                        else -> { o.put("x1", sh.o.optDouble("x1") + dx); o.put("y1", sh.o.optDouble("y1") + dy); o.put("x2", sh.o.optDouble("x2") + dx); o.put("y2", sh.o.optDouble("y2") + dy) }
                    }
                    o.put("_turn", (rot * 180f / Math.PI.toFloat()).toDouble()); o.put("_scale", sc.toDouble()); o.put("_alpha", op.toDouble())
                    out += Shape(sh.id, sh.kind, o, sh.color)
                } else if (i == w.index && sh.kind == "bars") {
                    // THE SEA. The bars are its front; rows of surface rise behind them,
                    // each higher, smaller and fainter, joined by contour lines, the water
                    // between them facets of ink, deeper where the crest stands. Two crests
                    // travel it, running diagonally; under a crest the surface rises and
                    // its top leans forward, the curl of a breaking wave, and collapses
                    // behind. Rows grow out of the bars as the wave opens and sink back as
                    // it closes. Facets and contours are shapes of this frame only, never
                    // from the server. All in the mark's own ink.
                    val q = w.q.coerceIn(0f, 1f); val k = 1f + (sp.lift - 1f) * w.q
                    val x1 = sh.o.optDouble("x1").toFloat(); val y1 = sh.o.optDouble("y1").toFloat(); val x2 = sh.o.optDouble("x2").toFloat(); val y2 = sh.o.optDouble("y2").toFloat()
                    val mx = w.mx + (if (sp.centre) cX - w.mx else 0f) * w.q; val my = w.my + (if (sp.centre) cY - w.my else 0f) * w.q
                    val ax = mx + (x1 - w.mx) * k; val ay = my + (y1 - w.my) * k; val bx = mx + (x2 - w.mx) * k; val by = my + (y2 - w.my) * k
                    val hs = sh.o.optJSONArray("heights")!!; val n = hs.length()
                    val swell = sh.o.optJSONObject("swell"); val swT = swell?.optDouble("thick", 1.3)?.toFloat() ?: 1.3f; val swH = swell?.optDouble("height", 1.9)?.toFloat() ?: 1.9f
                    val thick = sh.o.optDouble("thick", 6.0).toFloat() * k
                    val ddx = bx - ax; val ddy = by - ay; val len = maxOf(1e-6f, Math.hypot(ddx.toDouble(), ddy.toDouble()).toFloat())
                    val dx = ddx / len; val dy = ddy / len; val nx = -dy; val ny = dx
                    var ux = -nx * 0.85f - dx * 0.35f; var uy = -ny * 0.85f - dy * 0.35f
                    val ul = maxOf(1e-6f, Math.hypot(ux.toDouble(), uy.toDouble()).toFloat()); ux /= ul; uy /= ul
                    // Messy by `mess`: a third crest runs against the other two, a chop of
                    // short ripples crosses all of them, and a slow noise lifts and drops
                    // patches of the surface, so no two tides are alike.
                    fun tide(f: Float, r: Int): Float {
                        val tau2 = 2f * Math.PI.toFloat()
                        val a = maxOf(0f, sn(tau2 * (f / sp.tideLength - clock / sp.tidePeriod + r * sp.tideSkew)))
                        val b = maxOf(0f, sn(tau2 * (f / (sp.tideLength * 0.55f) - clock / (sp.tidePeriod * 0.7f) + 0.3f + r * sp.tideSkew)))
                        val cc = maxOf(0f, sn(tau2 * (f / (sp.tideLength * 0.8f) + clock / (sp.tidePeriod * 1.3f) - r * sp.tideSkew * 1.5f)))
                        val chop = sn(tau2 * (f * 6.5f - clock * 2.3f + r * 0.37f)) * sn(tau2 * (f * 3.1f + clock * 1.7f))
                        val noise = sn(clock * 3.7f + r * 2.1f + f * 11f) * sn(clock * 2.3f - f * 7f + r)
                        val v = Math.pow(a.toDouble(), 1.6).toFloat() + 0.45f * Math.pow(b.toDouble(), 1.6).toFloat() +
                            sp.tideMess * (0.35f * Math.pow(cc.toDouble(), 1.4).toFloat() + 0.18f * chop + 0.15f * noise)
                        return (v * sp.tideRise).coerceIn(0f, 1f)
                    }
                    val rows = sp.tideRows
                    val tops = Array(rows) { FloatArray(n * 2) }; val ks = Array(rows) { FloatArray(n) }
                    val barShapes = ArrayList<Shape>(n)
                    for (r in 0 until rows) {
                        val scale = 1f - 0.12f * r; val off = sp.tideDepth * k * r * q * (1f + sp.tideMess * 0.12f * sn(clock * 1.3f + r * 1.9f))
                        for (j in 0 until n) {
                            val f = (j + 0.5f) / n; val kk = tide(f, r)
                            val h = hs.optDouble(j, 0.0).toFloat() * k * (1f + (swH - 1f) * kk * q) * scale
                            val cx = ax + ddx * f + ux * off; val cy = ay + ddy * f + uy * off
                            tops[r][j * 2] = cx + nx * h / 2 + dx * sp.tideLean * h * kk * q; tops[r][j * 2 + 1] = cy + ny * h / 2 + dy * sp.tideLean * h * kk * q
                            ks[r][j] = kk
                            if (r == 0) {
                                // The bar itself, k of the way up, its top leaning with the crest.
                                val hh = hs.optDouble(j, 0.0).toFloat() * k * (1f + (swH - 1f) * kk * q)
                                val bar = JSONObject()
                                bar.put("x1", (ax + ddx * f - nx * hh / 2).toDouble()); bar.put("y1", (ay + ddy * f - ny * hh / 2).toDouble())
                                bar.put("x2", (ax + ddx * f + nx * hh / 2 + dx * sp.tideLean * hh * kk * q).toDouble()); bar.put("y2", (ay + ddy * f + ny * hh / 2 + dy * sp.tideLean * hh * kk * q).toDouble())
                                bar.put("width", (thick * (1f + (swT - 1f) * kk * q)).toDouble())
                                barShapes += Shape(null, "line", bar, sh.color)
                            }
                        }
                    }
                    // Behind the bars: the water, then the contours; the bars last, in front.
                    for (r in 0 until rows - 1) for (j in 0 until n - 1) {
                        val pts = org.json.JSONArray()
                        pts.put(tops[r][j * 2].toDouble()); pts.put(tops[r][j * 2 + 1].toDouble()); pts.put(tops[r][j * 2 + 2].toDouble()); pts.put(tops[r][j * 2 + 3].toDouble())
                        pts.put(tops[r + 1][j * 2 + 2].toDouble()); pts.put(tops[r + 1][j * 2 + 3].toDouble()); pts.put(tops[r + 1][j * 2].toDouble()); pts.put(tops[r + 1][j * 2 + 1].toDouble())
                        val kavg = (ks[r][j] + ks[r][j + 1] + ks[r + 1][j] + ks[r + 1][j + 1]) / 4
                        val facet = JSONObject(); facet.put("pts", pts); facet.put("_alpha", (q * (0.09f + 0.3f * kavg) * (1f - 0.12f * r)).toDouble())
                        out += Shape(null, "_poly", facet, sh.color)
                    }
                    for (r in 0 until rows) {
                        val pts = org.json.JSONArray(); for (v in tops[r]) pts.put(v.toDouble())
                        val contour = JSONObject(); contour.put("pts", pts); contour.put("width", (thick * 0.35f).toDouble())
                        contour.put("_alpha", (q * (if (r == 0) 0.85f else 0.6f - 0.1f * r)).toDouble())
                        out += Shape(null, "_pline", contour, sh.color)
                    }
                    out.addAll(barShapes)
                } else if (i == w.index) {
                    // The wave as a dashed line: its ends glided and grown about its middle, and the cluster's lit dashes over it.
                    val q = w.q.coerceIn(0f, 1f); val k = 1f + (sp.lift - 1f) * w.q
                    val x1 = sh.o.optDouble("x1").toFloat(); val y1 = sh.o.optDouble("y1").toFloat(); val x2 = sh.o.optDouble("x2").toFloat(); val y2 = sh.o.optDouble("y2").toFloat()
                    val mx = w.mx + (if (sp.centre) cX - w.mx else 0f) * w.q; val my = w.my + (if (sp.centre) cY - w.my else 0f) * w.q
                    val ax = mx + (x1 - w.mx) * k; val ay = my + (y1 - w.my) * k; val bx = mx + (x2 - w.mx) * k; val by = my + (y2 - w.my) * k
                    val width = sh.o.optDouble("width", 1.0).toFloat() * k
                    o.put("x1", ax.toDouble()); o.put("y1", ay.toDouble()); o.put("x2", bx.toDouble()); o.put("y2", by.toDouble()); o.put("width", width.toDouble())
                    val dash = sh.o.optJSONArray("dash")
                    if (dash != null && dash.length() >= 1) {
                        // The dash pattern is drawn in the copy at the grown scale, so a bar sits exactly on its dash.
                        val scaled = org.json.JSONArray(); for (j in 0 until dash.length()) scaled.put(dash.optDouble(j, 0.0) * k)
                        o.put("dash", scaled)
                        out += Shape(sh.id, sh.kind, o, sh.color)
                        // The cluster: `width` of the line, fully lit at its core and soft at
                        // its edges, from end to end in `run` seconds, a rest of `gap`, again.
                        val len = Math.hypot((bx - ax).toDouble(), (by - ay).toDouble()).toFloat()
                        val on = dash.optDouble(0, 0.0).toFloat() * k; val off = (if (dash.length() > 1) dash.optDouble(1, 0.0) else dash.optDouble(0, 0.0)).toFloat() * k
                        var pos = 0f
                        while (pos < len && on > 0f) {
                            val f0 = pos / len; val f1 = minOf(len, pos + on) / len; val f = (f0 + f1) / 2
                            val ta = maxOf(0f, sn(2f * Math.PI.toFloat() * (f / sp.tideLength - clock / sp.tidePeriod)))
                            val lit = q * minOf(1f, Math.pow(ta.toDouble(), 1.6).toFloat() * sp.tideRise)
                            if (lit > 0.002f) {
                                val bar = JSONObject()
                                bar.put("x1", (ax + (bx - ax) * f0).toDouble()); bar.put("y1", (ay + (by - ay) * f0).toDouble())
                                bar.put("x2", (ax + (bx - ax) * f1).toDouble()); bar.put("y2", (ay + (by - ay) * f1).toDouble())
                                bar.put("width", width.toDouble())
                                bar.put("_color", sigColor); bar.put("_alpha", lit.toDouble())
                                out += Shape(null, "line", bar, null)
                            }
                            pos += on + off
                        }
                    } else out += Shape(sh.id, sh.kind, o, sh.color)
                } else out += Shape(sh.id, sh.kind, o, sh.color)
            }
            return out
        }

        override fun onDraw(c: Canvas) {
            if (program != null) {
                val pg = program
                val now = System.nanoTime()
                val dt = if (lastNanos == 0L) 1f / 60f else ((now - lastNanos) / 1_000_000_000f).coerceIn(0f, 1f / 20f)
                lastNanos = now
                // A program the renderer cannot run (a value it cannot draw)
                // is a still mark, never a keyboard that crashes on every open.
                val frame = try { runProgram(pg, dt) } catch (t: Exception) {
                    progSprings.clear()
                    Frame(shapes, null)
                }
                paintShapes(c, frame.shapes, vb, width.toFloat(), height.toFloat(), tint, emptyList(), 0f, 0f, circle, 0f, frame.mark)
                if (animatorsEnabled(context)) postDelayed(nextFrame, (1000 / (if (progRec == 1f) pg.fpsRec else pg.fpsIdle)).toLong())
                return
            }
            if (isPlaying) {
                stepDisperse()
                val sig = idle.firstOrNull { it.optString("kind") == "signal" }?.let { parseHex(it.optString("color", if (tint != null) "#F4F1EA" else "#E8A23C")) }
                    ?: parseHex(if (tint != null) "#F4F1EA" else "#E8A23C")
                val shown = try { moved(tint, sig) } catch (t: Exception) { shapes }
                paintShapes(c, shown, vb, width.toFloat(), height.toFloat(), tint, idleNoSignal, phase, breath, circle, 0f)
                if (isPlaying) postInvalidateOnAnimation()
            } else {
                paintShapes(c, shapes, vb, width.toFloat(), height.toFloat(), tint, idle, phase, breath, circle, signal)
            }
        }

        companion object {
            private fun sn(x: Float) = Math.sin(x.toDouble()).toFloat()
            private fun cs(x: Float) = Math.cos(x.toDouble()).toFloat()

            /** What the key does while the microphone is open: "disperse",
             *  "particles" or "none". A backend before the dispersal sent a
             *  name; now it sends the numbers under `kind`. Absent, the
             *  particles — what older builds do. */
            fun recordingKind(motion: JSONObject?): String {
                val r = motion?.opt("recording") ?: return "particles"
                return (r as? JSONObject)?.optString("kind", "particles") ?: r.toString()
            }

            fun parseDisperse(motion: JSONObject?): Disperse? {
                val r = motion?.optJSONObject("recording") ?: return null
                if (r.optString("kind") != "disperse") return null
                val w = r.optJSONObject("wave")
                return Disperse(
                    r.optString("keep", "link").ifEmpty { "link" },
                    r.optDouble("out", 1.9).toFloat().coerceAtLeast(1f), r.optDouble("spin", 40.0).toFloat(),
                    r.optDouble("arc", 0.22).toFloat().coerceAtLeast(0f), r.optDouble("shrink", 0.45).toFloat().coerceIn(0f, 0.95f),
                    r.optDouble("gather", 0.05).toFloat().coerceAtLeast(0f), r.optDouble("stagger", 0.07).toFloat().coerceAtLeast(0f),
                    r.optDouble("settle", 1.2).toFloat().coerceAtLeast(0.1f),
                    (w?.optDouble("lift", 2.0) ?: 2.0).toFloat().coerceAtLeast(0.5f), (w?.optDouble("wait", 0.25) ?: 0.25).toFloat().coerceAtLeast(0f),
                    (w?.optJSONObject("tide")?.optDouble("period", 1.2) ?: 1.2).toFloat().coerceAtLeast(0.2f),
                    (w?.optJSONObject("tide")?.optDouble("length", 0.6) ?: 0.6).toFloat().coerceAtLeast(0.1f),
                    (w?.optJSONObject("tide")?.optDouble("rise", 1.0) ?: 1.0).toFloat().coerceIn(0f, 1f),
                    (w?.optJSONObject("tide")?.optInt("rows", 5) ?: 5).coerceIn(1, 8),
                    (w?.optJSONObject("tide")?.optDouble("depth", 14.0) ?: 14.0).toFloat().coerceAtLeast(0f),
                    (w?.optJSONObject("tide")?.optDouble("lean", 0.55) ?: 0.55).toFloat().coerceAtLeast(0f),
                    (w?.optJSONObject("tide")?.optDouble("skew", 0.09) ?: 0.09).toFloat(),
                    (w?.optJSONObject("tide")?.optDouble("mess", 0.7) ?: 0.7).toFloat().coerceIn(0f, 1f),
                    (r.optJSONObject("back")?.optDouble("speed", 12.0) ?: 12.0).toFloat().coerceAtLeast(2f),
                    (r.optJSONObject("back")?.optDouble("bounce", 0.6) ?: 0.6).toFloat().coerceIn(0.1f, 1f),
                    (r.optJSONObject("back")?.optDouble("turbulence", 0.14) ?: 0.14).toFloat().coerceAtLeast(0f),
                    (r.optJSONObject("back")?.optDouble("tumble", 1.0) ?: 1.0).toFloat().coerceAtLeast(0f),
                    (r.optJSONObject("back")?.optDouble("stagger", 0.05) ?: 0.05).toFloat().coerceAtLeast(0f),
                    w?.optBoolean("centre", true) ?: true,
                )
            }

            /** Shapes of a kind this build draws; anything else is skipped, not shown. */
            fun parse(spec: JSONObject): Pair<List<Shape>, FloatArray>? {
                val vbA = spec.optJSONArray("viewBox") ?: return null
                if (vbA.length() != 4) return null
                val vb = FloatArray(4) { vbA.optDouble(it, 0.0).toFloat() }
                if (vb[2] <= 0f || vb[3] <= 0f) return null
                val raw = spec.optJSONArray("shapes") ?: return null
                val out = ArrayList<Shape>()
                for (i in 0 until raw.length()) {
                    val o = raw.optJSONObject(i) ?: continue
                    val kind = o.optString("kind")
                    if (kind !in listOf("rect", "line", "circle", "bars")) continue
                    if (kind == "bars" && (o.optJSONArray("heights")?.length() ?: 0) == 0) continue
                    val color = o.optString("color", "").takeIf { it.isNotEmpty() }?.let { parseHex(it) }
                    out += Shape(o.optString("id", "").takeIf { it.isNotEmpty() }, kind, o, color)
                }
                return if (out.isEmpty()) null else Pair(out, vb)
            }

            /** The physics' turn and stretch on one shape, about its centre:
             *  stretched along its velocity, squashed across it, then turned. */
            private fun motionOf(c: Canvas, o: JSONObject, cx: Float, cy: Float) {
                if (!o.has("_stretch") && !o.has("_turn") && !o.has("_scale")) return
                val st = o.optDouble("_stretch", 1.0).toFloat(); val along = o.optDouble("_along", 0.0).toFloat(); val turn = o.optDouble("_turn", 0.0).toFloat()
                val sc = o.optDouble("_scale", 1.0).toFloat()
                if (sc != 1f) c.scale(sc, sc, cx, cy)
                if (st != 1f) { c.rotate(along, cx, cy); c.scale(st, 1f / st, cx, cy); c.rotate(-along, cx, cy) }
                if (turn != 0f) c.rotate(turn, cx, cy)
            }

            /** `a` moved `k` of the way to `b`, channel by channel. */
            fun mix(a: Int, b: Int, k: Float): Int {
                val j = k.coerceIn(0f, 1f)
                fun ch(x: Int, y: Int) = (x + (y - x) * j).toInt().coerceIn(0, 255)
                return Color.argb(ch(Color.alpha(a), Color.alpha(b)), ch(Color.red(a), Color.red(b)),
                                  ch(Color.green(a), Color.green(b)), ch(Color.blue(a), Color.blue(b)))
            }

            fun animatorsEnabled(ctx: Context): Boolean =
                if (Build.VERSION.SDK_INT >= 26) ValueAnimator.areAnimatorsEnabled()
                else Settings.Global.getFloat(ctx.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) != 0f

            /** The artboard centred in w × h, then every shape. A round key fits
             *  the artboard by its DIAGONAL, so its corners touch the circle and
             *  no square is cut off at the rim; `fit: "box"` fits the sides. */
            fun paintShapes(
                c: Canvas, shapes: List<Shape>, vb: FloatArray, w: Float, h: Float,
                tint: Int?, idle: List<JSONObject>, phase: Float, breath: Float, circle: Boolean = true, signal: Float = 0f,
                mark: FloatArray? = null,
            ) {
                val s = if (circle) minOf(w, h) / Math.hypot(vb[2].toDouble(), vb[3].toDouble()).toFloat()
                        else minOf(w / vb[2], h / vb[3])
                val ox = (w - vb[2] * s) / 2 - vb[0] * s
                val oy = (h - vb[3] * s) / 2 - vb[1] * s
                val paint = Paint(Paint.ANTI_ALIAS_FLAG)
                // Motion on the whole mark: a breath about the centre, and the
                // splash's signal — a timeline of steps, each naming a shape and
                // the second it lights. A square wears the signal colour for
                // `hold`; a dashed line has a run of light travel it for `run`.
                val markBreath = idle.firstOrNull { it.optString("on") == "mark" && it.optString("kind") == "breathe" }
                val sig = idle.firstOrNull { it.optString("on") == "mark" && it.optString("kind") == "signal" && it.optJSONArray("steps") != null }
                val steps = sig?.optJSONArray("steps")?.let { arr -> (0 until arr.length()).mapNotNull { arr.optJSONObject(it) } } ?: emptyList()
                val sigColor = sig?.let { parseHex(it.optString("color", if (tint != null) "#F4F1EA" else "#E8A23C")) } ?: 0
                val t = signal * (sig?.optDouble("period", 3.6)?.toFloat()?.coerceAtLeast(0.2f) ?: 1f)   // seconds into the period
                var markAlpha = 1f
                c.save()
                if (mark != null) {
                    // The program's transform of the whole: scale and turn about the centre, and its opacity.
                    c.scale(mark[0], mark[0], w / 2, h / 2); c.rotate(mark[1], w / 2, h / 2)
                    if (mark.size > 2) markAlpha *= mark[2]
                }
                if (markBreath != null) {
                    val msc = 1f + (markBreath.optDouble("scale", 1.06).toFloat() - 1f) * breath
                    c.scale(msc, msc, w / 2, h / 2)
                    markAlpha = 1f - (1f - markBreath.optDouble("opacity", 1.0).toFloat()) * breath
                }
                for (sh in shapes) {
                    val o = sh.o
                    paint.reset(); paint.isAntiAlias = true
                    paint.color = if (o.has("_color")) o.optInt("_color") else tint ?: sh.color ?: Color.BLACK   // a bar of the wave wears its own
                    paint.pathEffect = null
                    var alpha = markAlpha * o.optDouble("_alpha", 1.0).toFloat()
                    // A shape that breathes swells about its own centre and fades a little.
                    val br = sh.id?.let { id -> idle.firstOrNull { it.optString("on") == id && it.optString("kind") == "breathe" } }
                    val sc = if (br != null) 1f + (br.optDouble("scale", 1.45).toFloat() - 1f) * breath else 1f
                    if (br != null) alpha *= 1f - (1f - br.optDouble("opacity", 0.72).toFloat()) * breath
                    // Its step in the signal. A run along a dashed line is drawn
                    // over the line below; anything else swaps colour for `hold`,
                    // on in sixty milliseconds and off in sixty.
                    val step = sh.id?.let { id -> steps.firstOrNull { it.optString("on") == id } }
                    val runs = step != null && step.has("run") && ((sh.kind == "line" && o.optJSONArray("dash") != null) || sh.kind == "bars")
                    if (step != null && !runs) {
                        val at = step.optDouble("at", 0.0).toFloat(); val hold = step.optDouble("hold", 0.4).toFloat().coerceAtLeast(0.05f)
                        val k = when {
                            t < at -> 0f
                            t < at + 0.06f -> (t - at) / 0.06f
                            t < at + hold -> 1f
                            t < at + hold + 0.06f -> 1f - (t - at - hold) / 0.06f
                            else -> 0f
                        }
                        if (k > 0f) paint.color = mix(paint.color, sigColor, k)
                    }
                    paint.alpha = (255 * alpha.coerceIn(0f, 1f)).toInt()
                    c.save()
                    when (sh.kind) {
                        "rect" -> {
                            val r = RectF(
                                ox + o.optDouble("x").toFloat() * s, oy + o.optDouble("y").toFloat() * s,
                                ox + (o.optDouble("x") + o.optDouble("w")).toFloat() * s, oy + (o.optDouble("y") + o.optDouble("h")).toFloat() * s,
                            )
                            c.scale(sc, sc, r.centerX(), r.centerY())
                            motionOf(c, o, r.centerX(), r.centerY())
                            paint.style = Paint.Style.FILL
                            val rx = o.optDouble("rx").toFloat() * s
                            c.drawRoundRect(r, rx, rx, paint)
                        }
                        "circle" -> {
                            val cx = ox + o.optDouble("cx").toFloat() * s
                            val cy = oy + o.optDouble("cy").toFloat() * s
                            motionOf(c, o, cx, cy)
                            paint.style = Paint.Style.FILL
                            c.drawCircle(cx, cy, o.optDouble("r").toFloat() * s * sc, paint)
                        }
                        "_poly", "_pline" -> {
                            // The sea's facets and contours: made by the wave for one frame,
                            // never sent by the server (parse() refuses these kinds).
                            val pts = o.optJSONArray("pts")
                            if (pts != null && pts.length() >= 4) {
                                if (o.has("_about_x")) motionOf(c, o, ox + o.optDouble("_about_x").toFloat() * s, oy + o.optDouble("_about_y").toFloat() * s)
                                val path = android.graphics.Path()
                                var j = 0
                                while (j + 1 < pts.length()) {
                                    val px = ox + pts.optDouble(j, 0.0).toFloat() * s; val py = oy + pts.optDouble(j + 1, 0.0).toFloat() * s
                                    if (j == 0) path.moveTo(px, py) else path.lineTo(px, py)
                                    j += 2
                                }
                                if (sh.kind == "_poly") { path.close(); paint.style = Paint.Style.FILL }
                                else { paint.style = Paint.Style.STROKE; paint.strokeWidth = o.optDouble("width", 1.0).toFloat() * s; paint.strokeJoin = Paint.Join.ROUND }
                                c.drawPath(path, paint)
                            }
                        }
                        "bars" -> {
                            // THE WAVE OF THE ICON: thin bars of uneven height across the
                            // line, as the splash draws it, in the mark's own ink. Under
                            // the signal's crest a bar rises — `swell.height` times taller,
                            // `swell.thick` times thicker — and collapses behind it. A copy
                            // made by the wave carries each bar's own rise in `_rise`.
                            val x1 = ox + o.optDouble("x1").toFloat() * s; val y1 = oy + o.optDouble("y1").toFloat() * s
                            val x2 = ox + o.optDouble("x2").toFloat() * s; val y2 = oy + o.optDouble("y2").toFloat() * s
                            val hs = o.optJSONArray("heights")!!; val n = hs.length()
                            val dx = x2 - x1; val dy = y2 - y1; val len = maxOf(1e-6f, Math.hypot(dx.toDouble(), dy.toDouble()).toFloat())
                            val nx = -dy / len; val ny = dx / len
                            val thick = o.optDouble("thick", 6.0).toFloat() * s
                            val swell = o.optJSONObject("swell"); val swT = swell?.optDouble("thick", 1.3)?.toFloat() ?: 1.3f; val swH = swell?.optDouble("height", 1.9)?.toFloat() ?: 1.9f
                            motionOf(c, o, (x1 + x2) / 2, (y1 + y2) / 2)
                            paint.style = Paint.Style.STROKE; paint.strokeCap = Paint.Cap.BUTT
                            val at = step?.optDouble("at", 0.0)?.toFloat() ?: 0f
                            val run = step?.optDouble("run", 1.0)?.toFloat()?.coerceAtLeast(0.05f) ?: 1f
                            val width = step?.optDouble("width", 0.3)?.toFloat()?.coerceIn(0.05f, 0.9f) ?: 0.3f; val half = width / 2
                            val u = if (runs) (t - at) / run else -1f
                            val centre = u * (1 + width) - half
                            val rises = o.optJSONArray("_rise"); val leans = o.optJSONArray("_lean")
                            for (i in 0 until n) {
                                val f = (i + 0.5f) / n
                                // How far up this bar is: under the crest of the run, or as the program says; and its top's lean.
                                var k = if (rises != null) rises.optDouble(i, 0.0).toFloat() else 0f
                                if (runs && u in 0f..1f) { val q = Math.abs(f - centre) / half; if (q < 1f) k = maxOf(k, 0.5f + 0.5f * cs(Math.PI.toFloat() * q)) }
                                val lean = leans?.optDouble(i, 0.0)?.toFloat() ?: 0f
                                val h = hs.optDouble(i, 0.0).toFloat() * s * (1f + (swH - 1f) * k)
                                val cx = x1 + dx * f; val cy = y1 + dy * f
                                paint.strokeWidth = thick * (1f + (swT - 1f) * k)
                                c.drawLine(cx - nx * h / 2, cy - ny * h / 2, cx + nx * h / 2 + dx / len * lean * h, cy + ny * h / 2 + dy / len * lean * h, paint)
                            }
                        }
                        else -> {
                            val x1 = ox + o.optDouble("x1").toFloat() * s; val y1 = oy + o.optDouble("y1").toFloat() * s
                            val x2 = ox + o.optDouble("x2").toFloat() * s; val y2 = oy + o.optDouble("y2").toFloat() * s
                            c.scale(sc, sc, (x1 + x2) / 2, (y1 + y2) / 2)
                            motionOf(c, o, (x1 + x2) / 2, (y1 + y2) / 2)     // a part flying: turned, shrunk
                            paint.style = Paint.Style.STROKE
                            paint.strokeWidth = o.optDouble("width", 1.0).toFloat() * s
                            paint.strokeCap = if (o.optString("cap") == "round") Paint.Cap.ROUND else Paint.Cap.BUTT
                            val dash = o.optJSONArray("dash")
                            var basePhase = 0f
                            var iv: FloatArray? = null
                            if (dash != null && dash.length() >= 2) {
                                iv = FloatArray(dash.length()) { dash.optDouble(it, 0.0).toFloat() * s }
                                // The dashes travel along the line when its motion says `hatch`.
                                val hatched = sh.id?.let { id -> idle.any { it.optString("on") == id && it.optString("kind") == "hatch" } } ?: false
                                basePhase = if (hatched) -phase * iv.sum() else 0f
                                paint.pathEffect = DashPathEffect(iv, basePhase)
                            }
                            c.drawLine(x1, y1, x2, y2, paint)
                            if (runs && iv != null) {
                                // THE RUN BETWEEN THE BLOCKS, as the splash has it: the dashes
                                // stay where they are, and a bright cluster of them — `width` of
                                // the line, fully lit at its core and soft at its edges — travels
                                // from end to end in `run` seconds. Each dash lit on its own cue.
                                val at = step!!.optDouble("at", 0.0).toFloat()
                                val run = step.optDouble("run", 1.0).toFloat().coerceAtLeast(0.05f)
                                val width = step.optDouble("width", 0.3).toFloat().coerceIn(0.05f, 0.9f); val half = width / 2
                                val u = (t - at) / run
                                if (u in 0f..1f) {
                                    val centre = u * (1 + width) - half
                                    val len = Math.hypot((x2 - x1).toDouble(), (y2 - y1).toDouble()).toFloat()
                                    val on = iv[0]; val off = if (iv.size > 1) iv[1] else iv[0]
                                    paint.pathEffect = null; paint.color = sigColor
                                    var pos = 0f
                                    while (pos < len && on > 0f) {
                                        val f0 = pos / len; val f1 = minOf(len, pos + on) / len
                                        val q = Math.abs((f0 + f1) / 2 - centre) / half
                                        if (q < 1f) {
                                            val lit = if (q < 0.5f) 1f else 0.5f + 0.5f * cs(Math.PI.toFloat() * (q - 0.5f) / 0.5f)
                                            paint.alpha = (255 * alpha.coerceIn(0f, 1f) * lit).toInt()
                                            c.drawLine(x1 + (x2 - x1) * f0, y1 + (y2 - y1) * f0, x1 + (x2 - x1) * f1, y1 + (y2 - y1) * f1, paint)
                                        }
                                        pos += on + off
                                    }
                                }
                            }
                        }
                    }
                    c.restore()
                }
                c.restore()
            }

            /** The mark as a picture, for the particle sim to burst from. The sim
             *  samples opaque pixels, so the colour is beside the point. */
            fun bitmap(spec: JSONObject, tint: Int, px: Int): Bitmap? {
                val parsed = parse(spec) ?: return null
                val size = px.coerceAtLeast(8)
                val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
                paintShapes(Canvas(bmp), parsed.first, parsed.second, size.toFloat(), size.toFloat(), tint, emptyList(), 0f, 0f,
                    spec.optString("fit", "circle") != "box")
                return bmp
            }
        }
    }

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

        // The physics, from the server (read once per view — onDraw runs every
        // frame). Defaults are the numbers this sim shipped with.
        private val burstSpeedMin = knobFloat("kb.mic.particles.speedMin", 55f)
        private val burstSpeedRange = knobFloat("kb.mic.particles.speedRange", 55f)
        private val wanderDrag = knobFloat("kb.mic.particles.drag", 0.985f)
        private val wanderMinSpeed = knobFloat("kb.mic.particles.minSpeed", 13f)
        private val homeStiffness = knobFloat("kb.mic.particles.stiffness", 26f)
        private val homeDamping = knobFloat("kb.mic.particles.damping", 0.8f)
        private val homeMaxSec = knobFloat("kb.mic.particles.reassembleMaxMs", 600f) / 1000f
        private val homeSnapPx = knobFloat("kb.mic.particles.snapPx", 0.8f)
        private val markAlphaMin = knobInt("kb.mic.particles.alphaThreshold", 90)

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
            val speed = burstSpeedMin + rnd.nextFloat() * burstSpeedRange   // 55..110 px/s shipped
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
                    if (a > markAlphaMin) all.add(PointF(ox + (x + 0.5f) * scale, oy + (y + 0.5f) * scale))
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
            val drag = wanderDrag; val minSpeed = wanderMinSpeed
            for (d in dots) {
                d.vx *= drag; d.vy *= drag
                val s = kotlin.math.sqrt(d.vx * d.vx + d.vy * d.vy)
                if (s > 0.001f && s < minSpeed) { val k = minSpeed / s; d.vx *= k; d.vy *= k }
            }
        }

        /** Stopping: damped spring to home points, then snap + hand off. */
        private fun stepReassemble(dt: Float) {
            reassembleElapsed += dt
            val stiffness = homeStiffness; val damping = homeDamping
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
            if (!reassembleFinished && (maxDist < homeSnapPx || reassembleElapsed > homeMaxSec)) {
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
        color: Int,
        private val radiusPx: Float,
        private val spacingPx: Float,
        private val levelMultiplier: Float,
        private val baselineMin: Float,
        baselineMax: Float,
        fps: Float,
        private val levelProvider: () -> Float,
        private val activeProvider: () -> Boolean,
    ) : View(ctx) {
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color }
        private val rnd = java.util.Random()
        /** Each bar's resting height, 0..1 of the view — the iOS waveform's
         *  shape: a quiet uneven row that the voice lifts. */
        private val baselines = FloatArray(barCount.coerceAtLeast(1)) {
            baselineMin + rnd.nextFloat() * (maxOf(baselineMin, baselineMax) - baselineMin)
        }
        /** Repaint cadence while live; 60 or more follows the display. */
        private val frameMs: Long = if (fps >= 60f || fps <= 0f) 0L else (1000f / fps).toLong()

        override fun onDraw(canvas: Canvas) {
            val w = width.toFloat()
            val h = height.toFloat()
            // Under 2px there is no bar to draw, and coerceIn(2f, h) would throw.
            if (w <= 0f || h < 2f) return
            val level = levelProvider().coerceIn(0f, 1f)
            val n = baselines.size
            val barW = maxOf(1.5f, (w - spacingPx * (n - 1)) / n)
            for (i in 0 until n) {
                val jitter = (rnd.nextFloat() - 0.5f) * 0.1f
                val bh = (h * (baselines[i] + level * levelMultiplier + jitter)).coerceIn(2f, h)
                val x = i * (barW + spacingPx)
                val y = (h - bh) / 2f
                canvas.drawRoundRect(x, y, x + barW, y + bh, radiusPx, radiusPx, paint)
            }
            if (activeProvider()) {
                if (frameMs == 0L) postInvalidateOnAnimation() else postInvalidateDelayed(frameMs)
            }
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
        // A3: key pop-ups, accent trays, the space-bar trackpad, double-space
        // full stop, and the mic hidden when focus moves into a password box.
        const val BUILD_STAMP = "A3"

        /** Tag on suggestion chips, so nothing mistakes a one-letter chip for a key. */
        const val CHIP_TAG = "tulmi.chip"

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
            val theme = parseTheme(o.optJSONObject("theme") ?: JSONObject())
            // The appearance-specific themes. Parsed in full, each on its own —
            // a theme the server did not send stays null and `theme` stands in.
            val themeDark = o.optJSONObject("themeDark")?.let { parseTheme(it) }
            val themeLight = o.optJSONObject("themeLight")?.let { parseTheme(it) }
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
                themeDark = themeDark,
                themeLight = themeLight,
            )
        }

        private fun parseTheme(t: JSONObject): KBTheme = KBTheme(
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

// =============================================================================
// THE MOTION LANGUAGE
//
// The mic key's program is written in a small language of numbers: arithmetic,
// comparisons, && || !, ?:, built-in functions, the program's own functions,
// and names looked up in a context. The same evaluator runs on iOS and in the
// backend's tests. Anything unknown or non-finite is 0: a bad program is a
// still mark, never a crash.
// =============================================================================
sealed class MotionAst {
    class Num(val v: Float) : MotionAst()
    class Name(val k: String) : MotionAst()
    class Call(val name: String, val args: List<MotionAst>) : MotionAst()
    class Neg(val x: MotionAst) : MotionAst()
    class Not(val x: MotionAst) : MotionAst()
    class Tern(val c: MotionAst, val a: MotionAst, val b: MotionAst) : MotionAst()
    class Bin(val op: String, val l: MotionAst, val r: MotionAst) : MotionAst()
}

/** A context: names to numbers, a few lent functions, and a parent to fall back on. */
class MotionCtx(private val parent: MotionCtx? = null) {
    val v = HashMap<String, Float>()
    val fn = HashMap<String, (FloatArray) -> Float>()
    fun get(k: String): Float? = v[k] ?: parent?.get(k)
    fun lent(k: String): ((FloatArray) -> Float)? = fn[k] ?: parent?.lent(k)
}

class MotionFunc(val args: List<String>, val ast: MotionAst)

object MotionLang {
    private sealed class Tok { class Num(val v: Float) : Tok(); class Id(val v: String) : Tok(); class Op(val v: String) : Tok() }

    private fun tokenize(src: String): List<Tok> {
        val out = ArrayList<Tok>(); var i = 0; val n = src.length
        val two = setOf("||", "&&", "==", "!=", "<=", ">="); val one = "-+*/%^<>!?:(),"
        while (i < n) {
            val c = src[i]
            if (c.isWhitespace()) { i++; continue }
            if (c.isDigit() || (c == '.' && i + 1 < n && src[i + 1].isDigit())) {
                var j = i
                while (j < n && (src[j].isDigit() || src[j] == '.')) j++
                if (j < n && (src[j] == 'e' || src[j] == 'E')) {
                    var k = j + 1
                    if (k < n && (src[k] == '+' || src[k] == '-')) k++
                    if (k < n && src[k].isDigit()) { j = k; while (j < n && src[j].isDigit()) j++ }
                }
                out += Tok.Num(src.substring(i, j).toFloatOrNull() ?: 0f); i = j; continue
            }
            if (c.isLetter() || c == '_') {
                var j = i
                while (j < n && (src[j].isLetterOrDigit() || src[j] == '_' || src[j] == '.')) j++
                out += Tok.Id(src.substring(i, j)); i = j; continue
            }
            if (i + 1 < n && src.substring(i, i + 2) in two) { out += Tok.Op(src.substring(i, i + 2)); i += 2; continue }
            if (c in one) { out += Tok.Op(c.toString()); i++; continue }
            throw IllegalArgumentException("bad character $c")
        }
        return out
    }

    private class Parser(val toks: List<Tok>) {
        var pos = 0
        fun isOp(v: String) = pos < toks.size && (toks[pos] as? Tok.Op)?.v == v
        fun take(v: String) { if (!isOp(v)) throw IllegalArgumentException("expected $v"); pos++ }
        fun opValue(): String { val v = (toks[pos] as Tok.Op).v; pos++; return v }
        fun ternary(): MotionAst { val c = or(); if (isOp("?")) { pos++; val a = ternary(); take(":"); val b = ternary(); return MotionAst.Tern(c, a, b) }; return c }
        fun or(): MotionAst { var l = and(); while (isOp("||")) { pos++; l = MotionAst.Bin("||", l, and()) }; return l }
        fun and(): MotionAst { var l = eq(); while (isOp("&&")) { pos++; l = MotionAst.Bin("&&", l, eq()) }; return l }
        fun eq(): MotionAst { var l = rel(); while (isOp("==") || isOp("!=")) { val o = opValue(); l = MotionAst.Bin(o, l, rel()) }; return l }
        fun rel(): MotionAst { var l = add(); while (isOp("<") || isOp("<=") || isOp(">") || isOp(">=")) { val o = opValue(); l = MotionAst.Bin(o, l, add()) }; return l }
        fun add(): MotionAst { var l = mul(); while (isOp("+") || isOp("-")) { val o = opValue(); l = MotionAst.Bin(o, l, mul()) }; return l }
        fun mul(): MotionAst { var l = unary(); while (isOp("*") || isOp("/") || isOp("%")) { val o = opValue(); l = MotionAst.Bin(o, l, unary()) }; return l }
        fun unary(): MotionAst { if (isOp("-")) { pos++; return MotionAst.Neg(unary()) }; if (isOp("!")) { pos++; return MotionAst.Not(unary()) }; return power() }
        fun power(): MotionAst { val b = primary(); if (isOp("^")) { pos++; return MotionAst.Bin("^", b, unary()) }; return b }
        fun primary(): MotionAst {
            if (pos >= toks.size) throw IllegalArgumentException("unexpected end")
            when (val t = toks[pos]) {
                is Tok.Num -> { pos++; return MotionAst.Num(t.v) }
                is Tok.Id -> {
                    pos++
                    if (isOp("(")) {
                        pos++; val args = ArrayList<MotionAst>()
                        if (!isOp(")")) { args += ternary(); while (isOp(",")) { pos++; args += ternary() } }
                        take(")"); return MotionAst.Call(t.v, args)
                    }
                    return MotionAst.Name(t.v)
                }
                is Tok.Op -> {
                    if (t.v == "(") { pos++; val e = ternary(); take(")"); return e }
                    throw IllegalArgumentException("unexpected ${t.v}")
                }
            }
        }
    }

    fun parse(src: String): MotionAst {
        val p = Parser(tokenize(src)); val ast = p.ternary()
        if (p.pos != p.toks.size) throw IllegalArgumentException("trailing input")
        return ast
    }

    private fun fin(x: Float) = if (x.isFinite()) x else 0f
    private fun a(v: FloatArray, i: Int) = if (i < v.size) v[i] else 0f
    private fun d(x: Float) = x.toDouble()
    val builtins: Map<String, (FloatArray) -> Float> = mapOf(
        "sin" to { v -> Math.sin(d(a(v, 0))).toFloat() }, "cos" to { v -> Math.cos(d(a(v, 0))).toFloat() }, "tan" to { v -> Math.tan(d(a(v, 0))).toFloat() },
        "abs" to { v -> Math.abs(a(v, 0)) }, "sqrt" to { v -> if (a(v, 0) < 0f) 0f else Math.sqrt(d(a(v, 0))).toFloat() },
        "floor" to { v -> Math.floor(d(a(v, 0))).toFloat() }, "ceil" to { v -> Math.ceil(d(a(v, 0))).toFloat() }, "round" to { v -> Math.round(a(v, 0)).toFloat() },
        "exp" to { v -> Math.exp(d(a(v, 0))).toFloat() }, "log" to { v -> if (a(v, 0) > 0f) Math.log(d(a(v, 0))).toFloat() else 0f },
        "atan2" to { v -> Math.atan2(d(a(v, 0)), d(a(v, 1))).toFloat() },
        "min" to { v -> v.minOrNull() ?: 0f }, "max" to { v -> v.maxOrNull() ?: 0f },
        "pow" to { v -> if (a(v, 0) < 0f && a(v, 1) != Math.floor(d(a(v, 1))).toFloat()) 0f else Math.pow(d(a(v, 0)), d(a(v, 1))).toFloat() },
        "hypot" to { v -> Math.hypot(d(a(v, 0)), d(a(v, 1))).toFloat() },
        "clamp" to { v -> a(v, 0).coerceIn(minOf(a(v, 1), a(v, 2)), maxOf(a(v, 1), a(v, 2))) },
        "smooth" to { v -> val lo = a(v, 0); val hi = a(v, 1); val x = a(v, 2); val u = if (hi == lo) (if (x >= hi) 1f else 0f) else ((x - lo) / (hi - lo)).coerceIn(0f, 1f); u * u * (3f - 2f * u) },
        "lerp" to { v -> a(v, 0) + (a(v, 1) - a(v, 0)) * a(v, 2) },
        "crest" to { v -> val s = Math.sin(d(a(v, 0))).toFloat(); if (s > 0f) Math.pow(d(s), 1.6).toFloat() else 0f },
        "ramp" to { v -> val x = a(v, 0); val at = a(v, 1); val len = a(v, 2); val e = if (v.size > 3 && a(v, 3) > 0f) a(v, 3) else 0.06f
            if (x < at) 0f else if (x < at + e) (x - at) / e else if (x < at + len) 1f else if (x < at + len + e) 1f - (x - at - len) / e else 0f },
        "run" to { v -> val f = a(v, 0); val x = a(v, 1); val at = a(v, 2); val dur = a(v, 3); val width = a(v, 4); val u = if (dur == 0f) -1f else (x - at) / dur
            if (u < 0f || u > 1f) 0f else { val half = width / 2; if (half <= 0f) 0f else { val c = u * (1 + width) - half; val q = Math.abs(f - c) / half; if (q >= 1f) 0f else 0.5f + 0.5f * Math.cos(Math.PI * q).toFloat() } } },
        "noise" to { v -> (Math.sin(d(a(v, 0)) * 1.7) * Math.sin(d(a(v, 0)) * 0.61 + 2.1)).toFloat() },
    )

    fun eval(n: MotionAst, ctx: MotionCtx, funcs: Map<String, MotionFunc>, depth: Int = 0): Float {
        return when (n) {
            is MotionAst.Num -> fin(n.v)
            is MotionAst.Name -> fin(ctx.get(n.k) ?: 0f)
            is MotionAst.Neg -> -eval(n.x, ctx, funcs, depth)
            is MotionAst.Not -> if (eval(n.x, ctx, funcs, depth) != 0f) 0f else 1f
            is MotionAst.Tern -> if (eval(n.c, ctx, funcs, depth) != 0f) eval(n.a, ctx, funcs, depth) else eval(n.b, ctx, funcs, depth)
            is MotionAst.Call -> {
                val f = funcs[n.name]
                if (f != null) {
                    if (depth > 8) return 0f
                    val c2 = MotionCtx(ctx)
                    f.args.forEachIndexed { i, an -> c2.v[an] = if (i < n.args.size) eval(n.args[i], ctx, funcs, depth) else 0f }
                    return fin(eval(f.ast, c2, funcs, depth + 1))
                }
                val vals = FloatArray(n.args.size) { eval(n.args[it], ctx, funcs, depth) }
                val b = builtins[n.name]; if (b != null) return fin(b(vals))
                val l = ctx.lent(n.name); if (l != null) return fin(l(vals))
                0f
            }
            is MotionAst.Bin -> {
                if (n.op == "||") return if (eval(n.l, ctx, funcs, depth) != 0f || eval(n.r, ctx, funcs, depth) != 0f) 1f else 0f
                if (n.op == "&&") return if (eval(n.l, ctx, funcs, depth) != 0f && eval(n.r, ctx, funcs, depth) != 0f) 1f else 0f
                val x = eval(n.l, ctx, funcs, depth); val y = eval(n.r, ctx, funcs, depth)
                when (n.op) {
                    // Finite in, finite out: an overflow is Infinity, Infinity
                    // minus itself is NaN, and JSONObject.put throws on both.
                    "+" -> fin(x + y); "-" -> fin(x - y); "*" -> fin(x * y)
                    "/" -> if (y == 0f) 0f else fin(x / y)
                    "%" -> if (y == 0f) 0f else fin(x - Math.floor(d(x / y)).toFloat() * y)
                    "^" -> fin(Math.pow(d(x), d(y)).toFloat())
                    "<" -> if (x < y) 1f else 0f; "<=" -> if (x <= y) 1f else 0f; ">" -> if (x > y) 1f else 0f; ">=" -> if (x >= y) 1f else 0f
                    "==" -> if (x == y) 1f else 0f; "!=" -> if (x != y) 1f else 0f
                    else -> 0f
                }
            }
        }
    }
}

/** A program, compiled: every expression parsed once. What fails to parse is 0. */
class MotionProgram private constructor(
    val vars: Map<String, Float>, val funcs: Map<String, MotionFunc>, val springs: Map<String, Spring>,
    val mark: Map<String, MotionAst>, val shapes: Map<String, ShapeProg>, val emit: List<Emit>,
    val fpsIdle: Int, val fpsRec: Int, val signal: Int, val eps: Float, val timeout: Float,
) {
    class Spring(val shapeScoped: Boolean, val rest: Float, val target: MotionAst, val rate: MotionAst, val damp: MotionAst)
    class ShapeProg(val vars: Map<String, Float>, val props: Map<String, MotionAst>)
    class Emit(
        val attach: String, val kind: String, val repeats: List<MotionAst>, val names: List<String>, val signal: Boolean,
        val opacity: MotionAst, val width: MotionAst, val points: List<Pair<MotionAst, MotionAst>>?,
        val genCount: MotionAst?, val genName: String, val genX: MotionAst?, val genY: MotionAst?, val fields: Map<String, MotionAst>,
    )
    companion object {
        private fun x(v: Any?, fallback: String): MotionAst = try { MotionLang.parse(v?.toString() ?: fallback) } catch (_: Throwable) { MotionAst.Num(0f) }
        fun compile(spec: JSONObject): MotionProgram? {
            if (spec.optDouble("version", 0.0) < 1) return null
            val vars = HashMap<String, Float>()
            spec.optJSONObject("vars")?.let { o -> for (k in o.keys()) { val n = o.opt(k); if (n is Number) vars[k] = n.toFloat() } }
            val funcs = HashMap<String, MotionFunc>()
            spec.optJSONObject("funcs")?.let { o -> for (k in o.keys()) { val f = o.optJSONObject(k) ?: continue
                val args = f.optJSONArray("args"); funcs[k] = MotionFunc((0 until (args?.length() ?: 0)).map { args!!.optString(it) }, x(f.opt("expr"), "0")) } }
            val springs = HashMap<String, Spring>()
            spec.optJSONObject("springs")?.let { o -> for (k in o.keys()) { val so = o.optJSONObject(k) ?: continue
                springs[k] = Spring(so.optString("scope") == "shape", so.optDouble("rest", 0.0).toFloat(), x(so.opt("target"), "0"), x(so.opt("rate"), "8"), x(so.opt("damp"), "1")) } }
            val mark = HashMap<String, MotionAst>()
            spec.optJSONObject("mark")?.let { o -> for (k in o.keys()) mark[k] = x(o.opt(k), "0") }
            val shapes = HashMap<String, ShapeProg>()
            spec.optJSONObject("shapes")?.let { o -> for (id in o.keys()) { val so = o.optJSONObject(id) ?: continue
                val sv = HashMap<String, Float>(); val props = HashMap<String, MotionAst>()
                for (k in so.keys()) { if (k == "vars") { val vo = so.optJSONObject(k); if (vo != null) for (vk in vo.keys()) { val n = vo.opt(vk); if (n is Number) sv[vk] = n.toFloat() } } else props[k] = x(so.opt(k), "0") }
                shapes[id] = ShapeProg(sv, props) } }
            val emit = ArrayList<Emit>()
            spec.optJSONArray("emit")?.let { arr -> for (i in 0 until arr.length()) { val e = arr.optJSONObject(i) ?: continue
                val attach = e.optString("attach", ""); if (attach.isEmpty()) continue
                var points: List<Pair<MotionAst, MotionAst>>? = null; var genCount: MotionAst? = null; var genName = "i"; var genX: MotionAst? = null; var genY: MotionAst? = null
                val pa = e.optJSONArray("points"); val po = e.optJSONObject("points")
                if (pa != null) points = (0 until pa.length()).mapNotNull { j -> pa.optJSONArray(j)?.let { p -> if (p.length() >= 2) Pair(x(p.opt(0), "0"), x(p.opt(1), "0")) else null } }
                else if (po != null) { genCount = x(po.opt("count"), "0"); genName = po.optString("as", "i"); genX = x(po.opt("x"), "0"); genY = x(po.opt("y"), "0") }
                val fields = HashMap<String, MotionAst>()
                for (k in listOf("x1", "y1", "x2", "y2", "cx", "cy", "r")) if (e.has(k)) fields[k] = x(e.opt(k), "0")
                val rep = e.optJSONArray("repeat"); val names = e.optJSONArray("as")
                emit += Emit(attach, e.optString("kind", "polyline"), (0 until (rep?.length() ?: 0)).map { x(rep!!.opt(it), "1") },
                    (0 until (names?.length() ?: 0)).map { names!!.optString(it) }, e.optString("color") == "signal",
                    x(e.opt("opacity"), "1"), x(e.opt("width"), "1"), points, genCount, genName, genX, genY, fields) } }
            val fps = spec.optJSONObject("fps"); val settle = spec.optJSONObject("settle")
            return MotionProgram(vars, funcs, springs, mark, shapes, emit,
                (fps?.optInt("idle", 24) ?: 24).coerceIn(1, 60), (fps?.optInt("rec", 60) ?: 60).coerceIn(1, 120),
                parseHex(spec.optJSONObject("colors")?.optString("signal", "#F4F1EA") ?: "#F4F1EA"),
                (settle?.optDouble("eps", 0.002) ?: 0.002).toFloat().coerceAtLeast(1e-5f), (settle?.optDouble("timeout", 1.4) ?: 1.4).toFloat().coerceAtLeast(0.1f))
        }
    }
}

