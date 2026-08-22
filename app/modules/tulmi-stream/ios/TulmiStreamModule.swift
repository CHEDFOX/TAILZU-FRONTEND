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
      self.streamer?.cancel()
      let s = Streamer { [weak self] name, payload in
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

  init(emit: @escaping (String, [String: Any]) -> Void) {
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
    let audio = AVAudioSession.sharedInstance()
    do {
      try audio.setCategory(.record, mode: .default)
      try audio.setActive(true)
    } catch {
      emit("onError", ["message": "Audio session: \(error.localizedDescription)"])
      return
    }
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

  private func stopCapture() {
    if tapInstalled {
      engine.inputNode.removeTap(onBus: 0)
      tapInstalled = false
    }
    if engine.isRunning { engine.stop() }
    try? AVAudioSession.sharedInstance().setActive(false)
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
