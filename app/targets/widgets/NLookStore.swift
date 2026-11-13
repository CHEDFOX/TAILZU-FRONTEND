import ImageIO
import SwiftUI
import UIKit


// WHERE A DESIGN COMES FROM, AND WHAT STOPS A BAD ONE.
//
// The app writes designs into a NEW versioned folder in the App Group and then switches one small pointer file
// (nlook/current) with write-temp-then-rename, which is atomic for a file on both platforms. So nothing a running render
// reads is ever overwritten under it, and a half-written catalog can never be the current one.
//
//   nlook/current          the folder name of the current version ("v7")
//   nlook/v7/index.json    the index: palettes, design id to file, art key to file, font id to file
//   nlook/v7/<id>.json     one design
//   nlook/art/<sha>@3.png  art, by content, so a new sha is a new file and nothing in use is replaced
//   nlook/fonts/<sha>.ttf  hooked faces, registered into this process at first draw
//
// Nothing here fetches anything: the widget extension has no network at all. Every file was downloaded, checked (PNG magic
// bytes, size, sha256) and moved into place by the app.
//
// THE CRASH MARKER. Before a design's root view is built, a marker with this process's launch id is written. It is cleared
// from an async hop scheduled inside the root body, which runs after the snapshot pass in the same process. A marker left by
// ANOTHER launch, found at the next provider call, is a strike: two strikes mark the design bad, the native view draws, and
// the app reports the id so the server stops naming it for this device.

enum NLookStore {
  /// This process, so a marker can be told apart from one a dead process left.
  private static let launchId = UUID().uuidString

  private static let markKey = "tulmi.nlook.mark"
  private static let strikeKey = "tulmi.nlook.strikes"
  private static let badKey = "tulmi.nlook.bad"

  private static let lock = NSLock()
  private static var indexCache: NLookIndex?
  private static var designCache: [String: NLookDesign] = [:]
  /// Art is held by cost, not forever: a warm extension must not pin its whole decode budget. The system empties it
  /// under memory pressure, and a miss only costs one more decode.
  private static let artCache: NSCache<NSString, UIImage> = {
    let c = NSCache<NSString, UIImage>()
    c.totalCostLimit = NLookLimits.artCacheBytes
    return c
  }()
  private static var decodedBytes = 0
  private static var fontsDone = false

  // ---------------------------------------------------------------- the files

