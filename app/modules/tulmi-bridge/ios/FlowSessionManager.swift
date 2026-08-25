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
  private var capturing = false   // AVAudioEngine tap is live (runs continuously while armed)
  private var dictating = false   // a single utterance is currently streaming to the server

  // MARK: One-shot mode
  //
  // Instead of streaming this utterance over a socket, buffer the PCM and POST
  // it once to /v1/transcribe-clean when the user stops.
  //
  // Why it exists: a dropped socket loses the words outright — they were never
  // anywhere but in flight — and with deferred insert the user is left with
  // nothing at all. A buffered utterance still exists on the phone after a
  // failed request, so it can be retried. That endpoint also already runs the
  // Sarvam+Whisper fusion AND the writing step in one call, which is the same
  // path the in-app mic uses, so both surfaces stop diverging.
  //
  // Cost: transcription starts at stop rather than finishing during speech.
  private var oneShot = false
  private var pcm = Data()
  private let pcmLock = NSLock()
  /// ~2 minutes of 16 kHz mono int16. Far beyond any real dictation, and a hard
  /// ceiling matters here: this buffer lives in a background app whose memory
  /// iOS is happy to reclaim.
  private static let pcmCap = 16_000 * 2 * 120
  /// The utterance currently being uploaded — held so a failed request can be
  /// retried with the same audio rather than losing it.
  private var lastUtterance = Data()

  /// Guards the two OBJECT refs the realtime audio thread (sendBuffer) reads
  /// while the main thread frees them: `task` and `converter`. Reading an object
  /// reference while another thread writes it is undefined in Swift and can
  /// over-release → use-after-free crash. The audio callback snapshots both under
  /// this lock into strong locals, so they survive even if main nils the
  /// originals the next instant. `dictating` is a Bool (atomic word read), so it
  /// stays lock-free. NSLock works on every deployment target; the tap holds it
  /// only for a two-pointer copy, so the realtime cost is negligible.
  private let avLock = NSLock()
  private func captureAV() -> (AVAudioConverter?, URLSessionWebSocketTask?) {
    avLock.lock(); defer { avLock.unlock() }
    return (converter, task)
  }
  private func setTask(_ t: URLSessionWebSocketTask?) { avLock.lock(); task = t; avLock.unlock() }
  private func setConverter(_ c: AVAudioConverter?) { avLock.lock(); converter = c; avLock.unlock() }
  private var idleTimer: Timer?
  private var idleTimeout: TimeInterval = 300  // 5 min default; backend overrides
  private var baseUrl = ""
  private var token = ""
  private var language = "auto"
  private var seq = 0
  private var observersRegistered = false

  // Post-stop close lifecycle. When an utterance ends we ask the server to flush
  // its tail and wait for the terminal message (`final`/`done`) to close the
  // socket, with a long watchdog as a fallback. `finishing` marks that draining
  // window; `pendingClose` is the exact socket to tear down — the identity guard
  // in finalizeClose() keeps a NEW dictation's socket safe if one opens meanwhile.
  private var finishing = false
  private var pendingClose: URLSessionWebSocketTask?

  // Liveness heartbeat. While a Flow Session is genuinely alive (this process is
  // running AND the audio engine is delivering buffers), we stamp
  // `tulmi.flow.heartbeat` ~1×/sec. The keyboard treats a stale heartbeat as
  // "no live session" — the only way it can tell the app was FORCE-QUIT, since a
  // force-quit kills the process before it can clear the `active` tombstone.
  private var heartbeatTimer: Timer?
  private var lastBufferAt: TimeInterval = 0   // set on the audio thread (plain Double = realtime-safe)
  private let heartbeatIntervalS: TimeInterval = 1.0

  private override init() { super.init() }

  // MARK: - Public API (called from JS via TulmiBridge)

  /// Arm (or re-arm / extend) a Flow Session. Brings up a background-capable
  /// audio session and keeps it active — that's what keeps the app alive after
  /// the user swipes back to their app. Registers the Darwin observers the
  /// keyboard nudges. Idempotent; calling again refreshes the idle window.
  func arm(baseUrl: String, token: String, language: String, idleTimeoutMs: Double,
           oneShot: Bool = false) {
    self.baseUrl = baseUrl
    self.token = token
    self.language = language.isEmpty ? "auto" : language
    self.idleTimeout = idleTimeoutMs > 0 ? idleTimeoutMs / 1000.0 : 300
    self.oneShot = oneShot

    registerObservers()
    activateAudioSession()
    // Start capturing IMMEDIATELY and keep the engine running for the whole
    // armed window. This is the crux of the Wispr model on iOS: an active but
    // IDLE audio session does NOT keep the app alive in the background — only a
    // continuously-recording engine earns background execution under
    // UIBackgroundModes:["audio"]. Buffers are discarded until a dictation opens
    // a stream (see the `dictating` gate in sendBuffer); the point is that the
    // app stays alive so it can answer the keyboard's flow.start nudge instantly.
    startCapture()

    // If the engine never started (mic permission not granted, another app
    // holds the input, or the audio session failed to activate), do NOT publish
    // a live session. The keyboard trusts `active` + heartbeat; a false-active
    // session makes every mic tap animate into a dead mic and then fall back to
    // the grey "open app" state — the exact "mic stopped responding, greys on
    // every tap" regression. Surface the failure and stay inactive instead.
    guard capturing else {
      armed = false
      publishInactive()
      deactivateAudioSession()
      return
    }

    armed = true
    // Fresh session id so the keyboard can tell this is a NEW Flow Session and
    // reset its transcript-dedup counter. Each process restarts `seq` from 0, so
    // a fresh session's early seq can collide with the keyboard's stale lastSeq
    // and drop a transcript; the sessionId change is the reset signal it reads.
    store?.set(UUID().uuidString, forKey: "tulmi.flow.sessionId")
    publishActive()
    publishHeartbeat()   // immediate liveness so the keyboard sees a live session at once
    startHeartbeat()
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
    d?.removeObject(forKey: "tulmi.flow.heartbeat")
  }

  private func publishHeartbeat() {
    store?.set(Date().timeIntervalSince1970 * 1000, forKey: "tulmi.flow.heartbeat")
  }

  // MARK: - Heartbeat (liveness the keyboard can trust)

  private func startHeartbeat() {
    heartbeatTimer?.invalidate()
    // A repeating MAIN-THREAD timer proves the app PROCESS is alive (a
    // force-quit kills the process → the timer stops firing). The lastBufferAt
    // guard additionally proves the audio engine is still delivering buffers, so
    // a silently-dead mic also lets the heartbeat go stale. Under
    // UIBackgroundModes:["audio"] with an active recording session, main-runloop
    // timers keep firing in the background — the same mechanism that keeps the
    // capture alive.
    heartbeatTimer = Timer.scheduledTimer(withTimeInterval: heartbeatIntervalS, repeats: true) { [weak self] _ in
      guard let self = self, self.armed else { return }
      let now = Date().timeIntervalSince1970
      if self.engine.isRunning && (now - self.lastBufferAt) < 2.0 {
        self.publishHeartbeat()
      }
    }
  }

  private func stopHeartbeat() {
    heartbeatTimer?.invalidate(); heartbeatTimer = nil
    store?.removeObject(forKey: "tulmi.flow.heartbeat")
  }

  private func post(_ name: String) {
    CFNotificationCenterPostNotification(
      CFNotificationCenterGetDarwinNotifyCenter(),
      CFNotificationName(name as CFString), nil, nil, true)
  }

  // MARK: - Idle timer

  private func resetIdleTimer() {
    // Timer.scheduledTimer attaches to the CURRENT thread's run loop. `relay`
    // calls this from the URLSession receive queue, whose run loop isn't
    // running — the timer would never fire and the background mic would stay
    // armed indefinitely (battery + privacy). Always schedule on the main run
    // loop; invalidate cross-thread is also unsafe, so do it here too.
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      self.idleTimer?.invalidate()
      guard self.armed else { return }
      self.publishActive()  // refresh expiresAt on every activity
      self.idleTimer = Timer.scheduledTimer(withTimeInterval: self.idleTimeout, repeats: false) { [weak self] _ in
        self?.disarm(notify: true)
      }
    }
  }

  private func disarm(notify: Bool) {
    idleTimer?.invalidate(); idleTimer = nil
    stopHeartbeat()
    dictating = false
    finishing = false
    pendingClose = nil
    stopCapture()   // only now do we tear the engine down — end of the session
    task?.cancel(with: .goingAway, reason: nil); setTask(nil)
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
    guard armed, !dictating else { return }
    resetIdleTimer()
    dictating = true
    if !capturing { startCapture() }   // safety net — the engine should already be live
    if oneShot {
      pcmLock.lock(); pcm = Data(); pcmLock.unlock()
      return                            // no socket: the buffer IS the transport
    }
    openStream()
  }

  private func endDictation() {
    guard dictating else { return }
    resetIdleTimer()
    dictating = false
    if oneShot { uploadUtterance(); return }
    // Stop STREAMING this utterance — but deliberately keep the engine running
    // (do NOT stopCapture) so the app stays alive in the background between
    // dictations. Ask the server to flush the tail. We do NOT close on a blind
    // short timer: a BATCH backend (Groq — no partials, a single `final` ~3s
    // after flush, and the current provider) would be truncated. Instead the
    // socket closes when the terminal server message (`final`/`done`) lands in
    // handleServer; this long watchdog only force-closes if that never comes.
    guard let closing = task else { return }
    finishing = true
    pendingClose = closing
    closing.send(.string("{\"type\":\"stop\"}")) { _ in }
    DispatchQueue.main.asyncAfter(deadline: .now() + 9.0) { [weak self] in
      self?.finalizeClose(closing)
    }
  }

  /// Close a finished utterance's socket — but ONLY if it's still the current
  /// one. A new dictation started within the grace window reassigns `task` to a
  /// fresh socket; without this identity guard a stale watchdog/terminal-close
  /// would tear the new one down. Idempotent — a second call (watchdog after a
  /// terminal message already closed, or vice-versa) simply no-ops.
  private func finalizeClose(_ closing: URLSessionWebSocketTask) {
    guard task === closing else { return }
    closing.cancel(with: .normalClosure, reason: nil)
    setTask(nil)
    pendingClose = nil
    finishing = false
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
    // Supersede any previous utterance's socket still draining behind the grace
    // window — a fresh dictation makes the old tail moot, and its watchdog /
    // terminal-close then no-ops via the identity guard in finalizeClose().
    if let old = task { old.cancel(with: .normalClosure, reason: nil) }
    setTask(nil)
    pendingClose = nil
    finishing = false
    // Re-read the freshest bearer from the shared Keychain on every open. The
    // arm()-time token goes stale after Supabase rotates it during a long armed
    // session; the server then rejects the socket and receiveLoop just breaks
    // (silent no-text). This is the same source setKeyboardCredentials writes on
    // TOKEN_REFRESHED, so per-open re-reads are always current.
    if let fresh = TulmiKeychain.string(forKey: "tulmi.token"), !fresh.isEmpty {
      token = fresh
    }
    var req = URLRequest(url: url)
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    let t = urlSession.webSocketTask(with: req)
    setTask(t)
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
    case "final":
      relay(json["text"] as? String ?? "", isFinal: true)
      // A batch provider (Groq) emits ONE `final` after our stop and no partials;
      // close as soon as it lands (once we've asked to stop) instead of waiting
      // out the watchdog. A streaming provider's interim finals arrive while
      // still dictating (finishing == false) and must NOT close. `task` /
      // pendingClose / finishing are main-thread state (this receive callback is
      // off-main), so decide + close there.
      DispatchQueue.main.async { [weak self] in
        guard let self = self, self.finishing, let c = self.pendingClose else { return }
        self.finalizeClose(c)
      }
    case "done":
      // The SECOND engine's reading of the same audio, when the server ran two
      // and they disagreed (STT_LIVE_DUAL). It never goes to the cursor — the
      // keyboard hands it to /v1/refine alongside the streamed transcript so
      // the two get reconciled into one sentence. Without relaying it here the
      // shadow engine's work is computed and then thrown away, and the refine
      // call has only one reading to work from.
      if let alt = (json["alternative"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
         !alt.isEmpty {
        store?.set(alt, forKey: "tulmi.flow.alternative")
      }
      // Clean terminal marker — close now if we were draining after a stop.
      DispatchQueue.main.async { [weak self] in
        guard let self = self, let c = self.pendingClose else { return }
        self.finalizeClose(c)
      }
    default: break  // "ready" / "error" need no relay
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
    guard !capturing else { return }
    let input = engine.inputNode
    try? input.setVoiceProcessingEnabled(true)
    let inputFormat = input.outputFormat(forBus: 0)
    setConverter(AVAudioConverter(from: inputFormat, to: targetFormat))
    input.installTap(onBus: 0, bufferSize: 2048, format: inputFormat) { [weak self] buffer, _ in
      self?.sendBuffer(buffer, inputFormat: inputFormat)
    }
    tapInstalled = true
    engine.prepare()
    do { try engine.start(); capturing = true } catch { stopCapture() }
  }

  private func stopCapture() {
    if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
    if engine.isRunning { engine.stop() }
    capturing = false
    // NOTE: this is only called on disarm(). Between dictations the engine keeps
    // running — that continuous capture is what holds the app alive in the
    // background so the keyboard's flow.start nudge is serviced instantly.
  }

  private func sendBuffer(_ buffer: AVAudioPCMBuffer, inputFormat: AVAudioFormat) {
    // Prove the engine is delivering audio — the heartbeat timer reads this to
    // stamp liveness. Runs on the realtime audio thread, so keep it to a plain
    // Double write (no locks/allocations). Stamped for EVERY buffer, whether or
    // not a dictation is open, since the engine runs continuously while armed.
    lastBufferAt = Date().timeIntervalSince1970
    // The engine runs continuously while armed, but we only forward audio to the
    // server DURING a dictation. Between utterances the captured buffers are
    // discarded here — their only job was to keep the app alive in the background.
    guard dictating else { return }
    // Snapshot the object refs under the lock so main can't free them mid-use.
    // In one-shot there is no socket — the converter alone is enough.
    let (snapConv, snapTask) = captureAV()
    guard let converter = snapConv else { return }
    guard oneShot || snapTask != nil else { return }
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
    if oneShot {
      // Runs on the realtime audio thread — a lock around an append is the
      // cheapest safe option; anything heavier here glitches the capture.
      pcmLock.lock()
      if pcm.count < FlowSessionManager.pcmCap { pcm.append(data) }
      pcmLock.unlock()
      return
    }
    snapTask?.send(.data(data)) { _ in }
  }

  // MARK: - One-shot upload

  /// POST the buffered utterance to /v1/transcribe-clean and relay the finished
  /// text. That endpoint returns text that is ALREADY transcribed, fused and
  /// written, so the keyboard inserts it as-is rather than refining again.
  /// Drain the capture buffer and send the utterance. Called on main at stop.
  private func uploadUtterance() {
    // Hold the audio until it either lands or is given up on — that is the
    // whole advantage of buffering over streaming: a failed request can be
    // retried, where a dropped socket has nothing left to retry with.
    pcmLock.lock(); lastUtterance = pcm; pcm = Data(); pcmLock.unlock()
    // Under 0.1s of audio is a mis-tap, not speech. Say so instead of leaving
    // the keyboard waiting on words that were never spoken.
    guard lastUtterance.count > 3200 else {
      lastUtterance = Data()
      giveUpOnUtterance()
      return
    }
    sendUtterance(retriesLeft: 1)
  }

  private func giveUpOnUtterance() {
    store?.set(true, forKey: "tulmi.flow.failed")
    relay("", isFinal: true)
  }

  private func sendUtterance(retriesLeft: Int) {
    let audio = lastUtterance
    guard let url = URL(string: "\(baseUrl)/v1/transcribe-clean") else { return }

    let body = wavContainer(for: audio)
    let boundary = "Boundary-\(UUID().uuidString)"
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.timeoutInterval = 90
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

    var form = Data()
    func field(_ name: String, _ value: String) {
      form.append("--\(boundary)\r\n".data(using: .utf8)!)
      form.append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n".data(using: .utf8)!)
      form.append("\(value)\r\n".data(using: .utf8)!)
    }
    // The language is a SOFT hint only — the backend never pins the recognizer
    // to it (see pipeline/stt.ts). Sent so vocabulary bias still applies.
    field("language", language)
    // Written by the keyboard at dictation start: the user's picked tone, what
    // is already at their cursor, and which app they're typing in. Without
    // these the one-shot path would write in a default voice and ignore the
    // draft it's joining — worse than the streaming path it replaces.
    if let tone = store?.string(forKey: "tulmi.kb.tone"), !tone.isEmpty { field("tone", tone) }
    if let ctx = store?.string(forKey: "tulmi.flow.context"), !ctx.isEmpty { field("context", ctx) }
    if let app = store?.string(forKey: "tulmi.flow.targetApp"), !app.isEmpty { field("targetApp", app) }
    form.append("--\(boundary)\r\n".data(using: .utf8)!)
    form.append("Content-Disposition: form-data; name=\"audio\"; filename=\"u.wav\"\r\n".data(using: .utf8)!)
    form.append("Content-Type: audio/wav\r\n\r\n".data(using: .utf8)!)
    form.append(body)
    form.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
    req.httpBody = form

    URLSession.shared.dataTask(with: req) { [weak self] data, response, _ in
      guard let self = self else { return }
      let ok = (response as? HTTPURLResponse).map { (200...299).contains($0.statusCode) } ?? false
      guard ok, let data = data,
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
      else {
        // The audio is still in hand, so a flaky network costs a retry rather
        // than the user's words.
        // `lastUtterance` is main-thread state (endDictation writes it too), so
        // every decision about it happens there.
        DispatchQueue.main.asyncAfter(deadline: .now() + (retriesLeft > 0 ? 0.8 : 0)) {
          [weak self] in
          guard let self = self else { return }
          if retriesLeft > 0 { self.sendUtterance(retriesLeft: retriesLeft - 1); return }
          // Out of retries. Tell the keyboard explicitly so it stops waiting and
          // shows a failure, instead of sitting on "Writing…" until its deadline.
          self.lastUtterance = Data()
          self.giveUpOnUtterance()
        }
        return
      }
      // cleanedText is the written result; transcript is the raw fallback.
      let text = (json["cleanedText"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        ?? (json["transcript"] as? String) ?? ""
      DispatchQueue.main.async { [weak self] in self?.lastUtterance = Data() }
      guard !text.isEmpty else { self.giveUpOnUtterance(); return }
      // Mark it: this text came back already written, so the keyboard must not
      // run a second refine over it.
      self.store?.set(true, forKey: "tulmi.flow.preRefined")
      self.relay(text, isFinal: true)
    }.resume()
  }

  /// Wrap raw 16 kHz mono int16 PCM in a WAV container. The endpoint infers the
  /// format from the container, so the header is what makes a bare buffer
  /// decodable at all.
  private func wavContainer(for pcmData: Data) -> Data {
    let sampleRate: UInt32 = 16000, channels: UInt16 = 1, bits: UInt16 = 16
    let byteRate = sampleRate * UInt32(channels) * UInt32(bits / 8)
    let blockAlign = channels * (bits / 8)
    var out = Data()
    func u32(_ v: UInt32) { withUnsafeBytes(of: v.littleEndian) { out.append(contentsOf: $0) } }
    func u16(_ v: UInt16) { withUnsafeBytes(of: v.littleEndian) { out.append(contentsOf: $0) } }
    out.append("RIFF".data(using: .ascii)!)
    u32(UInt32(36 + pcmData.count))
    out.append("WAVEfmt ".data(using: .ascii)!)
    u32(16); u16(1); u16(channels); u32(sampleRate); u32(byteRate); u16(blockAlign); u16(bits)
    out.append("data".data(using: .ascii)!)
    u32(UInt32(pcmData.count))
    out.append(pcmData)
    return out
  }
}
