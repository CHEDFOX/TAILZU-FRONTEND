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

  /// Stop the mic, tell the server we're done, and close gracefully.
  func finish() {
    stopCapture()
    if let task = task {
      task.send(.string("{\"type\":\"stop\"}")) { _ in
        task.cancel(with: .normalClosure, reason: nil)
      }
    }
    task = nil
  }

  /// Abort immediately (keyboard dismissed, error, etc.).
  func cancel() {
    stopCapture()
    task?.cancel(with: .goingAway, reason: nil)
    task = nil
  }

  // MARK: - Capture

  private func startCapture() {
    let audio = AVAudioSession.sharedInstance()
    do {
      try audio.setCategory(.record, mode: .default)
      try audio.setActive(true)
    } catch {
      onEvent(.error("Audio session: \(error.localizedDescription)"))
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
      onEvent(.error("Mic start: \(error.localizedDescription)"))
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
    task.send(.data(data)) { _ in }
  }

  // MARK: - Receive

  private func receiveLoop() {
    task?.receive { [weak self] result in
      guard let self = self else { return }
      switch result {
      case .failure:
        self.onEvent(.closed)
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
    case "final", "done": onEvent(.finalText(json["text"] as? String ?? ""))
    case "error": onEvent(.error(json["message"] as? String ?? "stream error"))
    default: break
    }
  }
}
