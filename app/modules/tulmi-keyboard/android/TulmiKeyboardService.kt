package com.tulmi.app.keyboard

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.inputmethodservice.InputMethodService
import android.inputmethodservice.Keyboard
import android.inputmethodservice.KeyboardView
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.ExtractedTextRequest
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.PopupMenu
import android.widget.TextView
import androidx.core.content.ContextCompat
import java.io.File

/**
 * Tulmi keyboard (IME). A standard-ish QWERTY with two special keys:
 *   🎙️ mic    → record → POST /v1/transcribe-clean → insert cleaned text
 *   ✨ refine  → take the whole field → POST /v1/refine → replace with polished text
 *
 * Talks to the Tulmi backend (see Net.kt). Uses the deprecated Keyboard/
 * KeyboardView for a minimal, working keyboard surface in v1.
 */
class TulmiKeyboardService : InputMethodService(), KeyboardView.OnKeyboardActionListener, KBHost {

    private var keyboardView: KeyboardView? = null
    private var keyboard: Keyboard? = null
    private var statusView: TextView? = null
    private var rootView: View? = null
    private var tonePill: Button? = null

    /** Server-driven config (theme/labels/flags); null until fetched/cached. */
    private var kbConfig: Net.KbConfig? = null

    // -- SDUI wiring ---------------------------------------------------------
    // When the backend flips features.sdui=true AND ships a root tree, we hand
    // the whole keyboard surface to SDUIRenderer instead of inflating
    // res/layout/keyboard.xml. The hand-built path stays intact as a fallback
    // so old configs (and offline first-run before the cache lands) still work.
    private var sduiConfig: KBConfig? = null
    private var sduiRenderer: SDUIRenderer? = null
    private var sduiContainer: FrameLayout? = null
    private val kbState = KBState()
    private var sduiActive = false

    // Tone / emoji preferences persist in SharedPreferences under the same file
    // the config cache uses ("tulmi_kb") — keeps everything keyboard-scoped in
    // one place. Loaded on onCreateInputView, saved on every menu selection.
    private var currentTone = "Neutral"
    private var emojiOn = true

    // One-shot command from the tone menu (Shorter / Longer / Bullet points).
    // Consumed by the next successful transcription: we append it to the field
    // as a trailing "…make it shorter" so the backend's command-mode detector
    // picks it up on refine. Reset once consumed.
    private var pendingCommand: String? = null

    private var caps = false
    private var recorder: MediaRecorder? = null
    private var audioFile: File? = null
    private var recording = false

    // Live (streaming) dictation state. Used when the server enables
    // features.liveVoice; otherwise we fall back to the file-based path.
    private var stream: Stream? = null
    private var streaming = false
    private var pendingPartial = "" // interim text currently shown in the field
    private var dictatedSomething = false // a final landed this session → auto-refine on close

    private val main = Handler(Looper.getMainLooper())

    companion object {
        const val CODE_DELETE = -5
        const val CODE_SHIFT = -1
        const val CODE_ENTER = -4
        const val CODE_SPACE = 32
        const val CODE_MIC = -100
        const val CODE_REFINE = -101
    }

    override fun onCreateInputView(): View {
        // Pick up shared prefs + preload cached config synchronously so we can
        // decide SDUI vs fallback BEFORE inflating anything.
        Net.load(this)
        loadTonePrefs()

        val prefs = getSharedPreferences("tulmi_kb", Context.MODE_PRIVATE)
        val cached = prefs.getString("config_json", null)
        val useSdui = cached != null && SDUIRenderer.isSDUI(cached)

        return if (useSdui) buildSduiInputView(cached!!) else buildFallbackInputView()
    }

    /**
     * SDUI path: create a bare FrameLayout container and hand it to the renderer.
     * The renderer walks config.root and produces the entire view subtree. When
     * the background config refetch returns, `applyConfig` updates the renderer
     * via `updateConfig` so pushed changes take effect without a keyboard reopen.
     */
    private fun buildSduiInputView(rawJson: String): View {
        val container = FrameLayout(this)
        sduiContainer = container
        rootView = container
        sduiActive = true
        try {
            val cfg = SDUIRenderer.parseKBConfig(rawJson)
            sduiConfig = cfg
            val renderer = SDUIRenderer(this, cfg, container)
            sduiRenderer = renderer
            cfg.root?.let { renderer.mount(it) }
        } catch (t: Throwable) {
            android.util.Log.w("SDUI", "parse failed, falling back: ${t.message}")
            sduiActive = false
            return buildFallbackInputView()
        }

        // Kick off the background refresh — same policy as fallback.
        loadAndApplyConfig()
        setupTonePill() // no-op if pill isn't in the tree; harmless
        return container
    }

