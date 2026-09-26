import Foundation

/// Tiny backend client for the iOS keyboard. Mirrors Android's Net.kt.
///
/// The backend URL + user token are shared by the main app through an App Group
/// (written by the tulmi-bridge native module). We read them here, falling back
/// to the production host when the app hasn't written yet. With no token there
/// is no Authorization header at all — the server answers 401 and the caller
/// handles that like any expired session.
///
/// Everything else here — every endpoint path but the config's, every timeout,
/// retries, the default language, the upload's filename and type — is a knob
/// (KBKnobs.swift): the server sends it with the config, and the literal next
/// to each call is only what holds before any config has arrived. The config
/// path itself stays a literal: it is the request that fetches the knobs.
enum TulmiBackend {
  // Must match the App Group in the app + keyboard entitlements.
  private static let appGroup = "group.com.tulmi.app"
  private static var shared: UserDefaults? { UserDefaults(suiteName: appGroup) }

  static var baseUrl: String {
    let v = shared?.string(forKey: "tulmi.baseUrl")
    return (v?.isEmpty == false) ? v! : "https://api.tailzu.space"
  }

  /// Bearer token, read from the shared Keychain (encrypted at rest, out of
  /// UserDefaults dumps). Falls back to the App-Group UserDefaults key so
  /// older installs that haven't seen the new bridge module still keep
  /// working — the next foreground of the main app migrates it to Keychain.
  ///
  /// Empty when neither has one. There used to be a "dev" fallback here (the
  /// backend's DEV_SKIP_AUTH), which meant a keyboard with no signed-in user
  /// still sent a credential; now it sends none (see `authorize`).
  private static var token: String {
    if let v = TulmiKeychain.string(forKey: "tulmi.token"), !v.isEmpty {
      return v
    }
    if let legacy = shared?.string(forKey: "tulmi.token"), !legacy.isEmpty {
      return legacy
    }
    return ""
  }

  /// Put the user's token on a request — or, with no token, no Authorization
  /// header at all.
  static func authorize(_ req: inout URLRequest) {
    let t = token
    if !t.isEmpty { req.setValue("Bearer \(t)", forHTTPHeaderField: "Authorization") }
  }

  /// User-selected language code (hi / es / fr / hinglish / auto / …).
  /// Written by the main app via the tulmi-bridge module when the user picks
  /// a language on the onboarding language screen or in Settings. Empty →
  /// the server's default (kb.dictation.defaultLanguage, "auto" = the
  /// server-side model detects language + code-switching).
  static var language: String {
    let v = shared?.string(forKey: "tulmi.language")
    return (v?.isEmpty == false) ? v! : knobString("kb.dictation.defaultLanguage", "auto")
  }

  /// The user token, exposed for the live streaming client (TulmiStream).
  /// Empty when there is none.
  static var bearer: String { token }

  /// An endpoint on the backend: `path` is the server's (a knob) or the literal.
  private static func endpoint(_ path: String) -> URL? {
    URL(string: "\(baseUrl)\(path)")
  }

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
    let path = knobString("kb.endpoints.stream", "/v1/transcribe-stream")
    return URL(string: "\(ws)\(path)")
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

  // MARK: - Idempotent GETs, retried

  /// Run an idempotent request (a GET), retrying a network failure or a
  /// 5xx / 408 / 429 up to `kb.network.retries` times. The first retry waits
  /// `kb.network.retryBackoffMs`, and each later one twice the one before.
  /// The default is no retries — exactly the single attempt this always made.
  /// A 4xx (an expired token, say) is never retried: asking again won't fix it.
  static func getWithRetry(
    _ req: URLRequest,
    completion: @escaping (Data?, URLResponse?, Error?) -> Void
  ) {
    let retries = max(0, knobInt("kb.network.retries", 0))
    let backoffMs = max(0, knobDouble("kb.network.retryBackoffMs", 500))
    attempt(req, retriesLeft: retries, delayMs: backoffMs, completion: completion)
  }

