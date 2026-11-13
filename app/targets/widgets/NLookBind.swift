import Foundation

// WHAT A DESIGN MAY READ: the closed bind table (the contract's BIND_PATHS), the word table, and the lists an `Each` walks.
//
// There are no expressions. A template is "{{a.path}}" and nothing else; a word may carry its own slots ({n}, {stage}, {of})
// and WORD_SLOTS below says exactly what fills each one, per surface — because "filled as today" was never one rule.
//
// Four rules this file keeps:
//   • An unknown path resolves to EMPTY, so a design written against a later glance degrades quietly instead of printing a
//     hole or a raw "{{…}}".
//   • A Text hides when EVERY slot in it resolved empty, so punctuation never prints on its own.
//   • A word whose slot has no fill on this surface resolves to empty whole. A bare "{n}" never prints.
//   • A sensitive path stays sensitive through an index and through an `it.`: the privacy rule lives here, never in a design.
//
// On the Live Activity the WORDS come from the last glance the app stored (the App Group), not from the push: a 4 KB push
// carries no words. Everything else there comes from ContentState.

/// One item of a list an `Each` walks: named fields, or one plain string for a list of names.
struct NLookItem {
  var fields: [String: String] = [:]
  var scalar: String = ""
  /// Field names whose words may be private, kept with the item so an `it.` cannot lose the mark.
  var sensitiveFields: Set<String> = []
  /// Lists this item holds of its own (a needs item's choices).
  var lists: [String: [NLookItem]] = [:]
}

/// Everything a design can see, on one surface, at one moment.
struct NLookBind {
  /// "widget" or "activity".
  let surface: String
  let glance: X0Glance?
  let state: BotsAtWorkAttributes.ContentState?
  let vars: [String: String]
  /// The entry's own date, so "{n} min in" counts to the minute the entry draws, not to now.
  let now: Date
  /// A lock or accessory root: a sensitive path resolves to the lock-safe words when the item is private.
  let lockSafe: Bool
  /// What a press has already done to an item, so an answered question stops offering its answers.
  let states: [String: RowState]
  /// The `Each` items in scope, innermost last.
  var scope: [(name: String, item: NLookItem)] = []

  // ---------------------------------------------------------------- words

  /// Today's literals, in one place, so no design has to carry a fallback it could not translate anyway (H1.9).
  static let wordDefaults: [String: String] = [
    "needsYou": "Needs you", "ready": "Ready", "ask": "Ask any bot…", "brand": "X0", "youDecide": "You decide",
    "working": "{n} working", "step": "Step {stage} of {of}", "minIn": "{n} min in", "seePr": "See the PR",
    "done": "Done", "answered": "Answered", "finish": "Open X0 to finish", "doneSeePr": "Done · See the PR",
    "min": "{n} min", "pr": "PR #{n}", "sending": "Sending…", "gone": "Already answered", "failed": "Open X0 to finish",
  ]

  /// What fills each slot of each word, per surface. A nil fill means the word cannot be drawn here at all.
  /// `minutesSince` is the one computed fill format 1 allows: whole minutes from that date to the entry's own date.
  private static let wordSlots: [String: [String: (widget: String?, state: String?)]] = [
    "step": ["stage": ("job.stage", "stage"), "of": ("job.of", "of")],
    "working": ["n": ("counts.working", nil)],
    "minIn": ["n": ("@minutes:job.startedAt", "@minutes:startedAt")],
    "min": ["n": ("lastDone.minutes", "minutes")],
    "pr": ["n": ("lastDone.pr.number", "pr.number")],
  ]

  /// A word of the server's, with its own slots filled. Empty when a slot of it has no fill on this surface.
  private func word(_ key: String) -> String {
    let template = glance?.words[key] ?? NLookBind.wordDefaults[key]
    guard let template, !template.isEmpty else { return "" }
    guard let slots = NLookBind.wordSlots[key] else { return template }
    var out = template
    for (slot, fill) in slots {
      let path = surface == "widget" ? fill.widget : fill.state
      // No fill on this surface: the whole word resolves empty, so a bare "{n}" never prints.
      guard let path else { return "" }
      out = out.replacingOccurrences(of: "{\(slot)}", with: slotValue(path))
    }
    return out
  }

  private func slotValue(_ path: String) -> String {
    guard path.hasPrefix("@minutes:") else { return raw(String(path)) }
    let from = String(path.dropFirst("@minutes:".count))
    guard let d = date(from) else { return "" }
    return String(wholeMinutes(now.timeIntervalSince(d)))
  }

