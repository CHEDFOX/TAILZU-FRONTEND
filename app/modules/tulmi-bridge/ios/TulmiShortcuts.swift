import ExpoModulesCore
import UIKit

/// LONG-PRESS THE APP ICON: the Home Screen quick actions (Ask, Dictate, New note, Spaces), as the server lists them
/// (app.quickActions.ios; src/quickActions in the app). The list is set from JavaScript on every launch (setQuickActions); a press
/// reaches the app delegate (TulmiShortcutsAppDelegate below, registered in expo-module.config.json), which keeps the item's link
/// for the app to take (consumeQuickAction) and tells a running app (the module's onQuickAction event).
///
/// A Dictate item names the microphone's arming screen in `arm` instead: a link may never open a microphone screen (any web page
/// can open tulmi://), so it leaves the keyboard's App Group tombstone, exactly as the Dictate control does (DictateControl.swift),
/// and the app's keyboard entry routes and arms it.
final class TulmiShortcuts {
  static let shared = TulmiShortcuts()

  private static let appGroup = "group.com.tulmi.app"
  private static let typePrefix = "space.tailzu.quick."
  private let lock = NSLock()
  private var pending: String?
  private var listener: (() -> Void)?
  private var work: [Int: UIBackgroundTaskIdentifier] = [:]
  private var nextWork = 1

  /// Called when an item was queued while the app runs (the module forwards it to JavaScript).
  static var onQueued: (() -> Void)? {
    get { shared.lock.lock(); defer { shared.lock.unlock() }; return shared.listener }
    set { shared.lock.lock(); shared.listener = newValue; shared.lock.unlock() }
  }

  /// The system's items for the server's list: [{ id, title, subtitle?, icon?, url, arm? }]. Bad entries are left out.
  static func items(from json: String) -> [UIApplicationShortcutItem] {
    guard let data = json.data(using: .utf8), let list = (try? JSONSerialization.jsonObject(with: data)) as? [Any] else { return [] }
    var out: [UIApplicationShortcutItem] = []
    for case let o as [String: Any] in list {
      guard let id = o["id"] as? String, !id.isEmpty, let title = o["title"] as? String, !title.isEmpty,
            let url = o["url"] as? String, !url.isEmpty else { continue }
      var info: [String: NSSecureCoding] = ["url": url as NSString]
      if let arm = o["arm"] as? String, !arm.isEmpty { info["arm"] = arm as NSString }
      let icon = (o["icon"] as? String).flatMap { name -> UIApplicationShortcutIcon? in
        guard !name.isEmpty, UIImage(systemName: name) != nil else { return nil }
        return UIApplicationShortcutIcon(systemImageName: name)
      }
      out.append(UIApplicationShortcutItem(
        type: typePrefix + id,
        localizedTitle: title,
        localizedSubtitle: (o["subtitle"] as? String).flatMap { $0.isEmpty ? nil : $0 },
        icon: icon,
        userInfo: info))
      if out.count >= 4 { break }
    }
    return out
  }

  /// Set the list, on the main thread.
  static func apply(_ json: String) {
    let list = items(from: json)
    DispatchQueue.main.async { UIApplication.shared.shortcutItems = list }
  }

  /// A press: its link kept for the app (or, for `arm`, the keyboard's tombstone left). True when it was one of ours.
  @discardableResult
  static func queue(_ item: UIApplicationShortcutItem) -> Bool {
    guard item.type.hasPrefix(typePrefix) else { return false }
    let info = item.userInfo ?? [:]
    if let arm = info["arm"] as? String, !arm.isEmpty {
      // The keyboard's own tombstone (consumeKeyboardDeepLink): only this app and its extensions can write it.
      let d = UserDefaults(suiteName: appGroup)
      d?.set(arm, forKey: "tulmi.kb.pendingDeepLink")
      d?.set(Date().timeIntervalSince1970 * 1000, forKey: "tulmi.kb.pendingDeepLinkAt")
    } else if let url = info["url"] as? String, !url.isEmpty {
      shared.lock.lock()
      shared.pending = url
      shared.lock.unlock()
    } else {
      return false
    }
    let tell = onQueued
    DispatchQueue.main.async { tell?() }
    return true
  }

  /// The link a press left, once.
  static func consume() -> String? {
    shared.lock.lock(); defer { shared.lock.unlock() }
    let url = shared.pending
    shared.pending = nil
    return url
  }

  /// A little background time (UIApplication's background task), by handle. Begun on the main thread; ended there too, and by
  /// the system's own expiry, whichever comes first.
  static func beginWork() -> Int {
    shared.lock.lock()
    let handle = shared.nextWork
    shared.nextWork += 1
    shared.lock.unlock()
    DispatchQueue.main.async {
      let task = UIApplication.shared.beginBackgroundTask(withName: "x0.quickAnswer") {
        shared.lock.lock()
        let t = shared.work.removeValue(forKey: handle)
        shared.lock.unlock()
        if let t, t != .invalid { UIApplication.shared.endBackgroundTask(t) }
      }
      shared.lock.lock()
      shared.work[handle] = task
      shared.lock.unlock()
    }
    return handle
  }

  static func endWork(_ handle: Int) {
    DispatchQueue.main.async {
      shared.lock.lock()
      let task = shared.work.removeValue(forKey: handle)
      shared.lock.unlock()
      if let task, task != .invalid { UIApplication.shared.endBackgroundTask(task) }
    }
  }
}

/// The app delegate's side: a press that launched the app (in its launch options), and one while it ran.
public class TulmiShortcutsAppDelegate: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    if let item = launchOptions?[.shortcutItem] as? UIApplicationShortcutItem {
      TulmiShortcuts.queue(item)
    }
    return true
  }

  public func application(
    _ application: UIApplication,
    performActionFor shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    completionHandler(TulmiShortcuts.queue(shortcutItem))
  }
}
