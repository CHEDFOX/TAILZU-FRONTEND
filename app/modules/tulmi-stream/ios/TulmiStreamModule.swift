import ExpoModulesCore
import AVFoundation

/// Live (streaming) dictation for the main app.
///
/// JS calls `start({ url, token, targetApp, language })`; the native side opens a
/// WebSocket to the backend, captures the mic as 16 kHz mono PCM, streams it, and
/// emits `onReady` / `onPartial` / `onFinal` / `onError` / `onClosed` events back
/// to JS. See STREAMING.md for the wire protocol.
public class TulmiStreamModule: Module {
  private var streamer: Streamer?

  public func definition() -> ModuleDefinition {
    Name("TulmiStream")

    Events("onReady", "onPartial", "onFinal", "onError", "onClosed")

    Function("start") { (options: [String: Any]) in
      let url = options["url"] as? String ?? ""
      let token = options["token"] as? String ?? "dev"
      let targetApp = options["targetApp"] as? String ?? "Generic"
      let language = options["language"] as? String ?? "auto"
      // The caller says whether this session also has to PLAY. Dictation does
      // not and keeps the narrower .record category; the spoken conversation
      // does, and a .record session cannot answer.
      let duplex = options["duplex"] as? Bool ?? false
      self.streamer?.cancel()
      let s = Streamer(duplex: duplex) { [weak self] name, payload in
        self?.sendEvent(name, payload)
      }
      self.streamer = s
      s.start(urlString: url, token: token, targetApp: targetApp, language: language)
    }

    Function("stop") {
      self.streamer?.finish()
    }

    Function("cancel") {
      self.streamer?.cancel()
      // A duplex streamer holds the audio session between turns, so leaving the
      // screen has to hand it back explicitly — otherwise the app keeps the
      // route to itself and whatever the user was playing stays silenced.
      self.streamer?.releaseSession()
      self.streamer = nil
    }

    OnDestroy {
      self.streamer?.cancel()
      self.streamer = nil
    }
  }
}

/// The actual capture + WebSocket plumbing. Mirrors the keyboard's TulmiStream,
/// but reports through an event closure instead of an enum callback.
private final class Streamer: NSObject {
  private let emit: (String, [String: Any]) -> Void
  /// True when this session also plays — see activateSession().
  private let duplex: Bool
  private let session = URLSession(configuration: .default)
  private var task: URLSessionWebSocketTask?

  private let engine = AVAudioEngine()
  private var converter: AVAudioConverter?
  private let targetFormat = AVAudioFormat(
    commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true
  )!
  private var tapInstalled = false

  /// Guards the object refs the realtime audio tap reads (task/converter) while
  /// the main thread frees them — reading an object reference mid-write is
  /// undefined in Swift and can over-release → use-after-free. Same pattern as
  /// FlowSessionManager; the tap holds it only for a two-pointer snapshot.
  private let avLock = NSLock()
  private func captureAV() -> (AVAudioConverter?, URLSessionWebSocketTask?) {
    avLock.lock(); defer { avLock.unlock() }; return (converter, task)
  }
  private func setTask(_ t: URLSessionWebSocketTask?) { avLock.lock(); task = t; avLock.unlock() }
  private func setConverter(_ c: AVAudioConverter?) { avLock.lock(); converter = c; avLock.unlock() }

  init(duplex: Bool, emit: @escaping (String, [String: Any]) -> Void) {
    self.duplex = duplex
    self.emit = emit
    super.init()
  }

