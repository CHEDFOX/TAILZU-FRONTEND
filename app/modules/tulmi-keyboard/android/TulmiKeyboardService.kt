package com.tulmi.app.keyboard

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Color
import android.inputmethodservice.InputMethodService
import android.inputmethodservice.Keyboard
import android.inputmethodservice.KeyboardView
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.inputmethod.ExtractedTextRequest
import android.widget.LinearLayout
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
class TulmiKeyboardService : InputMethodService(), KeyboardView.OnKeyboardActionListener {

    private lateinit var keyboardView: KeyboardView
    private lateinit var keyboard: Keyboard
    private var statusView: TextView? = null
    private var rootView: View? = null

    /** Server-driven config (theme/labels/flags); null until fetched/cached. */
    private var kbConfig: Net.KbConfig? = null

    private var caps = false
    private var recorder: MediaRecorder? = null
    private var audioFile: File? = null
    private var recording = false

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
        val root = layoutInflater.inflate(
            resources.getIdentifier("keyboard", "layout", packageName),
            null,
        ) as LinearLayout
        keyboardView = root.findViewById(resources.getIdentifier("keyboard_view", "id", packageName))
        statusView = root.findViewById(resources.getIdentifier("status", "id", packageName))
        keyboard = Keyboard(this, resources.getIdentifier("qwerty", "xml", packageName))
        keyboardView.keyboard = keyboard
        keyboardView.setOnKeyboardActionListener(this)
        rootView = root
        // Pick up the backend URL + user token the app shared before any request.
        Net.load(this)
        loadAndApplyConfig()
        return root
    }

    // --- server-driven config (theme/labels/flags), cached for offline -------

    private fun loadAndApplyConfig() {
        val prefs = getSharedPreferences("tulmi_kb", Context.MODE_PRIVATE)
        // Apply last-known config immediately so the keyboard never waits on the network.
        prefs.getString("config_json", null)?.let {
            try { applyConfig(Net.parseConfig(it)) } catch (_: Exception) {}
        }
        // Refresh in the background; cache the result for next time.
        Thread {
            try {
                val json = Net.getKeyboardConfigJson()
                val cfg = Net.parseConfig(json)
                prefs.edit().putString("config_json", json).apply()
                main.post { applyConfig(cfg) }
            } catch (_: Exception) { /* offline → keep cached/defaults */ }
        }.start()
    }

    private fun applyConfig(cfg: Net.KbConfig) {
        kbConfig = cfg
        try {
            val bg = Color.parseColor(cfg.background)
            rootView?.setBackgroundColor(bg)
            keyboardView.setBackgroundColor(bg)
            statusView?.setTextColor(Color.parseColor(cfg.keyText))
        } catch (_: Exception) { /* malformed color → ignore */ }
    }

    private fun label(key: String, default: String): String =
        kbConfig?.labels?.get(key) ?: default

    // --- key handling -------------------------------------------------------

    override fun onKey(primaryCode: Int, keyCodes: IntArray?) {
        val ic = currentInputConnection ?: return
        when (primaryCode) {
            CODE_DELETE -> ic.deleteSurroundingText(1, 0)
            CODE_SHIFT -> {
                caps = !caps
                keyboard.isShifted = caps
                keyboardView.invalidateAllKeys()
            }
            CODE_ENTER -> sendDefaultEditorAction(true)
            CODE_SPACE -> ic.commitText(" ", 1)
            CODE_MIC -> if (kbConfig?.voice != false) toggleRecording() else setStatus(label("voiceOff", "Voice is off."))
            CODE_REFINE -> if (kbConfig?.refine != false) refineField() else setStatus(label("refineOff", "Refine is off."))
            else -> {
                var ch = primaryCode.toChar()
                if (caps) ch = Character.toUpperCase(ch)
                ic.commitText(ch.toString(), 1)
            }
        }
    }

    // --- mic / dictation ----------------------------------------------------

    private fun toggleRecording() {
        if (recording) stopAndTranscribe() else startRecording()
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
            setStatus(label("listening", "🎙️ Listening… tap mic to stop"))
        } catch (e: Exception) {
            setStatus("Mic error: ${e.message}")
            cleanupRecorder()
        }
    }

    private fun stopAndTranscribe() {
        recording = false
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
        setStatus(label("refining", "Refining…"))
        val target = targetAppName()
        Thread {
            try {
                val refined = Net.refine(full, target)
                main.post {
                    val conn = currentInputConnection
                    conn?.deleteSurroundingText(before.length, after.length)
                    conn?.commitText(refined, 1)
                    setStatus("")
                }
            } catch (e: Exception) {
                main.post { setStatus("Error: ${e.message}") }
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

    private fun setStatus(text: String) {
        statusView?.let {
            it.text = text
            it.visibility = if (text.isEmpty()) View.GONE else View.VISIBLE
        }
    }

    override fun onFinishInput() {
        super.onFinishInput()
        if (recording) {
            recording = false
            cleanupRecorder()
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
}
