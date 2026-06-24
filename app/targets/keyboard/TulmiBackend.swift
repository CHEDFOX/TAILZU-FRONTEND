import Foundation

/// Tiny backend client for the iOS keyboard. Mirrors Android's Net.kt.
///
/// The backend URL + user token are shared by the main app through an App Group
/// (written by the tulmi-bridge native module). We read them here, falling back
/// to localhost + a "dev" token (DEV_SKIP_AUTH) when the app hasn't written yet.
enum TulmiBackend {
  // Must match the App Group in the app + keyboard entitlements.
  private static let appGroup = "group.com.tulmi.app"
  private static var shared: UserDefaults? { UserDefaults(suiteName: appGroup) }

  static var baseUrl: String {
    let v = shared?.string(forKey: "tulmi.baseUrl")
    return (v?.isEmpty == false) ? v! : "http://localhost:8770"
  }

  private static var token: String {
    let v = shared?.string(forKey: "tulmi.token")
    return (v?.isEmpty == false) ? v! : "dev"
  }

  /// The user token, exposed for the live streaming client (TulmiStream).
  static var bearer: String { token }

  /// WebSocket URL for live dictation: same host as baseUrl, ws/wss scheme.
  /// See STREAMING.md.
  static var streamURL: URL? {
    let b = baseUrl
    let ws: String
    if b.hasPrefix("https://") {
      ws = "wss://" + b.dropFirst("https://".count)
    } else if b.hasPrefix("http://") {
      ws = "ws://" + b.dropFirst("http://".count)
    } else {
      ws = b
    }
    return URL(string: "\(ws)/v1/transcribe-stream")
  }

  enum BackendError: LocalizedError {
    case http(Int, String)
    case badResponse
    case noAudio
    var errorDescription: String? {
      switch self {
      case .http(let code, let body): return "\(code): \(body)"
      case .badResponse: return "Unexpected response"
      case .noAudio: return "Could not read recording"
      }
    }
  }

  // MARK: - Server-driven keyboard config

  struct KbConfig {
    let background: String
    let key: String
    let keyText: String
    let accent: String
    let voice: Bool
    let refine: Bool
    let liveVoice: Bool
    let labels: [String: String]
  }

  /// Fetch the raw config JSON (the caller both applies and caches it).
  static func keyboardConfigData(completion: @escaping (Result<Data, Error>) -> Void) {
    guard let url = URL(string: "\(baseUrl)/v1/keyboard/config") else {
      completion(.failure(BackendError.badResponse))
      return
    }
    var req = URLRequest(url: url)
    req.httpMethod = "GET"
    req.timeoutInterval = 30
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    URLSession.shared.dataTask(with: req) { data, _, error in
      if let error = error { completion(.failure(error)); return }
      guard let data = data else { completion(.failure(BackendError.badResponse)); return }
      completion(.success(data))
    }.resume()
  }

  static func parseConfig(_ data: Data) -> KbConfig? {
    guard
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let theme = json["theme"] as? [String: Any],
      let features = json["features"] as? [String: Any]
    else { return nil }
    var labels: [String: String] = [:]
    if let raw = json["labels"] as? [String: Any] {
      for (k, v) in raw { if let s = v as? String { labels[k] = s } }
    }
    return KbConfig(
      background: theme["background"] as? String ?? "#15151b",
      key: theme["key"] as? String ?? "#1c1c25",
      keyText: theme["keyText"] as? String ?? "#ffffff",
      accent: theme["accent"] as? String ?? "#5b4bff",
      voice: features["voice"] as? Bool ?? true,
      refine: features["refine"] as? Bool ?? true,
      liveVoice: features["liveVoice"] as? Bool ?? false,
      labels: labels
    )
  }

  static func refine(
    text: String,
    targetApp: String,
    completion: @escaping (Result<String, Error>) -> Void
  ) {
    guard let url = URL(string: "\(baseUrl)/v1/refine") else {
      completion(.failure(BackendError.badResponse))
      return
    }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.timeoutInterval = 60
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    req.httpBody = try? JSONSerialization.data(withJSONObject: [
      "text": text,
      "targetApp": targetApp,
      "language": "auto",
    ])

    URLSession.shared.dataTask(with: req) { data, response, error in
      if let error = error {
        completion(.failure(error))
        return
      }
      let body = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
      if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
        completion(.failure(BackendError.http(http.statusCode, body)))
        return
      }
      guard
        let data = data,
        let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let refined = json["refinedText"] as? String
      else {
        completion(.failure(BackendError.badResponse))
        return
      }
      completion(.success(refined))
    }.resume()
  }

  /// Upload a recording for transcription + cleanup. Mirrors Android's
  /// Net.transcribeClean (multipart POST /v1/transcribe-clean).
  static func transcribeClean(
    fileURL: URL,
    targetApp: String,
    completion: @escaping (Result<String, Error>) -> Void
  ) {
    guard let url = URL(string: "\(baseUrl)/v1/transcribe-clean") else {
      completion(.failure(BackendError.badResponse))
      return
    }
    guard let audio = try? Data(contentsOf: fileURL) else {
      completion(.failure(BackendError.noAudio))
      return
    }

    let boundary = "Boundary-\(UUID().uuidString)"
    var body = Data()
    func append(_ s: String) { body.append(s.data(using: .utf8)!) }

    append("--\(boundary)\r\n")
    append("Content-Disposition: form-data; name=\"audio\"; filename=\"audio.m4a\"\r\n")
    append("Content-Type: audio/m4a\r\n\r\n")
    body.append(audio)
    append("\r\n")
    for (key, value) in ["targetApp": targetApp, "language": "auto"] {
      append("--\(boundary)\r\n")
      append("Content-Disposition: form-data; name=\"\(key)\"\r\n\r\n")
      append("\(value)\r\n")
    }
    append("--\(boundary)--\r\n")

    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.timeoutInterval = 60
    req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    req.httpBody = body

    URLSession.shared.dataTask(with: req) { data, response, error in
      if let error = error {
        completion(.failure(error))
        return
      }
      let bodyStr = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
      if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
        completion(.failure(BackendError.http(http.statusCode, bodyStr)))
        return
      }
      guard
        let data = data,
        let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let cleaned = json["cleanedText"] as? String
      else {
        completion(.failure(BackendError.badResponse))
        return
      }
      completion(.success(cleaned))
    }.resume()
  }
}