  // ---------------------------------------------------------------- templates

  /// Fill a template. `hide` is true when the template HAD slots and every one of them resolved empty — then the Text draws
  /// nothing at all, so a stray "·" or "()" never prints on its own.
  func fill(_ template: String) -> (text: String, hide: Bool) {
    guard template.contains("{{") else { return (String(template.prefix(NLookLimits.textChars)), false) }
    var out = ""
    var rest = Substring(template)
    var slots = 0
    var filled = 0
    while let open = rest.range(of: "{{") {
      out += rest[..<open.lowerBound]
      let after = rest[open.upperBound...]
      guard let close = after.range(of: "}}") else {
        rest = after
        break
      }
      let path = String(after[..<close.lowerBound]).trimmingCharacters(in: .whitespaces)
      slots += 1
      let value = raw(path)
      if !value.isEmpty { filled += 1 }
      out += value
      rest = after[close.upperBound...]
      guard out.count <= NLookLimits.textChars * 2 else { break }
    }
    out += rest
    let text = String(out.prefix(NLookLimits.textChars))
    return (text, slots > 0 && filled == 0)
  }

  /// Whether anything a template names could be private, so the renderer redacts it on a locked phone.
  func sensitive(_ template: String) -> Bool {
    var rest = Substring(template)
    while let open = rest.range(of: "{{") {
      let after = rest[open.upperBound...]
      guard let close = after.range(of: "}}") else { return false }
      let path = String(after[..<close.lowerBound]).trimmingCharacters(in: .whitespaces)
      if isSensitive(path) { return true }
      rest = after[close.upperBound...]
    }
    return false
  }

  /// Words that can be private. `vars.*` is sensitive by default: a free string cannot be classified.
  func isSensitive(_ path: String) -> Bool {
    if path.hasPrefix("vars.") { return true }
    let tail = path.split(separator: ".").last.map(String.init) ?? path
    if ["question", "task", "result"].contains(tail) { return true }
    if path.hasPrefix("it."), let item = scope.last?.item {
      return item.sensitiveFields.contains(String(path.dropFirst(3)))
    }
    return false
  }

  // ---------------------------------------------------------------- one path

  /// One bind path as a string. Unknown, or nothing there: "".
  func raw(_ path: String) -> String {
    guard !path.isEmpty, path.count <= 80 else { return "" }

    if path == "it" { return scope.last?.item.scalar ?? "" }
    if path.hasPrefix("it.") {
      let name = String(path.dropFirst(3))
      guard let item = scope.last?.item else { return "" }
      return redact(item.fields[name] ?? "", sensitive: item.sensitiveFields.contains(name))
    }
    if path.hasPrefix("words.") { return word(String(path.dropFirst(6))) }
    if path.hasPrefix("vars.") {
      let key = String(path.dropFirst(5))
      guard !key.contains(".") else { return "" }
      return redact(vars[key] ?? "", sensitive: true)
    }
    if let indexed = indexedValue(path) { return indexed }

    return redact(plain(path), sensitive: isSensitive(path))
  }

  /// A sensitive value on a lock or accessory root, when the thing it belongs to is private, becomes the lock-safe line the
  /// server already wrote. A design cannot opt out of this.
  private func redact(_ value: String, sensitive: Bool) -> String {
    guard sensitive, lockSafe, isPrivateNow else { return value }
    let safe = glance?.lockLine ?? ""
    return safe.isEmpty ? (glance?.lockTitle ?? "") : safe
  }

  /// Whether what is on this surface right now was marked private by the server.
  private var isPrivateNow: Bool {
    if let state { return state.isPrivate }
    return glance?.asks.first?.isPrivate ?? false
  }

  /// "needs.items[0].question", and a nested "needs.items[0].choices[1].label".
  private func indexedValue(_ path: String) -> String? {
    guard let open = path.firstIndex(of: "["), let close = path.firstIndex(of: "]"), open < close else { return nil }
    let listPath = String(path[..<open])
    guard let n = Int(path[path.index(after: open)..<close]), (0...7).contains(n) else { return "" }
    var rest = String(path[path.index(after: close)...])
    if rest.hasPrefix(".") { rest.removeFirst() }
    let items = list(listPath)
    guard n < items.count else { return "" }
    let item = items[n]
    if rest.isEmpty { return item.scalar }
    if let deeper = rest.firstIndex(of: "["), let dClose = rest.firstIndex(of: "]"), deeper < dClose {
      let name = String(rest[..<deeper])
      guard let k = Int(rest[rest.index(after: deeper)..<dClose]), (0...7).contains(k),
            let inner = item.lists[name], k < inner.count else { return "" }
      var tail = String(rest[rest.index(after: dClose)...])
      if tail.hasPrefix(".") { tail.removeFirst() }
      return redact(inner[k].fields[tail] ?? "", sensitive: inner[k].sensitiveFields.contains(tail))
    }
    return redact(item.fields[rest] ?? "", sensitive: item.sensitiveFields.contains(rest))
  }

