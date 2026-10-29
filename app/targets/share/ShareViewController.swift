import ImageIO
import UIKit
import UniformTypeIdentifiers

/// Tailzu in another app's Share menu.
///
/// THE EXTENSION DOES NO WORK OF ITS OWN. It copies what was shared into the
/// App Group the app and the keyboard already share, and opens the app:
///
///   files    → <group>/ShareIn/<batch>/<name>   (at most five, 50 MB each, or
///              the app's lower limits from the server, tulmi.share.config;
///              a picture iOS keeps as HEIC is made a JPEG, which the backend
///              reads)
///   the list → UserDefaults(group) "tulmi.share.pending", JSON:
///              { v: 1, at: <ms>, skipped: n, items: [
///                  { type: "text", text } | { type: "url", url } |
///                  { type: "file", path: "ShareIn/…", name, mime, bytes } ] }
///   then     → tulmi://share
///
/// The app takes the list (modules/tulmi-share consumeShared), sends the files
/// to POST /v1/files as the signed-in person, and opens the share-in screen,
/// where the person picks a bot or Ask (src/share/useShareIn.ts). No token, no
/// network here: an extension that holds nothing cannot leak anything.
///
/// Opening the app is the keyboard's mechanism (KeyboardViewController
/// attemptOpenApp): the real UIApplication from the responder chain, its
/// open(_:options:completionHandler:), and the legacy openURL: as the only
/// fallback. If iOS refuses, the share is still in the App Group and the app
/// picks it up the next time it comes to the front (within ten minutes).
final class ShareViewController: UIViewController {
  static let appGroup = "group.com.tulmi.app"
  static let pendingKey = "tulmi.share.pending"
  /// What the app last wrote for this card (src/share/shareConfig.ts, from the server's labels and flags):
  /// { v, words: { opening, tooBig, cantTake, saved }, limits: { maxFiles, maxBytes, maxText, maxPixels, closeMs },
  ///   card: { background, ink, dim, radius } }. Each falls back to the literal below.
  static let configKey = "tulmi.share.config"
  static let folder = "ShareIn"

