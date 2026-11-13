import UIKit
import ImageIO
import MobileCoreServices
import CryptoKit

/// Backend-driven media loader for the keyboard extension.
///
/// The main app can push any image asset (PNG, JPG, WebP, GIF, APNG, SVG) to
/// `bootstrap.media[key]` and reference it from the keyboard config; this
/// helper resolves the URL to a UIImage that UIKit knows how to render.
///
/// GIF / APNG handling: `UIImage(data:)` only decodes the first frame, so an
/// animated file would appear frozen. We use ImageIO to walk every frame,
/// read each frame's own delay from the GIF metadata, and build a proper
/// `UIImage.animatedImage(with:duration:)` — assigning that to a
/// `UIImageView.image` (or button's imageView) makes UIKit animate it
/// automatically at the source's timing.
///
/// A small disk cache in the shared App Group keeps a fetched asset warm
/// across keyboard sessions, so the mic art doesn't re-download every time
/// the user opens the keyboard.
enum TulmiImageLoader {
  private static var memory: [String: UIImage] = [:]
  /// Insertion order, so the cap can drop the oldest rather than everything.
  private static var order: [String] = []
  /// A keyboard extension is killed above roughly 48–60MB, and a decoded image
  /// is the largest thing this process holds. Unbounded, every distinct asset
  /// the backend has ever served stayed resident for the life of the extension
  /// — which is exactly the shape of "the keyboard vanishes mid-sentence".
  /// The disk cache is untouched by any of this, so an evicted image comes
  /// back without a network round trip. The server's number
  /// (kb.images.memoryCap); 12 until a config says otherwise.
  private static var memoryLimit: Int { max(0, knobInt("kb.images.memoryCap", 12)) }
  private static var inflight: Set<String> = []
  private static let appGroup = "group.com.tulmi.app"
  private static let cacheDirName = "keyboard-media"

  // MARK: - Public API

  /// Return an already-loaded image for `url` synchronously (memory or disk
  /// cache); nil when nothing has been fetched. Kicks off a background fetch
  /// on the first miss so subsequent calls succeed.
  static func cached(_ url: String, onLoad: (() -> Void)? = nil) -> UIImage? {
    if let hit = memory[url] { return hit }
    if let disk = readDisk(url) {
      remember(url, disk)
      return disk
    }
    fetch(url, onLoad: onLoad)
    return nil
  }

  /// Keep an image, and evict the oldest once the cap is passed.
  private static func remember(_ url: String, _ image: UIImage) {
    if memory[url] == nil { order.append(url) }
    memory[url] = image
    let cap = memoryLimit
    while order.count > cap {
      let oldest = order.removeFirst()
      memory.removeValue(forKey: oldest)
    }
  }

  /// Drop every decoded image. Called on a memory warning: holding pixels we
  /// can re-read from disk is not worth being killed for.
  static func purgeMemory() {
    memory.removeAll(keepingCapacity: false)
    order.removeAll(keepingCapacity: false)
    faceMemory.removeAll(keepingCapacity: false)
    faceOrder.removeAll(keepingCapacity: false)
  }

  // MARK: - Fetch + cache

  private static func fetch(_ url: String, onLoad: (() -> Void)?) {
    // OUR HOST, COMPILED IN (App Review 4.4.1, and the privacy promise). A
    // config push used to be able to point this at any host on the internet;
    // now a URL anywhere else is simply not fetched. `sf:`, `asset:` and
    // emoji icons need no network and are unaffected, and no config in the
    // field uses a remote image URL, so nothing that works today stops.
    guard isAllowedMediaURL(url) else { return }
    // Validate the URL BEFORE claiming the inflight slot. The old order claimed
    // the slot first, so a URL(string:) that failed returned WITHOUT ever
    // removing `url` from inflight — permanently blocking every future load of
    // that url. Constructing + inserting in this order can't leak the slot.
    guard let u = URL(string: url), inflight.insert(url).inserted else { return }
    // A GET, so it takes the backend client's retry policy (kb.network.retries
    // — none by default, the single attempt this always made).
    TulmiBackend.getWithRetry(URLRequest(url: u)) { data, _, _ in
      DispatchQueue.main.async {
        inflight.remove(url)
        guard let data = data, let img = decode(data) else { return }
        remember(url, img)
        writeDisk(data, url: url)
        onLoad?()
      }
    }
  }