  private static var root: URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: WidgetAct.appGroup)?
      .appendingPathComponent("nlook", isDirectory: true)
  }

  /// A name that came out of a file must never climb out of the folder it names.
  private static func safeName(_ name: String) -> String? {
    let ok = Set("abcdefghijklmnopqrstuvwxyz0123456789._-@")
    guard (1...80).contains(name.count), name.lowercased().allSatisfy({ ok.contains($0) }),
          !name.contains(".."), name != ".", !name.hasPrefix(".") else { return nil }
    return name
  }

  /// The index of the current version.
  ///
  /// The few-byte `current` pointer is read on EVERY call, and the parsed index is kept only while it still names the
  /// same folder. A widget extension is kept warm between renders and a Live Activity renders in that same process, so
  /// caching the index for the life of the process would outlive the folder it points into: the app writes v(N+1),
  /// renames the pointer and DELETES vN, after which a stale index draws old designs from memory, falls back to the
  /// native view for every design not already read, and never shows a newly pushed one. Everything read out of the old
  /// folder goes with it.
  static var index: NLookIndex? {
    lock.lock()
    defer { lock.unlock() }
    #if NLOOK_TEST_SEAM
      // The harness has no App Group container: whatever `useForTests` installed is the catalog.
      if testing, let indexCache { return indexCache }
    #endif
    guard let root,
          let pointer = try? String(contentsOf: root.appendingPathComponent("current"), encoding: .utf8),
          let folder = safeName(pointer.trimmingCharacters(in: .whitespacesAndNewlines)) else {
      // No pointer any more: the catalog is gone, and so is everything this process read out of it.
      forgetVersion()
      return nil
    }
    if let indexCache, indexCache.folder == folder { return indexCache }
    // A different version than the one in hand: nothing read out of the old one may be reused.
    forgetVersion()
    guard let data = try? Data(contentsOf: root.appendingPathComponent(folder).appendingPathComponent("index.json")),
          let parsed = NLookIndex.parse(data, folder: folder) else { return nil }
    indexCache = parsed
    return parsed
  }

  /// Everything that belongs to one version of the catalog. Called with the lock held.
  private static func forgetVersion() {
    indexCache = nil
    designCache = [:]
    artCache.removeAllObjects()
    decodedBytes = 0
    X0Palette.forgetTheme()
  }

  /// Read one design off disk, whatever the marker says about it. Only `designOrFallback` below decides what is drawn.
  private static func load(_ id: String) -> NLookDesign? {
    guard let index else { return nil }
    lock.lock()
    if let hit = designCache[id] {
      lock.unlock()
      return hit
    }
    lock.unlock()
    guard let file = index.designs[id], let name = safeName(file), let root else { return nil }
    let url = root.appendingPathComponent(index.folder).appendingPathComponent(name)
    guard let data = try? Data(contentsOf: url), data.count <= 64 * 1024,
          let parsed = NLookDesign.parse(data), parsed.id == id else { return nil }
    lock.lock()
    designCache[id] = parsed
    lock.unlock()
    registerFonts()
    return parsed
  }

  /// The design to draw for an id, or nil for "draw today's native view".
  ///
  /// A design marked bad by the crash marker is read all the same — only so the id it names as its FALLBACK can be followed.
  /// Three hops at most, and an id already seen is never followed twice, so a catalog that points at itself cannot loop.
  static func designOrFallback(_ id: String?) -> NLookDesign? {
    guard let id, var next = NLookDesign.safeId(id) else { return nil }
    let marked = bad()
    var seen = Set<String>()
    for _ in 0..<3 {
      guard seen.insert(next).inserted, let found = load(next) else { return nil }
      if !marked.contains(found.id) { return found }
      guard let fallback = found.fallbackId else { return nil }
      next = fallback
    }
    return nil
  }

  #if NLOOK_TEST_SEAM
    /// THE ONE TEST SEAM, and it is not in the app. `NLOOK_TEST_SEAM` is passed only by the simulator snapshot harness
    /// (../../tools/nlook-harness/main.swift), never by the Expo build or the CI type-check, so the shipping extension does not contain this
    /// function at all. The harness has no App Group container, so it hands the store the same JSON bytes a real catalog
    /// holds and they go through the same two parsers the phone uses. Returns false if either parse refuses them.
    private static var testing = false

    static func useForTests(index data: Data, designs: [String: Data]) -> Bool {
      guard let parsed = NLookIndex.parse(data, folder: "test") else { return false }
      var read: [String: NLookDesign] = [:]
      for (id, bytes) in designs {
        guard let design = NLookDesign.parse(bytes), design.id == id else { return false }
        read[id] = design
      }
      lock.lock()
      defer { lock.unlock() }
      testing = true
      indexCache = parsed
      designCache = read
      return true
    }
  #endif

  /// The palette a design's roles resolve against; today's literals when the catalog has none by that name.
  static func palette(_ name: String) -> NLookPalette {
    index?.palettes[name] ?? (name == "island" ? .island : .fallback)
  }

  // ---------------------------------------------------------------- art

  /// One art file, decoded at the size it will be drawn and no larger. NEVER raw: WidgetKit refuses to archive a view whose
  /// image has more pixels than the family's area, and draws a placeholder instead.
  static func image(_ key: String, maxPx: CGFloat) -> UIImage? {
    guard let index, let file = index.art[key], let name = safeName(file), let root else { return nil }
    // Int(nan) traps, and the size came out of a file and an environment value, so it is checked before it is converted.
    let wanted = maxPx.isFinite ? maxPx.rounded() : 256
    let px = Int(max(16, min(1200, wanted)))
    let cacheKey = "\(name)#\(px)" as NSString
    lock.lock()
    if let hit = artCache.object(forKey: cacheKey) {
      lock.unlock()
      return hit
    }
    guard decodedBytes < NLookLimits.decodedBytes else {
      lock.unlock()
      return nil
    }
    lock.unlock()

    let url = root.appendingPathComponent("art", isDirectory: true).appendingPathComponent(name)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceShouldCacheImmediately: true,
      kCGImageSourceThumbnailMaxPixelSize: px,
    ]
    guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
    let image = UIImage(cgImage: cg)
    let cost = cg.width * cg.height * 4
    lock.lock()
    // The budget counts decodes within one version of the catalog, and `forgetVersion` puts it back to zero: a long-lived
    // extension must not stop drawing art because it has been alive a while.
    decodedBytes += cost
    artCache.setObject(image, forKey: cacheKey, cost: cost)
    lock.unlock()
    return image
  }

  /// What one art key costs at most on this root, so the island never decodes a banner-sized picture.
  static func maxPx(forRoot root: String, nodeSize: CGFloat, displaySize: CGSize, scale: CGFloat) -> CGFloat {
    let box = nodeSize > 0 ? nodeSize : max(displaySize.width, displaySize.height)
    let wanted = min(box, max(displaySize.width, displaySize.height)) * max(1, scale)
    return min(wanted, NLookLimits.regionMaxPx(root) * max(1, scale))
  }

  // ---------------------------------------------------------------- fonts

  /// Register the bundled faces and whatever the app hooked in, once per process.
  static func registerFonts() {
    lock.lock()
    let done = fontsDone
    fontsDone = true
    lock.unlock()
    guard !done else { return }
    var hooked: [URL] = []
    if let index, let root {
      let dir = root.appendingPathComponent("fonts", isDirectory: true)
      for (_, file) in index.fonts {
        guard let name = safeName(file) else { continue }
        hooked.append(dir.appendingPathComponent(name))
      }
    }
    NLookType.registerOnce(hooked: Array(hooked.prefix(4)))
  }

  // ---------------------------------------------------------------- the crash marker

  /// Design ids this phone has struck twice. The app reads the same key and reports them.
  static func bad() -> Set<String> {
    let raw = WidgetAct.store?.array(forKey: badKey) as? [String] ?? []
    return Set(raw)
  }

  /// Called from the provider, before anything is drawn: a marker from another launch means the last render died in there.
  static func checkMarker() {
    guard let store = WidgetAct.store, let mark = store.string(forKey: markKey) else { return }
    let parts = mark.split(separator: "|", maxSplits: 1).map(String.init)
    // A marker THIS process wrote is left alone. Every family and every Activity region shares the one key, so a provider
    // call made while another design's body is between `mark` and `clearMark` would otherwise wipe a live marker and the
    // crash it is there to catch would go uncounted. Only a marker from a dead launch is a strike, and only that is cleared.
    guard parts.count == 2 else {
      store.removeObject(forKey: markKey)
      return
    }
    guard parts[1] != launchId else { return }
    store.removeObject(forKey: markKey)
    guard let id = NLookDesign.safeId(parts[0]) else { return }
    var strikes = (store.dictionary(forKey: strikeKey) as? [String: Int]) ?? [:]
    let n = (strikes[id] ?? 0) + 1
    strikes[id] = n
    store.set(strikes, forKey: strikeKey)
    if n >= 2 {
      var marked = (store.array(forKey: badKey) as? [String]) ?? []
      if !marked.contains(id) {
        marked.append(id)
        store.set(Array(marked.suffix(32)), forKey: badKey)
      }
      lock.lock()
      designCache.removeValue(forKey: id)
      lock.unlock()
    }
  }

  /// Written before a design's root view is built.
  static func mark(_ id: String) {
    WidgetAct.store?.set("\(id)|\(launchId)", forKey: markKey)
  }

  /// Cleared from inside the root body, on the next turn of the main queue — which runs after the snapshot pass in the same
  /// process. A render that died before this point leaves the marker behind, which is the whole point.
  static func clearMark() {
    DispatchQueue.main.async {
      WidgetAct.store?.removeObject(forKey: markKey)
    }
  }
}

