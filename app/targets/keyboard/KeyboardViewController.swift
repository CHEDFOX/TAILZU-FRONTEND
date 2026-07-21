import UIKit
import AVFoundation

/// Tulmi keyboard (iOS custom keyboard extension).
///
/// A native-feel QWERTY mirroring Apple's keyboard, with a Wispr-style top bar:
///   🎙️ mic (Tailzu mark) → record → POST /v1/transcribe-clean → insert text
///   ✨ refine (auto, after dictation) → POST /v1/refine
///
/// Native-feel engine (ships in the binary; not server-tunable):
///   • press-down highlight + selection haptic
///   • key-pop callout balloon on letter keys
///   • delete auto-repeat (0.5s initial / 0.1s interval)
///   • shift one-shot / caps-lock (double-tap) + auto-capitalization
///   • 123 / #+= number & symbol pages, double-space → ". "
///
/// Both special keys (network + microphone) require "Allow Full Access".
class KeyboardViewController: UIInputViewController, AVAudioRecorderDelegate {

  // Layout / state
  private enum KeyPage { case letters, numbers, symbols }
  private enum ShiftState { case off, oneShot, locked }
  private var page: KeyPage = .letters
  private var shiftState: ShiftState = .oneShot   // auto-cap at field start

  private var letterButtons: [UIButton] = []      // case-toggled keys (letters page only)
  private var allKeys: [UIButton] = []            // themable keys currently on screen
  private var bottomKeys: [UIButton] = []         // persistent bottom-row themable keys
  private var keyRowStacks: [UIStackView] = []    // the 3 rebuilt rows (per page)
  private var mainStack: UIStackView!  // nil-safe after SDUI takeover (see loadAndApplyConfig)

  private let statusLabel = UILabel()
  private var nextKeyboardButton: UIButton!
  private var micButton: UIButton!
  private var refineButton: UIButton?   // no longer shown; kept for auto-refine after dictation
  private var tonePill: UIButton!
  private var returnButton: UIButton?
  private var shiftButton: UIButton?
  private var pageToggleButton: UIButton?         // bottom-left 123 / ABC
  private var undoButton: UIButton!               // top-bar undo — reverts the last insert
  private var currentTone = "Formal"
  private let tones = ["Formal", "Casual", "Very Casual", "Excited"]

  // Last insert tracking for the top-bar UNDO. Whenever we insert cleaned voice
  // text, refined text, or a paste, we record what we inserted here so a single
  // undo tap can delete exactly that string. `lastRawTranscript` (if set) is
  // re-inserted in its place — used by refine to revert to the pre-refine text.
  private var lastInserted: String?
  private var lastRawTranscript: String?

  // Native-feel key press haptic (KeyboardKit standard = selectionChanged on tap).
  // Requires "Allow Full Access"; UISelectionFeedbackGenerator is silent without it.
  private let selectionHaptic = UISelectionFeedbackGenerator()

  // Press-down highlight: remember each key's base color so we can restore it.
  private var pressRestore: [UIButton: UIColor] = [:]
  // Key-pop callout balloon (lazily created, reused).
  private var calloutLabel: UILabel?
  // Delete auto-repeat timer.
  private var deleteTimer: Timer?
  // Double-tap timing for shift / double-space.
  private var lastShiftTapTime: TimeInterval = 0
  private var lastSpaceTime: TimeInterval = 0

  // Server-driven config (theme/labels/flags); nil until fetched/cached.
  private var kbConfig: TulmiBackend.KbConfig?

  // SDUI (server-driven UI) renderer. Non-nil when `features.sdui == true` and
  // the fetched config carries a `root` KeyboardNode tree — in that case the
  // hand-built UI below is torn down and the renderer owns the keyboard view.
  // When nil, the hand-built path stays as the fallback.
  private var sduiRenderer: SDUIRenderer?

  // Microphone / dictation state (file-based, one-shot).
  private var audioRecorder: AVAudioRecorder?
  private var recordingURL: URL?
  private var isRecording = false

  // Personality quick-swap row above the keys — tap = switch, long-press =
  // tone popover. Content flows from the keyboard config's
  // kb.personality.pinned flag. See TulmiPersonalityRow.swift.
  private let personalityRow = TulmiPersonalityRow()

  // Mic handoff: kept as a fallback for hosts that refuse in-extension
  // recording. Default path is now local (see micTapped) — my earlier
  // "iOS blocks recording" refactor was wrong; Wispr Flow, Grammarly, etc.
  // all record in-extension with Full Access on.
  private lazy var handoff: TulmiHandoff = {
    let h = TulmiHandoff()
    h.onResult = { [weak self] text, cancelled in
      guard let self = self else { return }
      self.isHandoffActive = false
      self.micButton.setImage(self.brandMarkImage(), for: .normal)
      // Never let a conversational refusal ("I didn't catch that") reach the
      // field — drop it to nothing, same guard the streaming path uses.
      if cancelled || text.isEmpty || self.looksLikeFiller(text) {
        self.setStatus("")
        return
      }
      self.textDocumentProxy.insertText(text)
      self.lastInserted = text
      self.lastRawTranscript = nil
      self.setStatus("")
    }
    return h
  }()
  private var isHandoffActive = false

  // Flow Session (background-audio mic — kb.mic.mode="flow"). The app holds the
  // mic alive in the background; this coordinator drives each dictation and
  // receives live transcripts over Darwin + the App Group. See TulmiFlow.
  private lazy var flow: TulmiFlow = {
    let f = TulmiFlow()
    f.onTranscript = { [weak self] text, isFinal in
      guard let self = self else { return }
      // The final ALWAYS commits (that's the after-stop text). Interim partials
      // only paint the field live when kb.mic.liveText is on — backend flips it
      // without a rebuild. Off → the field stays put until you stop, then the
      // final lands in one shot.
      if isFinal { self.commitFinal(text) }
      else if self.micLiveText { self.replacePartial(with: text) }
    }
    f.onEnded = { [weak self] in
      guard let self = self else { return }
      // Session expired / turned off — reset the mic UI. The button flips back
      // to "Start Flow"; the next tap re-opens the app to arm a fresh session.
      self.flowRecording = false
      self.pendingPartial = ""
      self.sduiRenderer?.reflectDictating(false)
      self.refreshFlowButton()
    }
    return f
  }()
  private var flowRecording = false
  // Bumped on each dictation start / abandon so a stale dead-app watchdog can
  // tell whether it still refers to the current dictation.
  private var flowDictationToken = 0

  // Live (streaming) dictation state.
  private var stream: TulmiStream?
  private var isStreaming = false
  // Set synchronously the instant a stream start begins, BEFORE the async mic
  // permission round-trip — so a double-tap can't spawn two TulmiStreams (the
  // second would orphan the first's engine + tap + socket). Cleared once the
  // stream actually starts, or on any bail.
  private var isStartingStream = false
  // Same synchronous guard for the file-based record path: set the instant a
  // record start begins, BEFORE the async mic-permission round-trip, so a
  // double-tap can't spawn two AVAudioRecorders (the second would orphan the
  // first's mic/engine). Cleared once recording begins, or on any bail.
  private var isStartingRecording = false
  private var pendingPartial = "" // partial text currently shown in the field
  private var dictatedSomething = false // a final landed this session → auto-refine on close

  // QWERTY letter rows.
  private let rows: [[String]] = [
    ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
    ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
    ["z", "x", "c", "v", "b", "n", "m"],
  ]

  // Number / symbol pages (Apple layout). Row 3 here is punctuation only — the
  // leading toggle key and trailing delete are added by rebuildKeyArea().
  private let numberRows: [[String]] = [
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
    ["-", "/", ":", ";", "(", ")", "$", "&", "@", "\""],
    [".", ",", "?", "!", "'"],
  ]
  private let symbolRows: [[String]] = [
    ["[", "]", "{", "}", "#", "%", "^", "*", "+", "="],
    ["_", "\\", "|", "~", "<", ">", "€", "£", "¥", "•"],
    [".", ",", "?", "!", "'"],
  ]