  private static func attempt(
    _ req: URLRequest,
    retriesLeft: Int,
    delayMs: Double,
    completion: @escaping (Data?, URLResponse?, Error?) -> Void
  ) {
    URLSession.shared.dataTask(with: req) { data, response, error in
      let status = (response as? HTTPURLResponse)?.statusCode ?? 0
      let cancelled = (error as? URLError)?.code == .cancelled
      let transient = (error != nil && !cancelled) || status >= 500 || status == 408 || status == 429
      if transient && retriesLeft > 0 {
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + delayMs / 1000.0) {
          attempt(req, retriesLeft: retriesLeft - 1, delayMs: delayMs * 2, completion: completion)
        }
        return
      }
      completion(data, response, error)
    }.resume()
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
    /// The full flags dict as parsed from the response, opaque to the legacy
    /// path but consumed by KeyboardViewController for the tunable audio-recorder
    /// settings and dictation params. SDUI-side uses its own KBConfig for flags.
    let flags: [String: Any]
  }

  /// Fetch the raw config JSON (the caller both applies and caches it).
  static func keyboardConfigData(completion: @escaping (Result<Data, Error>) -> Void) {
    // The one path that stays a literal: this is the request that fetches the
    // knobs every other path is read from.
    guard let url = endpoint("/v1/keyboard/config") else {
      completion(.failure(BackendError.badResponse))
      return
    }
    var req = URLRequest(url: url)
    req.httpMethod = "GET"
    req.timeoutInterval = knobDouble("kb.network.timeouts.configSec", 30)
    authorize(&req)
    // WHICH BINARY IS ASKING. The server keys a few flags on it — the recording
    // veil's blur, for one, which only a build that raises the veil above the
    // keys can wear. An older build sends nothing and gets the safe answer.
    req.setValue(SDUIRenderer.buildStamp, forHTTPHeaderField: "X-Tulmi-Keyboard-Build")
    getWithRetry(req) { data, response, error in
      if let error = error { completion(.failure(error)); return }
      // Reject non-2xx BEFORE the caller caches the body. Previously the status
      // was ignored, so an auth-expired 401 (or a 5xx error page) was returned as
      // ".success(errorBody)" and cached AS the config — parseConfig then failed
      // and the keyboard fell back to stale/defaults. A failure here leaves the
      // last-known-good cached config untouched.
      if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
        let body = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        completion(.failure(BackendError.http(http.statusCode, body)))
        return
      }
      guard let data = data else { completion(.failure(BackendError.badResponse)); return }
      completion(.success(data))
    }
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
      accent: theme["accent"] as? String ?? "#FFFFFF",
      voice: features["voice"] as? Bool ?? true,
      refine: features["refine"] as? Bool ?? true,
      liveVoice: features["liveVoice"] as? Bool ?? false,
      labels: labels,
      flags: (json["flags"] as? [String: Any]) ?? [:]
    )
  }

  /// Upload keyboard diagnostic COUNTERS. Fire-and-forget: telemetry must
  /// never surface to a user who is mid-sentence, so failures are silent and
  /// the counters simply stay pending for the next attempt (the caller only
  /// clears them on success).
  static func postTelemetry(
    counters: [String: Int],
    windowMs: Int,
    build: String,
    completion: @escaping (Bool) -> Void,
  ) {
    guard let url = endpoint(knobString("kb.endpoints.telemetry", "/v1/keyboard/telemetry")),
          !token.isEmpty else {
      completion(false)
      return
    }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.timeoutInterval = knobDouble("kb.network.timeouts.telemetrySec", 15)
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    authorize(&req)
    let appVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
    req.httpBody = try? JSONSerialization.data(withJSONObject: [
      "counters": counters,
      "windowMs": windowMs,
      "build": build,
      "appVersion": appVersion,
      "platform": "ios",
    ])
    URLSession.shared.dataTask(with: req) { _, response, error in
      let ok = error == nil
        && (response as? HTTPURLResponse).map { (200...299).contains($0.statusCode) } == true
      completion(ok)
    }.resume()
  }

  /// Small PUT to /v1/personality — used by the personality chip row to
  /// switch preset + tone without pulling the whole profile down. Backend
  /// does a partial merge so an { activePresetId, activeTone } body doesn't
  /// disturb the rest of the profile (vocabulary, sign-off, etc.).
  static func putPersonalityQuick(
    body: [String: Any],
    completion: @escaping (Result<Void, Error>) -> Void,
  ) {
    guard let url = endpoint(knobString("kb.endpoints.personality", "/v1/personality")) else {
      completion(.failure(BackendError.badResponse))
      return
    }
    var req = URLRequest(url: url)
    req.httpMethod = "PUT"
    req.timeoutInterval = knobDouble("kb.network.timeouts.personalitySec", 15)
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    authorize(&req)
    req.httpBody = try? JSONSerialization.data(withJSONObject: body)
    URLSession.shared.dataTask(with: req) { _, response, error in
      if let error = error { completion(.failure(error)); return }
      if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
        completion(.failure(BackendError.http(http.statusCode, "")))
        return
      }
      completion(.success(()))
    }.resume()
  }

  static func refine(
    text: String,
    targetApp: String,
    tone: String? = nil,
    /// Text already in the field BEFORE this dictation. Sent as context so the
    /// model can fit the new sentence to an existing draft without rewriting
    /// it — refining the whole field would edit words the user never dictated.
    context: String? = nil,
    /// A SECOND speech engine's reading of the same audio, when the server ran
    /// two and they disagreed. The endpoint reconciles the pair rather than
    /// picking one — each engine fails in different places, so together they
    /// can reconstruct a sentence neither got fully right.
    alternative: String? = nil,
    completion: @escaping (Result<String, Error>) -> Void
  ) {
    guard let url = endpoint(knobString("kb.endpoints.refine", "/v1/refine")) else {
      completion(.failure(BackendError.badResponse))
      return
    }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.timeoutInterval = knobDouble("kb.network.timeouts.refineSec", 60)
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    authorize(&req)
    // Use the user's chosen language (falls back to the server's default when
    // unset). The backend's cleanup pipeline prompts the LLM to output in this
    // language, so refinement lands in the user's tongue instead of always
    // English. `tone` (a tone ID picked on the keyboard's pill) overrides the
    // server's saved activeTone for this call — the server falls back to the
    // profile when it's absent (body.tone ?? personality.activeTone).
    var payload: [String: Any] = [
      "text": text,
      "targetApp": targetApp,
      "language": language,
    ]
    if let tone = tone, !tone.isEmpty { payload["tone"] = tone }
    if let context = context, !context.isEmpty { payload["context"] = context }
    if let alternative = alternative, !alternative.isEmpty { payload["alternative"] = alternative }
    req.httpBody = try? JSONSerialization.data(withJSONObject: payload)

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
    guard let url = endpoint(knobString("kb.endpoints.transcribeClean", "/v1/transcribe-clean")) else {
      completion(.failure(BackendError.badResponse))
      return
    }
    guard let audio = try? Data(contentsOf: fileURL) else {
      completion(.failure(BackendError.noAudio))
      return
    }

    let boundary = "Boundary-\(UUID().uuidString)"
    let filename = knobString("kb.upload.filename", "audio.m4a")
    let mimeType = knobString("kb.upload.mimeType", "audio/m4a")
    var body = Data()
    func append(_ s: String) { body.append(s.data(using: .utf8)!) }

    append("--\(boundary)\r\n")
    append("Content-Disposition: form-data; name=\"audio\"; filename=\"\(filename)\"\r\n")
    append("Content-Type: \(mimeType)\r\n\r\n")
    body.append(audio)
    append("\r\n")
    // Same language plumbing as refine() — the STT provider uses this as a
    // hint (empty/"auto" = model detects; explicit code = biases decoding).
    for (key, value) in ["targetApp": targetApp, "language": language] {
      append("--\(boundary)\r\n")
      append("Content-Disposition: form-data; name=\"\(key)\"\r\n\r\n")
      append("\(value)\r\n")
    }
    append("--\(boundary)--\r\n")

    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.timeoutInterval = knobDouble("kb.network.timeouts.transcribeCleanSec", 60)
    req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
    authorize(&req)
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
