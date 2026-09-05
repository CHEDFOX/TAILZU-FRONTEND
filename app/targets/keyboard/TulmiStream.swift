import Foundation
import AVFoundation

/// Live (streaming) dictation client for the iOS keyboard.
///
/// Opens a WebSocket to the backend (`/v1/transcribe-stream`), streams raw
/// 16 kHz mono PCM captured from the mic, and surfaces partial + final
/// transcripts as they arrive. Engine-agnostic: the backend relays audio to
/// whatever streaming speech engine it uses and pushes JSON messages back.
/// See STREAMING.md for the wire protocol.
///
/// Requires "Allow Full Access" (network + mic), same as the file-based path.
final class TulmiStream: NSObject {
  enum Event {
    case ready
    case partial(String)
    case finalText(String)
    case error(String)
    case closed
  }

  private let onEvent: (Event) -> Void
  private let session = URLSession(configuration: .default)
  private var task: URLSessionWebSocketTask?

  private let engine = AVAudioEngine()
  private var converter: AVAudioConverter?
  private let targetFormat = AVAudioFormat(
    commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true
  )!
  private var tapInstalled = false

  /// Backpressure: track in-flight WS sends so a slow/failing socket can't queue
  /// audio indefinitely. Keyboard extensions have a ~60 MB memory ceiling —
  /// unbounded queuing gets the process killed. When we hit the cap we drop
  /// the newest frames (aka "spill from the end") rather than the oldest,
  /// which keeps the transcript in temporal order.
  private let sendCapBytes = 2 * 1024 * 1024   // 2 MB in-flight ≈ 60s of 16k PCM
  private var inFlightBytes = 0
  private let sendQueue = DispatchQueue(label: "TulmiStream.send")

  /// Set when the caller invoked finish(); differentiates a graceful close
  /// from a mid-stream socket failure in receiveLoop.
  private var finishing = false

  /// finish()'s force-close watchdog, held so a graceful "done" can cancel it —
  /// otherwise it fired a SECOND .closed ~2s after the clean close (double
  /// teardown / duplicate refine).
  private var finishWatchdog: DispatchWorkItem?

  /// One-shot guard so .closed is emitted EXACTLY once no matter which path
  /// (server "done", watchdog, or receive failure) gets there first.
  private var hasClosed = false

  init(onEvent: @escaping (Event) -> Void) {
    self.onEvent = onEvent
    super.init()
  }

  // MARK: - Lifecycle

  /// Open the socket, announce the stream, and start capturing.
  func start(targetApp: String, language: String) {
    guard let url = TulmiBackend.streamURL else {
      onEvent(.error("Bad server URL"))
      return
    }
    var req = URLRequest(url: url)
    req.setValue("Bearer \(TulmiBackend.bearer)", forHTTPHeaderField: "Authorization")
    let task = session.webSocketTask(with: req)
    self.task = task
    task.resume()
    receiveLoop()

    let start: [String: Any] = [
      "type": "start",
      "token": TulmiBackend.bearer,
      "targetApp": targetApp,
      "language": language,
      "sampleRate": 16000,
      "encoding": "pcm_s16le",
      "channels": 1,
    ]
    if let data = try? JSONSerialization.data(withJSONObject: start),
       let str = String(data: data, encoding: .utf8) {
      task.send(.string(str)) { _ in }
    }

    startCapture()
  }

  /// Stop the mic and tell the server we're done — but KEEP the socket open.
  ///
  /// The speech engine buffers the last ~0.3–1s of audio and only emits the
  /// final tail segment(s) after it receives our "stop" and flushes; the server
  /// then sends "done". If we cancel the socket here (the old behaviour), that
  /// tail never arrives and every dictation's ending is truncated. So we send
  /// "stop", let the server drive the close via .closed (the "done" event), and
  /// only force-close from a watchdog if "done" never comes.
  func finish() {
    finishing = true
    stopCapture()
    guard let task = task else {
      emitClosedOnce()
      return
    }
    task.send(.string("{\"type\":\"stop\"}")) { _ in }
    // Watchdog: if the server never flushes "done" (dropped socket / wedged
    // engine), force-close so we don't hang in the finishing state. Held as a
    // work item so a graceful "done" cancels it (see handleMessage) — otherwise
    // it fired a second .closed ~2s after the clean close.
    let watchdog = DispatchWorkItem { [weak self] in
      guard let self = self, self.task != nil else { return }
      self.task?.cancel(with: .normalClosure, reason: nil)
      self.task = nil
      self.emitClosedOnce()
    }
    finishWatchdog = watchdog
    DispatchQueue.main.asyncAfter(deadline: .now() + 2.5, execute: watchdog)
  }

  /// Abort immediately (keyboard dismissed, error, etc.).
  func cancel() {
    finishing = true
    finishWatchdog?.cancel()
    finishWatchdog = nil
    stopCapture()
    task?.cancel(with: .goingAway, reason: nil)
    task = nil
  }

  /// Emit .closed at most once — every close path funnels through here. Always
  /// resolves on main: receive callbacks land off-main, but the close state
  /// (hasClosed / task / finishWatchdog) is otherwise touched on main by
  /// finish() and its watchdog, so funneling here keeps that state single-threaded.
  private func emitClosedOnce() {
    guard Thread.isMainThread else {
      DispatchQueue.main.async { [weak self] in self?.emitClosedOnce() }
      return
    }
    guard !hasClosed else { return }
    hasClosed = true
    onEvent(.closed)
  }

