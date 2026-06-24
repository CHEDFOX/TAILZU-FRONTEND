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
    self.task = task
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
    stopCapture()
    if let task = task {
      task.send(.string("{\"type\":\"stop\"}")) { _ in
        task.cancel(with: .normalClosure, reason: nil)
      }
    }
    task = nil
  }

  func cancel() {
    stopCapture()
    task?.cancel(with: .goingAway, reason: nil)
    task = nil
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
    converter = AVAudioConverter(from: inputFormat, to: targetFormat)
    input.installTap(onBus: 0, bufferSize: 2048, format: inputFormat) { [weak self] buffer, _ in
      self?.sendBuffer(buffer, inputFormat: inputFormat)
    }
    tapInstalled = true
    engine.prepare()
    do {
      try engine.start()
    } catch {
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
    case "final", "done": emit("onFinal", ["text": json["text"] as? String ?? ""])
    case "error": emit("onError", ["message": json["message"] as? String ?? "stream error"])
    default: break
    }
  }
}
