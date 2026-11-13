import AppIntents
import SwiftUI
import WidgetKit

// THE RENDERER: one node tree to one SwiftUI view.
//
// A switch over the fourteen node types, recursing through the same struct — no AnyView chains, so SwiftUI can still tell
// one entry's tree from the next and animate a change the way it does for a hand-written view.
//
// Nothing here can fail. A node whose type this build does not know draws its `fallback`, then nothing. A Text whose slots
// all resolved empty hides itself, so a stray "·" never prints. A missing head on a card draws THAT CARD'S BOT (its face,
// else a disc in its colour); other missing art draws its `alt`, then a bundled pose, then nothing. A design that gets ALL
// the way to nothing is handled a level up (X0Widget / BotsActivity), which then draws today's hand-written view instead.

/// Everything a tree needs that is not in the tree.
struct NLookCtx {
  /// "small", "rect", "lock", "island.bottom" — which root is being drawn, and what `if.family` is matched against.
  let root: String
  /// "widget" or "activity".
  let surface: String
  let scheme: NLookScheme
  let palette: NLookPalette
  let ink: NLookInk
  var bind: NLookBind
  let appearance: String
  /// iOS widgetRenderingMode: full, accented or vibrant.
  let mode: String
  /// Always-On.
  let reduced: Bool
  /// Lock Screen or StandBy: no container background.
  let standby: Bool
  /// A Lock Screen accessory family, where the system draws everything in one colour.
  let accessory: Bool
  let displaySize: CGSize
  let scale: CGFloat
  /// The running job, for the Live Activity's answer buttons.
  let jobId: String
  /// Today's context, so the Kit parts draw exactly what they draw in the hand-written views.
  let x0: X0Context
  /// The ROLE the nearest `bg` at or above this node names — "ink", "accent", "surface", or "" for none and for a `bg`
  /// that is a hex or a bot's colour rather than a role. See `defaultTint`.
  var bgRole: String = ""

  /// Today's palette, for the Kit parts, which take an X0Palette rather than a scheme.
  var p: X0Palette { x0.p }

  func color(_ token: String?) -> Color? { ink.color(token) }

  /// WHAT A TEXT IS WHEN THE DESIGN GIVES NO `tint`. One rule, the same in all three renderers (the contract states it next
  /// to `NLOOK_PROPS.Text`): `ground` when the nearest background at or above the node is the role `ink` or `accent`,
  /// `ink` everywhere else. It is decided by ROLE NAME, never by luminance, so light and dark give the same answer on every
  /// platform. Timers and a `sym:` image with no tint follow it too.
  var defaultTint: Color {
    bgRole == "ink" || bgRole == "accent" ? scheme.ground : scheme.ink
  }

  /// The role a `bg` token names, with any `@alpha` dropped. A hex, `$color` or `$bot.<slug>` names no role: it is still
  /// the NEAREST background, so it replaces whatever an ancestor said, and it is not ink or accent, so the words on it
  /// take `ink`.
  static func role(ofBG token: String?) -> String {
    guard var name = token, !name.isEmpty else { return "" }
    if let at = name.lastIndex(of: "@"), Double(String(name[name.index(after: at)...])) != nil {
      name = String(name[..<at])
    }
    return name.hasPrefix("#") || name.hasPrefix("$") ? "" : name
  }
}

/// A link a design may open: our own scheme, the app's own hosts, and the one https shape today's allow-list permits.
func nlookLink(_ s: String) -> URL? {
  if let u = appLink(s) { return u }
  guard s.hasPrefix("https://github.com/"), let u = URL(string: s) else { return nil }
  return u
}

struct NLookNodeView: View {
  let node: NLookNode
  let ctx: NLookCtx

  var body: some View {
    if ctx.bind.passes(
      node.cond, root: ctx.root, appearance: ctx.appearance, mode: ctx.mode, reduced: ctx.reduced,
      standby: ctx.standby) {
      drawn.nlookStyled(node.style, ctx)
    }
  }

  @ViewBuilder
  private var drawn: some View {
    switch node.type {
    case "V": stack(vertical: true)
    case "H": stack(vertical: false)
    case "Z": zstack
    case "Spacer": Spacer(minLength: node.props.cg("min") ?? 0)
    case "Grid": grid
    case "Text": text
    case "Image": picture
    case "Bot": bot
    case "Shape": shape
    case "Bar": bar
    case "Ring": ring
    case "Kit": kit
    case "Each": each
    case "Button": button
    default: fallbackView
    }
  }