  /// The closed table itself. Everything outside it is "".
  private func plain(_ path: String) -> String {
    if surface == "activity" { return activityValue(path) }
    return glanceValue(path)
  }

  private func glanceValue(_ path: String) -> String {
    guard let g = glance else { return "" }
    switch path {
    case "case": return g.lead.rawValue
    case "greeting.hello": return g.hello
    case "greeting.line": return g.dayLine
    case "summary": return g.summary
    case "week.dots": return g.weekDots > 0 ? String(g.weekDots) : ""
    case "week.line": return g.weekLine
    case "needs.count": return g.needsCount > 0 ? String(g.needsCount) : ""
    case "counts.needs": return g.needsCount > 0 ? String(g.needsCount) : ""
    case "counts.working": return String(g.countWorking)
    case "job.id": return g.job?.id ?? ""
    case "job.bot": return g.job?.bot ?? ""
    case "job.task": return g.job?.task ?? ""
    case "job.stage": return g.job.map { String($0.stage) } ?? ""
    case "job.of": return g.job.map { String($0.of) } ?? ""
    case "job.stageName": return g.job?.stageName ?? ""
    case "job.link": return g.job?.link?.absoluteString ?? ""
    case "lastDone.id": return g.lastDone?.id ?? ""
    case "lastDone.bot": return g.lastDone?.bot ?? ""
    case "lastDone.botName": return g.lastDone?.botName ?? ""
    case "lastDone.result": return g.lastDone?.result ?? ""
    case "lastDone.minutes": return g.lastDone?.minutes.map(String.init) ?? ""
    case "lastDone.pr.number": return g.lastDone?.prNumber.map(String.init) ?? ""
    case "lastDone.link": return g.lastDone?.link?.absoluteString ?? ""
    case "lock.inline": return g.lockInline
    case "lock.title": return g.lockTitle
    case "lock.line": return g.lockLine
    case "links.ask": return (g.askURL ?? X0Links.ask).absoluteString
    case "links.home": return (g.homeURL ?? X0Links.home).absoluteString
    case "links.mic": return g.micURL?.absoluteString ?? ""
    default: return ""
    }
  }

  private func activityValue(_ path: String) -> String {
    guard let s = state else { return "" }
    switch path {
    case "bot": return s.bot
    case "botName": return s.botName
    case "face": return s.face ?? ""
    case "task": return s.task
    case "stage": return String(s.stage)
    case "of": return String(s.of)
    case "stageName": return s.stageName
    case "phase": return s.phase
    case "question": return s.question ?? ""
    case "itemId": return s.itemId ?? ""
    case "itemKind": return s.itemKind ?? ""
    case "decideLink": return s.decideLink ?? ""
    case "result": return s.result ?? ""
    case "minutes": return s.minutes.map(String.init) ?? ""
    case "pr.number": return s.pr.map { String($0.number) } ?? ""
    case "pr.url": return s.pr?.url ?? ""
    case "link": return s.link
    default: return ""
    }
  }

  // ---------------------------------------------------------------- dates, numbers, lists

  /// A date path, for a timer or a relative line.
  func date(_ path: String) -> Date? {
    switch (surface, path) {
    case ("widget", "job.startedAt"): return glance?.job?.startedAt
    case ("widget", "lastDone.endedAt"): return glance?.lastDone?.endedAt
    case ("activity", "startedAt"):
      guard let ms = state?.startedAt, ms > 0 else { return nil }
      return Date(timeIntervalSince1970: ms / 1000)
    default: return nil
    }
  }

  /// A number path, for a Bar or a Ring. A template ("{{job.stage}}") is filled first.
  ///
  /// Finite and bounded, always: `Double("inf")` parses, and `Int(.infinity)` traps. A design that asks for a stage of
  /// infinity gets nothing, and the node draws its fallback.
  func number(_ token: String?) -> Double? {
    guard let token, !token.isEmpty else { return nil }
    let text = token.contains("{{") ? fill(token).text : token
    guard let d = Double(text.trimmingCharacters(in: .whitespaces)), d.isFinite, abs(d) < 1e6 else { return nil }
    return d
  }

