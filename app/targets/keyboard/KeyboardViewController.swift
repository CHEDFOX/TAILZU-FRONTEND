import UIKit
import AVFoundation

/// Tulmi keyboard (iOS custom keyboard extension).
///
/// A minimal QWERTY with two special keys, mirroring the Android IME:
///   🎙️ mic    → record → POST /v1/transcribe-clean → insert cleaned text
///   ✨ refine  → take the whole field → POST /v1/refine → replace with polished text
///
/// Both special keys (network + microphone) require the user to enable "Allow
/// Full Access" for the keyboard (Settings → General → Keyboard → Keyboards).
/// Recording the mic inside a keyboard extension works with Full Access — this
/// is the same inline approach Wispr Flow uses.
class KeyboardViewController: UIInputViewController, AVAudioRecorderDelegate {

  private var capsOn = false
  private var letterButtons: [UIButton] = []
  private var allKeys: [UIButton] = []
  private let statusLabel = UILabel()
  private var nextKeyboardButton: UIButton!
  private var micButton: UIButton!
  private var refineButton: UIButton?   // no longer shown; kept for auto-refine after dictation
  private var tonePill: UIButton!
  private var returnButton: UIButton?
  private var currentTone = "Formal"
  private let tones = ["Formal", "Casual", "Very Casual", "Excited"]

  // Server-driven config (theme/labels/flags); nil until fetched/cached.
  private var kbConfig: TulmiBackend.KbConfig?

  // Microphone / dictation state (file-based, one-shot).
  private var audioRecorder: AVAudioRecorder?
  private var recordingURL: URL?
  private var isRecording = false

  // Live (streaming) dictation state. Used when the server enables
  // features.liveVoice; otherwise we fall back to the file-based path above.
  private var stream: TulmiStream?
  private var isStreaming = false
  private var pendingPartial = "" // partial text currently shown in the field
  private var dictatedSomething = false // a final landed this session → auto-refine on close

