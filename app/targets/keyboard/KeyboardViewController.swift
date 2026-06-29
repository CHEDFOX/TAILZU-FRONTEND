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
  private var mainStack: UIStackView!

  private let statusLabel = UILabel()
  private var nextKeyboardButton: UIButton!
  private var micButton: UIButton!
  private var refineButton: UIButton?   // no longer shown; kept for auto-refine after dictation
  private var tonePill: UIButton!
  private var returnButton: UIButton?
  private var shiftButton: UIButton?
  private var pageToggleButton: UIButton?         // bottom-left 123 / ABC
  private var currentTone = "Formal"
  private let tones = ["Formal", "Casual", "Very Casual", "Excited"]

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

  // Microphone / dictation state (file-based, one-shot).
  private var audioRecorder: AVAudioRecorder?
  private var recordingURL: URL?
  private var isRecording = false

  // Live (streaming) dictation state.
  private var stream: TulmiStream?
  private var isStreaming = false
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
    view.backgroundColor = UIColor(red: 0.09, green: 0.09, blue: 0.11, alpha: 1) // #15151b-ish
    writeKeyboardStatus()
    buildKeyboard()
    loadAndApplyConfig()
  }

  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    writeKeyboardStatus()
  }

  /// Publish the keyboard's live state to the shared App Group so the main app
  /// can detect that the keyboard is enabled and whether Full Access is granted
  /// (used to gate the onboarding "you're all set" step). Written every time the
  /// keyboard runs; the presence of a recent timestamp means it's enabled.
  private func writeKeyboardStatus() {
    let d = UserDefaults(suiteName: "group.com.tulmi.app")
    d?.set(hasFullAccess, forKey: "tulmi.kb.fullAccess")
    d?.set(Date().timeIntervalSince1970 * 1000, forKey: "tulmi.kb.lastActive")
  }

  // MARK: - Server-driven config (theme/labels/flags), cached for offline

  private func loadAndApplyConfig() {
    if let data = UserDefaults.standard.data(forKey: "tulmi_kb_config"),
       let cfg = TulmiBackend.parseConfig(data) {
      applyConfig(cfg)
    }
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
    let accentColor = UIColor(tulmiHex: cfg.accent)                 // config-driven accent
    returnButton?.backgroundColor = accentColor
    // Contrast the "return" label against the accent (black on a white/light
    // accent, white on a dark one) so it's always legible.
    returnButton?.setTitleColor(accentColor.tulmiIsLight ? .black : .white, for: .normal)
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

    // Insert above the bottom row (which sits at index 2 after topBar + status).
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

  /// The Tailzu brand mark (the soundwave logo) bundled in the keyboard
  /// target's Assets.xcassets. Rendered as-is (already black) so it reads as
  /// the logo on the white circle. Falls back to the SF mic symbol if missing.
  private func brandMarkImage() -> UIImage {
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
    deleteTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: false) { [weak self] _ in
      self?.startDeleteRepeat()
    }
  }

  private func startDeleteRepeat() {
    deleteTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
      self?.textDocumentProxy.deleteBackward()
    }
  }

  @objc private func deleteTouchUp() {
    deleteTimer?.invalidate()
    deleteTimer = nil
  }

  @objc private func returnTapped() { textDocumentProxy.insertText("\n") }

  // MARK: - Auto-capitalization

  /// Re-evaluate shift after the document text changes (sentence start → cap).
  override func textDidChange(_ textInput: UITextInput?) {
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
    micButton.setImage(brandMarkImage(), for: .normal)
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
    micButton.setImage(brandMarkImage(), for: .normal)
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
  /// True for light colors (so callers can pick black vs white text for contrast).
  var tulmiIsLight: Bool {
    var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
    getRed(&r, green: &g, blue: &b, alpha: &a)
    return (0.299 * r + 0.587 * g + 0.114 * b) > 0.6
  }

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
