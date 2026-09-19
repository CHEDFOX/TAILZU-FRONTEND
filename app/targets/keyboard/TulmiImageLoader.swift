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
  /// Insertion order, so the cap can drop the oldest rather than everything.
  private static var order: [String] = []
  /// A keyboard extension is killed above roughly 48–60MB, and a decoded image
  /// is the largest thing this process holds. Unbounded, every distinct asset
  /// the backend has ever served stayed resident for the life of the extension
  /// — which is exactly the shape of "the keyboard vanishes mid-sentence".
  /// The disk cache is untouched by any of this, so an evicted image comes
  /// back without a network round trip.
  private static let memoryLimit = 12
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
    while order.count > memoryLimit {
      let oldest = order.removeFirst()
      memory.removeValue(forKey: oldest)
    }
  }

  /// Drop every decoded image. Called on a memory warning: holding pixels we
  /// can re-read from disk is not worth being killed for.
  static func purgeMemory() {
    memory.removeAll(keepingCapacity: false)
    order.removeAll(keepingCapacity: false)
  }

  // MARK: - Fetch + cache

  private static func fetch(_ url: String, onLoad: (() -> Void)?) {
    // Validate the URL BEFORE claiming the inflight slot. The old order claimed
    // the slot first, so a URL(string:) that failed returned WITHOUT ever
    // removing `url` from inflight — permanently blocking every future load of
    // that url. Constructing + inserting in this order can't leak the slot.
    guard let u = URL(string: url), inflight.insert(url).inserted else { return }
    URLSession.shared.dataTask(with: u) { data, _, _ in
      DispatchQueue.main.async {
        inflight.remove(url)
        guard let data = data, let img = decode(data) else { return }
        remember(url, img)
        writeDisk(data, url: url)
        onLoad?()
      }
    }.resume()
  }

  // MARK: - Decoder — handles static + animated (GIF / APNG)

  /// Maximum pixel dimension (long edge) any decoded frame is scaled to.
  /// Keyboard extensions run in a ~48MB memory ceiling — a 1024×1024 RGBA
  /// frame is 4MB, a 30-frame animation at that size unpacks to ~120MB and
  /// crashes the extension outright. 256px covers the largest mic button
  /// at 3× scale (~108px physical) with headroom for HDR / tint blending;
  /// larger sources are downscaled at decode time so the animated image
  /// footprint stays predictable.
  private static let maxFrameEdge: CGFloat = 256

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