  // QWERTY rows (the action row is built separately).
  private let rows: [[String]] = [
    ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
    ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
    ["z", "x", "c", "v", "b", "n", "m"],
  ]

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = UIColor(red: 0.09, green: 0.09, blue: 0.11, alpha: 1) // #15151b-ish
    buildKeyboard()
    loadAndApplyConfig()
  }

  // MARK: - Server-driven config (theme/labels/flags), cached for offline

  private func loadAndApplyConfig() {
    // Apply last-known config instantly so the keyboard never waits on the network.
    if let data = UserDefaults.standard.data(forKey: "tulmi_kb_config"),
       let cfg = TulmiBackend.parseConfig(data) {
      applyConfig(cfg)
    }
    // Refresh in the background; cache for next launch.
    TulmiBackend.keyboardConfigData { result in
      guard case .success(let data) = result, let cfg = TulmiBackend.parseConfig(data) else { return }
      UserDefaults.standard.set(data, forKey: "tulmi_kb_config")
      DispatchQueue.main.async { self.applyConfig(cfg) }
    }
  }

  private func applyConfig(_ cfg: TulmiBackend.KbConfig) {
    kbConfig = cfg
    view.backgroundColor = UIColor(tulmiHex: cfg.background)
    for b in allKeys {
      b.backgroundColor = UIColor(tulmiHex: cfg.key)
      b.setTitleColor(UIColor(tulmiHex: cfg.keyText), for: .normal)
    }
    returnButton?.backgroundColor = UIColor(tulmiHex: cfg.accent)   // config-driven accent
    statusLabel.textColor = UIColor(tulmiHex: cfg.keyText)
    micButton?.isEnabled = cfg.voice
    micButton?.alpha = cfg.voice ? 1 : 0.4
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
    let undoBtn = makeGlyphButton(symbol: "arrow.uturn.backward")
    undoBtn.addTarget(self, action: #selector(undoTapped), for: .touchUpInside)
    let flex = UIView()
    flex.setContentHuggingPriority(.defaultLow, for: .horizontal)
    flex.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    tonePill = makeTonePill(title: currentTone)
    micButton = makeCircleButton(symbol: "mic.fill")
    micButton.addTarget(self, action: #selector(micTapped), for: .touchUpInside)
    [menuBtn, undoBtn, flex, tonePill, micButton!].forEach { topBar.addArrangedSubview($0) }
    topBar.heightAnchor.constraint(equalToConstant: 40).isActive = true
    stack.addArrangedSubview(topBar)

    // Status line (hidden until there's something to say).
    statusLabel.textColor = UIColor(white: 0.7, alpha: 1)
    statusLabel.font = .systemFont(ofSize: 12)
    statusLabel.textAlignment = .center
    statusLabel.isHidden = true
    stack.addArrangedSubview(statusLabel)

    // Letter rows 1 & 2.
    for i in 0..<2 {
      let rowStack = makeRowStack()
      for key in rows[i] {
        let b = makeKeyButton(title: key)
        b.addTarget(self, action: #selector(letterTapped(_:)), for: .touchUpInside)
        letterButtons.append(b)
        rowStack.addArrangedSubview(b)
      }
      rowStack.heightAnchor.constraint(equalToConstant: 44).isActive = true
      stack.addArrangedSubview(rowStack)
    }

    // Row 3: shift · z x c v b n m · delete.
    let row3 = makeRowStack()
    let shift = makeKeyButton(title: "⇧")
    shift.addTarget(self, action: #selector(shiftTapped), for: .touchUpInside)
    row3.addArrangedSubview(shift)
    for key in rows[2] {
      let b = makeKeyButton(title: key)
      b.addTarget(self, action: #selector(letterTapped(_:)), for: .touchUpInside)
      letterButtons.append(b)
      row3.addArrangedSubview(b)
    }
    let del = makeKeyButton(title: "⌫")
    del.addTarget(self, action: #selector(deleteTapped), for: .touchUpInside)
    row3.addArrangedSubview(del)
    shift.widthAnchor.constraint(equalTo: del.widthAnchor).isActive = true
    row3.heightAnchor.constraint(equalToConstant: 44).isActive = true
    stack.addArrangedSubview(row3)

    // Bottom row: 123 · globe · space("Tailzu") · return(accent).
    let bottom = makeRowStack()
    let numBtn = makeKeyButton(title: "123")
    numBtn.titleLabel?.font = .systemFont(ofSize: 15)
    let globeBtn = makeGlyphButton(symbol: "globe")
    globeBtn.tintColor = UIColor(white: 0.85, alpha: 1)
    globeBtn.addTarget(self, action: #selector(handleInputModeList(from:with:)), for: .allTouchEvents)
    nextKeyboardButton = globeBtn
    let space = makeKeyButton(title: "Tailzu")
    space.titleLabel?.font = .systemFont(ofSize: 14)
    space.setTitleColor(UIColor(white: 0.55, alpha: 1), for: .normal)
    space.addTarget(self, action: #selector(spaceTapped), for: .touchUpInside)
    let ret = makeKeyButton(title: "return")
    ret.backgroundColor = UIColor(red: 0.20, green: 0.47, blue: 0.96, alpha: 1) // #3478f7 (overridden by accent in applyConfig)
    ret.addTarget(self, action: #selector(returnTapped), for: .touchUpInside)
    returnButton = ret
    [numBtn, globeBtn, space, ret].forEach { bottom.addArrangedSubview($0) }
    space.widthAnchor.constraint(equalTo: numBtn.widthAnchor, multiplier: 3.4).isActive = true
    ret.widthAnchor.constraint(equalTo: numBtn.widthAnchor, multiplier: 1.5).isActive = true
    bottom.heightAnchor.constraint(equalToConstant: 44).isActive = true
    stack.addArrangedSubview(bottom)
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

  private func makeCircleButton(symbol: String) -> UIButton {
    let b = UIButton(type: .system)
    b.setImage(UIImage(systemName: symbol), for: .normal)
    b.tintColor = .black
    b.backgroundColor = .white
    b.layer.cornerRadius = 19
    b.clipsToBounds = true
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
    // Undo the last word.
    let before = textDocumentProxy.documentContextBeforeInput ?? ""
    if before.isEmpty { return }
    var count = 0
    var started = false
    for ch in before.reversed() {
      if ch == " " || ch == "\n" { if started { break } } else { started = true }
      count += 1
    }
    for _ in 0..<max(count, 1) { textDocumentProxy.deleteBackward() }
  }

  private func makeKeyButton(title: String) -> UIButton {
    let b = UIButton(type: .system)
    b.setTitle(title, for: .normal)
    b.setTitleColor(.white, for: .normal)
    b.titleLabel?.font = .systemFont(ofSize: 18)
    b.backgroundColor = UIColor(red: 0.11, green: 0.11, blue: 0.15, alpha: 1) // #1c1c25
    b.layer.cornerRadius = 6
    b.translatesAutoresizingMaskIntoConstraints = false
    allKeys.append(b)
    return b
  }

  // MARK: - Key actions

  @objc private func letterTapped(_ sender: UIButton) {
    guard let t = sender.title(for: .normal) else { return }
    textDocumentProxy.insertText(capsOn ? t.uppercased() : t)
  }

  @objc private func shiftTapped() {
    capsOn.toggle()
    for b in letterButtons {
      let t = b.title(for: .normal) ?? ""
      b.setTitle(capsOn ? t.uppercased() : t.lowercased(), for: .normal)
    }
  }

  @objc private func spaceTapped() { textDocumentProxy.insertText(" ") }

  @objc private func deleteTapped() { textDocumentProxy.deleteBackward() }

  @objc private func returnTapped() { textDocumentProxy.insertText("\n") }

  // MARK: - Mic / dictation (inline; requires Full Access)

  @objc private func micTapped() {
    if kbConfig?.liveVoice == true {
      if isStreaming { stopStreaming() } else { startStreaming() }
    } else {
      if isRecording { stopAndTranscribe() } else { startRecording() }
    }
  }

  // MARK: - Live (streaming) dictation

  private func startStreaming() {
    AVAudioSession.sharedInstance().requestRecordPermission { [weak self] granted in
      DispatchQueue.main.async {
        guard let self = self else { return }
        guard granted else {
          self.setStatus("Open the Tulmi app once to allow microphone access.")
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
    setStatus(label("listening", "🎙️ Listening…"))
    let s = TulmiStream { [weak self] event in
      DispatchQueue.main.async { self?.handleStreamEvent(event) }
    }
    stream = s
    s.start(targetApp: "Generic", language: "auto")
  }

  private func handleStreamEvent(_ event: TulmiStream.Event) {
    switch event {
    case .ready:
      setStatus(label("listening", "🎙️ Listening…"))
    case .partial(let text):
      replacePartial(with: text)
    case .finalText(let text):
      commitFinal(text)
    case .error(let msg):
      setStatus("Error: \(msg)")
      endStreaming()
    case .closed:
      endStreaming()
      // Dictation closed → auto-refine what was spoken (replaces the old ✨ key).
      if dictatedSomething && (kbConfig?.refine ?? true) { refineTapped() }
      dictatedSomething = false
    }
  }

  /// Swap the on-screen interim text for the latest hypothesis.
  private func replacePartial(with text: String) {
    let proxy = textDocumentProxy
    for _ in 0..<pendingPartial.count { proxy.deleteBackward() }
    proxy.insertText(text)
    pendingPartial = text
  }

  /// Commit a finalized segment (keep it) and reset the interim tracker.
  private func commitFinal(_ text: String) {
    let proxy = textDocumentProxy
    for _ in 0..<pendingPartial.count { proxy.deleteBackward() }
    proxy.insertText(text.hasSuffix(" ") ? text : text + " ")
    pendingPartial = ""
    dictatedSomething = true
  }

  private func stopStreaming() {
    setStatus(label("transcribing", "Finishing…"))
    stream?.finish()
    endStreaming()
  }

  private func endStreaming() {
    isStreaming = false
    stream = nil
    micButton.setImage(UIImage(systemName: "mic.fill"), for: .normal)
    if statusLabel.text == label("transcribing", "Finishing…") { setStatus("") }
  }

  private func startRecording() {
    let session = AVAudioSession.sharedInstance()
    session.requestRecordPermission { [weak self] granted in
      DispatchQueue.main.async {
        guard let self = self else { return }
        guard granted else {
          self.setStatus("Open the Tulmi app once to allow microphone access.")
          return
        }
        self.beginRecording(session: session)
      }
    }
  }

  private func beginRecording(session: AVAudioSession) {
    do {
      try session.setCategory(.record, mode: .default)
      try session.setActive(true)

      let url = FileManager.default.temporaryDirectory.appendingPathComponent("tulmi_rec.m4a")
      let settings: [String: Any] = [
        AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
        AVSampleRateKey: 16000,
        AVNumberOfChannelsKey: 1,
        AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
      ]
      let recorder = try AVAudioRecorder(url: url, settings: settings)
      recorder.delegate = self
      recorder.record()

      audioRecorder = recorder
      recordingURL = url
      isRecording = true
      micButton.setImage(UIImage(systemName: "stop.fill"), for: .normal)
      setStatus(label("listening", "🎙️ Listening… tap to stop"))
    } catch {
      setStatus("Mic error: \(error.localizedDescription)")
      cleanupRecorder()
    }
  }

  private func stopAndTranscribe() {
    isRecording = false
    micButton.setImage(UIImage(systemName: "mic.fill"), for: .normal)
    audioRecorder?.stop()
    try? AVAudioSession.sharedInstance().setActive(false)

    guard let url = recordingURL,
          FileManager.default.fileExists(atPath: url.path) else {
      setStatus("No audio captured.")
      cleanupRecorder()
      return
    }
    setStatus(label("transcribing", "Transcribing…"))
    let fileURL = url

    TulmiBackend.transcribeClean(fileURL: fileURL, targetApp: "Generic") { [weak self] result in
      DispatchQueue.main.async {
        guard let self = self else { return }
        switch result {
        case .success(let cleaned):
          self.textDocumentProxy.insertText(cleaned)
          self.setStatus("")
        case .failure(let err):
          self.setStatus("Error: \(err.localizedDescription)")
        }
        self.cleanupRecorder()
      }
    }
  }

  private func cleanupRecorder() {
    audioRecorder = nil
    recordingURL = nil
  }

  // MARK: - Refine

  @objc private func refineTapped() {
    let proxy = textDocumentProxy
    let before = proxy.documentContextBeforeInput ?? ""
    let after = proxy.documentContextAfterInput ?? ""
    let full = (before + after).trimmingCharacters(in: .whitespacesAndNewlines)
    guard !full.isEmpty else {
      setStatus("Type something first, then tap ✨")
      return
    }
    setStatus(label("refining", "Refining…"))

    TulmiBackend.refine(text: full, targetApp: "Generic") { [weak self] result in
      DispatchQueue.main.async {
        guard let self = self else { return }
        switch result {
        case .success(let refined):
          self.replaceFieldText(before: before, after: after, with: refined)
          self.setStatus("")
        case .failure(let err):
          self.setStatus("Error: \(err.localizedDescription)")
        }
      }
    }
  }

  /// Replace the captured before+after context with new text. iOS only gives us
  /// the context around the cursor (not always the whole field), so this is a
  /// best-effort replacement that matches what the user can see.
  private func replaceFieldText(before: String, after: String, with newText: String) {
    let proxy = textDocumentProxy
    proxy.adjustTextPosition(byCharacterOffset: after.count)
    for _ in 0..<(before.count + after.count) { proxy.deleteBackward() }
    proxy.insertText(newText)
  }

  // MARK: - Status

  private func setStatus(_ text: String) {
    statusLabel.text = text
    statusLabel.isHidden = text.isEmpty
  }

  override func textWillChange(_ textInput: UITextInput?) {}

  // Stop any in-flight recording if the keyboard goes away.
  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    if isRecording {
      isRecording = false
      audioRecorder?.stop()
      try? AVAudioSession.sharedInstance().setActive(false)
      cleanupRecorder()
      setStatus("")
    }
    if isStreaming {
      stream?.cancel()
      endStreaming()
      setStatus("")
    }
  }
}

// MARK: - Hex color helper

extension UIColor {
  /// Parse "#rrggbb" (server theme tokens) into a UIColor; falls back to gray.
  convenience init(tulmiHex hex: String) {
    var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if s.hasPrefix("#") { s.removeFirst() }
    var rgb: UInt64 = 0
    guard s.count == 6, Scanner(string: s).scanHexInt64(&rgb) else {
      self.init(white: 0.15, alpha: 1)
      return
    }
    self.init(
      red: CGFloat((rgb & 0xFF0000) >> 16) / 255.0,
      green: CGFloat((rgb & 0x00FF00) >> 8) / 255.0,
      blue: CGFloat(rgb & 0x0000FF) / 255.0,
      alpha: 1
    )
  }
}