    /** Legacy hand-built keyboard — inflates keyboard.xml + Keyboard(qwerty). */
    private fun buildFallbackInputView(): View {
        val root = layoutInflater.inflate(
            resources.getIdentifier("keyboard", "layout", packageName),
            null,
        ) as LinearLayout
        val kv: KeyboardView = root.findViewById(resources.getIdentifier("keyboard_view", "id", packageName))
        keyboardView = kv
        statusView = root.findViewById(resources.getIdentifier("status", "id", packageName))
        val kb = Keyboard(this, resources.getIdentifier("qwerty", "xml", packageName))
        keyboard = kb
        kv.keyboard = kb
        kv.setOnKeyboardActionListener(this)
        rootView = root
        sduiActive = false

        // Tone pill (top-bar). Mirrors the iOS tonePill: shows the current tone,
        // opens a PopupMenu with tones + emoji toggle + one-shot commands.
        val pillId = resources.getIdentifier("tone_pill", "id", packageName)
        if (pillId != 0) {
            tonePill = root.findViewById(pillId)
        }
        setupTonePill()

        loadAndApplyConfig()
        return root
    }

    // --- tone pill / command palette ---------------------------------------

    private fun loadTonePrefs() {
        val prefs = getSharedPreferences("tulmi_kb", Context.MODE_PRIVATE)
        currentTone = prefs.getString("tone", "Neutral") ?: "Neutral"
        emojiOn = prefs.getBoolean("emoji", true)
    }

    private fun persistTonePrefs() {
        getSharedPreferences("tulmi_kb", Context.MODE_PRIVATE).edit()
            .putString("tone", currentTone)
            .putBoolean("emoji", emojiOn)
            .apply()
    }