/// What the app wrote beside the designs, so a widget can find one by id without reading the catalog.
struct NLookIndex {
  let v: Int
  let drawsFormat: Int
  let folder: String
  let palettes: [String: NLookPalette]
  /// design id to its file inside the version folder.
  let designs: [String: String]
  /// art key to its file in nlook/art.
  let art: [String: String]
  /// font id to its file in nlook/fonts.
  let fonts: [String: String]

  static func parse(_ data: Data, folder: String) -> NLookIndex? {
    guard data.count <= 512 * 1024,
          let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return nil }
    let p = NLookProps(o)
    func strings(_ k: String) -> [String: String] {
      guard let m = o[k] as? [String: Any] else { return [:] }
      var out: [String: String] = [:]
      for (key, value) in m {
        guard let s = value as? String, !s.isEmpty, key.count <= 80 else { continue }
        out[key] = s
      }
      return out
    }
    var palettes: [String: NLookPalette] = [:]
    for (name, value) in (o["palettes"] as? [String: Any]) ?? [:] {
      palettes[name] = NLookPalette.read(value)
    }
    return NLookIndex(
      v: p.int("v"),
      drawsFormat: p.int("drawsFormat", nlookFormat),
      folder: folder,
      palettes: palettes,
      designs: strings("designs"),
      art: strings("art"),
      fonts: strings("fonts"))
  }
}