  /// What a node draws when it cannot be drawn: the one node it names, then nothing at all.
  @ViewBuilder
  private var fallbackView: some View {
    if let f = node.fallback {
      NLookNodeView(node: f, ctx: inner)
    }
  }

  /// The context everything INSIDE this node draws in: its own words, its pictures, its children and its fallback. A `bg`
  /// here is the nearest background for all of them, which is what decides an untinted Text's colour; a node with no `bg`
  /// passes its ancestor's down untouched.
  private var inner: NLookCtx {
    guard let bg = node.style.bg, !bg.isEmpty else { return ctx }
    var next = ctx
    next.bgRole = NLookCtx.role(ofBG: bg)
    return next
  }

  // ---------------------------------------------------------------- layout

  private var gap: CGFloat { max(0, min(64, node.props.cg("gap") ?? 0)) }
  private var align: NLookAlign { NLookAlign.read(node.props.raw["align"]) ?? .start }

  @ViewBuilder
  private func stack(vertical: Bool) -> some View {
    if vertical {
      // V aligns ACROSS the stack: leading, centred, trailing.
      VStack(alignment: align == .center ? .center : align == .end ? .trailing : .leading, spacing: gap) {
        children
      }
    } else {
      // H aligns ACROSS the stack: top, centred, bottom — by box, never by text baseline.
      HStack(alignment: align == .center ? .center : align == .end ? .bottom : .top, spacing: gap) {
        children
      }
    }
  }

  private var zstack: some View {
    // Z takes one value for both axes: start is top-leading, end is bottom-trailing.
    ZStack(alignment: align == .center ? .center : align == .end ? .bottomTrailing : .topLeading) {
      children
    }
  }

  @ViewBuilder
  private var children: some View {
    ForEach(node.children.indices, id: \.self) { i in
      NLookNodeView(node: node.children[i], ctx: inner)
    }
  }