    private fun setupTonePill() {
        val pill = tonePill ?: return
        pill.text = currentTone
        // Rounded background built at runtime so we don't need a new drawable
        // resource file. Corner radius = half the pill height for a full pill.
        val bg = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = 18f * resources.displayMetrics.density
            setColor(Color.WHITE)
        }
        pill.background = bg
        pill.setOnClickListener { anchor -> showToneMenu(anchor) }
    }

    /** Popup: three tones + Emoji On/Off + one-shot Shorter/Longer/Bullet points. */
    private fun showToneMenu(anchor: View) {
        val popup = PopupMenu(this, anchor)
        val menu = popup.menu
        val tones = arrayOf("Casual", "Neutral", "Formal")
        // Menu item IDs: use stable index-based ids so we can identify selection
        // without enum overhead. 1-3 = tones, 4 = emoji, 5-7 = one-shot commands.
        tones.forEachIndexed { i, t ->
            val label = if (t == currentTone) "$t ✓" else t
            menu.add(0, i + 1, i, label)
        }
        menu.add(0, 4, 3, if (emojiOn) "Emoji: On ✓" else "Emoji: Off")
        menu.add(0, 5, 4, "Shorter")
        menu.add(0, 6, 5, "Longer")
        menu.add(0, 7, 6, "Bullet points")
        popup.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                1, 2, 3 -> {
                    currentTone = tones[item.itemId - 1]
                    tonePill?.text = currentTone
                    persistTonePrefs()
                }
                4 -> {
                    emojiOn = !emojiOn
                    persistTonePrefs()
                }
                5 -> pendingCommand = "make it shorter"
                6 -> pendingCommand = "make it longer"
                7 -> pendingCommand = "format as bullet points"
            }
            true
        }
        popup.show()
    }

    /**
     * If the user picked a one-shot command from the tone menu, append it to
     * the field as a trailing suffix like "…make it shorter" so the backend's
     * command-mode detector catches it on the next refine call. Consumed once.
     */
    private fun applyPendingCommandToField() {
        val cmd = pendingCommand ?: return
        val ic = currentInputConnection ?: return
        ic.commitText(" …$cmd", 1)
        pendingCommand = null
    }

    // --- server-driven config (theme/labels/flags), cached for offline -------

    private fun loadAndApplyConfig() {
        val prefs = getSharedPreferences("tulmi_kb", Context.MODE_PRIVATE)
        // Apply last-known config immediately so the keyboard never waits on the network.
        prefs.getString("config_json", null)?.let { applyRawJson(it) }
        // Refresh in the background; cache the result for next time.
        Thread {
            try {
                val json = Net.getKeyboardConfigJson()
                prefs.edit().putString("config_json", json).apply()
                main.post { applyRawJson(json) }
            } catch (_: Exception) { /* offline → keep cached/defaults */ }
        }.start()
    }

    /**
     * Apply raw config JSON to whichever renderer is active. For the fallback
     * path we parse into Net.KbConfig and repaint the hand-built keyboard. For
     * the SDUI path we parse into the full tree model and push it into the
     * renderer via `updateConfig` (which triggers a cheap re-render).
     */
    private fun applyRawJson(json: String) {
        // Fallback theme/labels always parsed — used for label() lookups and
        // for the tone pill even when SDUI is driving the tree.
        try { applyConfig(Net.parseConfig(json)) } catch (_: Exception) {}
        if (sduiActive) {
            try {
                val cfg = SDUIRenderer.parseKBConfig(json)
                sduiConfig = cfg
                sduiRenderer?.updateConfig(cfg)
            } catch (t: Throwable) {
                android.util.Log.w("SDUI", "config apply failed: ${t.message}")
            }
        }
    }

    private fun applyConfig(cfg: Net.KbConfig) {
        kbConfig = cfg
        // If we're rendering via SDUI, the theme lives in the tree, not on the
        // fallback views — skip the legacy color-apply and let the SDUI path
        // pick up the fresh JSON (see applyRawJson below).
        if (sduiActive) return
        try {
            val bg = Color.parseColor(cfg.background)
            rootView?.setBackgroundColor(bg)
            keyboardView?.setBackgroundColor(bg)
            statusView?.setTextColor(parseHexColor(cfg.keyText))
            // Theme the tone pill from cfg.accent so it inherits the same white
            // (or brand-tinted) affordance as the return key on iOS.
            try {
                val accent = parseHexColor(cfg.accent)
                (tonePill?.background as? GradientDrawable)?.setColor(accent)
                val lum = 0.299 * Color.red(accent) + 0.587 * Color.green(accent) + 0.114 * Color.blue(accent)
                tonePill?.setTextColor(if (lum > 153) Color.BLACK else Color.WHITE)
            } catch (_: Exception) { /* keep default */ }
        } catch (_: Exception) { /* malformed color → ignore */ }
    }

    /**
     * Color parser that extends `Color.parseColor` with 8-char `#RRGGBBAA`
     * support (Android's built-in expects `#AARRGGBB`). Used across both the
     * fallback and SDUI paths so themes can push whichever ordering.
     */
    private fun parseHexColor(hex: String): Int = SDUIRenderer.parseHex(hex)

    private fun label(key: String, default: String): String =
        kbConfig?.labels?.get(key) ?: default

    // --- key handling -------------------------------------------------------

    override fun onKey(primaryCode: Int, keyCodes: IntArray?) {
        val ic = currentInputConnection ?: return
        when (primaryCode) {
            CODE_DELETE -> ic.deleteSurroundingText(1, 0)
            CODE_SHIFT -> {
                caps = !caps
                keyboard?.let { it.isShifted = caps }
                keyboardView?.invalidateAllKeys()
            }
            CODE_ENTER -> sendDefaultEditorAction(true)
            CODE_SPACE -> ic.commitText(" ", 1)
            CODE_MIC -> if (kbConfig?.voice != false) toggleVoice() else setStatus(label("voiceOff", "Voice is off."))
            CODE_REFINE -> if (kbConfig?.refine != false) refineField() else setStatus(label("refineOff", "Refine is off."))
            else -> {
                var ch = primaryCode.toChar()
                if (caps) ch = Character.toUpperCase(ch)
                ic.commitText(ch.toString(), 1)
            }
        }
    }

    // --- mic / dictation ----------------------------------------------------

    /** Route to live streaming or the file-based path based on server config. */
    private fun toggleVoice() {
        if (kbConfig?.liveVoice == true) {
            if (streaming) stopStreaming() else startStreaming()
        } else {
            toggleRecording()
        }
    }

    private fun toggleRecording() {
        if (recording) stopAndTranscribe() else startRecording()
    }

    // --- live (streaming) dictation -----------------------------------------

    private fun startStreaming() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            setStatus("Open the Tulmi app once to allow microphone access.")
            return
        }
        pendingPartial = ""
        dictatedSomething = false
        streaming = true
        kbState.dictating = true
        sduiRenderer?.stateChanged()
        setStatus(label("listening", "🎙️ Listening…"))
        val target = targetAppName()
        stream = Stream(
            onReady = { main.post { setStatus(label("listening", "🎙️ Listening…")) } },
            onPartial = { t -> main.post { replacePartial(t) } },
            onFinal = { t -> main.post { commitFinal(t) } },
            onError = { e -> main.post { setStatus("Error: $e"); endStreaming() } },
            onClosed = { main.post { onDictationClosed() } },
        ).also { it.start(target, "auto") }
    }

    /** Swap the on-screen interim text for the latest hypothesis. */
    private fun replacePartial(text: String) {
        val ic = currentInputConnection ?: return
        if (pendingPartial.isNotEmpty()) ic.deleteSurroundingText(pendingPartial.length, 0)
        ic.commitText(text, 1)
        pendingPartial = text
    }

    /** Commit a finalized segment (keep it) and reset the interim tracker. */
    private fun commitFinal(text: String) {
        val ic = currentInputConnection ?: return
        if (pendingPartial.isNotEmpty()) ic.deleteSurroundingText(pendingPartial.length, 0)
        ic.commitText(if (text.endsWith(" ")) text else "$text ", 1)
        pendingPartial = ""
        dictatedSomething = true
    }

    private fun stopStreaming() {
        setStatus(label("transcribing", "Finishing…"))
        stream?.finish()
        endStreaming()
    }

    private fun endStreaming() {
        streaming = false
        stream = null
        kbState.dictating = false
        sduiRenderer?.stateChanged()
        if (statusView?.text == label("transcribing", "Finishing…")) setStatus("")
    }

    /** Dictation closed → auto-refine what was just spoken (replaces the old ✨ key). */
    private fun onDictationClosed() {
        endStreaming()
        if (dictatedSomething) {
            // If the user picked a one-shot command from the tone menu, drop it
            // in as a trailing suffix before refine — the backend command-mode
            // detector reads the field and rewrites accordingly.
            applyPendingCommandToField()
            if (kbConfig?.refine != false) refineField()
        }
        dictatedSomething = false
    }

    private fun startRecording() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            setStatus("Open the Tulmi app once to allow microphone access.")
            return
        }
        try {
            val file = File(cacheDir, "tulmi_rec.m4a")
            val rec = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(this) else @Suppress("DEPRECATION") MediaRecorder()
            rec.setAudioSource(MediaRecorder.AudioSource.MIC)
            rec.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            rec.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            rec.setAudioSamplingRate(16000)
            rec.setOutputFile(file.absolutePath)
            rec.prepare()
            rec.start()
            recorder = rec
            audioFile = file
            recording = true
            kbState.dictating = true
            sduiRenderer?.stateChanged()
            setStatus(label("listening", "🎙️ Listening… tap mic to stop"))
        } catch (e: Exception) {
            setStatus("Mic error: ${e.message}")
            cleanupRecorder()
        }
    }

    private fun stopAndTranscribe() {
        recording = false
        kbState.dictating = false
        sduiRenderer?.stateChanged()
        val file = audioFile
        try {
            recorder?.stop()
        } catch (_: Exception) {
        }
        cleanupRecorder()
        if (file == null || !file.exists()) {
            setStatus("No audio captured.")
            return
        }
        setStatus(label("transcribing", "Transcribing…"))
        val target = targetAppName()
        Thread {
            try {
                val cleaned = Net.transcribeClean(file, target)
                main.post {
                    currentInputConnection?.commitText(cleaned, 1)
                    applyPendingCommandToField()
                    setStatus("")
                }
            } catch (e: Exception) {
                main.post { setStatus("Error: ${e.message}") }
            }
        }.start()
    }

    private fun cleanupRecorder() {
        try {
            recorder?.reset()
            recorder?.release()
        } catch (_: Exception) {
        }
        recorder = null
    }

    // --- refine (smart autocorrect of the whole field) ----------------------

    private fun refineField() {
        val ic = currentInputConnection ?: return
        val before = ic.getTextBeforeCursor(10000, 0)?.toString() ?: ""
        val after = ic.getTextAfterCursor(10000, 0)?.toString() ?: ""
        val full = (before + after).trim()
        if (full.isEmpty()) {
            setStatus("Type something first, then tap ✨")
            return
        }
        kbState.refining = true
        sduiRenderer?.stateChanged()
        setStatus(label("refining", "Refining…"))
        val target = targetAppName()
        Thread {
            try {
                val refined = Net.refine(full, target)
                main.post {
                    val conn = currentInputConnection
                    conn?.deleteSurroundingText(before.length, after.length)
                    conn?.commitText(refined, 1)
                    kbState.refining = false
                    sduiRenderer?.stateChanged()
                    setStatus("")
                }
            } catch (e: Exception) {
                main.post {
                    kbState.refining = false
                    sduiRenderer?.stateChanged()
                    setStatus("Error: ${e.message}")
                }
            }
        }.start()
    }

    // --- helpers ------------------------------------------------------------

    /** Map the current app's package to a friendly name for tone matching. */
    private fun targetAppName(): String {
        val pkg = currentInputEditorInfo?.packageName ?: return "Generic"
        return when {
            pkg.contains("whatsapp") -> "WhatsApp"
            pkg.contains("telegram") -> "Telegram"
            pkg.contains("slack") -> "Slack"
            pkg.contains("gmail") || pkg.contains("email") -> "Gmail"
            pkg.contains("instagram") -> "Instagram"
            pkg.contains("twitter") || pkg.contains("x.android") -> "Twitter"
            pkg.contains("mms") || pkg.contains("messaging") -> "Messages"
            else -> "Generic"
        }
    }

    override fun setStatus(text: String) {
        // Mirror status into KBState so SDUI-driven StatusLabel components can
        // subscribe to the same value the fallback status TextView shows.
        kbState.status = text
        statusView?.let {
            it.text = text
            it.visibility = if (text.isEmpty()) View.GONE else View.VISIBLE
        }
        if (sduiActive) sduiRenderer?.stateChanged()
    }

    override fun onFinishInput() {
        super.onFinishInput()
        if (recording) {
            recording = false
            cleanupRecorder()
        }
        if (streaming) {
            stream?.cancel()
            endStreaming()
        }
        setStatus("")
    }

    // --- unused OnKeyboardActionListener members ----------------------------
    override fun onPress(primaryCode: Int) {}
    override fun onRelease(primaryCode: Int) {}
    override fun onText(text: CharSequence?) {}
    override fun swipeLeft() {}
    override fun swipeRight() {}
    override fun swipeDown() {}
    override fun swipeUp() {}

    // =======================================================================
    // KBHost — implementation the SDUIRenderer calls back into. Everything is
    // a thin adapter over existing methods so the fallback path continues to
    // reuse the same dictation/refine/status helpers.
    // =======================================================================
    override fun context(): Context = this

    override fun ic(): InputConnection? = currentInputConnection

    override fun startDictation() {
        if (kbConfig?.voice == false) {
            setStatus(label("voiceOff", "Voice is off."))
            return
        }
        if (kbConfig?.liveVoice == true) startStreaming() else startRecording()
    }

    override fun stopDictation() {
        if (streaming) stopStreaming()
        if (recording) stopAndTranscribe()
    }

    override fun runRefine() {
        if (kbConfig?.refine == false) {
            setStatus(label("refineOff", "Refine is off."))
            return
        }
        refineField()
    }

    override fun switchLayout(language: String?) {
        val target = language ?: return cycleLayout()
        kbState.layoutId = target
        sduiRenderer?.stateChanged()
    }

    override fun cycleLayout() {
        val layouts = sduiConfig?.layouts ?: return
        if (layouts.isEmpty()) return
        val idx = layouts.indexOfFirst { it.language == kbState.layoutId }
        val next = layouts[(idx + 1).coerceAtLeast(0) % layouts.size]
        kbState.layoutId = next.language
        sduiRenderer?.stateChanged()
    }

    override fun showLanguageMenu() {
        val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
        imm?.showInputMethodPicker()
    }

    override fun state(): KBState = kbState

    override fun config(): KBConfig =
        sduiConfig ?: throw IllegalStateException("SDUI config not loaded")

    override fun rootView(): View? = rootView

    override fun onStateChanged() {
        sduiRenderer?.stateChanged()
    }
}