  // MARK: - Decoder — handles static + animated (GIF / APNG)

  /// Maximum pixel dimension (long edge) any decoded frame is scaled to.
  /// Keyboard extensions run in a ~48MB memory ceiling — a 1024×1024 RGBA
  /// frame is 4MB, a 30-frame animation at that size unpacks to ~120MB and
  /// crashes the extension outright. 256px covers the largest mic button
  /// at 3× scale (~108px physical) with headroom for HDR / tint blending;
  /// larger sources are downscaled at decode time so the animated image
  /// footprint stays predictable. The server's number (kb.images.maxEdgePx);
  /// anything that isn't a positive number keeps 256.
  private static var maxFrameEdge: CGFloat {
    let v = knobDouble("kb.images.maxEdgePx", 256)
    // Capped too: the extension's memory ceiling allows nothing near 2048.
    return v.isFinite && v > 0 ? CGFloat(min(v, 2048)) : 256
  }

  /// Decode static or animated (GIF/APNG) image data, downscaling every frame
  /// to `maxFrameEdge` so the keyboard extension can't blow its ~48MB ceiling.
  /// Exposed (not private) so the SDUI renderer shares this ONE safe decoder
  /// instead of its own full-resolution one.
  static func decode(_ data: Data) -> UIImage? {
    guard let src = CGImageSourceCreateWithData(data as CFData, nil) else {
      return UIImage(data: data)
    }
    let count = CGImageSourceGetCount(src)
    if count <= 1 {
      // Single-frame path: still downscale if the source is huge, so the
      // idle mic button icon can't OOM the extension either.
      return decodeDownscaledSingle(src)
    }

    // ImageIO's `kCGImageSourceCreateThumbnailFromImageAlways` + a
    // max-pixel-size limit produces a downscaled frame in a single pass —
    // no separate resize step, no full-resolution decode into memory first.
    let scaleOpts: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceShouldCacheImmediately: true,
      kCGImageSourceThumbnailMaxPixelSize: Int(maxFrameEdge * UIScreen.main.scale),
    ]