  func start(urlString: String, token: String, targetApp: String, language: String) {
    guard let url = URL(string: urlString) else {
      emit("onError", ["message": "Bad server URL"])
      return
    }
    var req = URLRequest(url: url)
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    let task = session.webSocketTask(with: req)
    setTask(task)
    task.resume()
    receiveLoop()

    let start: [String: Any] = [
      "type": "start",
      "token": token,
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

  func finish() {
    // Keep the socket open after "stop" so the engine's flushed tail + "done"
    // still arrive (cancelling here truncated the ending). Watchdog force-closes
    // if "done" never comes.
    stopCapture()
    guard let task = task else { emit("onClosed", [:]); return }
    task.send(.string("{\"type\":\"stop\"}")) { _ in }
    DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in
      guard let self = self, self.task != nil else { return }
      self.task?.cancel(with: .normalClosure, reason: nil)
      self.setTask(nil)
      self.emit("onClosed", [:])
    }
  }

  func cancel() {
    stopCapture()
    task?.cancel(with: .goingAway, reason: nil)
    setTask(nil)
  }

  private func startCapture() {
    if !activateSession() { return }
    let input = engine.inputNode
    let inputFormat = input.outputFormat(forBus: 0)
    setConverter(AVAudioConverter(from: inputFormat, to: targetFormat))
    input.installTap(onBus: 0, bufferSize: 2048, format: inputFormat) { [weak self] buffer, _ in
      self?.sendBuffer(buffer, inputFormat: inputFormat)
    }
    tapInstalled = true
    engine.prepare()
    do {
      try engine.start()
    } catch {
      // Don't leak the tap + active audio session when the engine won't start.
      stopCapture()
      emit("onError", ["message": "Mic start: \(error.localizedDescription)"])
    }
  }

  /// Take the audio session, and say what for.
  ///
  /// `.record` IS THE WRONG CATEGORY WHEN THE APP ALSO TALKS. A recording
  /// session cannot play, so on the spoken-conversation screen — which listens,
  /// then answers through the synthesiser, then listens again — the two fight
  /// over the same session every turn. The synthesiser holds it to speak, the
  /// next `setActive(true)` arrives while it is still letting go, and iOS
  /// answers "session activation failed". Which is what the screen showed.
  ///
  /// `.playAndRecord` is one session that serves both, so there is nothing to
  /// hand back and forth. `.defaultToSpeaker` because that category otherwise
  /// routes playback to the earpiece, and an assistant that can only be heard
  /// by holding the phone to your head is not one anybody would use.
  ///
  /// Dictation keeps `.record`: it is the narrower permission, it never plays
  /// anything, and changing the category under it would change the input path
  /// for the feature that matters most.
  private func activateSession() -> Bool {
    let audio = AVAudioSession.sharedInstance()
    let category: AVAudioSession.Category = duplex ? .playAndRecord : .record
    let options: AVAudioSession.CategoryOptions =
      duplex ? [.defaultToSpeaker, .allowBluetooth, .allowBluetoothA2DP] : []
    do {
      try audio.setCategory(category, mode: .default, options: options)
      try audio.setActive(true)
      return true
    } catch {
      // ONE RETRY, because the usual cause is a race rather than a refusal:
      // whatever held the session a moment ago is still releasing it, and by
      // the time a person could read an error it would have worked. Failing
      // twice is a real failure and is reported as one.
      Thread.sleep(forTimeInterval: 0.12)
      do {
        try audio.setCategory(category, mode: .default, options: options)
        try audio.setActive(true)
        return true
      } catch {
        emit("onError", ["message": "Audio session: \(error.localizedDescription)"])
        return false
      }
    }
  }

  private func stopCapture() {
    if tapInstalled {
      engine.inputNode.removeTap(onBus: 0)
      tapInstalled = false
    }
    if engine.isRunning { engine.stop() }
    // HOLD THE SESSION IN DUPLEX. The conversation stops the mic between every
    // turn so it does not transcribe its own reply, and dropping the session
    // there means the synthesiser has to take it and give it back on each one —
    // which is the handover that fails. Keeping it means the turn is just a tap
    // being removed.
    //
    // Dictation still releases it, and does so politely: without
    // notifyOthersOnDeactivation whatever was playing before is left paused.
    if !duplex {
      try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
  }

  /// Release the session for good. Only the conversation needs this, because
  /// only the conversation holds on between turns.
  func releaseSession() {
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  private func sendBuffer(_ buffer: AVAudioPCMBuffer, inputFormat: AVAudioFormat) {
    // Snapshot the object refs under the lock so main can't free them mid-use.
    let (snapConv, snapTask) = captureAV()
    guard let converter = snapConv, let task = snapTask else { return }
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
    task.send(.data(data)) { _ in }
  }

  private func receiveLoop() {
    task?.receive { [weak self] result in
      guard let self = self else { return }
      switch result {
      case .failure:
        self.emit("onClosed", [:])
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
    case "ready": emit("onReady", [:])
    case "partial": emit("onPartial", ["text": json["text"] as? String ?? ""])
    case "final": emit("onFinal", ["text": json["text"] as? String ?? ""])
    // "done" is the terminal marker, not a transcript — no text to insert.
    case "done": emit("onClosed", [:])
    case "error": emit("onError", ["message": json["message"] as? String ?? "stream error"])
    default: break
    }
  }
}
