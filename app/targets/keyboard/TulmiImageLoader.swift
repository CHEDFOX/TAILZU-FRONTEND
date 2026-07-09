import UIKit
import ImageIO
import MobileCoreServices

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
      memory[url] = disk
      return disk
    }
    fetch(url, onLoad: onLoad)
    return nil
  }

  // MARK: - Fetch + cache

  private static func fetch(_ url: String, onLoad: (() -> Void)?) {
    guard inflight.insert(url).inserted, let u = URL(string: url) else { return }
    URLSession.shared.dataTask(with: u) { data, _, _ in
      DispatchQueue.main.async {
        inflight.remove(url)
        guard let data = data, let img = decode(data) else { return }
        memory[url] = img
        writeDisk(data, url: url)
        onLoad?()
      }
    }.resume()
  }

  // MARK: - Decoder — handles static + animated (GIF / APNG)

  private static func decode(_ data: Data) -> UIImage? {
    guard let src = CGImageSourceCreateWithData(data as CFData, nil) else {
      return UIImage(data: data)
    }
    let count = CGImageSourceGetCount(src)
    if count <= 1 { return UIImage(data: data) }

    var frames: [UIImage] = []
    var total: TimeInterval = 0
    for i in 0..<count {
      guard let cg = CGImageSourceCreateImageAtIndex(src, i, nil) else { continue }
      total += frameDuration(src, index: i)
      frames.append(UIImage(cgImage: cg))
    }
    if frames.isEmpty { return UIImage(data: data) }
    // UIKit fires the animation loop as soon as the animatedImage is placed
    // in a UIImageView. Duration is the FULL loop length.
    return UIImage.animatedImage(with: frames, duration: total)
  }

  /// Read per-frame delay from GIF / APNG metadata. Falls back to 100ms when
  /// the source omits a duration (matches how browsers render "instant" gifs).
  private static func frameDuration(_ src: CGImageSource, index: Int) -> TimeInterval {
    guard let props = CGImageSourceCopyPropertiesAtIndex(src, index, nil) as? [String: Any] else {
      return 0.1
    }
    if let gif = props[kCGImagePropertyGIFDictionary as String] as? [String: Any] {
      if let d = gif[kCGImagePropertyGIFUnclampedDelayTime as String] as? Double, d > 0.0009 { return d }
      if let d = gif[kCGImagePropertyGIFDelayTime as String] as? Double, d > 0.0009 { return d }
    }
    if let png = props[kCGImagePropertyPNGDictionary as String] as? [String: Any] {
      if let d = png[kCGImagePropertyAPNGUnclampedDelayTime as String] as? Double, d > 0.0009 { return d }
      if let d = png[kCGImagePropertyAPNGDelayTime as String] as? Double, d > 0.0009 { return d }
    }
    return 0.1
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

  private static func readDisk(_ url: String) -> UIImage? {
    guard let f = file(for: url), let data = try? Data(contentsOf: f) else { return nil }
    return decode(data)
  }

  private static func writeDisk(_ data: Data, url: String) {
    guard let f = file(for: url) else { return }
    try? data.write(to: f, options: .atomic)
  }
}
