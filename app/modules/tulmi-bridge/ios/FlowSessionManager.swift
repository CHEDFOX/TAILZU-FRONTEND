import Foundation
import AVFoundation

/// FlowSessionManager — the app-side half of the "Flow Session" mic architecture
/// (the same design Wispr Flow uses).
///
/// iOS forbids a keyboard extension from recording audio, so the MAIN APP holds
/// the microphone. Once the user arms a session (opens the app, which calls
/// `arm()`), the app keeps a live AVAudioSession alive in the BACKGROUND
/// (Info.plist `UIBackgroundModes: ["audio"]`) for a configurable idle window.
/// While armed, the keyboard drives each dictation over Darwin notifications:
///
///   keyboard → app:  flow.start  (begin capturing this utterance)
///                    flow.stop   (finalize this utterance)
///   app → keyboard:  flow.transcript  (a new partial/final landed — read it
///                                       from the App Group and insert)
///                    flow.ended       (the session expired / was ended)
///
/// The app streams 16 kHz PCM to `/v1/transcribe-stream` and relays each partial
/// / final through the shared App Group so the keyboard shows live text. The
/// idle window (and everything else) is backend-tunable via `arm()`.
///
/// Everything here is process-local to the MAIN APP. The keyboard side lives in
/// KeyboardViewController (flow mic mode).
final class FlowSessionManager: NSObject {
  static let shared = FlowSessionManager()

  static let appGroup = "group.com.tulmi.app"

  // Darwin notification names — stable so both processes register once.
  static let nStart      = "space.tailzu.tulmi.flow.start"
  static let nStop       = "space.tailzu.tulmi.flow.stop"
  static let nTranscript = "space.tailzu.tulmi.flow.transcript"
  static let nEnded      = "space.tailzu.tulmi.flow.ended"

  private var store: UserDefaults? { UserDefaults(suiteName: FlowSessionManager.appGroup) }

  // Capture / streaming
  private let engine = AVAudioEngine()
  private var converter: AVAudioConverter?
  private let targetFormat = AVAudioFormat(
    commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!
  private var tapInstalled = false
  private let urlSession = URLSession(configuration: .default)
  private var task: URLSessionWebSocketTask?

  // State
  private var armed = false
  private var recording = false
  private var idleTimer: Timer?
  private var idleTimeout: TimeInterval = 300  // 5 min default; backend overrides
  private var baseUrl = ""
  private var token = ""
  private var language = "auto"
  private var seq = 0
  private var observersRegistered = false

  private override init() { super.init() }

  // MARK: - Public API (called from JS via TulmiBridge)

  /// Arm (or re-arm / extend) a Flow Session. Brings up a background-capable
  /// audio session and keeps it active — that's what keeps the app alive after
  /// the user swipes back to their app. Registers the Darwin observers the
  /// keyboard nudges. Idempotent; calling again refreshes the idle window.
  func arm(baseUrl: String, token: String, language: String, idleTimeoutMs: Double) {
    self.baseUrl = baseUrl
    self.token = token
    self.language = language.isEmpty ? "auto" : language
    self.idleTimeout = idleTimeoutMs > 0 ? idleTimeoutMs / 1000.0 : 300

    registerObservers()
    activateAudioSession()

    armed = true
    publishActive()
    resetIdleTimer()
  }

  /// End the session now (user turned Flow off, or the app decided to).
  func end() { disarm(notify: true) }

  var isArmed: Bool { armed }

  // MARK: - Audio session

  private func activateAudioSession() {
    let audio = AVAudioSession.sharedInstance()
    do {
      // .spokenAudio + voice-friendly options; keep the session ACTIVE across
      // the swipe-back so the app stays alive in the background to record.
      try audio.setCategory(.playAndRecord, mode: .spokenAudio,
                            options: [.duckOthers, .allowBluetooth, .defaultToSpeaker])
      try audio.setActive(true)
    } catch {
      // Fall back to a plainer category if the voice-tuned one is refused.
      try? audio.setCategory(.playAndRecord, mode: .default, options: [.duckOthers])
      try? audio.setActive(true)
    }
  }

  private func deactivateAudioSession() {
    try? AVAudioSession.sharedInstance().setActive(
      false, options: [.notifyOthersOnDeactivation])
  }

  // MARK: - App Group publishing

  private func publishActive() {
    let d = store
    d?.set(true, forKey: "tulmi.flow.active")
    d?.set(Date().timeIntervalSince1970 * 1000 + idleTimeout * 1000, forKey: "tulmi.flow.expiresAt")
  }

  private func publishInactive() {
    let d = store
    d?.set(false, forKey: "tulmi.flow.active")
    d?.removeObject(forKey: "tulmi.flow.expiresAt")
  }

  private func post(_ name: String) {
    CFNotificationCenterPostNotification(
      CFNotificationCenterGetDarwinNotifyCenter(),
      CFNotificationName(name as CFString), nil, nil, true)
  }

  // MARK: - Idle timer

  private func resetIdleTimer() {
    idleTimer?.invalidate()
    guard armed else { return }
    publishActive()  // refresh expiresAt on every activity
    idleTimer = Timer.scheduledTimer(withTimeInterval: idleTimeout, repeats: false) { [weak self] _ in
      self?.disarm(notify: true)
    }
  }

  private func disarm(notify: Bool) {
    idleTimer?.invalidate(); idleTimer = nil
    if recording { stopCapture() }
    recording = false
    task?.cancel(with: .goingAway, reason: nil); task = nil
    armed = false
    publishInactive()
    deactivateAudioSession()
    if notify { post(FlowSessionManager.nEnded) }
  }

  // MARK: - Darwin observers (keyboard → app)

  private func registerObservers() {
    guard !observersRegistered else { return }
    observersRegistered = true
    let center = CFNotificationCenterGetDarwinNotifyCenter()
    let ptr = Unmanaged.passUnretained(self).toOpaque()
    // Two separate observers so we don't have to parse the name in the C
    // callback (matches the existing TulmiHandoff pattern).
    CFNotificationCenterAddObserver(center, ptr, { _, p, _, _, _ in
      guard let p = p else { return }
      let this = Unmanaged<FlowSessionManager>.fromOpaque(p).takeUnretainedValue()
      DispatchQueue.main.async { this.beginDictation() }
    }, FlowSessionManager.nStart as CFString, nil, .deliverImmediately)
    CFNotificationCenterAddObserver(center, ptr, { _, p, _, _, _ in
      guard let p = p else { return }
      let this = Unmanaged<FlowSessionManager>.fromOpaque(p).takeUnretainedValue()
      DispatchQueue.main.async { this.endDictation() }
    }, FlowSessionManager.nStop as CFString, nil, .deliverImmediately)
  }

  // MARK: - Dictation lifecycle (one utterance)

  private func beginDictation() {
    guard armed, !recording else { return }
    resetIdleTimer()
    recording = true
    openStream()
    startCapture()
  }

  private func endDictation() {
    guard recording else { return }
    resetIdleTimer()
    stopCapture()
    // Tell the server to flush the tail, then close after a grace window (the
    // final segments arrive via the receive loop and get relayed).
    if let task = task {
      task.send(.string("{\"type\":\"stop\"}")) { _ in }
      DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
        self?.task?.cancel(with: .normalClosure, reason: nil)
        self?.task = nil
      }
    }
    recording = false
  }

