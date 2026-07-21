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
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
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
    private var audioFx: TulmiAudioFx? = null

    // Voice-reactive UI wants the recorder's amplitude every ~33ms. We can't
    // read MediaRecorder.maxAmplitude directly on a background thread, so we
    // schedule a Handler tick on the main queue and push the smoothed level
    // into kbState.micLevel for whatever SDUI nodes bind to it.
    private var micLevelTimer: Runnable? = null
    private var smoothedLevel: Float = 0f

    // Long-press-to-cursor on the space bar. Ticks a follow-up gesture that
    // interprets ACTION_MOVE dx as InputConnection.setSelection() displacement.
    private var spaceDragging = false
    private var spaceDragAnchorX = 0f
    private var spaceDragAnchorSel = 0

    // Backspace acceleration — hold-to-delete-faster with a decaying interval.
    private val backspaceTicks = arrayOf(280L, 180L, 120L, 80L, 45L, 25L)
    private var backspaceTickIndex = 0
    private var backspaceRunnable: Runnable? = null

    // Live (streaming) dictation state. Used when the server enables
    // features.liveVoice; otherwise we fall back to the file-based path.
    private var stream: Stream? = null
    private var streaming = false
    // True from stopStreaming() (the "Finishing…" flush window) until
    // endStreaming() tears down. Guards against a second mic tap double-finishing
    // the stream (extra stop frame + a watchdog that could close a fresh session).
    private var finishing = false
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
        // Idempotent: a second start (double-tap, or an SDUI StartDictation while
        // already live) would overwrite `stream`/`recorder` and leak the first
        // with the mic left hot. Bail if anything is already capturing.
        if (streaming || recording) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            setStatus("Open the Tailzu app once to allow microphone access.")
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
            // Only paint interim words live when the backend's kb.mic.liveText is
            // on; otherwise wait for the final so text lands in one block after
            // stop. The final always commits either way.
            onPartial = { t -> if (kbConfig?.liveText != false) main.post { replacePartial(t) } },
            onFinal = { t -> main.post { commitFinal(t) } },
            onError = { m -> main.post {
                val lower = m.lowercase()
                // A 401/unauthorized means the shared token expired — tell the
                // user to reopen the app (which re-shares a fresh one).
                if (lower.contains("unauthorized") || lower.contains("invalid or missing token"))
                    setStatus(label("auth_expired", "Open Tailzu once to sign in again"))
                else
                    setStatus(label("voice_not_listening", "444 : Not Listening"))
                endStreaming()
            } },
            onClosed = { main.post { onDictationClosed() } },
            // Publish the live mic level so a Waveform / level-bound SDUI node
            // reacts during streaming (the file path polls maxAmplitude; the
            // streaming path had no level source).
            onLevel = { lvl -> main.post {
                kbState.micLevel = lvl
                sduiRenderer?.stateChanged()
            } },
        ).also { it.start(target, "auto") }
    }

    /** Swap the on-screen interim text for the latest hypothesis. */
    private fun replacePartial(text: String) {
        val ic = currentInputConnection ?: return
        if (pendingPartial.isNotEmpty()) ic.deleteSurroundingText(pendingPartial.length, 0)
        ic.commitText(text, 1)
        pendingPartial = text
    }

    // Conversational refusal/clarification the STT/refine can emit on silence
    // ("I didn't catch that", "say that again", "no speech detected"). The server
    // filters these, but this is the last line of defense: such a string must
    // NEVER land in the field. Precise + length-bounded (mirrors iOS
    // KeyboardViewController.looksLikeFiller / the backend looksLikeMeta guard)
    // so a real short dictation is never dropped.
    private val fillerPatterns: List<Regex> = listOf(
        "\\bi (didn'?t|couldn'?t|can'?t|could not|did not) (catch|hear|understand|make out) (that|it|you|anything)\\b",
        "\\bi (don'?t|didn'?t) get anything\\b",
        "\\b(could|can) you (say (that|it) again|repeat that)\\b",
        "\\bsay (that|it) again\\b",
        "\\b(please )?repeat that\\b",
        "\\bno (speech|audio|input|sound) (was )?(detected|found|received|captured)\\b",
        "\\bnothing (was said|to transcribe|was detected|was captured)\\b",
    ).map { Regex(it, RegexOption.IGNORE_CASE) }

    private fun looksLikeFiller(text: String): Boolean {
        val t = text.trim()
        if (t.isEmpty() || t.length > 140) return false
        return fillerPatterns.any { it.containsMatchIn(t) }
    }

    /** Commit a finalized segment (keep it) and reset the interim tracker. */
    private fun commitFinal(text: String) {
        // Never insert a bare space for an empty final — that dropped a stray
        // trailing space at the cursor. Empty finals carry no words.
        if (text.isBlank()) return
        val ic = currentInputConnection ?: return
        // Never commit a conversational refusal to the field — drop it and wipe
        // the provisional partial it was replacing.
        if (looksLikeFiller(text)) {
            if (pendingPartial.isNotEmpty()) ic.deleteSurroundingText(pendingPartial.length, 0)
            pendingPartial = ""
            return
        }
        if (pendingPartial.isNotEmpty()) ic.deleteSurroundingText(pendingPartial.length, 0)
        ic.commitText(if (text.endsWith(" ")) text else "$text ", 1)
        pendingPartial = ""
        dictatedSomething = true
    }

    private fun stopStreaming() {
        // Don't tear down yet. finish() stops the mic and asks the server to
        // flush the engine's final tail + send "done"; we keep the socket AND
        // the stream alive so those tail words still land. Teardown happens when
        // onDictationClosed() runs (the "done" event) or finish()'s watchdog
        // fires. Tearing down here cut the socket before the tail arrived.
        // Ignore a second stop tap during the flush window — otherwise we send a
        // second "stop" frame and arm a second watchdog that could later close a
        // freshly-restarted session, and the double-finish blocks restarting.
        if (finishing) return
        val s = stream ?: run { endStreaming(); return }
        finishing = true
        setStatus(label("transcribing", "Finishing…"))
        s.finish()
    }

    private fun endStreaming() {
        finishing = false
        streaming = false
        // Terminal path: cancel the stream so the mic/socket/capture thread are
        // released here too (the error path used to just null the ref, leaving
        // the mic hot until the IME died). cancel() is idempotent + safe on an
        // already-closed stream, so the normal "done" close path is unaffected.
        stream?.cancel()
        stream = null
        kbState.dictating = false
        kbState.micLevel = 0f
        sduiRenderer?.stateChanged()
        if (statusView?.text == label("transcribing", "Finishing…")) setStatus("")
    }

    /** Dictation closed → auto-refine what was just spoken (replaces the old ✨ key). */
    private fun onDictationClosed() {
        // A partial may still be in the field that never got its finalizing
        // "final" (socket closed right after the last partial). It's real
        // dictated text already at the cursor — treat it as committed so the
        // tail isn't dropped and refine still runs over it.
        if (pendingPartial.isNotEmpty()) {
            dictatedSomething = true
            pendingPartial = ""
        }
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
        // Idempotent — see startStreaming. A second start would strand the first
        // MediaRecorder with the mic hot.
        if (recording || streaming) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            setStatus("Open the Tailzu app once to allow microphone access.")
            return
        }
        try {
            val file = File(cacheDir, "tulmi_rec.m4a")
            val rec = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(this) else @Suppress("DEPRECATION") MediaRecorder()
            // VOICE_COMMUNICATION activates the OS voice-processing pipeline
            // (AEC + NS + AGC where the vendor implements it) — matches the
            // iOS AVAudioSession .voiceChat mode, which is what makes the
            // background-voice + hiss rejection possible.
            rec.setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
            rec.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            rec.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            rec.setAudioSamplingRate(16000)
            rec.setOutputFile(file.absolutePath)
            rec.prepare()
            rec.start()
            // Layer TulmiAudioFx on top so devices that don't route
            // VOICE_COMMUNICATION through the shared pipeline still get
            // application-level AEC/NS/AGC. audioSessionId isn't exposed on
            // MediaRecorder, but the global session (id 0) accepts effects
            // that apply to any active input on this app.
            audioFx = TulmiAudioFx.attach(audioSessionId = 0)
            recorder = rec
            audioFile = file
            recording = true
            kbState.dictating = true
            sduiRenderer?.stateChanged()
            startMicLevelPolling()
            setStatus(label("listening", "🎙️ Listening… tap mic to stop"))
        } catch (e: Exception) {
            setStatus(label("voice_not_listening", "444 : Not Listening"))
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
            setStatus(label("voice_not_listening", "444 : Not Listening"))
            return
        }
        setStatus(label("transcribing", "Transcribing…"))
        val target = targetAppName()
        Thread {
            try {
                val cleaned = Net.transcribeClean(file, target)
                main.post {
                    // Drop a conversational refusal/clarification instead of
                    // committing it (mirrors the streaming commitFinal guard);
                    // there's nothing to refine in that case either.
                    if (looksLikeFiller(cleaned)) {
                        setStatus("")
                        return@post
                    }
                    currentInputConnection?.commitText(cleaned, 1)
                    setStatus("")
                    // A one-shot tone command (Shorter/Longer/Bullets) is only
                    // meaningful if a refine actually consumes it — same as the
                    // streaming path's onDictationClosed(). Appending it without a
                    // following refine (the old behaviour) left "…make it shorter"
                    // stranded in the field forever. Only drop it in + refine when
                    // refine is enabled; otherwise leave it pending for next time.
                    if (pendingCommand != null && kbConfig?.refine != false) {
                        applyPendingCommandToField()
                        refineField()
                    }
                }
            } catch (e: Exception) {
                main.post { setStatus(statusForError(e)) }
            }
        }.start()
    }

    /**
     * Map a backend failure to a status line. Net wraps HTTP errors as
     * "<op> <code>: <body>"; a 401 means the token the app shared into
     * SharedPreferences has expired — the keyboard can't refresh a Supabase
     * session itself, so the fix is to open the app once (which re-shares a
     * fresh token). Everything else is the generic "backend unavailable" copy.
     */
    private fun statusForError(e: Throwable): String {
        val msg = e.message ?: ""
        return if (msg.contains(" 401") || msg.contains("unauthorized", ignoreCase = true))
            label("auth_expired", "Open Tailzu once to sign in again")
        else
            label("voice_unavailable", "222 : will let you know when we are back")
    }

    private fun cleanupRecorder() {
        try {
            recorder?.reset()
            recorder?.release()
        } catch (_: Exception) {
        }
        recorder = null
        try { audioFx?.close() } catch (_: Throwable) {}
        audioFx = null
        stopMicLevelPolling()
    }

    // ---------------------------------------------------------------------
    // Voice-reactive mic-level polling. maxAmplitude is a 16-bit signed int
    // — we normalize to [0, 1] and IIR-smooth it so a single burst doesn't
    // jerk the animation. Publishes into kbState.micLevel so SDUI nodes that
    // bind to it (MediaPlayer speed, Waveform bars if a backend ever adds
    // them back) get live values.
    // ---------------------------------------------------------------------

    private fun startMicLevelPolling() {
        stopMicLevelPolling()
        smoothedLevel = 0f
        val fps = 30f
        val periodMs = (1000f / fps).toLong()
        val alpha = 0.35f  // one-pole IIR — 0..1, higher = less smoothing
        val tick = object : Runnable {
            override fun run() {
                val rec = recorder ?: return
                val amp = try { rec.maxAmplitude } catch (_: Throwable) { 0 }
                val norm = (amp / 32767f).coerceIn(0f, 1f)
                smoothedLevel = smoothedLevel * (1 - alpha) + norm * alpha
                kbState.micLevel = smoothedLevel
                sduiRenderer?.stateChanged()
                main.postDelayed(this, periodMs)
            }
        }
        micLevelTimer = tick
        main.postDelayed(tick, periodMs)
    }

    private fun stopMicLevelPolling() {
        micLevelTimer?.let { main.removeCallbacks(it) }
        micLevelTimer = null
        kbState.micLevel = 0f
        sduiRenderer?.stateChanged()
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
        // Read the currently-selected tone fresh from prefs so refine honors it,
        // whether it was set by the hand-built pill or the SDUI cycleTone (both
        // write "tulmi_kb"/"tone"). Was previously never sent → tone had no
        // effect on Android refine output.
        val tone = getSharedPreferences("tulmi_kb", Context.MODE_PRIVATE)
            .getString("tone", "Neutral") ?: "Neutral"
        Thread {
            try {
                val refined = Net.refine(full, target, tone)
                main.post {
                    val conn = currentInputConnection
                    conn?.deleteSurroundingText(before.length, after.length)
                    conn?.commitText(refined, 1)
                    kbState.refining = false
                    sduiRenderer?.stateChanged()
                    setStatus("")
                    flashKeysForText(refined)
                }
            } catch (e: Exception) {
                main.post {
                    kbState.refining = false
                    sduiRenderer?.stateChanged()
                    setStatus(statusForError(e))
                }
            }
        }.start()
    }

    // ---------------------------------------------------------------------
    // Orange word-flash across letter keys — mirrors the iOS
    // KeyboardViewController.flashKeysForText behaviour. Whenever refined
    // text lands, walk every key in the current view tree that represents
    // a letter that appears in the incoming string and animate its
    // background between authored key-fill and brand-accent for ~120ms,
    // staggered by index so it reads as a left-to-right wave rather than a
    // simultaneous pop.
    //
    // No hardcoded list of keys — we walk rootView recursively and pick out
    // anything that IS a Button/TextView with a single-char letter label.
    // Backend-driven layouts (new symbol pages, extra keys, non-Latin
    // scripts) all light up correctly because the discovery is purely by
    // shape, not by a static keymap.
    // ---------------------------------------------------------------------

    private fun flashKeysForText(text: String) {
        val root = rootView ?: return
        val letters = text.lowercase().toCharArray().toSet()
        if (letters.isEmpty()) return
        val hits = mutableListOf<TextView>()
        walkLetterKeys(root, letters, hits)
        if (hits.isEmpty()) return
        val accentHex = kbConfig?.accent ?: "#e8a23c"
        val accent = try { SDUIRenderer.parseHex(accentHex) } catch (_: Throwable) { Color.parseColor("#e8a23c") }
        val perStagger = 25L
        val flashMs = 260L
        hits.sortBy { locationX(it) }
        hits.forEachIndexed { i, key ->
            main.postDelayed({ flashOneKey(key, accent, flashMs) }, i * perStagger)
        }
    }

    private fun walkLetterKeys(v: View, letters: Set<Char>, out: MutableList<TextView>) {
        if (v is TextView && v !is Button && v.text?.length == 1) {
            val ch = v.text[0].lowercaseChar()
            if (ch in letters) out.add(v)
            return
        }
        if (v is Button && v.text?.length == 1) {
            val ch = v.text[0].lowercaseChar()
            if (ch in letters) out.add(v)
            return
        }
        if (v is ViewGroup) {
            for (i in 0 until v.childCount) walkLetterKeys(v.getChildAt(i), letters, out)
        }
    }

    private fun locationX(v: View): Int {
        val out = IntArray(2)
        v.getLocationOnScreen(out)
        return out[0]
    }

    private fun flashOneKey(v: TextView, accent: Int, ms: Long) {
        val originalBg = v.background
        val originalTint = v.currentTextColor
        val flashBg = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = 7f * resources.displayMetrics.density
            setColor(accent)
        }
        v.background = flashBg
        v.setTextColor(Color.parseColor("#14100c"))
        main.postDelayed({
            v.background = originalBg
            v.setTextColor(originalTint)
        }, ms)
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
        // The keyboard shows NO status text. Every status/error string — the
        // 444/222 codes, "Listening…", "Finishing…", permission/auth prompts —
        // is suppressed here so nothing chatty renders over the keys. The
        // mic-button animation is the only feedback the keyboard gives.
        // (Single choke point so callers don't need to change.)
        kbState.status = ""
        statusView?.let {
            it.text = ""
            it.visibility = View.GONE
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

    override fun onDestroy() {
        // The service can be destroyed WITHOUT a final onFinishInput — release
        // the mic + streaming socket and drop every pending main-thread callback
        // (mic-level poll, backspace repeat, key-flash restores, SDUI posts) so
        // nothing leaks or fires against a torn-down view. Idempotent.
        try { if (recording) cleanupRecorder() } catch (_: Exception) {}
        try { stream?.cancel() } catch (_: Exception) {}
        recording = false
        streaming = false
        main.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    // ---------------------------------------------------------------------
    // Text-field lifecycle. Runs every time a new input field takes focus.
    // Refreshes auto-capitalization + Return-key label so both react to the
    // field the keyboard is currently sitting on (email vs search vs
    // messenger vs multi-line note).
    // ---------------------------------------------------------------------

    override fun onStartInputView(info: android.view.inputmethod.EditorInfo?, restarting: Boolean) {
        super.onStartInputView(info, restarting)
        refreshAutoCap()
        refreshReturnKeyLabel(info)
    }

    override fun onUpdateSelection(
        oldSelStart: Int, oldSelEnd: Int,
        newSelStart: Int, newSelEnd: Int,
        candidatesStart: Int, candidatesEnd: Int,
    ) {
        super.onUpdateSelection(oldSelStart, oldSelEnd, newSelStart, newSelEnd, candidatesStart, candidatesEnd)
        refreshAutoCap()
    }

    /**
     * Auto-capitalize by asking the InputConnection whether the next
     * character should be uppercased — Android's own text engine tells us
     * (based on TextView.CAP_MODE_SENTENCES + the surrounding punctuation).
     * The keyboard just observes; the field owner decides.
     */
    private fun refreshAutoCap() {
        val ic = currentInputConnection ?: return
        val info = currentInputEditorInfo ?: return
        val capMode = ic.getCursorCapsMode(info.inputType) and android.text.TextUtils.CAP_MODE_SENTENCES
        val shouldCap = capMode != 0
        if (caps != shouldCap) {
            caps = shouldCap
            keyboard?.isShifted = caps
            keyboardView?.invalidateAllKeys()
            kbState.shift = caps
            sduiRenderer?.stateChanged()
        }
    }

    /**
     * Return-key label follows EditorInfo.imeOptions — same source iOS
     * reads via UITextInputTraits.returnKeyType. When the host requests a
     * specific action (search, send, done, next) we surface the localized
     * label from kbConfig.labels so translations flow through the backend.
     * Nothing hardcodes a language.
     */
    private fun refreshReturnKeyLabel(info: android.view.inputmethod.EditorInfo?) {
        val opts = info?.imeOptions ?: 0
        val action = opts and android.view.inputmethod.EditorInfo.IME_MASK_ACTION
        val fallback = when (action) {
            android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH -> "Search"
            android.view.inputmethod.EditorInfo.IME_ACTION_SEND -> "Send"
            android.view.inputmethod.EditorInfo.IME_ACTION_GO -> "Go"
            android.view.inputmethod.EditorInfo.IME_ACTION_NEXT -> "Next"
            android.view.inputmethod.EditorInfo.IME_ACTION_DONE -> "Done"
            else -> "Return"
        }
        val key = "return.${fallback.lowercase()}"
        val labelText = kbConfig?.labels?.get(key) ?: fallback
        kbState.returnLabel = labelText
        sduiRenderer?.stateChanged()
    }

    // ---------------------------------------------------------------------
    // Gesture layer. Backspace acceleration + space cursor-drag are wired
    // as touch listeners on whichever concrete views the renderer creates
    // — we look them up by tag on every remount so hot-swaps of the tree
    // don't leave stale references.
    // ---------------------------------------------------------------------

    /** Attach hold-to-repeat + acceleration to a backspace button. */
    fun bindBackspaceAcceleration(view: View) {
        view.setOnTouchListener { v, ev ->
            when (ev.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    backspaceTickIndex = 0
                    val r = object : Runnable {
                        override fun run() {
                            currentInputConnection?.deleteSurroundingText(1, 0)
                            val idx = backspaceTickIndex.coerceAtMost(backspaceTicks.lastIndex)
                            val delay = backspaceTicks[idx]
                            backspaceTickIndex = (backspaceTickIndex + 1).coerceAtMost(backspaceTicks.lastIndex)
                            main.postDelayed(this, delay)
                        }
                    }
                    backspaceRunnable = r
                    main.postDelayed(r, backspaceTicks[0])
                    false
                }
                MotionEvent.ACTION_UP,
                MotionEvent.ACTION_CANCEL -> {
                    backspaceRunnable?.let { main.removeCallbacks(it) }
                    backspaceRunnable = null
                    v.performClick()
                    true
                }
                else -> false
            }
        }
    }

    /**
     * Attach space long-press → cursor drag. During the drag the space
     * key stops being a space key; ACTION_MOVE dx translates to selection
     * displacement one character per ~14dp (matches iOS trackpad tuning).
     */
    fun bindSpaceCursorDrag(view: View) {
        val threshold = view.resources.displayMetrics.density * 14f
        view.setOnLongClickListener { v ->
            spaceDragging = true
            v.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
            val ic = currentInputConnection
            val before = ic?.getTextBeforeCursor(1_000_000, 0)?.length ?: 0
            spaceDragAnchorSel = before
            true
        }
        view.setOnTouchListener { v, ev ->
            when (ev.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    spaceDragAnchorX = ev.rawX
                    false
                }
                MotionEvent.ACTION_MOVE -> {
                    if (spaceDragging) {
                        val dx = ev.rawX - spaceDragAnchorX
                        val delta = (dx / threshold).toInt()
                        val target = (spaceDragAnchorSel + delta).coerceAtLeast(0)
                        currentInputConnection?.setSelection(target, target)
                        true
                    } else false
                }
                MotionEvent.ACTION_UP,
                MotionEvent.ACTION_CANCEL -> {
                    val wasDragging = spaceDragging
                    spaceDragging = false
                    if (wasDragging) true else { v.performClick(); false }
                }
                else -> false
            }
        }
    }

    /**
     * Attach long-press accent menu to a letter view. [accents] comes from
     * the backend config (kb.accents[char]) so which accents show up for
     * each key is a server-side decision; the keyboard never hardcodes a
     * mapping. Empty accent list = no menu.
     */
    fun bindAccentLongPress(view: TextView, char: Char) {
        val accents = kbConfig?.accents?.get(char.lowercase()) ?: return
        if (accents.isEmpty()) return
        view.setOnLongClickListener { v ->
            v.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
            val popup = PopupMenu(this, v)
            accents.forEachIndexed { i, glyph ->
                popup.menu.add(0, i, i, glyph.toString())
            }
            popup.setOnMenuItemClickListener { item ->
                val glyph = accents.getOrNull(item.itemId) ?: return@setOnMenuItemClickListener false
                val out = if (caps) glyph.uppercaseChar() else glyph
                currentInputConnection?.commitText(out.toString(), 1)
                true
            }
            popup.show()
            true
        }
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