  /// The lists an `Each` may walk, and nothing else.
  func list(_ of: String) -> [NLookItem] {
    // An index in `of` picks WHICH item, not which list, so "needs.items[0].choices" is the same list as "needs.items[]
    // .choices". Only a literal 0 to 7 is a legal index.
    var key = of
    for n in 0...7 { key = key.replacingOccurrences(of: "[\(n)]", with: "[]") }
    switch (surface, key) {
    case ("widget", "bots"):
      return (glance?.bots ?? []).map { b in
        NLookItem(
          fields: [
            "slug": b.slug, "name": b.name, "color": b.color, "face": b.face, "state": b.state,
            "needs": b.needs > 0 ? String(b.needs) : "", "working": b.working ? "1" : "", "line": b.line,
            "link": b.link?.absoluteString ?? "",
          ],
          scalar: b.name)
      }
    case ("widget", "needs.items"):
      return (glance?.asks ?? []).map { a in
        NLookItem(
          fields: [
            "id": a.id, "kind": a.kind, "bot": a.bot, "botName": a.botName, "face": a.face, "question": a.question,
            "decideLink": a.decideLink?.absoluteString ?? "", "private": a.isPrivate ? "1" : "",
            "answerable": a.answerable ? "1" : "", "link": a.link?.absoluteString ?? "",
          ],
          scalar: a.question,
          sensitiveFields: ["question"],
          lists: ["choices": a.choices.map(NLookBind.choiceItem)])
      }
    case ("widget", "needs.items[].choices"):
      return (glance?.asks.first?.choices ?? []).map(NLookBind.choiceItem)
    case ("widget", "job.stages"):
      return (glance?.job?.stages ?? []).map { NLookItem(scalar: $0) }
    case ("activity", "stages"):
      return (state?.stages ?? []).map { NLookItem(scalar: $0) }
    case ("activity", "choices"):
      return (state?.answers ?? []).map(NLookBind.choiceItem)
    default:
      return []
    }
  }

  private static func choiceItem(_ c: X0Choice) -> NLookItem {
    NLookItem(fields: ["id": c.id, "label": c.label, "primary": c.primary ? "1" : ""], scalar: c.label)
  }

  // ---------------------------------------------------------------- conditions

  /// Whether a node's `if` lets it draw. An AND over keys, each key an OR over its values.
  func passes(_ c: NLookCond?, root: String, appearance: String, mode: String, reduced: Bool, standby: Bool) -> Bool {
    guard let c else { return true }
    func any(_ values: [String]?, _ actual: String) -> Bool {
      guard let values else { return true }
      return values.contains(actual)
    }
    guard any(c.family, root), any(c.appearance, appearance), any(c.mode, mode) else { return false }
    if let r = c.reduced, r != reduced { return false }
    if let s = c.standby, s != standby { return false }
    if let p = c.platform, p != "ios" { return false }
    guard any(c.cases, glance?.lead.rawValue ?? ""), any(c.phase, state?.phase ?? "") else { return false }
    if let has = c.has, raw(has).isEmpty { return false }
    if let want = c.canAnswer, want != canAnswer { return false }
    return true
  }

  /// Whether a press can answer right here: the item is answerable and nothing has already answered it.
  var canAnswer: Bool {
    if surface == "activity" {
      guard let s = state, let item = s.itemId, !item.isEmpty, !s.answers.isEmpty else { return false }
      return states[item] == nil
    }
    guard let a = glance?.asks.first, a.answerable else { return false }
    return states[a.id] == nil
  }

  /// The bot whose colour "$color" means on this surface.
  var boundBot: String {
    if surface == "activity" { return state?.bot ?? "" }
    guard let g = glance else { return "" }
    switch g.lead {
    case .needs: return g.asks.first?.bot ?? ""
    case .done: return g.lastDone?.bot ?? ""
    case .working: return g.job?.bot ?? g.bots.first(where: { $0.working })?.slug ?? ""
    case .quiet: return ""
    }
  }
}

extension BotsAtWorkAttributes.ContentState {
  /// The server's own mark. A private question is sent without its words, and its answers are not offered outside the app.
  var isPrivate: Bool { self.`private` == true }
}