  /// A fixed grid, drawn as rows so both platforms place the same children in the same places.
  private var grid: some View {
    let cols = max(1, min(4, node.props.int("cols", 1)))
    let rows = stride(from: 0, to: node.children.count, by: cols).map { start in
      Array(node.children[start..<min(start + cols, node.children.count)])
    }
    return VStack(alignment: .leading, spacing: gap) {
      ForEach(rows.indices, id: \.self) { r in
        HStack(alignment: .top, spacing: gap) {
          ForEach(rows[r].indices, id: \.self) { c in
            NLookNodeView(node: rows[r][c], ctx: inner)
              .frame(maxWidth: .infinity, alignment: .leading)
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- text

  @ViewBuilder
  private var text: some View {
    let template = node.props.str("text")
    let filled = ctx.bind.fill(template)
    let body = cased(filled.text)
    if !filled.hide, !body.isEmpty || timerDate != nil {
      styledText(body)
    }
  }

  private var timerDate: Date? {
    if let p = node.props.text("timer") { return ctx.bind.date(p) }
    if let p = node.props.text("countdown") { return ctx.bind.date(p) }
    if let p = node.props.text("relative") { return ctx.bind.date(p) }
    return nil
  }

  @ViewBuilder
  private func styledText(_ body: String) -> some View {
    let size = node.props.cg("size") ?? 14
    let weight = node.props.int("weight", 400)
    let lines = max(1, min(8, node.props.int("lines", 1)))
    let scale = node.props.num("minScale").map { min(1, max(0.5, $0)) } ?? 1

    base(body)
      .font(NLookType.font(node.props.text("font"), size: size, weight: weight))
      .tracking(node.props.cg("track") ?? 0)
      .lineLimit(lines)
      .minimumScaleFactor(scale)
      .multilineTextAlignment(textAlign)
      // `tint` wins; with none, the rule in NLookCtx.defaultTint decides, so a label on an ink pill is readable rather
      // than ink-on-ink. A timer takes the same colour as any other word.
      .foregroundStyle(ctx.color(node.props.text("tint")) ?? inner.defaultTint)
      .modifier(NLookDigits(mono: node.props.str("digits") == "mono"))
      .modifier(NLookChange(kind: node.props.str("change")))
      .modifier(NLookPrivate(on: node.style.sensitive || ctx.bind.sensitive(node.props.str("text"))))
  }

  /// A live timer is the one thing a widget may redraw on its own: iOS runs it, not us.
  @ViewBuilder
  private func base(_ body: String) -> some View {
    // Both ranges are built so the end can never fall before the start: a start date from a push can be anything at all,
    // and a backwards ClosedRange traps rather than drawing badly.
    if let date = node.props.text("timer").flatMap({ ctx.bind.date($0) }) {
      Text(timerInterval: date...max(date.addingTimeInterval(1), Date(timeIntervalSinceNow: 43_200)), countsDown: false)
    } else if let date = node.props.text("countdown").flatMap({ ctx.bind.date($0) }) {
      Text(timerInterval: Date()...max(date, Date(timeIntervalSinceNow: 1)), countsDown: true)
    } else if let date = node.props.text("relative").flatMap({ ctx.bind.date($0) }) {
      Text(date, style: .relative)
    } else {
      Text(body)
    }
  }

  private var textAlign: TextAlignment {
    switch NLookAlign.read(node.props.raw["align"]) {
    case .center: return .center
    case .end: return .trailing
    default: return .leading
    }
  }

  private func cased(_ s: String) -> String {
    switch node.props.str("case") {
    case "upper": return s.uppercased()
    case "lower": return s.lowercased()
    default: return s
    }
  }

  // ---------------------------------------------------------------- pictures

  @ViewBuilder
  private var picture: some View {
    let src = ctx.bind.fill(node.props.str("src")).text
    let size = node.props.cg("size") ?? 0
    let tint = ctx.color(node.props.text("tint"))
    if let image = resolve(src) {
      let shown = Image(uiImage: image)
        .resizable()
        .interpolation(.high)
        .x0Desaturated()
        .aspectRatio(contentMode: node.props.str("fit") == "fill" ? .fill : .fit)
      sized(shown, size)
        .foregroundStyle(tint ?? inner.defaultTint)
        .clipped()
    } else if let name = symbolName(src) {
      // An untinted icon takes the same default a word does, so a symbol inside a filled pill is not ink on ink.
      sized(Image(systemName: name).resizable().aspectRatio(contentMode: .fit), size)
        .foregroundStyle(tint ?? inner.defaultTint)
    } else if src.hasPrefix("face:"), !pictureBot.isEmpty {
      // A head this phone has not got, on a card that HAS a bot (a person's own bot arrives with no face key at all):
      // that bot's own face — a disc in its colour with its initial. Never the design's pose alt, which would put Blip,
      // X0's own, where the bot belongs.
      ctx.x0.face(pictureBot, String(src.dropFirst(5)), size: size > 0 ? size : 32)
    } else if let alt = node.props.text("alt"), alt != src {
      // Missing art: the design's own alternative (a bundled pose, a symbol), then nothing.
      NLookNodeView(node: NLookNode(
        type: "Image",
        props: NLookProps(["src": alt, "size": Double(size), "fit": node.props.str("fit")]),
        style: .none, children: [], cond: nil, fallback: nil), ctx: inner)
    }
  }

  /// Whose card a `face:` picture is on: the row's own bot inside an `Each` (a bot row, a needs row), else the bot this
  /// surface is bound to. Empty only where no bot is bound at all — the quiet widget.
  private var pictureBot: String {
    let row = ctx.bind.raw("it.slug")
    if !row.isEmpty { return row }
    let asking = ctx.bind.raw("it.bot")
    if !asking.isEmpty { return asking }
    return ctx.bind.boundBot
  }

  /// An SF Symbol the system actually has; nil for anything else, so a bad name draws the `alt` instead of a hole.
  private func symbolName(_ src: String) -> String? {
    guard src.hasPrefix("sym:") else { return nil }
    let name = symbol(String(src.dropFirst(4)), "")
    return name.isEmpty ? nil : name
  }

  @ViewBuilder
  private func sized(_ image: some View, _ size: CGFloat) -> some View {
    if size > 0 {
      image.frame(width: size, height: size)
    } else {
      image
    }
  }

  /// What the four src prefixes point at. Nothing else is ever read, and nothing is ever fetched.
  private func resolve(_ src: String) -> UIImage? {
    if src.hasPrefix("art:") || src.hasPrefix(BotArtKey.prefix) {
      let key = src.hasPrefix("art:") ? String(src.dropFirst(4)) : src
      let px = NLookStore.maxPx(
        forRoot: ctx.root, nodeSize: node.props.cg("size") ?? 0, displaySize: ctx.displaySize, scale: ctx.scale)
      return NLookStore.image(key, maxPx: px)
    }
    if src.hasPrefix("face:") { return X0Faces.image(String(src.dropFirst(5))) }
    if src.hasPrefix("pose:") {
      let name = String(src.dropFirst(5))
      guard let pose = BlipPose(rawValue: name) else { return UIImage(named: "BlipHead") }
      return UIImage(named: pose.asset)
    }
    return nil
  }

  /// The dotted bot as a STILL: the app drew it from the bots' looks and left it beside the art, so the widget only reads it.
  /// Whatever the node draws, it is THAT BOT: the still, else the bot's own face. Blip is only for a node with no bot bound.
  @ViewBuilder
  private var bot: some View {
    let who = ctx.bind.fill(node.props.str("who")).text
    let slug = who == "$bot" || who.isEmpty ? ctx.bind.boundBot : who
    let size = node.props.cg("size") ?? 32
    let key = BotArtKey.make(
      who: slug, moment: node.props.str("moment"), at: node.props.num("at") ?? 0,
      dark: ctx.scheme.onDark, px: Int((size * max(1, ctx.scale)).rounded()))
    if let image = NLookStore.image(key, maxPx: size * max(1, ctx.scale)) {
      Image(uiImage: image)
        .resizable()
        .interpolation(.high)
        .x0Desaturated()
        .aspectRatio(contentMode: .fit)
        .frame(width: size, height: size)
    } else if slug.isEmpty {
      // No bot bound at all (the quiet widget): Blip, X0's own, in the nearest pose he already has, bundled in this build.
      Blip(pose: BlipPose(rawValue: node.props.str("moment")) ?? .rest, height: size)
    } else {
      // No still on this phone yet, but this is a bot's card: its own face (the App Group's head, else a disc in its
      // colour). Never Blip, who would put X0's mascot where the bot belongs. The face the activity was sent is used when
      // this node draws the bound bot; a row's own bot takes the one the glance names for it.
      ctx.x0.face(slug, slug == ctx.bind.boundBot ? ctx.bind.raw("face") : "", size: size)
    }
  }

  // ---------------------------------------------------------------- shapes, bars, rings

  @ViewBuilder
  private var shape: some View {
    let fill = ctx.color(node.props.text("fill"))
    let stroke = ctx.color(node.props.text("stroke"))
    let width = max(0.5, min(12, node.props.cg("width") ?? 1))
    switch node.props.str("kind") {
    case "capsule":
      outlined(Capsule(), fill, stroke, width)
    case "circle":
      outlined(Circle(), fill, stroke, width)
    case "ring":
      Circle().strokeBorder(stroke ?? fill ?? ctx.scheme.line, lineWidth: width)
    case "path":
      NLookPathShape(d: node.props.str("d"), viewBox: viewBox)
        .fill(fill ?? ctx.scheme.ink)
        .overlay {
          if let stroke {
            NLookPathShape(d: node.props.str("d"), viewBox: viewBox).stroke(stroke, lineWidth: width)
          }
        }
    case "dots":
      NLookDots(
        grid: max(1, min(40, node.props.int("grid", 8))),
        spacing: max(1, min(24, node.props.cg("spacing") ?? 4)),
        dot: max(0.5, min(12, node.props.cg("dot") ?? 2)),
        color: fill ?? ctx.scheme.ink)
    default:
      outlined(RoundedRectangle(cornerRadius: node.style.corner ?? 0), fill, stroke, width)
    }
  }

  private var viewBox: CGSize {
    let box = node.props.list("viewBox").compactMap { ($0 as? NSNumber)?.doubleValue }
    guard box.count == 4, box[2] > 0, box[3] > 0 else { return CGSize(width: 100, height: 100) }
    return CGSize(width: box[2], height: box[3])
  }

  @ViewBuilder
  private func outlined(_ s: some InsettableShape, _ fill: Color?, _ stroke: Color?, _ width: CGFloat) -> some View {
    s.fill(fill ?? .clear)
      .overlay {
        if let stroke { s.strokeBorder(stroke, lineWidth: width) }
      }
  }

  private var bar: some View {
    let of = Int(ctx.bind.number(node.props.text("of")) ?? 1)
    let value = Int(ctx.bind.number(node.props.text("value")) ?? 0)
    let names = node.props.text("segments").map { ctx.bind.list($0).map(\.scalar) } ?? []
    return StageBar(
      stage: value, of: max(1, of), color: ctx.color(node.props.text("color")) ?? ctx.scheme.ink,
      track: ctx.color(node.props.text("track")) ?? ctx.scheme.line,
      height: node.style.h?.points ?? 6,
      done: of > 0 && value >= of, labels: names.count > 1 ? names : [], p: ctx.p)
  }

  private var ring: some View {
    let of = Int(ctx.bind.number(node.props.text("of")) ?? 1)
    let value = Int(ctx.bind.number(node.props.text("value")) ?? 0)
    return StageRing(stage: value, of: max(1, of), width: node.props.cg("width") ?? 5)
  }

  // ---------------------------------------------------------------- today's own parts

  @ViewBuilder
  private var kit: some View {
    let inner = NLookProps(node.props.obj("props"))
    switch node.props.str("name") {
    case "askBar":
      AskBar(c: ctx.x0, height: node.style.h?.points ?? 40)
    case "stripes":
      Stripes(band: inner.cg("band") ?? 4, gap: inner.cg("gap") ?? 3)
        .fill(ctx.color(inner.text("fill")) ?? ctx.scheme.line)
    case "beads":
      Beads(
        dots: Int(ctx.bind.number(inner.text("value")) ?? 0), ink: ctx.scheme.ink, hollow: ctx.scheme.hollow,
        size: inner.cg("size") ?? 7, gap: inner.cg("gap") ?? 4)
    case "pill":
      X0Pill(
        label: ctx.bind.fill(inner.str("label")).text, primary: inner.bool("primary") == true, p: ctx.p,
        fill: inner.bool("fill") == true, height: inner.cg("height") ?? 30)
    case "mark":
      X0Mark(size: inner.cg("size") ?? 20)
    default:
      fallbackView
    }
  }

  // ---------------------------------------------------------------- lists and buttons

  /// A bounded repeat over data, never a loop: at most 8 on a widget, 3 in an Activity region.
  @ViewBuilder
  private var each: some View {
    let cap = ctx.surface == "activity" ? NLookLimits.activityEachMax : NLookLimits.eachMax
    let asked = node.props.int("max", cap)
    let copies = asked < 1 ? cap : min(cap, asked)
    let items = Array(ctx.bind.list(node.props.str("of")).prefix(copies))
    ForEach(items.indices, id: \.self) { i in
      ForEach(node.children.indices, id: \.self) { j in
        NLookNodeView(node: node.children[j], ctx: scoped(items[i]))
      }
    }
  }

  private func scoped(_ item: NLookItem) -> NLookCtx {
    var next = inner
    var bind = inner.bind
    bind.scope = Array((bind.scope + [(name: node.props.text("as") ?? "it", item: item)]).suffix(2))
    next.bind = bind
    return next
  }

  /// A button answers a needs item with the widget's own token, or opens a vetted link. Nothing else: both App Intent types
  /// are compiled in, and a design can never widen the token's scope.
  @ViewBuilder
  private var button: some View {
    let act = node.props.obj("act")
    let item = ctx.bind.fill((act["item"] as? String) ?? "").text
    let action = ctx.bind.fill((act["action"] as? String) ?? "").text
    let open = node.props.text("open").map { ctx.bind.fill($0).text }
    if !item.isEmpty, !action.isEmpty, ctx.bind.canAnswer {
      if ctx.surface == "activity" {
        Button(intent: AnswerBotsActivityIntent(job: ctx.jobId, item: item, action: action)) { children }
          .buttonStyle(.plain)
      } else {
        Button(intent: AnswerNeedIntent(item: item, action: action)) { children }
          .buttonStyle(.plain)
      }
    } else if let open, let url = nlookLink(open) {
      Link(destination: url) { children }
    } else {
      children
    }
  }
}

// ------------------------------------------------------------------ style

private struct NLookDigits: ViewModifier {
  let mono: Bool
  @ViewBuilder
  func body(content: Content) -> some View {
    if mono { content.monospacedDigit() } else { content }
  }
}

/// How a Text changes when a timeline entry replaces it. The only motion a widget has.
private struct NLookChange: ViewModifier {
  let kind: String
  func body(content: Content) -> some View {
    switch kind {
    case "numeric": return AnyView(content.contentTransition(.numericText()))
    case "fade": return AnyView(content.contentTransition(.opacity))
    case "push": return AnyView(content.contentTransition(.interpolate))
    default: return AnyView(content)
    }
  }
}

/// Words that can be private are redacted by iOS itself on a locked phone, over and above the lock-safe swap the bind does.
private struct NLookPrivate: ViewModifier {
  let on: Bool
  @ViewBuilder
  func body(content: Content) -> some View {
    if on { content.privacySensitive() } else { content }
  }
}

/// A path as a Shape, so it can be filled and stroked like any other.
struct NLookPathShape: Shape {
  let d: String
  let viewBox: CGSize

  func path(in rect: CGRect) -> Path {
    Path(nlook: d, viewBox: viewBox, in: rect) ?? Path()
  }
}

/// A dot matrix, drawn in one Canvas rather than a view per dot: a grid of hundreds of views would cost the extension more
/// than it has.
struct NLookDots: View {
  let grid: Int
  let spacing: CGFloat
  let dot: CGFloat
  let color: Color

  var body: some View {
    Canvas { context, size in
      let step = spacing + dot
      let cols = min(grid, Int(size.width / step) + 1)
      let rows = min(grid, Int(size.height / step) + 1)
      guard cols > 0, rows > 0, cols * rows <= 2_000 else { return }
      for y in 0..<rows {
        for x in 0..<cols {
          let r = CGRect(x: CGFloat(x) * step, y: CGFloat(y) * step, width: dot, height: dot)
          context.fill(Path(ellipseIn: r), with: .color(color))
        }
      }
    }
    .accessibilityHidden(true)
  }
}

extension View {
  /// Every style key format 1 promises, in the one order that makes them read the same on both platforms: pad, then frame,
  /// then background and border, then opacity and offset.
  @ViewBuilder
  func nlookStyled(_ s: NLookStyleSpec, _ ctx: NLookCtx) -> some View {
    self
      .modifier(NLookFrame(style: s))
      .modifier(NLookSkin(style: s, ctx: ctx))
  }
}

private struct NLookFrame: ViewModifier {
  let style: NLookStyleSpec

  private var alignment: Alignment {
    switch style.align {
    case .center: return .center
    case .end: return .bottomTrailing
    case .start: return .topLeading
    case nil: return .center
    }
  }

  func body(content: Content) -> some View {
    var out = AnyView(content)
    if style.hasPad {
      out = AnyView(out
        .padding(.top, style.pad.top).padding(.trailing, style.pad.right)
        .padding(.bottom, style.pad.bottom).padding(.leading, style.pad.left))
    }
    switch (style.w, style.h) {
    case (.some(.fill), .some(.fill)):
      out = AnyView(out.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: alignment))
    case (.some(.fill), _):
      out = AnyView(out.frame(maxWidth: .infinity, alignment: alignment))
    case (_, .some(.fill)):
      out = AnyView(out.frame(maxHeight: .infinity, alignment: alignment))
    default:
      break
    }
    let w = style.w?.points
    let h = style.h?.points
    if w != nil || h != nil {
      out = AnyView(out.frame(width: w, height: h, alignment: alignment))
    }
    if style.maxW != nil || style.maxH != nil {
      out = AnyView(out.frame(maxWidth: style.maxW, maxHeight: style.maxH, alignment: alignment))
    }
    return out
  }
}

private struct NLookSkin: ViewModifier {
  let style: NLookStyleSpec
  let ctx: NLookCtx

  func body(content: Content) -> some View {
    let corner = style.corner ?? 0
    let shape = RoundedRectangle(cornerRadius: corner, style: .continuous)
    var out = AnyView(content)
    if let bg = ctx.color(style.bg) {
      out = AnyView(out.background { shape.fill(bg) })
    }
    if let border = ctx.color(style.borderColor), style.borderWidth > 0 {
      out = AnyView(out.overlay { shape.strokeBorder(border, lineWidth: style.borderWidth) })
    }
    if corner > 0 {
      out = AnyView(out.clipShape(shape))
    }
    if let o = style.opacity {
      out = AnyView(out.opacity(o))
    }
    if let off = style.offset {
      out = AnyView(out.offset(x: off.width, y: off.height))
    }
    if style.accent == "full" {
      out = AnyView(out.widgetAccentable())
    }
    return out
  }
}

/// How a bot still is named on disk: bot:<avatar>.<moment>@<t>.<scheme>.<px>. The app renders it from the bots' own looks,
/// on a CPU raster surface, only for the bots the current glance actually shows.
enum BotArtKey {
  static let prefix = "bot:"

  static func make(who: String, moment: String, at: Double, dark: Bool, px: Int) -> String {
    let t = max(0, min(1, at.isFinite ? at : 0))
    let slug = who.isEmpty ? "x0" : who
    let step = String(format: "%.2f", t)
    return "\(prefix)\(slug).\(moment.isEmpty ? "rest" : moment)@\(step).\(dark ? "dark" : "light").\(max(8, min(512, px)))"
  }
}