  // MARK: - WebSocket

  private var streamURL: URL? {
    let b = baseUrl
    let ws: String
    if b.hasPrefix("https://") { ws = "wss://" + b.dropFirst("https://".count) }
    else if b.hasPrefix("http://") { ws = "ws://" + b.dropFirst("http://".count) }
    else { ws = b }
    return URL(string: "\(ws)/v1/transcribe-stream")
  }

  private func openStream() {
    guard let url = streamURL else { return }
    var req = URLRequest(url: url)
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    let t = urlSession.webSocketTask(with: req)
    task = t
    t.resume()
    receiveLoop()
    let start: [String: Any] = [
      "type": "start", "token": token, "targetApp": "Generic",
      "language": language, "sampleRate": 16000, "encoding": "pcm_s16le", "channels": 1,
    ]
    if let data = try? JSONSerialization.data(withJSONObject: start),
       let str = String(data: data, encoding: .utf8) {
      t.send(.string(str)) { _ in }
    }
  }

  private func receiveLoop() {
    task?.receive { [weak self] result in
      guard let self = self else { return }
      switch result {
      case .failure:
        break  // socket closed; the next dictation opens a fresh one
      case .success(let msg):
        switch msg {
        case .string(let s): self.handleServer(s)
        case .data(let d): self.handleServer(String(data: d, encoding: .utf8) ?? "")
        @unknown default: break
        }
        self.receiveLoop()
      }
    }
  }

  private func handleServer(_ text: String) {
    guard
      let data = text.data(using: .utf8),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let type = json["type"] as? String
    else { return }
    switch type {
    case "partial": relay(json["text"] as? String ?? "", isFinal: false)
    case "final":   relay(json["text"] as? String ?? "", isFinal: true)
    default: break  // "ready" / "done" / "error" need no relay
    }
  }

  /// Publish a transcript update to the App Group and nudge the keyboard. The
  /// keyboard reads `.seq` (to dedupe), `.text`, and `.isFinal` and does its own
  /// partial-replace / final-commit at the cursor.
  private func relay(_ text: String, isFinal: Bool) {
    resetIdleTimer()
    seq += 1
    let d = store
    d?.set(seq, forKey: "tulmi.flow.transcript.seq")
    d?.set(text, forKey: "tulmi.flow.transcript.text")
    d?.set(isFinal, forKey: "tulmi.flow.transcript.isFinal")
    post(FlowSessionManager.nTranscript)
  }

  // MARK: - Capture

  private func startCapture() {
    let input = engine.inputNode
    try? input.setVoiceProcessingEnabled(true)
    let inputFormat = input.outputFormat(forBus: 0)
    converter = AVAudioConverter(from: inputFormat, to: targetFormat)
    input.installTap(onBus: 0, bufferSize: 2048, format: inputFormat) { [weak self] buffer, _ in
      self?.sendBuffer(buffer, inputFormat: inputFormat)
    }
    tapInstalled = true
    engine.prepare()
    do { try engine.start() } catch { stopCapture() }
  }

  private func stopCapture() {
    if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
    if engine.isRunning { engine.stop() }
    // NOTE: we deliberately do NOT deactivate the AVAudioSession here — the
    // session stays live between dictations so the app keeps holding the mic
    // in the background. It's only torn down on disarm().
  }

  private func sendBuffer(_ buffer: AVAudioPCMBuffer, inputFormat: AVAudioFormat) {
    guard let converter = converter, let task = task else { return }
    let ratio = targetFormat.sampleRate / inputFormat.sampleRate
    let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio + 1024)
    guard let out = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: capacity) else { return }
    var fed = false
    var err: NSError?
    let status = converter.convert(to: out, error: &err) { _, outStatus in
      if fed { outStatus.pointee = .noDataNow; return nil }
      fed = true; outStatus.pointee = .haveData; return buffer
    }
    guard status != .error, out.frameLength > 0, let ch = out.int16ChannelData else { return }
    let data = Data(bytes: ch[0], count: Int(out.frameLength) * MemoryLayout<Int16>.size)
    task.send(.data(data)) { _ in }
  }
}