  /// The app's block, read once per share. Empty until the app has written one.
  private static let config: [String: Any] = {
    guard let json = UserDefaults(suiteName: ShareViewController.appGroup)?.string(forKey: ShareViewController.configKey),
          let data = json.data(using: .utf8),
          let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return [:] }
    return o
  }()

  /// One of the card's words: the server's, else the literal.
  private static func word(_ key: String, _ fallback: String) -> String {
    guard let words = config["words"] as? [String: Any], let v = words[key] as? String else { return fallback }
    let t = v.trimmingCharacters(in: .whitespacesAndNewlines)
    return t.isEmpty ? fallback : String(t.prefix(160))
  }

  /// A limit the server may LOWER, never raise: `most` is what this extension can hold in its memory.
  private static func limit(_ key: String, _ most: Int) -> Int {
    guard let v = (config["limits"] as? [String: Any])?[key] as? NSNumber else { return most }
    let n = v.doubleValue
    guard n.isFinite, n >= 1 else { return most }
    // Compared as a Double first: Int() of a number past Int's range would stop the extension.
    return Int(min(n, Double(most)))
  }

  /// A colour from "#RRGGBB" or "#RRGGBBAA", else the fallback.
  private static func color(_ key: String, _ fallback: UIColor) -> UIColor {
    guard let hex = (config["card"] as? [String: Any])?[key] as? String else { return fallback }
    var h = hex.trimmingCharacters(in: .whitespaces)
    if h.hasPrefix("#") { h.removeFirst() }
    guard h.count == 6 || h.count == 8, let n = UInt64(h, radix: 16) else { return fallback }
    let rgba = h.count == 6 ? (n << 8) | 0xFF : n
    return UIColor(red: CGFloat((rgba >> 24) & 0xFF) / 255, green: CGFloat((rgba >> 16) & 0xFF) / 255,
                   blue: CGFloat((rgba >> 8) & 0xFF) / 255, alpha: CGFloat(rgba & 0xFF) / 255)
  }

  /// A number for the card's look, within [low, high], else the fallback.
  private static func cardNumber(_ key: String, _ fallback: Double, _ low: Double, _ high: Double) -> Double {
    guard let v = (config["card"] as? [String: Any])?[key] as? NSNumber else { return fallback }
    let n = v.doubleValue
    return n.isFinite ? min(max(n, low), high) : fallback
  }

  static var maxFiles: Int { limit("maxFiles", 5) }
  static var maxBytes: Int64 { Int64(limit("maxBytes", 50 * 1024 * 1024)) }
  static var maxText: Int { limit("maxText", 6000) }
  /// A picture bigger than this on its long side is made smaller when it has to become a JPEG anyway.
  static var maxPixels: Int { limit("maxPixels", 4096) }
  /// How long the card's last line stays before it closes.
  static var closeSeconds: Double {
    guard let v = (config["limits"] as? [String: Any])?["closeMs"] as? NSNumber, v.doubleValue.isFinite else { return 1.6 }
    return min(max(v.doubleValue, 300), 5000) / 1000
  }

  private let line = UILabel()
  private var started = false

  // MARK: - The one small card

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = UIColor.black.withAlphaComponent(CGFloat(Self.cardNumber("dim", 0.2, 0, 0.8)))
    let card = UIView()
    card.backgroundColor = Self.color("background", .white)
    card.layer.cornerRadius = CGFloat(Self.cardNumber("radius", 20, 0, 40))
    card.translatesAutoresizingMaskIntoConstraints = false
    line.text = Self.word("opening", "Opening X0 Bot…")
    line.textColor = Self.color("ink", UIColor(red: 0.04, green: 0.04, blue: 0.04, alpha: 1))
    line.font = .systemFont(ofSize: 15, weight: .semibold)
    line.textAlignment = .center
    line.numberOfLines = 2
    line.translatesAutoresizingMaskIntoConstraints = false
    card.addSubview(line)
    view.addSubview(card)
    NSLayoutConstraint.activate([
      card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      card.widthAnchor.constraint(equalToConstant: 260),
      line.topAnchor.constraint(equalTo: card.topAnchor, constant: 22),
      line.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -22),
      line.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 18),
      line.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -18),
    ])
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    guard !started else { return }
    started = true
    collect { [weak self] items, skipped in self?.handOff(items, skipped: skipped) }
  }

  // MARK: - What was shared

  private func collect(_ finish: @escaping ([[String: Any]], Int) -> Void) {
    let inputs = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
    guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.appGroup) else {
      finish([], 0)
      return
    }
    let root = container.appendingPathComponent(Self.folder, isDirectory: true)
    // A share the app never picked up is replaced by this one, files and all.
    try? FileManager.default.removeItem(at: root)
    let batch = UUID().uuidString
    let dir = root.appendingPathComponent(batch, isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

    let group = DispatchGroup()
    let lock = NSLock()
    var found: [(Int, [String: Any])] = []
    var skipped = 0
    var files = 0
    var index = 0
    let add: (Int, [String: Any]?) -> Void = { i, item in
      lock.lock()
      if let item = item { found.append((i, item)) } else { skipped += 1 }
      lock.unlock()
    }

    for input in inputs {
      // Words that came with the attachments: a caption, a page's title.
      if let said = input.attributedContentText?.string.trimmingCharacters(in: .whitespacesAndNewlines), !said.isEmpty {
        add(index, ["type": "text", "text": String(said.prefix(Self.maxText))])
        index += 1
      }
      for provider in input.attachments ?? [] {
        let i = index
        index += 1
        if Self.isFile(provider) {
          guard files < Self.maxFiles else { add(i, nil); continue }
          files += 1
          group.enter()
          saveFile(provider, into: dir, relative: "\(Self.folder)/\(batch)") { item in add(i, item); group.leave() }
        } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
          group.enter()
          provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { data, _ in
            let url = (data as? URL)?.absoluteString ?? (data as? String) ?? (data as? Data).flatMap { String(data: $0, encoding: .utf8) }
            if let u = url?.trimmingCharacters(in: .whitespacesAndNewlines), u.hasPrefix("http://") || u.hasPrefix("https://") {
              add(i, ["type": "url", "url": String(u.prefix(2000))])
            }
            group.leave()
          }
        } else if provider.hasItemConformingToTypeIdentifier(UTType.text.identifier) {
          group.enter()
          let type = provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) ? UTType.plainText.identifier : UTType.text.identifier
          provider.loadItem(forTypeIdentifier: type, options: nil) { data, _ in
            let text = (data as? String) ?? (data as? NSAttributedString)?.string ?? (data as? Data).flatMap { String(data: $0, encoding: .utf8) }
            if let t = text?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty {
              add(i, ["type": "text", "text": String(t.prefix(Self.maxText))])
            }
            group.leave()
          }
        }
      }
    }
    group.notify(queue: .main) {
      finish(found.sorted { $0.0 < $1.0 }.map { $0.1 }, skipped)
    }
  }

  /// A picture, a video, a recording, a PDF, or any file: something with bytes, not words or a web address.
  private static func isFile(_ p: NSItemProvider) -> Bool {
    if p.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) { return true }
    for t in [UTType.image, .movie, .audio, .pdf] where p.hasItemConformingToTypeIdentifier(t.identifier) { return true }
    return p.hasItemConformingToTypeIdentifier(UTType.data.identifier)
      && !p.hasItemConformingToTypeIdentifier(UTType.text.identifier)
      && !p.hasItemConformingToTypeIdentifier(UTType.url.identifier)
  }

  /// The bytes iOS hands over, as a file of ours in the App Group. Nil: unreadable or too big.
  private func saveFile(_ p: NSItemProvider, into dir: URL, relative: String, done: @escaping ([String: Any]?) -> Void) {
    let isImage = p.hasItemConformingToTypeIdentifier(UTType.image.identifier)
    let suggested = p.suggestedName
    // A picture already as JPEG or PNG is taken as it is; anything else (HEIC) is made a JPEG in keep().
    let preferred = [UTType.jpeg, .png, .gif, .webP].first { p.hasItemConformingToTypeIdentifier($0.identifier) }
    let bytesType = p.registeredTypeIdentifiers.first { UTType($0)?.conforms(to: .data) == true }
    guard let type = (isImage ? preferred?.identifier : nil) ?? bytesType else {
      // Only a file's address (the Files app): read it from where it is.
      p.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { data, _ in
        guard let url = data as? URL, url.isFileURL else { done(nil); return }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        done(Self.keep(url, name: suggested, image: isImage, into: dir, relative: relative))
      }
      return
    }
    p.loadFileRepresentation(forTypeIdentifier: type) { tmp, _ in
      // Valid only inside this block: copied before it returns.
      if let tmp = tmp {
        done(Self.keep(tmp, name: suggested, image: isImage, into: dir, relative: relative))
        return
      }
      // Some apps only hand over the thing itself: a screenshot as a UIImage, bytes as Data, a file's URL.
      p.loadItem(forTypeIdentifier: type, options: nil) { data, _ in
        if let url = data as? URL, url.isFileURL {
          done(Self.keep(url, name: suggested, image: isImage, into: dir, relative: relative))
          return
        }
        let fm = FileManager.default
        let scratch = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        var file: URL?
        var picture = isImage
        if let bytes = data as? Data, Int64(bytes.count) <= Self.maxBytes {
          let f = scratch.appendingPathExtension(UTType(type)?.preferredFilenameExtension ?? "bin")
          if (try? bytes.write(to: f)) != nil { file = f }
        } else if let image = data as? UIImage, let jpeg = image.jpegData(compressionQuality: 0.85) {
          let f = scratch.appendingPathExtension("jpg")
          if (try? jpeg.write(to: f)) != nil { file = f; picture = true }
        }
        guard let f = file else { done(nil); return }
        done(Self.keep(f, name: suggested, image: picture, into: dir, relative: relative))
        try? fm.removeItem(at: f)
      }
    }
  }

  /// Copy (or, for a picture the backend can't read, convert) `src` into the batch's folder.
  private static func keep(_ src: URL, name suggested: String?, image: Bool, into dir: URL, relative: String) -> [String: Any]? {
    let fm = FileManager.default
    let srcType = UTType(filenameExtension: src.pathExtension)
    let readable = [UTType.jpeg, .png, .gif, .webP].contains { srcType?.conforms(to: $0) == true }
    let convert = image && !readable
    var raw = suggested ?? src.deletingPathExtension().lastPathComponent
    // IMG_2041.HEIC made a JPEG is IMG_2041.jpg.
    if convert { raw = (raw as NSString).deletingPathExtension }
    var name = safeName(raw, ext: convert ? "jpg" : src.pathExtension)
    var dest = dir.appendingPathComponent(name)
    var n = 1
    while fm.fileExists(atPath: dest.path) {
      n += 1
      let base = (name as NSString).deletingPathExtension, ext = (name as NSString).pathExtension
      name = ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)"
      dest = dir.appendingPathComponent(name)
    }
    do {
      if convert {
        guard jpeg(from: src, to: dest) else { return nil }
      } else {
        let size = Int64((try? src.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0)
        guard size <= maxBytes else { return nil }
        try fm.copyItem(at: src, to: dest)
      }
    } catch {
      return nil
    }
    let bytes = Int64((try? dest.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0)
    guard bytes > 0, bytes <= maxBytes else { try? fm.removeItem(at: dest); return nil }
    let mime = UTType(filenameExtension: dest.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
    return ["type": "file", "path": "\(relative)/\(name)", "name": name, "mime": mime, "bytes": Double(bytes)]
  }

  /// A HEIC (or any picture the backend can't read) as a JPEG, at most maxPixels on its long side.
  private static func jpeg(from src: URL, to dest: URL) -> Bool {
    guard let source = CGImageSourceCreateWithURL(src as CFURL, nil) else { return false }
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: maxPixels,
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary),
          let out = CGImageDestinationCreateWithURL(dest as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else { return false }
    CGImageDestinationAddImage(out, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
    return CGImageDestinationFinalize(out)
  }

  /// A file name that is only a name: no folders, nothing odd, not too long, with its extension.
  private static func safeName(_ raw: String, ext: String) -> String {
    let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: " ._-()"))
    var scalars = String.UnicodeScalarView()
    let blank: Unicode.Scalar = "_"
    for s in raw.unicodeScalars { scalars.append(allowed.contains(s) ? s : blank) }
    var base = String(scalars).trimmingCharacters(in: CharacterSet(charactersIn: " ."))
    if base.isEmpty { base = "file" }
    base = String(base.prefix(100))
    let e = ext.lowercased().filter { $0.isLetter || $0.isNumber }
    if e.isEmpty || base.lowercased().hasSuffix(".\(e)") { return base }
    return "\(base).\(e)"
  }

  // MARK: - To the app

  private func handOff(_ items: [[String: Any]], skipped: Int) {
    guard !items.isEmpty else {
      if let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.appGroup) {
        try? FileManager.default.removeItem(at: container.appendingPathComponent(Self.folder))
      }
      close(saying: skipped > 0 ? Self.word("tooBig", "That's too big for X0 Bot.") : Self.word("cantTake", "X0 Bot can't take this one."))
      return
    }
    let payload: [String: Any] = ["v": 1, "at": Date().timeIntervalSince1970 * 1000, "skipped": skipped, "items": items]
    guard let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8) else {
      close(saying: Self.word("cantTake", "X0 Bot can't take this one."))
      return
    }
    UserDefaults(suiteName: Self.appGroup)?.set(json, forKey: Self.pendingKey)
    guard let url = URL(string: "tulmi://share") else { close(saying: Self.word("saved", "Saved. Open X0 Bot to send it.")); return }
    openApp(url) { [weak self] ok in
      if ok { self?.extensionContext?.completeRequest(returningItems: [], completionHandler: nil) }
      else { self?.close(saying: Self.word("saved", "Saved. Open X0 Bot to send it.")) }
    }
  }

  private func close(saying words: String) {
    line.text = words
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.closeSeconds) { [weak self] in
      self?.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
  }

  /// The keyboard's way (KeyboardViewController.attemptOpenApp): the genuine
  /// UIApplication in the responder chain and its modern open; the legacy
  /// openURL: only when there is none. Exactly one of the two fires.
  private func openApp(_ url: URL, completion: @escaping (Bool) -> Void) {
    var responder: UIResponder? = self
    while let r = responder {
      if let app = r as? UIApplication {
        app.open(url, options: [:]) { ok in DispatchQueue.main.async { completion(ok) } }
        return
      }
      responder = r.next
    }
    let sel = NSSelectorFromString("openURL:")
    responder = self
    while let r = responder {
      if r.responds(to: sel) {
        _ = r.perform(sel, with: url)
        completion(true)
        return
      }
      responder = r.next
    }
    completion(false)
  }
}