    var frames: [UIImage] = []
    var total: TimeInterval = 0
    for i in 0..<count {
      guard let cg = CGImageSourceCreateThumbnailAtIndex(src, i, scaleOpts as CFDictionary) else {
        continue
      }
      total += frameDuration(src, index: i)
      frames.append(UIImage(cgImage: cg))
    }
    if frames.isEmpty { return UIImage(data: data) }
    return UIImage.animatedImage(with: frames, duration: total)
  }

  private static func decodeDownscaledSingle(_ src: CGImageSource) -> UIImage? {
    let scaleOpts: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceShouldCacheImmediately: true,
      kCGImageSourceThumbnailMaxPixelSize: Int(maxFrameEdge * UIScreen.main.scale),
    ]
    guard let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, scaleOpts as CFDictionary) else {
      return nil
    }
    return UIImage(cgImage: cg)
  }

  /// The delay for a frame whose source names none: the server's
  /// (kb.images.fallbackFrameDelaySec), 100ms until a config arrives — which
  /// matches how browsers render "instant" gifs.
  private static var fallbackFrameDelay: TimeInterval {
    let v = knobDouble("kb.images.fallbackFrameDelaySec", 0.1)
    return v.isFinite && v > 0 ? v : 0.1
  }

  /// Read per-frame delay from GIF / APNG metadata. Falls back to
  /// `fallbackFrameDelay` when the source omits a duration.
  private static func frameDuration(_ src: CGImageSource, index: Int) -> TimeInterval {
    guard let props = CGImageSourceCopyPropertiesAtIndex(src, index, nil) as? [String: Any] else {
      return fallbackFrameDelay
    }
    if let gif = props[kCGImagePropertyGIFDictionary as String] as? [String: Any] {
      if let d = gif[kCGImagePropertyGIFUnclampedDelayTime as String] as? Double, d > 0.0009 { return d }
      if let d = gif[kCGImagePropertyGIFDelayTime as String] as? Double, d > 0.0009 { return d }
    }
    if let png = props[kCGImagePropertyPNGDictionary as String] as? [String: Any] {
      if let d = png[kCGImagePropertyAPNGUnclampedDelayTime as String] as? Double, d > 0.0009 { return d }
      if let d = png[kCGImagePropertyAPNGDelayTime as String] as? Double, d > 0.0009 { return d }
    }
    return fallbackFrameDelay
  }

  // MARK: - Disk cache (shared via App Group so main app + keyboard hit it)

  private static func cacheDir() -> URL? {
    let fm = FileManager.default
    let base = fm.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
      ?? fm.urls(for: .cachesDirectory, in: .userDomainMask).first
    guard let root = base?.appendingPathComponent(cacheDirName, isDirectory: true) else { return nil }
    if !fm.fileExists(atPath: root.path) {
      try? fm.createDirectory(at: root, withIntermediateDirectories: true)
    }
    return root
  }

  private static func file(for url: String) -> URL? {
    guard let dir = cacheDir() else { return nil }
    var h: UInt64 = 5381
    for ch in url.unicodeScalars { h = (h << 5) &+ h &+ UInt64(ch.value) }
    return dir.appendingPathComponent(String(h, radix: 36) + ".bin")
  }

  /// A cached file older than kb.images.maxAgeSec is dropped and fetched
  /// again. 0 (the default) = never expire, which is how this always behaved.
  private static func readDisk(_ url: String) -> UIImage? {
    guard let f = file(for: url) else { return nil }
    let maxAge = knobDouble("kb.images.maxAgeSec", 0)
    if maxAge > 0,
       let attrs = try? FileManager.default.attributesOfItem(atPath: f.path),
       let modified = attrs[.modificationDate] as? Date,
       Date().timeIntervalSince(modified) > maxAge {
      try? FileManager.default.removeItem(at: f)
      return nil
    }
    guard let data = try? Data(contentsOf: f) else { return nil }
    return decode(data)
  }

  private static func writeDisk(_ data: Data, url: String) {
    guard let f = file(for: url) else { return }
    try? data.write(to: f, options: .atomic)
  }

  // MARK: - The art host, compiled in

  /// THE ONLY HOSTS THIS EXTENSION WILL FETCH A PICTURE FROM. A constant in
  /// the binary, not a flag: a skin that could name its own host could carry
  /// a tracking pixel, and a keyboard that fetches from a stranger is a 4.4.1
  /// problem whatever the server meant by it. Art and fonts are served
  /// content-addressed from here, with no cookies, no auth and no id in the
  /// URL.
  ///
  /// TWO names, both ours, both exact. The one API server answers to both for
  /// as long as the domain move lasts: `api.x0bot.com` is the new name and
  /// `api.tailzu.space` the old one, kept for builds already in the field.
  /// With only the new name, a phone whose App Group still says
  /// `api.tailzu.space` would take its config from one name and its art from
  /// the other, and would draw flat colours until the move finished. The lock
  /// is just as tight either way: our server, files by content hash, no
  /// cookies.
  static let allowedMediaHosts: Set<String> = ["api.x0bot.com", "api.tailzu.space"]

  /// `https://` only, and a host on the list. Anything else is refused: a
  /// scheme that is not https, an IP literal, a host with a port we did not
  /// compile in, a userinfo trick.
  ///
  /// A DEBUG build also admits the exact host the app is pointed at, over
  /// http or https, and nothing else. Skins launch dark, so a laptop or a
  /// staging server is the only place anyone can see face art before the
  /// owner's device checks. `#if DEBUG` is compiled out of every TestFlight
  /// and App Store build, so a review build carries exactly the two names
  /// above.
  static func isAllowedMediaURL(_ url: String) -> Bool {
    guard let u = URL(string: url),
          u.user == nil, u.password == nil,
          let host = u.host?.lowercased() else { return false }
    let scheme = u.scheme?.lowercased()
    if scheme == "https", allowedMediaHosts.contains(host) { return true }
    #if DEBUG
    if scheme == "https" || scheme == "http",
       let devHost = URL(string: TulmiBackend.baseUrl)?.host?.lowercased(),
       host == devHost {
      return true
    }
    #endif
    return false
  }

  /// How long a prefetch may sit idle. The same key the Android batch already
  /// reads (`TulmiImageLoader.kt`), so the knob parity check passes and both
  /// keyboards give up at the same point. `timeoutInterval` is an idle
  /// timeout, which is what a read timeout means; iOS has no separate connect
  /// timeout, so `kb.media.connectTimeoutMs` stays Android-only.
  private static var mediaReadTimeout: TimeInterval {
    min(60, max(1, knobDouble("kb.media.readTimeoutMs", 10000) / 1000))
  }

  /// The name a release build falls back to. Spelled out rather than taken
  /// from the Set, which has no order.
  static let defaultMediaHost = "api.x0bot.com"

  /// Where content-addressed art and fonts come from: the backend the app is
  /// pointed at WHEN that base is one `isAllowedMediaURL` would fetch from,
  /// else the compiled default. In a release build that means one of the two
  /// compiled names; in a DEBUG build it also means the laptop or staging
  /// server the app is pointed at.
  private static var mediaBase: String {
    let base = TulmiBackend.baseUrl
    let trimmed = base.hasSuffix("/") ? String(base.dropLast()) : base
    if isAllowedMediaURL(trimmed + "/v1/native/art/probe.png") { return trimmed }
    return "https://" + defaultMediaHost
  }

  // MARK: - Face art: prefetched in one batch, then read only from the cache

  /// The names the current config's `skin.manifest` listed. A face may draw
  /// nothing else: a file that was not in the manifest was never prefetched,
  /// so drawing it would mean a fetch mid-session — and a fetch mid-session
  /// is a request that could be tied to a keystroke.
  private static var faceManifest: Set<String> = []
  /// Decoded faces, keyed by (name, pixel edge). Separate from `memory` so
  /// the mic key's art and the key prints cannot evict each other.
  private static var faceMemory: [String: UIImage] = [:]
  private static var faceOrder: [String] = []
  private static var facePrefetched = Set<String>()

  static func setFaceManifest(_ names: Set<String>) {
    guard names != faceManifest else { return }
    faceManifest = names
    faceMemory.removeAll(keepingCapacity: false)
    faceOrder.removeAll(keepingCapacity: false)
  }

  /// ONE BATCH, right after the config arrives, and never again until the
  /// next config. Files already on disk are not re-fetched; a file over the
  /// cap, one whose bytes are not a PNG, or one that does not hash to the
  /// name it came under, is dropped and its key draws the flat colour for
  /// this session.
  static func prefetchFaceArt(_ names: [String]) {
    guard let dir = artDir() else { return }
    let base = mediaBase
    for name in names.prefix(KBSkin.maxArtFiles) {
      guard isArtName(name) else { continue }
      let f = dir.appendingPathComponent(name)
      if FileManager.default.fileExists(atPath: f.path) { continue }
      guard facePrefetched.insert(name).inserted else { continue }
      let urlString = base + "/v1/native/art/" + name
      guard isAllowedMediaURL(urlString), let u = URL(string: urlString) else { continue }
      var req = URLRequest(url: u)
      req.httpMethod = "GET"
      // No cookies and no credentials: content-addressed bytes need neither,
      // and a cookie is how a picture becomes a tracker.
      req.httpShouldHandleCookies = false
      req.timeoutInterval = mediaReadTimeout
      // The 64 hex characters in front of the `@` are this file's sha-256.
      let wantSha = String(name.prefix(64))
      URLSession.shared.dataTask(with: req) { data, response, _ in
        guard let data = data,
              data.count <= KBSkin.maxArtFileBytes,
              isPNG(data),
              (response as? HTTPURLResponse).map({ (200...299).contains($0.statusCode) }) == true,
              bytesMatch(data, sha: wantSha)
        else { return }
        try? data.write(to: f, options: .atomic)
      }.resume()
    }
  }

  /// Fetch the hooked fonts of a manifest, in the same one batch. A font file
  /// is TTF or OTF, at most 300 KB, and must hash to the sha-256 it is named
  /// by (Android checks the same thing in `KbSkin.fetchFont`); anything else
  /// is not written.
  static func prefetchFonts(_ fonts: [(id: String, sha256: String)]) {
    guard let dir = fontDir() else { return }
    let base = mediaBase
    for f in fonts.prefix(KBSkin.maxFontsPerConfig) {
      guard isSha256(f.sha256) else { continue }
      let out = dir.appendingPathComponent(f.sha256)
      if FileManager.default.fileExists(atPath: out.path) { continue }
      let urlString = base + "/v1/native/font/" + f.sha256
      guard isAllowedMediaURL(urlString), let u = URL(string: urlString) else { continue }
      var req = URLRequest(url: u)
      req.httpMethod = "GET"
      req.httpShouldHandleCookies = false
      req.timeoutInterval = mediaReadTimeout
      let wantSha = f.sha256
      URLSession.shared.dataTask(with: req) { data, response, _ in
        guard let data = data,
              data.count <= KBSkin.maxFontFileBytes,
              isFontFile(data),
              (response as? HTTPURLResponse).map({ (200...299).contains($0.statusCode) }) == true,
              bytesMatch(data, sha: wantSha)
        else { return }
        try? data.write(to: out, options: .atomic)
      }.resume()
    }
  }

  /// A hooked font already on disk, or nil. Never fetches.
  static func cachedFontFile(sha256: String) -> URL? {
    guard isSha256(sha256), let dir = fontDir() else { return nil }
    let f = dir.appendingPathComponent(sha256)
    return FileManager.default.fileExists(atPath: f.path) ? f : nil
  }

  /// A key's art, decoded at THAT KEY's size. Reads only the cache: nil means
  /// the flat colour for this session, and no request is ever made from here.
  ///
  /// nil also when the reference is not on the compiled host, is not in the
  /// manifest, or turns out to be animated — no animated raster in a face in
  /// format 1, because thirty animated keys is a different class of cost from
  /// one mic key. Motion in a print is a `mark` with a `program`, which is
  /// budgeted and capped at three keys.
  static func faceArt(_ ref: String, maxEdgePx: Int) -> UIImage? {
    guard let name = faceArtName(ref), faceManifest.contains(name) else { return nil }
    let px = max(8, min(KBSkin.maxArtEdgePx, maxEdgePx))
    let key = "\(name)|\(px)"
    if let hit = faceMemory[key] { return hit }
    guard let dir = artDir() else { return nil }
    let f = dir.appendingPathComponent(name)
    guard let data = try? Data(contentsOf: f), isPNG(data),
          data.count <= KBSkin.maxArtFileBytes,
          let src = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
    guard CGImageSourceGetCount(src) == 1 else { return nil }
    let opts: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceShouldCacheImmediately: true,
      kCGImageSourceThumbnailMaxPixelSize: px,
    ]
    guard let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary) else { return nil }
    let img = UIImage(cgImage: cg, scale: UIScreen.main.scale, orientation: .up)
    if faceMemory[key] == nil { faceOrder.append(key) }
    faceMemory[key] = img
    while faceOrder.count > KBSkin.maxArtFiles {
      let oldest = faceOrder.removeFirst()
      faceMemory.removeValue(forKey: oldest)
    }
    return img
  }

  /// THE BARE MANIFEST NAME, "<sha256>@<1|2|3>.png", and nothing else.
  ///
  /// No host travels in a config: each phone puts its own compiled host in
  /// front of this name. A URL, a path, or a `url:` prefix is not a name,
  /// even on a host we would have fetched from — the server refuses those
  /// forms at publish, both phones refuse them again here, and one spelling
  /// means the two keyboards can never disagree about what a face draws.
  static func faceArtName(_ ref: String) -> String? {
    isArtName(ref) ? ref : nil
  }

  /// THE ONE SHAPE AN ART NAME MAY HAVE: `<64 lower-case hex>@<1|2|3>.png`.
  ///
  /// The same pattern the server checks at publish and the same one Android
  /// uses (`KbSkin.ART_NAME`). `isSafeName` below is looser — it would also
  /// pass `logo.png` or `x@3.jpg` — and it stays where it belongs, guarding
  /// the cache folder. Names are the one place the two keyboards must refuse
  /// exactly the same spellings, or a skin draws on one phone and not the
  /// other.
  static func isArtName(_ name: String) -> Bool {
    // Hand-written rather than NSRegularExpression: this runs per key per
    // render, and the shape is fixed. Counted in scalars, not characters —
    // a combining mark would make `name.count` lie.
    let u = Array(name.unicodeScalars)
    guard u.count == 70 else { return false }      // 64 hex + "@" + scale + ".png"
    for i in 0..<64 where !isHexDigit(u[i]) { return false }
    guard u[64] == "@", u[65] == "1" || u[65] == "2" || u[65] == "3" else { return false }
    return u[66] == "." && u[67] == "p" && u[68] == "n" && u[69] == "g"
  }

  /// A hex sha-256, lower case. Font files are named by this and nothing else.
  static func isSha256(_ s: String) -> Bool {
    let u = s.unicodeScalars
    guard u.count == 64 else { return false }
    return u.allSatisfy(isHexDigit)
  }

  private static func isHexDigit(_ c: Unicode.Scalar) -> Bool {
    (c >= "0" && c <= "9") || (c >= "a" && c <= "f")
  }

  /// The lower-case hex sha-256 of some bytes. CryptoKit is available to an
  /// app extension and needs no entitlement.
  private static func sha256Hex(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }

  /// Do these bytes hash to the name they arrived under? Every art and font
  /// file is content-addressed, so the name IS the checksum — and because a
  /// file already on disk is never fetched again, one bad body (a proxy, a
  /// half-deployed server, a truncated response) would otherwise stick under
  /// a trusted name for good. Checking before the write is the whole fix.
  private static func bytesMatch(_ data: Data, sha: String) -> Bool {
    sha256Hex(data) == sha
  }

  /// A content-addressed file name: hex, digits, one `@scale`, one suffix. No
  /// slash, no dot-dot, nothing that could walk out of the cache folder.
  private static func isSafeName(_ name: String) -> Bool {
    guard !name.isEmpty, name.count <= 96, !name.contains("/"), !name.contains("..") else { return false }
    let ok = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@._-")
    return name.unicodeScalars.allSatisfy { ok.contains($0) }
  }

  private static func isPNG(_ data: Data) -> Bool {
    guard data.count > 8 else { return false }
    return Array(data.prefix(8)) == [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
  }

  /// TTF (`\0\u{1}\0\0` or "true") or OTF ("OTTO"), by its first four bytes.
  private static func isFontFile(_ data: Data) -> Bool {
    guard data.count > 4 else { return false }
    let head = Array(data.prefix(4))
    return head == [0x00, 0x01, 0x00, 0x00]      // TrueType
      || head == [0x74, 0x72, 0x75, 0x65]        // 'true'
      || head == [0x4F, 0x54, 0x54, 0x4F]        // 'OTTO'
  }

  private static func subdir(_ name: String) -> URL? {
    guard let root = cacheDir() else { return nil }
    let dir = root.appendingPathComponent(name, isDirectory: true)
    if !FileManager.default.fileExists(atPath: dir.path) {
      try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }
    return dir
  }
  private static func artDir() -> URL? { subdir("art") }
  private static func fontDir() -> URL? { subdir("font") }
}