  // MARK: - Capture

  private func startCapture() {
    let audio = AVAudioSession.sharedInstance()
    do {
      // .voiceChat enables the OS voice-processing IO unit (AEC + noise
      // suppression + AGC) — exactly what a keyboard dictating in a noisy
      // room wants. Some devices/hosts refuse voice-chat IO inside an
      // extension and throw here; fall back to plain .record so capture
      // still works.
      do {
        try audio.setCategory(.playAndRecord, mode: .voiceChat, options: [.duckOthers])
      } catch {
        try audio.setCategory(.record, mode: .default)
      }
      try audio.setActive(true)
    } catch {
      onEvent(.error("Audio session: \(error.localizedDescription)"))
      return
    }

    let input = engine.inputNode
    // Turn on the input node's voice processing (echo cancel + noise suppress).
    // iOS 13+; throws on hardware that can't do it — non-fatal, we just capture
    // raw. If enabling it later makes engine.start() fail, KeyboardViewController
    // falls back to the local batch-record path, so streaming never hard-fails.
    try? input.setVoiceProcessingEnabled(true)

    let inputFormat = input.outputFormat(forBus: 0)
    converter = AVAudioConverter(from: inputFormat, to: targetFormat)
    input.installTap(onBus: 0, bufferSize: 2048, format: inputFormat) { [weak self] buffer, _ in
      self?.sendBuffer(buffer, inputFormat: inputFormat)
    }
    tapInstalled = true
    engine.prepare()
    do {
      try engine.start()
    } catch {
      // Don't leak the tap + active audio session (which ducks other apps'
      // audio) when the engine fails to start — tear the capture down before
      // surfacing the error.
      stopCapture()
      onEvent(.error("Mic start: \(error.localizedDescription)"))
    }
  }

  private func stopCapture() {
    if tapInstalled {
      engine.inputNode.removeTap(onBus: 0)
      tapInstalled = false
    }
    if engine.isRunning { engine.stop() }
    // Notify other apps (Music, Podcasts) so they resume playback where they
    // were paused when we activated the session. Without this flag the user's
    // music stays silent until they tap play again.
    try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
  }

  /// Resample the mic buffer to 16 kHz mono Int16 and send it as a binary frame.
  private func sendBuffer(_ buffer: AVAudioPCMBuffer, inputFormat: AVAudioFormat) {
    guard let converter = converter, let task = task else { return }
    let ratio = targetFormat.sampleRate / inputFormat.sampleRate
    let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio + 1024)
    guard let out = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: capacity) else { return }

    var fed = false
    var err: NSError?
    let status = converter.convert(to: out, error: &err) { _, outStatus in
      if fed {
        outStatus.pointee = .noDataNow
        return nil
      }
      fed = true
      outStatus.pointee = .haveData
      return buffer
    }
    guard status != .error, out.frameLength > 0, let ch = out.int16ChannelData else { return }
    let data = Data(bytes: ch[0], count: Int(out.frameLength) * MemoryLayout<Int16>.size)

    // Drop new frames if the socket is backlogged — better a small audio gap
    // than an OOM kill of the keyboard extension.
    var willDrop = false
    sendQueue.sync {
      if inFlightBytes + data.count > sendCapBytes { willDrop = true }
      else { inFlightBytes += data.count }
    }
    if willDrop { return }

    task.send(.data(data)) { [weak self] _ in
      self?.sendQueue.async { self?.inFlightBytes -= data.count }
    }
  }

  // MARK: - Receive

  private func receiveLoop() {
    task?.receive { [weak self] result in
      guard let self = self else { return }
      switch result {
      case .failure(let err):
        // Distinguish a graceful close from a mid-stream network failure so
        // the keyboard doesn't auto-refine a partial-that-never-finalized.
        if self.finishing {
          self.emitClosedOnce()
        } else {
          self.onEvent(.error("stream lost: \(err.localizedDescription)"))
          self.emitClosedOnce()
        }
      case .success(let message):
        switch message {
        case .string(let text): self.handleMessage(text)
        case .data(let data): self.handleMessage(String(data: data, encoding: .utf8) ?? "")
        @unknown default: break
        }
        self.receiveLoop()
      }
    }
  }

  private func handleMessage(_ text: String) {
    guard
      let data = text.data(using: .utf8),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let type = json["type"] as? String
    else { return }
    switch type {
    case "ready": onEvent(.ready)
    case "partial": onEvent(.partial(json["text"] as? String ?? ""))
    case "final": onEvent(.finalText(json["text"] as? String ?? ""))
    // "done" is the terminal marker, NOT a transcript — it carries no text.
    // Mapping it to .finalText("") made commitFinal insert a bare space at the
    // cursor (the reported "stray trailing space" bug). It's a clean close.
    // Cancel the finish() watchdog and drop the socket here so it can't fire a
    // second .closed later; emitClosedOnce keeps the teardown/refine single.
    case "done":
      // This callback lands off-main; mutate the close state on main so it can't
      // race finish()'s watchdog.
      DispatchQueue.main.async { [weak self] in
        guard let self = self else { return }
        self.finishWatchdog?.cancel()
        self.finishWatchdog = nil
        self.task?.cancel(with: .normalClosure, reason: nil)
        self.task = nil
        self.emitClosedOnce()
      }
    case "error": onEvent(.error(json["message"] as? String ?? "stream error"))
    default: break
    }
  }
}