  override func viewDidLoad() {
    super.viewDidLoad()
    // Do NOT paint an opaque background on the extension view. Native iOS
    // keyboards leave the inputView transparent and let the theme's
    // backgroundEffect (a UIVisualEffectView blur) do all the frosting — that's
    // why native keys look like they're floating on frosted glass instead of
    // sitting on a solid slab. Any opaque paint here defeats the blur.
    view.backgroundColor = .clear
    writeKeyboardStatus()
    loadDictionary()
    buildKeyboard()
    loadAndApplyConfig()
  }

  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    writeKeyboardStatus()
    loadDictionary() // pick up edits made in the app
    // Reflect the Flow Session state each time the keyboard reappears — so after
    // the user arms in the app and swipes back, the button flips from "Start
    // Flow" to the live mic without needing another config fetch. No-op unless
    // kb.mic.mode="flow".
    refreshFlowButton()
  }

  /// System appearance flipped (Settings → dark mode toggle, or the user's
  /// automatic-appearance schedule). Route to the SDUI renderer so it picks
  /// the right theme palette + re-renders. No-op when the hand-built path
  /// is active.
  override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    if traitCollection.userInterfaceStyle != previousTraitCollection?.userInterfaceStyle {
      sduiRenderer?.appearanceDidChange()
    }
  }

  /// Publish the keyboard's live state to the shared App Group so the main app
  /// can detect that the keyboard is enabled and whether Full Access is granted
  /// (used to gate the onboarding "you're all set" step). Written every time the
  /// keyboard runs; the presence of a recent timestamp means it's enabled.
  private func writeKeyboardStatus() {
    let d = UserDefaults(suiteName: "group.com.tulmi.app")
    d?.set(hasFullAccess, forKey: "tulmi.kb.fullAccess")
    d?.set(Date().timeIntervalSince1970 * 1000, forKey: "tulmi.kb.lastActive")
    // Reflect to the SDUI renderer so visibleIf conditions gated on
    // state.hasFullAccess update on Full Access flips.
    sduiRenderer?.reflectHasFullAccess(hasFullAccess)
  }

  // MARK: - Text-expansion dictionary (trigger → replacement, from the app)

  /// trigger (lowercased) → replacement. Loaded from the shared App Group, which
  /// the app writes when the user edits their Dictionary on Home.
  private var expansions: [String: String] = [:]

  private func loadDictionary() {
    // Read + parse off the main thread so a large dictionary can't hitch
    // viewDidLoad / viewWillAppear (this ran synchronously on the hot path
    // before). `expansions` is only ever assigned on the main thread, so
    // expandLastWord() — which reads it on main — never races the parse.
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      guard let json = UserDefaults(suiteName: "group.com.tulmi.app")?.string(forKey: "tulmi.dictionary"),
            let data = json.data(using: .utf8),
            let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }
      var map: [String: String] = [:]
      for e in arr {
        if let w = e["word"] as? String, let r = e["replacement"] as? String, !w.isEmpty {
          map[w.lowercased()] = r
        }
      }
      DispatchQueue.main.async { self?.expansions = map }
    }
  }

  /// If the word right before the cursor is a trigger, replace it. Returns true
  /// when an expansion happened.
  private func expandLastWord() -> Bool {
    guard !expansions.isEmpty else { return false }
    let before = textDocumentProxy.documentContextBeforeInput ?? ""
    var word = ""
    for ch in before.reversed() {
      if ch == " " || ch == "\n" || ch == "\t" { break }
      word.insert(ch, at: word.startIndex)
    }
    guard !word.isEmpty, let repl = expansions[word.lowercased()] else { return false }
    for _ in 0..<word.count { textDocumentProxy.deleteBackward() }
    textDocumentProxy.insertText(repl)
    if hasFullAccess { selectionHaptic.selectionChanged() }
    return true
  }

  // MARK: - Server-driven config (theme/labels/flags), cached for offline

  private func loadAndApplyConfig() {
    if let data = UserDefaults.standard.data(forKey: "tulmi_kb_config") {
      if let cfg = TulmiBackend.parseConfig(data) { applyConfig(cfg) }
      applySDUIIfAvailable(data)
    }
    // [weak self]: this completion captures the controller across a network
    // round-trip. A strong capture pins the whole keyboard view tree alive for
    // the duration inside the extension's tight (~48–60 MB) memory budget.
    TulmiBackend.keyboardConfigData { [weak self] result in
      guard case .success(let data) = result else { return }
      UserDefaults.standard.set(data, forKey: "tulmi_kb_config")
      if let cfg = TulmiBackend.parseConfig(data) {
        DispatchQueue.main.async { self?.applyConfig(cfg) }
      }
      DispatchQueue.main.async { self?.applySDUIIfAvailable(data) }
    }
  }

  /// Try to decode the config as a full SDUI response and, if `features.sdui`
  /// is on AND `root` is present, hand off the whole keyboard view to the
  /// SDUIRenderer. Otherwise this is a no-op and the hand-built path remains
  /// on screen — that's the fallback contract.
  private func applySDUIIfAvailable(_ data: Data) {
    guard sduiRenderer == nil,
          let kb = SDUIRenderer.decodeConfig(data),
          kb.features?.sdui == true,
          let _ = kb.root
    else { return }
    // Tear down the hand-built subtree (rows, top bar, callouts). The renderer
    // will mount its own subtree spanning the whole keyboard view. IMPORTANT:
    // detach statusLabel from mainStack BEFORE removing subviews so we can
    // re-attach it as an overlay on top of the SDUI root — otherwise every
    // subsequent setStatus() writes to a detached label and every mic /
    // permission / recording error is invisible.
    statusLabel.removeFromSuperview()
    for sub in view.subviews { sub.removeFromSuperview() }
    mainStack = nil
    keyRowStacks.removeAll()
    letterButtons.removeAll()
    allKeys.removeAll()
    bottomKeys.removeAll()
    calloutLabel = nil
    let renderer = SDUIRenderer(controller: self, config: kb)
    sduiRenderer = renderer
    renderer.mount(into: view)
    // Re-attach statusLabel as a floating overlay pinned to the top of the
    // keyboard view. Sits above whatever SDUI has mounted so error/status
    // strings show up regardless of the tree shape.
    statusLabel.translatesAutoresizingMaskIntoConstraints = false
    statusLabel.backgroundColor = UIColor(white: 0, alpha: 0.75)
    statusLabel.textColor = .white
    statusLabel.textAlignment = .center
    statusLabel.font = .systemFont(ofSize: 12, weight: .medium)
    statusLabel.numberOfLines = 2
    statusLabel.layer.cornerRadius = 8
    statusLabel.layer.masksToBounds = true
    view.addSubview(statusLabel)
    NSLayoutConstraint.activate([
      statusLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
      statusLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12),
      statusLabel.topAnchor.constraint(equalTo: view.topAnchor, constant: 4),
      statusLabel.heightAnchor.constraint(greaterThanOrEqualToConstant: 24),
    ])
    // Kept invisible by default; setStatus() reveals it when text non-empty.
    statusLabel.isHidden = true
  }

  private func applyConfig(_ cfg: TulmiBackend.KbConfig) {
    kbConfig = cfg
    // Legacy path: also keep the extension view transparent so the OS-provided
    // keyboard region + backdrop show through. cfg.background is still applied
    // as the fallback color the blur/effect sits over (see SDUIRenderer),
    // but the ROOT view itself must stay clear or the blur has nothing to frost.
    view.backgroundColor = .clear
    for b in allKeys {
      b.backgroundColor = UIColor(tulmiHex: cfg.key)
      b.setTitleColor(UIColor(tulmiHex: cfg.keyText), for: .normal)
    }
    let accentColor = UIColor(tulmiHex: cfg.accent)                 // config-driven accent
    returnButton?.backgroundColor = accentColor
    // Contrast the "return" label against the accent (black on a white/light
    // accent, white on a dark one) so it's always legible.
    returnButton?.setTitleColor(accentColor.tulmiIsLight ? .black : .white, for: .normal)
    statusLabel.textColor = UIColor(tulmiHex: cfg.keyText)
    micButton?.isEnabled = cfg.voice
    micButton?.alpha = cfg.voice ? 1 : 0.4
    // Now that the mode + flow glyph/label flags are known, reflect the Flow
    // Session state on the mic button (Start Flow / mic / checkmark).
    refreshFlowButton()

    // Personality chip row — populated from the pinned presets on the
    // config. Backend passes them in the `flags` bag as
    // kb.personality.pinned (array of { id, name, emoji, tone }).
    populatePersonalityRow(from: cfg, accent: accentColor)
  }

  /// Read the pinned personalities from config flags and (re)render the row.
  /// Hides the row entirely when the user hasn't pinned anything so the
  /// keyboard's total height doesn't shift for casual users.
  private func populatePersonalityRow(from cfg: TulmiBackend.KbConfig, accent: UIColor) {
    let raw = cfg.flags["kb.personality.pinned"] as? [[String: Any]] ?? []
    if raw.isEmpty {
      personalityRow.isHidden = true
      return
    }
    let chips: [TulmiPersonalityRow.ChipData] = raw.compactMap { m in
      guard let id = m["id"] as? String, !id.isEmpty else { return nil }
      return TulmiPersonalityRow.ChipData(
        id: id,
        name: (m["name"] as? String) ?? id.capitalized,
        emoji: (m["emoji"] as? String) ?? "•",
        tone: (m["tone"] as? String) ?? "casual",
      )
    }
    if chips.isEmpty {
      personalityRow.isHidden = true
      return
    }
    let activeId = (cfg.flags["kb.personality.activeId"] as? String) ?? chips[0].id
    let chipBg = UIColor(tulmiHex: cfg.key).withAlphaComponent(0.7)
    let chipFg = UIColor(tulmiHex: cfg.keyText).withAlphaComponent(0.9)
    // Backend-driven fast-tone list for the long-press sheet. Accepts either the
    // rich shape (array of { id, label }) or a plain array of label strings
    // (legacy); nil → the row keeps its built-in fallback tones.
    let tones: [(id: String, label: String)]? = {
      if let rich = cfg.flags["kb.personality.tones"] as? [[String: Any]] {
        let mapped = rich.compactMap { m -> (id: String, label: String)? in
          guard let id = m["id"] as? String, !id.isEmpty else { return nil }
          return (id: id, label: (m["label"] as? String) ?? id.capitalized)
        }
        return mapped.isEmpty ? nil : mapped
      }
      return nil
    }()
    personalityRow.update(chips: chips, activeId: activeId,
                          accentColor: accent, chipBgColor: chipBg, chipFgColor: chipFg,
                          tones: tones)
    personalityRow.isHidden = false
  }

  /// Chip tapped (or a tone chosen in the long-press popover). Fires a
  /// backend save so the next refine call uses the new voice/tone; also
  /// updates our in-memory cfg so the row stays in sync without a full
  /// config refetch.
  private func applyPersonalityChange(presetId: String, tone: String?) {
    // Persist server-side (best-effort — never block the keyboard on a
    // network hop). Backend's PUT /v1/personality does a partial merge, so
    // sending just these two fields doesn't disturb the user's vocabulary.
    let body: [String: Any] = tone == nil
      ? ["activePresetId": presetId]
      : ["activePresetId": presetId, "activeTone": tone!]
    TulmiBackend.putPersonalityQuick(body: body) { _ in /* fire-and-forget */ }

    // Optimistically flip the row's active state so the UI feels instant.
    var flags = kbConfig?.flags ?? [:]
    flags["kb.personality.activeId"] = presetId
    if let tone = tone { flags["kb.personality.activeTone"] = tone }
    if let cfg = kbConfig {
      let next = TulmiBackend.KbConfig(
        background: cfg.background, key: cfg.key, keyText: cfg.keyText, accent: cfg.accent,
        voice: cfg.voice, refine: cfg.refine, liveVoice: cfg.liveVoice, labels: cfg.labels,
        flags: flags,
      )
      kbConfig = next
    }
  }

  private func label(_ key: String, _ fallback: String) -> String {
    kbConfig?.labels[key] ?? fallback
  }

  // MARK: - Layout

  private func buildKeyboard() {
    let stack = UIStackView()
    stack.axis = .vertical
    stack.alignment = .fill
    stack.distribution = .fill
    stack.spacing = 7
    stack.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(stack)
    mainStack = stack

    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 5),
      stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -5),
      stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 6),
      stack.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -8),
    ])

    // ── Top bar: menu · undo · (flex) · tone pill · mic ── (Wispr-style)
    let topBar = UIStackView()
    topBar.axis = .horizontal
    topBar.alignment = .center
    topBar.spacing = 10
    let menuBtn = makeGlyphButton(symbol: "line.3.horizontal")
    menuBtn.addTarget(self, action: #selector(menuTapped), for: .touchUpInside)
    undoButton = makeGlyphButton(symbol: "arrow.uturn.backward")
    undoButton.addTarget(self, action: #selector(undoTapped), for: .touchUpInside)
    let flex = UIView()
    flex.setContentHuggingPriority(.defaultLow, for: .horizontal)
    flex.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    tonePill = makeTonePill(title: currentTone)
    micButton = makeCircleButton(symbol: "mic.fill")
    micButton.addTarget(self, action: #selector(micTapped), for: .touchUpInside)
    [menuBtn, undoButton!, flex, tonePill, micButton!].forEach { topBar.addArrangedSubview($0) }
    topBar.heightAnchor.constraint(equalToConstant: 40).isActive = true
    stack.addArrangedSubview(topBar)

    // Personality quick-swap row — 6 chips of the user's pinned voices.
    // Hidden by default; the config-fetch reveals it when
    // kb.personality.pinned is populated. See TulmiPersonalityRow.swift.
    personalityRow.isHidden = true
    personalityRow.onSelect = { [weak self] presetId, tone in
      self?.applyPersonalityChange(presetId: presetId, tone: tone)
    }
    stack.addArrangedSubview(personalityRow)

    // Status label is kept in the layout stack — the mic button's own press
    // state + the flash-across-keys animation cover the "something is
    // happening" cases, but the label is the ONLY channel for permission
    // errors ("Enable Full Access", "Microphone denied") the user needs to
    // see to unblock themselves. Hidden by default; setStatus() shows it
    // only when text is non-empty.
    statusLabel.textColor = UIColor(white: 0.7, alpha: 1)
    statusLabel.font = .systemFont(ofSize: 12)
    statusLabel.textAlignment = .center
    statusLabel.numberOfLines = 2
    statusLabel.isHidden = true
    stack.addArrangedSubview(statusLabel)

    // Bottom row first (persistent), then insert the per-page key rows above it.
    buildBottomRow()
    rebuildKeyArea()
  }

  /// Build (or rebuild) the three key rows for the current page and insert them
  /// above the persistent bottom row. Called on launch and on every page switch.
  private func rebuildKeyArea() {
    for r in keyRowStacks { mainStack.removeArrangedSubview(r); r.removeFromSuperview() }
    keyRowStacks.removeAll()
    letterButtons.removeAll()
    var areaKeys: [UIButton] = []

    let content: [[String]]
    switch page {
    case .letters: content = rows
    case .numbers: content = numberRows
    case .symbols: content = symbolRows
    }

    // Rows 1 & 2.
    for i in 0..<2 {
      let rowStack = makeRowStack()
      for key in content[i] {
        let b = makeKeyButton(title: key)
        b.addTarget(self, action: #selector(letterTapped(_:)), for: .touchUpInside)
        if page == .letters { letterButtons.append(b) }
        areaKeys.append(b)
        rowStack.addArrangedSubview(b)
      }
      rowStack.heightAnchor.constraint(equalToConstant: 44).isActive = true
      keyRowStacks.append(rowStack)
    }

    // Row 3: [leading toggle / shift] · keys · [delete].
    let row3 = makeRowStack()
    let leading = makeRow3LeadingKey()
    row3.addArrangedSubview(leading)
    areaKeys.append(leading)
    for key in content[2] {
      let b = makeKeyButton(title: key)
      b.addTarget(self, action: #selector(letterTapped(_:)), for: .touchUpInside)
      if page == .letters { letterButtons.append(b) }
      areaKeys.append(b)
      row3.addArrangedSubview(b)
    }
    let del = makeKeyButton(title: "⌫")
    del.addTarget(self, action: #selector(deleteTouchDown), for: .touchDown)
    del.addTarget(self, action: #selector(deleteTouchUp), for: [.touchUpInside, .touchUpOutside, .touchCancel])
    row3.addArrangedSubview(del)
    areaKeys.append(del)
    leading.widthAnchor.constraint(equalTo: del.widthAnchor).isActive = true
    row3.heightAnchor.constraint(equalToConstant: 44).isActive = true
    keyRowStacks.append(row3)

    // Insert above the bottom row (which sits at index 2 after topBar + personalityRow).
    for (i, r) in keyRowStacks.enumerated() {
      mainStack.insertArrangedSubview(r, at: 2 + i)
    }

    allKeys = bottomKeys + areaKeys
    if let cfg = kbConfig { applyConfig(cfg) }
    updateShiftUI()
  }

  private func makeRow3LeadingKey() -> UIButton {
    switch page {
    case .letters:
      let b = makeKeyButton(title: shiftState == .locked ? "⇪" : "⇧")
      b.titleLabel?.font = .systemFont(ofSize: 20)
      b.addTarget(self, action: #selector(shiftTapped), for: .touchUpInside)
      shiftButton = b
      return b
    case .numbers:
      let b = makeKeyButton(title: "#+=")
      b.titleLabel?.font = .systemFont(ofSize: 15)
      b.addTarget(self, action: #selector(symbolToggleTapped), for: .touchUpInside)
      return b
    case .symbols:
      let b = makeKeyButton(title: "123")
      b.titleLabel?.font = .systemFont(ofSize: 15)
      b.addTarget(self, action: #selector(symbolToggleTapped), for: .touchUpInside)
      return b
    }
  }

  private func buildBottomRow() {
    let bottom = makeRowStack()
    let numBtn = makeKeyButton(title: "123")
    numBtn.titleLabel?.font = .systemFont(ofSize: 15)
    numBtn.addTarget(self, action: #selector(pageToggleTapped), for: .touchUpInside)
    pageToggleButton = numBtn
    let globeBtn = makeGlyphButton(symbol: "globe")
    globeBtn.tintColor = UIColor(white: 0.85, alpha: 1)
    globeBtn.addTarget(self, action: #selector(handleInputModeList(from:with:)), for: .allTouchEvents)
    nextKeyboardButton = globeBtn
    let space = makeKeyButton(title: "Tailzu")
    space.titleLabel?.font = .systemFont(ofSize: 14)
    space.setTitleColor(UIColor(white: 0.55, alpha: 1), for: .normal)
    space.addTarget(self, action: #selector(spaceTapped), for: .touchUpInside)
    let ret = makeKeyButton(title: "return")
    ret.backgroundColor = .white            // white "button" (overridden by cfg.accent)
    ret.setTitleColor(.black, for: .normal) // dark text for contrast on white/light accents
    ret.addTarget(self, action: #selector(returnTapped), for: .touchUpInside)
    returnButton = ret
    [numBtn, globeBtn, space, ret].forEach { bottom.addArrangedSubview($0) }
    space.widthAnchor.constraint(equalTo: numBtn.widthAnchor, multiplier: 3.4).isActive = true
    ret.widthAnchor.constraint(equalTo: numBtn.widthAnchor, multiplier: 1.5).isActive = true
    bottom.heightAnchor.constraint(equalToConstant: 44).isActive = true
    mainStack.addArrangedSubview(bottom)
    bottomKeys = [numBtn, space, ret]   // globe is a glyph button, not themed as a key
  }

  private func makeRowStack() -> UIStackView {
    let s = UIStackView()
    s.axis = .horizontal
    s.alignment = .fill
    s.distribution = .fillProportionally
    s.spacing = 5
    return s
  }

  // ── Wispr-style control makers ──
  private func makeGlyphButton(symbol: String) -> UIButton {
    let b = UIButton(type: .system)
    b.setImage(UIImage(systemName: symbol), for: .normal)
    b.tintColor = UIColor(white: 0.92, alpha: 1)
    b.translatesAutoresizingMaskIntoConstraints = false
    b.widthAnchor.constraint(equalToConstant: 38).isActive = true
    return b
  }

  /// The mic-button image. Backend can push a custom asset (static image OR
  /// animated GIF/APNG) via the `kb.mic.idleIcon.url` config flag; when set,
  /// we return that (animated frames included). Falls back to the bundled
  /// TailzuMark, then the SF `mic.fill` symbol.
  private func brandMarkImage() -> UIImage {
    if let url = kbConfig?.flags["kb.mic.idleIcon.url"] as? String,
       !url.isEmpty {
      if let img = TulmiImageLoader.cached(url, onLoad: { [weak self] in
        // Re-apply the image on the button once the async fetch completes,
        // and kick UIKit into playing the animation loop.
        guard let self = self else { return }
        DispatchQueue.main.async {
          if let ready = TulmiImageLoader.cached(url) {
            self.micButton.setImage(ready, for: .normal)
            self.micButton.imageView?.startAnimating()
          }
        }
      }) {
        // If the image is animated, UIKit picks that up from
        // `UIImage.animatedImage(with:duration:)` and the imageView loops it
        // once startAnimating() fires (kicked below whenever we set it).
        return img
      }
    }
    if let mark = UIImage(named: "TailzuMark") {
      return mark.withRenderingMode(.alwaysOriginal)
    }
    return UIImage(systemName: "mic.fill") ?? UIImage()
  }

  private func makeCircleButton(symbol: String) -> UIButton {
    let b = UIButton(type: .system)
    // Idle state shows the Tailzu soundwave mark on the white rounded toggle.
    // The active (recording/streaming) state swaps to `stop.fill`.
    b.setImage(brandMarkImage(), for: .normal)
    b.tintColor = .black
    b.backgroundColor = .white
    b.layer.cornerRadius = 19
    b.clipsToBounds = true
    b.imageView?.contentMode = .scaleAspectFit
    b.contentEdgeInsets = UIEdgeInsets(top: 8, left: 5, bottom: 8, right: 5)
    b.translatesAutoresizingMaskIntoConstraints = false
    b.widthAnchor.constraint(equalToConstant: 38).isActive = true
    b.heightAnchor.constraint(equalToConstant: 38).isActive = true
    return b
  }

  private func makeTonePill(title: String) -> UIButton {
    let b = UIButton(type: .system)
    b.setTitle(title, for: .normal)
    b.setTitleColor(.black, for: .normal)
    b.titleLabel?.font = .boldSystemFont(ofSize: 15)
    b.backgroundColor = .white
    b.layer.cornerRadius = 18
    b.contentEdgeInsets = UIEdgeInsets(top: 0, left: 16, bottom: 0, right: 16)
    b.translatesAutoresizingMaskIntoConstraints = false
    b.heightAnchor.constraint(equalToConstant: 36).isActive = true
    b.menu = toneMenu()
    b.showsMenuAsPrimaryAction = true
    return b
  }

  private func toneMenu() -> UIMenu {
    UIMenu(title: "", children: tones.map { t in
      UIAction(title: t, state: t == currentTone ? .on : .off) { [weak self] _ in self?.selectTone(t) }
    })
  }

  private func selectTone(_ tone: String) {
    currentTone = tone
    tonePill.setTitle(tone, for: .normal)
    tonePill.menu = toneMenu()
  }

  @objc private func menuTapped() { /* options menu — wired later */ }

  @objc private func undoTapped() {
    // Priority 1: if we tracked the last insert (voice-clean, streaming final,
    // or refine), delete exactly that many chars and optionally re-insert the
    // pre-refine raw so undo reads as "revert refine".
    if let last = lastInserted, !last.isEmpty {
      let proxy = textDocumentProxy
      for _ in 0..<last.count { proxy.deleteBackward() }
      if let raw = lastRawTranscript, !raw.isEmpty { proxy.insertText(raw) }
      lastInserted = nil
      lastRawTranscript = nil
      if hasFullAccess { selectionHaptic.selectionChanged() }
      flashUndoCheckmark()
      return
    }
    // Fallback: last-word delete (original behavior — useful for keys typed by
    // hand, which aren't tracked as a single insert).
    let before = textDocumentProxy.documentContextBeforeInput ?? ""
    if before.isEmpty { return }
    var count = 0
    var started = false
    for ch in before.reversed() {
      if ch == " " || ch == "\n" { if started { break } } else { started = true }
      count += 1
    }
    for _ in 0..<max(count, 1) { textDocumentProxy.deleteBackward() }
    if hasFullAccess { selectionHaptic.selectionChanged() }
    flashUndoCheckmark()
  }

  /// Briefly swap the undo glyph for a checkmark so the user sees the action
  /// landed. Matches the native "confirmed" affordance without any new colors.
  private func flashUndoCheckmark() {
    guard let btn = undoButton else { return }
    let original = UIImage(systemName: "arrow.uturn.backward")
    btn.setImage(UIImage(systemName: "checkmark"), for: .normal)
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak btn] in
      btn?.setImage(original, for: .normal)
    }
  }

  private func makeKeyButton(title: String) -> UIButton {
    let b = UIButton(type: .system)
    b.setTitle(title, for: .normal)
    b.setTitleColor(.white, for: .normal)
    b.titleLabel?.font = .systemFont(ofSize: 18)
    b.backgroundColor = UIColor(red: 0.11, green: 0.11, blue: 0.15, alpha: 1) // #1c1c25
    b.layer.cornerRadius = 5 // native iPhone key radius (confirmed)
    b.translatesAutoresizingMaskIntoConstraints = false
    // Native-feel press feedback: highlight + haptic on down, restore on up.
    b.addTarget(self, action: #selector(keyTouchDown(_:)), for: .touchDown)
    b.addTarget(self, action: #selector(keyTouchUp(_:)), for: [.touchUpInside, .touchUpOutside, .touchCancel, .touchDragExit])
    b.addTarget(self, action: #selector(keyTouchEnter(_:)), for: .touchDragEnter)
    return b
  }

  // MARK: - Press feedback (highlight + haptic + key-pop callout)

  @objc private func keyTouchDown(_ sender: UIButton) {
    if hasFullAccess {
      selectionHaptic.selectionChanged()
      selectionHaptic.prepare() // keep the Taptic engine warm for the next tap
    }
    pressDown(sender)
    if letterButtons.contains(sender) { showCallout(for: sender) }
  }

  @objc private func keyTouchUp(_ sender: UIButton) {
    pressUp(sender)
    hideCallout()
  }

  @objc private func keyTouchEnter(_ sender: UIButton) {
    pressDown(sender)
    if letterButtons.contains(sender) { showCallout(for: sender) }
  }

  private func pressDown(_ b: UIButton) {
    if pressRestore[b] == nil { pressRestore[b] = b.backgroundColor }
    b.backgroundColor = pressedColor(b.backgroundColor ?? .gray)
  }

  private func pressUp(_ b: UIButton) {
    if let c = pressRestore[b] { b.backgroundColor = c; pressRestore[b] = nil }
  }

  /// Lighten dark keys (and slightly darken light keys) on press — the native
  /// "key reversal" feel without animating a scale transform.
  private func pressedColor(_ base: UIColor) -> UIColor {
    var r: CGFloat = 0, g: CGFloat = 0, bl: CGFloat = 0, a: CGFloat = 0
    base.getRed(&r, green: &g, blue: &bl, alpha: &a)
    let lum = 0.299 * r + 0.587 * g + 0.114 * bl
    let f: CGFloat = lum < 0.5 ? 0.18 : -0.12
    func adj(_ c: CGFloat) -> CGFloat { min(1, max(0, c + f)) }
    return UIColor(red: adj(r), green: adj(g), blue: adj(bl), alpha: a)
  }

  private func makeCallout() -> UILabel {
    let l = UILabel()
    l.textAlignment = .center
    l.font = .systemFont(ofSize: 30, weight: .light)
    l.textColor = .white
    l.backgroundColor = UIColor(red: 0.22, green: 0.22, blue: 0.28, alpha: 1)
    l.layer.cornerRadius = 10
    l.layer.masksToBounds = true
    l.isUserInteractionEnabled = false
    calloutLabel = l
    return l
  }

  /// Show the key-pop balloon above a pressed letter key (phone, letters page).
  private func showCallout(for key: UIButton) {
    guard page == .letters, let title = key.title(for: .normal), title.count == 1 else { return }
    let l = calloutLabel ?? makeCallout()
    l.text = title
    let f = key.convert(key.bounds, to: view)
    let w = max(f.width + 18, 42)
    let h: CGFloat = 50
    var x = f.midX - w / 2
    x = max(2, min(x, view.bounds.width - w - 2))
    let y = max(0, f.minY - h - 4)
    l.frame = CGRect(x: x, y: y, width: w, height: h)
    if l.superview == nil { view.addSubview(l) }
    view.bringSubviewToFront(l)
    l.isHidden = false
  }

  private func hideCallout() { calloutLabel?.isHidden = true }

  // MARK: - Key actions

  @objc private func letterTapped(_ sender: UIButton) {
    guard let t = sender.title(for: .normal) else { return }
    let out = (page == .letters && shiftState != .off) ? t.uppercased() : t
    textDocumentProxy.insertText(out)
    if page == .letters && shiftState == .oneShot {
      shiftState = .off
      updateShiftUI()
    }
  }

  @objc private func shiftTapped() {
    let now = Date().timeIntervalSince1970
    if (now - lastShiftTapTime) < 0.3 {
      shiftState = .locked            // double-tap → caps lock
    } else {
      shiftState = (shiftState == .off) ? .oneShot : .off
    }
    lastShiftTapTime = now
    updateShiftUI()
  }

  private func updateShiftUI() {
    let upper = shiftState != .off
    for b in letterButtons {
      let t = b.title(for: .normal) ?? ""
      b.setTitle(upper ? t.uppercased() : t.lowercased(), for: .normal)
    }
    shiftButton?.setTitle(shiftState == .locked ? "⇪" : "⇧", for: .normal)
  }

  @objc private func pageToggleTapped() {
    page = (page == .letters) ? .numbers : .letters
    rebuildKeyArea()
    pageToggleButton?.setTitle(page == .letters ? "123" : "ABC", for: .normal)
  }

  @objc private func symbolToggleTapped() {
    page = (page == .numbers) ? .symbols : .numbers
    rebuildKeyArea()
  }

  @objc private func spaceTapped() {
    let now = Date().timeIntervalSince1970
    // Text-expansion: if the just-typed word is a dictionary trigger, swap it
    // for its replacement before inserting the space.
    if expandLastWord() {
      textDocumentProxy.insertText(" ")
      lastSpaceTime = now
      return
    }
    let before = textDocumentProxy.documentContextBeforeInput ?? ""
    // Double-space → ". " (when the char before the trailing space is a letter/number).
    if (now - lastSpaceTime) < 0.6, before.hasSuffix(" "), before.count >= 2 {
      let idx = before.index(before.endIndex, offsetBy: -2)
      let prev = before[idx]
      if prev.isLetter || prev.isNumber {
        textDocumentProxy.deleteBackward()
        textDocumentProxy.insertText(". ")
        lastSpaceTime = 0
        return
      }
    }
    textDocumentProxy.insertText(" ")
    lastSpaceTime = now
  }

  @objc private func deleteTouchDown() {
    textDocumentProxy.deleteBackward()
    deleteTimer?.invalidate()
    // Native: 0.5s initial delay, then repeat every 0.1s.
    // .common runloop mode so the timer keeps firing while the finger is
    // held (tracking mode); scheduledTimer defaults to .default which
    // pauses during tracking and gives the "delete only fires after
    // release" bug.
    let t = Timer(timeInterval: 0.5, repeats: false) { [weak self] _ in
      self?.startDeleteRepeat()
    }
    RunLoop.main.add(t, forMode: .common)
    deleteTimer = t
  }

  private func startDeleteRepeat() {
    let t = Timer(timeInterval: 0.1, repeats: true) { [weak self] _ in
      self?.textDocumentProxy.deleteBackward()
    }
    RunLoop.main.add(t, forMode: .common)
    deleteTimer = t
  }

  @objc private func deleteTouchUp() {
    deleteTimer?.invalidate()
    deleteTimer = nil
  }

  @objc private func returnTapped() { textDocumentProxy.insertText("\n") }

  // MARK: - Auto-capitalization

  /// Re-evaluate shift after the document text changes (sentence start → cap).
  override func textDidChange(_ textInput: UITextInput?) {
    // Refresh the SDUI renderer's field-context cache first — this fires when
    // the user switches focus between fields too, so it's the right hook for
    // "return key label changed from Go → Send". Cheap (no-op if unchanged).
    sduiRenderer?.reflectFieldContext()
    if isStreaming || isRecording { return }
    if shiftState == .locked { return } // caps-lock overrides auto-cap
    let before = textDocumentProxy.documentContextBeforeInput ?? ""
    let shouldCap = shouldAutoCapitalize(before)
    let newState: ShiftState = shouldCap ? .oneShot : .off
    if newState != shiftState {
      shiftState = newState
      updateShiftUI()
    }
  }

  private func shouldAutoCapitalize(_ before: String) -> Bool {
    if before.isEmpty { return true }
    if before.hasSuffix("\n") { return true }
    // Trailing space(s) preceded by sentence-ending punctuation → new sentence.
    let stripped = String(before.reversed().drop(while: { $0 == " " }).reversed())
    if stripped.count < before.count, let last = stripped.last, ".!?".contains(last) {
      return true
    }
    return false
  }

  // MARK: - Mic / dictation

  @objc private func micTapped() {
    // iOS blocks the microphone inside a keyboard extension, so the ONLY
    // reliable path is Flow (the background-audio session held by the main
    // app). An ABSENT or UNKNOWN kb.mic.mode must therefore resolve to "flow";
    // the in-extension record paths run ONLY when the backend EXPLICITLY opts
    // into them:
    //   kb.mic.mode = "stream"   → live WebSocket dictation
    //   kb.mic.mode = "local"    → batch record → upload → refine
    //   kb.mic.mode = "handoff"  → hand the mic to the main app for one capture
    let mode = (kbConfig?.flags["kb.mic.mode"] as? String)?.lowercased() ?? "flow"
    switch mode {
    case "handoff":
      if isHandoffActive { cancelHandoff() } else { beginMicHandoff() }
    case "stream":
      if isStreaming { stopStreaming() } else { startStreaming() }
    case "local":
      // Explicit opt-in to in-keyboard batch recording.
      if isRecording { stopAndTranscribe() } else { startRecording() }
    default:
      // "flow" — and any ABSENT/UNKNOWN mode — the Wispr model, the only
      // reliable iOS mic. If the app already holds a live session, toggle
      // dictation right here in the keyboard. If not, open the app once to arm
      // it (the user swipes back and dictations run without leaving the keyboard).
      if flow.isSessionActive {
        if flowRecording { stopFlowDictation() } else { startFlowDictation() }
      } else {
        openAppToArmFlow()
      }
    }
  }

  // MARK: - Flow Session (background-audio mic)

  private func flowGlyph(_ key: String, _ fallback: String) -> String {
    (kbConfig?.flags[key] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? fallback
  }

  /// Whether dictated words paint the field LIVE as you speak (true) or only
  /// arrive as one committed block AFTER you stop (false). This is the "button
  /// logic" the backend tunes without a rebuild — `kb.mic.liveText`. Governs the
  /// Flow path and the in-keyboard stream path alike. Default true preserves the
  /// live-typing feel when the flag is absent; the backend sets the desired
  /// value. (Note: with a batch provider like Groq there are no interim partials
  /// to begin with, so text arrives after stop regardless of this flag; the flag
  /// is what lets a streaming provider like Deepgram ALSO defer to after-stop.)
  private var micLiveText: Bool {
    (kbConfig?.flags["kb.mic.liveText"] as? Bool) ?? true
  }

  /// Reflect the Flow Session state on the mic button + status — Wispr's exact
  /// model, all three states backend-tunable:
  ///   • no live session → a "Start Flow" affordance (distinct glyph + hint).
  ///     The first tap opens the app once to arm the background mic.
  ///   • session armed, idle → the mic. Tap to talk.
  ///   • recording → a checkmark. Tap to finish (Wispr taps ✓ to end an utterance).
  /// Called on appear, after the backend config loads, and on every transition.
  private func refreshFlowButton() {
    guard (kbConfig?.flags["kb.mic.mode"] as? String)?.lowercased() == "flow" else { return }
    if flowRecording {
      micButton.imageView?.stopAnimating()
      micButton.setImage(UIImage(systemName: flowGlyph("kb.flow.stopGlyph", "checkmark")), for: .normal)
      micButton.tintColor = .black
      return
    }
    if flow.isSessionActive {
      // Armed & idle — the mic. Tap to talk. Clear any lingering Flow hint.
      micButton.setImage(brandMarkImage(), for: .normal)
      micButton.imageView?.startAnimating()
      let hint = label("flow_start_hint", "Tap to start Flow")
      let arming = label("flow_arming", "Turning on Flow — swipe back when you land in Tailzu.")
      if statusLabel.text == hint || statusLabel.text == arming { setStatus("") }
    } else {
      // No session — this is "Start Flow", not a dictation mic. A distinct glyph
      // + a persistent hint make it obvious the first tap opens the app to arm.
      // (Backend can blank kb.flow.startGlyph→mic or flow_start_hint→"" to hide.)
      micButton.imageView?.stopAnimating()
      micButton.setImage(UIImage(systemName: flowGlyph("kb.flow.startGlyph", "bolt.fill")), for: .normal)
      micButton.tintColor = .black
      setStatus(label("flow_start_hint", "Tap to start Flow"), actionable: true)
    }
  }

  private func startFlowDictation() {
    pendingPartial = ""
    flowRecording = true
    flowDictationToken &+= 1
    let token = flowDictationToken
    // Morph to the "finish" affordance (checkmark) — Wispr's tap-✓-to-end.
    micButton.imageView?.stopAnimating()
    micButton.setImage(UIImage(systemName: flowGlyph("kb.flow.stopGlyph", "checkmark")), for: .normal)
    micButton.tintColor = .black
    setStatus("")                          // clear the "Tap to start Flow" hint
    sduiRenderer?.reflectDictating(true)   // particles burst — recording
    flow.startDictation()                  // nudge the app to begin capturing
    // Dead-app watchdog. isSessionActive gates on a ~4s-fresh heartbeat, but if
    // the app was force-quit only a second or two before this tap, its last
    // heartbeat can still look fresh — so the tap slips past and we're now
    // "recording" into a dead app that captures nothing. The heartbeat stops the
    // instant the process dies, so it's stale within ~1-2s; re-check just after
    // that window and, if the session is no longer live, bail the animation and
    // re-arm. (Independent of transcripts, so it works with kb.mic.liveText off,
    // where no partials arrive during recording.)
    DispatchQueue.main.asyncAfter(deadline: .now() + 2.4) { [weak self] in
      guard let self = self, self.flowRecording, token == self.flowDictationToken else { return }
      if !self.flow.isSessionActive { self.abandonDeadFlowDictation() }
    }
  }

  /// The Flow Session turned out to be dead (app force-quit) while we were
  /// "recording". Stop the animation and re-open the app to arm a fresh session
  /// so the user isn't stuck talking to a mic that captures nothing.
  private func abandonDeadFlowDictation() {
    flowRecording = false
    pendingPartial = ""
    flowDictationToken &+= 1                // invalidate any in-flight watchdog
    sduiRenderer?.reflectDictating(false)
    flow.markSessionDead()
    micButton.imageView?.stopAnimating()
    micButton.setImage(UIImage(systemName: flowGlyph("kb.flow.startGlyph", "bolt.fill")), for: .normal)
    micButton.tintColor = .black
    NSLog("[Tailzu][kb] flow: session was dead (app force-quit) — re-arming.")
    openAppToArmFlow()
  }

  private func stopFlowDictation() {
    flowRecording = false
    flow.stopDictation()                   // app finalizes; final lands via onTranscript
    // Back to the armed-idle mic — the session stays live for the next utterance
    // (no app trip). The final transcript still commits via onTranscript.
    micButton.setImage(brandMarkImage(), for: .normal)
    micButton.imageView?.startAnimating()
    sduiRenderer?.reflectDictating(false)
  }

  /// Open the app once to arm a Flow Session. The keyboard can't call openURL,
  /// so we drop a deep-link tombstone the app consumes on foreground (routes to
  /// the SDUI "flow_arm" screen, which calls armFlowSession) AND try the
  /// responder-chain open for an instant hop.
  private func openAppToArmFlow() {
    let d = UserDefaults(suiteName: "group.com.tulmi.app")
    d?.set("screen/flow_arm", forKey: "tulmi.kb.pendingDeepLink")
    d?.set(Date().timeIntervalSince1970 * 1000, forKey: "tulmi.kb.pendingDeepLinkAt")
    // Try to open the app. The tombstone above is the reliable half — opening
    // Tailzu (auto OR by hand) consumes it and arms Flow — so the message covers
    // the case where iOS refuses the auto-open, instead of promising a swipe-back
    // that never happens.
    let opened = URL(string: "tulmi://s/flow_arm").map { openURLViaResponderChain($0) } ?? false
    setStatus(opened
      ? label("flow_arming", "Turning on Flow — swipe back into your app.")
      : label("flow_arm_manual", "Open Tailzu once to turn on Flow, then come back."),
      actionable: true)
  }

  private func beginMicHandoff() {
    guard hasFullAccess else {
      setStatus(label("full_access_required", "Enable “Allow Full Access” in Settings to use voice."), actionable: true)
      return
    }
    let hostBundle = parentBundleIdentifier() ?? ""
    isHandoffActive = true
    micButton.setImage(UIImage(systemName: "stop.fill"), for: .normal)
    setStatus(handoff.isAppWarm
              ? label("mic_handoff_warm", "🎙️ Speak in Tulmi — swipe back when done")
              : label("mic_handoff_cold", "Opening Tulmi… grant mic once, then swipe back"))
    _ = handoff.beginHandoff(hostApp: hostBundle) { [weak self] url in
      return self?.openURLViaResponderChain(url) ?? false
    }
  }

  private func cancelHandoff() {
    handoff.cancelPending()
    isHandoffActive = false
    micButton.setImage(brandMarkImage(), for: .normal); micButton.imageView?.startAnimating()
    setStatus("")
  }

  /// Best-effort "open a URL from a keyboard extension." Apple doesn't provide
  /// a first-class API, so we walk the responder chain for something that can
  /// open a URL. The OLD version cast each responder `as? UIApplication` — but
  /// that class almost never appears in a keyboard extension's responder chain,
  /// so it returned false and the app didn't open (the "works sometimes" bug).
  /// Match by CAPABILITY instead: any responder that RESPONDS to `openURL:`
  /// (UIApplication does) — the trick shipping keyboards (Gboard, Grammarly)
  /// actually use, and it hits far more often. Still best-effort: iOS can refuse
  /// it, which is why we ALWAYS leave the App-Group tombstone so the user
  /// opening the app by hand still arms Flow.
  @discardableResult
  private func openURLViaResponderChain(_ url: URL) -> Bool {
    let sel = NSSelectorFromString("openURL:")
    var responder: UIResponder? = self
    while let r = responder {
      if r.responds(to: sel) {
        // Honor the ACTUAL result instead of returning true just because a
        // responder RESPONDS to openURL: (the old over-claim — "works
        // sometimes"). openURL: returns BOOL, which surfaces through perform as
        // a non-nil unmanaged result for YES and nil for NO; read it that way
        // rather than dereferencing the raw BOOL as an object (which can crash).
        let result = r.perform(sel, with: url)
        return result != nil
      }
      responder = r.next
    }
    return false
  }

  /// The bundle identifier of the host app (the app the keyboard is inside).
  /// Best-effort — some fields are only readable in specific iOS versions.
  private func parentBundleIdentifier() -> String? {
    // NSExtensionContext exposes hostAppBundleID on some iOS versions only.
    // Fall back to the process name so we always send SOMETHING.
    return Bundle.main.object(forInfoDictionaryKey: "NSExtensionHostBundleID") as? String
      ?? ProcessInfo.processInfo.processName
  }

  // MARK: - Live (streaming) dictation

  private func startStreaming() {
    // Re-entry guard: ignore a second start while one is already in flight or
    // running. requestRecordPermission is async, so without this a double-tap
    // spawns a second TulmiStream that orphans the first's engine/tap/socket.
    guard !isStreaming, !isStartingStream else { return }
    // Full Access is required for network AND mic in a keyboard extension.
    // Without it, requestRecordPermission returns false with no explanation,
    // so we check first and route the user to Settings with a clear message.
    guard self.hasFullAccess else {
      setStatus(label("full_access_required", "Enable “Allow Full Access” in Settings to use voice."), actionable: true)
      return
    }
    isStartingStream = true
    AVAudioSession.sharedInstance().requestRecordPermission { [weak self] granted in
      DispatchQueue.main.async {
        guard let self = self else { return }
        self.isStartingStream = false
        guard granted else {
          self.setStatus(self.label("mic_denied", "Microphone denied. Open Tulmi settings to allow it."), actionable: true)
          return
        }
        self.beginStreaming()
      }
    }
  }

  private func beginStreaming() {
    pendingPartial = ""
    dictatedSomething = false
    isStreaming = true
    micButton.setImage(UIImage(systemName: "stop.fill"), for: .normal)
    setStatus("")  // transient — mic button animation is the visible cue
    sduiRenderer?.reflectDictating(true)
    let s = TulmiStream { [weak self] event in
      DispatchQueue.main.async { self?.handleStreamEvent(event) }
    }
    stream = s
    // Backend flags: kb.dictation.targetApp (default "Generic"), kb.dictation.language (default "auto")
    let targetApp = (kbConfig?.flags["kb.dictation.targetApp"] as? String) ?? "Generic"
    // Flag override takes precedence (lets backend force a specific language
    // for debugging / A/B tests); otherwise use the user's chosen language
    // from the shared App Group. Empty falls through to "auto" so the STT
    // provider does language detection + code-switch handling on its own.
    let lang = (kbConfig?.flags["kb.dictation.language"] as? String) ?? TulmiBackend.language
    s.start(targetApp: targetApp, language: lang)
  }

  private func handleStreamEvent(_ event: TulmiStream.Event) {
    switch event {
    case .ready:
      setStatus("")  // transient — mic button animation is the visible cue
    case .partial(let text):
      // Same backend-tuned rule as Flow: only paint interim words live when
      // kb.mic.liveText is on; otherwise wait for the final (after-stop).
      if micLiveText { replacePartial(with: text) }
    case .finalText(let text):
      commitFinal(text)
    case .error(let msg):
      // A 401/unauthorized means the shared token expired. Batch would fail the
      // same way, so DON'T silently fall back to it — tell the user to reopen
      // the app once, which re-shares a fresh token on foreground.
      let lower = msg.lowercased()
      if lower.contains("unauthorized") || lower.contains("invalid or missing token") {
        endStreaming()
        setStatus(label("auth_expired", "Open Tailzu once to sign in again"), actionable: true)
        return
      }
      // The WebSocket dropped BEFORE we committed a word. The OLD behavior fell
      // back to in-extension batch recording — but iOS blocks the microphone
      // inside a keyboard extension, so that recorder captures nothing. Rather
      // than a dead silent fallback, end cleanly and point the user at the main
      // app (which CAN hold the mic). Once a partial has landed we instead keep
      // that text and surface the generic error below.
      if !dictatedSomething && pendingPartial.isEmpty {
        endStreaming()
        setStatus(label("stream_lost_open_app", "Open Tailzu once to use voice, then try again."), actionable: true)
        return
      }
      setStatus(label("voice_not_listening", "444 : Not Listening"))
      endStreaming()
    case .closed:
      // A partial may still be sitting in the field that never got its
      // finalizing "final" (socket closed right after the last partial). It's
      // real dictated text already at the cursor — treat it as committed so the
      // tail isn't dropped and refine still runs over it.
      if !pendingPartial.isEmpty {
        dictatedSomething = true
        pendingPartial = ""
      }
      endStreaming()
      if dictatedSomething && (kbConfig?.refine ?? true) { refineTapped() }
      dictatedSomething = false
    }
  }

  private func replacePartial(with text: String) {
    let proxy = textDocumentProxy
    for _ in 0..<pendingPartial.count { proxy.deleteBackward() }
    proxy.insertText(text)
    pendingPartial = text
  }

  // Conversational refusal/clarification the STT/refine can emit on silence
  // ("I didn't catch that", "say that again", "no speech detected"). The server
  // now filters these, but this is the last line of defense: such a string must
  // NEVER land on the typepad. Precise + length-bounded so a real short
  // dictation is never dropped. Mirrors the backend looksLikeMeta guard.
  private static let fillerPatterns: [NSRegularExpression] = {
    let pats = [
      "\\bi (didn'?t|couldn'?t|can'?t|could not|did not) (catch|hear|understand|make out) (that|it|you|anything)\\b",
      "\\bi (don'?t|didn'?t) get anything\\b",
      "\\b(could|can) you (say (that|it) again|repeat that)\\b",
      "\\bsay (that|it) again\\b",
      "\\b(please )?repeat that\\b",
      "\\bno (speech|audio|input|sound) (was )?(detected|found|received|captured)\\b",
      "\\bnothing (was said|to transcribe|was detected|was captured)\\b",
    ]
    return pats.compactMap { try? NSRegularExpression(pattern: $0, options: .caseInsensitive) }
  }()

  private func looksLikeFiller(_ text: String) -> Bool {
    let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !t.isEmpty, t.count <= 140 else { return false }
    let r = NSRange(t.startIndex..., in: t)
    return Self.fillerPatterns.contains { $0.firstMatch(in: t, options: [], range: r) != nil }
  }

  /// Remove whatever provisional partial is currently showing at the cursor.
  private func clearPendingPartial() {
    guard !pendingPartial.isEmpty else { return }
    let proxy = textDocumentProxy
    for _ in 0..<pendingPartial.count { proxy.deleteBackward() }
    pendingPartial = ""
  }

  private func commitFinal(_ text: String) {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    // Empty final = the utterance finalized to nothing (silence/noise). Never
    // insert a bare space; and clear any provisional partial so noise can't get
    // stranded at the cursor. (The server now sends an empty final for exactly
    // this — a sanitized-to-nothing segment.)
    guard !trimmed.isEmpty else { clearPendingPartial(); return }
    // Never commit a conversational refusal to the typepad — drop it and wipe
    // the provisional partial it was replacing.
    guard !looksLikeFiller(trimmed) else { clearPendingPartial(); return }
    let proxy = textDocumentProxy
    for _ in 0..<pendingPartial.count { proxy.deleteBackward() }
    let inserted = text.hasSuffix(" ") ? text : text + " "
    proxy.insertText(inserted)
    flashKeysForText(inserted)
    pendingPartial = ""
    dictatedSomething = true
    // Track for the top-bar UNDO. Multiple finals in one session collapse to
    // "undo the most recent final" — matches user expectation of "take back
    // what just appeared".
    lastInserted = inserted
    lastRawTranscript = nil
  }

  private func stopStreaming() {
    // Don't tear down yet. finish() stops the mic and asks the server to flush
    // the speech engine's final tail + send "done" — we keep the socket AND the
    // stream reference alive so those tail segments still land at the cursor.
    // Teardown happens when .closed arrives (handleStreamEvent) or finish()'s
    // watchdog fires. Tearing down here (the old behaviour) cancelled the socket
    // before the tail arrived → truncated endings.
    guard let s = stream else { endStreaming(); return }
    setStatus(label("transcribing", "Finishing…"))
    s.finish()
  }

  private func endStreaming() {
    isStreaming = false
    // Stop mic capture + audio session on EVERY teardown path. The .error and
    // .closed events land here WITHOUT going through finish()/cancel(), so
    // without this the AVAudioEngine tap and audio session stay live (mic hot,
    // other-app audio not restored) until nondeterministic dealloc — and it can
    // race the local-record fallback that re-activates the session. cancel() is
    // idempotent, so calling it after a graceful finish() (stopStreaming) is safe.
    stream?.cancel()
    stream = nil
    micButton.setImage(brandMarkImage(), for: .normal); micButton.imageView?.startAnimating()
    if statusLabel.text == label("transcribing", "Finishing…") { setStatus("") }
    sduiRenderer?.reflectDictating(false)
  }

  private func startRecording() {
    // Synchronous re-entry guard (mirrors isStartingStream): a fast double-tap
    // would otherwise clear the async requestRecordPermission twice and spawn a
    // second AVAudioRecorder that orphans the first's mic/engine. Bail if a
    // start is already in flight or a recording is live.
    guard !isRecording, !isStartingRecording else { return }
    // Every early-return path below must call bailDictating() so the SDUI
    // mic button flips back to idle and the next tap can start again.
    // Without this, state.dictating stays true after a bail and the second
    // tap dispatches stopDictation into a no-op branch (isRecording=false)
    // — that's exactly the symptom the user reported: "line-on-orange shows
    // but nothing lands in the field and no POST hits the backend."
    guard self.hasFullAccess else {
      setStatus(label("full_access_required", "Enable “Allow Full Access” in Settings to use voice."), actionable: true)
      bailDictating()
      return
    }
    isStartingRecording = true
    let session = AVAudioSession.sharedInstance()
    session.requestRecordPermission { [weak self] granted in
      DispatchQueue.main.async {
        guard let self = self else { return }
        self.isStartingRecording = false
        guard granted else {
          self.setStatus(self.label("mic_denied", "Microphone denied. Open Tailzu settings to allow it."), actionable: true)
          self.bailDictating()
          return
        }
        self.beginRecording(session: session)
      }
    }
  }

  /// Reset the SDUI dictating state so the mic button flips back to idle
  /// after a permission/config/hardware bail. Also mirrored into the
  /// state so any binding reading state.dictating re-evaluates.
  private func bailDictating() {
    sduiRenderer?.reflectDictating(false)
  }

  private func beginRecording(session: AVAudioSession) {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("tulmi_rec.m4a")
    // Backend flags:
    //   kb.audio.sampleRate  (default 16000) — Hz
    //   kb.audio.channels    (default 1)
    //   kb.audio.quality     (default "high") — min/low/medium/high/max
    // (Format is fixed AAC — changing it requires a native filename change too.)
    let flags = kbConfig?.flags ?? [:]
    let sr = flags["kb.audio.sampleRate"] as? Double ?? 16000
    let ch = flags["kb.audio.channels"] as? Int ?? 1
    let quality: AVAudioQuality = {
      switch (flags["kb.audio.quality"] as? String ?? "high").lowercased() {
      case "min":    return .min
      case "low":    return .low
      case "medium": return .medium
      case "max":    return .max
      default:       return .high
      }
    }()
    let settings: [String: Any] = [
      AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
      AVSampleRateKey: sr,
      AVNumberOfChannelsKey: ch,
      AVEncoderAudioQualityKey: quality.rawValue,
    ]

    // Configure the session for the given category/mode and actually START a
    // recorder. Returns the LIVE recorder, or nil if the route didn't come up
    // so the caller can retry with a plainer category.
    //
    // Key point: inside a keyboard extension a category can be ACCEPTED (no
    // throw) yet still fail to provision a mic input — so `record() == false`
    // is a real, recoverable failure, not just a thrown error. The old code
    // only fell back when setCategory THREW, so a non-functional .voiceChat IO
    // dead-ended at "444 : Not Listening". We also prepareToRecord() to warm
    // the input route (record() right after setActive can otherwise return
    // false before the route settles).
    func tryStart(_ category: AVAudioSession.Category, _ mode: AVAudioSession.Mode) -> AVAudioRecorder? {
      do {
        try session.setCategory(category, mode: mode, options: [.duckOthers])
        try session.setActive(true)
        let r = try AVAudioRecorder(url: url, settings: settings)
        r.delegate = self
        // Metering on so we can drive voice-reactive UI (mic art speed follows
        // level, same behavior as the main app's dictation screen).
        r.isMeteringEnabled = true
        r.prepareToRecord()
        if r.record() { return r }
        r.stop()
      } catch {
        // fall through — the caller retries with a plainer session
      }
      return nil
    }

    // 1) OS voice-processing (.voiceChat → AEC/NS/AGC) for clean speech in a
    //    noisy room. 2) If that route won't come up in the extension, reset the
    //    session and retry with a plain capture session.
    var recorder = tryStart(.playAndRecord, .voiceChat)
    if recorder == nil {
      try? session.setActive(false)
      recorder = tryStart(.record, .default)
    }
    guard let live = recorder else {
      // Both routes failed — the extension couldn't provision a mic input
      // (record() == false). In a keyboard this almost always means "Allow
      // Full Access" is OFF (or the host app revoked it). Surface a clear,
      // actionable message rather than a cryptic code or silent dead mic.
      NSLog("[Tailzu][kb] beginRecording: both audio routes failed (record()==false) — likely Full Access off / host blocked mic")
      setStatus(
        label("mic_unavailable", "Couldn’t start the mic. Turn on “Allow Full Access” in Settings › General › Keyboard › Keyboards › Tailzu."),
        actionable: true,
      )
      cleanupRecorder()
      bailDictating()
      return
    }

    audioRecorder = live
    recordingURL = url
    isRecording = true
    micButton.setImage(UIImage(systemName: "stop.fill"), for: .normal)
    setStatus("")  // transient — mic button animation is the visible cue
    sduiRenderer?.reflectDictating(true)
  }

  private func stopAndTranscribe() {
    isRecording = false
    micButton.setImage(brandMarkImage(), for: .normal); micButton.imageView?.startAnimating()
    sduiRenderer?.reflectDictating(false)
    audioRecorder?.stop()
    try? AVAudioSession.sharedInstance().setActive(false)

    guard let url = recordingURL,
          FileManager.default.fileExists(atPath: url.path) else {
      setStatus(label("voice_not_listening", "444 : Not Listening"))
      cleanupRecorder()
      return
    }
    setStatus("")  // transient — refined text will land in the field
    let fileURL = url

    let targetApp = (kbConfig?.flags["kb.dictation.targetApp"] as? String) ?? "Generic"
    TulmiBackend.transcribeClean(fileURL: fileURL, targetApp: targetApp) { [weak self] result in
      DispatchQueue.main.async {
        guard let self = self else { return }
        switch result {
        case .success(let cleaned):
          // Drop a conversational refusal to nothing rather than typing it into
          // the field — same last-line-of-defense guard as the streaming path.
          if self.looksLikeFiller(cleaned) {
            self.setStatus("")
          } else {
            self.textDocumentProxy.insertText(cleaned)
            self.flashKeysForText(cleaned)
            self.lastInserted = cleaned
            self.lastRawTranscript = nil
            self.setStatus("")
          }
        case .failure(let error):
          self.setStatus(self.statusForBackendError(error), actionable: true)
        }
        self.cleanupRecorder()
      }
    }
  }

  private func cleanupRecorder() {
    audioRecorder = nil
    recordingURL = nil
  }

  /// Map a backend error to a user-facing status. A 401 means the token the
  /// main app shared into the Keychain has expired — the keyboard can't refresh
  /// a Supabase session itself, so the fix is to open the app once (which
  /// re-shares a fresh token on foreground). Everything else is the generic
  /// "backend unavailable" copy.
  private func statusForBackendError(_ error: Error) -> String {
    if case TulmiBackend.BackendError.http(let code, _) = error, code == 401 {
      return label("auth_expired", "Open Tailzu once to sign in again")
    }
    return "" // generic backend hiccup is cosmetic — suppress (no 222 code)
  }

  // MARK: - Refine

  @objc private func refineTapped() {
    let proxy = textDocumentProxy
    let before = proxy.documentContextBeforeInput ?? ""
    let after = proxy.documentContextAfterInput ?? ""
    let full = (before + after).trimmingCharacters(in: .whitespacesAndNewlines)
    guard !full.isEmpty else {
      // Nothing to refine — do NOT print instructions onto the typepad. Just a
      // tiny haptic nudge so the tap isn't silent, and bail.
      if hasFullAccess { selectionHaptic.selectionChanged() }
      return
    }
    setStatus("")  // transient — refined text will land in the field
    sduiRenderer?.reflectRefining(true)

    let targetApp = (kbConfig?.flags["kb.dictation.targetApp"] as? String) ?? "Generic"
    TulmiBackend.refine(text: full, targetApp: targetApp) { [weak self] result in
      DispatchQueue.main.async {
        guard let self = self else { return }
        switch result {
        case .success(let refined):
          // If refine came back as a conversational refusal, DON'T apply it —
          // replacing would wipe the user's field text with the refusal. Leave
          // the original text untouched (drop the bad refine to nothing).
          if self.looksLikeFiller(refined) {
            self.setStatus("")
          } else {
            self.replaceFieldText(before: before, after: after, with: refined)
            self.setStatus("")
          }
        case .failure(let error):
          self.setStatus(self.statusForBackendError(error), actionable: true)
        }
        self.sduiRenderer?.reflectRefining(false)
      }
    }
  }

  private func replaceFieldText(before: String, after: String, with newText: String) {
    let proxy = textDocumentProxy
    proxy.adjustTextPosition(byCharacterOffset: after.count)
    for _ in 0..<(before.count + after.count) { proxy.deleteBackward() }
    proxy.insertText(newText)
    flashKeysForText(newText)
    // Track for UNDO: keep the pre-refine text as "raw" so a single undo tap
    // reverts refine back to what the user originally had.
    lastInserted = newText
    lastRawTranscript = before + after
  }

  // MARK: - Key flash on response arrival

  /// Fired whenever a refined / transcribed response lands at the cursor.
  /// Runs a staggered orange flash across the keys that spell out the
  /// arriving text — a visible "the keyboard just typed that" signal that
  /// echoes the response in the physical space the user is looking at
  /// (the keys), not the text field (which is in another app entirely).
  ///
  /// Backend flags (all optional, sensible defaults baked in):
  ///   kb.flash.color            — hex accent (default = the keyboard's
  ///                                accent color)
  ///   kb.flash.durationMs       — how long each key stays orange
  ///                                (default 260ms)
  ///   kb.flash.staggerMs        — delay between successive letters
  ///                                (default 32ms — feels like ~30wpm)
  ///   kb.flash.enabled          — false → no-op the whole feature
  private func flashKeysForText(_ text: String) {
    let flags = kbConfig?.flags ?? [:]
    if (flags["kb.flash.enabled"] as? Bool) == false { return }

    let colorHex = flags["kb.flash.color"] as? String ?? kbConfig?.accent ?? "#E8A23C"
    let flashColor = UIColor(tulmiHex: colorHex)
    let durationMs = flags["kb.flash.durationMs"] as? Double ?? 260
    let staggerMs = flags["kb.flash.staggerMs"] as? Double ?? 32
    let duration = durationMs / 1000.0
    let stagger = staggerMs / 1000.0

    // Cap at a reasonable length so a paragraph-long refine doesn't queue
    // 500 animations — the eye reads "typing wave" in the first ~30 keys.
    let charLimit = 40
    let chars = Array(text.lowercased().prefix(charLimit))

    for (i, ch) in chars.enumerated() {
      let delay = Double(i) * stagger
      DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
        self?.flashKey(matching: ch, color: flashColor, duration: duration)
      }
    }
  }

  /// Locate the on-screen key that would insert `char` and briefly tint it.
  /// Space is the space bar; letters map by title; unknown chars are ignored
  /// (they'd need a page switch to be visible; the flash still adds up on
  /// letters even if a few chars miss).
  private func flashKey(matching char: Character, color: UIColor, duration: TimeInterval) {
    let target: UIButton?

    if char == " " {
      // Space is one of the persistent bottom-row buttons.
      target = bottomKeys.first(where: { $0.currentTitle == " " || $0.titleLabel?.text?.trimmingCharacters(in: .whitespaces).isEmpty == true })
    } else {
      // Letters: match by button title (case-insensitive, ignoring shift state).
      let want = String(char)
      target = allKeys.first { btn in
        (btn.currentTitle ?? "").lowercased() == want
      }
    }

    guard let btn = target else { return }
    let restore = btn.backgroundColor ?? .clear
    UIView.animate(withDuration: 0.08, animations: {
      btn.backgroundColor = color
    }, completion: { _ in
      UIView.animate(withDuration: duration - 0.08, delay: 0, options: [.curveEaseOut], animations: {
        btn.backgroundColor = restore
      })
    })
  }

  // MARK: - Status

  private func setStatus(_ text: String, actionable: Bool = false) {
    // ALWAYS log to the device console (Console.app / Xcode) — even when the
    // banner is suppressed — so a mic that bails is DIAGNOSABLE. Suppressing
    // every on-screen string made all failures invisible; this keeps the trail.
    if !text.isEmpty { NSLog("[Tailzu][kb] status: %@", text) }
    // Cosmetic/transient chatter stays hidden — the mic animation is the cue:
    // the 444/222 codes, "Listening…", "Finishing…". But ACTIONABLE guidance
    // (Enable Full Access, mic denied, open the app to sign in) MUST show, or a
    // blocked mic looks completely dead with no way to recover.
    let show = actionable && !text.isEmpty
    statusLabel.text = show ? text : ""
    statusLabel.isHidden = !show
    sduiRenderer?.reflectStatus(show ? text : "")
  }

  override func textWillChange(_ textInput: UITextInput?) {}

  // Stop any in-flight recording / timers if the keyboard goes away.
  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    deleteTimer?.invalidate()
    deleteTimer = nil
    if isRecording {
      isRecording = false
      audioRecorder?.stop()
      try? AVAudioSession.sharedInstance().setActive(false)
      cleanupRecorder()
      bailDictating()   // flip the SDUI mic button back to idle
      setStatus("")
    }
    if isStreaming {
      stream?.cancel()
      endStreaming()    // already resets the SDUI dictating state
      setStatus("")
    }
    // Flow / handoff can also be mid-flight when the keyboard is dismissed. Reset
    // their state + UI so the mic button doesn't reappear stuck in "recording" on
    // the next appearance.
    if flowRecording {
      flowRecording = false
      pendingPartial = ""
    }
    isHandoffActive = false
    sduiRenderer?.reflectDictating(false)
  }
}

// MARK: - Hex color helper

extension UIColor {
  /// True for light colors (so callers can pick black vs white text for contrast).
  var tulmiIsLight: Bool {
    var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
    getRed(&r, green: &g, blue: &b, alpha: &a)
    return (0.299 * r + 0.587 * g + 0.114 * b) > 0.6
  }

  /// Parse "#rrggbb" or "#rrggbbaa" (server theme tokens) into a UIColor.
  /// 8-char adds the trailing alpha byte (0-255). Falls back to gray on
  /// anything else — the SDUI schema uses hex strings throughout.
  convenience init(tulmiHex hex: String) {
    var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if s.hasPrefix("#") { s.removeFirst() }
    var rgb: UInt64 = 0
    if s.count == 6, Scanner(string: s).scanHexInt64(&rgb) {
      self.init(
        red: CGFloat((rgb & 0xFF0000) >> 16) / 255.0,
        green: CGFloat((rgb & 0x00FF00) >> 8) / 255.0,
        blue: CGFloat(rgb & 0x0000FF) / 255.0,
        alpha: 1
      )
      return
    }
    if s.count == 8, Scanner(string: s).scanHexInt64(&rgb) {
      self.init(
        red: CGFloat((rgb & 0xFF000000) >> 24) / 255.0,
        green: CGFloat((rgb & 0x00FF0000) >> 16) / 255.0,
        blue: CGFloat((rgb & 0x0000FF00) >> 8) / 255.0,
        alpha: CGFloat(rgb & 0x000000FF) / 255.0
      )
      return
    }
    self.init(white: 0.15, alpha: 1)
  }
}

// MARK: - SDUI host bridge

/// UIInputViewAudioFeedback conformance — required for playInputClick() to
/// actually play the system click. Returning true whenever Full Access is on
/// lets Apple respect the user's "Keyboard Feedback → Sound" toggle. When
/// Full Access is off, the sound API silently no-ops anyway.
extension KeyboardViewController: UIInputViewAudioFeedback {
  var enableInputClicksWhenVisible: Bool { hasFullAccess }
}

/// The renderer holds `self` weakly and calls into these host hooks so that
/// dictation / refine / text-proxy semantics stay in the existing code path.
extension KeyboardViewController: KBHostControllerProtocol {
  var hostTextDocumentProxy: UITextDocumentProxy { textDocumentProxy }
  var hostHasFullAccess: Bool { hasFullAccess }
  var hostExtensionContext: NSExtensionContext? { extensionContext }

  func hostLabel(_ key: String, _ fallback: String) -> String { label(key, fallback) }

  func hostStartDictation() {
    // Route through the same entry point the mic button uses so the streaming
    // vs file-based branch is chosen from cfg.liveVoice.
    if !isStreaming && !isRecording {
      micTapped()
    }
  }
  func hostStopDictation() {
    // Symmetric with the mode dispatch in micTapped(): stop whichever mic path
    // is actually live. Flow + handoff were missing, so a stop tap in those
    // modes fell through to the "not listening" branch and could never end the
    // session (Flow in particular could not be stopped at all).
    if flowRecording { stopFlowDictation() }
    else if isHandoffActive { cancelHandoff() }
    else if isStreaming { stopStreaming() }
    else if isRecording { stopAndTranscribe() }
    else {
      // Neither flag is set — startRecording bailed silently before
      // isRecording could flip true (Full Access off / mic permission
      // denied / AVAudioSession threw). The SDUI mic button was flipped
      // optimistically to state.dictating=true on tap 1, so we MUST reset
      // it here or the icon stays as "recording" forever. Also surface a
      // status so the user knows what happened.
      NSLog("[Tailzu] hostStopDictation: neither streaming nor recording — resetting SDUI dictating state.")
      sduiRenderer?.reflectDictating(false)
      if statusLabel.text?.isEmpty ?? true {
        setStatus(label("voice_not_listening", "444 : Not Listening"))
      }
    }
  }
  func hostRunRefine() { refineTapped() }
  func hostAdvanceInputMode() { advanceToNextInputMode() }
  func hostPresent(_ vc: UIViewController) {
    present(vc, animated: true, completion: nil)
  }

  /// The current field's autocap trait, read via the text-input traits on the
  /// text document proxy. Defaults to `.sentences` (Apple's default) when the
  /// proxy doesn't expose the trait.
  func hostAutocapitalizationType() -> UITextAutocapitalizationType {
    (textDocumentProxy as? UITextInputTraits)?.autocapitalizationType ?? .sentences
  }

  /// The current field's returnKeyType. Same lookup path — mirrors what
  /// Apple's system keyboard reads to render "Go / Send / Search / Done…"
  /// with the system-blue accent on action keys.
  func hostReturnKeyType() -> UIReturnKeyType {
    (textDocumentProxy as? UITextInputTraits)?.returnKeyType ?? .default
  }

  /// Whether the OS wants a next-keyboard switch key visible. This is true iff
  /// the user has more than one keyboard installed — the same flag native iOS
  /// checks before rendering the language code on space.
  func hostNeedsInputModeSwitchKey() -> Bool { needsInputModeSwitchKey }

  /// The two-letter primary language code (uppercased) of the currently active
  /// input mode — matches what native iOS labels its space bar with when
  /// multiple keyboards are enabled. Falls back to the device locale.
  func hostPrimaryLanguageCode() -> String {
    // primaryLanguage returns "en-US"-style; take the language part and upper-case.
    // Locale.current.language is iOS 16+, but the keyboard deploys to iOS 15.1,
    // so fall back to the (deprecated but 15-safe) languageCode there.
    let localeLang: String?
    if #available(iOS 16.0, *) {
      localeLang = Locale.current.language.languageCode?.identifier
    } else {
      localeLang = Locale.current.languageCode
    }
    let raw = textInputMode?.primaryLanguage ?? localeLang
    guard let head = raw?.split(separator: "-").first, !head.isEmpty else { return "EN" }
    return head.uppercased()
  }
}
